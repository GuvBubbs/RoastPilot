import { hoursBetween, minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { CALCULATION_THRESHOLDS } from '../constants/defaults.js';

/**
 * The readings a rate fit may legitimately use.
 *
 * A pause is not a slow patch of the same cook - it is a different experiment.
 * Fitting a line across one averages the flat (or falling) pause into the
 * heating rate: measured against the harness, a roast genuinely climbing at
 * 10 °F/hr reported 4.5 °F/hr because the fit window straddled a 40 minute
 * oven-off period. Everything downstream then inherits it - the ETA doubles,
 * the schedule says "late", and the app advises raising an oven that is fine.
 *
 * So the fit is confined to the current oven-state segment:
 *
 *  - oven currently OFF: readings from the off event onward. That measures
 *    cooling, which is the truth about what is happening now.
 *  - oven currently ON after a pause: readings from the restart onward.
 *  - no pause in this cook: everything.
 *
 * This can leave fewer than two readings, in which case there is no rate. That
 * is the correct answer and not a regression: immediately after a restart the
 * app genuinely has not measured the new state yet, and saying so is better than
 * reporting a rate that belongs to the wrong segment.
 *
 * @param {InternalReading[]} readings - Chronological
 * @param {OvenTempEvent[]} [ovenEvents] - Chronological
 * @returns {InternalReading[]} A suffix of `readings`
 */
export function readingsForRateFit(readings, ovenEvents = []) {
  if (!ovenEvents || ovenEvents.length === 0) return readings;
  
  let lastOffIndex = -1;
  for (let i = ovenEvents.length - 1; i >= 0; i--) {
    if (ovenEvents[i].isOff === true) { lastOffIndex = i; break; }
  }
  if (lastOffIndex === -1) return readings;
  
  // The restart is the first non-off event after that pause. If there is none
  // the oven is still off, and the pause itself is the current segment.
  const restart = ovenEvents.slice(lastOffIndex + 1).find(e => e.isOff !== true);
  const segmentStart = restart ? restart.timestamp : ovenEvents[lastOffIndex].timestamp;
  
  return readings.filter(r => r.timestamp >= segmentStart);
}

/**
 * Calculate the heating rate from a set of readings using linear regression
 * Returns rate in degrees Fahrenheit per hour
 *
 * The slope and R² come back UNROUNDED. They used to be rounded to 2 and 3
 * decimal places here, which is a display concern applied to a value the whole
 * projection is then derived from - and the rounded rate was what got divided
 * into the remaining degrees. Rounding is done at the edge, in
 * useCalculations/formatRate.
 * 
 * @param {InternalReading[]} readings - Array of readings sorted by timestamp
 * @param {number} windowSize - Number of most recent readings to use
 * @returns {{rate: number|null, r2: number, readings: number}}
 */
export function calculateHeatingRate(readings, windowSize = 3) {
  if (readings.length < CALCULATION_THRESHOLDS.MIN_READINGS_FOR_RATE) {
    return { rate: null, r2: 0, readings: readings.length };
  }
  
  // Use the most recent N readings
  const windowReadings = readings.slice(-windowSize);
  
  if (windowReadings.length < 2) {
    return { rate: null, r2: 0, readings: windowReadings.length };
  }
  
  // Convert timestamps to hours since first reading in window
  const firstTime = new Date(windowReadings[0].timestamp).getTime();
  const points = windowReadings.map(r => ({
    x: (new Date(r.timestamp).getTime() - firstTime) / (1000 * 60 * 60), // hours
    y: r.temp
  }));
  
  // Simple linear regression: y = mx + b
  // m = (n∑xy - ∑x∑y) / (n∑x² - (∑x)²)
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }
  
  const denominator = n * sumX2 - sumX * sumX;
  
  // Handle edge case of all points at same time (division by zero)
  if (Math.abs(denominator) < 0.0001) {
    return { rate: null, r2: 0, readings: n };
  }
  
  const slope = (n * sumXY - sumX * sumY) / denominator;
  
  // Calculate R² (coefficient of determination) for confidence assessment
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  const intercept = (sumY - slope * sumX) / n;
  
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssTotal += (p.y - meanY) ** 2;
    ssResidual += (p.y - predicted) ** 2;
  }
  
  const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;
  
  // A non-finite slope escaped from here and was passed on as a number. It
  // reached predictTimeToTarget, which divided by it, produced a non-finite
  // minute count, and handed that to addMinutes - where `new Date(NaN)
  // .toISOString()` throws RangeError out of the whole status panel rather than
  // producing a bad number. The guarded arithmetic above makes this hard to
  // reach now; it stays because "hard to reach" and "unreachable" are different
  // and the failure mode is a blank screen.
  if (!Number.isFinite(slope) || !Number.isFinite(r2)) {
    return { rate: null, r2: 0, readings: n };
  }
  
  return {
    rate: slope,
    r2,
    readings: n
  };
}

