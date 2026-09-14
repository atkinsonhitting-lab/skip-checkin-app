// Skip: loads only the drill-name registry used for the check-in form's
// autocomplete datalist. No programs, no video library — those live in the
// private programs portal. DATA_DIR env var overrides ./data.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function loadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {};
  }
}

const drillLinks = loadJSON(path.join(DATA_DIR, 'drill_links.json'));
const links = drillLinks.links || {};
const aliases = drillLinks.aliases || {};

/**
 * Every known drill name, for the check-in form's autocomplete datalist.
 * Sources: the drill-link registry and its aliases.
 */
function drillNames() {
  const set = new Set();
  for (const k of Object.keys(links)) set.add(k);
  for (const k of Object.keys(aliases)) set.add(k);
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

module.exports = { DATA_DIR, drillNames };
