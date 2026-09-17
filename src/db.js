// Skip database: users, check-ins, and express-session storage.
// Uses Node's built-in node:sqlite (Node 24+) — no native dependencies.
// DB_PATH env var overrides the default ./skip.db location.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'skip.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

// node:sqlite has no .transaction() helper (unlike better-sqlite3), so add
// one with the same shape: db.transaction(fn) returns a function that runs
// fn inside BEGIN/COMMIT, rolling back on throw.
db.transaction = function (fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const out = fn(...args);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  };
};

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

// View-only coach access (Sep 2026): can_edit=0 means the coach can look at
// everything but change nothing. Defaults to 1 so Bobby keeps full access.
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('can_edit')) {
    db.exec('ALTER TABLE users ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 1;');
  }
}

// Organizations (Sep 2026): Bobby sells Diamond Daily to colleges, travel
// programs, and hitting coaches. Each organization has a signup code its
// coaches hand to players, plus a per-organization Talk to Skip switch — many
// programs want the check-ins and the coach dashboard without players
// chatting with Skip.
// (First shipped as "colleges" on Sep 16 2026; renamed the same day to cover
// travel programs and hitting coaches too.)
{
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  if (tables.includes('colleges') && !tables.includes('organizations')) {
    db.exec('ALTER TABLE colleges RENAME TO organizations');
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  skip_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);`);

// Deal tracking (Sep 2026): agreed price + collected revenue per organization,
// set by Bobby on the Organizations page. Powers the revenue stat on the
// Coach Dashboard.
for (const col of ['deal_cents', 'paid_cents']) {
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE organizations ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0;`);
}

// Finances page (Sep 16 2026): deal pipeline fields per organization — status
// (prospect/pilot/active/past), start + renewal dates, freeform notes — plus
// a payment ledger so every dollar collected has a dated record.
for (const [col, type] of [['deal_status', 'TEXT NOT NULL DEFAULT ""'], ['deal_start', 'TEXT NOT NULL DEFAULT ""'], ['deal_renewal', 'TEXT NOT NULL DEFAULT ""'], ['deal_notes', 'TEXT NOT NULL DEFAULT ""']]) {
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE organizations ADD COLUMN ${col} ${type};`);
}

// Organization branding (Sep 17 2026): per-org logo + colors so a college or
// travel program's players see their own program's look. logo_path is a file
// name under DATA_DIR/org-logos (never a path — served via /org-logos/:file).
for (const [col, type] of [['logo_path', 'TEXT NOT NULL DEFAULT ""'], ['primary_color', 'TEXT NOT NULL DEFAULT ""'], ['accent_color', 'TEXT NOT NULL DEFAULT ""']]) {
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE organizations ADD COLUMN ${col} ${type};`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS org_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);`);

// Organization link + birthdate on users. A coach row with organization_id set
// is an organization coach: view-only, scoped to their organization's
// players. date_of_birth is YYYY-MM-DD, collected at signup for every player.
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('college_id') && !cols.includes('organization_id')) {
    db.exec('ALTER TABLE users RENAME COLUMN college_id TO organization_id');
  }
}
for (const col of ['organization_id', 'date_of_birth']) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} ${col === 'organization_id' ? 'INTEGER' : 'TEXT'};`);
  }
}

// Teams (Sep 2026): travel programs group players into teams (14U Black,
// 16U, …). The organization is the master account; each team has its own
// signup code and its own coaches, who see only their team's players.
// Organization-level coaches (team_id NULL) see every team in the program.
db.exec(`CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);`);
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('team_id')) {
    db.exec('ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id);');
  }
}

// Pitchers + two-way players (Sep 2026): every player has a role — hitter,
// pitcher, or two_way. The users-side migration lives here (users table is
// created above); the checkins/pre_checkins column migrations live AFTER
// those tables are created, near the bottom of this file.
{
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('player_type')) {
    db.exec("ALTER TABLE users ADD COLUMN player_type TEXT NOT NULL DEFAULT 'hitter';");
  }
}

// User agreements (Sep 2026): Terms of Service + Privacy Policy acceptance at
// signup. Under-18 signups also record a parent/guardian name + email.
// Existing users are grandfathered — all columns are nullable.
for (const col of ['accepted_terms_at', 'terms_version', 'parent_name', 'parent_email']) {
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
}

// Verifiable parental consent for under-13 signups (Sep 2026, COPPA): the
// consent token's SHA-256 hash is stored on the user row; the raw token only
// ever appears in the email sent to the parent. All columns nullable.
for (const col of ['parent_consent_token_hash', 'parent_consent_sent_at', 'parent_consent_verified_at']) {
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
}

