// Training Environment Library — Bobby's canonical environments with his exact
// descriptions. Loaded at boot from data/training_environments.json (packaged
// in the deploy repo) with a workspace fallback for local dev.
// Bobby (Sep 24 2026): these are CONDITIONS, not drills. The coach picks them
// per-athlete in the hitting-plan editor; the athlete's Hitting Program shows
// each picked environment with its description. default_ids go into every
// remote hitter's program until a coach customizes per athlete.
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
      if (list.length) return raw;
    } catch (e) { /* try next candidate */ }
  }
  return { environments: [], default_ids: [] };
}

const RAW = loadEnvLib();
const ENV_LIST = RAW.environments || [];
const DEFAULT_IDS = Array.isArray(RAW.default_ids) ? RAW.default_ids : [];

// Match a sheet/auto-collected environment name to a library entry.
// Longest matching pattern wins, so "Open Angle LH Breaking Ball" resolves to
// the LH breaking-ball entry rather than the plain open-angle entry, and
// "Open Angle Front Toss" beats "Open Angle". Ties keep file order.
function findEnvEntry(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  let best = null;
  let bestLen = -1;
  for (const e of ENV_LIST) {
    const pats = Array.isArray(e.match) ? e.match : [];
    let len = -1;
    for (const m of pats) {
      const s = String(m).toLowerCase();
      if (s && n.includes(s) && s.length > len) len = s.length;
    }
    if (len > bestLen) { best = e; bestLen = len; }
  }
  return best;
}

function envById(id) {
  return ENV_LIST.find((e) => e && e.id === id) || null;
}

function defaultEnvEntries() {
  return DEFAULT_IDS.map(envById).filter(Boolean);
}

module.exports = { ENV_LIST, DEFAULT_IDS, findEnvEntry, envById, defaultEnvEntries };
