// Skip — the standalone session check-in app.
// Real accounts (bcrypt + sessions), open public signup, the full Skip
// check-in flow (environment, drills, Feel/Confidence/Focus 1-10, instant
// session score + tier, Skip's journal read), a coach dashboard, and an API
// for the AI assistant. No programs, no video library — those live in the
// private programs portal. Free for now; subscription later (accounts ready).
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');

const db = require('./db');
const SQLiteStore = require('./store');
const data = require('./data');
const views = require('./views');
const { seedUsers, writeCredentialsFile, userCount } = require('./seed');

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';

app.use(
  session({
    store: new SQLiteStore(db),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---- First-boot seeding (used on Render: set SEED_ON_BOOT=true once) ----
if (process.env.SEED_ON_BOOT === 'true' && userCount() === 0) {
  const created = seedUsers();
  const outPath = writeCredentialsFile(created);
  console.log('=== FIRST-BOOT SEED COMPLETE ===');
  console.log(`Credentials file: ${outPath}`);
  for (const u of created) console.log(`  ${u.email} / ${u.password}`);
  console.log('Copy these now, then remove SEED_ON_BOOT and redeploy.');
}

// ---- Auth helpers ----

function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const row = db.prepare('SELECT id, email, role, athlete_name FROM users WHERE id = ?').get(req.session.userId);
    if (row) {
      req.user = {
        id: row.id,
        email: row.email,
        role: row.role,
        athleteName: row.athlete_name,
        displayName: row.athlete_name || 'Bobby',
      };
    }
  }
  next();
}
app.use(attachUser);

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireCoach(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'coach') return res.status(403).send('Forbidden');
  next();
}

// Simple in-memory throttle: 10 attempts per 5 minutes per IP.
const attempts = new Map();
function attemptAllowed(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, reset: now + 5 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 5 * 60 * 1000; }
  attempts.set(ip, rec);
  return rec.count < 10;
}
function attemptFailed(ip) {
  const rec = attempts.get(ip) || { count: 0, reset: Date.now() + 5 * 60 * 1000 };
  rec.count += 1;
  attempts.set(ip, rec);
}

// ---- Public routes: login / register / logout ----

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.loginPage(req.query.error));
});

app.post('/login', (req, res) => {
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.loginPage('Too many attempts. Wait a few minutes and try again.'));
  }
  const { email, password } = req.body;
  const clean = (email || '').trim().toLowerCase();
  const row = validEmail(clean)
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(clean)
    : null;
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    attemptFailed(ip);
    return res.send(views.loginPage('Wrong email or password.'));
  }
  req.session.userId = row.id;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.registerPage(req.query.error));
});

app.post('/register', (req, res) => {
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.registerPage('Too many attempts. Wait a few minutes and try again.'));
  }
  const fail = (msg) => {
    attemptFailed(ip);
    return res.send(views.registerPage(msg));
  };
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm_password || '';
  if (!validEmail(email)) {
    return fail('Enter a valid email address.');
  }
  if (password.length < 8) {
    return fail('Password must be at least 8 characters.');
  }
  if (password !== confirm) {
    return fail('Passwords do not match.');
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) {
    return fail('An account with that email already exists. Try logging in.');
  }
  const hash = bcrypt.hashSync(password, 12);
  const athleteName = email.split('@')[0];
  const info = db
    .prepare(
      'INSERT INTO users (email, password_hash, role, athlete_name, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(email, hash, 'athlete', athleteName, new Date().toISOString());
  req.session.userId = info.lastInsertRowid;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---- Skip's session score ----

const ENVIRONMENTS = ['Game', 'Cage', 'Live BP', 'Tee Work', 'Other'];

function scoreTier(score) {
  if (score >= 9.0) return 'Locked In';
  if (score >= 7.0) return 'Solid';
  if (score >= 5.0) return 'Off';
  return 'Rough';
}

function parseRating(v) {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 10 ? n : null;
}

function parseDrillsDone(raw) {
  // Form sends one text field; multiple drills are comma-separated.
  // Also accepts a JSON array string (API-style input).
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((d) => String(d).trim()).filter(Boolean);
    } catch (e) { /* fall through to comma split */ }
  }
  return s.split(',').map((d) => d.trim()).filter(Boolean);
}

