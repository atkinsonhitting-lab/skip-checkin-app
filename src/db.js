// Skip database: users, check-ins, and express-session storage.
// Uses Node's built-in node:sqlite (Node 24+) — no native dependencies.
// DB_PATH env var overrides the default ./skip.db location.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const videoLinks = require('./video_links');

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
  created_at TEXT NOT NULL,
  notify_on_checkin INTEGER
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

// Per-player check-in log alerts (Sep 17 2026, Bobby): tri-state.
// 1 = always notify, 0 = never notify, NULL = default rule (notify only for
// his program players). Nullable on purpose — NULL means "not chosen".
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('notify_on_checkin')) {
    db.exec('ALTER TABLE users ADD COLUMN notify_on_checkin INTEGER;');
  }
}

// Bible study opt-in (Sep 23 2026, Bobby): tri-state.
// 1 = wants the daily Bible study, 0 = declined, NULL = not asked yet (the
// opt-in popup shows on app open while NULL).
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('bible_study')) {
    db.exec('ALTER TABLE users ADD COLUMN bible_study INTEGER;');
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

// "My Players" (Sep 17 2026): is_mine=1 marks Bobby's own programs. The
// My Players tab lists athletes in is_mine orgs; colleges/travel programs
// Bobby sells to stay is_mine=0 and only show under All Players.
{
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map((c) => c.name);
  if (!cols.includes('is_mine')) db.exec('ALTER TABLE organizations ADD COLUMN is_mine INTEGER NOT NULL DEFAULT 0;');
}

// Coach/player messaging (Sep 17 2026, revised): 1:1 + broadcasts with a
// player inbox. recipient_id NULL = broadcast to Bobby's players;
// message_recipients materializes the audience at send time so read state
// is per-recipient.
db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  recipient_id INTEGER,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
// Video/photo attachments on messages (Sep 23 2026): remote guys send Bobby
// swing clips through the app. Stored on disk for now; move to R2 when volume grows.
{
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('attachment_path')) db.exec(`ALTER TABLE messages ADD COLUMN attachment_path TEXT NOT NULL DEFAULT ''`);
  if (!cols.includes('attachment_type')) db.exec(`ALTER TABLE messages ADD COLUMN attachment_type TEXT NOT NULL DEFAULT ''`);
}
db.exec(`CREATE TABLE IF NOT EXISTS message_recipients (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_at TEXT,
  PRIMARY KEY(message_id, user_id)
)`);
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
// Liability waiver (Sep 2026): athletes with a program sign before they can
// open it. waiver_signed_at is an ISO timestamp; waiver_version pins the exact
// text they agreed to; waiver_parent_name holds the co-signing parent/guardian
// for athletes under 18.
for (const col of ['waiver_signed_at', 'waiver_name', 'waiver_parent_name', 'waiver_version']) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
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
// The 4 program files were built at different times with different
// shapes — normalize to one canonical shape on the way in.
function normalizeSeedProgram(raw) {
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
  // Attach video links from Bobby's drill registry on the way in
  // (YouTube for mobility/med-ball, Drive library for hitting/prep).
  // The video library is empty on a fresh seed, so only the registry
  // matches here; the library sync auto-links the rest later.
  try { videoLinks.attachVideoLinks(p, []); } catch (e) { /* registry missing */ }
  if (!p.grades || typeof p.grades !== 'object') p.grades = {};
  if (!Array.isArray(p.strengths)) p.strengths = [];
  if (!p.cues || typeof p.cues !== 'object') p.cues = { movement: '', timing: '', game: '' };
  return p;
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
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const prog = normalizeSeedProgram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        const name = String(prog.athlete || f.replace(/\.json$/, '')).trim();
        if (name) ins.run(name, JSON.stringify(prog), new Date().toISOString());
      } catch (e) { console.warn('program seed skipped', f, e.message); }
    }
  }
  // Repair (Sep 23 2026): one of the 4 founder programs (Ryan Seddon's) went
  // missing from the DB. Re-insert any founder program that has no row —
  // from the bundled seed — without touching the ones Bobby customized.
  {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, 'seed_programs');
    const have = new Set(
      db.prepare('SELECT athlete_name FROM remote_programs').all()
        .map((r) => String(r.athlete_name || '').trim().toLowerCase())
    );
    const ins = db.prepare(
      'INSERT INTO remote_programs (athlete_name, program_json, updated_at) VALUES (?, ?, ?)'
    );
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const prog = normalizeSeedProgram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        const name = String(prog.athlete || f.replace(/\.json$/, '')).trim();
        if (name && !have.has(name.toLowerCase())) {
          ins.run(name, JSON.stringify(prog), new Date().toISOString());
          have.add(name.toLowerCase());
          console.log(`Restored missing remote program for ${name}.`);
        }
      } catch (e) { console.warn('program restore skipped', f, e.message); }
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
  // One-time: seed empty program schedules from the sheet-synced seed JSONs
  // (carries Sam's Day 1 = Monday etc. over), then never again — the app DB
  // is the source of truth and Bobby edits schedules in the coach editor.
  // Guarded by a settings flag so his in-app edits are never overwritten.
  {
    const fs = require('fs');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\');');
      const done = db.prepare("SELECT value FROM settings WHERE key = 'schedule_seed_v1'").get();
      if (!done) {
        const rows = db.prepare('SELECT id, athlete_name, program_json FROM remote_programs').all();
        for (const row of rows) {
          let prog = {};
          try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
          const sched = Array.isArray(prog.schedule) ? prog.schedule : [];
          const hasSched = sched.some((s) => {
            const label = Array.isArray(s) ? s[1] : (s && (s.day_label || s.label));
            return String(label || '').trim();
          });
          if (hasSched) continue;
          const seedFile = String(row.athlete_name || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '') + '.json';
          const fp = path.join(__dirname, 'seed_programs', seedFile);
          if (!fs.existsSync(fp)) continue;
          const seed = JSON.parse(fs.readFileSync(fp, 'utf8'));
          if (Array.isArray(seed.schedule) && seed.schedule.length) {
            prog.schedule = seed.schedule;
            db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(prog), new Date().toISOString(), row.id);
            console.log(`Schedule seeded for ${row.athlete_name}.`);
          }
        }
        db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_seed_v1', '1')").run();
      }
    } catch (e) { console.warn('schedule seed skipped', e.message); }
  }
  // One-time: attach video links to program items from Bobby's drill registry
  // + the synced video library. Only fills items with no link and no manual
  // decision; his in-app edits always win. Guarded by a settings flag; the
  // library sync re-runs auto-linking on every sync after this.
  // v2 (Sep 23 2026): the registry gained the mobility YouTube links and
  // dropped the wrong Banded Loads/Turns video AFTER v1 ran, so v1 left
  // items unlinked. Re-run once — still only fills blanks, never overrides.
  {
    try {
      db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\');');
      const done = db.prepare("SELECT value FROM settings WHERE key = 'video_links_v2'").get();
      if (!done) {
        const r = videoLinks.autoLinkAllPrograms(db, videoLinks.getLibraryRows(db));
        console.log(`Video links attached (v2): ${r.linked} items across ${r.programs} programs.`);
        db.prepare("INSERT INTO settings (key, value) VALUES ('video_links_v2', '1')").run();
      }
    } catch (e) { console.warn('video link migration skipped', e.message); }
  }
  // Cleanup (Sep 23 2026): Bobby rejected the old Banded Loads/Turns video
  // mapping (it was a generic "resistance band hitting drills" video, not a
  // Banded Loads demo) and the mapping is gone from the registry. Clear any
  // stale AUTO-linked copies of that URL still stored on program items —
  // manual links are never touched.
  {
    try {
      const bad = 'https://www.youtube.com/watch?v=k1XTovi8X6s';
      const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
      const upd = db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        let prog;
        try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
        let changed = false;
        for (const c of (Array.isArray(prog.routine) ? prog.routine : [])) {
          for (const it of (c && c.items) || []) {
            if (it && it.video === bad && it.video_source !== 'manual') {
              it.video = '';
              changed = true;
            }
          }
        }
        if (changed) upd.run(JSON.stringify(prog), new Date().toISOString(), row.id);
      }
    } catch (e) { /* best effort */ }
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