/**
 * Calculate the session average heating rate (from first to last reading)
 * 
 * @param {InternalReading[]} readings
 * @returns {number|null} Rate in °F/hour
 */
export function calculateAverageRate(readings) {
  if (readings.length < 2) return null;
  
  const first = readings[0];
  const last = readings[readings.length - 1];
  
  const hours = hoursBetween(first.timestamp, last.timestamp);
  if (hours < 0.01) return null; // Less than ~30 seconds, avoid division issues
  
  const tempChange = last.temp - first.temp;
  return Math.round((tempChange / hours) * 100) / 100;
}

/**
 * Calculate time span of readings in minutes
 * 
 * @param {InternalReading[]} readings
 * @returns {number}
 */
export function calculateReadingSpanMinutes(readings) {
  if (readings.length < 2) return 0;
  return minutesBetween(readings[0].timestamp, readings[readings.length - 1].timestamp);
}

/**
 * Predict time to reach target temperature
 * 
 * The projection is anchored to the moment `currentTemp` was observed - the last
 * reading - not to "now". Anchoring to "now" would re-charge the projection for
 * the minutes the meat has already been climbing since that reading was taken.
 * 
 * A refusal carries a `reason`, so a caller can tell "no data yet" from "the
 * arithmetic came out absurd". Every refusal returns null timings: a projection
 * the app does not believe must not reach a display as a number, because a
 * number on a clock face is indistinguishable from a number the app stands
 * behind.
 *
 * @param {number} currentTemp - Internal temperature at the anchor (°F)
 * @param {number} targetTemp - Target temperature (°F)
 * @param {number} rate - Heating rate (°F/hour)
 * @param {string} [anchorTime] - ISO timestamp `currentTemp` was observed at
 * @param {string} [now] - ISO timestamp to measure the countdown from
 * @returns {{minutes: number|null, minutesFromNow: number|null,
 *   targetTime: string|null, reason: string|null}}
 */
