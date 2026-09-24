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
      if (list.length) return { raw, file: p };
    } catch (e) { /* try next candidate */ }
  }
  return { raw: { environments: [], default_ids: [] }, file: candidates[0] };
}

const LOADED = loadEnvLib();
const LIB_FILE = LOADED.file;
const RAW = LOADED.raw;
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

// Persist a new library doc (Bobby, Sep 24 2026): the coach edits the
// Training Environment Library from the app — add/edit/delete entries.
// Writes the same file loadEnvLib() reads (on Render that's /app/data,
// the persistent disk, so edits survive deploys) and refreshes the
// in-memory lists in place so every consumer sees the change without
// a restart. Callers must pass { environments: [...], default_ids: [...] }.
function saveEnvLib(doc) {
  const envs = Array.isArray(doc.environments) ? doc.environments : [];
  const clean = envs
    .map((e) => ({
      id: String(e.id || '').trim(),
      name: String(e.name || '').trim(),
      description: String(e.description || ''),
      match: Array.isArray(e.match) ? e.match.map((m) => String(m)) : [],
    }))
    .filter((e) => e.id && e.name);
  const seen = new Set();
  const deduped = clean.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const defaults = (Array.isArray(doc.default_ids) ? doc.default_ids : [])
    .map(String)
    .filter((id) => deduped.some((e) => e.id === id));
  const out = {
    default_ids: defaults,
    environments: deduped,
    note: String(doc.note || RAW.note || ''),
    updated: new Date().toISOString().slice(0, 10),
    version: RAW.version || 1,
  };
  fs.writeFileSync(LIB_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  // Refresh in place — ENV_LIST / DEFAULT_IDS are shared references.
  ENV_LIST.length = 0;
  deduped.forEach((e) => ENV_LIST.push(e));
  DEFAULT_IDS.length = 0;
  defaults.forEach((id) => DEFAULT_IDS.push(id));
  RAW.environments = ENV_LIST;
  RAW.default_ids = DEFAULT_IDS;
  RAW.updated = out.updated;
  return out;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'environment';
}

module.exports = { ENV_LIST, DEFAULT_IDS, findEnvEntry, envById, defaultEnvEntries, saveEnvLib, slugify, LIB_FILE };
