// Skip's Brain v2 — structured coaching library.
//
// Replaces the old free-text "coaching notes" blob. The problem with the blob:
// every training session appended more prose, nothing was ever removed, and old
// instructions contradicted new ones — the more Bobby trained Skip, the worse
// Skip got (prompt bloat). The fix:
//   1. A short, immutable core prompt (in server.js) — identity + 4 rules.
//   2. This library: discrete entries (rule / approach / cue / diagnosis /
//      example / note) that Bobby can add, edit, archive, or restore one at
//      a time on the Train Skip page.
//   3. Retrieval: only entries relevant to the hitter's current message get
//      injected — rules always, everything else by keyword match, capped at 5.
//      The prompt stays short no matter how much Bobby teaches him.

const { DatabaseSync } = require('node:sqlite'); // type hint only; db is injected

const LIB_TYPES = ['rule', 'approach', 'cue', 'diagnosis', 'example', 'note'];
const TYPE_LABELS = {
  rule: 'Rules',
  approach: 'Approaches',
  cue: 'Cues',
  diagnosis: 'Miss reads',
  example: 'Examples',
  note: 'Notes',
};

// ---------------------------------------------------------------------------
// Seed data: Bobby's knowledge, distilled from the old mega-prompt into
// discrete entries. Nothing was dropped — it just lives in pieces now.
// ---------------------------------------------------------------------------
const SEED_ENTRIES = [
  // ---- Rules: always injected, kept few on purpose ----
  { type: 'rule', title: 'Learn him over time — your #1 job',
    body: 'Your number one priority is learning this hitter over time: his words, his feels, what his best days have in common. Know what each hitter needs — no two hitters get the same coaching. When he is struggling, take him back to exactly what he was doing, feeling, and thinking when he was at his best — name the date, the score, his own words. Never give generic advice to a hitter you have history on.',
    tags: 'coaching priority' },
  { type: 'rule', title: 'Back-on-track order',
    body: 'When a hitter is struggling, remind — don\'t fix. Bring him back to the state he felt when he was good: what he was doing, feeling, and thinking on his best days, in his own words, name the date and level. Then help him see what\'s different now — he finds the gap, you hold up the mirror. You are not a swing doctor and never claim to fix his swing: never diagnose, never hand out fixes. Only when his old feels aren\'t working, suggest new things to try — experiments, not "the fix," one at a time.',
    tags: 'coaching priority slump' },
  { type: 'rule', title: 'Their words first',
    body: 'Coach off the hitter\'s own language, their what-worked entries, and their locked-in sessions before anything else. A cue in their own words beats a "better" cue every time. Only reach for the head coach\'s mechanical cues when the hitter has no history.',
    tags: 'coaching priority' },
  { type: 'rule', title: 'Mental and external first, mechanics when the hitter wants them',
    body: 'Game and at-bat problems get approach first: simple plan, ready early, decide late, 100% commitment to one thing. Then external cues before anything mechanical. But mechanics are needed a lot — whenever the hitter talks mechanics or asks for mechanical help, coach mechanics directly. Read what he wants. Cage problems get mechanics and feels.',
    tags: 'mental approach game slump' },
  { type: 'rule', title: 'One suggestion at a time',
    body: 'Praise what\'s good first. New suggestions only when his old feels aren\'t working — and one at a time, like a text from their coach. Never dump three changes in one message. End with one good follow-up question that moves them forward.',
    tags: 'format' },
  { type: 'rule', title: 'External cues before internal',
    body: 'Lead with an external cue — a target or outcome outside the body — before any internal body-part instruction. "Drive it through the shortstop" beats "extend your arms." Only go internal if the external cue isn\'t landing.',
    tags: 'cue external internal' },
  { type: 'rule', title: 'Never invent a cause',
    body: 'If a hitter describes a problem — rolling over, popping up, feeling late, pulling off — never state a specific mechanical cause as THE reason (wrapping the bat, casting, flying open, dropping the hands) unless the hitter described that cause himself or you have seen video of his swing. When he brings a problem, bring him back to the state he felt when he was good and help him see what\'s different now. If his old feels aren\'t getting it done, you can talk through what it could be — ask what HE thinks, lay out possibilities (never a diagnosis) using common sense and the playbook — and suggest new things to try, one at a time. A guessed cause teaches the wrong fix.',
    tags: 'coaching diagnosis honesty' },
  { type: 'rule', title: 'Build him up',
    body: 'You are here to help the hitter feel good and feel confident, and to help him mentally. Notice what\'s going right and name it. When he\'s spiraling, steady him with what\'s true: he\'s done it before, and his best days are the proof. Confidence comes from evidence — his own history. Never empty hype; build him up with what\'s real.',
    tags: 'coaching confidence mental' },
  { type: 'rule', title: 'No medical advice',
    body: 'Pain or injury: tell them to get it checked by a trainer and stick to swing talk.',
    tags: 'safety' },
  { type: 'rule', title: 'Steer back to the plate',
    body: 'Off-topic questions: answer briefly, then steer back to hitting.',
    tags: 'format' },

  // ---- Approaches: the mental menu for crowded heads ----
  { type: 'approach', title: 'Pick a Spot',
    body: 'For overthinkers at the plate: pick one field target and hunt it. One spot, full commitment.',
    tags: 'approach mental overthinking game plan' },
  { type: 'approach', title: 'Pick a Speed',
    body: 'Fully commit to one timing: sit fastball or sit off-speed. Pick a speed, no in-between.',
    tags: 'approach mental timing game' },
  { type: 'approach', title: 'Pick a Zone',
    body: 'Hunt one zone, stay on heater timing. Shrink the plate to shrink the thinking.',
    tags: 'approach mental zone game' },
  { type: 'approach', title: 'Dead Red Middle',
    body: 'Sit heater, middle of the plate. The simplest plan there is.',
    tags: 'approach mental game plan' },
  { type: 'approach', title: "Head coach's locked-in cue",
    body: 'When his own head got crowded, his cue was: "hit a line drive and take off the shortstop\'s hat." Simple plan. Clear intent. Full commitment.',
    tags: 'cue approach mental slump' },

  // ---- Cues: Bobby's mechanical cues, used sparingly ----
  { type: 'note', title: 'About the head coach\'s cues',
    body: 'The head coach\'s mechanical cues were mostly built for left-handed hitters — never force one onto a hitter it doesn\'t fit. They are the last resort, not the starting point.',
    tags: 'cue guidance' },
  { type: 'cue', title: 'Swing down the line',
    body: 'Let the barrel trace a line. Use when: hitter is spinny with no direction.',
    tags: 'cue mechanics spin direction' },
  { type: 'cue', title: 'Drive the back elbow',
    body: 'Use when: hitter is handsy, arms getting long early.',
    tags: 'cue mechanics hands arms' },
  { type: 'cue', title: 'Let it happen behind you',
    body: 'Use when: choppers and weak flares vs velo — let the ball travel.',
    tags: 'cue mechanics velo timing contact' },
  { type: 'cue', title: 'Load down, not back',
    body: 'Use when: hitter is swaying in the load.',
    tags: 'cue mechanics load sway' },
  { type: 'cue', title: 'Eyes behind your barrel',
    body: 'Use when: hitter is standing up on breakers.',
    tags: 'cue mechanics breaking-ball posture' },
  { type: 'cue', title: 'Hands above it, chest square',
    body: 'Use when: top-zone heat is beating them.',
    tags: 'cue mechanics high fastball' },
  { type: 'cue', title: "Don't shift — feel behind as the foot lands",
    body: 'Use when: barrel drag. Feel stacked behind as the foot lands.',
    tags: 'cue mechanics barrel-drag' },
  { type: 'cue', title: 'Waiting, waiting, waiting, go',
    body: 'Timing cue for rushers. Wait longer than feels natural.',
    tags: 'cue timing rushing' },
  { type: 'cue', title: 'Let the barrel outrace the hands',
    body: 'Use when: hitter is pushy, stuck behind the ball.',
    tags: 'cue mechanics push hands' },
  { type: 'cue', title: 'Flatten the BP angle',
    body: 'Missing under balls in games = BP angle too steep. Line drives and seated darts, not launch angle.',
    tags: 'cue mechanics launch-angle BP' },

  // ---- Diagnoses: reading the miss the way Bobby does ----
  // NOTE (Sep 16 2026): mechanical cause-asserting diagnoses were removed
  // per Bobby — Skip must not name a cause it cannot see. Approach-level
  // reads (ready early, decisions not mechanics) stay.
  { type: 'diagnosis', title: "Can't catch up to heat",
    body: 'Not ready early. Check plate position and approach before touching mechanics.',
    tags: 'diagnosis miss velo timing approach' },
  { type: 'diagnosis', title: 'Good in the cage, bad in games',
    body: 'Practicing mechanics, not decisions. Challenge the environment and give them a box plan.',
    tags: 'diagnosis cage games approach' },

  // ---- Examples: few-shot, in Skip's voice ----
  { type: 'example', title: 'Slumping, crowded head',
    body: 'Hitter: "I\'m thinking about everything up there."\nSkip: "That\'s the whole problem — three thoughts means zero commitment. Tonight it\'s Pick a Spot: left-center gap, heater timing, and you don\'t come off it. One target. You in?"',
    tags: 'example slump overthinking' },
  { type: 'example', title: 'Rolling over',
    body: 'Hitter: "I keep rolling over everything pull-side."\nSkip: "When\'s the last time you were barreling everything — what were you feeling on those days? And what\'s different now?"',
    tags: 'example mechanics rolling-over remind' },
  { type: 'example', title: "Coaching off their own words",
    body: 'Hitter: "When I\'m going good I feel like I\'m staying inside it."\nSkip: "Then that\'s your cue — \'stay inside it\' is YOUR language and it works. Next round, say it to yourself before every swing and grade yourself 1-10 on it after. What score are you giving today\'s round?"',
    tags: 'example their-words' },
];

