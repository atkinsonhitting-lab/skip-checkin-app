// Skip database: users, check-ins, and express-session storage.
// Uses Node's built-in node:sqlite (Node 24+) — no native dependencies.
// DB_PATH env var overrides the default ./skip.db location.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'skip.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

const USERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('coach','athlete')),
  athlete_name TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT NOT NULL
);
`;
db.exec(USERS_SCHEMA);

// Migration: add first_name / last_name to existing users tables (non-destructive).
for (const col of ['first_name', 'last_name']) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
}

// Account approvals (Sep 15 2026): Bobby approves every new signup before the
// hitter can use the app. New athletes are inserted as 'pending'; existing
// rows (including the coach) default to 'approved' so nobody gets locked out.
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';");
  }
}

// Check-ins: the full Skip flow — environment, drills done, Feel/Confidence/
// Focus (1-10), instant session score + tier, journal fields, and Skip's
// journal rating (posted back by the assistant via the API).
db.exec(`
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  athlete_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT '',
  drills_done TEXT NOT NULL DEFAULT '[]',
  feel INTEGER,
  confidence INTEGER,
  focus INTEGER,
  session_score REAL,
  score_tier TEXT NOT NULL DEFAULT '',
  session_notes TEXT NOT NULL DEFAULT '',
  what_worked TEXT NOT NULL DEFAULT '',
  whats_next TEXT NOT NULL DEFAULT '',
  skip_journal_score REAL,
  skip_journal_note TEXT,
  skip_rated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkins_athlete_time ON checkins(athlete_name, created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_time ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);
`);

// Migration: the pre-launch schema identified users by `username`. The app
// has not been distributed yet and storage is ephemeral, so a legacy schema
// is rebuilt for email login (users + check-ins reset) instead of migrated.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (userCols.includes('username') && !userCols.includes('email')) {
  console.warn(
    'MIGRATION: legacy username-based users table found — rebuilding for email login. ' +
    'Existing users and check-ins will be reset.'
  );
  db.exec('DROP TABLE users;');
  db.exec(USERS_SCHEMA);
  // Recreate users before clearing checkins: the checkins table has a
  // REFERENCES users(id) clause, and SQLite requires the parent table to
  // exist when preparing DML against the child table.
  db.exec('DELETE FROM checkins;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// Talk to Skip: persisted chat history per hitter (the client sends the
// message, the server calls the LLM and stores both sides).
db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_messages(user_id, created_at);
`);

// Migration: session difficulty (1-10, how hard the training was). Older
// check-ins predate it; NULL difficulty is treated as neutral (5).
const checkinCols = db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name);
if (!checkinCols.includes('difficulty')) {
  db.exec('ALTER TABLE checkins ADD COLUMN difficulty INTEGER;');
}

// Remote programs: Bobby's 4 remote hitters each get their training program
// in the app. users.remote_program_id links a hitter's account to theirs.
db.exec(`CREATE TABLE IF NOT EXISTS remote_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_name TEXT UNIQUE NOT NULL,
  program_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);`);
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('remote_program_id')) {
    db.exec('ALTER TABLE users ADD COLUMN remote_program_id INTEGER;');
  }
}
// Seed the 4 remote programs from the bundled snapshots (first boot only —
// Bobby's in-app edits are never overwritten). Then link any existing
// accounts whose name matches, so a remote guy who already signed up just
// gets his program.
{
  const n = db.prepare('SELECT COUNT(*) AS n FROM remote_programs').get().n;
  if (n === 0) {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, 'seed_programs');
    const ins = db.prepare(
      'INSERT INTO remote_programs (athlete_name, program_json, updated_at) VALUES (?, ?, ?)'
    );
    // The 4 program files were built at different times with different
    // shapes — normalize to one canonical shape on the way in.
    const normItems = (items) =>
      (Array.isArray(items) ? items : [])
        .map((it) => {
          if (typeof it === 'string') return { drill: it.trim() };
          const drill = String((it && it.drill) || '').trim();
          if (!drill) return null;
          const o = { drill };
          if (it.volume) o.volume = String(it.volume).trim();
          return o;
        })
        .filter(Boolean);
    const normalizeProgram = (raw) => {
      const p = { ...(raw || {}) };
      const blocks = [];
      if (Array.isArray(p.routine)) {
        for (const c of p.routine) {
          const items = normItems(c.items);
          if (c.category || items.length) blocks.push({ category: String(c.category || 'Training'), items });
        }
      }
      if (Array.isArray(p.daily_routine) && p.daily_routine.length) {
        blocks.unshift({ category: 'Daily Routine', items: normItems(p.daily_routine) });
      }
      if (Array.isArray(p.mobility) && p.mobility.length) {
        blocks.push({ category: 'Mobility', items: normItems(p.mobility) });
      }
      if (Array.isArray(p.days)) {
        for (const d of p.days) {
          const title = [d.title, d.section].filter(Boolean).join(' \u2014 ');
          const items = normItems(d.items);
          if (title || items.length) blocks.push({ category: title || 'Training Day', items });
        }
      }
      p.routine = blocks;
      delete p.daily_routine;
      delete p.mobility;
      delete p.days;
      if (!Array.isArray(p.notes)) p.notes = [];
      if (!Array.isArray(p.schedule)) p.schedule = [];
      if (!p.grades || typeof p.grades !== 'object') p.grades = {};
      if (!Array.isArray(p.strengths)) p.strengths = [];
      if (!p.cues || typeof p.cues !== 'object') p.cues = { movement: '', timing: '', game: '' };
      return p;
    };
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const prog = normalizeProgram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        const name = String(prog.athlete || f.replace(/\.json$/, '')).trim();
        if (name) ins.run(name, JSON.stringify(prog), new Date().toISOString());
      } catch (e) { console.warn('program seed skipped', f, e.message); }
    }
  }
  // Backfill: match accounts by full name (runs every boot; idempotent).
  const link = db.prepare(
    `UPDATE users SET remote_program_id = ?
     WHERE remote_program_id IS NULL AND role = 'athlete'
     AND lower(first_name || ' ' || last_name) = lower(?)`
  );
  for (const r of db.prepare('SELECT id, athlete_name FROM remote_programs').all()) {
    link.run(r.id, r.athlete_name);
  }
}

