/**
 * The scenario deck: ten simulated cooks.
 *
 * Default behaviour in all of them is the real cook's pattern, taken from
 * Docs/Reference/roast-session-2026-08-22.json: sparse irregular readings about
 * 45 minutes apart, and the dial moved ~30 seconds after logging a reading. In
 * that export the cook did exactly that three times out of three, which makes
 * it the default here rather than an edge case - it is also the exact path
 * through assessOvenChangeEffect where the double-charge bug of b823705 lived.
 *
 * Serve times are set from measured model durations, not from round numbers.
 * The plan for this harness predated the calibration and assumed a 6 lb prime
 * rib needs ~5 h at 200 F; the calibrated model says 2 h 35 m. Where the two
 * disagree the intent of the scenario ("on track", "running late") wins over
 * the literal figure, and the deviation is called out per scenario below.
 */
import { mulberry32 } from './meatModel.js';

/** The driver's observation grid. Reading times are quantised to it. */
export const TICK_MINUTES = 5;

/** Everything is timed from here. A fixed instant keeps transcripts diffable. */
export const COOK_START_ISO = '2026-08-22T18:00:00.000Z';

const F = (celsius) => Math.round((celsius * 9 / 5 + 32) * 10) / 10;
const quantise = (minutes) => Math.round(minutes / TICK_MINUTES) * TICK_MINUTES;

/**
 * A sparse, irregular reading schedule on the tick grid.
 *
 * @param {Object} params
 * @param {number} params.seed
 * @param {number} params.everyMin - Nominal cadence
 * @param {number} params.jitterMin - Uniform +/- jitter before quantising
 * @param {number} params.untilMin - Generate at least this far out
 * @param {Array<{afterMin: number, gapMin: number}>} [params.gaps] - Force a
 *   stretch with no readings at all, starting after the first reading at or
 *   past `afterMin`
 * @returns {number[]} Ascending minute offsets, first always 0
 */
export function cadence({ seed, everyMin, jitterMin, untilMin, gaps = [] }) {
  const rand = mulberry32(seed);
  const out = [0];
  let t = 0;
  while (t < untilMin) {
    let step = everyMin + (rand() * 2 - 1) * jitterMin;
    const gap = gaps.find((g) => t >= g.afterMin && !g.used);
    if (gap) {
      gap.used = true;
      step = gap.gapMin;
    }
    t += step;
    const next = quantise(t);
    // Quantising can collide with the previous entry; a duplicate reading time
    // is not a sparse cadence, it is two readings at once.
    if (next > out[out.length - 1]) out.push(next);
    t = next;
  }
  return out;
}

/**
 * @typedef {Object} Scenario
 * @property {string} name - Also the artifact filename stem
 * @property {string} title
 * @property {string} what - What this cook is meant to exercise
 * @property {string} [caveat] - Where it departs from the written plan, and why
 * @property {number} seed
 * @property {Object} config - Session config; `serveAfterMin` replaces
 *   desiredServeTime, which the driver stamps from COOK_START_ISO
 * @property {Object} [settings] - Overrides on createDefaultSettings()
 * @property {Object} model - createMeatModel options
 * @property {number[]} readingsAt - Minute offsets to log a reading at
 * @property {Array<Object>} [cookActions] - Dial moves the virtual cook makes
 *   on their own initiative, regardless of advice
 * @property {number} maxMinutes - Give up after this long
 * @property {boolean} [advisoryConvergence] - Exclude from the convergence
 *   assertion (still reported)
 * @property {boolean} [obeysReadingPrompt] - Default true. False models a cook
 *   who ignores the app's request for a reading, which is the control for whether
 *   the prompt is worth anything.
 * @property {boolean} [excludeFromAcceptance] - Keep this cook out of the
 *   deck-wide acceptance aggregate. For cooks that are not representative of
 *   normal operation: the 12-hour shoulder, and the control cooks whose bad
 *   numbers are the measurement rather than a failure. Still fully asserted
 *   against its own recorded baseline.
 */

/** Shared: a 6 lb bone-in prime rib out of the fridge. */
const PRIME_RIB_6LB = { weightLb: 6, cut: 'prime-rib', startCoreF: 48 };

