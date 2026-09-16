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
const webpush = require('web-push');
const bcrypt = require('bcryptjs');

const db = require('./db');
const SQLiteStore = require('./store');
const data = require('./data');
const views = require('./views');
const brain = require('./brain');
const { seedUsers, writeCredentialsFile, userCount } = require('./seed');

// Bobby's own organization — his 4 remote hitters, Talk to Skip on, free
// forever. Pinned at the top of the Organizations list; the only org whose
// players get "Edit program" links (it's the only org with programs).
const FOUNDER_ORG_NAME = 'Atkinson Hitting Remote Development';

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Video library embeds Google Drive previews in an iframe.
      'frame-src': ["'self'", 'https://drive.google.com'],
    },
  },
}));
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

// ---- Web Push (VAPID) — hitter reminders + coach alerts ----
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
let pushEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:atkinsonhitting@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  pushEnabled = true;
} else {
  console.warn('Push off: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set.');
}
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

// One-time coach creation (Sep 2026): set BOOT_CREATE_USER to
// "email|password|can_edit|first|last" to add a coach on boot, then remove the
// env var and redeploy. Used to add Cam McDonald as a view-only coach.
if (process.env.BOOT_CREATE_USER) {
  const parts = String(process.env.BOOT_CREATE_USER).split('|');
  const cuEmail = (parts[0] || '').trim().toLowerCase();
  const cuPassword = parts[1] || '';
  const cuCanEdit = parts[2] === '1' ? 1 : 0;
  const cuFirst = parts[3] || null;
  const cuLast = parts[4] || null;
  if (cuEmail && cuPassword) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cuEmail);
    if (!existing) {
      const cuNow = new Date().toISOString();
      db.prepare(
        "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit) VALUES (?, ?, 'coach', NULL, ?, ?, ?, 'approved', ?)"
      ).run(cuEmail, bcrypt.hashSync(cuPassword, 12), cuFirst, cuLast, cuNow, cuCanEdit);
      console.log(`BOOT_CREATE_USER: created coach ${cuEmail} (can_edit=${cuCanEdit})`);
    } else {
      console.log(`BOOT_CREATE_USER: ${cuEmail} already exists, skipping`);
    }
  } else {
    console.log('BOOT_CREATE_USER: missing email or password, skipping');
  }
}

// Remote org one-shot (Sep 2026): set BOOT_REMOTE_ORG=1 to create Bobby's own
// organization "Atkinson Hitting Remote Development" and place his 4 remote
// hitters in it. Idempotent: skips creation if the org exists, re-ensures the
// hitter assignments and Talk to Skip access on every run.
if (process.env.BOOT_REMOTE_ORG === '1') {
  const REMOTE_ORG_NAME = 'Atkinson Hitting Remote Development';
  const REMOTE_NAMES = ['Liam Stoffel', 'Dylan Kakuda', 'Ryan Seddon', 'Sam Chapman'];
  let org = db.prepare('SELECT id, code, skip_enabled FROM organizations WHERE name = ?').get(REMOTE_ORG_NAME);
  if (!org) {
    const code = makeOrganizationCode(REMOTE_ORG_NAME);
    const info = db
      .prepare(
        'INSERT INTO organizations (name, code, skip_enabled, created_at, deal_notes) VALUES (?, ?, 1, ?, ?)'
      )
      .run(REMOTE_ORG_NAME, code, new Date().toISOString(), 'Founder org — free forever, exempt from billing');
    org = { id: info.lastInsertRowid, code, skip_enabled: 1 };
    console.log(`BOOT_REMOTE_ORG: created org "${REMOTE_ORG_NAME}" code=${code}`);
  } else if (!org.skip_enabled) {
    db.prepare('UPDATE organizations SET skip_enabled = 1 WHERE id = ?').run(org.id);
    console.log(`BOOT_REMOTE_ORG: enabled Talk to Skip for "${REMOTE_ORG_NAME}"`);
  }
  // Assign the 4 remote hitters: prefer the remote-program link, fall back to name match.
  const lowered = REMOTE_NAMES.map((n) => n.toLowerCase());
  const ph = lowered.map(() => '?').join(',');
  const hitters = db
    .prepare(
      `SELECT u.id FROM users u
       LEFT JOIN remote_programs p ON p.id = u.remote_program_id
       WHERE u.role = 'athlete' AND (
         lower(p.athlete_name) IN (${ph})
         OR lower(u.athlete_name) IN (${ph})
         OR lower(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,''))) IN (${ph})
       )`
    )
    .all(...lowered, ...lowered, ...lowered);
  const assign = db.prepare('UPDATE users SET organization_id = ?, team_id = NULL WHERE id = ?');
  let moved = 0;
  for (const h of hitters) {
    const cur = db.prepare('SELECT organization_id FROM users WHERE id = ?').get(h.id);
    if (cur.organization_id !== org.id) {
      assign.run(org.id, h.id);
      moved++;
    }
  }
  console.log(
    `BOOT_REMOTE_ORG: org "${REMOTE_ORG_NAME}" code=${org.code}, ${hitters.length} remote hitters matched, ${moved} newly assigned`
  );
}

// ---- Auth helpers ----

function toReqUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    athleteName: row.athlete_name,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    displayName: row.first_name || row.athlete_name || 'Coach',
    status: row.status || 'approved',
    remoteProgramId: row.remote_program_id || null,
    organizationId: row.organization_id || null,
    teamId: row.team_id || null,
    dateOfBirth: row.date_of_birth || null,
    playerType: row.player_type || 'hitter',
    // View-only coaches (can_edit=0) see everything but change nothing.
    canEdit: row.can_edit == null ? true : row.can_edit !== 0,
  };
}

// ---- Organizations (Sep 2026) ----
function getOrganization(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) || null;
}
// A signup code resolves to an organization, or to a team inside one.
// Returns { organizationId, teamId } or null.
function codeLookup(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const t = db.prepare('SELECT id, organization_id FROM teams WHERE UPPER(code) = ?').get(c);
  if (t) return { organizationId: t.organization_id, teamId: t.id };
  const o = db.prepare('SELECT id FROM organizations WHERE UPPER(code) = ?').get(c);
  if (o) return { organizationId: o.id, teamId: null };
  return null;
}
function getTeam(id) {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(id)) || null;
}
// Scoping for organization coaches: null = global coach (Bobby/Cam, sees
// everything); otherwise { orgId, teamId }. Organization-level coaches
// (teamId null) see every team in their program; team coaches see one team.
// In queries: AND (? IS NULL OR organization_id = ?) AND (? IS NULL OR team_id = ?)
function orgScope(req) {
  const u = realUser(req);
  if (!u || u.role !== 'coach' || !u.organizationId) return null;
  return { orgId: u.organizationId, teamId: u.teamId || null };
}
// Params for the scope pattern above: (orgId, orgId, teamId, teamId),
// or four nulls for a global coach.
function scopeParams(scope) {
  if (!scope) return [null, null, null, null];
  return [scope.orgId, scope.orgId, scope.teamId, scope.teamId];
}
const SCOPE_CLAUSE = 'AND (? IS NULL OR organization_id = ?) AND (? IS NULL OR team_id = ?)';
// Attach organization + team names and Skip availability after toReqUser
// builds the object.
function decorateUser(u) {
  if (u && u.organizationId) {
    const c = getOrganization(u.organizationId);
    u.organizationName = c ? c.name : null;
    if (u.role === 'athlete') u.skipChatDisabled = c ? c.skip_enabled === 0 : false;
  }
  if (u && u.teamId) {
    const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(u.teamId);
    u.teamName = t ? t.name : null;
  }
  return u;
}
// Signup-code generator: NAME-XXXX with unambiguous characters.
function makeOrganizationCode(name) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TEAM';
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    let suffix = '';
    for (let j = 0; j < 4; j++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `${prefix}-${suffix}`;
    if (!db.prepare('SELECT id FROM organizations WHERE code = ?').get(code) &&
        !db.prepare('SELECT id FROM teams WHERE code = ?').get(code)) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}
// Team signup codes: same shape, unique across both tables so a code never
// resolves ambiguously.
function makeTeamCode(name) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TEAM';
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    let suffix = '';
    for (let j = 0; j < 4; j++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `${prefix}-${suffix}`;
    if (!db.prepare('SELECT id FROM organizations WHERE code = ?').get(code) &&
        !db.prepare('SELECT id FROM teams WHERE code = ?').get(code)) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}
// Birthdate validation: YYYY-MM-DD, real date, not in the future, age 8-100.
function validDob(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const d = new Date(v + 'T12:00:00');
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 8 && age <= 100;
}
function ageOn(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}
// Player roles (Sep 2026): hitter, pitcher, or two_way (both).
const PLAYER_TYPES = ['hitter', 'pitcher', 'two_way'];
function playerTypeLabel(t) {
  return t === 'pitcher' ? 'Pitcher' : t === 'two_way' ? 'Two-way' : 'Hitter';
}
function validPlayerType(t) {
  return PLAYER_TYPES.includes(t);
}
// Pitching check-in vocab (mirrors views.js).
const PITCH_SESSION_TYPES = ['bullpen', 'live', 'game', 'catch_play', 'recovery', 'no_throw'];
const THROW_INTENTS = ['light', 'medium', 'heavy'];
const PITCH_TYPES = ['4-seam FB', '2-seam FB', 'Cutter', 'Slider', 'Curveball', 'Changeup', 'Splitter', 'Sweeper'];
const round1 = (n) => Math.round(n * 10) / 10;
// Mean of the sliders present (command is absent on recovery/no-throw days).
function pitchingScoreOf(feel, focus, confidence, command) {
  const nums = [feel, focus, confidence, command].filter((n) => n !== null && n !== undefined);
  return round1(nums.reduce((a, b) => a + b, 0) / nums.length);
}
function parsePitchesThrown(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(arr.map((s) => String(s).trim()).filter((s) => PITCH_TYPES.includes(s)))];
}
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const row = db.prepare('SELECT id, email, role, athlete_name, first_name, last_name, status, remote_program_id, can_edit, organization_id, team_id, date_of_birth, player_type FROM users WHERE id = ?').get(req.session.userId);
    if (row) {
      req.user = decorateUser(toReqUser(row));
      // "View as hitter": the coach browses the app exactly as this hitter
      // sees it. req.user becomes the hitter; the real coach stays on
      // req.coachUser so coach-only routes keep working.
      if (row.role === 'coach' && req.session.viewAsUserId) {
        const t = db.prepare("SELECT id, email, role, athlete_name, first_name, last_name, status, remote_program_id, organization_id, team_id, date_of_birth, player_type FROM users WHERE id = ? AND role != 'coach'").get(req.session.viewAsUserId);
        if (t) {
          req.coachUser = req.user;
          req.user = decorateUser(toReqUser(t));
          req.user.viewAs = true;
          req.user.viewAsName = req.user.displayName;
        } else {
          delete req.session.viewAsUserId;
        }
      }
    }
  }
  next();
}
app.use(attachUser);

// The real logged-in user (the coach) even while viewing as a hitter.
function realUser(req) {
  return req.coachUser || req.user;
}
// In view-as mode the preview is read-only: no check-ins, chats, or edits
// can be submitted as the hitter by accident.
app.use((req, res, next) => {
  if (req.user && req.user.viewAs && req.method === 'POST' && req.path !== '/coach/view-as/exit') {
    return res.redirect('/');
  }
  next();
});

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  // Athletes waiting for Bobby's approval can't use the app yet.
  if (req.user.role !== 'coach' && req.user.status !== 'approved') {
    return res.redirect('/pending');
  }
  next();
}

function requireCoach(req, res, next) {
  // Full coach only: view-only coaches (can_edit=0) are blocked from every
  // mutation. Read routes use requireCoachAny below.
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach' || !u.canEdit) return res.status(403).send('Forbidden');
  next();
}

// Any coach, including view-only: dashboard, hitter views, library, Brain.
function requireCoachAny(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach') return res.status(403).send('Forbidden');
  next();
}

// Global coaches only (Bobby + Cam): organization coaches are scoped to their
// organization, so they never see remote programs, the video library, Train Skip,
// or the Organizations admin page.
function requireGlobalCoachAny(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach' || u.organizationId) return res.status(403).send('Forbidden');
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
  if (req.query.deleted) return res.send(views.loginPage(null, 'Account deleted. You\u2019re always welcome back.'));
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

// Public legal pages (linked from signup).
app.get('/terms', (req, res) => res.send(views.termsPage()));
app.get('/privacy', (req, res) => res.send(views.privacyPage()));

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
  const dob = String(req.body.date_of_birth || '').trim();
  if (!validDob(dob)) {
    return fail('Enter your date of birth.');
  }
  // User agreements (Sep 2026): everyone must accept the Terms + Privacy Policy.
  const agreed = req.body.agree_terms === '1' || req.body.agree_terms === 'on';
  if (!agreed) {
    return fail('Please agree to the Terms of Service and Privacy Policy to create an account.');
  }
  // Under 18: a parent/guardian must accept on the player's behalf.
  const age = ageOn(dob);
  const parentName = (req.body.parent_name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const parentEmail = (req.body.parent_email || '').trim().toLowerCase();
  if (age !== null && age < 18) {
    if (!parentName) {
      return fail('A parent or guardian\u2019s name is required for players under 18.');
    }
    if (!validEmail(parentEmail)) {
      return fail('A parent or guardian\u2019s valid email is required for players under 18.');
    }
  }
  const playerType = validPlayerType(req.body.player_type) ? req.body.player_type : 'hitter';
  // Organization code is optional: only players joining through an organization
  // use one. Accepts an organization code or a team code.
  const organizationCode = String(req.body.organization_code || '').trim();
  let organizationId = null;
  let teamId = null;
  if (organizationCode) {
    const found = codeLookup(organizationCode);
    if (!found) {
      return fail('That code wasn\u2019t recognized. Check it with your coach, or leave it blank.');
    }
    organizationId = found.organizationId;
    teamId = found.teamId;
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
      'INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, organization_id, team_id, date_of_birth, player_type, accepted_terms_at, terms_version, parent_name, parent_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(email, hash, 'athlete', athleteName, firstName, lastName, new Date().toISOString(), 'pending', organizationId, teamId, dob, playerType, new Date().toISOString(), '1', parentName || null, parentEmail || null);
  linkRemoteProgram(info.lastInsertRowid, athleteName);
  // Tell Bobby so he can approve (or decline) the new hitter.
  notifyCoachOfSignup(req, email, athleteName, organizationId ? getOrganization(organizationId).name : null).catch((e) =>
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

// Known-drill matching (Sep 2026): hitters sometimes summarize their work
// ("did some tee stuff, front toss") instead of naming real drills. Only
// entries that match the drill library count as drills for Skip's reads and
// drill stats — the rest are kept as the hitter's own words ("other work"),
// never presented as literal drills.
function normDrillName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
let _knownDrillNorms = null;
function knownDrillNorms() {
  if (!_knownDrillNorms) {
    try {
      _knownDrillNorms = new Set(data.drillNames().map(normDrillName).filter(Boolean));
    } catch (e) {
      _knownDrillNorms = new Set();
    }
  }
  return _knownDrillNorms;
}
function matchKnownDrill(name) {
  const n = normDrillName(name);
  if (!n) return false;
  const set = knownDrillNorms();
  if (!set.size) return true; // no library to judge against — trust the entry
  if (set.has(n)) return true;
  if (n.length >= 4) {
    for (const k of set) {
      if (k.length >= 4 && (n.startsWith(k) || k.startsWith(n))) return true;
    }
  }
  return false;
}
// Whether one stored drills_done entry counts as a real drill. Entries
// written before this flag existed are judged at read time so old summaries
// stop polluting Skip's reads too.
function drillEntryKnown(d) {
  if (d && typeof d === 'object') {
    if (d.known === false) return false;
    if (d.known === true) return true;
  }
  const name = String((d && typeof d === 'object' ? d.name : d) || '');
  return matchKnownDrill(name);
}

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
      return { name, station: canonicalStation(d.station), known: drillEntryKnown(d) };
    }
    let name = String(d || '').trim();
    if (!name) return null;
    let station = null;
    const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && m[1].trim()) {
      station = canonicalStation(m[2]);
      if (station) name = m[1].trim();
    }
    return { name, station, known: matchKnownDrill(name) };
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
      if (!drillEntryKnown(d)) continue; // summaries aren't drills — Skip shouldn't rank them
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
function thoughtGroups(athleteName) {
  const rows = db
    .prepare(
      `SELECT COALESCE(what_worked, '') || ' ' || COALESCE(felt_good, '') || ' ' || COALESCE(what_was_working, '') AS what_worked,
              session_score FROM checkins
       WHERE athlete_name = ? AND session_score IS NOT NULL
       AND TRIM(COALESCE(what_worked, '') || ' ' || COALESCE(felt_good, '') || ' ' || COALESCE(what_was_working, '')) <> ''`
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
    );
}

// Normalized drill names from a stored drills_done JSON value.
function sessionDrills(drillsDoneJson) {
  let arr = [];
  try { arr = JSON.parse(drillsDoneJson || '[]'); } catch (e) { arr = []; }
  const out = [];
  const seen = new Set();
  for (const d of arr) {
    const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, station: d && typeof d === 'object' ? d.station || null : null, known: drillEntryKnown(d) });
  }
  return out;
}

