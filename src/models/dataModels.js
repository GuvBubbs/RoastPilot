/**
 * @typedef {Object} SessionConfig
 * @property {string} id - Unique session identifier (UUID v4)
 * @property {number} targetTemp - Target internal temperature in Fahrenheit
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
 * @property {number} setTemp - Oven set temperature in Fahrenheit (canonical unit)
 * @property {string} timestamp - ISO 8601 datetime when oven was adjusted
 * @property {number|null} previousTemp - The oven temp before this change (null for first entry)
 */

/**
 * @typedef {Object} CalculationResult
 * @property {number|null} currentRate - Degrees F per hour, null if insufficient data
 * @property {number|null} averageRate - Session average rate in degrees F per hour
 * @property {number|null} predictedMinutesToTarget - Minutes until target reached
 * @property {string|null} predictedTargetTime - ISO 8601 datetime of predicted target
 * @property {number|null} scheduleVarianceMinutes - Positive = late, negative = early
 * @property {'early'|'late'|'on-track'|'unknown'} scheduleStatus
 * @property {'high'|'medium'|'low'|'insufficient'} confidence
 * @property {string|null} confidenceReason - Human-readable explanation
 */

/**
 * @typedef {Object} Recommendation
 * @property {'raise'|'lower'|'hold'|'none'} action
 * @property {number|null} suggestedTemp - New oven set temp in Fahrenheit
 * @property {number|null} changeAmount - Degrees to change (always positive)
 * @property {string} message - Human-readable recommendation
 * @property {string|null} reasoning - Explanation of why this recommendation
 * @property {boolean} canRecommend - Whether conditions allow a recommendation
 * @property {string|null} blockerReason - If canRecommend is false, why
 */

/**
 * @typedef {Object} AppSettings
 * @property {'F'|'C'} units - Temperature display units
 * @property {number} smoothingWindowReadings - Number of readings for rate smoothing (default 3)
 * @property {number} smoothingWindowMinutes - Alternative: time window for smoothing (default 30)
 * @property {'readings'|'time'} smoothingMode - Which smoothing approach to use
 * @property {number} onTrackThresholdMinutes - Minutes variance considered "on track" (default 10)
 * @property {number} recommendationStepF - Default temp change step in F (default 10)
 * @property {number} recommendationMaxStepF - Maximum single change in F (default 25)
 * @property {number} ovenTempMinF - Minimum suggested oven temp in F (default 150)
 * @property {number} ovenTempMaxF - Maximum suggested oven temp in F (default 300)
 * @property {number} minReadingsForRecommendation - Minimum readings required (default 3)
 * @property {number} minTimeSpanMinutes - Minimum time span for recommendations (default 30)
 * @property {number} ovenTempStaleMinutes - Max age of oven temp for recommendations (default 60)
 */

/**
 * @typedef {Object} Session
 * @property {SessionConfig} config
 * @property {InternalReading[]} readings
 * @property {OvenTempEvent[]} ovenEvents
 * @property {AppSettings} settings
 */

/**
 * Factory function to create a new empty session
 * @param {Partial<SessionConfig>} configOverrides
 * @returns {Session}
 */
export function createSession(configOverrides = {}) {
  const now = new Date().toISOString();
  return {
    config: {
      id: generateUUID(),
      targetTemp: 125, // Default for medium-rare beef
      units: 'F',
      startingTemp: null,
      desiredServeTime: null,
      desiredTimeRemaining: null,
      initialOvenTemp: 200,
      meatType: null,
      meatCut: null,
      weight: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      ...configOverrides
    },
    readings: [],
    ovenEvents: [],
    settings: createDefaultSettings()
  };
}

/**
 * Factory function to create default settings
 * @returns {AppSettings}
 */
export function createDefaultSettings() {
  return {
    units: 'F',
    smoothingWindowReadings: 3,
    smoothingWindowMinutes: 30,
    smoothingMode: 'readings',
    onTrackThresholdMinutes: 10,
    recommendationStepF: 10,
    recommendationMaxStepF: 25,
    ovenTempMinF: 150,
    ovenTempMaxF: 300,
    minReadingsForRecommendation: 3,
    minTimeSpanMinutes: 30,
    ovenTempStaleMinutes: 60
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
 * @returns {OvenTempEvent}
 */
export function createOvenEvent(setTemp, previousTemp = null, timestamp = null) {
  return {
    id: generateUUID(),
    setTemp: setTemp, // Caller responsible for ensuring this is in Fahrenheit
    timestamp: timestamp || new Date().toISOString(),
    previousTemp: previousTemp
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