// ---------------------------------------------------------------------------
// Setup: table, seed, and one-time migration of the legacy notes blob.
// ---------------------------------------------------------------------------
function ensureBrain(db, getSetting, setSetting) {
  db.exec(`
CREATE TABLE IF NOT EXISTS skip_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_type ON skip_library(type, active);
`);
  const count = db.prepare('SELECT COUNT(*) AS n FROM skip_library').get().n;
  if (count === 0) {
    const now = new Date().toISOString();
    const ins = db.prepare(
      'INSERT INTO skip_library (type, title, body, tags, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    );
    for (const e of SEED_ENTRIES) ins.run(e.type, e.title, e.body, e.tags, now, now);
    console.log(`BRAIN: seeded ${SEED_ENTRIES.length} library entries.`);
  }
  // One-time (Sep 15 2026): scrub Bobby's name from already-seeded library
  // entries (seed only runs on empty tables, so this fixes live DBs too).
  // Idempotent — re-running finds nothing to change.
  {
    const now = new Date().toISOString();
    const SCRUBS = [
      { from: 'Their words first', title: null,
        body: 'Coach off the hitter\'s own language, their what-worked entries, and their locked-in sessions before anything else. A cue in their own words beats a "better" cue every time. Only reach for the head coach\'s mechanical cues when the hitter has no history.',
        tags: null },
      { from: "Bobby's locked-in cue", title: "Head coach's locked-in cue",
        body: 'When his own head got crowded, his cue was: "hit a line drive and take off the shortstop\'s hat." Simple plan. Clear intent. Full commitment.',
        tags: 'cue approach mental slump' },
      { from: 'About Bobby\'s cues', title: 'About the head coach\'s cues',
        body: 'The head coach\'s mechanical cues were mostly built for left-handed hitters — never force one onto a hitter it doesn\'t fit. They are the last resort, not the starting point.',
        tags: null },
    ];
    const upd = db.prepare(
      'UPDATE skip_library SET title = COALESCE(?, title), body = COALESCE(?, body), tags = COALESCE(?, tags), updated_at = ? WHERE id = ?'
    );
    for (const s of SCRUBS) {
      const row = db.prepare('SELECT id FROM skip_library WHERE title = ?').get(s.from);
      if (row) upd.run(s.title, s.body, s.tags, now, row.id);
    }
    // Fallback: any entry whose title was renamed but body still names Bobby.
    db.prepare('UPDATE skip_library SET body = REPLACE(body, \'Bobby\'\'s\', \'the head coach\'\'s\'), updated_at = ? WHERE body LIKE \'%Bobby%\'').run(now);
  }
  // One-time (Sep 16 2026): backfill the "Never invent a cause" rule into
  // databases seeded before it existed. Idempotent — skips if the title
  // is already present.
  {
    const exists = db.prepare("SELECT id FROM skip_library WHERE title = 'Never invent a cause'").get();
    if (!exists) {
      const now = new Date().toISOString();
      const seed = SEED_ENTRIES.find((e) => e.title === 'Never invent a cause');
      if (seed) {
        db.prepare(
          'INSERT INTO skip_library (type, title, body, tags, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
        ).run(seed.type, seed.title, seed.body, seed.tags, now, now);
        console.log('BRAIN: backfilled "Never invent a cause" rule.');
      }
    }
  }
  // One-time (Sep 16 2026): archive the seeded mechanical-cause diagnoses
  // ("Rolling over / topspin pull-side", "Flaring oppo", "Stuck and pushy")
  // and rewrite the "Rolling over" example — Skip must not assert a cause it
  // cannot see (Bobby: "just give fixes"). Archived, not deleted, so Bobby
  // can restore from Train Skip. Idempotent.
  {
    const now = new Date().toISOString();
    const arch = db.prepare(
      "UPDATE skip_library SET active = 0, updated_at = ? WHERE type = 'diagnosis' AND active = 1 AND title IN ('Rolling over / topspin pull-side', 'Flaring oppo', 'Stuck and pushy')"
    );
    const n = arch.run(now).changes;
    if (n) console.log(`BRAIN: archived ${n} mechanical-cause diagnos(es).`);
    const ex = db.prepare(
      "SELECT id FROM skip_library WHERE type = 'example' AND title = 'Rolling over' AND body LIKE '%wrapping around your head%'"
    ).get();
    if (ex) {
      const seed = SEED_ENTRIES.find((e) => e.type === 'example' && e.title === 'Rolling over');
      if (seed) {
        db.prepare('UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE id = ?')
          .run(seed.body, seed.tags, now, ex.id);
        console.log('BRAIN: rewrote "Rolling over" example (fix, no invented cause).');
      }
    }
  }
  // One-time (Sep 16 2026): Bobby's "remind, don't fix" philosophy — refresh
  // the seed rules' bodies in existing DBs. The two long-standing rules only
  // update when they still match the original seed text (never overwrite
  // Bobby's own edits); the "Never invent a cause" rule is new today so it
  // updates unconditionally. Idempotent.
  {
    const now = new Date().toISOString();
    const backtrack = SEED_ENTRIES.find((e) => e.title === 'Back-on-track order');
    const suggest = SEED_ENTRIES.find((e) => e.title === 'One suggestion at a time');
    const noCause = SEED_ENTRIES.find((e) => e.title === 'Never invent a cause');
    const rollEx = SEED_ENTRIES.find((e) => e.type === 'example' && e.title === 'Rolling over');
    let n = 0;
    if (backtrack) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'rule' AND title = 'Back-on-track order' AND body = 'When getting a hitter back on track, work in this order: 1) his own past entries and best days, 2) mental — simple plan, clear intent, full commitment, 3) external cues — target or outcome outside the body, 4) mechanics — needed a lot. EXCEPTION: read what the hitter wants. If he is talking mechanics or asking for mechanical help, meet him there and coach mechanics directly. Never force the order on a hitter who is telling you what he needs.'"
      ).run(backtrack.body, backtrack.tags, now).changes;
    }
    if (suggest) {
      n += db.prepare(
        "UPDATE skip_library SET title = 'One suggestion at a time', body = ?, tags = ?, updated_at = ? WHERE type = 'rule' AND title = 'One fix at a time' AND body = 'Praise what''s good first, then give the single fix. 2-4 sentences, like a text from their coach. End with one good follow-up question that moves them forward. Never dump three mechanical changes in one message.'"
      ).run(suggest.body, suggest.tags, now).changes;
    }
    if (noCause) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'rule' AND title = 'Never invent a cause'"
      ).run(noCause.body, noCause.tags, now).changes;
    }
    if (rollEx) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'example' AND title = 'Rolling over' AND body LIKE '%which one sounds most like%'"
      ).run(rollEx.body, rollEx.tags, now).changes;
    }
    if (n) console.log(`BRAIN: updated ${n} Brain entr(ies) to remind-don't-fix philosophy.`);
  }
  // One-time (Sep 16 2026): Bobby's "hold up the mirror" refinement — Skip
  // brings the hitter back to the state he felt when he was good and helps
  // him see what's different now. Updates the entries from the previous
  // migration; idempotent.
  {
    const now = new Date().toISOString();
    const backtrack = SEED_ENTRIES.find((e) => e.title === 'Back-on-track order');
    const noCause = SEED_ENTRIES.find((e) => e.title === 'Never invent a cause');
    const rollEx = SEED_ENTRIES.find((e) => e.type === 'example' && e.title === 'Rolling over');
    let n = 0;
    if (backtrack) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'rule' AND title = 'Back-on-track order' AND body LIKE '%Take him back to what he was doing, feeling, and thinking on his best days%'"
      ).run(backtrack.body, backtrack.tags, now).changes;
    }
    if (noCause) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'rule' AND title = 'Never invent a cause'"
      ).run(noCause.body, noCause.tags, now).changes;
    }
    if (rollEx) {
      n += db.prepare(
        "UPDATE skip_library SET body = ?, tags = ?, updated_at = ? WHERE type = 'example' AND title = 'Rolling over' AND body LIKE '%before we try anything new%'"
      ).run(rollEx.body, rollEx.tags, now).changes;
    }
    if (n) console.log(`BRAIN: updated ${n} Brain entr(ies) to mirror philosophy.`);
  }
  // One-time (Sep 16 2026): backfill the "Build him up" rule (help hitters
  // feel good and confident, help them mentally) into databases seeded
  // before it existed. Idempotent.
  {
    const exists = db.prepare("SELECT id FROM skip_library WHERE title = 'Build him up'").get();
    if (!exists) {
      const now = new Date().toISOString();
      const seed = SEED_ENTRIES.find((e) => e.title === 'Build him up');
      if (seed) {
        db.prepare(
          'INSERT INTO skip_library (type, title, body, tags, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
        ).run(seed.type, seed.title, seed.body, seed.tags, now, now);
        console.log('BRAIN: backfilled "Build him up" rule.');
      }
    }
  }
  // One-time migration: split the legacy free-text blob into discrete notes
  // so Bobby's past training survives as individual, archivable entries.
  const legacy = (getSetting('coach_notes') || '').trim();
  if (legacy) {
    const chunks = legacy.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const now = new Date().toISOString();
    const ins = db.prepare(
      'INSERT INTO skip_library (type, title, body, tags, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    );
    for (const c of chunks) {
      ins.run('note', c.split('\n')[0].slice(0, 80) || 'Imported note', c, 'imported', now, now);
    }
    setSetting('coach_notes', '');
    console.log(`BRAIN: migrated ${chunks.length} legacy note(s) into the library.`);
  }
}

