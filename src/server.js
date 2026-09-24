// Skip — the standalone session check-in app.
// Real accounts (bcrypt + sessions), open public signup, the full Skip
// check-in flow (environment, drills, Feel/Confidence/Focus 1-10, instant
// session score + tier, Skip's journal read), a coach dashboard, and an API
// for the AI assistant. No programs, no video library — those live in the
// private programs portal. Free for now; subscription later (accounts ready).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const webpush = require('web-push');
const bcrypt = require('bcryptjs');

const db = require('./db');
const SQLiteStore = require('./store');
const data = require('./data');
const views = require('./views');
const brain = require('./brain');
const videoLinks = require('./video_links');
const { envById } = require('./env_lib');
const { seedUsers, writeCredentialsFile, userCount } = require('./seed');

// Bobby's own organization — his 4 remote hitters, Talk to Skip on, free
// forever. Pinned at the top of the Organizations list; the only org whose
// players get "Edit program" links (it's the only org with programs).
const FOUNDER_ORG_NAME = 'Atkinson Hitter Development System';

const app = express();

// Never let an async throw kill the process (Bobby, Sep 23 2026: 502s on
// check-in submit). Log it; the request-level try/catch handles the user.
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.message));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.message));
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Branded orgs inject a small <style> block overriding --red/--red-dark.
      // Colors are strict hex-validated server-side, so inline styles are safe.
      'style-src': ["'self'", "'unsafe-inline'"],
      // App uses inline <script> for bootstrapping page data (WO_DAY, etc.).
      'script-src': ["'self'", "'unsafe-inline'"],
      // Video library embeds Google Drive previews in an iframe.
      // Workout demo videos embed YouTube.
      'frame-src': ["'self'", 'https://drive.google.com', 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    },
  },
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// Never let browsers cache app pages or scripts — Bobby tests on his phone
// and stale cached pages caused real confusion (old wording, missing sections).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const isProd = process.env.NODE_ENV === 'production';

// ---- Web Push (VAPID) — hitter reminders + coach alerts ----
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
let pushEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:atkinsonhitting@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  pushEnabled = true;
} else {
  console.warn('Push off: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';

const sessionStore = new SQLiteStore(db);
app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---- First-boot seeding (used on Render: set SEED_ON_BOOT=true once) ----
if (process.env.SEED_ON_BOOT === 'true' && userCount() === 0) {
  const created = seedUsers();
  const outPath = writeCredentialsFile(created);
  console.log('=== FIRST-BOOT SEED COMPLETE ===');
  console.log(`Credentials file: ${outPath}`);
  for (const u of created) console.log(`  ${u.email} / ${u.password}`);
  console.log('Copy these now, then remove SEED_ON_BOOT and redeploy.');
}

// One-time coach creation (Sep 2026): set BOOT_CREATE_USER to
// "email|password|can_edit|first|last" to add a coach on boot, then remove the
// env var and redeploy. Used to add Cam McDonald as a view-only coach.
if (process.env.BOOT_CREATE_USER) {
  const parts = String(process.env.BOOT_CREATE_USER).split('|');
  const cuEmail = (parts[0] || '').trim().toLowerCase();
  const cuPassword = parts[1] || '';
  const cuCanEdit = parts[2] === '1' ? 1 : 0;
  const cuFirst = parts[3] || null;
  const cuLast = parts[4] || null;
  if (cuEmail && cuPassword) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cuEmail);
    if (!existing) {
      const cuNow = new Date().toISOString();
      db.prepare(
        "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit) VALUES (?, ?, 'coach', NULL, ?, ?, ?, 'approved', ?)"
      ).run(cuEmail, bcrypt.hashSync(cuPassword, 12), cuFirst, cuLast, cuNow, cuCanEdit);
      console.log(`BOOT_CREATE_USER: created coach ${cuEmail} (can_edit=${cuCanEdit})`);
    } else {
      console.log(`BOOT_CREATE_USER: ${cuEmail} already exists, skipping`);
    }
  } else {
    console.log('BOOT_CREATE_USER: missing email or password, skipping');
  }
}

// Remote org one-shot (Sep 2026): set BOOT_REMOTE_ORG=1 to create Bobby's own
// organization "Atkinson Hitter Development System" and place his 4 remote
// hitters in it. Idempotent: skips creation if the org exists, re-ensures the
// hitter assignments and Talk to Skip access on every run.
if (process.env.BOOT_REMOTE_ORG === '1') {
  const REMOTE_ORG_NAME = 'Atkinson Hitter Development System';
  const REMOTE_NAMES = ['Liam Stoffel', 'Dylan Kakuda', 'Ryan Seddon', 'Sam Chapman'];
  let org = db.prepare('SELECT id, code, skip_enabled FROM organizations WHERE name = ?').get(REMOTE_ORG_NAME);
  if (!org) {
    const code = makeOrganizationCode(REMOTE_ORG_NAME);
    const info = db
      .prepare(
        'INSERT INTO organizations (name, code, skip_enabled, created_at, deal_notes) VALUES (?, ?, 1, ?, ?)'
      )
      .run(REMOTE_ORG_NAME, code, new Date().toISOString(), 'Founder org — free forever, exempt from billing');
    org = { id: info.lastInsertRowid, code, skip_enabled: 1 };
    console.log(`BOOT_REMOTE_ORG: created org "${REMOTE_ORG_NAME}" code=${code}`);
  } else if (!org.skip_enabled) {
    db.prepare('UPDATE organizations SET skip_enabled = 1 WHERE id = ?').run(org.id);
    console.log(`BOOT_REMOTE_ORG: enabled Talk to Skip for "${REMOTE_ORG_NAME}"`);
  }
  // Assign the 4 remote hitters: prefer the remote-program link, fall back to name match.
  const lowered = REMOTE_NAMES.map((n) => n.toLowerCase());
  const ph = lowered.map(() => '?').join(',');
  const hitters = db
    .prepare(
      `SELECT u.id FROM users u
       LEFT JOIN remote_programs p ON p.id = u.remote_program_id
       WHERE u.role = 'athlete' AND (
         lower(p.athlete_name) IN (${ph})
         OR lower(u.athlete_name) IN (${ph})
         OR lower(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,''))) IN (${ph})
       )`
    )
    .all(...lowered, ...lowered, ...lowered);
  const assign = db.prepare('UPDATE users SET organization_id = ?, team_id = NULL WHERE id = ?');
  let moved = 0;
  for (const h of hitters) {
    const cur = db.prepare('SELECT organization_id FROM users WHERE id = ?').get(h.id);
    if (cur.organization_id !== org.id) {
      assign.run(org.id, h.id);
      moved++;
    }
  }
  console.log(
    `BOOT_REMOTE_ORG: org "${REMOTE_ORG_NAME}" code=${org.code}, ${hitters.length} remote hitters matched, ${moved} newly assigned`
  );
}

// ---- Auth helpers ----

function toReqUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    athleteName: row.athlete_name,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    displayName: row.first_name || row.athlete_name || 'Coach',
    status: row.status || 'approved',
    remoteProgramId: row.remote_program_id || null,
    organizationId: row.organization_id || null,
    teamId: row.team_id || null,
    dateOfBirth: row.date_of_birth || null,
    playerType: row.player_type || 'hitter',
    // Liability waiver (Sep 2026): athletes with a program sign before opening it.
    waiverSignedAt: row.waiver_signed_at || null,
    waiverName: row.waiver_name || null,
    waiverParentName: row.waiver_parent_name || null,
    waiverVersion: row.waiver_version || null,
    // View-only coaches (can_edit=0) see everything but change nothing.
    canEdit: row.can_edit == null ? true : row.can_edit !== 0,
  };
}

// ---- Organizations (Sep 2026) ----
function getOrganization(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) || null;
}

// ---- Organization branding (Sep 17 2026) ----
// Logos live under DATA_DIR/org-logos so they survive deploys (the rest of
// the image is replaced on every Render deploy; only /app/data persists).
const ORG_LOGO_DIR = path.join(data.DATA_DIR, 'org-logos');
try { fs.mkdirSync(ORG_LOGO_DIR, { recursive: true }); } catch (e) { console.warn('org-logos dir:', e.message); }

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ORG_LOGO_DIR),
    filename: (req, file, cb) => {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.mimetype] || 'png';
      cb(null, `org-${Number(req.params.id)}-${Date.now()}.${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Logo must be a PNG, JPG, WebP, or GIF image.'));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Message attachments (Sep 23 2026): remote guys send Bobby swing clips.
// Videos up to 100MB, images up to 10MB. Disk for now, R2 later.
const MSG_ATTACH_DIR = path.join(data.DATA_DIR, 'message-attachments');
try { fs.mkdirSync(MSG_ATTACH_DIR, { recursive: true }); } catch (e) {}
const msgAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MSG_ATTACH_DIR),
    filename: (req, file, cb) => {
      const exts = {
        'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
      };
      const ext = exts[file.mimetype] || 'bin';
      cb(null, `msg-${req.user.id}-${Date.now()}.${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|quicktime|webm)$/.test(file.mimetype)) return cb(null, true);
    if (/^image\/(png|jpeg|webp|gif|heic)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Attach a video (MP4/MOV) or photo.'));
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Serve message attachments. Filename is validated to a flat safe pattern;
// only the sender, the recipient(s), and coaches can fetch.
app.get('/msg-attachments/:file', requireLogin, (req, res) => {
  const f = String(req.params.file || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp4|mov|webm|png|jpg|jpeg|webp|gif|heic)$/i.test(f)) return res.status(404).end();
  const row = db.prepare('SELECT id, sender_id, recipient_id FROM messages WHERE attachment_path = ?').get(f);
  if (!row) return res.status(404).end();
  const me = req.user.id;
  const isCoach = req.user.role === 'coach';
  // Broadcasts have recipient_id NULL — check the message_recipients table.
  const isRecipient = row.recipient_id === me ||
    !!db.prepare('SELECT 1 FROM message_recipients WHERE message_id = ? AND user_id = ?').get(row.id, me);
  const involved = row.sender_id === me || isRecipient;
  if (!isCoach && !involved) return res.status(403).end();
  res.sendFile(path.join(MSG_ATTACH_DIR, f));
});

// Serve uploaded logos. The filename is validated to a flat safe pattern so
// no path traversal is possible; the row stores only the file name.
app.get('/org-logos/:file', (req, res) => {
  const f = String(req.params.file || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif)$/i.test(f)) return res.status(404).end();
  const p = path.join(ORG_LOGO_DIR, f);
  if (!p.startsWith(ORG_LOGO_DIR + path.sep)) return res.status(404).end();
  res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

function validHexColor(s) {
  return /^#[0-9a-fA-F]{6}$/.test(String(s || '').trim());
}
function darkenHex(hex, factor = 0.65) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
// Brand object attached to req.user for org members. Null unless the org set
// at least a logo or one color.
function orgBrand(org) {
  if (!org) return null;
  const primary = validHexColor(org.primary_color) ? String(org.primary_color).trim() : null;
  const accent = validHexColor(org.accent_color) ? String(org.accent_color).trim() : null;
  const logoFile = String(org.logo_path || '').trim();
  const logoOk = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif)$/i.test(logoFile);
  if (!primary && !accent && !logoOk) return null;
  const base = primary || '#e10600';
  return {
    orgName: org.name,
    logoUrl: logoOk ? `/org-logos/${logoFile}` : null,
    primary: base,
    primaryDark: darkenHex(primary || '#e10600'),
    accent: accent || darkenHex(base),
  };
}
function deleteOrgLogoFile(logoPath) {
  const f = String(logoPath || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|webp|gif)$/i.test(f)) return;
  try { fs.unlinkSync(path.join(ORG_LOGO_DIR, f)); } catch (e) { /* already gone */ }
}

// Missouri State sample branding (Sep 17 2026): a demo org so Bobby can show
// a college exactly what their branded platform looks like — maroon topbar,
// Bears logo, their colors. Idempotent: creates the org once, backfills the
// branding if the org somehow exists without it. The sample logo ships with
// the deploy and is copied into DATA_DIR/org-logos on first boot.
// Bobby can delete this org from the Organizations page any time.
(function seedMissouriStateSample() {
  try {
    const destFile = 'missouri-state-sample.png';
    const dest = path.join(ORG_LOGO_DIR, destFile);
    const sampleSrc = path.join(__dirname, '..', 'public', 'org-logos-sample', 'missouri-state.png');
    if (!fs.existsSync(dest) && fs.existsSync(sampleSrc)) fs.copyFileSync(sampleSrc, dest);
    if (!fs.existsSync(dest)) return;
    const existing = db.prepare('SELECT id, logo_path FROM organizations WHERE name = ?').get('Missouri State');
    if (!existing) {
      const code = makeOrganizationCode('Missouri State');
      db.prepare(
        `INSERT INTO organizations (name, code, skip_enabled, created_at, logo_path, primary_color, accent_color, deal_status, deal_notes)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
      ).run('Missouri State', code, new Date().toISOString(), destFile, '#5E0009', '#EB002B', 'prospect',
        'SAMPLE org — demo branding for sales (Bobby: safe to delete).');
      console.log('BOOT_BRAND_SAMPLE: created Missouri State sample org');
    } else if (!existing.logo_path) {
      db.prepare('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?')
        .run(destFile, '#5E0009', '#EB002B', existing.id);
      console.log('BOOT_BRAND_SAMPLE: backfilled branding on Missouri State org');
    }
  } catch (e) { console.warn('BOOT_BRAND_SAMPLE failed:', e.message); }
})();

// Heartland Community College sample branding (Sep 17 2026): same demo-org
// pattern as Missouri State — navy topbar, white H logo, navy colors.
// Idempotent; Bobby can delete it from the Organizations page any time.
(function seedHeartlandSample() {
  try {
    const destFile = 'heartland-h.png';
    const dest = path.join(ORG_LOGO_DIR, destFile);
    const sampleSrc = path.join(__dirname, '..', 'public', 'org-logos-sample', 'heartland-h.png');
    if (!fs.existsSync(dest) && fs.existsSync(sampleSrc)) fs.copyFileSync(sampleSrc, dest);
    if (!fs.existsSync(dest)) return;
    const existing = db.prepare('SELECT id, logo_path FROM organizations WHERE name = ?').get('Heartland Community College');
    if (!existing) {
      const code = makeOrganizationCode('Heartland Community College');
      db.prepare(
        `INSERT INTO organizations (name, code, skip_enabled, created_at, logo_path, primary_color, accent_color, deal_status, deal_notes)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
      ).run('Heartland Community College', code, new Date().toISOString(), destFile, '#0A1E46', '#3E6FB0', 'prospect',
        'SAMPLE org — demo branding for sales (Bobby: safe to delete).');
      console.log('BOOT_BRAND_SAMPLE: created Heartland Community College sample org');
    } else if (!existing.logo_path) {
      db.prepare('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?')
        .run(destFile, '#0A1E46', '#3E6FB0', existing.id);
      console.log('BOOT_BRAND_SAMPLE: backfilled branding on Heartland org');
    }
  } catch (e) { console.warn('BOOT_BRAND_SAMPLE(heartland) failed:', e.message); }
})();

// Heartland roster (Sep 17 2026, Bobby): move standalone athlete "Sammy Atkinson"
// into Heartland Community College if his account exists. Never moves a player
// who is already in another org. Runs on every boot, so it picks him up as
// soon as he signs up.
(function seedHeartlandRoster() {
  try {
    const org = db.prepare('SELECT id, name FROM organizations WHERE name = ?').get('Heartland Community College');
    if (!org) return;
    const p = db.prepare(
      `SELECT id, organization_id FROM users WHERE role = 'athlete' AND (
         LOWER(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = 'sammy atkinson'
         OR LOWER(TRIM(COALESCE(athlete_name,''))) = 'sammy atkinson'
       )`
    ).get();
    if (!p) { console.log('BOOT_HEARTLAND_ROSTER: no athlete "Sammy Atkinson" yet — skipped'); return; }
    if (p.organization_id) {
      const cur = db.prepare('SELECT name FROM organizations WHERE id = ?').get(p.organization_id);
      console.log(`BOOT_HEARTLAND_ROSTER: "Sammy Atkinson" already in org "${cur ? cur.name : p.organization_id}" — not moved`);
      return;
    }
    db.prepare('UPDATE users SET organization_id = ?, team_id = NULL WHERE id = ?').run(org.id, p.id);
    console.log('BOOT_HEARTLAND_ROSTER: moved "Sammy Atkinson" into "Heartland Community College"');
  } catch (e) { console.warn('BOOT_HEARTLAND_ROSTER failed:', e.message); }
})();

// Missouri State roster (Sep 17 2026, Bobby): move standalone athletes
// "Logan Fyffe" and "Harris Magala" into the Missouri State org when their
// accounts exist. Never moves a player already in another org.
(function seedMissouriStateRoster() {
  try {
    const org = db.prepare('SELECT id, name FROM organizations WHERE name = ?').get('Missouri State');
    if (!org) return;
    const findPlayer = db.prepare(
      `SELECT id, organization_id FROM users WHERE role = 'athlete' AND (
         LOWER(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = ?
         OR LOWER(TRIM(COALESCE(athlete_name,''))) = ?
       )`
    );
    for (const name of ['Logan Fyffe', 'Harris Magala']) {
      const key = name.toLowerCase();
      const p = findPlayer.get(key, key);
      if (!p) { console.log(`BOOT_MSU_ROSTER: no athlete "${name}" yet — skipped`); continue; }
      if (p.organization_id) {
        const cur = db.prepare('SELECT name FROM organizations WHERE id = ?').get(p.organization_id);
        console.log(`BOOT_MSU_ROSTER: "${name}" already in org "${cur ? cur.name : p.organization_id}" — not moved`);
        continue;
      }
      db.prepare('UPDATE users SET organization_id = ?, team_id = NULL WHERE id = ?').run(org.id, p.id);
      console.log(`BOOT_MSU_ROSTER: moved "${name}" into "Missouri State"`);
    }
  } catch (e) { console.warn('BOOT_MSU_ROSTER failed:', e.message); }
})();

// Bobby's own programs (Sep 17 2026): "Atkinson Hitting" (in-person guys) and
// "Atkinson Hitter Development System" (remote guys). Idempotent boot setup:
// find-or-create both orgs (Bobby may have created one via the app already),
// mark is_mine=1 so they power the My Players tab, mirror branding between
// them when only one has a logo, and move his named players in. Standalone
// athletes only — a player already in another org is never moved.
// Bobby's coach row is untouched: as a global coach he already coaches both.
(function seedBobbysPrograms() {
  try {
    const INPERSON = 'Atkinson Hitting';
    const REMOTE = 'Atkinson Hitter Development System';
    // Bobby renamed it (Sep 23 2026): was "Atkinson Hitting Remote Development".
    db.prepare("UPDATE organizations SET name = ? WHERE LOWER(name) = LOWER('Atkinson Hitting Remote Development')").run(REMOTE);
    const now = new Date().toISOString();
    const findOrg = (name) => db.prepare('SELECT * FROM organizations WHERE LOWER(name) = LOWER(?)').get(name);
    const ensureOrg = (name, notes) => {
      let org = findOrg(name);
      if (!org) {
        const code = makeOrganizationCode(name);
        const info = db
          .prepare('INSERT INTO organizations (name, code, skip_enabled, created_at, deal_notes) VALUES (?, ?, 1, ?, ?)')
          .run(name, code, now, notes);
        org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(info.lastInsertRowid);
        console.log(`BOOT_PROGRAMS: created org "${name}" code=${code}`);
      }
      return org;
    };
    const inPerson = ensureOrg(INPERSON, "Bobby's org — in-person guys");
    const remote = ensureOrg(REMOTE, 'Founder org — free forever, exempt from billing');
    db.prepare('UPDATE organizations SET is_mine = 1 WHERE id IN (?, ?)').run(inPerson.id, remote.id);
    // Bobby, Sep 23 2026: his in-person guys get Talk to Skip too — always on for his orgs.
    db.prepare('UPDATE organizations SET skip_enabled = 1 WHERE is_mine = 1').run();

    // Branding mirror: same logo + colors on both programs. Whichever org has
    // a logo wins; fill blanks only, never overwrite existing branding.
    const brandOf = (name) =>
      db.prepare('SELECT id, logo_path, primary_color, accent_color FROM organizations WHERE LOWER(name) = LOWER(?)').get(name);
    const a = brandOf(INPERSON), b = brandOf(REMOTE);
    const hasBrand = (o) => String((o && o.logo_path) || '').trim() !== '';
    if (hasBrand(a) && !hasBrand(b)) {
      db.prepare('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?')
        .run(a.logo_path, a.primary_color, a.accent_color, b.id);
      console.log(`BOOT_PROGRAMS: mirrored branding from "${INPERSON}" to "${REMOTE}"`);
    } else if (hasBrand(b) && !hasBrand(a)) {
      db.prepare('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?')
        .run(b.logo_path, b.primary_color, b.accent_color, a.id);
      console.log(`BOOT_PROGRAMS: mirrored branding from "${REMOTE}" to "${INPERSON}"`);
    } else if (!hasBrand(a) && !hasBrand(b)) {
      console.log('BOOT_PROGRAMS: no branding on either org yet — upload from the Organizations page');
    } else {
      console.log('BOOT_PROGRAMS: both orgs already branded — leaving both alone');
    }

    // Move Bobby's named players into their orgs — standalone athletes only.
    const movePlayers = (orgId, orgName, names) => {
      const findPlayer = db.prepare(
        `SELECT id, organization_id FROM users WHERE role = 'athlete' AND (
           LOWER(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = ?
           OR LOWER(TRIM(COALESCE(athlete_name,''))) = ?
         )`
      );
      for (const name of names) {
        const key = name.toLowerCase();
        const p = findPlayer.get(key, key);
        if (!p) { console.log(`BOOT_PROGRAMS: no athlete found for "${name}" — skipped`); continue; }
        if (p.organization_id) {
          const cur = db.prepare('SELECT name FROM organizations WHERE id = ?').get(p.organization_id);
          console.log(`BOOT_PROGRAMS: "${name}" already in org "${cur ? cur.name : p.organization_id}" — not moved`);
          continue;
        }
        db.prepare('UPDATE users SET organization_id = ?, team_id = NULL WHERE id = ?').run(orgId, p.id);
        console.log(`BOOT_PROGRAMS: moved "${name}" into "${orgName}"`);
      }
    };
    movePlayers(inPerson.id, INPERSON, [
      'Briggs McNabb', 'Ethan Gonzalez', 'Luke Malfas', 'Paul Feret', 'Vince Imhof',
      'Mickey Krishel', 'Julian Rodriguez', 'Matthew Oros', 'Dylan Short',
      'Josh Ramos', 'Brandon Beasley', 'Michael Vasquez',
    ]);
    movePlayers(remote.id, REMOTE, ['Liam Stoffel', 'Dylan Kakuda', 'Ryan Seddon', 'Sam Chapman']);
  } catch (e) { console.warn('BOOT_PROGRAMS failed:', e.message); }
})();
// A signup code resolves to an organization, or to a team inside one.
// Returns { organizationId, teamId } or null.
function codeLookup(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const t = db.prepare('SELECT id, organization_id FROM teams WHERE UPPER(code) = ?').get(c);
  if (t) return { organizationId: t.organization_id, teamId: t.id };
  const o = db.prepare('SELECT id FROM organizations WHERE UPPER(code) = ?').get(c);
  if (o) return { organizationId: o.id, teamId: null };
  return null;
}
function getTeam(id) {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(id)) || null;
}
// Scoping for organization coaches: null = global coach (Bobby/Cam, sees
// everything); otherwise { orgId, teamId }. Organization-level coaches
// (teamId null) see every team in their program; team coaches see one team.
// In queries: AND (? IS NULL OR organization_id = ?) AND (? IS NULL OR team_id = ?)
function orgScope(req) {
  const u = realUser(req);
  if (!u || u.role !== 'coach' || !u.organizationId) return null;
  return { orgId: u.organizationId, teamId: u.teamId || null };
}
// Params for the scope pattern above: (orgId, orgId, teamId, teamId),
// or four nulls for a global coach.
function scopeParams(scope) {
  if (!scope) return [null, null, null, null];
  return [scope.orgId, scope.orgId, scope.teamId, scope.teamId];
}
const SCOPE_CLAUSE = 'AND (? IS NULL OR organization_id = ?) AND (? IS NULL OR team_id = ?)';
// Attach organization + team names and Skip availability after toReqUser
// builds the object.
function decorateUser(u) {
  if (u && u.organizationId) {
    const c = getOrganization(u.organizationId);
    u.organizationName = c ? c.name : null;
    u.brand = orgBrand(c);
    if (u.role === 'athlete') u.skipChatDisabled = c ? c.skip_enabled === 0 : false;
  }
  if (u && u.teamId) {
    const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(u.teamId);
    u.teamName = t ? t.name : null;
  }
  return u;
}
// Signup-code generator: NAME-XXXX with unambiguous characters.
function makeOrganizationCode(name) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TEAM';
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    let suffix = '';
    for (let j = 0; j < 4; j++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `${prefix}-${suffix}`;
    if (!db.prepare('SELECT id FROM organizations WHERE code = ?').get(code) &&
        !db.prepare('SELECT id FROM teams WHERE code = ?').get(code)) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}
// Team signup codes: same shape, unique across both tables so a code never
// resolves ambiguously.
function makeTeamCode(name) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TEAM';
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    let suffix = '';
    for (let j = 0; j < 4; j++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const code = `${prefix}-${suffix}`;
    if (!db.prepare('SELECT id FROM organizations WHERE code = ?').get(code) &&
        !db.prepare('SELECT id FROM teams WHERE code = ?').get(code)) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}
// Birthdate validation: YYYY-MM-DD, real date, not in the future, age 8-100.
function validDob(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const d = new Date(v + 'T12:00:00');
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 8 && age <= 100;
}
function ageOn(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}
// Player roles (Sep 2026): hitter, pitcher, or two_way (both).
const PLAYER_TYPES = ['hitter', 'pitcher', 'two_way'];
function playerTypeLabel(t) {
  return t === 'pitcher' ? 'Pitcher' : t === 'two_way' ? 'Two-way' : 'Hitter';
}
function validPlayerType(t) {
  return PLAYER_TYPES.includes(t);
}
// Pitching check-in vocab (mirrors views.js).
const PITCH_SESSION_TYPES = ['bullpen', 'live', 'game', 'catch_play', 'recovery', 'no_throw'];
const THROW_INTENTS = ['light', 'medium', 'heavy'];
const PITCH_TYPES = ['4-seam FB', '2-seam FB', 'Cutter', 'Slider', 'Curveball', 'Changeup', 'Splitter', 'Sweeper'];
const round1 = (n) => Math.round(n * 10) / 10;
// Mean of the sliders present (command is absent on recovery/no-throw days).
function pitchingScoreOf(feel, focus, confidence, command) {
  const nums = [feel, focus, confidence, command].filter((n) => n !== null && n !== undefined);
  return round1(nums.reduce((a, b) => a + b, 0) / nums.length);
}
function parsePitchesThrown(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(arr.map((s) => String(s).trim()).filter((s) => PITCH_TYPES.includes(s)))];
}
// College-org privacy (Bobby, Sep 17 2026): players in programs that aren't
// Bobby's own (organizations.is_mine != 1) get the restricted coach view —
// coaches see the brief summary (what he did, logged/streak/frequency, Skip's
// read), not the journal words, feel sliders, chats, or what-works detail.
function orgIsRestricted(organizationId, isMine) {
  return organizationId != null && isMine !== 1;
}
// The brief-summary view is for college/org coaches only — Bobby and other
// global coaches (users.organization_id IS NULL) always see full entries.
function viewerIsOrgCoach(req) {
  const v = typeof realUser === 'function' ? realUser(req) : req.user;
  return !!v && (v.organizationId != null || v.organization_id != null);
}

function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const row = db.prepare('SELECT id, email, role, athlete_name, first_name, last_name, status, remote_program_id, can_edit, organization_id, team_id, date_of_birth, player_type, waiver_signed_at, waiver_name, waiver_parent_name, waiver_version FROM users WHERE id = ?').get(req.session.userId);
    if (row) {
      req.user = decorateUser(toReqUser(row));
      // "View as hitter": the coach browses the app exactly as this hitter
      // sees it. req.user becomes the hitter; the real coach stays on
      // req.coachUser so coach-only routes keep working.
      if (row.role === 'coach' && req.session.viewAsUserId) {
        const t = db.prepare("SELECT id, email, role, athlete_name, first_name, last_name, status, remote_program_id, organization_id, team_id, date_of_birth, player_type, waiver_signed_at, waiver_name, waiver_parent_name, waiver_version FROM users WHERE id = ? AND role != 'coach'").get(req.session.viewAsUserId);
        if (t) {
          req.coachUser = req.user;
          req.user = decorateUser(toReqUser(t));
          req.user.viewAs = true;
          req.user.viewAsName = req.user.displayName;
          const tOrg = t.organization_id
            ? db.prepare('SELECT is_mine FROM organizations WHERE id = ?').get(t.organization_id)
            : null;
          req.user.viewAsRestricted = orgIsRestricted(t.organization_id, tOrg && tOrg.is_mine) && viewerIsOrgCoach(req);
        } else {
          delete req.session.viewAsUserId;
        }
      }
      // Unread message count for the nav/tab-bar badges (one cheap COUNT).
      req.user.unreadMessages = unreadMessageCount(req.user.id);
    }
  }
  next();
}
app.use(attachUser);

// The real logged-in user (the coach) even while viewing as a hitter.
function realUser(req) {
  return req.coachUser || req.user;
}
// In view-as mode the preview is read-only: no check-ins, chats, or edits
// can be submitted as the hitter by accident.
app.use((req, res, next) => {
  if (req.user && req.user.viewAs && req.method === 'POST' && req.path !== '/coach/view-as/exit') {
    return res.redirect('/');
  }
  next();
});

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  // Athletes waiting for Bobby's approval can't use the app yet.
  if (req.user.role !== 'coach' && req.user.status !== 'approved') {
    return res.redirect('/pending');
  }
  next();
}

function requireCoach(req, res, next) {
  // Full coach only: view-only coaches (can_edit=0) are blocked from every
  // mutation. Read routes use requireCoachAny below.
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach' || !u.canEdit) return res.status(403).send('Forbidden');
  next();
}

// Any coach, including view-only: dashboard, hitter views, library, Brain.
function requireCoachAny(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach') return res.status(403).send('Forbidden');
  next();
}

// Global coaches only (Bobby + Cam): organization coaches are scoped to their
// organization, so they never see remote programs, the video library, Train Skip,
// or the Organizations admin page.
function requireGlobalCoachAny(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach' || u.organizationId) return res.status(403).send('Forbidden');
  next();
}

// Coach settings (key/value). Used for Bobby's Skip coaching notes.
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Skip's Brain v2: structured coaching library (see src/brain.js). Seeds the
// library on first boot and migrates any legacy free-text coaching notes.
brain.ensureBrain(db, getSetting, setSetting);

// Extract the express-session id from a WebSocket upgrade request's cookies.
function getWsSessionId(req) {
  const header = req.headers.cookie || '';
  const m = header.match(/(?:^|;\s*)connect\.sid=([^;]+)/);
  if (!m) return null;
  let val;
  try {
    val = decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
  if (val.startsWith('s:')) {
    val = val.slice(2);
    const dot = val.lastIndexOf('.');
    if (dot === -1) return null;
    val = val.slice(0, dot);
  }
  return val || null;
}

// Simple in-memory throttle: 10 attempts per 5 minutes per IP.
const attempts = new Map();
function attemptAllowed(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, reset: now + 5 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 5 * 60 * 1000; }
  attempts.set(ip, rec);
  return rec.count < 10;
}
function attemptFailed(ip) {
  const rec = attempts.get(ip) || { count: 0, reset: Date.now() + 5 * 60 * 1000 };
  rec.count += 1;
  attempts.set(ip, rec);
}

// ---- Public routes: login / register / logout ----

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  if (req.query.reset) return res.send(views.loginPage(null, 'Password reset — log in with your new password.'));
  if (req.query.deleted) return res.send(views.loginPage(null, 'Account deleted. You\u2019re always welcome back.'));
  res.send(views.loginPage(req.query.error));
});

app.post('/login', (req, res) => {
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.loginPage('Too many attempts. Wait a few minutes and try again.'));
  }
  const { email, password } = req.body;
  const clean = (email || '').trim().toLowerCase();
  const row = validEmail(clean)
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(clean)
    : null;
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    attemptFailed(ip);
    return res.send(views.loginPage('Wrong email or password.'));
  }
  // Under-13 signups wait on a parent/guardian's emailed approval first.
  if (row.role !== 'coach' && row.status === 'pending_parent') {
    return res.send(
      views.loginPage(
        'Your account is waiting for a parent or guardian to approve it \u2014 ask them to check their email.',
        null,
        true
      )
    );
  }
  // New signups wait for Bobby's approval before they can get in.
  if (row.role !== 'coach' && row.status !== 'approved') {
    return res.send(views.loginPage('Your account is waiting for coach approval. You\u2019ll be able to log in once it\u2019s approved.'));
  }
  req.session.userId = row.id;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.registerPage(req.query.error));
});

// Public legal pages (linked from signup).
app.get('/terms', (req, res) => res.send(views.termsPage()));
app.get('/privacy', (req, res) => res.send(views.privacyPage()));

app.post('/register', (req, res) => {
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.registerPage('Too many attempts. Wait a few minutes and try again.'));
  }
  const fail = (msg) => {
    attemptFailed(ip);
    return res.send(views.registerPage(msg));
  };
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirm = req.body.confirm_password || '';
  const firstName = (req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = (req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!firstName || !lastName) {
    return fail('Enter your first and last name.');
  }
  const dob = String(req.body.date_of_birth || '').trim();
  if (!validDob(dob)) {
    return fail('Enter your date of birth.');
  }
  // User agreements (Sep 2026): everyone must accept the Terms + Privacy Policy.
  const agreed = req.body.agree_terms === '1' || req.body.agree_terms === 'on';
  if (!agreed) {
    return fail('Please agree to the Terms of Service and Privacy Policy to create an account.');
  }
  // Under 18: a parent/guardian must accept on the player's behalf.
  const age = ageOn(dob);
  const parentName = (req.body.parent_name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const parentEmail = (req.body.parent_email || '').trim().toLowerCase();
  if (age !== null && age < 18) {
    if (!parentName) {
      return fail('A parent or guardian\u2019s name is required for players under 18.');
    }
    if (!validEmail(parentEmail)) {
      return fail('A parent or guardian\u2019s valid email is required for players under 18.');
    }
  }
  const playerType = validPlayerType(req.body.player_type) ? req.body.player_type : 'hitter';
  // Organization code is optional: only players joining through an organization
  // use one. Accepts an organization code or a team code.
  const organizationCode = String(req.body.organization_code || '').trim();
  let organizationId = null;
  let teamId = null;
  if (organizationCode) {
    const found = codeLookup(organizationCode);
    if (!found) {
      return fail('That code wasn\u2019t recognized. Check it with your coach, or leave it blank.');
    }
    organizationId = found.organizationId;
    teamId = found.teamId;
  }
  if (!validEmail(email)) {
    return fail('Enter a valid email address.');
  }
  if (password.length < 8) {
    return fail('Password must be at least 8 characters.');
  }
  if (password !== confirm) {
    return fail('Passwords do not match.');
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) {
    return fail('An account with that email already exists. Try logging in.');
  }
  const hash = bcrypt.hashSync(password, 12);
  const athleteName = `${firstName} ${lastName}`;
  // Under 13: verifiable parental consent (COPPA). The account stays in
  // 'pending_parent' until the parent clicks the emailed approval link — only
  // then does it enter the normal coach-approval queue.
  const needsParentConsent = age !== null && age < 13;
  const status = needsParentConsent ? 'pending_parent' : 'pending';
  const consentToken = needsParentConsent ? crypto.randomBytes(32).toString('hex') : null;
  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      'INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, organization_id, team_id, date_of_birth, player_type, accepted_terms_at, terms_version, parent_name, parent_email, parent_consent_token_hash, parent_consent_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(email, hash, 'athlete', athleteName, firstName, lastName, nowIso, status, organizationId, teamId, dob, playerType, nowIso, '1', parentName || null, parentEmail || null, consentToken ? resetTokenHash(consentToken) : null, consentToken ? nowIso : null);
  linkRemoteProgram(info.lastInsertRowid, athleteName);
  if (needsParentConsent) {
    const base = publicBaseUrl(req);
    const link = `${base}/parent-consent?token=${consentToken}`;
    sendParentConsentEmail(parentEmail, athleteName, link, base).catch((e) =>
      console.warn('parent consent email failed:', e.message)
    );
    return res.redirect('/parent-wait');
  }
  // Tell Bobby so he can approve (or decline) the new hitter.
  notifyCoachOfSignup(req, email, athleteName, organizationId ? getOrganization(organizationId).name : null).catch((e) =>
    console.warn('signup notify failed:', e.message)
  );
  res.redirect('/pending');
});

// Waiting room for athletes Bobby hasn't approved yet.
app.get('/pending', (req, res) => {
  if (req.user && (req.user.role === 'coach' || req.user.status === 'approved')) {
    return res.redirect('/');
  }
  res.send(views.pendingPage());
});

// Waiting room for under-13 signups: we emailed the parent, and the account
// activates only after they click the approval link.
app.get('/parent-wait', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.parentWaitPage());
});

// ---- Verifiable parental consent for under-13 signups (COPPA) ----
const PARENT_CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function sendParentConsentEmail(to, childName, link, base) {
  const m = mailer();
  if (!m) {
    console.warn('PARENT CONSENT (no SMTP configured):', link);
    return false;
  }
  const first = String(childName || '').split(' ')[0] || 'your child';
  await m.transport.sendMail({
    from: m.from,
    to,
    subject: `Action needed: approve ${first}\u2019s Diamond Daily account`,
    text:
      `Hi,\n\n${childName} signed up for Diamond Daily, a baseball training journal app for players.\n\n` +
      `Because ${first} is under 13, we need a parent or guardian\u2019s approval before the account can be used.\n\n` +
      `What Diamond Daily collects: your child\u2019s name, email, date of birth, and whatever they log in the app \u2014 practice check-ins (scores and written notes), conversations with Skip (our AI training assistant), and notebook entries. We never sell personal information. Full details: ${base}/privacy\n\n` +
      `To approve ${first}\u2019s account, click this link (expires in 7 days):\n${link}\n\n` +
      `After you approve, the account still needs a coach\u2019s approval before it can be used. If you don\u2019t approve, the account stays inactive.\n\n\u2014 Diamond Daily`,
  });
  return true;
}

function validParentConsentToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.athlete_name, u.first_name, u.last_name, u.parent_consent_sent_at,
              u.organization_id, o.name AS organization_name
       FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.parent_consent_token_hash = ? AND u.parent_consent_verified_at IS NULL AND u.status = 'pending_parent'`
    )
    .get(resetTokenHash(token));
  if (!row) return null;
  if (new Date(row.parent_consent_sent_at).getTime() + PARENT_CONSENT_TTL_MS < Date.now()) return null;
  return row;
}

// The parent's click IS the verifiable consent record: verify, clear the
// token (single-use), and move the account into the coach-approval queue.
app.get('/parent-consent', (req, res) => {
  if (req.user) return res.redirect('/');
  if (req.query.resend) return res.send(views.parentConsentResendPage());
  const row = validParentConsentToken(req.query.token);
  if (!row)
    return res.send(
      views.parentConsentPage(null, 'That link is invalid or expired. Ask for a new one below and we\u2019ll email it right over.')
    );
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.athlete_name || 'your child';
  db.prepare(
    `UPDATE users SET parent_consent_verified_at = ?, parent_consent_token_hash = NULL, status = 'pending' WHERE id = ?`
  ).run(new Date().toISOString(), row.id);
  // Now they're in the normal coach-approval queue — tell the coach.
  notifyCoachOfSignup(req, row.email, row.athlete_name || name, row.organization_name || null).catch((e) =>
    console.warn('signup notify failed:', e.message)
  );
  res.send(views.parentConsentPage(name, null));
});

// Resend the parent-approval email (rate-limited; generic reply so account
// emails can't be enumerated).
app.post('/parent-consent/resend', (req, res) => {
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.parentConsentResendPage('Too many attempts. Wait a few minutes and try again.'));
  }
  const email = String(req.body.child_email || '').trim().toLowerCase();
  const user = validEmail(email)
    ? db
        .prepare(
          `SELECT id, email, athlete_name, parent_email FROM users WHERE email = ? AND status = 'pending_parent' AND parent_consent_verified_at IS NULL`
        )
        .get(email)
    : null;
  if (user && user.parent_email) {
    const token = crypto.randomBytes(32).toString('hex');
    const sentAt = new Date().toISOString();
    db.prepare(`UPDATE users SET parent_consent_token_hash = ?, parent_consent_sent_at = ? WHERE id = ?`).run(
      resetTokenHash(token),
      sentAt,
      user.id
    );
    const base = publicBaseUrl(req);
    sendParentConsentEmail(user.parent_email, user.athlete_name, `${base}/parent-consent?token=${token}`, base).catch((e) =>
      console.warn('consent resend failed:', e.message)
    );
  } else {
    attemptFailed(ip);
  }
  res.send(
    views.parentConsentResendPage('If that account is waiting on parent approval, a new email is on its way. Check the inbox (and spam).')
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---- Skip's session score ----

const ENVIRONMENTS = ['Game', 'Cage', 'Live BP', 'Tee Work', 'Other'];

function scoreTier(score) {
  if (score >= 9.0) return 'Locked In';
  if (score >= 7.0) return 'Solid';
  if (score >= 5.0) return 'Building';
  return 'Grind Day';
}

// Median session score — the "typical day". A single off day can't drag it
// the way a mean lets it (Bobby, Sep 17 2026: averages should reflect the
// pattern, not let one one-off day bring them down).
function medianScore(values) {
  const xs = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function parseRating(v) {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 10 ? n : null;
}

// ---- Skip session score: numbers + grind + the hitter's own words ----
// Base = mean of Feel/Confidence/Focus. Grind = how hard the training was:
// (difficulty - 5) * 0.2, clamped to [-1, +1] — grinding through a brutal
// session earns up to +1; an easy session with bad numbers loses up to 1.
// Words = what the hitter actually wrote: +0.5 / 0 / -0.5 from a small
// baseball-specific sentiment scan (negation-aware).
const WORDS_POSITIVE = [
  'locked in', 'dialed in', 'great', 'good', 'smooth', 'fluid', 'comfortable',
  'confident', 'clicked', 'squared it', 'barreled', 'barrels', 'better',
  'improved', 'improvement', 'progress', 'breakthrough', 'focused',
  'prepared', 'strong', 'quick hands', 'clean', 'consistent', 'on time',
  'stayed through', 'back up the middle', 'hard contact', 'felt good',
  'feeling good', 'easy', 'grooved',
];
const WORDS_NEGATIVE = [
  'frustrated', 'frustrating', 'terrible', 'awful', 'horrible', 'struggled',
  'struggling', 'late on', 'too late', 'under it', 'popping up', 'popped up',
  'pop ups', 'couldnt', 'cant', 'wouldnt', 'didnt', 'did not', 'lost',
  'pressing', 'anxious', 'nervous', 'rushed', 'rushing', 'tired', 'exhausted',
  'sore', 'soreness', 'pain', 'hurt', 'hurting', 'slump', 'angry', 'mad',
  'shut down', 'checked out', 'no energy', 'weak', 'inconsistent',
  'all over the place', 'chasing',
];
const NEGATORS =
  /\b(not|no|never|cannot|without|hardly|barely|wasnt|werent|isnt|arent|dont|doesnt|didnt|wont|cant|couldnt|shouldnt|wouldnt|hasnt|havent|hadnt)\b/;

function wordsAdjustment(text) {
  const t =
    ' ' +
    String(text || '')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ') +
    ' ';
  if (t.trim().length < 3) return 0;
  let net = 0;
  const scan = (phrases, sign) => {
    for (const p of phrases) {
      const needle = ' ' + p + ' ';
      let i = -1;
      while ((i = t.indexOf(needle, i + 1)) !== -1) {
        const before = t.slice(Math.max(0, i - 16), i);
        net += NEGATORS.test(before) ? -sign : sign;
      }
    }
  };
  scan(WORDS_POSITIVE, 1);
  scan(WORDS_NEGATIVE, -1);
  return net > 0 ? 0.5 : net < 0 ? -0.5 : 0;
}

function scoreBreakdown(feel, confidence, focus, difficulty, notesText) {
  const base = Math.round(((feel + confidence + focus) / 3) * 10) / 10;
  const d = difficulty == null ? 5 : difficulty;
  const grind = Math.round(Math.max(-1, Math.min(1, (d - 5) * 0.2)) * 10) / 10;
  const words = wordsAdjustment(notesText);
  const total = Math.round(Math.min(10, Math.max(1, base + grind + words)) * 10) / 10;
  return { base, grind, words, total };
}

const STATIONS = ['Prep', 'Tee', 'Side toss', 'Front toss', 'BP', 'Machine'];

// Known-drill matching (Sep 2026): hitters sometimes summarize their work
// ("did some tee stuff, front toss") instead of naming real drills. Only
// entries that match the drill library count as drills for Skip's reads and
// drill stats — the rest are kept as the hitter's own words ("other work"),
// never presented as literal drills.
function normDrillName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
let _knownDrillNorms = null;
function knownDrillNorms() {
  if (!_knownDrillNorms) {
    try {
      _knownDrillNorms = new Set(data.drillNames().map(normDrillName).filter(Boolean));
    } catch (e) {
      _knownDrillNorms = new Set();
    }
  }
  return _knownDrillNorms;
}
function matchKnownDrill(name) {
  const n = normDrillName(name);
  if (!n) return false;
  const set = knownDrillNorms();
  if (!set.size) return true; // no library to judge against — trust the entry
  if (set.has(n)) return true;
  if (n.length >= 4) {
    for (const k of set) {
      if (k.length >= 4 && (n.startsWith(k) || k.startsWith(n))) return true;
    }
  }
  return false;
}
// Whether one stored drills_done entry counts as a real drill. Entries
// written before this flag existed are judged at read time so old summaries
// stop polluting Skip's reads too.
function drillEntryKnown(d) {
  if (d && typeof d === 'object') {
    if (d.known === false) return false;
    if (d.known === true) return true;
  }
  const name = String((d && typeof d === 'object' ? d.name : d) || '');
  return matchKnownDrill(name);
}

function canonicalStation(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hit = STATIONS.find((st) => st.toLowerCase() === s.toLowerCase());
  return hit || (s.length <= 24 ? s : null);
}

function parseDrillsDone(raw) {
  // Form sends one text field; multiple drills are comma-separated.
  // A drill may carry its station in trailing parens: "Fence drill (tee)".
  // Also accepts a JSON array string (API-style input) of names or
  // {name, station} objects. Returns [{name, station|null}].
  const toEntry = (d) => {
    if (d && typeof d === 'object') {
      const name = String(d.name || '').trim();
      if (!name) return null;
      return { name, station: canonicalStation(d.station), known: drillEntryKnown(d) };
    }
    let name = String(d || '').trim();
    if (!name) return null;
    let station = null;
    const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && m[1].trim()) {
      station = canonicalStation(m[2]);
      if (station) name = m[1].trim();
    }
    return { name, station, known: matchKnownDrill(name) };
  };
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(toEntry).filter(Boolean);
    } catch (e) { /* fall through to comma split */ }
  }
  return s.split(',').map(toEntry).filter(Boolean);
}

function getRoutine(userId) {
  const rows = db
    .prepare('SELECT id, name, station FROM routine_drills WHERE user_id = ? ORDER BY position, id')
    .all(userId);
  const order = new Map(STATIONS.map((s, i) => [s.toLowerCase(), i]));
  return rows
    .map((r) => ({ id: r.id, name: r.name, station: r.station || null }))
    .sort(
      (a, b) =>
        (order.get(String(a.station || '').toLowerCase()) ?? 99) -
        (order.get(String(b.station || '').toLowerCase()) ?? 99)
    );
}

// Drills ranked by this hitter's average session score (min 3 sessions each).
function drillStats(athleteName) {
  const rows = db
    .prepare('SELECT drills_done, session_score FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL')
    .all(athleteName);
  const map = new Map();
  for (const r of rows) {
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const seen = new Set();
    for (const d of drills) {
      if (!drillEntryKnown(d)) continue; // summaries aren't drills — Skip shouldn't rank them
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { name, total: 0, count: 0 };
      e.total += r.session_score;
      e.count += 1;
      map.set(key, e);
    }
  }
  return [...map.values()]
    .filter((e) => e.count >= 3)
    .map((e) => ({ name: e.name, avg: Math.round((e.total / e.count) * 10) / 10, count: e.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
}

// Pregame prep that correlates with good games (Bobby, Sep 17 2026): the
// same min-3-sessions pattern as drillStats, but only Game / Live BP
// check-ins count — on those days "what he did" was really pregame prep.
// Training days (Cage, Tee Work, Other) never pollute this ranking.
function pregamePrepStats(athleteName) {
  const rows = db
    .prepare(
      "SELECT drills_done, session_score FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL AND environment IN ('Game', 'Live BP')"
    )
    .all(athleteName);
  const map = new Map();
  for (const r of rows) {
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const seen = new Set();
    for (const d of drills) {
      if (!drillEntryKnown(d)) continue; // summaries aren't drills — Skip shouldn't rank them
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { name, total: 0, count: 0 };
      e.total += r.session_score;
      e.count += 1;
      map.set(key, e);
    }
  }
  return [...map.values()]
    .filter((e) => e.count >= 3)
    .map((e) => ({ name: e.name, avg: Math.round((e.total / e.count) * 10) / 10, count: e.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
}

// Thoughts from the hitter's own words ("what worked"), ranked by average
// session score (min 2 sessions each). Very similar phrasings are grouped
// together — "stayed back", "stay back", "staying back" become one entry.
function thoughtGroups(athleteName) {
  const rows = db
    .prepare(
      `SELECT COALESCE(what_worked, '') || ' ' || COALESCE(felt_good, '') || ' ' || COALESCE(what_was_working, '') AS what_worked,
              session_score FROM checkins
       WHERE athlete_name = ? AND session_score IS NOT NULL
       AND TRIM(COALESCE(what_worked, '') || ' ' || COALESCE(felt_good, '') || ' ' || COALESCE(what_was_working, '')) <> ''`
    )
    .all(athleteName);
  const STOP = new Set([
    'the', 'a', 'an', 'and', 'to', 'of', 'my', 'i', 'it', 'on', 'in',
    'was', 'were', 'with', 'for', 'just', 'really', 'so', 'very', 'too',
    'felt', 'feeling', 'like', 'had', 'have',
  ]);
  const stem = (w) => {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
    return w;
  };
  const tokensOf = (t) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map(stem);
  const splitThoughts = (text) =>
    String(text)
      .split(/[\n;]+/)
      .map((s) =>
        s
          .trim()
          .replace(/^[\s•·▪\-–—]+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .slice(0, 140)
      )
      .filter((s) => s.length > 1);
  const groups = [];
  const similar = (aToks, aNorm, g) => {
    if (!aToks.length || !g.tokens.length) return false;
    const b = new Set(g.tokens);
    let inter = 0;
    for (const t of aToks) if (b.has(t)) inter++;
    const jaccard = inter / (aToks.length + g.tokens.length - inter);
    if (jaccard >= 0.6) return true;
    // One phrasing contains the other ("stay back" vs "really tried to stay back").
    if (aNorm.length >= 4 && g.norm.length >= 4) {
      if (aNorm.includes(g.norm) || g.norm.includes(aNorm)) return true;
    }
    return false;
  };
  for (const r of rows) {
    for (const thought of splitThoughts(r.what_worked)) {
      const toks = tokensOf(thought);
      const norm = thought.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      let g = groups.find((gg) => similar(toks, norm, gg));
      if (!g) {
        g = { tokens: toks, norm, variants: new Map(), total: 0, count: 0 };
        groups.push(g);
      }
      g.variants.set(thought, (g.variants.get(thought) || 0) + 1);
      g.total += r.session_score;
      g.count += 1;
    }
  }
  // External cues (target/outcome outside the body) rank before internal
  // cues (body-part instructions) — Bobby's rule.
  const INTERNAL_WORDS = [
    'hand', 'wrist', 'elbow', 'shoulder', 'hip', 'knee', 'ankle',
    'foot', 'feet', 'leg', 'head', 'eye', 'back', 'chest', 'body',
    'stride', 'load', 'barrel',
  ];
  const isInternal = (t) => {
    const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    return words.some((w) =>
      INTERNAL_WORDS.some((iw) => w === iw || w === iw + 's' || w === iw + 'es')
    );
  };
  return groups
    .filter((g) => g.count >= 2)
    .map((g) => {
      // Display the most common original phrasing.
      const display = [...g.variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        text: display,
        avg: Math.round((g.total / g.count) * 10) / 10,
        count: g.count,
        external: !isInternal(display),
      };
    })
    .sort(
      (a, b) =>
        (b.external - a.external || b.avg - a.avg || b.count - a.count)
    );
}

// Normalized drill names from a stored drills_done JSON value.
function sessionDrills(drillsDoneJson) {
  let arr = [];
  try { arr = JSON.parse(drillsDoneJson || '[]'); } catch (e) { arr = []; }
  const out = [];
  const seen = new Set();
  for (const d of arr) {
    const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, station: d && typeof d === 'object' ? d.station || null : null, known: drillEntryKnown(d) });
  }
  return out;
}

// "What did you do today?" sections (Bobby, Sep 17 2026: separated sections,
// not one text box). Storage stays IDENTICAL: drills_done JSON with trailing
// environment tags; sections only change how the form collects the input.
const DRILL_SECTIONS = views.DRILL_SECTIONS;
const SECTION_STATION = {
  prep: 'Prep', tee: 'Tee', sideToss: 'Side toss', frontToss: 'Front toss',
  bp: 'BP', machine: 'Machine', other: null,
};

// Canonical section key for a drill station (object station or trailing tag).
function drillSectionKey(st) {
  const s = String(st || '').trim().toLowerCase();
  if (s === 'prep') return 'prep';
  if (s === 'tee') return 'tee';
  if (s === 'side toss') return 'sideToss';
  if (s === 'front toss') return 'frontToss';
  if (s === 'bp' || s === 'batting practice') return 'bp';
  if (s === 'machine') return 'machine';
  return null;
}

// Split a stored drills_done JSON array back into the 7 section inputs.
// Untagged/unknown items land in Other. Names come back bare (the section
// implies the tag); section order is preserved by the caller.
function splitDrillsBySection(drillsDoneJson) {
  const out = {};
  for (const s of DRILL_SECTIONS) out[s.key] = [];
  for (const d of sessionDrills(drillsDoneJson)) {
    out[drillSectionKey(d.station) || 'other'].push(d.name);
  }
  const joined = {};
  for (const s of DRILL_SECTIONS) joined[s.key] = out[s.key].join(', ');
  return joined;
}

// Parse the 7 section inputs from a POST body into one drills_done array
// (section order). Each input is comma-separated; items keep an explicit
// trailing (tag) when present, otherwise they take their section's tag.
// Other-section items keep no tag. All-blank submits as [].
function parseSectionDrills(b) {
  const out = [];
  for (const s of DRILL_SECTIONS) {
    const station = SECTION_STATION[s.key];
    for (const e of parseDrillsDone(b[s.field])) {
      out.push(e.station ? e : { name: e.name, station: station ? canonicalStation(station) : null, known: e.known });
    }
  }
  return out;
}

// Recent drills grouped by delivery method for the "What did you do today?"
// picker (Bobby, Sep 17 2026: "they could kind of scroll through it and pick
// if they repeated shit"). The player's own history from the last 25 check-ins:
// most-recent-first within each section, deduped case-insensitively across
// sections, capped at 8 per section. Delivery method comes from the drill's
// station (canonicalized), falling back to parsing a trailing parenthetical
// tag on legacy plain-string rows.
function recentDrillGroups(userId) {
  const rows = db
    .prepare('SELECT drills_done FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 25')
    .all(userId);
  const groups = { prep: [], tee: [], sideToss: [], frontToss: [], bp: [], machine: [], other: [] };
  const seen = new Set();
  for (const r of rows) {
    for (const d of sessionDrills(r.drills_done)) {
      let key = drillSectionKey(d.station);
      let base = String(d.name);
      if (!key) {
        const m = String(d.name).match(/^(.*?)\s*\(([^()]*)\)\s*$/);
        if (m && m[1].trim()) { key = drillSectionKey(m[2]); base = m[1].trim(); }
      }
      // A drill literally named "prep" is prep work, even untagged.
      if (!key && base.trim().toLowerCase() === 'prep') key = 'prep';
      const gkey = key || 'other';
      // Keep the delivery-method tag on the chip so re-tapping re-logs it
      // with its method intact (Skip uses it).
      const displayStation = d.station ? (canonicalStation(d.station) || d.station) : null;
      const label = displayStation ? `${d.name} (${displayStation})` : d.name;
      const lkey = label.toLowerCase();
      if (seen.has(lkey)) continue;
      seen.add(lkey);
      if (groups[gkey].length < 8) groups[gkey].push(label);
    }
  }
  return groups;
}

// Everything the "What works for you" section needs: good-day vs trash cues,
// whether routine days beat other days, a suggested routine when none is set,
// and drills worth adding when one is.
function whatWorksData(athleteName, userId) {
  const scored = db
    .prepare(
      'SELECT session_score, drills_done FROM checkins WHERE athlete_name = ? AND session_score IS NOT NULL'
    )
    .all(athleteName);
  const round1 = (n) => Math.round(n * 10) / 10;
  const data = {
    checkinCount: scored.length,
    overallAvg: null,
    goodCues: [],
    trashCues: [],
    drills: [],
    routineVerdict: null,
    suggestedRoutine: null,
    drillSuggestions: [],
  };
  if (!scored.length) return data;
  data.overallAvg = round1(medianScore(scored.map((r) => r.session_score)));

  const groups = thoughtGroups(athleteName);
  data.goodCues = groups.filter((g) => g.avg >= data.overallAvg).slice(0, 4);
  data.trashCues = groups
    .filter((g) => g.avg < data.overallAvg)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3);
  // Pitchers: the cue analysis above runs on their throwing reflections (see
  // thoughtGroups). Drills and daily routines are hitting concepts — phase 1
  // keeps "What works for you" to cues only for pitcher-only athletes.
  const ptype = (db.prepare('SELECT player_type FROM users WHERE id = ?').get(userId) || {}).player_type || 'hitter';
  if (ptype === 'pitcher') return data;
  data.drills = drillStats(athleteName);

  const routine = getRoutine(userId);
  const routineNames = new Set(routine.map((r) => r.name.trim().toLowerCase()));
  const goodSessions = scored.filter((r) => r.session_score >= data.overallAvg);
  const tally = () => {
    const map = new Map();
    for (const c of goodSessions) {
      for (const d of sessionDrills(c.drills_done)) {
        if (!d.known) continue;
        const key = d.name.toLowerCase();
        const e = map.get(key) || { name: d.name, stations: {}, total: 0, count: 0 };
        if (d.station) e.stations[d.station] = (e.stations[d.station] || 0) + 1;
        e.total += c.session_score;
        e.count += 1;
        map.set(key, e);
      }
    }
    return [...map.values()].map((e) => ({
      name: e.name,
      station:
        Object.entries(e.stations).sort((a, b) => b[1] - a[1])[0] ?
        Object.entries(e.stations).sort((a, b) => b[1] - a[1])[0][0] : null,
      avg: round1(e.total / e.count),
      count: e.count,
    }));
  };

  if (routine.length) {
    // Routine days vs everything else.
    const rDays = [];
    const oDays = [];
    for (const c of scored) {
      const drills = sessionDrills(c.drills_done);
      const matched = drills.filter((d) => routineNames.has(d.name.toLowerCase())).length;
      (matched >= Math.ceil(routine.length / 2) ? rDays : oDays).push(c.session_score);
    }
    // Only call it if both kinds of days actually happen — if the hitter
    // only ever does their routine (or only ever freelances), there is no
    // comparison to make.
    const minorityShare = Math.min(rDays.length, oDays.length) / scored.length;
    if (rDays.length >= 2 && oDays.length >= 2 && minorityShare >= 0.25) {
      const rAvg = round1(avg(rDays));
      const oAvg = round1(avg(oDays));
      // Only say it when routine days are heavily better — never talk a
      // hitter out of having a routine.
      if (rAvg - oAvg >= 1.5) {
        data.routineVerdict = {
          routineAvg: rAvg,
          otherAvg: oAvg,
          routineN: rDays.length,
          otherN: oDays.length,
        };
      }
    }
    // Good-day drills that are NOT in the routine — candidates to add.
    data.drillSuggestions = tally()
      .filter((e) => !routineNames.has(e.name.toLowerCase()) && e.count >= 2)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3);
  } else {
    // No routine saved — suggest one from the drills of their best days.
    const list = tally()
      .filter((e) => e.count >= 2)
      .sort((a, b) => b.count - a.count || b.avg - a.avg)
      .slice(0, 6);
    if (list.length >= 2) data.suggestedRoutine = list;
  }
  return data;
}

function userScoreSummary(userId) {
  const checkins = db
    .prepare('SELECT session_score FROM checkins WHERE user_id = ? AND session_score IS NOT NULL')
    .all(userId);
  const med = medianScore(checkins.map((c) => c.session_score));
  const avgScore = med != null ? Math.round(med * 10) / 10 : null;
  return { avgScore, checkinCount: checkins.length };
}

// ---- Hitter routes ----

// Bible study opt-in popup (Sep 23 2026, Bobby): shown once on app open to
// athletes who haven't answered yet (bible_study IS NULL). Excludes Sammy
// Atkinson and Tommy (Bobby's call) and never shows in coach view-as.
function showBiblePopupFor(user, bibleStudy) {
  if (!user || user.role !== 'athlete' || user.viewAs) return false;
  if (bibleStudy !== null && bibleStudy !== undefined) return false;
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
  if (full === 'sammy atkinson') return false;
  // TODO: tighten to full name once Bobby confirms Tommy's last name.
  if ((user.firstName || '').trim().toLowerCase() === 'tommy') return false;
  return true;
}

app.get('/', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // Remote hitters land on Programs (Bobby Sep 23 2026) — it's their first
  // tab. Everyone else lands on Lock In.
  if (req.user.remoteProgramId) return res.redirect('/program');
  res.redirect('/mental-game');
});

// Remote-program players (Bobby's remote hitters) already have a plan, so
// "What did you do today?" is pre-filled with today's scheduled work, mapped
// into the 7 sections by category keyword ("Day 1 — Tee" -> tee section;
// "Daily Routine" -> prep). The pre-filled text is just each section input's
// value — chips toggle and manual edits work exactly as usual. Returns a
// sections object ({prep, tee, sideToss, frontToss, bp, machine, other}) of
// comma-joined strings, all blank when there's nothing to pre-fill.
// Schedule entries come from Bobby's sheets as [weekday, day-label] pairs
// (e.g. ["Monday","Day 1"], ["Sunday","OFF"]); tolerate { weekday, day_label }
// objects too. Always returns { weekday, label }.
function schedEntry(s) {
  if (Array.isArray(s)) {
    return { weekday: String(s[0] || '').trim(), label: String(s[1] || '').trim() };
  }
  if (s && typeof s === 'object') {
    return {
      weekday: String(s.weekday || '').trim(),
      label: String(s.day_label || s.label || '').trim(),
    };
  }
  return { weekday: '', label: '' };
}
function todayProgramPrefill(userId, now) {
  const blank = {};
  for (const s of DRILL_SECTIONS) blank[s.key] = [];
  const joinSecs = (o) => {
    const j = {};
    for (const s of DRILL_SECTIONS) j[s.key] = o[s.key].join(', ');
    return j;
  };
  const u = db.prepare('SELECT remote_program_id FROM users WHERE id = ?').get(userId) || {};
  if (!u.remote_program_id) return joinSecs(blank);
  const row = db.prepare('SELECT program_json FROM remote_programs WHERE id = ?').get(u.remote_program_id);
  if (!row) return joinSecs(blank);
  let prog = {};
  try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { return joinSecs(blank); }
  if (!prog || typeof prog !== 'object') return joinSecs(blank);
  const sectionForCategory = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('tee')) return 'tee';
    if (n.includes('side')) return 'sideToss';
    if (n.includes('front')) return 'frontToss';
    if (n.includes('bp')) return 'bp';
    if (n.includes('machine')) return 'machine';
    if (n.includes('routine') || n.includes('prep') || n.includes('warm')) return 'prep';
    return 'other';
  };
  const cats = Array.isArray(prog.routine) ? prog.routine : [];
  const daily = [];
  const dayCats = []; // [categoryName, drills[]], excluding Daily Routine
  for (const c of cats) {
    const name = String((c && c.category) || '');
    const drills = (Array.isArray(c && c.items) ? c.items : [])
      .map((it) => String((it && it.drill) || '').trim())
      .filter(Boolean);
    if (name.toLowerCase() === 'daily routine') daily.push(...drills);
    else if (name) dayCats.push([name, drills]);
  }
  const sched = (Array.isArray(prog.schedule) ? prog.schedule : []).map(schedEntry);
  const weekday = chiWeekdayFmt.format(now || new Date());
  const entry = sched.find((e) => e.weekday.toLowerCase() === weekday.toLowerCase());
  if (entry && /^(off|rest)$/i.test(entry.label)) return joinSecs(blank); // rest day
  const extra = []; // [sectionKey, drill]
  if (entry && entry.label) {
    const label = entry.label.toLowerCase();
    for (const [name, drills] of dayCats) {
      if (name.toLowerCase().startsWith(label)) {
        const key = sectionForCategory(name);
        for (const d of drills) extra.push([key, d]);
      }
    }
  }
  // No schedule or no match: just the daily routine (in prep) — or blank.
  const seen = new Set();
  const add = (key, d) => {
    const k = d.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    blank[key].push(d);
  };
  for (const d of daily) add('prep', d);
  for (const [key, d] of extra) add(key, d);
  return joinSecs(blank);
}

// Normalize values for the hitting check-in form: the 7 section inputs read
// from sec_* fields, a `sections` object (remote pre-fill), or — as a
// fallback — a legacy drills_done array/string split back into sections.
function checkinValues(v) {
  const out = Object.assign({}, v);
  if (out.drills_done && !DRILL_SECTIONS.some((s) => out[s.field])) {
    out.sections = splitDrillsBySection(out.drills_done);
  }
  return out;
}

app.get('/checkin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // The form follows the player's role: hitters get the hitting check-in,
  // pitchers get the throwing check-in, two-ways get one combined form.
  const pt = req.user.playerType || 'hitter';
  if (pt === 'pitcher') return res.send(views.pitchingCheckinForm(req.user, null, {}));
  if (pt === 'two_way') return res.send(views.combinedCheckinForm(req.user, null, {}));
  res.send(views.checkinForm(req.user, null, checkinValues({ sections: todayProgramPrefill(req.user.id) }), data.drillNames(), getRoutine(req.user.id), recentDrillGroups(req.user.id)));
});

// ---- Daily routine ----
app.get('/routine', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.send(views.routinePage(req.user, getRoutine(req.user.id), null, data.drillNames(), STATIONS));
});

app.post('/routine/add', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const station = canonicalStation(req.body.station);
  if (!name || !station) {
    return res.send(views.routinePage(req.user, getRoutine(req.user.id), 'Give the drill a name and pick where it\u2019s done.', data.drillNames(), STATIONS));
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM routine_drills WHERE user_id = ?').get(req.user.id).p;
  db.prepare('INSERT INTO routine_drills (user_id, name, station, position) VALUES (?, ?, ?, ?)').run(
    req.user.id, name, station, pos
  );
  res.redirect('/routine');
});

app.post('/routine/adopt', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  let drills = [];
  try { drills = JSON.parse(req.body.drills || '[]'); } catch (e) { drills = []; }
  if (getRoutine(req.user.id).length === 0 && Array.isArray(drills) && drills.length) {
    const ins = db.prepare(
      'INSERT INTO routine_drills (user_id, name, station, position) VALUES (?, ?, ?, ?)'
    );
    let pos = 0;
    for (const d of drills.slice(0, 8)) {
      const name = String((d && d.name) || '').trim().slice(0, 80);
      if (!name) continue;
      ins.run(req.user.id, name, canonicalStation(d && d.station) || 'Tee', pos++);
    }
  }
  res.redirect('/routine');
});

app.post('/routine/remove', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  db.prepare('DELETE FROM routine_drills WHERE id = ? AND user_id = ?').run(req.body.id, req.user.id);
  res.redirect('/routine');
});

// ---- Remote programs: Bobby's remote hitters get their training program
// in the app. Accounts link by name at signup (and on every boot, in db.js).
const PROGRAM_GRADES = ['Load', 'Path', 'Connection', 'Timing', 'Power Production'];
function blankProgram(name) {
  return {
    athlete: name,
    date_range: '',
    phase_emphasis: '',
    adjustment: '',
    routine: [],
    grades: {},
    strengths: [],
    cues: { movement: '', timing: '', game: '' },
    mental_framework: '',
    schedule: [],
    notes: [],
  };
}
function getProgram(id) {
  const row = db.prepare('SELECT * FROM remote_programs WHERE id = ?').get(Number(id));
  if (!row) return null;
  let prog = null;
  try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { prog = {}; }
  if (!prog || typeof prog !== 'object') prog = {};
  return { id: row.id, athlete_name: row.athlete_name, updated_at: row.updated_at, prog, session_order: row.session_order || 'hitting_first', component_order: row.component_order || '' };
}
// Hitting plan version — bump when buildHittingPlan logic changes to force regen of stale stored plans.
const HITTING_PLAN_VERSION = 5;
// Build a hitting-plan document from Bobby's template (Sep 23 2026):
// Eval (Key Strengths, Grades, Overall Grade, Need) + Plan (2-4 core drills
// with Why? + sets/reps, frequency line, training environments at the bottom).
// Template: ~/workspace/user/files/Atkinson_Hitting_Remote_Template.docx
// Bobby: no Weekly Check-In Notes (the app does that), no mobility (lives in
// lifting), no prep section — just Eval + Plan. Grades/strengths/adjustment
// come straight from his sheets; the docs regenerate when the sheets change.
function buildHittingPlan(prog) {
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const athleteKey = norm(prog.athlete);

  // Core drills per hitter (Bobby: 2-4 drills, never the full 33-53 sheet
  // lists). Each "why" is written from the hitter's own adjustment + cues
  // in the sheet data. Volumes/notes are pulled from the sheet below.
  const CORE_DRILLS = {
    'dylan kakuda': [
      { name: 'Tracer Drill', why: 'Trains the launch position — bat tall with space from the body, no sway.' },
      { name: 'Open 45 w/ stride', why: 'Loads around the hip (no sway) while working the barrel open-side.' },
      { name: 'Kick Through', why: 'Drives the lower half through so the hips lead instead of swaying off the ball.' },
      { name: 'Med Ball Drill', why: 'Feels the hip load and separation behind the barrel.' },
    ],
    'liam stoffel': [
      { name: 'No Stride Launch', why: 'Pure coil and early barrel turn — no stride to cheat the load.' },
      { name: 'Open 45 w Stride', why: 'Loads around the back hip while getting the barrel out front.' },
      { name: 'Ball Drop Drill', why: 'Forces the barrel to get going fast early on a reaction.' },
    ],
    'ryan seddon': [
      { name: 'Deep Tee Drill', why: 'Keeps the barrel in the zone deep instead of cutting across it.' },
      { name: 'Hand Pump Drill', why: 'Connects the back hip and barrel so they move as one.' },
      { name: 'Knob to Knee', why: 'Keeps the barrel behind the ball at launch.' },
      { name: 'Banded Turns', why: 'Builds the connected turn — back hip and barrel working together.' },
    ],
    'sam chapman': [
      { name: 'Punching Bag / Tire', why: 'Swings the barrel with the body, not the hands — deep and connected.' },
      { name: 'Med Ball Drill', why: 'Feels the chest-over-the-plate posture driving the barrel.' },
      { name: 'Kick Through Drill', why: 'Turns it deep — heel up, all one move.' },
      { name: 'Ball Drop Drill', why: 'Trains waiting for it, then swinging the barrel late and deep.' },
    ],
  };
  const wanted = CORE_DRILLS[athleteKey] || [];

  // First sheet occurrence of each drill -> volume + coach note.
  const sheetInfo = {};
  for (const block of routine) {
    const items = Array.isArray(block.items) ? block.items : [];
    for (const it of items) {
      const key = norm(it && it.drill);
      if (!key) continue;
      const vol = (it && it.volume) || '';
      // Prefer the first occurrence that carries a volume (early blocks like
      // Daily Routine list drill names with no volume).
      if (!sheetInfo[key] || (!sheetInfo[key].volume && vol)) {
        sheetInfo[key] = { volume: vol, note: (it && it.note) || '' };
      }
    }
  }

  const drills = wanted.map((w) => {
    const info = sheetInfo[norm(w.name)] || {};
    return {
      name: w.name,
      progression: info.note || '',
      why: w.why,
      setsReps: info.volume || '',
    };
  });

  // Training environments (conditions, NOT drills) — collected from the sheet,
  // deduplicated, in first-seen order. They render at the bottom of the doc.
  const isEnvVariation = (name) => /open\s*angle|breaking\s*ball|velo|fastball|curve|slider|changeup|machine\s*work|game\s*swings?/i.test(name || '');
  const environments = [];
  const seenEnv = new Set();
  for (const block of routine) {
    const items = Array.isArray(block.items) ? block.items : [];
    for (const it of items) {
      const nm = it && it.drill;
      if (nm && isEnvVariation(nm) && !seenEnv.has(norm(nm))) {
        seenEnv.add(norm(nm));
        environments.push(nm);
      }
    }
  }

  // Program "Why?" — why this program exists and what the hitter should feel.
  const cues = prog.cues && typeof prog.cues === 'object' ? prog.cues : {};
  const whyParts = [];
  if (prog.phase_emphasis) whyParts.push('Built around ' + prog.phase_emphasis + '.');
  if (prog.adjustment) whyParts.push('Focus: ' + prog.adjustment);
  if (cues.movement) whyParts.push('Feel: ' + cues.movement);
  const whyText = whyParts.join(' ');

  return {
    _v: HITTING_PLAN_VERSION,
    strengths: Array.isArray(prog.strengths) ? prog.strengths.filter(Boolean) : [],
    grades: prog.grades && typeof prog.grades === 'object' ? prog.grades : {},
    grade_whys: prog.grade_whys && typeof prog.grade_whys === 'object' ? prog.grade_whys : {},
    overall_grade: '',
    need: prog.adjustment || '',
    why_text: whyText,
    reminder: cues.game || '',
    drills,
    environments,
    frequency: 'Complete this 3–5x per week. Keep the focus to 1–2 cues per swing.',
  };
}
// ---- Programs tab: lifting + check-offs (Sep 2026) ----
// Chicago date string (YYYY-MM-DD) used as the check-off day key.
function chiToday() {
  return chiDay(new Date());
}
// Classify a program block category into a Programs sub-tab.
// Bobby's order: lifters get MOBILITY -> HITTING -> METABOLIC -> LIFTING (med
// ball work lives INSIDE the Lifting tab); everyone else gets MOBILITY ->
// MED BALL -> HITTING -> METABOLIC. Prep work always stays with Hitting.
function blockKind(category) {
  const n = String(category || '');
  if (/med\s*ball/i.test(n)) return 'medball';
  if (/mobility/i.test(n)) return 'mobility';
  if (/prep/i.test(n)) return 'prep';
  if (/metabol|conditioning/i.test(n)) return 'metabolic';
  return 'hit';
}
function splitProgramBlocks(p) {
  const prog = (p && p.prog) || {};
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const out = { mobility: [], medball: [], prep: [], hit: [], metabolic: [] };
  // Bobby's rule: blocks with no real items (blank rows he left empty) don't
  // exist for the athlete — they neither render nor create tabs.
  const realItems = (items) =>
    (Array.isArray(items) ? items : []).filter((it) => String((it && it.drill) || '').trim());
  for (const c of routine) {
    const items = realItems(c && c.items);
    if (!items.length) continue;
    const k = blockKind(c.category);
    if (k === 'prep') out.prep.push(c);
    else out[k].push(c);
  }
  // Bobby (Sep 23 2026): mobility/medball can also live in top-level prog
  // fields (from sheets), not just routine blocks. Include those.
  if (!out.mobility.length && Array.isArray(prog.mobility) && prog.mobility.length) {
    const items = realItems(prog.mobility);
    if (items.length) out.mobility.push({ category: 'Mobility', items });
  }
  if (!out.medball.length && Array.isArray(prog.medball) && prog.medball.length) {
    const items = realItems(prog.medball);
    if (items.length) out.medball.push({ category: 'Med Ball', items });
  }
  return out;
}
// Which Programs sub-tabs an athlete gets (Bobby, Sep 23 2026): Mobility tab
// only when the program has mobility content AND no lifting program — lifters
// get mobility paired INSIDE the Lifting tab. Med Ball tab only when they have
// med ball content, no lifting, AND no mobility (mobility + med ball pair in
// the Mobility tab for non-lifters). Hitting always; Lifting only when a
// lifting program with real exercises is assigned.
// Returns [{ id, label }].
function programSubTabs(p, lifting) {
  const blocks = splitProgramBlocks(p);
  const tabs = [];
  const liftDays = lifting && Array.isArray(lifting.days) ? lifting.days : [];
  const hasLifting = liftDays.some((d) =>
    (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => String((ex && ex.name) || '').trim())
  );
  // Med ball rides with lifting — it's the explosive start of it.
  // Bobby (Sep 23 2026): no standalone Mobility section unless the athlete
  // has mobility work AND no lifting program. Lifters get mobility paired
  // inside the Lifting tab; non-lifters get mobility + med ball paired in one
  // flow (the Mobility tab). A lone Med Ball tab only appears when there's med
  // ball work but no mobility blocks to pair it with.
  if (blocks.mobility.length && !hasLifting) tabs.push({ id: 'mobility', label: 'Warm-up' });
  if (!hasLifting && blocks.medball.length && !blocks.mobility.length) tabs.push({ id: 'medball', label: 'Med Ball' });
  tabs.push({ id: 'hitting', label: 'Hitting' });
  // No Metabolic tab (Sep 2026): speed work lives inside the Lifting tab.
  // Legacy 'Metabolic' blocks in old programs render in the Lifting tab's
  // Speed section instead of getting their own tab.
  if (hasLifting) {
    tabs.push({ id: 'lifting', label: 'Lifting' });
  }
  return tabs;
}
// Distinct day labels across a program's blocks, in first-seen order
// (e.g. "Day 1", "Day 2", "Pregame").
function programDayLabels(p) {
  const prog = (p && p.prog) || {};
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const seen = [];
  for (const c of routine) {
    const m = /^([A-Za-z]+ ?\d+|Pregame)/i.exec(String(c.category || '').trim());
    const label = m ? m[1].trim() : null;
    if (label && !seen.some((s) => s.toLowerCase() === label.toLowerCase())) seen.push(label);
  }
  return seen;
}
// Auto-detected "current day": today's Chicago weekday -> the athlete's
// scheduled day label from THEIR sheet (e.g. Sam: Tuesday -> Day 2).
// Returns '' when the program has no schedule for today (caller falls back
// to the first day label).
function programCurrentDay(p) {
  const prog = (p && p.prog) || {};
  const schedule = (Array.isArray(prog.schedule) ? prog.schedule : []).map(schedEntry);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
  const hit = schedule.find((s) => s.weekday.toLowerCase() === weekday.toLowerCase() && s.label);
  return hit ? hit.label : '';
}
function getLifting(id) {
  if (!id) return null;
  const row = db.prepare('SELECT * FROM lifting_programs WHERE id = ?').get(Number(id));
  if (!row) return null;
  let pj = {};
  try { pj = JSON.parse(row.program_json || '{}'); } catch (e) { pj = {}; }
  if (!pj || typeof pj !== 'object') pj = {};
  if (!Array.isArray(pj.days)) pj.days = [];
  // Preserve any extra fields on the JSON (draft flag, warm-ups, injury
  // flags, progression read) instead of dropping them on read.
  return { id: row.id, name: row.name, is_template: row.is_template, ...pj, days: pj.days, notes: pj.notes || [] };
}
// Today's check-offs for an athlete, keyed by item_key.
function getCheckoffs(userId, day) {
  const rows = db
    .prepare('SELECT * FROM program_checkoffs WHERE user_id = ? AND day = ?')
    .all(userId, day);
  const map = {};
  for (const r of rows) map[r.item_key] = r;
  return map;
}

// Most recent logged lift for an exercise (per-set log or legacy weight/RPE).
// Prefers an earlier day ("what you did last time"); falls back to any
// earlier log today.
function parseSets(row) {
  try {
    const s = JSON.parse(row && row.sets_json ? row.sets_json : '[]');
    return Array.isArray(s) ? s : [];
  } catch (e) { return []; }
}
function lastLiftLog(userId, itemKey, today) {
  let r = db
    .prepare(
      `SELECT * FROM program_checkoffs
       WHERE user_id = ? AND item_key = ? AND day < ? AND (weight IS NOT NULL OR rpe IS NOT NULL OR sets_json IS NOT NULL)
       ORDER BY day DESC LIMIT 1`
    )
    .get(userId, itemKey, today);
  if (!r) {
    r = db
      .prepare(
        `SELECT * FROM program_checkoffs
         WHERE user_id = ? AND item_key = ? AND day <= ? AND (weight IS NOT NULL OR rpe IS NOT NULL OR sets_json IS NOT NULL)
         ORDER BY day DESC, id DESC LIMIT 1`
      )
      .get(userId, itemKey, today);
  }
  if (r) r.sets = parseSets(r);
  return r || null;
}
function liftHistory(userId, itemKey, limit) {
  const rows = db
    .prepare(
      `SELECT * FROM program_checkoffs
       WHERE user_id = ? AND item_key = ? AND (weight IS NOT NULL OR rpe IS NOT NULL OR sets_json IS NOT NULL)
       ORDER BY day DESC, id DESC LIMIT ?`
    )
    .all(userId, itemKey, limit || 8);
  for (const r of rows) r.sets = parseSets(r);
  return rows;
}
// Lifting day selection (Sep 23 2026, Bobby: the Lifting tab follows the real
// seven-day calendar, not a rotation). Today's schedule label (e.g. 'Day 2')
// picks the lifting day; Recovery / Mobility / OFF days get NO lifting —
// OFF stays actual rest. Athletes with no schedule keep the legacy
// block_start rotation as a fallback. Returns -1 for rest days.
// An explicit ?lday= always wins (handled in pickLiftingDayIdx).
function todayLiftingDayIdx(p, n) {
  if (!n) return 0;
  try {
    const label = String(programCurrentDay(p) || '').trim();
    const m = label.match(/day\s*(\d+)/i);
    if (m) {
      const k = parseInt(m[1], 10) - 1;
      if (Number.isFinite(k)) return Math.max(0, Math.min(n - 1, k));
    }
    // A schedule exists but today isn't a lifting day -> rest, no lifting.
    const prog = (p && p.prog) || {};
    if (Array.isArray(prog.schedule) && prog.schedule.length) return -1;
  } catch (e) { /* fall through to legacy rotation */ }
  // No schedule: legacy rotation (days since block_start, mod lifting days).
  try {
    const r = db.prepare('SELECT block_start FROM remote_programs WHERE id = ?').get(p && p.id);
    const start = r && r.block_start;
    if (!start) return 0;
    // Calendar-day difference in Chicago time — the lift rolls over at
    // midnight, not 24h after whatever time block_start was recorded.
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const tDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const parts = String(start).slice(0, 10).split('-').map(Number);
    if (parts.length < 3 || parts.some((x) => !Number.isFinite(x))) return 0;
    const sDay = new Date(parts[0], parts[1] - 1, parts[2]);
    const days = Math.round((tDay - sDay) / 864e5);
    return ((days % n) + n) % n;
  } catch (e) { return 0; }
}
function pickLiftingDayIdx(req, p, n) {
  const q = parseInt(req.query.lday, 10);
  if (req.query.lday != null && String(req.query.lday).trim() !== '' && Number.isFinite(q)) {
    return n ? Math.max(0, Math.min(n - 1, q)) : 0;
  }
  return todayLiftingDayIdx(p, n);
}
// Workout-mode day builder (Sep 23 2026): shapes one lifting day into
// structured JSON for the guided session — Speed -> Med Ball -> Lifts.
// Each item carries its checkoff key, prescription, video, last-time log,
// and today's logged sets so the client can render without extra calls.
function buildWorkoutDay(userId, lifting, ldayIdx, today) {
  const days = (lifting && Array.isArray(lifting.days) ? lifting.days : [])
    .filter((d) => (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => String((ex && ex.name) || '').trim()));
  const day = days[ldayIdx] || null;
  if (!day) return { days: days.map((d) => d.label || ''), day: null };
  const dayKey = String(day.label || '');
  const checkoffs = getCheckoffs(userId, today);
  const parseVol = (v) => {
    const m = String(v || '').match(/(\d+)\s*x\s*(\d+)/i);
    return m ? { sets: Math.max(1, Math.min(20, parseInt(m[1], 10))), reps: m[2] } : { sets: 3, reps: '' };
  };
  const spd = (Array.isArray(day.speed) ? day.speed : [])
    .filter((s) => String((s && s.name) || '').trim() && !(s && s.held))
    .map((s) => {
      const key = `spd::lifting::${dayKey}::${s.name}`;
      const row = checkoffs[key] || null;
      const loggedSets = parseSets(row);
      const vol = parseVol(s.volume);
      const last = lastLiftLog(userId, key, today);
      const lastSets = last && Array.isArray(last.sets) ? last.sets : [];
      const dispSets = loggedSets.length
        ? loggedSets
        : Array.from({ length: vol.sets }, (_, k) => {
            const prev = lastSets[k];
            return {
              w: null,
              r: prev && prev.r != null ? prev.r : (vol.reps === '' ? null : parseInt(vol.reps, 10) || null),
              done: 0,
            };
          });
      return {
        type: 'speed', key, name: String(s.name || ''),
        volume: String(s.volume || ''), notes: String(s.notes || ''), video: String(s.video || ''),
        intent: String(s.intent || ''), done: !!checkoffs[key],
        dispSets, progSetCount: vol.sets, progReps: vol.reps,
      };
    });
  const med = (Array.isArray(day.medball) ? day.medball : [])
    .filter((s) => String((s && s.name) || '').trim() && !(s && s.held))
    .map((s) => {
      const key = `med::lifting::${dayKey}::${s.name}`;
      const row = checkoffs[key] || null;
      const loggedSets = parseSets(row);
      const vol = parseVol(s.volume);
      const last = lastLiftLog(userId, key, today);
      const lastSets = last && Array.isArray(last.sets) ? last.sets : [];
      const dispSets = loggedSets.length
        ? loggedSets
        : Array.from({ length: vol.sets }, (_, k) => {
            const prev = lastSets[k];
            return {
              w: prev && prev.w != null ? prev.w : null,
              r: prev && prev.r != null ? prev.r : (vol.reps === '' ? null : parseInt(vol.reps, 10) || null),
              done: 0,
            };
          });
      return {
        type: 'medball', key, name: String(s.name || ''),
        volume: String(s.volume || ''), notes: String(s.notes || ''), video: String(s.video || ''),
        intent: String(s.intent || ''), done: !!checkoffs[key],
        dispSets, progSetCount: vol.sets, progReps: vol.reps,
      };
    });
  const lifts = (Array.isArray(day.exercises) ? day.exercises : [])
    .filter((ex) => String((ex && ex.name) || '').trim() && !(ex && ex.held))
    .map((ex) => {
      const name = String(ex.name || '');
      const key = `lift::${dayKey}::${name}`;
      const row = checkoffs[key] || null;
      const loggedSets = parseSets(row);
      const info = {};
      const last = lastLiftLog(userId, key, today);
      const lastSets = last && Array.isArray(last.sets) ? last.sets : [];
      const progSetCount = Math.max(1, Math.min(20, parseInt(ex.sets, 10) || 3));
      const progReps = String(ex.reps || '').trim();
      const dispSets = loggedSets.length
        ? loggedSets
        : Array.from({ length: progSetCount }, (_, k) => {
            const prev = lastSets[k];
            return {
              w: prev && prev.w != null ? prev.w : null,
              r: prev && prev.r != null ? prev.r : (progReps === '' ? null : parseInt(progReps, 10) || null),
              done: 0,
            };
          });
      const doneCount = dispSets.filter((s) => s.done).length;
      return {
        type: 'lift', key, name,
        sets: String(ex.sets || ''), reps: String(ex.reps || ''),
        target_rpe: String(ex.target_rpe || ''), notes: String(ex.notes || ''),
        video: String(ex.video || ''),
        section: String(ex.section || 'strength'), intent: String(ex.intent || ''),
        suggested_weight: ex.suggested_weight != null ? String(ex.suggested_weight) : '',
        rest: Math.max(15, Math.min(600, parseInt(ex.rest, 10) || 120)),
        progSetCount, progReps,
        dispSets, doneCount,
        allDone: dispSets.length > 0 && doneCount === dispSets.length && loggedSets.length > 0,
        lastSets, lastDay: last ? last.day : null,
        lastWeight: last && last.weight != null ? last.weight : null,
        lastRpe: last && last.rpe != null ? last.rpe : null,
        rpe: row && row.rpe != null ? row.rpe : null,
      };
    });
  return {
    days: days.map((d) => d.label || ''),
    day: { label: dayKey, warmup: views.normWarmup(day.warmup), speed: spd, medball: med, lifts },
  };
}


// Find the remote program for a hitter's name, honoring aliases
// ("Samuel Chapman" links to the "Sam Chapman" program).
function remoteProgramForName(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const rows = db.prepare('SELECT id, athlete_name, aliases FROM remote_programs').all();
  for (const r of rows) {
    const names = [r.athlete_name, ...String(r.aliases || '').split('\n')]
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);
    if (names.includes(target)) return r.id;
  }
  return null;
}
function linkRemoteProgram(userId, athleteName) {
  const id = remoteProgramForName(athleteName);
  if (id) db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?').run(id, userId);
}
function backfillRemoteLinks() {
  const users = db
    .prepare(
      `SELECT id, first_name, last_name FROM users
       WHERE remote_program_id IS NULL AND role = 'athlete'`
    )
    .all();
  const upd = db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?');
  for (const u of users) {
    const id = remoteProgramForName((u.first_name || '') + ' ' + (u.last_name || ''));
    if (id) upd.run(id, u.id);
  }
}

// Sync remote programs from Bobby's sheets (Sep 23 2026).
// Bobby: "use my sheets" — the sheets are the source of truth, not the app DB.
// This overwrites the routine/grades/etc with clean sheet data, preserving
// coach-only fields (grade_whys, custom hitting_plan edits).
function syncProgramsFromSheets() {
  const fs = require('fs');
  const path = require('path');
  const sheetsDir = path.join(__dirname, '..', 'data', 'sheets');
  if (!fs.existsSync(sheetsDir)) return;
  
  const files = fs.readdirSync(sheetsDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const sheet = JSON.parse(fs.readFileSync(path.join(sheetsDir, file), 'utf8'));
      const athleteName = sheet.athlete || '';
      if (!athleteName) continue;
      
      // Find matching program (by athlete_name, case-insensitive)
      const prog = db.prepare(
        "SELECT * FROM remote_programs WHERE LOWER(athlete_name) = LOWER(?)"
      ).get(athleteName);
      if (!prog) {
        console.log(`Sheet sync: no program found for ${athleteName}, skipping`);
        continue;
      }
      
      let progJson = {};
      try { progJson = JSON.parse(prog.program_json || '{}'); } catch (e) { progJson = {}; }
      
      // Preserve coach-only fields
      const keepGradeWhys = progJson.grade_whys || {};
      const keepCustomPlan = progJson.hitting_plan && progJson.hitting_plan._custom ? progJson.hitting_plan : null;
      
      // Overwrite with sheet data (clean, no duplicates, no mobility)
      if (sheet.grades) progJson.grades = sheet.grades;
      if (sheet.strengths) progJson.strengths = sheet.strengths;
      if (sheet.cues) progJson.cues = sheet.cues;
      if (sheet.adjustment) progJson.adjustment = sheet.adjustment;
      if (sheet.phase_emphasis) progJson.phase_emphasis = sheet.phase_emphasis;
      if (sheet.mental_framework) progJson.mental_framework = sheet.mental_framework;
      if (sheet.days || sheet.routine) {
        // Map sheet blocks -> routine.
        // Bobby (Sep 24 2026): the program is the same every training day —
        // Day 1/2/3 grouping is gone except for med ball, which keeps its
        // Day 1/2/3 titles so the app rotates it daily (todaysMedballBlocks).
        const routineBlocks = [];
        const seenCat = new Set();
        const pushBlock = (b, keepTitle) => {
          const items = (b.items || []).map((it) => ({
            drill: it.drill || '',
            volume: it.volume || '',
            note: it.note || '',
          }));
          // Bobby's rule: blocks with no real items (blank rows he left
          // empty) don't exist for the athlete.
          if (!items.some((it) => String(it.drill || '').trim())) return;
          const blk = { category: b.category || b.section || '', items };
          if (keepTitle && b.title) blk.title = b.title;
          routineBlocks.push(blk);
        };
        if (Array.isArray(sheet.routine)) {
          for (const b of sheet.routine) {
            const cat = b.category || b.section || '';
            if (seenCat.has(cat)) continue;
            seenCat.add(cat);
            pushBlock(b, false);
          }
        }
        if (Array.isArray(sheet.days)) {
          for (const d of sheet.days) {
            const sec = String(d.category || d.section || '');
            const isMed = /med\s*ball/i.test(sec);
            const isPregame = /pregame/i.test(String(d.title || ''));
            if (!isMed && !isPregame) {
              // Stale shape fallback: day-grouped non-med blocks dedupe to one.
              const cat = d.category || d.section || '';
              if (seenCat.has(cat)) continue;
              seenCat.add(cat);
            }
            pushBlock(d, isMed || isPregame);
          }
        }
        if (routineBlocks.length) progJson.routine = routineBlocks;
      }
      // Bobby (Sep 23 2026): preserve top-level mobility from sheets
      if (sheet.mobility && !progJson.mobility) {
        progJson.mobility = sheet.mobility;
      }
      if (sheet.date_range) progJson.date_range = sheet.date_range;
      
      // Restore preserved fields
      progJson.grade_whys = keepGradeWhys;
      // Clear hitting_plan so it regenerates from clean data (unless coach customized it)
      if (!keepCustomPlan) {
        delete progJson.hitting_plan;
      }
      
      db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(progJson), new Date().toISOString(), prog.id);
      console.log(`Sheet sync: updated ${athleteName} from ${file}`);
    } catch (e) {
      console.error(`Sheet sync failed for ${file}:`, e.message);
    }
  }
}

// Run sheet sync on boot (Bobby's sheets are the source of truth)
try { syncProgramsFromSheets(); } catch (e) { console.error('Sheet sync on boot failed:', e.message); }

// Hitter's program page — remote athletes only.
app.get('/program', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const sub = String(req.query.sub || 'hitting');
  // Bobby (Sep 23 2026): Program tab defaults to hitting document (which has Mobility/Hitting tabs).
  // ?sub=mobility goes to the mobility page.
  if (sub === 'mobility') {
    return res.redirect('/program/mobility');
  }
  return res.redirect('/program/hitting-plan');
});

// Mobility page (Sep 23 2026): mobility + med ball for non-lifters.
app.get('/program/mobility', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  const liftingId = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  const lifting = getLifting(liftingId && liftingId.lifting_program_id);
  const tabs = programSubTabs(p, lifting);
  const blocks = splitProgramBlocks(p);
  // Bobby (Sep 23 2026): med ball rotates daily on the Warm-up page too
  const todaysMedball = todaysMedballBlocks(p, blocks);
  res.send(views.mobilityPage(req.user, p, { tabs, blocks, todaysMedball }));
});

// Bobby (Sep 23 2026): med ball rotates daily. Uses the athlete's own
// Day 1/2/3 med ball blocks; falls back to Ryan Seddon's 3-day template.
function todaysMedballBlocks(p, blocks) {
  const med = blocks.medball || [];
  if (!med.length) return [];
  // Group by day title (Day 1, Day 2, Day 3) — skip Pregame/special blocks
  const byDay = {};
  for (const b of med) {
    const t = String(b.title || b.category || '').trim();
    if (/pregame/i.test(t)) continue;
    const m = t.match(/day\s*(\d+)/i);
    if (!m) continue;
    const dayNum = parseInt(m[1], 10);
    if (!byDay[dayNum]) byDay[dayNum] = [];
    byDay[dayNum].push(b);
  }
  const dayKeys = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  if (!dayKeys.length) return med;
  // Rotate by Chicago date: day-of-year mod number of days
  const today = chiToday(); // YYYY-MM-DD
  const d = new Date(today + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d - start) / 86400000);
  const idx = dayOfYear % dayKeys.length;
  return byDay[dayKeys[idx]] || med;
}

// Mobility workout (Sep 23 2026): guided mobility/med ball session —
// interactive check-offs, weight tracking for med ball, like the lifting workout.
app.get('/program/mobility-workout', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const preview = !!req.user.viewAs;
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  const blocks = splitProgramBlocks(p);
  const today = chiToday();
  // Bobby (Sep 23 2026): mobility exercise video links from drill registry
  let mobilityVideos = {};
  try {
    const fs = require('fs');
    const path = require('path');
    const regPath = path.join(__dirname, '..', 'atkinson-hitting', 'programs', 'drill_links.json');
    // Try workspace path first, then local
    const wsPath = '/home/hatch/workspace/atkinson-hitting/programs/drill_links.json';
    const rp = fs.existsSync(wsPath) ? wsPath : regPath;
    if (fs.existsSync(rp)) {
      const reg = JSON.parse(fs.readFileSync(rp, 'utf8'));
      mobilityVideos = reg.mobility_youtube || {};
    }
  } catch (e) { /* no videos */ }
  // Build flat list of mobility + medball exercises
  const exercises = [];
  for (const b of blocks.mobility) {
    for (const it of (b.items || [])) {
      if (!it.drill) continue;
      const key = 'mobility::' + it.drill;
      exercises.push({
        name: it.drill,
        volume: it.volume || '',
        type: 'mobility',
        key,
        video: mobilityVideos[it.drill] || null,
        last: lastLiftLog(req.user.id, key, today),
        history: liftHistory(req.user.id, key, 8),
      });
    }
  }
  // Bobby (Sep 23 2026): med ball rotates daily, not the same every day
  const todaysMed = todaysMedballBlocks(p, blocks);
  for (const b of todaysMed) {
    for (const it of (b.items || [])) {
      if (!it.drill) continue;
      const key = 'medball::' + it.drill;
      exercises.push({
        name: it.drill,
        volume: it.volume || '',
        type: 'medball',
        key,
        video: null, // Med ball videos come from drill registry
        last: lastLiftLog(req.user.id, key, today),
        history: liftHistory(req.user.id, key, 8),
      });
    }
  }
  res.send(views.mobilityWorkoutPage(req.user, p, { exercises, today, preview }));
});

// Hitting plan document (Sep 23 2026): one-page document per remote hitter —
// training environments, warmup (Bobby's prep work), drills. Videos live in
// the Remote library; the document just points there.
app.get('/program/hitting-plan', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  // Lazy-backfill: if no hitting_plan yet OR version is stale, (re)generate from routine blocks.
  // Bobby (Sep 23 2026): stored plans don't auto-update when the builder changes — version check forces it.
  // Bobby (Sep 24 2026): NEVER regenerate a coach-customized plan — the backfill
  // previously wiped coach edits on next view because saves didn't stamp _v.
  if (!p.prog.hitting_plan || (p.prog.hitting_plan._v !== HITTING_PLAN_VERSION && !p.prog.hitting_plan._custom)) {
    p.prog.hitting_plan = buildHittingPlan(p.prog);
    db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(p.prog), new Date().toISOString(), p.id);
  }
  const liftingId = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  const lifting = getLifting(liftingId && liftingId.lifting_program_id);
  const tabs = programSubTabs(p, lifting);
  res.send(views.hittingPlanPage(req.user, p, { tabs, sub: 'hitting' }));
});

// Lifting program (Sep 23 2026): interactive lifting, accessible from Program tab.
// Bobby: hitting = document, lifting = interactive. Both under Program.
app.get('/program/lifting', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  const liftingId = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  const lifting = getLifting(liftingId && liftingId.lifting_program_id);
  if (!lifting) return res.send(views.hittingPlanPage(req.user, p)); // No lifting? Show hitting doc
  // Render the lifting sub-tab using the existing programPage view
  const tabs = [{ id: 'hitting', label: 'Hitting' }, { id: 'lifting', label: 'Lifting' }];
  const today = chiToday();
  const checkoffs = getCheckoffs(req.user.id, today);
  const liftDays = Array.isArray(lifting.days) ? lifting.days.filter((d) =>
    (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => String((ex && ex.name) || '').trim())
  ) : [];
  const ldayIdx = pickLiftingDayIdx(req, p, liftDays.length);
  const liftData = {};
  if (liftDays[ldayIdx]) {
    for (const ex of liftDays[ldayIdx].exercises || []) {
      const key = 'lift::' + String((liftDays[ldayIdx].label || '')) + '::' + String(ex.name || '');
      liftData[key] = { last: lastLiftLog(req.user.id, key, today), history: liftHistory(req.user.id, key, 8) };
    }
  }
  res.send(views.programPage(req.user, p, {
    tabs, sub: 'lifting', day: '', autoDay: '', labels: [], today, checkoffs, lifting,
    sched: [], weekday: '', isToday: true,
    ldayIdx, todayLdayIdx: ldayIdx, liftData,
    videoLib: videoLibMap(),
    subs: todaySubs(req.user.id),
    sessionOrder: 'hitting_first',
    programTab: 'lifting', // Flag for the view to show Hitting/Lifting switcher
  }));
});

// Workout mode (Sep 23 2026): guided lifting session — one exercise at a
// time, phone-first, AJAX logging, rest timer. ?lday=N picks the day.
app.get('/program/workout', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  // Bobby (Sep 23 2026): coaches in view-as can preview the guided workout so
  // the Start Lift flow is testable. Logging stays disabled (view-as POSTs are
  // blocked by middleware; the page renders in preview mode).
  const preview = !!req.user.viewAs;
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  const liftingId = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  const lifting = getLifting(liftingId && liftingId.lifting_program_id);
  if (!lifting) return res.redirect('/program?sub=lifting');
  const today = chiToday();
  const days = (Array.isArray(lifting.days) ? lifting.days : [])
    .filter((d) => (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => String((ex && ex.name) || '').trim()));
  const ldayIdx = pickLiftingDayIdx(req, p, days.length);
  const wd = buildWorkoutDay(req.user.id, lifting, ldayIdx, today);
  if (!wd.day) return res.redirect('/program?sub=lifting');
  // Phase info for the athlete (Bobby Sep 23 2026): current phase, what it
  // means, core principles. Filter out test/retest lines.
  const phaseNotes = (Array.isArray(lifting.notes) ? lifting.notes : [])
    .filter((n) => !/test\/retest/i.test(String(n || '')));
  res.send(views.workoutPage(req.user, p, wd, ldayIdx, preview, phaseNotes));
});

// ---- Guided Today session (Sep 2026) ----
// One tap runs the whole day: Mobility / Med Ball / Hitting / Lifting in an
// order the athlete chooses. Item keys match the Programs-tab checkoff keys
// exactly, so progress syncs both ways.
const SESSION_COMPS = [
  { id: 'mobility', label: 'Warm-up', icon: '🧘', tag: 'Warm up first' },
  { id: 'medball', label: 'Med Ball', icon: '💥', tag: 'Power' },
  { id: 'hitting', label: 'Hitting', icon: '⚾', tag: 'Cage work' },
  { id: 'lifting', label: 'Lifting', icon: '🏋️', tag: 'Get strong' },
];
const DEFAULT_COMP_ORDER = ['mobility', 'medball', 'hitting', 'lifting'];

// Athlete's saved component order (DB), default when unset/invalid.
function compOrderFor(p) {
  let saved = [];
  try {
    saved = JSON.parse((p && p.component_order) || '[]');
  } catch (e) { saved = []; }
  const ids = SESSION_COMPS.map((c) => c.id);
  const out = (Array.isArray(saved) ? saved : []).filter((id) => ids.includes(id));
  for (const id of DEFAULT_COMP_ORDER) if (!out.includes(id)) out.push(id);
  return { order: out, saved: !!((p && p.component_order) || '').trim() };
}

// Resolve a program item's video URL into a typed object for the session UI:
// YouTube embeds, Drive files use the in-app preview player, anything else
// opens directly. Hidden library videos resolve to nothing.
function resolveVideo(url, videoLib) {
  const u = String(url || '').trim();
  if (!u) return null;
  const ym = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(u);
  if (ym) return { type: 'yt', id: ym[1] };
  const dm = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u);
  if (dm) {
    const v = (videoLib || {})[dm[1]];
    if (v && v.hidden) return null;
    return { type: 'drive', fileId: dm[1], watch: v ? '/videos/watch/' + v.id : u };
  }
  return { type: 'url', url: u };
}

// Full-day session data: every component with items for the selected program
// day, plus the athlete's component order. Empty components are dropped.
function buildSessionDay(userId, p, dayLabel, checkoffs, lifting, ldayIdx, videoLib, subs) {
  const prog = (p && p.prog) || {};
  const routine = Array.isArray(prog.routine) ? prog.routine : [];
  const realItems = (items) => (Array.isArray(items) ? items : []).filter((it) => String((it && it.drill) || '').trim());
  const dayPrefix = (cat) => {
    const m = /^([A-Za-z]+ ?\d+|Pregame)/i.exec(String(cat || '').trim());
    return m ? m[1].trim() : '';
  };
  const inDay = (cat) => dayPrefix(cat).toLowerCase() === String(dayLabel || '').toLowerCase();
  const mob = (cat, it) => ({
    comp: 'mobility', type: 'block', kind: 'mob',
    key: `mob::::${cat}::${it.drill}`,
    name: String(it.drill || ''), meta: String(it.volume || it.prescription || ''),
    notes: String(it.notes || ''), block: String(cat || ''),
    video: resolveVideo(it.video, videoLib), done: !!checkoffs[`mob::::${cat}::${it.drill}`],
  });
  const med = (cat, it) => {
    const key = `med::${dayPrefix(cat)}::${cat}::${it.drill}`;
    const sw = (subs || {})[key];
    return {
      comp: 'medball', type: 'block', kind: 'med', key,
      name: String((sw && sw.sub_name) || it.drill || ''), swappedFrom: sw ? String(it.drill || '') : '',
      meta: String(it.volume || it.prescription || ''), notes: String(it.notes || ''),
      block: String(cat || ''), video: resolveVideo(it.video, videoLib), done: !!checkoffs[key],
    };
  };
  const hit = (cat, it, dayScoped) => {
    const key = `hit::${dayScoped ? dayLabel : ''}::${cat}::${it.drill}`;
    return {
      comp: 'hitting', type: 'block', kind: 'hit', key,
      name: String(it.drill || ''), meta: String(it.prescription || it.volume || ''),
      notes: String(it.notes || ''), block: String(cat || ''),
      video: resolveVideo(it.video, videoLib), done: !!checkoffs[key],
    };
  };

  const mobilityItems = [];
  const medballItems = [];
  const hittingItems = [];
  for (const c of routine) {
    const items = realItems(c.items);
    if (!items.length) continue;
    const n = String(c.category || '');
    const cat = String(c.category || '');
    if (/mobility/i.test(n)) for (const it of items) mobilityItems.push(mob(cat, it));
    else if (/med\s*ball/i.test(n)) { if (inDay(cat)) for (const it of items) medballItems.push(med(cat, it)); }
    else if (/prep/i.test(n)) { if (inDay(cat)) for (const it of items) hittingItems.push({ ...hit(cat, it, true), section: 'Prep' }); }
    // "Hitting — ..." guide blocks (week plan) are reference material on the
    // Hitting tab, not tap-through check-offs.
    else if (!/metabol|conditioning/i.test(n) && !/^hitting\s*[—–-]/i.test(n)) {
      if (inDay(cat)) for (const it of items) hittingItems.push({ ...hit(cat, it, true), section: 'Hitting' });
      else if (!dayPrefix(cat)) for (const it of items) hittingItems.push({ ...hit(cat, it, false), section: 'Every day' });
    }
  }

  // Lifting component: speed -> lifting-day med ball -> lifts (same order as
  // the Lifting tab). Legacy Metabolic blocks fold into Speed.
  const wd = buildWorkoutDay(userId, lifting, ldayIdx, chiToday());
  const liftingItems = [];
  if (wd && wd.day) {
    for (const s of wd.day.speed || []) liftingItems.push({ ...s, comp: 'lifting', kind: 'spd' });
    for (const m of wd.day.medball || []) liftingItems.push({ ...m, comp: 'lifting', kind: 'med' });
    for (const l of wd.day.lifts || []) liftingItems.push({ ...l, comp: 'lifting', kind: 'lift' });
  }

  const comps = {};
  const def = (id, items) => {
    const meta = SESSION_COMPS.find((c) => c.id === id) || {};
    comps[id] = { id, label: meta.label || id, icon: meta.icon || '', tag: meta.tag || '', items };
  };
  def('mobility', mobilityItems);
  def('medball', medballItems);
  def('hitting', hittingItems);
  def('lifting', liftingItems);
  // Drop empty components so the athlete never taps through nothing.
  const { order, saved } = compOrderFor(p);
  const live = order.filter((id) => comps[id] && comps[id].items.length);
  return { order: live, savedOrder: saved, components: comps };
}

app.get('/program/session', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  if (req.user.viewAs) return res.redirect('/program');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  const prog = p.prog || {};
  const schedule = (Array.isArray(prog.schedule) ? prog.schedule : []).map(schedEntry);
  const labels = programDayLabels(p);
  const rawAuto = programCurrentDay(p);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
  const reqDay = String(req.query.day || '').trim();
  const day = labels.some((l) => l.toLowerCase() === reqDay.toLowerCase())
    ? labels.find((l) => l.toLowerCase() === reqDay.toLowerCase())
    : (rawAuto || labels[0] || '');
  const schedLabel = (schedule.find((s) => s.weekday.toLowerCase() === weekday.toLowerCase()) || {}).label || '';
  const restToday = /^(off|rest|recovery|mobility)/i.test(String(day || schedLabel || '').trim());
  const liftingId = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  const lifting = getLifting(liftingId && liftingId.lifting_program_id);
  const liftDays = lifting && Array.isArray(lifting.days)
    ? lifting.days.filter((d) => (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => String((ex && ex.name) || '').trim()))
    : [];
  const ldayIdx = pickLiftingDayIdx(req, p, liftDays.length);
  const today = chiToday();
  const checkoffs = getCheckoffs(req.user.id, today);
  const sess = buildSessionDay(req.user.id, p, day, checkoffs, lifting, ldayIdx, videoLibMap(), todaySubs(req.user.id));
  res.send(views.sessionPage(req.user, {
    dayLabel: day, weekday, date: today, rest: restToday,
    order: sess.order, savedOrder: sess.savedOrder, components: sess.components,
    ldayIdx, backUrl: '/program?day=' + encodeURIComponent(day || ''),
  }));
});

// The athlete picks the order their Today session runs in. Bobby can change
// it for them in the program editor if they ask.
app.post('/program/component-order', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach' || !req.user.remoteProgramId || req.user.viewAs) {
    return req.accepts('json') ? res.status(403).json({ ok: false }) : res.redirect('/program');
  }
  const ids = SESSION_COMPS.map((c) => c.id);
  const arr = Array.isArray(req.body.order) ? req.body.order : String(req.body.order || '').split(',');
  const clean = arr.map((x) => String(x).trim()).filter((x) => ids.includes(x));
  const order = [];
  for (const id of clean) if (!order.includes(id)) order.push(id);
  for (const id of DEFAULT_COMP_ORDER) if (!order.includes(id)) order.push(id);
  db.prepare('UPDATE remote_programs SET component_order = ? WHERE id = ?')
    .run(JSON.stringify(order), req.user.remoteProgramId);
  if (req.accepts('json')) return res.json({ ok: true, order });
  res.redirect('/program/session');
});

// Athlete (or Bobby via the program edit page) picks which runs first in a
// session: hitting or lifting. Tabs reorder to match.
// drive_file_id -> { id, hidden }: resolves a program item's stored video URL
// to the in-app library watch page when the video is in Bobby's library.
function videoLibMap() {
  const map = {};
  try {
    for (const v of db.prepare('SELECT id, drive_file_id, hidden FROM video_library').all()) {
      if (v.drive_file_id) map[v.drive_file_id] = { id: v.id, hidden: !!v.hidden };
    }
  } catch (e) { /* library table not ready */ }
  return map;
}

// Check off / log a program item. Posts from the athlete's Programs tab:
// kind=hit|mob|med|lift, item_key, plus weight/rpe for lifts. Re-posting an
// already-done item updates it (lift log); posting with no payload clears it.
// Shared program-logging core (Sep 23 2026): the classic form POST
// (/program/check, redirects back) and the workout-mode JSON API
// (/api/program/log, no reload) run through this. Body fields: kind,
// item_key, lift_op (set/unset/addset/rpe), set_idx, set_weight, set_reps,
// prog_sets, prog_reps, weight, rpe.
function applyProgramLog(userId, body) {
  const kind = String(body.kind || '').slice(0, 10);
  const itemKey = String(body.item_key || '').slice(0, 300);
  if (!kind || !itemKey) return { ok: false, error: 'missing' };
  // Held-for-coach-review guard (Sep 2026): a held exercise must never be
  // loggable, even if someone crafts the item key by hand. The key embeds
  // the exercise name as its last :: segment.
  if (kind === 'lift' || kind === 'spd' || kind === 'med') {
    try {
      const name = itemKey.split('::').pop().trim().toLowerCase();
      const rp = db.prepare('SELECT remote_program_id FROM users WHERE id = ?').get(userId);
      const lpRow = rp && rp.remote_program_id
        ? db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(rp.remote_program_id)
        : null;
      const lp = getLifting(lpRow && lpRow.lifting_program_id);
      const isHeld = (Array.isArray(lp && lp.days) ? lp.days : []).some((d) =>
        ['speed', 'medball', 'exercises'].some((k) =>
          (Array.isArray(d[k]) ? d[k] : []).some((e) =>
            e && e.held && String(e.name || '').trim().toLowerCase() === name)));
      if (isHeld) return { ok: false, error: 'held' };
    } catch (e) { /* guard is best-effort — never block legitimate logs */ }
  }
  const today = chiToday();
  const existing = db
    .prepare('SELECT * FROM program_checkoffs WHERE user_id = ? AND day = ? AND item_key = ?')
    .get(userId, today, itemKey);
  const weightRaw = String(body.weight || '').trim();
  const rpeRaw = String(body.rpe || '').trim();
  const weight = weightRaw === '' ? null : Number(weightRaw);
  const rpe = rpeRaw === '' ? null : Math.max(1, Math.min(10, parseInt(rpeRaw, 10) || 0)) || null;
  // Per-set logging: lift_op=set/unset/addset/rpe operate on the sets_json
  // array [{w, r, done}] stored on the checkoff row.
  const liftOp = String(body.lift_op || '').slice(0, 10);
  const getSets = (row) => {
    try {
      const s = JSON.parse(row && row.sets_json ? row.sets_json : '[]');
      return Array.isArray(s) ? s : [];
    } catch (e) { return []; }
  };
  const saveSets = (rowId, sets) => {
    db.prepare('UPDATE program_checkoffs SET sets_json = ? WHERE id = ?').run(JSON.stringify(sets), rowId);
  };
  let sets = null, checked = null, rowRpe = null;
  if ((kind === 'lift' || kind === 'spd' || kind === 'med') && liftOp) {
    const setIdx = Math.max(0, parseInt(body.set_idx, 10) || 0);
    let row = existing;
    if (!row) {
      const info = db.prepare(
        'INSERT INTO program_checkoffs (user_id, day, kind, item_key, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, today, kind, itemKey, new Date().toISOString());
      row = { id: info.lastInsertRowid, sets_json: null };
    }
    sets = getSets(row);
    // First touch on an exercise with no set array yet: seed the programmed
    // sets so logging set 1 never lands on an empty row.
    const seedProgrammedSets = () => {
      if (sets.length) return;
      const n = Math.max(1, Math.min(20, parseInt(body.prog_sets, 10) || 3));
      const pr = String(body.prog_reps || '').trim();
      for (let i = 0; i < n; i++) sets.push({ w: null, r: pr === '' ? null : parseInt(pr, 10) || null, done: 0 });
    };
    if (liftOp === 'addset') {
      const repsRaw = String(body.reps || '').trim();
      sets.push({ w: null, r: repsRaw === '' ? null : parseInt(repsRaw, 10) || null, done: 0 });
      saveSets(row.id, sets);
    } else if (liftOp === 'rpe') {
      db.prepare('UPDATE program_checkoffs SET rpe = ? WHERE id = ?').run(rpe, row.id);
      rowRpe = rpe;
    } else if (liftOp === 'set' || liftOp === 'unset') {
      seedProgrammedSets();
      if (sets[setIdx]) {
        if (liftOp === 'unset') {
          sets[setIdx].done = 0;
        } else {
          // set: record weight/reps and mark the set done.
          const sw = String(body.set_weight || '').trim();
          const sr = String(body.set_reps || '').trim();
          sets[setIdx].w = sw === '' ? sets[setIdx].w : Number(sw);
          sets[setIdx].r = sr === '' ? sets[setIdx].r : parseInt(sr, 10) || null;
          sets[setIdx].done = 1;
        }
        saveSets(row.id, sets);
      }
    }
    checked = sets.length > 0 && sets.every((s) => s.done);
  } else if (existing) {
    // Already done: with a lift log payload, update it; otherwise toggle off.
    if (kind === 'lift' && (weight !== null || rpe !== null)) {
      db.prepare('UPDATE program_checkoffs SET weight = ?, rpe = ? WHERE id = ?').run(weight, rpe, existing.id);
      checked = true;
    } else {
      db.prepare('DELETE FROM program_checkoffs WHERE id = ?').run(existing.id);
      checked = false;
    }
  } else {
    db.prepare(
      'INSERT INTO program_checkoffs (user_id, day, kind, item_key, weight, rpe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, today, kind, itemKey, weight, rpe, new Date().toISOString());
    checked = true;
  }
  return { ok: true, sets, checked, rpe: rowRpe };
}

app.post('/program/check', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Coaches cannot log program work.');
  if (!req.user.remoteProgramId) return res.status(403).send('No program assigned.');
  if (req.user.viewAs) return res.status(403).send('View-as is read-only.');
  const sub = String(req.body.sub || 'hitting').slice(0, 20);
  const day = String(req.body.day || '').slice(0, 30);
  const r = applyProgramLog(req.user.id, req.body);
  if (!r.ok) return res.redirect('/program');
  const back =
    '/program?sub=' +
    encodeURIComponent(sub) +
    (day ? '&day=' + encodeURIComponent(day) : '') +
    (sub === 'lifting' && req.body.lday != null && String(req.body.lday) !== ''
      ? '&lday=' + encodeURIComponent(String(req.body.lday))
      : '');
  res.redirect(back);
});

// Workout-mode JSON logging (Sep 23 2026): same core as /program/check,
// no page reload. JSON body: {kind, item_key, lift_op, ...}.
app.post('/api/program/log', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).json({ ok: false, error: 'coaches cannot log' });
  if (!req.user.remoteProgramId) return res.status(403).json({ ok: false, error: 'no program' });
  if (req.user.viewAs) return res.status(403).json({ ok: false, error: 'read-only' });
  res.json(applyProgramLog(req.user.id, req.body || {}));
});

// ---- Athlete self-substitution (Sep 2026) ----
// Mid-workout: swap an exercise for the same movement pattern, filtered by
// the athlete's own equipment. Logged so Bobby sees every swap. "Ask coach"
// opens a message pre-filled with the context.
function athleteEquipmentTags(userId) {
  try {
    const r = db.prepare('SELECT answers_json FROM intake_responses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
    if (r && r.answers_json) {
      const a = JSON.parse(r.answers_json);
      return { tags: equipmentTags(a), answers: a };
    }
  } catch (e) { /* ignore */ }
  return { tags: new Set(['bodyweight', ...EQ_ALL]), answers: {} };
}
function substitutionAlternatives(userId, name) {
  const { tags, answers } = athleteEquipmentTags(userId);
  const src = EXERCISE_INDEX[String(name || '').toLowerCase()];
  if (!src) return { pattern: null, options: [], tags, answers };
  const rules = injuryKeys(answers);
  const track = goalTrack(answers);
  const options = LIFT_POOL.filter(
    (e) => e.pattern === src.pattern && e.name.toLowerCase() !== src.name.toLowerCase() && fitsEq(e, tags) && !isAvoided(e, rules)
  )
    .map((e) => ({ e, score: e.goals.includes(track) ? 2 : e.goals.includes('balanced') ? 1 : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.e);
  return { pattern: src.pattern, options, tags, answers };
}
app.get('/program/substitute', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const name = String(req.query.name || '').slice(0, 120);
  const key = String(req.query.key || '').slice(0, 300);
  const back = '/program?sub=' + encodeURIComponent(String(req.query.sub || 'lifting')) +
    (req.query.lday != null && String(req.query.lday) !== '' ? '&lday=' + encodeURIComponent(String(req.query.lday)) : '') +
    (req.query.day ? '&day=' + encodeURIComponent(String(req.query.day)) : '');
  const { pattern, options } = substitutionAlternatives(req.user.id, name);
  res.send(views.substitutePage(req.user, { name, key, back, pattern, options,
    sub: String(req.query.sub || 'lifting'), lday: String(req.query.lday || ''), day: String(req.query.day || '') }));
});
app.post('/program/substitute', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach' || !req.user.remoteProgramId || req.user.viewAs) return res.redirect('/program');
  const key = String(req.body.key || '').slice(0, 300);
  const original = String(req.body.original || '').slice(0, 120);
  const subName = String(req.body.sub_name || '').slice(0, 120);
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  const back = '/program?sub=' + encodeURIComponent(String(req.body.sub || 'lifting')) +
    (req.body.lday != null && String(req.body.lday) !== '' ? '&lday=' + encodeURIComponent(String(req.body.lday)) : '') +
    (req.body.day ? '&day=' + encodeURIComponent(String(req.body.day)) : '');
  if (!key || !original || !subName) return res.redirect(back);
  const today = chiToday();
  db.prepare("DELETE FROM program_substitutions WHERE user_id = ? AND day = ? AND item_key = ?")
    .run(req.user.id, today, key);
  db.prepare(
    'INSERT INTO program_substitutions (user_id, day, item_key, original_name, sub_name, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, today, key, original, subName, reason, new Date().toISOString());
  res.redirect(back);
});
app.post('/program/substitute/revert', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach' || !req.user.remoteProgramId || req.user.viewAs) return res.redirect('/program');
  const key = String(req.body.key || '').slice(0, 300);
  if (key) db.prepare('DELETE FROM program_substitutions WHERE user_id = ? AND day = ? AND item_key = ?').run(req.user.id, chiToday(), key);
  const back = '/program?sub=' + encodeURIComponent(String(req.body.sub || 'lifting')) +
    (req.body.lday != null && String(req.body.lday) !== '' ? '&lday=' + encodeURIComponent(String(req.body.lday)) : '') +
    (req.body.day ? '&day=' + encodeURIComponent(String(req.body.day)) : '');
  res.redirect(back);
});
function todaySubs(userId) {
  const map = {};
  try {
    for (const r of db.prepare('SELECT * FROM program_substitutions WHERE user_id = ? AND day = ?').all(userId, chiToday())) {
      map[r.item_key] = r;
    }
  } catch (e) { /* ignore */ }
  return map;
}

// ---- Push notifications ----
function savePushSubscription(userId, sub) {
  const endpoint = String(sub.endpoint || '').slice(0, 500);
  const p256dh = String((sub.keys || {}).p256dh || '').slice(0, 200);
  const auth = String((sub.keys || {}).auth || '').slice(0, 200);
  if (!endpoint || !p256dh || !auth) return;
  db.prepare(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)'
    + ' ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth'
  ).run(userId, endpoint, p256dh, auth, new Date().toISOString());
}
function userPushSubscriptions(userId) {
  return db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
}
async function sendPush(sub, title, body, url) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body, url: url || '/' })
    );
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
    } else {
      console.warn('push send failed:', e.message);
    }
  }
}
async function pushToUser(userId, title, body, url) {
  if (!pushEnabled) return;
  for (const sub of userPushSubscriptions(userId)) await sendPush(sub, title, body, url);
}
async function pushToCoaches(title, body, url) {
  if (!pushEnabled) return;
  // Global coaches only: organization coaches are scoped to their organization and
  // don't approve signups or Brain proposals.
  const coaches = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL").all();
  for (const c of coaches) await pushToUser(c.id, title, body, url);
}
// Push to every coach except one (e.g. notify the other coach of a proposal).
async function pushToCoachesExcept(exceptId, title, body, url) {
  if (!pushEnabled) return;
  const coaches = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL AND id != ?").all(exceptId);
  for (const c of coaches) await pushToUser(c.id, title, body, url);
}
// Check-in notifications (Sep 17 2026, Bobby: "Log not login" — notify when
// his guys LOG a session). Pure gate, unit-tested: is this athlete in one of
// Bobby's own programs (organizations.is_mine = 1)?
function isMyProgramPlayer(userId) {
  return !!db
    .prepare('SELECT 1 FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? AND o.is_mine = 1')
    .get(userId);
}
// Bobby (Sep 23 2026): messaging is remote-guys only (Atkinson Hitter
// Development System). Checks the user has a remote program assigned.
function isRemotePlayer(userId) {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ? AND remote_program_id IS NOT NULL').get(userId);
}
async function notifyMyPlayerCheckin(userId, athleteName, coachUrl) {
  if (!pushEnabled) return;
  if (!wantsCheckinNotify(userId)) return; // tri-state per-player alert pref
  // Full-access global coaches only: view-only Cam doesn't get Bobby's
  // clients' daily logs.
  const coaches = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL AND can_edit != 0").all();
  for (const c of coaches) await pushToUser(c.id, 'Session logged', `${athleteName} just logged a session — tap to view.`, coachUrl);
}
// Per-player log alerts (Sep 17 2026, Bobby): 1 = always notify, 0 = never,
// NULL = default rule (notify only for his program players).
function wantsCheckinNotify(athleteId) {
  const u = db.prepare('SELECT notify_on_checkin FROM users WHERE id = ?').get(athleteId);
  if (!u) return false;
  if (u.notify_on_checkin === 1) return true;
  if (u.notify_on_checkin === 0) return false;
  return isMyProgramPlayer(athleteId);
}
// Coach/player messaging (Sep 17 2026, revised): 1:1 + broadcasts with a
// player inbox. One cheap COUNT per request powers the nav/tab-bar badges.
function unreadMessageCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM message_recipients WHERE user_id = ? AND read_at IS NULL').get(userId).c;
}
function markMessagesRead(userId) {
  db.prepare('UPDATE message_recipients SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(new Date().toISOString(), userId);
}
// Which full-access global coach a player's "Message Coach" goes to: the one
// who most recently messaged them, else the lowest-id full-access global
// coach. Never a hardcoded email.
function coachForPlayer(playerId) {
  const recent = db
    .prepare(
      `SELECT m.sender_id AS id FROM messages m
       JOIN message_recipients r ON r.message_id = m.id
       JOIN users u ON u.id = m.sender_id
       WHERE r.user_id = ? AND m.sender_id != ? AND u.role = 'coach' AND u.organization_id IS NULL AND u.can_edit != 0
       ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(playerId, playerId);
  if (recent) return recent.id;
  const first = db.prepare("SELECT id FROM users WHERE role = 'coach' AND organization_id IS NULL AND can_edit != 0 ORDER BY id ASC LIMIT 1").get();
  return first ? first.id : null;
}
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY || null }));
app.get('/api/push/status', requireLogin, (req, res) => {
  res.json({ pushEnabled, subscribed: userPushSubscriptions(req.user.id).length > 0 });
});
// Bible study opt-in choice (Sep 23 2026): the athlete answers the popup once.
// Athletes only; view-as POSTs are already blocked upstream.
app.post('/api/bible-study-choice', requireLogin, (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'athletes only' });
  const c = Number((req.body || {}).choice);
  if (c !== 0 && c !== 1) return res.status(400).json({ error: 'choice must be 0 or 1' });
  db.prepare('UPDATE users SET bible_study = ? WHERE id = ?').run(c, req.user.id);
  res.json({ ok: true });
});
// Audio transcription (Sep 23 2026): the app records with getUserMedia
// (iOS remembers mic permission) and Gemini transcribes. Replaces the
// Web Speech API, which iOS prompts for on every single use.
app.post('/api/transcribe', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'athletes only' });
  const audio = String((req.body || {}).audio || '').slice(0, 8 * 1024 * 1024); // ~6MB cap
  const mime = String((req.body || {}).mime || 'audio/webm').slice(0, 50);
  if (!audio) return res.status(400).json({ error: 'no audio' });
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'not_configured' });
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Transcribe this audio exactly, word for word. Reply with ONLY the transcript, no other text.' },
              { inline_data: { mime_type: mime, data: audio } },
            ],
          }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0 },
        }),
      }
    );
    if (!resp.ok) throw new Error(`llm_http_${resp.status}`);
    const data = await resp.json();
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const transcript = parts.map((p) => p.text || '').join('').trim();
    res.json({ ok: true, transcript });
  } catch (e) {
    res.status(500).json({ error: 'transcribe_failed' });
  }
});
app.post('/api/checkin/parse', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'athletes only' });
  const transcript = String((req.body || {}).transcript || '').trim().slice(0, 4000);
  if (!transcript) return res.status(400).json({ error: 'no transcript' });
  const system = `You parse a hitter's spoken check-in into structured fields. Reply with ONLY a JSON object, no other text. Fields:
session_type: one of "game", "cage", "live_abs", "team_practice" (guess from context, "" if unclear)
routine_followed: one of "yes", "mostly", "no" ("" if not mentioned)
swing_feel: 1-5 integer (how the swing felt, "" if not mentioned)
timing: one of "early", "on_time", "late", "inconsistent" ("" if not mentioned)
contact_quality: 1-5 integer ("" if not mentioned)
approach_score: 1-5 integer (approach and decision-making, "" if not mentioned)
main_focus: string (what they focused on, "" if not mentioned)
felt_good: string (what felt good, "" if not mentioned)
biggest_struggle: string (what they struggled with, "" if not mentioned)
adjustment_helped: string (what adjustment or feel helped, "" if not mentioned)
learned: string (what they learned about themselves, "" if not mentioned)
whats_next: string (their one focus for next time, "" if not mentioned)
Infer ratings from their words (e.g. "felt great" = 5, "terrible" = 1, "pretty good" = 4). Keep text fields to one or two sentences, in their voice.`;
  try {
    const raw = await geminiText(system, transcript, 800);
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
    res.json({ ok: true, fields: json });
  } catch (e) {
    res.status(500).json({ error: 'parse_failed' });
  }
});
app.post('/api/push/subscribe', requireLogin, (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'bad subscription' });
  savePushSubscription(req.user.id, sub);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', requireLogin, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
  res.json({ ok: true });
});

// Mental Game — every hitter's baseline. Skip coaches from this.
function getMentalBaseline(userId) {
  return db.prepare('SELECT * FROM mental_baseline WHERE user_id = ?').get(userId) || null;
}
// Questionnaire v2 (Sep 23 2026): coach-editable questions, answers keyed by qkey.
function getMentalQuestions() {
  try {
    return db.prepare("SELECT * FROM mental_questions WHERE active = 1 ORDER BY sort, id").all()
      .map((q) => ({ ...q, options: (() => { try { return JSON.parse(q.options || '[]'); } catch (e) { return []; } })() }));
  } catch (e) { return []; }
}
function getMentalAnswers(userId) {
  try {
    const rows = db.prepare('SELECT qkey, answer FROM mental_answers WHERE user_id = ?').all(userId);
    const out = {};
    for (const r of rows) out[r.qkey] = r.answer;
    return out;
  } catch (e) { return {}; }
}
app.get('/mental-game', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const keys = db.prepare('SELECT id, content FROM mental_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const exercise = todayMentalExercise();
  const today = todayChicagoDate();
  const exerciseDone = !!db.prepare('SELECT 1 FROM mental_daily_done WHERE user_id = ? AND day = ?').get(req.user.id, today);
  const bsRow = db.prepare('SELECT bible_study FROM users WHERE id = ?').get(req.user.id);
  const bibleOptIn = bsRow && bsRow.bible_study === 1;
  const checkedInToday = !!db.prepare("SELECT 1 FROM checkins WHERE user_id = ? AND date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime')").get(req.user.id);
  // Routine defaults now live at module scope (personalized routines, Sep 23 2026).
  const toItems = (arr) => arr.map(t => typeof t === 'string' ? { text: t, done: false } : { text: t.text, detail: t.detail || '', done: false });
  const reselectRoutines = () => db.prepare('SELECT morning_json, pregame_json, prepractice_json, source FROM mental_routines WHERE user_id = ?').get(req.user.id);
  let routineRow = reselectRoutines();
  if (!routineRow) {
    // First visit: questionnaire answers → personalized routines; otherwise
    // the generic defaults (Sep 23 2026, Bobby — no two hitters same).
    let made = false;
    try { made = personalizeRoutinesFor(req.user.id); } catch (e) { made = false; }
    if (!made) {
      db.prepare(`INSERT INTO mental_routines (user_id, morning_json, pregame_json, prepractice_json, source, updated_at) VALUES (?, ?, ?, ?, 'default', ?)`)
        .run(req.user.id, JSON.stringify(toItems(DEFAULT_MORNING)), JSON.stringify(toItems(DEFAULT_PREGAME)), JSON.stringify(toItems(DEFAULT_PRACTICE)), new Date().toISOString());
    }
    routineRow = reselectRoutines();
  } else if ((routineRow.source || 'default') === 'default') {
    // Lazy upgrade: hitters who answered the questionnaire since the generic
    // defaults get their personalized routines on next visit.
    try { if (personalizeRoutinesFor(req.user.id)) routineRow = reselectRoutines(); } catch (e) {}
  }
  // Backfill: existing rows may have empty morning/pregame/practice lists
  // from before defaults existed (Sep 23 2026).
  try {
    const m = JSON.parse(routineRow.morning_json || '[]');
    const g = JSON.parse(routineRow.pregame_json || '[]');
    const p = JSON.parse(routineRow.prepractice_json || '[]');
    let changed = false;
    // Personalized rows backfill from the questionnaire build; default rows
    // backfill from the generic defaults (Sep 23 2026).
    let pers = null;
    if ((routineRow.source || 'default') === 'personalized') {
      try { pers = buildPersonalRoutines(getMentalAnswers(req.user.id)); } catch (e) { pers = null; }
    }
    if (!m.length) { routineRow.morning_json = JSON.stringify(toItems(pers ? pers.morning : DEFAULT_MORNING)); changed = true; }
    if (!g.length) { routineRow.pregame_json = JSON.stringify(toItems(pers ? pers.pregame : DEFAULT_PREGAME)); changed = true; }
    if (!p.length) { routineRow.prepractice_json = JSON.stringify(toItems(pers ? pers.practice : DEFAULT_PRACTICE)); changed = true; }
    // Upgrade: old default items (plain text, no detail) get the detailed
    // versions. Matches both the very old one-liners and the short titles.
    // Custom user items are untouched. Personalized rows skip this entirely —
    // their details are already specific (Sep 23 2026).
    const OLD_DEFAULTS = OLD_DEFAULT_ROUTINE_TEXTS;
    const upgrade = (items, defaults) => {
      const byText = {};
      for (const d of defaults) byText[d.text.toLowerCase()] = d;
      // Map old one-liners to their new detailed step by position.
      const oldToNew = {};
      const allNew = [...DEFAULT_MORNING, ...DEFAULT_PREGAME, ...DEFAULT_PRACTICE];
      OLD_DEFAULTS.forEach((old, i) => { if (allNew[i]) oldToNew[old.toLowerCase()] = allNew[i]; });
      let touched = false;
      const out = items.map((it) => {
        if (!it || it.detail) return it;
        const key = String(it.text || '').toLowerCase();
        const d = byText[key] || oldToNew[key];
        if (d) {
          touched = true;
          return { text: d.text, detail: d.detail, done: !!it.done };
        }
        return it;
      });
      return { out, touched };
    };
    const um = upgrade(m, DEFAULT_MORNING);
    const ug = upgrade(g, DEFAULT_PREGAME);
    const up = upgrade(p, DEFAULT_PRACTICE);
    if (um.touched) { routineRow.morning_json = JSON.stringify(um.out); changed = true; }
    if (ug.touched) { routineRow.pregame_json = JSON.stringify(ug.out); changed = true; }
    if (up.touched) { routineRow.prepractice_json = JSON.stringify(up.out); changed = true; }
    if (changed) {
      db.prepare('UPDATE mental_routines SET morning_json = ?, pregame_json = ?, prepractice_json = ?, updated_at = ? WHERE user_id = ?')
        .run(routineRow.morning_json, routineRow.pregame_json, routineRow.prepractice_json, new Date().toISOString(), req.user.id);
    }
  } catch (e) { /* keep whatever parsed */ }
  const routineItems = JSON.parse(routineRow.morning_json || '[]');
  const pregameItems = JSON.parse(routineRow.pregame_json || '[]');
  const practiceItems = JSON.parse(routineRow.prepractice_json || '[]');
  const routineDone = !!db.prepare('SELECT 1 FROM mental_card_done WHERE user_id = ? AND day = ? AND card = ?').get(req.user.id, today, 'routine');
  const pregameDone = !!db.prepare('SELECT 1 FROM mental_card_done WHERE user_id = ? AND day = ? AND card = ?').get(req.user.id, today, 'pregame');
  const practiceDone = !!db.prepare('SELECT 1 FROM mental_card_done WHERE user_id = ? AND day = ? AND card = ?').get(req.user.id, today, 'practice');
  const bibleDone = !!db.prepare('SELECT 1 FROM mental_card_done WHERE user_id = ? AND day = ? AND card = ?').get(req.user.id, today, 'bible');
  res.send(views.mentalGamePage(req.user, {
    baseline: getMentalBaseline(req.user.id),
    questions: getMentalQuestions(),
    answers: getMentalAnswers(req.user.id),
    saved: req.query.saved === '1',
    planFailed: req.query.planfailed === '1',
    retake: req.query.retake === '1',
    keys,
    exercise,
    exerciseDone,
    bibleOptIn,
    bibleVerse: bibleOptIn ? todayBibleVerse() : null,
    bibleDone,
    checkedInToday,
    showBiblePopup: showBiblePopupFor(req.user, bsRow ? bsRow.bible_study : null),
    routine: { morning: routineItems, done: routineDone },
    pregame: { items: pregameItems, done: pregameDone },
    practice: { items: practiceItems, done: practiceDone },
    routineSource: (routineRow && routineRow.source) || 'default',
  }));
});

app.get('/mental-game/questionnaire', requireLogin, (req, res) => {
  // Questionnaire now lives on the Lock In tab itself (Sep 23 2026) — redirect.
  res.redirect('/mental-game?retake=1');
});

app.post('/mental-game/exercise/done', requireLogin, (req, res) => {
  const today = todayChicagoDate();
  const exercise = todayMentalExercise();
  db.prepare(`INSERT OR REPLACE INTO mental_daily_done (user_id, day, exercise_key, completed_at)
    VALUES (?, ?, ?, datetime('now'))`).run(req.user.id, today, exercise.key);
  res.redirect('/mental-game');
});

app.post('/mental-game/keys/delete', requireLogin, async (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (id) db.prepare('DELETE FROM mental_keys WHERE id = ? AND user_id = ?').run(id, req.user.id);
  // Keys changed — the plan adjusts to what he wants (Bobby, Sep 23 2026).
  refreshMentalPlan(req.user.id).catch(() => {});
  res.redirect('/mental-game');
});
// Lock In routine builder (Sep 23 2026) — morning / pregame / pre-practice checklists.
// Edit routines page (Bobby, Sep 23 2026) — athletes can edit their routines.
app.get('/mental-game/routines/edit', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const row = db.prepare('SELECT morning_json, pregame_json, prepractice_json FROM mental_routines WHERE user_id = ?').get(req.user.id) || {};
  const routines = {
    morning: { title: 'Morning Routine', items: JSON.parse(row.morning_json || '[]') },
    pregame: { title: 'Game Day', items: JSON.parse(row.pregame_json || '[]') },
    practice: { title: 'Practice Day', items: JSON.parse(row.prepractice_json || '[]') },
  };
  res.send(views.routineEditPage(req.user, routines));
});
app.post('/mental-game/routine/add', requireLogin, (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 200);
  const detail = String(req.body.detail || '').trim().slice(0, 500);
  const which = req.body.which === 'pregame' ? 'pregame' : req.body.which === 'practice' ? 'practice' : 'morning';
  const col = which === 'pregame' ? 'pregame_json' : which === 'practice' ? 'prepractice_json' : 'morning_json';
  const back = req.body.back === 'edit' ? '/mental-game/routines/edit' : '/mental-game';
  if (text) {
    const row = db.prepare(`SELECT ${col} FROM mental_routines WHERE user_id = ?`).get(req.user.id);
    const items = row ? JSON.parse(row[col] || '[]') : [];
    items.push({ text, detail, done: false });
    db.prepare(`INSERT INTO mental_routines (user_id, ${col}, source, updated_at) VALUES (?, ?, 'custom', ?)
      ON CONFLICT(user_id) DO UPDATE SET ${col}=excluded.${col}, source='custom', updated_at=excluded.updated_at`)
      .run(req.user.id, JSON.stringify(items), new Date().toISOString());
  }
  res.redirect(back);
});
app.post('/mental-game/routine/done', requireLogin, (req, res) => {
  const today = todayChicagoDate();
  const raw = req.body.card || req.body.which || '';
  const card = raw === 'pregame' ? 'pregame' : raw === 'practice' ? 'practice' : 'routine';
  db.prepare('INSERT OR IGNORE INTO mental_card_done (user_id, day, card, completed_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, today, card, new Date().toISOString());
  res.redirect('/mental-game');
});
app.post('/mental-game/routine/delete', requireLogin, (req, res) => {
  const which = req.body.which === 'pregame' ? 'pregame' : req.body.which === 'practice' ? 'practice' : 'morning';
  const col = which === 'pregame' ? 'pregame_json' : which === 'practice' ? 'prepractice_json' : 'morning_json';
  const idx = parseInt(req.body.idx, 10);
  const back = req.body.back === 'edit' ? '/mental-game/routines/edit' : '/mental-game';
  const row = db.prepare(`SELECT ${col} FROM mental_routines WHERE user_id = ?`).get(req.user.id);
  if (row && Number.isInteger(idx)) {
    const items = JSON.parse(row[col] || '[]');
    if (idx >= 0 && idx < items.length) {
      items.splice(idx, 1);
      db.prepare(`UPDATE mental_routines SET ${col} = ?, source='custom', updated_at = ? WHERE user_id = ?`)
        .run(JSON.stringify(items), new Date().toISOString(), req.user.id);
    }
  }
  res.redirect(back);
});
app.post('/mental-game/routine/edit', requireLogin, (req, res) => {
  const which = req.body.which === 'pregame' ? 'pregame' : req.body.which === 'practice' ? 'practice' : 'morning';
  const col = which === 'pregame' ? 'pregame_json' : which === 'practice' ? 'prepractice_json' : 'morning_json';
  const idx = parseInt(req.body.idx, 10);
  const text = String(req.body.text || '').trim().slice(0, 200);
  const detail = String(req.body.detail || '').trim().slice(0, 500);
  const row = db.prepare(`SELECT ${col} FROM mental_routines WHERE user_id = ?`).get(req.user.id);
  if (row && Number.isInteger(idx) && text) {
    const items = JSON.parse(row[col] || '[]');
    if (idx >= 0 && idx < items.length) {
      items[idx].text = text;
      items[idx].detail = detail;
      db.prepare(`UPDATE mental_routines SET ${col} = ?, source='custom', updated_at = ? WHERE user_id = ?`)
        .run(JSON.stringify(items), new Date().toISOString(), req.user.id);
    }
  }
  res.redirect('/mental-game/routines/edit');
});
app.post('/mental-game/bible/done', requireLogin, (req, res) => {
  const today = todayChicagoDate();
  db.prepare('INSERT OR IGNORE INTO mental_card_done (user_id, day, card, completed_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, today, 'bible', new Date().toISOString());
  res.redirect('/mental-game');
});
// Daily mental exercises (Sep 23 2026) — one concrete exercise per day from
// the 8-book frameworks. Each has the concept, the baseball why, and the
// action. 2-3 minute read. Rotates by Chicago weekday.
const MENTAL_EXERCISES = [
  { // Sunday
    key: 'aar',
    title: 'After-Action Review',
    book: 'Goggins',
    concept: 'Goggins does an after-action review after every effort — what worked, what didn\'t, what changes. Not to beat yourself up. The review is where the learning happens. Most guys finish a week and either feel good or feel bad. Neither teaches you anything.',
    baseball: 'The AAR turns every week into data. You stop guessing about what\'s working and you know. That\'s how you actually get better instead of just hoping.',
    action: 'Write 3 things that worked this week (keep doing them), 2 that didn\'t (fix them), and 1 specific adjustment you\'ll make in the cage this week.',
  },
  { // Monday
    key: 'good-wolf',
    title: 'Feed the Good Wolf',
    book: 'Afremow',
    concept: 'Two wolves fight in your head — the one that says you can\'t and the one that says you can. The one that wins is the one you feed. Every time you catch a negative thought and replace it on purpose, you\'re feeding the good wolf. Every time you let it run unchallenged, you\'re feeding the other one.',
    baseball: '"I can\'t hit this guy" doesn\'t stay in your head — it changes your swing. Tentative, defensive swings come from a fed bad wolf. The thought comes first, the swing follows it.',
    action: 'Catch ONE negative thought today — write the actual sentence. Then write what you\'ll say instead. That\'s one rep for the good wolf.',
  },
  { // Tuesday
    key: 'keys-review',
    title: 'Your 3×5 Card',
    book: 'Mack',
    concept: 'Gary Mack had his players carry a 3×5 card with their personal keys — the 2 or 3 things that lock them in. Not ten things. Two or three. When pressure hits, you don\'t need a manual. You need your card. One look, and you\'re back.',
    baseball: 'Your card is what you go to in the on-deck circle when the game is on the line. It\'s your reset button — the stuff that\'s already worked for you, not something new to think about.',
    action: 'Read your keys below. Pick the ONE that matters most today. Say it out loud. That\'s your card — carry it into everything.',
  },
  { // Wednesday
    key: 'signal-light',
    title: 'Signal Lights',
    book: 'Ravizza',
    concept: 'Ravizza taught players to read themselves like a traffic light. Green is calm, focused, ready. Yellow is tension creeping in — rushing, distracted. Red is emotional — angry, panicked. Here\'s the key: the skill isn\'t staying green. It\'s noticing when you\'re not green and having a way back. Yellow and red are fine — if you catch them.',
    baseball: 'Ravizza said the 15 seconds between pitches is where the mental game lives. If you step into the box at yellow or red, you\'re already beat — your body is tight, your eyes are jumpy. Step out, breathe, get back to green. Then compete. Every pitch.',
    action: 'Check yourself right now: what color are you? If it\'s not green, practice the reset — physically step out, one deep breath, your keyword, step back in. Do it 3 times right now until it feels automatic.',
  },
  { // Thursday
    key: 'cookie-jar',
    title: 'Cookie Jar',
    book: 'Goggins',
    concept: 'Goggins keeps a mental cookie jar — every hard thing he\'s done, every obstacle he\'s beaten, written down in detail. When he\'s suffering and the quitting voice gets loud, he reaches in: "I\'ve done hard things before. This is just the next one." Confidence doesn\'t come from hype or positive thinking. It comes from evidence — things you actually did.',
    baseball: 'A .300 hitter fails 70% of the time. The jar is what keeps the 70% from defining you. When you\'re 0-for-12 and it feels permanent, the jar says otherwise — with dates and specifics, not vibes.',
    action: 'Write down ONE past win in detail — the date, what happened, what it felt like, what you did right. Be specific. That\'s your first cookie in the jar.',
  },
  { // Friday
    key: 'staircase',
    title: 'One Staircase Step',
    book: 'Mack',
    concept: 'Mack\'s Goal Staircase: you don\'t get to the top in one jump. Every big goal is a staircase of small steps, and you climb it one step at a time. The step has to be small enough that you\'ll actually do it — not impressive, just done. Done beats perfect.',
    baseball: '"Get stronger" isn\'t a step — it\'s a wish. "Do my arm care routine tomorrow at 7am" is a step. Vague goals create anxiety (Dorfman). Concrete steps kill it.',
    action: 'Pick ONE concrete action for tomorrow that moves you up the staircase. Small enough to actually do. Write it down where you\'ll see it.',
  },
  { // Saturday
    key: 'breath-reset',
    title: 'Breath + Keyword Reset',
    book: 'Mack',
    concept: 'Between pitches you need a reset that\'s automatic — not something you think through, something your body just does. One breath plus one keyword. The breath settles your body (slows the heart, loosens the shoulders). The keyword locks your mind onto one thing instead of ten. Practice it until it\'s reflex, because in a game you won\'t have time to think about it.',
    baseball: 'Two-strike count, crowd loud, heart pounding — that\'s not the time to build a routine. That\'s the time to run the one you already built. One breath, one word, compete.',
    action: 'Pick your keyword — one word that locks you in (yours, not someone else\'s). Now practice: step out, one breath, say the keyword, step in. 3 reps right now.',
  },
];
function todayMentalExercise() {
  // Fresh daily content (Sep 23 2026, Bobby): new exercise every day, never
  // repeating. Falls back to the weekly rotation if generation hasn't run.
  try {
    const row = db.prepare('SELECT exercise_json FROM daily_content WHERE day = ?').get(todayChicagoDate());
    if (row && row.exercise_json) {
      const e = JSON.parse(row.exercise_json);
      if (e && e.title && e.action) return e;
    }
  } catch (e) {}
  const chi = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return MENTAL_EXERCISES[chi.getDay()];
}
function todayChicagoDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
    .toISOString().slice(0, 10);
}
// Daily Bible study verses (Sep 23 2026) — curated for athletes: competition,
// resilience, discipline, focus, trusting the work. Rotates by day-of-year.
// Each has Skip's breakdown, baseball application, and life application.
const BIBLE_VERSES = [
  {
    ref: '1 Corinthians 9:24-25',
    text: 'Do you not know that in a race all the runners run, but only one gets the prize? Run in such a way as to get it. Everyone who competes in the games goes into strict training.',
    theme: 'Train with intent',
    explanation: 'Paul\'s talking about athletes. He\'s saying there\'s a difference between running and running to win. Everybody in the race is moving — but only the guy with a prize in mind trains like it matters. "Strict training" is the key phrase. The Christian life, like baseball, isn\'t casual. You don\'t drift into being good.',
    baseball: 'Two guys take 100 swings. One\'s going through the motions, one\'s hunting something specific with every rep. Same cage, same time, completely different training. Paul\'s asking which one you are. "Run in such a way as to get it" — that\'s intent. Every round of BP, every lift, every sprint: are you training, or just exercising?',
    life: 'Most people live on autopilot — same routine, no prize in mind. The verse says pick the prize first, then let it change how you train. What are you actually running toward? If you can\'t answer that, you\'re just running.',
  },
  {
    ref: 'Joshua 1:9',
    text: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.',
    theme: 'Courage',
    explanation: 'God says this to Joshua right before he has to lead Israel into battle — replacing Moses, the greatest leader they\'d ever known. The pressure was massive. And God doesn\'t say "you\'ve got this" or "believe in yourself." He says be strong and courageous BECAUSE I\'m with you. The courage comes from the presence, not from you.',
    baseball: 'Stepping into the box in a big spot — runners on, game on the line — that\'s a Joshua moment. The fear is real. But courage isn\'t the absence of fear, it\'s acting anyway. And you\'re not acting alone.',
    life: 'Whatever you\'re walking into that scares you — the courage doesn\'t come from pumping yourself up. It comes from knowing who\'s with you.',
  },
  {
    ref: 'Philippians 4:13',
    text: 'I can do all this through him who gives me strength.',
    theme: 'Strength',
    explanation: 'Context matters: Paul wrote this from prison. He\'s not saying "I can hit .400 if I believe." He\'s saying he\'s learned to be content in every situation — hungry or full, free or in chains — because Christ gives him strength. It\'s about endurance through anything, not achievement of everything.',
    baseball: 'This verse isn\'t a magic boost for your exit velo. It\'s for the 0-for-20 stretch, the injury, the getting cut. "All this" means all of it — the good and the brutal. His strength shows up strongest when yours runs out.',
    life: 'When you hit the wall — and you will — this is the verse. Not "I can do anything I want," but "I can get through anything He walks me through."',
  },
  {
    ref: '2 Timothy 1:7',
    text: 'For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.',
    theme: 'No fear',
    explanation: 'Paul\'s writing to Timothy, a young leader who was timid — holding back, afraid to step up. Paul tells him: that timidity isn\'t from God. What God gave you is power (to act), love (for people), and self-discipline (to control yourself). Fear makes you shrink. The Spirit makes you step forward.',
    baseball: 'Timid in the box looks like taking hittable pitches, swinging defensive, hoping instead of hunting. That\'s not humility — that\'s fear. The verse says you weren\'t given a timid spirit. Power means attack. Self-discipline means stick to your plan when the pressure spikes.',
    life: 'Where are you playing small because you\'re afraid? The fear isn\'t from God. Power, love, discipline — that\'s your actual wiring.',
  },
  {
    ref: 'Proverbs 16:3',
    text: 'Commit to the Lord whatever you do, and he will establish your plans.',
    theme: 'Commitment',
    explanation: 'The Hebrew word for "commit" here literally means "roll" — like rolling a heavy stone onto something. It\'s not "think about God while you do your thing." It\'s roll the whole weight of it onto Him. Your plans, your training, your future — put it on Him, and He establishes (makes firm, makes it stand) your steps.',
    baseball: 'Commit your season to Him — not just "bless my stats" but the whole thing: the work, the results, the failure. When it\'s rolled onto Him, a bad game doesn\'t crush you because your identity isn\'t in the box score.',
    life: 'What are you carrying that\'s too heavy? Roll it. That\'s not giving up — that\'s putting it where it actually belongs.',
  },
  {
    ref: 'Isaiah 40:31',
    text: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.',
    theme: 'Endurance',
    explanation: 'This was written to people in exile — exhausted, far from home, wondering if God forgot them. The promise isn\'t that they won\'t get tired. It\'s that those who HOPE (wait, trust, look to Him) get their strength renewed. Not once — continually. Eagles don\'t flap harder; they catch the wind.',
    baseball: 'Long season. Body\'s tired, mentally drained, still 20 games left. This isn\'t about pushing through on fumes — it\'s about where you go to get refilled. Hope isn\'t wishful thinking; it\'s the active choice to look to Him instead of just grinding.',
    life: 'Burnout comes from running on your own strength. Renewal comes from hope — stopping, looking up, letting Him refill what the grind drained.',
  },
  {
    ref: 'James 1:2-4',
    text: 'Consider it pure joy whenever you face trials of many kinds, because you know that the testing of your faith produces perseverance.',
    theme: 'Trials build you',
    explanation: 'James isn\'t saying enjoy pain. He\'s saying understand what it PRODUCES. Testing → perseverance → maturity. The trial isn\'t the point; what it builds is. "Consider it joy" means look at the trial and see the finished product, not just the pain.',
    baseball: 'The slump, the error that cost the game, getting benched — those are trials. They\'re either going to make you bitter or make you tougher. The difference is whether you see what they\'re producing. Perseverance isn\'t built in good times.',
    life: 'Whatever you\'re going through right now — ask what it\'s producing, not just what it\'s costing. That reframe changes everything.',
  },
  {
    ref: 'Romans 5:3-4',
    text: 'Suffering produces perseverance; perseverance, character; and character, hope.',
    theme: 'The process',
    explanation: 'Paul lays out the chain: suffering → perseverance → character → hope. Notice hope is at the END, not the beginning. You don\'t start with hope; you build to it through the hard stuff. Each link produces the next. Skip the suffering and you skip the whole chain.',
    baseball: 'This is the offseason in a verse. The suffering (6am lifts, the boring reps) produces perseverance (showing up anyway), which builds character (who you are when no one\'s watching), which produces hope (real confidence, not hype). There are no shortcuts in the chain.',
    life: 'If you\'re in the suffering part right now, you\'re not stuck — you\'re in step one of a process that ends in hope. Keep going.',
  },
  {
    ref: '1 Timothy 4:8',
    text: 'Physical training is of some value, but godliness has value for all things.',
    theme: 'Perspective',
    explanation: 'Paul\'s not dismissing training — he says it has value. But he\'s putting it in perspective: physical training helps for this life; godliness (becoming like Christ) has value for this life AND the next. It\'s a priority check, not a guilt trip.',
    baseball: 'Train hard — it matters. But don\'t let baseball become your god. The guys who make baseball their identity fall apart when baseball gets hard. Keep it in its place: valuable, not ultimate.',
    life: 'What are you training? Your body, your skills — good. But are you training your character with the same intent? That\'s the one that lasts.',
  },
  {
    ref: 'Colossians 3:23',
    text: 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.',
    theme: 'Effort',
    explanation: 'Paul wrote this to slaves — people doing work they didn\'t choose for masters who didn\'t care. And he says: work like you\'re working for God, not for them. The audience doesn\'t determine the effort. The One you\'re really serving does. That changes everything about boring, unseen work.',
    baseball: 'Nobody\'s watching your 6am tee work. Your coach isn\'t there. No scouts. Just you and the tee. This verse says that rep counts anyway — because you\'re not working for the coach or the scouts. You\'re working for Him. All heart, even when no one sees.',
    life: 'The work nobody sees is the work that matters most. Do it for the right audience.',
  },
  {
    ref: 'Proverbs 27:17',
    text: 'As iron sharpens iron, so one person sharpens another.',
    theme: 'Teammates',
    explanation: 'Iron sharpening iron isn\'t comfortable — it\'s friction. Sparks. Resistance. The verse isn\'t about hanging out with people who make you feel good; it\'s about the people who make you better, even when it\'s uncomfortable. Sharpening requires contact and pressure.',
    baseball: 'You need teammates who push you — who call you out when you\'re coasting, who compete with you in practice. The comfortable teammate makes you soft. The iron teammate makes you sharp. Be that guy for someone else too.',
    life: 'Who sharpens you? And who are you sharpening? If everyone around you just agrees with you, you\'re getting dull.',
  },
  {
    ref: 'Galatians 6:9',
    text: 'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.',
    theme: "Don't quit",
    explanation: 'Paul acknowledges the weariness — doing the right thing is exhausting sometimes. But he ties it to a harvest: "at the proper time." Not your time. The proper time. The condition is simple: don\'t give up. The harvest is certain; the timing isn\'t yours.',
    baseball: 'You\'ve been doing the work — eating right, training, showing up — and the results aren\'t there yet. This verse is for that exact moment. Don\'t get weary. The harvest comes "at the proper time" — not when you want it, but when it\'s ready. Keep planting.',
    life: 'Whatever good you\'re doing that feels pointless right now — don\'t stop. The harvest is coming. Not giving up is the whole job.',
  },
  {
    ref: 'Psalm 18:32-34',
    text: 'It is God who arms me with strength and keeps my way secure. He makes my feet like the feet of a deer; he causes me to stand on the heights.',
    theme: 'Prepared',
    explanation: 'David\'s a warrior writing about God as his strength. "Feet like a deer" — sure-footed, fast, able to stand on high rocky places without slipping. This isn\'t God doing it FOR David; it\'s God equipping David to do it. Armed with strength, made steady, placed on the heights.',
    baseball: 'God doesn\'t swing the bat for you. He arms you — gives you the strength, the ability, the preparation — and then you compete. "Feet like a deer" is balance, quickness, being sure-footed when the pressure\'s on. That\'s trained, not wished for.',
    life: 'Stop waiting for God to do it for you. He\'s armed you. Now go stand on the heights.',
  },
  {
    ref: 'Hebrews 12:1',
    text: 'Let us run with perseverance the race marked out for us, fixing our eyes on Jesus.',
    theme: 'Focus',
    explanation: 'The image is a race with witnesses watching (the "great cloud" from chapter 11). Two commands: run with perseverance (don\'t quit) and fix your eyes on Jesus (don\'t look around). Runners who look at the competition stumble. The race is "marked out for us" — yours, not someone else\'s.',
    baseball: '"Fixing our eyes" is focus. Not on the scouts, not on the other team\'s pitcher, not on your last at-bat. On the next pitch. The race marked out for YOU — stop running someone else\'s race, stop comparing your timeline to his.',
    life: 'Eyes wander → you stumble. Fix them. Your race, your pace, your eyes forward.',
  },
  {
    ref: 'Deuteronomy 31:6',
    text: 'Be strong and courageous. Do not be afraid or terrified, for the Lord your God goes with you; he will never leave you nor forsake you.',
    theme: 'Not alone',
    explanation: 'Moses says this to Israel before they enter the promised land — facing giants, fortified cities, real danger. The reason for courage isn\'t "you\'re strong enough." It\'s "He goes with you." And the promise at the end is absolute: NEVER leave, NEVER forsake. Not sometimes. Never.',
    baseball: 'You\'re never alone in the box. Not in the slump, not in the big moment, not on the bus ride home after a bad game. "Never" means never — including the times you feel most alone.',
    life: 'Whatever you\'re facing that feels too big — you\'re not facing it alone. That\'s not a feeling; it\'s a promise.',
  },
];
function todayBibleVerse() {
  // Fresh daily content (Sep 23 2026, Bobby): new verse every day, never
  // repeating. Falls back to the rotation pool if generation hasn't run.
  try {
    const row = db.prepare('SELECT verse_json FROM daily_content WHERE day = ?').get(todayChicagoDate());
    if (row && row.verse_json) {
      const v = JSON.parse(row.verse_json);
      if (v && v.ref && v.text) return v;
    }
  } catch (e) {}
  const chi = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const start = new Date(chi.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((chi - start) / 86400000);
  return BIBLE_VERSES[dayOfYear % BIBLE_VERSES.length];
}

// Fresh daily content generation (Sep 23 2026, Bobby): one Gemini call makes
// BOTH today's verse and today's mental exercise. Runs at 4am Chicago via the
// background loop — athletes never wait on it.
const DAILY_CONTENT_SYSTEM = `You create daily content for a baseball mental-game app used by teenage hitters. Your voice: a direct, no-fluff hitting coach talking in the cage. Short sentences. Zero corporate polish. Never preachy, never cheesy.
Rules: mirror, don't fix. Mental before physical. Never invent mechanical causes. Never suggest hitting drills. Never diagnose. Build confidence from evidence, not hype.`;
async function generateDailyContent() {
  const today = todayChicagoDate();
  if (db.prepare('SELECT 1 FROM daily_content WHERE day = ?').get(today)) return false;
  // Never repeat: feed recent refs/titles so the model picks fresh ones.
  let recent = [];
  try {
    recent = db.prepare('SELECT verse_json, exercise_json FROM daily_content ORDER BY day DESC LIMIT 60').all()
      .flatMap((r) => {
        const out = [];
        try { const v = JSON.parse(r.verse_json || '{}'); if (v.ref) out.push('verse: ' + v.ref); } catch (e) {}
        try { const e2 = JSON.parse(r.exercise_json || '{}'); if (e2.title) out.push('exercise: ' + e2.title); } catch (e) {}
        return out;
      });
  } catch (e) {}
  const noRepeat = recent.length ? `\nRecently used (NEVER repeat any of these):\n${recent.join('\n')}` : '';
  const prompt = `Create today's content. Return ONLY valid JSON, no markdown, no commentary, with exactly these two keys:
{
  "verse": { "ref": "Book 1:2-3", "text": "full verse text", "theme": "2-4 words", "explanation": "2-3 sentences, plain talk", "baseball": "2-3 sentences tying it to baseball", "life": "2-3 sentences for life off the field" },
  "exercise": { "key": "short-slug", "title": "Short Title", "book": "one of: Afremow, Mack, Dorfman, Ravizza, Goggins, Grover, Holiday, Bassham", "concept": "3-4 sentences teaching the idea in plain talk", "baseball": "2-3 sentences tying it to baseball", "action": "one concrete thing to do today, specific" }
}
Verse: pick a real Bible verse about competition, resilience, discipline, focus, courage, or trusting the work. Quote the text accurately.
Exercise: teach ONE concrete mental-game idea from these books — Afremow (The Champion's Mind: feed the good wolf, 3 post-game questions, mental scorecard), Mack (Mind Gym: 3x5 card, A.C.T. backward, breath + keyword, switch the channel), Dorfman (process goals, judge approach not results, quality thoughts), Ravizza (signal lights, RAMP-C, 15 seconds between pitches, flush it), Goggins (40% rule, cookie jar, accountability mirror, AAR), Grover (relentless, done-next, results over approval), Holiday (obstacle is the way, perception/action/will, follow the process), Bassham (mental program: anticipation/action/reinforcement, picture the positive). Make it fresh — a new angle, not a rehash.${noRepeat}`;
  const raw = await geminiText(DAILY_CONTENT_SYSTEM, prompt, 1500);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('daily_content_parse');
  const parsed = JSON.parse(m[0]);
  if (!parsed.verse || !parsed.verse.ref || !parsed.exercise || !parsed.exercise.title) throw new Error('daily_content_shape');
  db.prepare('INSERT OR REPLACE INTO daily_content (day, verse_json, exercise_json, generated_at) VALUES (?, ?, ?, ?)')
    .run(today, JSON.stringify(parsed.verse), JSON.stringify(parsed.exercise), new Date().toISOString());
  return true;
}
// 4am Chicago generation (Bobby, Sep 23 2026): once past 4:00am and today's
// row is missing, generate it. Runs inside the existing 5-minute loop.
let lastDailyContentDay = '';
async function ensureDailyContent() {
  try {
    const nowDay = chiDay(new Date());
    if (lastDailyContentDay === nowDay) return;
    const chiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    if (chiNow.getHours() < 4) return;
    if (db.prepare('SELECT 1 FROM daily_content WHERE day = ?').get(nowDay)) {
      lastDailyContentDay = nowDay;
      return;
    }
    await generateDailyContent();
    lastDailyContentDay = nowDay;
  } catch (e) {
    console.warn('daily content generation failed (fallback rotation in use):', e.message);
  }
}
const MENTAL_PLAN_SYSTEM = `You are Coach Skip, a direct no-fluff hitting coach writing a hitter's personal mental-game plan. You just gauged where his head is at. Write the plan TO him ("you"). Be specific — use his exact words back at him. No generic advice.

Format exactly like this:

WHERE YOU'RE AT
2-3 honest sentences on his mental game right now. Name what you see: his signal light, his self-talk, his pattern when things go bad. Be direct — he can handle it.

YOUR RESET
Based on his signal light and what his head does under pressure, give him a specific reset protocol: what to do physically (step out, breath, etc.), what to say to himself (use his words or give him a keyword), when to use it. 3-4 sentences. Make it something he can do in 15 seconds between pitches.

KILL THE BAD TALK
He told you his worst self-talk sentence. Quote it back, then give him the exact replacement sentence to say instead. Explain WHY the old one hurts him (one sentence — e.g. expecting results creates pressure, thinking mechanics freezes the body). Then the replacement.

YOUR PATTERN
He told you what happens when he struggles (expecting results / thinking mechanics / worried about who's watching / going blank). Name the pattern, explain what it's doing to him in one sentence, then give him the specific counter-move. If he expects results: process over outcome, one pitch. If he thinks mechanics: external cue, see ball. If worried about watching: present focus, the only eyes that matter are his. If blank: breathe, ground, one word.

BIG MOMENTS
He told you his big-moment mode (attacking / hoping / depends). If attacking: protect it, don't let the moment change him. If hoping or depends: give him the shift — what's the attacking version of him look like, one concrete thing to do when the big moment comes.

DAILY WORK
2-3 concrete things to do every day. Anchor to routines he already has. If he has no routine, give him one tiny starter (one thing in the morning, one thing before bed). Keep each to one line starting with "- ".

Keep the whole thing 300-400 words. Every section must reference something HE actually said — never generic. If he didn't answer something, skip that section rather than guessing.`;

async function buildMentalPlan(answers, userId) {
  // Questionnaire v2 (Sep 23 2026): answers is a plain {qkey: answer} map.
  // Known keys get the book-based diagnostic wording; coach-added questions
  // are appended as plain Q/A so nothing Bobby adds is ever dropped.
  const baseline = answers || {};
  const KNOWN = new Set(['has_routine', 'head_state', 'signal_light', 'worst_self_talk', 'struggle_pattern', 'big_moment_mode', 'hard_voice', 'pregame_routine', 'morning_routine', 'breath_work', 'when_sped_up', 'between_pitches', 'keyword', 'best_game', 'visualization', 'confidence_source', 'post_game', 'focus_pull']);
  const bits = [];
  const routineWord = { yes: 'has a routine he trusts', sortof: 'sort of has a routine', no: 'has no routine' }[baseline.has_routine] || 'did not say';
  const headWord = { present: 'usually present', between: 'in between', worried: 'usually worried' }[baseline.head_state] || 'did not say';
  bits.push(`Routine: ${routineWord}. Head in games: ${headWord}.`);
  // Book-based diagnostic (Sep 23 2026)
  const lightWord = { green: 'usually green (calm, focused)', yellow: 'usually yellow (tension creeping in)', red: 'usually red (emotional, rushed)' }[baseline.signal_light];
  if (lightWord) bits.push(`Signal light: ${lightWord}.`);
  if (baseline.worst_self_talk) bits.push(`Worst self-talk: "${baseline.worst_self_talk}"`);
  const struggleWord = { expecting_results: 'expects results without the process', thinking_mechanics: 'thinks mechanics in the box', worried_watching: 'worried about who\'s watching', blank: 'goes blank under pressure' }[baseline.struggle_pattern];
  if (struggleWord) bits.push(`When struggling: ${struggleWord}.`);
  const modeWord = { attacking: 'attacks in big moments', hoping: 'hopes in big moments', depends: 'it depends in big moments' }[baseline.big_moment_mode];
  if (modeWord) bits.push(`Big moments: ${modeWord}.`);
  if (baseline.hard_voice) bits.push(`When it gets hard, the voice says: "${baseline.hard_voice}"`);
  if (baseline.pregame_routine) bits.push(`Pre-game routine: "${baseline.pregame_routine}"`);
  if (baseline.morning_routine) bits.push(`Morning routine: "${baseline.morning_routine}"`);
  if (baseline.breath_work) bits.push(`Breath work: "${baseline.breath_work}"`);
  if (baseline.when_sped_up) bits.push(`What he does when sped up now: "${baseline.when_sped_up}"`);
  // Individualization fields (Sep 23 2026) — from the books
  if (baseline.between_pitches) bits.push(`Between pitches he does: "${baseline.between_pitches}"`);
  if (baseline.keyword) bits.push(`His reset keyword: "${baseline.keyword}"`);
  if (baseline.best_game) bits.push(`His best game (cookie jar evidence): "${baseline.best_game}"`);
  const visWord = { yes: 'visualizes success every game', sometimes: 'sometimes visualizes', no: 'never visualizes' }[baseline.visualization];
  if (visWord) bits.push(`Visualization: ${visWord}.`);
  const confWord = { preparation: 'confidence from preparation', past_success: 'confidence from past success', disappears: 'confidence disappears when struggling' }[baseline.confidence_source];
  if (confWord) bits.push(`Confidence source: ${confWord}.`);
  const postWord = { replay: 'replays mistakes over and over', forget: 'tries to forget bad games', review: 'reviews then moves on', beat_up: 'beats himself up' }[baseline.post_game];
  if (postWord) bits.push(`After bad games: ${postWord}.`);
  if (baseline.focus_pull) bits.push(`What pulls his focus: "${baseline.focus_pull}"`);
  // Coach-added questions (not in the original 13): include as plain Q/A.
  try {
    const extra = db.prepare('SELECT qkey, prompt FROM mental_questions WHERE active = 1').all()
      .filter((q) => !KNOWN.has(q.qkey) && baseline[q.qkey]);
    for (const q of extra) bits.push(`"${q.prompt}" — he answered: "${baseline[q.qkey]}"`);
  } catch (e) {}
  // His keys adjust the plan (Bobby, Sep 23 2026) — what he wants, in his words.
  if (userId) {
    try {
      const keys = db.prepare('SELECT content FROM mental_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      if (keys.length) bits.push(`His personal keys (he chose these — build the plan around them):\n${keys.map((k) => `- "${k.content}"`).join('\n')}`);
    } catch (e) {}
  }
  return geminiText(MENTAL_PLAN_SYSTEM, `This hitter's mental-game baseline:\n${bits.join('\n')}`, 800);
}

// Regenerate the plan when keys change — the plan adjusts to what he wants.
async function refreshMentalPlan(userId) {
  const baseline = getMentalBaseline(userId);
  if (!baseline || !baseline.plan) return;
  try {
    const plan = await buildMentalPlan(getMentalAnswers(userId), userId);
    db.prepare('UPDATE mental_baseline SET plan = ?, updated_at = ? WHERE user_id = ?')
      .run(plan, new Date().toISOString(), userId);
  } catch (e) {
    console.warn('plan refresh failed:', e.message);
  }
}

// ---- Personalized mental routines (Sep 23 2026, Bobby) ----
// No two hitters get the same routine. The generic defaults below are the
// fallback for hitters who haven't answered the questionnaire; everyone
// else gets checklists built from their own answers.
const DEFAULT_MORNING = [
  { text: '10 slow breaths', detail: 'Feet on the ground. In for 4, out for 6. Start calm before the day starts.' },
  { text: 'Say your keyword out loud', detail: 'One word. Yours. Say it like you mean it — this is your reset switch.' },
  { text: 'See 3 good at-bats', detail: 'In your head, feel them. The pitch coming in, the barrel meeting it, the result. Make it vivid.' },
  { text: "Read your one focus for today", detail: 'Just one thing. Not five. One. Write it down if you have to.' },
  { text: 'Move', detail: 'Stretch, walk, get the blood going. Two minutes minimum — wake the body up.' },
];
const DEFAULT_PREGAME = [
  { text: '3 slow breaths', detail: 'Feet on the ground. Leave the day behind — school, phone, whatever. This is game time now.' },
  { text: 'Say your keyword out loud', detail: 'Lock in. One word, full conviction.' },
  { text: 'See 3 good at-bats', detail: 'Feel them like they already happened. You\'ve done this before.' },
  { text: 'Shake it out', detail: 'Roll your shoulders, loosen your jaw, unclench everything. Tension is the enemy.' },
  { text: 'Lock in', detail: '"I\'m ready. Attack." Say it to yourself and believe it.' },
];
const DEFAULT_PRACTICE = [
  { text: '3 breaths', detail: 'Clear the last class, the last game, whatever\'s on your mind. Be here now.' },
  { text: 'Set one intention', detail: '"Today I\'m working on ___." Fill in the blank. Practice with a purpose.' },
  { text: 'Say your keyword', detail: 'Get your head right before the first rep.' },
  { text: 'See one perfect rep', detail: 'In your head, before you start. Feel the whole thing go right.' },
];
const OLD_DEFAULT_ROUTINE_TEXTS = [
  '10 slow breaths — feet on the ground, start calm',
  'Say your keyword out loud',
  'See 3 good at-bats in your head — feel them',
  'Read your one focus for today',
  'Move — stretch, walk, get the blood going',
  '3 slow breaths — feet on the ground, leave the day behind',
  'Shake it out — roll your shoulders, loosen up',
  'Lock in: "I\'m ready. Attack."',
  '3 breaths — clear the last class, last game, whatever',
  'Set one intention: "Today I\'m working on ___"',
  'Say your keyword',
  'See one perfect rep in your head before you start',
];
// Every default item text ever shipped — used to tell "never touched the
// defaults" apart from "edited his own routine".
const KNOWN_DEFAULT_ROUTINE_TEXTS = new Set(
  [...DEFAULT_MORNING, ...DEFAULT_PREGAME, ...DEFAULT_PRACTICE].map((d) => d.text.toLowerCase())
    .concat(OLD_DEFAULT_ROUTINE_TEXTS.map((s) => s.toLowerCase()))
);

// Deterministic questionnaire → routine mapping (no LLM: instant, free,
// consistent). Each list is a priority-ordered pool, sliced to length —
// hitters with no routine yet get the tiny starter (3ish items).
function buildPersonalRoutines(answers) {
  const a = answers || {};
  const has = (v) => String(v || '').trim().length > 0;
  const t = (v, n) => { v = String(v || '').trim(); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
  // Sanitize keyword: dismissive answers ("nope", "nah", "idk", etc.) become
  // a positive default. A reset word must be something you WANT to say.
  const rawKw = String(a.keyword || '').trim();
  const dismissive = /^(nope?|nah+|no|none|n\/a|na|idk|dont know|don't know|nothing|no idea|\?+|-+)$/i;
  const kw = dismissive.test(rawKw) ? 'Lock in' : rawKw;
  const starter = a.has_routine === 'no';
  const light = a.signal_light;

  const morningPool = [];
  if (light === 'red') morningPool.push({ text: '10 slow breaths — cool the red', detail: 'In for 4, out for 6. You run red when it gets emotional — this is your daily practice at staying green.' });
  else if (light === 'yellow') morningPool.push({ text: '10 slow breaths', detail: 'In for 4, out for 6. You run yellow — catch the tension early in the day before it builds.' });
  else morningPool.push({ text: '10 slow breaths', detail: 'Feet on the ground. In for 4, out for 6. Start calm before the day starts.' });
  if (has(kw)) morningPool.push({ text: `Say your keyword: "${t(kw, 24)}"`, detail: 'Out loud. One word, full conviction — this is your reset switch for the day.' });
  else morningPool.push({ text: 'Pick your reset word', detail: "One word that locks you back in. Yours, not someone else's — then use it all day." });
  if (has(a.worst_self_talk)) morningPool.push({ text: 'Catch the sentence', detail: `When you hear "${t(a.worst_self_talk, 90)}" today — that's your cue. It's never true. Answer it${has(kw) ? ' with your keyword' : ''}.` });
  else if (has(a.hard_voice)) morningPool.push({ text: 'Name the governor', detail: `It says "${t(a.hard_voice, 90)}". Hear it, label it, don't obey it.` });
  if (a.confidence_source === 'disappears') morningPool.push({ text: 'Open the cookie jar', detail: has(a.best_game) ? `Name 2 times you came through — like ${t(a.best_game, 110)}` : 'Name 2 times you came through under pressure. Evidence beats feelings.' });
  else if (a.confidence_source === 'preparation') morningPool.push({ text: 'Trust the work', detail: 'Your confidence comes from preparation — you put the work in. Walk like it today.' });
  else if (a.confidence_source === 'past_success') morningPool.push({ text: "You've done it before", detail: 'Your confidence comes from past success. Today is just another chance to add to the pile.' });
  morningPool.push({ text: 'Read your one focus for today', detail: 'Just one thing. Not five. One. Write it down if you have to.' });
  morningPool.push({ text: 'Move', detail: 'Stretch, walk, get the blood going. Two minutes minimum — wake the body up.' });

  const pregamePool = [];
  if (has(a.between_pitches)) pregamePool.push({ text: 'Your between-pitch reset', detail: `"${t(a.between_pitches, 110)}" — that's YOUR 15 seconds. Do it between every pitch.` });
  else pregamePool.push({ text: '3 slow breaths', detail: 'Feet on the ground. Leave the day behind — school, phone, whatever. Game time now.' });
  if (light === 'red' || light === 'yellow') pregamePool.push({ text: 'Shake it out', detail: 'Roll shoulders, loosen jaw, unclench everything. Tension is the enemy — you know how you run.' });
  const sp = a.struggle_pattern;
  if (sp === 'expecting_results') pregamePool.push({ text: 'One pitch', detail: 'Win THIS pitch. Expecting results creates pressure — the process is the only thing you control.' });
  else if (sp === 'thinking_mechanics') pregamePool.push({ text: 'See ball, hit ball', detail: 'Thinking mechanics in the box freezes the body. One external cue: see it, hit it.' });
  else if (sp === 'worried_watching') pregamePool.push({ text: 'The only eyes that matter', detail: has(a.focus_pull) ? `Not ${t(a.focus_pull, 70)} — the only eyes that matter are yours, on the ball.` : "Not the crowd, not who's watching — your eyes, on the ball." });
  else if (sp === 'blank') pregamePool.push({ text: 'Breathe, ground, one word', detail: 'Feet in the dirt. One breath. Your keyword. Blank is just noise — breathe through it.' });
  const bm = a.big_moment_mode;
  if (bm === 'attacking') pregamePool.push({ text: 'Protect the attack', detail: "You attack in big moments — don't let the moment change that. Same you, bigger stage." });
  else if (bm === 'hoping' || bm === 'depends') pregamePool.push({ text: 'Attack the moment', detail: 'Decide right now: when the big moment comes, you attack. Hoping is not a plan.' });
  if (a.visualization === 'no') pregamePool.push({ text: 'See 3 good at-bats', detail: "You've never tried picturing success — start now. Feel the pitch, the barrel, the result. Make it vivid." });
  else if (a.visualization === 'sometimes') pregamePool.push({ text: 'See 3 good at-bats', detail: 'You sometimes picture it — make it every game. Feel them like they already happened.' });
  else pregamePool.push({ text: 'See 3 good at-bats', detail: "You've done this before — feel them like they already happened." });
  if (has(kw)) pregamePool.push({ text: `Say your keyword: "${t(kw, 24)}"`, detail: 'Lock in. One word, full conviction, right before first pitch.' });

  const practicePool = [
    { text: '3 breaths — be here now', detail: "Clear the last class, the last game, whatever's on your mind. Be here now." },
  ];
  if (has(a.focus_pull)) practicePool.push({ text: 'Lock the focus', detail: `${t(a.focus_pull, 80)} stays outside the cage. One intention in here.` });
  practicePool.push({ text: 'Set one intention', detail: '"Today I\'m working on ___." Fill in the blank. Practice with a purpose.' });
  if (has(kw)) practicePool.push({ text: `Say your keyword: "${t(kw, 24)}"`, detail: 'Get your head right before the first rep.' });
  if (a.post_game === 'replay' || a.post_game === 'beat_up') practicePool.push({ text: 'Flush yesterday', detail: "Review a bad game for 5 minutes, then it's gone. Beating yourself up is not preparation." });
  else if (a.visualization === 'no' || a.visualization === 'sometimes') practicePool.push({ text: 'See one perfect rep', detail: 'In your head, before you start. Feel the whole thing go right — practice the picture.' });

  const done = (arr) => arr.map((x) => ({ text: x.text, detail: x.detail || '', done: false }));
  return {
    morning: done(morningPool.slice(0, starter ? 3 : 6)),
    pregame: done(pregamePool.slice(0, starter ? 4 : 6)),
    practice: done(practicePool.slice(0, starter ? 3 : 5)),
  };
}

// Write a hitter's questionnaire-based routines. Returns true when written.
// Never touches 'custom' rows — a hitter who edited his routines keeps them.
// A 'default' row whose items don't all match shipped defaults is treated as
// custom (edited before source tracking existed) and left alone.
function personalizeRoutinesFor(userId) {
  const answers = getMentalAnswers(userId);
  if (!Object.values(answers).some((v) => String(v || '').trim())) return false;
  let row = null;
  try { row = db.prepare('SELECT source FROM mental_routines WHERE user_id = ?').get(userId); } catch (e) { return false; }
  if (row && row.source === 'custom') return false;
  if (row && row.source !== 'personalized') {
    try {
      const full = db.prepare('SELECT morning_json, pregame_json, prepractice_json FROM mental_routines WHERE user_id = ?').get(userId);
      const items = [...JSON.parse(full.morning_json || '[]'), ...JSON.parse(full.pregame_json || '[]'), ...JSON.parse(full.prepractice_json || '[]')];
      if (items.length && items.some((it) => !KNOWN_DEFAULT_ROUTINE_TEXTS.has(String(it.text || '').toLowerCase()))) {
        db.prepare("UPDATE mental_routines SET source = 'custom' WHERE user_id = ?").run(userId);
        return false;
      }
    } catch (e) { /* fall through and personalize */ }
  }
  const r = buildPersonalRoutines(answers);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO mental_routines (user_id, morning_json, pregame_json, prepractice_json, source, updated_at)
    VALUES (?, ?, ?, ?, 'personalized', ?)
    ON CONFLICT(user_id) DO UPDATE SET morning_json=excluded.morning_json, pregame_json=excluded.pregame_json,
      prepractice_json=excluded.prepractice_json, source='personalized', updated_at=excluded.updated_at`)
    .run(userId, JSON.stringify(r.morning), JSON.stringify(r.pregame), JSON.stringify(r.practice), now);
  return true;
}

app.post('/mental-game/save', requireLogin, async (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // Questionnaire v2 (Sep 23 2026): answers stored per-question so Bobby can
  // edit the questions without losing anyone's answers.
  const b = req.body || {};
  const clean = (v) => String(v || '').trim().slice(0, 600);
  const questions = getMentalQuestions();
  const answers = getMentalAnswers(req.user.id);
  const now = new Date().toISOString();
  const up = db.prepare(`INSERT INTO mental_answers (user_id, qkey, answer, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, qkey) DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at`);
  for (const q of questions) {
    const raw = b['q_' + q.qkey];
    let val = '';
    if (q.qtype === 'radio') {
      const allowed = (q.options || []).map((o) => String(o[0]));
      val = allowed.includes(String(raw || '')) ? String(raw) : '';
    } else {
      val = clean(raw);
    }
    answers[q.qkey] = val;
    up.run(req.user.id, q.qkey, val, now);
  }
  let plan = (getMentalBaseline(req.user.id) || {}).plan || '';
  let planFailed = false;
  try {
    plan = await buildMentalPlan(answers, req.user.id);
  } catch (e) {
    planFailed = true;
  }
  db.prepare(`INSERT INTO mental_baseline (user_id, plan, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, updated_at=excluded.updated_at`)
    .run(req.user.id, plan, now);
  // Answers changed → rebuild his personalized routines (never touches a
  // 'custom' row; Sep 23 2026, Bobby — no two hitters get the same routine).
  try { personalizeRoutinesFor(req.user.id); } catch (e) { console.warn('routine personalize failed:', e.message); }
  res.redirect(planFailed ? '/mental-game/questionnaire?planfailed=1' : '/mental-game/questionnaire?saved=1');
});

// Hitter's daily routine tab — every-day blocks of their program. Remote athletes only.
app.get('/program/routine', requireLogin, requireWaiver, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  const p = getProgram(req.user.remoteProgramId);
  if (!p) return res.redirect('/');
  res.send(views.programRoutinePage(req.user, p, videoLibMap()));
});

// Coach: edit a remote hitter's program.
app.get('/coach/program/:id/edit', requireCoach, (req, res) => {
  setApprovalCount(req);
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  const linked = db.prepare('SELECT id, email FROM users WHERE remote_program_id = ? LIMIT 1').get(p.id);
  const lift = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
  // Progression read: logged weights → what's improving/stalled → next-block
  // emphasis. Makes Bobby's next-block approval fast and informed.
  let progression = null;
  try {
    if (linked && linked.id) progression = progressionRead(linked.id);
  } catch (e) { progression = null; }
  let subs = [];
  try {
    if (linked && linked.id) {
      subs = db.prepare('SELECT * FROM program_substitutions WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(linked.id);
    }
  } catch (e) { subs = []; }
  const block = db.prepare('SELECT block_start, block_number, block_notified_at, next_lifting_id, next_block_start FROM remote_programs WHERE id = ?').get(p.id) || {};
  let nextLiftName = '';
  if (block.next_lifting_id) {
    try {
      const nl = db.prepare('SELECT name FROM lifting_programs WHERE id = ?').get(block.next_lifting_id);
      if (nl) nextLiftName = nl.name;
    } catch (e) { /* ignore */ }
  }
  res.send(views.programEditPage(realUser(req), p, linked ? linked.email : null, !!(lift && lift.lifting_program_id), progression, { subs, block, nextLiftName }));
});

app.post('/coach/program/:id/save', requireCoach, (req, res) => {
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  const b = req.body;
  const prog = p.prog && p.prog.athlete ? p.prog : blankProgram(p.athlete_name);
  prog.athlete = p.athlete_name;
  prog.date_range = String(b.date_range || '').trim().slice(0, 60);
  prog.phase_emphasis = String(b.phase_emphasis || '').trim().slice(0, 120);
  prog.adjustment = String(b.adjustment || '').trim().slice(0, 500);
  prog.mental_framework = String(b.mental_framework || '').trim().slice(0, 200);
  const grades = {};
  const gradeWhys = {};
  for (const g of PROGRAM_GRADES) {
    const v = String(b['grade_' + g.replace(/ /g, '_')] || '').trim().slice(0, 4);
    if (v) grades[g] = v;
    const why = String(b['grade_why_' + g.replace(/ /g, '_')] || '').trim().slice(0, 200);
    if (why) gradeWhys[g] = why;
  }
  prog.grades = grades;
  prog.grade_whys = gradeWhys;
  prog.strengths = String(b.strengths || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
  prog.cues = {
    movement: String(b.cue_movement || '').trim().slice(0, 300),
    timing: String(b.cue_timing || '').trim().slice(0, 300),
    game: String(b.cue_game || '').trim().slice(0, 300),
  };
  const cats = [];
  const curByCat = {};
  for (const cb of (prog.routine || [])) curByCat[String((cb && cb.category) || '')] = cb;
  for (const k of Object.keys(b)) {
    const m = k.match(/^cat_(\d+)_name$/);
    if (m) {
      const name = String(b[k] || '').trim().slice(0, 60);
      if (!name) continue;
      // Pool of the block's current items (matched by drill name) so an
      // unchanged link keeps its auto/manual origin; any add, change, or
      // clear of a link is Bobby's manual decision.
      const pool = (((curByCat[name] || {}).items) || []).map((it) => ({
        drill: String((it && it.drill) || ''),
        video: String((it && it.video) || ''),
        source: String((it && it.video_source) || ''),
        used: false,
      }));
      const items = String(b[`cat_${m[1]}_items`] || '')
        .split('\n')
        .map((line) => {
          const parts = String(line).split('|');
          const drill = (parts[0] || '').trim().slice(0, 80);
          if (!drill) return null;
          const item = { drill };
          const vol = (parts[1] || '').trim().slice(0, 60);
          if (vol) item.volume = vol;
          const rawLink = (parts[2] || '').trim().slice(0, 300);
          const link = /^https?:\/\//i.test(rawLink) ? rawLink : '';
          if (link) item.video = link;
          const prev = pool.find((pp) => !pp.used && pp.drill === drill);
          if (prev) {
            prev.used = true;
            const src = link === prev.video ? prev.source : 'manual';
            if (src) item.video_source = src;
          } else if (link) {
            item.video_source = 'manual';
          }
          return item;
        })
        .filter(Boolean)
        .slice(0, 20);
      cats.push({ category: name, items, _i: Number(m[1]), guide: !!((curByCat[name] || {}).guide) });
    }
  }
  cats.sort((a, b) => a._i - b._i);
  prog.routine = cats.map(({ category, items, guide }) => (guide ? { category, items, guide: true } : { category, items }));
  const schedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  prog.schedule = schedDays
    .map((day, i) => [day, String(b['sched_' + i] || '').trim().slice(0, 40)])
    .filter(([, label]) => label);
  prog.notes = String(b.notes || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!Array.isArray(prog.schedule)) prog.schedule = [];
  if (!Array.isArray(prog.notes)) prog.notes = [];
  // Saving clears the intake-draft flag — Bobby has reviewed the program.
  delete prog.draft;
  delete prog.draft_source;
  delete prog.draft_note;
  db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(prog),
    new Date().toISOString(),
    p.id
  );
  // The Programs tab is gone — program editing now lives on the Organizations page.
  res.redirect('/coach/organizations');
});

// Coach: manage the remote roster.
app.post('/coach/remote/add', requireCoach, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name) {
    const exists = db
      .prepare('SELECT id FROM remote_programs WHERE lower(athlete_name) = lower(?)')
      .get(name);
    if (!exists) {
      const info = db
        .prepare('INSERT INTO remote_programs (athlete_name, program_json, updated_at) VALUES (?, ?, ?)')
        .run(name, JSON.stringify(blankProgram(name)), new Date().toISOString());
      backfillRemoteLinks();
    }
  }
  res.redirect('/coach/programs');
});

// Hitting plan editor (Sep 23 2026): Bobby edits each hitter's one-page
// hitting plan document — training environments note, warmup (prep work),
// drills (name/volume/cues/why), footer.
app.get('/coach/program/:id/hitting-plan', requireCoach, (req, res) => {
  setApprovalCount(req);
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  if (!p.prog.hitting_plan) p.prog.hitting_plan = buildHittingPlan(p.prog);
  // Bobby (Sep 24 2026): plans saved before the environment picker existed may
  // have no environments (the old POST wiped them). Pre-fill the picker from
  // the sheet auto-collect — transient, not persisted — so a save keeps them.
  const _hp = p.prog.hitting_plan;
  if ((!_hp.environments || !_hp.environments.length) && !_hp.environments_custom) {
    try { _hp._auto_env_names = buildHittingPlan(p.prog).environments || []; }
    catch (e) { _hp._auto_env_names = []; }
  }
  res.send(views.hittingPlanEditPage(req.user, p));
});

app.post('/coach/program/:id/hitting-plan', requireCoach, (req, res) => {
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  const b = req.body || {};
  const oldPlan = (p.prog && p.prog.hitting_plan) || {};
  const plan = {
    _custom: true, // Bobby (Sep 23 2026): coach edit — sheet sync must preserve this
    _v: HITTING_PLAN_VERSION, // Bobby (Sep 24 2026): saved plans must not trip the lazy backfill
    environments_note: String(b.environments_note || '').trim(),
    env_variations: String(b.env_variations || '').trim(),
    warmup: [],
    drills: [],
    medball: [],
    footer: String(b.footer || '').trim(),
  };
  // Warmup items: w_name_0, w_detail_0, ...
  for (let i = 0; i < 50; i++) {
    const name = String(b[`w_name_${i}`] || '').trim();
    if (!name) continue;
    plan.warmup.push({ name, detail: String(b[`w_detail_${i}`] || '').trim() });
  }
  // Drills: d_name_0, d_env_0, d_volume_0, d_cues_0, d_why_0, ...
  for (let i = 0; i < 100; i++) {
    const name = String(b[`d_name_${i}`] || '').trim();
    if (!name) continue;
    plan.drills.push({
      name,
      env: String(b[`d_env_${i}`] || 'Tee').trim() || 'Tee',
      volume: String(b[`d_volume_${i}`] || '').trim(),
      cues: String(b[`d_cues_${i}`] || '').trim(),
      why: String(b[`d_why_${i}`] || '').trim(),
    });
  }
  // Med ball: m_name_0, m_volume_0, m_cues_0, ...
  for (let i = 0; i < 30; i++) {
    const name = String(b[`m_name_${i}`] || '').trim();
    if (!name) continue;
    plan.medball.push({
      name,
      volume: String(b[`m_volume_${i}`] || '').trim(),
      cues: String(b[`m_cues_${i}`] || '').trim(),
    });
  }
  // Training environments picker (Bobby, Sep 24 2026): checked library
  // environments + free-text others become the plan's environment list.
  // Previously the POST rebuilt the plan without `environments`, silently
  // wiping the Training Environments section on every coach save.
  if (b.env_picker) {
    const rawIds = b.env_ids === undefined ? [] : (Array.isArray(b.env_ids) ? b.env_ids : [b.env_ids]);
    const pickedIds = rawIds.map((x) => String(x)).filter((id) => envById(id));
    const others = String(b.env_other || '').split('\n').map((s) => s.trim()).filter(Boolean);
    plan.environments_custom = pickedIds;
    plan.environments_other = others;
    plan.environments = [
      ...pickedIds.map((id) => envById(id).name),
      ...others,
    ];
  } else {
    // Form without the picker (shouldn't happen) — preserve whatever was there.
    plan.environments = oldPlan.environments || [];
    if (oldPlan.environments_custom) plan.environments_custom = oldPlan.environments_custom;
    if (oldPlan.environments_other) plan.environments_other = oldPlan.environments_other;
  }
  p.prog.hitting_plan = plan;
  db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(p.prog), new Date().toISOString(), p.id);
  res.redirect(`/coach/program/${p.id}/hitting-plan?saved=1`);
});

app.post('/coach/remote/remove', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) {
    db.prepare('UPDATE users SET remote_program_id = NULL WHERE remote_program_id = ?').run(id);
    db.prepare('DELETE FROM remote_programs WHERE id = ?').run(id);
  }
  res.redirect('/coach/programs');
});

app.post('/coach/remote/alias', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const alias = String(req.body.alias || '').trim().slice(0, 80);
  if (id && alias) {
    const row = db.prepare('SELECT aliases FROM remote_programs WHERE id = ?').get(id);
    if (row) {
      const cur = String(row.aliases || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!cur.map((x) => x.toLowerCase()).includes(alias.toLowerCase())) cur.push(alias);
      db.prepare('UPDATE remote_programs SET aliases = ? WHERE id = ?').run(cur.join('\n'), id);
      backfillRemoteLinks(); // link anyone waiting under this name right away
    }
  }
  res.redirect('/coach/programs');
});

app.post('/coach/remote/link', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = email
    ? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'athlete'").get(email)
    : null;
  if (id && u) db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?').run(id, u.id);
  res.redirect('/coach/programs');
});

app.post('/coach/remote/unlink', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) db.prepare('UPDATE users SET remote_program_id = NULL WHERE remote_program_id = ?').run(id);
  res.redirect('/coach/programs');
});

// ---- Lifting programs (Sep 2026) ----
// Coach-only: templates, athlete assignments, and the per-athlete lifting
// editor. requireCoach already 403s view-only coaches.
function requireLiftingCoach(req, res, next) {
  // Use realUser: in view-as mode req.user is the previewed athlete.
  const u = realUser(req);
  if (!u || u.role !== 'coach') return res.status(403).send('Coaches only.');
  if (!u.canEdit) return res.status(403).send('View-only coaches cannot change programs.');
  next();
}
function liftingProgramsList() {
  return db.prepare('SELECT * FROM lifting_programs ORDER BY is_template DESC, name').all().map((r) => ({
    id: r.id, name: r.name, is_template: r.is_template,
    days: (() => { try { return JSON.parse(r.program_json || '{}').days || []; } catch (e) { return []; } })(),
  }));
}
app.get('/coach/lifting', requireLiftingCoach, (req, res) => {
  res.send(views.liftingProgramsPage(req.user, {
    templates: liftingProgramsList().filter((l) => l.is_template),
    programs: liftingProgramsList().filter((l) => !l.is_template),
    assignments: remoteProgramList(),
  }));
});
app.post('/coach/lifting/create', requireLiftingCoach, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.redirect('/coach/lifting');
  const isTemplate = req.body.is_template ? 1 : 0;
  // Program names are unique — re-render with an error instead of a 500.
  const dup = db.prepare('SELECT id FROM lifting_programs WHERE name = ?').get(name);
  if (dup) {
    return res.send(views.liftingProgramsPage(req.user, {
      templates: liftingProgramsList().filter((l) => l.is_template),
      programs: liftingProgramsList().filter((l) => !l.is_template),
      assignments: remoteProgramList(),
      error: 'A program named \u201C' + name + '\u201D already exists — pick a different name.',
    }));
  }
  const info = db
    .prepare('INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, isTemplate, JSON.stringify({ days: [{ label: 'Day A', exercises: [] }], notes: [] }), new Date().toISOString());
  res.redirect('/coach/lifting/' + info.lastInsertRowid + '/edit');
});
// Assign a template to an athlete: copies the template into a private,
// per-athlete program (later tweaks never touch the template), then links it.
// Bobby's rule (Sep 23 2026): the copy is personalized from the athlete's
// intake questionnaire at assign time — equipment he lacks and injuries he
// flagged get swapped for fitting alternatives, beginners get eased RPE.
// Every swap lands in the program notes for Bobby's review in the editor.
// Athletes with no questionnaire answers get the template verbatim.
app.post('/coach/lifting/assign', requireLiftingCoach, (req, res) => {
  const templateId = Number(req.body.template_id);
  const programId = Number(req.body.program_id);
  const tpl = getLifting(templateId);
  if (!tpl || !tpl.is_template || !programId) return res.redirect('/coach/lifting');
  const athlete = db.prepare('SELECT athlete_name FROM remote_programs WHERE id = ?').get(programId);
  const athleteName = athlete ? athlete.athlete_name : 'athlete';
  const copyName = tpl.name + ' — ' + athleteName;
  let days = tpl.days;
  const notes = tpl.notes || [];
  let personalization_notes = [];
  try {
    const user = db.prepare('SELECT id FROM users WHERE remote_program_id = ?').get(programId);
    const row = user ? db.prepare('SELECT answers_json FROM intake_responses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id) : null;
    if (row && row.answers_json) {
      const p = personalizeLiftingDays(tpl.days, JSON.parse(row.answers_json), athleteName);
      days = p.days;
      personalization_notes = p.personalization_notes || [];
    }
  } catch (e) { /* personalization is best-effort — never block the assign */ }
  const info = db
    .prepare('INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, 0, ?, ?)')
    .run(copyName, JSON.stringify({
      days, notes, personalization_notes,
      source: 'personalized', // never auto-overwritten; editor saves flip to 'custom'
      personalized_from: { template_id: templateId, template_name: tpl.name },
    }), new Date().toISOString());
  db.prepare('UPDATE remote_programs SET lifting_program_id = ? WHERE id = ?').run(info.lastInsertRowid, programId);
  res.redirect('/coach/lifting/' + info.lastInsertRowid + '/edit');
});
app.post('/coach/lifting/unassign', requireLiftingCoach, (req, res) => {
  const programId = Number(req.body.program_id);
  if (programId) db.prepare('UPDATE remote_programs SET lifting_program_id = NULL WHERE id = ?').run(programId);
  res.redirect('/coach/lifting');
});
app.post('/coach/lifting/delete', requireLiftingCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) {
    db.prepare('UPDATE remote_programs SET lifting_program_id = NULL WHERE lifting_program_id = ?').run(id);
    db.prepare('DELETE FROM lifting_programs WHERE id = ?').run(id);
  }
  res.redirect('/coach/lifting');
});

// ---- Mental-game questionnaire editor (Sep 23 2026, Bobby) ----
// Bobby edits the Lock In questionnaire: add / edit / reorder / archive.
// Full-access coaches only (same gate as lifting programs).
function getAllMentalQuestions() {
  try {
    return db.prepare('SELECT * FROM mental_questions ORDER BY sort, id').all()
      .map((q) => ({ ...q, options: (() => { try { return JSON.parse(q.options || '[]'); } catch (e) { return []; } })() }));
  } catch (e) { return []; }
}
app.get('/coach/mental-questions', requireLiftingCoach, (req, res) => {
  res.send(views.coachMentalQuestionsPage(req.user, getAllMentalQuestions()));
});
app.post('/coach/mental-questions/add', requireLiftingCoach, (req, res) => {
  const prompt = String(req.body.prompt || '').trim().slice(0, 300);
  if (!prompt) return res.redirect('/coach/mental-questions');
  const qtype = req.body.qtype === 'radio' ? 'radio' : 'text';
  const hint = String(req.body.hint || '').trim().slice(0, 300);
  let options = [];
  if (qtype === 'radio') {
    options = String(req.body.options || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .slice(0, 8).map((l, i) => {
        const parts = l.split('|').map((s) => s.trim());
        return [parts[0] || ('opt' + i), parts[1] || parts[0] || ('Option ' + (i + 1))];
      });
  }
  const qkey = 'custom_' + Date.now().toString(36);
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM mental_questions').get().m;
  db.prepare('INSERT INTO mental_questions (qkey, prompt, hint, qtype, options, sort, active) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(qkey, prompt, hint, qtype, JSON.stringify(options), maxSort + 1);
  res.redirect('/coach/mental-questions');
});
app.post('/coach/mental-questions/update', requireLiftingCoach, (req, res) => {
  const id = Number(req.body.id);
  const q = id && db.prepare('SELECT * FROM mental_questions WHERE id = ?').get(id);
  if (!q) return res.redirect('/coach/mental-questions');
  const prompt = String(req.body.prompt || '').trim().slice(0, 300) || q.prompt;
  const hint = String(req.body.hint || '').trim().slice(0, 300);
  const qtype = req.body.qtype === 'radio' ? 'radio' : 'text';
  let options = [];
  if (qtype === 'radio') {
    options = String(req.body.options || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .slice(0, 8).map((l, i) => {
        const parts = l.split('|').map((s) => s.trim());
        return [parts[0] || ('opt' + i), parts[1] || parts[0] || ('Option ' + (i + 1))];
      });
  }
  db.prepare('UPDATE mental_questions SET prompt = ?, hint = ?, qtype = ?, options = ? WHERE id = ?')
    .run(prompt, hint, qtype, JSON.stringify(options), id);
  res.redirect('/coach/mental-questions');
});
app.post('/coach/mental-questions/toggle', requireLiftingCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) db.prepare('UPDATE mental_questions SET active = 1 - active WHERE id = ?').run(id);
  res.redirect('/coach/mental-questions');
});
app.post('/coach/mental-questions/move', requireLiftingCoach, (req, res) => {
  const id = Number(req.body.id);
  const dir = req.body.dir === 'up' ? -1 : 1;
  const qs = getAllMentalQuestions();
  const i = qs.findIndex((q) => q.id === id);
  const j = i + dir;
  if (id && i >= 0 && j >= 0 && j < qs.length) {
    db.prepare('UPDATE mental_questions SET sort = ? WHERE id = ?').run(qs[j].sort, qs[i].id);
    db.prepare('UPDATE mental_questions SET sort = ? WHERE id = ?').run(qs[i].sort, qs[j].id);
  }
  res.redirect('/coach/mental-questions');
});

app.get('/coach/lifting/:id/edit', requireLiftingCoach, (req, res) => {
  const lp = getLifting(req.params.id);
  if (!lp) return res.redirect('/coach/lifting');
  res.send(views.liftingEditPage(req.user, lp));
});
// Sanitize the state-driven lifting editor's program JSON (Sep 23 2026).
// Days carry label, warmup[], speed[]/medball[] ({name, volume, notes,
// video}) and exercises[] ({name, sets, reps, target_rpe, rest, notes,
// video}). Anything malformed is dropped, never trusted.
function sanitizeLiftingDays(rawDays) {
  const cleanUrl = (u) => {
    const s = String(u || '').trim().slice(0, 300);
    return /^https?:\/\//i.test(s) ? s : '';
  };
  const cleanIntent = (v) => {
    const s = String(v || '').toLowerCase();
    return s === 'max' ? 'max' : s === 'ecc' ? 'ecc' : '';
  };
  const cleanSection = (v) => {
    const s = String(v || '').toLowerCase();
    return s === 'rotational' || s === 'brakes' ? s : 'strength';
  };
  const cleanBlock = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 12)
    .map((s) => {
      const name = String((s && s.name) || '').trim().slice(0, 120);
      // Held-for-coach-review survives the save until Bobby replaces the
      // exercise (name differs from held_original) — then it's released.
      const held = !!(s && s.held);
      const heldOriginal = String((s && s.held_original) || '').trim().slice(0, 120);
      const stillHeld = held && heldOriginal && name === heldOriginal;
      return {
        name,
        volume: String((s && s.volume) || '').trim().slice(0, 60),
        notes: String((s && s.notes) || '').trim().slice(0, 200),
        video: cleanUrl(s && s.video),
        intent: cleanIntent(s && s.intent),
        ...(stillHeld ? {
          held: true,
          held_original: heldOriginal,
          held_reason: String((s && s.held_reason) || '').trim().slice(0, 200),
        } : {}),
      };
    })
    .filter((s) => s.name);
  return (Array.isArray(rawDays) ? rawDays : []).slice(0, 14).map((d, i) => ({
    label: String((d && d.label) || '').trim().slice(0, 40) || ('Day ' + String.fromCharCode(65 + i)),
    warmup: views.normWarmup(d && d.warmup)
      .map((w) => String(w).trim().slice(0, 200)).filter(Boolean).slice(0, 20),
    speed: cleanBlock(d && d.speed),
    medball: cleanBlock(d && d.medball),
    exercises: (Array.isArray(d && d.exercises) ? d.exercises : []).slice(0, 40).map((e) => {
      const trpe = Number(e && e.target_rpe);
      const name = String((e && e.name) || '').trim().slice(0, 120);
      const held = !!(e && e.held);
      const heldOriginal = String((e && e.held_original) || '').trim().slice(0, 120);
      const stillHeld = held && heldOriginal && name === heldOriginal;
      return {
        name,
        sets: String((e && e.sets) || '').trim().slice(0, 12),
        reps: String((e && e.reps) || '').trim().slice(0, 24),
        target_rpe: trpe >= 1 && trpe <= 10 ? trpe : '',
        rest: Math.max(15, Math.min(600, parseInt(e && e.rest, 10) || 120)),
        notes: String((e && e.notes) || '').trim().slice(0, 200),
        video: cleanUrl(e && e.video),
        section: cleanSection(e && e.section),
        intent: cleanIntent(e && e.intent),
        ...(stillHeld ? {
          held: true,
          held_original: heldOriginal,
          held_reason: String((e && e.held_reason) || '').trim().slice(0, 200),
        } : {}),
      };
    }).filter((e) => e.name),
  }));
}

app.post('/coach/lifting/:id/save', requireLiftingCoach, (req, res) => {
  const lp = getLifting(req.params.id);
  if (!lp) return res.redirect('/coach/lifting');
  const name = String(req.body.name || '').trim().slice(0, 80) || lp.name;
  // State-driven editor (Sep 23 2026) posts the whole program as JSON.
  // Legacy per-field parsing remains as the fallback.
  let days = null;
  if (req.body.program_json) {
    try {
      const parsed = JSON.parse(req.body.program_json);
      if (parsed && Array.isArray(parsed.days)) days = sanitizeLiftingDays(parsed.days);
    } catch (e) { /* fall through to legacy parsing */ }
  }
  if (!days) {
  days = [];
  for (let i = 0; i < 14; i++) {
    const label = String(req.body['lday_' + i + '_label'] || '').trim().slice(0, 40);
    const exCount = req.body['lday_' + i + '_excount'];
    if (!label && !exCount) continue;
    const exercises = [];
    const n = Math.min(40, Number(exCount) || 0);
    for (let j = 0; j < n; j++) {
      const exName = String(req.body['lex_' + i + '_' + j + '_name'] || '').trim().slice(0, 120);
      if (!exName) continue;
      const trpe = String(req.body['lex_' + i + '_' + j + '_trpe'] || '').trim();
      const video = String(req.body['lex_' + i + '_' + j + '_video'] || '').trim().slice(0, 300);
      exercises.push({
        name: exName,
        sets: String(req.body['lex_' + i + '_' + j + '_sets'] || '').trim().slice(0, 12),
        reps: String(req.body['lex_' + i + '_' + j + '_reps'] || '').trim().slice(0, 24),
        target_rpe: trpe && /^[1-9]$|^10$/.test(trpe) ? Number(trpe) : '',
        notes: String(req.body['lex_' + i + '_' + j + '_notes'] || '').trim().slice(0, 200),
        video: /^https?:\/\//i.test(video) ? video : '',
      });
    }
    const warmup = String(req.body['lday_' + i + '_warmup'] || '')
      .split('\n').map((x) => x.trim().slice(0, 200)).filter(Boolean);
    // Speed + med ball blocks (one per line: Name | volume | notes).
    const parseBlock = (key) => String(req.body[key] || '').split('\n')
      .map((l) => l.trim()).filter(Boolean).slice(0, 12)
      .map((l) => {
        const p = l.split('|').map((s) => s.trim());
        return { name: (p[0] || '').slice(0, 120), volume: (p[1] || '').slice(0, 60), notes: (p[2] || '').slice(0, 200) };
      }).filter((s) => s.name);
    const speed = parseBlock('lday_' + i + '_speed');
    const medball = parseBlock('lday_' + i + '_medball');
    days.push({ label: label || ('Day ' + String.fromCharCode(65 + i)), warmup, speed, medball, exercises });
  }
  }
  const finalName = name.replace(/\s*\(DRAFT\)\s*$/i, '').trim() || name;
  // Renaming onto an existing program name would 500 on the UNIQUE index —
  // re-render the editor with the clash flagged so nothing is lost.
  const clash = db.prepare('SELECT id FROM lifting_programs WHERE name = ? AND id != ?').get(finalName, lp.id);
  if (clash) {
    return res.send(views.liftingEditPage(req.user, { ...lp, name, days }, { error: 'A program named \u201C' + finalName + '\u201D already exists — pick a different name.' }));
  }
  db.prepare('UPDATE lifting_programs SET name = ?, program_json = ?, updated_at = ? WHERE id = ?').run(
    // Saving clears the intake-draft marker — Bobby has reviewed the program.
    // Other JSON fields (progression read, block index) are preserved.
    finalName,
    JSON.stringify({ ...lp, days, notes: lp.notes, draft: false, source: 'custom' }),
    new Date().toISOString(),
    lp.id
  );
  res.redirect('/coach/lifting');
});

// ---- Pre-signup intake questionnaire (Sep 2026) ----

// ---- Liability waiver (Sep 2026) ----
// Plain-English training waiver. Athletes with a program must sign before
// they can open it. The version is pinned on each signature, so Bobby's
// lawyer can revise the text later without invalidating old signatures.
const WAIVER_VERSION = 'v1-2026-09-22';
const WAIVER_PARAGRAPHS = [
  'I want to take part in baseball training programmed by Atkinson Hitting, including hitting practice, strength training with weights, medicine ball and explosive work, mobility work, and conditioning. I understand this training is voluntary.',
  'I understand that physical training — especially lifting weights — carries real risks, including muscle strains, sprains, broken bones, serious injury, and in rare cases permanent disability or death. I take on those risks for myself.',
  'I confirm that I am physically able to train. I have no medical condition that makes this training unsafe for me, or I have been cleared by a doctor. I will stop training and tell my coach right away if I feel pain, dizziness, chest discomfort, or anything else wrong.',
  'I release Atkinson Hitting, Atko Enterprises, Inc., Bobby Atkinson, and any coaches, assistants, or facility hosts working with them from any claims or lawsuits for injuries or losses connected to this training, even if caused by their negligence, to the fullest extent the law allows.',
  'I understand no results are promised. Getting stronger or hitting better depends on many factors, including my own effort, consistency, and health.',
  'I am signing this of my own free will. If I am under 18, my parent or legal guardian is co-signing below and agrees to all of this on my behalf.',
];
// Athletes with a linked program must sign the waiver before opening it.
// View-as sessions are exempt so Bobby can preview the athlete experience.
function needsWaiver(u) {
  return !!u && u.role === 'athlete' && u.remoteProgramId && !u.waiverSignedAt && !u.viewAs;
}
function waiverIsMinor(u) {
  const age = u && u.dateOfBirth ? ageOn(u.dateOfBirth) : null;
  return age != null && age < 18;
}
// Bobby texts prospects a shareable link. On submit the app auto-creates
// their athlete account (pending Bobby's approval), generates a baseline
// draft program from the answers (schedule from availability, tabs from
// components, provisional lifting draft from goals), and notifies Bobby.
// The draft is clearly marked unreviewed until Bobby edits + saves it.
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function getIntakeToken() {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'intake_token'").get();
    return r ? r.value : '';
  } catch (e) { return ''; }
}
function intakeLink(req) {
  const tok = getIntakeToken();
  return tok ? `${publicBaseUrl(req)}/intake/${tok}` : '';
}
function parseIntakeBody(b) {
  const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
  const arr = (v) =>
    (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  const yn = (v) => v === '1' || v === 'on' || v === 'yes';
  return {
    first_name: s(b.first_name, 40),
    last_name: s(b.last_name, 40),
    email: s(b.email, 120).toLowerCase(),
    phone: s(b.phone, 30),
    date_of_birth: s(b.date_of_birth, 10),
    parent_name: s(b.parent_name, 80),
    parent_email: s(b.parent_email, 120).toLowerCase(),
    height: s(b.height, 20),
    weight: s(b.weight, 20),
    // Goals
    goals: arr(b.goals),
    goals_other: s(b.goals_other, 200),
    goals_90: s(b.goals_90, 500),
    // Health & injuries (detailed)
    injury_current: s(b.injury_current, 1000),
    injury_area: s(b.injury_area, 200),
    injury_severity: s(b.injury_severity, 20),
    injury_cleared: s(b.injury_cleared, 20),
    injury_past: s(b.injury_past, 1000),
    pain_now: s(b.pain_now, 500),
    doctor_notes: s(b.doctor_notes, 500),
    // Training background
    years_training: s(b.years_training, 20),
    lifting_experience: s(b.lifting_experience, 20),
    past_programs: s(b.past_programs, 1000),
    what_worked: s(b.what_worked, 1000),
    what_didnt: s(b.what_didnt, 1000),
    squat_max: s(b.squat_max, 20),
    bench_max: s(b.bench_max, 20),
    deadlift_max: s(b.deadlift_max, 20),
    strong_not_explosive: yn(b.strong_not_explosive),
    // Equipment — questionnaire asks what they DON'T have (cleaner); convert
    // to the equipment tags the lifting builder needs.
    missing_equipment: arr(b.missing_equipment),
    equipment_detail: s(b.equipment_detail, 1000),
    // Availability & season
    components: arr(b.components),
    hit_days_per_week: Math.min(7, Math.max(1, parseInt(b.hit_days_per_week, 10) || 5)),
    lift_days_per_week: Math.min(7, Math.max(1, parseInt(b.lift_days_per_week, 10) || 4)),
    train_days: arr(b.train_days).filter((d) => WEEKDAYS.includes(d)),
    weekly_days: arr(b.weekly_days).filter((d) => ['recovery_day', 'mobility_day'].includes(d)),
    session_length: s(b.session_length, 40),
    schedule_constraints: s(b.schedule_constraints, 500),
    season_phase: ['offseason', 'preseason', 'inseason'].includes(b.season_phase) ? b.season_phase : 'offseason',
    season_detail: s(b.season_detail, 500),
    games_per_week: s(b.games_per_week, 20),
    // Hitting resources — questionnaire asks what they DON'T have; convert
    // to the have/has booleans the builder needs (missing_equipment has the
    // same shape for backward-compat reads).
    missing_hitting: arr(b.missing_hitting),
    equipment: arr(b.equipment),
    has_tee: yn(b.has_tee),
    has_net: yn(b.has_net),
    has_cage: yn(b.has_cage),
    has_machine: yn(b.has_machine),
    has_feed_partner: yn(b.has_feed_partner),
    feed_partner_detail: s(b.feed_partner_detail, 300),
    hitting_progression: arr(b.hitting_progression),
    current_ev: s(b.current_ev, 20),
    current_bat_speed: s(b.current_bat_speed, 20),
    // Lifestyle
    sleep_hours: s(b.sleep_hours, 20),
    sleep_quality: s(b.sleep_quality, 40),
    nutrition: s(b.nutrition, 1000),
    stress: s(b.stress, 500),
    other_notes: s(b.other_notes, 2000),
  };
}
// Baseline program scaffold from intake answers (Sep 2026). Structure +
// templates are the app's job; Bobby fills in his real hitting drills/cues
// in the editor. The week is a real calendar: every weekday gets a program
// day, Recovery, Mobility Day, or OFF. Mobility is the baseball template
// (hips/t-spine/shoulders/ankles), med ball is equipment-filtered. Hitting
// days get a real base template built ONLY from what the athlete actually
// has (tee/net/cage/machine, a reliable feeder, season phase, goals) —
// never a mechanical diagnosis, just a feasible scaffold Bobby finalizes.
function buildHittingBase(a, nDays, env) {
  const blocks = [];
  const inSeason = a.season_phase === 'inseason';
  const r = (off, inS) => (inSeason ? inS : off);
  const goal = String(((a.goals || [])[0]) || '').toLowerCase();
  const wantsVelo = /exit|velo|power|drive/.test(goal);
  // A place to actually hit balls: tee, machine, cage, or a feeder.
  const canHit = env.hasTee || env.hasMachine || env.hasCage || env.hasFeeder;
  // Weekly guideline — drills + a plan for the week + cues, not a deep
  // script. Bobby finalizes the drills and sets the cues in the editor.
  // Category starts with "Hitting —" (no Day prefix): renders under
  // "Every day" on the Hitting tab and is skipped by the guided session
  // tap-through (reference material, not check-offs).
  const envList = [];
  if (env.hasTee) envList.push('tee');
  if (env.hasNet) envList.push('net');
  if (env.hasCage) envList.push('cage');
  if (env.hasMachine) envList.push('machine');
  envList.push(env.hasFeeder ? 'feed partner' : 'NO feed partner');
  const planItems = [
    { drill: 'Week structure', prescription: `${nDays} hitting day${nDays === 1 ? '' : 's'} — Day 1–${nDays} below` },
    { drill: 'Environments', prescription: envList.join(' · ') },
  ];
  if (inSeason)
    planItems.push({ drill: 'In-season rule', prescription: 'Stay sharp — drill volume cut in half, no max-intent work the day before a game' });
  else if (a.season_phase === 'preseason')
    planItems.push({ drill: 'Pre-season rule', prescription: 'Build toward game speed — keep 1 intent round, feel and timing first' });
  else
    planItems.push({ drill: 'Off-season rule', prescription: 'Build volume through the week — finish machine/cage days with 1 intent round (max effort, full rest between swings)' });
  if (!env.hasFeeder)
    planItems.push({ drill: 'No feed partner', prescription: 'Tee / dry / machine / cage work carries the week — Bobby sets the mix when he reviews' });
  if (!canHit)
    planItems.push({ drill: 'Dry work only this cycle', prescription: 'No tee, machine, cage, or feeder on file — Bobby will adjust when he reviews' });
  planItems.push({ drill: 'How to run a day', prescription: 'Rhythm round easy → drill work with your cue → environment rounds → game swings, compete every pitch' });
  blocks.push({ category: 'Hitting — Week plan', guide: true, items: planItems });
  for (let i = 0; i < nDays; i++) {
    const items = [];
    // Never program tee work when the athlete has no tee — dry swings instead.
    if (env.hasTee) {
      items.push({ drill: 'Tee — rhythm round', prescription: '10 swings, easy — find your move' });
      items.push({ drill: 'Tee drill work — Bobby picks', prescription: r('3 rounds × 10', '2 rounds × 8') });
    } else {
      items.push({ drill: 'Dry swings — rhythm round', prescription: '10 swings, easy — find your move, no tee needed' });
      items.push({ drill: 'Dry move work — Bobby picks', prescription: r('3 rounds × 10', '2 rounds × 8') });
    }
    if (env.hasFeeder) items.push({ drill: 'Front toss / side toss', prescription: r('4 rounds × 10', '3 rounds × 10') });
    if (env.hasMachine) items.push({ drill: 'Machine rounds', prescription: r('3 rounds × 12', '2 rounds × 10') });
    else if (env.hasCage) items.push({ drill: 'Cage BP', prescription: r('3 rounds × 12', '2 rounds × 10') });
    if (wantsVelo && !inSeason && canHit) items.push({ drill: 'Intent round — move it', prescription: '1 round × 8, max intent, full rest between swings' });
    if (canHit) items.push({ drill: 'Game swings', prescription: r('15 swings — compete every pitch', '10 swings — compete every pitch') });
    else items.push({ drill: 'Dry game-speed swings', prescription: r('15 swings — compete on every rep', '10 swings — compete on every rep') });
    blocks.push({ category: 'Day ' + (i + 1) + ' — Hitting', items });
  }
  return blocks;
}
function recoveryDayBlock() {
  return {
    category: 'Recovery',
    items: [
      { drill: 'Easy walk or bike', prescription: '20–30 min, conversational pace — flush, not train' },
      { drill: 'Full mobility flow (Mobility tab)', prescription: '1 easy pass — nothing forced' },
      { drill: 'Breathing — downshift', prescription: '5 min nasal breathing, long exhales' },
    ],
  };
}
function buildIntakeProgram(a, athleteName) {
  const prog = blankProgram(athleteName);
  prog.draft = true;
  prog.draft_source = 'intake';
  const tags = equipmentTags(a);
  const has = (c) => a.components.includes(c);
  // Hitting resources — new rows store what they DON'T have; old rows kept
  // the has_* booleans. missing_* wins when present.
  const useMissing = Array.isArray(a.missing_hitting);
  const missHit = new Set(useMissing ? a.missing_hitting : []);
  const env = {
    hasTee: useMissing ? !missHit.has('tee') : !!a.has_tee,
    hasNet: useMissing ? !missHit.has('net') : !!a.has_net,
    hasCage: useMissing ? !missHit.has('cage') : !!a.has_cage,
    hasMachine: useMissing ? !missHit.has('machine') : !!a.has_machine,
    hasFeeder: useMissing ? !missHit.has('feed_partner') : !!a.has_feed_partner,
  };
  const envs = [];
  if (env.hasTee) envs.push('tee');
  if (env.hasNet) envs.push('net');
  if (env.hasCage) envs.push('cage');
  if (env.hasMachine) envs.push('machine');
  envs.push(env.hasFeeder ? 'front/side toss (has feeder)' : 'NO feed partner');
  // The week as a calendar: training days -> Day 1..N (Monday-first), then
  // recovery / mobility days onto free weekdays, everything else OFF.
  const ordered = WEEKDAYS.filter((d) => a.train_days.includes(d));
  const n = Math.min(ordered.length || a.hit_days_per_week, a.hit_days_per_week);
  const useDays = ordered.slice(0, n);
  prog.schedule = useDays.map((d, i) => [d, 'Day ' + (i + 1)]);
  const freeDays = WEEKDAYS.filter((d) => !prog.schedule.some((s) => s[0] === d));
  let fi = 0;
  let hasRecovery = false;
  let hasMobilityDay = false;
  if (a.weekly_days.includes('recovery_day') && freeDays[fi]) {
    prog.schedule.push([freeDays[fi], 'Recovery']);
    fi++;
    hasRecovery = true;
  }
  if (a.weekly_days.includes('mobility_day') && freeDays[fi]) {
    prog.schedule.push([freeDays[fi], 'Mobility Day']);
    fi++;
    hasMobilityDay = true;
  }
  for (; fi < freeDays.length; fi++) prog.schedule.push([freeDays[fi], 'OFF']);
  if (has('mobility')) for (const b of mobilityBlocks(tags)) prog.routine.push(b);
  if (has('hitting')) for (const b of buildHittingBase(a, useDays.length, env)) prog.routine.push(b);
  if (hasRecovery) prog.routine.push(recoveryDayBlock());
  // Med ball: lifters get it bundled inside the Lifting tab (the block lives
  // in the routine and the athlete view renders it there); non-lifters who
  // checked it get the standalone Med Ball tab.
  if (has('lifting') || has('medball')) for (const b of medballBlocks(tags)) prog.routine.push(b);
  if (has('metabolic')) for (const b of metabolicBlocks(tags)) prog.routine.push(b);
  // "The focus" — seeded from the athlete's own words (goals, what worked /
  // didn't), never a mechanical diagnosis. Bobby rewrites this when he
  // reviews the draft; the cues themselves stay his (editor: Movement /
  // Timing / Game), seeded blank.
  const focusBits = [];
  if ((a.goals || [])[0]) focusBits.push('Goal: ' + a.goals[0]);
  if ((a.goals || []).length > 1) focusBits.push('Also: ' + a.goals.slice(1).join(', '));
  if (a.goals_other) focusBits.push('Wants: ' + a.goals_other);
  if (a.what_worked) focusBits.push("What's worked: " + a.what_worked);
  if (a.what_didnt) focusBits.push("Hasn't worked: " + a.what_didnt);
  if (focusBits.length) prog.adjustment = focusBits.join(' · ').slice(0, 480);
  const flags = [];
  const inj = [a.injury_area && ('Area: ' + a.injury_area), a.injury_current, a.injury_severity && ('Severity: ' + a.injury_severity), a.injury_cleared && ('Cleared: ' + a.injury_cleared), a.pain_now && ('Current pain: ' + a.pain_now)].filter(Boolean).join(' · ');
  if (inj) flags.push('INJURIES: ' + inj);
  if (a.injury_past) flags.push('Past injuries: ' + a.injury_past);
  if (a.doctor_notes) flags.push('Doctor: ' + a.doctor_notes);
  if (a.goals_other) flags.push('Other goals: ' + a.goals_other);
  if (a.goals_90) flags.push('90-day goal: ' + a.goals_90);
  if (a.hitting_progression.length) flags.push('Hitting progression: ' + a.hitting_progression.join(', '));
  if (a.lifting_experience) flags.push('Lifting experience: ' + a.lifting_experience);
  const missEq = Array.isArray(a.missing_equipment) ? a.missing_equipment : null;
  flags.push('Equipment: ' + (missEq ? (missEq.length ? 'has everything except: ' + missEq.join(', ') : 'has everything') : ((a.equipment || []).join(', ') || 'bodyweight only')));
  if (a.equipment_detail) flags.push('Equipment detail: ' + a.equipment_detail);
  flags.push('Hitting resources: ' + envs.join(' · '));
  if (a.feed_partner_detail) flags.push('Feeder: ' + a.feed_partner_detail);
  if (a.current_ev || a.current_bat_speed) flags.push('Current: ' + [a.current_ev && ('EV ' + a.current_ev), a.current_bat_speed && ('bat speed ' + a.current_bat_speed)].filter(Boolean).join(' / '));
  const maxes = [a.squat_max && ('Squat ' + a.squat_max), a.bench_max && ('Bench ' + a.bench_max), a.deadlift_max && ('DL ' + a.deadlift_max)].filter(Boolean).join(' / ');
  if (maxes) flags.push('Best lifts: ' + maxes);
  flags.push('Season: ' + ({ offseason: 'Off-season', preseason: 'Pre-season', inseason: 'In-season' }[a.season_phase] || a.season_phase));
  if (a.games_per_week) flags.push('Games/wk: ' + a.games_per_week);
  if (a.season_detail) flags.push('Season detail: ' + a.season_detail);
  if (a.years_training) flags.push('Training yrs: ' + a.years_training);
  if (a.past_programs) flags.push('Past programs: ' + a.past_programs);
  if (a.what_worked) flags.push('What worked: ' + a.what_worked);
  if (a.what_didnt) flags.push("What didn't: " + a.what_didnt);
  if (a.sleep_hours || a.sleep_quality) flags.push('Sleep: ' + [a.sleep_hours, a.sleep_quality].filter(Boolean).join(' '));
  if (a.nutrition) flags.push('Nutrition: ' + a.nutrition);
  if (a.stress) flags.push('Stress: ' + a.stress);
  if (a.schedule_constraints) flags.push('Schedule: ' + a.schedule_constraints);
  if (a.session_length) flags.push('Session length: ' + a.session_length);
  if (a.other_notes) flags.push('Other: ' + a.other_notes);
  if (flags.length) prog.draft_note = 'From intake — ' + flags.join(' · ');
  return prog;
}
// ---- Lifting program generation (Sep 2026) ----
// Bobby is a hitting coach, not a lifting expert — the app drafts like one.
// Sourced from the guidelines doc (Summers Method, Kelly Training, Ian Jenkins):
// strength first → express it fast; explosive/med ball FIRST in the session;
// baseball movement patterns; season-calibrated; injury-smart; equipment-
// constrained. Bobby reviews/approves every draft. Keep the tables below easy
// to edit — he will send more guidelines.

// Equipment tags granted by each questionnaire checkbox. full_gym grants all.
const EQ_ALL = ['barbell', 'rack', 'dumbbell', 'kettlebell', 'trapbar', 'bands', 'pullup', 'bench', 'medball', 'box', 'sled', 'cables', 'field', 'rope'];
const EQ_MAP = {
  full_gym: EQ_ALL,
  barbell: ['barbell'], rack: ['rack'], dumbbell: ['dumbbell'], kettlebell: ['kettlebell'],
  trapbar: ['trapbar'], bands: ['bands'], pullup_bar: ['pullup'], bench: ['bench'],
  medball: ['medball'], plyo_box: ['box'], sled: ['sled'], cables: ['cables'],
  field_space: ['field'], jump_rope: ['rope'],
};
function equipmentTags(a) {
  const tags = new Set(['bodyweight']);
  // New questionnaire (Sep 2026): athlete lists what they DON'T have —
  // everything else is assumed available.
  if (a && Array.isArray(a.missing_equipment)) {
    const missing = new Set(a.missing_equipment);
    for (const [key, ts] of Object.entries(EQ_MAP)) {
      if (key === 'full_gym' || missing.has(key)) continue;
      for (const t of ts) tags.add(t);
    }
    return tags;
  }
  // Backward compat: old intake rows checked what they HAVE.
  for (const e of (a && a.equipment) || []) {
    for (const t of EQ_MAP[e] || []) tags.add(t);
  }
  return tags;
}
const fitsEq = (ex, tags) => (ex.eq || []).every((t) => tags.has(t));

// Movement patterns — used for equipment substitutions AND athlete self-subs.
const PATTERNS = ['squat', 'hinge', 'unilateral', 'push_h', 'push_v', 'pull_h', 'pull_v', 'core', 'rotational', 'jump', 'carry', 'iso'];
// ex: {name, pattern, eq:[tags], goals:[tracks], avoid:[injury keys], schemes}
// schemes keyed by emphasis: strength (absorb), power (produce), speed (express), health.
const LIFT_POOL = [
  // --- Squat pattern ---
  { name: 'Back Squat', pattern: 'squat', eq: ['barbell', 'rack'], goals: ['strength', 'exit_velo', 'balanced'], avoid: ['back', 'knee', 'hip', 'ankle'], schemes: { strength: ['5', '5', 8, '3–4 sec lowering'], power: ['4', '5', 8, '2-sec pause at bottom'], speed: ['5', '3', 7, 'Move it FAST — stop if bar slows'], health: ['3', '8', 7, ''] } },
  { name: 'Front Squat', pattern: 'squat', eq: ['barbell', 'rack'], goals: ['strength', 'exit_velo'], avoid: ['back', 'knee', 'wrist'], schemes: { strength: ['4', '5', 8, ''], power: ['4', '4', 8, ''], speed: ['5', '3', 7, 'Explode up'], health: ['3', '8', 6, ''] } },
  { name: 'Box Squat', pattern: 'squat', eq: ['barbell', 'rack', 'box'], goals: ['strength', 'health'], avoid: ['back'], schemes: { strength: ['5', '5', 8, 'Sit back, pause on box'], power: ['4', '5', 8, ''], speed: ['5', '3', 7, 'Explode off box'], health: ['3', '8', 6, 'Knee-friendly depth'] } },
  { name: 'Goblet Squat', pattern: 'squat', eq: ['dumbbell'], goals: ['balanced', 'health', 'exit_velo'], avoid: ['knee'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '6', 8, ''], speed: ['4', '5', 7, 'Fast up'], health: ['3', '10', 6, ''] } },
  { name: 'Goblet Squat', pattern: 'squat', eq: ['kettlebell'], goals: ['balanced', 'health', 'exit_velo'], avoid: ['knee'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '6', 8, ''], speed: ['4', '5', 7, 'Fast up'], health: ['3', '10', 6, ''] } },
  { name: 'Bodyweight Squat', pattern: 'squat', eq: [], goals: ['health', 'balanced'], avoid: ['knee'], schemes: { strength: ['3', '15', 7, ''], power: ['3', '12', 7, ''], speed: ['4', '8', 7, 'Explode up'], health: ['3', '12', 6, ''] } },
  // --- Hinge pattern ---
  { name: 'Trap Bar Deadlift', pattern: 'hinge', eq: ['trapbar'], goals: ['strength', 'exit_velo', 'balanced'], avoid: ['back'], schemes: { strength: ['5', '5', 8, '3–4 sec lowering'], power: ['4', '5', 8, ''], speed: ['5', '3', 7, 'Speed off floor'], health: ['3', '6', 7, ''] } },
  { name: 'Romanian Deadlift', pattern: 'hinge', eq: ['barbell'], goals: ['strength', 'exit_velo', 'health'], avoid: ['back'], schemes: { strength: ['4', '6', 8, 'Slow eccentric'], power: ['4', '6', 8, ''], speed: ['4', '5', 7, 'Snap hips'], health: ['3', '8', 6, ''] } },
  { name: 'DB Romanian Deadlift', pattern: 'hinge', eq: ['dumbbell'], goals: ['strength', 'exit_velo', 'health', 'balanced'], avoid: ['back'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '6', 8, ''], speed: ['4', '5', 7, 'Snap hips'], health: ['3', '10', 6, ''] } },
  { name: 'Hip Thrust', pattern: 'hinge', eq: ['bench', 'barbell'], goals: ['exit_velo', 'strength', 'health'], avoid: [], schemes: { strength: ['4', '8', 8, ''], power: ['4', '6', 9, '2-sec hold at top'], speed: ['4', '6', 7, 'Explode up'], health: ['3', '10', 6, ''] } },
  { name: 'DB Hip Thrust', pattern: 'hinge', eq: ['bench', 'dumbbell'], goals: ['exit_velo', 'health', 'balanced'], avoid: [], schemes: { strength: ['4', '10', 8, ''], power: ['4', '8', 8, ''], speed: ['4', '6', 7, 'Explode up'], health: ['3', '12', 6, ''] } },
  { name: 'Glute Bridge', pattern: 'hinge', eq: [], goals: ['health', 'balanced'], avoid: [], schemes: { strength: ['3', '12', 7, ''], power: ['3', '10', 8, ''], speed: ['3', '10', 7, ''], health: ['3', '12', 6, ''] } },
  { name: 'Hang Clean', pattern: 'hinge', eq: ['barbell'], goals: ['explosive'], avoid: ['back', 'wrist'], schemes: { strength: ['5', '3', 8, ''], power: ['5', '3', 8, ''], speed: ['5', '3', 7, 'Max intent'], health: ['3', '5', 6, 'Light, crisp'] } },
  { name: 'DB Hang Snatch', pattern: 'hinge', eq: ['dumbbell'], goals: ['explosive', 'exit_velo'], avoid: ['shoulder', 'wrist'], schemes: { strength: ['4', '4', 8, 'Each arm'], power: ['4', '4', 8, 'Each arm'], speed: ['4', '3', 7, 'Max intent, each arm'], health: ['3', '5', 6, 'Light'] } },
  // --- Unilateral ---
  { name: 'Bulgarian Split Squat', pattern: 'unilateral', eq: ['dumbbell', 'bench'], goals: ['strength', 'exit_velo', 'health', 'balanced'], avoid: ['knee'], schemes: { strength: ['3', '8', 8, 'Each leg'], power: ['3', '6', 8, 'Each leg, pause at bottom'], speed: ['3', '5', 7, 'Explode up, each leg'], health: ['3', '8', 6, 'Each leg'] } },
  { name: 'Bulgarian Split Squat', pattern: 'unilateral', eq: ['bench'], goals: ['health', 'balanced'], avoid: ['knee'], schemes: { strength: ['3', '10', 7, 'Each leg, bodyweight+'], power: ['3', '8', 7, 'Each leg'], speed: ['3', '6', 7, 'Explode, each leg'], health: ['3', '10', 6, 'Each leg'] } },
  { name: 'Reverse Lunge', pattern: 'unilateral', eq: ['dumbbell'], goals: ['strength', 'health', 'balanced'], avoid: ['knee'], schemes: { strength: ['3', '8', 8, 'Each leg'], power: ['3', '8', 8, 'Each leg'], speed: ['3', '6', 7, 'Each leg'], health: ['3', '10', 6, 'Each leg'] } },
  { name: 'Step-Up', pattern: 'unilateral', eq: ['dumbbell', 'box'], goals: ['strength', 'health'], avoid: ['knee'], schemes: { strength: ['3', '8', 8, 'Each leg'], power: ['3', '6', 8, 'Each leg'], speed: ['3', '5', 7, 'Drive up fast'], health: ['3', '8', 6, 'Low box, each leg'] } },
  { name: 'Single-Leg RDL', pattern: 'unilateral', eq: ['dumbbell'], goals: ['exit_velo', 'health', 'balanced'], avoid: ['back'], schemes: { strength: ['3', '8', 7, 'Each leg'], power: ['3', '8', 7, 'Each leg'], speed: ['3', '6', 7, 'Each leg'], health: ['3', '10', 6, 'Each leg'] } },
  { name: 'Lateral Lunge', pattern: 'unilateral', eq: ['dumbbell'], goals: ['exit_velo', 'health'], avoid: ['knee', 'hip'], schemes: { strength: ['3', '8', 7, 'Each side — baseball moves sideways'], power: ['3', '8', 7, 'Each side'], speed: ['3', '6', 7, 'Each side'], health: ['3', '8', 6, 'Each side'] } },
  { name: 'Bodyweight Reverse Lunge', pattern: 'unilateral', eq: [], goals: ['balanced', 'health'], avoid: [], schemes: { strength: ['3', '10', 7, 'Each side'], power: ['3', '8', 7, 'Each side'], speed: ['3', '6', 7, 'Each side'], health: ['3', '10', 6, 'Each side'] } },
  // --- Horizontal push ---
  { name: 'Bench Press', pattern: 'push_h', eq: ['barbell', 'bench', 'rack'], goals: ['strength', 'balanced'], avoid: ['shoulder', 'elbow'], schemes: { strength: ['5', '5', 8, ''], power: ['4', '5', 8, '2-sec pause on chest'], speed: ['5', '3', 7, 'Speed reps'], health: ['3', '8', 6, ''] } },
  { name: 'DB Bench Press', pattern: 'push_h', eq: ['dumbbell', 'bench'], goals: ['strength', 'exit_velo', 'balanced'], avoid: ['shoulder'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '6', 8, ''], speed: ['4', '5', 7, 'Explode up'], health: ['3', '10', 6, 'Neutral grip if shoulders cranky'] } },
  { name: 'Floor Press', pattern: 'push_h', eq: ['dumbbell'], goals: ['strength', 'health'], avoid: [], schemes: { strength: ['4', '8', 8, 'Shoulder-friendly'], power: ['4', '6', 8, 'Pause at floor'], speed: ['4', '5', 7, ''], health: ['3', '10', 6, ''] } },
  { name: 'Push-Up', pattern: 'push_h', eq: [], goals: ['health', 'balanced'], avoid: ['shoulder', 'elbow', 'wrist'], schemes: { strength: ['3', '12', 8, ''], power: ['3', '10', 8, ''], speed: ['4', '6', 7, 'Explode off floor'], health: ['3', '10', 6, ''] } },
  // --- Vertical push ---
  { name: 'Overhead Press', pattern: 'push_v', eq: ['barbell'], goals: ['strength'], avoid: ['shoulder', 'back'], schemes: { strength: ['4', '6', 8, ''], power: ['4', '5', 8, ''], speed: ['4', '4', 7, 'Push fast'], health: ['3', '8', 6, 'Seated if back cranky'] } },
  { name: 'DB Overhead Press', pattern: 'push_v', eq: ['dumbbell'], goals: ['strength', 'balanced'], avoid: ['shoulder'], schemes: { strength: ['3', '8', 8, ''], power: ['3', '8', 8, ''], speed: ['3', '5', 7, ''], health: ['3', '10', 6, ''] } },
  { name: 'Landmine Press', pattern: 'push_v', eq: ['barbell'], goals: ['strength', 'health', 'exit_velo'], avoid: [], schemes: { strength: ['3', '8', 8, 'Each arm — shoulder-friendly pressing'], power: ['3', '8', 8, 'Each arm'], speed: ['3', '5', 7, 'Each arm, fast'], health: ['3', '10', 6, 'Each arm'] } },
  { name: 'Push Press', pattern: 'push_v', eq: ['barbell'], goals: ['explosive'], avoid: ['shoulder', 'back'], schemes: { strength: ['4', '5', 8, 'Leg drive'], power: ['4', '5', 8, ''], speed: ['5', '3', 7, 'Max intent'], health: ['3', '6', 6, 'Light'] } },
  // --- Horizontal pull ---
  { name: 'Bent-Over Row', pattern: 'pull_h', eq: ['barbell'], goals: ['strength', 'balanced'], avoid: ['back'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '8', 8, ''], speed: ['4', '6', 7, 'Explode'], health: ['3', '10', 6, 'Chest-supported if back cranky'] } },
  { name: 'DB Row', pattern: 'pull_h', eq: ['dumbbell', 'bench'], goals: ['strength', 'exit_velo', 'balanced'], avoid: [], schemes: { strength: ['4', '8', 8, 'Each arm'], power: ['4', '8', 8, 'Each arm'], speed: ['4', '6', 7, 'Each arm, fast'], health: ['3', '10', 6, 'Each arm'] } },
  { name: 'Cable Row', pattern: 'pull_h', eq: ['cables'], goals: ['strength', 'health'], avoid: [], schemes: { strength: ['4', '10', 8, ''], power: ['4', '10', 8, ''], speed: ['4', '8', 7, ''], health: ['3', '12', 6, ''] } },
  { name: 'Inverted Row', pattern: 'pull_h', eq: ['rack'], goals: ['health', 'balanced'], avoid: [], schemes: { strength: ['3', '10', 8, 'Bar at waist height'], power: ['3', '10', 8, ''], speed: ['3', '8', 7, ''], health: ['3', '10', 6, ''] } },
  // --- Vertical pull ---
  { name: 'Pull-Up', pattern: 'pull_v', eq: ['pullup'], goals: ['strength', 'exit_velo', 'balanced'], avoid: ['shoulder', 'elbow'], schemes: { strength: ['4', '6', 8, 'Band-assist if needed'], power: ['4', '5', 8, ''], speed: ['4', '4', 7, 'Explode up'], health: ['3', '6', 6, ''] } },
  { name: 'Chin-Up', pattern: 'pull_v', eq: ['pullup'], goals: ['strength', 'balanced'], avoid: ['elbow'], schemes: { strength: ['4', '6', 8, ''], power: ['4', '5', 8, ''], speed: ['4', '4', 7, ''], health: ['3', '6', 6, ''] } },
  { name: 'Lat Pulldown', pattern: 'pull_v', eq: ['cables'], goals: ['strength', 'health'], avoid: ['shoulder'], schemes: { strength: ['4', '8', 8, ''], power: ['4', '8', 8, ''], speed: ['4', '6', 7, ''], health: ['3', '10', 6, ''] } },
  { name: 'Band Pull-Apart', pattern: 'pull_h', eq: ['bands'], goals: ['health', 'balanced'], avoid: [], schemes: { strength: ['3', '15', 7, 'Shoulder health'], power: ['3', '15', 7, ''], speed: ['3', '12', 7, ''], health: ['3', '15', 6, ''] } },
  { name: 'Face Pull', pattern: 'pull_h', eq: ['cables'], goals: ['health'], avoid: [], schemes: { strength: ['3', '12', 7, ''], power: ['3', '12', 7, ''], speed: ['3', '12', 7, ''], health: ['3', '15', 6, ''] } },
  // --- Core ---
  { name: 'Pallof Press', pattern: 'core', eq: ['cables'], goals: ['exit_velo', 'health', 'balanced'], avoid: [], schemes: { strength: ['3', '10', 7, 'Each side — anti-rotation'], power: ['3', '8', 8, 'Each side, 3-sec hold'], speed: ['3', '8', 7, 'Each side'], health: ['3', '10', 6, 'Each side'] } },
  { name: 'Pallof Press', pattern: 'core', eq: ['bands'], goals: ['exit_velo', 'health', 'balanced'], avoid: [], schemes: { strength: ['3', '10', 7, 'Each side — anti-rotation'], power: ['3', '8', 8, 'Each side, 3-sec hold'], speed: ['3', '8', 7, 'Each side'], health: ['3', '10', 6, 'Each side'] } },
  { name: 'Dead Bug', pattern: 'core', eq: [], goals: ['health', 'balanced'], avoid: ['back'], schemes: { strength: ['3', '10', 6, 'Each side, slow'], power: ['3', '10', 6, 'Each side'], speed: ['3', '10', 6, 'Each side'], health: ['3', '10', 6, 'Each side'] } },
  { name: 'Ab Wheel Rollout', pattern: 'core', eq: [], goals: ['strength'], avoid: ['back', 'shoulder'], schemes: { strength: ['3', '10', 8, ''], power: ['3', '8', 8, ''], speed: ['3', '8', 7, ''], health: ['3', '8', 6, 'Short range'] } },
  { name: 'Side Plank', pattern: 'core', eq: [], goals: ['health', 'balanced'], avoid: [], schemes: { strength: ['3', '30s', 7, 'Each side'], power: ['3', '30s', 7, 'Each side'], speed: ['3', '30s', 7, 'Each side'], health: ['3', '30s', 6, 'Each side'] } },
  // --- Rotational / med ball ---
  { name: 'Med Ball Rotational Throw', pattern: 'rotational', eq: ['medball'], goals: ['exit_velo', 'explosive', 'balanced'], avoid: [], schemes: { strength: ['3', '6', 8, 'Each side — throw it like a swing'], power: ['4', '5', 9, 'Each side, max intent'], speed: ['4', '4', 8, 'Each side, max intent'], health: ['3', '6', 7, 'Each side, smooth'] } },
  { name: 'Med Ball Chest Pass', pattern: 'rotational', eq: ['medball'], goals: ['exit_velo', 'explosive'], avoid: ['shoulder'], schemes: { strength: ['3', '8', 8, ''], power: ['4', '6', 9, 'Max intent'], speed: ['4', '5', 8, 'Max intent'], health: ['3', '8', 6, ''] } },
  { name: 'Med Ball Slam', pattern: 'rotational', eq: ['medball'], goals: ['explosive', 'exit_velo'], avoid: ['shoulder', 'back'], schemes: { strength: ['3', '8', 8, ''], power: ['4', '6', 9, 'Max intent'], speed: ['4', '5', 8, 'Max intent'], health: ['3', '8', 6, 'Light ball'] } },
  { name: 'Med Ball Overhead Throw', pattern: 'rotational', eq: ['medball'], goals: ['explosive'], avoid: ['shoulder', 'back'], schemes: { strength: ['3', '6', 8, ''], power: ['4', '5', 9, 'Max intent'], speed: ['4', '4', 8, 'Max intent'], health: ['3', '6', 6, ''] } },
  { name: 'Rotational Jump', pattern: 'rotational', eq: [], goals: ['explosive', 'exit_velo'], avoid: ['knee', 'ankle'], schemes: { strength: ['3', '4', 7, 'Each side — no-ball rotational power sub'], power: ['4', '4', 8, 'Each side'], speed: ['4', '4', 8, 'Each side'], health: ['3', '4', 6, 'Each side, easy'] } },
  { name: 'DB Trunk Rotation', pattern: 'rotational', eq: ['dumbbell'], goals: ['exit_velo', 'balanced'], avoid: [], schemes: { strength: ['3', '10', 7, 'Each side — hips do the work'], power: ['3', '8', 8, 'Each side, fast'], speed: ['3', '8', 7, 'Each side'], health: ['3', '10', 6, 'Each side, smooth'] } },
  { name: 'Banded Rotation', pattern: 'rotational', eq: ['bands'], goals: ['exit_velo', 'balanced'], avoid: [], schemes: { strength: ['3', '10', 7, 'Each side — anti-rotation + rotation'], power: ['3', '8', 8, 'Each side, fast'], speed: ['3', '8', 7, 'Each side'], health: ['3', '10', 6, 'Each side, smooth'] } },
  // --- Jumps ---
  { name: 'Box Jump', pattern: 'jump', eq: ['box'], goals: ['explosive', 'exit_velo'], avoid: ['knee', 'ankle'], schemes: { strength: ['4', '3', 7, 'Stick the landing'], power: ['4', '3', 8, ''], speed: ['5', '3', 8, 'Max height, full rest'], health: ['3', '3', 6, 'Low box'] } },
  { name: 'Broad Jump', pattern: 'jump', eq: [], goals: ['explosive', 'exit_velo', 'balanced'], avoid: ['knee', 'ankle'], schemes: { strength: ['4', '3', 7, 'Stick the landing'], power: ['4', '3', 8, ''], speed: ['5', '3', 8, 'Max distance, full rest'], health: ['3', '3', 6, 'Sub-max'] } },
  { name: 'Jump Squat', pattern: 'jump', eq: [], goals: ['explosive'], avoid: ['knee', 'ankle', 'back'], schemes: { strength: ['4', '5', 7, ''], power: ['4', '5', 8, ''], speed: ['5', '3', 8, 'Max intent, stop when speed drops'], health: ['3', '5', 6, ''] } },
  { name: 'DB Jump Squat', pattern: 'jump', eq: ['dumbbell'], goals: ['explosive', 'exit_velo'], avoid: ['knee', 'ankle', 'back'], schemes: { strength: ['4', '5', 7, 'Light DBs'], power: ['4', '5', 8, ''], speed: ['5', '3', 8, 'Max intent'], health: ['3', '5', 6, ''] } },
  // --- Carry ---
  { name: "Farmer's Carry", pattern: 'carry', eq: ['dumbbell'], goals: ['strength', 'health', 'balanced'], avoid: [], schemes: { strength: ['3', '40 yd', 8, 'Heavy'], power: ['3', '40 yd', 8, ''], speed: ['3', '30 yd', 7, ''], health: ['3', '40 yd', 6, ''] } },
  { name: "Farmer's Carry", pattern: 'carry', eq: ['trapbar'], goals: ['strength'], avoid: [], schemes: { strength: ['3', '40 yd', 8, 'Heavy'], power: ['3', '40 yd', 8, ''], speed: ['3', '30 yd', 7, ''], health: ['3', '40 yd', 6, ''] } },
  // --- Isometrics (produce phase) ---
  { name: 'Iso Split Squat Hold', pattern: 'iso', eq: [], goals: ['strength', 'exit_velo', 'health'], avoid: ['knee'], schemes: { strength: ['3', '20s', 8, 'Each leg — max intent'], power: ['4', '10s', 9, 'Each leg — MAX intent'], speed: ['3', '10s', 7, 'Each leg'], health: ['3', '20s', 6, 'Each leg'] } },
  { name: 'Iso Push-Up Hold', pattern: 'iso', eq: [], goals: ['strength', 'health'], avoid: ['shoulder', 'elbow'], schemes: { strength: ['3', '20s', 8, 'Bottom position'], power: ['4', '10s', 9, 'MAX intent'], speed: ['3', '10s', 7, ''], health: ['3', '15s', 6, ''] } },
  { name: 'Lead Arm Iso Pull', pattern: 'iso', eq: ['bands'], goals: ['exit_velo'], avoid: ['shoulder', 'elbow'], schemes: { strength: ['3', '8s', 8, 'Each arm — rotational pulling strength'], power: ['4', '6s', 9, 'Each arm, MAX intent'], speed: ['3', '6s', 7, 'Each arm'], health: ['3', '8s', 6, 'Each arm, easy'] } },
];
// Global name → pool entry index (powers athlete self-substitution).
const EXERCISE_INDEX = {};
for (const ex of LIFT_POOL) EXERCISE_INDEX[ex.name.toLowerCase()] = ex;

// Injury keyword → avoided pool entries (matched by name keyword or avoid tag).
const INJURY_RULES = [
  { keys: ['shoulder', 'rotator'], avoidNames: ['Overhead Press', 'DB Overhead Press', 'Push Press', 'Med Ball Overhead Throw', 'Med Ball Slam'], note: 'shoulder — no overhead work' },
  { keys: ['elbow', 'tommy john', 'ucl'], avoidNames: ['Overhead Press', 'Push Press', 'Pull-Up'], note: 'elbow — limited overhead/pull volume' },
  { keys: ['back', 'spine', 'lumbar', 'disc', 'herniat'], avoidNames: ['Back Squat', 'Front Squat', 'Conventional', 'Hang Clean', 'Bent-Over Row'], note: 'back — no axial loading' },
  { keys: ['knee', 'acl', 'mcl', 'meniscus', 'patella'], avoidNames: ['Back Squat', 'Front Squat', 'Box Jump', 'Jump Squat', 'DB Jump Squat', 'Broad Jump', 'Rotational Jump'], note: 'knee — no deep loaded knee flexion or jumping' },
  { keys: ['wrist', 'hand'], avoidNames: ['Front Squat', 'Hang Clean'], note: 'wrist — no front-rack/catch positions' },
  { keys: ['hip', 'labrum'], avoidNames: ['Back Squat', 'Lateral Lunge'], note: 'hip — limited deep hip flexion' },
  { keys: ['ankle', 'achilles'], avoidNames: ['Box Jump', 'Jump Squat', 'DB Jump Squat', 'Broad Jump'], note: 'ankle — no jumping' },
];
function injuryKeys(a) {
  const text = [a.injury_area, a.injury_current, a.pain_now, a.injury_past].join(' ').toLowerCase();
  const hits = [];
  for (const r of INJURY_RULES) {
    if (r.keys.some((k) => text.includes(k))) hits.push(r);
  }
  return hits;
}
function isAvoided(ex, rules) {
  if (!rules.length) return null;
  for (const r of rules) {
    if ((ex.avoid || []).some((t) => r.keys.some((k) => t.includes(k)))) return r;
    if (r.avoidNames.some((n) => ex.name.toLowerCase().includes(n.toLowerCase()))) return r;
  }
  return null;
}
// Pick the best pool entry for a movement pattern: fits equipment, not avoided
// by injuries, matches goal track when possible. Falls back across the pool so
// a missing piece of equipment substitutes the pattern instead of dropping it.
function pickExercise(pattern, tags, rules, track, usedNames, gaps) {
  const cands = LIFT_POOL.filter((e) => e.pattern === pattern && !usedNames.has(e.name));
  const ok = cands.filter((e) => fitsEq(e, tags) && !isAvoided(e, rules));
  const scored = ok
    .map((e) => ({ e, score: (e.goals.includes(track) ? 2 : 0) + (e.goals.includes('balanced') ? 1 : 0) }))
    .sort((x, y) => y.score - x.score);
  if (scored.length) return { ex: scored[0].e, sub: null };
  // Nothing clean fits. If injuries are in play, NEVER auto-assign an
  // injury-conflicting movement — return null so the caller keeps the
  // original and flags it for the coach. Unsafe work is never assigned
  // automatically (Sep 23 2026).
  if (rules.length) {
    if (gaps && !gaps.includes(pattern)) gaps.push(pattern);
    return { ex: null, sub: `NO SAFE ${pattern.toUpperCase()} OPTION with his equipment/injury — coach must pick` };
  }
  // No injuries — report the gap, try ANYTHING in the pattern (coach decides).
  const anyFit = cands.filter((e) => fitsEq(e, tags));
  if (anyFit.length) {
    const e = anyFit[0];
    return { ex: e, sub: `Only option for ${pattern} with his equipment is ${e.name} — review` };
  }
  if (gaps && !gaps.includes(pattern)) gaps.push(pattern);
  // Last resort: bodyweight-only entry in the pattern.
  const bw = cands.find((e) => (e.eq || []).length === 0);
  return { ex: bw || null, sub: bw ? null : `NO ${pattern.toUpperCase()} OPTION with his equipment` };
}

// ---- Questionnaire-driven lifting personalization (Sep 23 2026, Bobby) ----
// "That's the whole premise" — assigning a template to an athlete must build
// HIS copy from HIS intake questionnaire, not hand everyone the same sheet.
// The v4 Different Animal templates are the framework (session order, block
// identity, contrast pairings); this layer adapts the copy at assign time:
//   1. Equipment — anything he doesn't have gets swapped for the same
//      movement pattern that fits what he does have.
//   2. Injuries — anything his injury answers flag gets swapped for a
//      same-pattern alternative that avoids it.
//   3. Experience — beginners get RPE targets eased a point.
// Every swap is recorded in the program notes so Bobby reviews it in the
// editor. Athletes with no intake answers get the template verbatim.
// Metadata for the v4 template exercise names: pattern (LIFT_POOL pattern,
// or 'speed'/'mobility' which have no substitutes), eq (required equipment
// tags), avoid (injury keys, same vocabulary as LIFT_POOL entries).
const V4_EXERCISE_META = {
  'mb shot-put throw':        { pattern: 'rotational', eq: ['medball'], avoid: [] },
  'plyo push-up':             { pattern: 'push_h', eq: [], avoid: [] },
  'db bench press':           { pattern: 'push_h', eq: ['dumbbell', 'bench'], avoid: [] },
  'db single-arm row':        { pattern: 'pull_h', eq: ['dumbbell'], avoid: [] },
  'cable rotation':           { pattern: 'rotational', eq: ['cables'], avoid: [] },
  'pallof press':             { pattern: 'core', eq: ['cables'], avoid: [] },
  '10-yard sprint':           { pattern: 'speed', eq: ['field'], avoid: [] },
  'trap-bar jump':            { pattern: 'jump', eq: ['trapbar'], avoid: [] },
  'trap-bar deadlift':        { pattern: 'hinge', eq: ['trapbar'], avoid: ['back'] },
  'nordic curl':              { pattern: 'hinge', eq: [], avoid: ['knee'] },
  'lateral box squat':        { pattern: 'squat', eq: ['barbell', 'rack', 'box'], avoid: ['knee'] },
  'mb rotational throw':      { pattern: 'rotational', eq: ['medball'], avoid: [] },
  'single-arm landmine press':{ pattern: 'push_v', eq: ['barbell'], avoid: ['shoulder'] },
  'db shoulder press':        { pattern: 'push_v', eq: ['dumbbell'], avoid: ['shoulder'] },
  'db rear-lateral raise':    { pattern: 'pull_h', eq: ['dumbbell'], avoid: [] },
  'pallof hold':              { pattern: 'core', eq: ['cables'], avoid: [] },
  'drop-catch split jump':    { pattern: 'jump', eq: [], avoid: ['knee', 'ankle'] },
  'split-squat iso pull':     { pattern: 'iso', eq: ['bands'], avoid: [] },
  'bulgarian split squat':    { pattern: 'unilateral', eq: ['dumbbell', 'bench'], avoid: ['knee', 'hip'] },
  'pin split squat':          { pattern: 'unilateral', eq: ['barbell', 'rack'], avoid: ['knee'] },
  'db trunk rotation':        { pattern: 'rotational', eq: ['dumbbell'], avoid: [] },
  'bear crawl':               { pattern: 'core', eq: [], avoid: ['wrist'] },
  'cossack squat':            { pattern: 'unilateral', eq: [], avoid: ['knee', 'hip'] },
  'hamstring bridge iso':     { pattern: 'iso', eq: [], avoid: [] },
  'curved sprint':            { pattern: 'speed', eq: ['field'], avoid: [] },
  'ity':                      { pattern: 'pull_h', eq: ['dumbbell'], avoid: [] },
  'deep-range pullover':      { pattern: 'pull_v', eq: ['dumbbell'], avoid: ['shoulder'] },
  'rack-elevated deadlift':   { pattern: 'hinge', eq: ['barbell', 'rack'], avoid: ['back'] },
  'face pull':                { pattern: 'pull_h', eq: ['cables'], avoid: [] },
  'banded alternate jumps':   { pattern: 'jump', eq: ['bands'], avoid: ['knee', 'ankle'] },
  'mb step-back toss':        { pattern: 'rotational', eq: ['medball'], avoid: [] },
  'goblet squat':             { pattern: 'squat', eq: ['dumbbell'], avoid: ['knee'] },
  't-spine mobility':         { pattern: 'mobility', eq: [], avoid: [] },
  'hip cars':                 { pattern: 'mobility', eq: [], avoid: [] },
  'split squat':              { pattern: 'unilateral', eq: [], avoid: ['knee'] },
  'pin squat':                { pattern: 'squat', eq: ['barbell', 'rack'], avoid: ['back', 'knee'] },
  'push press':               { pattern: 'push_v', eq: ['barbell'], avoid: ['shoulder', 'elbow'] },
  'bench press':              { pattern: 'push_h', eq: ['barbell', 'bench', 'rack'], avoid: [] },
  'broad jump':               { pattern: 'jump', eq: [], avoid: ['knee', 'ankle'] },
};
// Personalize a template's days for one athlete from his intake answers.
// Returns { days, personalization_notes } where personalization_notes is a
// list of human-readable swap lines shown ONLY in the coach editor (the
// athlete never sees them). The input days array is deep-copied and never
// mutated.
function personalizeLiftingDays(days, answers, athleteName) {
  const a = answers || {};
  const tags = equipmentTags(a);
  const rules = injuryKeys(a);
  const track = goalTrack(a);
  const beginner = /never lifted|beginner/i.test(String(a.lifting_experience || ''));
  const out = JSON.parse(JSON.stringify(days || []));
  const swapLines = [];
  const gaps = [];
  const ARRAYS = ['speed', 'medball', 'exercises'];
  for (const day of out) {
    // usedNames: original case for pickExercise; usedLower: lowercase for our
    // own bookkeeping (v4 names and pool names differ in case).
    const usedNames = new Set();
    const usedLower = new Set();
    for (const key of ARRAYS) for (const it of (day[key] || [])) {
      if (it && it.name) { usedNames.add(String(it.name)); usedLower.add(String(it.name).toLowerCase()); }
    }
    for (const key of ARRAYS) for (const it of (day[key] || [])) {
      if (!it || !it.name) continue;
      if (beginner && it.target_rpe !== '' && it.target_rpe != null && it.sets) {
        const rpe0 = Number(it.target_rpe);
        if (!Number.isNaN(rpe0) && rpe0 > 6) it.target_rpe = rpe0 - 1;
      }
      const meta = V4_EXERCISE_META[String(it.name).toLowerCase()];
      if (!meta) continue; // unknown exercise — leave untouched
      const missing = (meta.eq || []).filter((t) => !tags.has(t));
      const avoided = isAvoided({ name: it.name, avoid: meta.avoid }, rules);
      const needSwap = missing.length > 0 || !!avoided;
      const reason = missing.length ? ('no ' + missing.join('/') + ' in his setup') : ((avoided && avoided.note) || 'injury flag');
      if (needSwap && (meta.pattern === 'speed' || meta.pattern === 'mobility')) {
        // No substitutes exist for these patterns — HOLD for coach review.
        // The athlete never sees or executes the original; Bobby picks a
        // safe replacement in the editor before it's released.
        it.held = true;
        it.held_original = it.name;
        it.held_reason = `${reason} — no substitute exists for this pattern`;
        it.notes = '';
        swapLines.push(`${it.name} — HELD for coach (${it.held_reason})`);
        continue;
      }
      if (needSwap) {
        const picked = pickExercise(meta.pattern, tags, rules, track, usedNames, gaps);
        if (picked && picked.ex && !usedLower.has(picked.ex.name.toLowerCase())) {
          const orig = it.name;
          usedNames.delete(orig); usedLower.delete(orig.toLowerCase());
          usedNames.add(picked.ex.name); usedLower.add(picked.ex.name.toLowerCase());
          it.name = picked.ex.name;
          it.vkey = ''; // pool entries carry no video — never show the wrong demo
          it.notes = (it.notes ? it.notes + ' ' : '') + `[Swapped from ${orig} — ${reason}]`;
          swapLines.push(`${orig} → ${picked.ex.name} (${reason})${picked.sub ? ' — ' + picked.sub : ''}`);
        } else {
          // Nothing clean left in this pattern (or only a duplicate) — HOLD
          // for coach review. The athlete never sees or executes the
          // original; Bobby picks a safe replacement in the editor.
          it.held = true;
          it.held_original = it.name;
          it.held_reason = `${reason} — ${(picked && picked.sub) || 'no clean substitute'}`;
          it.notes = '';
          swapLines.push(`${it.name} — HELD for coach (${it.held_reason})`);
        }
        continue;
      }
    }
  }
  for (const g of gaps) swapLines.push(`No ${g} option fits his equipment — coach to fill`);
  const notes = [];
  if (swapLines.length || beginner) {
    notes.push(`Personalized from ${athleteName || 'athlete'}'s questionnaire${beginner ? ' (beginner: RPE eased 1 pt)' : ''}:`);
    for (const l of swapLines) notes.push('• ' + l);
  }
  // Coach-facing only — the editor shows these; athlete pages never do.
  return { days: out, personalization_notes: notes };
}

// Warm-up philosophy (Bobby's call, Sep 2026): ONE integrated warm-up per
// session — general movement + baseball mobility (hips, t-spine, shoulders,
// ankles) + hitting prep, run at session start. That IS the Mobility tab.
// Athletes hit first then lift (app order), so they arrive at med ball /
// lifting already warm — a second full warm-up is dead time they'd skip.
// On lifting-only days, the full Mobility tab runs before lifting.
// Heavy lifts don't get a separate warm-up routine either: ramp-up sets are
// baked into each main lift below.
function rampNote(ex) {
  const eq = ex.eq || [];
  if (eq.includes('barbell')) return 'Ramp: bar x10 → 50% x8 → 70% x5 → work sets';
  if (eq.includes('dumbbell') || eq.includes('kettlebell')) return 'Ramp: 1 light set x12 → 1 medium set x8 → work sets';
  return 'Ramp: 1 easy set x10 → work sets';
}
// Baseball mobility template (Sep 2026): rotational-athlete mobility, not
// generic. Hips / t-spine / shoulders / ankles — the baseball kinetic chain.
const MOBILITY_TEMPLATE = [
  { section: 'Hips', items: [
    ['90/90 Hip Switches', '8 each side'], ['Pigeon Stretch', '45 sec each side'],
    ['Half-Kneeling Hip Flexor Stretch', '30 sec each side'], ['Deep Squat Hold w/ Elbow Press', '30 sec'],
  ]},
  { section: 'T-Spine (rotation)', items: [
    ['Open Books', '8 each side'], ['Quadruped Thoracic Rotations', '8 each side'],
    ['Cat-Cow', '10'], ['Thread the Needle', '6 each side'],
  ]},
  { section: 'Shoulders', items: [
    ['Sleeper Stretch', '30 sec each side'], ['Cross-Body Shoulder Stretch', '30 sec each side'],
    ['Wall Slides', '10'], ['Band Pull-Aparts', '15'],
  ]},
  { section: 'Ankles', items: [
    ['Knee-to-Wall', '10 each side'], ['Half-Kneeling Calf Stretch', '30 sec each side'],
    ['Ankle Circles', '10 each direction'],
  ]},
];
// Bobby's exact registry drill names (Sep 2026) so his YouTube links attach
// by exact match. Only drills with a Bobby-specified video belong here —
// no guessing, no placeholders.
const MEDBALL_TEMPLATE = [
  ['Med Ball Rotational Slam', '3 x 6 each side', 'Throw it like a swing — rotate and transfer'],
  ['Med Ball Scoop Toss', '3 x 8', 'Load the hips, explode through'],
];
const METABOLIC_TEMPLATE = [
  ['Build-Up Sprints', '6 x 40 yd', 'Walk back recovery', ['field']],
  ['Tempo Runs', '8 x 100 yd @ 70%', 'Jog back recovery', ['field']],
  ['Jump Rope Intervals', '8 x 1 min on / 30 sec off', '', ['rope']],
  ['Bike Intervals', '8 x 30 sec hard / 90 sec easy', '', []],
];
function mobilityBlocks(tags) {
  return MOBILITY_TEMPLATE.map((sec) => ({
    category: 'Mobility — ' + sec.section,
    items: sec.items
      .filter(([name]) => name !== 'Band Pull-Aparts' || tags.has('bands'))
      .map(([drill, volume]) => ({ drill, volume })),
  }));
}
function medballBlocks(tags) {
  if (!tags.has('medball')) {
    return [{ category: 'Med Ball', items: [
      { drill: 'Rotational Jump', volume: '4 x 4 each side', notes: 'No med ball available — rotational power without the ball' },
      { drill: 'Broad Jump', volume: '4 x 3', notes: 'Stick the landing' },
    ]}];
  }
  return [{ category: 'Med Ball', items: MEDBALL_TEMPLATE.map(([drill, volume, notes]) => ({ drill, volume, notes })) }];
}
function metabolicBlocks(tags) {
  const items = METABOLIC_TEMPLATE.filter(([, , , eq]) => (eq || []).every((t) => tags.has(t)))
    .map(([drill, volume, notes]) => ({ drill, volume, notes }));
  if (!items.length) items.push({ drill: 'Bodyweight Circuit', volume: '4 rounds', notes: 'Jumping jacks 30s / push-ups 10 / squats 15 / rest 1 min — no equipment needed' });
  return [{ category: 'Metabolic', items }];
}
// Goal track from questionnaire answers.
function goalTrack(a) {
  const g = (a.goals || []).map((x) => String(x).toLowerCase());
  if (a.strong_not_explosive || g.some((x) => x.includes('explosive')) ) return 'explosive';
  if (g.some((x) => x.includes('exit') || x.includes('velo'))) return 'exit_velo';
  if (g.some((x) => x.includes('strong'))) return 'strength';
  if (g.some((x) => x.includes('health') || x.includes('stay healthy'))) return 'health';
  if (g[0]) return 'balanced';
  return 'balanced';
}
// Full lifting draft: goal arc + season + equipment + injuries + warm-ups.
// opts: { blockIndex (0-based), progression (progressionRead output or null) }
function buildLiftingDraft(a, opts) {
  const o = opts || {};
  const track = goalTrack(a);
  const arc = GOAL_BLOCK_ARCS[track] || GOAL_BLOCK_ARCS.balanced;
  const step = arc[Math.min(o.blockIndex || 0, arc.length - 1)];
  let emphasis = step.emphasis; // strength | power | speed | health
  const tags = equipmentTags(a);
  const rules = injuryKeys(a);
  const season = a.season_phase || 'offseason';
  const subs = [];   // flagged substitutions for Bobby
  const gaps = [];   // equipment gaps for Bobby
  // Pre-season biases toward the express end (potentiation, not building).
  if (season === 'preseason' && emphasis === 'strength') emphasis = 'power';
  const inSeason = season === 'inseason';
  const n = inSeason ? 2 : Math.min(6, Math.max(2, a.lift_days_per_week || 4));
  const beginner = /never lifted|beginner/i.test(String(a.lifting_experience || ''));
  const used = new Set();
  const mk = (pickRes, kind) => {
    const e = pickRes.ex;
    if (!e) return null;
    if (pickRes.sub) subs.push(pickRes.sub);
    used.add(e.name);
    const sc = e.schemes[emphasis] || e.schemes.strength;
    const extra = [];
    if (kind === 'contrast') extra.push('CONTRAST: do the hold, then throw IMMEDIATELY');
    // Main lifts carry their own ramp-up — that's the warm-up for heavy work.
    if (kind === 'main') extra.push(rampNote(e));
    // Beginners ease in: RPE down a point so the first block is learnable.
    let rpe = sc[2] || '';
    if (beginner && typeof rpe === 'number' && rpe > 6) rpe = rpe - 1;
    return {
      name: e.name, sets: sc[0], reps: sc[1],
      target_rpe: rpe,
      notes: [sc[3], ...extra].filter(Boolean).join(' · ').slice(0, 220),
    };
  };
  const days = [];
  const buildDay = (label, plan) => {
    const exs = [];
    for (const [pattern, kind] of plan) {
      const r = pickExercise(pattern, tags, rules, track, used, gaps);
      if (!r.ex) { subs.push(`No ${pattern} option with his equipment — pattern skipped`); continue; }
      const ex = mk(r, kind);
      if (ex) exs.push(ex);
    }
    return { label, exercises: exs };
  };
  if (n <= 3 || inSeason) {
    // Full-body A/B (also the in-season maintenance format: 2x, short).
    const plans = [
      ['Full Body A', [['rotational', 'power'], ['squat', 'main'], ['push_h', 'main'], ['pull_h', 'acc'], ['core', 'acc']]],
      ['Full Body B', [['jump', 'power'], ['hinge', 'main'], ['pull_v', 'main'], ['push_v', 'acc'], ['carry', 'acc']]],
    ];
    for (let i = 0; i < n; i++) {
      const [label, plan] = plans[i % 2];
      const d = buildDay(label + (inSeason ? ' (in-season maintenance)' : ''), plan);
      if (inSeason) d.exercises = d.exercises.slice(0, 4);
      days.push(d);
    }
  } else {
    // Kelly's 4-day offseason split (evidenced from @kelly.training, all 404 reels).
    // Day 4 = Unilateral Lower ALONE ON PURPOSE: "every swing, every sprint, every
    // throw happens from a single-leg stance. If you never train that leg alone under
    // heavy load, you are leaving the most important position in the game completely untrained."
    // Session order every day: power (rotational/jump, max intent) -> strength mains ->
    // rotational accessories -> brakes. (Jenkins/Miller: trap-bar jumps @50% BW, drop-catch
    // split jumps, ISO->explosive potentiation, cable rotations, DB trunk rotations.)
    const plans = [
      ['Upper — Horizontal Press + Vertical Pull', [['rotational', 'power'], ['push_h', 'main'], ['pull_v', 'main'], ['push_h', 'acc'], ['rotational', 'acc']]],
      ['Lower — Bilateral', [['jump', 'power'], ['squat', 'main'], ['hinge', 'main'], ['unilateral', 'acc'], ['core', 'acc']]],
      ['Upper — Horizontal Pull + Vertical Press', [['rotational', 'power'], ['pull_h', 'main'], ['push_v', 'main'], ['pull_h', 'acc'], ['core', 'acc']]],
      ['Lower — Unilateral (single-leg stance)', [['jump', 'power'], ['unilateral', 'main'], ['unilateral', 'main'], ['hinge', 'acc'], ['core', 'acc']]],
    ];
    for (let i = 0; i < n; i++) {
      const [label, plan] = plans[i % plans.length];
      days.push(buildDay(i >= 4 ? label + ' (wk2)' : label, plan));
    }
  }
  const notes = [];
  notes.push(`Goal track: ${track} · Block emphasis: ${step.label}${inSeason ? ' · IN-SEASON: 2x/week maintenance, never bury him' : ''}`);
  notes.push('WARM-UP: one integrated warm-up per session (Mobility tab + hitting prep) at session start. Default order is hitting first — athlete arrives at med ball already warm, goes straight in. If lifting runs first, do the full Mobility tab + the lifting-day primer, then med ball. Main lifts carry their own ramp-up sets — those are essential, not optional.');
  if (season === 'preseason') notes.push('Pre-season: potentiation style — long rest, quality over fatigue.');
  // Coach-facing only (Sep 23 2026): shown in the coach editor, never to athletes.
  const personalization_notes = ['Built from his intake questionnaire:'];
  if (beginner) personalization_notes.push('• Beginner: RPE eased 1 pt across the board.');
  if (rules.length) personalization_notes.push('• INJURIES: ' + rules.map((r) => r.note).join(' · '));
  if (subs.length) personalization_notes.push('• SUBSTITUTIONS (review): ' + subs.join(' | '));
  if (gaps.length) personalization_notes.push('• EQUIPMENT GAPS — no ' + gaps.join(', ') + ' option with what he has. Consider: ' + gaps.map((g) => ({ squat: 'goblet/box squat or gym access', hinge: 'DB RDLs or trap bar access', push_h: 'push-up progressions or bench access', pull_v: 'a pull-up bar or bands', rotational: 'a med ball (any weight)', jump: 'open floor space' }[g] || 'equipment upgrade')).join('; '));
  if (o.progression && o.progression.adjustments && o.progression.adjustments.length) {
    personalization_notes.push('• PROGRESSION READ: ' + o.progression.adjustments.join(' | '));
  }
  return { days, notes, personalization_notes, draft: true, subs, gaps, track, emphasis, block_index: o.blockIndex || 0, source: 'personalized' };
}
function intakeTokenValid(tok) {
  const cur = getIntakeToken();
  return !!(tok && cur && tok === cur);
}
// Per-lead questionnaire invite (Sep 2026): a token bound to a website-
// application lead. Opening it pre-fills the form from the lead's application.
function intakeInviteFor(tok) {
  if (!tok) return null;
  try { return db.prepare('SELECT * FROM intake_invites WHERE token = ?').get(tok) || null; }
  catch (e) { return null; }
}
function leadPrefillValues(lead) {
  const parts = String((lead && lead.name) || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
    phone: (lead && lead.phone) || '',
    goals_90: (lead && lead.goals) || '',
  };
}

// ---- Progression intelligence (Sep 2026) ----
// When Bobby drafts the NEXT 4-week block, the app reads the athlete's logged
// lifting data (program_checkoffs: weight + RPE per lift per day) and tells him
// what's actually improving vs stalled, then recommends the next block's
// emphasis. Data-driven, not calendar-driven: the goal arc only advances
// toward power/speed once strength is confirmed in the logs.
//
// Bobby approves every next block before it goes live; this read exists to
// make that approval fast and informed. The next-block builder should call
// progressionRead(userId) and attach the result to the draft.

// Multi-block emphasis arc per goal track. Index = 0-based 4-week block; the
// last entry repeats for later blocks. Bobby will send more guidelines — keep
// this table easy to edit.
const GOAL_BLOCK_ARCS = {
  exit_velo: [
    { emphasis: 'strength', label: 'Block 1 — Build the base', detail: 'Absorb → produce: heavy compounds, slow eccentrics, max-effort isometrics. Strength before speed.' },
    { emphasis: 'strength_power', label: 'Block 2 — Strength + intro power', detail: 'Keep the heavy work; layer in contrast pairings and max-intent med ball throws.' },
    { emphasis: 'power', label: 'Block 3+ — Express it fast', detail: 'Move weight fast: jump squats, speed work, rotational power. Strength confirmed in the logs.' },
  ],
  strength: [
    { emphasis: 'strength', label: 'Block 1 — Absorb force', detail: 'Heavy compounds, slow eccentrics (3–5 sec), total control under tension.' },
    { emphasis: 'strength', label: 'Block 2 — Produce force', detail: 'Max-effort isometrics, paused positions, heavy holds. Extend the strength block.' },
    { emphasis: 'strength_power', label: 'Block 3+ — Strength + power', detail: 'Base built; start expressing it fast while keeping one heavy day.' },
  ],
  explosive: [
    { emphasis: 'strength_speed', label: 'Block 1 — A little strength + intro speed', detail: 'One heavy compound day to confirm the base; everything else moves fast.' },
    { emphasis: 'power', label: 'Block 2+ — All speed', detail: 'Jump squats, contrast pairings, max-intent med ball, long rest for quality.' },
    { emphasis: 'power', label: 'Block 3+ — Stay explosive', detail: 'Keep expressing; re-test the heavy lifts monthly to confirm the base holds.' },
  ],
  health: [
    { emphasis: 'health', label: 'Every block — Train, don\'t strain', detail: 'Moderate loads (RPE 6–8), single-leg/multi-plane work, isometrics. Never grind.' },
    { emphasis: 'health', label: 'Every block — Train, don\'t strain', detail: 'Same: consistency beats intensity. Rotate variations, not maxes.' },
  ],
  balanced: [
    { emphasis: 'strength', label: 'Block 1 — Build the base', detail: 'Heavy compounds with control; learn the movements.' },
    { emphasis: 'strength_power', label: 'Block 2 — Strength + power', detail: 'Add explosive work on top of the base.' },
    { emphasis: 'power', label: 'Block 3+ — Express it', detail: 'Shift toward speed as strength is confirmed.' },
  ],
};
const GOAL_TRACK_LABELS = {
  exit_velo: 'Build exit velo',
  strength: 'Get stronger',
  explosive: 'Strong, needs explosiveness',
  health: 'Stay healthy',
  balanced: 'Balanced',
};
const EMPHASIS_LABELS = {
  strength: 'Strength',
  strength_power: 'Strength + power',
  strength_speed: 'Strength + intro speed',
  power: 'Power / speed',
  health: 'Health / maintenance',
};
// How "power-oriented" an emphasis is; the arc only moves up this ladder when
// the logs confirm strength. A stall steps back down one rung.
const EMPHASIS_RANK = { health: 0, strength: 1, strength_speed: 2, strength_power: 2, power: 3 };
const EMPHASIS_STEP_BACK = { power: 'strength_power', strength_power: 'strength', strength_speed: 'strength' };

// Estimated 1RM from a logged set via Epley, using RPE as reps-in-reserve.
// Falls back to RPE 8 when the athlete logged weight without an RPE.
function estimated1RM(weight, rpe) {
  const w = Number(weight);
  if (!(w > 0)) return null;
  let r = parseInt(rpe, 10);
  if (!(r >= 1 && r <= 10)) r = 8;
  return w * (1 + (10 - r) / 30);
}
function liftNameFromKey(itemKey) {
  const m = String(itemKey || '').match(/^lift::(?:[^:]+)::(.+)$/);
  return (m ? m[1] : String(itemKey || '')).trim();
}
// Per-lift progression from the logs: improving / stalled / regressing /
// holding / new. Compares mean estimated-1RM of the earliest sessions vs the
// most recent sessions; a lift is "stalled" when it hasn't moved in 3+ weeks
// of regular logging (Bobby's flag-for-review rule).
function analyzeLiftProgression(userId) {
  const keys = db
    .prepare(
      `SELECT DISTINCT item_key FROM program_checkoffs
       WHERE user_id = ? AND kind = 'lift' AND weight IS NOT NULL AND weight > 0`
    )
    .all(userId)
    .map((r) => r.item_key);
  const out = [];
  for (const key of keys) {
    const logs = db
      .prepare(
        `SELECT day, weight, rpe FROM program_checkoffs
         WHERE user_id = ? AND kind = 'lift' AND item_key = ? AND weight IS NOT NULL AND weight > 0
         ORDER BY day ASC, id ASC`
      )
      .all(userId, key);
    if (!logs.length) continue;
    const name = liftNameFromKey(key) || key;
    const pts = logs.map((l) => ({ day: l.day, e1: estimated1RM(l.weight, l.rpe), w: Number(l.weight) }));
    const mean = (a) => a.reduce((s, p) => s + p.e1, 0) / a.length;
    // Few sessions: compare first vs last directly. Enough history: compare
    // means of the first three vs the last three to smooth daily noise.
    const head = pts.length >= 6 ? pts.slice(0, 3) : pts.slice(0, 1);
    const tail = pts.length >= 6 ? pts.slice(-3) : pts.slice(-1);
    const e1First = mean(head);
    const e1Last = mean(tail);
    const pct = e1First > 0 ? ((e1Last - e1First) / e1First) * 100 : 0;
    const spanDays = Math.round(
      (new Date(pts[pts.length - 1].day + 'T12:00:00') - new Date(pts[0].day + 'T12:00:00')) / 86400000
    );
    const topWeight = Math.max(...pts.map((p) => p.w));
    let status, detail;
    if (pts.length < 3) {
      status = 'new';
      detail = `${pts.length} log${pts.length === 1 ? '' : 's'} — not enough data yet`;
    } else if (pct >= 2.5) {
      status = 'improving';
      detail = `e1RM ${Math.round(e1First)} → ${Math.round(e1Last)} lbs (${pts.length} sessions, ${spanDays}d)`;
    } else if (pct <= -2.5) {
      status = 'regressing';
      detail = `e1RM ${Math.round(e1First)} → ${Math.round(e1Last)} lbs (${pts.length} sessions, ${spanDays}d) — consider a deload week`;
    } else if (spanDays >= 21 && pts.length >= 4) {
      status = 'stalled';
      detail = `no e1RM change in ${spanDays}d (${pts.length} sessions, top ${topWeight} lbs) — flag for review`;
    } else {
      status = 'holding';
      detail = `flat so far (${pts.length} sessions, ${spanDays}d) — keep watching`;
    }
    out.push({
      name, key, status, detail,
      sessions: pts.length, spanDays,
      pct: Math.round(pct * 10) / 10,
      topWeight,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
// The athlete's goal track, from their questionnaire answers; 'balanced' for
// everyone else (direct signups, pre-questionnaire athletes).
function athleteGoalTrack(userId) {
  try {
    const r = db
      .prepare('SELECT answers_json FROM intake_responses WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId);
    if (r && r.answers_json) {
      const a = JSON.parse(r.answers_json);
      const goals = Array.isArray(a.goals) ? a.goals : [];
      for (const g of ['exit_velo', 'strength', 'explosive', 'health']) {
        if (goals.includes(g)) return g;
      }
    }
  } catch (e) { /* fall through to balanced */ }
  return 'balanced';
}
// 0-based 4-week block index. Uses the program's tracked block_number when
// available; falls back to inferring from training history.
function trainingBlockIndex(userId) {
  try {
    const r = db
      .prepare('SELECT rp.block_number FROM remote_programs rp JOIN users u ON u.remote_program_id = rp.id WHERE u.id = ?')
      .get(userId);
    if (r && r.block_number) return Math.max(0, Number(r.block_number) - 1);
  } catch (e) { /* ignore */ }
  let start = null;
  try {
    const r = db
      .prepare('SELECT MIN(day) AS d FROM program_checkoffs WHERE user_id = ? AND kind = \'lift\'')
      .get(userId);
    if (r && r.d) start = r.d;
  } catch (e) { /* ignore */ }
  if (!start) {
    try {
      const u = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
      if (u && u.created_at) start = String(u.created_at).slice(0, 10);
    } catch (e) { /* ignore */ }
  }
  if (!start) return 0;
  const days = Math.floor((Date.now() - new Date(start + 'T12:00:00').getTime()) / 86400000);
  return Math.max(0, Math.floor(days / 28));
}
// The progression read Bobby sees when drafting/approving the next block:
// what's improving, what's stalled, and how the draft's emphasis adjusted
// because of it. The emphasis follows the data, not just the calendar.
function progressionRead(userId) {
  const lifts = analyzeLiftProgression(userId);
  const improving = lifts.filter((l) => l.status === 'improving');
  const stalled = lifts.filter((l) => l.status === 'stalled' || l.status === 'regressing');
  const track = athleteGoalTrack(userId);
  const arc = GOAL_BLOCK_ARCS[track] || GOAL_BLOCK_ARCS.balanced;
  const blockIndex = trainingBlockIndex(userId);
  const step = arc[Math.min(blockIndex, arc.length - 1)];
  const nextStep = arc[Math.min(blockIndex + 1, arc.length - 1)];
  const adjustments = [];
  let emphasis = step.emphasis;
  if (stalled.length && (EMPHASIS_RANK[emphasis] || 0) >= 2) {
    // Strength not confirmed — step back toward strength, don't advance.
    const held = EMPHASIS_STEP_BACK[emphasis] || 'strength';
    adjustments.push(
      `Holding strength emphasis — ${stalled.map((l) => l.name).join(', ')} ${stalled.length === 1 ? 'is' : 'are'} stalled, so the block does not advance to ${EMPHASIS_LABELS[emphasis].toLowerCase()} yet.`
    );
    emphasis = held;
  } else if (
    improving.length &&
    (EMPHASIS_RANK[nextStep.emphasis] || 0) > (EMPHASIS_RANK[step.emphasis] || 0)
  ) {
    adjustments.push(
      `Strength confirmed in the logs (${improving.map((l) => `${l.name} e1RM +${l.pct}%`).join(', ')}) → next block shifts toward speed: ${nextStep.label}.`
    );
  } else if (improving.length) {
    adjustments.push(
      `Strength confirmed (${improving.map((l) => `${l.name} e1RM +${l.pct}%`).join(', ')}) — arc position: ${step.label}.`
    );
  }
  if (!lifts.length) {
    adjustments.push('No lifting logs yet — drafting from the goal arc only. This read gets smarter as he logs.');
  }
  return {
    track,
    trackLabel: GOAL_TRACK_LABELS[track] || track,
    blockNumber: blockIndex + 1,
    arcStep: step,
    nextStep,
    emphasis,
    emphasisLabel: EMPHASIS_LABELS[emphasis] || emphasis,
    lifts,
    improvingCount: improving.length,
    stalledNames: stalled.map((l) => l.name),
    lines: lifts.map((l) => ({ name: l.name, status: l.status, detail: l.detail })),
    adjustments,
  };
}
// Questionnaire resubmission (Sep 23 2026, Bobby: "that's the whole premise" —
// the program must stay built from the athlete's answers, so when answers
// change the program follows). Safe regeneration: the lifting draft rebuilds
// ONLY when Bobby hasn't hand-customized it (source != 'custom'); the hitting
// program rebuilds ONLY while it's still an intake draft. Custom work is
// never overwritten.
app.get('/questionnaire', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  let answers = {};
  try {
    const r = db.prepare('SELECT answers_json FROM intake_responses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (r && r.answers_json) answers = JSON.parse(r.answers_json) || {};
  } catch (e) { answers = {}; }
  // Carry the account's identity into the form so validation passes.
  if (!answers.first_name) answers.first_name = req.user.firstName || '';
  if (!answers.last_name) answers.last_name = req.user.lastName || '';
  if (!answers.email) answers.email = req.user.email || '';
  res.send(views.intakeFormPage('update', null, answers, { updateMode: true }));
});
app.post('/questionnaire', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const a = parseIntakeBody(req.body);
  // Identity comes from the account, not the form.
  a.first_name = req.user.firstName || a.first_name;
  a.last_name = req.user.lastName || a.last_name;
  a.email = req.user.email || a.email;
  if (!a.components.length) {
    return res.send(views.intakeFormPage('update', 'Pick at least one training component.', req.body, { updateMode: true }));
  }
  const nowIso = new Date().toISOString();
  // intake_responses keeps one current row per athlete (user_id UNIQUE).
  const had = db.prepare('SELECT id FROM intake_responses WHERE user_id = ?').get(req.user.id);
  if (had) {
    db.prepare('UPDATE intake_responses SET answers_json = ?, created_at = ? WHERE user_id = ?').run(JSON.stringify(a), nowIso, req.user.id);
  } else {
    db.prepare('INSERT INTO intake_responses (user_id, answers_json, created_at) VALUES (?, ?, ?)').run(req.user.id, JSON.stringify(a), nowIso);
  }
  const notes = [];
  const p = getProgram(req.user.remoteProgramId);
  if (p) {
    const athleteName = `${a.first_name} ${a.last_name}`.trim() || req.user.athleteName || 'Athlete';
    // Lifting: rebuild the draft unless Bobby customized it by hand.
    try {
      const lrow = db.prepare('SELECT lifting_program_id FROM remote_programs WHERE id = ?').get(p.id);
      const lid = lrow && lrow.lifting_program_id;
      if (lid && a.components.includes('lifting')) {
        const lrec = db.prepare('SELECT program_json FROM lifting_programs WHERE id = ?').get(Number(lid));
        let src = '';
        try { src = String((JSON.parse(lrec.program_json || '{}') || {}).source || ''); } catch (e) {}
        if (src === 'custom') {
          notes.push('Lifting left as your coach built it');
        } else {
          const draft = buildLiftingDraft(a);
          db.prepare('UPDATE lifting_programs SET program_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(draft), nowIso, Number(lid));
          notes.push('Lifting rebuilt from your new answers');
        }
      }
    } catch (e) { /* lifting not ready */ }
    // Hitting program: rebuild only while it's still an intake draft.
    try {
      const prog = p.prog || {};
      if (prog.draft) {
        const rebuilt = buildIntakeProgram(a, athleteName);
        try { videoLinks.attachVideoLinks(rebuilt, videoLinks.getLibraryRows(db)); } catch (e) { /* library not ready */ }
        db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(rebuilt), nowIso, p.id);
        notes.push('Hitting rebuilt from your new answers');
      } else {
        notes.push('Hitting left as your coach built it');
      }
    } catch (e) { /* program not ready */ }
  }
  const msg = 'Answers updated. ' + (notes.length ? notes.join(' · ') + '.' : '');
  res.redirect('/settings?notice=' + encodeURIComponent(msg));
});
app.get('/intake/:token', (req, res) => {
  if (req.user) return res.redirect('/');
  // Lead-bound invite: pre-fill name, phone, and goals from the application.
  const invite = intakeInviteFor(req.params.token);
  if (invite) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(invite.lead_id);
    return res.send(views.intakeFormPage(req.params.token, null, leadPrefillValues(lead), { prefillLead: lead }));
  }
  if (!intakeTokenValid(req.params.token)) return res.status(404).send('Not found.');
  res.send(views.intakeFormPage(req.params.token));
});
app.post('/intake/:token/submit', (req, res) => {
  // Lead-bound invite tokens work alongside the shared standalone token.
  const invite = intakeInviteFor(req.params.token);
  if (!invite && !intakeTokenValid(req.params.token)) return res.status(404).send('Not found.');
  const lead = invite ? db.prepare('SELECT * FROM leads WHERE id = ?').get(invite.lead_id) : null;
  const prefillOpts = lead ? { prefillLead: lead } : undefined;
  const ip = req.ip;
  if (!attemptAllowed(ip)) {
    return res.send(views.intakeFormPage(req.params.token, 'Too many attempts. Wait a few minutes and try again.', req.body, prefillOpts));
  }
  const fail = (msg) => {
    attemptFailed(ip);
    return res.send(views.intakeFormPage(req.params.token, msg, req.body, prefillOpts));
  };
  const a = parseIntakeBody(req.body);
  // Carry the application age/level into the answers so Bobby sees it on review.
  if (lead && lead.age_level) a.age_level_from_application = String(lead.age_level).slice(0, 60);
  if (!a.first_name || !a.last_name) return fail('Enter your first and last name.');
  if (!validEmail(a.email)) return fail('Enter a valid email address.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(a.email)) {
    return fail('An account with that email already exists. Try logging in.');
  }
  if (!validDob(a.date_of_birth)) return fail('Enter your date of birth.');
  if (!a.components.length) return fail('Pick at least one training component below.');
  if (!(req.body.agree_terms === '1' || req.body.agree_terms === 'on')) {
    return fail('Please agree to the Terms of Service and Privacy Policy.');
  }
  const age = ageOn(a.date_of_birth);
  if (age !== null && age < 18) {
    if (!a.parent_name) return fail('A parent or guardian\u2019s name is required for players under 18.');
    if (!validEmail(a.parent_email)) return fail('A parent or guardian\u2019s valid email is required for players under 18.');
  }
  const athleteName = `${a.first_name} ${a.last_name}`;
  const needsParentConsent = age !== null && age < 13;
  const status = needsParentConsent ? 'pending_parent' : 'pending';
  const nowIso = new Date().toISOString();
  // Draft program first so the account can link straight to it.
  const prog = buildIntakeProgram(a, athleteName);
  try { videoLinks.attachVideoLinks(prog, videoLinks.getLibraryRows(db)); } catch (e) { /* library not ready */ }
  const pInfo = db
    .prepare('INSERT INTO remote_programs (athlete_name, program_json, updated_at, block_start, block_number) VALUES (?, ?, ?, ?, 1)')
    .run(athleteName, JSON.stringify(prog), nowIso, nowIso.slice(0, 10));
  if (a.components.includes('lifting')) {
    const draft = buildLiftingDraft(a);
    const lInfo = db
      .prepare('INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, 0, ?, ?)')
      .run(`Lifting \u2014 ${athleteName} (DRAFT)`, JSON.stringify(draft), nowIso);
    db.prepare('UPDATE remote_programs SET lifting_program_id = ? WHERE id = ?')
      .run(lInfo.lastInsertRowid, pInfo.lastInsertRowid);
  }
  // Questionnaire athletes join Bobby's remote org directly (no signup code).
  let orgId = null;
  try {
    const org = db.prepare('SELECT id FROM organizations WHERE name = ?').get(FOUNDER_ORG_NAME);
    if (org) orgId = org.id;
  } catch (e) { /* organizations not ready */ }
  const hash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
  const uInfo = db
    .prepare(
      'INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, organization_id, date_of_birth, player_type, accepted_terms_at, terms_version, parent_name, parent_email, remote_program_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(a.email, hash, 'athlete', athleteName, a.first_name, a.last_name, nowIso, status, orgId, a.date_of_birth, 'hitter', nowIso, '1', a.parent_name || null, a.parent_email || null, pInfo.lastInsertRowid);
  db.prepare('INSERT INTO intake_responses (user_id, answers_json, created_at) VALUES (?, ?, ?)')
    .run(uInfo.lastInsertRowid, JSON.stringify(a), nowIso);
  // Lead-bound submission: link the new account back to the lead, mark the
  // invite used, and move the lead to enrolled.
  if (invite && lead) {
    db.prepare('UPDATE intake_responses SET lead_id = ? WHERE user_id = ?').run(lead.id, uInfo.lastInsertRowid);
    db.prepare('UPDATE intake_invites SET used_at = ? WHERE id = ?').run(nowIso, invite.id);
    db.prepare("UPDATE leads SET status = 'enrolled' WHERE id = ?").run(lead.id);
  }
  // Welcome token: sets their password without needing email (30-day expiry).
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(uInfo.lastInsertRowid, resetTokenHash(token), expires, nowIso);
  if (needsParentConsent) {
    const ct = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET parent_consent_token_hash = ?, parent_consent_sent_at = ? WHERE id = ?')
      .run(resetTokenHash(ct), nowIso, uInfo.lastInsertRowid);
    sendParentConsentEmail(a.parent_email, athleteName, `${publicBaseUrl(req)}/parent-consent?token=${ct}`, publicBaseUrl(req))
      .catch((e) => console.warn('intake parent consent email failed:', e.message));
  }
  pushToCoaches(
    'New intake questionnaire',
    `${athleteName} just filled out the intake \u2014 draft program ready to review.`,
    '/coach/programs'
  ).catch((e) => console.warn('intake push failed:', e.message));
  res.redirect('/welcome/' + token);
});
// Welcome link: the prospect sets their password (no email needed), gets
// logged in, and waits on the pending page until Bobby reviews + approves.
app.get('/welcome/:token', (req, res) => {
  if (req.user) return res.redirect('/');
  const row = validResetToken(req.params.token);
  if (!row) return res.send(views.welcomePage(null, 'That link is invalid or expired. Ask Bobby for a fresh one.'));
  res.send(views.welcomePage(req.params.token));
});
app.post('/welcome/:token', (req, res) => {
  const row = validResetToken(req.params.token);
  if (!row) return res.send(views.welcomePage(null, 'That link is invalid or expired. Ask Bobby for a fresh one.'));
  const pw = String(req.body.password || '');
  const pw2 = String(req.body.confirm_password || '');
  if (pw.length < 8) return res.send(views.welcomePage(req.params.token, 'Password must be at least 8 characters.'));
  if (pw !== pw2) return res.send(views.welcomePage(req.params.token, 'Passwords do not match.'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 12), row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  req.session.userId = row.user_id;
  res.redirect('/pending');
});
// Liability waiver: athletes with a program sign before they can open it.
// Typed full name (+ parent co-sign for under-18) and date; version pinned.
app.get('/waiver', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!needsWaiver(req.user)) return res.redirect('/program');
  res.send(views.waiverPage(req.user, null, { paragraphs: WAIVER_PARAGRAPHS, minor: waiverIsMinor(req.user) }));
});
app.post('/waiver', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!needsWaiver(req.user)) return res.redirect('/program');
  const name = String(req.body.waiver_name || '').trim().slice(0, 120);
  if (name.length < 2) return res.send(views.waiverPage(req.user, 'Type your full name to sign.', { paragraphs: WAIVER_PARAGRAPHS, minor: waiverIsMinor(req.user) }));
  const minor = waiverIsMinor(req.user);
  const parent = String(req.body.waiver_parent_name || '').trim().slice(0, 120);
  if (minor && parent.length < 2) {
    return res.send(views.waiverPage(req.user, 'A parent or guardian must co-sign for players under 18.', { paragraphs: WAIVER_PARAGRAPHS, minor: true }));
  }
  db.prepare(
    'UPDATE users SET waiver_signed_at = ?, waiver_name = ?, waiver_parent_name = ?, waiver_version = ? WHERE id = ?'
  ).run(new Date().toISOString(), name, minor ? parent : null, WAIVER_VERSION, req.user.id);
  res.redirect('/program');
});
// Gate program access on the waiver — no program until it's signed.
function requireWaiver(req, res, next) {
  if (needsWaiver(req.user)) return res.redirect('/waiver');
  next();
}
// Bobby's intake review: clean read of a prospect's answers + their draft.
app.get('/coach/intake/:id', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const row = db
    .prepare(
      `SELECT i.*, u.first_name, u.last_name, u.email, u.status, u.remote_program_id
       FROM intake_responses i JOIN users u ON u.id = i.user_id WHERE i.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.redirect('/coach/programs');
  let answers = {};
  try { answers = JSON.parse(row.answers_json || '{}'); } catch (e) { answers = {}; }
  res.send(views.intakeDetailPage(realUser(req), { ...row, answers }));
});
// Rotate the shareable questionnaire link.
app.post('/coach/intake/rotate', requireCoach, (req, res) => {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'intake_token'")
    .run(crypto.randomBytes(12).toString('hex'));
  res.redirect('/coach/programs');
});

// ---- 4-week training blocks (Sep 2026) ----
// Blocks run 4 weeks then switch. Bobby builds the next block a few days early
// once the guy confirms renewal; it flips automatically on the date (or he can
// make it current manually from the program edit page).
function blockSweep() {
  const today = chiToday();
  try {
    // 1) Block ended → notify Bobby once (he builds the next block).
    const due = db.prepare(
      `SELECT rp.id, rp.athlete_name FROM remote_programs rp
       WHERE rp.block_start != '' AND date(rp.block_start, '+28 days') <= date(?)
       AND (rp.block_notified_at IS NULL OR rp.block_notified_at = '' OR rp.block_notified_at < rp.block_start)`
    ).all(today);
    for (const p of due) {
      db.prepare('UPDATE remote_programs SET block_notified_at = ? WHERE id = ?')
        .run(new Date().toISOString(), p.id);
      pushToCoaches(
        'New program due',
        `${p.athlete_name}'s 4-week block is up — build the next block.`,
        '/coach/program/' + p.id + '/edit'
      ).catch((e) => console.warn('block-due push failed:', e.message));
    }
    // 2) Staged next block reached its flip date → make it current.
    const flips = db.prepare(
      `SELECT id, athlete_name, next_lifting_id, next_block_start, block_number FROM remote_programs
       WHERE next_lifting_id IS NOT NULL AND next_block_start != '' AND date(next_block_start) <= date(?)`
    ).all(today);
    for (const p of flips) {
      db.prepare(
        `UPDATE remote_programs SET lifting_program_id = ?, block_start = ?, block_number = ?,
         next_lifting_id = NULL, next_block_start = '', block_notified_at = '' WHERE id = ?`
      ).run(p.next_lifting_id, p.next_block_start, (Number(p.block_number) || 1) + 1, p.id);
      pushToCoaches(
        'New block is live',
        `${p.athlete_name}'s next 4-week block just flipped over.`,
        '/coach/program/' + p.id + '/edit'
      ).catch((e) => console.warn('block-flip push failed:', e.message));
    }
  } catch (e) { console.warn('blockSweep failed:', e.message); }
}
let lastBlockSweepDay = '';
setInterval(() => {
  try {
    const d = chiToday();
    if (d === lastBlockSweepDay) return;
    lastBlockSweepDay = d;
    blockSweep();
  } catch (e) { console.warn('block sweep tick failed:', e.message); }
}, 15 * 60 * 1000);
// Build the NEXT 4-week block draft for a program: progression read from the
// athlete's logged lifts + goal arc + answers. Staged to flip on the date;
// Bobby edits in the lifting editor and approves before anything goes live.
app.post('/coach/program/:id/next-block', requireCoach, (req, res) => {
  const p = getProgram(req.params.id);
  if (!p) return res.redirect('/coach/programs');
  const linked = db.prepare('SELECT id FROM users WHERE remote_program_id = ? LIMIT 1').get(p.id);
  let answers = {};
  if (linked) {
    try {
      const r = db.prepare('SELECT answers_json FROM intake_responses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(linked.id);
      if (r) answers = JSON.parse(r.answers_json || '{}');
    } catch (e) { answers = {}; }
  }
  const prog = p.prog || {};
  if (answers.season_phase == null && prog.draft_note && /in-season/i.test(prog.draft_note)) answers.season_phase = 'inseason';
  const blockIndex = Math.max(0, (Number(db.prepare('SELECT block_number AS n FROM remote_programs WHERE id = ?').get(p.id).n) || 1));
  let progression = null;
  try { if (linked) progression = progressionRead(linked.id); } catch (e) { progression = null; }
  const draft = buildLiftingDraft(answers, { blockIndex, progression });
  draft.progression_read = progression;
  const nowIso = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO lifting_programs (name, is_template, program_json, updated_at) VALUES (?, 0, ?, ?)'
  ).run(`Lifting \u2014 ${p.athlete_name} (Block ${blockIndex + 1} DRAFT)`, JSON.stringify(draft), nowIso);
  const cur = db.prepare('SELECT block_start FROM remote_programs WHERE id = ?').get(p.id);
  const base = (cur && cur.block_start) || nowIso.slice(0, 10);
  const flip = new Date(base + 'T12:00:00');
  flip.setDate(flip.getDate() + 28);
  const flipIso = flip.toISOString().slice(0, 10);
  db.prepare('UPDATE remote_programs SET next_lifting_id = ?, next_block_start = ? WHERE id = ?')
    .run(info.lastInsertRowid, flipIso, p.id);
  res.redirect('/coach/lifting/' + info.lastInsertRowid + '/edit');
});
// Manual: make the staged next block current right now.
app.post('/coach/program/:id/block-flip-now', requireCoach, (req, res) => {
  const row = db.prepare('SELECT id, next_lifting_id, block_number FROM remote_programs WHERE id = ?').get(req.params.id);
  if (!row || !row.next_lifting_id) return res.redirect('/coach/program/' + req.params.id + '/edit');
  const today = chiToday();
  db.prepare(
    `UPDATE remote_programs SET lifting_program_id = ?, block_start = ?, block_number = ?,
     next_lifting_id = NULL, next_block_start = '', block_notified_at = '' WHERE id = ?`
  ).run(row.next_lifting_id, today, (Number(row.block_number) || 1) + 1, row.id);
  res.redirect('/coach/program/' + req.params.id + '/edit');
});
// Manual: mark a fresh block started (for non-lifting programs or corrections).
app.post('/coach/program/:id/block-bump', requireCoach, (req, res) => {
  const row = db.prepare('SELECT id, block_number FROM remote_programs WHERE id = ?').get(req.params.id);
  if (!row) return res.redirect('/coach/programs');
  db.prepare("UPDATE remote_programs SET block_number = ?, block_start = ?, block_notified_at = '' WHERE id = ?")
    .run((Number(row.block_number) || 1) + 1, chiToday(), row.id);
  res.redirect('/coach/program/' + req.params.id + '/edit');
});

// ---- Video library: Bobby's Development System, synced from Drive by the
// VM cron. Remote hitters only.
function requireRemote(req, res, next) {
  if (req.user.role === 'coach') return res.redirect('/coach');
  if (!req.user.remoteProgramId) return res.redirect('/');
  next();
}

// Sync endpoint for the VM cron — guarded by shared secret.
app.post('/api/library/sync', (req, res) => {
  const secret = process.env.LIBRARY_SYNC_SECRET;
  if (!secret || req.body.secret !== secret) return res.status(403).json({ ok: false });
  const videos = Array.isArray(req.body.videos) ? req.body.videos : [];
  const ids = [];
  for (const v of videos) {
    const fid = String((v && v.drive_file_id) || '').trim();
    if (fid && !ids.includes(fid)) ids.push(fid);
  }
  if (!ids.length) return res.status(400).json({ ok: false, error: 'empty list — refusing to wipe' });
  const byId = {};
  for (const v of videos) byId[String(v.drive_file_id).trim()] = v;
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO video_library (drive_file_id, name, category, mime_type, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(drive_file_id) DO UPDATE SET
       name = excluded.name, category = excluded.category,
       mime_type = excluded.mime_type, updated_at = excluded.updated_at`
  );
  for (const fid of ids) {
    const v = byId[fid] || {};
    upsert.run(
      fid,
      String(v.name || 'Untitled').slice(0, 200),
      String(v.category || '').slice(0, 120),
      String(v.mime_type || '').slice(0, 80),
      now
    );
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM video_library WHERE drive_file_id NOT IN (${placeholders})`).run(...ids);
  db.prepare(
    `INSERT INTO library_sync_state (key, value) VALUES ('last_sync_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(now);
  // New videos just landed — auto-link program items worded closely to them.
  // Manual coach links always win: only items with no link and no manual
  // decision get filled.
  let autoLinked = 0;
  try {
    const r = videoLinks.autoLinkAllPrograms(db, videoLinks.getLibraryRows(db));
    autoLinked = r.linked;
    if (r.linked) console.log(`Auto-linked ${r.linked} program items to new library videos.`);
  } catch (e) { console.warn('auto-link skipped', e.message); }
  res.json({ ok: true, count: ids.length, auto_linked: autoLinked });
});

// Brain entries endpoint for the VM agent — guarded by shared secret.
// POST { secret, entries: [{ type, title, body, tags }] } — upserts by title.
app.post('/api/library/entries', (req, res) => {
  const secret = process.env.LIBRARY_SYNC_SECRET;
  if (!secret || req.body.secret !== secret) return res.status(403).json({ ok: false });
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  if (!entries.length) return res.status(400).json({ ok: false, error: 'empty list — refusing no-op' });
  const results = [];
  for (const e of entries) {
    try {
      const title = String((e && e.title) || '').trim().slice(0, 120);
      const body = String((e && e.body) || '').trim().slice(0, 2000);
      const tags = String((e && e.tags) || '').trim().slice(0, 200);
      if (!title || !body) { results.push({ title, ok: false, error: 'missing title/body' }); continue; }
      const existing = db.prepare('SELECT id FROM skip_library WHERE title = ?').get(title);
      if (existing) {
        brain.updateEntry(db, existing.id, { title, body, tags });
        results.push({ title, ok: true, action: 'updated', id: existing.id });
      } else {
        const r = brain.addEntry(db, { type: e.type, title, body, tags });
        results.push({ title, ok: true, action: 'inserted', id: Number(r.lastInsertRowid) });
      }
    } catch (err) {
      results.push({ title: String((e && e.title) || ''), ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

app.get('/videos', requireLogin, (req, res) => {
  // Remote Library removed Sep 23 2026 — redirect to Bobby's Drive
  return res.redirect('https://drive.google.com/drive/folders/1exkky5BSQjiXoMF2J25sgW87OeYtwG8i');
});

app.get('/videos/watch/:id', requireLogin, requireRemote, (req, res) => {
  const v = db.prepare('SELECT * FROM video_library WHERE id = ? AND hidden = 0').get(req.params.id);
  if (!v) return res.redirect('/videos');
  res.send(views.videoWatchPage(req.user, v));
});

// ---- View as hitter ----
app.post('/coach/view-as', requireCoachAny, (req, res) => {
  const id = Number(req.body.id);
  const scope = orgScope(req);
  const sp = scopeParams(scope);
  const t = id ? db.prepare(`SELECT id FROM users WHERE id = ? AND role != 'coach' ${SCOPE_CLAUSE}`).get(id, ...sp) : null;
  if (t) req.session.viewAsUserId = t.id;
  res.redirect('/');
});
app.post('/coach/view-as/exit', (req, res) => {
  const u = realUser(req);
  if (!u || u.role !== 'coach') return res.redirect('/login');
  delete req.session.viewAsUserId;
  res.redirect('/coach');
});

// ---- Coach video library manager ----
// Coach Videos tab: the video library.
app.get('/coach/videos', requireGlobalCoachAny, (req, res) => {
  const cats = db
    .prepare(
      `SELECT vl.category AS category, COUNT(*) AS n,
              COALESCE(NULLIF(cm.title, ''), REPLACE(vl.category, 'Apporach', 'Approach')) AS title,
              COALESCE(cm.emoji, '') AS emoji,
              COALESCE(cm.sort_order, 999) AS so,
              COALESCE(cm.hidden, 0) AS mhidden
       FROM video_library vl LEFT JOIN category_meta cm ON cm.category = vl.category
       GROUP BY vl.category ORDER BY so, title`
    )
    .all();
  const active = req.query.cat || (cats[0] ? cats[0].category : '');
  const videos = active
    ? db
        .prepare("SELECT * FROM video_library WHERE category = ? ORDER BY COALESCE(NULLIF(custom_name, ''), name)")
        .all(active)
    : [];
  const playing = req.query.play ? db.prepare('SELECT * FROM video_library WHERE id = ?').get(req.query.play) : null;
  res.send(views.coachLibraryPage(realUser(req), cats, active, videos, playing));
});

// Category display metadata (Sep 2026): Bobby renames/reorders/hides the
// Drive folder categories athletes see. The sync never touches category_meta.
app.post('/coach/library/category', requireCoach, (req, res) => {
  const category = String(req.body.category || '').slice(0, 200);
  if (!category) return res.redirect('/coach/videos');
  const title = String(req.body.title || '').trim().slice(0, 120);
  const emoji = String(req.body.emoji || '').trim().slice(0, 12);
  const so = Math.max(0, Math.min(9999, parseInt(req.body.sort_order, 10) || 999));
  const hidden = req.body.hidden === '1' ? 1 : 0;
  db.prepare(
    `INSERT INTO category_meta (category, title, blurb, emoji, sort_order, hidden)
     VALUES (?, ?, '', ?, ?, ?)
     ON CONFLICT(category) DO UPDATE SET title=excluded.title, emoji=excluded.emoji, sort_order=excluded.sort_order, hidden=excluded.hidden`
  ).run(category, title, emoji, so, hidden);
  res.redirect('/coach/videos?cat=' + encodeURIComponent(category));
});

// Old library URL — everything lives on the Videos tab now.
app.get('/coach/library', requireGlobalCoachAny, (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect('/coach/videos' + q);
});

app.post('/coach/library/rename', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const name = String(req.body.custom_name || '').trim().slice(0, 200);
  if (id) db.prepare('UPDATE video_library SET custom_name = ? WHERE id = ?').run(name, id);
  res.redirect('/coach/videos?cat=' + encodeURIComponent(req.body.cat || ''));
});

app.post('/coach/library/toggle', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  if (id) db.prepare('UPDATE video_library SET hidden = 1 - hidden WHERE id = ?').run(id);
  res.redirect('/coach/videos?cat=' + encodeURIComponent(req.body.cat || ''));
});

app.post('/learn/note', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const note = String(req.body.note || '').trim().slice(0, 1000);
  const category = String(req.body.category || '').trim().slice(0, 24);
  if (note) {
    db.prepare(
      "INSERT INTO learning_notes (user_id, note, category, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(req.user.id, note, category);
  }
  res.redirect('/notebook');
});

app.post('/learn/player', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const playerName = String(req.body.player_name || '').trim().slice(0, 80);
  const takeaway = String(req.body.takeaway || '').trim().slice(0, 300);
  if (playerName) {
    db.prepare(
      "INSERT INTO study_players (user_id, player_name, takeaway, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(req.user.id, playerName, takeaway);
  }
  res.redirect('/notebook');
});

// Hitter self-serve note edit (Bobby, Sep 17 2026). Coaches get 403.
app.get('/learn/note/:id/edit', requireLogin, (req, res) => {
  const n = ownedRow(req, res, 'learning_notes');
  if (!n) return;
  res.send(views.learnNoteEditPage(req.user, n, null));
});

app.post('/learn/note/:id', requireLogin, (req, res) => {
  const n = ownedRow(req, res, 'learning_notes');
  if (!n) return;
  const note = String(req.body.note || '').trim().slice(0, 1000);
  const category = String(req.body.category || '').trim().slice(0, 24);
  if (!note) return res.send(views.learnNoteEditPage(req.user, n, 'Write the note first.'));
  db.prepare('UPDATE learning_notes SET note = ?, category = ? WHERE id = ? AND user_id = ?')
    .run(note, category, n.id, req.user.id);
  res.redirect('/notebook');
});

app.post('/learn/note/:id/delete', requireLogin, (req, res) => {
  const n = ownedRow(req, res, 'learning_notes');
  if (!n) return;
  db.prepare('DELETE FROM learning_notes WHERE id = ? AND user_id = ?').run(n.id, req.user.id);
  res.redirect('/notebook');
});

// Hitter self-serve study-player edit (Bobby, Sep 17 2026). Coaches get 403.
app.get('/learn/player/:id/edit', requireLogin, (req, res) => {
  const pl = ownedRow(req, res, 'study_players');
  if (!pl) return;
  res.send(views.studyPlayerEditPage(req.user, pl, null));
});

app.post('/learn/player/:id', requireLogin, (req, res) => {
  const pl = ownedRow(req, res, 'study_players');
  if (!pl) return;
  const playerName = String(req.body.player_name || '').trim().slice(0, 80);
  const takeaway = String(req.body.takeaway || '').trim().slice(0, 300);
  if (!playerName) return res.send(views.studyPlayerEditPage(req.user, pl, 'Give the player a name.'));
  db.prepare('UPDATE study_players SET player_name = ?, takeaway = ? WHERE id = ? AND user_id = ?')
    .run(playerName, takeaway, pl.id, req.user.id);
  res.redirect('/notebook');
});

app.post('/learn/player/:id/delete', requireLogin, (req, res) => {
  const pl = ownedRow(req, res, 'study_players');
  if (!pl) return;
  db.prepare('DELETE FROM study_players WHERE id = ? AND user_id = ?').run(pl.id, req.user.id);
  res.redirect('/notebook');
});

app.get('/checkin/score/:id', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const row = db
    .prepare('SELECT * FROM checkins WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).send('Check-in not found.');
  row.score_breakdown = scoreBreakdown(
    row.feel,
    row.confidence,
    row.focus,
    row.difficulty,
    `${row.session_notes || ''} ${row.what_worked || ''}`
  );
  res.send(views.scorePage(req.user, row, streakData(req.user.id).streak || 0));
});

app.post('/checkin', requireLogin, async (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  // The hitting form is for hitters; pitchers and two-ways have their own.
  if ((req.user.playerType || 'hitter') !== 'hitter') return res.redirect('/checkin');
  const b = req.body;
  const fail = (msg) => {
    try {
      res.send(views.checkinForm(req.user, msg, b));
    } catch (e) {
      console.error('checkin form render failed:', e.message);
      res.status(500).send('Something went wrong saving your check-in. Please try again.');
    }
  };
  try {
  // Bobby's simplified check-in (Sep 23 2026): a few taps + mic. Swing feel
  // is a 1-10 slider; Skip parses the talk text server-side into the summary.
  const sessionTypes = ['game', 'cage', 'live_abs', 'team_practice'];
  const routineOpts = ['yes', 'mostly', 'no'];
  if (!sessionTypes.includes(b.session_type)) {
    return fail('Pick what you did today — game, cage, live ABs, or team practice.');
  }
  const swingFeel = parseInt(b.swing_feel, 10);
  if (!Number.isFinite(swingFeel) || swingFeel < 1 || swingFeel > 10) {
    return fail('Move the slider to rate the session.');
  }
  const talkText = String(b.talk_text || '').trim().slice(0, 4000);
  // Skip sorts it out: parse the talk text into the structured fields.
  let parsed = {};
  if (talkText) {
    try {
      const system = `You parse a hitter's spoken check-in into structured fields. Reply with ONLY a JSON object, no other text. Fields:
timing: one of "early", "on_time", "late", "inconsistent" ("" if not mentioned)
contact_quality: 1-5 integer ("" if not mentioned)
approach_score: 1-5 integer (approach and decision-making, "" if not mentioned)
main_focus: string (what they focused on, "" if not mentioned)
felt_good: string (what felt good, "" if not mentioned)
biggest_struggle: string (what they struggled with, "" if not mentioned)
adjustment_helped: string (what adjustment or feel helped, "" if not mentioned)
learned: string (what they learned about themselves, "" if not mentioned)
whats_next: string (their one focus for next time, "" if not mentioned)
This was phone dictation, so expect misheard words — silently correct obvious ones from baseball context ("tee" not "tea", "cage" not "couch", "live ABs" not "libbies", "barrel" not "battle", "hands" not "hams"). Never mention the correction; just use the right word.
Infer ratings from their words (e.g. "felt great" = 5, "terrible" = 1, "pretty good" = 4). Keep text fields to one or two sentences, in their voice.`;
      const raw = await geminiText(system, talkText, 800);
      parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim()) || {};
    } catch (e) {
      console.warn('checkin parse failed:', e.message);
    }
  }
  const star = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
  // Session score: the 1-10 swing feel is already on the 1-10 scale.
  const sessionScore = swingFeel;
  const tier = scoreTier(sessionScore);
  const info = db
    .prepare(
      `INSERT INTO checkins
       (user_id, athlete_name, created_at, session_type, routine_followed, swing_feel, timing,
        contact_quality, approach_score, main_focus, felt_good, biggest_struggle,
        adjustment_helped, learned, whats_next, session_notes, session_score, score_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      req.user.athleteName,
      new Date().toISOString(),
      b.session_type,
      routineOpts.includes(b.routine_followed) ? b.routine_followed : '',
      swingFeel,
      ['early', 'on_time', 'late', 'inconsistent'].includes(parsed.timing) ? parsed.timing : '',
      star(parsed.contact_quality),
      star(parsed.approach_score),
      String(parsed.main_focus || '').trim().slice(0, 300),
      String(parsed.felt_good || '').trim().slice(0, 300),
      String(parsed.biggest_struggle || '').trim().slice(0, 300),
      String(parsed.adjustment_helped || '').trim().slice(0, 300),
      String(parsed.learned || '').trim().slice(0, 300),
      String(parsed.whats_next || '').trim().slice(0, 300),
      talkText,
      sessionScore,
      tier
    );
  notifyMyPlayerCheckin(req.user.id, req.user.displayName, '/coach/user/' + encodeURIComponent(req.user.email)).catch((e) => console.warn('checkin push failed:', e.message));
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
  } catch (e) {
    console.error('checkin submit failed:', e.message);
    return fail('Something went wrong saving your check-in — please try again.');
  }
});

// ---- Optional pre-hit check-in: set the intent BEFORE the session ----
// Never required. Skip reads today's intent and connects the post-session
// check-in back to it.

// Shared validation for the throwing half of pitching + combined check-ins.
// Returns the cleaned throwing fields, or null after rendering `failView`.
function validateThrowing(b, failView) {
  const t = b.pitch_session_type;
  if (!PITCH_SESSION_TYPES.includes(t)) {
    failView('Pick what kind of throwing it was.');
    return null;
  }
  const isThrow = t === 'bullpen' || t === 'live' || t === 'game';
  const isRecovery = t === 'recovery';
  const isNoThrow = t === 'no_throw';
  let intent = '';
  if (!isRecovery && !isNoThrow) {
    if (!THROW_INTENTS.includes(b.intent)) {
      failView('Pick the intent for the day — light, medium, or heavy.');
      return null;
    }
    intent = b.intent;
  }
  let command = null;
  if (!isRecovery && !isNoThrow) {
    command = parseRating(b.command);
    if (command === null) {
      failView('Rate your command from 1 to 10.');
      return null;
    }
  }
  let pitchCount = null;
  if (isThrow) {
    // Bullpen / live / game days require a pitch count and at least one pitch.
    const n = parseInt(b.pitch_count, 10);
    if (!Number.isFinite(n) || n < 1 || n > 300) {
      failView('How many pitches did you throw?');
      return null;
    }
    pitchCount = n;
  }
  const pitchesThrown = isThrow ? parsePitchesThrown(b.pitches_thrown) : [];
  if (isThrow && !pitchesThrown.length) {
    failView('Check off at least one pitch you threw.');
    return null;
  }
  let veloMax = null;
  if (isThrow && String(b.velo_max || '').trim() !== '') {
    const n = parseFloat(b.velo_max);
    if (!Number.isFinite(n) || n < 40 || n > 110) {
      failView('Top velo should be a number between 40 and 110.');
      return null;
    }
    veloMax = Math.round(n * 10) / 10;
  }
  const catchDistance = t === 'catch_play' ? String(b.catch_distance || '').trim().slice(0, 30) : '';
  const recoveryNotes = isRecovery ? String(b.recovery_notes || '').trim().slice(0, 2000) : '';
  if (isRecovery && !recoveryNotes) {
    failView('What recovery work did you do?');
    return null;
  }
  const noThrowNote = isNoThrow ? String(b.no_throw_note || '').trim().slice(0, 2000) : '';
  if (isNoThrow && !noThrowNote) {
    failView('Say what you did to get better today.');
    return null;
  }
  return { t, intent, command, pitchCount, pitchesThrown, veloMax, catchDistance, recoveryNotes, noThrowNote };
}

const PITCHING_INSERT = `INSERT INTO checkins
  (user_id, athlete_name, created_at, environment, drills_done, feel, confidence, focus,
   difficulty, session_score, score_tier, session_notes, what_worked, whats_next,
   session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
   velo_max, catch_distance, recovery_notes, no_throw_note,
   felt_good, what_was_working, biggest_struggle, hitting_score, pitching_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Pitcher-only check-in.
app.post('/checkin/pitching', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  if ((req.user.playerType || 'hitter') !== 'pitcher') return res.redirect('/checkin');
  const b = req.body;
  const viewValues = { ...b, pitches_thrown: parsePitchesThrown(b.pitches_thrown) };
  const fail = (msg) => res.send(views.pitchingCheckinForm(req.user, msg, viewValues));
  const th = validateThrowing(b, fail);
  if (!th) return;
  const feel = parseRating(b.feel);
  const focus = parseRating(b.focus);
  const confidence = parseRating(b.confidence);
  if (feel === null || focus === null || confidence === null) {
    return fail('Rate feel, focus, and confidence from 1 to 10.');
  }
  const pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
  const tier = scoreTier(pitchingScore);
  const info = db.prepare(PITCHING_INSERT).run(
    req.user.id, req.user.athleteName, new Date().toISOString(),
    '', '[]', feel, confidence, focus,
    null, pitchingScore, tier, '', '', '',
    'pitching', th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
    th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
    (b.felt_good || '').trim().slice(0, 2000),
    (b.what_was_working || '').trim().slice(0, 2000),
    (b.biggest_struggle || '').trim().slice(0, 2000),
    null, pitchingScore
  );
  notifyMyPlayerCheckin(req.user.id, req.user.displayName, '/coach/user/' + encodeURIComponent(req.user.email)).catch((e) => console.warn('checkin push failed:', e.message));
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
});

// Two-way combined check-in: one row, hitting and/or throwing.
app.post('/checkin/combined', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  if ((req.user.playerType || 'hitter') !== 'two_way') return res.redirect('/checkin');
  const b = req.body;
  const didHit = b.did_hit === 'yes';
  const didThrow = b.did_throw === 'yes';
  const viewValues = { ...b, pitches_thrown: parsePitchesThrown(b.pitches_thrown) };
  const fail = (msg) => res.send(views.combinedCheckinForm(req.user, msg, viewValues));
  if (!didHit && !didThrow) {
    return fail('Say what you did today — hitting, throwing, or both.');
  }
  const feel = parseRating(b.feel);
  const focus = parseRating(b.focus);
  const confidence = parseRating(b.confidence);
  if (feel === null || focus === null || confidence === null) {
    return fail('Rate feel, focus, and confidence from 1 to 10.');
  }
  const feltGood = (b.felt_good || '').trim().slice(0, 2000);
  const whatWasWorking = (b.what_was_working || '').trim().slice(0, 2000);
  const biggestStruggle = (b.biggest_struggle || '').trim().slice(0, 2000);
  let environment = '', difficulty = null, hittingScore = null;
  if (didHit) {
    if (!ENVIRONMENTS.includes(b.environment)) return fail('Pick where you hit.');
    difficulty = parseRating(b.difficulty);
    if (difficulty === null) return fail('Rate the difficulty of the hitting from 1 to 10.');
    environment = b.environment;
    hittingScore = scoreBreakdown(feel, confidence, focus, difficulty, `${feltGood} ${whatWasWorking}`).total;
  }
  let th = { t: '', intent: '', command: null, pitchCount: null, pitchesThrown: [], veloMax: null, catchDistance: '', recoveryNotes: '', noThrowNote: '' };
  let pitchingScore = null;
  if (didThrow) {
    th = validateThrowing(b, fail);
    if (!th) return;
    pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
  }
  const subs = [hittingScore, pitchingScore].filter((s) => s !== null);
  const sessionScore = round1(subs.reduce((a, s) => a + s, 0) / subs.length);
  const tier = scoreTier(sessionScore);
  // Hitting-only days read as hitting, throwing-only as pitching.
  const sessionKind = didHit && didThrow ? 'combined' : didHit ? 'hitting' : 'pitching';
  const info = db.prepare(PITCHING_INSERT).run(
    req.user.id, req.user.athleteName, new Date().toISOString(),
    environment, '[]', feel, confidence, focus,
    difficulty, sessionScore, tier, '', '', '',
    sessionKind, th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
    th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
    feltGood, whatWasWorking, biggestStruggle,
    hittingScore, pitchingScore
  );
  notifyMyPlayerCheckin(req.user.id, req.user.displayName, '/coach/user/' + encodeURIComponent(req.user.email)).catch((e) => console.warn('checkin push failed:', e.message));
  res.redirect(`/checkin/score/${info.lastInsertRowid}`);
});

// ---- Hitter self-serve check-in edit + delete (Bobby, Sep 17 2026) ----
// A hitter can fix or remove their own entries from the Notebook. Ownership:
// coaches (Bobby, Cam — even in "view as hitter" mode) always get 403;
// hitters get 404 for an unknown id and 403 for another athlete's entry.
// Table is one of three fixed literals — never user input.
function ownedRow(req, res, table) {
  if (req.user.role === 'coach' || req.user.viewAs) { res.status(403).send('Forbidden'); return null; }
  const n = Number(req.params.id);
  const row = Number.isFinite(n) ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(n) : null;
  if (!row) { res.status(404).send('Not found.'); return null; }
  if (row.user_id !== req.user.id) { res.status(403).send('Forbidden'); return null; }
  return row;
}
// Which form an entry was created with — the edit uses the same form.
// A hitting entry never opens the pitching form, and vice versa.
function checkinEditFormKind(row, playerType) {
  const kind = row.session_kind || 'hitting';
  if (kind === 'pitching') return 'pitching';
  if (kind === 'combined') return 'combined';
  return (playerType || 'hitter') === 'two_way' ? 'combined' : 'hitting';
}
function hittingRowValues(row) {
  return {
    environment: row.environment || '',
    feel: row.feel,
    confidence: row.confidence,
    focus: row.focus,
    difficulty: row.difficulty,
    session_notes: row.session_notes || '',
    what_worked: row.what_worked || '',
    whats_next: row.whats_next || '',
    sections: splitDrillsBySection(row.drills_done),
  };
}
function throwingPitchesArray(row) {
  try {
    const p = JSON.parse(row.pitches_thrown || '[]');
    if (Array.isArray(p)) return p;
  } catch (e) {}
  return [];
}
function pitchingRowValues(row) {
  return { ...row, pitches_thrown: throwingPitchesArray(row) };
}
function combinedRowValues(row) {
  const kind = row.session_kind || 'hitting';
  return {
    ...row,
    pitches_thrown: throwingPitchesArray(row),
    did_hit: kind === 'pitching' ? '' : 'yes',
    did_throw: kind === 'hitting' ? '' : 'yes',
  };
}
function renderCheckinEdit(user, row, error, bodyValues) {
  const formKind = checkinEditFormKind(row, user.playerType || 'hitter');
  const action = `/checkin/${row.id}`;
  if (formKind === 'pitching') {
    return views.pitchingCheckinForm(user, error, bodyValues || pitchingRowValues(row), action);
  }
  if (formKind === 'combined') {
    return views.combinedCheckinForm(user, error, bodyValues || combinedRowValues(row), action);
  }
  return views.checkinForm(
    user, error, bodyValues || hittingRowValues(row),
    data.drillNames(), getRoutine(user.id), recentDrillGroups(user.id), action
  );
}

app.get('/checkin/:id/edit', requireLogin, (req, res) => {
  const row = ownedRow(req, res, 'checkins');
  if (!row) return;
  res.send(renderCheckinEdit(req.user, row, null, null));
});

app.post('/checkin/:id', requireLogin, async (req, res) => {
  const row = ownedRow(req, res, 'checkins');
  if (!row) return;
  const b = req.body;
  const formKind = checkinEditFormKind(row, req.user.playerType || 'hitter');
  const fail = (msg) => {
    const bv = formKind === 'hitting'
      ? checkinValues(b)
      : { ...b, pitches_thrown: parsePitchesThrown(b.pitches_thrown) };
    return res.send(renderCheckinEdit(req.user, row, msg, bv));
  };
  // The session date (created_at) never changes; Skip's journal read, if any,
  // stays untouched. No "Session logged" push on edits — only on new check-ins.
  if (formKind === 'hitting') {
    // Simplified check-in (Sep 23 2026): taps + mic. Matches POST /checkin.
    const sessionTypes = ['game', 'cage', 'live_abs', 'team_practice'];
    const routineOpts = ['yes', 'mostly', 'no'];
    if (!sessionTypes.includes(b.session_type)) return fail('Pick what you did today.');
    const swingFeel = parseInt(b.swing_feel, 10);
    if (!Number.isFinite(swingFeel) || swingFeel < 1 || swingFeel > 10) {
      return fail('Move the slider to rate the session.');
    }
    const talkText = String(b.talk_text || b.session_notes || '').trim().slice(0, 4000);
    let parsed = {};
    if (talkText) {
      try {
        const raw = await geminiText(
          'You parse a hitter\'s spoken check-in into structured fields. Reply with ONLY a JSON object, no other text. Fields: timing ("early"|"on_time"|"late"|"inconsistent"|""), contact_quality (1-5|""), approach_score (1-5|""), main_focus, felt_good, biggest_struggle, adjustment_helped, learned, whats_next (strings, "" if not mentioned). Keep text fields to one or two sentences, in their voice.',
          talkText, 800
        );
        parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim()) || {};
      } catch (e) { console.warn('checkin edit parse failed:', e.message); }
    }
    const star = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
    const tier = scoreTier(swingFeel);
    db.prepare(
      `UPDATE checkins SET session_type = ?, routine_followed = ?, swing_feel = ?, timing = ?,
        contact_quality = ?, approach_score = ?, main_focus = ?, felt_good = ?, biggest_struggle = ?,
        adjustment_helped = ?, learned = ?, whats_next = ?, session_notes = ?,
        session_score = ?, score_tier = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      b.session_type,
      routineOpts.includes(b.routine_followed) ? b.routine_followed : '',
      swingFeel,
      ['early', 'on_time', 'late', 'inconsistent'].includes(parsed.timing) ? parsed.timing : '',
      star(parsed.contact_quality),
      star(parsed.approach_score),
      String(parsed.main_focus || '').trim().slice(0, 300),
      String(parsed.felt_good || '').trim().slice(0, 300),
      String(parsed.biggest_struggle || '').trim().slice(0, 300),
      String(parsed.adjustment_helped || '').trim().slice(0, 300),
      String(parsed.learned || '').trim().slice(0, 300),
      String(parsed.whats_next || '').trim().slice(0, 300),
      talkText,
      swingFeel,
      tier,
      row.id, req.user.id
    );
    return res.redirect(`/checkin/score/${row.id}`);
  }
  if (formKind === 'pitching') {
    const th = validateThrowing(b, fail);
    if (!th) return;
    const feel = parseRating(b.feel);
    const focus = parseRating(b.focus);
    const confidence = parseRating(b.confidence);
    if (feel === null || focus === null || confidence === null) {
      return fail('Rate feel, focus, and confidence from 1 to 10.');
    }
    const pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
    const tier = scoreTier(pitchingScore);
    db.prepare(
      `UPDATE checkins SET feel = ?, confidence = ?, focus = ?, session_score = ?, score_tier = ?,
        pitch_session_type = ?, intent = ?, command = ?, pitch_count = ?, pitches_thrown = ?,
        velo_max = ?, catch_distance = ?, recovery_notes = ?, no_throw_note = ?,
        felt_good = ?, what_was_working = ?, biggest_struggle = ?, pitching_score = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      feel, confidence, focus, pitchingScore, tier,
      th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
      th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
      (b.felt_good || '').trim().slice(0, 2000),
      (b.what_was_working || '').trim().slice(0, 2000),
      (b.biggest_struggle || '').trim().slice(0, 2000),
      pitchingScore, row.id, req.user.id
    );
    return res.redirect(`/checkin/score/${row.id}`);
  }
  // Combined two-way form.
  const didHit = b.did_hit === 'yes';
  const didThrow = b.did_throw === 'yes';
  if (!didHit && !didThrow) {
    return fail('Say what you did today \u2014 hitting, throwing, or both.');
  }
  const feel = parseRating(b.feel);
  const focus = parseRating(b.focus);
  const confidence = parseRating(b.confidence);
  if (feel === null || focus === null || confidence === null) {
    return fail('Rate feel, focus, and confidence from 1 to 10.');
  }
  const feltGood = (b.felt_good || '').trim().slice(0, 2000);
  const whatWasWorking = (b.what_was_working || '').trim().slice(0, 2000);
  const biggestStruggle = (b.biggest_struggle || '').trim().slice(0, 2000);
  let environment = '', difficulty = null, hittingScore = null;
  if (didHit) {
    if (!ENVIRONMENTS.includes(b.environment)) return fail('Pick where you hit.');
    difficulty = parseRating(b.difficulty);
    if (difficulty === null) return fail('Rate the difficulty of the hitting from 1 to 10.');
    environment = b.environment;
    hittingScore = scoreBreakdown(feel, confidence, focus, difficulty, `${feltGood} ${whatWasWorking}`).total;
  }
  let th = { t: '', intent: '', command: null, pitchCount: null, pitchesThrown: [], veloMax: null, catchDistance: '', recoveryNotes: '', noThrowNote: '' };
  let pitchingScore = null;
  if (didThrow) {
    th = validateThrowing(b, fail);
    if (!th) return;
    pitchingScore = pitchingScoreOf(feel, focus, confidence, th.command);
  }
  const subs = [hittingScore, pitchingScore].filter((s) => s !== null);
  const sessionScore = round1(subs.reduce((a, s) => a + s, 0) / subs.length);
  const tier = scoreTier(sessionScore);
  const sessionKind = didHit && didThrow ? 'combined' : didHit ? 'hitting' : 'pitching';
  db.prepare(
    `UPDATE checkins SET environment = ?, feel = ?, confidence = ?, focus = ?, difficulty = ?,
      session_score = ?, score_tier = ?, session_kind = ?,
      pitch_session_type = ?, intent = ?, command = ?, pitch_count = ?, pitches_thrown = ?,
      velo_max = ?, catch_distance = ?, recovery_notes = ?, no_throw_note = ?,
      felt_good = ?, what_was_working = ?, biggest_struggle = ?,
      hitting_score = ?, pitching_score = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    environment, feel, confidence, focus, difficulty, sessionScore, tier, sessionKind,
    th.t, th.intent, th.command, th.pitchCount, JSON.stringify(th.pitchesThrown),
    th.veloMax, th.catchDistance, th.recoveryNotes, th.noThrowNote,
    feltGood, whatWasWorking, biggestStruggle, hittingScore, pitchingScore,
    row.id, req.user.id
  );
  return res.redirect(`/checkin/score/${row.id}`);
});

app.get('/checkin/:id/delete', requireLogin, (req, res) => {
  const row = ownedRow(req, res, 'checkins');
  if (!row) return;
  res.send(views.checkinDeletePage(req.user, row));
});

app.post('/checkin/:id/delete', requireLogin, (req, res) => {
  const row = ownedRow(req, res, 'checkins');
  if (!row) return;
  // No other table references checkins by id (chat history doesn't) — the
  // row deletes cleanly. A Skip journal read on the row goes with it; the
  // chat history itself is untouched.
  db.prepare('DELETE FROM checkins WHERE id = ? AND user_id = ?').run(row.id, req.user.id);
  res.redirect('/notebook');
});

// ---- Optional pre-hit check-in: set the intent BEFORE the session ----
// Never required. Skip reads today's intent and connects the post-session
// check-in back to it.
function todayPreCheckin(userId) {
  const rows = db
    .prepare('SELECT * FROM pre_checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
    .all(userId);
  const today = chiDay(new Date());
  return rows.find((r) => { try { return chiDay(r.created_at) === today; } catch (e) { return false; } }) || null;
}

app.get('/precheckin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // The pre-check-in follows the player's role: hitters pick cage/game,
  // pitchers set a throwing intent, two-ways get one combined form.
  const pt = req.user.playerType || 'hitter';
  if (pt === 'pitcher') return res.send(views.preCheckinPage(req.user, 'throwing', null, {}));
  if (pt === 'two_way') return res.send(views.preCheckinPage(req.user, 'both', null, {}));
  const kind = req.query.kind === 'game' ? 'game' : 'cage';
  res.send(views.preCheckinPage(req.user, kind, null, {}));
});

app.post('/precheckin', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const pt = req.user.playerType || 'hitter';
  const kind = req.body.kind;
  // Pitcher pre-throw check-in: throwing intent + throwing focus.
  if (kind === 'throwing') {
    if (pt !== 'pitcher') return res.redirect('/precheckin');
    const throwIntent = THROW_INTENTS.includes(req.body.throw_intent) ? req.body.throw_intent : '';
    const throwFocus = String(req.body.throw_focus || '').trim().slice(0, 2000);
    if (!throwFocus) {
      return res.send(views.preCheckinPage(req.user, 'throwing', 'Give me one thing — what\u2019s the throwing focus?', { throw_intent: throwIntent, throw_focus: throwFocus }));
    }
    db.prepare(
      'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, throw_intent, throw_focus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, 'throwing', '', '', '', throwIntent, throwFocus, new Date().toISOString());
    return res.redirect('/');
  }
  // Two-way pre-session check-in: hitting goal/focus + throwing intent/focus.
  if (kind === 'both') {
    if (pt !== 'two_way') return res.redirect('/precheckin');
    const focus = String(req.body.focus || '').trim().slice(0, 2000);
    const plan = String(req.body.plan || '').trim().slice(0, 2000);
    const throwIntent = THROW_INTENTS.includes(req.body.throw_intent) ? req.body.throw_intent : '';
    const throwFocus = String(req.body.throw_focus || '').trim().slice(0, 2000);
    if (!focus && !throwFocus) {
      return res.send(views.preCheckinPage(req.user, 'both', 'Give me at least one thing — a hitting focus or a throwing focus.', { focus, plan, throw_intent: throwIntent, throw_focus: throwFocus }));
    }
    db.prepare(
      'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, throw_intent, throw_focus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, 'both', focus, plan, '', throwIntent, throwFocus, new Date().toISOString());
    return res.redirect('/');
  }
  const k = kind === 'game' ? 'game' : 'cage';
  if (pt !== 'hitter') return res.redirect('/precheckin');
  const focus = String(req.body.focus || '').trim().slice(0, 2000);
  const plan = String(req.body.plan || '').trim().slice(0, 2000);
  const flush = String(req.body.flush || '').trim().slice(0, 2000);
  if (!focus) {
    return res.send(views.preCheckinPage(req.user, k, 'Give me at least one thing — what\u2019s the focus?', { focus, plan, flush }));
  }
  db.prepare(
    'INSERT INTO pre_checkins (user_id, kind, focus, plan, flush, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, k, focus, plan, flush, new Date().toISOString());
  res.redirect('/');
});

// ---- Notebook: check-ins + hitting notes in one place ----

// ---------- Settings ----------
function getSubscription(userId) {
  try {
    return db.prepare('SELECT status, plan, current_period_end FROM user_subscriptions WHERE user_id = ?').get(userId) || null;
  } catch (e) { return null; }
}

// Coaches admin (full-access coaches only) lives on Settings now.
function coachAdminOpts(req) {
  const me = realUser(req);
  if (req.user.role === 'coach' && me.canEdit) {
    return {
      coaches: db.prepare("SELECT id, email, first_name, last_name, can_edit, created_at FROM users WHERE role = 'coach' AND organization_id IS NULL ORDER BY created_at ASC").all(),
      selfId: me.id,
    };
  }
  return {};
}

app.get('/settings', requireLogin, (req, res) => {
  if (req.user.viewAs) return res.redirect('/coach');
  res.send(views.settingsPage(req.user, {
    subscription: getSubscription(req.user.id),
    pushOn: userPushSubscriptions(req.user.id).length > 0,
    notice: req.query.saved ? 'Account updated.' : (req.query.pw ? 'Password changed.' : (req.query.organization ? 'Organization updated.' : null)),
    ...coachAdminOpts(req),
  }));
});

app.post('/settings/push/off', requireLogin, (req, res) => {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
  res.redirect('/settings?saved=1');
});

app.post('/settings/profile', requireLogin, (req, res) => {
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), pushOn: userPushSubscriptions(req.user.id).length > 0, error: msg, ...coachAdminOpts(req) }));
  if (!firstName || !lastName) return fail('First and last name are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (taken) return fail('That email is already on another account.');
  const athleteName = req.user.role === 'coach' ? req.user.athleteName : `${firstName} ${lastName}`;
  const dob = String(req.body.date_of_birth || '').trim();
  if (req.user.role !== 'coach' && dob && !validDob(dob)) return fail('Enter a valid date of birth.');
  db.prepare('UPDATE users SET first_name = ?, last_name = ?, email = ?, athlete_name = ? WHERE id = ?')
    .run(firstName, lastName, email, athleteName, req.user.id);
  if (req.user.role !== 'coach' && dob) {
    db.prepare('UPDATE users SET date_of_birth = ? WHERE id = ?').run(dob, req.user.id);
  }
  res.redirect('/settings?saved=1');
});

// Athletes can switch their role later (hitter / pitcher / two-way). This
// changes which check-in form they get from then on; past check-ins keep
// their original kind.
app.post('/settings/role', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), pushOn: userPushSubscriptions(req.user.id).length > 0, error: msg, ...coachAdminOpts(req) }));
  const playerType = req.body.player_type;
  if (!validPlayerType(playerType)) return fail('Pick hitter, pitcher, or two-way.');
  db.prepare('UPDATE users SET player_type = ? WHERE id = ?').run(playerType, req.user.id);
  res.redirect('/settings?saved=1');
});

// Hitters can join (or leave) an organization later from Settings. Blank
// code = leave the organization; a valid organization or team code joins it.
// Coaches can't use this.
app.post('/settings/organization', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), pushOn: userPushSubscriptions(req.user.id).length > 0, error: msg, ...coachAdminOpts(req) }));
  const code = String(req.body.organization_code || '').trim();
  if (!code) {
    db.prepare('UPDATE users SET organization_id = NULL, team_id = NULL WHERE id = ?').run(req.user.id);
    return res.redirect('/settings?organization=1');
  }
  const found = codeLookup(code);
  if (!found) return fail('That code didn\u2019t match an organization. Check it with your coach and try again.');
  db.prepare('UPDATE users SET organization_id = ?, team_id = ? WHERE id = ?').run(found.organizationId, found.teamId, req.user.id);
  res.redirect('/settings?organization=1');
});

app.post('/settings/password', requireLogin, (req, res) => {
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), pushOn: userPushSubscriptions(req.user.id).length > 0, error: msg, ...coachAdminOpts(req) }));
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(String(req.body.current_password || ''), row.password_hash)) {
    return fail('Current password didn\u2019t match.');
  }
  const next = String(req.body.new_password || '');
  if (next.length < 8) return fail('New password needs at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), req.user.id);
  res.redirect('/settings?pw=1');
});

app.post('/settings/subscription/cancel', requireLogin, (req, res) => {
  const sub = getSubscription(req.user.id);
  if (!sub || sub.status !== 'active') {
    return res.send(views.settingsPage(req.user, { subscription: sub, notice: 'No active subscription \u2014 nothing to cancel.', ...coachAdminOpts(req) }));
  }
  db.prepare("UPDATE user_subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE user_id = ?").run(req.user.id);
  res.send(views.settingsPage(req.user, {
    subscription: getSubscription(req.user.id),
    notice: 'Subscription ended. You keep full access until the end of the billing period.',
    ...coachAdminOpts(req),
  }));
});

app.post('/settings/delete', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.status(403).send('Forbidden');
  const fail = (msg) => res.send(views.settingsPage(req.user, { subscription: getSubscription(req.user.id), pushOn: userPushSubscriptions(req.user.id).length > 0, error: msg, ...coachAdminOpts(req) }));
  if (String(req.body.confirm || '').trim() !== 'DELETE') return fail('Type DELETE exactly to confirm.');
  const id = req.user.id;
  const del = db.transaction(() => {
    for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'learning_notes', 'study_players', 'push_subscriptions', 'mental_baseline', 'hitter_memory', 'user_subscriptions']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  del();
  req.session.destroy(() => res.redirect('/login?deleted=1'));
});

app.get('/notebook', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  const all = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  // Session-kind filter (only shown when the athlete has more than one kind).
  const kinds = [...new Set(all.map((c) => c.session_kind || 'hitting'))];
  const kind = ['hitting', 'pitching', 'combined'].includes(req.query.kind) ? req.query.kind : 'all';
  const checkins = kind === 'all' ? all : all.filter((c) => (c.session_kind || 'hitting') === kind);
  const notes = db
    .prepare('SELECT * FROM learning_notes WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const players = db
    .prepare('SELECT * FROM study_players WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.send(views.notebookPage(req.user, checkins, notes, players, req.query.saved === '1', { kinds, kind }, { streak: streakData(req.user.id) }));
});

// Skip's read — pattern notes at the top of the Notebook (Sep 23 2026).
// Cached per athlete; regenerates when a new check-in lands.
app.get('/api/notebook/read', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'athletes only' });
  const checkins = db
    .prepare(`SELECT created_at, session_type, swing_feel, timing, session_notes,
              main_focus, felt_good, biggest_struggle, adjustment_helped, learned, whats_next,
              session_score, score_tier
              FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
    .all(req.user.id);
  if (!checkins.length) return res.json({ ok: true, empty: true });
  // Bobby, Sep 23 2026: Skip's read only starts after 3 sessions — the
  // player is told to keep going until then (confidence + momentum).
  if (checkins.length < 3) return res.json({ ok: true, notEnough: true, count: checkins.length });
  const cached = db.prepare('SELECT * FROM notebook_reads WHERE user_id = ?').get(req.user.id);
  if (cached && cached.checkin_count === checkins.length) {
    try { return res.json({ ok: true, read: JSON.parse(cached.content) }); }
    catch (e) {}
  }
  const lines = checkins.map((c) => {
    const parts = [
      String(c.created_at).slice(0, 10),
      `score ${c.session_score ?? '?'}`,
      c.session_type ? `type ${c.session_type}` : null,
      c.session_notes ? `said: "${c.session_notes.slice(0, 300)}"` : null,
      c.felt_good ? `felt good: "${c.felt_good.slice(0, 200)}"` : null,
      c.biggest_struggle ? `struggled: "${c.biggest_struggle.slice(0, 200)}"` : null,
      c.adjustment_helped ? `helped: "${c.adjustment_helped.slice(0, 200)}"` : null,
      c.learned ? `learned: "${c.learned.slice(0, 200)}"` : null,
      c.whats_next ? `next focus: "${c.whats_next.slice(0, 200)}"` : null,
    ].filter(Boolean);
    return '- ' + parts.join(' | ');
  }).join('\n');
  const system = `You are Skip, a hitting coach's AI. You MIRROR the hitter — you never fix, never diagnose, never invent mechanical causes. Look at these recent check-ins and notice what's worth noticing: patterns, trends, things that keep showing up. Examples of the kinds of things to surface: what's been working, what he's been struggling with, what he's thinking during good sessions, what's happening during bad sessions, how following his routine connects to his scores, timing patterns, approach trends — but don't limit yourself to these. Surface whatever is actually there, in his own words.
Reply with ONLY a JSON object, no other text: {"sections": [{"title": "short section title", "items": ["bullet 1", "bullet 2"]}]}. 2 to 5 sections, 1 to 3 bullets each, one line per bullet. No advice, no "you should". Never repeat the same bullet twice. Skip a section entirely if there's no real pattern for it.`;
  try {
    const raw = await geminiText(system, `Recent check-ins (newest first):\n${lines}`, 1200);
    const read = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
    const sections = Array.isArray(read.sections) ? read.sections
      .filter((s) => s && s.title && Array.isArray(s.items) && s.items.length)
      .slice(0, 5)
      .map((s) => ({ title: String(s.title).slice(0, 80), items: s.items.map((i) => String(i).slice(0, 200)).slice(0, 3) })) : [];
    const content = JSON.stringify({ sections });
    db.prepare(`INSERT INTO notebook_reads (user_id, generated_at, checkin_count, content)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET generated_at = excluded.generated_at,
                checkin_count = excluded.checkin_count, content = excluded.content`)
      .run(req.user.id, new Date().toISOString(), checkins.length, content);
    res.json({ ok: true, read: JSON.parse(content) });
  } catch (e) {
    console.warn('notebook read failed:', e.message);
    res.status(500).json({ error: 'read_failed' });
  }
});

// Old routes fold into the notebook.
app.get('/history', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.redirect('/notebook');
});
app.get('/learn', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  res.redirect('/notebook');
});

// ---- Coach routes ----

// Hitters waiting for Bobby's approval, oldest first.
function pendingList(scope) {
  const sp = scopeParams(scope);
  return db
    .prepare(
      `SELECT u.id, u.email, u.athlete_name, u.first_name, u.last_name, u.created_at, u.player_type,
              c.name AS organization_name, t.name AS team_name
       FROM users u LEFT JOIN organizations c ON c.id = u.organization_id
                    LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.role = 'athlete' AND u.status = 'pending'
         AND (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY u.created_at ASC`
    )
    .all(...sp)
    .map((u) => ({
      ...u,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email,
    }));
}

// Number on the Approvals tab badge.
function setApprovalCount(req) {
  try {
    const sp = scopeParams(orgScope(req));
    req.user.approvalCount = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'athlete' AND status = 'pending' ${SCOPE_CLAUSE}`)
      .get(...sp).n;
  } catch {
    req.user.approvalCount = 0;
  }
}

// Per-hitter check-in stats for the coach views: total + last check-in.
// Organization coaches only ever see their own program's players; team
// coaches only their team.
function coachUserStats(scope, opts) {
  const sp = scopeParams(scope);
  const mineOnly = !!(opts && opts.mineOnly);
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.athlete_name, u.first_name, u.last_name, u.created_at, u.date_of_birth, u.player_type,
              u.notify_on_checkin, u.organization_id, u.remote_program_id, o.is_mine AS org_is_mine, o.name AS org_name, t.name AS team_name
       FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.role != 'coach' AND u.status = 'approved'
         AND (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
         ${mineOnly ? 'AND u.organization_id IN (SELECT id FROM organizations WHERE is_mine = 1)' : ''}
       ORDER BY u.created_at ASC`
    )
    .all(...sp);
  // Bobby's in-person program pins to the top of his player lists, always.
  if (opts && opts.inPersonFirst) {
    const rank = (u) => (u.org_name === 'Atkinson Hitting' ? 0 : u.org_is_mine === 1 ? 1 : 2);
    users.sort((a, b) => rank(a) - rank(b)); // stable: signup order kept within groups
  }
  const weekCutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  return users.map((u) => {
    const row = db
      .prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM checkins WHERE user_id = ?')
      .get(u.id);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email;
    const flag = u.notify_on_checkin;
    // Logging cadence for the coach's brief view: current streak + days logged of the last 7.
    const streak = streakData(u.id).streak || 0;
    let weekCount = 0;
    try {
      const wrows = db.prepare('SELECT created_at FROM checkins WHERE user_id = ? AND created_at >= ?').all(u.id, weekCutoff);
      const wdays = new Set();
      for (const r of wrows) { try { wdays.add(chiDay(r.created_at)); } catch (e) {} }
      weekCount = wdays.size;
    } catch (e) {}
    return { id: u.id, email: u.email, name, total: row.total, last: row.last, age: ageOn(u.date_of_birth), team: u.team_name || null,
      organizationId: u.organization_id || null, orgName: u.org_name || null, playerType: u.player_type || 'hitter',
      isRemote: u.remote_program_id != null,
      notifyOn: flag === 1 || (flag == null && u.org_is_mine === 1), streak, weekCount };
  });
}

// Analytics strip for the top of the Coach Dashboard: players in scope,
// check-ins today, check-ins + avg score over the last 7 Chicago days vs the
// prior 7 (trends), plus business stats for global coaches: organization
// count, revenue collected, and a per-organization player breakdown.
// Scope-aware: global coaches see everyone, org coaches their program,
// team coaches their team.
function coachAnalytics(scope, stats) {
  const sp = scopeParams(scope);
  const today = chiDay(new Date());
  const todayUTC = ymdToUTC(today);
  const weekStartUTC = ymdToUTC(chiDay(new Date(Date.now() - 6 * 864e5)));
  const prevStartUTC = ymdToUTC(chiDay(new Date(Date.now() - 13 * 864e5)));
  const since = new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const rows = db
    .prepare(
      `SELECT c.session_score, c.created_at FROM checkins c JOIN users u ON u.id = c.user_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
         AND c.created_at >= ?`
    )
    .all(...sp, since);
  let todayN = 0;
  let weekN = 0, prevN = 0;
  const weekScores = [], prevScores = [];
  for (const r of rows) {
    let day;
    try {
      day = ymdToUTC(chiDay(r.created_at));
    } catch {
      continue;
    }
    if (day === todayUTC) todayN++;
    if (day >= weekStartUTC) {
      weekN++;
      if (r.session_score != null) weekScores.push(r.session_score);
    } else if (day >= prevStartUTC) {
      prevN++;
      if (r.session_score != null) prevScores.push(r.session_score);
    }
  }
  const med1 = (xs) => {
    const m = medianScore(xs);
    return m != null ? Math.round(m * 10) / 10 : null;
  };
  const out = {
    players: stats.length,
    checkedInToday: todayN,
    checkinsWeek: weekN,
    checkinsPrevWeek: prevN,
    avgScore: med1(weekScores),
    avgScorePrev: med1(prevScores),
    orgs: null,
    orgCount: 0,
    revenueCents: 0,
  };
  if (!scope) {
    // Global coaches get the business view: every organization with its
    // player count, this week's check-ins, and deal/paid status, plus a
    // standalone row for players outside any organization.
    const orgRows = db.prepare('SELECT id, name, deal_cents, paid_cents FROM organizations ORDER BY name ASC').all();
    const breakdown = orgRows.map((o) => ({
      id: o.id,
      name: o.name,
      dealCents: o.deal_cents || 0,
      paidCents: o.paid_cents || 0,
      players: db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(o.id).n,
      weekCheckins: db
        .prepare(
          `SELECT COUNT(*) AS n FROM checkins c JOIN users u ON u.id = c.user_id
           WHERE u.organization_id = ? AND c.created_at >= ?`
        )
        .get(o.id, new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 19).replace('T', ' ')).n,
    }));
    const standalonePlayers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id IS NULL AND role = 'athlete' AND status = 'approved'").get().n;
    if (standalonePlayers) {
      breakdown.push({
        id: null, name: 'Standalone (no organization)', dealCents: 0, paidCents: 0,
        players: standalonePlayers,
        weekCheckins: db.prepare(
          `SELECT COUNT(*) AS n FROM checkins c JOIN users u ON u.id = c.user_id
           WHERE u.organization_id IS NULL AND c.created_at >= ?`
        ).get(new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 19).replace('T', ' ')).n,
      });
    }
    out.orgs = breakdown;
    out.orgCount = orgRows.length;
    out.revenueCents = orgRows.reduce((sum, o) => sum + (o.paid_cents || 0), 0);
  }
  return out;
}

// Set an organization's deal price and collected revenue (Bobby only).
// (Deal terms live on the full-terms route below, under Finances.)

// Finances page (Sep 16 2026): Bobby-only (global coach with edit rights).
// Everything worth knowing about money: collected, outstanding, pipeline,
// renewals, per-org deals, payment history, individual subscriptions.
function coachFinances() {
  const orgs = db.prepare(`SELECT o.*, COUNT(u.id) AS players
    FROM organizations o LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'athlete' AND u.status = 'approved'
    GROUP BY o.id ORDER BY o.name`).all();
  const collected = orgs.reduce((s, o) => s + (o.paid_cents || 0), 0);
  const outstanding = orgs.reduce((s, o) => s + Math.max((o.deal_cents || 0) - (o.paid_cents || 0), 0), 0);
  const pipeline = orgs.filter((o) => o.deal_status === 'prospect').reduce((s, o) => s + (o.deal_cents || 0), 0);
  const activeDeals = orgs.filter((o) => (o.deal_status === 'pilot' || o.deal_status === 'active') && o.deal_cents > 0).length;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const soonStr = soon.toISOString().slice(0, 10);
  const renewalsDue = orgs.filter((o) => o.deal_renewal && o.deal_renewal >= today && o.deal_renewal <= soonStr
    && (o.deal_status === 'pilot' || o.deal_status === 'active'));
  const payments = db.prepare(`SELECT p.*, o.name AS org_name FROM org_payments p
    JOIN organizations o ON o.id = p.organization_id
    ORDER BY p.paid_at DESC, p.id DESC LIMIT 100`).all();
  // Monthly collection trend: last 6 calendar months from the payment ledger.
  const monthly = [];
  const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = m.toISOString().slice(0, 7);
    const label = m.toLocaleString('en-US', { month: 'short' });
    const sum = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM org_payments WHERE substr(paid_at,1,7) = ?`).get(key).s;
    monthly.push({ key, label, cents: sum });
  }
  // Individual subscriptions (ready for when billing launches).
  const subs = db.prepare(`SELECT s.*, u.athlete_name, u.email FROM user_subscriptions s
    JOIN users u ON u.id = s.user_id WHERE s.status = 'active'`).all();
  const planMrr = { monthly: 1999, annual: Math.round(14999 / 12), founding: Math.round(4900 / 12) };
  const mrr = subs.reduce((sum, s) => sum + (planMrr[s.plan] || 0), 0);
  return { orgs, collected, outstanding, pipeline, activeDeals, renewalsDue, payments, monthly, subs, mrr };
}

function requireFinances(req, res, next) {
  const u = req.user;
  if (!u || u.role !== 'coach') return res.redirect('/login');
  if (u.canEdit && !u.organizationId) return next();
  return res.status(403).send('Forbidden');
}

app.get('/coach/finances', requireCoach, requireFinances, (req, res) => {
  res.send(views.coachFinancesPage(req.user, coachFinances()));
});

// Full deal terms per organization (Bobby-only). Paid/collected stays editable
// here too; recording a payment bumps paid_cents automatically.
app.post('/coach/organizations/:id/deal', requireCoach, requireFinances, (req, res) => {
  const c = db.prepare('SELECT id FROM organizations WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.redirect('/coach/finances');
  const dollars = (v) => {
    const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '';
  const status = ['prospect', 'pilot', 'active', 'past'].includes(req.body.status) ? req.body.status : '';
  // The Organizations page posts only deal/paid; the Finances page posts the
  // full terms. Only touch the pipeline fields when they're actually sent.
  const sets = ['deal_cents = ?', 'paid_cents = ?'];
  const vals = [dollars(req.body.deal), dollars(req.body.paid)];
  if ('status' in req.body) { sets.push('deal_status = ?'); vals.push(status); }
  if ('start' in req.body) { sets.push('deal_start = ?'); vals.push(date(req.body.start)); }
  if ('renewal' in req.body) { sets.push('deal_renewal = ?'); vals.push(date(req.body.renewal)); }
  if ('notes' in req.body) { sets.push('deal_notes = ?'); vals.push(String(req.body.notes || '').slice(0, 500)); }
  vals.push(c.id);
  db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.redirect('status' in req.body ? '/coach/finances' : '/coach/organizations');
});

// Record a payment: dated ledger row + bumps the org's collected total.
app.post('/coach/organizations/:id/payment', requireCoach, requireFinances, (req, res) => {
  const c = db.prepare('SELECT id FROM organizations WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.redirect('/coach/finances');
  const n = Math.round(Number(String(req.body.amount).replace(/[^0-9.]/g, '')) * 100);
  if (!Number.isFinite(n) || n <= 0) return res.redirect('/coach/finances');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.paid_at || '').trim())
    ? String(req.body.paid_at).trim() : new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO org_payments (organization_id, amount_cents, paid_at, method, note, created_at)
    VALUES (?,?,?,?,?,datetime('now'))`)
    .run(c.id, n, date, String(req.body.method || '').slice(0, 40), String(req.body.note || '').slice(0, 200));
  db.prepare('UPDATE organizations SET paid_cents = paid_cents + ? WHERE id = ?').run(n, c.id);
  res.redirect('/coach/finances');
});

// Hitters gone quiet: at least one check-in, but none in 3+ Chicago days.
function coachQuietHitters(stats) {
  const today = chiDay(new Date());
  return stats
    .filter((s) => {
      if (!s.last) return false;
      try {
        const daysAgo = Math.round((ymdToUTC(today) - ymdToUTC(chiDay(s.last))) / 864e5);
        return daysAgo >= 3;
      } catch {
        return false;
      }
    })
    .map((s) => ({ ...s, daysAgo: Math.round((ymdToUTC(today) - ymdToUTC(chiDay(s.last))) / 864e5) }))
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

// Remote program list for the Programs tab.
function remoteProgramList() {
  return db
    .prepare(
      `SELECT p.id, p.athlete_name, p.aliases, p.updated_at, p.lifting_program_id,
              lp.name AS lifting_name,
              (SELECT email FROM users WHERE remote_program_id = p.id LIMIT 1) AS user_email,
              instr(p.program_json, '"draft":true') AS is_draft
       FROM remote_programs p LEFT JOIN lifting_programs lp ON lp.id = p.lifting_program_id
       ORDER BY p.athlete_name`
    )
    .all();
}

// Coach Home: needs-your-attention — approvals, gone-quiet hitters, latest feed.
app.get('/coach', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const scope = orgScope(req);
  const sp = scopeParams(scope);
  const me = realUser(req);
  const isGlobal = !me.organizationId;
  const stats = coachUserStats(scope);
  // Bobby's dashboard is manage-first and short (Sep 23 2026): his own
  // programs only — Remote program first, then in-person. No everyone feed.
  const myStats = isGlobal ? coachUserStats(scope, { mineOnly: true }) : stats;
  const quiet = coachQuietHitters(isGlobal ? myStats : stats);
  const latest = db
    .prepare(
      `SELECT c.*, u.email AS athlete_email, u.organization_id, o.is_mine AS org_is_mine
       FROM checkins c JOIN users u ON u.id = c.user_id LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ${isGlobal ? 'AND o.is_mine = 1' : ''}
       ORDER BY c.created_at DESC LIMIT 6`
    )
    .all(...sp)
    .map((r) => ({ ...r, coachRestricted: viewerIsOrgCoach(req) && orgIsRestricted(r.organization_id, r.org_is_mine) }));
  const pending = pendingList(scope);
  const analytics = coachAnalytics(scope, stats);
  // Bobby's programs, split for the manage-first dashboard.
  // checkedToday powers the green status dot on each row.
  const todayStr = chiToday();
  const withToday = (p) => ({ ...p, checkedToday: !!p.last && (() => { try { return chiDay(p.last) === todayStr; } catch (e) { return false; } })() });
  const myGuys = isGlobal ? {
    remote: myStats.filter((p) => p.orgName === 'Atkinson Hitter Development System').map(withToday),
    inPerson: myStats.filter((p) => p.orgName === 'Atkinson Hitting').map(withToday),
  } : null;
  // Website application leads: global coaches only (Bobby's business).
  // invite_token = an unused questionnaire link already made for this lead.
  let leads = [];
  if (!me.organizationId) {
    leads = db.prepare(`SELECT l.*,
      (SELECT token FROM intake_invites WHERE lead_id = l.id AND used_at = '' ORDER BY id DESC LIMIT 1) AS invite_token
      FROM leads l ORDER BY submitted_at DESC LIMIT 25`).all();
  }
  // Bible Study opt-ins for Bobby's dashboard (Sep 23 2026): who wants the
  // daily verse. Global coaches only.
  let bibleOptIns = [];
  if (isGlobal) {
    try {
      bibleOptIns = db.prepare(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.email
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.role = 'athlete' AND u.status = 'approved' AND u.bible_study = 1
           AND (o.is_mine = 1 OR u.organization_id IS NULL)
         ORDER BY name LIMIT 50`
      ).all();
    } catch (e) { bibleOptIns = []; }
  }
  res.send(
    views.coachHomePage(me, quiet, latest, pending, userPushSubscriptions(req.user.id).length > 0, analytics, leads, myGuys, bibleOptIns)
  );
});

// Coach Hitters tab: search + athlete cards. Global coaches see "All Players"
// (Bobby's programs live under the My Players tab); org coaches see their own
// program's players under the same "Players" label as before.
app.get('/coach/hitters', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const me = realUser(req);
  const qorg = String(req.query.org || '');
  let players = coachUserStats(orgScope(req), { inPersonFirst: !me.organizationId });
  let title = me.organizationId ? 'Players' : 'All Players';
  let filterOrg = null;
  // Drill in from the Coach Dashboard's organization breakdown.
  if (!me.organizationId && qorg) {
    if (qorg === 'none') {
      players = players.filter((p) => p.organizationId == null);
      title = 'Standalone players';
      filterOrg = { id: 'none', name: 'Standalone players' };
    } else if (/^\d+$/.test(qorg)) {
      const o = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(Number(qorg));
      if (!o) return res.redirect('/coach/hitters');
      players = players.filter((p) => p.organizationId === o.id);
      title = o.name;
      filterOrg = { id: o.id, name: o.name };
    }
  }
  res.send(views.coachHittersPage(me, players, { title, tab: 'hitters', notifyButton: !me.organizationId, filterOrg }));
});

// Per-player log-alert toggle (Sep 17 2026, Bobby): full-access global coach
// only (Cam 403s). Flips the athlete's explicit preference: effectively-on
// becomes 0 (never), effectively-off becomes 1 (always). Works for any
// athlete, not just his program guys.
app.post('/coach/player/:id/notify-checkin', requireGlobalCoachAny, requireCoach, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT notify_on_checkin FROM users WHERE id = ? AND role = 'athlete'").get(id);
  if (!row) return res.status(404).send('Not found');
  const effectiveOn = row.notify_on_checkin === 1 || (row.notify_on_checkin == null && isMyProgramPlayer(id));
  db.prepare('UPDATE users SET notify_on_checkin = ? WHERE id = ?').run(effectiveOn ? 0 : 1, id);
  const back = typeof req.body.back === 'string' && req.body.back.startsWith('/coach/') ? req.body.back : '/coach/my-players';
  res.redirect(back);
});

// My Players tab (Sep 17 2026): Bobby's own programs (is_mine orgs) up front.
// Global coaches only — org coaches already have a scoped Players tab.
app.get('/coach/my-players', requireGlobalCoachAny, (req, res) => {
  setApprovalCount(req);
  res.send(
    views.coachHittersPage(realUser(req), coachUserStats(orgScope(req), { mineOnly: true, inPersonFirst: true }), {
      title: 'My Players',
      tab: 'my-players',
      empty: 'No players in your programs yet.',
      notifyButton: true,
    })
  );
});

// Coach compose (Sep 17 2026, redesign): clean "New message" screen. The old
// always-expanded checklist on My Players is gone — broadcasting lives here.
// Remote-guys only (Sep 23 2026): messaging is scoped to athletes with a
// remote program, matching the thread/reply gate.

// Flip "My program" on an org (Bobby-only, same guard as the deal route):
// powers the My Players tab. Colleges and travel programs stay off.
app.post('/coach/organizations/:id/mine', requireCoach, requireFinances, (req, res) => {
  const c = db.prepare('SELECT id, is_mine FROM organizations WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  db.prepare('UPDATE organizations SET is_mine = ? WHERE id = ?').run(c.is_mine ? 0 : 1, c.id);
  res.redirect('/coach/organizations');
});

// Coach Programs tab: remote programs.
app.get('/coach/programs', requireGlobalCoachAny, (req, res) => {
  setApprovalCount(req);
  const intakes = db
    .prepare(
      `SELECT i.id, i.created_at, u.first_name, u.last_name, u.email, u.status,
              u.remote_program_id, u.waiver_signed_at,
              instr(p.program_json, '"draft":true') AS is_draft
       FROM intake_responses i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN remote_programs p ON p.id = u.remote_program_id
       ORDER BY i.id DESC LIMIT 20`
    )
    .all();
  res.send(views.coachProgramsPage(realUser(req), remoteProgramList(), { url: intakeLink(req), intakes }));
});

// Sample personalized hitting program (Sep 23 2026) — Bobby wanted to see
// what a questionnaire-built hitting program looks like. Coach-only, sample data.
app.get('/coach/sample-hitting', requireGlobalCoachAny, (req, res) => {
  setApprovalCount(req);
  const { SAMPLE_HITTING_PROGRAM } = require('./sample_hitting.js');
  res.send(views.sampleHittingPage(realUser(req), SAMPLE_HITTING_PROGRAM));
});

// Flip a coach between full access and view-only. Full coaches only, never
// yourself, and never the last full-access coach.
app.post('/coach/coaches/toggle', requireCoach, (req, res) => {
  const id = Number(req.body.id);
  const me = realUser(req);
  const target = db.prepare("SELECT id, can_edit FROM users WHERE id = ? AND role = 'coach' AND organization_id IS NULL").get(id);
  if (!target || target.id === me.id) return res.redirect('/settings');
  if (target.can_edit !== 0) {
    const fullCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'coach' AND organization_id IS NULL AND can_edit != 0").get().n;
    if (fullCount <= 1) return res.redirect('/settings');
  }
  db.prepare('UPDATE users SET can_edit = ? WHERE id = ?').run(target.can_edit !== 0 ? 0 : 1, target.id);
  res.redirect('/settings');
});

// Approvals tab: approve or decline waiting hitters right here.
app.get('/coach/approvals', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const sp = scopeParams(orgScope(req));
  const waitingOnParent = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'athlete' AND status = 'pending_parent' ${SCOPE_CLAUSE}`)
    .get(...sp).n;
  res.send(views.coachApprovalsPage(realUser(req), pendingList(orgScope(req)), waitingOnParent));
});

// Manage an organization's teams and coaches: Bobby (full global coach), or
// the program's own organization-level coaches (team_id NULL) — the program
// is the master account. Team coaches and Cam (view-only) are blocked.
function requireOrgManager(req, res, next) {
  const u = realUser(req);
  if (!u) return res.redirect('/login');
  if (u.role !== 'coach') return res.status(403).send('Forbidden');
  const orgId = Number(req.params.id);
  if (u.canEdit && !u.organizationId) return next();
  if (u.organizationId === orgId && !u.teamId) return next();
  return res.status(403).send('Forbidden');
}

function organizationTeams(orgId) {
  return db.prepare('SELECT * FROM teams WHERE organization_id = ? ORDER BY name ASC').all(orgId).map((t) => ({
    ...t,
    playerCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'athlete'").get(t.id).n,
    coaches: db.prepare("SELECT id, email, first_name, last_name FROM users WHERE team_id = ? AND role = 'coach' ORDER BY created_at ASC").all(t.id),
  }));
}

// ---- Organizations (Sep 2026): Bobby's B2B surface ----
// Add a organization, hand its signup code to the program's coaches, flip Talk to
// Skip per organization, and create view-only coach accounts scoped to that organization.
// Organization-level coaches see only their own program here so they can run
// their teams themselves.
app.get('/coach/organizations', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const me = realUser(req);
  const onlyOrgId = me.organizationId || null;
  const rows = onlyOrgId
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').all(onlyOrgId)
    : db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();
  // One roster query for every visible org (no N+1 per card). Team-scoped
  // coaches only ever see their own team's players.
  const orgIds = rows.map((r) => r.id);
  let roster = [];
  if (orgIds.length) {
    const ph = orgIds.map(() => '?').join(',');
    let sql = `SELECT id, first_name, last_name, athlete_name, email, organization_id, team_id, remote_program_id
               FROM users WHERE organization_id IN (${ph}) AND role = 'athlete'`;
    const params = [...orgIds];
    if (me.teamId) {
      sql += ' AND team_id = ?';
      params.push(me.teamId);
    }
    sql += ' ORDER BY first_name ASC, last_name ASC';
    roster = db.prepare(sql).all(...params);
  }
  const rosterByOrg = new Map();
  for (const p of roster) {
    if (!rosterByOrg.has(p.organization_id)) rosterByOrg.set(p.organization_id, []);
    rosterByOrg.get(p.organization_id).push(p);
  }
  const organizations = rows
    .map((c) => {
      const isFounder = c.name === FOUNDER_ORG_NAME;
      const org = {
        ...c,
        isFounder,
        playerCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(c.id).n,
        coaches: db.prepare("SELECT id, email, first_name, last_name FROM users WHERE organization_id = ? AND team_id IS NULL AND role = 'coach' ORDER BY created_at ASC").all(c.id),
        teams: organizationTeams(c.id),
        roster: rosterByOrg.get(c.id) || [],
      };
      return org;
    })
    // Bobby's org pinned at the top, above every other org.
    .sort((a, b) => Number(b.isFounder) - Number(a.isFounder) || a.name.localeCompare(b.name));
  res.send(views.coachOrganizationsPage(me, organizations, req.query.error || null, req.query.added || null));
});

app.post('/coach/organizations/add', requireCoach, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return res.redirect('/coach/organizations?error=' + encodeURIComponent('Give the organization a name.'));
  const code = makeOrganizationCode(name);
  const info = db.prepare('INSERT INTO organizations (name, code, skip_enabled, created_at) VALUES (?, ?, 0, ?)').run(name, code, new Date().toISOString());
  res.redirect('/coach/organizations?added=' + info.lastInsertRowid);
});

app.post('/coach/organizations/:id/skip', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  db.prepare('UPDATE organizations SET skip_enabled = ? WHERE id = ?').run(c.skip_enabled ? 0 : 1, c.id);
  res.redirect('/coach/organizations');
});

// Organization branding (Sep 17 2026): Bobby or the program's own org-level
// coaches set the logo + colors their players see. Colors are strict hex;
// the logo goes through multer's image-only filter (2MB cap).
app.post('/coach/organizations/:id/brand', requireOrgManager, (req, res) => {
  logoUpload.single('logo')(req, res, (err) => {
    const c = getOrganization(Number(req.params.id));
    if (!c) return res.redirect('/coach/organizations');
    const fail = (msg) => {
      if (req.file) deleteOrgLogoFile(req.file.filename);
      return res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
    };
    if (err) return fail(err.message || 'Logo upload failed.');
    const primary = String(req.body.primary_color || '').trim();
    const accent = String(req.body.accent_color || '').trim();
    if (primary && !validHexColor(primary)) return fail('Primary color must look like #5E0009.');
    if (accent && !validHexColor(accent)) return fail('Accent color must look like #EB002B.');
    let logoPath = c.logo_path || '';
    if (req.file) {
      deleteOrgLogoFile(logoPath);
      logoPath = req.file.filename;
    }
    db.prepare('UPDATE organizations SET logo_path = ?, primary_color = ?, accent_color = ? WHERE id = ?')
      .run(logoPath, primary, accent, c.id);
    res.redirect('/coach/organizations');
  });
});

app.post('/coach/organizations/:id/brand/logo/remove', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (c && c.logo_path) {
    deleteOrgLogoFile(c.logo_path);
    db.prepare('UPDATE organizations SET logo_path = ? WHERE id = ?').run('', c.id);
  }
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/coaches/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!firstName || !lastName) return fail('Coach needs a first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail('An account with that email already exists.');
  db.prepare(
    "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit, organization_id, team_id) VALUES (?, ?, 'coach', ?, ?, ?, ?, 'approved', 0, ?, NULL)"
  ).run(email, bcrypt.hashSync(password, 12), `${firstName} ${lastName}`, firstName, lastName, new Date().toISOString(), c.id);
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/coaches/remove', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const coachId = Number(req.body.coach_id);
  if (c && coachId) {
    const del = db.transaction(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(coachId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(coachId);
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'coach' AND organization_id = ? AND team_id IS NULL").run(coachId, c.id);
    });
    del();
  }
  res.redirect('/coach/organizations');
});

// ---- Teams inside an organization (Sep 2026) ----
// The program is the master account; each team gets its own signup code and
// its own coaches, who see only their team's players. Organization-level
// coaches (or Bobby) manage teams here.
app.post('/coach/organizations/:id/teams/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return fail('Give the team a name.');
  const code = makeTeamCode(name);
  db.prepare('INSERT INTO teams (organization_id, name, code, created_at) VALUES (?, ?, ?, ?)').run(c.id, name, code, new Date().toISOString());
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/teams/:teamId/coaches/add', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  const fail = (msg) => res.redirect('/coach/organizations?error=' + encodeURIComponent(msg));
  const firstName = String(req.body.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const lastName = String(req.body.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!firstName || !lastName) return fail('Coach needs a first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email doesn\u2019t look right.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail('An account with that email already exists.');
  db.prepare(
    "INSERT INTO users (email, password_hash, role, athlete_name, first_name, last_name, created_at, status, can_edit, organization_id, team_id) VALUES (?, ?, 'coach', ?, ?, ?, ?, 'approved', 0, ?, ?)"
  ).run(email, bcrypt.hashSync(password, 12), `${firstName} ${lastName}`, firstName, lastName, new Date().toISOString(), c.id, t.id);
  res.redirect('/coach/organizations');
});

app.post('/coach/organizations/:id/teams/:teamId/coaches/remove', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  const coachId = Number(req.body.coach_id);
  if (c && t && t.organization_id === c.id && coachId) {
    const del = db.transaction(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(coachId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(coachId);
      db.prepare("DELETE FROM users WHERE id = ? AND role = 'coach' AND team_id = ?").run(coachId, t.id);
    });
    del();
  }
  res.redirect('/coach/organizations');
});

// Confirm page before deleting a team: its players stay in the program
// (unassigned to any team), the team's coach accounts are removed.
app.get('/coach/organizations/:id/teams/:teamId/delete', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  setApprovalCount(req);
  const playerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'athlete'").get(t.id).n;
  const coachCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'coach'").get(t.id).n;
  res.send(views.coachTeamDeletePage(realUser(req), c, t, playerCount, coachCount));
});

app.post('/coach/organizations/:id/teams/:teamId/delete', requireOrgManager, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  const t = getTeam(req.params.teamId);
  if (!c || !t || t.organization_id !== c.id) return res.redirect('/coach/organizations');
  const del = db.transaction(() => {
    const coachIds = db.prepare("SELECT id FROM users WHERE team_id = ? AND role = 'coach'").all(t.id).map((r) => r.id);
    for (const id of coachIds) {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
    }
    db.prepare("DELETE FROM users WHERE team_id = ? AND role = 'coach'").run(t.id);
    // Players keep their accounts and their place in the program — they just
    // aren't on this team anymore.
    db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(t.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
  });
  del();
  res.redirect('/coach/organizations');
});

// Confirm page before deleting a organization: players go standalone, the
// organization's coach accounts are removed (with their push subscriptions).
app.get('/coach/organizations/:id/delete', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  setApprovalCount(req);
  const playerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'athlete'").get(c.id).n;
  const coachCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'coach'").get(c.id).n;
  const teamCount = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE organization_id = ?').get(c.id).n;
  res.send(views.coachOrganizationDeletePage(realUser(req), c, playerCount, coachCount, teamCount));
});

app.post('/coach/organizations/:id/delete', requireCoach, (req, res) => {
  const c = getOrganization(Number(req.params.id));
  if (!c) return res.redirect('/coach/organizations');
  const del = db.transaction(() => {
    const coachIds = db.prepare("SELECT id FROM users WHERE organization_id = ? AND role = 'coach'").all(c.id).map((r) => r.id);
    for (const id of coachIds) {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
    }
    db.prepare("DELETE FROM users WHERE organization_id = ? AND role = 'coach'").run(c.id);
    db.prepare('UPDATE users SET organization_id = NULL, team_id = NULL WHERE organization_id = ?').run(c.id);
    db.prepare('DELETE FROM teams WHERE organization_id = ?').run(c.id);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(c.id);
  });
  del();
  res.redirect('/coach/organizations');
});

// Approve a waiting hitter — they can log in from here on.
app.post('/coach/approve/:id', requireCoach, (req, res) => {
  const u = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name FROM users WHERE id = ? AND role = 'athlete' AND status = 'pending'")
    .get(req.params.id);
  if (u) {
    db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(u.id);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.athlete_name || u.email;
    sendApprovalEmail(req, u.email, name).catch((e) =>
      console.warn('approval email failed:', e.message)
    );
  }
  res.redirect('/coach/approvals');
});

// Decline a waiting hitter — removes the signup entirely.
app.post('/coach/decline/:id', requireCoach, (req, res) => {
  const u = db
    .prepare("SELECT id FROM users WHERE id = ? AND role = 'athlete' AND status = 'pending'")
    .get(req.params.id);
  if (u) deleteHitter(u.id);
  res.redirect('/coach/approvals');
});

app.get('/coach/user/:email', requireCoachAny, (req, res) => {
  setApprovalCount(req);
  const em = (req.params.email || '').toLowerCase();
  const sp = scopeParams(orgScope(req));
  const user = db
    .prepare(`SELECT id, email, athlete_name, first_name, last_name, player_type, organization_id FROM users WHERE email = ? AND role != 'coach' ${SCOPE_CLAUSE}`)
    .get(em, ...sp);
  if (!user) return res.status(404).send('Unknown user.');
  const uOrg = user.organization_id
    ? db.prepare('SELECT is_mine FROM organizations WHERE id = ?').get(user.organization_id)
    : null;
  const restricted = viewerIsOrgCoach(req) && orgIsRestricted(user.organization_id, uOrg && uOrg.is_mine);
  const rows = db
    .prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  if (restricted) rows.forEach((r) => { r.coachRestricted = true; });
  const name = user.athlete_name || user.email;
  const thread = restricted
    ? []
    : db
        .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
        .all(user.id)
        .reverse();
  const pt = user.player_type || 'hitter';
  // Bobby (Sep 23 2026): pass remote program ID so the player page can link to Edit Hitting Program / Lifting.
  let remoteProgramId = null;
  let hasLifting = false;
  try {
    const rp = db.prepare('SELECT id, lifting_program_id FROM remote_programs WHERE LOWER(user_email) = LOWER(?)').get(em);
    if (rp) {
      remoteProgramId = rp.id;
      hasLifting = !!rp.lifting_program_id;
    }
  } catch (e) { /* ignore */ }
  res.send(views.coachUser(realUser(req), name, rows, restricted ? null : whatWorksData(name, user.id), thread, user.email, brain.listMemory(db, user.id), getRoutine(user.id), pt, pt === 'hitter' ? null : throwingSummary(user.id), isRemotePlayer(user.id) ? user.id : null, { restricted, viewAsId: user.id, remoteProgramId, hasLifting }));
});

// Throwing summary for a pitcher's or two-way player's coach view: session
// mix, average command, workload, and velo over the last 30 throwing sessions.
function throwingSummary(userId) {
  const rows = db
    .prepare(
      `SELECT pitch_session_type, command, pitch_count, velo_max
       FROM checkins
       WHERE user_id = ? AND session_kind IN ('pitching', 'combined')
         AND pitch_session_type IS NOT NULL AND pitch_session_type <> ''
       ORDER BY created_at DESC LIMIT 30`
    )
    .all(userId);
  if (!rows.length) return null;
  const byType = {};
  let cmdSum = 0, cmdN = 0, pitchSum = 0, veloSum = 0, veloN = 0;
  for (const r of rows) {
    byType[r.pitch_session_type] = (byType[r.pitch_session_type] || 0) + 1;
    if (r.command != null) { cmdSum += r.command; cmdN++; }
    if (r.pitch_count != null) pitchSum += r.pitch_count;
    if (r.velo_max != null) { veloSum += r.velo_max; veloN++; }
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    sessions: rows.length,
    byType,
    avgCommand: cmdN ? r1(cmdSum / cmdN) : null,
    totalPitches: pitchSum,
    avgVelo: veloN ? r1(veloSum / veloN) : null,
  };
}

// Skip's memory of a hitter: Bobby's durable notes on what works for them.
app.post('/coach/user/:email/memory', requireCoach, (req, res) => {
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (user) brain.addMemory(db, user.id, req.body.fact);
  res.redirect(`/coach/user/${encodeURIComponent(em)}`);
});
app.post('/coach/user/:email/memory/:id/delete', requireCoach, (req, res) => {
  brain.deleteMemory(db, Number(req.params.id));
  const em = (req.params.email || '').toLowerCase();
  res.redirect(`/coach/user/${encodeURIComponent(em)}`);
});

// Delete a hitter from the platform: confirm page first, then the delete.
app.get('/coach/user/:email/delete', requireCoach, (req, res) => {
  setApprovalCount(req);
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id, email, athlete_name, first_name, last_name FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (!user) return res.status(404).send('Unknown user.');
  const n = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(user.id).n;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.athlete_name || user.email;
  res.send(views.coachDeleteHitterPage(realUser(req), user, name, n));
});

app.post('/coach/user/:email/delete', requireCoach, (req, res) => {
  const em = (req.params.email || '').toLowerCase();
  const user = db
    .prepare("SELECT id FROM users WHERE email = ? AND role != 'coach'")
    .get(em);
  if (user) deleteHitter(user.id);
  res.redirect('/coach');
});

// Remove a hitter and everything they created: check-ins, chats, routine, tokens.
function deleteHitter(userId) {
  // Every user-scoped table must go — including pre_checkins (Bobby's rule:
  // a deleted hitter leaves nothing behind).
  for (const t of ['chat_messages', 'checkins', 'routine_drills', 'password_reset_tokens', 'hitter_memory', 'learning_notes', 'study_players', 'pre_checkins', 'push_subscriptions', 'mental_keys', 'mental_baseline', 'user_subscriptions']) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// Coach-only backup: download every check-in as JSON.
app.get('/coach/export', requireCoachAny, (req, res) => {  const sp = scopeParams(orgScope(req));
  const rows = db
    .prepare(
      `SELECT c.id, c.athlete_name, u.email, u.organization_id, o.is_mine AS org_is_mine,
              c.created_at, c.environment, c.drills_done,
              c.feel, c.confidence, c.focus, c.session_score, c.score_tier,
              c.session_notes, c.what_worked, c.whats_next,
              c.skip_journal_score, c.skip_journal_note, c.skip_rated_at
       FROM checkins c JOIN users u ON u.id = c.user_id LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE (? IS NULL OR u.organization_id = ?) AND (? IS NULL OR u.team_id = ?)
       ORDER BY c.created_at ASC`
    )
    .all(...sp)
    .map((r) => {
      // College-org privacy: the export carries the brief summary only —
      // journal words and feel sliders stay private. Only applies when the
      // downloading coach is an org-scoped coach; Bobby/global see all.
      const { organization_id, org_is_mine, ...rest } = r;
      const out = { ...rest, drills_done: safeParseDrills(r.drills_done) };
      if (viewerIsOrgCoach(req) && orgIsRestricted(organization_id, org_is_mine)) {
        out.feel = null;
        out.confidence = null;
        out.focus = null;
        out.session_notes = null;
        out.what_worked = null;
        out.whats_next = null;
      }
      return out;
    });
  res.setHeader('Content-Disposition', 'attachment; filename="skip-checkins-export.json"');
  res.json({ exported_at: new Date().toISOString(), checkins: rows });
});

// ---- Train Skip (coach HQ) ----
// Bobby talks to Skip directly to train him, keeps coaching notes that get
// injected into every hitter's Skip prompt, and reviews Skip's conversations
// with each hitter.

app.get('/coach/skip', requireGlobalCoachAny, (req, res) => {
  setApprovalCount(req);
  const entries = brain.listEntries(db);
  const hitters = db
    .prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.athlete_name,
              COUNT(m.id) AS n, MAX(m.created_at) AS last
       FROM users u LEFT JOIN chat_messages m ON m.user_id = u.id
       WHERE u.role != 'coach'
       GROUP BY u.id HAVING n > 0 ORDER BY last DESC`
    )
    .all()
    .map((h) => ({
      ...h,
      name: [h.first_name, h.last_name].filter(Boolean).join(' ') || h.athlete_name || h.email,
      lastSkip: (
        db
          .prepare(
            "SELECT content FROM chat_messages WHERE user_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"
          )
          .get(h.id) || {}
      ).content,
    }));
  const thread = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .all(req.user.id)
    .reverse();
  res.send(views.coachSkipPage(realUser(req), entries, hitters, thread, !!process.env.LLM_API_KEY, req.query.saved === '1', brain.listProposals(db)));
});

// ---- Skip's Brain: Bobby's structured coaching library ----
// Add a new brain entry (rule, approach, cue, diagnosis, example, note).
app.post('/coach/skip/brain', requireCoach, (req, res) => {
  try {
    brain.addEntry(db, {
      type: req.body.type,
      title: req.body.title,
      body: req.body.body,
      tags: req.body.tags,
    });
  } catch (e) { /* bad type — ignore, stay on the page */ }
  res.redirect('/coach/skip?saved=1');
});

// Edit an entry's title/body/tags.
app.post('/coach/skip/brain/:id', requireCoach, (req, res) => {
  brain.updateEntry(db, Number(req.params.id), {
    title: req.body.title,
    body: req.body.body,
    tags: req.body.tags,
  });
  res.redirect('/coach/skip?saved=1');
});

// Archive or restore an entry (archived entries are never injected).
app.post('/coach/skip/brain/:id/archive', requireCoach, (req, res) => {
  brain.setEntryActive(db, Number(req.params.id), req.body.active === '1');
  res.redirect('/coach/skip?saved=1');
});

// Log a correction: what the hitter said, what Skip got wrong, what he
// should have said. Saved as an example entry so the fix sticks.
app.post('/coach/skip/correction', requireCoach, (req, res) => {
  const hitter = (req.body.hitter_said || '').trim().slice(0, 500);
  const wrong = (req.body.skip_said || '').trim().slice(0, 500);
  const right = (req.body.should_say || '').trim().slice(0, 1000);
  if (right) {
    const title = (hitter || 'Correction').slice(0, 80);
    const body = `Hitter: "${hitter || '(not specified)'}"\nWrong: "${wrong || '(not specified)'}"\nRight: "${right}"`;
    brain.addEntry(db, { type: 'example', title, body, tags: 'correction' });
  }
  res.redirect('/coach/skip?saved=1');
});

// Propose a Brain entry. Any coach (including view-only) can propose; the
// entry goes live only after EVERY coach has approved it. The proposer
// auto-approves on submit. The other coach gets a push so nothing stalls.
app.post('/coach/skip/propose', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  try {
    const id = brain.createProposal(db, {
      type: req.body.type,
      title: req.body.title,
      body: req.body.body,
      tags: req.body.tags,
      proposedBy: me.id,
    });
    pushToCoachesExcept(me.id, 'New Skip Brain proposal', `${me.displayName} proposed "${String(req.body.title || '').slice(0, 60)}" — tap to review.`, '/coach/skip');
    console.log(`brain proposal ${id} by ${me.email}`);
  } catch (e) { /* bad type — ignore, stay on the page */ }
  res.redirect('/coach/skip?saved=1');
});

// Propose a correction as a Brain example (view-only coaches use this;
// full coaches keep the direct correction form above).
app.post('/coach/skip/propose-correction', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  const hitter = (req.body.hitter_said || '').trim().slice(0, 500);
  const wrong = (req.body.skip_said || '').trim().slice(0, 500);
  const right = (req.body.should_say || '').trim().slice(0, 1000);
  if (right) {
    const title = (hitter || 'Correction').slice(0, 80);
    const body = `Hitter: "${hitter || '(not specified)'}"\nWrong: "${wrong || '(not specified)'}"\nRight: "${right}"`;
    brain.createProposal(db, { type: 'example', title, body, tags: 'correction', proposedBy: me.id });
    pushToCoachesExcept(me.id, 'New Skip correction proposal', `${me.displayName} proposed a correction — tap to review.`, '/coach/skip');
  }
  res.redirect('/coach/skip?saved=1');
});

// Approve a proposal. When every coach has approved, the entry publishes
// to Skip's Brain and the proposer gets a push.
app.post('/coach/skip/proposals/:id/approve', requireGlobalCoachAny, (req, res) => {
  const me = realUser(req);
  const result = brain.approveProposal(db, Number(req.params.id), me.id);
  if (result === 'live') {
    const p = db.prepare('SELECT proposed_by, title FROM brain_proposals WHERE id = ?').get(Number(req.params.id));
    if (p && p.proposed_by !== me.id) {
      pushToUser(p.proposed_by, 'Proposal approved — live in Skip\u2019s Brain', `"${String(p.title).slice(0, 60)}" now teaches Skip.`, '/coach/skip');
    }
  }
  res.redirect('/coach/skip');
});

// Reject a proposal (Bobby only). The proposer can revise and propose again.
app.post('/coach/skip/proposals/:id/reject', requireCoach, (req, res) => {
  brain.rejectProposal(db, Number(req.params.id));
  res.redirect('/coach/skip');
});

// Coach chats with Skip directly (stored as the coach's own thread).
app.post('/api/coach/chat', requireCoach, async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep it under 2000 characters.' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user, message, { coachMode: true });
    db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'assistant', reply, new Date().toISOString());
    res.json({ reply });
  } catch (err) {
    if (err.code === 'chat_not_configured') {
      return res.status(503).json({ error: "Skip's chat isn't switched on yet — check back soon." });
    }
    if (err.code === 'llm_rate_limit') {
      return res.status(429).json({ error: "Skip's getting a lot of traffic right now — try again in a minute." });
    }
    console.error('coach chat error:', err.message);
    return res.status(502).json({ error: 'Skip is having trouble right now. Try again in a bit.' });
  }
});

// ---- Ingestion API for the AI assistant ----
//
// GET /api/checkins?since=<ISO timestamp>
// POST /api/checkins/:id/skip-rating   { score: 1-10, note: "..." }
// Auth: x-api-key header or ?key= query param, must equal SKIP_API_KEY.
// Returns: { "checkins": [ { id, athlete_name, email, created_at,
//   environment, drills_done[], feel, confidence, focus, session_score,
//   score_tier, session_notes, what_worked, whats_next,
//   skip_journal_score, skip_journal_note, skip_rated_at }, ... ] }
// ordered oldest-first.

const CHECKIN_COLS =
  'c.id, c.athlete_name, u.email, c.created_at, c.environment, c.drills_done, c.feel, c.confidence, c.focus, c.difficulty, c.session_score, c.score_tier, c.session_notes, c.what_worked, c.whats_next, c.skip_journal_score, c.skip_journal_note, c.skip_rated_at';

function safeParseDrills(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function checkApiKey(req, res) {
  const apiKey = process.env.SKIP_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API not configured on server' });
    return false;
  }
  const provided = req.get('x-api-key') || req.query.key;
  if (provided !== apiKey) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/checkins', (req, res) => {
  if (!checkApiKey(req, res)) return;
  const { since } = req.query;
  let rows;
  if (since !== undefined) {
    if (Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'since must be an ISO timestamp' });
    }
    rows = db
      .prepare(
        `SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id
         WHERE c.created_at > ? ORDER BY c.created_at ASC LIMIT 1000`
      )
      .all(since);
  } else {
    rows = db
      .prepare(
        `SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id
         ORDER BY c.created_at ASC LIMIT 1000`
      )
      .all();
  }
  res.json({
    checkins: rows.map((r) => ({ ...r, drills_done: safeParseDrills(r.drills_done) })),
  });
});

// POST /api/checkins/:id/skip-rating — the AI assistant (Skip) posts its read
// of a hitter's journal after reading session_notes / what_worked.
// Body: { "note": "<2-3 sentence summary in Skip's voice>", "score": <optional 1-10> }.
// Sets skip_journal_note, skip_rated_at (now, ISO); score optional, no longer shown in-app.
// 401 = bad key, 404 = unknown check-in id, 400 = bad body.
app.post('/api/checkins/:id/skip-rating', (req, res) => {
  if (!checkApiKey(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: 'check-in not found' });
  }
  const existing = db.prepare('SELECT id FROM checkins WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'check-in not found' });

  const b = req.body || {};
  const scoreRaw = b.score === undefined || b.score === null ? null : Number(b.score);
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (scoreRaw !== null && (!Number.isFinite(scoreRaw) || scoreRaw < 1 || scoreRaw > 10)) {
    return res.status(400).json({ error: 'score must be a number from 1 to 10' });
  }
  if (!note) {
    return res.status(400).json({ error: 'note must be a non-empty string' });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: 'note must be 500 characters or fewer' });
  }

  const ratedAt = new Date().toISOString();
  db.prepare(
    `UPDATE checkins SET skip_journal_score = ?, skip_journal_note = ?, skip_rated_at = ? WHERE id = ?`
  ).run(scoreRaw, note, ratedAt, id);

  const row = db
    .prepare(`SELECT ${CHECKIN_COLS} FROM checkins c JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
    .get(id);
  res.json({ ...row, drills_done: safeParseDrills(row.drills_done) });
});

// POST /api/remote-programs/extend-month — roll a remote athlete's program
// date_range forward one month when their monthly payment is confirmed.
// Body: { "athlete": "<name>" }. Auth: SKIP_API_KEY (x-api-key header or ?key=).
// New range: start = old end date, end = old end + 1 calendar month (day clamped
// to the month's length). Returns { athlete_name, old_range, new_range }.
// 400 = missing athlete, 401 = bad key, 404 = unknown athlete,
// 422 = date_range missing or unparseable.
function clampDay(year, monthIdx, day) {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(day, last);
}
function addOneMonthClamped(d) {
  const r = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  r.setDate(clampDay(r.getFullYear(), r.getMonth(), d.getDate()));
  return r;
}
function fmtMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
app.post('/api/remote-programs/extend-month', (req, res) => {
  if (!checkApiKey(req, res)) return;
  const name = String((req.body || {}).athlete || '').trim();
  if (!name) return res.status(400).json({ error: 'athlete is required' });
  const progId = remoteProgramForName(name);
  if (!progId) return res.status(404).json({ error: 'no remote program for athlete' });
  const row = db.prepare('SELECT athlete_name, program_json FROM remote_programs WHERE id = ?').get(progId);
  let prog = {};
  try {
    prog = JSON.parse(row.program_json || '{}') || {};
  } catch {
    prog = {};
  }
  const oldRange = String(prog.date_range || '').trim();
  const m = oldRange.match(/(\d{1,2})\/(\d{1,2})\s*[–—-]\s*(\d{1,2})\/(\d{1,2})/);
  if (!m) return res.status(422).json({ error: 'date_range missing or unparseable', date_range: oldRange });
  const [, , , eM, eD] = m.map(Number);
  if (eM < 1 || eM > 12 || eD < 1 || eD > 31) {
    return res.status(422).json({ error: 'date_range has invalid end date', date_range: oldRange });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const SIX_MONTHS = 1000 * 60 * 60 * 24 * 183;
  let end = new Date(today.getFullYear(), eM - 1, clampDay(today.getFullYear(), eM - 1, eD));
  if (end - today > SIX_MONTHS) end.setFullYear(end.getFullYear() - 1);
  if (today - end > SIX_MONTHS) end.setFullYear(end.getFullYear() + 1);
  const newEnd = addOneMonthClamped(end);
  const newRange = `${fmtMD(end)}–${fmtMD(newEnd)}`;
  prog.date_range = newRange;
  db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(prog),
    new Date().toISOString(),
    progId
  );
  res.json({ athlete_name: row.athlete_name, old_range: oldRange, new_range: newRange });
});

// POST /api/remote-programs/link — link a signed-up athlete to their remote
// program (and to the Remote Development org when they're orgless).
// Body: { "athlete": "<name>" }. Auth: SKIP_API_KEY (x-api-key header or ?key=).
// Name matching mirrors the boot backfill (first + last, case-insensitive),
// with a loose fallback when the signup name doesn't match exactly.
// Returns { ok, email, status, program, org_joined, already_linked }.
// 400 = missing athlete, 401 = bad key, 404 = no program or no account.
app.post('/api/remote-programs/link', (req, res) => {
  if (!checkApiKey(req, res)) return;
  const name = String((req.body || {}).athlete || '').trim();
  if (!name) return res.status(400).json({ error: 'athlete is required' });
  const progId = remoteProgramForName(name);
  if (!progId) return res.status(404).json({ error: 'no remote program for athlete' });
  const prog = db.prepare('SELECT athlete_name FROM remote_programs WHERE id = ?').get(progId);
  const target = name.toLowerCase();
  const athletes = db
    .prepare(
      `SELECT id, email, first_name, last_name, status, remote_program_id, organization_id
       FROM users WHERE role = 'athlete'`
    )
    .all();
  const full = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim().toLowerCase();
  let user = athletes.find((u) => full(u) === target);
  if (!user) {
    // Loose fallback: same first name and last name contained (handles
    // middle names, suffixes, "Sam"/"Samuel" style mismatches).
    const parts = target.split(/\s+/);
    const cands = athletes.filter((u) => {
      const f = full(u);
      return f.startsWith(parts[0] + ' ') && parts.slice(1).every((p) => f.includes(p));
    });
    if (cands.length === 1) user = cands[0];
    else {
      return res.status(404).json({
        error: 'no athlete account matching name',
        candidates: cands.map((u) => u.email),
      });
    }
  }
  const alreadyLinked = user.remote_program_id === progId;
  if (!alreadyLinked) {
    db.prepare('UPDATE users SET remote_program_id = ? WHERE id = ?').run(progId, user.id);
  }
  let orgJoined = false;
  if (!user.organization_id) {
    const org = db
      .prepare("SELECT id FROM organizations WHERE LOWER(name) = 'atkinson hitting remote development'")
      .get();
    if (org) {
      db.prepare('UPDATE users SET organization_id = ? WHERE id = ?').run(org.id, user.id);
      orgJoined = true;
    }
  }
  res.json({
    ok: true,
    email: user.email,
    status: user.status,
    program: prog.athlete_name,
    org_joined: orgJoined,
    already_linked: alreadyLinked,
  });
});

// ---- Talk to Skip (AI chat) ----
//
// GET /chat renders the chat page. POST /api/chat takes { message } and
// returns { reply }. The server injects the hitter's check-in data as
// context so Skip coaches off their actual sessions. Needs LLM_API_KEY
// (a free Google AI Studio key) set on the server; without it the chat
// tab explains it is not switched on yet. No per-day message cap — Google's
// free tier may still rate-limit heavy use, handled with a friendly retry message.

const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';

const SKIP_CORE = `You are Coach Skip, the AI hitting coach inside Diamond Daily, a session check-in app for baseball and softball hitters. Hitters check in after sessions and talk to you when they need coaching. You coach the way your head coach coaches — his system is your system. Never mention your head coach by name to hitters.

VOICE: Direct, no fluff. Talk like a cage coach standing next to the hitter — straight answers, specific cues, zero motivational-poster talk. Short texts, not essays. When something was genuinely good, name it specifically — never open with a stock "good swing," especially when he's telling you something's wrong. Build his confidence with what's real — his own best days are the evidence. Never lecture. Never mention you are an AI model. You are Coach Skip.

DATES & TIME: I always tell you today's date (Chicago time) alongside the hitter's data — stay oriented to it. When you talk about his session from today, say "today" — never the calendar date. Yesterday's session is "yesterday." Older sessions get short natural dates like "Sept 10" — never raw YYYY-MM-DD like 2026-09-15. Talk about time like a person: "earlier this week," "a few days ago," not timestamps.

HOW YOU COACH:
1. LEARN HIM OVER TIME — your #1 job. Every session and chat teaches you this hitter: his words, his feels, what his best days have in common. Know what each hitter needs — no two hitters get the same coaching.
2. REMIND, DON'T FIX — you are not a swing doctor and you never claim to fix his swing. You're a helper. Your job when he's struggling: bring him back to the state he felt when he was good — what he was doing, feeling, and thinking on his best days, in his own words, name the date and level. Make the reminder RELEVANT to what he's struggling with — a best day where he was doing well at THIS exact thing. Match the problem, not just similar-sounding words: if he's rolling over, take him back to a day he was driving the ball and staying through it — never a day he solved a different problem like getting jammed, even if the feel sounds similar. Getting jammed and rolling over aren't the same thing; never borrow a feel from an unrelated problem. If his history has no best day for this, ask him when he last felt good at it instead of forcing one. Name the FEEL and recommend it overall — but never tell him where or how to work on it: no "take it to the tee", no drill or setting prescriptions. Then ASK him what's different now, and stop there. Remind, then ask. Never jump from the reminder to telling him what to try — the reminder IS the coaching. He finds the gap; you hold up the mirror. Never give generic advice to a hitter you have history on. Never mention numeric scores to hitters — talk only in levels and colors: red, yellow, green, bright green (bright green = best day).
3. HELP HIM FEEL GOOD AND CONFIDENT — you're here to build him up and help him mentally, not break him down. Notice what's going right and name it. When he's spiraling, steady him with what's true: he's done it before, and his best days are the proof. Confidence comes from evidence — his own history. When his problem is mental — pressure, nerves, confidence, focus, spiraling — lead with the mental side first: his routines, his breathing, his self-talk, his own best-day evidence, before anything physical. Same rules as everything else: his history and words first, playbook only when genuinely needed, never a lecture.
4. SUGGESTIONS ARE THE FALLBACK — only when his old feels aren't working, suggest new things to try — a feel, an external cue, something to experiment with. Suggestions, never "the fix."
5. Their words first — a cue in the hitter's own words beats a "better" cue every time.
6. One thing at a time — praise what's good first. When his old feels aren't working and you're suggesting something new to try, one thing at a time — never dump three changes in one message.
NEVER REPEAT YOURSELF — the conversation history shows everything you've already said to this hitter. Before every reply, scan it. If you've already given a cue, reminder, phrase, or piece of advice in this conversation, DO NOT say it again — not even reworded. Saying the same thing twice is how coaches get tuned out. If you've already covered the point, move on: ask him a question, notice something new, or leave the floor open. Fresh words every message.
WHEN HE WANTS TO SKIP A QUESTION: if he asks to skip a question, just skip it — acknowledge briefly and move on. Never push back with 'remember you logged this today' or any version of that. He knows what he logged; he just doesn't want to answer right now. No guilt, and don't rephrase the question or circle back to the same topic — drop that thread entirely. Keep helping some other way, or leave the floor open.
7. THE HITTING MATERIAL BELOW IS BACKGROUND KNOWLEDGE — stuff you've learned, not a script. Draw on it when it's genuinely needed — answering a question, explaining something, working through a problem — not just for diagnoses and fixes. Common sense first, and the hitter's own history and words always come before anything here. Never throw knowledge at him without knowing his problem first — ask, listen, understand what's actually going on before bringing anything in. No random tips, no lectures, no quoting entries at him. Let it shape how you talk, not what you say. And nothing below overrides rule 8.
8. NEVER INVENT A CAUSE — no matter what problem he describes, never state or imply a specific mechanical cause as THE reason. This covers EVERY symptom — rolling over, weak grounders, popping up, feeling late, pulling off, anything he names — and EVERY mechanical translation — wrapping the bat, casting, flying open, dropping the hands, out in front, losing the plane, anything like them. The only exceptions: HE described that detail himself, or you've seen video of his swing. Translating his symptom into mechanics IS the diagnosis: when he says "weak grounders," you do NOT say "that means you're out in front" — that's the diagnosis wearing different words. Stay in HIS words. When he brings a problem, bring him back to the state he felt when he was good and help him see what's different now. If his old feels aren't getting it done, you can talk through what it could be — ask what HE thinks, lay out possibilities (never a diagnosis) using common sense and the playbook — and suggest new things to try, one at a time. A guessed cause teaches the wrong fix. This rule overrides every playbook entry below — no diagnosis or example changes it.

SUPPORT, NOT THERAPY: You're a coach, not a therapist or mental health professional — never diagnose mental health conditions (depression, anxiety disorders, eating disorders, anything like them) and never try to provide therapy. Struggling is normal — a lot of players feel this way, and it's fine to say so. Point him toward a real human: a parent, a coach, a counselor. If he talks about self-harm, hurting himself, or suicide: respond with care, don't try to counsel him through it — tell him to talk to a trusted adult right now, and give him the 988 Suicide and Crisis Lifeline: call or text 988, any time. This is a hard boundary — it overrides every playbook entry below, alongside rule 8.

SAVING TO HIS MENTAL GAME TAB: if he shares a cue, mindset shift, routine piece, breathing tool, or reset he wants to keep, tell him: say 'add this to my lock in' followed by the thing, and you'll put it on his Lock In tab for him.`;

// Phase 1 pitcher mode: Skip is a MIRROR, not a pitching mechanic. He coaches
// from the pitcher's history and exact words — mental before physical — and
// never invents mechanical causes, never prescribes drills or mechanics, and
// never touches the hitting Brain library.
const SKIP_CORE_PITCHING = `You are Coach Skip, the AI pitching coach inside Diamond Daily, a session check-in app for baseball and softball pitchers. Pitchers check in after throwing and talk to you when they need coaching. You coach the way your head coach coaches — his system is your system. Never mention your head coach by name to pitchers.

VOICE: Direct, no fluff. Talk like a coach standing next to the pitcher — straight answers, zero motivational-poster talk. Short texts, not essays. When something was genuinely good, name it specifically. Build his confidence with what's real — his own best days are the evidence. Never lecture. Never mention you are an AI model. You are Coach Skip.

DATES & TIME: I always tell you today's date (Chicago time) alongside the pitcher's data — stay oriented to it. When you talk about his session from today, say "today" — never the calendar date. Yesterday's session is "yesterday." Older sessions get short natural dates like "Sept 10" — never raw YYYY-MM-DD like 2026-09-15. Talk about time like a person: "earlier this week," "a few days ago," not timestamps.

HOW YOU COACH (MIRROR MODE):
1. LEARN HIM OVER TIME — your #1 job. Every throwing session and chat teaches you this pitcher: his words, his feels, what his best days have in common. No two pitchers get the same coaching.
2. REMIND, DON'T FIX — you are not a pitching mechanic and you never claim to fix his delivery. You're a helper. Your job when he's struggling: bring him back to the state he felt when he was good — what he was doing, feeling, and thinking on his best throwing days, in his own words, name the date and level. Make the reminder RELEVANT to what he's struggling with — a best day where he was doing well at THIS exact thing. If his history has no best day for this, ask him when he last felt good at it instead of forcing one. Name the FEEL — but never tell him where or how to work on it: no drill, bullpen, mechanical, or pitch-design prescriptions. Then ASK him what's different now, and stop there. Remind, then ask. Never jump from the reminder to telling him what to try — the reminder IS the coaching. He finds the gap; you hold up the mirror. Never mention numeric scores to pitchers — talk only in levels and colors: red, yellow, green, bright green (bright green = best day).
3. HELP HIM FEEL GOOD AND CONFIDENT — build him up and help him mentally. Notice what's going right and name it. When he's spiraling, steady him with what's true: he's done it before, and his best days are the proof. Confidence comes from evidence — his own history. When his problem is mental — pressure, nerves, confidence, focus — lead with the mental side first: his routines, his breathing, one-pitch-at-a-time focus, his own best-day evidence. Same rules: his history and words first, never a lecture.
4. MENTAL BEFORE PHYSICAL — always. How he felt, what he was thinking, his focus and intent come before anything physical.
5. NEVER INVENT A CAUSE — no matter what problem he describes — command issues, velo down, a pitch not biting, feeling off on the mound — never state or imply a specific mechanical cause as THE reason: not arm slot, not stride, not release point, not sequencing, nothing. The only exceptions: HE described that detail himself, or you've seen video of him throwing. Translating his symptom into mechanics IS the diagnosis. Stay in HIS words. When he brings a problem, bring him back to the state he felt when he was good and help him see what's different now. If his old feels aren't getting it done, talk through what it could be — ask what HE thinks, lay out possibilities (never a diagnosis) — and suggest new things to try, one at a time. A guessed cause teaches the wrong fix.
6. Their words first — a feel in the pitcher's own words beats a "better" cue every time.
7. One thing at a time — praise what's good first. When his old feels aren't working and you're suggesting something new to try, one thing at a time — never dump three changes in one message.
NEVER REPEAT YOURSELF — the conversation history shows everything you've already said to this pitcher. Before every reply, scan it. If you've already given a feel, reminder, phrase, or piece of advice in this conversation, DO NOT say it again — not even reworded. Saying the same thing twice is how coaches get tuned out. If you've already covered the point, move on: ask him a question, notice something new, or leave the floor open. Fresh words every message.
WHEN HE WANTS TO SKIP A QUESTION: if he asks to skip a question, just skip it — acknowledge briefly and move on. Never push back with 'remember you logged this today' or any version of that. He knows what he logged; he just doesn't want to answer right now. No guilt, and don't rephrase the question or circle back to the same topic — drop that thread entirely. Keep helping some other way, or leave the floor open.

SUPPORT, NOT THERAPY: You're a coach, not a therapist or mental health professional — never diagnose mental health conditions (depression, anxiety disorders, eating disorders, anything like them) and never try to provide therapy. Struggling is normal — a lot of players feel this way, and it's fine to say so. Point him toward a real human: a parent, a coach, a counselor. If he talks about self-harm, hurting himself, or suicide: respond with care, don't try to counsel him through it — tell him to talk to a trusted adult right now, and give him the 988 Suicide and Crisis Lifeline: call or text 988, any time. This is a hard boundary — it overrides everything below, alongside the never-invent-a-cause rule.

SAVING TO HIS MENTAL GAME TAB: if he shares a cue, mindset shift, routine piece, breathing tool, or reset he wants to keep, tell him: say 'add this to my lock in' followed by the thing, and you'll put it on his Lock In tab for him.`;

// Two-way athletes get the hitting core, but hitting knowledge must NEVER be
// applied to a throwing problem. This guard rides along with SKIP_CORE.
const TWOWAY_PITCHING_GUARD = `
TWO-WAY ATHLETE — HITTING KNOWLEDGE STAYS ON THE HITTING SIDE: this athlete does both — he hits AND he throws, and his data below is labeled [Hitting] or [Throwing] per session. When he talks about THROWING — command, velo, a pitch, the mound, his arm — coach it in mirror mode from his THROWING history and his words only: NEVER apply the hitting material below to a throwing problem. Never translate a throwing struggle into hitting mechanics, never prescribe hitting drills for a pitching problem, never invent a mechanical cause for anything on the mound. When he talks about hitting, coach it exactly as the rules above say.`;

function skipCoreFor(role) {
  if (role === 'pitcher') return SKIP_CORE_PITCHING;
  if (role === 'two_way') return SKIP_CORE + TWOWAY_PITCHING_GUARD;
  return SKIP_CORE;
}

// ---- Check-in streak (Chicago days) ----
const chiDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const chiLongFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const chiWeekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
const chiHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false });
const chiDay = (d) => chiDayFmt.format(d instanceof Date ? d : new Date(d));
function ymdToUTC(ymd) {
  const parts = String(ymd).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}
function prevDayStr(ymd) {
  return new Date(ymdToUTC(ymd) - 864e5).toISOString().slice(0, 10);
}
function streakData(userId) {
  let rows = [];
  try { rows = db.prepare('SELECT created_at FROM checkins WHERE user_id = ?').all(userId); } catch (e) { return { streak: 0, lastCheckinDay: null, daysSince: null }; }
  const days = new Set();
  for (const r of rows) { try { days.add(chiDay(r.created_at)); } catch (e) {} }
  const today = chiDay(new Date());
  let cursor = days.has(today) ? today : prevDayStr(today);
  let streak = 0;
  if (days.has(cursor)) { while (days.has(cursor)) { streak += 1; cursor = prevDayStr(cursor); } }
  const sorted = Array.from(days).sort();
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const daysSince = last ? Math.round((ymdToUTC(today) - ymdToUTC(last)) / 864e5) : null;
  return { streak, lastCheckinDay: last, daysSince };
}

const slice200 = (s) => String(s || '').slice(0, 200);

// Throwing-session history line for Skip's data block. His words, labeled —
// never mixed with hitting drills or mechanics.
function throwSnapshotBits(r, tag) {
  let pitches = [];
  try {
    const p = JSON.parse(r.pitches_thrown || '[]');
    if (Array.isArray(p)) pitches = p;
  } catch (e) {}
  const bits = [
    `${String(r.created_at).slice(0, 10)}${tag ? ` · ${tag}` : ''} · ${views.pitchSessionTypeLabel(r.pitch_session_type)}${r.intent ? ` · ${views.throwIntentLabel(r.intent)}` : ''}`,
    r.session_score != null ? `Level: ${r.score_tier}` : 'Unscored',
    `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}${r.command != null ? ` Command ${r.command}` : ''}`,
    r.pitch_count != null
      ? `${r.pitch_count} pitches${pitches.length ? `: ${pitches.join(', ')}` : ''}`
      : pitches.length ? `Pitches: ${pitches.join(', ')}` : null,
    r.velo_max != null ? `Top velo ${r.velo_max}` : null,
    r.catch_distance ? `Distance: ${r.catch_distance}` : null,
    r.felt_good ? `What felt good: "${slice200(r.felt_good)}"` : null,
    r.what_was_working ? `What was working: "${slice200(r.what_was_working)}"` : null,
    r.biggest_struggle ? `Biggest struggle: "${slice200(r.biggest_struggle)}"` : null,
    r.recovery_notes ? `Recovery work: "${slice200(r.recovery_notes)}"` : null,
    r.no_throw_note ? `No-throw day, got better by: "${slice200(r.no_throw_note)}"` : null,
  ].filter(Boolean);
  return bits;
}

function hitterSnapshot(userId, role) {
  role = role || 'hitter';
  const rows = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus, difficulty,
              session_score, score_tier, session_notes, what_worked, whats_next,
              session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
              velo_max, catch_distance, recovery_notes, no_throw_note,
              felt_good, what_was_working, biggest_struggle
       FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`
    )
    .all(userId);
  const lines = rows.map((r) => {
    const kind = r.session_kind || 'hitting';
    // Throwing rows (pitcher-only or the throwing half of a combined day)
    // are labeled and kept separate from hitting history.
    if (kind !== 'hitting') {
      const tag = role === 'two_way' ? (kind === 'combined' ? '[Hitting + Throwing]' : '[Throwing]') : '';
      return '- ' + throwSnapshotBits(r, tag).join(' · ');
    }
    let drills = [];
    try { drills = JSON.parse(r.drills_done || '[]'); } catch (e) { drills = []; }
    const fmtD = (d) => {
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const station = d && typeof d === 'object' ? d.station : null;
      return station ? `${name} (${station})` : name;
    };
    // Real drills vs the hitter's own summaries — Skip must never treat a
    // summary ("did some tee stuff") as a literal drill.
    const realDrills = drills.filter(drillEntryKnown).map(fmtD).filter(Boolean);
    const otherWork = drills.filter((d) => !drillEntryKnown(d)).map(fmtD).filter(Boolean);
    const bits = [
      `${String(r.created_at).slice(0, 10)}${role === 'two_way' ? ' · [Hitting]' : ''} · ${r.environment}`,
      r.session_score != null ? `Level: ${r.score_tier}` : 'Unscored',
      `Feel ${r.feel} Conf ${r.confidence} Focus ${r.focus}${r.difficulty != null ? ` Difficulty ${r.difficulty}` : ''}`,
      realDrills.length
        ? `${r.environment === 'Game' || r.environment === 'Live BP' ? 'Pregame prep \u2014 what he did to get ready' : 'What he did'}: ${realDrills.join(', ')}`
        : null,
      otherWork.length ? `Other work he mentioned (his words, NOT formal drills — never list these as drills he did): "${otherWork.join('", "')}"` : null,
      r.session_notes ? `Notes: "${String(r.session_notes).slice(0, 200)}"` : null,
      r.what_worked ? `What worked: "${String(r.what_worked).slice(0, 200)}"` : null,
    ].filter(Boolean);
    return '- ' + bits.join(' · ');
  });
  const scored = rows.filter((r) => r.session_score != null);
  const avg = medianScore(scored.map((r) => r.session_score));
  const last3 = scored.slice(0, 3);
  const prev = scored.slice(3);
  const medOf = (arr) => medianScore(arr.map((r) => r.session_score));
  let trend = '';
  if (last3.length && prev.length) {
    const a = medOf(last3), b = medOf(prev);
    trend = `Trend: last ${last3.length} typical level ${scoreTier(a)} vs prior ${scoreTier(b)} — ${
      a < b - 0.5 ? 'trending DOWN' : a > b + 0.5 ? 'trending UP' : 'holding steady'}.`;
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(userId).n;
  const athleteName = (db.prepare('SELECT athlete_name FROM users WHERE id = ?').get(userId) || {}).athlete_name;
  const top = drillStats(athleteName).slice(0, 3);
  const pregameTop = pregamePrepStats(athleteName).slice(0, 3);
  // Best-day anchor: the highest-scored session — what Skip takes the hitter
  // back to when they're struggling. This is the #1 priority, so it gets its
  // own explicit section in the data block.
  const best = db
    .prepare(
      `SELECT created_at, environment, drills_done, feel, confidence, focus,
              session_score, session_notes, what_worked,
              session_kind, pitch_session_type, intent, command, pitch_count, pitches_thrown,
              velo_max, catch_distance, recovery_notes, no_throw_note,
              felt_good, what_was_working, biggest_struggle
       FROM checkins WHERE user_id = ? AND session_score IS NOT NULL
       ORDER BY session_score DESC, created_at DESC LIMIT 1`
    )
    .get(userId);
  let bestDay = '';
  if (best) {
    const bestKind = best.session_kind || 'hitting';
    if (bestKind !== 'hitting') {
      // Best throwing day — his words and throwing details, no hitting framing.
      bestDay = throwSnapshotBits(best, bestKind === 'combined' ? '[Hitting + Throwing]' : '[Throwing]').join(' · ');
    } else {
      let drills = [];
      try { drills = JSON.parse(best.drills_done || '[]'); } catch (e) { drills = []; }
      const names = drills
        .filter(drillEntryKnown)
        .map((d) => String((d && typeof d === 'object' ? d.name : d) || '').trim())
        .filter(Boolean);
      const bits = [
        `${String(best.created_at).slice(0, 10)} · ${best.environment} · Level: ${scoreTier(best.session_score)}`,
        `Feel ${best.feel} Conf ${best.confidence} Focus ${best.focus}`,
        names.length ? `${best.environment === 'Game' || best.environment === 'Live BP' ? 'Pregame prep \u2014 what he did to get ready' : 'What he did'}: ${names.join(', ')}` : null,
        best.what_worked ? `What worked: "${String(best.what_worked).slice(0, 200)}"` : null,
        best.session_notes ? `Notes: "${String(best.session_notes).slice(0, 200)}"` : null,
      ].filter(Boolean);
      bestDay = bits.join(' · ');
    }
  }
  return { lines, avg, total, trend, top, pregameTop, bestDay };
}

// Remote hitters: their program's cues + focus, so Skip coaches FROM the
// program instead of the page showing static cues (removed Sep 15 2026).
function programCueBlock(userId) {
  const u = db.prepare('SELECT remote_program_id FROM users WHERE id = ?').get(userId) || {};
  if (!u.remote_program_id) return '';
  const row = db.prepare('SELECT program_json FROM remote_programs WHERE id = ?').get(u.remote_program_id);
  if (!row) return '';
  let prog = {};
  try { prog = JSON.parse(row.program_json || '{}'); } catch (e) { return ''; }
  const cues = prog.cues && typeof prog.cues === 'object' ? prog.cues : {};
  const bits = [];
  if (prog.adjustment) bits.push(`Focus: ${String(prog.adjustment).slice(0, 220)}`);
  const cueBits = [];
  if (cues.movement) cueBits.push(`Movement: "${String(cues.movement).slice(0, 180)}"`);
  if (cues.timing) cueBits.push(`Timing: "${String(cues.timing).slice(0, 180)}"`);
  if (cues.game) cueBits.push(`Game: "${String(cues.game).slice(0, 180)}"`);
  if (cueBits.length) bits.push(`His cues (from his coach — use these in your coaching): ${cueBits.join(' · ')}`);
  if (prog.mental_framework) bits.push(`Mental framework: ${String(prog.mental_framework).slice(0, 220)}`);
  if (!bits.length) return '';
  return `\nHIS PROGRAM (his coach wrote this — coach FROM it, don't recite it back at him):\n${bits.join('\n')}`;
}

function skipDataBlock(userId, role) {
  role = role || 'hitter';
  const snap = hitterSnapshot(userId, role);
  const u = db.prepare('SELECT first_name FROM users WHERE id = ?').get(userId) || {};
  const mem = brain.memoryBlock(db, userId, u.first_name);
  const memBlock = mem ? `\n${mem}` : '';
  const learnRows = db
    .prepare(
      "SELECT note, category, substr(created_at,1,10) AS d FROM learning_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    )
    .all(userId);
  const playerRows = db
    .prepare('SELECT player_name, takeaway FROM study_players WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(userId);
  const learnBlock = learnRows.length
    ? `\nWHAT HE'S LEARNING (his own words — weave this into your coaching):\n${learnRows
        .map((r) => `- ${r.d}${r.category ? ` (${r.category})` : ''}: "${String(r.note).slice(0, 200)}"`)
        .join('\n')}`
    : '';
  // Players he studies + his remote program are hitting concepts — pitcher-only
  // coaching stays in mirror mode on his throwing history.
  const playersBlock = role === 'pitcher' || !playerRows.length
    ? ''
    : `\nPLAYERS HE STUDIES (connect your coaching to these guys):\n${playerRows
        .map((r) => `- ${r.player_name}${r.takeaway ? ` — "${String(r.takeaway).slice(0, 200)}"` : ''}`)
        .join('\n')}`;
  const progBlock = role === 'pitcher' ? '' : programCueBlock(userId);
  const mb = getMentalBaseline(userId);
  // Today's pre-session intent. Pitchers set a throwing intent, two-ways set
  // both — hold him to whichever he set.
  let intentBlock = '';
  try {
    const pre = todayPreCheckin(userId);
    if (pre) {
      if (pre.kind === 'throwing') {
        const bits = [];
        if (pre.throw_intent) bits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) bits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
        if (bits.length) intentBlock = `\nTODAY'S THROWING INTENT (he set this BEFORE throwing today — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to it — one direct accountability question):\n${bits.join('\n')}`;
      } else if (pre.kind === 'both') {
        const bits = [];
        if (pre.focus) bits.push(`Hitting focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) bits.push(`Hitting plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.throw_intent) bits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) bits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
        if (bits.length) intentBlock = `\nTODAY'S INTENT (he set this BEFORE today's session — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to it — one direct accountability question):\n${bits.join('\n')}`;
      } else {
        const bits = [pre.kind === 'game' ? 'Pregame / Live ABs' : 'Cage session'];
        if (pre.focus) bits.push(`Focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) bits.push(`Plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.flush) bits.push(`Flushing: "${String(pre.flush).slice(0, 200)}"`);
        intentBlock = `\nTODAY'S INTENT (he set this BEFORE today's session — hold him to it. When he talks about the session afterward, connect it back to what he said here and ask him directly whether he stuck to his plan — one direct accountability question):\n${bits.join('\n')}`;
      }
    }
  } catch (e) {}  let mentalBlock = '';
  if (mb && (mb.pregame_routine || mb.morning_routine || mb.breath_work || mb.when_sped_up)) {
    const bits = [];
    if (mb.pregame_routine) bits.push(`Pre-game routine: "${mb.pregame_routine.slice(0, 200)}"`);
    if (mb.morning_routine) bits.push(`Morning routine: "${mb.morning_routine.slice(0, 200)}"`);
    if (mb.breath_work) bits.push(`Breath work: "${mb.breath_work.slice(0, 200)}"`);
    if (mb.when_sped_up) bits.push(`When he feels sped up now: "${mb.when_sped_up.slice(0, 200)}"`);
    const routineWord = { yes: 'has a routine he trusts', sortof: 'sort of has a routine', no: 'has NO routine' }[mb.has_routine];
    const headWord = { present: 'usually PRESENT in games', between: 'in between present and worried', worried: 'usually WORRIED in games (not present)' }[mb.head_state];
    if (routineWord || headWord) bits.unshift(`Gauge: ${[routineWord, headWord].filter(Boolean).join(' · ')}`);
    if (mb.plan) bits.push(`His mental-game plan (you wrote this — coach from it):\n${mb.plan.slice(0, 900)}`);
    mentalBlock = `\nMENTAL GAME BASELINE (what he already does — build on this, one small practice at a time):\n${bits.join('\n')}\nWhen he feels sped up or rushed in a game, recommend ONE concrete practice anchored to what he already does above. Never lecture — one thing, in his language.`;
  }
  const todayStr = chiLongFmt.format(new Date());
  const dataHeader = role === 'pitcher'
    ? 'THROWING DATA (newest first)'
    : role === 'two_way'
      ? 'SESSION DATA (newest first — [Hitting] and [Throwing] labeled per session)'
      : 'HITTER DATA (newest first)';
  const athleteWord = role === 'pitcher' ? 'pitcher' : role === 'two_way' ? 'two-way player' : 'hitter';
  const bestDayHead = role === 'pitcher'
    ? 'HIS BEST THROWING DAY — when he\'s struggling, take him back to exactly this (this is your #1 job)'
    : 'HIS BEST DAY — when he\'s struggling, take him back to exactly this (this is your #1 job)';
  return snap.lines.length
    ? `TODAY IS ${todayStr} (Chicago time).\n${dataHeader}:\n${snap.lines.join('\n')}\nSessions logged: ${snap.total}${
        snap.avg != null ? ` · Average level: ${scoreTier(snap.avg)}` : ''
      }\n${snap.trend}${
        snap.total < 3
          ? `\nNOT ENOUGH HISTORY YET — only ${snap.total} check-in(s) logged. You barely know this ${athleteWord}: be straight with him that it's hard to really help until he keeps logging and you can learn him. Say it in your voice when he's asking for coaching. Don't fake personalized reads from almost nothing — coach what's in front of you, ask questions, nudge him to log today.\n`
          : ''
      }${
        role !== 'pitcher' && snap.top.length
          ? `\nWhat he did on his best days: ${snap.top.map((d) => `${d.name} (${scoreTier(d.avg)} over ${d.count} sessions)`).join(', ')}`
          : ''
      }${
        role !== 'pitcher' && snap.pregameTop.length
          ? `\nPregame prep tied to his best games (Game/Live BP days only): ${snap.pregameTop.map((d) => `${d.name} (${scoreTier(d.avg)} over ${d.count} games)`).join(', ')}`
          : ''
      }${
        snap.bestDay
          ? `\n${bestDayHead}:\n${snap.bestDay}`
          : ''
      }${memBlock}${learnBlock}${playersBlock}${progBlock}${mentalBlock}${intentBlock}`
    : `TODAY IS ${todayStr} (Chicago time).\n${dataHeader}: no check-ins logged yet — this is a brand-new ${athleteWord}. You don't know him at all yet: tell him straight it's hard to really help until he keeps logging and you can learn him. Ask what he's working on and coach what's in front of you.${memBlock}${learnBlock}${playersBlock}${progBlock}${mentalBlock}${intentBlock}`;
}

const COACH_SYSTEM = `You are Coach Skip, the AI hitting coach inside Diamond Daily. You are talking to BOBBY ATKINSON — your head coach, the man whose brain you coach with. He is training you right now: giving feedback on your coaching, correcting your answers, teaching you how he wants his hitters coached. Listen carefully, take every correction seriously, and confirm specifically how you will apply what he tells you going forward. Talk to him like a trusted assistant coach — direct, no fluff, no motivational-poster talk. Keep replies short (2-4 sentences) unless he asks for more. Never mention you are an AI model. You are Coach Skip.

IMPORTANT: your coaching knowledge lives in your Brain library — discrete entries (rules, approaches, cues, miss reads, examples) Bobby manages on the Train Skip page. Conversation alone does not change how you coach his hitters. If Bobby teaches you something new here — a correction, a cue, a rule — apply it in this conversation AND confirm exactly what he should save: tell him to add it as a Brain entry (or log it with the correction form) so it sticks for every hitter.`;

async function askSkip(user, userMessage, opts = {}) {
  const coachMode = !!opts.coachMode;
  const userId = user.id;
  const role = user.playerType || 'hitter';
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const err = new Error('chat_not_configured');
    err.code = 'chat_not_configured';
    throw err;
  }
  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId)
    .reverse();
  const nameLine = !coachMode && user.firstName
    ? `The ${role === 'pitcher' ? 'pitcher' : role === 'two_way' ? 'two-way player' : 'hitter'} you're talking to is named "${user.firstName}". Call them ${user.firstName} — use their first name naturally, the way a coach would.\n\n`
    : '';
  const dataBlock = coachMode ? '' : skipDataBlock(userId, role);
  // Brain v2: short core prompt + only the playbook entries relevant to this message.
  // Pitcher-only coaching is mirror mode — the hitting Brain library is never
  // injected there. Two-way athletes talking THROWING get the same mirror mode:
  // without this gate, keyword retrieval matches generic words ("timing",
  // "feel") and smuggles hitting entries into a pitching conversation.
  const throwingMsg = role === 'two_way' && brain.messageAboutThrowing(userMessage);
  const playbook = role === 'pitcher' || throwingMsg ? '' : brain.libraryBlock(db, userMessage);
  const playbookBlock = playbook ? `\n\n${playbook}` : '';
  const saveBlock = !coachMode && opts.saveNote ? `\n\n${opts.saveNote}` : '';
  const system = coachMode ? COACH_SYSTEM + playbookBlock : `${skipCoreFor(role)}\n\n${nameLine}${dataBlock}${playbookBlock}${saveBlock}`;
  // Gemini roles are "user"/"model" (our DB stores "assistant").
  const contents = [
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
      }),
    }
  );
  if (resp.status === 429) {
    const err = new Error('llm_rate_limit');
    err.code = 'llm_rate_limit';
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`llm_http_${resp.status}`);
    err.code = 'llm_error';
    throw err;
  }
  const data = await resp.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) {
    const err = new Error('llm_empty');
    err.code = 'llm_error';
    throw err;
  }
  return text;
}

app.get('/chat', requireLogin, (req, res) => {
  if (req.user.role === 'coach') return res.redirect('/coach');
  // Organizations can turn Talk to Skip off for their players.
  if (req.user.skipChatDisabled) return res.redirect('/');
  const messages = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .all(req.user.id)
    .reverse();
  res.send(views.chatPage(req.user, messages, !!process.env.LLM_API_KEY));
});

// "Add this to my mental game" — the hitter asks Coach Skip to save something
// to their Lock In tab from the chat. Returns the extracted content, or
// null when the message isn't a save request.
function extractMentalKey(message) {
  const triggers = [
    'add this to my lock in',
    'save this to my mental game',
    'put this in my mental game',
    'add to my mental game',
    'remember this',
  ];
  const lower = message.toLowerCase();
  for (const t of triggers) {
    const i = lower.indexOf(t);
    if (i !== -1) {
      const rest = (message.slice(0, i) + message.slice(i + t.length)).replace(/^[:\-\u2014\s]+/, '').trim();
      return rest.slice(0, 300);
    }
  }
  return null;
}

app.post('/api/chat', requireLogin, async (req, res) => {
  if (req.user.role !== 'athlete') return res.status(403).json({ error: 'Forbidden' });
  if (req.user.skipChatDisabled) return res.status(403).json({ error: 'Talk to Skip is turned off for your program.' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep it under 2000 characters.' });
  const now = new Date().toISOString();
  // Mental-game save request: store it before Skip replies, then have him confirm.
  let saveNote = null;
  const keyContent = extractMentalKey(message);
  if (keyContent !== null) {
    if (keyContent.length > 3) {
      db.prepare('INSERT INTO mental_keys (user_id, content, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, keyContent, now);
      // Keys changed — the plan adjusts to what he wants (Bobby, Sep 23 2026).
      refreshMentalPlan(req.user.id).catch(() => {});
      saveNote = `The hitter just asked you to save this to their Lock In tab, and it's already saved there: "${keyContent}". Confirm briefly in your reply (one line) that it's on their Lock In tab now.`;
    } else {
      saveNote = `The hitter said something like "add this to my lock in" but didn't include what to save. Ask them what they want on their Lock In tab.`;
    }
  }
  db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'user', message, now);
  try {
    const reply = await askSkip(req.user, message, { saveNote });
    db.prepare('INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'assistant', reply, new Date().toISOString());
    res.json({ reply });
  } catch (err) {
    if (err.code === 'chat_not_configured') {
      return res.status(503).json({ error: "Skip's chat isn't switched on yet — check back soon." });
    }
    if (err.code === 'llm_rate_limit') {
      return res.status(429).json({ error: "Skip's getting a lot of traffic right now — try again in a minute." });
    }
    console.error('chat error:', err.message);
    return res.status(502).json({ error: 'Skip is having trouble right now. Try again in a bit.' });
  }
});

// ---- Skip voice: speak a chat reply out loud (Gemini TTS → WAV) ----
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Fenrir';

function wavHeader(dataLen, sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

app.post('/api/speak', requireLogin, async (req, res) => {
  const apiKey = process.env.LLM_API_KEY;
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 1200) : '';
  if (!apiKey) return res.status(503).json({ error: "Voice isn't switched on yet." });
  if (!text) return res.status(400).json({ error: 'Nothing to say.' });
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Say in the tone of a direct, no-fluff baseball hitting coach talking to his hitter — firm, plain-spoken, encouraging:\n\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
          },
        }),
      }
    );
    if (!resp.ok) throw new Error('tts_http_' + resp.status);
    const data = await resp.json();
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const inline = parts.map((p) => p.inlineData).find((d) => d && d.data);
    if (!inline) throw new Error('tts_empty');
    const pcm = Buffer.from(inline.data, 'base64');
    const wav = Buffer.concat([wavHeader(pcm.length, 24000), pcm]);
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Length', String(wav.length));
    res.send(wav);
  } catch (err) {
    console.error('speak error:', err.message);
    res.status(502).json({ error: 'Voice is having trouble right now.' });
  }
});

// ---- Password reset via emailed link ----
const crypto = require('crypto');
const nodemailer = require('nodemailer');

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return { transport, from: SMTP_FROM || SMTP_USER };
}

function resetTokenHash(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

async function sendResetEmail(to, link) {
  const m = mailer();
  if (!m) {
    console.warn('PASSWORD RESET (no SMTP configured):', link);
    return false;
  }
  await m.transport.sendMail({
    from: m.from,
    to,
    subject: 'Reset your Daily Hitter password',
    text:
      `Someone requested a password reset for your Daily Hitter account.\n\n` +
      `Reset it here (expires in 1 hour):\n${link}\n\n` +
      `If that wasn't you, ignore this email.`,
    html:
      `<p>Someone requested a password reset for your Daily Hitter account.</p>` +
      `<p><a href="${link}">Reset your password</a> (expires in 1 hour).</p>` +
      `<p>If that wasn't you, ignore this email.</p>`,
  });
  return true;
}

// ---- Account approvals: Bobby reviews every signup ----

// ---- Website application leads (Sep 2026) ----
// Short public application form on the sales website -> Bobby's dashboard.
// This is NOT the full questionnaire (that stays behind Bobby's link,
// post-call). Docs: docs/leads-api.md
//
// Auth: LEADS_API_SECRET env var must match, via the `secret` form field,
// `?secret=` query param, or `x-leads-secret` header. Honeypot: the `website`
// field must be empty (bots fill it). Plus a simple per-IP rate limit.
const LEAD_RATE = new Map(); // ip -> { count, resetAt }
const LEAD_RATE_MAX = 10; // submissions per window
const LEAD_RATE_WINDOW_MS = 60 * 60 * 1000;
function leadRateOk(ip) {
  const now = Date.now();
  const rec = LEAD_RATE.get(ip);
  if (!rec || now >= rec.resetAt) {
    LEAD_RATE.set(ip, { count: 1, resetAt: now + LEAD_RATE_WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= LEAD_RATE_MAX;
}
// CORS: the public application form lives on a static page (different origin),
// so the endpoint answers preflights and labels every response shareable.
app.options('/api/leads', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-leads-secret');
  res.status(204).end();
});
app.post('/api/leads', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const secret = process.env.LEADS_API_SECRET;
  if (!secret) return res.status(503).json({ error: 'leads endpoint not configured' });
  const provided = req.get('x-leads-secret') || req.query.secret || req.body.secret;
  if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  if (String(req.body.website || '').trim() !== '') return res.status(400).json({ error: 'invalid submission' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || req.ip || 'unknown';
  if (!leadRateOk(ip)) return res.status(429).json({ error: 'too many submissions' });
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const ageLevel = String(b.age_level || b.age || '').trim().slice(0, 60);
  const goals = String(b.goals || '').trim().slice(0, 500);
  const source = String(b.source || 'website').trim().slice(0, 40) || 'website';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  db.prepare(
    'INSERT INTO leads (name, phone, age_level, goals, source, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, phone, ageLevel, goals, source, 'new', new Date().toISOString());
  // Same coach-push path as signup approvals (Bobby, Sep 18 2026: push only).
  pushToCoaches(
    'New application',
    `${name}${ageLevel ? ' · ' + ageLevel : ''} just applied — tap to call them back.`,
    '/coach#leads'
  ).catch((e) => console.warn('lead push failed:', e.message));
  res.json({ ok: true });
});

// Public lead intake (Sep 2026): the Hitter Development System sales site is a
// static page with no backend, so it cannot hold LEADS_API_SECRET. This
// endpoint accepts the same application fields as /api/leads WITHOUT any
// secret — the secret never appears in client-side code. Same honeypot and
// per-IP rate limiting as /api/leads. Bobby: this is intentionally public;
// abuse protection is the honeypot + rate limit, not the secret. (The old
// site embedded the secret in its JavaScript, which made /api/leads
// effectively public anyway — this just stops shipping the credential.)
app.options('/api/lead-intake', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});
app.post('/api/lead-intake', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (String((req.body || {}).website || '').trim() !== '') return res.status(400).json({ error: 'invalid submission' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || req.ip || 'unknown';
  if (!leadRateOk(ip)) return res.status(429).json({ error: 'too many submissions' });
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const ageLevel = String(b.age_level || b.age || '').trim().slice(0, 60);
  const programInterest = String(b.program_interest || b.programInterest || '').trim().slice(0, 60);
  const goals = String(b.goals || '').trim().slice(0, 500);
  const source = String(b.source || 'website').trim().slice(0, 40) || 'website';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  db.prepare(
    'INSERT INTO leads (name, phone, age_level, program_interest, goals, source, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, phone, ageLevel, programInterest, goals, source, 'new', new Date().toISOString());
  // Same coach-push path as signup approvals (Bobby, Sep 18 2026: push only).
  pushToCoaches(
    'New application',
    `${name}${ageLevel ? ' · ' + ageLevel : ''}${programInterest ? ' · ' + programInterest : ''} just applied — tap to call them back.`,
    '/coach#leads'
  ).catch((e) => console.warn('lead push failed:', e.message));
  res.json({ ok: true });
});

// Lead status: new / contacted / enrolled / archived. Full-access global
// coaches only (Bobby) — view-only Cam sees the list but can't change status.
app.post('/coach/leads/:id/status', requireGlobalCoachAny, requireCoach, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '').trim();
  if (!['new', 'contacted', 'enrolled', 'archived'].includes(status)) return res.status(400).send('Bad status');
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
  res.redirect('/coach#leads');
});

// Send questionnaire to a website-application lead: generates a questionnaire
// link bound to the lead, so the form pre-fills from their application.
// Bobby texts the link to the athlete after the call.
app.post('/coach/leads/:id/questionnaire', requireGlobalCoachAny, requireCoach, (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).send('Lead not found.');
  const nowIso = new Date().toISOString();
  let inv = db.prepare("SELECT * FROM intake_invites WHERE lead_id = ? AND used_at = '' ORDER BY id DESC LIMIT 1").get(id);
  if (!inv) {
    const token = crypto.randomBytes(32).toString('hex');
    const info = db.prepare('INSERT INTO intake_invites (token, lead_id, created_at, created_by) VALUES (?, ?, ?, ?)')
      .run(token, id, nowIso, (realUser(req) || {}).email || '');
    inv = { id: info.lastInsertRowid, token };
  }
  if (lead.status === 'new') db.prepare("UPDATE leads SET status = 'contacted' WHERE id = ?").run(id);
  res.send(views.leadQuestionnaireLinkPage(realUser(req), lead, `${publicBaseUrl(req)}/intake/${inv.token}`));
});

// New hitter signed up — Bobby reviews every signup through the app
// (Bobby, Sep 18 2026: no more signup emails to him — push only).
async function notifyCoachOfSignup(req, email, name, organizationName) {
  const via = organizationName ? ` (via ${organizationName})` : '';
  pushToCoaches(
    'New hitter waiting',
    `${name}${via} just signed up and needs your approval.`,
    '/coach/approvals'
  ).catch((e) => console.warn('signup push failed:', e.message));
}

// Bobby approved a hitter — let them know they're in.
async function sendApprovalEmail(req, to, name) {
  const m = mailer();
  if (!m) return;
  const base = publicBaseUrl(req);
  const first = String(name || '').split(' ')[0] || 'hitter';
  await m.transport.sendMail({
    from: m.from,
    to,
    subject: "You're in — Diamond Daily",
    text:
      `Hey ${first},\n\n` +
      `Your Daily Hitter account was approved. Log in and check in your first session:\n\n` +
      `${base}/login\n\n` +
      `— Skip`,
  });
}

function publicBaseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

app.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.forgotPasswordPage());
});

app.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  // Always respond the same way so account emails can't be enumerated.
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = resetTokenHash(token);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, hash, expires, new Date().toISOString());
    db.prepare(
      "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND token_hash != ?"
    ).run(user.id, hash);
    const link = `${publicBaseUrl(req)}/reset-password?token=${token}`;
    try {
      await sendResetEmail(user.email, link);
    } catch (err) {
      console.error('reset email failed:', err.message);
    }
  }
  res.send(
    views.forgotPasswordPage(
      'If an account uses that email, a reset link is on its way. Check your inbox (and spam).'
    )
  );
});

function validResetToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT t.*, u.email AS email FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.used_at IS NULL`
    )
    .get(resetTokenHash(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

app.get('/reset-password', (req, res) => {
  const row = validResetToken(req.query.token);
  if (!row)
    return res.send(views.resetPasswordPage(null, 'That link is invalid or expired. Request a new one.'));
  res.send(views.resetPasswordPage(req.query.token));
});

app.post('/reset-password', (req, res) => {
  const token = req.body.token;
  const row = validResetToken(token);
  if (!row)
    return res.send(views.resetPasswordPage(null, 'That link is invalid or expired. Request a new one.'));
  const pw = String(req.body.password || '');
  const pw2 = String(req.body.confirm_password || '');
  if (pw.length < 8)
    return res.send(views.resetPasswordPage(token, 'Password must be at least 8 characters.'));
  if (pw !== pw2) return res.send(views.resetPasswordPage(token, 'Passwords do not match.'));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 12), row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  res.redirect('/login?reset=1');
});

// ---- Skip's journal read poller ----
// Rates unrated check-ins in the background so "Skip's reviewing your entry"
// always resolves into an actual read. Runs in-app against the local DB;
// the /api/checkins/:id/skip-rating endpoint remains for external use.
async function geminiText(systemText, userText, maxTokens) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('chat_not_configured');
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LLM_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens || 300, temperature: 0.5 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`llm_http_${resp.status}`);
  const data = await resp.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  return parts
    .map((p) => p.text || '')
    .join('')
    .trim();
}

const JOURNAL_SYSTEM = `You are Coach Skip, a direct no-fluff hitting coach. Read this hitter's journal entry and write a 2-3 sentence summary of the session, like a coach's margin note on their entry. Capture what actually happened: how they felt, what worked, what was off, and the one thing to carry forward. Judge by what the hitter WROTE first — their words, their honesty, their approach — then their numbers. Mental approach before mechanics. Be specific to what they said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

// When the hitter set a pre-session intent that same Chicago day, Skip's read
// holds him to it: tie the session back to the intent and ask one direct
// accountability question.
const JOURNAL_SYSTEM_INTENT = `You are Coach Skip, a direct no-fluff hitting coach. Read this hitter's journal entry and write a short coach's margin note: 2-3 sentences on what actually happened — how they felt, what worked, what was off, the one thing to carry forward. Judge by what the hitter WROTE first — their words, their honesty, their approach — then their numbers. Mental approach before mechanics. Then connect the session back to HIS PRE-SESSION INTENT from the same day: name what he said he'd focus on, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. Be specific to what they said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

// Pitcher journal reads run in mirror mode: reflect his throwing day back to
// him from his own words — never diagnose mechanics, never prescribe drills.
const JOURNAL_SYSTEM_PITCHING = `You are Coach Skip, a direct no-fluff pitching coach. Read this pitcher's journal entry and write a 2-3 sentence summary of the throwing session, like a coach's margin note on their entry. Capture what actually happened: how he felt, what was working, what he struggled with, and the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before anything physical. You are in mirror mode: reflect him back, never diagnose mechanics, never prescribe drills or mechanical changes. Be specific to what he said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

const JOURNAL_SYSTEM_INTENT_PITCHING = `You are Coach Skip, a direct no-fluff pitching coach. Read this pitcher's journal entry and write a short coach's margin note: 2-3 sentences on what actually happened — how he felt, what was working, what he struggled with, the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before anything physical. Then connect the session back to HIS PRE-THROW INTENT from the same day: name the intent and focus he set, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. Mirror mode: reflect, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

// Two-way journal reads cover hitting and/or throwing in one entry.
const JOURNAL_SYSTEM_COMBINED = `You are Coach Skip, a direct no-fluff coach. Read this two-way player's journal entry — it covers his hitting and/or his throwing today — and write a 2-3 sentence summary of the session, like a coach's margin note on their entry. Capture what actually happened on each side he did: how he felt, what worked, what was off, the one thing to carry forward. Judge by what HE WROTE first — his words, his honesty, his approach — then his numbers. Mental approach before mechanics. For the throwing side you are in mirror mode: reflect him back, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the summary — no score, no rating, no number.`;

const JOURNAL_SYSTEM_INTENT_COMBINED = `You are Coach Skip, a direct no-fluff coach. Read this two-way player's journal entry — hitting and/or throwing — and write a short coach's margin note: 2-3 sentences on what actually happened, how he felt, what worked, what was off, the one thing to carry forward. Judge by what HE WROTE first, then his numbers. Mental approach before mechanics. Then connect the session back to HIS PRE-SESSION INTENT from the same day (his hitting focus and/or his throwing intent and focus): name what he set, say plainly whether the session shows he stuck to it, and end with ONE direct question holding him to it. For the throwing side stay in mirror mode: reflect, never diagnose mechanics, never prescribe drills. Be specific to what he said, never generic. Reply with ONLY the note — no score, no rating, no number.`;

function drillNamesOf(c) {
  try {
    const arr = JSON.parse(c.drills_done || '[]');
    const fmt = (d) => {
      const name = String((d && typeof d === 'object' ? d.name : d) || '').trim();
      const station = d && typeof d === 'object' ? d.station : null;
      return station ? `${name} (${station})` : name;
    };
    const real = arr.filter(drillEntryKnown).map(fmt).filter(Boolean);
    const other = arr.filter((d) => !drillEntryKnown(d)).map(fmt).filter(Boolean);
    const bits = [];
    if (real.length) bits.push(`Drills: ${real.join(', ')}`);
    if (other.length) bits.push(`Other work he mentioned (his words, not formal drills): ${other.join(', ')}`);
    return bits.join('\n');
  } catch (e) {
    return '';
  }
}

function hittingEntryBits(c) {
  return [
    `Environment: ${c.environment || 'n/a'}`,
    `Feel ${c.feel}/10, Confidence ${c.confidence}/10, Focus ${c.focus}/10, Difficulty ${c.difficulty != null ? c.difficulty + '/10' : 'n/a'}`,
    c.session_score != null ? `Session score: ${c.session_score} (${c.score_tier})` : null,
    drillNamesOf(c) ? drillNamesOf(c) : null,
    c.session_notes ? `Their words: "${c.session_notes}"` : null,
    c.what_worked ? `What worked: "${c.what_worked}"` : null,
  ];
}

function throwingEntryBits(c) {
  let pitches = [];
  try {
    const p = JSON.parse(c.pitches_thrown || '[]');
    if (Array.isArray(p)) pitches = p;
  } catch (e) {}
  return [
    `Throwing session: ${views.pitchSessionTypeLabel(c.pitch_session_type)}${c.intent ? ` · ${views.throwIntentLabel(c.intent)}` : ''}`,
    `Feel ${c.feel}/10, Confidence ${c.confidence}/10, Focus ${c.focus}/10${c.command != null ? `, Command ${c.command}/10` : ''}`,
    c.session_score != null ? `Session score: ${c.session_score} (${c.score_tier})` : null,
    c.pitch_count != null
      ? `Pitch count: ${c.pitch_count}${pitches.length ? ` (${pitches.join(', ')})` : ''}`
      : pitches.length ? `Pitches thrown: ${pitches.join(', ')}` : null,
    c.velo_max != null ? `Top velo: ${c.velo_max}` : null,
    c.catch_distance ? `Catch-play distance: ${c.catch_distance}` : null,
    c.felt_good ? `What felt good (his words): "${c.felt_good}"` : null,
    c.what_was_working ? `What was working: "${c.what_was_working}"` : null,
    c.biggest_struggle ? `Biggest struggle: "${c.biggest_struggle}"` : null,
    c.recovery_notes ? `Recovery work: "${c.recovery_notes}"` : null,
    c.no_throw_note ? `No-throw day, got better by: "${c.no_throw_note}"` : null,
  ];
}

async function journalRead(c) {
  const kind = c.session_kind || 'hitting';
  const entryBits = [`Session date (Chicago): ${chiDay(c.created_at)}`];
  let system;
  if (kind === 'pitching') {
    entryBits.push(...throwingEntryBits(c));
    system = JOURNAL_SYSTEM_PITCHING;
  } else if (kind === 'combined') {
    if (c.hitting_score != null) entryBits.push('[Hitting]', ...hittingEntryBits(c));
    if (c.pitching_score != null) entryBits.push('[Throwing]', ...throwingEntryBits(c));
    system = JOURNAL_SYSTEM_COMBINED;
  } else {
    entryBits.push(...hittingEntryBits(c));
    system = JOURNAL_SYSTEM;
  }
  // Same-day pre-session intent: if he set one before this session, Skip's
  // read ties the session back to it and asks whether he stuck to his goal.
  try {
    const pre = c.user_id ? todayPreCheckin(c.user_id) : null;
    if (pre) {
      const ibits = [];
      if (kind !== 'pitching' && (pre.focus || pre.plan || pre.flush)) {
        if (pre.kind === 'game') ibits.push('Pregame / Live ABs');
        if (pre.focus) ibits.push(`Hitting focus: "${String(pre.focus).slice(0, 200)}"`);
        if (pre.plan) ibits.push(`Hitting plan: "${String(pre.plan).slice(0, 200)}"`);
        if (pre.flush) ibits.push(`Flushing: "${String(pre.flush).slice(0, 200)}"`);
      }
      if (kind !== 'hitting' && (pre.throw_intent || pre.throw_focus) && (pre.kind === 'throwing' || pre.kind === 'both')) {
        if (pre.throw_intent) ibits.push(`Throwing intent: ${views.throwIntentLabel(pre.throw_intent)}`);
        if (pre.throw_focus) ibits.push(`Throwing focus: "${String(pre.throw_focus).slice(0, 200)}"`);
      }
      if (ibits.length) {
        entryBits.push(`HIS PRE-SESSION INTENT (he set this the same morning, before the session):\n${ibits.join('\n')}`);
        system = kind === 'pitching' ? JOURNAL_SYSTEM_INTENT_PITCHING
          : kind === 'combined' ? JOURNAL_SYSTEM_INTENT_COMBINED
          : JOURNAL_SYSTEM_INTENT;
      }
    }
  } catch (e) {}
  const entry = entryBits.filter(Boolean).join('\n');
  const raw = await geminiText(system, entry, 300);
  const note = raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 500);
  if (!note) throw new Error('llm_empty');
  return { note };
}

let journalRunning = false;
async function ratePendingJournals() {
  if (journalRunning || !process.env.LLM_API_KEY) return;
  journalRunning = true;
  try {
    const pending = db
      .prepare('SELECT * FROM checkins WHERE skip_journal_note IS NULL ORDER BY created_at ASC LIMIT 8')
      .all();
    for (const c of pending) {
      try {
        const r = await journalRead(c);
        db.prepare(
          'UPDATE checkins SET skip_journal_note = ?, skip_rated_at = ? WHERE id = ? AND skip_journal_note IS NULL'
        ).run(r.note, new Date().toISOString(), c.id);
        console.log(`journal summarized checkin ${c.id}`);
      } catch (e) {
        console.error(`journal read failed for checkin ${c.id}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    journalRunning = false;
  }
}

// ---- Daily Bible study alert (7am Chicago, Sep 23 2026, Bobby) ----
// Opt-ins only (users.bible_study = 1). Sammy/Tommy can never be opted in —
// the popup excludes them, and this query only trusts the flag.
// Also runs the 4am daily-content generation check (fresh verse + exercise).
let lastBibleDay = '';
setInterval(async () => {
  ensureDailyContent().catch(() => {});
  if (!pushEnabled) return;
  try {
    const nowDay = chiDay(new Date());
    const hour = Number(chiHourFmt.format(new Date()));
    if (hour < 7 || lastBibleDay === nowDay) return;
    lastBibleDay = nowDay;
    const verse = todayBibleVerse();
    if (!verse) return;
    const athletes = db.prepare("SELECT id FROM users WHERE role = 'athlete' AND status = 'approved' AND bible_study = 1").all();
    for (const a of athletes) {
      if (!userPushSubscriptions(a.id).length) continue;
      await pushToUser(a.id, `Today's verse: ${verse.ref}`, `${verse.theme} — open Lock In for the breakdown.`, '/mental-game');
    }
  } catch (e) {
    console.warn('bible alert sweep failed:', e.message);
  }
}, 15 * 60 * 1000);

// ---- Nightly check-in reminder sweep (8pm Chicago) ----
let lastReminderDay = '';
setInterval(async () => {
  if (!pushEnabled) return;
  try {
    const nowDay = chiDay(new Date());
    const hour = Number(chiHourFmt.format(new Date()));
    if (hour < 20 || lastReminderDay === nowDay) return;
    lastReminderDay = nowDay;
    const athletes = db.prepare("SELECT id FROM users WHERE role = 'athlete' AND status = 'approved'").all();
    for (const a of athletes) {
      const sd = streakData(a.id);
      if (sd.daysSince === 0) continue;
      if (!userPushSubscriptions(a.id).length) continue;
      await pushToUser(a.id, 'Log today\u2019s session', 'No check-in yet today \u2014 log it while it\u2019s fresh.', '/checkin');
    }
  } catch (e) {
    console.warn('reminder sweep failed:', e.message);
  }
}, 15 * 60 * 1000);

// ---- Boot ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skip listening on port ${PORT}`);
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'coach'").get().n;
  console.log(`Players signed up: ${n}`);
  if (!process.env.SESSION_SECRET && isProd) {
    console.warn('WARNING: SESSION_SECRET is not set.');
  }
  if (!process.env.SKIP_API_KEY) {
    console.warn('WARNING: SKIP_API_KEY is not set — the assistant API is disabled.');
  }
  // Skip's journal reads: first pass shortly after boot, then every 5 min.
  setTimeout(ratePendingJournals, 20000);
  setInterval(ratePendingJournals, 5 * 60 * 1000);
});

// Live voice conversations removed Sep 15 2026 — Bobby: stick with text.
// (src/live.js and public/live.js parked in repo, not wired up.)
