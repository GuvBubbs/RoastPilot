import { SESSION_DEFAULTS } from '../constants/defaults.js';
import { estimateCarryoverF, pullTempFor, servingTempFor } from '../services/carryoverService.js';

/**
 * @typedef {Object} SessionConfig
 * @property {string} id - Unique session identifier (UUID v4)
 * @property {number} pullTempF - Where the cook STOPS, in Fahrenheit. This is
 *   what the projection aims at and what "at target" means.
 * @property {number} servingTempF - What the cook wants on the PLATE, in
 *   Fahrenheit. Higher than pullTempF by the carryover.
 * @property {number} carryoverF - Degrees the core is expected to climb after
 *   the meat leaves the oven. Stored per session and never recomputed live -
 *   see carryoverService.js for why.
 * @property {boolean} carryoverIsUserSet - Whether the cook overrode the app's
 *   estimate. Once true, no automatic re-estimate touches it.
 * @property {number} restMinutes - Minutes on the board before carving. The
 *   projection is judged against the serve time LESS this.
 * @property {'F'|'C'} units - Display unit preference
 * @property {number|null} startingTemp - Optional starting internal temp in Fahrenheit
 * @property {string|null} desiredServeTime - ISO 8601 datetime string or null
 * @property {number|null} desiredTimeRemaining - Minutes until desired serve time (alternative to serveTime)
 * @property {number} initialOvenTemp - Initial oven set temperature in Fahrenheit
 * @property {string|null} meatType - Optional: e.g., "Prime Rib", "Pork Shoulder"
 * @property {string|null} meatCut - Optional: e.g., "Bone-in", "Boneless"
 * @property {number|null} weight - Optional: weight in pounds
 * @property {string|null} notes - Optional: free-form notes
 * @property {string} createdAt - ISO 8601 datetime when session started
 * @property {string} updatedAt - ISO 8601 datetime of last modification
 */

/**
 * @typedef {Object} InternalReading
 * @property {string} id - Unique reading identifier (UUID v4)
 * @property {number} temp - Internal temperature in Fahrenheit (canonical unit)
 * @property {string} timestamp - ISO 8601 datetime when reading was taken
 * @property {number|null} deltaFromStart - Computed: degrees change from first reading
 * @property {number|null} deltaFromPrevious - Computed: degrees change from previous reading
 */

/**
 * @typedef {Object} OvenTempEvent
 * @property {string} id - Unique event identifier (UUID v4)
 * @property {number} setTemp - Oven set temperature in Fahrenheit (0 if oven is off)
 * @property {string} timestamp - ISO 8601 datetime when oven was adjusted
 * @property {number|null} previousTemp - The oven temp before this change (null for first entry)
 * @property {boolean} isOff - Whether this event represents turning the oven OFF (default: false)
 */

/**
 * @typedef {Object} CalculationResult
 * @property {number|null} currentRate - Degrees F per hour, null if insufficient data
 * @property {number|null} averageRate - Session average rate in degrees F per hour
 * @property {number|null} predictedMinutesToTarget - Heating minutes still needed,
 *   measured from the last reading's timestamp (the projection anchor)
 * @property {number|null} predictedMinutesFromNow - The same projection as a live
 *   countdown from now; this is what a display should show
 * @property {string|null} predictedTargetTime - ISO 8601 datetime of predicted target
 * @property {number|null} scheduleVarianceMinutes - Positive = late, negative = early
 * @property {'early'|'late'|'on-track'|'unknown'} scheduleStatus
 * @property {'high'|'medium'|'low'|'insufficient'} confidence
 * @property {string|null} confidenceReason - Human-readable explanation
 */

