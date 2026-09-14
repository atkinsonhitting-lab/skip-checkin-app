// Seeds the coach/admin account only. Everyone else signs up themselves
// on the public register page — no athlete seeds in this app.
// Generates a strong random password, bcrypt-hashes it, and writes
// CREDENTIALS.md (gitignored — hand it to Bobby directly, never commit it).
//
// Usage: npm run seed [-- --reset]   (--reset wipes existing users first)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const SEED_USERS = [
  // Coach login email: override with the COACH_EMAIL env var (set in render.yaml).
  { email: (process.env.COACH_EMAIL || 'coach@skip.app').trim().toLowerCase(), role: 'coach', athlete_name: null, display: 'Bobby (coach/admin)' },
];

function generatePassword() {
  return crypto.randomBytes(12).toString('base64url'); // 16 chars, URL-safe
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function seedUsers({ reset = false } = {}) {
  if (reset) {
    db.exec('DELETE FROM users');
  }
  if (userCount() > 0) {
    throw new Error('Users already exist. Re-run with --reset to wipe and recreate them.');
  }
  const created = [];
  const insert = db.prepare(
    'INSERT INTO users (email, password_hash, role, athlete_name, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  for (const u of SEED_USERS) {
    const password = generatePassword();
    const hash = bcrypt.hashSync(password, 12);
    insert.run(u.email, hash, u.role, u.athlete_name, now);
    created.push({ ...u, password });
  }
  return created;
}

function writeCredentialsFile(created) {
  const lines = [
    '# Skip — Credentials',
    '',
    '> PRIVATE. Hand these to Bobby directly. Do NOT commit this file.',
    `> Generated ${new Date().toISOString()}.`,
    '',
    '| Email | Who | Initial password |',
    '|---|---|---|',
  ];
  for (const u of created) {
    lines.push(`| \`${u.email}\` | ${u.display} | \`${u.password}\` |`);
  }
  lines.push(
    '',
    'All hitters sign up themselves at /register — no credentials to hand out.',
    'Password change is not yet supported; keep this safe. (Planned v2.)'
  );
  const outPath = path.join(__dirname, '..', 'CREDENTIALS.md');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 });
  return outPath;
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  try {
    const created = seedUsers({ reset });
    const outPath = writeCredentialsFile(created);
    console.log(`Seeded ${created.length} user(s).`);
    console.log(`Credentials written to ${outPath} (gitignored, mode 600).`);
    for (const u of created) console.log(`  ${u.email} / ${u.password}`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

module.exports = { seedUsers, writeCredentialsFile, SEED_USERS, userCount };
