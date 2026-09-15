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
const { pollCoachVideos, POLL_MS } = require('./feed');

const db = require('./db');
const SQLiteStore = require('./store');
const data = require('./data');
const views = require('./views');
const brain = require('./brain');
const { seedUsers, writeCredentialsFile, userCount } = require('./seed');

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// Never let browsers cache app pages or scripts — Bobby tests on his phone
// and stale cached pages caused real confusion (old wording, missing sections).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';

const sessionStore = new SQLiteStore(db);
app.use(
  session({
    store: sessionStore,
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
    const row = db.prepare('SELECT id, email, role, athlete_name, first_name, last_name, status FROM users WHERE id = ?').get(req.session.userId);
    if (row) {
      req.user = {
        id: row.id,
        email: row.email,
        role: row.role,
        athleteName: row.athlete_name,
        firstName: row.first_name || null,
        displayName: row.first_name || row.athlete_name || 'Coach',
        status: row.status || 'approved',
      };
    }
  }
  next();
}
app.use(attachUser);

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  // Athletes waiting for Bobby's approval can't use the app yet.
  if (req.user.role !== 'coach' && req.user.status !== 'approved') {
    return res.redirect('/pending');
  }
  next();
}

function requireCoach(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'coach') return res.status(403).send('Forbidden');
  next();
}

// Coach settings (key/value). Used for Bobby's Skip coaching notes.
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Skip's Brain v2: structured coaching library (see src/brain.js). Seeds the
// library on first boot and migrates any legacy free-text coaching notes.
brain.ensureBrain(db, getSetting, setSetting);

