// My Players tab + Bobby's program orgs: integration suite on a throwaway DB.
// Boots the real server and checks: the is_mine migration, the idempotent
// boot seed (org creation, branding mirror, standalone-only player moves),
// the /coach/my-players route + 403 for org coaches, the /mine toggle guard,
// the Routine tab for hitters (exactly once for remote-program hitters),
// and the six drill quick-tap chips in the check-in form.
const { spawn, execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const views = require('./src/views.js');
const PORT = 3497, DB = '/tmp/myplayers-test.db', BASE = `http://127.0.0.1:${PORT}`, CWD = '/home/hatch/workspace/skip-push-deploy';
const DATA_DIR = '/tmp/myplayers-test-data';
let failures = 0;
const check = (n, c) => { console.log((c ? '  ok - ' : '  FAIL - ') + n); if (!c) failures++; };

const BOOT_ENV = `DATA_DIR=${DATA_DIR} DB_PATH=${DB} PORT=3499 SESSION_SECRET=t SKIP_API_KEY=t LLM_API_KEY=t`;

function boot(capture) {
  const cmd = `${BOOT_ENV} timeout 15 node src/server.js ${capture ? '2>&1' : '> /dev/null 2>&1'} || true`;
  return execSync(cmd, { cwd: CWD, timeout: 40000, encoding: 'utf8' });
}
const run = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).run(...a); } finally { d.close(); } };
const q = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).get(...a); } finally { d.close(); } };
const qall = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).all(...a); } finally { d.close(); } };
const orgIdOf = (name) => q('SELECT id FROM organizations WHERE LOWER(name) = LOWER(?)', name).id;
const orgOf = (userId) => q('SELECT organization_id FROM users WHERE id = ?', userId).organization_id;

