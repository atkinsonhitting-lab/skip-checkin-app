// Exercise Video Library — Bobby's YouTube links for Warm-up (mobility) and
// Med Ball exercises. Coach-editable from /coach/video-library, just like the
// Training Environment Library: add a row, paste a YouTube link, save — the
// hitter's Warm-up Watch buttons update immediately.
//
// Persistence mirrors env_lib.js: the repo seed lives in
// data/exercise_video_library.json (copied onto the Render disk on first
// deploy). Runtime reads/writes the same path — on Render that's /app/data,
// the persistent disk, so Bobby's edits survive deploys and are never
// overwritten by a later push. If the file is missing (fresh local checkout),
// the library seeds in memory from src/exercise_videos.json plus blank rows
// for known exercises that have no video yet.
const fs = require('fs');
const path = require('path');

const LIB_PATH = path.join(__dirname, '..', 'data', 'exercise_video_library.json');
const REPO_MAP = path.join(__dirname, 'exercise_videos.json');

// Video groups beyond Mobility / Med Ball — Bobby (Sep 24 2026): the library
// holds ALL video types (drill demos, approach, field work, ...), not just
// warm-up videos. Groups are coach-created; each is a named list of rows.
// Stored as {"Group Name": [rows]} under the `categories` key.
const DEFAULT_CATEGORIES = ['Drill Demos', 'Approach', 'Field Work'];

// Med-ball exercises Bobby programs that have no YouTube link yet — they get
// blank rows so he can paste links straight into the library.
const PENDING_MEDBALL = [
  'Med Ball Split Stance Rotational Throw',
  'Med Ball Hip Toss',
  'Med Ball Step Back Scoop Toss',
];

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'exercise';
}

function normName(n) {
  return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanRows(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((e) => ({
      id: String((e && e.id) || '').trim() || slugify((e && e.name) || ''),
      name: String((e && e.name) || '').trim(),
      url: String((e && e.url) || '').trim(),
    }))
    .filter((e) => e.name)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

function seedFromRepoMap() {
  let mobility = [];
  let medball = [];
  try {
    const ev = JSON.parse(fs.readFileSync(REPO_MAP, 'utf8'));
    const rows = (obj) =>
      Object.entries(obj || {}).map(([name, url]) => ({ id: slugify(name), name: String(name), url: String(url || '') }));
    mobility = rows(ev.mobility_youtube);
    medball = rows(ev.medball_youtube);
  } catch (e) { /* no repo map */ }
  for (const name of PENDING_MEDBALL) {
    if (!medball.some((r) => normName(r.name) === normName(name))) {
      medball.push({ id: slugify(name), name, url: '' });
    }
  }
  return { mobility: cleanRows(mobility), medball: cleanRows(medball) };
}

function loadVideoLib() {
  try {
    const raw = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
    if (Array.isArray(raw.mobility) || Array.isArray(raw.medball)) {
      const seed = seedFromRepoMap();
      // Backfill blank rows for pending exercises on old files too.
      const mob = cleanRows(raw.mobility);
      const med = cleanRows(raw.medball);
      for (const name of PENDING_MEDBALL) {
        if (!med.some((r) => normName(r.name) === normName(name))) {
          med.push({ id: slugify(name), name, url: '' });
        }
      }
      void seed;
      const rawCats = raw.categories && typeof raw.categories === 'object' ? raw.categories : {};
      const cats = Object.keys(rawCats).map((name) => ({ name, rows: cleanRows(rawCats[name]) }));
      for (const name of DEFAULT_CATEGORIES) {
        if (!cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) cats.push({ name, rows: [] });
      }
      return { raw: { mobility: mob, medball: med, categories: cats }, file: LIB_PATH };
    }
  } catch (e) { /* fall through to seed */ }
  const s = seedFromRepoMap();
  s.categories = DEFAULT_CATEGORIES.map((name) => ({ name, rows: [] }));
  return { raw: s, file: LIB_PATH };
}

const LOADED = loadVideoLib();
const MOBILITY_LIST = LOADED.raw.mobility;
const MEDBALL_LIST = LOADED.raw.medball;
const CATEGORIES = LOADED.raw.categories || [];

// Persist the library (Bobby's coach edits). Writes the same file loadVideoLib
// reads and refreshes the in-memory lists in place — no restart needed.
function saveVideoLib(doc) {
  const mobility = cleanRows(doc.mobility);
  const medball = cleanRows(doc.medball);
  const cats = (Array.isArray(doc.categories) ? doc.categories : [])
    .map((c) => ({ name: String((c && c.name) || '').trim().slice(0, 40), rows: cleanRows(c && c.rows) }))
    .filter((c) => c.name);
  const out = {
    mobility,
    medball,
    categories: {},
    updated: new Date().toISOString().slice(0, 10),
  };
  for (const c of cats) out.categories[c.name] = c.rows;
  fs.mkdirSync(path.dirname(LIB_PATH), { recursive: true });
  fs.writeFileSync(LIB_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  MOBILITY_LIST.length = 0;
  mobility.forEach((e) => MOBILITY_LIST.push(e));
  MEDBALL_LIST.length = 0;
  medball.forEach((e) => MEDBALL_LIST.push(e));
  CATEGORIES.length = 0;
  cats.forEach((c) => CATEGORIES.push(c));
  return out;
}

// YouTube URL for an exercise name. Case-insensitive, punctuation-insensitive,
// so "90/90 Hip Switch" matches "90 90 hip switch". Returns '' when missing.
function findVideoUrl(kind, name) {
  const list = kind === 'medball' ? MEDBALL_LIST : MOBILITY_LIST;
  const nn = normName(name);
  if (!nn) return '';
  for (const e of list) {
    if (normName(e.name) === nn) return e.url || '';
  }
  return '';
}

module.exports = { MOBILITY_LIST, MEDBALL_LIST, CATEGORIES, findVideoUrl, saveVideoLib, slugify, LIB_PATH };