// Everything the "What works for you" section needs: good-day vs trash cues,
// whether routine days beat other days, a suggested routine when none is set,
// and drills worth adding when one is.
function whatWorksData(athleteName, userId) {
  const scored = db
    .prepare(
      'SELECT session_score, drills_done FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL'
    )
    .all(athleteName);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const round1 = (n) => Math.round(n * 10) / 10;
  const data = {
    checkinCount: scored.length,
    overallAvg: null,
    goodCues: [],
    trashCues: [],
    drills: [],
    routineVerdict: null,
    suggestedRoutine: null,
    drillSuggestions: [],
  };
  if (!scored.length) return data;
  data.overallAvg = round1(avg(scored.map((r) => r.session_score)));

  const groups = thoughtGroups(athleteName);
  data.goodCues = groups.filter((g) => g.avg >= data.overallAvg).slice(0, 4);
  data.trashCues = groups
    .filter((g) => g.avg < data.overallAvg)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3);
  // Pitchers: the cue analysis above runs on their throwing reflections (see
  // thoughtGroups). Drills and daily routines are hitting concepts — phase 1
  // keeps "What works for you" to cues only for pitcher-only athletes.
  const ptype = (db.prepare('SELECT player_type FROM users WHERE id = ?').get(userId) || {}).player_type || 'hitter';
  if (ptype === 'pitcher') return data;
  data.drills = drillStats(athleteName);

  const routine = getRoutine(userId);
  const routineNames = new Set(routine.map((r) => r.name.trim().toLowerCase()));
  const goodSessions = scored.filter((r) => r.session_score >= data.overallAvg);
  const tally = () => {
    const map = new Map();
    for (const c of goodSessions) {
      for (const d of sessionDrills(c.drills_done)) {
        if (!d.known) continue;
        const key = d.name.toLowerCase();
        const e = map.get(key) || { name: d.name, stations: {}, total: 0, count: 0 };
        if (d.station) e.stations[d.station] = (e.stations[d.station] || 0) + 1;
        e.total += c.session_score;
        e.count += 1;
        map.set(key, e);
      }
    }
    return [...map.values()].map((e) => ({
      name: e.name,
      station:
        Object.entries(e.stations).sort((a, b) => b[1] - a[1])[0] ?
        Object.entries(e.stations).sort((a, b) => b[1] - a[1])[0][0] : null,
      avg: round1(e.total / e.count),
      count: e.count,
    }));
  };

  if (routine.length) {
    // Routine days vs everything else.
    const rDays = [];
    const oDays = [];
    for (const c of scored) {
      const drills = sessionDrills(c.drills_done);
      const matched = drills.filter((d) => routineNames.has(d.name.toLowerCase())).length;
      (matched >= Math.ceil(routine.length / 2) ? rDays : oDays).push(c.session_score);
    }
    // Only call it if both kinds of days actually happen — if the hitter
    // only ever does their routine (or only ever freelances), there is no
    // comparison to make.
    const minorityShare = Math.min(rDays.length, oDays.length) / scored.length;
    if (rDays.length >= 2 && oDays.length >= 2 && minorityShare >= 0.25) {
      const rAvg = round1(avg(rDays));
      const oAvg = round1(avg(oDays));
      // Only say it when routine days are heavily better — never talk a
      // hitter out of having a routine.
      if (rAvg - oAvg >= 1.5) {
        data.routineVerdict = {
          routineAvg: rAvg,
          otherAvg: oAvg,
          routineN: rDays.length,
          otherN: oDays.length,
        };
      }
    }
    // Good-day drills that are NOT in the routine — candidates to add.
    data.drillSuggestions = tally()
      .filter((e) => !routineNames.has(e.name.toLowerCase()) && e.count >= 2)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3);
  } else {
    // No routine saved — suggest one from the drills of their best days.
    const list = tally()
      .filter((e) => e.count >= 2)
      .sort((a, b) => b.count - a.count || b.avg - a.avg)
      .slice(0, 6);
    if (list.length >= 2) data.suggestedRoutine = list;
  }
  return data;
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
    whatWorks: whatWorksData(req.user.athleteName, req.user.id),
    avgScore,
    checkinCount,
    recent,
    streak: streakData(req.user.id),
    pushOn: userPushSubscriptions(req.user.id).length > 0,
    pushEnabled,
    precheckin: todayPreCheckin(req.user.id),
  }));
});

app.get('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // The form follows the player's role: hitters get the hitting check-in,
  // pitchers get the throwing check-in, two-ways get one combined form.
  const pt = req.user.playerType || 'hitter';
  if (pt === 'pitcher') return res.send(views.pitchingCheckinForm(req.user, null, {}));
  if (pt === 'two_way') return res.send(views.combinedCheckinForm(req.user, null, {}));
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

app.post('/routine/adopt', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  let drills = [];
  try { drills = JSON.parse(req.body.drills || '[]'); } catch (e) { drills = []; }
  if (getRoutine(req.user.id).length === 0 && Array.isArray(drills) && drills.length) {
    const ins = db.prepare(
      'INSERT INTO routine_drills (user_id, name, station, position) VALUES (?, ?, ?, ?)'
    );
    let pos = 0;
    for (const d of drills.slice(0, 8)) {
      const name = String((d && d.name) || '').trim().slice(0, 80);
      if (!name) continue;
      ins.run(req.user.id, name, canonicalStation(d && d.station) || 'Tee', pos++);
    }
  }
  res.redirect('/routine');
});

app.post('/routine/remove', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM routine_drills WHERE id = ? AND user_id = ?').run(req.body.id, req.user.id);
  res.redirect('/routine');
});

// ---- Remote programs: Bobby's remote hitters get their training program
// in the app. Accounts link by name at signup (and on every boot, in db.js).
const PROGRAM_GRADES = ['Load', 'Path', 'Connection', 'Timing', 'Power Production'];
function blankProgram(name) {
  return {
    athlete: name,
    date_range: '',
    phase_emphasis: '',
    adjustment: '',
    routine: [],
    grades: {},
    strengths: [],
    cues: { movement: '', timing: '', game: '' },
    mental_framework: '',
    schedule: [],
    notes: [],
  };
}
function getProgram(id) {
  const row = db.prepare('SELECT * FROM remote_programs WHERE id = ?').get(Number(id));
  if (!row) return null;
  let prog = null;
  try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { prog = {}; }
  if (!prog || typeof prog !== 'object') prog = {};
  return { id: row.id, athlete_name: row.athlete_name, updated_at: row.updated_at, prog };
}
// Find the remote program for a hitter's name, honoring aliases
// ("Samuel Chapman" links to the "Sam Chapman" program).
function remoteProgramForName(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const rows = db.prepare('SELECT id, athlete_name, aliases FROM remote_programs').all();
  for (const r of rows) {
    const names = [r.athlete_name, ...String(r.aliases || '').split('\n')]
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);
    if (names.includes(target)) return r.id;
  }
  return null;
}
function linkRemoteProgram(userId, athleteName) {
  const id = remoteProgramForName(athleteName);
  if (id) db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?').run(id, userId);
}
function backfillRemoteLinks() {
  const users = db
    .prepare(
      `SELECT id, first_name, last_name FROM users
       WHERE remote_program_id IS NULL AND role = 'athlete'`
    )
    .all();
  const upd = db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?');
  for (const u of users) {
    const id = remoteProgramForName((u.first_name || '') + ' ' + (u.last_name || ''));
    if (id) upd.run(id, u.id);
  }
}

// Hitter's program page — remote athletes only.
app.get('/program', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  res.send(views.programPage(req.user, p));
});

// ---- Push notifications ----
function savePushSubscription(userId, sub) {
  const endpoint = String(sub.endpoint || '').slice(0, 500);
  const p256dh = String((sub.keys || {}).p256dh || '').slice(0, 200);
  const auth = String((sub.keys || {}).auth || '').slice(0, 200);
  if (!endpoint || !p256dh || !auth) return;
  db.prepare(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)'
    + ' ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth'
  ).run(userId, endpoint, p256dh, auth, new Date().toISOString());
}
function userPushSubscriptions(userId) {
  return db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
}
async function sendPush(sub, title, body, url) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body, url: url || '/' })
    );
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
    } else {
      console.warn('push send failed:', e.message);
    }
  }
}
async function pushToUser(userId, title, body, url) {
  if (!pushEnabled) return;
  for (const sub of userPushSubscriptions(userId)) await sendPush(sub, title, body, url);
}
async function pushToCoaches(title, body, url) {
  if (!pushEnabled) return;
  // Global coaches only: organization coaches are scoped to their organization and
  // don't approve signups or Brain proposals.
  const coaches = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL").all();
  for (const c of coaches) await pushToUser(c.id, title, body, url);
}
// Push to every coach except one (e.g. notify the other coach of a proposal).
async function pushToCoachesExcept(exceptId, title, body, url) {
  if (!pushEnabled) return;
  const coaches = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL AND id != ?").all(exceptId);
  for (const c of coaches) await pushToUser(c.id, title, body, url);
}
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || null }));
app.get('/api/push/status', requireLogin, (req, res) => {
  res.json({ pushEnabled, subscribed: userPushSubscriptions(req.user.id).length > 0 });
});
app.post('/api/push/subscribe', requireLogin, (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'bad subscription' });
  savePushSubscription(req.user.id, sub);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', requireLogin, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
  res.json({ ok: true });
});

// Mental Game — every hitter's baseline. Skip coaches from this.
function getMentalBaseline(userId) {
  return db.prepare('SELECT * FROM mental_baseline WHERE user_id = ?').get(userId) || null;
}
app.get('/mental-game', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const keys = db.prepare('SELECT id, content FROM mental_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.send(views.mentalGamePage(req.user, getMentalBaseline(req.user.id), req.query.saved === '1', req.query.planfailed === '1', keys));
});

app.post('/mental-game/keys/delete', requireLogin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (id) db.prepare('DELETE FROM mental_keys WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.redirect('/mental-game');
});
const MENTAL_PLAN_SYSTEM = `You are Coach Skip, a direct no-fluff hitting coach writing a hitter's personal mental-game plan. You just gauged where his head is at. Write the plan TO him ("you").

Format exactly like this — short, plain, no fluff:
READ: one honest sentence on where his mental game is at right now.
DO THIS: 2-3 concrete practices, one per line starting with "- ". Anchor each to something he already does. If he has no routine, give him one tiny starter routine. If he's usually worried, give him one present-moment reset.
WHEN YOU'RE SPED UP: one cue or breath reset for mid-game, one or two sentences.

Keep the whole thing under 160 words. Never generic — use his words back at him.`;

async function buildMentalPlan(baseline) {
  const bits = [];
  const routineWord = { yes: 'has a routine he trusts', sortof: 'sort of has a routine', no: 'has no routine' }[baseline.has_routine] || 'did not say';
  const headWord = { present: 'usually present', between: 'in between', worried: 'usually worried' }[baseline.head_state] || 'did not say';
  bits.push(`Routine: ${routineWord}. Head in games: ${headWord}.`);
  if (baseline.pregame_routine) bits.push(`Pre-game routine: "${baseline.pregame_routine}"`);
  if (baseline.morning_routine) bits.push(`Morning routine: "${baseline.morning_routine}"`);
  if (baseline.breath_work) bits.push(`Breath work: "${baseline.breath_work}"`);
  if (baseline.when_sped_up) bits.push(`What he does when sped up now: "${baseline.when_sped_up}"`);
  return geminiText(MENTAL_PLAN_SYSTEM, `This hitter's mental-game baseline:\n${bits.join('\n')}`, 400);
}

app.post('/mental-game/save', requireLogin, async (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const b = req.body || {};
  const clean = (v) => String(v || '').trim().slice(0, 600);
  const row = {
    pregame_routine: clean(b.pregame_routine),
    morning_routine: clean(b.morning_routine),
    breath_work: clean(b.breath_work),
    when_sped_up: clean(b.when_sped_up),
    has_routine: ['yes', 'sortof', 'no'].includes(b.has_routine) ? b.has_routine : '',
    head_state: ['present', 'between', 'worried'].includes(b.head_state) ? b.head_state : '',
  };
  let plan = (getMentalBaseline(req.user.id) || {}).plan || '';
  let planFailed = false;
  try {
    plan = await buildMentalPlan(row);
  } catch (e) {
    planFailed = true;
  }
  db.prepare(
    `INSERT INTO mental_baseline (user_id, pregame_routine, morning_routine, breath_work, when_sped_up, has_routine, head_state, plan, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET pregame_routine=excluded.pregame_routine, morning_routine=excluded.morning_routine,
       breath_work=excluded.breath_work, when_sped_up=excluded.when_sped_up, has_routine=excluded.has_routine,
       head_state=excluded.head_state, plan=excluded.plan, updated_at=excluded.updated_at`
  ).run(
    req.user.id, row.pregame_routine, row.morning_routine, row.breath_work, row.when_sped_up,
    row.has_routine, row.head_state, plan, new Date().toISOString()
  );
  res.redirect(planFailed ? '/mental-game?planfailed=1' : '/mental-game?saved=1');
});

