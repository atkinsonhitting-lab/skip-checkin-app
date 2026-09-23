// Program item video links (Sep 2026).
//
// Matches program items (mobility / med ball / hitting drills / prep work) to
// Bobby's videos from two sources:
//   1. His drill registry (data/drill_links.json, synced from his sheets):
//      YouTube URLs for mobility + med-ball, Drive URLs for hitting drills.
//   2. The app's video library (video_library table, synced from the
//      "Atkinson Hitting Development System" Drive folder): matched by title.
//      New videos Bobby drops in Drive auto-link on the next library sync.
//
// Matching is conservative by design (Bobby's rule): exact and alias matches
// always link; the fuzzy fallback only links on a confident token overlap.
// No match -> the item stays blank. No guessing, no placeholders.
//
// Manual links always win: items carry video_source = 'manual' when Bobby
// sets or clears a link in the coach editor. Auto-linking only fills items
// that have no video AND no manual decision, and never overrides an existing
// link.

const fs = require('fs');
const path = require('path');

// Minimum Jaccard token overlap for the fuzzy fallback. A token-subset in
// either direction also counts as a confident match.
const FUZZY_JACCARD_MIN = 0.67;

let _reg = null;
function registry() {
  if (_reg) return _reg;
  try {
    _reg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'drill_links.json'), 'utf8')
    );
  } catch (e) {
    _reg = { links: {}, aliases: {} };
  }
  if (!_reg.links) _reg.links = {};
  if (!_reg.aliases) _reg.aliases = {};
  return _reg;
}