export function predictTimeToTarget(
  currentTemp,
  targetTemp,
  rate,
  anchorTime = new Date().toISOString(),
  now = anchorTime
) {
  const refuse = (reason) => ({
    minutes: null, minutesFromNow: null, targetTime: null, reason
  });
  
  // Non-finite before the comparison: NaN fails every `<=` test, so a NaN rate
  // used to sail past this gate and be divided by below.
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return refuse('no-rate');
  }
  
  if (!Number.isFinite(currentTemp) || !Number.isFinite(targetTemp)) {
    return refuse('no-temp');
  }
  
  if (rate <= CALCULATION_THRESHOLDS.MIN_RATE_FOR_PREDICTION) {
    return refuse('rate-too-low');
  }
  
  const tempRemaining = targetTemp - currentTemp;
  
  if (tempRemaining <= 0) {
    /**
     * Already at or past target as of the anchor reading.
     *
     * NOT routed through assessPullProgress, deliberately. This is a numeric
     * guard against dividing a negative remainder by a positive rate and
     * projecting into the past - it is arithmetic, not a UI verdict, and it has
     * to hold for any (currentTemp, targetTemp) pair including ones that have
     * nothing to do with a pull temperature. The graded verdict is what the
     * SCREENS read; this is what the division reads.
     */
    return { minutes: 0, minutesFromNow: 0, targetTime: anchorTime, reason: null };
  }
  
  const hoursRemaining = tempRemaining / rate;
  const minutesRemaining = Math.round(hoursRemaining * 60);
  
  // The horizon. A straight line fitted to three readings does not know it has
  // left the range of everything it has seen, and the app has no way to say
  // "this is a guess" once the number is a time on a clock.
  if (minutesRemaining > CALCULATION_THRESHOLDS.MAX_PREDICTION_MINUTES) {
    return refuse('beyond-horizon');
  }
  
  const targetTime = addMinutes(anchorTime, minutesRemaining);
  
  return {
    // Heating still needed measured from the anchor reading
    minutes: minutesRemaining,
    // The same projection as a countdown from `now`, which is what a display
    // should show: part of `minutes` has already elapsed since the anchor.
    minutesFromNow: Math.round(minutesBetween(now, targetTime)),
    targetTime,
    reason: null
  };
}

/**
 * Calculate schedule variance with configurable threshold
 */
export function calculateScheduleVarianceWithThreshold(predictedTargetTime, desiredServeTime, thresholdMinutes) {
  if (!predictedTargetTime || !desiredServeTime) {
    return { varianceMinutes: null, status: 'unknown' };
  }
  
  const variance = minutesBetween(desiredServeTime, predictedTargetTime);
  
  let status;
  if (variance < -thresholdMinutes) {
    status = 'early';
  } else if (variance > thresholdMinutes) {
    status = 'late';
  } else {
    status = 'on-track';
  }
  
  return {
    varianceMinutes: Math.round(variance),
    status
  };
}

/**
 * Assess confidence level of predictions based on data quality
 * 
 * @param {Object} params
 * @param {number} params.readingCount - Number of readings
 * @param {number} params.timeSpanMinutes - Time span of readings
 * @param {number} params.r2 - R² value from rate calculation
 * @param {number} params.rate - Calculated heating rate
 * @param {number} [params.fitReadings] - Readings the rate fit actually used; the
 *   smoothing window can be narrower than the full reading list
 * @returns {{level: 'high'|'medium'|'low'|'insufficient', reason: string}}
 */
export function assessConfidence({ readingCount, timeSpanMinutes, r2, rate, fitReadings = readingCount }) {
  // Insufficient data
  if (readingCount < 2) {
    return {
      level: 'insufficient',
      reason: 'Need at least 2 readings to calculate rate'
    };
  }
  
  if (readingCount < 3) {
    return {
      level: 'low',
      reason: 'Only 2 readings available; predictions may be inaccurate'
    };
  }
  
  // Check for unreliable rate
  if (rate !== null && rate <= CALCULATION_THRESHOLDS.MIN_RATE_FOR_PREDICTION) {
    return {
      level: 'low',
      reason: 'Heating rate is very slow or negative; check thermometer placement'
    };
  }
  
  // Check time span
  if (timeSpanMinutes < 15) {
    return {
      level: 'low',
      reason: 'Readings span less than 15 minutes; wait for more data'
    };
  }
  
  // Check data fit quality
  if (r2 < 0.7) {
    return {
      level: 'low',
      reason: 'Temperature readings are fluctuating; predictions may be unstable'
    };
  }
  
  if (r2 < 0.9) {
    return {
      level: 'medium',
      reason: 'Good data quality with moderate variation'
    };
  }
  
  // A fit over fewer than 3 points can't be told apart from noise - two points
  // always fit a line perfectly, so a perfect R² there means nothing - and so it
  // never earns high confidence however good the rest of the data looks.
  if (fitReadings < 3) {
    return {
      level: 'medium',
      reason: `Rate is fitted from only ${fitReadings} readings; treat the projection as approximate`
    };
  }
  
  // High confidence conditions
  if (readingCount >= 4 && timeSpanMinutes >= 30 && r2 >= 0.9) {
    return {
      level: 'high',
      reason: 'Strong data quality with consistent heating pattern'
    };
  }
  
  return {
    level: 'medium',
    reason: 'Adequate data for reasonable predictions'
  };
}