// Hitter's daily routine tab — every-day blocks of their program. Remote athletes only.
app.get('/program/routine', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  res.send(views.programRoutinePage(req.user, p));
});

// Coach: edit a remote hitter's program.
app.get('/coach/program/:id/edit', requireCoach, (req, res) => {
  setApprovalCount(req);
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  res.send(views.programEditPage(realUser(req), p));
});

app.post('/coach/program/:id/save', requireCoach, (req, res) => {
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  const b = req.body;
  const prog = p.prog && p.prog.athlete ? p.prog : blankProgram(p.athlete_name);
  prog.athlete = p.athlete_name;
  prog.date_range = String(b.date_range || '').trim().slice(0, 60);
  prog.phase_emphasis = String(b.phase_emphasis || '').trim().slice(0, 120);
  prog.adjustment = String(b.adjustment || '').trim().slice(0, 500);
  prog.mental_framework = String(b.mental_framework || '').trim().slice(0, 200);
  const grades = {};
  for (const g of PROGRAM_GRADES) {
    const v = String(b['grade_' + g.replace(/ /g, '_')] || '').trim().slice(0, 4);
    if (v) grades[g] = v;
  }
  prog.grades = grades;
  prog.strengths = String(b.strengths || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
  prog.cues = {
    movement: String(b.cue_movement || '').trim().slice(0, 300),
    timing: String(b.cue_timing || '').trim().slice(0, 300),
    game: String(b.cue_game || '').trim().slice(0, 300),
  };
  const cats = [];
  for (const k of Object.keys(b)) {
    const m = k.match(/^cat_(\d+)_name$/);
    if (m) {
      const name = String(b[k] || '').trim().slice(0, 60);
      if (!name) continue;
      const items = String(b[`cat_${m[1]}_items`] || '')
        .split('\n')
        .map((line) => {
          const parts = String(line).split('|');
          const drill = (parts[0] || '').trim().slice(0, 80);
          if (!drill) return null;
          const item = { drill };
          const vol = (parts[1] || '').trim().slice(0, 60);
          if (vol) item.volume = vol;
          return item;
        })
        .filter(Boolean)
        .slice(0, 20);
      cats.push({ category: name, items, _i: Number(m[1]) });
    }
  }
  cats.sort((a, b) => a._i - b._i);
  prog.routine = cats.map(({ category, items }) => ({ category, items }));
  const schedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  prog.schedule = schedDays
    .map((day, i) => [day, String(b['sched_' + i] || '').trim().slice(0, 40)])
    .filter(([, label]) => label);
  prog.notes = String(b.notes || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!Array.isArray(prog.schedule)) prog.schedule = [];
  if (!Array.isArray(prog.notes)) prog.notes = [];
  db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(prog),
    new Date().toISOString(),
    p.id
  );
  // The Programs tab is gone — program editing now lives on the Organizations page.
  res.redirect('/coach/organizations');
});

// Coach: manage the remote roster.
app.post('/coach/remote/add', requireCoach, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name) {
    const exists = db
      .prepare('SELECT id FROM remote_programs WHERE lower(athlete_name) = lower(?)')
      .get(name);
    if (!exists) {
      const info = db
        .prepare('INSERT INTO remote_programs (athlete_name, program_json, updated_at) VALUES (?, ?, ?)')
        .run(name, JSON.stringify(blankProgram(name)), new Date().toISOString());
      backfillRemoteLinks();
    }
  }
  res.redirect('/coach/programs');
});

app.post('/coach/remote/remove', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) {
    db.prepare('UPDATE users SET remote_program_id = NULL WHERE remote_program_id = ?').run(id);
    db.prepare('DELETE FROM remote_programs WHERE id = ?').run(id);
  }
  res.redirect('/coach/programs');
});

app.post('/coach/remote/alias', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const alias = String(req.body.alias || '').trim().slice(0, 80);
  if (id && alias) {
    const row = db.prepare('SELECT aliases FROM remote_programs WHERE id = ?').get(id);
    if (row) {
      const cur = String(row.aliases || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!cur.map((x) => x.toLowerCase()).includes(alias.toLowerCase())) cur.push(alias);
      db.prepare('UPDATE remote_programs SET aliases = ? WHERE id = ?').run(cur.join('\n'), id);
      backfillRemoteLinks(); // link anyone waiting under this name right away
    }
  }
  res.redirect('/coach/programs');
});

app.post('/coach/remote/link', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = email
    ? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'athlete'").get(email)
    : null;
  if (id && u) db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?').run(id, u.id);
  res.redirect('/coach/programs');
});

app.post('/coach/remote/unlink', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) db.prepare('UPDATE users SET remote_program_id = NULL WHERE remote_program_id = ?').run(id);
  res.redirect('/coach/programs');
});

// ---- Video library: Bobby's Development System, synced from Drive by the
// VM cron. Remote hitters only.
function requireRemote(req, res, next) {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  next();
}

// Sync endpoint for the VM cron — guarded by shared secret.
app.post('/api/library/sync', (req, res) => {
  const secret = process.env.LIBRARY_SYNC_SECRET;
  if (!secret || req.body.secret !== secret) return res.status(403).json({ ok: false });
  const videos = Array.isArray(req.body.videos) ? req.body.videos : [];
  const ids = [];
  for (const v of videos) {
    const fid = String((v && v.drive_file_id) || '').trim();
    if (fid && !ids.includes(fid)) ids.push(fid);
  }
  if (!ids.length) return res.status(400).json({ ok: false, error: 'empty list — refusing to wipe' });
  const byId = {};
  for (const v of videos) byId[String(v.drive_file_id).trim()] = v;
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO video_library (drive_file_id, name, category, mime_type, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(drive_file_id) DO UPDATE SET
       name = excluded.name, category = excluded.category,
       mime_type = excluded.mime_type, updated_at = excluded.updated_at`
  );
  for (const fid of ids) {
    const v = byId[fid] || {};
    upsert.run(
      fid,
      String(v.name || 'Untitled').slice(0, 200),
      String(v.category || '').slice(0, 120),
      String(v.mime_type || '').slice(0, 80),
      now
    );
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM video_library WHERE drive_file_id NOT IN (${placeholders})`).run(...ids);
  db.prepare(
    `INSERT INTO library_sync_state (key, value) VALUES ('last_sync_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(now);
  res.json({ ok: true, count: ids.length });
});

// Brain entries endpoint for the VM agent — guarded by shared secret.
// POST { secret, entries: [{ type, title, body, tags }] } — upserts by title.
app.post('/api/library/entries', (req, res) => {
  const secret = process.env.LIBRARY_SYNC_SECRET;
  if (!secret || req.body.secret !== secret) return res.status(403).json({ ok: false });
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  if (!entries.length) return res.status(400).json({ ok: false, error: 'empty list — refusing no-op' });
  const results = [];
  for (const e of entries) {
    try {
      const title = String((e && e.title) || '').trim().slice(0, 120);
      const body = String((e && e.body) || '').trim().slice(0, 2000);
      const tags = String((e && e.tags) || '').trim().slice(0, 200);
      if (!title || !body) { results.push({ title, ok: false, error: 'missing title/body' }); continue; }
      const existing = db.prepare('SELECT id FROM skip_library WHERE title = ?').get(title);
      if (existing) {
        brain.updateEntry(db, existing.id, { title, body, tags });
        results.push({ title, ok: true, action: 'updated', id: existing.id });
      } else {
        const r = brain.addEntry(db, { type: e.type, title, body, tags });
        results.push({ title, ok: true, action: 'inserted', id: Number(r.lastInsertRowid) });
      }
    } catch (err) {
      results.push({ title: String((e && e.title) || ''), ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

app.get('/videos', requireLogin, requireRemote, (req, res) => {
  const cats = db
    .prepare(
      'SELECT category, COUNT(*) AS n FROM video_library WHERE hidden = 0 GROUP BY category ORDER BY category'
    )
    .all();
  const active = req.query.cat || (cats[0] ? cats[0].category : '');
  const videos = active
    ? db
        .prepare(
          "SELECT * FROM video_library WHERE category = ? AND hidden = 0 ORDER BY COALESCE(NULLIF(custom_name, ''), name)"
        )
        .all(active)
    : [];
  res.send(views.videosPage(req.user, cats, active, videos));
});

app.get('/videos/watch/:id', requireLogin, requireRemote, (req, res) => {
  const v = db.prepare('SELECT * FROM video_library WHERE id = ? AND hidden = 0').get(req.params.id);
  if (!v) return res.redirect('/videos');
  res.send(views.videoWatchPage(req.user, v));
});

// ---- View as hitter ----
app.post('/coach/view-as', requireCoachAny, (req, res) => {
  const id = Number(req.body.id);
  const scope = orgScope(req);
  const sp = scopeParams(scope);
  const t = id ? db.prepare(`SELECT id FROM users WHERE id = ? AND role != 'coach' ${SCOPE_CLAUSE}`).get(id, ...sp) : null;
  if (t) req.session.viewAsUserId = t.id;
  res.redirect('/');
});
app.post('/coach/view-as/exit', (req, res) => {
  const u = realUser(req);
  if (!u || u.role !== 'coach') return res.redirect('/login');
  delete req.session.viewAsUserId;
  res.redirect('/coach');
});

// ---- Coach video library manager ----
// Coach Videos tab: the video library.
app.get('/coach/videos', requireGlobalCoachAny, (req, res) => {
  const cats = db
    .prepare('SELECT category, COUNT(*) AS n FROM video_library GROUP BY category ORDER BY category')
    .all();
  const active = req.query.cat || (cats[0] ? cats[0].category : '');
  const videos = active
    ? db
        .prepare("SELECT * FROM video_library WHERE category = ? ORDER BY COALESCE(NULLIF(custom_name, ''), name)")
        .all(active)
    : [];
  const playing = req.query.play ? db.prepare('SELECT * FROM video_library WHERE id = ?').get(req.query.play) : null;
  res.send(views.coachLibraryPage(realUser(req), cats, active, videos, playing));
});

// Old library URL — everything lives on the Videos tab now.
app.get('/coach/library', requireGlobalCoachAny, (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect('/coach/videos' + q);
});

app.post('/coach/library/rename', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const name = String(req.body.custom_name || '').trim().slice(0, 200);
  if (id) db.prepare('UPDATE video_library SET custom_name = ? WHERE id = ?').run(name, id);
  res.redirect('/coach/videos?cat=' + encodeURIComponent(req.body.cat || ''));
});

app.post('/coach/library/toggle', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) db.prepare('UPDATE video_library SET hidden = 1 - hidden WHERE id = ?').run(id);
  res.redirect('/coach/videos?cat=' + encodeURIComponent(req.body.cat || ''));
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
  res.redirect('/notebook');
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
  res.redirect('/notebook');
});

app.post('/learn/note/:id/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM learning_notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/notebook');
});

app.post('/learn/player/:id/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM study_players WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/notebook');
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
  // The hitting form is for hitters; pitchers and two-ways have their own.
  if ((req.user.playerType || 'hitter') !== 'hitter') return res.redirect('/checkin');
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
    return fail('Say whether you did any drills.');
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

// ---- Optional pre-hit check-in: set the intent BEFORE the session ----
// Never required. Skip reads today's intent and connects the post-session
// check-in back to it.

// Shared validation for the throwing half of pitching + combined check-ins.
// Returns the cleaned throwing fields, or null after rendering `failView`.
function validateThrowing(b, failView) {
  const t = b.pitch_session_type;
  if (!PITCH_SESSION_TYPES.includes(t)) {
    failView('Pick what kind of throwing it was.');
    return null;
  }
  const isThrow = t === 'bullpen' || t === 'live' || t === 'game';
  const isRecovery = t === 'recovery';
  const isNoThrow = t === 'no_throw';
  let intent = '';
  if (!isRecovery && !isNoThrow) {
    if (!THROW_INTENTS.includes(b.intent)) {
      failView('Pick the intent for the day — light, medium, or heavy.');
      return null;
    }
    intent = b.intent;
  }
  let command = null;
  if (!isRecovery && !isNoThrow) {
    command = parseRating(b.command);
    if (command === null) {
      failView('Rate your command from 1 to 10.');
      return null;
    }
  }
  let pitchCount = null;
  if (isThrow) {
    // Bullpen / live / game days require a pitch count and at least one pitch.
    const n = parseInt(b.pitch_count, 10);
    if (!Number.isFinite(n) || n < 1 || n > 300) {
      failView('How many pitches did you throw?');
      return null;
    }
    pitchCount = n;
  }
  const pitchesThrown = isThrow ? parsePitchesThrown(b.pitches_thrown) : [];
  if (isThrow && !pitchesThrown.length) {
    failView('Check off at least one pitch you threw.');
    return null;
  }
  let veloMax = null;
  if (isThrow && String(b.velo_max || '').trim() !== '') {
    const n = parseFloat(b.velo_max);
    if (!Number.isFinite(n) || n < 40 || n > 110) {
      failView('Top velo should be a number between 40 and 110.');
      return null;
    }
    veloMax = Math.round(n * 10) / 10;
  }
  const catchDistance = t === 'catch_play' ? String(b.catch_distance || '').trim().slice(0, 30) : '';
  const recoveryNotes = isRecovery ? String(b.recovery_notes || '').trim().slice(0, 2000) : '';
  if (isRecovery && !recoveryNotes) {
    failView('What recovery work did you do?');
    return null;
  }
  const noThrowNote = isNoThrow ? String(b.no_throw_note || '').trim().slice(0, 2000) : '';
  if (isNoThrow && !noThrowNote) {
    failView('Say what you did to get better today.');
    return null;
  }
  return { t, intent, command, pitchCount, pitchesThrown, veloMax, catchDistance, recoveryNotes, noThrowNote };
}

const PITCHING_INSERT = `INSERT INTO checkins
  (user_id, athlete_name, created_at, environment, drills_done, feel, confidence, focus,
   difficulty, session_score, score_tier, session_notes, what_worked, whats_next,
   session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
   velo_max, catch_distance, recovery_notes, no_throw_note,
   felt_good, what_was_working, biggest_struggle, hitting_score, pitching_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Pitcher-only check-in.
app.post('/checkin/pitching', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  if ((req.user.playerType || 'hitter') !== 'pitcher') return res.redirect('/checkin');
  const b = req.body;
  const viewValues = { ...b, pitches_thrown: parsePitchesThrown(b.pitches_thrown) };
  const fail = (msg) => res.send(views.pitchingCheckinForm(req.user, msg, viewValues));
  const th = validateThrowing(b, fail);
  if (!th) return;
  const feel = parseRating(b.feel);
  const focus = parseRating(b.focus);
  const confidence = parseRating(b.confidence);
  if (feel === null || focus === null || confidence === null) {
    return fail('Rate feel, focus, and confidence from 1 to 10.');
  }
  const pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
  const tier = scoreTier(pitchingScore);
  const info = db.prepare(PITCHING_INSERT).run(
    req.user.id, req.user.athleteName, new Date().toISOString(),
    '', '[]', feel, confidence, focus,
    null, pitchingScore, tier, '', '', '',
    'pitching', th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
    th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
    (b.felt_good || '').trim().slice(0, 2000),
    (b.what_was_working || '').trim().slice(0, 2000),
    (b.biggest_struggle || '').trim().slice(0, 2000),
    null, pitchingScore
  );
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
});

// Two-way combined check-in: one row, hitting and/or throwing.
app.post('/checkin/combined', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  if ((req.user.playerType || 'hitter') !== 'two_way') return res.redirect('/checkin');
  const b = req.body;
  const didHit = b.did_hit === 'yes';
  const didThrow = b.did_throw === 'yes';
  const viewValues = { ...b, pitches_thrown: parsePitchesThrown(b.pitches_thrown) };
  const fail = (msg) => res.send(views.combinedCheckinForm(req.user, msg, viewValues));
  if (!didHit && !didThrow) {
    return fail('Say what you did today — hitting, throwing, or both.');
  }
  const feel = parseRating(b.feel);
  const focus = parseRating(b.focus);
  const confidence = parseRating(b.confidence);
  if (feel === null || focus === null || confidence === null) {
    return fail('Rate feel, focus, and confidence from 1 to 10.');
  }
  const feltGood = (b.felt_good || '').trim().slice(0, 2000);
  const whatWasWorking = (b.what_was_working || '').trim().slice(0, 2000);
  const biggestStruggle = (b.biggest_struggle || '').trim().slice(0, 2000);
  let environment = '', difficulty = null, hittingScore = null;
  if (didHit) {
    if (!ENVIRONMENTS.includes(b.environment)) return fail('Pick where you hit.');
    difficulty = parseRating(b.difficulty);
    if (difficulty === null) return fail('Rate the difficulty of the hitting from 1 to 10.');
    environment = b.environment;
    hittingScore = scoreBreakdown(feel, confidence, focus, difficulty, `${feltGood} ${whatWasWorking}`).total;
  }
  let th = { t: '', intent: '', command: null, pitchCount: null, pitchesThrown: [], veloMax: null, catchDistance: '', recoveryNotes: '', noThrowNote: '' };
  let pitchingScore = null;
  if (didThrow) {
    th = validateThrowing(b, fail);
    if (!th) return;
    pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
  }
  const subs = [hittingScore, pitchingScore].filter((s) => s !== null);
  const sessionScore = round1(subs.reduce((a, s) => a + s, 0) / subs.length);
  const tier = scoreTier(sessionScore);
  // Hitting-only days read as hitting, throwing-only as pitching.
  const sessionKind = didHit && didThrow ? 'combined' : didHit ? 'hitting' : 'pitching';
  const info = db.prepare(PITCHING_INSERT).run(
    req.user.id, req.user.athleteName, new Date().toISOString(),
    environment, '[]', feel, confidence, focus,
    difficulty, sessionScore, tier, '', '', '',
    sessionKind, th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
    th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
    feltGood, whatWasWorking, biggestStruggle,
    hittingScore, pitchingScore
  );
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
});

// ---- Optional pre-hit check-in: set the intent BEFORE the session ----
// Never required. Skip reads today's intent and connects the post-session
// check-in back to it.
function todayPreCheckin(userId) {
  const rows = db
    .prepare('SELECT * FROM pre_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
    .all(userId);
  const today = chiDay(new Date());
  return rows.find((r) => { try { return chiDay(r.created_at) === today; } catch (e) { return false; } }) || null;
}

app.get('/precheckin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // The pre-check-in follows the player's role: hitters pick cage/game,
  // pitchers set a throwing intent, two-ways get one combined form.
  const pt = req.user.playerType || 'hitter';
  if (pt === 'pitcher') return res.send(views.preCheckinPage(req.user, 'throwing', null, {}));
  if (pt === 'two_way') return res.send(views.preCheckinPage(req.user, 'both', null, {}));
  const kind = req.query.kind === 'game' ? 'game' : 'cage';
  res.send(views.preCheckinPage(req.user, kind, null, {}));
});

app.post('/precheckin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const pt = req.user.playerType || 'hitter';
  const kind = req.body.kind;
  // Pitcher pre-throw check-in: throwing intent + throwing focus.
  if (kind === 'throwing') {
    if (pt !== 'pitcher') return res.redirect('/precheckin');
    const throwIntent = THROW_INTENTS.includes(req.body.throw_intent) ? req.body.throw_intent : '';
    const throwFocus = String(req.body.throw_focus || '').trim().slice(0, 2000);
    if (!throwFocus) {
      return res.send(views.preCheckinPage(req.user, 'throwing', 'Give me one thing — what\u2019s the throwing focus?', { throw_intent: throwIntent, throw_focus: throwFocus }));
    }
    db.prepare(
      'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, throw_intent, throw_focus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, 'throwing', '', '', '', throwIntent, throwFocus, new Date().toISOString());
    return res.redirect('/');
  }
  // Two-way pre-session check-in: hitting goal/focus + throwing intent/focus.
  if (kind === 'both') {
    if (pt !== 'two_way') return res.redirect('/precheckin');
    const focus = String(req.body.focus || '').trim().slice(0, 2000);
    const plan = String(req.body.plan || '').trim().slice(0, 2000);
    const throwIntent = THROW_INTENTS.includes(req.body.throw_intent) ? req.body.throw_intent : '';
    const throwFocus = String(req.body.throw_focus || '').trim().slice(0, 2000);
    if (!focus && !throwFocus) {
      return res.send(views.preCheckinPage(req.user, 'both', 'Give me at least one thing — a hitting focus or a throwing focus.', { focus, plan, throw_intent: throwIntent, throw_focus: throwFocus }));
    }
    db.prepare(
      'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, throw_intent, throw_focus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, 'both', focus, plan, '', throwIntent, throwFocus, new Date().toISOString());
    return res.redirect('/');
  }
  const k = kind === 'game' ? 'game' : 'cage';
  if (pt !== 'hitter') return res.redirect('/precheckin');
  const focus = String(req.body.focus || '').trim().slice(0, 2000);
  const plan = String(req.body.plan || '').trim().slice(0, 2000);
  const flush = String(req.body.flush || '').trim().slice(0, 2000);
  if (!focus) {
    return res.send(views.preCheckinPage(req.user, k, 'Give me at least one thing — what\u2019s the focus?', { focus, plan, flush }));
  }
  db.prepare(
    'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, k, focus, plan, flush, new Date().toISOString());
  res.redirect('/');
});

// ---- Notebook: check-ins + hitting notes in one place ----

// ---------- Settings ----------
function getSubscription(userId) {
  try {
    return db.prepare('SELECT status, plan, current_period_end FROM user_subscriptions WHERE user_id = ?').get(userId) || null;
  } catch (e) { return null; }
}

// Coaches admin (full-access coaches only) lives on Settings now.
function coachAdminOpts(req) {
  const me = realUser(req);
  if (req.user.role === 'coach' && me.canEdit) {
    return {
      coaches: db.prepare("SELECT id, email, first_name, last_name, can_edit, created_at FROM users WHERE role = 'coach' AND organization_id IS NULL ORDER BY created_at ASC").all(),
      selfId: me.id,
    };
  }
  return {};
}

app.get('/settings', requireLogin, (req, res) => {
  if (req.user.viewAs) return res.redirect('/coach');
  res.send(views.settingsPage(req.user, {
    subscription: getSubscription(req.user.id),
    notice: req.query.saved ? 'Account updated.' : (req.query.pw ? 'Password changed.' : (req.query.organization ? 'Organization updated.' : null)),
    ...coachAdminOpts(req),
  }));
});

app.post('/settings/profile', requireLogin, (req, res) => {
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), error: msg, ...coachAdminOpts(req) }));
  if (!firstName || !lastName) return fail('First and last name are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (taken) return fail('That email is already on another account.');
  const athleteName = req.user.role === 'coach' ? req.user.athleteName : `${firstName} ${lastName}`;
  const dob = String(req.body.date_of_birth || '').trim();
  if (req.user.role !== 'coach' && dob && !validDob(dob)) return fail('Enter a valid date of birth.');
  db.prepare('UPDATE users SET first_name = ?, last_name = ?, email = ?, athlete_name = ? WHERE id = ?')
    .run(firstName, lastName, email, athleteName, req.user.id);
  if (req.user.role !== 'coach' && dob) {
    db.prepare('UPDATE users SET date_of_birth = ? WHERE id = ?').run(dob, req.user.id);
  }
  res.redirect('/settings?saved=1');
});

// Athletes can switch their role later (hitter / pitcher / two-way). This
// changes which check-in form they get from then on; past check-ins keep
// their original kind.
app.post('/settings/role', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), error: msg, ...coachAdminOpts(req) }));
  const playerType = req.body.player_type;
  if (!validPlayerType(playerType)) return fail('Pick hitter, pitcher, or two-way.');
  db.prepare('UPDATE users SET player_type = ? WHERE id = ?').run(playerType, req.user.id);
  res.redirect('/settings?saved=1');
});