// ---- Lifting programs (Sep 2026) ----
// Bobby writes lifting programs for his remote/hybrid guys. Templates are
// reusable starters he assigns to an athlete (assign = private copy, so
// tweaks for one guy never touch the template or another guy's program).
// Athletes see their lifting program as the LIFTING sub-tab of Programs,
// log weight + RPE per exercise, and get "last time" + history per exercise.
db.exec(`CREATE TABLE IF NOT EXISTS lifting_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 0,
  program_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);`);
// Which lifting program an athlete's remote program points at (NULL = none).
{
  const cols = db.prepare('PRAGMA table_info(remote_programs)').all().map((c) => c.name);
  if (!cols.includes('lifting_program_id')) {
    db.exec('ALTER TABLE remote_programs ADD COLUMN lifting_program_id INTEGER;');
  }
}
// Daily check-offs + lift logging. One row per athlete/day/item; weight and
// rpe are only used for lifting exercises (kind='lift').
db.exec(`CREATE TABLE IF NOT EXISTS program_checkoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  weight REAL,
  rpe INTEGER,
  created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, day, item_key)
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_checkoffs_user_key ON program_checkoffs(user_id, item_key, day);');
// Hevy-style per-set logging (Sep 2026): sets_json holds
// [{w: lbs, r: reps, done: 0/1}, ...] for kind='lift' rows.
{
  const cols = db.prepare('PRAGMA table_info(program_checkoffs)').all().map((c) => c.name);
  if (!cols.includes('sets_json')) db.exec('ALTER TABLE program_checkoffs ADD COLUMN sets_json TEXT;');
}
// Coach-editable intake questions (Sep 2026): Bobby's own custom questions,
// appended to the intake questionnaire. Core questions stay fixed (they
// drive draft program generation); these are informational for his review.
db.exec(`CREATE TABLE IF NOT EXISTS intake_custom_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options_json TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);`);
// Bobby's rule (Sep 2026): no static stretching, ever. Strip the banned
// template stretches from existing programs' mobility blocks. Runs once.
{
  // Defensive: the canonical settings table is created further down in this
  // file, so make sure it exists before this migration touches it.
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');");
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration_no_static_stretch'").get();
  if (!flag) {
    const banned = ['pigeon stretch', 'half-kneeling hip flexor stretch', 'deep squat hold w/ elbow press', 'sleeper stretch', 'cross-body shoulder stretch', 'half-kneeling calf stretch'];
    let cleaned = 0;
    try {
      const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
      for (const row of rows) {
        let prog;
        try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
        let changed = false;
        const blocks = Array.isArray(prog.routine) ? prog.routine : [];
        for (const b of blocks) {
          const cat = String(b.category || '');
          if (!/^mobility/i.test(cat) || !Array.isArray(b.items)) continue;
          const before = b.items.length;
          b.items = b.items.filter((it) => !banned.includes(String(it.drill || it.name || '').toLowerCase().trim()));
          if (b.items.length !== before) { changed = true; cleaned += before - b.items.length; }
        }
        if (changed) {
          db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(prog), new Date().toISOString(), row.id);
        }
      }
    } catch (e) { /* best effort */ }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_no_static_stretch', ?)").run(String(cleaned));
  }
}
// Bobby's rule (Sep 2026): med ball work links to YouTube, never the in-app
// drill library. Re-point auto-linked med ball items at his YouTube registry
// links. Runs once; manual links are never touched.
{
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration_medball_youtube'").get();
  if (!flag) {
    let fixed = 0;
    try {
      const vl = require('./video_links');
      const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
      const upd = db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        let prog;
        try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
        const n = vl.repairMedBallLinks(prog);
        if (n > 0) {
          upd.run(JSON.stringify(prog), new Date().toISOString(), row.id);
          fixed += n;
        }
      }
    } catch (e) { /* best effort */ }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_medball_youtube', ?)").run(String(fixed));
  }
}
// v2 (Sep 23 2026): the med-ball YouTube links landed in the registry AFTER
// v1 ran, so v1 re-pointed nothing. Re-run the repair, and purge any
// auto-linked NON-YouTube (Drive/library) video from med-ball items —
// Bobby's rule is YouTube-only for med ball, and the fuzzy matcher had
// attached the "Med Ball Drill" hitting video to real throws. Manual links
// are never touched; items with no registry match are left blank (no guess).
{
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migration_medball_youtube_v2'").get();
  if (!flag) {
    let fixed = 0;
    let purged = 0;
    try {
      const vl = require('./video_links');
      const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
      const upd = db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        let prog;
        try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
        let changed = false;
        const n1 = vl.repairMedBallLinks(prog);
        if (n1 > 0) { fixed += n1; changed = true; }
        const blocks = Array.isArray(prog.routine) ? prog.routine : [];
        for (const c of blocks) {
          if (!/med\s*ball/i.test(String((c && c.category) || ''))) continue;
          for (const it of (c && c.items) || []) {
            if (!it || it.video_source === 'manual' || !it.video) continue;
            const isYT = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(it.video);
            if (!isYT) {
              it.video = '';
              purged++;
              changed = true;
            }
          }
        }
        if (changed) upd.run(JSON.stringify(prog), new Date().toISOString(), row.id);
      }
    } catch (e) { /* best effort */ }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_medball_youtube_v2', ?)").run(`${fixed}f/${purged}p`);
  }
  // Bobby's rule (Sep 23 2026): lifting, mobility, and med ball are ALL
  // YouTube videos — never the Drive library. Repair mobility + recovery
  // items that were auto-linked to Drive videos: re-point at the YouTube
  // registry where it has them, clear the rest. Manual links never touched.
  // Then fill any blanks from the registry (YouTube only for these blocks).
  const mflag = db.prepare("SELECT value FROM settings WHERE key = 'migration_mobility_youtube'").get();
  if (!mflag) {
    let fixed = 0;
    let purged = 0;
    let relinked = 0;
    try {
      const vl = require('./video_links');
      const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
      const upd = db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        let prog;
        try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { continue; }
        let changed = false;
        const r = vl.repairMobilityLinks(prog);
        if (r.fixed > 0 || r.purged > 0) { fixed += r.fixed; purged += r.purged; changed = true; }
        const n = vl.attachVideoLinks(prog, []);
        if (n > 0) { relinked += n; changed = true; }
        if (changed) upd.run(JSON.stringify(prog), new Date().toISOString(), row.id);
      }
    } catch (e) { /* best effort */ }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_mobility_youtube', ?)").run(`${fixed}f/${purged}p/${relinked}r`);
  }
}
// NOTE: starter lifting templates are seeded after the settings table is
// created below (guarded by a settings flag).

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

// Website application leads (Sep 2026): the short public application form on
// the sales website POSTs to /api/leads. Separate from the full intake
// questionnaire, which stays behind Bobby's link post-call. Statuses:
// new -> contacted -> enrolled (or archived).
db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  age_level TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_submitted ON leads(submitted_at);
`);
// The sales-site application form collects which program the visitor wants
// (Regular / Complete, Remote / Hybrid). /api/leads silently dropped it;
// the public intake endpoint stores it. Guarded for existing databases.
{
  const cols = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
  if (!cols.includes('program_interest')) {
    db.exec("ALTER TABLE leads ADD COLUMN program_interest TEXT NOT NULL DEFAULT '';");
  }
}

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

