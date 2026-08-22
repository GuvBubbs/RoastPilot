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
   * A linear extrapolation has no idea it has left the range of anything it has
   * seen. Combined with the rate floor above this is belt and braces: the floor
   * catches "the meat is not moving", this catches "the arithmetic came out
   * absurd" - a target the oven cannot reach, a probe reading that dropped, a
   * fit over a flat early limb.
   *
   * It turns the 55.7-DAY projection the harness found into a refusal.
   *
   * Note this is heating time still NEEDED, not the length of the cook: a 12
   * hour shoulder spends most of its life under this bound and only crosses it at
   * the start, where a straight-line projection was worthless anyway.
   *
   * FIVE hours, measured, not four. The plan specified 240 minutes; swept against
   * the deck, 240 sits exactly on a cliff:
   *
   *     horizon   blocked minutes (7 short cooks)   invariant errors
   *       240                770.5                        11
   *       300                545.5                         5
   *       360                545.5                         5
   *       480                545.5                         5
   *
   * At 240 two cooks lose their first advice window by a few minutes, never
   * suggest a dial move, and so never log an oven event - which lets the sole
   * opening event age past ovenTempStaleMinutes, at which point stale_oven_data
   * latches for the rest of the cook and the app says nothing at all. The gate
   * that asks the cook to confirm their oven setting can only be cleared by an
   * oven event, and the app's own advice was what generated them.
   *
   * Above 300 the number stops mattering: nothing in seven realistic cooks ever
   * legitimately projects further than five hours ahead. So 300 is the smallest
   * value clear of the cliff - and the cliff itself is the stale-oven latch,
   * which Phase 4 deals with directly.
   */
  MAX_PREDICTION_MINUTES: 300
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
  EARLY_NO_PAUSE_YET: 'Running early with the oven already at {minTemp}. Let it run - pausing the oven is not safe until the core is above 140°F.',
  AT_TARGET: 'Target reached. Latest reading is {latestTemp}. Turn the oven off and rest the meat.',
  NEEDS_READING: 'Cooking is paused. Log a fresh reading to resume recommendations.',
  // The oven is off and a reading since the pause exists, so the app knows where
  // the meat is - but every other action it could suggest presumes a heating
  // oven. Restarting is the only one that means anything.
  RESTART_OVEN: 'Oven is off. Restart it at {ovenTemp} when you\'re ready - timing advice resumes once it\'s heating again.',
  NEED_MORE_READINGS: 'Need at least {count} readings to make recommendations.',
  NEED_MORE_TIME: 'Need readings spanning at least {minutes} minutes.',
  NO_SERVE_TIME: 'Set a serve time in the cook plan to get timing recommendations.',
  RATE_TOO_LOW: 'Heating rate is very slow or negative. Check thermometer placement.',
  RATE_UNSTABLE: 'Temperature readings are fluctuating. Wait for more stable data.',
  OVEN_TEMP_STALE: 'Oven temperature hasn\'t been updated recently. Please confirm current oven setting.',
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