// Hitters can join (or leave) an organization later from Settings. Blank
// code = leave the organization; a valid organization or team code joins it.
// Coaches can't use this.
app.post('/settings/organization', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), error: msg, ...coachAdminOpts(req) }));
  const code = String(req.body.organization_code || '').trim();
  if (!code) {
    db.prepare('UPDATE users SET organization_id = NULL, team_id = NULL WHERE id = ?').run(req.user.id);
    return res.redirect('/settings?organization=1');
  }
  const found = codeLookup(code);
  if (!found) return fail('That code didn\u2019t match an organization. Check it with your coach and try again.');
  db.prepare('UPDATE users SET organization_id = ?, team_id = ? WHERE id = ?').run(found.organizationId, found.teamId, req.user.id);
  res.redirect('/settings?organization=1');
});

app.post('/settings/password', requireLogin, (req, res) => {
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), error: msg, ...coachAdminOpts(req) }));
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(String(req.body.current_password || ''), row.password_hash)) {
    return fail('Current password didn\u2019t match.');
  }
  const next = String(req.body.new_password || '');
  if (next.length < 8) return fail('New password needs at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), req.user.id);
  res.redirect('/settings?pw=1');
});

app.post('/settings/subscription/cancel', requireLogin, (req, res) => {
  const sub = getSubscription(req.user.id);
  if (!sub || sub.status !== 'active') {
    return res.send(views.settingsPage(req.user, { subscription: sub, notice: 'No active subscription \u2014 nothing to cancel.', ...coachAdminOpts(req) }));
  }
  db.prepare("UPDATE user_subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE user_id = ?").run(req.user.id);
  res.send(views.settingsPage(req.user, {
    subscription: getSubscription(req.user.id),
    notice: 'Subscription ended. You keep full access until the end of the billing period.',
    ...coachAdminOpts(req),
  }));
});

app.post('/settings/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), error: msg, ...coachAdminOpts(req) }));
  if (String(req.body.confirm || '').trim() !== 'DELETE') return fail('Type DELETE exactly to confirm.');
  const id = req.user.id;
  const del = db.transaction(() => {
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'learning_notes', 'study_players', 'push_subscriptions', 'mental_baseline', 'hitter_memory', 'user_subscriptions']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  del();
  req.session.destroy(() => res.redirect('/login?deleted=1'));
});

app.get('/notebook', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const all = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  // Session-kind filter (only shown when the athlete has more than one kind).
  const kinds = [...new Set(all.map((c) => c.session_kind || 'hitting'))];
  const kind = ['hitting', 'pitching', 'combined'].includes(req.query.kind) ? req.query.kind : 'all';
  const checkins = kind === 'all' ? all : all.filter((c) => (c.session_kind || 'hitting') === kind);
  const notes = db
    .prepare('SELECT * FROM learning_notes WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const players = db
    .prepare('SELECT * FROM study_players WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.send(views.notebookPage(req.user, checkins, notes, players, req.query.saved === '1', { kinds, kind }));
});

// Old routes fold into the notebook.
app.get('/history', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.redirect('/notebook');
});
app.get('/learn', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.redirect('/notebook');
});

// ---- Coach routes ----

// Hitters waiting for Bobby's approval, oldest first.
function pendingList(scope) {
  const sp = scopeParams(scope);
  return db
    .prepare(
      `SELECT u.id, u.email, u.athlete_name, u.first_name, u.last_name, u.created_at, u.player_type,
              c.name AS organization_name, t.name AS team_name
       FROM users u LEFT JOIN organizations c ON c.id = u.organization_id
                    LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.role = 'athlete' AND u.status = 'pending'
         AND (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY u.created_at ASC`
    )
    .all(...sp)
    .map((u) => ({
      ...u,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email,
    }));
}

// Number on the Approvals tab badge.
function setApprovalCount(req) {
  try {
    const sp = scopeParams(orgScope(req));
    req.user.approvalCount = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'athlete' AND status = 'pending' ${SCOPE_CLAUSE}`)
      .get(...sp).n;
  } catch {
    req.user.approvalCount = 0;
  }
}

// Per-hitter check-in stats for the coach views: total + last check-in.
// Organization coaches only ever see their own program's players; team
// coaches only their team.
function coachUserStats(scope) {
  const sp = scopeParams(scope);
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.athlete_name, u.first_name, u.last_name, u.created_at, u.date_of_birth, u.player_type,
              t.name AS team_name
       FROM users u LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.role != 'coach' AND u.status = 'approved'
         AND (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY u.created_at ASC`
    )
    .all(...sp);
  return users.map((u) => {
    const row = db
      .prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM checkins WHERE user_id = ?')
      .get(u.id);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email;
    return { id: u.id, email: u.email, name, total: row.total, last: row.last, age: ageOn(u.date_of_birth), team: u.team_name || null, playerType: u.player_type || 'hitter' };
  });
}

