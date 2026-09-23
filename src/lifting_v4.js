// Different Animal — full lifting system, v4 (Sep 23 2026).
// Bobby: "make this a real legit lifting program" — monthly triphasic blocks
// (Absorb → Produce → Express), Kelly's 4-day offseason split, 3-day
// in-season, 5-section session flow, max-intent markers, contrast pairings.
//
// Video keys resolve against the YT map in db.js. New keys (YT_V4) are filled
// from the verified audit; any exercise without a verified exact demo keeps
// video '' rather than a wrong link.

const YT_V4 = {
  latBoxSquat: 'https://www.youtube.com/watch?v=bjkyer2hCxQ',
  rearLateral: 'https://www.youtube.com/watch?v=p1yQnTNE808',
  pallofHold: 'https://www.youtube.com/watch?v=XypX3A_0Kbg',
  dropCatch: 'https://www.youtube.com/watch?v=GAm6K6p2gvg',
  isoPull: 'https://www.youtube.com/shorts/W7qLXJaXb_c',
  pinSplit: 'https://www.youtube.com/watch?v=458ui9PxfP8',
  trunkRot: 'https://www.youtube.com/watch?v=mbbsYXGynDc',
  pinSquat: 'https://www.youtube.com/watch?v=3GjKE-OkLyY',
  splitSquat: 'https://www.youtube.com/watch?v=2V5NipAulKY',
  cossack: 'https://www.youtube.com/watch?v=51slmzoEVt8',
  hamBridge: 'https://www.youtube.com/watch?v=QgX9inLBTbA',
  curvedSprint: 'https://www.youtube.com/watch?v=6dNCYeFCo74',
  ity: 'https://www.youtube.com/watch?v=EHkvVqlCG68',
  bearCrawl: 'https://www.youtube.com/watch?v=EAR26sGk8yI',
  pullover: 'https://www.youtube.com/watch?v=dtrnz0EKwnE',
  rackPull: 'https://www.youtube.com/watch?v=9vYBWV5OeKg',
  bandedJumps: 'https://www.youtube.com/watch?v=-GXzGojjpr4',
  stepBackToss: 'https://www.youtube.com/shorts/xQQi7BviXnY',
  goblet: 'https://www.youtube.com/watch?v=Xjo_fY9Hl9w',
  tSpine: 'https://www.youtube.com/watch?v=NSxiZd8QGgA',
  hipCars: 'https://www.youtube.com/watch?v=5kM-o61Z14I',
};

const spd = (name, volume, notes, vkey, intent) => ({
  name, volume, notes: notes || '', vkey: vkey || '', intent: intent || '',
});
const ex = (name, sets, reps, target_rpe, rest, notes, vkey, section, intent) => ({
  name, sets: String(sets), reps: String(reps), target_rpe: target_rpe || '',
  rest: rest || 120, notes: notes || '', vkey: vkey || '',
  section: section || 'strength', intent: intent || '',
});