// Extract the express-session id from a WebSocket upgrade request's cookies.
function getWsSessionId(req) {
  const header = req.headers.cookie || '';
  const m = header.match(/(?:^|;\s*)connect\.sid=([^;]+)/);
  if (!m) return null;
  let val;
  try {
    val = decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
  if (val.startsWith('s:')) {
    val = val.slice(2);
    const dot = val.lastIndexOf('.');
    if (dot === -1) return null;
    val = val.slice(0, dot);
  }
  return val || null;
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
  if (req.query.reset) return res.send(views.loginPage(null, 'Password reset — log in with your new password.'));
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
  // New signups wait for Bobby's approval before they can get in.
  if (row.role !== 'coach' && row.status !== 'approved') {
    return res.send(views.loginPage('Your account is waiting for coach approval. You\u2019ll be able to log in once it\u2019s approved.'));
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
  const firstName = (req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = (req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!firstName || !lastName) {
    return fail('Enter your first and last name.');
  }
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
  const athleteName = `${firstName} ${lastName}`;
  const info = db
    .prepare(
      'INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(email, hash, 'athlete', athleteName, firstName, lastName, new Date().toISOString(), 'pending');
  // Tell Bobby so he can approve (or decline) the new hitter.
  notifyCoachOfSignup(req, email, athleteName).catch((e) =>
    console.warn('signup notify failed:', e.message)
  );
  res.redirect('/pending');
});

// Waiting room for athletes Bobby hasn't approved yet.
app.get('/pending', (req, res) => {
  if (req.user && (req.user.role === 'coach' || req.user.status === 'approved')) {
    return res.redirect('/');
  }
  res.send(views.pendingPage());
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

// ---- Skip session score: numbers + grind + the hitter's own words ----
// Base = mean of Feel/Confidence/Focus. Grind = how hard the training was:
// (difficulty - 5) * 0.2, clamped to [-1, +1] — grinding through a brutal
// session earns up to +1; an easy session with bad numbers loses up to 1.
// Words = what the hitter actually wrote: +0.5 / 0 / -0.5 from a small
// baseball-specific sentiment scan (negation-aware).
const WORDS_POSITIVE = [
  'locked in', 'dialed in', 'great', 'good', 'smooth', 'fluid', 'comfortable',
  'confident', 'clicked', 'squared it', 'barreled', 'barrels', 'better',
  'improved', 'improvement', 'progress', 'breakthrough', 'focused',
  'prepared', 'strong', 'quick hands', 'clean', 'consistent', 'on time',
  'stayed through', 'back up the middle', 'hard contact', 'felt good',
  'feeling good', 'easy', 'grooved',
];
const WORDS_NEGATIVE = [
  'frustrated', 'frustrating', 'terrible', 'awful', 'horrible', 'struggled',
  'struggling', 'late on', 'too late', 'under it', 'popping up', 'popped up',
  'pop ups', 'couldnt', 'cant', 'wouldnt', 'didnt', 'did not', 'lost',
  'pressing', 'anxious', 'nervous', 'rushed', 'rushing', 'tired', 'exhausted',
  'sore', 'soreness', 'pain', 'hurt', 'hurting', 'slump', 'angry', 'mad',
  'shut down', 'checked out', 'no energy', 'weak', 'inconsistent',
  'all over the place', 'chasing',
];
const NEGATORS =
  /\b(not|no|never|cannot|without|hardly|barely|wasnt|werent|isnt|arent|dont|doesnt|didnt|wont|cant|couldnt|shouldnt|wouldnt|hasnt|havent|hadnt)\b/;

function wordsAdjustment(text) {
  const t =
    ' ' +
    String(text || '')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ') +
    ' ';
  if (t.trim().length < 3) return 0;
  let net = 0;
  const scan = (phrases, sign) => {
    for (const p of phrases) {
      const needle = ' ' + p + ' ';
      let i = -1;
      while ((i = t.indexOf(needle, i + 1)) !== -1) {
        const before = t.slice(Math.max(0, i - 16), i);
        net += NEGATORS.test(before) ? -sign : sign;
      }
    }
  };
  scan(WORDS_POSITIVE, 1);
  scan(WORDS_NEGATIVE, -1);
  return net > 0 ? 0.5 : net < 0 ? -0.5 : 0;
}

function scoreBreakdown(feel, confidence, focus, difficulty, notesText) {
  const base = Math.round(((feel + confidence + focus) / 3) * 10) / 10;
  const d = difficulty == null ? 5 : difficulty;
  const grind = Math.round(Math.max(-1, Math.min(1, (d - 5) * 0.2)) * 10) / 10;
  const words = wordsAdjustment(notesText);
  const total = Math.round(Math.min(10, Math.max(1, base + grind + words)) * 10) / 10;
  return { base, grind, words, total };
}

const STATIONS = ['Tee', 'Side toss', 'Front toss', 'BP', 'Machine'];

function canonicalStation(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hit = STATIONS.find((st) => st.toLowerCase() === s.toLowerCase());
  return hit || (s.length <= 24 ? s : null);
}

function parseDrillsDone(raw) {
  // Form sends one text field; multiple drills are comma-separated.
  // A drill may carry its station in trailing parens: "Fence drill (tee)".
  // Also accepts a JSON array string (API-style input) of names or
  // {name, station} objects. Returns [{name, station|null}].
  const toEntry = (d) => {
    if (d && typeof d === 'object') {
      const name = String(d.name || '').trim();
      if (!name) return null;
      return { name, station: canonicalStation(d.station) };
    }
    let name = String(d || '').trim();
    if (!name) return null;
    let station = null;
    const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && m[1].trim()) {
      station = canonicalStation(m[2]);
      if (station) name = m[1].trim();
    }
    return { name, station };
  };
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(toEntry).filter(Boolean);
    } catch (e) { /* fall through to comma split */ }
  }
  return s.split(',').map(toEntry).filter(Boolean);
}

function getRoutine(userId) {
  const rows = db
    .prepare('SELECT id, name, station FROM routine_drills WHERE user_id = ? ORDER BY position, id')
    .all(userId);
  const order = new Map(STATIONS.map((s, i) => [s.toLowerCase(), i]));
  return rows
    .map((r) => ({ id: r.id, name: r.name, station: r.station || null }))
    .sort(
      (a, b) =>
        (order.get(String(a.station || '').toLowerCase()) ?? 99) -
        (order.get(String(b.station || '').toLowerCase()) ?? 99)
    );
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
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
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

// Thoughts from the hitter's own words ("what worked"), ranked by average
// session score (min 2 sessions each). Very similar phrasings are grouped
// together — "stayed back", "stay back", "staying back" become one entry.
function thoughtStats(athleteName) {
  const rows = db
    .prepare(
      `SELECT what_worked, session_score FROM checkins
       WHERE athlete_name = ? AND session_score IS NOT NULL
       AND what_worked IS NOT NULL AND TRIM(what_worked) <> ''`
    )
    .all(athleteName);
  const STOP = new Set([
    'the', 'a', 'an', 'and', 'to', 'of', 'my', 'i', 'it', 'on', 'in',
    'was', 'were', 'with', 'for', 'just', 'really', 'so', 'very', 'too',
    'felt', 'feeling', 'like', 'had', 'have',
  ]);
  const stem = (w) => {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
    return w;
  };
  const tokensOf = (t) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map(stem);
  const splitThoughts = (text) =>
    String(text)
      .split(/[\n;]+/)
      .map((s) =>
        s
          .trim()
          .replace(/^[\s•·▪\-–—]+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .slice(0, 140)
      )
      .filter((s) => s.length > 1);
  const groups = [];
  const similar = (aToks, aNorm, g) => {
    if (!aToks.length || !g.tokens.length) return false;
    const b = new Set(g.tokens);
    let inter = 0;
    for (const t of aToks) if (b.has(t)) inter++;
    const jaccard = inter / (aToks.length + g.tokens.length - inter);
    if (jaccard >= 0.6) return true;
    // One phrasing contains the other ("stay back" vs "really tried to stay back").
    if (aNorm.length >= 4 && g.norm.length >= 4) {
      if (aNorm.includes(g.norm) || g.norm.includes(aNorm)) return true;
    }
    return false;
  };
  for (const r of rows) {
    for (const thought of splitThoughts(r.what_worked)) {
      const toks = tokensOf(thought);
      const norm = thought.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      let g = groups.find((gg) => similar(toks, norm, gg));
      if (!g) {
        g = { tokens: toks, norm, variants: new Map(), total: 0, count: 0 };
        groups.push(g);
      }
      g.variants.set(thought, (g.variants.get(thought) || 0) + 1);
      g.total += r.session_score;
      g.count += 1;
    }
  }
  // External cues (target/outcome outside the body) rank before internal
  // cues (body-part instructions) — Bobby's rule.
  const INTERNAL_WORDS = [
    'hand', 'wrist', 'elbow', 'shoulder', 'hip', 'knee', 'ankle',
    'foot', 'feet', 'leg', 'head', 'eye', 'back', 'chest', 'body',
    'stride', 'load', 'barrel',
  ];
  const isInternal = (t) => {
    const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    return words.some((w) =>
      INTERNAL_WORDS.some((iw) => w === iw || w === iw + 's' || w === iw + 'es')
    );
  };
  return groups
    .filter((g) => g.count >= 2)
    .map((g) => {
      // Display the most common original phrasing.
      const display = [...g.variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        text: display,
        avg: Math.round((g.total / g.count) * 10) / 10,
        count: g.count,
        external: !isInternal(display),
      };
    })
    .sort(
      (a, b) =>
        (b.external - a.external || b.avg - a.avg || b.count - a.count)
    )
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
    thoughtStats: thoughtStats(req.user.athleteName),
    avgScore,
    checkinCount,
    recent,
  }));
});