// Analytics strip for the top of the Coach Dashboard: players in scope,
// check-ins today, check-ins + avg score over the last 7 Chicago days vs the
// prior 7 (trends), plus business stats for global coaches: organization
// count, revenue collected, and a per-organization player breakdown.
// Scope-aware: global coaches see everyone, org coaches their program,
// team coaches their team.
function coachAnalytics(scope, stats) {
  const sp = scopeParams(scope);
  const today = chiDay(new Date());
  const todayUTC = ymdToUTC(today);
  const weekStartUTC = ymdToUTC(chiDay(new Date(Date.now() - 6 * 864e5)));
  const prevStartUTC = ymdToUTC(chiDay(new Date(Date.now() - 13 * 864e5)));
  const since = new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const rows = db
    .prepare(
      `SELECT c.session_score, c.created_at FROM checkins c JOIN users u ON u.id = c.user_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
         AND c.created_at >= ?`
    )
    .all(...sp, since);
  let todayN = 0;
  let weekN = 0, prevN = 0;
  let scoreSum = 0, scoreN = 0, prevScoreSum = 0, prevScoreN = 0;
  for (const r of rows) {
    let day;
    try {
      day = ymdToUTC(chiDay(r.created_at));
    } catch {
      continue;
    }
    if (day === todayUTC) todayN++;
    if (day >= weekStartUTC) {
      weekN++;
      if (r.session_score != null) { scoreSum += r.session_score; scoreN++; }
    } else if (day >= prevStartUTC) {
      prevN++;
      if (r.session_score != null) { prevScoreSum += r.session_score; prevScoreN++; }
    }
  }
  const out = {
    players: stats.length,
    checkedInToday: todayN,
    checkinsWeek: weekN,
    checkinsPrevWeek: prevN,
    avgScore: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
    avgScorePrev: prevScoreN ? Math.round((prevScoreSum / prevScoreN) * 10) / 10 : null,
    orgs: null,
    orgCount: 0,
    revenueCents: 0,
  };
  if (!scope) {
    // Global coaches get the business view: every organization with its
    // player count, this week's check-ins, and deal/paid status, plus a
    // standalone row for players outside any organization.
    const orgRows = db.prepare('SELECT id, name, deal_cents, paid_cents FROM organizations ORDER BY name ASC').all();
    const breakdown = orgRows.map((o) => ({
      id: o.id,
      name: o.name,
      dealCents: o.deal_cents || 0,
      paidCents: o.paid_cents || 0,
      players: db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(o.id).n,
      weekCheckins: db
        .prepare(
          `SELECT COUNT(*) AS n FROM checkins c JOIN users u ON u.id = c.user_id
           WHERE u.organization_id = ? AND c.created_at >= ?`
        )
        .get(o.id, new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 19).replace('T', ' ')).n,
    }));
    const standalonePlayers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id IS NULL AND role = 'athlete' AND status = 'approved'").get().n;
    if (standalonePlayers) {
      breakdown.push({
        id: null, name: 'Standalone (no organization)', dealCents: 0, paidCents: 0,
        players: standalonePlayers,
        weekCheckins: db.prepare(
          `SELECT COUNT(*) AS n FROM checkins c JOIN users u ON u.id = c.user_id
           WHERE u.organization_id IS NULL AND c.created_at >= ?`
        ).get(new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 19).replace('T', ' ')).n,
      });
    }
    out.orgs = breakdown;
    out.orgCount = orgRows.length;
    out.revenueCents = orgRows.reduce((sum, o) => sum + (o.paid_cents || 0), 0);
  }
  return out;
}

// Set an organization's deal price and collected revenue (Bobby only).
// (Deal terms live on the full-terms route below, under Finances.)

// Finances page (Sep 16 2026): Bobby-only (global coach with edit rights).
// Everything worth knowing about money: collected, outstanding, pipeline,
// renewals, per-org deals, payment history, individual subscriptions.
function coachFinances() {
  const orgs = db.prepare(`SELECT o.*, COUNT(u.id) AS players
    FROM organizations o LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'athlete' AND u.status = 'approved'
    GROUP BY o.id ORDER BY o.name`).all();
  const collected = orgs.reduce((s, o) => s + (o.paid_cents || 0), 0);
  const outstanding = orgs.reduce((s, o) => s + Math.max((o.deal_cents || 0) - (o.paid_cents || 0), 0), 0);
  const pipeline = orgs.filter((o) => o.deal_status === 'prospect').reduce((s, o) => s + (o.deal_cents || 0), 0);
  const activeDeals = orgs.filter((o) => (o.deal_status === 'pilot' || o.deal_status === 'active') && o.deal_cents > 0).length;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const soonStr = soon.toISOString().slice(0, 10);
  const renewalsDue = orgs.filter((o) => o.deal_renewal && o.deal_renewal >= today && o.deal_renewal <= soonStr
    && (o.deal_status === 'pilot' || o.deal_status === 'active'));
  const payments = db.prepare(`SELECT p.*, o.name AS org_name FROM org_payments p
    JOIN organizations o ON o.id = p.organization_id
    ORDER BY p.paid_at DESC, p.id DESC LIMIT 100`).all();
  // Monthly collection trend: last 6 calendar months from the payment ledger.
  const monthly = [];
  const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = m.toISOString().slice(0, 7);
    const label = m.toLocaleString('en-US', { month: 'short' });
    const sum = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM org_payments WHERE substr(paid_at,1,7) = ?`).get(key).s;
    monthly.push({ key, label, cents: sum });
  }
  // Individual subscriptions (ready for when billing launches).
  const subs = db.prepare(`SELECT s.*, u.athlete_name, u.email FROM user_subscriptions s
    JOIN users u ON u.id = s.user_id WHERE s.status = 'active'`).all();
  const planMrr = { monthly: 1999, annual: Math.round(14999 / 12), founding: Math.round(4900 / 12) };
  const mrr = subs.reduce((sum, s) => sum + (planMrr[s.plan] || 0), 0);
  return { orgs, collected, outstanding, pipeline, activeDeals, renewalsDue, payments, monthly, subs, mrr };
}

function requireFinances(req, res, next) {
  const u = req.user;
  if (!u || u.role !== 'coach') return res.redirect('/login');
  if (u.canEdit && !u.organizationId) return next();
  return res.status(403).send('Forbidden');
}

app.get('/coach/finances', requireCoach, requireFinances, (req, res) => {
  res.send(views.coachFinancesPage(req.user, coachFinances()));
});

// Full deal terms per organization (Bobby-only). Paid/collected stays editable
// here too; recording a payment bumps paid_cents automatically.
app.post('/coach/organizations/:id/deal', requireCoach, requireFinances, (req, res) => {
  const c = db.prepare('SELECT id FROM organizations WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.redirect('/coach/finances');
  const dollars = (v) => {
    const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '';
  const status = ['prospect', 'pilot', 'active', 'past'].includes(req.body.status) ? req.body.status : '';
  // The Organizations page posts only deal/paid; the Finances page posts the
  // full terms. Only touch the pipeline fields when they're actually sent.
  const sets = ['deal_cents = ?', 'paid_cents = ?'];
  const vals = [dollars(req.body.deal), dollars(req.body.paid)];
  if ('status' in req.body) { sets.push('deal_status = ?'); vals.push(status); }
  if ('start' in req.body) { sets.push('deal_start = ?'); vals.push(date(req.body.start)); }
  if ('renewal' in req.body) { sets.push('deal_renewal = ?'); vals.push(date(req.body.renewal)); }
  if ('notes' in req.body) { sets.push('deal_notes = ?'); vals.push(String(req.body.notes || '').slice(0, 500)); }
  vals.push(c.id);
  db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.redirect('status' in req.body ? '/coach/finances' : '/coach/organizations');
});

// Record a payment: dated ledger row + bumps the org's collected total.
app.post('/coach/organizations/:id/payment', requireCoach, requireFinances, (req, res) => {
  const c = db.prepare('SELECT id FROM organizations WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.redirect('/coach/finances');
  const n = Math.round(Number(String(req.body.amount).replace(/[^0-9.]/g, '')) * 100);
  if (!Number.isFinite(n) || n <= 0) return res.redirect('/coach/finances');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.paid_at || '').trim())
    ? String(req.body.paid_at).trim() : new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO org_payments (organization_id, amount_cents, paid_at, method, note, created_at)
    VALUES (?,?,?,?,?,datetime('now'))`)
    .run(c.id, n, date, String(req.body.method || '').slice(0, 40), String(req.body.note || '').slice(0, 200));
  db.prepare('UPDATE organizations SET paid_cents = paid_cents + ? WHERE id = ?').run(n, c.id);
  res.redirect('/coach/finances');
});

// Hitters gone quiet: at least one check-in, but none in 3+ Chicago days.
function coachQuietHitters(stats) {
  const today = chiDay(new Date());
  return stats
    .filter((s) => {
      if (!s.last) return false;
      try {
        const daysAgo = Math.round((ymdToUTC(today) - ymdToUTC(chiDay(s.last))) / 864e5);
        return daysAgo >= 3;
      } catch {
        return false;
      }
    })
    .map((s) => ({ ...s, daysAgo: Math.round((ymdToUTC(today) - ymdToUTC(chiDay(s.last))) / 864e5) }))
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

// Remote program list for the Programs tab.
function remoteProgramList() {
  return db
    .prepare(
      `SELECT p.id, p.athlete_name, p.aliases, p.updated_at,
              (SELECT email FROM users WHERE remote_program_id = p.id LIMIT 1) AS user_email
       FROM remote_programs p ORDER BY p.athlete_name`
    )
    .all();
}

// Coach Home: needs-your-attention — approvals, gone-quiet hitters, latest feed.
app.get('/coach', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const scope = orgScope(req);
  const sp = scopeParams(scope);
  const stats = coachUserStats(scope);
  const quiet = coachQuietHitters(stats);
  const latest = db
    .prepare(
      `SELECT c.* FROM checkins c JOIN users u ON u.id = c.user_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY c.created_at DESC LIMIT 8`
    )
    .all(...sp);
  const pending = pendingList(scope);
  const me = realUser(req);
  const analytics = coachAnalytics(scope, stats);
  res.send(
    views.coachHomePage(me, quiet, latest, pending, userPushSubscriptions(req.user.id).length > 0, analytics)
  );
});

// Coach Hitters tab: search + athlete cards.
app.get('/coach/hitters', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  res.send(views.coachHittersPage(realUser(req), coachUserStats(orgScope(req))));
});

// Coach Programs tab: remote programs.
app.get('/coach/programs', requireGlobalCoachAny, (req, res) => {
  setApprovalCount(req);
  res.send(views.coachProgramsPage(realUser(req), remoteProgramList()));
});

// Flip a coach between full access and view-only. Full coaches only, never
// yourself, and never the last full-access coach.
app.post('/coach/coaches/toggle', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const me = realUser(req);
  const target = db.prepare("SELECT id, can_edit FROM users WHERE id = ? AND role = 'coach' AND organization_id IS NULL").get(id);
  if (!target || target.id === me.id) return res.redirect('/settings');
  if (target.can_edit !== 0) {
    const fullCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'coach' AND organization_id IS NULL AND can_edit != 0").get().n;
    if (fullCount <= 1) return res.redirect('/settings');
  }
  db.prepare('UPDATE users SET can_edit = ? WHERE id = ?').run(target.can_edit !== 0 ? 0 : 1, target.id);
  res.redirect('/settings');
});

// Approvals tab: approve or decline waiting hitters right here.
app.get('/coach/approvals', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  res.send(views.coachApprovalsPage(realUser(req), pendingList(orgScope(req))));
});

// Manage an organization's teams and coaches: Bobby (full global coach), or
// the program's own organization-level coaches (team_id NULL) — the program
// is the master account. Team coaches and Cam (view-only) are blocked.
function requireOrgManager(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach') return res.status(403).send('Forbidden');
  const orgId = Number(req.params.id);
  if (u.canEdit && !u.organizationId) return next();
  if (u.organizationId === orgId && !u.teamId) return next();
  return res.status(403).send('Forbidden');
}

function organizationTeams(orgId) {
  return db.prepare('SELECT * FROM teams WHERE organization_id = ? ORDER BY name ASC').all(orgId).map((t) => ({
    ...t,
    playerCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'athlete'").get(t.id).n,
    coaches: db.prepare("SELECT id, email, first_name, last_name FROM users WHERE team_id = ? AND role = 'coach' ORDER BY created_at ASC").all(t.id),
  }));
}

// ---- Organizations (Sep 2026): Bobby's B2B surface ----
// Add a organization, hand its signup code to the program's coaches, flip Talk to
// Skip per organization, and create view-only coach accounts scoped to that organization.
// Organization-level coaches see only their own program here so they can run
// their teams themselves.
app.get('/coach/organizations', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const me = realUser(req);
  const onlyOrgId = me.organizationId || null;
  const rows = onlyOrgId
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').all(onlyOrgId)
    : db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();
  const organizations = rows
    .map((c) => {
      const isFounder = c.name === FOUNDER_ORG_NAME;
      const org = {
        ...c,
        isFounder,
        playerCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(c.id).n,
        coaches: db.prepare("SELECT id, email, first_name, last_name FROM users WHERE organization_id = ? AND team_id IS NULL AND role = 'coach' ORDER BY created_at ASC").all(c.id),
        teams: organizationTeams(c.id),
      };
      // Founder org only: its players, so Bobby can jump straight to each
      // player's remote program editor from the org card.
      if (isFounder) {
        org.players = db
          .prepare(
            `SELECT id, first_name, last_name, athlete_name, email, remote_program_id FROM users
             WHERE organization_id = ? AND role = 'athlete'
             ORDER BY first_name ASC, last_name ASC`
          )
          .all(c.id);
      }
      return org;
    })
    // Bobby's org pinned at the top, above every other org.
    .sort((a, b) => Number(b.isFounder) - Number(a.isFounder) || a.name.localeCompare(b.name));
  res.send(views.coachOrganizationsPage(me, organizations, req.query.error || null, req.query.added || null));
});

app.post('/coach/organizations/add', requireCoach, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return res.redirect('/coach/organizations?error=' + encodeURIComponent('Give the organization a name.'));
  const code = makeOrganizationCode(name);
  const info = db.prepare('INSERT INTO organizations (name, code, skip_enabled, created_at) VALUES (?, ?, 0, ?)').run(name, code, new Date().toISOString());
  res.redirect('/coach/organizations?added=' + info.lastInsertRowid);
});

app.post('/coach/organizations/:id/skip', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  db.prepare('UPDATE organizations SET skip_enabled = ? WHERE id = ?').run(c.skip_enabled ? 0 : 1, c.id);
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/coaches/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!firstName || !lastName) return fail('Coach needs a first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail('An account with that email already exists.');
  db.prepare(
    "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit, organization_id, team_id) VALUES (?, ?, 'coach', ?, ?, ?, ?, 'approved', 0, ?, NULL)"
  ).run(email, bcrypt.hashSync(password, 12), `${firstName} ${lastName}`, firstName, lastName, new Date().toISOString(), c.id);
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/coaches/remove', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const coachId = Number(req.body.coach_id);
  if (c && coachId) {
    const del = db.transaction(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(coachId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(coachId);
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'coach' AND organization_id = ? AND team_id IS NULL").run(coachId, c.id);
    });
    del();
  }
  res.redirect('/coach/organizations');
});

// ---- Teams inside an organization (Sep 2026) ----
// The program is the master account; each team gets its own signup code and
// its own coaches, who see only their team's players. Organization-level
// coaches (or Bobby) manage teams here.
app.post('/coach/organizations/:id/teams/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return fail('Give the team a name.');
  const code = makeTeamCode(name);
  db.prepare('INSERT INTO teams (organization_id, name, code, created_at) VALUES (?, ?, ?, ?)').run(c.id, name, code, new Date().toISOString());
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/teams/:teamId/coaches/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!firstName || !lastName) return fail('Coach needs a first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail('An account with that email already exists.');
  db.prepare(
    "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit, organization_id, team_id) VALUES (?, ?, 'coach', ?, ?, ?, ?, 'approved', 0, ?, ?)"
  ).run(email, bcrypt.hashSync(password, 12), `${firstName} ${lastName}`, firstName, lastName, new Date().toISOString(), c.id, t.id);
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/teams/:teamId/coaches/remove', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  const coachId = Number(req.body.coach_id);
  if (c && t && t.organization_id === c.id && coachId) {
    const del = db.transaction(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(coachId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(coachId);
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'coach' AND team_id = ?").run(coachId, t.id);
    });
    del();
  }
  res.redirect('/coach/organizations');
});

// Confirm page before deleting a team: its players stay in the program
// (unassigned to any team), the team's coach accounts are removed.
app.get('/coach/organizations/:id/teams/:teamId/delete', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  setApprovalCount(req);
  const playerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'athlete'").get(t.id).n;
  const coachCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'coach'").get(t.id).n;
  res.send(views.coachTeamDeletePage(realUser(req), c, t, playerCount, coachCount));
});

