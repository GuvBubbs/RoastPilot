/**
 * Default session configuration values
 */
export const SESSION_DEFAULTS = {
  /**
   * What the cook wants on the PLATE, in Fahrenheit - 125 °F is medium-rare
   * beef. The pull temperature is derived from this by subtracting carryover, so
   * a default 200 °F oven gives a pull at 121 °F.
   *
   * This used to be TARGET_TEMP_F and meant "where the cook stops", which is a
   * different number. See carryoverService.js.
   */
  SERVING_TEMP_F: 125,
  INITIAL_OVEN_TEMP_F: 200,
  /** Minutes on the board before carving. Per-preset where a preset says so. */
  REST_MINUTES: 20,
  UNITS: 'C' // Default to Celsius
};

/**
 * Calculation thresholds
 */
export const CALCULATION_THRESHOLDS = {
  MIN_READINGS_FOR_RATE: 2,
  /**
   * °F/hr below which a projection is refused outright.
   *
   * Was 0.1 - about 100x too low to mean anything. A roast climbing at 0.11
   * °F/hr is not heating, it is stalled or the probe has fallen out; the app
   * projected it forward regardless and returned an ETA 55.7 DAYS out, which the
   * status panel rendered as an ordinary clock time.
   *
   * 2 °F/hr is chosen as roughly a fifth of the slowest rate a real cook shows.
   * The reference export's slowest interval is 10.2 °C/h (18 °F/hr); a 9 lb
   * shoulder deep in the evaporative stall still manages several °F/hr. Anything
   * under 2 is a measurement problem, not a slow roast, and the honest answer is
   * no projection rather than a confident one.
   */
  MIN_RATE_FOR_PREDICTION: 2,
  /**
   * Minutes of remaining heating beyond which the projection is refused.
   *
   * TWENTY-FOUR HOURS, and the reason it is that loose is that the model changed
   * underneath it.
   *
   * This bound was written for a straight-line projection, which had no notion of
   * a temperature the roast asymptotes to and would therefore happily report 55.7
   * DAYS for a stalled cook. Against that, a tight cap was the only defence, and
   * measured against the deck the tightest workable value was 300 minutes.
   *
   * The curve does not need defending that way. It has a principled bound of its
   * own: if the oven's steady state is at or below the target, there is no finish
   * time and the app says `unreachable` - which is both correct and far more use
   * than a number. And a fit that does not describe the readings is rejected on
   * its residual before any projection is attempted.
   *
   * So a tight cap stopped being a safety net and became a defect. A 9 lb pork
   * shoulder to 195 °F genuinely takes eleven hours, and at 300 minutes the app
   * refused to speak for 90 % of that cook - useless for exactly the low-and-slow
   * cooking it exists for. What is left here is a backstop against arithmetic
   * absurdity: no domestic roast takes more than a day, so a projection past that
   * is a bug rather than a long cook.
   */
  MAX_PREDICTION_MINUTES: 24 * 60
};

/**
 * UI-related constants
 */
export const UI_CONSTANTS = {
  AUTO_SAVE_DEBOUNCE_MS: 1000,
  TOAST_DURATION_MS: 3000
};

/**
 * Recommendation message templates
 */