/**
 * @typedef {Object} Recommendation
 * @property {'raise'|'lower'|'hold'|'oven-off'|'restart-oven'|'at-target'|'needs-reading'|'settling'|'none'} action
 * @property {number|null} suggestedTemp - New oven set temp in Fahrenheit
 * @property {number|null} changeAmount - Degrees to change (always positive)
 * @property {string|null} message - TEMPLATE with {placeholders}; substituted (and
 *   unit-converted) by useRecommendations. Never render this field directly.
 * @property {string|null} reasoning - Explanation of why this recommendation
 * @property {string|null} alternativeMessage - Alternative action TEMPLATE with
 *   {placeholders}; same substitution rule as `message`
 * @property {number|null} ovenOffMinutes - Suggested minutes to turn oven off
 * @property {number|null} practicalMinF - Practical minimum oven temp in Fahrenheit
 * @property {number|null} plannedTempF - When the dial has been moved further than
 *   the projection asked for, the target it asked for (°F). Distinct from
 *   suggestedTemp, which in that state is the setting already in force.
 * @property {number|null} latestReadingTemp - Newest logged reading in Fahrenheit
 * @property {'normal'|'moderate'|'urgent'|'warning'|'info'|'unknown'} severity
 * @property {boolean} canRecommend - Whether conditions allow a recommendation
 * @property {string|null} blockerReason - If canRecommend is false, why (display string)
 * @property {string|null} blockerType - Machine-readable blocker discriminant, e.g.
 *   'insufficient_readings' | 'insufficient_time' | 'no_oven_data' |
 *   'stale_reading' | 'no_serve_time' | 'no_projection' | 'no_session'
 * @property {string|null} blockerCode - When blockerType is 'no_projection', the
 *   specific cause: a dead-time gate code, 'poor-fit', 'unreachable',
 *   'beyond-horizon'. The UI needs it because "raise the oven" is the right
 *   suggestion for one of those and nonsense for the rest.
 * @property {{current: number, required: number, message: string}|null} progress -
 *   Progress toward clearing a countable blocker
 * @property {boolean} awaitingEffect - True while the last oven set-point change has
 *   not yet appeared in the readings, so the projection still describes the previous
 *   setting. Suggestions in this state are anchored to the pre-change set point.
 * @property {number|null} ovenChangeMinutesAgo - Age of that change in minutes
 * @property {number|null} waitMinutes - Minutes until the change should be visible in
 *   a reading; 0 once enough time has passed and only a reading is missing
 */

/**
 * @typedef {Object} AppSettings
 * @property {number} onTrackThresholdMinutes - Minutes variance considered "on track" (default 10)
 * @property {number} recommendationStepF - Default temp change step in F (default 10)
 * @property {number} recommendationMaxStepF - Maximum single change in F (default 25)
 * @property {number} ovenTempMinF - Minimum suggested oven temp in F (default 150)
 * @property {number} ovenTempMaxF - Maximum suggested oven temp in F (default 300)
 * @property {number} ovenTempPracticalMinF - Practical minimum most ovens can achieve (default 175)
 * @property {boolean} enableLowTempRecommendations - Allow recommendations below practical minimum (default true)
 * @property {number} minReadingsForRecommendation - Minimum readings required (default 3)
 * @property {number} minTimeSpanMinutes - Minimum time span for recommendations (default 30)
 * @property {number} ovenTempStaleMinutes - Max age of oven temp for recommendations (default 60)
 * @property {number} ovenChangeLagMinutes - Thermal lag before a dial change can show
 *   up in the meat's heating rate (default 15)
 * @property {number} ovenChangeSettleReadings - Readings needed past that lag before
 *   the measured rate is treated as belonging to the new setting (default 2)
 * @property {number} defaultRestMinutes - Rest to seed a NEW session with, when
 *   its preset does not name one. Per-session after that: a shoulder rests 30
 *   minutes and a tenderloin 15, so this is a starting point, not the value the
 *   projection reads.
 * @property {number} readingIntervalMinutes - The longest the app will go without
 *   asking for a reading (default 45). The actual cadence is derived from the
 *   projection and is usually shorter - see useReadingSchedule.
 * @property {number} staleReadingMinutes - Age at which the newest reading stops
 *   being evidence and advice is withheld (default 45).
 */

