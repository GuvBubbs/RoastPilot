/**
 * Default session configuration values
 */
export const SESSION_DEFAULTS = {
  TARGET_TEMP_F: 125, // Medium-rare beef (stored in F, but display defaults to C)
  INITIAL_OVEN_TEMP_F: 200,
  UNITS: 'C' // Default to Celsius
};

/**
 * Default settings values
 */
export const SETTINGS_DEFAULTS = {
  SMOOTHING_WINDOW_READINGS: 3,
  SMOOTHING_WINDOW_MINUTES: 30,
  ON_TRACK_THRESHOLD_MINUTES: 10,
  RECOMMENDATION_STEP_F: 10,
  RECOMMENDATION_MAX_STEP_F: 25,
  OVEN_TEMP_MIN_F: 150,
  OVEN_TEMP_MAX_F: 300,
  MIN_READINGS_FOR_RECOMMENDATION: 3,
  MIN_TIME_SPAN_MINUTES: 30,
  OVEN_TEMP_STALE_MINUTES: 60
};

/**
 * Calculation thresholds
 */
export const CALCULATION_THRESHOLDS = {
  MIN_READINGS_FOR_RATE: 2,
  MIN_READINGS_FOR_PROJECTION: 2,
  RATE_VARIANCE_THRESHOLD: 0.5, // Coefficient of variation threshold for "noisy" data
  MIN_RATE_FOR_PREDICTION: 0.1 // °F/hr minimum to consider valid heating
};

/**
 * UI-related constants
 */
export const UI_CONSTANTS = {
  CHART_UPDATE_DEBOUNCE_MS: 250,
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
  NEED_MORE_READINGS: 'Need at least {count} readings to make recommendations.',
  NEED_MORE_TIME: 'Need readings spanning at least {minutes} minutes.',
  NO_SERVE_TIME: 'Set a desired serve time to get timing recommendations.',
  RATE_TOO_LOW: 'Heating rate is very slow or negative. Check thermometer placement.',
  RATE_UNSTABLE: 'Temperature readings are fluctuating. Wait for more stable data.',
  OVEN_TEMP_STALE: 'Oven temperature hasn\'t been updated recently. Please confirm current oven setting.'
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