// Daily routine drills: each hitter's everyday drill list, each drill tagged
// with how it's done (tee / side toss / front toss / BP / machine).
db.exec(`CREATE TABLE IF NOT EXISTS routine_drills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  station TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);`);
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_routine_user ON routine_drills(user_id, position);'
);

// Password resets: single-use tokens, SHA-256 hashed, 1-hour expiry.
db.exec(`
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);
`);

// Skip's durable memory per hitter: what Skip has learned about this hitter
// over time (their best-day patterns, cues that work for them, slump fixes).
// Written by Bobby on the hitter's coach page; injected into every Skip chat
// with that hitter. This is how Skip "learns hitters over time."
db.exec(`
CREATE TABLE IF NOT EXISTS hitter_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_user ON hitter_memory(user_id);
`);

// Coach settings: key/value store (e.g. Bobby's coaching notes for Skip).
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// One-time cleanup (Sep 15 2026): Bobby asked to remove ALL test accounts
// except test@atkinsonhitting.com. Keeps every coach account and that one
// athlete account; deletes everyone else plus their check-ins, chats,
// routines, and reset tokens. Guarded by a settings flag so it runs once.
if (!db.prepare("SELECT value FROM settings WHERE key = 'test_cleanup_20260915'").get()) {
  const victims = db
    .prepare("SELECT id, email FROM users WHERE role != 'coach' AND email != 'test@atkinsonhitting.com'")
    .all();
  const ids = victims.map((r) => r.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'learning_notes', 'study_players']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id IN (${ph})`).run(...ids);
    }
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('test_cleanup_20260915', ?)").run(String(ids.length));
  console.log(`TEST CLEANUP: removed ${ids.length} test account(s): ${victims.map((r) => r.email).join(', ') || 'none'}`);
}

// Follow-up (Sep 15 2026): remove any leftover synthetic verification
// accounts (@e2e.com) created after the main cleanup. One-time, flagged.
if (!db.prepare("SELECT value FROM settings WHERE key = 'test_cleanup_e2e_20260915'").get()) {
  const victims = db
    .prepare("SELECT id, email FROM users WHERE role != 'coach' AND email LIKE '%@e2e.com'")
    .all();
  const ids = victims.map((r) => r.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'learning_notes', 'study_players']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id IN (${ph})`).run(...ids);
    }
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('test_cleanup_e2e_20260915', ?)").run(String(ids.length));
  console.log(`TEST CLEANUP (e2e): removed ${ids.length} account(s): ${victims.map((r) => r.email).join(', ') || 'none'}`);
}

// Learning log (Sep 15 2026): hitters save new things they're learning
// about hitting (beyond session check-ins), plus the players they like
// learning from and what they're stealing from each one.
db.exec(`
CREATE TABLE IF NOT EXISTS learning_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_user_time ON learning_notes(user_id, created_at);
CREATE TABLE IF NOT EXISTS study_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  player_name TEXT NOT NULL,
  takeaway TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_user_time ON study_players(user_id, created_at);
`);

// Coach feed REMOVED Sep 15 2026 (Bobby: Learn tab is a personal notebook, no social layer).
// Drop the tables if a previous deploy created them.
db.exec(`DROP TABLE IF EXISTS post_reactions; DROP TABLE IF EXISTS coach_posts;`);

module.exports = db;