// Starter lifting templates (Sep 2026): seeded once, guarded by a settings
// flag so a deleted template is never resurrected and Bobby's in-app edits
// are never overwritten.
{
  let seeded = null;
  try { seeded = db.prepare("SELECT value FROM settings WHERE key = 'lifting_templates_seeded'").get(); } catch (e) { /* table just created */ }
  // Lifting rebuild v2 (Sep 23 2026, Bobby): every day flows Speed →
  // Med Ball → Lifts. No standalone Metabolic section, no static stretching,
  // no hitting drills, no hang/power cleans. Every exercise carries a
  // verified YouTube demo link (verified via oEmbed Sep 23 2026).
  const YT = {
    sprint10: 'https://www.youtube.com/watch?v=aLzKKgrZI30',
    flying10: 'https://www.youtube.com/shorts/MiS6sNYial8',
    sprint20: 'https://www.youtube.com/watch?v=wHDGKBJEnOQ',
    agility545: 'https://www.youtube.com/watch?v=tYhCJd7LaBU',
    mbRot: 'https://www.youtube.com/watch?v=l2R7f3r1228',
    mbSlam: 'https://www.youtube.com/watch?v=EsAhU1jHpiQ',
    mbScoop: 'https://www.youtube.com/watch?v=KT7iAYA3g7Y',
    mbShotput: 'https://www.youtube.com/watch?v=EXV9UhUMTiY',
    trapbar: 'https://www.youtube.com/watch?v=dfYIApfWS5o',
    dbBench: 'https://www.youtube.com/watch?v=xhEhjF5ozuY',
    csRow: 'https://www.youtube.com/watch?v=kNvy2_9Ji2w',
    pallof: 'https://www.youtube.com/watch?v=YI4Yewxn_sg',
    frontSquat: 'https://www.youtube.com/watch?v=Q1R0_CbgHpc',
    ohp: 'https://www.youtube.com/watch?v=S3kYKH32VqI',
    latPull: 'https://www.youtube.com/watch?v=FDtwvLNjSYs',
    farmers: 'https://www.youtube.com/watch?v=8OtwXwrJizk',
    bbBench: 'https://www.youtube.com/watch?v=ejI1Nlsul9k',
    bbRow: 'https://www.youtube.com/watch?v=Ola0WMb0mXc',
    dbOhp: 'https://www.youtube.com/watch?v=9Uj1LL-rvF8',
    facePull: 'https://www.youtube.com/watch?v=sd4W2lFmIMM',
    backSquat: 'https://www.youtube.com/watch?v=rrJIyZGlK8c',
    rdl: 'https://www.youtube.com/watch?v=5bJEigM5iVg',
    bulgarian: 'https://www.youtube.com/watch?v=je7lk51Vl8c',
    kneeRaise: 'https://www.youtube.com/watch?v=dDd2gMmbWJU',
  };
  const spd = (name, volume, notes, video) => ({ name, volume, notes: notes || '', video: video || '' });
  const ex = (name, sets, reps, target_rpe, notes, video) => ({
    name, sets: String(sets), reps: String(reps), target_rpe: target_rpe || '', notes: notes || '', video: video || '',
  });
  const LIFTING_TEMPLATES_V2 = [
    {
      name: 'Full-Body A/B',
      days: [
        { label: 'Day A',
          speed: [
            spd('10-Yard Sprint', '6 x 10 yd', 'Explode out — walk-back recovery', YT.sprint10),
            spd('Flying 10 Sprint', '4 x flying 10', 'Build up, then max speed — full recovery', YT.flying10),
          ],
          medball: [
            spd('Med Ball Rotational Throw', '3 x 6 each side', 'Explode through the hips', YT.mbRot),
            spd('Med Ball Overhead Slam', '3 x 8', 'All out, every rep', YT.mbSlam),
          ],
          exercises: [
            ex('Trap Bar Deadlift', '4', '5', 8, 'Hinge, brace, drive the floor away', YT.trapbar),
            ex('DB Bench Press', '3', '8', 7, '', YT.dbBench),
            ex('Chest-Supported DB Row', '3', '10', 7, '', YT.csRow),
            ex('Pallof Press', '3', '10 each side', 6, '', YT.pallof),
          ]},
        { label: 'Day B',
          speed: [
            spd('20-Yard Sprint', '5 x 20 yd', 'Stay tall, drive — walk-back recovery', YT.sprint20),
            spd('5-10-5 Pro Agility', '4 reps', 'Full recovery between reps', YT.agility545),
          ],
          medball: [
            spd('Med Ball Scoop Toss', '3 x 6', 'Triple extension — throw it far', YT.mbScoop),
            spd('Med Ball Shotput Throw', '3 x 6 each side', 'Punch through the throw', YT.mbShotput),
          ],
          exercises: [
            ex('Front Squat', '4', '6', 8, 'Elbows high, knees forward', YT.frontSquat),
            ex('Overhead Press', '3', '8', 7, '', YT.ohp),
            ex('Lat Pulldown', '3', '10', 7, '', YT.latPull),
            ex("Farmer's Carry", '3', '40 yards', 6, 'Heavy — stand tall', YT.farmers),
          ]},
      ],
    },
    {
      name: 'Upper / Lower',
      days: [
        { label: 'Upper',
          speed: [
            spd('10-Yard Sprint', '6 x 10 yd', 'Explode out — walk-back recovery', YT.sprint10),
          ],
          medball: [
            spd('Med Ball Rotational Throw', '3 x 6 each side', 'Explode through the hips', YT.mbRot),
            spd('Med Ball Overhead Slam', '3 x 8', 'All out, every rep', YT.mbSlam),
          ],
          exercises: [
            ex('Bench Press', '4', '6', 8, '', YT.bbBench),
            ex('Bent-Over Row', '4', '8', 8, 'Chest over the plate', YT.bbRow),
            ex('DB Overhead Press', '3', '10', 7, '', YT.dbOhp),
            ex('Face Pull', '3', '12', 6, '', YT.facePull),
          ]},
        { label: 'Lower',
          speed: [
            spd('20-Yard Sprint', '5 x 20 yd', 'Stay tall, drive — walk-back recovery', YT.sprint20),
            spd('Flying 10 Sprint', '4 x flying 10', 'Build up, then max speed — full recovery', YT.flying10),
          ],
          medball: [
            spd('Med Ball Scoop Toss', '3 x 6', 'Triple extension — throw it far', YT.mbScoop),
            spd('Med Ball Shotput Throw', '3 x 6 each side', 'Punch through the throw', YT.mbShotput),
          ],
          exercises: [
            ex('Back Squat', '4', '6', 8, '', YT.backSquat),
            ex('Romanian Deadlift', '3', '8', 7, 'Feel the hamstrings load', YT.rdl),
            ex('Bulgarian Split Squat', '3', '10 each', 7, '', YT.bulgarian),
            ex('Hanging Knee Raise', '3', '12', 6, '', YT.kneeRaise),
          ]},
      ],
    },
  ];
  const buildTemplateJson = (t) => JSON.stringify({ days: t.days, notes: [] });
  if (!seeded) {
    const now = new Date().toISOString();
    const ins = db.prepare(
      'INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, 1, ?, ?)'
    );
    for (const t of LIFTING_TEMPLATES_V2) ins.run(t.name, buildTemplateJson(t), now);
    db.prepare("INSERT INTO settings (key, value) VALUES ('lifting_templates_seeded', '1')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('lifting_rebuild_v2', '1')").run();
    console.log('Seeded lifting templates: Full-Body A/B, Upper / Lower.');
  } else {
    // Rebuild legacy templates still on the old shape (lifts only, no video
    // links, no speed/med-ball blocks). Templates Bobby already customized
    // with the new fields are left alone.
    const done = db.prepare("SELECT value FROM settings WHERE key = 'lifting_rebuild_v2'").get();
    if (!done) {
      const now = new Date().toISOString();
      const tpls = db.prepare('SELECT * FROM lifting_programs WHERE is_template = 1').all();
      let rebuilt = 0;
      for (const tpl of tpls) {
        let p = {};
        try { p = JSON.parse(tpl.program_json || '{}'); } catch (e) {}
        const days = Array.isArray(p.days) ? p.days : [];
        const isLegacy = days.length && days.every((d) =>
          !(d.speed && d.speed.length) && !(d.medball && d.medball.length) &&
          (d.exercises || []).every((e) => !e.video));
        const match = LIFTING_TEMPLATES_V2.find((t) => t.name === tpl.name);
        if (isLegacy && match) {
          db.prepare('UPDATE lifting_programs SET program_json = ?, updated_at = ? WHERE id = ?')
            .run(buildTemplateJson(match), now, tpl.id);
          rebuilt++;
        }
      }
      db.prepare("INSERT INTO settings (key, value) VALUES ('lifting_rebuild_v2', '1')").run();
      console.log('Lifting rebuild v2: rebuilt ' + rebuilt + ' template(s).');
    }
  }

  // Lifting rebuild v3 (Sep 23 2026, Bobby's Different Animal method): the
  // v2 templates were generic. These follow his actual system — Kelly's
  // 4-day offseason split, 2-day in-season maintenance, contrast pairings
  // (heavy → explosive, same plane, ~3-min rest), triphasic tempo, monthly
  // Absorb → Produce → Express blocks, test/retest every 2 weeks.
  // Every video link verified via oEmbed Sep 23 2026; exercises without a
  // verified demo carry no video rather than a wrong one.
  Object.assign(YT, {
    plyoPushup: 'https://www.youtube.com/watch?v=hDP-oskzYUs',
    saRow: 'https://www.youtube.com/watch?v=BPi7PYlWPos',
    cableRot: 'https://www.youtube.com/watch?v=he4IhLc1d5k',
    trapJump: 'https://www.youtube.com/watch?v=QsuwFIcQ440',
    nordic: 'https://www.youtube.com/watch?v=HrOhaEnwDQY',
    landmine: 'https://www.youtube.com/watch?v=7UHzSSqlC7w',
    broadJump: 'https://www.youtube.com/watch?v=uhz-ia-2UcM',
    pushPress: 'https://www.youtube.com/watch?v=yklSQG1_Ovc',
  });
  const LIFTING_TEMPLATES_V3 = [
    {
      name: 'Offseason 4-Day — Kelly Split',
      notes: [
        'Triphasic month: Absorb → Produce → Express. Test/retest every 2 weeks.',
        'Contrast pairings: heavy lift → explosive same-plane movement, ~3 min rest.',
        'Stop explosive work when rep quality drops.',
      ],
      days: [
        { label: 'Day 1 — Upper: Horiz Press + Vert Pull',
          medball: [
            spd('MB Shot-Put Throw', '4 x 5', 'Max intent, every throw', YT.mbShotput),
          ],
          exercises: [
            ex('Plyo Push-Up', '3', '5', 8, 'CONTRAST with DB bench press — 3 min rest', YT.plyoPushup),
            ex('DB Bench Press', '4', '6', 8, 'Triphasic tempo. CONTRAST: bench → plyo push-up', YT.dbBench),
            ex('DB Single-Arm Row', '4', '6 each side', 8, '', YT.saRow),
            ex('Cable Rotation', '3', '5 each side', 8, 'Max intent — rotate through the hips', YT.cableRot),
            ex('Pallof Press', '3', '10 each side', 6, '', YT.pallof),
          ]},
        { label: 'Day 2 — Bilateral Lower',
          speed: [
            spd('10-Yard Sprint', '3 x 10 yd', 'Explode out — full recovery', YT.sprint10),
            spd('Trap-Bar Jump', '4 x 5 @ ~50% BW', 'Max intent. CONTRAST after deadlift — 3 min rest', YT.trapJump),
          ],
          exercises: [
            ex('Trap-Bar Deadlift', '3', '3 @ 85–90%', 9, 'Triphasic tempo. CONTRAST: deadlift → trap-bar jump', YT.trapbar),
            ex('Nordic Curl', '3', '5', 8, 'Slow eccentrics — control the way down', YT.nordic),
            ex('Lateral Box Squat', '3', '5–8 each side', 7, '', ''),
          ]},
        { label: 'Day 3 — Upper: Horiz Pull + Vert Press',
          medball: [
            spd('MB Rotational Throw', '4 x 5', 'Max intent, every throw', YT.mbRot),
          ],
          exercises: [
            ex('Single-Arm Landmine Press', '4', '5 each side', 8, 'Explosive press', YT.landmine),
            ex('DB Single-Arm Row', '4', '6 each side', 8, 'Triphasic tempo', YT.saRow),
            ex('DB Shoulder Press', '3', '6', 8, 'Triphasic tempo', YT.dbOhp),
            ex('DB Rear-Lateral Raise', '3', '8–10', 7, '', ''),
            ex('Pallof Hold', '3', '15 sec each side', 7, 'Max weight you can hold with perfect posture', ''),
          ]},
        { label: 'Day 4 — Unilateral Lower (alone on purpose)',
          speed: [
            spd('Drop-Catch Split Jump', '3 x 5', 'Max intent — stick the landing', ''),
          ],
          exercises: [
            ex('Split-Squat ISO Pull', '3', '5 each side', 7, 'Potentiation primer before Bulgarians', ''),
            ex('Bulgarian Split Squat', '3', '6 each leg', 8, 'Month 1: 3-sec down. Months 2–3 CONTRAST: Bulgarian → drop-catch split jump', YT.bulgarian),
            ex('Pin Split Squat', '3', '5 each leg @ challenging load', 8, '', ''),
            ex('Nordic Curl', '3', '5', 8, 'Slow eccentrics', YT.nordic),
            ex('DB Trunk Rotation', '3', '8 each side', 7, 'Build the brakes — control the rotation', ''),
          ]},
      ],
    },
    {
      name: 'In-Season 2-Day Maintenance',
      notes: [
        'In-season floor: keep 1 high-quality lift per week minimum. Cut volume, never intensity.',
        'Remove excess work when games pile up. No "easy J-band only" maintenance.',
      ],
      days: [
        { label: 'Day 1 — Lower + Acceleration',
          speed: [
            spd('10-Yard Sprint', '3 x 10 yd', 'Explode out — full recovery', YT.sprint10),
            spd('Broad Jump', '3 x 3', 'Max horizontal power — stick the landing', YT.broadJump),
          ],
          exercises: [
            ex('Pin Squat', '3', '2 @ 85–90%', 9, 'Move the bar fast', ''),
            ex('Split Squat', '3', '3 @ 85%', 8, '', ''),
            ex('Cable Rotation', '2', '5 each side', 7, '', YT.cableRot),
            ex('Cossack Squat', '2', '5 each side', 6, '', ''),
            ex('Hamstring Bridge ISO', '2', '20 sec', 6, '', ''),
          ]},
        { label: 'Day 2 — Upper + Top Speed',
          speed: [
            spd('Curved Sprint', '3 reps', 'Lean into the curve — full recovery', ''),
          ],
          exercises: [
            ex('Push Press', '3', '2 @ 85–90%', 9, 'Leg drive, fast hands', YT.pushPress),
            ex('Bench Press', '4', '3 @ 85%', 8, '', YT.bbBench),
            ex('ITY', '2', '8', 6, 'Shoulder health — light and clean', ''),
            ex('Bear Crawl', '2', '20 yards', 6, '', ''),
            ex('Deep-Range Pullover', '2', '8', 6, '', ''),
          ]},
      ],
    },
  ];
  const buildTemplateJsonV3 = (t) => JSON.stringify({ days: t.days, notes: t.notes || [] });
  {
    const done = db.prepare("SELECT value FROM settings WHERE key = 'lifting_rebuild_v3'").get();
    if (!done) {
      const now = new Date().toISOString();
      // Remove the generic v2 templates — but ONLY if Bobby never touched
      // them (byte-identical to what v2 generated). His customizations stay.
      let removed = 0;
      for (const old of LIFTING_TEMPLATES_V2) {
        const row = db.prepare('SELECT * FROM lifting_programs WHERE name = ? AND is_template = 1').get(old.name);
        if (!row) continue;
        let days = null;
        try { days = JSON.parse(row.program_json || '{}').days; } catch (e) {}
        if (days && JSON.stringify(days) === JSON.stringify(old.days)) {
          db.prepare('DELETE FROM lifting_programs WHERE id = ?').run(row.id);
          removed++;
        }
      }
      // Insert the method templates (skip any name Bobby already has).
      let added = 0;
      for (const t of LIFTING_TEMPLATES_V3) {
        const exists = db.prepare('SELECT id FROM lifting_programs WHERE name = ? AND is_template = 1').get(t.name);
        if (!exists) {
          db.prepare('INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, 1, ?, ?)')
            .run(t.name, buildTemplateJsonV3(t), now);
          added++;
        }
      }
      db.prepare("INSERT INTO settings (key, value) VALUES ('lifting_rebuild_v3', '1')").run();
      console.log(`Lifting rebuild v3: removed ${removed} generic template(s), added ${added} method template(s).`);
    }
  }
}

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
-- Skip's read: cached pattern notes at the top of the Notebook (Sep 23 2026).
-- Regenerated when the check-in count changes.
CREATE TABLE IF NOT EXISTS notebook_reads (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  generated_at TEXT NOT NULL,
  checkin_count INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '{}'
);
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
  // Book-based questionnaire rebuild (Sep 23 2026): new diagnostic columns.
  // signal_light (Ravizza): green/yellow/red. worst_self_talk (Dorfman/Mack):
  // the actual sentence. struggle_pattern (Dorfman): expecting_results /
  // thinking_mechanics / worried_watching / blank. big_moment_mode (Grover):
  // attacking / hoping / depends. hard_voice (Goggins): what the governor says.
  for (const c of ['signal_light', 'worst_self_talk', 'struggle_pattern', 'big_moment_mode', 'hard_voice']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE mental_baseline ADD COLUMN ${c} TEXT NOT NULL DEFAULT '';`);
  }
  // Individualization fields (Sep 23 2026): between_pitches (Ravizza 15 sec),
  // keyword (Mack reset word), best_game (Goggins cookie jar evidence),
  // visualization (Mack/Holiday picturing), confidence_source (Dorfman),
  // post_game (Goggins AAR pattern), focus_pull (distractions).
  for (const c of ['between_pitches', 'keyword', 'best_game', 'visualization', 'confidence_source', 'post_game', 'focus_pull']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE mental_baseline ADD COLUMN ${c} TEXT NOT NULL DEFAULT '';`);
  }
}
// Daily mental exercise completions (Sep 23 2026): one concrete exercise per
// day from the book frameworks. exercise_key like '2026-09-23:good-wolf'.
db.exec(`CREATE TABLE IF NOT EXISTS mental_daily_done (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  exercise_key TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, day)
);`);
// Lock In card completions (Sep 23 2026): routine / bible cards, one per day.
db.exec(`CREATE TABLE IF NOT EXISTS mental_card_done (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  card TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, day, card)
);`);
// Structured routines (Sep 23 2026): morning / pre-practice / pregame as JSON
// step lists. Bible study auto-included in morning routine for opt-ins.
db.exec(`CREATE TABLE IF NOT EXISTS mental_routines (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  morning_json TEXT NOT NULL DEFAULT '[]',
  prepractice_json TEXT NOT NULL DEFAULT '[]',
  pregame_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT ''
);`);

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