app.get('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.send(views.checkinForm(req.user, null, {}, data.drillNames(), getRoutine(req.user.id)));
});

// ---- Daily routine ----
app.get('/routine', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.send(views.routinePage(req.user, getRoutine(req.user.id), null, data.drillNames(), STATIONS));
});

app.post('/routine/add', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const station = canonicalStation(req.body.station);
  if (!name || !station) {
    return res.send(views.routinePage(req.user, getRoutine(req.user.id), 'Give the drill a name and pick where it\u2019s done.', data.drillNames(), STATIONS));
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM routine_drills WHERE user_id = ?').get(req.user.id).p;
  db.prepare('INSERT INTO routine_drills (user_id, name, station, position) VALUES (?, ?, ?, ?)').run(
    req.user.id, name, station, pos
  );
  res.redirect('/routine');
});

app.post('/routine/remove', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM routine_drills WHERE id = ? AND user_id = ?').run(req.body.id, req.user.id);
  res.redirect('/routine');
});

// ---- Learn: hitting notebook + players studied + coach feed ----
app.get('/learn', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const notes = db
    .prepare('SELECT * FROM learning_notes WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const players = db
    .prepare('SELECT * FROM study_players WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const posts = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id AND r.reaction = 'like') AS likes,
        (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id AND r.reaction = 'dislike') AS dislikes,
        (SELECT reaction FROM post_reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS mine
       FROM coach_posts p ORDER BY p.id DESC`
    )
    .all(req.user.id);
  res.send(views.learnPage(req.user, notes, players, posts));
});

app.post('/learn/note', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const note = String(req.body.note || '').trim().slice(0, 1000);
  const category = String(req.body.category || '').trim().slice(0, 24);
  if (note) {
    db.prepare(
      "INSERT INTO learning_notes (user_id, note, category, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(req.user.id, note, category);
  }
  res.redirect('/learn');
});

app.post('/learn/player', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const playerName = String(req.body.player_name || '').trim().slice(0, 80);
  const takeaway = String(req.body.takeaway || '').trim().slice(0, 300);
  if (playerName) {
    db.prepare(
      "INSERT INTO study_players (user_id, player_name, takeaway, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(req.user.id, playerName, takeaway);
  }
  res.redirect('/learn');
});

app.post('/learn/note/:id/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM learning_notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/learn');
});

app.post('/learn/player/:id/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM study_players WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/learn');
});

// Like/dislike a coach post — tapping the same reaction again removes it.
app.post('/learn/post/:id/react', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const postId = Number(req.params.id);
  const reaction = req.body.reaction === 'dislike' ? 'dislike' : 'like';
  const existing = db
    .prepare('SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?')
    .get(postId, req.user.id);
  if (existing && existing.reaction === reaction) {
    db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?').run(postId, req.user.id);
  } else {
    db.prepare(
      `INSERT INTO post_reactions (post_id, user_id, reaction, created_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(post_id, user_id) DO UPDATE SET reaction = excluded.reaction`
    ).run(postId, req.user.id, reaction);
  }
  res.redirect('/learn');
});

app.get('/checkin/score/:id', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const row = db
    .prepare('SELECT * FROM checkins WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).send('Check-in not found.');
  row.score_breakdown = scoreBreakdown(
    row.feel,
    row.confidence,
    row.focus,
    row.difficulty,
    `${row.session_notes || ''} ${row.what_worked || ''}`
  );
  res.send(views.scorePage(req.user, row));
});

app.post('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const b = req.body;
  const fail = (msg) => res.send(views.checkinForm(req.user, msg, b, data.drillNames(), getRoutine(req.user.id)));
  if (!ENVIRONMENTS.includes(b.environment)) {
    return fail('Pick the environment you were in.');
  }
  const feel = parseRating(b.feel);
  const confidence = parseRating(b.confidence);
  const focus = parseRating(b.focus);
  const difficulty = parseRating(b.difficulty);
  if (feel === null || confidence === null || focus === null || difficulty === null) {
    return fail('Rate feel, confidence, focus, and difficulty from 1 to 10.');
  }
  const didDrills = b.did_drills;
  if (didDrills !== 'yes' && didDrills !== 'no') {
    return fail('Tell Skip whether you did any drills.');
  }
  const drills = parseDrillsDone(b.drills_done);
  if (didDrills === 'yes' && !drills.length) {
    return fail('You did drills — which ones?');
  }
  const sessionScore = scoreBreakdown(
    feel,
    confidence,
    focus,
    difficulty,
    `${b.session_notes || ''} ${b.what_worked || ''}`
  ).total;
  const tier = scoreTier(sessionScore);
  const info = db
    .prepare(
      `INSERT INTO checkins
       (user_id, athlete_name, created_at, environment, drills_done, feel, confidence, focus,
        difficulty, session_score, score_tier, session_notes, what_worked, whats_next)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      difficulty,
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

// Hitters waiting for Bobby's approval, oldest first.
function pendingList() {
  return db
    .prepare("SELECT id, email, athlete_name, first_name, last_name, created_at FROM users WHERE role = 'athlete' AND status = 'pending' ORDER BY created_at ASC")
    .all()
    .map((u) => ({
      ...u,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email,
    }));
}

// Number on the Approvals tab badge.
function setApprovalCount(req) {
  try {
    req.user.approvalCount = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'athlete' AND status = 'pending'")
      .get().n;
  } catch {
    req.user.approvalCount = 0;
  }
}

// Bobby posts a tip to the Learn feed — every hitter sees it.
app.post('/coach/post', requireCoach, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 1000);
  let link = String(req.body.link || '').trim().slice(0, 300);
  if (link && !/^https?:\/\//i.test(link)) link = '';
  if (title && body) {
    db.prepare(
      "INSERT INTO coach_posts (coach_name, title, body, source_url, created_at) VALUES ('Atkinson Hitting', ?, ?, ?, datetime('now'))"
    ).run(title, body, link);
  }
  res.redirect('/coach');
});

app.get('/coach', requireCoach, (req, res) => {
  setApprovalCount(req);
  const users = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name, created_at FROM users WHERE role != 'coach' AND status = 'approved' ORDER BY created_at ASC")
    .all();
  const stats = users.map((u) => {
    const row = db
      .prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM checkins WHERE user_id = ?')
      .get(u.id);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email;
    return { id: u.id, email: u.email, name, total: row.total, last: row.last };
  });
  const latest = db
    .prepare('SELECT * FROM checkins ORDER BY created_at DESC LIMIT 20')
    .all();
  const pending = pendingList();
  res.send(views.coachDashboard(req.user, stats, latest, pending));
});

// Approvals tab: approve or decline waiting hitters right here.
app.get('/coach/approvals', requireCoach, (req, res) => {
  setApprovalCount(req);
  res.send(views.coachApprovalsPage(req.user, pendingList()));
});

// Approve a waiting hitter — they can log in from here on.
app.post('/coach/approve/:id', requireCoach, (req, res) => {
  const u = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name FROM users WHERE id = ? AND role = 'athlete' AND status = 'pending'")
    .get(req.params.id);
  if (u) {
    db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(u.id);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email;
    sendApprovalEmail(req, u.email, name).catch((e) =>
      console.warn('approval email failed:', e.message)
    );
  }
  res.redirect('/coach/approvals');
});

// Decline a waiting hitter — removes the signup entirely.
app.post('/coach/decline/:id', requireCoach, (req, res) => {
  const u = db
    .prepare("SELECT id FROM users WHERE id = ? AND role = 'athlete' AND status = 'pending'")
    .get(req.params.id);
  if (u) deleteHitter(u.id);
  res.redirect('/coach/approvals');
});

app.get('/coach/user/:email', requireCoach, (req, res) => {
  setApprovalCount(req);
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (!user) return res.status(404).send('Unknown user.');
  const rows = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  const name = user.athlete_name || user.email;
  const thread = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 200')
    .all(user.id);
  res.send(views.coachUser(req.user, name, rows, drillStats(name), thoughtStats(name), thread, user.email, brain.listMemory(db, user.id)));
});

// Skip's memory of a hitter: Bobby's durable notes on what works for them.
app.post('/coach/user/:email/memory', requireCoach, (req, res) => {
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (user) brain.addMemory(db, user.id, req.body.fact);
  res.redirect(`/coach/user/${encodeURIComponent(em)}`);
});
app.post('/coach/user/:email/memory/:id/delete', requireCoach, (req, res) => {
  brain.deleteMemory(db, Number(req.params.id));
  const em = (req.params.email || '').toLowerCase();
  res.redirect(`/coach/user/${encodeURIComponent(em)}`);
});

// Delete a hitter from the platform: confirm page first, then the delete.
app.get('/coach/user/:email/delete', requireCoach, (req, res) => {
  setApprovalCount(req);
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (!user) return res.status(404).send('Unknown user.');
  const n = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(user.id).n;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.athlete_name || user.email;
  res.send(views.coachDeleteHitterPage(req.user, user, name, n));
});

app.post('/coach/user/:email/delete', requireCoach, (req, res) => {
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (user) deleteHitter(user.id);
  res.redirect('/coach');
});

// Remove a hitter and everything they created: check-ins, chats, routine, tokens.
function deleteHitter(userId) {
  for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'hitter_memory', 'learning_notes', 'study_players', 'post_reactions']) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// Coach-only backup: download every check-in as JSON.
app.get('/coach/export', requireCoach, (req, res) => {  const rows = db
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

// ---- Train Skip (coach HQ) ----
// Bobby talks to Skip directly to train him, keeps coaching notes that get
// injected into every hitter's Skip prompt, and reviews Skip's conversations
// with each hitter.

app.get('/coach/skip', requireCoach, (req, res) => {
  setApprovalCount(req);
  const entries = brain.listEntries(db);
  const hitters = db
    .prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.athlete_name,
              COUNT(m.id) AS n, MAX(m.created_at) AS last
       FROM users u LEFT JOIN chat_messages m ON m.user_id = u.id
       WHERE u.role != 'coach'
       GROUP BY u.id HAVING n > 0 ORDER BY last DESC`
    )
    .all()
    .map((h) => ({
      ...h,
      name: [h.first_name, h.last_name].filter(Boolean).join(' ') || h.athlete_name || h.email,
      lastSkip: (
        db
          .prepare(
            "SELECT content FROM chat_messages WHERE user_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"
          )
          .get(h.id) || {}
      ).content,
    }));
  const thread = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100')
    .all(req.user.id);
  res.send(views.coachSkipPage(req.user, entries, hitters, thread, !!process.env.LLM_API_KEY, req.query.saved === '1'));
});

// ---- Skip's Brain: Bobby's structured coaching library ----
// Add a new brain entry (rule, approach, cue, diagnosis, example, note).
app.post('/coach/skip/brain', requireCoach, (req, res) => {
  try {
    brain.addEntry(db, {
      type: req.body.type,
      title: req.body.title,
      body: req.body.body,
      tags: req.body.tags,
    });
  } catch (e) { /* bad type — ignore, stay on the page */ }
  res.redirect('/coach/skip?saved=1');
});

// Edit an entry's title/body/tags.
app.post('/coach/skip/brain/:id', requireCoach, (req, res) => {
  brain.updateEntry(db, Number(req.params.id), {
    title: req.body.title,
    body: req.body.body,
    tags: req.body.tags,
  });
  res.redirect('/coach/skip?saved=1');
});

// Archive or restore an entry (archived entries are never injected).
app.post('/coach/skip/brain/:id/archive', requireCoach, (req, res) => {
  brain.setEntryActive(db, Number(req.params.id), req.body.active === '1');
  res.redirect('/coach/skip?saved=1');
});

// Log a correction: what the hitter said, what Skip got wrong, what he
// should have said. Saved as an example entry so the fix sticks.
app.post('/coach/skip/correction', requireCoach, (req, res) => {
  const hitter = (req.body.hitter_said || '').trim().slice(0, 500);
  const wrong = (req.body.skip_said || '').trim().slice(0, 500);
  const right = (req.body.should_say || '').trim().slice(0, 1000);
  if (right) {
    const title = (hitter || 'Correction').slice(0, 80);
    const body = `Hitter: "${hitter || '(not specified)'}"\nWrong: "${wrong || '(not specified)'}"\nRight: "${right}"`;
    brain.addEntry(db, { type: 'example', title, body, tags: 'correction' });
  }
  res.redirect('/coach/skip?saved=1');
});

// Coach chats with Skip directly (stored as the coach's own thread).
app.post('/api/coach/chat', requireCoach, async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep it under 2000 characters.' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user, message, { coachMode: true });
    db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'assistant', reply, new Date().toISOString());
    res.json({ reply });
  } catch (err) {
    if (err.code === 'chat_not_configured') {
      return res.status(503).json({ error: "Skip's chat isn't switched on yet — check back soon." });
    }
    if (err.code === 'llm_rate_limit') {
      return res.status(429).json({ error: "Skip's getting a lot of traffic right now — try again in a minute." });
    }
    console.error('coach chat error:', err.message);
    return res.status(502).json({ error: 'Skip is having trouble right now. Try again in a bit.' });
  }
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
  'c.id, c.athlete_name, u.email, c.created_at, c.environment, c.drills_done, c.feel, c.confidence, c.focus, c.difficulty, c.session_score, c.score_tier, c.session_notes, c.what_worked, c.whats_next, c.skip_journal_score, c.skip_journal_note, c.skip_rated_at';

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
// Body: { "note": "<2-3 sentence summary in Skip's voice>", "score": <optional 1-10> }.
// Sets skip_journal_note, skip_rated_at (now, ISO); score optional, no longer shown in-app.
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
  const scoreRaw = b.score === undefined || b.score === null ? null : Number(b.score);
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (scoreRaw !== null && (!Number.isFinite(scoreRaw) || scoreRaw < 1 || scoreRaw > 10)) {
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
  ).run(scoreRaw, note, ratedAt, id);

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
// (a free Google AI Studio key) set on the server; without it the chat
// tab explains it is not switched on yet. No per-day message cap — Google's
// free tier may still rate-limit heavy use, handled with a friendly retry message.

const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';

const SKIP_CORE = `You are Skip, the AI hitting coach inside The Daily Hitter, a session check-in app for baseball and softball hitters. Hitters check in after sessions and talk to you when they need coaching. You coach the way your head coach coaches — his system is your system. Never mention your head coach by name to hitters.

VOICE: Direct, no fluff. Talk like a cage coach standing next to the hitter — straight answers, specific cues, zero motivational-poster talk. Short texts, not essays. Praise what's good first ("good swing, just too deep"), then give the one fix. Never lecture. Never mention you are an AI model. You are Skip.

HOW YOU COACH:
1. LEARN HIM OVER TIME — your #1 job. Every session and chat teaches you this hitter: his words, his feels, what his best days have in common. Know what each hitter needs — no two hitters get the same coaching.
2. GETTING HIM BACK ON TRACK — when he's struggling, work in this order: (a) his own past entries — take him back to what he was doing, feeling, and thinking on his best days, in his own words, name the date and level; (b) mental first — simple plan, clear intent, full commitment; (c) external cues — a target or outcome outside the body; (d) mechanics — needed a lot, and always fair game when the hitter brings them up. READ WHAT THE HITTER WANTS: if he's talking mechanics or asking for mechanical help, meet him there and coach mechanics directly — don't force the order on a hitter who's telling you what he needs. Never give generic advice to a hitter you have history on. Never mention numeric scores to hitters — talk only in levels and colors: red, yellow, green, bright green (bright green = best day).
3. Their words first — a cue in the hitter's own words beats a "better" cue every time.
4. One fix at a time — praise what's good first, then the single fix.
5. The head coach's playbook below overrides your defaults wherever they conflict. Use an entry only when it's relevant to what the hitter just said — never force one in.`;

function hitterSnapshot(userId) {
  const rows = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus, difficulty,
              session_score, score_tier, session_notes, what_worked, whats_next
       FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`
    )
    .all(userId);
  const lines = rows.map((r) => {
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const drillBits = drills.map((d) => {
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const station = d && typeof d === 'object' ? d.station : null;
      return station ? `${name} (${station})` : name;
    }).filter(Boolean);
    const bits = [
      `${String(r.created_at).slice(0, 10)} · ${r.environment}`,
      r.session_score != null ? `Level: ${r.score_tier}` : 'Unscored',
      `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}${r.difficulty != null ? ` Difficulty ${r.difficulty}` : ''}`,
      drillBits.length ? `Drills: ${drillBits.join(', ')}` : null,
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
    trend = `Trend: last ${last3.length} avg level ${scoreTier(a)} vs prior ${scoreTier(b)} — ${
      a < b - 0.5 ? 'trending DOWN' : a > b + 0.5 ? 'trending UP' : 'holding steady'}.`;
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(userId).n;
  const top = drillStats(
    (db.prepare('SELECT athlete_name FROM users WHERE id = ?').get(userId) || {}).athlete_name
  ).slice(0, 3);
  // Best-day anchor: the highest-scored session — what Skip takes the hitter
  // back to when they're struggling. This is the #1 priority, so it gets its
  // own explicit section in the data block.
  const best = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus,
              session_score, session_notes, what_worked
       FROM checkins WHERE user_id = ? AND session_score IS NOT NULL
       ORDER BY session_score DESC, created_at DESC LIMIT 1`
    )
    .get(userId);
  let bestDay = '';
  if (best) {
    let drills = [];
    try { drills = JSON.parse(best.drills_done || '[]'); } catch (e) { drills = []; }
    const names = drills
      .map((d) => String((d && typeof d === 'object' ? d.name : d) || '').trim())
      .filter(Boolean);
    const bits = [
      `${String(best.created_at).slice(0, 10)} · ${best.environment} · Level: ${scoreTier(best.session_score)}`,
      `Feel ${best.feel} Conf ${best.confidence} Focus ${best.focus}`,
      names.length ? `Drills: ${names.join(', ')}` : null,
      best.what_worked ? `What worked: "${String(best.what_worked).slice(0, 200)}"` : null,
      best.session_notes ? `Notes: "${String(best.session_notes).slice(0, 200)}"` : null,
    ].filter(Boolean);
    bestDay = bits.join(' · ');
  }
  return { lines, avg, total, trend, top, bestDay };
}

function skipDataBlock(userId) {
  const snap = hitterSnapshot(userId);
  const u = db.prepare('SELECT first_name FROM users WHERE id = ?').get(userId) || {};
  const mem = brain.memoryBlock(db, userId, u.first_name);
  const memBlock = mem ? `\n${mem}` : '';
  const learnRows = db
    .prepare(
      "SELECT note, category, substr(created_at,1,10) AS d FROM learning_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    )
    .all(userId);
  const playerRows = db
    .prepare('SELECT player_name, takeaway FROM study_players WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(userId);
  const learnBlock = learnRows.length
    ? `\nWHAT HE'S LEARNING (his own words — weave this into your coaching):\n${learnRows
        .map((r) => `- ${r.d}${r.category ? ` (${r.category})` : ''}: "${String(r.note).slice(0, 200)}"`)
        .join('\n')}`
    : '';
  const playersBlock = playerRows.length
    ? `\nPLAYERS HE STUDIES (connect your coaching to these guys):\n${playerRows
        .map((r) => `- ${r.player_name}${r.takeaway ? ` — "${String(r.takeaway).slice(0, 200)}"` : ''}`)
        .join('\n')}`
    : '';
  const likedRows = db
    .prepare(
      `SELECT p.coach_name, p.title FROM coach_posts p
       JOIN post_reactions r ON r.post_id = p.id
       WHERE r.user_id = ? AND r.reaction = 'like' ORDER BY r.created_at DESC LIMIT 10`
    )
    .all(userId);
  const dislikedRows = db
    .prepare(
      `SELECT p.coach_name, p.title FROM coach_posts p
       JOIN post_reactions r ON r.post_id = p.id
       WHERE r.user_id = ? AND r.reaction = 'dislike' ORDER BY r.created_at DESC LIMIT 10`
    )
    .all(userId);
  const likedBlock = likedRows.length
    ? `\nCOACHING THAT CLICKS FOR HIM (he liked these posts — speak this language):\n${likedRows
        .map((r) => `- ${r.coach_name}: "${r.title}"`)
        .join('\n')}`
    : '';
  const dislikedBlock = dislikedRows.length
    ? `\nDOESN'T CLICK FOR HIM (he disliked these — don't push these ideas):\n${dislikedRows
        .map((r) => `- ${r.coach_name}: "${r.title}"`)
        .join('\n')}`
    : '';
  return snap.lines.length
    ? `HITTER DATA (newest first):\n${snap.lines.join('\n')}\nSessions logged: ${snap.total}${
        snap.avg != null ? ` · Average level: ${scoreTier(snap.avg)}` : ''
      }\n${snap.trend}${
        snap.top.length
          ? `\nDrills tied to their best days: ${snap.top.map((d) => `${d.name} (${scoreTier(d.avg)} over ${d.count} sessions)`).join(', ')}`
          : ''
      }${
        snap.bestDay
          ? `\nHIS BEST DAY — when he's struggling, take him back to exactly this (this is your #1 job):\n${snap.bestDay}`
          : ''
      }${memBlock}${learnBlock}${playersBlock}${likedBlock}${dislikedBlock}`
    : 'HITTER DATA: no check-ins logged yet — this is a brand-new hitter. Ask what they are working on.';
}

const COACH_SYSTEM = `You are Skip, the AI hitting coach inside The Daily Hitter. You are talking to BOBBY ATKINSON — your head coach, the man whose brain you coach with. He is training you right now: giving feedback on your coaching, correcting your answers, teaching you how he wants his hitters coached. Listen carefully, take every correction seriously, and confirm specifically how you will apply what he tells you going forward. Talk to him like a trusted assistant coach — direct, no fluff, no motivational-poster talk. Keep replies short (2-4 sentences) unless he asks for more. Never mention you are an AI model. You are Skip.

IMPORTANT: your coaching knowledge lives in your Brain library — discrete entries (rules, approaches, cues, miss reads, examples) Bobby manages on the Train Skip page. Conversation alone does not change how you coach his hitters. If Bobby teaches you something new here — a correction, a cue, a rule — apply it in this conversation AND confirm exactly what he should save: tell him to add it as a Brain entry (or log it with the correction form) so it sticks for every hitter.`;

async function askSkip(user, userMessage, opts = {}) {
  const coachMode = !!opts.coachMode;
  const userId = user.id;
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const err = new Error('chat_not_configured');
    err.code = 'chat_not_configured';
    throw err;
  }
  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId)
    .reverse();
  const nameLine = !coachMode && user.firstName
    ? `The hitter you're talking to is named "${user.firstName}". Call them ${user.firstName} — use their first name naturally, the way a coach would.\n\n`
    : '';
  const dataBlock = coachMode ? '' : skipDataBlock(userId);
  // Brain v2: short core prompt + only the playbook entries relevant to this message.
  const playbook = brain.libraryBlock(db, userMessage);
  const playbookBlock = playbook ? `\n\n${playbook}` : '';
  const system = coachMode ? COACH_SYSTEM + playbookBlock : `${SKIP_CORE}\n\n${nameLine}${dataBlock}${playbookBlock}`;
  // Gemini roles are "user"/"model" (our DB stores "assistant").
  const contents = [
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
      }),
    }
  );
  if (resp.status === 429) {
    const err = new Error('llm_rate_limit');
    err.code = 'llm_rate_limit';
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`llm_http_${resp.status}`);
    err.code = 'llm_error';
    throw err;
  }
  const data = await resp.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts
    .map((p) => p.text || '')
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
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user, message);
    db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'assistant', reply, new Date().toISOString());
    res.json({ reply });
  } catch (err) {
    if (err.code === 'chat_not_configured') {
      return res.status(503).json({ error: "Skip's chat isn't switched on yet — check back soon." });
    }
    if (err.code === 'llm_rate_limit') {
      return res.status(429).json({ error: "Skip's getting a lot of traffic right now — try again in a minute." });
    }
    console.error('chat error:', err.message);
    return res.status(502).json({ error: 'Skip is having trouble right now. Try again in a bit.' });
  }
});