// Drills ranked by this hitter's average session score (min 3 sessions each).
function drillStats(athleteName) {
  const rows = db
    .prepare('SELECT drills_done, session_score FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL')
    .all(athleteName);
  const map = new Map();
  for (const r of rows) {
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const seen = new Set();
    for (const d of drills) {
      const name = String(d || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { name, total: 0, count: 0 };
      e.total += r.session_score;
      e.count += 1;
      map.set(key, e);
    }
  }
  return [...map.values()]
    .filter((e) => e.count >= 3)
    .map((e) => ({ name: e.name, avg: Math.round((e.total / e.count) * 10) / 10, count: e.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
}

function userScoreSummary(userId) {
  const checkins = db
    .prepare('SELECT session_score FROM checkins WHERE user_id = ? AND session_score IS NOT NULL')
    .all(userId);
  const avgScore = checkins.length
    ? Math.round((checkins.reduce((s, c) => s + c.session_score, 0) / checkins.length) * 10) / 10
    : null;
  return { avgScore, checkinCount: checkins.length };
}

// ---- Hitter routes ----

app.get('/', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const { avgScore, checkinCount } = userScoreSummary(req.user.id);
  const recent = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 3')
    .all(req.user.id);
  res.send(views.userHome(req.user, {
    drillStats: drillStats(req.user.athleteName),
    avgScore,
    checkinCount,
    recent,
  }));
});

app.get('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.send(views.checkinForm(req.user, null, {}, data.drillNames()));
});

app.get('/checkin/score/:id', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const row = db
    .prepare('SELECT * FROM checkins WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).send('Check-in not found.');
  res.send(views.scorePage(req.user, row));
});

app.post('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const b = req.body;
  const fail = (msg) => res.send(views.checkinForm(req.user, msg, b, data.drillNames()));
  if (!ENVIRONMENTS.includes(b.environment)) {
    return fail('Pick the environment you were in.');
  }
  const feel = parseRating(b.feel);
  const confidence = parseRating(b.confidence);
  const focus = parseRating(b.focus);
  if (feel === null || confidence === null || focus === null) {
    return fail('Rate feel, confidence, and focus from 1 to 10.');
  }
  const drills = parseDrillsDone(b.drills_done);
  if (!drills.length) {
    return fail('Tell Skip what drills you did today.');
  }
  const sessionScore = Math.round(((feel + confidence + focus) / 3) * 10) / 10;
  const tier = scoreTier(sessionScore);
  const info = db
    .prepare(
      `INSERT INTO checkins
       (user_id, athlete_name, created_at, environment, drills_done, feel, confidence, focus,
        session_score, score_tier, session_notes, what_worked, whats_next)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      req.user.athleteName,
      new Date().toISOString(),
      b.environment,
      JSON.stringify(drills),
      feel,
      confidence,
      focus,
      sessionScore,
      tier,
      (b.session_notes || '').trim(),
      (b.what_worked || '').trim(),
      (b.whats_next || '').trim()
    );
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
});

app.get('/history', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const rows = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.send(views.historyPage(req.user, rows, req.query.saved === '1'));
});

// ---- Coach routes ----

app.get('/coach', requireCoach, (req, res) => {
  const users = db
    .prepare("SELECT id, email, athlete_name, created_at FROM users WHERE role != 'coach' ORDER BY created_at ASC")
    .all();
  const stats = users.map((u) => {
    const row = db
      .prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM checkins WHERE user_id = ?')
      .get(u.id);
    return { id: u.id, email: u.email, name: u.athlete_name || u.email, total: row.total, last: row.last };
  });
  const latest = db
    .prepare('SELECT * FROM checkins ORDER BY created_at DESC LIMIT 20')
    .all();
  res.send(views.coachDashboard(req.user, stats, latest));
});

app.get('/coach/user/:email', requireCoach, (req, res) => {
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id, email, athlete_name FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (!user) return res.status(404).send('Unknown user.');
  const rows = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  const name = user.athlete_name || user.email;
  res.send(views.coachUser(req.user, name, rows, drillStats(name)));
});

// Coach-only backup: download every check-in as JSON.
app.get('/coach/export', requireCoach, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.athlete_name, u.email, c.created_at, c.environment, c.drills_done,
              c.feel, c.confidence, c.focus, c.session_score, c.score_tier,
              c.session_notes, c.what_worked, c.whats_next,
              c.skip_journal_score, c.skip_journal_note, c.skip_rated_at
       FROM checkins c JOIN users u ON u.id = c.user_id ORDER BY c.created_at ASC`
    )
    .all()
    .map((r) => ({ ...r, drills_done: safeParseDrills(r.drills_done) }));
  res.setHeader('Content-Disposition', 'attachment; filename="skip-checkins-export.json"');
  res.json({ exported_at: new Date().toISOString(), checkins: rows });
});

// ---- Ingestion API for the AI assistant ----
//
// GET /api/checkins?since=<ISO timestamp>
// POST /api/checkins/:id/skip-rating   { score: 1-10, note: "..." }
// Auth: x-api-key header or ?key= query param, must equal SKIP_API_KEY.
// Returns: { "checkins": [ { id, athlete_name, email, created_at,
//   environment, drills_done[], feel, confidence, focus, session_score,
//   score_tier, session_notes, what_worked, whats_next,
//   skip_journal_score, skip_journal_note, skip_rated_at }, ... ] }
// ordered oldest-first.

const CHECKIN_COLS =
  'c.id, c.athlete_name, u.email, c.created_at, c.environment, c.drills_done, c.feel, c.confidence, c.focus, c.session_score, c.score_tier, c.session_notes, c.what_worked, c.whats_next, c.skip_journal_score, c.skip_journal_note, c.skip_rated_at';

function safeParseDrills(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function checkApiKey(req, res) {
  const apiKey = process.env.SKIP_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API not configured on server' });
    return false;
  }
  const provided = req.get('x-api-key') || req.query.key;
  if (provided !== apiKey) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/checkins', (req, res) => {
  if (!checkApiKey(req, res)) return;
  const { since } = req.query;
  let rows;
  if (since !== undefined) {
    if (Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'since must be an ISO timestamp' });
    }
    rows = db
      .prepare(
        `SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id
         WHERE c.created_at > ? ORDER BY c.created_at ASC LIMIT 1000`
      )
      .all(since);
  } else {
    rows = db
      .prepare(
        `SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id
         ORDER BY c.created_at ASC LIMIT 1000`
      )
      .all();
  }
  res.json({
    checkins: rows.map((r) => ({ ...r, drills_done: safeParseDrills(r.drills_done) })),
  });
});

