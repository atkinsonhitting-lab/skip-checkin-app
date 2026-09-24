// Training Environment Library — Bobby's canonical environments with his exact
// descriptions. Loaded at boot from data/training_environments.json (packaged
// in the deploy repo) with a workspace fallback for local dev.
// Bobby (Sep 24 2026): these are CONDITIONS, not drills. The coach picks them
// per-athlete in the hitting-plan editor; the athlete's Hitting Program shows
// each picked environment with its description.
const fs = require('fs');
const path = require('path');

function loadEnvLib() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'training_environments.json'),
    '/home/hatch/workspace/atkinson-hitting/programs/training_environments.json',
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw.environments) ? raw.environments : [];
      if (list.length) return list;
    } catch (e) { /* try next candidate */ }
  }
  return [];
}

const ENV_LIST = loadEnvLib();

// Match a sheet/auto-collected environment name to a library entry.
// File order is match priority: breaking-ball entries come before the plain
// angle entries so "Open Angle LH Breaking Ball" resolves to the LH entry.
function findEnvEntry(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const e of ENV_LIST) {
    const pats = Array.isArray(e.match) ? e.match : [];
    if (pats.some((m) => n.includes(String(m).toLowerCase()))) return e;
  }
  return null;
}

function envById(id) {
  return ENV_LIST.find((e) => e && e.id === id) || null;
}

module.exports = { ENV_LIST, findEnvEntry, envById };
