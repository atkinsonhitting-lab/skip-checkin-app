// College-org coach privacy (Bobby, Sep 17 2026): coaches of programs that
// aren't Bobby's own (organizations.is_mine != 1) see the brief summary —
// what the player did, logged/streak/frequency, Skip's read — NOT the
// journal words, feel sliders, chat history, or what-works detail.
// Bobby's own orgs (is_mine=1) keep full visibility.
// Boots the real server on a throwaway DB.
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const PORT = 3496, DB = '/tmp/college-privacy-test.db', BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = '/tmp/college-privacy-test-data';
const CWD = '/home/hatch/workspace/skip-push-deploy';
let failures = 0;
const check = (n, c) => { console.log((c ? '  ok - ' : '  FAIL - ') + n); if (!c) failures++; };

const run = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).run(...a); } finally { d.close(); } };
const q = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).get(...a); } finally { d.close(); } };

async function main() {
  // ---- Boot 1: build the schema ----
  const { execSync } = require('node:child_process');
  execSync(`DATA_DIR=${DATA_DIR} DB_PATH=${DB} PORT=3498 SESSION_SECRET=t SKIP_API_KEY=t timeout 12 node src/server.js > /dev/null 2>&1 || true`,
    { cwd: CWD, timeout: 30000 });

  // ---- Unit: tier names fully renamed ----
  const src = require('fs').readFileSync(CWD + '/src/views.js', 'utf8');
  check('no stale Off/Rough tier keys in views.js', !/'Off'|'Rough'/.test(src.match(/const TIER_NOTES = \{[^}]*\}/s)[0])
    && !/'Rough'|'Off'/.test(src.match(/const LEVEL_COLORS = \{[^}]*\}/)[0]));
  check('tierBadgeClass maps Building to warn', src.includes("if (tier === 'Building') return 'warn'"));
  check('no "rough days" language left', !src.includes('rough days'));

  // ---- Seed ----
  const h = bcrypt.hashSync('password123', 10), now = new Date().toISOString();
  const addUser = (email, role, fn, ln, extra) =>
    run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status${extra ? ',' + extra[0] : ''}) VALUES (?,?,?,?,?,?,?,?${extra ? ',?' : ''})`,
      email, h, role, `${fn} ${ln}`, fn, ln, now, 'approved', ...(extra ? [extra[1]] : [])).lastInsertRowid;
  const collegeOrg = run(`INSERT INTO organizations (name,code,skip_enabled,created_at,is_mine) VALUES (?,?,?,?,?)`,
    'Test College', 'TEST-COL-1', 1, now, 0).lastInsertRowid;
  const bobbyOrg = q(`SELECT id FROM organizations WHERE name = 'Atkinson Hitting'`).id;
  check('Bobby org seeded is_mine=1', q(`SELECT is_mine FROM organizations WHERE id = ?`, bobbyOrg).is_mine === 1);
  const collegeKid = addUser('collegekid@test.com', 'athlete', 'College', 'Kid', ['organization_id', collegeOrg]);
  const bobbyKid = addUser('bobbykid@test.com', 'athlete', 'Bobby', 'Kid', ['organization_id', bobbyOrg]);
  addUser('gcoach@test.com', 'coach', 'G', 'Coach', ['can_edit', 1]);
  const orgCoach = addUser('ccollege@test.com', 'coach', 'C', 'Coach', ['organization_id', collegeOrg]);
  const drills = JSON.stringify([{ name: 'Front Toss', known: true, station: 'Front Toss' }]);
  const addCheckin = (uid, notes) => run(
    `INSERT INTO checkins (user_id,athlete_name,created_at,environment,feel,confidence,focus,difficulty,session_score,score_tier,session_notes,what_worked,felt_good,drills_done,skip_journal_note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid, 'Kid', now, 'Cage', 8, 7, 8, 6, 7.8, 'Solid',
    'PRIVATE-DIARY-' + notes, 'PRIVATE-WORKED-' + notes, 'PRIVATE-FELT-' + notes, drills, 'Skip read summary here');
  addCheckin(collegeKid, 'COLLEGE');
  addCheckin(bobbyKid, 'BOBBY');
  run(`INSERT INTO chat_messages (user_id,role,content,created_at) VALUES (?,?,?,?)`, collegeKid, 'user', 'PRIVATE-CHAT-COLLEGE', now);
  run(`INSERT INTO chat_messages (user_id,role,content,created_at) VALUES (?,?,?,?)`, bobbyKid, 'user', 'PRIVATE-CHAT-BOBBY', now);

  // ---- HTTP ----
  const srv = spawn('node', ['src/server.js'], { cwd: CWD, env: { ...process.env, DATA_DIR, DB_PATH: DB, PORT: String(PORT), SESSION_SECRET: 't', SKIP_API_KEY: 't', LLM_API_KEY: 't' }, stdio: 'inherit' });
  const jar = {};
  const req = async (method, p, body, who) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (jar[who]) headers.cookie = jar[who];
    const r = await fetch(BASE + p, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
  };
  const P = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) u.append(k, v); return u; };
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/login'); if (r.status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const lr = await req('POST', '/login', P({ email: 'gcoach@test.com', password: 'password123' }), 'coach');
    if (lr.status !== 302) throw new Error('coach login failed');
    const or = await req('POST', '/login', P({ email: 'ccollege@test.com', password: 'password123' }), 'orgcoach');
    if (or.status !== 302) throw new Error('org coach login failed');

    // --- The college-org coach's view: brief summary only. ---
    // --- The college-org coach's view: brief summary only. ---
    // View-as the college player: notebook shows brief summary only.
    await req('POST', '/coach/view-as', P({ id: String(collegeKid) }), 'orgcoach');
    let nb = await req('GET', '/notebook', null, 'orgcoach');
    check('college notebook 200', nb.status === 200);
    check('college notebook hides Full entry', !nb.text.includes('Full entry'));
    check('college notebook hides diary words', !nb.text.includes('PRIVATE-DIARY-COLLEGE'));
    check('college notebook hides reflections', !nb.text.includes('PRIVATE-FELT-COLLEGE'));
    check('college notebook hides feel sliders', !nb.text.includes('Feel 8'));
    check('college notebook shows what he did (environment)', nb.text.includes('Cage'));
    check('college notebook shows drills', nb.text.includes('Front Toss'));
    check('college notebook shows Skip read', nb.text.includes('Skip read summary here'));
    // Home in view-as: recent cards restricted too.
    const hm = await req('GET', '/', null, 'orgcoach');
    check('college home hides Full entry', !hm.text.includes('Full entry'));
    check('college home hides diary words', !hm.text.includes('PRIVATE-DIARY-COLLEGE'));
    await req('POST', '/coach/view-as/exit', P({}), 'orgcoach');

    // Per-player coach page.
    let cp = await req('GET', '/coach/user/' + encodeURIComponent('collegekid@test.com'), null, 'orgcoach');
    check('coach user page 200 (college)', cp.status === 200);
    check('college coach page hides chat history', !cp.text.includes('Chat history'));
    check('college coach page hides chat words', !cp.text.includes('PRIVATE-CHAT-COLLEGE'));
    check('college coach page hides diary words', !cp.text.includes('PRIVATE-DIARY-COLLEGE'));
    check('college coach page hides Full entry', !cp.text.includes('Full entry'));
    check('college coach page shows activity', cp.text.includes('Cage') && cp.text.includes('Front Toss'));

    // Coach home latest feed: college card restricted per-row.
    const home = await req('GET', '/coach', null, 'orgcoach');
    check('coach home 200', home.status === 200);
    const feedIdx = home.text.indexOf('Latest check-ins');
    const feed = home.text.slice(feedIdx);
    check('latest feed hides college diary words', !feed.includes('PRIVATE-DIARY-COLLEGE'));
    check('latest feed shows college activity', feed.includes('Cage'));

    // Export: college rows redacted for the org coach.
    const ex = await req('GET', '/coach/export', null, 'orgcoach');
    check('export 200', ex.status === 200);
    const data = JSON.parse(ex.text);
    const colRow = data.checkins.find((r) => r.email === 'collegekid@test.com');
    check('export redacts college diary', colRow && colRow.session_notes === null && colRow.what_worked === null);
    check('export redacts college feel sliders', colRow && colRow.feel === null);
    check('export keeps college score + read', colRow && colRow.session_score === 7.8 && colRow.skip_journal_note === 'Skip read summary here');

    // --- Bobby (global coach): full visibility everywhere, even for college orgs. ---
    await req('POST', '/coach/view-as', P({ id: String(collegeKid) }), 'coach');
    nb = await req('GET', '/notebook', null, 'coach');
    check('bobby view-as keeps Full entry (college kid)', nb.text.includes('Full entry'));
    check('bobby view-as keeps diary words', nb.text.includes('PRIVATE-DIARY-COLLEGE'));
    await req('POST', '/coach/view-as/exit', P({}), 'coach');
    cp = await req('GET', '/coach/user/' + encodeURIComponent('collegekid@test.com'), null, 'coach');
    check('bobby coach page keeps chat history (college kid)', cp.text.includes('Chat history'));
    check('bobby coach page keeps diary words (college kid)', cp.text.includes('PRIVATE-DIARY-COLLEGE'));
    const exb = await req('GET', '/coach/export', null, 'coach');
    const datab = JSON.parse(exb.text);
    const colRowB = datab.checkins.find((r) => r.email === 'collegekid@test.com');
    check('bobby export keeps college diary', colRowB && colRowB.session_notes && colRowB.session_notes.includes('PRIVATE-DIARY-COLLEGE'));

    // Bobby-org player: full visibility kept for both coaches.
    cp = await req('GET', '/coach/user/' + encodeURIComponent('bobbykid@test.com'), null, 'coach');
    check('bobby coach page keeps chat history (bobby kid)', cp.text.includes('Chat history'));
    check('bobby coach page keeps diary words (bobby kid)', cp.text.includes('PRIVATE-DIARY-BOBBY'));
    const ex2 = await req('GET', '/coach/export', null, 'coach');
    const data2 = JSON.parse(ex2.text);
    const bobRow = data2.checkins.find((r) => r.email === 'bobbykid@test.com');
    check('export keeps bobby diary', bobRow && bobRow.session_notes && bobRow.session_notes.includes('PRIVATE-DIARY-BOBBY'));

    // Hitter list: streak + frequency visible (global coach).
    const hl = await req('GET', '/coach/hitters', null, 'coach');
    check('hitter list shows streak', hl.text.includes('-day streak'));
    check('hitter list shows 7-day frequency', hl.text.includes('/7 days'));

    console.log(failures === 0 ? 'COLLEGE PRIVACY OK' : failures + ' FAILURES');
  } finally {
    srv.kill();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('TEST ERROR:', e); process.exit(1); });
