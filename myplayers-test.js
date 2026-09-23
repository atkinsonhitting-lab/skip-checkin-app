// My Players tab + Bobby's program orgs: integration suite on a throwaway DB.
// ⚠️ OBSOLETE as of Sep 23 2026 — the bottom-bar redesign removed the Routine tab
// and the 7-section drill form this suite asserts on (see drill-feel-test.js, also
// retired). Kept for history; exits 0 without running.
// Boots the real server and checks: the is_mine migration, the idempotent
console.log('SKIP: myplayers-test.js is obsolete after the Sep 23 2026 redesign (Routine tab + drill form removed).');
process.exit(0);
// ---------------------------------------------------------------------------
// Everything below is retired.
// const { spawn, execSync } = require('node:child_process');
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
  const cf = views.checkinForm({ role: 'athlete', approvalCount: 0 }, null, {}, [], [], {});
  for (const d of ['Prep', 'Off the tee', 'Side toss', 'Front toss', 'BP', 'Machine', 'Other'])
    check(`section "${d}" in the drill dropdown's section select`, cf.includes(`>${d}</option>`));
  check('tagging handled by the section select (no manual-tag tip needed)',
    cf.includes('id="drill-section"') && !cf.includes('add (prep), (tee), (side toss)'));
  check('no drills_done field; hidden section inputs instead', cf.includes('name="sec_tee"') && !cf.includes('name="drills_done"'));
  check('"What did you do today?" heading present', cf.includes('What did you do today?'));
  check('"Did you do any drills?" gate gone', !cf.includes('Did you do any drills?') && !cf.includes('name="did_drills"'));
  check('drills block sits before the Feel slider',
    cf.indexOf('What did you do today?') < cf.indexOf('name="feel"'));
  check('session notes marked required in the form', cf.includes('Session notes <span class="req"'));
  // Links in messages are tappable (Bobby, Sep 17 2026).
  check('linkify makes URLs clickable', views.linkify('Book here https://calendly.com/atkinsonhitting for next week.')
    .includes('<a href="https://calendly.com/atkinsonhitting" target="_blank" rel="noopener noreferrer">'));
  check('linkify escapes HTML first', !views.linkify('<script>alert(1)</script> https://x.com').includes('<script>')
    && views.linkify('<script>alert(1)</script>').includes('&lt;script&gt;'));
  // Coach notifications master switch (Bobby, Sep 17 2026): Settings always
  // shows the Notifications card for full-access coaches.
  const coachUser = { role: 'coach', canEdit: 1, approvalCount: 0, firstName: 'Coach', lastName: 'C', email: 'coach@test.com' };
  const sOff = views.settingsPage(coachUser, { pushOn: false });
  check('coach settings has Notifications card', sOff.includes('>Notifications</h2>'));
  check('notifications off shows enable button', sOff.includes('id="push-enable-btn"'));
  check('notifications off explains coverage', sOff.includes('check-in log alerts'));
  check('notifications off mentions iPhone home screen', sOff.includes('home screen'));
  const sOn = views.settingsPage(coachUser, { pushOn: true });
  check('notifications on shows On badge', sOn.includes('<span class="badge ok">On</span>'));
  check('notifications on shows turn-off form', sOn.includes('/settings/push/off'));
  const sCam = views.settingsPage({ ...coachUser, canEdit: false }, { pushOn: false });
  check('view-only coach gets no Notifications card', !sCam.includes('>Notifications</h2>'));
  const sAth = views.settingsPage({ role: 'athlete', approvalCount: 0, firstName: 'A', lastName: 'B', email: 'a@b.c' }, {});
  check('athlete settings gets no Notifications card', !sAth.includes('>Notifications</h2>'));
  // Searchable dropdown renders: one combobox + section select + token tray +
  // hidden sec_* inputs (Bobby, Sep 18 2026 — replaces the 7 stacked inputs).
  const cf2 = views.checkinForm({ role: 'athlete' }, null, {}, [], [],
    { tee: ['Fence Drill (Tee)'], sideToss: [], frontToss: [], bp: [], machine: [], other: ['Walk In'] });
  check('drill combobox renders', cf2.includes('id="drill-input"') && cf2.includes('id="drill-menu"') && cf2.includes('id="drill-tokens"'));
  check('section select renders with all 7 sections in order',
    ['Prep', 'Off the tee', 'Side toss', 'Front toss', 'BP', 'Machine', 'Other']
      .every((l, i, a) => {
        const re = new RegExp(`<option value="[a-zA-Z]+">${l}</option>`);
        if (!re.test(cf2)) return false;
        return i === 0 || cf2.indexOf(`>${a[i - 1]}</option>`) < cf2.indexOf(`>${l}</option>`);
      }));
  check('all 7 hidden section inputs render', ['sec_prep', 'sec_tee', 'sec_sidetoss', 'sec_fronttoss', 'sec_bp', 'sec_machine', 'sec_other']
    .every((f) => cf2.includes(`name="${f}"`)));
  // Decode the HTML-escaped options JSON into a parsed object for assertions.
  const drillOptsOf = (html) => {
    const m = html.match(/<script type="application\/json" id="drill-options">([\s\S]*?)<\/script>/);
    if (!m) return { recent: [], registry: [] };
    const raw = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    try { return JSON.parse(raw); } catch (e) { return { recent: [], registry: [] }; }
  };
  const allOpts = (o) => [...(o.recent || []), ...(o.registry || [])];
  const hasOpt = (o, name, section) => allOpts(o).some((x) => x.name === name && x.section === section);
  const opts2 = drillOptsOf(cf2);
  check('history drills land in the options JSON with their section, bare names',
    hasOpt(opts2, 'Fence Drill', 'tee') && hasOpt(opts2, 'Walk In', 'other') &&
    !allOpts(opts2).some((x) => x.name.includes('(Tee)')));
  check('blank-counts-as-none hint renders', cf2.includes('blank counts as none'));
  // Bobby Sep 18 2026: dropdown styles present and compact.
  const css = fs.readFileSync(path.join(CWD, 'public/style.css'), 'utf8');
  check('dropdown menu styles present', /\.drill-menu\s*\{/.test(css) && /\.drill-option\s*\{/.test(css));
  check('token styles present', /\.drill-token\s*\{/.test(css));
  // Pregame subtitle (Bobby, Sep 17 2026): hitter form only.
  const cfSub = views.checkinForm({ role: 'athlete' }, null, {}, [], [], {});
  check('drills subtitle element present with default text',
    cfSub.includes('id="drills-subtitle"') && cfSub.includes('data-default="Everything you did'));
  check('combined form keeps no pregame subtitle', !views.combinedCheckinForm({ role: 'athlete' }, null, {}).includes('drills-subtitle'));
  const checkinSrc = fs.readFileSync(path.join(CWD, 'public/checkin.js'), 'utf8');
  check('subtitle switches for Game', checkinSrc.includes('Your pregame prep') && checkinSrc.includes('what did you do to get ready?'));
  check('subtitle switches for Live BP', checkinSrc.includes('What did you do to get ready for live BP?'));
  check('subtitle watches the environment radios',
    checkinSrc.includes("getElementById('drills-subtitle')") && checkinSrc.includes('input[name="environment"]'));
  const cfP = views.checkinForm({ role: 'athlete' }, null, {}, [], [],
    { prep: ['Arm Circles (Prep)'], tee: ['Fence Drill (Tee)'], sideToss: [], frontToss: [], bp: [], machine: [], other: [] });
  const optsP = drillOptsOf(cfP);
  check('options JSON carries the prep-tagged drill under the prep section',
    hasOpt(optsP, 'Arm Circles', 'prep') && !allOpts(optsP).some((x) => x.name.includes('(Prep)')));
  check('seeded tokens render for pre-filled sections', cfP.includes('id="drill-initial"'));
  const cf3 = views.checkinForm({ role: 'athlete' }, null, {}, [], [{ name: 'Fence Drill', station: 'Tee' }], {});
  check('routine button renders when routine set', cf3.includes('id="use-routine"'));
  check('routine button + edit link sit at the top of the drills block (before the combobox)',
    cf3.indexOf('id="use-routine"') < cf3.indexOf('id="drill-input"') &&
    cf3.indexOf('Edit daily routine') < cf3.indexOf('id="drill-input"'));

  // ---- Unit: drill-field pure helpers in public/app.js (extracted from source) ----
  const appSrc = fs.readFileSync(path.join(CWD, 'public/app.js'), 'utf8');
  function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('fn not found: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    throw new Error('unbalanced braces: ' + name);
  }
  const sectionKeyForStation = new Function(extractFn(appSrc, 'sectionKeyForStation') + '; return sectionKeyForStation;')();
  const addDrillToken = new Function(extractFn(appSrc, 'addDrillToken') + '; return addDrillToken;')();
  const serializeDrillTokens = new Function(extractFn(appSrc, 'serializeDrillTokens') + '; return serializeDrillTokens;')();
  // Routine station -> picker section key.
  check('station maps to its section key',
    sectionKeyForStation('Prep') === 'prep' && sectionKeyForStation('Tee') === 'tee' &&
    sectionKeyForStation('Side toss') === 'sideToss' && sectionKeyForStation('Front toss') === 'frontToss' &&
    sectionKeyForStation('BP') === 'bp' && sectionKeyForStation('Batting Practice') === 'bp' &&
    sectionKeyForStation('Machine') === 'machine');
  check('unknown/blank station maps to other', sectionKeyForStation('') === 'other' && sectionKeyForStation('Cage') === 'other');
  // Token add: no dupes (case-insensitive on name+section), no blanks.
  const toks = [];
  check('token add works', addDrillToken(toks, 'Fence Drill', 'tee') === true && toks.length === 1);
  check('token add rejects dupes case-insensitively', addDrillToken(toks, 'fence drill', 'tee') === false && toks.length === 1);
  check('same name in another section is a separate token', addDrillToken(toks, 'Fence Drill', 'bp') === true && toks.length === 2);
  check('token add rejects blanks', addDrillToken(toks, '   ', 'tee') === false && toks.length === 2);
  // Serialize: per-section comma-joined, every key present, blank = none.
  const ser = serializeDrillTokens([{ name: 'A', section: 'prep' }, { name: 'B', section: 'tee' }, { name: 'C', section: 'tee' }]);
  check('serialize groups by section', ser.prep === 'A' && ser.tee === 'B, C');
  check('serialize keeps every section key present', ['prep', 'tee', 'sideToss', 'frontToss', 'bp', 'machine', 'other'].every((k) => typeof ser[k] === 'string'));
  check('serialize of empty tokens is all blank (none)', Object.values(serializeDrillTokens([])).every((v) => v === ''));

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

    // ---- Coach notifications master switch (Bobby, Sep 17 2026) ----
    const coachRow = q('SELECT id FROM users WHERE email = ?', 'coach@test.com');
    let r = await req('GET', '/settings', null, 'coach');
    check('GET /settings 200 for coach', r.status === 200);
    check('settings shows Notifications card', r.text.includes('>Notifications</h2>'));
    check('settings shows turn-on button when unsubscribed', r.text.includes('id="push-enable-btn"'));
    r = await req('GET', '/coach', null, 'coach');
    check('dashboard nudges to turn on notifications', r.status === 200 && r.text.includes('so you never miss an approval'));
    run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)',
      coachRow.id, 'https://example.com/ep1', 'p256dh1', 'auth1', now);
    r = await req('GET', '/settings', null, 'coach');
    check('settings shows On badge when subscribed', r.text.includes('<span class="badge ok">On</span>'));
    check('settings shows turn-off form when subscribed', r.text.includes('/settings/push/off'));
    r = await req('GET', '/coach', null, 'coach');
    check('dashboard nudge hidden once subscribed', !r.text.includes('so you never miss an approval'));
    r = await req('POST', '/settings/push/off', P({}), 'coach');
    check('POST /settings/push/off clears subscriptions',
      r.status === 302 && qall('SELECT * FROM push_subscriptions WHERE user_id = ?', coachRow.id).length === 0);
    r = await req('GET', '/settings', null, 'coach');
    check('settings back to Off after turn-off', r.text.includes('id="push-enable-btn"'));
    r = await req('GET', '/settings', null, 'cam');
    check('view-only Cam gets no Notifications card', r.status === 200 && !r.text.includes('>Notifications</h2>'));

    r = await req('GET', '/coach/my-players', null, 'coach');
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

    // ---- "What did you do today?" — searchable dropdown (Bobby, Sep 18 2026) ----
    const chipAthlete = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'chips@test.com', h, 'athlete', 'Chip', 'Chip', 'Hitter', now, 'approved').lastInsertRowid;
    const addCheckin = (uid, drills, created) => run(`INSERT INTO checkins (user_id, athlete_name, created_at, drills_done) VALUES (?,?,?,?)`,
      uid, 'Chip Hitter', created, JSON.stringify(drills));
    addCheckin(chipAthlete, ['Old Drill One', 'Walk In Drill (side toss)'], '2026-09-10T10:00:00');
    addCheckin(chipAthlete, [{ name: 'Fence Drill', station: 'Tee' }, 'Tee', 'New Drill Two'], '2026-09-12T10:00:00');
    addCheckin(chipAthlete, ['prep'], '2026-09-11T10:00:00'); // literal "prep" -> prep section
    await login('chips', 'chips@test.com');
    r = await req('GET', '/checkin', null, 'chips');
    html = r.text;
    check('check-in 200 for hitter', r.status === 200);
    check('"What did you do today?" heading in form', html.includes('What did you do today?'));
    check('no did_drills gate in form', !html.includes('name="did_drills"') && !html.includes('Did you do any drills?'));
    check('no single drills_done input anymore', !html.includes('name="drills_done"') && !html.includes('id="drills-input"'));
    check('drills block before Feel slider', html.indexOf('What did you do today?') < html.indexOf('name="feel"'));
    // One combobox + section select + token tray + 7 hidden section inputs.
    check('drill combobox renders', html.includes('id="drill-input"') && html.includes('id="drill-menu"') && html.includes('id="drill-tokens"'));
    const secNames = ['sec_prep', 'sec_tee', 'sec_sidetoss', 'sec_fronttoss', 'sec_bp', 'sec_machine', 'sec_other'];
    check('7 hidden section inputs render in order',
      secNames.every((n) => html.includes(`name="${n}"`)) &&
      secNames.every((n, i, a) => i === 0 || html.indexOf(`name="${a[i-1]}"`) < html.indexOf(`name="${n}"`)));
    check('section select options in order',
      ['Prep', 'Off the tee', 'Side toss', 'Front toss', 'BP', 'Machine', 'Other']
        .every((l, i, a) => i === 0 || html.indexOf(`>${a[i-1]}</option>`) < html.indexOf(`>${l}</option>`)));
    check('routine button + edit link above the combobox',
      html.indexOf('Edit daily routine') < html.indexOf('id="drill-input"'));
    // History drills land in the options JSON with their section, bare names.
    const hasOptH = (name, section) => hasOpt(drillOptsOf(html), name, section);
    check('tee history drill tagged tee in options', hasOptH('Fence Drill', 'tee'));
    check('side toss history drill tagged sideToss in options', hasOptH('Walk In Drill', 'sideToss'));
    check('untagged history drills land in other', hasOptH('Old Drill One', 'other') && hasOptH('New Drill Two', 'other'));
    check('literal "prep" drill is a prep option', hasOptH('prep', 'prep'));
    check('options use bare names (no trailing tags)',
      !allOpts(drillOptsOf(html)).some((x) => /\(tee\)|\(side toss\)/i.test(x.name)));
    // Case-insensitive dedupe across sections (string tag vs object station).
    addCheckin(chipAthlete, ['fence drill (TEE)'], '2026-09-13T10:00:00');
    r = await req('GET', '/checkin', null, 'chips');
    html = r.text;
    const optsDedupe = drillOptsOf(html);
    const fenceOpts = allOpts(optsDedupe).filter((x) => x.name.toLowerCase() === 'fence drill').length;
    check('case-insensitive dedupe across sections', fenceOpts === 1);
    // Cap at 8 per section (all untagged → Other): D9/D10 fall off recent.
    const capAthlete = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'cap@test.com', h, 'athlete', 'Cap', 'Cap', 'Tester', now, 'approved').lastInsertRowid;
    addCheckin(capAthlete, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'], '2026-09-12T10:00:00');
    await login('cap', 'cap@test.com');
    r = await req('GET', '/checkin', null, 'cap');
    html = r.text;
    const capOpts = drillOptsOf(html);
    const capNames = allOpts(capOpts).map((x) => x.name);
    check('recent options capped at 8 per section', !capNames.includes('D9') && !capNames.includes('D10') && capNames.includes('D8'));
    // No history: combobox still renders, recent group empty.
    await login('briggs', 'briggs@test.com');
    r = await req('GET', '/checkin', null, 'briggs');
    html = r.text;
    check('combobox renders for player with no history',
      html.includes('id="drill-input"') && secNames.every((n) => html.includes(`name="${n}"`)));

    // ---- C: check-in push gating ----
    // Gate SQL mirrors isMyProgramPlayer() in src/server.js exactly.
    const gate = (uid) => !!q('SELECT 1 FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? AND o.is_mine = 1', uid);
    // Tri-state alert pref mirrors wantsCheckinNotify(): 1 = always, 0 = never,
    // NULL = default rule (notify only for his program players).
    const effOn = (uid) => { const f = q('SELECT notify_on_checkin AS f FROM users WHERE id = ?', uid).f; return f === 1 || (f == null && gate(uid)); };
    const solo = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      'solo@test.com', h, 'athlete', 'Solo', 'Solo', 'Player', now, 'approved').lastInsertRowid;
    const msuPlayer = run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,organization_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      'msu@test.com', h, 'athlete', 'Msu', 'Msu', 'Bear', now, 'approved', orgIdOf('Missouri State')).lastInsertRowid;
    check('gate: is_mine-org player would notify', gate(briggs) === true);
    check('gate: standalone player stays silent', gate(solo) === false);
    check('gate: non-mine-org player stays silent', gate(msuPlayer) === false);
    // Per-player log alerts (Bobby, Sep 17 2026): tri-state, any athlete.
    check('program player defaults to alerts on', effOn(briggs) === true);
    check('standalone player defaults to alerts off', effOn(solo) === false);
    check('other-org player defaults to alerts off', effOn(msuPlayer) === false);
    r = await req('POST', `/coach/player/${solo}/notify-checkin`, P({ back: '/coach/hitters' }), 'coach');
    check('toggle turns alerts ON for non-program player', r.status === 302 && r.loc === '/coach/hitters' && effOn(solo) === true);
    r = await req('POST', `/coach/player/${briggs}/notify-checkin`, P({ back: '/coach/my-players' }), 'coach');
    check('toggle turns alerts OFF for program player', r.status === 302 && effOn(briggs) === false);
    r = await req('POST', `/coach/player/${briggs}/notify-checkin`, P({}), 'cam');
    check('view-only coach 403 on alert toggle', r.status === 403 && effOn(briggs) === false);
    r = await req('POST', '/coach/player/99999/notify-checkin', P({}), 'coach');
    check('alert toggle 404 for unknown athlete', r.status === 404);
    r = await req('GET', '/coach/my-players', null, 'coach');
    check('My Players shows alert toggle', r.text.includes(`/coach/player/${briggs}/notify-checkin`) && r.text.includes('Alerts off'));
    r = await req('GET', '/coach/hitters', null, 'coach');
    check('All Players shows alert toggle', r.text.includes(`/coach/player/${solo}/notify-checkin`));
    // Restore briggs to default so later tests see the standard gate behavior.
    await req('POST', `/coach/player/${briggs}/notify-checkin`, P({}), 'coach');
    check('toggle back on restores default-on', effOn(briggs) === true);
    // The notify hook never breaks the check-in redirect (push off in tests).
    // Drills are optional now — no did_drills gate, blank is fine.
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', session_notes: 'Felt locked in today.', what_worked: '' }), 'briggs');
    check('POST /checkin with blank drills succeeds', r.status === 302 && (r.loc || '').startsWith('/checkin/score/'));
    check('blank drills stored as empty array', q(`SELECT drills_done FROM checkins WHERE user_id = ? ORDER BY id DESC LIMIT 1`, briggs).drills_done === '[]');
    // Session notes are required (Bobby, Sep 17 2026); "where were you"
    // (environment) already was — both are enforced server-side too.
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', session_notes: '   ', what_worked: '' }), 'briggs');
    check('POST /checkin with blank session notes fails', r.status === 200 && r.text.includes('Write a few session notes'));
    r = await req('POST', '/checkin', P({ feel: '7', confidence: '7', focus: '7', difficulty: '5', session_notes: 'Felt good.', what_worked: '' }), 'briggs');
    check('POST /checkin with no environment fails', r.status === 200 && r.text.includes('Pick the environment you were in.'));
    const vjs = fs.readFileSync(path.join(CWD, 'public/checkin.js'), 'utf8');
    check('client validator requires session notes', vjs.includes("missing('session_notes'"));
    // Sectioned submit: each section's input gets its section tag; Other keeps no tag.
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', sec_tee: 'Fence Drill, Walk In Drill', sec_bp: 'BP Rounds', sec_other: 'Random Work', session_notes: 'Felt locked in today.', what_worked: '' }), 'briggs');
    check('POST /checkin with sectioned drills succeeds', r.status === 302 && (r.loc || '').startsWith('/checkin/score/'));
    const stored = q(`SELECT drills_done FROM checkins WHERE user_id = ? ORDER BY id DESC LIMIT 1`, briggs).drills_done;
    const storedArr = JSON.parse(stored);
    check('section tags attached on save',
      storedArr.some((d) => d.name === 'Fence Drill' && d.station === 'Tee') &&
      storedArr.some((d) => d.name === 'BP Rounds' && d.station === 'BP') &&
      storedArr.some((d) => d.name === 'Random Work' && !d.station));
    check('sections stored in section order',
      storedArr.map((d) => d.name).join('|') === 'Fence Drill|Walk In Drill|BP Rounds|Random Work');
    // Explicit (tag) in a section input wins over the section tag.
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', sec_tee: 'Fence Drill (machine)', session_notes: 'Felt locked in today.', what_worked: '' }), 'briggs');
    const stored2 = JSON.parse(q(`SELECT drills_done FROM checkins WHERE user_id = ? ORDER BY id DESC LIMIT 1`, briggs).drills_done);
    check('explicit tag kept over section tag', stored2.some((d) => d.name === 'Fence Drill' && d.station === 'Machine'));
    // Skip keeps learning from the sectioned drills field: three scored
    // check-ins with a registry drill, then confirm it shows up in the
    // hitter's history picker AND in Skip's drill-derived what-works data.
    for (let i = 0; i < 3; i++) {
      r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '8', confidence: '8', focus: '8', difficulty: '5', sec_tee: 'Deep Tee Drill', session_notes: 'Felt locked in today.', what_worked: '' }), 'briggs');
      check(`check-in ${i + 1} with Deep Tee Drill posts clean`, r.status === 302);
    }
    r = await req('GET', '/checkin', null, 'briggs');
    check('submitted drill appears in the dropdown options (tee)', hasOpt(drillOptsOf(r.text), 'Deep Tee Drill', 'tee'));
    r = await req('GET', '/', null, 'briggs');
    check("Skip's what-works learned the drill", r.text.includes('What you did on good days') && r.text.includes('Deep Tee Drill'));

    // ---- Remote-program pre-fill: today's scheduled work lands in
    // "What did you do today?" on the initial GET (Bobby, Sep 17 2026) ----
    // Build the schedule around today's actual Chicago weekday.
    const chiWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(new Date());
    const progJson = {
      routine: [
        { category: 'Daily Routine', items: [{ drill: 'No Stride Launch' }, { drill: 'Open 45 w Stride' }] },
        { category: 'Day 1 \u2014 Tee', items: [{ drill: 'Deep Tee Drill' }, { drill: 'High Tee' }] },
        { category: 'Day 1 \u2014 Side Flips', items: [{ drill: 'Side Flip Work' }] },
        { category: 'Day 2 \u2014 BP', items: [{ drill: 'BP Rounds' }] },
      ],
      schedule: [[chiWeekday, 'Day 1']],
    };
    const progId = run(`INSERT INTO remote_programs (athlete_name, program_json, updated_at) VALUES (?,?,?)`,
      'Remy Remote', JSON.stringify(progJson), now).lastInsertRowid;
    const remy = addAthlete('remy@test.com', 'Remy', 'Remote');
    run('UPDATE users SET remote_program_id = ?, organization_id = ? WHERE id = ?', progId, orgIdOf('Atkinson Hitting'), remy);
    await login('remy', 'remy@test.com');
    const secVal = (html, field) => (html.match(new RegExp(`id="${field}"[^>]*value="([^"]*)"`)) || [])[1];
    r = await req('GET', '/checkin', null, 'remy');
    check('remote pre-fill: Daily Routine lands in prep',
      secVal(r.text, 'sec_prep') === 'No Stride Launch, Open 45 w Stride');
    check('remote pre-fill: "Day 1 \\u2014 Tee" lands in the tee section',
      secVal(r.text, 'sec_tee') === 'Deep Tee Drill, High Tee');
    check('remote pre-fill: "Day 1 \\u2014 Side Flips" lands in side toss',
      secVal(r.text, 'sec_sidetoss') === 'Side Flip Work');
    check('remote pre-fill: unmatched day stays blank', secVal(r.text, 'sec_bp') === '');
    // OFF day -> all sections blank.
    progJson.schedule = [[chiWeekday, 'OFF']];
    run('UPDATE remote_programs SET program_json = ? WHERE id = ?', JSON.stringify(progJson), progId);
    r = await req('GET', '/checkin', null, 'remy');
    check('OFF day leaves every section blank',
      ['sec_prep', 'sec_tee', 'sec_sidetoss', 'sec_fronttoss', 'sec_bp', 'sec_machine', 'sec_other']
        .every((f) => secVal(r.text, f) === ''));
    // POST fail path preserves the submitted section values, never re-prefills.
    progJson.schedule = [[chiWeekday, 'Day 1']];
    run('UPDATE remote_programs SET program_json = ? WHERE id = ?', JSON.stringify(progJson), progId);
    r = await req('POST', '/checkin', P({ environment: 'Bogus', feel: '8', confidence: '8', focus: '8', difficulty: '5', sec_tee: 'My Custom Work', sec_bp: 'BP Stuff', session_notes: 'Felt locked in today.', what_worked: '' }), 'remy');
    check('POST fail preserves submitted section values',
      r.status === 200 && secVal(r.text, 'sec_tee') === 'My Custom Work' && secVal(r.text, 'sec_bp') === 'BP Stuff' &&
      !r.text.includes('value="No Stride Launch'));
    // Non-remote player: no pre-fill (section inputs blank even with history).
    r = await req('GET', '/checkin', null, 'briggs');
    check('non-remote player gets no pre-fill',
      ['sec_prep', 'sec_tee', 'sec_sidetoss', 'sec_fronttoss', 'sec_bp', 'sec_machine', 'sec_other']
        .every((f) => secVal(r.text, f) === ''));

    // ---- Tab bar: Program INSTEAD of Messages for remote players ----
    r = await req('GET', '/', null, 'remy');
    const tabbar = (r.text.match(/<nav id="tabbar"[\s\S]*?<\/nav>/) || [''])[0];
    check('remote tab bar shows Program', tabbar.includes('href="/program"'));
    check('remote tab bar hides Messages', !tabbar.includes('href="/messages"'));
    check('remote drawer still lists Messages', r.text.includes('href="/messages"'));
    r = await req('GET', '/', null, 'briggs');
    const tabbar2 = (r.text.match(/<nav id="tabbar"[\s\S]*?<\/nav>/) || [''])[0];
    check('non-remote tab bar still shows Messages', tabbar2.includes('href="/messages"'));
    check('non-remote tab bar has no Program', !tabbar2.includes('href="/program"'));

    // ---- Pregame prep learning (Bobby, Sep 17 2026): Skip-side only ----
    const srvSrc = fs.readFileSync(path.join(CWD, 'src/server.js'), 'utf8');
    check('game-day entries labeled pregame prep in Skip data',
      srvSrc.includes("Pregame prep \\u2014 what he did to get ready") && srvSrc.includes("r.environment === 'Game' || r.environment === 'Live BP'"));
    check('pregame line in Skip data block', srvSrc.includes('Pregame prep tied to his best games'));
    check('pregame ranking filters Game/Live BP only', srvSrc.includes("environment IN ('Game', 'Live BP')"));
    check('pregame ranking keeps the min-3-sessions threshold',
      /function pregamePrepStats[\s\S]*?\.filter\(\(e\) => e\.count >= 3\)/.test(srvSrc));
    // Ranking semantics, mirrored from pregamePrepStats (same pattern the
    // suite uses for isMyProgramPlayer): 3 Game check-ins qualify, 2 Live BP
    // stay under threshold, 5 Cage + 4 Tee Work must not pollute it.
    const pg = addAthlete('pregame@test.com', 'Pregame', 'Pete');
    await login('pg', 'pregame@test.com');
    const postG = (env, drills) => req('POST', '/checkin',
      P({ environment: env, feel: '8', confidence: '8', focus: '8', difficulty: '5', sec_tee: drills, session_notes: 'Felt locked in today.', what_worked: '' }), 'pg');
    for (let i = 0; i < 3; i++) await postG('Game', 'Deep Tee Drill');
    for (let i = 0; i < 2; i++) await postG('Live BP', 'Ball Drop Drill');
    for (let i = 0; i < 5; i++) await postG('Cage', 'Flat Bat High Tee');
    for (let i = 0; i < 4; i++) await postG('Tee Work', 'Deep Tee');
    const tally = (rows) => {
      const map = new Map();
      for (const r of rows) {
        for (const d of JSON.parse(r.drills_done || '[]')) {
          const k = String(d.name || '').toLowerCase();
          if (!k || (r._seen && r._seen.has(k))) continue;
          (r._seen = r._seen || new Set()).add(k);
          const e = map.get(k) || { name: d.name, total: 0, count: 0 };
          e.total += r.session_score; e.count += 1; map.set(k, e);
        }
      }
      return [...map.values()].filter((e) => e.count >= 3).map((e) => e.name);
    };
    const preRows = qall(
      "SELECT drills_done, session_score FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL AND environment IN ('Game', 'Live BP')",
      'Pregame Pete');
    const preNames = tally(preRows).map((n) => n.toLowerCase());
    check('pregame ranking includes the 3-game drill', preNames.includes('deep tee drill'));
    check('below-threshold Live BP drill excluded', !preNames.includes('ball drop drill'));
    check('Cage training days do not pollute pregame ranking', !preNames.includes('flat bat high tee'));
    check('Tee Work training days do not pollute pregame ranking', !preNames.includes('deep tee'));

    // ---- D (revised): coach/player messaging — 1:1 + broadcast + inbox ----
    check('messages table exists', !!q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'"));
    check('message_recipients table exists', !!q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_recipients'"));
    const bobbyId = q("SELECT id FROM users WHERE email = 'coach@test.com'").id;
    r = await req('GET', '/coach/my-players', null, 'coach');
    html = r.text;
    check('broadcast composer gone from My Players', !html.includes('Message my players') && !html.includes('/coach/my-players/message'));
    check('per-player Message links on My Players', html.includes(`/coach/messages/${briggs}`) && html.includes(`/coach/messages/${liam}`));
    // Compose screen: clean picker, not a giant checklist.
    r = await req('GET', '/coach/messages/new', null, 'coach');
    html = r.text;
    check('compose page renders picker', html.includes('All my players') && html.includes('Choose players') && html.includes('id="compose-search"'));
    check('compose page posts to new endpoint', html.includes('action="/coach/messages/new"'));
    check('compose page lists players as checkboxes', html.includes(`name="user_ids" value="${briggs}"`));
    check('compose textarea has live char count', html.includes('id="char-count"') && html.includes('maxlength="500"'));
    r = await req('GET', '/coach/messages/new', null, 'cam');
    check('view-only coach can read compose page', r.status === 200);
    const msgCount = () => q('SELECT COUNT(*) AS c FROM messages').c;
    const unreadFor = (uid) => q('SELECT COUNT(*) AS c FROM message_recipients WHERE user_id = ? AND read_at IS NULL', uid).c;
    const myOrgCount = () => q('SELECT COUNT(*) AS c FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.role = ? AND o.is_mine = 1', 'athlete').c;
    // Broadcast to "All my players".
    const msgBefore = msgCount();
    const allN = myOrgCount();
    r = await req('POST', '/coach/messages/new', P({ to_mode: 'all', body: 'Big week — check in daily.' }), 'coach');
    check('broadcast-all redirects with sent count', r.status === 302 && (r.loc || '').includes('/coach/messages') && (r.loc || '').includes('sent=' + allN));
    check('broadcast-all: one message row, recipient_id NULL', msgCount() === msgBefore + 1 && q('SELECT recipient_id FROM messages ORDER BY id DESC LIMIT 1').recipient_id === null);
    check('broadcast-all reaches every my-org player only',
      q('SELECT COUNT(*) AS c FROM message_recipients').c === allN && unreadFor(briggs) === 1 && unreadFor(solo) === 0 && unreadFor(msuPlayer) === 0);
    // Broadcast to a subset; invalid ids ignored; only my-players get rows.
    const p2 = new URLSearchParams();
    p2.append('to_mode', 'choose');
    p2.append('body', 'Nice work this week.');
    p2.append('user_ids', String(briggs));
    p2.append('user_ids', '99999'); // not a player — must be ignored
    r = await req('POST', '/coach/messages/new', p2, 'coach');
    check('broadcast-subset redirects with sent=1', r.status === 302 && (r.loc || '').includes('sent=1'));
    check('broadcast-subset: only briggs gets a row', unreadFor(briggs) === 2 && unreadFor(liam) === 1 && unreadFor(dylan) === 1);
    r = await req('GET', '/coach/messages?sent=2', null, 'coach');
    check('sent confirmation renders on hub', r.text.includes('Sent</strong> to 2 players'));
    check('hub has New message button', r.text.includes('href="/coach/messages/new"') && r.text.includes('New message'));
    r = await req('POST', '/coach/messages/new', P({ to_mode: 'all', body: '   ' }), 'coach');
    check('empty body rejected', r.status === 302 && (r.loc || '').includes('/coach/messages/new') && (r.loc || '').includes('error=') && msgCount() === msgBefore + 2);
    r = await req('POST', '/coach/messages/new', P({ to_mode: 'choose', body: 'hi' }), 'coach');
    check('choose-mode with no players rejected', r.status === 302 && (r.loc || '').includes('error=') && msgCount() === msgBefore + 2);
    // Booking links in messages must be tappable (Bobby, Sep 17 2026).
    const p3 = new URLSearchParams();
    p3.append('to_mode', 'choose');
    p3.append('body', 'Schedule is live for next week! https://calendly.com/atkinsonhitting');
    p3.append('user_ids', String(briggs));
    r = await req('POST', '/coach/messages/new', p3, 'coach');
    check('message with booking link sends', r.status === 302 && (r.loc || '').includes('sent=1'));
    r = await req('GET', `/coach/messages/${briggs}`, null, 'coach');
    check('coach thread renders the link as a clickable anchor', r.status === 200 && r.text.includes('<a href="https://calendly.com/atkinsonhitting" target="_blank"'));
    r = await req('POST', '/coach/messages/new', P({ to_mode: 'all', body: 'hi' }), 'cam');
    check('view-only coach 403 on broadcast', r.status === 403 && msgCount() === msgBefore + 3);
    r = await req('POST', '/coach/my-players/message', P({ to_mode: 'all', body: 'hi' }), 'coach');
    check('old broadcast route is gone', r.status === 404);
    // Per-hitter page has the Message button (my-org player only).
    r = await req('GET', '/coach/user/briggs@test.com', null, 'coach');
    check('per-hitter page has Message button', r.text.includes(`/coach/messages/${briggs}`));
    r = await req('GET', '/coach/user/solo@test.com', null, 'coach');
    check('per-hitter page hides Message for non-my-org player', !r.text.includes('/coach/messages/' + solo));
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
    check('player unread counts all four messages', unreadFor(briggs) === 4);
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
    // Coach tab bar: Messages instead of Train Skip (Bobby, Sep 17 2026).
    const ctab = (r.text.match(/<nav id="tabbar"[\s\S]*?<\/nav>/) || [''])[0];
    check('coach tab bar has Messages', ctab.includes('href="/coach/messages"'));
    check('coach tab bar no longer has Train Skip', !ctab.includes('href="/coach/skip"'));
    check('drawer still has Train Skip', r.text.includes('class="drawer-link') && r.text.includes('href="/coach/skip"'));
    r = await req('GET', '/coach/messages/' + briggs, null, 'coach');
    check('thread shows both directions', r.text.includes('Thanks coach!') && r.text.includes('Keep it up.'));
    check('thread view marks coach rows read', unreadFor(bobbyId) === 0);
    // Player tab bar: Messages tab with unread badge; badge hidden at zero.
    await login('briggs', 'briggs@test.com');
    r = await req('GET', '/', null, 'briggs');
    check('tab bar has Messages tab', r.text.includes('href="/messages"') && r.text.includes('>Messages<'));
    check('tab bar badge shows unread count', r.text.includes('<span class="tabbar-badge">4</span>'));
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
    // ---- Hitter self-serve check-in edit + delete (Bobby, Sep 17 2026) ----
    const edith = addAthlete('edith@test.com', 'Edith', 'Hitter');
    const otherh = addAthlete('otherh@test.com', 'Other', 'Hitter');
    const mkCheckin = (uid, cols) => run(
      `INSERT INTO checkins (user_id, athlete_name, created_at, environment, drills_done, feel, confidence, focus, difficulty, session_score, score_tier, session_notes, what_worked, session_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid, 'Edith Hitter', cols.created_at, cols.environment || '', cols.drills_done || '[]',
      cols.feel ?? 7, cols.confidence ?? 7, cols.focus ?? 7, cols.difficulty ?? 5,
      cols.session_score ?? 7, cols.score_tier || 'Solid', cols.session_notes || 'notes', cols.what_worked || '',
      cols.session_kind || 'hitting');
    const hitId = mkCheckin(edith, {
      created_at: '2026-09-14T10:00:00', environment: 'Cage',
      drills_done: JSON.stringify([{ name: 'Fence Drill', station: 'Tee', known: true }]),
      session_notes: 'original notes',
    }).lastInsertRowid;
    const pitchId = run(
      `INSERT INTO checkins (user_id, athlete_name, created_at, session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown, feel, focus, confidence, session_score, score_tier, felt_good) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      edith, 'Edith Hitter', '2026-09-13T10:00:00', 'pitching', 'bullpen', 'medium', 6, 30,
      JSON.stringify(['4-seam FB']), 7, 7, 7, 7, 'Solid', 'arm felt free').lastInsertRowid;
    const combId = run(
      `INSERT INTO checkins (user_id, athlete_name, created_at, environment, difficulty, session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown, feel, focus, confidence, session_score, score_tier, hitting_score, pitching_score, felt_good) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      edith, 'Edith Hitter', '2026-09-12T10:00:00', 'Cage', 6, 'combined', 'bullpen', 'medium', 6, 25,
      JSON.stringify(['4-seam FB']), 7, 7, 7, 7, 'Solid', 7, 7, 'both felt ok').lastInsertRowid;
    await login('edith', 'edith@test.com');
    await login('otherh', 'otherh@test.com');

    // Notebook cards carry Edit/Delete for the hitter's own entries.
    r = await req('GET', '/notebook', null, 'edith');
    check('notebook shows Edit link for own entry', r.text.includes(`/checkin/${hitId}/edit`));
    check('notebook shows Delete link for own entry', r.text.includes(`/checkin/${hitId}/delete`));

    // Edit page: same hitting form, pre-filled.
    r = await req('GET', `/checkin/${hitId}/edit`, null, 'edith');
    html = r.text;
    check('edit page 200 with Edit heading', r.status === 200 && html.includes('>Edit check-in</h1>'));
    check('edit posts back to the entry', html.includes(`action="/checkin/${hitId}"`));
    check('edit prefills environment', html.includes('value="Cage" checked'));
    check('edit prefills session notes', html.includes('>original notes</textarea>'));
    check('edit prefills drill section', html.includes('value="Fence Drill"'));
    check('edit submit says Save changes', html.includes('>Save changes<'));

    // POST update: fields change, score recomputed, date kept.
    r = await req('POST', `/checkin/${hitId}`, P({
      environment: 'Tee Work', feel: '9', confidence: '9', focus: '9', difficulty: '5',
      session_notes: 'updated notes', what_worked: 'staying inside it', sec_tee: 'Walk In Drill',
    }), 'edith');
    check('update redirects to the score page', r.status === 302 && r.loc === `/checkin/score/${hitId}`);
    const upd = q('SELECT * FROM checkins WHERE id = ?', hitId);
    check('update changed environment', upd.environment === 'Tee Work');
    check('update changed notes', upd.session_notes === 'updated notes');
    check('update changed drills', upd.drills_done.includes('Walk In Drill'));
    check('update recomputed the score', upd.session_score > 7 && upd.feel === 9);
    check('update kept the session date', String(upd.created_at).startsWith('2026-09-14'));
    check('update kept the kind', upd.session_kind === 'hitting');

    // Required session notes still enforced on edit.
    r = await req('POST', `/checkin/${hitId}`, P({
      environment: 'Cage', feel: '7', confidence: '7', focus: '7', difficulty: '5', session_notes: '   ',
    }), 'edith');
    check('blank notes rejected on edit', r.status === 200 && r.text.includes('Write a few session notes'));
    check('rejected edit changed nothing', q('SELECT environment FROM checkins WHERE id = ?', hitId).environment === 'Tee Work');

    // Pitching entry: pitching form pre-filled; update works.
    r = await req('GET', `/checkin/${pitchId}/edit`, null, 'edith');
    html = r.text;
    check('pitching edit uses the throwing form', r.status === 200 && html.includes('What kind of throwing was it?'));
    check('pitching edit prefills pitch count', html.includes('value="30"'));
    r = await req('POST', `/checkin/${pitchId}`, P({
      pitch_session_type: 'bullpen', intent: 'heavy', command: '8', pitch_count: '40',
      pitches_thrown: '4-seam FB', feel: '8', focus: '8', confidence: '8', felt_good: 'heavy day, felt strong',
    }), 'edith');
    check('pitching update redirects', r.status === 302 && r.loc === `/checkin/score/${pitchId}`);
    const updP = q('SELECT * FROM checkins WHERE id = ?', pitchId);
    check('pitching update changed count + intent', updP.pitch_count === 40 && updP.intent === 'heavy');
    check('pitching update kept the date', String(updP.created_at).startsWith('2026-09-13'));

    // Combined entry: combined form pre-filled.
    r = await req('GET', `/checkin/${combId}/edit`, null, 'edith');
    check('combined edit uses the combined form', r.status === 200 && r.text.includes('What did you do today?') && r.text.includes('>Edit check-in</h1>'));

    // Delete confirm + delete.
    r = await req('GET', `/checkin/${hitId}/delete`, null, 'edith');
    check('delete confirm page renders', r.status === 200 && r.text.includes('Delete this check-in?'));
    check('delete confirm posts to the entry', r.text.includes(`/checkin/${hitId}/delete`));
    r = await req('POST', `/checkin/${hitId}/delete`, P({}), 'edith');
    check('delete redirects to notebook', r.status === 302 && r.loc === '/notebook');
    check('delete removed the row', !q('SELECT id FROM checkins WHERE id = ?', hitId));

    // Ownership + roles: 403s and 404s.
    r = await req('GET', `/checkin/${pitchId}/edit`, null, 'otherh');
    check('other hitter cannot edit (GET)', r.status === 403);
    r = await req('POST', `/checkin/${pitchId}`, P({}), 'otherh');
    check('other hitter cannot update (POST)', r.status === 403);
    r = await req('POST', `/checkin/${pitchId}/delete`, P({}), 'otherh');
    check('other hitter cannot delete', r.status === 403);
    check('other hitter changed nothing', !!q('SELECT id FROM checkins WHERE id = ?', pitchId));
    r = await req('GET', `/checkin/${pitchId}/edit`, null, 'coach');
    check('Bobby cannot edit (GET)', r.status === 403);
    r = await req('POST', `/checkin/${pitchId}/delete`, P({}), 'coach');
    check('Bobby cannot delete', r.status === 403);
    r = await req('GET', `/checkin/${pitchId}/edit`, null, 'cam');
    check('Cam cannot edit', r.status === 403);
    r = await req('GET', '/checkin/999999/edit', null, 'edith');
    check('unknown entry 404s on edit', r.status === 404);
    r = await req('GET', '/checkin/999999/edit', null, 'coach');
    check('coach gets 403 even for unknown id', r.status === 403);
    r = await req('POST', '/checkin/999999/delete', P({}), 'edith');
    check('unknown entry 404s on delete', r.status === 404);

    // Notebook notes: edit works, self-serve only.
    const noteId = run(`INSERT INTO learning_notes (user_id, note, category, created_at) VALUES (?,?,?,?)`,
      edith, 'keep the front shoulder closed', 'Mechanics', '2026-09-14T10:00:00').lastInsertRowid;
    r = await req('GET', '/notebook', null, 'edith');
    check('notebook shows note Edit link', r.text.includes(`/learn/note/${noteId}/edit`));
    r = await req('GET', `/learn/note/${noteId}/edit`, null, 'edith');
    check('note edit page prefills', r.status === 200 && r.text.includes('keep the front shoulder closed'));
    r = await req('POST', `/learn/note/${noteId}`, P({ note: 'stay through it longer', category: 'Approach' }), 'edith');
    check('note update redirects', r.status === 302);
    const updN = q('SELECT note, category FROM learning_notes WHERE id = ?', noteId);
    check('note update saved', updN.note === 'stay through it longer' && updN.category === 'Approach');
    r = await req('GET', `/learn/note/${noteId}/edit`, null, 'otherh');
    check('other hitter cannot edit note', r.status === 403);
    r = await req('GET', `/learn/note/${noteId}/edit`, null, 'coach');
    check('Bobby cannot edit note', r.status === 403);
    r = await req('POST', `/learn/note/${noteId}/delete`, P({}), 'otherh');
    check('other hitter cannot delete note (403, not silent)', r.status === 403);
    check('note still there', !!q('SELECT id FROM learning_notes WHERE id = ?', noteId));

    // Study players: edit works, self-serve only.
    const plId = run(`INSERT INTO study_players (user_id, player_name, takeaway, created_at) VALUES (?,?,?,?)`,
      edith, 'Mookie Betts', 'short to it', '2026-09-14T10:00:00').lastInsertRowid;
    r = await req('GET', `/learn/player/${plId}/edit`, null, 'edith');
    check('player edit page prefills', r.status === 200 && r.text.includes('Mookie Betts'));
    r = await req('POST', `/learn/player/${plId}`, P({ player_name: 'Mookie Betts', takeaway: 'stays through it' }), 'edith');
    check('player update saved', q('SELECT takeaway FROM study_players WHERE id = ?', plId).takeaway === 'stays through it');
    r = await req('POST', `/learn/player/${plId}`, P({ player_name: 'Mookie Betts', takeaway: 'x' }), 'coach');
    check('Bobby cannot edit player', r.status === 403);

  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