// POST /api/checkins/:id/skip-rating — the AI assistant (Skip) posts its read
// of a hitter's journal after reading session_notes / what_worked.
// Body: { "score": <1-10 number>, "note": "<1-2 sentences in Skip's voice>" }.
// Sets skip_journal_score, skip_journal_note, skip_rated_at (now, ISO).
// 401 = bad key, 404 = unknown check-in id, 400 = bad body.
app.post('/api/checkins/:id/skip-rating', (req, res) => {
  if (!checkApiKey(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: 'check-in not found' });
  }
  const existing = db.prepare('SELECT id FROM checkins WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'check-in not found' });

  const b = req.body || {};
  const score = typeof b.score === 'number' ? b.score : Number(b.score);
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    return res.status(400).json({ error: 'score must be a number from 1 to 10' });
  }
  if (!note) {
    return res.status(400).json({ error: 'note must be a non-empty string' });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: 'note must be 500 characters or fewer' });
  }

  const ratedAt = new Date().toISOString();
  db.prepare(
    `UPDATE checkins SET skip_journal_score = ?, skip_journal_note = ?, skip_rated_at = ? WHERE id = ?`
  ).run(score, note, ratedAt, id);

  const row = db
    .prepare(`SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
    .get(id);
  res.json({ ...row, drills_done: safeParseDrills(row.drills_done) });
});

// ---- Talk to Skip (AI chat) ----
//
// GET /chat renders the chat page. POST /api/chat takes { message } and
// returns { reply }. The server injects the hitter's check-in data as
// context so Skip coaches off their actual sessions. Needs LLM_API_KEY
// (Anthropic) set on the server; without it the chat tab explains it is
// not switched on yet. 30 messages per hitter per day keeps API costs sane.

const LLM_MODEL = process.env.LLM_MODEL || 'claude-haiku-4-5';
const CHAT_DAILY_LIMIT = 30;

const SKIP_SYSTEM = `You are Skip, the AI hitting coach inside The Dugout, a session check-in app for baseball and softball hitters. Hitters check in after sessions and talk to you when they need coaching.

Voice: direct, no fluff. Talk like a good hitting coach — straight answers, specific fixes, zero motivational-poster talk. Short messages. Never lecture, never pad.

You get this hitter's check-in data below: recent sessions, scores, what they wrote, and which drills line up with their best days. Use it. When they're struggling, get them back on track by pointing at what actually worked on THEIR good days — specific drills, routines, feels — not generic advice.

Rules:
- Keep replies short: a few sentences, or a short list when giving a plan. This is a phone chat, not an essay.
- Be specific to THEIR data. Reference their drills, their scores, their own words.
- If they ask about something outside hitting and training, answer briefly and steer back to the plate.
- Never mention you are an AI model. You are Skip.
- No medical advice. If something sounds like pain or injury, tell them to get it checked by a trainer and stick to swing talk.`;

function hitterSnapshot(userId) {
  const rows = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus,
              session_score, score_tier, session_notes, what_worked, whats_next
       FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`
    )
    .all(userId);
  const lines = rows.map((r) => {
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const bits = [
      `${String(r.created_at).slice(0, 10)} · ${r.environment}`,
      r.session_score != null ? `Score ${r.session_score} (${r.score_tier})` : 'Unscored',
      `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}`,
      drills.length ? `Drills: ${drills.join(', ')}` : null,
      r.session_notes ? `Notes: "${String(r.session_notes).slice(0, 200)}"` : null,
      r.what_worked ? `What worked: "${String(r.what_worked).slice(0, 200)}"` : null,
    ].filter(Boolean);
    return '- ' + bits.join(' · ');
  });
  const scored = rows.filter((r) => r.session_score != null);
  const avg = scored.length
    ? scored.reduce((s, r) => s + r.session_score, 0) / scored.length
    : null;
  const last3 = scored.slice(0, 3);
  const prev = scored.slice(3);
  const avgOf = (arr) => arr.reduce((s, r) => s + r.session_score, 0) / arr.length;
  let trend = '';
  if (last3.length && prev.length) {
    const a = avgOf(last3), b = avgOf(prev);
    trend = `Trend: last ${last3.length} avg ${a.toFixed(1)} vs prior ${b.toFixed(1)} — ${
      a < b - 0.5 ? 'trending DOWN' : a > b + 0.5 ? 'trending UP' : 'holding steady'}.`;
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(userId).n;
  const top = drillStats(
    (db.prepare('SELECT athlete_name FROM users WHERE id = ?').get(userId) || {}).athlete_name
  ).slice(0, 3);
  return { lines, avg, total, trend, top };
}