// V: video key -> verified URL. Returns the 4 template programs with resolved
// video URLs baked in (self-contained program_json).
function buildPrograms(V) {
  const v = (k) => (k && V[k]) || '';

  const M1 = {
    name: 'Different Animal — Offseason M1 (Absorb)',
    notes: [
      'MONTH 1 — ABSORB: eccentrics + isometrics. Load it HEAVY, lower it slow: 3–5 seconds down, explode up. ISO holds where programmed.',
      'ROTATION IS THE PRIORITY — rotational power and anti-rotation get loaded hard every week. This is a hitter\u2019s program.',
      'Explosive work stays at MAX INTENT ⚡ — moderate volume, perfect reps. Stop explosive work when rep quality drops.',
      'Test/retest every 2 weeks — log every lift, compare in the dashboard.',
    ],
    days: [
      { label: 'Day 1 — Upper: Horizontal Press + Vertical Pull',
        speed: [],
        medball: [
          spd('MB Shot-Put Throw', '4 x 5', 'Punch through the throw — hips then hands.', 'mbShotput', 'max'),
          spd('Plyo Push-Up', '3 x 5', 'Explode off the floor. Full recovery between sets.', 'plyoPushup', 'max'),
        ],
        exercises: [
          ex('DB Bench Press', '4', '5', 8, 120, 'ABSORB tempo: 4-sec down, 1-sec pause on the chest, explode up. Load it.', 'dbBench'),
          ex('DB Single-Arm Row', '4', '5/side', 8, 120, '3-sec down. Chest supported — no twisting. Heavy.', 'saRow'),
          ex('Cable Rotation', '4', '5/side', 8, 90, 'HEAVY rotation — hips do the work, arms just hold on.', 'cableRot', 'rotational', 'max'),
          ex('Pallof Press', '3', '10/side', 7, 60, '3-sec ISO hold every rep — own the position.', 'pallof', 'rotational'),
        ]},
      { label: 'Day 2 — Bilateral Lower',
        speed: [
          spd('10-Yard Sprint', '3 x 10 yd', 'Explode out — walk-back recovery.', 'sprint10', 'max'),
        ],
        medball: [
          spd('Trap-Bar Jump', '4 x 5 @ ~50% BW', 'Wake the nervous system up. Land soft, reset every rep.', 'trapJump', 'max'),
        ],
        exercises: [
          ex('Trap-Bar Deadlift', '4', '4', 8, 150, 'ABSORB tempo: 4-sec down to the knee, then drive the floor away. Heavy.', 'trapbar'),
          ex('Nordic Curl', '3', '5', 8, 120, 'Slow eccentrics — 5-sec lower, control the whole way down.', 'nordic', 'brakes'),
          ex('Lateral Box Squat', '3', '5/side', 8, 120, 'Sit back to the box, drive up through the whole foot. Load it.', 'latBoxSquat'),
        ]},
      { label: 'Day 3 — Upper: Horizontal Pull + Vertical Press',
        speed: [],
        medball: [
          spd('MB Rotational Throw', '5 x 5', 'Hips lead, hands follow — violent.', 'mbRot', 'max'),
          spd('Single-Arm Landmine Press', '4', '5/side', 8, 90, 'Explosive press — punch the ceiling.', 'landmine', 'max'),
        ],
        exercises: [
          ex('DB Single-Arm Row', '4', '5/side', 8, 120, '3-sec down, 1-sec squeeze at the top. Heavy.', 'saRow'),
          ex('DB Shoulder Press', '4', '5', 8, 120, 'ABSORB tempo: 3-sec down. Ribs down, no arching. Load it.', 'dbOhp'),
          ex('DB Rear-Lateral Raise', '3', '8–10', 7, 60, 'Light and strict — rear delts and upper back.', 'rearLateral'),
          ex('Pallof Hold', '3', '20 sec/side', 8, 60, 'Heaviest you can hold with perfect posture.', 'pallofHold', 'rotational'),
        ]},
      { label: 'Day 4 — Unilateral Lower (alone on purpose)',
        speed: [],
        medball: [
          spd('Drop-Catch Split Jump', '3 x 5', 'Stick every landing quiet.', 'dropCatch', 'max'),
          spd('Split-Squat ISO Pull', '3', '5/side', 7, 90, 'Potentiation primer: 5-sec ISO hold, then pull. Wakes up the Bulgarians.', 'isoPull'),
        ],
        exercises: [
          ex('Bulgarian Split Squat', '4', '5/leg', 8, 150, 'ABSORB: 3-sec down every rep. Torso tall. Heavy.', 'bulgarian'),
          ex('Pin Split Squat', '3', '5/leg', 8, 120, 'Dead stop off the pins — no bounce, pure concentric.', 'pinSplit'),
          ex('Nordic Curl', '3', '5', 8, 120, '5-sec lower.', 'nordic', 'brakes'),
          ex('DB Trunk Rotation', '3', '6/side', 8, 90, 'Heavy and controlled — brakes under load.', 'trunkRot', 'brakes'),
        ]},
    ],
  };

  const M2 = {
    name: 'Different Animal — Offseason M2 (Produce)',
    notes: [
      'MONTH 2 — PRODUCE: strength / concentric. Main lifts @85–90%, 2–5 reps, explosive concentric. Load it and move it.',
      'CONTRAST pairings: heavy lift → explosive movement, same plane, 3:00 rest. Rotation gets the contrast treatment too — heavy cable rotation → med-ball rotational throw.',
      'Test/retest every 2 weeks — log every lift, compare in the dashboard.',
    ],
    days: [
      { label: 'Day 1 — Upper: Horizontal Press + Vertical Pull',
        speed: [],
        medball: [
          spd('MB Shot-Put Throw', '5 x 4', 'Fewer reps, more violence per throw.', 'mbShotput', 'max'),
          spd('Plyo Push-Up', '3 x 5', 'CONTRAST: DB bench → plyo push-up. 3:00 rest.', 'plyoPushup', 'max'),
        ],
        exercises: [
          ex('DB Bench Press', '4', '4 @ 85%', 9, 180, 'PRODUCE: explosive concentric. CONTRAST with plyo push-up — 3:00 rest.', 'dbBench'),
          ex('DB Single-Arm Row', '4', '5/side', 9, 150, 'Heavy — explode the DB to the hip.', 'saRow'),
          ex('Cable Rotation', '4', '5/side', 9, 120, 'Heavy rotation, full speed. CONTRAST with med-ball rotational throw.', 'cableRot', 'rotational', 'max'),
          ex('Pallof Press', '3', '8/side', 8, 60, 'Heavy anti-rotation.', 'pallof', 'rotational'),
        ]},
      { label: 'Day 2 — Bilateral Lower',
        speed: [
          spd('10-Yard Sprint', '4 x 10 yd', 'Explode out — full recovery.', 'sprint10', 'max'),
        ],
        medball: [
          spd('Trap-Bar Jump', '5 x 3 @ ~50% BW', 'CONTRAST: deadlift → trap-bar jump. 3:00 rest.', 'trapJump', 'max'),
        ],
        exercises: [
          ex('Trap-Bar Deadlift', '3', '3 @ 85–90%', 9, 180, 'PRODUCE: move it fast. CONTRAST with trap-bar jump — 3:00 rest.', 'trapbar'),
          ex('Nordic Curl', '3', '5', 8, 120, 'Slow eccentrics.', 'nordic', 'brakes'),
          ex('Lateral Box Squat', '4', '5/side', 9, 120, 'Heavy single-leg strength. Drive.', 'latBoxSquat'),
        ]},
      { label: 'Day 3 — Upper: Horizontal Pull + Vertical Press',
        speed: [],
        medball: [
          spd('MB Rotational Throw', '5 x 5', 'Heavy ball, full intent. CONTRAST: heavy cable rotation → throw.', 'mbRot', 'max'),
          spd('Single-Arm Landmine Press', '4', '4/side', 8, 120, 'Heavy + explosive.', 'landmine', 'max'),
        ],
        exercises: [
          ex('DB Single-Arm Row', '4', '5/side', 9, 150, 'Heavy rows — own the squeeze.', 'saRow'),
          ex('DB Shoulder Press', '4', '4 @ 85%', 9, 150, 'PRODUCE: explosive lockout.', 'dbOhp'),
          ex('DB Rear-Lateral Raise', '3', '8', 7, 60, 'Strict.', 'rearLateral'),
          ex('Pallof Hold', '3', '20 sec/side', 8, 60, 'Max weight with perfect posture.', 'pallofHold', 'rotational'),
        ]},
      { label: 'Day 4 — Unilateral Lower (alone on purpose)',
        speed: [],
        medball: [
          spd('Drop-Catch Split Jump', '4 x 4', 'CONTRAST: Bulgarian → split jump. 3:00 rest.', 'dropCatch', 'max'),
          spd('Split-Squat ISO Pull', '3', '3/side', 8, 120, 'Heavy ISO potentiation before Bulgarians.', 'isoPull'),
        ],
        exercises: [
          ex('Bulgarian Split Squat', '3', '5/leg @ 85%', 9, 180, 'PRODUCE: heavy. CONTRAST with drop-catch split jump — 3:00 rest.', 'bulgarian'),
          ex('Pin Split Squat', '3', '4/leg', 9, 150, 'Heavy, dead stop off the pins. Drive.', 'pinSplit'),
          ex('Nordic Curl', '3', '5', 8, 120, 'Slow eccentrics.', 'nordic', 'brakes'),
          ex('DB Trunk Rotation', '3', '6/side', 9, 90, 'Heavy and controlled — brakes under max load.', 'trunkRot', 'brakes'),
        ]},
    ],
  };

  const M3 = {
    name: 'Different Animal — Offseason M3 (Express)',
    notes: [
      'MONTH 3 — EXPRESS: speed / transfer. @75%, moved as fast as humanly possible. Jumps, med-ball, and sprints LEAD the session.',
      'Rotation at max speed — rotational throws are the main event, not the warm-up.',
      'Volume up on explosive work. If the bar slows down, it\'s too heavy.',
      'Test/retest every 2 weeks — this is where the numbers should jump.',
    ],
    days: [
      { label: 'Day 1 — Upper: Horizontal Press + Vertical Pull',
        speed: [],
        medball: [
          spd('MB Shot-Put Throw', '5 x 5', 'Throws LEAD today — max violence.', 'mbShotput', 'max'),
          spd('Plyo Push-Up', '4 x 5', 'Fast hands off the floor.', 'plyoPushup', 'max'),
        ],
        exercises: [
          ex('DB Bench Press', '4', '5 @ 75%', 8, 90, 'EXPRESS: move the DBs violently fast.', 'dbBench'),
          ex('DB Single-Arm Row', '3', '6/side', 8, 90, 'Fast and crisp. Heavy intent, fast hands.', 'saRow'),
          ex('Cable Rotation', '3', '6/side', 9, 60, 'MAX rotation speed.', 'cableRot', 'rotational', 'max'),
          ex('Pallof Press', '2', '10/side', 7, 60, 'Snappy.', 'pallof', 'rotational'),
        ]},
      { label: 'Day 2 — Bilateral Lower',
        speed: [
          spd('10-Yard Sprint', '5 x 10 yd', 'Sprints lead — full recovery.', 'sprint10', 'max'),
        ],
        medball: [
          spd('Trap-Bar Jump', '5 x 5 @ ~40% BW', 'Jump day. Every rep maximal.', 'trapJump', 'max'),
        ],
        exercises: [
          ex('Trap-Bar Deadlift', '3', '3 @ 75%', 8, 120, 'EXPRESS: speed pulls — violent bar speed.', 'trapbar'),
          ex('Nordic Curl', '2', '5', 7, 90, 'Controlled.', 'nordic', 'brakes'),
          ex('Lateral Box Squat', '3', '6/side', 8, 90, 'Violent out of the bottom.', 'latBoxSquat'),
        ]},
      { label: 'Day 3 — Upper: Horizontal Pull + Vertical Press',
        speed: [],
        medball: [
          spd('MB Rotational Throw', '5 x 5', 'The main event — max rotation speed, every throw.', 'mbRot', 'max'),
          spd('Single-Arm Landmine Press', '4', '5/side', 7, 90, 'Speed press.', 'landmine', 'max'),
        ],
        exercises: [
          ex('DB Single-Arm Row', '3', '6/side', 8, 90, 'Fast and crisp.', 'saRow'),
          ex('DB Shoulder Press', '3', '5 @ 75%', 8, 90, 'Violent lockout.', 'dbOhp'),
          ex('DB Rear-Lateral Raise', '2', '10', 6, 60, 'Strict.', 'rearLateral'),
          ex('Pallof Hold', '2', '15 sec/side', 6, 60, 'Own it.', 'pallofHold', 'rotational'),
        ]},
      { label: 'Day 4 — Unilateral Lower (alone on purpose)',
        speed: [],
        medball: [
          spd('Drop-Catch Split Jump', '5 x 4', 'Jumps lead — maximal every rep.', 'dropCatch', 'max'),
          spd('Split-Squat ISO Pull', '2', '5/side', 6, 90, 'Primer only.', 'isoPull'),
        ],
        exercises: [
          ex('Bulgarian Split Squat', '3', '5/leg @ 70%', 7, 120, 'EXPRESS: fast concentrics.', 'bulgarian'),
          ex('Pin Split Squat', '2', '5/leg', 7, 90, 'Explode off the pins.', 'pinSplit'),
          ex('Nordic Curl', '2', '5', 7, 90, 'Controlled.', 'nordic', 'brakes'),
          ex('DB Trunk Rotation', '3', '8/side', 7, 60, 'Brakes stay sharp.', 'trunkRot', 'brakes'),
        ]},
    ],
  };

  const INSEASON = {
    name: 'Different Animal — In-Season (3-Day)',
    notes: [
      'IN-SEASON: never zero. 1 high-quality lift per week minimum — cut volume, never intensity.',
      'Remove excess work when games pile up. No "easy J-band only" maintenance.',
      'Track output and fatigue — if the numbers dip two weeks running, pull volume back.',
    ],
    days: [
      { label: 'Day 1 — Lower + Acceleration',
        speed: [
          spd('10-Yard Sprint', '3 x 10 yd', 'Full recovery.', 'sprint10', 'max'),
        ],
        medball: [
          spd('Broad Jump', '3 x 3', 'Max horizontal power — stick the landing.', 'broadJump', 'max'),
        ],
        exercises: [
          ex('Pin Squat', '3', '2 @ 85–90%', 9, 180, 'Move the bar fast. Dead stop, no bounce.', 'pinSquat'),
          ex('Split Squat', '3', '3 @ 85%', 8, 150, 'Heavy, tall torso.', 'splitSquat'),
          ex('Cable Rotation', '2', '5/side', 7, 60, 'Keep the rotation live.', 'cableRot', 'rotational'),
          ex('Cossack Squat', '2', '5/side', 6, 60, 'Deep lateral mobility under control.', 'cossack'),
          ex('Hamstring Bridge ISO', '2', '20 sec', 6, 60, 'Squeeze the glutes, hold.', 'hamBridge', 'brakes'),
        ]},
      { label: 'Day 2 — Upper + Top Speed',
        speed: [
          spd('Curved Sprint', '3 reps', 'Lean into the curve — full recovery.', 'curvedSprint', 'max'),
        ],
        medball: [],
        exercises: [
          ex('Push Press', '3', '2 @ 85–90%', 9, 180, 'Leg drive, fast hands.', 'pushPress'),
          ex('Bench Press', '4', '3 @ 85%', 8, 150, 'Move it fast.', 'bbBench'),
          ex('ITY', '2', '8', 6, 60, 'Shoulder health — light and clean.', 'ity'),
          ex('Bear Crawl', '2', '20 yards', 6, 60, 'Long spine, quiet knees.', 'bearCrawl'),
          ex('Deep-Range Pullover', '2', '8', 6, 60, 'Big stretch, control the weight.', 'pullover'),
        ]},
      { label: 'Day 3 — Primer',
        speed: [],
        medball: [
          spd('Banded Alternate Jumps', '3 x 5', 'Quick ground contacts.', 'bandedJumps', 'max'),
          spd('MB Step-Back Toss', '2 x 5', 'Load the back hip, throw.', 'stepBackToss', 'max'),
        ],
        exercises: [
          ex('Rack-Elevated Deadlift', '3', '3 @ 70%', 7, 120, 'Smooth and fast — primer, not a max.', 'rackPull'),
          ex('Goblet Squat', '3', '4', 6, 90, 'Deep and smooth.', 'goblet'),
          ex('Face Pull', '2', '12', 6, 60, 'Own the upper back.', 'facePull'),
          ex('T-Spine Mobility', '1', '5/side', 5, 0, 'Dynamic only — open the thoracic spine.', 'tSpine', 'rotational'),
          ex('Hip CARs', '1', '5/side', 5, 0, 'Slow, controlled circles — own every degree.', 'hipCars', 'rotational'),
        ]},
    ],
  };

  // Resolve video keys to URLs; bake self-contained program_json.
  const resolve = (items) => items.map((it) => {
    const o = { ...it };
    o.video = v(it.vkey);
    delete o.vkey;
    return o;
  });
  return [M1, M2, M3, INSEASON].map((p) => ({
    name: p.name,
    notes: p.notes,
    days: p.days.map((d) => ({
      label: d.label,
      speed: resolve(d.speed || []),
      medball: resolve(d.medball || []),
      exercises: resolve(d.exercises || []),
    })),
  }));
}

module.exports = { YT_V4, buildPrograms };