/**
 * @typedef {Object} Session
 * @property {SessionConfig} config
 * @property {InternalReading[]} readings
 * @property {OvenTempEvent[]} ovenEvents
 * @property {AppSettings} settings
 */

/**
 * Resolve the pull / serving / carryover triple from whatever a caller supplied.
 *
 * Three fields that must agree, of which any two determine the third, and
 * callers legitimately know different ones:
 *
 *  - the setup modal and the presets know the SERVING temperature (doneness);
 *  - a migrated session knows only the PULL temperature, because that is all the
 *    old build ever recorded;
 *  - the harness and the tests pass the legacy `targetTemp`, which meant "where
 *    the cook stops" and is therefore the pull temperature.
 *
 * The legacy key is accepted HERE and nowhere else. That is the whole shim: it
 * exists so that `grep -rn "\.targetTemp" src` finds nothing outside this file,
 * because the ambiguity of that name is the defect being fixed - and after this
 * change the UI shows two temperatures, so an alias would only relocate the
 * confusion.
 *
 * @param {Object} overrides - Raw config overrides, possibly legacy
 * @returns {{pullTempF: number, servingTempF: number, carryoverF: number,
 *   carryoverIsUserSet: boolean}}
 */
function resolveTemperatures(overrides) {
  const ovenTempF = Number.isFinite(overrides.initialOvenTemp)
    ? overrides.initialOvenTemp
    : SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F;

  const carryoverIsUserSet = overrides.carryoverIsUserSet === true;
  const carryoverF = Number.isFinite(overrides.carryoverF)
    ? overrides.carryoverF
    : estimateCarryoverF(ovenTempF);

  // The legacy name, and the migration rule that matters: it maps to pullTempF,
  // NOT to servingTempF. The old code stopped the cook exactly at it, so reading
  // it as a plate temperature would move a running cook's finish line 3-8 °F
  // earlier the moment the new build deployed.
  const legacyPull = Number.isFinite(overrides.targetTemp) ? overrides.targetTemp : null;
  const pullGiven = Number.isFinite(overrides.pullTempF) ? overrides.pullTempF : legacyPull;
  const servingGiven = Number.isFinite(overrides.servingTempF) ? overrides.servingTempF : null;

  if (pullGiven !== null) {
    return {
      pullTempF: pullGiven,
      servingTempF: servingGiven ?? servingTempFor(pullGiven, carryoverF),
      carryoverF,
      carryoverIsUserSet
    };
  }

  const servingTempF = servingGiven ?? SESSION_DEFAULTS.SERVING_TEMP_F;
  return {
    pullTempF: pullTempFor(servingTempF, carryoverF),
    servingTempF,
    carryoverF,
    carryoverIsUserSet
  };
}

/**
 * Factory function to create a new empty session
 * @param {Partial<SessionConfig>} configOverrides
 * @returns {Session}
 */
export function createSession(configOverrides = {}) {
  const now = new Date().toISOString();
  const temperatures = resolveTemperatures(configOverrides);
  
  // Strip the legacy key so it cannot survive into storage and be read again by
  // something that has not been through the shim.
  const { targetTemp: _legacyTargetTemp, ...overrides } = configOverrides;
  
  return {
    config: {
      id: generateUUID(),
      units: 'F',
      startingTemp: null,
      desiredServeTime: null,
      desiredTimeRemaining: null,
      initialOvenTemp: SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F,
      /**
       * A NEW session gets a real rest. A MIGRATED one gets zero - see
       * migrateSessionToV2. Retroactively inserting 20 minutes of rest would
       * flip an in-flight cook from "on track" to "20 min late" without the cook
       * having asked for anything.
       */
      restMinutes: SESSION_DEFAULTS.REST_MINUTES,
      meatType: null,
      meatCut: null,
      weight: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
      // After the spread: these are derived from the overrides, so an override
      // must not be able to reintroduce a disagreeing raw value.
      ...temperatures
    },
    readings: [],
    ovenEvents: [],
    settings: createDefaultSettings()
  };
}