export const RECOMMENDATION_MESSAGES = {
  HOLD: 'Hold steady at {ovenTemp}. You\'re on track to hit your target.',
  RAISE_SMALL: 'Consider raising oven to {suggestedTemp} to speed things up.',
  RAISE_LARGE: 'Running late. Consider raising oven to {suggestedTemp}.',
  LOWER_SMALL: 'Running ahead of schedule. Consider lowering oven to {suggestedTemp}.',
  LOWER_LARGE: 'Running very early. Lower oven to {suggestedTemp} to avoid overshooting.',
  OVEN_OFF_SUGGESTED: 'Running very early. Your oven can\'t go low enough to slow down heating.',
  OVEN_OFF_ALTERNATIVE: 'Turn off oven for approximately {minutes} minutes, then restart at {ovenTemp}.',
  LOW_TEMP_DISABLED: 'Running early, but recommendations below {minTemp} are disabled.',
  // Emitted when the oven is already as low as it goes, the cook is early, and
  // the core is still under 140 F - so pausing is not offered. There is nothing
  // to do but let it run.
  EARLY_NO_PAUSE_YET: 'Running early with the oven already at {minTemp}. Let it run - pausing the oven is not safe until the core is above {safeTemp}.',
  // The oven has already been off long enough this cook. Each further pause adds
  // danger-zone time, and nothing bounded the count before this.
  EARLY_PAUSE_BUDGET_SPENT: 'Running early, but the oven has already been off long enough this cook. Let it run - more pauses would keep the meat cool for too long in total.',
  // A pause is an oven change, and its effect has to be measured before another
  // one is offered - otherwise the app re-pauses the instant the cook restarts.
  EARLY_PAUSE_UNMEASURED: 'Running early. Log a reading before pausing again - nothing has measured what the last pause did.',
  // So far ahead that the app's remaining lever - a pause worth eight or ten
  // minutes - cannot close the gap. Saying so beats offering it anyway.
  EARLY_BEYOND_HELP: 'You\'re a long way ahead and the oven is already as low as it usefully goes. Nothing the app can suggest will close that much - plan to serve early, or hold the meat once it\'s done.',
  // Lowering further would put the oven so close to the target that the roast
  // approaches it and never arrives.
  EARLY_AT_TARGET_FLOOR: 'Running early, but {minTemp} is as low as the oven can go and still finish this roast. Hold there.',
  AT_TARGET: 'Target reached. Latest reading is {latestTemp}. Turn the oven off and rest the meat.',
  NEEDS_READING: 'Cooking is paused. Log a fresh reading to resume recommendations.',
  // The oven is off and a reading since the pause exists, so the app knows where
  // the meat is - but every other action it could suggest presumes a heating
  // oven. Restarting is the only one that means anything.
  RESTART_OVEN: 'Oven is off. Restart it at {ovenTemp} when you\'re ready - timing advice resumes once it\'s heating again.',
  NEED_MORE_READINGS: 'Need at least {count} readings to make recommendations.',
  NEED_MORE_TIME: 'Need readings spanning at least {minutes} minutes.',
  NO_SERVE_TIME: 'Set a serve time in the cook plan to get timing recommendations.',
  /*
   * RATE_TOO_LOW, RATE_UNSTABLE and OVEN_TEMP_STALE lived here.
   *
   * The first two were the blocker text for two branches keyed on substrings of a
   * confidence reason, one of which (R² < 0.7 over a three-point window) could
   * never fire. Both conditions are now detected from the RMS residual of the
   * curved fit and refused upstream with a specific reason - see
   * PROJECTION_REFUSAL_REASONS in recommendationService.js.
   *
   * OVEN_TEMP_STALE was the stale-oven BLOCKER, which latched: it could only be
   * cleared by logging an oven event, and the app's own advice was what generated
   * them. The age of the setting is still shown, as a chip in the status band.
   */
  STALE_READING: 'The last reading is too old to advise from. Log a fresh one.',
  // Emitted while the last dial change has not yet shown up in the readings.
  // {ovenTemp} is the setting the user actually chose, which may differ from the
  // one that was suggested - saying it back to them is the confirmation.
  SETTLING_ON_PLAN: 'Oven at {ovenTemp} is where it needs to be. Hold there - a reading in about {waitMinutes} min will confirm it.',
  SETTLING_ON_PLAN_READY: 'Oven at {ovenTemp} is where it needs to be. Log a reading now to confirm it is working.',
  SETTLING_RETARGET: 'Oven is at {ovenTemp}. Aim for {suggestedTemp} - that target already allows for the change you just made.',
  // The dial has gone further than the projection asked, in the direction it
  // asked for. Never answered with the opposite move - the projection cannot
  // see the change yet, so it cannot judge whether it went too far.
  SETTLING_BEYOND_PLAN: 'Oven is at {ovenTemp} - further than the {plannedTemp} the projection asked for. Hold there; a reading will show what it did.'
};

/**
 * Disclaimer text
 */
export const DISCLAIMER = 'Ovens and roasts vary. Use this as a guide and rely on thermometer readings. This app does not provide food safety guarantees.';

/**
 * Common meat presets.
 *
 * `servingTempF` is the PLATE temperature - the doneness the cook is after. The
 * app subtracts its own carryover estimate to get the pull temperature, so the
 * presets no longer carry a note telling the cook to subtract it themselves:
 * Prime Rib and Leg of Lamb both said "Remove 5°F below target for carryover",
 * which after this change would be counted twice.
 *
 * `restMinutes` is per cut because it genuinely is: a shoulder wants half an
 * hour on the board, a tenderloin fifteen minutes.
 */
export const MEAT_PRESETS = [
  {
    type: 'Prime Rib',
    cuts: ['Bone-in', 'Boneless'],
    servingTempF: 125,
    suggestedOvenF: 200,
    restMinutes: 20,
    notes: 'Medium-rare on the plate; the app pulls it early for carryover'
  },
  {
    type: 'Beef Tenderloin',
    cuts: ['Whole', 'Center-cut'],
    servingTempF: 125,
    suggestedOvenF: 225,
    restMinutes: 15,
    notes: 'Cooks faster due to smaller diameter'
  },
  {
    type: 'Pork Loin',
    cuts: ['Bone-in', 'Boneless'],
    servingTempF: 145,
    suggestedOvenF: 225,
    restMinutes: 15,
    // 140 was below the figure the note itself cited. The serving temperature is
    // the one that has to clear the guideline, so it is the one set to 145.
    notes: 'USDA recommends 145°F on the plate'
  },
  {
    type: 'Pork Shoulder',
    cuts: ['Bone-in', 'Boneless'],
    servingTempF: 195,
    suggestedOvenF: 225,
    restMinutes: 30,
    notes: 'For pulled pork, aim for 195-205°F'
  },
  {
    type: 'Leg of Lamb',
    cuts: ['Bone-in', 'Boneless'],
    servingTempF: 130,
    suggestedOvenF: 225,
    restMinutes: 20,
    notes: 'Medium-rare on the plate; the app pulls it early for carryover'
  }
];