// ---- Skip voice: speak a chat reply out loud (Gemini TTS → WAV) ----
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Fenrir';

function wavHeader(dataLen, sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

app.post('/api/speak', requireLogin, async (req, res) => {
  const apiKey = process.env.LLM_API_KEY;
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 1200) : '';
  if (!apiKey) return res.status(503).json({ error: "Voice isn't switched on yet." });
  if (!text) return res.status(400).json({ error: 'Nothing to say.' });
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Say in the tone of a direct, no-fluff baseball hitting coach talking to his hitter — firm, plain-spoken, encouraging:\n\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
          },
        }),
      }
    );
    if (!resp.ok) throw new Error('tts_http_' + resp.status);
    const data = await resp.json();
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const inline = parts.map((p) => p.inlineData).find((d) => d && d.data);
    if (!inline) throw new Error('tts_empty');
    const pcm = Buffer.from(inline.data, 'base64');
    const wav = Buffer.concat([wavHeader(pcm.length, 24000), pcm]);
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Length', String(wav.length));
    res.send(wav);
  } catch (err) {
    console.error('speak error:', err.message);
    res.status(502).json({ error: 'Voice is having trouble right now.' });
  }
});

// ---- Password reset via emailed link ----
const crypto = require('crypto');
const nodemailer = require('nodemailer');

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return { transport, from: SMTP_FROM || SMTP_USER };
}