// Mental-game questionnaire v2 (Sep 23 2026, Bobby): coach-editable questions.
// Bobby edits the questions; the athlete form renders from this table.
db.exec(`CREATE TABLE IF NOT EXISTS mental_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qkey TEXT NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  qtype TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);`);
db.exec(`CREATE TABLE IF NOT EXISTS mental_answers (
  user_id INTEGER NOT NULL REFERENCES users(id),
  qkey TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, qkey)
);`);
{
  // Seed the questionnaire once (the original 13 book-based questions).
  const n = db.prepare('SELECT COUNT(*) AS n FROM mental_questions').get().n;
  if (!n) {
    const seed = [
      ['signal_light', 'In games, what color are you usually?', "Ravizza's signal lights", 'radio',
        '[["green","Green \u2014 calm, focused"],["yellow","Yellow \u2014 tension creeping in"],["red","Red \u2014 emotional, rushed"]]'],
      ['worst_self_talk', "What's the worst thing you say to yourself when it's going bad?", 'Write the actual sentence in your head.', 'text', '[]'],
      ['struggle_pattern', "When you struggle, what's usually going on in your head?", '', 'radio',
        '[["expecting_results","Expecting results"],["thinking_mechanics","Thinking mechanics"],["worried_watching","Worried who\u2019s watching"],["blank","I go blank"]]'],
      ['big_moment_mode', 'In big moments \u2014 are you attacking or hoping?', '', 'radio',
        '[["attacking","Attacking"],["hoping","Hoping"],["depends","Depends"]]'],
      ['hard_voice', 'When it gets hard, what does the voice say?', 'The governor \u2014 what does it tell you?', 'text', '[]'],
      ['has_routine', 'Do you have a routine you actually trust?', '', 'radio',
        '[["yes","Yes \u2014 it\u2019s automatic"],["sortof","Sort of \u2014 sometimes"],["no","No routine yet"]]'],
      ['between_pitches', 'Between pitches \u2014 what do you actually do?', 'Ravizza: the 15 seconds between pitches is the game. Step out? Breathe? Nothing?', 'text', '[]'],
      ['keyword', 'Do you have a reset word \u2014 one word that locks you back in?', 'One word. Yours, not someone else\u2019s.', 'text', '[]'],
      ['best_game', 'Your best game ever \u2014 what were you thinking and feeling?', 'Be specific.', 'text', '[]'],
      ['visualization', 'Do you picture success before games \u2014 see yourself getting hits?', '', 'radio',
        '[["yes","Yes \u2014 every game"],["sometimes","Sometimes"],["no","No, never tried it"]]'],
      ['confidence_source', 'Where does your confidence come from?', '', 'radio',
        '[["preparation","My preparation \u2014 I know I put the work in"],["past_success","Past success \u2014 I know I\u2019ve done it before"],["disappears","Honestly it disappears when I struggle"]]'],
      ['post_game', 'After a bad game, what do you do?', '', 'radio',
        '[["replay","Replay the mistakes over and over"],["forget","Try to forget it"],["review","Review what happened, then move on"],["beat_up","Beat myself up"]]'],
      ['focus_pull', 'What pulls your focus during games?', 'Crowd, scouts, parents, last at-bat...', 'text', '[]'],
    ];
    const ins = db.prepare('INSERT INTO mental_questions (qkey, prompt, hint, qtype, options, sort, active) VALUES (?, ?, ?, ?, ?, ?, 1)');
    seed.forEach((s, i) => ins.run(s[0], s[1], s[2], s[3], s[4], i));
    // Migrate existing athletes' answers from mental_baseline into mental_answers.
    try {
      const cols = db.prepare('PRAGMA table_info(mental_baseline)').all().map((c) => c.name);
      const keys = seed.map((s) => s[0]).filter((k) => cols.includes(k));
      if (keys.length) {
        const users = db.prepare(`SELECT user_id, ${keys.join(', ')} FROM mental_baseline`).all();
        const up = db.prepare(`INSERT INTO mental_answers (user_id, qkey, answer, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, qkey) DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at`);
        const now = new Date().toISOString();
        for (const u of users) for (const k of keys) if (u[k]) up.run(u.user_id, k, u[k], now);
      }
    } catch (e) { /* best effort */ }
  }
}