/**
 * How close the roast is to coming out, as one graded verdict.
 *
 * Four states rather than the boolean `targetReached`, because the interesting
 * band is the one before the target: a roast 3 °F short is a different situation
 * from one 30 °F short, and the app had no way to say so - so it said nothing
 * until the moment it said "done", by which time the harness measured it as
 * 13.6 °F past target on average and 31.5 °F at worst.
 *
 *   heating      still climbing, nothing imminent
 *   approaching  inside APPROACHING_BAND_F of the pull; the endgame
 *   at-pull      at or past the pull temperature
 *   over         past it by more than OVERSHOOT_BAND_F - the app was late
 *
 * ONE function, called from every surface that needs the verdict. There were
 * four separate implementations of "is it done yet": here, in useCalculations,
 * in the recommendation service's short circuit, and in TemperatureChart - and
 * the chart's compared DISPLAY units, so on a Celsius session it could reach a
 * different answer than the advice band about the same roast.
 *
 * @param {number|null} currentTempF - Newest reading, °F
 * @param {number|null} pullTempF - Where the cook stops, °F
 * @param {number|null} [startTempF] - For the progress fraction
 * @returns {{state: 'heating'|'approaching'|'at-pull'|'over',
 *   degreesToPull: number|null, degreesOver: number|null,
 *   progressPercent: number|null}}
 */
export function assessPullProgress(currentTempF, pullTempF, startTempF = null) {
  if (!Number.isFinite(currentTempF) || !Number.isFinite(pullTempF)) {
    return { state: 'heating', degreesToPull: null, degreesOver: null, progressPercent: null };
  }
  
  const degreesToPull = pullTempF - currentTempF;
  
  // UNCLAMPED, deliberately. The clamp belongs to the ARIA value and the rail
  // width, which cannot render past 100%; a logic path that reads a clamped
  // progress cannot tell "just done" from "30 °F past done".
  const progressPercent = Number.isFinite(startTempF) && pullTempF > startTempF
    ? ((currentTempF - startTempF) / (pullTempF - startTempF)) * 100
    : null;
  
  if (degreesToPull > APPROACHING_BAND_F) {
    return { state: 'heating', degreesToPull, degreesOver: null, progressPercent };
  }
  
  if (degreesToPull > 0) {
    return { state: 'approaching', degreesToPull, degreesOver: null, progressPercent };
  }
  
  const degreesOver = -degreesToPull;
  return {
    state: degreesOver > OVERSHOOT_BAND_F ? 'over' : 'at-pull',
    degreesToPull,
    degreesOver,
    progressPercent
  };
}

/** °F below the pull at which the cook is in the endgame. */
export const APPROACHING_BAND_F = 10;

/** °F past the pull at which "done" becomes "you were late". */
export const OVERSHOOT_BAND_F = 5;

/**
 * The latest moment the meat can come out of the oven and still be rested in
 * time to serve.
 *
 * Rest was never subtracted anywhere: the projection aimed at the target
 * temperature and the schedule was compared straight against the serve time, so
 * a roast that needed 30 minutes on the board was declared "on track" to be
 * pulled at the moment dinner was supposed to be on the table. Dinner was
 * systematically 20-45 minutes late and nothing in the app said so.
 *
 * @param {string|null} desiredServeTime - ISO 8601
 * @param {number} [restMinutes]
 * @returns {string|null} ISO 8601, or null if there is no serve time
 */
