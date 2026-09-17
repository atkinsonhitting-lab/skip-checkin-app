// Pitchers + two-way players: full integration suite on a throwaway DB.
// Boots the real server, drives it over HTTP, and checks signup, roles,
// validation, session kinds, notebook/coach rendering, pre-check-ins,
// streak behavior, and Skip's pitcher isolation (static prompt checks).
const { spawn, execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const PORT = 3495, DB = '/tmp/pitcher-test.db', BASE = `http://127.0.0.1:${PORT}`, CWD = '/home/hatch/workspace/skip-push-deploy';
let failures = 0;
const check = (n, c) => { console.log((c ? '  ok - ' : '  FAIL - ') + n); if (!c) failures++; };
const chiFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const chiDay = (d) => chiFmt.format(d instanceof Date ? d : new Date(d));
const chiYesterday = () => { const d = new Date(Date.now() - 864e5); return chiFmt.format(d); };

async function main() {
  fs.rmSync(DB, { force: true });
  // 1. Fresh boot creates the schema with all new columns.
  execSync(`DB_PATH=${DB} PORT=3499 SESSION_SECRET=t SKIP_API_KEY=t timeout 12 node src/server.js > /dev/null 2>&1 || true`, { cwd: CWD, timeout: 30000 });
  const run = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).run(...a); } finally { d.close(); } };
  const q = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).get(...a); } finally { d.close(); } };
  const qall = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).all(...a); } finally { d.close(); } };
  const cols = (t) => qall(`PRAGMA table_info(${t})`).map((c) => c.name);
  const ucols = cols('users'), ccols = cols('checkins'), pcols = cols('pre_checkins');
  check('users.player_type exists', ucols.includes('player_type'));
  for (const c of ['session_kind','pitch_session_type','intent','command','pitch_count','pitches_thrown','velo_max','catch_distance','recovery_notes','no_throw_note','felt_good','what_was_working','biggest_struggle','hitting_score','pitching_score'])
    check(`checkins.${c} exists`, ccols.includes(c));
  check('pre_checkins.throw_intent exists', pcols.includes('throw_intent'));
  check('pre_checkins.throw_focus exists', pcols.includes('throw_focus'));

  // Seed: coach + legacy hitter (pre-pitcher era: no player_type set) + legacy check-in.
  const h = bcrypt.hashSync('password123', 10), now = new Date().toISOString();
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,can_edit) VALUES (?,?,?,?,?,?,?,?,?)`, 'coach@test.com', h, 'coach', 'Coach', 'Coach', 'C', now, 'approved', 1);
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`, 'legacy@test.com', h, 'athlete', 'Legacy', 'Leg', 'Acy', now, 'approved');
  run(`INSERT INTO checkins (user_id,athlete_name,created_at,environment,drills_done,feel,confidence,focus,session_score,score_tier,session_notes,what_worked,whats_next) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    q(`SELECT id FROM users WHERE email='legacy@test.com'`).id, 'Legacy', now, 'Cage', '[]', 8, 7, 8, 7.5, 'Locked In', 'good swings', 'staying through it', '');
  check('legacy hitter defaults to hitter role', (q(`SELECT player_type FROM users WHERE email='legacy@test.com'`).player_type || 'hitter') === 'hitter');

  const srv = spawn('node', ['src/server.js'], { cwd: CWD, env: { ...process.env, DB_PATH: DB, PORT: String(PORT), SESSION_SECRET: 't', SKIP_API_KEY: 't', LLM_API_KEY: 't' }, stdio: 'inherit' });
  const jar = {};
  const req = async (method, path, body, who) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (jar[who]) headers.cookie = jar[who];
    const r = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
  };
  const P = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) { (Array.isArray(v) ? v : [v]).forEach((x) => u.append(k, x)); } return u; };
  const login = async (who, email) => { const r = await req('POST', '/login', P({ email, password: 'password123' }), who); if (r.status !== 302) throw new Error('login failed for ' + email); };
  const approve = (email) => run(`UPDATE users SET status='approved' WHERE email=?`, email);
  const uid = (email) => q(`SELECT id FROM users WHERE email=?`, email).id;
  const lastCheckin = (email) => q(`SELECT * FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 1`, uid(email));

  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/login'); if (r.status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

    // ---- Signup roles ----
    const dob = '2008-04-12';
    const reg = async (email, pt) => {
      const body = { email, password: 'password123', confirm_password: 'password123', first_name: 'Test', last_name: 'Kid', date_of_birth: dob, agree_terms: '1' };
      if (pt !== undefined) body.player_type = pt;
      return req('POST', '/register', P(body), 'anon');
    };
    await reg('sp@test.com', 'pitcher'); await reg('tw@test.com', 'two_way');
    await reg('bogus@test.com', 'shortstop'); await reg('norole@test.com');
    check('signup pitcher saved', q(`SELECT player_type FROM users WHERE email='sp@test.com'`).player_type === 'pitcher');
    check('signup two_way saved', q(`SELECT player_type FROM users WHERE email='tw@test.com'`).player_type === 'two_way');
    check('signup bogus role defaults to hitter', q(`SELECT player_type FROM users WHERE email='bogus@test.com'`).player_type === 'hitter');
    check('signup missing role defaults to hitter', q(`SELECT player_type FROM users WHERE email='norole@test.com'`).player_type === 'hitter');
    check('new signups are pending', q(`SELECT status FROM users WHERE email='sp@test.com'`).status === 'pending');
    ['sp@test.com','tw@test.com','bogus@test.com','norole@test.com'].forEach(approve);
    await login('sp', 'sp@test.com'); await login('tw', 'tw@test.com');
    await login('hit', 'legacy@test.com'); await login('coach', 'coach@test.com');

    // ---- Settings role change ----
    await reg('switcher@test.com', 'pitcher'); approve('switcher@test.com'); await login('sw', 'switcher@test.com');
    let r = await req('POST', '/settings/role', P({ player_type: 'two_way' }), 'sw');
    check('role change redirects', r.status === 302);
    check('role change persisted', q(`SELECT player_type FROM users WHERE email='switcher@test.com'`).player_type === 'two_way');
    r = await req('POST', '/settings/role', P({ player_type: 'bogus' }), 'sw');
    check('invalid role change rejected', q(`SELECT player_type FROM users WHERE email='switcher@test.com'`).player_type === 'two_way');
    r = await req('POST', '/settings/role', P({ player_type: 'hitter' }), 'coach');
    check('coach role change blocked (403)', r.status === 403);

    // ---- GET /checkin routing by role ----
    r = await req('GET', '/checkin', null, 'sp');
    check('pitcher gets throwing form', r.text.includes('data-throw-sync') && r.text.includes('What kind of throwing'));
    r = await req('GET', '/checkin', null, 'tw');
    check('two-way gets combined form', r.text.includes('id="combined-form"'));
    r = await req('GET', '/checkin', null, 'hit');
    check('hitter keeps hitting form', r.text.includes('did_drills'));

    // ---- Role-gated POSTs ----
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'bullpen' }), 'hit');
    check('hitter blocked from pitching POST', r.status === 302 && r.loc === '/checkin');
    r = await req('POST', '/checkin', P({ environment: 'Cage' }), 'sp');
    check('pitcher blocked from hitting POST', r.status === 302 && r.loc === '/checkin');
    r = await req('POST', '/checkin/combined', P({ did_hit: 'yes' }), 'hit');
    check('hitter blocked from combined POST', r.status === 302 && r.loc === '/checkin');

    // ---- Pitching POST: bullpen happy path ----
    const bullpen = () => P({
      pitch_session_type: 'bullpen', intent: 'medium', pitch_count: '35',
      pitches_thrown: ['4-seam FB', 'Slider'], velo_max: '88.5',
      feel: '8', focus: '7', confidence: '8', command: '6',
      felt_good: 'arm felt live', what_was_working: 'slider down', biggest_struggle: 'rushing',
    });
    r = await req('POST', '/checkin/pitching', bullpen(), 'sp');
    check('bullpen submits', r.status === 302 && /^\/checkin\/score\//.test(r.loc || ''));
    let c = lastCheckin('sp@test.com');
    check('bullpen session_kind=pitching', c.session_kind === 'pitching');
    check('bullpen fields saved', c.pitch_session_type === 'bullpen' && c.pitch_count === 35 && c.velo_max === 88.5 && c.command === 6 && c.intent === 'medium');
    check('bullpen pitches saved', JSON.parse(c.pitches_thrown).join(',') === '4-seam FB,Slider');
    check('bullpen pitching_score set', c.pitching_score != null && c.hitting_score == null);
    check('bullpen reflections saved', c.felt_good === 'arm felt live' && c.biggest_struggle === 'rushing');
    const scoreLoc = r.loc;

    // ---- Pitching POST: validation ----
    const bad1 = bullpen(); bad1.delete('pitch_count');
    r = await req('POST', '/checkin/pitching', bad1, 'sp');
    check('bullpen without pitch count rejected', r.status === 200 && r.text.includes('How many pitches'));
    const bad2 = bullpen(); bad2.delete('pitches_thrown');
    r = await req('POST', '/checkin/pitching', bad2, 'sp');
    check('bullpen without pitches rejected', r.status === 200 && r.text.includes('at least one pitch'));
    const bad3 = bullpen(); bad3.set('pitch_count', '500');
    r = await req('POST', '/checkin/pitching', bad3, 'sp');
    check('bullpen with absurd pitch count rejected', r.status === 200);

    // ---- Other session types ----
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'catch_play', intent: 'light', catch_distance: '120 ft', feel: '7', focus: '7', confidence: '7', command: '6', felt_good: 'loose', what_was_working: 'long toss', biggest_struggle: 'none' }), 'sp');
    check('catch play submits', r.status === 302);
    check('catch play distance saved', lastCheckin('sp@test.com').catch_distance === '120 ft');
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'recovery', feel: '6', focus: '6', confidence: '6', felt_good: 'rested', what_was_working: 'bands', biggest_struggle: 'sore' }), 'sp');
    check('recovery without notes rejected', r.status === 200 && r.text.includes('recovery'));
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'recovery', recovery_notes: 'bands + shoulder care', feel: '6', focus: '6', confidence: '6', felt_good: 'rested', what_was_working: 'bands', biggest_struggle: 'sore' }), 'sp');
    check('recovery with notes submits', r.status === 302);
    check('recovery command null', lastCheckin('sp@test.com').command == null);
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'no_throw', feel: '7', focus: '8', confidence: '7', felt_good: 'legs', what_was_working: 'lift', biggest_struggle: 'none' }), 'sp');
    check('no-throw without note rejected', r.status === 200);
    r = await req('POST', '/checkin/pitching', P({ pitch_session_type: 'no_throw', no_throw_note: 'lifted legs, watched film', feel: '7', focus: '8', confidence: '7', felt_good: 'legs', what_was_working: 'lift', biggest_struggle: 'none' }), 'sp');
    check('no-throw with note submits', r.status === 302);
    check('no-throw note saved', lastCheckin('sp@test.com').no_throw_note === 'lifted legs, watched film');

    // ---- Score page: pitching breakdown ----
    r = await req('GET', scoreLoc, null, 'sp');
    check('score page shows command', r.text.includes('Command'));
    check('score page shows pitch count', r.text.includes('Pitch count'));
    check('score page shows pitch types', r.text.includes('4-seam FB') && r.text.includes('Slider'));

    // ---- Combined POST ----
    r = await req('POST', '/checkin/combined', P({ did_hit: 'yes', environment: 'Cage', difficulty: '6', feel: '8', focus: '8', confidence: '8', felt_good: 'bat path', what_was_working: 'tee', biggest_struggle: 'timing' }), 'tw');
    check('combined hitting-only submits', r.status === 302);
    check('hitting-only session_kind=hitting', lastCheckin('tw@test.com').session_kind === 'hitting');
    r = await req('POST', '/checkin/combined', P({ did_throw: 'yes', pitch_session_type: 'live', intent: 'heavy', pitch_count: '20', pitches_thrown: ['Changeup'], feel: '7', focus: '7', confidence: '7', command: '6', felt_good: 'compete', what_was_working: 'changeup', biggest_struggle: 'command' }), 'tw');
    check('combined throwing-only submits', r.status === 302);
    c = lastCheckin('tw@test.com');
    check('throwing-only session_kind=pitching', c.session_kind === 'pitching');
    check('throwing-only has no hitting_score', c.hitting_score == null && c.pitching_score != null);
    r = await req('POST', '/checkin/combined', P({ did_hit: 'yes', did_throw: 'yes', environment: 'Live BP', difficulty: '7', pitch_session_type: 'bullpen', intent: 'medium', pitch_count: '25', pitches_thrown: ['4-seam FB'], feel: '8', focus: '8', confidence: '8', command: '7', felt_good: 'both good', what_was_working: 'rhythm', biggest_struggle: 'late' }), 'tw');
    check('combined both submits', r.status === 302);
    c = lastCheckin('tw@test.com');
    check('both session_kind=combined', c.session_kind === 'combined');
    check('both has hitting+throwing scores', c.hitting_score != null && c.pitching_score != null);
    check('both keeps environment', c.environment === 'Live BP');
    r = await req('POST', '/checkin/combined', P({ feel: '7', focus: '7', confidence: '7' }), 'tw');
    check('combined neither rejected', r.status === 200 && r.text.includes('Say what you did today'));

    // ---- Notebook: badges + kind filter ----
    r = await req('GET', '/notebook', null, 'tw');
    check('notebook shows hitting-only row (Cage, no kind badge)', r.text.includes('>Cage</span>'));
    check('notebook shows Throwing badge', r.text.includes('>Throwing</span>'));
    check('notebook shows Hitting + Throwing badge', r.text.includes('Hitting + Throwing'));
    check('notebook shows kind filter pills', r.text.includes('?kind=pitching'));
    r = await req('GET', '/notebook?kind=pitching', null, 'tw');
    check('kind filter keeps throwing sessions', r.text.includes('>Throwing</span>'));
    check('kind filter drops hitting-only sessions', !r.text.includes('>Cage</span>') && !r.text.includes('Hitting + Throwing'));
    r = await req('GET', '/notebook', null, 'hit');
    check('hitter notebook has no kind filter', !r.text.includes('?kind=pitching'));

    // ---- Pre-check-ins ----
    r = await req('GET', '/precheckin', null, 'sp');
    check('pitcher pre-checkin is throwing form', r.text.includes('throw_focus'));
    r = await req('POST', '/precheckin', P({ kind: 'throwing', throw_intent: 'heavy', throw_focus: 'stay through it' }), 'sp');
    check('pitcher pre-checkin saves', r.status === 302);
    const pc = q(`SELECT * FROM pre_checkins WHERE user_id=? ORDER BY id DESC LIMIT 1`, uid('sp@test.com'));
    check('pitcher pre-checkin fields saved', pc.throw_intent === 'heavy' && pc.throw_focus === 'stay through it');
    r = await req('POST', '/precheckin', P({ kind: 'throwing' }), 'sp');
    check('pitcher pre-checkin without focus rejected', r.status === 200);
    r = await req('GET', '/precheckin', null, 'tw');
    check('two-way pre-checkin is combined form', r.text.includes('throw_focus') && r.text.includes('name="focus"'));
    r = await req('POST', '/precheckin', P({ kind: 'both', focus: 'see it deep', plan: 'tee then front toss', throw_intent: 'medium', throw_focus: 'downhill' }), 'tw');
    check('two-way pre-checkin saves both', r.status === 302);
    const tc = q(`SELECT * FROM pre_checkins WHERE user_id=? ORDER BY id DESC LIMIT 1`, uid('tw@test.com'));
    check('two-way pre-checkin fields saved', tc.focus === 'see it deep' && tc.throw_intent === 'medium');
    r = await req('POST', '/precheckin', P({ kind: 'cage', environment: 'Cage', focus: 'hands', plan: 'tee work', flush: 'last swing' }), 'hit');
    check('hitter pre-checkin still works', r.status === 302);

    // ---- Coach dashboard ----
    r = await req('GET', '/coach/hitters', null, 'coach');
    check('coach hitters page has Pitcher pill', r.text.includes('role-pitcher'));
    check('coach hitters page has Two-way pill', r.text.includes('role-twoway'));
    check('coach hitters cards carry data-role', r.text.includes('data-role="pitcher"') && r.text.includes('data-role="two_way"'));
    check('coach hitters page has role filter', r.text.includes('data-rolefilter="pitcher"'));
    r = await req('GET', '/coach/user/sp@test.com', null, 'coach');
    check('coach pitcher page has throwing summary', r.text.includes('Throwing summary'));
    check('coach pitcher page has role pill', r.text.includes('role-pitcher'));
    check('coach pitcher page hides hitting routine', !r.text.includes('Daily routine'));
    r = await req('GET', '/coach/user/legacy@test.com', null, 'coach');
    check('coach hitter page has no throwing summary', !r.text.includes('Throwing summary'));
    r = await req('GET', '/coach/user/tw@test.com', null, 'coach');
    check('coach two-way page has throwing summary', r.text.includes('Throwing summary'));

    // ---- Streak: no-throw day counts ----
    await reg('streak@test.com', 'pitcher'); approve('streak@test.com'); await login('st', 'streak@test.com');
    await req('POST', '/checkin/pitching', P({ pitch_session_type: 'no_throw', no_throw_note: 'lift day', feel: '7', focus: '7', confidence: '7', felt_good: 'x', what_was_working: 'y', biggest_struggle: 'z' }), 'st');
    run(`UPDATE checkins SET created_at=? WHERE user_id=?`, chiYesterday() + 'T12:00:00', uid('streak@test.com'));
    await req('POST', '/checkin/pitching', P({ pitch_session_type: 'bullpen', intent: 'light', pitch_count: '15', pitches_thrown: ['4-seam FB'], feel: '8', focus: '8', confidence: '8', command: '7', felt_good: 'x', what_was_working: 'y', biggest_struggle: 'z' }), 'st');
    r = await req('GET', '/', null, 'st');
    check('no-throw day counts toward streak (2-day)', r.text.includes('streak-num">2<') && r.text.includes('day streak'));

    // ---- Skip glove avatar for pitchers ----
    r = await req('GET', '/chat', null, 'sp');
    check('pitcher chat shows glove avatar', r.text.includes('skip-avatar-pitching.webp'));
    check('pitcher chat greeting is throwing-flavored', r.text.includes('going on with your throwing'));
    r = await req('GET', '/chat', null, 'hit');
    check('hitter chat keeps bat avatar', r.text.includes('/skip-avatar.webp') && !r.text.includes('skip-avatar-pitching'));

    // ---- Skip pitcher isolation (static prompt checks) ----
    const src = fs.readFileSync(CWD + '/src/server.js', 'utf8');
    check('hitting library never injected for pitchers', /role === 'pitcher' \|\| throwingMsg \? '' : brain\.libraryBlock/.test(src));
    check('two-way throwing gate exists', src.includes('brain.messageAboutThrowing(userMessage)'));
    check('pitcher core prompt is mirror mode', /skipCoreFor\(role\)/.test(src) && /mirror/i.test(src));
    check('throwing history labeled [Throwing]', src.includes('[Throwing]'));

    // ---- Two-way leak guard: throwing messages suppress the hitting library ----
    const brain = require(CWD + '/src/brain.js');
    check('throwing detected: bullpen/velo', brain.messageAboutThrowing('bullpen today, velo was down'));
    check('throwing detected: command', brain.messageAboutThrowing("couldn't find my command in the pen"));
    check('throwing detected: threw', brain.messageAboutThrowing('threw 40 pitches, arm felt heavy'));
    check('throwing detected: mound', brain.messageAboutThrowing('felt rushed on the mound'));
    check('hitting not flagged: timing', !brain.messageAboutThrowing('my timing was off at the plate today'));
    check('hitting not flagged: pitch recognition', !brain.messageAboutThrowing('saw the pitch really well tonight'));
    check('hitting not flagged: feel', !brain.messageAboutThrowing('my swing felt smooth'));

    // ---- Existing hitter regression ----
    r = await req('GET', '/notebook', null, 'hit');
    check('legacy hitter notebook renders', r.status === 200 && r.text.includes('good swings'));
    r = await req('POST', '/checkin', P({ environment: 'Cage', feel: '8', confidence: '7', focus: '8', difficulty: '5', did_drills: 'no', session_notes: 'fine', what_worked: 'path', whats_next: '' }), 'hit');
    check('legacy hitter check-in still submits', r.status === 302 && /^\/checkin\/score\//.test(r.loc || ''));

    console.log(failures === 0 ? '\nPITCHER SUITE OK' : `\n${failures} FAILURES`);
  } catch (e) { console.error('TEST ERROR:', e); failures++; }
  finally { srv.kill(); setTimeout(() => process.exit(failures ? 1 : 0), 500); }
}
main();
