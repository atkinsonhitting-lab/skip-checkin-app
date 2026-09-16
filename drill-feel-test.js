const { spawn, execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const PORT = 3494, DB = '/tmp/drill-feel.db', BASE = `http://127.0.0.1:${PORT}`, CWD = '/home/hatch/workspace/skip-push-deploy';
let failures = 0;
const check = (n, c) => { console.log((c ? '  ok - ' : '  FAIL - ') + n); if (!c) failures++; };
async function main() {
  fs.rmSync(DB, { force: true });
  execSync(`DB_PATH=${DB} PORT=3499 SESSION_SECRET=t SKIP_API_KEY=t timeout 12 node src/server.js > /dev/null 2>&1 || true`, { cwd: CWD, timeout: 30000 });
  const run = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).run(...a); } finally { d.close(); } };
  const q = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).get(...a); } finally { d.close(); } };
  const h = bcrypt.hashSync('password123', 10), now = new Date().toISOString();
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status) VALUES (?,?,?,?,?,?,?,?)`, 'kid@test.com', h, 'athlete', 'Kid K', 'Kid', 'K', now, 'approved');
  const srv = spawn('node', ['src/server.js'], { cwd: CWD, env: { ...process.env, DB_PATH: DB, PORT: String(PORT), SESSION_SECRET: 't', SKIP_API_KEY: 't' }, stdio: 'inherit' });
  const jar = {};
  const req = async (method, path, body, who) => {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (jar[who]) headers.cookie = jar[who];
    const r = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
  };
  const login = async (who, email) => { const r = await req('POST', '/login', new URLSearchParams({ email, password: 'password123' }), who); if (r.status !== 302) throw new Error('login failed'); };
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/login'); if (r.status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    await login('kid', 'kid@test.com');
    // check-in with a real drill + two summaries
    const r = await req('POST', '/checkin', new URLSearchParams({
      environment: 'Cage', feel: '8', confidence: '7', focus: '8', difficulty: '5',
      did_drills: 'yes', drills_done: 'Deep Tee Drill (Tee), did some tee stuff, front toss',
      session_notes: 'felt good', what_worked: 'staying through it', whats_next: '',
    }), 'kid');
    check('check-in submits', r.status === 302 && /^\/checkin\/score\//.test(r.loc || ''));
    const c = q(`SELECT drills_done FROM checkins WHERE user_id = (SELECT id FROM users WHERE email='kid@test.com')`);
    const arr = JSON.parse(c.drills_done);
    check('real drill flagged known', arr.find(d => d.name === 'Deep Tee Drill').known === true);
    check('summary flagged not-known', arr.find(d => d.name === 'did some tee stuff').known === false);
    check('front toss flagged not-known', arr.find(d => d.name === 'front toss').known === false);
    check('station parsed on real drill', arr.find(d => d.name === 'Deep Tee Drill').station === 'Tee');
    // notebook card renders chips vs also-mentioned
    const nb = await req('GET', '/notebook', null, 'kid');
    check('card shows drill chip', nb.text.includes('Deep Tee Drill'));
    check('card shows also-mentioned', nb.text.includes('Also mentioned'));
    console.log(failures === 0 ? 'DRILL FEEL OK' : failures + ' FAILURES');
  } catch (e) { console.error('TEST ERROR:', e); failures++; }
  finally { srv.kill(); setTimeout(() => process.exit(failures ? 1 : 0), 500); }
}
main();
