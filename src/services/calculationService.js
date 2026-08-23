import { hoursBetween, minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { CALCULATION_THRESHOLDS } from '../constants/defaults.js';
import {
  fitThermalModel,
  kPrior,
  projectToTarget,
  instantaneousRate,
  assessDeadTimeGate,
  assessRateAgreement,
  confidenceFromFit,
  MIN_READINGS_FOR_FIT,
  WARM_START_THRESHOLD_F
} from './thermalModel.js';

/*
 * `readingsForRateFit` lived here. It confined the rate fit to the current
 * oven-state segment, because a line fitted across a pause reported the pause's
 * flatness as the roast's heating rate - measured at 4.5 °F/hr against a true 10.
 *
 * The thermal model needs no such thing. It integrates the actual dial timeline,
 * oven-off events included, so a pause is not an anomaly to be excluded from the
 * data but a segment with the set point at ambient and a 45-minute cooling
 * constant. The readings taken across it are evidence like any others.
 */

/**
 * Calculate the heating rate from a set of readings using LINEAR regression.
 * Returns rate in degrees Fahrenheit per hour.
 *
 * Together with predictTimeToTarget below, this is the linear baseline the
 * thermal model is scored against, not the app's projection. See the note on
 * predictTimeToTarget.
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
 * Predict time to reach target temperature by LINEAR extrapolation.
 *
 * NOT the app's projection any more. computeSessionCalculations uses the two-lag
 * thermal model in thermalModel.js, and there is deliberately no fallback from
 * that to this one: measured against the deck, the line gave 17.5 minutes of mean
 * absolute error against the curve's 3.0, and the fallback for "cannot fit" is
 * silence rather than a worse answer wearing the same confidence.
 *
 * Retained because it is the BASELINE the harness scores the curve against - a
 * comparison worth being able to re-run - and because the horizon and rate-floor
 * guards it documents still apply to both.
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
/**
 * Turn "minutes of heating still needed" into the three timings a display wants,
 * refusing anything absurd.
 *
 * Shared by the thermal projection and by the linear one the harness scores it
 * against, so the two cannot disagree about what counts as absurd.
 *
 * @param {number|null} minutesFromAnchor
 * @param {string} anchorTime - When the reading it is measured from was taken
 * @param {string} now
 * @param {string|null} [refusal] - A reason already established upstream
 * @returns {{minutes: number|null, minutesFromNow: number|null,
 *   targetTime: string|null, reason: string|null}}
 */
export function guardProjection(minutesFromAnchor, anchorTime, now, refusal = null) {
  const refuse = (reason) => ({
    minutes: null, minutesFromNow: null, targetTime: null, reason
  });

  if (refusal) return refuse(refusal);
  if (minutesFromAnchor === null || !Number.isFinite(minutesFromAnchor)) {
    return refuse('no-projection');
  }
  if (minutesFromAnchor < 0) return refuse('no-projection');

  const minutes = Math.round(minutesFromAnchor);

  /**
   * NO HORIZON CHECK HERE, on purpose.
   *
   * There used to be one, against CALCULATION_THRESHOLDS.MAX_PREDICTION_MINUTES,
   * and it could never fire: every caller passes the output of `projectToTarget`,
   * which refuses anything past PROJECTION_HORIZON_MINUTES itself, and the two
   * constants are the same 1440 - so `Math.round(1440) > 1440` was the whole test.
   * Two constants for one bound, one of them unreachable, is how a limit comes to
   * be believed in without being enforced. The horizon is enforced where the
   * projection is made, and `beyond-horizon` still arrives here as a `refusal`.
   */
  const targetTime = addMinutes(anchorTime, minutes);
  return {
    minutes,
    minutesFromNow: Math.round(minutesBetween(now, targetTime)),
    targetTime,
    reason: null
  };
}

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
  
  /**
   * The horizon. A straight line fitted to three readings does not know it has left
   * the range of everything it has seen, and the app has no way to say "this is a
   * guess" once the number is a time on a clock.
   *
   * This is the only surviving use of MAX_PREDICTION_MINUTES, and it is load-bearing
   * here in a way it was not in guardProjection: the line has no horizon of its own.
   * `predictTimeToTarget` is the linear baseline the oracle scores the real
   * projection against and has no production callers, so this cap now guards a
   * measuring instrument rather than the app.
   */
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

/*
 * `assessConfidence` lived here. It graded a projection on R², reading count and
 * time span, and every one of those was the wrong question.
 *
 * R² says how much of the variance a fit explains, not whether the MODEL is
 * right: a straight line through three points on an S-curve scores beautifully
 * while being wrong by half an hour. Worse, over a three-point window R² cannot
 * fall below about 0.75, so its "readings are fluctuating" branch - and the
 * `unstable_rate` blocker that branch fed - had never once been reached.
 *
 * Replaced by confidenceFromFit in thermalModel.js, which grades the RMS residual
 * of the curved fit in DEGREES against the probe's own noise floor. That is the
 * only scale that means anything: a fit agreeing with the readings to within
 * their noise cannot be improved on with this data, and one missing them by 12 °F
 * is describing a different roast.
 */

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
 * @param {number|null} [params.weightLb] - Feeds the prior on k. Worth about
 *   0.1% of the fit once three readings exist; what it buys is that the fit
 *   always returns, so the show/don't-show decision lives entirely in the gate.
 * @param {string|null} [params.meatType] - Feeds the shape factor of that prior
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
  weightLb = null,
  meatType = null,
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
      projectionIfRestarted: null,
      latestPullTime: null,
      scheduleVarianceMinutes: null,
      scheduleStatus: 'unknown',
      confidence: {
        level: 'insufficient',
        code: 'no-readings',
        reason: 'No readings recorded yet'
      }
    };
  }
  
  const lastReading = readings[readings.length - 1];
  const currentTemp = lastReading.temp;
  const timeSpan = calculateReadingSpanMinutes(readings);
  const averageRate = calculateAverageRate(readings);
  
  /**
   * The projection aims at the PULL, so it is judged against the latest moment
   * the meat can come out and still be rested by the serve time - not against the
   * serve time itself. Applied here rather than inside
   * calculateScheduleVarianceWithThreshold, which is a clean comparison of two
   * timestamps and has its own tests saying exactly that.
   */
  const latestPullTime = computeLatestPullTime(desiredServeTime, restMinutes);
  
  const refuse = (reason, confidence) => ({
    currentRate: null,
    averageRate,
    predictedMinutesToTarget: null,
    predictedMinutesFromNow: null,
    predictedTargetTime: null,
    projectionRefusedReason: reason,
    projectionIfRestarted: null,
    latestPullTime,
    scheduleVarianceMinutes: null,
    scheduleStatus: 'unknown',
    confidence
  });
  
  /**
   * NO WINDOWING. Every reading goes into the fit.
   *
   * The old code fitted a line to the last `smoothingWindowReadings` and threw
   * the rest away, which is right for a straight line and wrong for a curve: the
   * early readings are the ones carrying the curvature that identifies k, and
   * discarding them leaves the fit unable to tell an accelerating roast from a
   * decelerating one. `smoothingWindowReadings` is now unused, and its settings
   * control has been removed rather than left there to be changed with no effect.
   */
  /**
   * With no oven history at all there is nothing to project THROUGH. The model
   * drives the surface node from the dial, and an absent dial is not the same
   * thing as an oven that is off - saying `unreachable` about a cook whose oven
   * setting was simply never logged would be blaming the oven for the app's
   * missing data.
   */
  if (!ovenEvents || ovenEvents.length === 0) {
    return refuse('no-oven-history', {
      level: 'insufficient',
      code: 'no-oven-history',
      reason: 'No oven setting has been recorded, so there is nothing to project from.'
    });
  }
  
  const fit = fitThermalModel({
    readings,
    ovenEvents,
    prior: kPrior({ weightLb, meatType }),
    nowISO: now
  });
  
  if (!fit) {
    return refuse('insufficient-readings', {
      level: 'insufficient',
      code: 'insufficient-readings',
      reason: `Need at least ${MIN_READINGS_FOR_FIT} readings to project a finish time.`
    });
  }
  
  /**
   * The dead-time gate. The single most important thing in this function.
   *
   * Before it, the first advice of every cook came from a curve fitted to the
   * flat early limb of an S-curve, which is not a weak projection but one that is
   * wrong in DIRECTION - so the app said "running late, raise the oven" and the
   * roast then finished early. There is no fit clever enough to fix that, because
   * the information is not in the readings yet. Silence is the correct answer.
   */
  // The PRIOR, not fit.k: this gate decides whether the fit can be trusted, so
  // handing it the fit's own k is circular - see G3 in assessDeadTimeGate.
  const gate = assessDeadTimeGate({ readings, k: fit.prior, pullTempF });
  if (!gate.passed) {
    return refuse(gate.code, {
      level: 'insufficient',
      code: gate.code,
      reason: GATE_REASONS[gate.code] ?? 'Not enough of the cook has happened to project a finish time.',
      detail: gate.detail
    });
  }
  
  const warmStart = readings[0].temp > WARM_START_THRESHOLD_F;
  const confidence = confidenceFromFit({
    // The RECENT residual, not the whole history's. The projection extrapolates
    // from the newest reading, so what decides whether it can be trusted is
    // whether the model describes the roast now - and judging it over every
    // reading ever made refusal permanent. See CONFIDENCE_WINDOW_READINGS.
    rmsResidual: fit.recentRmsResidual,
    dof: fit.dof,
    warmStart,
    // How far into the cook we are. A small residual on the first reading past the
    // gate is not evidence - see MIN_PROGRESS_FOR_HIGH_CONFIDENCE.
    progress: gate.detail?.progress ?? null
  });
  
  // A fit the model itself does not believe is not a projection with a caveat.
  if (confidence.level === 'insufficient') {
    return refuse(confidence.code, confidence);
  }

  /**
   * Does the model's rate agree with the rate the readings actually show?
   *
   * This is the gate that decides whether there is a projection at all, and it
   * replaced the residual in that job - see confidenceFromFit and
   * assessRateAgreement for why. A residual describes the past; a roast that has
   * stalled, or been opened, or hit a plateau the model cannot represent, is a
   * statement about right now.
   */
  const rateCheck = assessRateAgreement({
    readings,
    ovenEvents,
    anchorState: fit.anchorState,
    k: fit.k
  });
  if (!rateCheck.agrees) {
    const observed = rateCheck.detail.observedRate;
    const modelled = rateCheck.detail.modelRate;
    return refuse(rateCheck.code, {
      level: 'insufficient',
      code: rateCheck.code,
      reason:
        `This roast has slowed to ${observed.toFixed(1)}°F per hour, well under the ` +
        `${modelled.toFixed(1)}°F the curve so far predicts, so a finish time from it ` +
        'would be wrong. This is normal in the middle of a large cut. Timing advice ' +
        'comes back as soon as it picks up again.',
      detail: rateCheck.detail
    });
  }
  
  /**
   * The rate is the INSTANTANEOUS one at the anchor: k·(Ts - Tc)·60.
   *
   * Late in a cook this reads visibly lower than the least-squares slope over the
   * same readings, because the core decelerates as it closes on the surface and a
   * line through three points cannot know that. The difference is the
   * improvement.
   */
  const currentRate = instantaneousRate(fit.anchorState, fit.k);
  
  const projected = projectToTarget({
    state: fit.anchorState,
    k: fit.k,
    setPointF: fit.currentSetPointF,
    targetF: pullTempF
  });
  
  const prediction = guardProjection(
    projected.minutes,
    lastReading.timestamp,
    now,
    projected.reason
  );
  
  /**
   * While the oven is off there is no finish time, which is correct and also a
   * visible regression: the ETA simply disappears. So the app also works out what
   * WOULD happen once the oven is back on, at the last setting the cook used, and
   * the pause UI can say "about 2 h 10 m once the oven is back on" instead of a
   * dash.
   */
  let projectionIfRestarted = null;
  if (fit.currentSetPointF === null || fit.currentSetPointF === undefined) {
    const restartAt = lastActiveSetPoint(ovenEvents);
    if (restartAt !== null) {
      const restarted = projectToTarget({
        state: fit.anchorState,
        k: fit.k,
        setPointF: restartAt,
        targetF: pullTempF
      });
      projectionIfRestarted = {
        minutes: restarted.minutes === null ? null : Math.round(restarted.minutes),
        reason: restarted.reason,
        atOvenTempF: restartAt
      };
    }
  }
  
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
    currentRate,
    averageRate,
    predictedMinutesToTarget: prediction.minutes,
    predictedMinutesFromNow: prediction.minutesFromNow,
    predictedTargetTime: prediction.targetTime,
    // Why there is no projection, when there is none. Distinguishes "not enough
    // data yet" from "the oven cannot get there", which the UI and the
    // eligibility gate need to say very different things about.
    projectionRefusedReason: prediction.reason ?? null,
    projectionIfRestarted,
    latestPullTime,
    scheduleVarianceMinutes: scheduleVariance.varianceMinutes,
    scheduleStatus: scheduleVariance.status,
    confidence,
    // The fit itself, for the chart and for the harness. Not for the UI to
    // interpret - `confidence` is the interpretation.
    fit: {
      k: fit.k,
      prior: fit.prior,
      rmsResidual: fit.rmsResidual,
      // What confidence was actually decided on, so the harness and the chart can
      // see the same number the gate saw.
      recentRmsResidual: fit.recentRmsResidual,
      dof: fit.dof,
      residuals: fit.residuals,
      anchorState: fit.anchorState,
      steadyStateF: projected.steadyStateF
    },
    timeSpanMinutes: timeSpan,
    currentTempF: currentTemp
  };
}