function resetTokenHash(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

async function sendResetEmail(to, link) {
  const m = mailer();
  if (!m) {
    console.warn('PASSWORD RESET (no SMTP configured):', link);
    return false;
  }
  await m.transport.sendMail({
    from: m.from,
    to,
    subject: 'Reset your Daily Hitter password',
    text:
      `Someone requested a password reset for your Daily Hitter account.\n\n` +
      `Reset it here (expires in 1 hour):\n${link}\n\n` +
      `If that wasn't you, ignore this email.`,
    html:
      `<p>Someone requested a password reset for your Daily Hitter account.</p>` +
      `<p><a href="${link}">Reset your password</a> (expires in 1 hour).</p>` +
      `<p>If that wasn't you, ignore this email.</p>`,
  });
  return true;
}

// ---- Account approvals: Bobby reviews every signup ----

// New hitter signed up — tell Bobby so he can approve or decline them.
async function notifyCoachOfSignup(req, email, name) {
  const m = mailer();
  const coachEmail = (process.env.COACH_EMAIL || '').trim().toLowerCase();
  if (!m || !coachEmail) {
    console.warn('SIGNUP (no mail configured or no coach email):', email);
    return;
  }
  const base = publicBaseUrl(req);
  await m.transport.sendMail({
    from: m.from,
    to: coachEmail,
    subject: `New Daily Hitter signup: ${name}`,
    text:
      `${name} (${email}) just signed up for The Daily Hitter and is waiting for your approval.\n\n` +
      `Approve or decline them here:\n${base}/coach\n`,
  });
}

// Bobby approved a hitter — let them know they're in.
async function sendApprovalEmail(req, to, name) {
  const m = mailer();
  if (!m) return;
  const base = publicBaseUrl(req);
  const first = String(name || '').split(' ')[0] || 'hitter';
  await m.transport.sendMail({
    from: m.from,
    to,
    subject: "You're in — The Daily Hitter",
    text:
      `Hey ${first},\n\n` +
      `Your Daily Hitter account was approved. Log in and check in your first session:\n\n` +
      `${base}/login\n\n` +
      `— Skip`,
  });
}

function publicBaseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

app.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.forgotPasswordPage());
});