// Brain proposals (Sep 2026): Cam helps build Skip by proposing Brain entries,
// but nothing goes live until EVERY coach has approved it. The proposer
// auto-approves on submit; the other coach(es) approve from the Train Skip
// page. Publishing copies the proposal into skip_library as an active entry.
db.exec(`CREATE TABLE IF NOT EXISTS brain_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'rule',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS proposal_approvals (
  proposal_id INTEGER NOT NULL REFERENCES brain_proposals(id),
  coach_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, coach_id)
);`);

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
  skip_rated_at TEXT,
  session_kind TEXT NOT NULL DEFAULT 'hitting', -- hitting | pitching | combined
  pitch_session_type TEXT, -- bullpen | live | game | catch_play | recovery | no_throw
  intent TEXT, -- light | medium | heavy (throwing intent for the day)
  command INTEGER, -- 1-10 slider
  pitch_count INTEGER,
  pitches_thrown TEXT NOT NULL DEFAULT '[]', -- JSON array
  velo_max REAL,
  catch_distance TEXT,
  recovery_notes TEXT NOT NULL DEFAULT '',
  no_throw_note TEXT NOT NULL DEFAULT '',
  felt_good TEXT NOT NULL DEFAULT '',
  what_was_working TEXT NOT NULL DEFAULT '',
  biggest_struggle TEXT NOT NULL DEFAULT '',
  hitting_score REAL,
  pitching_score REAL
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
// Aliases: alternate names a remote hitter might sign up under
// ("Samuel Chapman" vs "Sam Chapman"). Newline-separated. Signup linking
// and the boot backfill match against these too.
{
  const cols = db.prepare('PRAGMA table_info(remote_programs)').all().map((c) => c.name);
  if (!cols.includes('aliases')) {
    db.exec("ALTER TABLE remote_programs ADD COLUMN aliases TEXT DEFAULT '';");
  }
  db.prepare(
    `UPDATE remote_programs SET aliases = 'Samuel Chapman'
     WHERE lower(athlete_name) = 'sam chapman' AND (aliases IS NULL OR aliases = '')`
  ).run();
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
          const title = [d.title, d.section || d.category].filter(Boolean).join(' \u2014 ');
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
  // One-time repair: Dylan's seed lost section names ("Day 1" x4 instead of
  // "Day 1 \u2014 Tee" etc.) because the normalizer ignored d.category.
  {
    const fs = require('fs');
    const path = require('path');
    try {
      const row = db
        .prepare("SELECT id, program_json FROM remote_programs WHERE lower(athlete_name) = 'dylan kakuda'")
        .get();
      if (row) {
        const seed = JSON.parse(
          fs.readFileSync(path.join(__dirname, 'seed_programs', 'dylan_kakuda.json'), 'utf8')
        );
        const seedDays = ((seed.program || seed).days || []);
        const prog = JSON.parse(row.program_json || '{}');
        const blocks = Array.isArray(prog.routine) ? prog.routine : [];
        // Only the day blocks are repaired (Daily Routine etc. are untouched).
        const dayIdx = [];
        for (let i = 0; i < blocks.length; i++) {
          if (/^Day \d+$/.test(String(blocks[i].category || '').trim())) dayIdx.push(i);
        }
        let untouched = dayIdx.length === seedDays.length && dayIdx.length > 0;
        if (untouched) {
          for (let k = 0; k < dayIdx.length; k++) {
            const a = (blocks[dayIdx[k]].items || []).map((it) => it.drill);
            const b = (seedDays[k].items || []).map((it) => it.drill);
            if (JSON.stringify(a) !== JSON.stringify(b)) { untouched = false; break; }
          }
        }
        if (untouched) {
          for (let k = 0; k < dayIdx.length; k++) {
            const sd = seedDays[k];
            const title = [sd.title, sd.section || sd.category].filter(Boolean).join(' \u2014 ');
            if (title) blocks[dayIdx[k]].category = title;
          }
          prog.routine = blocks;
          db.prepare('UPDATE remote_programs SET program_json = ? WHERE id = ?').run(JSON.stringify(prog), row.id);
        }
      }
    } catch (e) { /* leave the program as-is */ }
  }
  // One-time repair: standalone finisher sections ("Game Swings", "Open Angle")
  // fold into the section they follow — Bobby: they're part of that section's
  // work (Liam's Tee Work / Side Flips / Front Toss), not their own section.
  {
    try {
      const FINISHERS = new Set(['game swings', 'open angle']);
      const rows = db.prepare('SELECT id, athlete_name, program_json FROM remote_programs').all();
      for (const row of rows) {
        const prog = JSON.parse(row.program_json || '{}');
        const routine = Array.isArray(prog.routine) ? prog.routine : null;
        if (!routine) continue;
        let changed = false;
        const out = [];
        for (const c of routine) {
          const cat = String(c.category || '').trim();
          if (FINISHERS.has(cat.toLowerCase()) && out.length) {
            out[out.length - 1].items.push(...(c.items || []));
            changed = true;
          } else {
            out.push(c);
          }
        }
        if (changed) {
          prog.routine = out;
          db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(prog), new Date().toISOString(), row.id);
          console.log(`Folded finisher sections for ${row.athlete_name}.`);
        }
      }
    } catch (e) { /* leave the program as-is */ }
  }
  // Backfill: match accounts by full name, honoring aliases
  // (runs every boot; idempotent).
  const programs = db.prepare('SELECT id, athlete_name, aliases FROM remote_programs').all();
  const progForName = (name) => {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    for (const r of programs) {
      const names = [r.athlete_name, ...String(r.aliases || '').split('\n')]
        .map((x) => String(x).trim().toLowerCase())
        .filter(Boolean);
      if (names.includes(target)) return r.id;
    }
    return null;
  };
  const linkOne = db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?');
  for (const u of db
    .prepare(
      `SELECT id, first_name, last_name FROM users
       WHERE remote_program_id IS NULL AND role = 'athlete'`
    )
    .all()) {
    const pid = progForName((u.first_name || '') + ' ' + (u.last_name || ''));
    if (pid) linkOne.run(pid, u.id);
  }
}