export function computeLatestPullTime(desiredServeTime, restMinutes = 0) {
  if (!desiredServeTime) return null;
  if (!Number.isFinite(restMinutes) || restMinutes <= 0) return desiredServeTime;
  return addMinutes(desiredServeTime, -restMinutes);
}

/**
 * Compute all calculations for the current session state
 * This is the main entry point that combines all calculation functions
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} [params.ovenEvents] - Used to keep the rate fit
 *   inside one oven-state segment; see readingsForRateFit
 * @param {number} params.pullTempF - Where the cook stops. NOT the serving
 *   temperature: the projection aims at the pull, and carryover carries the meat
 *   from there to the plate. See carryoverService.js.
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @param {number} [params.restMinutes] - Rest the meat needs before it is
 *   served. The schedule is judged against the latest PULL time, which is the
 *   serve time less the rest.
 * @param {string} [params.now] - ISO timestamp to measure countdowns from
 * @returns {CalculationResult}
 */
export function computeSessionCalculations({
  readings,
  ovenEvents = [],
  pullTempF,
  desiredServeTime,
  settings,
  restMinutes = 0,
  now = new Date().toISOString()
}) {
  // Handle empty or insufficient readings
  if (readings.length === 0) {
    return {
      currentRate: null,
      averageRate: null,
      predictedMinutesToTarget: null,
      predictedMinutesFromNow: null,
      predictedTargetTime: null,
      projectionRefusedReason: 'no-readings',
      latestPullTime: null,
      scheduleVarianceMinutes: null,
      scheduleStatus: 'unknown',
      confidence: { level: 'insufficient', reason: 'No readings recorded yet' }
    };
  }
  
  const lastReading = readings[readings.length - 1];
  const currentTemp = lastReading.temp;
  const timeSpan = calculateReadingSpanMinutes(readings);
  
  // Calculate rates. The fit is confined to the current oven-state segment: a
  // window straddling a pause reports the pause's flatness as the roast's rate.
  const fitReadings = readingsForRateFit(readings, ovenEvents);
  const rateResult = calculateHeatingRate(fitReadings, settings.smoothingWindowReadings);
  const averageRate = calculateAverageRate(readings);
  
  // Assess confidence
  const confidence = assessConfidence({
    readingCount: readings.length,
    timeSpanMinutes: timeSpan,
    r2: rateResult.r2,
    rate: rateResult.rate,
    fitReadings: rateResult.readings
  });
  
  // Predict time to target, anchored to when the last reading was taken
  const prediction = predictTimeToTarget(
    currentTemp,
    pullTempF,
    rateResult.rate,
    lastReading.timestamp,
    now
  );
  
  // The projection aims at the PULL, so it is judged against the latest moment
  // the meat can come out and still be rested by the serve time - not against
  // the serve time itself. Applied here rather than inside
  // calculateScheduleVarianceWithThreshold, which is a clean comparison of two
  // timestamps and has its own tests saying exactly that.
  const latestPullTime = computeLatestPullTime(desiredServeTime, restMinutes);
  
  // Calculate schedule variance if serve time is set
  let scheduleVariance = { varianceMinutes: null, status: 'unknown' };
  if (latestPullTime && prediction.targetTime) {
    scheduleVariance = calculateScheduleVarianceWithThreshold(
      prediction.targetTime,
      latestPullTime,
      settings.onTrackThresholdMinutes
    );
  }
  
  return {
    currentRate: rateResult.rate,
    averageRate,
    predictedMinutesToTarget: prediction.minutes,
    predictedMinutesFromNow: prediction.minutesFromNow,
    predictedTargetTime: prediction.targetTime,
    // Why there is no projection, when there is none. Distinguishes "not enough
    // data yet" from "the number came out absurd and was refused", which the UI
    // and the eligibility gate need to say different things about.
    projectionRefusedReason: prediction.reason ?? null,
    latestPullTime,
    scheduleVarianceMinutes: scheduleVariance.varianceMinutes,
    scheduleStatus: scheduleVariance.status,
    confidence
  };
}