// Fresh daily content (Sep 23 2026, Bobby): a brand-new Bible verse + mental
// exercise every day, never repeating. Generated at 4am Chicago; the old
// rotation pools stay as fallback if generation fails.
db.exec(`CREATE TABLE IF NOT EXISTS daily_content (
  day TEXT PRIMARY KEY,
  verse_json TEXT NOT NULL DEFAULT '{}',
  exercise_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL DEFAULT ''
);`);

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
  add('hitting_score', 'REAL');
  add('pitching_score', 'REAL');
  // Bobby's 12-question check-in (Sep 23 2026)
  add('session_type', "TEXT NOT NULL DEFAULT ''");
  add('routine_followed', "TEXT NOT NULL DEFAULT ''");
  add('swing_feel', 'INTEGER');
  add('timing', "TEXT NOT NULL DEFAULT ''");
  add('contact_quality', 'INTEGER');
  add('approach_score', 'INTEGER');
  add('main_focus', "TEXT NOT NULL DEFAULT ''");
  add('adjustment_helped', "TEXT NOT NULL DEFAULT ''");
  add('learned', "TEXT NOT NULL DEFAULT ''");
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

// Score tier rename (Bobby, Sep 17 2026): 'Off' -> 'Building', 'Rough' ->
// 'Grind Day'. Backfills every historical check-in so past entries show the
// new encouraging names (and their colors) everywhere. Guarded to run once.
if (!db.prepare("SELECT value FROM settings WHERE key = 'score_tier_rename_20260917'").get()) {
  const offN = db.prepare("UPDATE checkins SET score_tier = 'Building' WHERE score_tier = 'Off'").run().changes;
  const roughN = db.prepare("UPDATE checkins SET score_tier = 'Grind Day' WHERE score_tier = 'Rough'").run().changes;
  db.prepare("INSERT INTO settings (key, value) VALUES ('score_tier_rename_20260917', '1')").run();
  console.log(`MIGRATE_TIER_NAMES: renamed ${offN} 'Off' -> 'Building', ${roughN} 'Rough' -> 'Grind Day' on historical check-ins`);
}