// Video library: Bobby's "Atkinson Hitting Development System" Drive folder,
// synced in by the VM cron (see workspace/video-library-sync). Remote
// hitters only.
db.exec(`CREATE TABLE IF NOT EXISTS video_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_video_cat ON video_library(category, name);');
// Coach overrides: custom display names + hide from hitters. The Drive sync
// never touches these columns, so Bobby's edits survive every sync.
{
  const cols = db.prepare('PRAGMA table_info(video_library)').all().map((c) => c.name);
  if (!cols.includes('custom_name')) db.exec("ALTER TABLE video_library ADD COLUMN custom_name TEXT DEFAULT '';");
  if (!cols.includes('hidden')) db.exec('ALTER TABLE video_library ADD COLUMN hidden INTEGER DEFAULT 0;');
}
db.exec(`CREATE TABLE IF NOT EXISTS library_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);`);
function getLibrarySync(key) {
  const r = db.prepare('SELECT value FROM library_sync_state WHERE key = ?').get(key);
  return r ? r.value : '';
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
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS mental_baseline (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  pregame_routine TEXT NOT NULL DEFAULT '',
  morning_routine TEXT NOT NULL DEFAULT '',
  breath_work TEXT NOT NULL DEFAULT '',
  when_sped_up TEXT NOT NULL DEFAULT '',
  has_routine TEXT NOT NULL DEFAULT '',
  head_state TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
`);
{
  // Migrate older mental_baseline tables (created before the gauge questions + plan).
  const cols = db.prepare('PRAGMA table_info(mental_baseline)').all().map((c) => c.name);
  for (const c of ['has_routine', 'head_state', 'plan']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE mental_baseline ADD COLUMN ${c} TEXT NOT NULL DEFAULT '';`);
  }
}

// Mental keys (Sep 15 2026): things a hitter asks Coach Skip to save to their
// Mental Game tab from the chat ("add this to my mental game"). Shown on the
// Mental Game tab; hitters can delete them.
db.exec(`
CREATE TABLE IF NOT EXISTS mental_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mental_keys_user ON mental_keys(user_id, created_at);
`);

// Subscriptions (Sep 15 2026): account-level billing state lives here once
// payments launch. Settings reads it (plan + End subscription); the cancel
// route flips an active sub to canceled. No provider wired up yet.
db.exec(`
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'none',
  plan TEXT NOT NULL DEFAULT '',
  current_period_end TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
`);

// Pre-hit check-ins (Sep 2026): optional intent-setting BEFORE a session.
// kind: 'cage' (what he's working on + how) or 'game' (approach, one goal, flush).
// Skip reads today's intent and connects the post-session check-in back to it.
db.exec(`
CREATE TABLE IF NOT EXISTS pre_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'cage',
  focus TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  flush TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  throw_intent TEXT NOT NULL DEFAULT '',
  throw_focus TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_precheckins_user_time ON pre_checkins(user_id, created_at);
`);

// Pitchers + two-way players (Sep 2026): guarded migrations for databases
// created before these columns existed in the CREATE TABLEs above (e.g.
// production). Fresh boots get the columns from the schema itself.
{
  const ccols = db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name);
  const add = (col, def) => {
    if (!ccols.includes(col)) db.exec(`ALTER TABLE checkins ADD COLUMN ${col} ${def};`);
  };
  add('session_kind', "TEXT NOT NULL DEFAULT 'hitting'");
  add('pitch_session_type', 'TEXT');
  add('intent', 'TEXT');
  add('command', 'INTEGER');
  add('pitch_count', 'INTEGER');
  add('pitches_thrown', "TEXT NOT NULL DEFAULT '[]'");
  add('velo_max', 'REAL');
  add('catch_distance', 'TEXT');
  add('recovery_notes', "TEXT NOT NULL DEFAULT ''");
  add('no_throw_note', "TEXT NOT NULL DEFAULT ''");
  add('felt_good', "TEXT NOT NULL DEFAULT ''");
  add('what_was_working', "TEXT NOT NULL DEFAULT ''");
  add('biggest_struggle', "TEXT NOT NULL DEFAULT ''");
  add('hitting_score', 'REAL');
  add('pitching_score', 'REAL');
  const pcols = db.prepare('PRAGMA table_info(pre_checkins)').all().map((c) => c.name);
  if (!pcols.includes('throw_intent')) {
    db.exec("ALTER TABLE pre_checkins ADD COLUMN throw_intent TEXT NOT NULL DEFAULT '';");
  }
  if (!pcols.includes('throw_focus')) {
    db.exec("ALTER TABLE pre_checkins ADD COLUMN throw_focus TEXT NOT NULL DEFAULT '';");
  }
}

// Coach feed REMOVED Sep 15 2026 (Bobby: Learn tab is a personal notebook, no social layer).
// Drop the tables if a previous deploy created them.
db.exec(`DROP TABLE IF EXISTS post_reactions; DROP TABLE IF EXISTS coach_posts;`);

// One-time dedup (Sep 16 2026): Bobby reported repeat check-in rows caused
// by double-submits. Remove STRICT duplicates only: same user, created
// within 5 minutes of each other, and identical session content — every
// user-input field must match exactly. Hitters can legitimately log
// multiple real check-ins per day, so anything outside the window or
// differing in any field is kept. Keeps the earliest row (lowest id).
// No child tables reference checkins(id), so nothing else needs cleanup.
// Guarded by a settings flag so it runs once.
if (!db.prepare("SELECT value FROM settings WHERE key = 'checkin_dedup_20260916'").get()) {
  // Every user-input column on checkins. Excluded on purpose:
  // id/user_id/athlete_name/created_at (identity; time handled by the
  // 5-minute window below) and score_tier + skip_journal_* (derived fields
  // Skip backfills later — a scored row and its unscored twin are still
  // the same double-submit).
  const DEDUP_FIELDS = [
    'session_kind', 'pitch_session_type', 'intent', 'command', 'pitch_count',
    'pitches_thrown', 'velo_max', 'catch_distance', 'environment', 'difficulty',
    'feel', 'confidence', 'focus', 'session_score', 'drills_done',
    'session_notes', 'what_worked', 'whats_next', 'recovery_notes',
    'no_throw_note', 'felt_good', 'what_was_working', 'biggest_struggle',
    'hitting_score', 'pitching_score',
  ];
  const norm = (v) => (v === null || v === undefined ? '' : String(v));
  const keyOf = (r) => DEDUP_FIELDS.map((f) => norm(r[f])).join('');
  const rows = db.prepare('SELECT * FROM checkins ORDER BY user_id, created_at, id').all();
  const toDelete = [];
  const perUser = {};
  let keeper = null;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    const kt = keeper ? Date.parse(keeper.created_at) : NaN;
    const sameRun =
      keeper &&
      keeper.user_id === r.user_id &&
      !Number.isNaN(t) &&
      !Number.isNaN(kt) &&
      t - kt <= 5 * 60 * 1000 &&
      keyOf(keeper) === keyOf(r);
    if (sameRun) {
      toDelete.push(r.id);
      perUser[r.user_id] = (perUser[r.user_id] || 0) + 1;
    } else {
      keeper = r;
    }
  }
  if (toDelete.length) {
    const ph = toDelete.map(() => '?').join(',');
    db.prepare(`DELETE FROM checkins WHERE id IN (${ph})`).run(...toDelete);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('checkin_dedup_20260916', ?)").run(String(toDelete.length));
  const who = db.prepare('SELECT id, email, first_name, last_name FROM users').all();
  const nameOf = (id) => {
    const u = who.find((x) => x.id === id);
    return u ? `${u.first_name || ''} ${u.last_name || ''} <${u.email}>`.trim() : `user ${id}`;
  };
  const detail = Object.entries(perUser)
    .map(([id, n]) => `${nameOf(Number(id))}: ${n}`)
    .join('; ');
  console.log(`CHECKIN DEDUP: removed ${toDelete.length} duplicate check-in row(s)${detail ? ` — ${detail}` : ''}`);
}

module.exports = db;