app.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  // Always respond the same way so account emails can't be enumerated.
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = resetTokenHash(token);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, hash, expires, new Date().toISOString());
    db.prepare(
      "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND token_hash != ?"
    ).run(user.id, hash);
    const link = `${publicBaseUrl(req)}/reset-password?token=${token}`;
    try {
      await sendResetEmail(user.email, link);
    } catch (err) {
      console.error('reset email failed:', err.message);
    }
  }
  res.send(
    views.forgotPasswordPage(
      'If an account uses that email, a reset link is on its way. Check your inbox (and spam).'
    )
  );
});

function validResetToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT t.*, u.email AS email FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.used_at IS NULL`
    )
    .get(resetTokenHash(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

app.get('/reset-password', (req, res) => {
  const row = validResetToken(req.query.token);
  if (!row)
    return res.send(views.resetPasswordPage(null, 'That link is invalid or expired. Request a new one.'));
  res.send(views.resetPasswordPage(req.query.token));
});

app.post('/reset-password', (req, res) => {
  const token = req.body.token;
  const row = validResetToken(token);
  if (!row)
    return res.send(views.resetPasswordPage(null, 'That link is invalid or expired. Request a new one.'));
  const pw = String(req.body.password || '');
  const pw2 = String(req.body.confirm_password || '');
  if (pw.length < 8)
    return res.send(views.resetPasswordPage(token, 'Password must be at least 8 characters.'));
  if (pw !== pw2) return res.send(views.resetPasswordPage(token, 'Passwords do not match.'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 12), row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  res.redirect('/login?reset=1');
});

// ---- Skip's journal read poller ----
// Rates unrated check-ins in the background so "Skip's reviewing your entry"
// always resolves into an actual read. Runs in-app against the local DB;
// the /api/checkins/:id/skip-rating endpoint remains for external use.
async function geminiText(systemText, userText, maxTokens) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('chat_not_configured');
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens || 300, temperature: 0.5 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`llm_http_${resp.status}`);
  const data = await resp.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  return parts
    .map((p) => p.text || '')
    .join('')
    .trim();
}

const JOURNAL_SYSTEM = `You are Skip, a direct no-fluff hitting coach. Read this hitter's journal entry and write a 2-3 sentence summary of the session, like a coach's margin note on their entry. Capture what actually happened: how they felt, what worked, what was off, and the one thing to carry forward. Judge by what the hitter WROTE first — their words, their honesty, their approach — then their numbers. Mental approach before mechanics. Be specific to what they said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