app.post('/coach/organizations/:id/teams/:teamId/delete', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  const del = db.transaction(() => {
    const coachIds = db.prepare("SELECT id FROM users WHERE team_id = ? AND role = 'coach'").all(t.id).map((r) => r.id);
    for (const id of coachIds) {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
    }
    db.prepare("DELETE FROM users WHERE team_id = ? AND role = 'coach'").run(t.id);
    // Players keep their accounts and their place in the program — they just
    // aren't on this team anymore.
    db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(t.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
  });
  del();
  res.redirect('/coach/organizations');
});

// Confirm page before deleting a organization: players go standalone, the
// organization's coach accounts are removed (with their push subscriptions).
app.get('/coach/organizations/:id/delete', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  setApprovalCount(req);
  const playerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(c.id).n;
  const coachCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'coach'").get(c.id).n;
  const teamCount = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE organization_id = ?').get(c.id).n;
  res.send(views.coachOrganizationDeletePage(realUser(req), c, playerCount, coachCount, teamCount));
});

app.post('/coach/organizations/:id/delete', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const del = db.transaction(() => {
    const coachIds = db.prepare("SELECT id FROM users WHERE organization_id = ? AND role = 'coach'").all(c.id).map((r) => r.id);
    for (const id of coachIds) {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
    }
    db.prepare("DELETE FROM users WHERE organization_id = ? AND role = 'coach'").run(c.id);
    db.prepare('UPDATE users SET organization_id = NULL, team_id = NULL WHERE organization_id = ?').run(c.id);
    db.prepare('DELETE FROM teams WHERE organization_id = ?').run(c.id);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(c.id);
  });
  del();
  res.redirect('/coach/organizations');
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

app.get('/coach/user/:email', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const em = (req.params.email || '').toLowerCase();
  const sp = scopeParams(orgScope(req));
  const user = db
    .prepare(`SELECT id, email, athlete_name, first_name, last_name, player_type FROM users WHERE email = ? AND role != 'coach' ${SCOPE_CLAUSE}`)
    .get(em, ...sp);
  if (!user) return res.status(404).send('Unknown user.');
  const rows = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  const name = user.athlete_name || user.email;
  const thread = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .all(user.id)
    .reverse();
  const pt = user.player_type || 'hitter';
  res.send(views.coachUser(realUser(req), name, rows, whatWorksData(name, user.id), thread, user.email, brain.listMemory(db, user.id), getRoutine(user.id), pt, pt === 'hitter' ? null : throwingSummary(user.id)));
});

// Throwing summary for a pitcher's or two-way player's coach view: session
// mix, average command, workload, and velo over the last 30 throwing sessions.
function throwingSummary(userId) {
  const rows = db
    .prepare(
      `SELECT pitch_session_type, command, pitch_count, velo_max
       FROM checkins
       WHERE user_id = ? AND session_kind IN ('pitching', 'combined')
         AND pitch_session_type IS NOT NULL AND pitch_session_type <> ''
       ORDER BY created_at DESC LIMIT 30`
    )
    .all(userId);
  if (!rows.length) return null;
  const byType = {};
  let cmdSum = 0, cmdN = 0, pitchSum = 0, veloSum = 0, veloN = 0;
  for (const r of rows) {
    byType[r.pitch_session_type] = (byType[r.pitch_session_type] || 0) + 1;
    if (r.command != null) { cmdSum += r.command; cmdN++; }
    if (r.pitch_count != null) pitchSum += r.pitch_count;
    if (r.velo_max != null) { veloSum += r.velo_max; veloN++; }
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    sessions: rows.length,
    byType,
    avgCommand: cmdN ? r1(cmdSum / cmdN) : null,
    totalPitches: pitchSum,
    avgVelo: veloN ? r1(veloSum / veloN) : null,
  };
}

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
  res.send(views.coachDeleteHitterPage(realUser(req), user, name, n));
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
  // Every user-scoped table must go — including pre_checkins (Bobby's rule:
  // a deleted hitter leaves nothing behind).
  for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'hitter_memory', 'learning_notes', 'study_players', 'pre_checkins', 'push_subscriptions', 'mental_keys', 'mental_baseline', 'user_subscriptions']) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// Coach-only backup: download every check-in as JSON.
app.get('/coach/export', requireCoachAny, (req, res) => {  const sp = scopeParams(orgScope(req));
  const rows = db
    .prepare(
      `SELECT c.id, c.athlete_name, u.email, c.created_at, c.environment, c.drills_done,
              c.feel, c.confidence, c.focus, c.session_score, c.score_tier,
              c.session_notes, c.what_worked, c.whats_next,
              c.skip_journal_score, c.skip_journal_note, c.skip_rated_at
       FROM checkins c JOIN users u ON u.id = c.user_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY c.created_at ASC`
    )
    .all(...sp)
    .map((r) => ({ ...r, drills_done: safeParseDrills(r.drills_done) }));
  res.setHeader('Content-Disposition', 'attachment; filename="skip-checkins-export.json"');
  res.json({ exported_at: new Date().toISOString(), checkins: rows });
});

// ---- Train Skip (coach HQ) ----
// Bobby talks to Skip directly to train him, keeps coaching notes that get
// injected into every hitter's Skip prompt, and reviews Skip's conversations
// with each hitter.

app.get('/coach/skip', requireGlobalCoachAny, (req, res) => {
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
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .all(req.user.id)
    .reverse();
  res.send(views.coachSkipPage(realUser(req), entries, hitters, thread, !!process.env.LLM_API_KEY, req.query.saved === '1', brain.listProposals(db)));
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

// Propose a Brain entry. Any coach (including view-only) can propose; the
// entry goes live only after EVERY coach has approved it. The proposer
// auto-approves on submit. The other coach gets a push so nothing stalls.
app.post('/coach/skip/propose', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  try {
    const id = brain.createProposal(db, {
      type: req.body.type,
      title: req.body.title,
      body: req.body.body,
      tags: req.body.tags,
      proposedBy: me.id,
    });
    pushToCoachesExcept(me.id, 'New Skip Brain proposal', `${me.displayName} proposed "${String(req.body.title || '').slice(0, 60)}" — tap to review.`, '/coach/skip');
    console.log(`brain proposal ${id} by ${me.email}`);
  } catch (e) { /* bad type — ignore, stay on the page */ }
  res.redirect('/coach/skip?saved=1');
});

// Propose a correction as a Brain example (view-only coaches use this;
// full coaches keep the direct correction form above).
app.post('/coach/skip/propose-correction', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  const hitter = (req.body.hitter_said || '').trim().slice(0, 500);
  const wrong = (req.body.skip_said || '').trim().slice(0, 500);
  const right = (req.body.should_say || '').trim().slice(0, 1000);
  if (right) {
    const title = (hitter || 'Correction').slice(0, 80);
    const body = `Hitter: "${hitter || '(not specified)'}"\nWrong: "${wrong || '(not specified)'}"\nRight: "${right}"`;
    brain.createProposal(db, { type: 'example', title, body, tags: 'correction', proposedBy: me.id });
    pushToCoachesExcept(me.id, 'New Skip correction proposal', `${me.displayName} proposed a correction — tap to review.`, '/coach/skip');
  }
  res.redirect('/coach/skip?saved=1');
});

// Approve a proposal. When every coach has approved, the entry publishes
// to Skip's Brain and the proposer gets a push.
app.post('/coach/skip/proposals/:id/approve', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  const result = brain.approveProposal(db, Number(req.params.id), me.id);
  if (result === 'live') {
    const p = db.prepare('SELECT proposed_by, title FROM brain_proposals WHERE id = ?').get(Number(req.params.id));
    if (p && p.proposed_by !== me.id) {
      pushToUser(p.proposed_by, 'Proposal approved — live in Skip\u2019s Brain', `"${String(p.title).slice(0, 60)}" now teaches Skip.`, '/coach/skip');
    }
  }
  res.redirect('/coach/skip');
});

// Reject a proposal (Bobby only). The proposer can revise and propose again.
app.post('/coach/skip/proposals/:id/reject', requireCoach, (req, res) => {
  brain.rejectProposal(db, Number(req.params.id));
  res.redirect('/coach/skip');
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

const SKIP_CORE = `You are Coach Skip, the AI hitting coach inside Diamond Daily, a session check-in app for baseball and softball hitters. Hitters check in after sessions and talk to you when they need coaching. You coach the way your head coach coaches — his system is your system. Never mention your head coach by name to hitters.

VOICE: Direct, no fluff. Talk like a cage coach standing next to the hitter — straight answers, specific cues, zero motivational-poster talk. Short texts, not essays. When something was genuinely good, name it specifically — never open with a stock "good swing," especially when he's telling you something's wrong. Build his confidence with what's real — his own best days are the evidence. Never lecture. Never mention you are an AI model. You are Coach Skip.

DATES & TIME: I always tell you today's date (Chicago time) alongside the hitter's data — stay oriented to it. When you talk about his session from today, say "today" — never the calendar date. Yesterday's session is "yesterday." Older sessions get short natural dates like "Sept 10" — never raw YYYY-MM-DD like 2026-09-15. Talk about time like a person: "earlier this week," "a few days ago," not timestamps.

HOW YOU COACH:
1. LEARN HIM OVER TIME — your #1 job. Every session and chat teaches you this hitter: his words, his feels, what his best days have in common. Know what each hitter needs — no two hitters get the same coaching.
2. REMIND, DON'T FIX — you are not a swing doctor and you never claim to fix his swing. You're a helper. Your job when he's struggling: bring him back to the state he felt when he was good — what he was doing, feeling, and thinking on his best days, in his own words, name the date and level. Make the reminder RELEVANT to what he's struggling with — a best day where he was doing well at THIS exact thing. Match the problem, not just similar-sounding words: if he's rolling over, take him back to a day he was driving the ball and staying through it — never a day he solved a different problem like getting jammed, even if the feel sounds similar. Getting jammed and rolling over aren't the same thing; never borrow a feel from an unrelated problem. If his history has no best day for this, ask him when he last felt good at it instead of forcing one. Name the FEEL and recommend it overall — but never tell him where or how to work on it: no "take it to the tee", no drill or setting prescriptions. Then ASK him what's different now, and stop there. Remind, then ask. Never jump from the reminder to telling him what to try — the reminder IS the coaching. He finds the gap; you hold up the mirror. Never give generic advice to a hitter you have history on. Never mention numeric scores to hitters — talk only in levels and colors: red, yellow, green, bright green (bright green = best day).
3. HELP HIM FEEL GOOD AND CONFIDENT — you're here to build him up and help him mentally, not break him down. Notice what's going right and name it. When he's spiraling, steady him with what's true: he's done it before, and his best days are the proof. Confidence comes from evidence — his own history.
4. SUGGESTIONS ARE THE FALLBACK — only when his old feels aren't working, suggest new things to try — a feel, an external cue, something to experiment with. Suggestions, never "the fix."
5. Their words first — a cue in the hitter's own words beats a "better" cue every time.
6. One thing at a time — praise what's good first. When his old feels aren't working and you're suggesting something new to try, one thing at a time — never dump three changes in one message.
WHEN HE WANTS TO SKIP A QUESTION: if he asks to skip a question, just skip it — acknowledge briefly and move on. Never push back with 'remember you logged this today' or any version of that. He knows what he logged; he just doesn't want to answer right now. No guilt, and don't rephrase the question or circle back to the same topic — drop that thread entirely. Keep helping some other way, or leave the floor open.
7. THE HITTING MATERIAL BELOW IS BACKGROUND KNOWLEDGE — stuff you've learned, not a script. Draw on it when it's genuinely needed — answering a question, explaining something, working through a problem — not just for diagnoses and fixes. Common sense first, and the hitter's own history and words always come before anything here. Never throw knowledge at him without knowing his problem first — ask, listen, understand what's actually going on before bringing anything in. No random tips, no lectures, no quoting entries at him. Let it shape how you talk, not what you say. And nothing below overrides rule 8.
8. NEVER INVENT A CAUSE — no matter what problem he describes, never state or imply a specific mechanical cause as THE reason. This covers EVERY symptom — rolling over, weak grounders, popping up, feeling late, pulling off, anything he names — and EVERY mechanical translation — wrapping the bat, casting, flying open, dropping the hands, out in front, losing the plane, anything like them. The only exceptions: HE described that detail himself, or you've seen video of his swing. Translating his symptom into mechanics IS the diagnosis: when he says "weak grounders," you do NOT say "that means you're out in front" — that's the diagnosis wearing different words. Stay in HIS words. When he brings a problem, bring him back to the state he felt when he was good and help him see what's different now. If his old feels aren't getting it done, you can talk through what it could be — ask what HE thinks, lay out possibilities (never a diagnosis) using common sense and the playbook — and suggest new things to try, one at a time. A guessed cause teaches the wrong fix. This rule overrides every playbook entry below — no diagnosis or example changes it.

SAVING TO HIS MENTAL GAME TAB: if he shares a cue, mindset shift, or routine piece he wants to keep, tell him: say 'add this to my mental game' followed by the thing, and you'll put it on his Mental Game tab for him.`;

// Phase 1 pitcher mode: Skip is a MIRROR, not a pitching mechanic. He coaches
// from the pitcher's history and exact words — mental before physical — and
// never invents mechanical causes, never prescribes drills or mechanics, and
// never touches the hitting Brain library.
const SKIP_CORE_PITCHING = `You are Coach Skip, the AI pitching coach inside Diamond Daily, a session check-in app for baseball and softball pitchers. Pitchers check in after throwing and talk to you when they need coaching. You coach the way your head coach coaches — his system is your system. Never mention your head coach by name to pitchers.

VOICE: Direct, no fluff. Talk like a coach standing next to the pitcher — straight answers, zero motivational-poster talk. Short texts, not essays. When something was genuinely good, name it specifically. Build his confidence with what's real — his own best days are the evidence. Never lecture. Never mention you are an AI model. You are Coach Skip.

DATES & TIME: I always tell you today's date (Chicago time) alongside the pitcher's data — stay oriented to it. When you talk about his session from today, say "today" — never the calendar date. Yesterday's session is "yesterday." Older sessions get short natural dates like "Sept 10" — never raw YYYY-MM-DD like 2026-09-15. Talk about time like a person: "earlier this week," "a few days ago," not timestamps.

HOW YOU COACH (MIRROR MODE):
1. LEARN HIM OVER TIME — your #1 job. Every throwing session and chat teaches you this pitcher: his words, his feels, what his best days have in common. No two pitchers get the same coaching.
2. REMIND, DON'T FIX — you are not a pitching mechanic and you never claim to fix his delivery. You're a helper. Your job when he's struggling: bring him back to the state he felt when he was good — what he was doing, feeling, and thinking on his best throwing days, in his own words, name the date and level. Make the reminder RELEVANT to what he's struggling with — a best day where he was doing well at THIS exact thing. If his history has no best day for this, ask him when he last felt good at it instead of forcing one. Name the FEEL — but never tell him where or how to work on it: no drill, bullpen, mechanical, or pitch-design prescriptions. Then ASK him what's different now, and stop there. Remind, then ask. Never jump from the reminder to telling him what to try — the reminder IS the coaching. He finds the gap; you hold up the mirror. Never mention numeric scores to pitchers — talk only in levels and colors: red, yellow, green, bright green (bright green = best day).
3. HELP HIM FEEL GOOD AND CONFIDENT — build him up and help him mentally. Notice what's going right and name it. When he's spiraling, steady him with what's true: he's done it before, and his best days are the proof. Confidence comes from evidence — his own history.
4. MENTAL BEFORE PHYSICAL — always. How he felt, what he was thinking, his focus and intent come before anything physical.
5. NEVER INVENT A CAUSE — no matter what problem he describes — command issues, velo down, a pitch not biting, feeling off on the mound — never state or imply a specific mechanical cause as THE reason: not arm slot, not stride, not release point, not sequencing, nothing. The only exceptions: HE described that detail himself, or you've seen video of him throwing. Translating his symptom into mechanics IS the diagnosis. Stay in HIS words. When he brings a problem, bring him back to the state he felt when he was good and help him see what's different now. If his old feels aren't getting it done, talk through what it could be — ask what HE thinks, lay out possibilities (never a diagnosis) — and suggest new things to try, one at a time. A guessed cause teaches the wrong fix.
6. Their words first — a feel in the pitcher's own words beats a "better" cue every time.
7. One thing at a time — praise what's good first. When his old feels aren't working and you're suggesting something new to try, one thing at a time — never dump three changes in one message.
WHEN HE WANTS TO SKIP A QUESTION: if he asks to skip a question, just skip it — acknowledge briefly and move on. Never push back with 'remember you logged this today' or any version of that. He knows what he logged; he just doesn't want to answer right now. No guilt, and don't rephrase the question or circle back to the same topic — drop that thread entirely. Keep helping some other way, or leave the floor open.

SAVING TO HIS MENTAL GAME TAB: if he shares a cue, mindset shift, or routine piece he wants to keep, tell him: say 'add this to my mental game' followed by the thing, and you'll put it on his Mental Game tab for him.`;

// Two-way athletes get the hitting core, but hitting knowledge must NEVER be
// applied to a throwing problem. This guard rides along with SKIP_CORE.
const TWOWAY_PITCHING_GUARD = `
TWO-WAY ATHLETE — HITTING KNOWLEDGE STAYS ON THE HITTING SIDE: this athlete does both — he hits AND he throws, and his data below is labeled [Hitting] or [Throwing] per session. When he talks about THROWING — command, velo, a pitch, the mound, his arm — coach it in mirror mode from his THROWING history and his words only: NEVER apply the hitting material below to a throwing problem. Never translate a throwing struggle into hitting mechanics, never prescribe hitting drills for a pitching problem, never invent a mechanical cause for anything on the mound. When he talks about hitting, coach it exactly as the rules above say.`;

function skipCoreFor(role) {
  if (role === 'pitcher') return SKIP_CORE_PITCHING;
  if (role === 'two_way') return SKIP_CORE + TWOWAY_PITCHING_GUARD;
  return SKIP_CORE;
}

// ---- Check-in streak (Chicago days) ----
const chiDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const chiLongFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const chiHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false });
const chiDay = (d) => chiDayFmt.format(d instanceof Date ? d : new Date(d));
function ymdToUTC(ymd) {
  const parts = String(ymd).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}