export const SCENARIOS = [
  {
    name: '01-real-replay',
    title: 'Real replay',
    what:
      "The exported cook's own config, target, units and oven history, then " +
      'simulated forward to target at its own ~45 min cadence. The first two ' +
      'dial moves are the human cook\'s actual choices (212 -> 266 -> 248 F), ' +
      'replayed; after that the app is in charge.',
    caveat:
      'The export has weight: null, so the model uses the 6 lb reference the ' +
      'constants were fitted at. Reading times are quantised from 0/44.05/88.55 ' +
      'to 0/45/90 by the 5 min tick grid.',
    seed: 101,
    config: {
      targetTemp: 129.9,
      units: 'C',
      startingTemp: 46.4,
      initialOvenTemp: 212,
      serveAfterMin: 181,       // 05:00Z from a 01:59Z start, per the export
      meatType: null,
      meatCut: null,
      weight: null,
      notes: 'Replay of roast-session-2026-08-22.json'
    },
    model: { weightLb: 6, cut: 'prime-rib', startCoreF: 46.4, ovenSetF: 212 },
    // The export's own three reading times, quantised, then its cadence onward.
    readingsAt: [0, 45, 90,
      ...cadence({ seed: 101, everyMin: 45, jitterMin: 8, untilMin: 400 }).filter((t) => t > 90)],
    cookActions: [
      { atMin: 45.5, kind: 'set-oven', tempF: 266 },
      { atMin: 90.5, kind: 'set-oven', tempF: 248 }
    ],
    // The app takes over only once the replayed history is exhausted. Both the
    // replayed move and an applied recommendation would otherwise land ~30 s
    // after the same reading, and the transcript would show two dial positions
    // for one instant.
    obeyFromMin: 91,
    maxMinutes: 420
  },

  {
    name: '02-baseline-on-track',
    title: 'Baseline, on track',
    what:
      'A 6 lb prime rib at 200 F with a serve time set 10 min past where the ' +
      'model actually finishes. Nothing is wrong; the question is whether the ' +
      'app leaves it alone.',
    caveat:
      'The plan said "serve in 5 h". The calibrated model reaches 125 F in ' +
      '155 min at 200 F, so 5 h would be the running-very-early scenario, not ' +
      'the baseline. Serve is set to 165 min to keep the scenario what it says.',
    seed: 202,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 200,
      serveAfterMin: 165,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 200 },
    readingsAt: cadence({ seed: 202, everyMin: 45, jitterMin: 10, untilMin: 400 }),
    maxMinutes: 420
  },

  {
    name: '03-running-late',
    title: 'Running late',
    what:
      'A 7 lb prime rib started at 175 F - too low - against a serve time the ' +
      'model misses by ~40 min. Should need successive raises, and must not ' +
      'stack them on top of each other.',
    seed: 303,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 175,
      serveAfterMin: 170,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 7,
      notes: null
    },
    model: { weightLb: 7, cut: 'prime-rib', startCoreF: 48, ovenSetF: 175 },
    readingsAt: cadence({ seed: 303, everyMin: 45, jitterMin: 10, untilMin: 400 }),
    maxMinutes: 440
  },

  {
    name: '04-running-very-early',
    title: 'Running very early',
    what:
      'A 6 lb prime rib at 250 F against a serve time 4 h out. The model gets ' +
      'there in ~2 h, so this should walk down through lower to the practical ' +
      'minimum and then to the oven-off path.',
    caveat:
      'The plan said 8 h to serve. That would leave a finished roast sitting ' +
      'for 6 h, which is not a cook anyone would run; 4 h reaches the same ' +
      'lower-then-oven-off branch without being physically absurd.',
    seed: 404,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 250,
      serveAfterMin: 240,
      meatType: 'Prime Rib',
      meatCut: 'Boneless',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 250 },
    readingsAt: cadence({ seed: 404, everyMin: 40, jitterMin: 8, untilMin: 500 }),
    maxMinutes: 520
  },

  {
    name: '05-overnight-shoulder',
    title: 'Overnight shoulder, stall engaged',
    what:
      'A 9 lb bone-in pork shoulder at 225 F to 195 F over 12 h, with the ' +
      'evaporative stall active through 150-165 F. The stall costs the model ' +
      '~3 h, which is the longest sustained disagreement between measured rate ' +
      'and remaining time the app will ever see.',
    caveat:
      'The stall term is fabricated, not calibrated - the real export never ' +
      'gets past 92 F core. Its magnitude is chosen so the stall costs a 9 lb ' +
      'shoulder about 3 h, which is plausible, not measured.',
    seed: 505,
    config: {
      targetTemp: 195,
      units: 'F',
      startingTemp: 40,
      initialOvenTemp: 225,
      serveAfterMin: 720,
      meatType: 'Pork Shoulder',
      meatCut: 'Bone-in',
      weight: 9,
      notes: null
    },
    model: { weightLb: 9, cut: 'pork-shoulder', startCoreF: 40, ovenSetF: 225 },
    readingsAt: cadence({ seed: 505, everyMin: 60, jitterMin: 15, untilMin: 900 }),
    maxMinutes: 960,
    // A 12-hour cook against thresholds set for 3-hour ones. Asserted against its
    // own baseline; kept out of the aggregate.
    excludeFromAcceptance: true
  },

  {
    name: '06-reading-gap',
    title: 'Reading gap',
    what:
      '100 minutes with no reading in the middle of an otherwise ordinary ' +
      'cook. Watches staleness, confidence decay, and whether the ETA sits ' +
      'frozen or goes stale-but-honest.',
    caveat:
      'Convergence is advisory here: the gap is the point of the scenario, so ' +
      'missing the serve time is information, not a failure.',
    seed: 606,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 200,
      serveAfterMin: 175,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 200 },
    readingsAt: cadence({
      seed: 606, everyMin: 40, jitterMin: 5, untilMin: 400,
      gaps: [{ afterMin: 80, gapMin: 100 }]
    }),
    maxMinutes: 440,
    advisoryConvergence: true
  },

  {
    name: '07-pause-and-restart',
    title: 'Pause and restart',
    what:
      'The cook turns the oven off for 40 min at 95 min in and logs no reading ' +
      'while it is off, then restarts at the last active setting. Exercises the ' +
      'needs-reading branch and lastActiveOvenTemp, which is the field that ' +
      'reads 0 if an off event is mistaken for a set point.',
    seed: 707,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 210,
      serveAfterMin: 210,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 210 },
    readingsAt: cadence({
      seed: 707, everyMin: 45, jitterMin: 8, untilMin: 400,
      gaps: [{ afterMin: 85, gapMin: 60 }]
    }),
    cookActions: [
      // Deliberately 5 min off the reading at +90: a pause that begins in the
      // same instant as a reading is over before the needs-reading branch is
      // ever on screen.
      { atMin: 95, kind: 'oven-off' },
      { atMin: 135, kind: 'restart-oven' }
    ],
    maxMinutes: 460
  },

  {
    name: '09-rest-and-carryover',
    title: 'Rest and carryover',
    what:
      'The same 6 lb prime rib as 02, but with a 30 minute rest declared and ' +
      'the pull temperature set 4 F below the plate temperature. The schedule ' +
      'is judged against the latest PULL time, so the app has to steer the ' +
      'roast out of the oven 30 minutes before dinner rather than at dinner. ' +
      'Nothing subtracted the rest before this, which is why dinner was ' +
      'systematically 20-45 min late.',
    caveat:
      'Convergence is measured against the PULL DEADLINE - serve time less the ' +
      'rest - which is what the app steers to. This scenario is the reason the ' +
      'harness measures it that way: against the raw serve time a correct cook ' +
      'here would score 30 min early.',
    seed: 909,
    config: {
      // 121 F pull for a 125 F plate at a 200 F oven: the app derives this
      // itself for a new cook, and it is stated here so the deck measures the
      // pull the same way the app does.
      targetTemp: 121,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 200,
      restMinutes: 30,
      // 165 min was 02's serve time with no rest. With 30 minutes of rest the
      // meat has to be out at +135, which the model reaches at about +145 - so
      // the app should be asking for a little more heat, not less.
      serveAfterMin: 175,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 200 },
    readingsAt: cadence({ seed: 909, everyMin: 40, jitterMin: 8, untilMin: 400 }),
    maxMinutes: 420
  },

  {
    name: '10-forgetful-cook',
    title: 'Forgetful cook',
    what:
      'The same cook as 02, who ignores the reading prompt entirely and logs ' +
      'on their own sparse schedule. This is the README\'s own stated limit of ' +
      'the harness: every other scenario has a perfectly obedient cook, and a ' +
      'control loop that only works with a perfectly obedient operator has not ' +
      'been tested. It is also the honest control for the reading prompt - the ' +
      'difference between this and 02 is what the prompt is worth.',
    caveat:
      'Overshoot here is expected to be BAD, and the baseline records it as ' +
      'such. The number that matters is that the app says so: it must not ' +
      'report "on track" beside a three-hour-old reading.',
    seed: 1010,
    obeysReadingPrompt: false,
    config: {
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      initialOvenTemp: 200,
      serveAfterMin: 165,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { ...PRIME_RIB_6LB, ovenSetF: 200 },
    // Deliberately sparse and irregular: 55 min apart on average, with one long
    // stretch, which is what a cook who is cooking dinner rather than watching a
    // dashboard actually does.
    readingsAt: cadence({
      seed: 1010, everyMin: 55, jitterMin: 12, untilMin: 400,
      gaps: [{ afterMin: 70, gapMin: 85 }]
    }),
    maxMinutes: 440,
    advisoryConvergence: true,
    // THE CONTROL. Its overshoot is meant to be terrible - that is the
    // measurement. Averaging it into the acceptance figures would report the
    // cook's choice as the app's failure.
    excludeFromAcceptance: true
  },

  {
    name: '08-celsius-eager-dial',
    title: 'Celsius session, eager dial',
    what:
      'Display units C, readings every ~20 min, and the dial moved after every ' +
      'single one the app asks for. The settling window never gets to close ' +
      'cleanly, which is the hardest case for awaitingEffect - and every ' +
      'suggestion has to survive a round trip through C.',
    seed: 808,
    config: {
      targetTemp: F(54),          // 129.2 F - a Celsius cook thinks in 54 C
      units: 'C',
      startingTemp: F(8),
      initialOvenTemp: F(95),
      serveAfterMin: 200,
      meatType: 'Prime Rib',
      meatCut: 'Bone-in',
      weight: 6,
      notes: null
    },
    model: { weightLb: 6, cut: 'prime-rib', startCoreF: F(8), ovenSetF: F(95) },
    readingsAt: cadence({ seed: 808, everyMin: 20, jitterMin: 5, untilMin: 500 }),
    maxMinutes: 520
  }
];

export function scenarioByName(name) {
  const found = SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`Unknown scenario: ${name}`);
  return found;
}