// ---- Pre-signup intake questionnaire (Sep 2026) ----
// Prospects fill out Bobby's intake form BEFORE signing up. On submit the
// app auto-creates their athlete account, generates a baseline draft program
// from the answers, and stores the raw answers here for Bobby's review.
// The account stays 'pending' until Bobby reviews the draft and approves it.
db.exec(`CREATE TABLE IF NOT EXISTS intake_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_intake_user ON intake_responses(user_id);');
// Per-lead questionnaire invites (Sep 2026): Bobby sends a questionnaire link
// bound to a website-application lead, so the form pre-fills from the lead's
// application instead of asking for it all again.
db.exec(`CREATE TABLE IF NOT EXISTS intake_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  created_at TEXT NOT NULL DEFAULT '',
  used_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT ''
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_intake_invites_token ON intake_invites(token);');
db.exec('CREATE INDEX IF NOT EXISTS idx_intake_invites_lead ON intake_invites(lead_id);');
// Link each questionnaire submission back to the lead it came from (if any).
{
  const cols = db.prepare('PRAGMA table_info(intake_responses)').all().map((c) => c.name);
  if (!cols.includes('lead_id')) db.exec('ALTER TABLE intake_responses ADD COLUMN lead_id INTEGER;');
}
// 4-week training blocks (Sep 2026): each remote program tracks its current
// block. block_start = ISO date the block began; block_number counts from 1;
// block_notified_at marks when Bobby was pinged that the block ended;
// next_lifting_id/next_block_start stage the upcoming block so it can flip
// automatically (or be approved early by Bobby).
// session_order (Sep 2026): 'hitting_first' (default) or 'lifting_first' —
// Bobby or the athlete picks which runs first in a session.
// component_order (Sep 2026): JSON array of ['mobility','medball','hitting','lifting']
// — the athlete's chosen order for the guided Today session. '' = default.
{
  const cols = db.prepare('PRAGMA table_info(remote_programs)').all().map((c) => c.name);
  for (const [col, ddl] of [
    ['block_start', "TEXT DEFAULT ''"],
    ['block_number', 'INTEGER DEFAULT 1'],
    ['block_notified_at', "TEXT DEFAULT ''"],
    ['next_lifting_id', 'INTEGER'],
    ['next_block_start', "TEXT DEFAULT ''"],
    ['session_order', "TEXT DEFAULT 'hitting_first'"],
    ['component_order', "TEXT DEFAULT ''"],
  ]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE remote_programs ADD COLUMN ${col} ${ddl};`);
  }
}
// Athlete self-substitutions (Sep 2026): one-tap exercise swaps mid-workout,
// logged so Bobby sees them. day = Chicago date the swap happened.
db.exec(`CREATE TABLE IF NOT EXISTS program_substitutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  item_key TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL DEFAULT '',
  sub_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_subs_user ON program_substitutions(user_id, day);');
// Shareable questionnaire link token (settings.intake_token). Bobby texts the
// link to prospects; he can rotate it from the Programs page.
{
  try {
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');");
    const tok = db.prepare("SELECT value FROM settings WHERE key = 'intake_token'").get();
    if (!tok) {
      const crypto = require('crypto');
      db.prepare("INSERT INTO settings (key, value) VALUES ('intake_token', ?)")
        .run(crypto.randomBytes(12).toString('hex'));
      console.log('INTAKE: generated questionnaire link token.');
    }
  } catch (e) { console.warn('intake token setup skipped', e.message); }
}

module.exports = db;