// ---------------------------------------------------------------------------
// Retrieval: rules always; other entries only when relevant to the message.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(
  'a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,do,does,did,doing,have,has,had,having,will,would,can,could,should,my,me,i,you,he,she,it,we,they,this,that,these,those,what,when,where,how,why,not,no,yes,so,just,like,get,got,go,going,went,im,ive,dont,cant,wont,there,here,very,really,always,never'.split(',')
);

function tokens(s) {
  return (String(s || '').toLowerCase().match(/[a-z']+/g) || [])
    .map((t) => t.replace(/'s$/, ''))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function relevantEntries(db, message, limit = 5) {
  const rows = db
    .prepare("SELECT id, type, title, body, tags FROM skip_library WHERE active = 1 AND type != 'rule' ORDER BY id")
    .all();
  const msgTokens = [...new Set(tokens(message))];
  if (!msgTokens.length || !rows.length) return [];
  return rows
    .map((r) => {
      const hay = `${r.title} ${r.body} ${r.tags}`.toLowerCase();
      let score = 0;
      for (const t of msgTokens) if (hay.includes(t)) score += t.length > 5 ? 2 : 1;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
}

function rulesEntries(db) {
  return db
    .prepare("SELECT id, type, title, body FROM skip_library WHERE active = 1 AND type = 'rule' ORDER BY id")
    .all();
}

// The block injected into Skip's system prompt for a hitter chat.
function libraryBlock(db, message) {
  const rules = rulesEntries(db);
  const rel = relevantEntries(db, message, 5);
  if (!rules.length && !rel.length) return '';
  const fmt = (e) => `- [${e.type.toUpperCase()}] ${e.title}: ${e.body}`;
  let out = "WHAT YOU'VE LEARNED ABOUT HITTING — background knowledge you've picked up, like a coach who's watched a lot of baseball. The rules always apply. The rest is there for when it's genuinely needed — answering a question, explaining something, working through a problem — not just diagnoses and fixes. Common sense first, and the hitter's own history and words before anything here. Never throw info at him without knowing his problem — understand what's actually going on first. Never force an entry in, never quote one at him, let it shape how you talk not script what you say:\n";
  out += rules.map(fmt).join('\n');
  if (rel.length) out += '\n' + rel.map(fmt).join('\n');
  return out;
}

// ---------------------------------------------------------------------------
// CRUD for the Train Skip page.
// ---------------------------------------------------------------------------
function listEntries(db) {
  return db
    .prepare('SELECT id, type, title, body, tags, active, updated_at FROM skip_library ORDER BY type, id')
    .all();
}

function addEntry(db, { type, title, body, tags }) {
  if (!LIB_TYPES.includes(type)) throw new Error('bad_type');
  const now = new Date().toISOString();
  return db
    .prepare(
      'INSERT INTO skip_library (type, title, body, tags, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    )
    .run(type, String(title || '').trim().slice(0, 120), String(body || '').trim().slice(0, 2000), String(tags || '').trim().slice(0, 200), now, now);
}

function updateEntry(db, id, { title, body, tags }) {
  db.prepare(
    'UPDATE skip_library SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?'
  ).run(
    String(title || '').trim().slice(0, 120),
    String(body || '').trim().slice(0, 2000),
    String(tags || '').trim().slice(0, 200),
    new Date().toISOString(),
    id
  );
}

function setEntryActive(db, id, active) {
  db.prepare('UPDATE skip_library SET active = ?, updated_at = ? WHERE id = ?')
    .run(active ? 1 : 0, new Date().toISOString(), id);
}

// ---------------------------------------------------------------------------
// Brain proposals: dual-approval queue. Any coach can propose; the entry goes
// live only after EVERY coach account has approved it. The proposer
// auto-approves at submit time. Publishing copies the proposal into
// skip_library as an active entry and marks the proposal live.
// ---------------------------------------------------------------------------
function listProposals(db) {
  return db
    .prepare(
      `SELECT p.id, p.type, p.title, p.body, p.tags, p.proposed_by, p.created_at,
              COALESCE(u.first_name || ' ' || u.last_name, '') AS proposer_name, u.email AS proposer_email
       FROM brain_proposals p JOIN users u ON u.id = p.proposed_by
       WHERE p.status = 'pending' ORDER BY p.created_at ASC`
    )
    .all()
    .map((p) => ({
      ...p,
      proposer_name: (p.proposer_name || '').trim() || p.proposer_email,
      approvals: db
        .prepare(
          `SELECT a.coach_id, COALESCE(u.first_name || ' ' || u.last_name, '') AS name, u.email
           FROM proposal_approvals a JOIN users u ON u.id = a.coach_id
           WHERE a.proposal_id = ?`
        )
        .all(p.id)
        .map((a) => ({ ...a, name: (a.name || '').trim() || a.email })),
    }));
}

function createProposal(db, { type, title, body, tags, proposedBy }) {
  if (!LIB_TYPES.includes(type)) throw new Error('bad_type');
  const now = new Date().toISOString();
  const r = db
    .prepare(
      'INSERT INTO brain_proposals (type, title, body, tags, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      type,
      String(title || '').trim().slice(0, 120),
      String(body || '').trim().slice(0, 2000),
      String(tags || '').trim().slice(0, 200),
      proposedBy,
      now
    );
  // Proposer counts as the first approval.
  db.prepare(
    'INSERT OR IGNORE INTO proposal_approvals (proposal_id, coach_id, created_at) VALUES (?, ?, ?)'
  ).run(r.lastInsertRowid, proposedBy, now);
  return r.lastInsertRowid;
}

// Returns 'live' if this approval published the entry, 'pending' if still
// waiting on other coaches, or null if the proposal wasn't pending.
function approveProposal(db, proposalId, coachId) {
  const p = db.prepare('SELECT id, status, type, title, body, tags FROM brain_proposals WHERE id = ?').get(proposalId);
  if (!p || p.status !== 'pending') return null;
  db.prepare(
    'INSERT OR IGNORE INTO proposal_approvals (proposal_id, coach_id, created_at) VALUES (?, ?, ?)'
  ).run(proposalId, coachId, new Date().toISOString());
  const approvals = db.prepare('SELECT COUNT(*) AS n FROM proposal_approvals WHERE proposal_id = ?').get(proposalId).n;
  const coaches = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'coach'").get().n;
  if (coaches > 0 && approvals >= coaches) {
    addEntry(db, { type: p.type, title: p.title, body: p.body, tags: p.tags });
    db.prepare("UPDATE brain_proposals SET status = 'live', decided_at = ? WHERE id = ?")
      .run(new Date().toISOString(), proposalId);
    return 'live';
  }
  return 'pending';
}

function rejectProposal(db, proposalId) {
  db.prepare("UPDATE brain_proposals SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(new Date().toISOString(), proposalId);
}

// ---------------------------------------------------------------------------
// Per-hitter durable memory: what Skip has learned about a hitter over time.
// Bobby writes these on the hitter's coach page; they inject into every chat.
// ---------------------------------------------------------------------------
function listMemory(db, userId) {
  return db
    .prepare('SELECT id, fact, created_at FROM hitter_memory WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

function addMemory(db, userId, fact) {
  const f = String(fact || '').trim().slice(0, 500);
  if (!f) return null;
  return db
    .prepare('INSERT INTO hitter_memory (user_id, fact, created_at) VALUES (?, ?, ?)')
    .run(userId, f, new Date().toISOString());
}

function deleteMemory(db, id) {
  db.prepare('DELETE FROM hitter_memory WHERE id = ?').run(id);
}

// Injected into Skip's prompt: durable learnings about THIS hitter.
function memoryBlock(db, userId, firstName) {
  const mems = listMemory(db, userId);
  if (!mems.length) return '';
  const name = firstName || 'this hitter';
  return `WHAT YOU'VE LEARNED ABOUT ${name.toUpperCase()} OVER TIME (durable memory — trust this like your own coaching notebook):\n` +
    mems.map((m) => `- ${m.fact}`).join('\n');
}

module.exports = {
  LIB_TYPES,
  TYPE_LABELS,
  SEED_ENTRIES,
  ensureBrain,
  libraryBlock,
  relevantEntries,
  rulesEntries,
  listEntries,
  addEntry,
  updateEntry,
  setEntryActive,
  listProposals,
  createProposal,
  approveProposal,
  rejectProposal,
  listMemory,
  addMemory,
  deleteMemory,
  memoryBlock,
};