// Normalize a drill/video name for comparison: strip trailing " — note"
// suffixes, lowercase, drop punctuation, drop the generic word "drill".
function normName(s) {
  return String(s || '')
    .split(/ — | - /)[0]
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bdrills?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'to', 'and', 'of', 'for']);
function tokens(s) {
  return normName(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

// 0..1 confidence that two names refer to the same drill. 1 = exact/alias,
// (0,1] = fuzzy token overlap, 0 = no confident match.
function matchConfidence(drill, candidate) {
  const n = normName(drill);
  const c = normName(candidate);
  if (!n || !c) return 0;
  if (n === c) return 1;
  const dt = new Set(tokens(drill));
  const kt = new Set(tokens(candidate));
  if (!dt.size || !kt.size) return 0;
  const inter = [...dt].filter((t) => kt.has(t)).length;
  const union = new Set([...dt, ...kt]).size;
  const jacc = union ? inter / union : 0;
  const subset = [...dt].every((t) => kt.has(t)) || [...kt].every((t) => dt.has(t));
  if (subset) return 1;
  return jacc >= FUZZY_JACCARD_MIN ? jacc : 0;
}

const driveUrl = (fileId) => `https://drive.google.com/file/d/${fileId}/view`;

// Resolve one drill name to a video URL, or '' when there's no confident
// match. libRows: [{ drive_file_id, title }] — visible library videos only;
// PDFs are browse-only and never auto-link.
function matchDrillVideo(drill, libRows) {
  const reg = registry();
  const linkKeys = Object.keys(reg.links);
  const n = normName(drill);
  if (!n) return '';
  // 1. Exact registry match.
  for (const k of linkKeys) {
    if (normName(k) === n) return reg.links[k];
  }
  // 2. Bobby's alias table. A null alias means he explicitly marked this
  // drill as having no video — respect it, don't fall through to fuzzy.
  for (const k of Object.keys(reg.aliases)) {
    if (normName(k) !== n) continue;
    const canon = reg.aliases[k];
    if (!canon) return '';
    for (const kk of linkKeys) {
      if (normName(kk) === normName(canon)) return reg.links[kk];
    }
    return '';
  }
  // 3. Confident fuzzy match — registry first (Bobby curated it), then the
  // live library (covers videos he added that aren't in the registry yet).
  let best = '';
  let bestScore = 0;
  for (const k of linkKeys) {
    const s = matchConfidence(drill, k);
    if (s > bestScore) {
      bestScore = s;
      best = reg.links[k];
    }
  }
  for (const v of libRows || []) {
    const s = matchConfidence(drill, v.title);
    if (s > bestScore) {
      bestScore = s;
      best = driveUrl(v.drive_file_id);
    }
  }
  return bestScore > 0 ? best : '';
}

// Bobby's rule (Sep 2026): lifting, mobility, and med ball are ALL YouTube
// videos — never the in-app drill library. Registry-only match for those
// items; the library fuzzy fallback is for hitting drills only.
function youTubeOnlyCategory(cat) {
  const c = String(cat || '');
  return /med\s*ball/i.test(c) || /mobility/i.test(c) || /recovery/i.test(c);
}
function matchRegistryOnly(drill) {
  const reg = registry();
  const linkKeys = Object.keys(reg.links);
  const n = normName(drill);
  if (!n) return '';
  for (const k of linkKeys) {
    if (normName(k) === n) return reg.links[k];
  }
  for (const k of Object.keys(reg.aliases)) {
    if (normName(k) !== n) continue;
    const canon = reg.aliases[k];
    if (!canon) return '';
    for (const kk of linkKeys) {
      if (normName(kk) === normName(canon)) return reg.links[kk];
    }
    return '';
  }
  return '';
}

// Fill in missing video links on a program object (mutates it). Returns the
// number of items linked. Skips items that already have a link and items
// Bobby decided on by hand (video_source === 'manual').
function attachVideoLinks(prog, libRows) {
  let count = 0;
  const blocks = prog && Array.isArray(prog.routine) ? prog.routine : [];
  for (const c of blocks) {
    const ytOnly = youTubeOnlyCategory(c && c.category);
    for (const it of (c && c.items) || []) {
      if (!it || it.video) continue;
      if (it.video_source === 'manual') continue;
      // Lifting / mobility / med ball / recovery: YouTube via Bobby's
      // registry only — never the Drive library. Hitting keeps the library.
      const url = ytOnly ? matchRegistryOnly(it.drill) : matchDrillVideo(it.drill, libRows);
      if (url) {
        it.video = url;
        it.video_source = 'auto';
        count++;
      }
    }
  }
  return count;
}

// One-time repair (Sep 2026): mobility + recovery items that were auto-linked
// to the drill library (Drive/in-app) get re-pointed at Bobby's YouTube
// registry links; non-YouTube auto-links with no registry match are cleared.
// Manual links are never touched.
function repairMobilityLinks(prog) {
  let fixed = 0;
  let purged = 0;
  const blocks = prog && Array.isArray(prog.routine) ? prog.routine : [];
  const isYT = (u) => /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(String(u || ''));
  for (const c of blocks) {
    const cat = String((c && c.category) || '');
    if (!/mobility/i.test(cat) && !/recovery/i.test(cat)) continue;
    for (const it of (c && c.items) || []) {
      if (!it || it.video_source === 'manual' || !it.video) continue;
      const yt = matchRegistryOnly(it.drill);
      if (yt && it.video !== yt) {
        it.video = yt;
        it.video_source = 'auto';
        fixed++;
      } else if (!yt && !isYT(it.video)) {
        it.video = '';
        purged++;
      }
    }
  }
  return { fixed, purged };
}
function repairMedBallLinks(prog) {
  let fixed = 0;
  const blocks = prog && Array.isArray(prog.routine) ? prog.routine : [];
  for (const c of blocks) {
    if (!/med\s*ball/i.test(String((c && c.category) || ''))) continue;
    for (const it of (c && c.items) || []) {
      if (!it || it.video_source === 'manual') continue;
      const yt = matchRegistryOnly(it.drill);
      if (yt && it.video !== yt) {
        it.video = yt;
        it.video_source = 'auto';
        fixed++;
      }
    }
  }
  return fixed;
}

// Visible library videos as match candidates (custom_name wins; hidden and
// PDF rows excluded).
function getLibraryRows(db) {
  try {
    return db
      .prepare(
        "SELECT drive_file_id, CASE WHEN custom_name IS NULL OR trim(custom_name) = '' THEN name ELSE custom_name END AS title FROM video_library WHERE hidden = 0 AND mime_type LIKE 'video/%'"
      )
      .all()
      .filter((v) => v.drive_file_id && v.title);
  } catch (e) {
    return [];
  }
}

// Run auto-linking across every stored program. Returns { linked, programs }.
function autoLinkAllPrograms(db, libRows) {
  const rows = db.prepare('SELECT id, program_json FROM remote_programs').all();
  let linked = 0;
  let programs = 0;
  const upd = db.prepare('UPDATE remote_programs SET program_json = ?, updated_at = ? WHERE id = ?');
  for (const row of rows) {
    let prog = {};
    try {
      prog = JSON.parse(row.program_json || '{}');
    } catch (e) {
      continue;
    }
    const n = attachVideoLinks(prog, libRows);
    if (n > 0) {
      upd.run(JSON.stringify(prog), new Date().toISOString(), row.id);
      linked += n;
      programs++;
    }
  }
  return { linked, programs };
}

module.exports = {
  FUZZY_JACCARD_MIN,
  registry,
  normName,
  matchConfidence,
  matchDrillVideo,
  matchRegistryOnly,
  attachVideoLinks,
  repairMedBallLinks,
  repairMobilityLinks,
  getLibraryRows,
  autoLinkAllPrograms,
};
