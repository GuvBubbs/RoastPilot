/**
 * Default session configuration values
 */
export const SESSION_DEFAULTS = {
  TARGET_TEMP_F: 125, // Medium-rare beef (stored in F, but display defaults to C)
  INITIAL_OVEN_TEMP_F: 200,
  UNITS: 'C' // Default to Celsius
};

/**
 * Calculation thresholds
 */
export const CALCULATION_THRESHOLDS = {
  MIN_READINGS_FOR_RATE: 2, // Coefficient of variation threshold for "noisy" data
  MIN_RATE_FOR_PREDICTION: 0.1 // °F/hr minimum to consider valid heating
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
  AT_TARGET: 'Target reached. Latest reading is {latestTemp}. Turn the oven off and rest the meat.',
  NEEDS_READING: 'Cooking is paused. Log a fresh reading to resume recommendations.',
  NEED_MORE_READINGS: 'Need at least {count} readings to make recommendations.',
  NEED_MORE_TIME: 'Need readings spanning at least {minutes} minutes.',
  NO_SERVE_TIME: 'Set a desired serve time to get timing recommendations.',
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
 * Common meat presets
 */
export const MEAT_PRESETS = [
  {
    type: 'Prime Rib',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 125,
    suggestedOvenF: 200,
    notes: 'Remove 5°F below target for carryover'
  },
  {
    type: 'Beef Tenderloin',
    cuts: ['Whole', 'Center-cut'],
    defaultTargetF: 125,
    suggestedOvenF: 225,
    notes: 'Cooks faster due to smaller diameter'
  },
  {
    type: 'Pork Loin',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 140,
    suggestedOvenF: 225,
    notes: 'USDA recommends 145°F minimum'
  },
  {
    type: 'Pork Shoulder',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 195,
    suggestedOvenF: 225,
    notes: 'For pulled pork, aim for 195-205°F'
  },
  {
    type: 'Leg of Lamb',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 130,
    suggestedOvenF: 225,
    notes: 'Remove 5°F below target for carryover'
  }
];