function drillNamesOf(c) {
  try {
    return JSON.parse(c.drills_done || '[]')
      .map((d) => {
        const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
        const station = d && typeof d === 'object' ? d.station : null;
        return station ? `${name} (${station})` : name;
      })
      .filter(Boolean)
      .join(', ');
  } catch (e) {
    return '';
  }
}

async function journalRead(c) {
  const entry = [
    `Environment: ${c.environment || 'n/a'}`,
    `Feel ${c.feel}/10, Confidence ${c.confidence}/10, Focus ${c.focus}/10, Difficulty ${c.difficulty != null ? c.difficulty + '/10' : 'n/a'}`,
    c.session_score != null ? `Session score: ${c.session_score} (${c.score_tier})` : null,
    drillNamesOf(c) ? `Drills: ${drillNamesOf(c)}` : null,
    c.session_notes ? `Their words: "${c.session_notes}"` : null,
    c.what_worked ? `What worked: "${c.what_worked}"` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const raw = await geminiText(JOURNAL_SYSTEM, entry, 300);
  const note = raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 500);
  if (!note) throw new Error('llm_empty');
  return { note };
}

let journalRunning = false;
async function ratePendingJournals() {
  if (journalRunning || !process.env.LLM_API_KEY) return;
  journalRunning = true;
  try {
    const pending = db
      .prepare('SELECT * FROM checkins WHERE skip_journal_note IS NULL ORDER BY created_at ASC LIMIT 8')
      .all();
    for (const c of pending) {
      try {
        const r = await journalRead(c);
        db.prepare(
          'UPDATE checkins SET skip_journal_note = ?, skip_rated_at = ? WHERE id = ? AND skip_journal_note IS NULL'
        ).run(r.note, new Date().toISOString(), c.id);
        console.log(`journal summarized checkin ${c.id}`);
      } catch (e) {
        console.error(`journal read failed for checkin ${c.id}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    journalRunning = false;
  }
}

// ---- Boot ----
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Skip listening on port ${PORT}`);
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'coach'").get().n;
  console.log(`Hitters signed up: ${n}`);
  if (!process.env.SESSION_SECRET && isProd) {
    console.warn('WARNING: SESSION_SECRET is not set.');
  }
  if (!process.env.SKIP_API_KEY) {
    console.warn('WARNING: SKIP_API_KEY is not set — the assistant API is disabled.');
  }
  // Skip's journal reads: first pass shortly after boot, then every 5 min.
  setTimeout(ratePendingJournals, 20000);
  setInterval(ratePendingJournals, 5 * 60 * 1000);
  // Coach feed auto-pull: YouTube uploads from the featured coaches, every 6h.
  setTimeout(() => pollCoachVideos(db), 60000);
  setInterval(() => pollCoachVideos(db), POLL_MS);
});

// Live voice conversations removed Sep 15 2026 — Bobby: stick with text.
// (src/live.js and public/live.js parked in repo, not wired up.)