async function askSkip(userId, userMessage) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const err = new Error('chat_not_configured');
    err.code = 'chat_not_configured';
    throw err;
  }
  const snap = hitterSnapshot(userId);
  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId)
    .reverse();
  const dataBlock = snap.lines.length
    ? `HITTER DATA (newest first):\n${snap.lines.join('\n')}\nSessions logged: ${snap.total}${
        snap.avg != null ? ` · Average score: ${snap.avg.toFixed(1)}` : ''
      }\n${snap.trend}${
        snap.top.length
          ? `\nDrills tied to their best days: ${snap.top.map((d) => `${d.name} (avg ${d.avg} over ${d.count})`).join(', ')}`
          : ''
      }`
    : 'HITTER DATA: no check-ins logged yet — this is a brand-new hitter. Ask what they are working on.';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 500,
      system: `${SKIP_SYSTEM}\n\n${dataBlock}`,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!resp.ok) {
    const err = new Error(`llm_http_${resp.status}`);
    err.code = 'llm_error';
    throw err;
  }
  const data = await resp.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) {
    const err = new Error('llm_empty');
    err.code = 'llm_error';
    throw err;
  }
  return text;
}

app.get('/chat', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const messages = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100')
    .all(req.user.id);
  res.send(views.chatPage(req.user, messages, !!process.env.LLM_API_KEY));
});

app.post('/api/chat', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'Forbidden' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep it under 2000 characters.' });
  const today = new Date().toISOString().slice(0, 10);
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND role = 'user' AND substr(created_at, 1, 10) = ?")
    .get(req.user.id, today).n;
  if (used >= CHAT_DAILY_LIMIT) {
    return res.status(429).json({ error: "You've hit today's chat limit (30). Back tomorrow." });
  }
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user.id, message);
    db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'assistant', reply, new Date().toISOString());
    res.json({ reply });
  } catch (err) {
    if (err.code === 'chat_not_configured') {
      return res.status(503).json({ error: "Skip's chat isn't switched on yet — check back soon." });
    }
    console.error('chat error:', err.message);
    return res.status(502).json({ error: 'Skip is having trouble right now. Try again in a bit.' });
  }
});

// ---- Boot ----

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skip listening on port ${PORT}`);
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'coach'").get().n;
  console.log(`Hitters signed up: ${n}`);
  if (!process.env.SESSION_SECRET && isProd) {
    console.warn('WARNING: SESSION_SECRET is not set.');
  }
  if (!process.env.SKIP_API_KEY) {
    console.warn('WARNING: SKIP_API_KEY is not set — the assistant API is disabled.');
  }
});