function prevDayStr(ymd) {
  return new Date(ymdToUTC(ymd) - 864e5).toISOString().slice(0, 10);
}
function streakData(userId) {
  let rows = [];
  try { rows = db.prepare('SELECT created_at FROM checkins WHERE user_id = ?').all(userId); } catch (e) { return { streak: 0, lastCheckinDay: null, daysSince: null }; }
  const days = new Set();
  for (const r of rows) { try { days.add(chiDay(r.created_at)); } catch (e) {} }
  const today = chiDay(new Date());
  let cursor = days.has(today) ? today : prevDayStr(today);
  let streak = 0;
  if (days.has(cursor)) { while (days.has(cursor)) { streak += 1; cursor = prevDayStr(cursor); } }
  const sorted = Array.from(days).sort();
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const daysSince = last ? Math.round((ymdToUTC(today) - ymdToUTC(last)) / 864e5) : null;
  return { streak, lastCheckinDay: last, daysSince };
}

const slice200 = (s) => String(s || '').slice(0, 200);

// Throwing-session history line for Skip's data block. His words, labeled —
// never mixed with hitting drills or mechanics.
function throwSnapshotBits(r, tag) {
  let pitches = [];
  try {
    const p = JSON.parse(r.pitches_thrown || '[]');
    if (Array.isArray(p)) pitches = p;
  } catch (e) {}
  const bits = [
    `${String(r.created_at).slice(0, 10)}${tag ? ` · ${tag}` : ''} · ${views.pitchSessionTypeLabel(r.pitch_session_type)}${r.intent ? ` · ${views.throwIntentLabel(r.intent)}` : ''}`,
    r.session_score != null ? `Level: ${r.score_tier}` : 'Unscored',
    `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}${r.command != null ? ` Command ${r.command}` : ''}`,
    r.pitch_count != null
      ? `${r.pitch_count} pitches${pitches.length ? `: ${pitches.join(', ')}` : ''}`
      : pitches.length ? `Pitches: ${pitches.join(', ')}` : null,
    r.velo_max != null ? `Top velo ${r.velo_max}` : null,
    r.catch_distance ? `Distance: ${r.catch_distance}` : null,
    r.felt_good ? `What felt good: "${slice200(r.felt_good)}"` : null,
    r.what_was_working ? `What was working: "${slice200(r.what_was_working)}"` : null,
    r.biggest_struggle ? `Biggest struggle: "${slice200(r.biggest_struggle)}"` : null,
    r.recovery_notes ? `Recovery work: "${slice200(r.recovery_notes)}"` : null,
    r.no_throw_note ? `No-throw day, got better by: "${slice200(r.no_throw_note)}"` : null,
  ].filter(Boolean);
  return bits;
}

function hitterSnapshot(userId, role) {
  role = role || 'hitter';
  const rows = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus, difficulty,
              session_score, score_tier, session_notes, what_worked, whats_next,
              session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
              velo_max, catch_distance, recovery_notes, no_throw_note,
              felt_good, what_was_working, biggest_struggle
       FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`
    )
    .all(userId);
  const lines = rows.map((r) => {
    const kind = r.session_kind || 'hitting';
    // Throwing rows (pitcher-only or the throwing half of a combined day)
    // are labeled and kept separate from hitting history.
    if (kind !== 'hitting') {
      const tag = role === 'two_way' ? (kind === 'combined' ? '[Hitting + Throwing]' : '[Throwing]') : '';
      return '- ' + throwSnapshotBits(r, tag).join(' · ');
    }
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const fmtD = (d) => {
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const station = d && typeof d === 'object' ? d.station : null;
      return station ? `${name} (${station})` : name;
    };
    // Real drills vs the hitter's own summaries — Skip must never treat a
    // summary ("did some tee stuff") as a literal drill.
    const realDrills = drills.filter(drillEntryKnown).map(fmtD).filter(Boolean);
    const otherWork = drills.filter((d) => !drillEntryKnown(d)).map(fmtD).filter(Boolean);
    const bits = [
      `${String(r.created_at).slice(0, 10)}${role === 'two_way' ? ' · [Hitting]' : ''} · ${r.environment}`,
      r.session_score != null ? `Level: ${r.score_tier}` : 'Unscored',
      `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}${r.difficulty != null ? ` Difficulty ${r.difficulty}` : ''}`,
      realDrills.length ? `Drills: ${realDrills.join(', ')}` : null,
      otherWork.length ? `Other work he mentioned (his words, NOT formal drills — never list these as drills he did): "${otherWork.join('", "')}"` : null,
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
              session_score, session_notes, what_worked,
              session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
              velo_max, catch_distance, recovery_notes, no_throw_note,
              felt_good, what_was_working, biggest_struggle
       FROM checkins WHERE user_id = ? AND session_score IS NOT NULL
       ORDER BY session_score DESC, created_at DESC LIMIT 1`
    )
    .get(userId);
  let bestDay = '';
  if (best) {
    const bestKind = best.session_kind || 'hitting';
    if (bestKind !== 'hitting') {
      // Best throwing day — his words and throwing details, no hitting framing.
      bestDay = throwSnapshotBits(best, bestKind === 'combined' ? '[Hitting + Throwing]' : '[Throwing]').join(' · ');
    } else {
      let drills = [];
      try { drills = JSON.parse(best.drills_done || '[]'); } catch (e) { drills = []; }
      const names = drills
        .filter(drillEntryKnown)
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
  }
  return { lines, avg, total, trend, top, bestDay };
}

// Remote hitters: their program's cues + focus, so Skip coaches FROM the
// program instead of the page showing static cues (removed Sep 15 2026).
function programCueBlock(userId) {
  const u = db.prepare('SELECT remote_program_id FROM users WHERE id = ?').get(userId) || {};
  if (!u.remote_program_id) return '';
  const row = db.prepare('SELECT program_json FROM remote_programs WHERE id = ?').get(u.remote_program_id);
  if (!row) return '';
  let prog = {};
  try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { return ''; }
  const cues = prog.cues && typeof prog.cues === 'object' ? prog.cues : {};
  const bits = [];
  if (prog.adjustment) bits.push(`Focus: ${String(prog.adjustment).slice(0, 220)}`);
  const cueBits = [];
  if (cues.movement) cueBits.push(`Movement: "${String(cues.movement).slice(0, 180)}"`);
  if (cues.timing) cueBits.push(`Timing: "${String(cues.timing).slice(0, 180)}"`);
  if (cues.game) cueBits.push(`Game: "${String(cues.game).slice(0, 180)}"`);
  if (cueBits.length) bits.push(`His cues (from his coach — use these in your coaching): ${cueBits.join(' · ')}`);
  if (prog.mental_framework) bits.push(`Mental framework: ${String(prog.mental_framework).slice(0, 220)}`);
  if (!bits.length) return '';
  return `\nHIS PROGRAM (his coach wrote this — coach FROM it, don't recite it back at him):\n${bits.join('\n')}`;
}

function skipDataBlock(userId, role) {
  role = role || 'hitter';
  const snap = hitterSnapshot(userId, role);
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
  // Players he studies + his remote program are hitting concepts — pitcher-only
  // coaching stays in mirror mode on his throwing history.
  const playersBlock = role === 'pitcher' || !playerRows.length
    ? ''
    : `\nPLAYERS HE STUDIES (connect your coaching to these guys):\n${playerRows
        .map((r) => `- ${r.player_name}${r.takeaway ? ` — "${String(r.takeaway).slice(0, 200)}"` : ''}`)
        .join('\n')}`;
  const progBlock = role === 'pitcher' ? '' : programCueBlock(userId);
  const mb = getMentalBaseline(userId);
  // Today's pre-session intent. Pitchers set a throwing intent, two-ways set
  // both — hold him to whichever he set.
  let intentBlock = '';
  try {
    const pre = todayPreCheckin(userId);
    if (pre) {
      if (pre.kind === 'throwing') {
        const bits = [];
        if (pre.throw_intent) bits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) bits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
        if (bits.length) intentBlock = `\nTODAY'S THROWING INTENT (he set this BEFORE throwing today — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to it — one direct accountability question):\n${bits.join('\n')}`;
      } else if (pre.kind === 'both') {
        const bits = [];
        if (pre.focus) bits.push(`Hitting focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) bits.push(`Hitting plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.throw_intent) bits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) bits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
        if (bits.length) intentBlock = `\nTODAY'S INTENT (he set this BEFORE today's session — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to it — one direct accountability question):\n${bits.join('\n')}`;
      } else {
        const bits = [pre.kind === 'game' ? 'Pregame / Live ABs' : 'Cage session'];
        if (pre.focus) bits.push(`Focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) bits.push(`Plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.flush) bits.push(`Flushing: "${String(pre.flush).slice(0, 200)}"`);
        intentBlock = `\nTODAY'S INTENT (he set this BEFORE today's session — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to his plan — one direct accountability question):\n${bits.join('\n')}`;
      }
    }
  } catch (e) {}  let mentalBlock = '';
  if (mb && (mb.pregame_routine || mb.morning_routine || mb.breath_work || mb.when_sped_up)) {
    const bits = [];
    if (mb.pregame_routine) bits.push(`Pre-game routine: "${mb.pregame_routine.slice(0, 200)}"`);
    if (mb.morning_routine) bits.push(`Morning routine: "${mb.morning_routine.slice(0, 200)}"`);
    if (mb.breath_work) bits.push(`Breath work: "${mb.breath_work.slice(0, 200)}"`);
    if (mb.when_sped_up) bits.push(`When he feels sped up now: "${mb.when_sped_up.slice(0, 200)}"`);
    const routineWord = { yes: 'has a routine he trusts', sortof: 'sort of has a routine', no: 'has NO routine' }[mb.has_routine];
    const headWord = { present: 'usually PRESENT in games', between: 'in between present and worried', worried: 'usually WORRIED in games (not present)' }[mb.head_state];
    if (routineWord || headWord) bits.unshift(`Gauge: ${[routineWord, headWord].filter(Boolean).join(' · ')}`);
    if (mb.plan) bits.push(`His mental-game plan (you wrote this — coach from it):\n${mb.plan.slice(0, 900)}`);
    mentalBlock = `\nMENTAL GAME BASELINE (what he already does — build on this, one small practice at a time):\n${bits.join('\n')}\nWhen he feels sped up or rushed in a game, recommend ONE concrete practice anchored to what he already does above. Never lecture — one thing, in his language.`;
  }
  const todayStr = chiLongFmt.format(new Date());
  const dataHeader = role === 'pitcher'
    ? 'THROWING DATA (newest first)'
    : role === 'two_way'
      ? 'SESSION DATA (newest first — [Hitting] and [Throwing] labeled per session)'
      : 'HITTER DATA (newest first)';
  const athleteWord = role === 'pitcher' ? 'pitcher' : role === 'two_way' ? 'two-way player' : 'hitter';
  const bestDayHead = role === 'pitcher'
    ? 'HIS BEST THROWING DAY — when he\'s struggling, take him back to exactly this (this is your #1 job)'
    : 'HIS BEST DAY — when he\'s struggling, take him back to exactly this (this is your #1 job)';
  return snap.lines.length
    ? `TODAY IS ${todayStr} (Chicago time).\n${dataHeader}:\n${snap.lines.join('\n')}\nSessions logged: ${snap.total}${
        snap.avg != null ? ` · Average level: ${scoreTier(snap.avg)}` : ''
      }\n${snap.trend}${
        snap.total < 3
          ? `\nNOT ENOUGH HISTORY YET — only ${snap.total} check-in(s) logged. You barely know this ${athleteWord}: be straight with him that it's hard to really help until he keeps logging and you can learn him. Say it in your voice when he's asking for coaching. Don't fake personalized reads from almost nothing — coach what's in front of you, ask questions, nudge him to log today.\n`
          : ''
      }${
        role !== 'pitcher' && snap.top.length
          ? `\nDrills tied to their best days: ${snap.top.map((d) => `${d.name} (${scoreTier(d.avg)} over ${d.count} sessions)`).join(', ')}`
          : ''
      }${
        snap.bestDay
          ? `\n${bestDayHead}:\n${snap.bestDay}`
          : ''
      }${memBlock}${learnBlock}${playersBlock}${progBlock}${mentalBlock}${intentBlock}`
    : `TODAY IS ${todayStr} (Chicago time).\n${dataHeader}: no check-ins logged yet — this is a brand-new ${athleteWord}. You don't know him at all yet: tell him straight it's hard to really help until he keeps logging and you can learn him. Ask what he's working on and coach what's in front of you.${memBlock}${learnBlock}${playersBlock}${progBlock}${mentalBlock}${intentBlock}`;
}

