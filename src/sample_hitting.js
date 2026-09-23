/* Sample personalized hitting program (Sep 23 2026)
 * Demonstrates what a questionnaire-driven hitting program looks like.
 * This is a SAMPLE for Bobby to review — not real athlete data.
 *
 * Sample questionnaire answers (Bobby as the hitter):
 * - Environments: tee, side_toss, front_toss (NO cage, NO machine, NO live)
 * - Missing: cage (so no Live BP section)
 * - Goals: increase EV, improve barrel turn
 * - Current EV: 92 mph, Bat speed: 68 mph
 */

const SAMPLE_HITTING_PROGRAM = {
  athlete: 'Bobby Atkinson (Sample)',
  date_range: 'Sample — Sep 23–Oct 23',
  phase_emphasis: 'Barrel Turn + EV',
  adjustment: 'Get the barrel going fast early. Tee work builds the pattern, front toss transfers it to timing.',
  source: 'personalized',
  personalization_notes: [
    'No cage access → Live BP section omitted (was in template)',
    'Has tee + net → Tee Work expanded to 4 drills',
    'Goal: +EV → added Overload Bat Tee Work (heavy bat)',
    'Current EV 92 mph → target 95+ by end of block',
  ],
  questionnaire_snapshot: {
    environments: ['tee', 'side_toss', 'front_toss'],
    missing: ['cage', 'machine'],
    goals: ['Increase exit velocity', 'Improve barrel turn'],
    current_ev: '92 mph',
    current_bat_speed: '68 mph',
  },
  routine: [
    {
      category: 'Daily Routine',
      items: [
        { drill: 'No Stride Launch' },
        { drill: 'Open 45 w Stride' },
      ],
    },
    {
      category: 'Tee Work',
      items: [
        { drill: 'No Stride Launch', volume: '2 sets × 5 swings' },
        { drill: 'Open 45 w Stride', volume: '2 sets × 5 swings' },
        { drill: 'High Tee Barrel Turn', volume: '2 sets × 5 swings' },
        { drill: 'Overload Bat Tee Work', volume: '2 sets × 3 swings (heavy bat)' },
        { drill: 'Game Swings', volume: '2 sets × 8 swings' },
      ],
    },
    {
      category: 'Side Toss',
      items: [
        { drill: 'No Stride Launch', volume: '2 sets × 5 swings' },
        { drill: 'Barrel Turn Side Toss', volume: '2 sets × 5 swings' },
        { drill: 'Game Swings', volume: '2 sets × 8 swings' },
      ],
    },
    {
      category: 'Front Toss',
      items: [
        { drill: 'Open 45 w Stride', volume: '2 sets × 5 swings' },
        { drill: 'Timing Front Toss', volume: '2 sets × 8 swings' },
        { drill: 'Game Swings', volume: '2 sets × 10 swings' },
      ],
    },
  ],
  cues: {
    movement: 'Barrel fast early',
    timing: 'See it, be on time',
    game: 'One pitch at a time',
  },
};

module.exports = { SAMPLE_HITTING_PROGRAM };