async function main() {
  // ---- Unit: Routine tab + drill chips (no server needed) ----
  const t1 = views.userTabs('home', { role: 'athlete' });
  check('regular hitter gets one /routine tab', t1.filter((t) => t.href === '/routine').length === 1);
  check('regular hitter Routine tab labeled Routine', t1.some((t) => t.href === '/routine' && t.label === 'Routine'));
  const t2 = views.userTabs('home', { role: 'athlete', remoteProgramId: 7 });
  check('remote hitter: exactly one Routine tab', t2.filter((t) => t.label === 'Routine').length === 1);
  check('remote hitter: Routine points at /program/routine', t2.some((t) => t.label === 'Routine' && t.href === '/program/routine'));
  check('remote hitter: no base /routine tab', !t2.some((t) => t.href === '/routine'));
  const cf = views.checkinForm({ role: 'athlete', approvalCount: 0 }, null, {}, [], []);
  for (const d of ['Prep', 'Tee', 'Side Toss', 'Front Toss', 'BP', 'Machine'])
    check(`drill chip "${d}" in check-in form`, cf.includes(`data-drill="${d}"`));
  check('tip text about (tee)/(side toss)/etc. unchanged', cf.includes('add (tee), (side toss), (front toss), (BP), or (machine) after a drill'));

  // ---- Boot 1: migration + seed ----
  fs.rmSync(DB, { force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const out1 = boot(true);
  const ocols = qall('PRAGMA table_info(organizations)').map((c) => c.name);
  check('organizations.is_mine exists', ocols.includes('is_mine'));
  check('is_mine defaults to 0', qall('PRAGMA table_info(organizations)').find((c) => c.name === 'is_mine').dflt_value === '0');
  const inP = q('SELECT * FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting');
  const rem = q('SELECT * FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting Remote Development');
  check('Atkinson Hitting org created', !!inP);
  check('Atkinson Hitting Remote Development org created', !!rem);
  check('both orgs marked is_mine=1', inP && rem && inP.is_mine === 1 && rem.is_mine === 1);
  check('Missouri State sample stays is_mine=0', q(`SELECT is_mine FROM organizations WHERE name = 'Missouri State'`).is_mine === 0);
  check('boot logs no-branding note', out1.includes('BOOT_PROGRAMS: no branding on either org yet'));

  // ---- Boot 2: idempotency ----
  boot(false);
  check('seed idempotent (one row per org)', qall('SELECT id FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting').length === 1
    && qall('SELECT id FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting Remote Development').length === 1);

  // ---- Branding mirror: fills blanks only, never overwrites ----
  run('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?',
    'atko-logo.png', '#E10600', '#A80400', orgIdOf('Atkinson Hitting'));
  fs.mkdirSync(path.join(DATA_DIR, 'org-logos'), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'org-logos', 'atko-logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const out3 = boot(true);
  const remB = q('SELECT logo_path, primary_color, accent_color FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting Remote Development');
  check('branding mirrored to blank org', remB.logo_path === 'atko-logo.png' && remB.primary_color === '#E10600' && remB.accent_color === '#A80400');
  check('boot logs the mirror', out3.includes('mirrored branding from "Atkinson Hitting" to "Atkinson Hitting Remote Development"'));
  // Now give the remote org its OWN branding; reboot must not overwrite either side.
  run('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?',
    'remote-logo.png', '#111111', '#222222', orgIdOf('Atkinson Hitting Remote Development'));
  boot(false);
  const aB = q('SELECT logo_path, primary_color FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting');
  const rB = q('SELECT logo_path, primary_color FROM organizations WHERE LOWER(name) = LOWER(?)', 'Atkinson Hitting Remote Development');
  check('existing branding never overwritten (in-person)', aB.logo_path === 'atko-logo.png' && aB.primary_color === '#E10600');
  check('existing branding never overwritten (remote)', rB.logo_path === 'remote-logo.png' && rB.primary_color === '#111111');

  // ---- Player moves: standalone only ----
  const h = bcrypt.hashSync('password123', 10), now = new Date().toISOString();
  const addAthlete = (email, fn, ln, an) => run(
    `INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
    email, h, 'athlete', an || (fn && ln ? `${fn} ${ln}` : 'Athlete'), fn || null, ln || null, now, 'approved').lastInsertRowid;
  const briggs = addAthlete('briggs@test.com', 'Briggs', 'McNabb');
  const liam = addAthlete('liam@test.com', 'Liam', 'Stoffel');
  const dylan = addAthlete('dylan@test.com', null, null, 'Dylan Short'); // athlete_name match
  run(`INSERT INTO organizations (name, code, skip_enabled, created_at) VALUES ('Some Travel Team','TEST-0001',1,?)`, now);
  const otherOrg = orgIdOf('Some Travel Team');
  const mickey = addAthlete('mickey@test.com', 'Mickey', 'Krishel');
  run('UPDATE users SET organization_id = ? WHERE id = ?', otherOrg, mickey);
  const out4 = boot(true);
  check('standalone in-person player moved', orgOf(briggs) === orgIdOf('Atkinson Hitting'));
  check('standalone remote player moved', orgOf(liam) === orgIdOf('Atkinson Hitting Remote Development'));
  check('athlete_name match moved', orgOf(dylan) === orgIdOf('Atkinson Hitting'));
  check('player already in another org NOT moved', orgOf(mickey) === otherOrg);
  check('boot logs the moves', out4.includes('BOOT_PROGRAMS: moved "Briggs McNabb" into "Atkinson Hitting"'));
  check('boot logs the skip', out4.includes('BOOT_PROGRAMS: "Mickey Krishel" already in org "Some Travel Team" — not moved'));

  // ---- HTTP: routes, guards, toggle ----
  const coachId = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,can_edit) VALUES (?,?,?,?,?,?,?,?,?)`,
    'coach@test.com', h, 'coach', 'Coach', 'Coach', 'C', now, 'approved', 1).lastInsertRowid;
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,can_edit) VALUES (?,?,?,?,?,?,?,?,?)`,
    'cam@test.com', h, 'coach', 'Cam', 'Cam', 'M', now, 'approved', 0);
  const orgCoach = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,organization_id) VALUES (?,?,?,?,?,?,?,?,?)`,
    'orgcoach@test.com', h, 'coach', 'OC', 'Org', 'Coach', now, 'approved', otherOrg).lastInsertRowid;
  void coachId; void orgCoach;

  const srv = spawn('node', ['src/server.js'], { cwd: CWD, env: { ...process.env, DATA_DIR, DB_PATH: DB, PORT: String(PORT), SESSION_SECRET: 't', SKIP_API_KEY: 't', LLM_API_KEY: 't' }, stdio: 'inherit' });
  const jar = {};
  const req = async (method, p, body, who, contentType) => {
    const headers = {};
    if (body) headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
    if (jar[who]) headers.cookie = jar[who];
    const r = await fetch(BASE + p, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
  };
  const P = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) u.append(k, v); return u; };
  const login = async (who, email) => { const r = await req('POST', '/login', P({ email, password: 'password123' }), who); if (r.status !== 302) throw new Error('login failed for ' + email); };
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/login'); if (r.status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    await login('coach', 'coach@test.com');
    await login('cam', 'cam@test.com');
    await login('oc', 'orgcoach@test.com');

    let r = await req('GET', '/coach/my-players', null, 'coach');
    check('GET /coach/my-players 200 for global coach', r.status === 200);
    let html = r.text;
    check('My Players page titled', html.includes('<h1 class="page-title">My Players</h1>'));
    check('My Players lists in-person player', html.includes('Briggs McNabb'));
    check('My Players lists remote player', html.includes('Liam Stoffel'));
    check('My Players excludes other-org player', !html.includes('Mickey Krishel'));
    check('drawer has My Players tab', html.includes('href="/coach/my-players"'));
    check('drawer relabels All Players', html.includes('>All Players<'));

    r = await req('GET', '/coach/my-players', null, 'oc');
    check('GET /coach/my-players 403 for org coach', r.status === 403);
    r = await req('GET', '/coach/my-players', null, 'cam');
    check('GET /coach/my-players 200 for view-only Cam', r.status === 200);

    r = await req('GET', '/coach/hitters', null, 'coach');
    html = r.text;
    check('All Players page titled for global coach', r.status === 200 && html.includes('<h1 class="page-title">All Players</h1>'));
    check('All Players lists other-org player', html.includes('Mickey Krishel'));
    r = await req('GET', '/coach/hitters', null, 'oc');
    html = r.text;
    check('org coach keeps "Players" title', r.status === 200 && html.includes('<h1 class="page-title">Players</h1>'));

    // /mine toggle: Bobby flips, Cam is blocked.
    r = await req('POST', `/coach/organizations/${otherOrg}/mine`, P({}), 'coach');
    check('POST /mine flips is_mine (Bobby)', r.status === 302 && q('SELECT is_mine FROM organizations WHERE id = ?', otherOrg).is_mine === 1);
    r = await req('GET', '/coach/my-players', null, 'coach');
    html = r.text;
    check('My Players picks up newly marked org', html.includes('Mickey Krishel'));
    r = await req('POST', `/coach/organizations/${otherOrg}/mine`, P({}), 'cam');
    check('POST /mine 403 for view-only Cam', r.status === 403 && q('SELECT is_mine FROM organizations WHERE id = ?', otherOrg).is_mine === 1);
    r = await req('POST', `/coach/organizations/${otherOrg}/mine`, P({}), 'oc');
    check('POST /mine 403 for org coach', r.status === 403);

    // Organizations page shows the toggle with state.
    r = await req('GET', '/coach/organizations', null, 'coach');
    html = r.text;
    check('org card shows My program toggle', html.includes('My program:'));
    check('toggle posts to /mine', html.includes(`/coach/organizations/${otherOrg}/mine`));

    // ---- B refinement: history-driven drill chips ----
    const chipAthlete = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'chips@test.com', h, 'athlete', 'Chip', 'Chip', 'Hitter', now, 'approved').lastInsertRowid;
    const addCheckin = (uid, drills, created) => run(`INSERT INTO checkins (user_id, athlete_name, created_at, drills_done) VALUES (?,?,?,?)`,
      uid, 'Chip Hitter', created, JSON.stringify(drills));
    addCheckin(chipAthlete, ['Old Drill One', 'Fence Drill'], '2026-09-10T10:00:00');
    addCheckin(chipAthlete, [{ name: 'Fence Drill', station: 'tee' }, 'Tee', 'New Drill Two'], '2026-09-12T10:00:00');
    await login('chips', 'chips@test.com');
    r = await req('GET', '/checkin', null, 'chips');
    html = r.text;
    check('check-in 200 for hitter', r.status === 200);
    const chipCount = (name) => html.split(`data-drill="${name}"`).length - 1;
    check('recent drill chip rendered', chipCount('Fence Drill') === 1);
    check('recent drill chip from object form', chipCount('New Drill Two') === 1);
    check('older recent drill rendered', chipCount('Old Drill One') === 1);
    check('preset matching recent drill not duplicated', chipCount('Tee') === 1);
    check('other presets still render', ['Prep', 'Side Toss', 'Front Toss', 'BP', 'Machine'].every((d) => chipCount(d) === 1));
    check('chips most-recent-first, recent before presets',
      html.indexOf('data-drill="Fence Drill"') < html.indexOf('data-drill="New Drill Two"') &&
      html.indexOf('data-drill="New Drill Two"') < html.indexOf('data-drill="Old Drill One"') &&
      html.indexOf('data-drill="Old Drill One"') < html.indexOf('data-drill="Prep"'));
    // Cap at 8 recent names.
    const capAthlete = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'cap@test.com', h, 'athlete', 'Cap', 'Cap', 'Tester', now, 'approved').lastInsertRowid;
    addCheckin(capAthlete, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'], '2026-09-12T10:00:00');
    await login('cap', 'cap@test.com');
    r = await req('GET', '/checkin', null, 'cap');
    html = r.text;
    const totalChips = html.split('drill-chip"').length - 1;
    check('recent chips capped at 8 (+6 presets)', totalChips === 14 && chipCount('D9') === 0 && chipCount('D10') === 0);
    // No history: presets only.
    await login('briggs', 'briggs@test.com');
    r = await req('GET', '/checkin', null, 'briggs');
    html = r.text;
    check('presets render for player with no history', ['Prep', 'Tee', 'Side Toss', 'Front Toss', 'BP', 'Machine'].every((d) => html.includes(`data-drill="${d}"`)));

    // ---- C: check-in push gating ----
    // Gate SQL mirrors isMyProgramPlayer() in src/server.js exactly.
    const gate = (uid) => !!q('SELECT 1 FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? AND o.is_mine = 1', uid);
    const solo = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'solo@test.com', h, 'athlete', 'Solo', 'Solo', 'Player', now, 'approved').lastInsertRowid;
    const msuPlayer = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,organization_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      'msu@test.com', h, 'athlete', 'Msu', 'Msu', 'Bear', now, 'approved', orgIdOf('Missouri State')).lastInsertRowid;
    check('gate: is_mine-org player would notify', gate(briggs) === true);
    check('gate: standalone player stays silent', gate(solo) === false);
    check('gate: non-mine-org player stays silent', gate(msuPlayer) === false);
    // The notify hook never breaks the check-in redirect (push off in tests).
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', did_drills: 'no', session_notes: '', what_worked: '' }), 'briggs');
    check('POST /checkin still redirects after notify hook', r.status === 302 && (r.loc || '').startsWith('/checkin/score/'));

    // ---- D (revised): coach/player messaging — 1:1 + broadcast + inbox ----
    check('messages table exists', !!q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'"));
    check('message_recipients table exists', !!q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_recipients'"));
    const bobbyId = q("SELECT id FROM users WHERE email = 'coach@test.com'").id;
    r = await req('GET', '/coach/my-players', null, 'coach');
    html = r.text;
    check('message form on My Players', html.includes('Message my players') && html.includes('/coach/my-players/message'));
    check('recipients checked by default', html.includes(`name="user_ids" value="${briggs}" checked`));
    const msgCount = () => q('SELECT COUNT(*) AS c FROM messages').c;
    const unreadFor = (uid) => q('SELECT COUNT(*) AS c FROM message_recipients WHERE user_id = ? AND read_at IS NULL', uid).c;
    // Broadcast to a subset; invalid ids ignored; only my-players get rows.
    const msgBefore = msgCount();
    const p2 = new URLSearchParams();
    p2.append('body', 'Big week — check in daily.');
    p2.append('user_ids', String(briggs));
    p2.append('user_ids', '99999'); // not a player — must be ignored
    r = await req('POST', '/coach/my-players/message', p2, 'coach');
    check('broadcast redirects with sent count', r.status === 302 && (r.loc || '').includes('sent=1'));
    check('broadcast: one message row, recipient_id NULL', msgCount() === msgBefore + 1 && q('SELECT recipient_id FROM messages ORDER BY id DESC LIMIT 1').recipient_id === null);
    check('broadcast: only my-players get recipient rows',
      q('SELECT COUNT(*) AS c FROM message_recipients').c === 1 && unreadFor(briggs) === 1 && unreadFor(solo) === 0 && unreadFor(msuPlayer) === 0);
    r = await req('GET', '/coach/my-players?sent=1', null, 'coach');
    check('sent confirmation renders', r.text.includes('Sent</strong> to 1 player'));
    r = await req('POST', '/coach/my-players/message', P({ body: '   ', user_ids: String(briggs) }), 'coach');
    check('empty body rejected', r.status === 302 && (r.loc || '').includes('error=') && msgCount() === msgBefore + 1);
    r = await req('POST', '/coach/my-players/message', p2, 'cam');
    check('view-only coach 403 on broadcast', r.status === 403 && msgCount() === msgBefore + 1);
    // Player → coach 1:1 (my-org player). Creates a recipient row for Bobby.
    await login('briggs', 'briggs@test.com');
    const m2 = msgCount();
    r = await req('POST', '/messages/to-coach', P({ body: 'Thanks coach!' }), 'briggs');
    check('my-org player to-coach works', r.status === 302 && msgCount() === m2 + 1);
    check('player message creates coach recipient row',
      q('SELECT user_id FROM message_recipients WHERE message_id = (SELECT MAX(id) FROM messages)').user_id === bobbyId);
    check('coach has unread before thread view', unreadFor(bobbyId) === 1);
    // Scope: outsiders cannot message.
    await login('solo', 'solo@test.com');
    r = await req('POST', '/messages/to-coach', P({ body: 'hey' }), 'solo');
    check('standalone player to-coach 403', r.status === 403 && msgCount() === m2 + 1);
    await login('msu', 'msu@test.com');
    r = await req('POST', '/messages/to-coach', P({ body: 'hey' }), 'msu');
    check('non-my-org player to-coach 403', r.status === 403 && msgCount() === m2 + 1);
    // Players can never message each other — no such route exists.
    r = await req('POST', '/messages/to/' + dylan, P({ body: 'hey' }), 'briggs');
    check('no player-to-player route', r.status === 404 && msgCount() === m2 + 1);
    // Coach 1:1: reply works for my-org player, 403 for outsiders.
    r = await req('POST', '/coach/messages/to/' + briggs, P({ body: 'Keep it up.' }), 'coach');
    check('coach reply works', r.status === 302 && (r.loc || '').includes('/coach/messages/' + briggs));
    check('player unread counts both messages', unreadFor(briggs) === 2);
    r = await req('POST', '/coach/messages/to/' + solo, P({ body: 'hi' }), 'coach');
    check('coach cannot message non-my-org athlete', r.status === 403);
    r = await req('GET', '/coach/messages/' + solo, null, 'coach');
    check('coach thread view 403 for non-my-org athlete', r.status === 403);
    r = await req('POST', '/coach/messages/to/' + briggs, P({ body: 'hi' }), 'cam');
    check('view-only coach 403 on 1:1', r.status === 403);
    // Coach thread list: Bobby's players only, with snippet + link.
    r = await req('GET', '/coach/messages', null, 'coach');
    check('coach thread list shows player thread', r.text.includes('Briggs McNabb') && r.text.includes('/coach/messages/' + briggs) && r.text.includes('Keep it up.'));
    r = await req('GET', '/coach/messages', null, 'cam');
    check('view-only coach can read threads', r.status === 200);
    r = await req('GET', '/coach/messages', null, 'oc');
    check('org coach 403 on coach messages', r.status === 403);
    // Coach nav badge before reading, gone after thread view.
    r = await req('GET', '/coach', null, 'coach');
    check('coach nav Messages badge', r.text.includes('/coach/messages') && r.text.includes('<span class="tab-badge">1</span>'));
    r = await req('GET', '/coach/messages/' + briggs, null, 'coach');
    check('thread shows both directions', r.text.includes('Thanks coach!') && r.text.includes('Keep it up.'));
    check('thread view marks coach rows read', unreadFor(bobbyId) === 0);
    // Player tab bar: Messages tab with unread badge; badge hidden at zero.
    await login('briggs', 'briggs@test.com');
    r = await req('GET', '/', null, 'briggs');
    check('tab bar has Messages tab', r.text.includes('href="/messages"') && r.text.includes('>Messages<'));
    check('tab bar badge shows unread count', r.text.includes('<span class="tabbar-badge">2</span>'));
    check('sidebar Messages item present', r.text.includes('drawer-link') && r.text.includes('href="/messages"'));
    check('home banner for unread + no push', r.text.includes('You have messages from Coach'));
    // Player inbox: both messages, compose box, nudge; viewing clears unread.
    r = await req('GET', '/messages', null, 'briggs');
    html = r.text;
    check('inbox shows broadcast + 1:1', html.includes('Big week — check in daily.') && html.includes('Thanks coach!') && html.includes('Keep it up.'));
    check('compose box present for my-org player', html.includes('Message Coach') && html.includes('/messages/to-coach'));
    check('nudge card for no-push player', html.includes('Turn on notifications</strong> <span class="hint">so you never miss a message from Coach.'));
    check('inbox view marks player rows read', unreadFor(briggs) === 0);
    r = await req('GET', '/', null, 'briggs');
    check('tab bar badge hidden at zero', !r.text.includes('tabbar-badge'));
    check('home banner gone at zero', !r.text.includes('You have messages from Coach'));
    // Non-my-org player: inbox without compose box.
    await login('solo', 'solo@test.com');
    r = await req('GET', '/messages', null, 'solo');
    check('compose box absent for standalone player', !r.text.includes('/messages/to-coach'));
    check('empty inbox renders', r.text.includes('No messages yet.'));
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