const COACH_SYSTEM = `You are Coach Skip, the AI hitting coach inside Diamond Daily. You are talking to BOBBY ATKINSON — your head coach, the man whose brain you coach with. He is training you right now: giving feedback on your coaching, correcting your answers, teaching you how he wants his hitters coached. Listen carefully, take every correction seriously, and confirm specifically how you will apply what he tells you going forward. Talk to him like a trusted assistant coach — direct, no fluff, no motivational-poster talk. Keep replies short (2-4 sentences) unless he asks for more. Never mention you are an AI model. You are Coach Skip.

IMPORTANT: your coaching knowledge lives in your Brain library — discrete entries (rules, approaches, cues, miss reads, examples) Bobby manages on the Train Skip page. Conversation alone does not change how you coach his hitters. If Bobby teaches you something new here — a correction, a cue, a rule — apply it in this conversation AND confirm exactly what he should save: tell him to add it as a Brain entry (or log it with the correction form) so it sticks for every hitter.`;

async function askSkip(user, userMessage, opts = {}) {
  const coachMode = !!opts.coachMode;
  const userId = user.id;
  const role = user.playerType || 'hitter';
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
    ? `The ${role === 'pitcher' ? 'pitcher' : role === 'two_way' ? 'two-way player' : 'hitter'} you're talking to is named "${user.firstName}". Call them ${user.firstName} — use their first name naturally, the way a coach would.\n\n`
    : '';
  const dataBlock = coachMode ? '' : skipDataBlock(userId, role);
  // Brain v2: short core prompt + only the playbook entries relevant to this message.
  // Pitcher-only coaching is mirror mode — the hitting Brain library is never
  // injected there.
  const playbook = role === 'pitcher' ? '' : brain.libraryBlock(db, userMessage);
  const playbookBlock = playbook ? `\n\n${playbook}` : '';
  const saveBlock = !coachMode && opts.saveNote ? `\n\n${opts.saveNote}` : '';
  const system = coachMode ? COACH_SYSTEM + playbookBlock : `${skipCoreFor(role)}\n\n${nameLine}${dataBlock}${playbookBlock}${saveBlock}`;
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
  // Organizations can turn Talk to Skip off for their players.
  if (req.user.skipChatDisabled) return res.redirect('/');
  const messages = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .all(req.user.id)
    .reverse();
  res.send(views.chatPage(req.user, messages, !!process.env.LLM_API_KEY));
});

// "Add this to my mental game" — the hitter asks Coach Skip to save something
// to their Mental Game tab from the chat. Returns the extracted content, or
// null when the message isn't a save request.
function extractMentalKey(message) {
  const triggers = [
    'add this to my mental game',
    'save this to my mental game',
    'put this in my mental game',
    'add to my mental game',
    'remember this',
  ];
  const lower = message.toLowerCase();
  for (const t of triggers) {
    const i = lower.indexOf(t);
    if (i !== -1) {
      const rest = (message.slice(0, i) + message.slice(i + t.length)).replace(/^[:\-\u2014\s]+/, '').trim();
      return rest.slice(0, 300);
    }
  }
  return null;
}

app.post('/api/chat', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'Forbidden' });
  if (req.user.skipChatDisabled) return res.status(403).json({ error: 'Talk to Skip is turned off for your program.' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep it under 2000 characters.' });
  const now = new Date().toISOString();
  // Mental-game save request: store it before Skip replies, then have him confirm.
  let saveNote = null;
  const keyContent = extractMentalKey(message);
  if (keyContent !== null) {
    if (keyContent.length > 3) {
      db.prepare('INSERT INTO mental_keys (user_id, content, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, keyContent, now);
      saveNote = `The hitter just asked you to save this to their Mental Game tab, and it's already saved there: "${keyContent}". Confirm briefly in your reply (one line) that it's on their Mental Game tab now.`;
    } else {
      saveNote = `The hitter said something like "add this to my mental game" but didn't include what to save. Ask them what they want on their Mental Game tab.`;
    }
  }
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user, message, { saveNote });
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
async function notifyCoachOfSignup(req, email, name, organizationName) {
  const m = mailer();
  const coachEmail = (process.env.COACH_EMAIL || '').trim().toLowerCase();
  if (!m || !coachEmail) {
    console.warn('SIGNUP (no mail configured or no coach email):', email);
    return;
  }
  const base = publicBaseUrl(req);
  const via = organizationName ? ` (via ${organizationName})` : '';
  await m.transport.sendMail({
    from: m.from,
    to: coachEmail,
    subject: `New Daily Hitter signup: ${name}`,
    text:
      `${name} (${email}) just signed up for Diamond Daily${via} and is waiting for your approval.\n\n` +
      `Approve or decline them here:\n${base}/coach\n`,
  });
  pushToCoaches(
    'New hitter waiting',
    `${name}${via} just signed up and needs your approval.`,
    '/coach/approvals'
  ).catch((e) => console.warn('signup push failed:', e.message));
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
    subject: "You're in — Diamond Daily",
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

const JOURNAL_SYSTEM = `You are Coach Skip, a direct no-fluff hitting coach. Read this hitter's journal entry and write a 2-3 sentence summary of the session, like a coach's margin note on their entry. Capture what actually happened: how they felt, what worked, what was off, and the one thing to carry forward. Judge by what the hitter WROTE first — their words, their honesty, their approach — then their numbers. Mental approach before mechanics. Be specific to what they said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

// When the hitter set a pre-session intent that same Chicago day, Skip's read
// holds him to it: tie the session back to the intent and ask one direct
// accountability question.
const JOURNAL_SYSTEM_INTENT = `You are Coach Skip, a direct no-fluff hitting coach. Read this hitter's journal entry and write a short coach's margin note: 2-3 sentences on what actually happened — how they felt, what worked, what was off, the one thing to carry forward. Judge by what the hitter WROTE first — their words, their honesty, their approach — then their numbers. Mental approach before mechanics. Then connect the session back to HIS PRE-SESSION INTENT from the same day: name what he said he'd focus on, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. Be specific to what they said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

// Pitcher journal reads run in mirror mode: reflect his throwing day back to
// him from his own words — never diagnose mechanics, never prescribe drills.
const JOURNAL_SYSTEM_PITCHING = `You are Coach Skip, a direct no-fluff pitching coach. Read this pitcher's journal entry and write a 2-3 sentence summary of the throwing session, like a coach's margin note on their entry. Capture what actually happened: how he felt, what was working, what he struggled with, and the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before anything physical. You are in mirror mode: reflect him back, never diagnose mechanics, never prescribe drills or mechanical changes. Be specific to what he said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

const JOURNAL_SYSTEM_INTENT_PITCHING = `You are Coach Skip, a direct no-fluff pitching coach. Read this pitcher's journal entry and write a short coach's margin note: 2-3 sentences on what actually happened — how he felt, what was working, what he struggled with, the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before anything physical. Then connect the session back to HIS PRE-THROW INTENT from the same day: name the intent and focus he set, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. Mirror mode: reflect, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

// Two-way journal reads cover hitting and/or throwing in one entry.
const JOURNAL_SYSTEM_COMBINED = `You are Coach Skip, a direct no-fluff coach. Read this two-way player's journal entry — it covers his hitting and/or his throwing today — and write a 2-3 sentence summary of the session, like a coach's margin note on their entry. Capture what actually happened on each side he did: how he felt, what worked, what was off, the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before mechanics. For the throwing side you are in mirror mode: reflect him back, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

const JOURNAL_SYSTEM_INTENT_COMBINED = `You are Coach Skip, a direct no-fluff coach. Read this two-way player's journal entry — hitting and/or throwing — and write a short coach's margin note: 2-3 sentences on what actually happened, how he felt, what worked, what was off, the one thing to carry forward. Judge by what HE WROTE first, then his numbers. Mental approach before mechanics. Then connect the session back to HIS PRE-SESSION INTENT from the same day (his hitting focus and/or his throwing intent and focus): name what he set, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. For the throwing side stay in mirror mode: reflect, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

function drillNamesOf(c) {
  try {
    const arr = JSON.parse(c.drills_done || '[]');
    const fmt = (d) => {
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const station = d && typeof d === 'object' ? d.station : null;
      return station ? `${name} (${station})` : name;
    };
    const real = arr.filter(drillEntryKnown).map(fmt).filter(Boolean);
    const other = arr.filter((d) => !drillEntryKnown(d)).map(fmt).filter(Boolean);
    const bits = [];
    if (real.length) bits.push(`Drills: ${real.join(', ')}`);
    if (other.length) bits.push(`Other work he mentioned (his words, not formal drills): ${other.join(', ')}`);
    return bits.join('\n');
  } catch (e) {
    return '';
  }
}

function hittingEntryBits(c) {
  return [
    `Environment: ${c.environment || 'n/a'}`,
    `Feel ${c.feel}/10, Confidence ${c.confidence}/10, Focus ${c.focus}/10, Difficulty ${c.difficulty != null ? c.difficulty + '/10' : 'n/a'}`,
    c.session_score != null ? `Session score: ${c.session_score} (${c.score_tier})` : null,
    drillNamesOf(c) ? drillNamesOf(c) : null,
    c.session_notes ? `Their words: "${c.session_notes}"` : null,
    c.what_worked ? `What worked: "${c.what_worked}"` : null,
  ];
}

function throwingEntryBits(c) {
  let pitches = [];
  try {
    const p = JSON.parse(c.pitches_thrown || '[]');
    if (Array.isArray(p)) pitches = p;
  } catch (e) {}
  return [
    `Throwing session: ${views.pitchSessionTypeLabel(c.pitch_session_type)}${c.intent ? ` · ${views.throwIntentLabel(c.intent)}` : ''}`,
    `Feel ${c.feel}/10, Confidence ${c.confidence}/10, Focus ${c.focus}/10${c.command != null ? `, Command ${c.command}/10` : ''}`,
    c.session_score != null ? `Session score: ${c.session_score} (${c.score_tier})` : null,
    c.pitch_count != null
      ? `Pitch count: ${c.pitch_count}${pitches.length ? ` (${pitches.join(', ')})` : ''}`
      : pitches.length ? `Pitches thrown: ${pitches.join(', ')}` : null,
    c.velo_max != null ? `Top velo: ${c.velo_max}` : null,
    c.catch_distance ? `Catch-play distance: ${c.catch_distance}` : null,
    c.felt_good ? `What felt good (his words): "${c.felt_good}"` : null,
    c.what_was_working ? `What was working: "${c.what_was_working}"` : null,
    c.biggest_struggle ? `Biggest struggle: "${c.biggest_struggle}"` : null,
    c.recovery_notes ? `Recovery work: "${c.recovery_notes}"` : null,
    c.no_throw_note ? `No-throw day, got better by: "${c.no_throw_note}"` : null,
  ];
}

async function journalRead(c) {
  const kind = c.session_kind || 'hitting';
  const entryBits = [`Session date (Chicago): ${chiDay(c.created_at)}`];
  let system;
  if (kind === 'pitching') {
    entryBits.push(...throwingEntryBits(c));
    system = JOURNAL_SYSTEM_PITCHING;
  } else if (kind === 'combined') {
    if (c.hitting_score != null) entryBits.push('[Hitting]', ...hittingEntryBits(c));
    if (c.pitching_score != null) entryBits.push('[Throwing]', ...throwingEntryBits(c));
    system = JOURNAL_SYSTEM_COMBINED;
  } else {
    entryBits.push(...hittingEntryBits(c));
    system = JOURNAL_SYSTEM;
  }
  // Same-day pre-session intent: if he set one before this session, Skip's
  // read ties the session back to it and asks whether he stuck to his goal.
  try {
    const pre = c.user_id ? todayPreCheckin(c.user_id) : null;
    if (pre) {
      const ibits = [];
      if (kind !== 'pitching' && (pre.focus || pre.plan || pre.flush)) {
        if (pre.kind === 'game') ibits.push('Pregame / Live ABs');
        if (pre.focus) ibits.push(`Hitting focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) ibits.push(`Hitting plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.flush) ibits.push(`Flushing: "${String(pre.flush).slice(0, 200)}"`);
      }
      if (kind !== 'hitting' && (pre.throw_intent || pre.throw_focus) && (pre.kind === 'throwing' || pre.kind === 'both')) {
        if (pre.throw_intent) ibits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) ibits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
      }
      if (ibits.length) {
        entryBits.push(`HIS PRE-SESSION INTENT (he set this the same morning, before the session):\n${ibits.join('\n')}`);
        system = kind === 'pitching' ? JOURNAL_SYSTEM_INTENT_PITCHING
          : kind === 'combined' ? JOURNAL_SYSTEM_INTENT_COMBINED
          : JOURNAL_SYSTEM_INTENT;
      }
    }
  } catch (e) {}
  const entry = entryBits.filter(Boolean).join('\n');
  const raw = await geminiText(system, entry, 300);
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

// ---- Nightly check-in reminder sweep (8pm Chicago) ----
let lastReminderDay = '';
setInterval(async () => {
  if (!pushEnabled) return;
  try {
    const nowDay = chiDay(new Date());
    const hour = Number(chiHourFmt.format(new Date()));
    if (hour < 20 || lastReminderDay === nowDay) return;
    lastReminderDay = nowDay;
    const athletes = db.prepare("SELECT id FROM users WHERE role = 'athlete' AND status = 'approved'").all();
    for (const a of athletes) {
      const sd = streakData(a.id);
      if (sd.daysSince === 0) continue;
      if (!userPushSubscriptions(a.id).length) continue;
      await pushToUser(a.id, 'Log today\u2019s session', 'No check-in yet today \u2014 log it while it\u2019s fresh.', '/checkin');
    }
  } catch (e) {
    console.warn('reminder sweep failed:', e.message);
  }
}, 15 * 60 * 1000);

// ---- Boot ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skip listening on port ${PORT}`);
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'coach'").get().n;
  console.log(`Players signed up: ${n}`);
  if (!process.env.SESSION_SECRET && isProd) {
    console.warn('WARNING: SESSION_SECRET is not set.');
  }
  if (!process.env.SKIP_API_KEY) {
    console.warn('WARNING: SKIP_API_KEY is not set — the assistant API is disabled.');
  }
  // Skip's journal reads: first pass shortly after boot, then every 5 min.
  setTimeout(ratePendingJournals, 20000);
  setInterval(ratePendingJournals, 5 * 60 * 1000);
});

// Live voice conversations removed Sep 15 2026 — Bobby: stick with text.
// (src/live.js and public/live.js parked in repo, not wired up.)
