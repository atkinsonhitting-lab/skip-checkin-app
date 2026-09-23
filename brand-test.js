// Organization branding: integration suite on a throwaway DB.
// Boots the real server, checks the branding migration, the Missouri State
// sample org, logo upload/validation/serving, color validation, branded page
// rendering, and the requireOrgManager gate on the brand routes.
const { spawn, execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const PORT = 3496, DB = '/tmp/brand-test.db', BASE = `http://127.0.0.1:${PORT}`, CWD = '/home/hatch/workspace/skip-push-deploy';
const DATA_DIR = '/tmp/brand-test-data';
let failures = 0;
const check = (n, c) => { console.log((c ? '  ok - ' : '  FAIL - ') + n); if (!c) failures++; };

const PNG1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function multipart(fields, files) {
  const boundary = '----brandtest' + Date.now() + Math.floor(Math.random() * 1e6);
  const parts = [];
  for (const [k, v] of Object.entries(fields || {}))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files || []) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function main() {
  fs.rmSync(DB, { force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  // 1. Fresh boot: schema migration + Missouri State sample seed.
  execSync(`DATA_DIR=${DATA_DIR} DB_PATH=${DB} PORT=3499 SESSION_SECRET=t SKIP_API_KEY=t timeout 15 node src/server.js > /dev/null 2>&1 || true`, { cwd: CWD, timeout: 40000 });
  const run = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).run(...a); } finally { d.close(); } };
  const q = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).get(...a); } finally { d.close(); } };
  const qall = (s, ...a) => { const d = new DatabaseSync(DB); try { return d.prepare(s).all(...a); } finally { d.close(); } };
  const ocols = qall('PRAGMA table_info(organizations)').map((c) => c.name);
  for (const c of ['logo_path', 'primary_color', 'accent_color']) check(`organizations.${c} exists`, ocols.includes(c));

  const sample = q(`SELECT * FROM organizations WHERE name = 'Missouri State'`);
  check('Missouri State sample org created', !!sample);
  check('sample primary color is MSU maroon', sample && sample.primary_color === '#5E0009');
  check('sample accent color is Brick City', sample && sample.accent_color === '#EB002B');
  check('sample logo_path set', sample && sample.logo_path === 'missouri-state-sample.png');
  check('sample logo file copied to DATA_DIR', sample && fs.existsSync(path.join(DATA_DIR, 'org-logos', 'missouri-state-sample.png')));
  const samplePng = sample && fs.existsSync(path.join(DATA_DIR, 'org-logos', sample.logo_path))
    ? fs.readFileSync(path.join(DATA_DIR, 'org-logos', sample.logo_path)) : null;
  check('sample logo is a real PNG', !!samplePng && samplePng.slice(1, 4).toString() === 'PNG');
  const orgId = sample.id;

  // Reboot idempotency: no duplicate sample org.
  execSync(`DATA_DIR=${DATA_DIR} DB_PATH=${DB} PORT=3499 SESSION_SECRET=t SKIP_API_KEY=t timeout 15 node src/server.js > /dev/null 2>&1 || true`, { cwd: CWD, timeout: 40000 });
  check('sample seed idempotent', qall(`SELECT id FROM organizations WHERE name = 'Missouri State'`).length === 1);

  // Seed: Bobby-style global coach, view-only coach, athlete in the sample org.
  const h = bcrypt.hashSync('password123', 10), now = new Date().toISOString();
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,can_edit) VALUES (?,?,?,?,?,?,?,?,?)`, 'coach@test.com', h, 'coach', 'Coach', 'Coach', 'C', now, 'approved', 1);
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,can_edit) VALUES (?,?,?,?,?,?,?,?,?)`, 'cam@test.com', h, 'coach', 'Cam', 'Cam', 'M', now, 'approved', 0);
  run(`INSERT INTO users (email,password_hash,role,athlete_name,first_name,last_name,created_at,status,organization_id) VALUES (?,?,?,?,?,?,?,?,?)`, 'bear@test.com', h, 'athlete', 'Bear', 'Beary', 'B', now, 'approved', orgId);

  const srv = spawn('node', ['src/server.js'], { cwd: CWD, env: { ...process.env, DATA_DIR, DB_PATH: DB, PORT: String(PORT), SESSION_SECRET: 't', SKIP_API_KEY: 't', LLM_API_KEY: 't' }, stdio: 'inherit' });
  const jar = {};
  const req = async (method, p, body, who, contentType) => {
    const headers = {};
    if (body) headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
    if (jar[who]) headers.cookie = jar[who];
    const r = await fetch(BASE + p, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location'), headers: r.headers };
  };
  const P = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) u.append(k, v); return u; };
  const login = async (who, email) => { const r = await req('POST', '/login', P({ email, password: 'password123' }), who); if (r.status !== 302) throw new Error('login failed for ' + email); };

  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/login'); if (r.status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    await login('coach', 'coach@test.com');
    await login('cam', 'cam@test.com');
    await login('bear', 'bear@test.com');

    // ---- Logo serving ----
    let r = await req('GET', '/org-logos/missouri-state-sample.png', null, 'anon');
    check('sample logo serves 200', r.status === 200);
    check('sample logo content-type is image', (r.headers.get('content-type') || '').startsWith('image/'));
    r = await req('GET', '/org-logos/nope.txt', null, 'anon');
    check('bad extension 404s', r.status === 404);
    r = await req('GET', '/org-logos/..%2f..%2fetc%2fpasswd', null, 'anon');
    check('path traversal 404s', r.status === 404);

    // ---- Color validation ----
    const brandPath = `/coach/organizations/${orgId}/brand`;
    const mp = (fields, files) => multipart(fields, files);
    const postMp = (who, fields, files) => { const m = mp(fields, files); return req('POST', brandPath, m.body, who, m.type); };
    r = await postMp('coach', { primary_color: 'not-a-color', accent_color: '#EB002B' }, []);
    check('bad color rejected with error', r.status === 302 && /error=/.test(r.loc || ''));
    check('bad color not saved', q(`SELECT primary_color FROM organizations WHERE id = ?`, orgId).primary_color === '#5E0009');

    // ---- Colors-only save ----
    r = await postMp('coach', { primary_color: '#123456', accent_color: '#ABCDEF' }, []);
    check('color save redirects clean', r.status === 302 && !(r.loc || '').includes('error='));
    const afterColors = q(`SELECT primary_color, accent_color, logo_path FROM organizations WHERE id = ?`, orgId);
    check('colors saved', afterColors.primary_color === '#123456' && afterColors.accent_color === '#ABCDEF');
    check('logo untouched by color save', afterColors.logo_path === 'missouri-state-sample.png');

    // ---- Logo upload ----
    r = await postMp('coach', { primary_color: '#123456', accent_color: '#ABCDEF' },
      [{ name: 'logo', filename: 'bear.png', type: 'image/png', data: PNG1x1 }]);
    const afterUpload = q(`SELECT logo_path FROM organizations WHERE id = ?`, orgId);
    check('upload redirects clean', r.status === 302 && !(r.loc || '').includes('error='));
    check('logo_path updated', afterUpload.logo_path && afterUpload.logo_path !== 'missouri-state-sample.png' && /\.png$/.test(afterUpload.logo_path));
    check('uploaded file on disk', afterUpload.logo_path && fs.existsSync(path.join(DATA_DIR, 'org-logos', afterUpload.logo_path)));
    check('old sample file deleted on replace', !fs.existsSync(path.join(DATA_DIR, 'org-logos', 'missouri-state-sample.png')));
    r = await req('GET', `/org-logos/${afterUpload.logo_path}`, null, 'anon');
    check('uploaded logo serves', r.status === 200);

    // ---- Non-image rejected ----
    r = await postMp('coach', { primary_color: '#123456', accent_color: '#ABCDEF' },
      [{ name: 'logo', filename: 'evil.txt', type: 'text/plain', data: Buffer.from('hello') }]);
    check('non-image rejected with error', r.status === 302 && /error=/.test(r.loc || ''));
    check('logo unchanged after bad upload', q(`SELECT logo_path FROM organizations WHERE id = ?`, orgId).logo_path === afterUpload.logo_path);

    // ---- Remove logo ----
    r = await req('POST', `/coach/organizations/${orgId}/brand/logo/remove`, P({}), 'coach');
    check('remove logo redirects', r.status === 302);
    check('logo_path cleared', q(`SELECT logo_path FROM organizations WHERE id = ?`, orgId).logo_path === '');
    check('logo file deleted', !fs.existsSync(path.join(DATA_DIR, 'org-logos', afterUpload.logo_path)));

    // ---- Branded page rendering (athlete in branded org) ----
    // Re-set branding for the render check (colors only, no logo now).
    await postMp('coach', { primary_color: '#5E0009', accent_color: '#EB002B' }, []);
    // Athletes are redirected off / to Lock In since Sep 23 2026 — check the
    // branded topbar on the landing page instead.
    r = await req('GET', '/mental-game', null, 'bear');
    check('athlete home 200', r.status === 200);
    check('branded topbar shows org name', r.text.includes('Missouri State'));
    check('brand CSS var injected', r.text.includes('--red:#5E0009'));
    check('accent used on topbar border', r.text.includes('border-bottom-color:#EB002B'));
    check('powered-by line present', r.text.includes('POWERED BY DIAMOND DAILY'));

    // ---- Unbranded user unaffected ----
    r = await req('GET', '/coach/organizations', null, 'coach');
    check('coach org page 200', r.status === 200);
    check('coach (no org) sees stock branding', r.text.includes('DIAMOND DAILY') && !r.text.includes('--red:#5E0009'));
    check('branding form on org card', r.text.includes(`/coach/organizations/${orgId}/brand`));
    check('player preview on org card', r.text.includes('Player preview'));

    // ---- View-only coach blocked ----
    r = await postMp('cam', { primary_color: '#000000', accent_color: '#000000' }, []);
    check('view-only coach gets 403', r.status === 403);
    check('colors unchanged after 403', q(`SELECT primary_color FROM organizations WHERE id = ?`, orgId).primary_color === '#5E0009');

    // ---- views.layout unit checks ----
    const views = require(CWD + '/src/views.js');
    const branded = views.layout({ title: 'T', user: { displayName: 'B', brand: { orgName: 'Missouri State', logoUrl: '/org-logos/x.png', primary: '#5E0009', primaryDark: '#3a0005', accent: '#EB002B' } }, tabs: [], body: 'x' });
    check('layout injects brand style', branded.includes(':root{--red:#5E0009'));
    check('layout swaps topbar logo', branded.includes('/org-logos/x.png') && branded.includes('Missouri State'));
    check('layout sets theme-color', branded.includes('content="#5E0009"'));
    const plain = views.layout({ title: 'T', user: { displayName: 'B' }, tabs: [], body: 'x' });
    check('layout without brand has no brand CSS', !plain.includes(':root{--red:') && plain.includes('DIAMOND DAILY'));
    // Injection attempt: org name is escaped, colors are hex-only by construction.
    const evil = views.layout({ title: 'T', user: { displayName: 'B', brand: { orgName: '<script>alert(1)</script>', logoUrl: null, primary: '#5E0009', primaryDark: '#3a0005', accent: '#EB002B' } }, tabs: [], body: 'x' });
    check('org name escaped in topbar', !evil.includes('<script>alert(1)</script>'));
  } finally {
    srv.kill('SIGTERM');
  }
  console.log(failures ? `\n${failures} FAILURES` : '\nAll brand checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
