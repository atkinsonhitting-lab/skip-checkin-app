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
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens']) {
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
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id IN (${ph})`).run(...ids);
    }
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('test_cleanup_e2e_20260915', ?)").run(String(ids.length));
  console.log(`TEST CLEANUP (e2e): removed ${ids.length} account(s): ${victims.map((r) => r.email).join(', ') || 'none'}`);
}

module.exports = db;