/**
 * Re-project the schedule as if the oven were on a different set point.
 *
 * Used for exactly one thing: while a dial change is still unmeasured, the
 * recommendation is computed from the set point the READINGS describe, and the
 * variance it is judged against has to describe the same oven or the two
 * disagree and the advice reverses. See scheduleUnderEvidence in
 * useRecommendations for the sequence that produces.
 *
 * The fit is unchanged - it is the same readings and the same oven history, so
 * the same k. Only the forward projection is re-run, under a different dial.
 *
 * @param {Object} params
 * @param {Array} params.readings
 * @param {Array} params.ovenEvents
 * @param {number} params.setPointF - The oven temperature to project under
 * @param {Object} params.config - Session config
 * @param {Object} params.settings
 * @param {string} params.now
 * @returns {{scheduleVarianceMinutes: number|null, scheduleStatus: string,
 *   predictedTargetTime: string|null}|null}
 */
export function projectScheduleUnderOven({
  readings, ovenEvents, setPointF, config, settings, now
}) {
  if (!readings?.length || !Number.isFinite(setPointF)) return null;

  const fit = fitThermalModel({
    readings,
    ovenEvents,
    prior: kPrior({ weightLb: config.weight, meatType: config.meatType }),
    nowISO: now
  });
  if (!fit) return null;
  if (!assessDeadTimeGate({ readings, k: fit.prior, pullTempF: config.pullTempF }).passed) {
    return null;
  }

  const projected = projectToTarget({
    state: fit.anchorState,
    k: fit.k,
    setPointF,
    targetF: config.pullTempF
  });
  const anchor = readings[readings.length - 1].timestamp;
  const prediction = guardProjection(projected.minutes, anchor, now, projected.reason);

  const latestPullTime = computeLatestPullTime(
    config.desiredServeTime,
    config.restMinutes ?? 0
  );
  /**
   * NULL, not a truthy 'unknown'.
   *
   * The caller prefers this over the main variance whenever it is truthy, so
   * returning `{ scheduleStatus: 'unknown' }` threw away a healthy projection and
   * put "Unable to determine schedule status." on screen with canRecommend TRUE -
   * a non-answer presented as advice. Reproduced: a cook told "the oven is not hot
   * enough, raise it" raises 175 to 250 and logs a reading; the main projection is
   * fine (339 minutes early) but the projection under the set point the READINGS
   * still describe is `unreachable`, because 175 never reaches a 195 F pull. So
   * this function had nothing to contribute and said so in a way that overrode
   * everything else.
   *
   * Null means "no opinion", which is the truth, and lets the caller fall back to
   * the main variance. What the cook then sees is the settling state - the change
   * has been made, a reading will confirm it - which is the right thing to say
   * about an oven that moved thirty seconds ago.
   */
  if (!latestPullTime || !prediction.targetTime) return null;

  const variance = calculateScheduleVarianceWithThreshold(
    prediction.targetTime,
    latestPullTime,
    settings.onTrackThresholdMinutes
  );
  return {
    scheduleVarianceMinutes: variance.varianceMinutes,
    scheduleStatus: variance.status,
    predictedTargetTime: prediction.targetTime
  };
}

/** What the app says when the dead-time gate holds it back. */
const GATE_REASONS = {
  'insufficient-readings': `Need at least ${MIN_READINGS_FOR_FIT} readings before a finish time means anything.`,
  'insufficient-span': 'The readings are too close together to tell how fast this roast is heating.',
  'insufficient-rise': 'The core has barely moved yet. Check the probe is seated in the thickest part.',
  'insufficient-progress': 'Too early in the cook to project a finish time - the first stretch of a roast tells you almost nothing about the rest of it.',
  'target-below-readings': 'Every reading is at or above your target temperature. Either the probe is not in the thickest part of the roast, or the target needs raising.'
};

/**
 * The last temperature the oven was actually set to, ignoring off events.
 *
 * An off event stores 0, and restarting "at 0 °F" is the bug this avoids.
 */
function lastActiveSetPoint(ovenEvents) {
  for (let i = ovenEvents.length - 1; i >= 0; i--) {
    if (ovenEvents[i].isOff !== true) return ovenEvents[i].setTemp;
  }
  return null;
}