/**
 * Bring a v1 stored session up to the v2 config shape, in place.
 *
 * Idempotent, and deliberately conservative: a session being migrated is a cook
 * that is happening right now, so nothing here may move its finish line or its
 * schedule verdict.
 *
 * @param {Session} session
 * @returns {Session} the same object
 */
export function migrateSessionToV2(session) {
  const config = session?.config;
  if (!config) return session;
  
  if (!Number.isFinite(config.pullTempF)) {
    // Where the cook stops. The old `targetTemp` is exactly this.
    config.pullTempF = Number.isFinite(config.targetTemp)
      ? config.targetTemp
      : SESSION_DEFAULTS.SERVING_TEMP_F;
  }
  
  if (!Number.isFinite(config.carryoverF)) {
    config.carryoverF = estimateCarryoverF(config.initialOvenTemp);
  }
  if (typeof config.carryoverIsUserSet !== 'boolean') {
    config.carryoverIsUserSet = false;
  }
  
  if (!Number.isFinite(config.servingTempF)) {
    // Derived upward from the pull temperature, so the pull stays put. The cook
    // was already going to eat this roast at pull + carryover; the app is only
    // now admitting that is what was happening.
    config.servingTempF = servingTempFor(config.pullTempF, config.carryoverF);
  }
  
  if (!Number.isFinite(config.restMinutes)) {
    // ZERO, not the new-session default. A migrated cook's serve time was set
    // against a projection with no rest in it; subtracting 20 minutes now would
    // announce that dinner is late, about a decision the cook never made.
    config.restMinutes = 0;
  }
  
  delete config.targetTemp;
  
  return session;
}

/**
 * Factory function to create default settings
 * @returns {AppSettings}
 */
export function createDefaultSettings() {
  return {
    // smoothingWindowReadings, smoothingWindowMinutes and smoothingMode lived
    // here. The first sized the rate fit's window; the other two were an
    // alternative approach that was never implemented - `smoothingMode` had one
    // reachable value. The thermal model fits every reading, so none of the three
    // has anything to do.
    onTrackThresholdMinutes: 10,
    recommendationStepF: 10,
    recommendationMaxStepF: 25,
    ovenTempMinF: 150,
    ovenTempMaxF: 300,
    ovenTempPracticalMinF: 175,
    enableLowTempRecommendations: true,
    minReadingsForRecommendation: 3,
    minTimeSpanMinutes: 30,
    ovenTempStaleMinutes: 60,
    ovenChangeLagMinutes: 15,
    ovenChangeSettleReadings: 2,
    defaultRestMinutes: SESSION_DEFAULTS.REST_MINUTES,
    readingIntervalMinutes: 45,
    staleReadingMinutes: 45
  };
}

/**
 * Factory function to create an internal reading
 * @param {number} temp - Temperature in current display units (will be converted)
 * @param {string} [timestamp] - Optional timestamp, defaults to now
 * @returns {InternalReading}
 */
export function createReading(temp, timestamp = null) {
  return {
    id: generateUUID(),
    temp: temp, // Caller responsible for ensuring this is in Fahrenheit
    timestamp: timestamp || new Date().toISOString(),
    deltaFromStart: null, // Computed after creation
    deltaFromPrevious: null // Computed after creation
  };
}

/**
 * Factory function to create an oven temperature event
 * @param {number} setTemp - Oven set temp in current display units (will be converted)
 * @param {number|null} previousTemp - Previous oven temp or null
 * @param {string} [timestamp] - Optional timestamp, defaults to now
 * @param {boolean} [isOff] - Whether this event represents turning the oven OFF
 * @returns {OvenTempEvent}
 */
export function createOvenEvent(setTemp, previousTemp = null, timestamp = null, isOff = false) {
  return {
    id: generateUUID(),
    setTemp: isOff ? 0 : setTemp, // Caller responsible for ensuring this is in Fahrenheit
    timestamp: timestamp || new Date().toISOString(),
    previousTemp: previousTemp,
    isOff: isOff
  };
}

/**
 * Generate a UUID v4
 * @returns {string}
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}





