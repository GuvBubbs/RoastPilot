import { minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { RECOMMENDATION_MESSAGES } from '../constants/defaults.js';

/**
 * Increments a real oven dial can actually be set to, per display unit. A
 * suggestion of 102°C is useless advice: the user rounds it themselves, which
 * used to look to the app like a manual change (see assessOvenChangeEffect).
 */
const DIAL_STEP = { C: 5, F: 5 };

/**
 * Snap an oven temperature to the nearest dial increment in the unit the user
 * is reading. Snapping in Fahrenheit would not help a Celsius dial - the two
 * grids do not line up - so this converts, snaps, and converts back.
 *
 * @param {number} tempF - Temperature in Fahrenheit
 * @param {'F'|'C'} units - Unit the dial is marked in
 * @param {'nearest'|'up'|'down'} [mode] - Rounding direction
 * @returns {number} Snapped temperature in Fahrenheit
 */
export function snapToDial(tempF, units, mode = 'nearest') {
  const step = DIAL_STEP[units] ?? DIAL_STEP.F;
  const inUnit = units === 'C' ? fahrenheitToCelsius(tempF) : tempF;
  const snapped = mode === 'up'
    ? Math.ceil(inUnit / step) * step
    : mode === 'down'
      ? Math.floor(inUnit / step) * step
      : Math.round(inUnit / step) * step;
  return units === 'C' ? celsiusToFahrenheit(snapped) : snapped;
}

/** One dial increment expressed in Fahrenheit. */
function dialStepF(units) {
  const step = DIAL_STEP[units] ?? DIAL_STEP.F;
  return units === 'C' ? step * 9 / 5 : step;
}

/**
 * Whether a reading has been logged at or after the given timestamp
 * 
 * @param {InternalReading[]} readings - Readings in chronological order
 * @param {string} sinceISO - ISO timestamp to compare against
 * @returns {boolean}
 */
export function hasReadingSince(readings, sinceISO) {
  if (readings.length === 0) return false;
  const latest = readings[readings.length - 1];
  return minutesBetween(sinceISO, latest.timestamp) >= 0;
}

/**
 * Build a complete Recommendation object, defaulting every field the callers
 * do not set. Keeps the emitted shape identical across all branches.
 * 
 * @param {Partial<Recommendation>} fields
 * @returns {Recommendation}
 */
export function buildRecommendationResult(fields) {
  return {
    action: 'none',
    suggestedTemp: null,
    changeAmount: null,
    message: null,
    reasoning: null,
    alternativeMessage: null,
    ovenOffMinutes: null,
    practicalMinF: null,
    plannedTempF: null,
    latestReadingTemp: null,
    severity: 'normal',
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null,
    awaitingEffect: false,
    ovenChangeMinutesAgo: null,
    waitMinutes: null,
    ...fields
  };
}

/**
 * Determine if conditions allow making a recommendation
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @param {Object} params.confidence - Confidence assessment from calculation service
 * @returns {{canRecommend: boolean, blockerReason: string|null, blockerType: string|null, progress: Object|null}}
 */
export function checkRecommendationEligibility({
  readings,
  ovenEvents,
  desiredServeTime,
  settings,
  confidence,
  now = new Date().toISOString()
}) {
  // Check minimum readings requirement
  if (readings.length < settings.minReadingsForRecommendation) {
    const needed = settings.minReadingsForRecommendation - readings.length;
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_READINGS.replace('{count}', settings.minReadingsForRecommendation),
      blockerType: 'insufficient_readings',
      progress: {
        current: readings.length,
        required: settings.minReadingsForRecommendation,
        message: `${needed} more reading${needed > 1 ? 's' : ''} needed`
      }
    };
  }
  
  // Check time span requirement
  const timeSpan = readings.length >= 2 
    ? minutesBetween(readings[0].timestamp, readings[readings.length - 1].timestamp)
    : 0;
  
  if (timeSpan < settings.minTimeSpanMinutes) {
    const needed = Math.ceil(settings.minTimeSpanMinutes - timeSpan);
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_TIME.replace('{minutes}', settings.minTimeSpanMinutes),
      blockerType: 'insufficient_time',
      progress: {
        current: Math.round(timeSpan),
        required: settings.minTimeSpanMinutes,
        message: `~${needed} more minutes of data needed`
      }
    };
  }
  
  // Check for recent oven temperature data
  if (ovenEvents.length === 0) {
    return {
      canRecommend: false,
      blockerReason: 'No oven temperature recorded. Please log your current oven setting.',
      blockerType: 'no_oven_data',
      progress: null
    };
  }
  
  const lastOvenEvent = ovenEvents[ovenEvents.length - 1];
  const ovenDataAge = minutesBetween(lastOvenEvent.timestamp, now);
  
  // Skip stale check if oven is currently off (we'll handle restart recommendations separately)
  const isOvenOff = lastOvenEvent.isOff === true;
  
  if (!isOvenOff && ovenDataAge > settings.ovenTempStaleMinutes) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.OVEN_TEMP_STALE,
      blockerType: 'stale_oven_data',
      progress: {
        current: Math.round(ovenDataAge),
        required: settings.ovenTempStaleMinutes,
        message: 'Please confirm your current oven setting'
      }
    };
  }
  
  // Check for desired serve time (required for timing recommendations)
  if (!desiredServeTime) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NO_SERVE_TIME,
      blockerType: 'no_serve_time',
      progress: null
    };
  }
  
  // If the oven is off we have already established (in generateRecommendation) that a
  // reading exists since the pause began, so let the recommendation through even though
  // the heating rate measured across the pause will look slow or unstable.
  if (isOvenOff) {
    return {
      canRecommend: true,
      blockerReason: null,
      blockerType: null,
      progress: null
    };
  }
  
  // For normal recommendations (oven is on), check confidence level
  if (confidence.level === 'insufficient') {
    return {
      canRecommend: false,
      blockerReason: confidence.reason,
      blockerType: 'insufficient_confidence',
      progress: null
    };
  }
  
  // Check for problematic rate (only when oven is on)
  if (confidence.level === 'low' && confidence.reason.includes('slow or negative')) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.RATE_TOO_LOW,
      blockerType: 'bad_rate',
      progress: null
    };
  }
  
  if (confidence.level === 'low' && confidence.reason.includes('fluctuating')) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.RATE_UNSTABLE,
      blockerType: 'unstable_rate',
      progress: null
    };
  }
  
  return {
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null
  };
}

/**
 * Calculate optimal oven-off duration to delay cooking
 * 
 * @param {number} scheduleVarianceMinutes - How early we're running (positive = early)
 * @param {number|null} predictedMinutesToTarget - Minutes until target at current rate
 * @param {number|null} currentRate - Current heating rate in °F/hour
 * @returns {number} Suggested pause duration in minutes
 */
function calculateOvenOffDuration(scheduleVarianceMinutes, predictedMinutesToTarget, currentRate) {
  // If we don't have prediction data, fall back to simple heuristic
  if (!predictedMinutesToTarget || !currentRate || currentRate <= 0) {
    return Math.max(5, Math.min(30, Math.round(scheduleVarianceMinutes * 0.4)));
  }
  
  // Pause for half of however early we are running. Note that predictedMinutesToTarget
  // cancels out of the expression below, so this reduces algebraically to
  // scheduleVarianceMinutes * 0.5 - the prediction only gates which branch we take.
  const pauseFactor = scheduleVarianceMinutes / predictedMinutesToTarget;
  const suggestedPause = Math.round(predictedMinutesToTarget * pauseFactor * 0.5);
  
  // Constrain to reasonable bounds (5-45 minutes)
  return Math.max(5, Math.min(45, suggestedPause));
}

/**
 * Calculate the recommended oven temperature adjustment
 * 
 * @param {Object} params
 * @param {number} params.ovenBaseTemp - The oven temperature to adjust FROM (°F).
 *   This is the last temperature actually set, not `currentOvenTemp`, which is 0
 *   while the oven is off - adjusting from 0 yields a nonsense set point.
 * @param {number} params.scheduleVarianceMinutes - Positive = late, negative = early
 * @param {'early'|'late'|'on-track'} params.scheduleStatus
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @param {'F'|'C'} [params.displayUnits] - Unit the user's dial is marked in;
 *   suggestions are snapped to a settable increment in that unit
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  ovenBaseTemp,
  scheduleVarianceMinutes,
  scheduleStatus,
  settings,
  predictedMinutesToTarget,
  currentRate,
  displayUnits = 'F'
}) {
  const {
    recommendationStepF,
    recommendationMaxStepF,
    ovenTempMinF,
    ovenTempMaxF,
    onTrackThresholdMinutes
  } = settings;
  
  // On track - recommend holding steady
  if (scheduleStatus === 'on-track') {
    return {
      action: 'hold',
      suggestedTemp: ovenBaseTemp,
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.HOLD,
      reasoning: `Predicted to finish within ${onTrackThresholdMinutes} minutes of your target time.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal'
    };
  }
  
  // Running late - suggest raising temperature
  if (scheduleStatus === 'late') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how late
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very late - suggest larger increase
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'urgent';
    } else if (absVariance > 15) {
      // Moderately late
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'moderate';
    } else {
      // Slightly late
      changeAmount = recommendationStepF;
      severity = 'normal';
    }
    
    // Snap to something the dial can actually be set to, then take the change
    // amount back off the snapped value so the two can never disagree.
    let suggestedTemp = snapToDial(ovenBaseTemp + changeAmount, displayUnits);
    if (suggestedTemp <= ovenBaseTemp) {
      // Snapping swallowed the whole step - move by one dial increment instead
      // of emitting a "change" that leaves the dial where it already is.
      suggestedTemp = snapToDial(ovenBaseTemp + dialStepF(displayUnits), displayUnits, 'up');
    }
    changeAmount = suggestedTemp - ovenBaseTemp;
    
    // Apply upper bound guardrail
    if (suggestedTemp > ovenTempMaxF) {
      suggestedTemp = snapToDial(ovenTempMaxF, displayUnits, 'down');
      changeAmount = suggestedTemp - ovenBaseTemp;
      
      // If already at max, can't recommend higher
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: `Already at maximum recommended temperature ({maxTemp}). Consider extending your timeline if possible.`,
          reasoning: `Running ${Math.round(absVariance)} minutes late, but oven is already at the upper limit for low-and-slow cooking.`,
          alternativeMessage: null,
          ovenOffMinutes: null,
          practicalMinF: null,
          maxTempF: ovenTempMaxF, // For formatting in composable
          severity: 'warning'
        };
      }
    }
    
    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.RAISE_LARGE 
      : RECOMMENDATION_MESSAGES.RAISE_SMALL;
    
    return {
      action: 'raise',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: messageTemplate,
      reasoning: `Running approximately ${Math.round(absVariance)} minutes late. Increasing oven temperature will speed up heating.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity
    };
  }
  
  // Running early - suggest lowering temperature
  if (scheduleStatus === 'early') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how early
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very early - suggest larger decrease
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'moderate';
    } else if (absVariance > 15) {
      // Moderately early
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'normal';
    } else {
      // Slightly early
      changeAmount = recommendationStepF;
      severity = 'normal';
    }
    
    // Snap to something the dial can actually be set to (see the raise branch)
    let suggestedTemp = snapToDial(ovenBaseTemp - changeAmount, displayUnits);
    if (suggestedTemp >= ovenBaseTemp) {
      suggestedTemp = snapToDial(ovenBaseTemp - dialStepF(displayUnits), displayUnits, 'down');
    }
    changeAmount = ovenBaseTemp - suggestedTemp;
    
    // Check practical minimum first (most ovens can't go below ~175°F/80°C).
    // Compared against the lowest *settable* value, not the raw limit: on a
    // Celsius dial 175°F falls between marks, and treating the unreachable
    // value as the floor left a "lower by 0°" recommendation behind.
    const practicalMinF = settings.ovenTempPracticalMinF || 175;
    const practicalMinSetting = snapToDial(practicalMinF, displayUnits, 'up');
    const enableLowTemp = settings.enableLowTempRecommendations !== false;
    
    if (suggestedTemp < practicalMinSetting) {
      // Calculate optimal oven-off duration using physics-based approach
      const ovenOffMinutes = calculateOvenOffDuration(absVariance, predictedMinutesToTarget, currentRate);
      
      // Check if low temp recommendations are disabled
      if (!enableLowTemp) {
        // Suggest oven-off instead of just saying "hold steady"
        return {
          action: 'oven-off',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: RECOMMENDATION_MESSAGES.LOW_TEMP_DISABLED,
          reasoning: `Running ${Math.round(absVariance)} minutes early. Low temperature recommendations are disabled, but you can pause cooking temporarily.`,
          alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_ALTERNATIVE,
          ovenOffMinutes,
          // The settable value, so the message names a temperature the dial has
          practicalMinF: practicalMinSetting,
          severity: 'moderate'
        };
      }
      
      // Already at practical minimum - suggest turning oven off temporarily
      if (ovenBaseTemp <= practicalMinSetting) {
        return {
          action: 'oven-off',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: RECOMMENDATION_MESSAGES.OVEN_OFF_SUGGESTED,
          reasoning: `Running ${Math.round(absVariance)} minutes early. Your oven is already at the practical minimum temperature.`,
          alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_ALTERNATIVE,
          ovenOffMinutes,
          practicalMinF: null,
          severity: 'moderate'
        };
      }
      
      // Suggest lowering to practical minimum
      suggestedTemp = practicalMinSetting;
      changeAmount = ovenBaseTemp - suggestedTemp;
      
      const messageTemplate = absVariance > 30 
        ? RECOMMENDATION_MESSAGES.LOWER_LARGE 
        : RECOMMENDATION_MESSAGES.LOWER_SMALL;
      
      return {
        action: 'lower',
        suggestedTemp: Math.round(suggestedTemp),
        changeAmount: Math.round(changeAmount),
        message: messageTemplate,
        reasoning: `Running approximately ${Math.round(absVariance)} minutes early. This is the practical minimum for most ovens.`,
        alternativeMessage: null,
        ovenOffMinutes: null,
        practicalMinF: null,
        severity
      };
    }
    
    // Apply food safety lower bound guardrail
    if (suggestedTemp < ovenTempMinF) {
      suggestedTemp = snapToDial(ovenTempMinF, displayUnits, 'up');
      changeAmount = ovenBaseTemp - suggestedTemp;
      
      // If already at min, can't recommend lower
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: `Already at minimum recommended temperature ({minTemp}). You may finish early.`,
          reasoning: `Running ${Math.round(absVariance)} minutes early, but oven is already at the lower limit for food safety.`,
          alternativeMessage: null,
          ovenOffMinutes: null,
          practicalMinF: null,
          minTempF: ovenTempMinF, // For formatting in composable
          severity: 'info'
        };
      }
    }
    
    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.LOWER_LARGE 
      : RECOMMENDATION_MESSAGES.LOWER_SMALL;
    
    return {
      action: 'lower',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: messageTemplate,
      reasoning: `Running approximately ${Math.round(absVariance)} minutes early. Lowering oven temperature will slow down heating.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity
    };
  }
  
  // Unknown status - no recommendation
  return {
    action: 'none',
    suggestedTemp: null,
    changeAmount: null,
    message: 'Unable to determine schedule status.',
    reasoning: 'Insufficient data to calculate timing.',
    alternativeMessage: null,
    ovenOffMinutes: null,
    practicalMinF: null,
    severity: 'unknown'
  };
}

/**
 * Work out which oven set point the current readings actually describe.
 *
 * A dial change cannot show up in the meat's heating rate immediately - there is
 * thermal lag, and then readings have to be taken. Until that has happened the
 * measured rate, and every projection built on it, still describes the PREVIOUS
 * setting. Recommendations that ignore this compound: each change is re-applied
 * on top of the one just made, walking the oven a step further every update.
 *
 * The evidence set point is the newest one with enough post-lag readings behind
 * it. Anything set after that is, so far, unmeasured.
 *
 * @param {Object} params
 * @param {InternalReading[]} params.readings - Readings in chronological order
 * @param {OvenTempEvent[]} params.ovenEvents - Oven events in chronological order
 * @param {AppSettings} params.settings
 * @param {string} [params.now]
 * @returns {{settled: boolean, evidenceTemp: number|null, currentTemp: number|null,
 *   minutesSinceChange: number|null, waitMinutes: number|null,
 *   readingsSinceChange: number, readingsNeeded: number}}
 */
export function assessOvenChangeEffect({
  readings,
  ovenEvents,
  settings,
  now = new Date().toISOString()
}) {
  const lagMinutes = settings.ovenChangeLagMinutes ?? 15;
  const readingsNeeded = settings.ovenChangeSettleReadings ?? 2;
  
  const settledResult = {
    settled: true,
    evidenceTemp: null,
    currentTemp: null,
    minutesSinceChange: null,
    waitMinutes: null,
    readingsSinceChange: 0,
    readingsNeeded
  };
  
  // Off events do not move the set point - they suspend it - so they are not
  // changes to reason about here. The pause branch handles that state.
  const active = ovenEvents.filter(e => e.isOff !== true);
  if (active.length === 0) return settledResult;
  
  const readingsAfterLag = (timestamp) => {
    const visibleFrom = addMinutes(timestamp, lagMinutes);
    return readings.filter(r => minutesBetween(visibleFrom, r.timestamp) >= 0).length;
  };
  
  const currentIndex = active.length - 1;
  
  let evidenceIndex = -1;
  for (let i = currentIndex; i >= 0; i--) {
    if (readingsAfterLag(active[i].timestamp) >= readingsNeeded) {
      evidenceIndex = i;
      break;
    }
  }
  
  // Nothing has been measured yet. With a single set point that is simply the
  // start of the cook (the eligibility gate vouches for the data); with several,
  // the oldest is the safest thing to anchor to - it is the one the earliest
  // readings belong to.
  const baseIndex = evidenceIndex === -1 ? 0 : evidenceIndex;
  
  const evidenceTemp = active[baseIndex].setTemp;
  const currentTemp = active[currentIndex].setTemp;
  const current = active[currentIndex];
  
  // A dial moved away and back again nets out: the readings describe the setting
  // that is in force, so there is nothing to wait for.
  if (baseIndex === currentIndex || evidenceTemp === currentTemp) {
    return { ...settledResult, evidenceTemp, currentTemp };
  }
  
  const visibleFrom = addMinutes(current.timestamp, lagMinutes);
  
  return {
    settled: false,
    evidenceTemp,
    currentTemp,
    minutesSinceChange: Math.round(minutesBetween(current.timestamp, now)),
    waitMinutes: Math.max(0, Math.round(minutesBetween(now, visibleFrom))),
    readingsSinceChange: readingsAfterLag(current.timestamp),
    readingsNeeded
  };
}

/**
 * Turn a recommendation computed from the *measured* set point into advice about
 * the set point the oven is actually on.
 *
 * Two cases matter. If the dial is already at (or acceptably near) the
 * temperature the projection calls for, the change is accepted and nothing more
 * is asked for - the app says so rather than re-issuing the same step. If the
 * dial is somewhere else, the target is restated as an absolute temperature; it
 * is never re-derived from the new set point, which is what made repeated
 * changes drift.
 *
 * @param {Object} params
 * @param {Object} params.recommendation - Result of calculateRecommendation for
 *   the measured (pre-change) set point
 * @param {number} params.currentOvenTemp - Set point the oven is on now (°F)
 * @param {Object} params.effect - Result of assessOvenChangeEffect
 * @param {AppSettings} params.settings
 * @param {'F'|'C'} [params.displayUnits]
 * @returns {Partial<Recommendation>}
 */
export function reconcileWithOvenChange({
  recommendation,
  currentOvenTemp,
  effect,
  settings,
  displayUnits = 'F'
}) {
  const settleFields = {
    awaitingEffect: true,
    ovenChangeMinutesAgo: effect.minutesSinceChange,
    waitMinutes: effect.waitMinutes
  };
  
  // Pausing advice is about the clock, not the dial: it survives a set point
  // change intact, except that the restart should name the new setting.
  if (recommendation.action === 'oven-off') {
    return { ...recommendation, suggestedTemp: currentOvenTemp, ...settleFields };
  }
  
  const implied = recommendation.suggestedTemp;
  if (implied === null || currentOvenTemp === null) {
    return { ...recommendation, ...settleFields };
  }
  
  const step = settings.recommendationStepF ?? 10;
  // Half a dial increment covers a user rounding the suggestion to a mark they
  // can actually hit; half a step covers the coarseness of the step itself.
  const tolerance = Math.max(dialStepF(displayUnits) / 2, step / 2);
  const gap = implied - currentOvenTemp; // positive: the oven is still too cool
  
  // Moving FURTHER than asked, in the direction that was asked for, must never
  // be answered by asking for the opposite move. The projection this target
  // came from was measured at the old set point, so it cannot yet see - and
  // cannot judge the size of - the change that has since been made. Reversing
  // on it is how "running 42 min early" ended up being told to raise the oven.
  // Hold, and let a reading decide.
  const overshot = recommendation.action === 'lower'
    ? gap > 0
    : recommendation.action === 'raise'
      ? gap < 0
      : false;
  
  if (Math.abs(gap) <= tolerance) {
    return {
      action: 'settling',
      suggestedTemp: currentOvenTemp,
      changeAmount: 0,
      message: effect.waitMinutes > 0
        ? RECOMMENDATION_MESSAGES.SETTLING_ON_PLAN
        : RECOMMENDATION_MESSAGES.SETTLING_ON_PLAN_READY,
      reasoning: `The oven was changed ${effect.minutesSinceChange} min ago and the readings so far still describe the previous setting. The setting you chose is what the projection calls for, so there is nothing to change until a reading shows the effect.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal',
      ...settleFields
    };
  }
  
  if (overshot) {
    const asked = recommendation.action === 'lower' ? 'a drop to' : 'a rise to';
    return {
      action: 'settling',
      suggestedTemp: currentOvenTemp,
      // The plan the dial has overshot, named so the message can say what was
      // asked for without the button offering to undo it.
      plannedTempF: Math.round(implied),
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.SETTLING_BEYOND_PLAN,
      // {plannedTemp} rather than a formatted number: only the composable
      // knows which unit the cook is reading.
      reasoning: `The oven was changed ${effect.minutesSinceChange} min ago, so the projection still describes the previous setting - it asked for ${asked} {plannedTemp} and you went further than that. Reversing now would be correcting a change no reading has measured yet.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal',
      ...settleFields
    };
  }
  
  return {
    ...recommendation,
    action: gap > 0 ? 'raise' : 'lower',
    suggestedTemp: Math.round(implied),
    changeAmount: Math.round(Math.abs(gap)),
    message: RECOMMENDATION_MESSAGES.SETTLING_RETARGET,
    reasoning: `The oven was changed ${effect.minutesSinceChange} min ago, so the projection still reflects the previous setting. This target comes from that projection - it is not stacked on top of the change you already made.`,
    ...settleFields
  };
}

/**
 * Generate the full recommendation result including eligibility check
 * 
 * Branch order matters: reaching the target and needing a post-pause reading both
 * short-circuit ahead of the eligibility check and the projection-based branches.
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings - Readings in chronological order
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {number} params.ovenBaseTemp - Current oven temp in °F
 * @param {number} params.targetTemp - Target internal meat temp in °F
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target at current rate
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @param {'F'|'C'} [params.displayUnits] - Unit the user's oven dial is marked in
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  ovenBaseTemp,
  targetTemp,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings,
  predictedMinutesToTarget,
  currentRate,
  displayUnits = 'F',
  now = new Date().toISOString()
}) {
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  
  // Already at or past target - projections are meaningless from here, so skip
  // straight to the done state rather than advising an oven change.
  if (latestReading && typeof targetTemp === 'number' && latestReading.temp >= targetTemp) {
    return buildRecommendationResult({
      action: 'at-target',
      message: RECOMMENDATION_MESSAGES.AT_TARGET,
      reasoning: 'The latest reading is at or above your target temperature, so no further oven changes will help.',
      latestReadingTemp: latestReading.temp,
      severity: 'info'
    });
  }
  
  const lastOvenEvent = ovenEvents.length > 0 ? ovenEvents[ovenEvents.length - 1] : null;
  const isOvenOff = lastOvenEvent !== null && lastOvenEvent.isOff === true;
  
  // Cooking is paused and nothing has been logged since. We deliberately do not
  // estimate how far the meat has cooled - ask for a real measurement instead.
  if (isOvenOff && !hasReadingSince(readings, lastOvenEvent.timestamp)) {
    return buildRecommendationResult({
      action: 'needs-reading',
      message: RECOMMENDATION_MESSAGES.NEEDS_READING,
      reasoning: 'Meat temperature while the oven is off is not estimated. A reading taken since the pause started is needed before recommendations can resume.',
      severity: 'moderate'
    });
  }
  
  // Then check eligibility
  const eligibility = checkRecommendationEligibility({
    readings,
    ovenEvents,
    desiredServeTime,
    settings,
    confidence,
    now
  });
  
  if (!eligibility.canRecommend) {
    return buildRecommendationResult({
      canRecommend: false,
      blockerReason: eligibility.blockerReason,
      blockerType: eligibility.blockerType,
      progress: eligibility.progress
    });
  }
  
  // A dial change that has not reached the readings yet is the one case where
  // the current set point is the wrong thing to advise from: the projection
  // still describes the previous setting, so the advice is anchored there and
  // then reconciled against where the dial actually is. Without this the same
  // step is re-applied on top of every change, manual or applied from here.
  const changeEffect = assessOvenChangeEffect({ readings, ovenEvents, settings, now });
  
  if (!changeEffect.settled) {
    const measured = calculateRecommendation({
      ovenBaseTemp: changeEffect.evidenceTemp,
      scheduleVarianceMinutes,
      scheduleStatus,
      settings,
      predictedMinutesToTarget,
      currentRate,
      displayUnits
    });
    
    return buildRecommendationResult({
      ...reconcileWithOvenChange({
        recommendation: measured,
        currentOvenTemp: ovenBaseTemp,
        effect: changeEffect,
        settings,
        displayUnits
      }),
      latestReadingTemp: latestReading ? latestReading.temp : null
    });
  }
  
  // Normal recommendation - from the latest reading, whether or not the oven is
  // currently off (a post-pause reading is guaranteed by the branch above).
  const recommendation = calculateRecommendation({
    ovenBaseTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings,
    predictedMinutesToTarget,
    currentRate,
    displayUnits
  });
  
  return buildRecommendationResult({
    ...recommendation,
    latestReadingTemp: latestReading ? latestReading.temp : null
  });
}

/**
 * Analyze how oven temperature changes have affected heating rate (nice-to-have)
 * This provides feedback on observed responsiveness
 * 
 * @param {InternalReading[]} readings
 * @param {OvenTempEvent[]} ovenEvents
 * @returns {Object|null} Responsiveness analysis or null if insufficient data
 */
export function analyzeOvenResponsiveness(readings, ovenEvents) {
  if (ovenEvents.length < 2 || readings.length < 5) {
    return null;
  }
  
  const segments = [];
  
  // Analyze each oven temperature segment
  for (let i = 0; i < ovenEvents.length; i++) {
    const segmentStart = new Date(ovenEvents[i].timestamp);
    const segmentEnd = i < ovenEvents.length - 1 
      ? new Date(ovenEvents[i + 1].timestamp)
      : new Date();
    
    // Find readings within this segment (with some delay for thermal lag)
    const lagMinutes = 15; // Thermal lag before oven change affects meat
    const effectiveStart = new Date(segmentStart.getTime() + lagMinutes * 60 * 1000);
    
    const segmentReadings = readings.filter(r => {
      const time = new Date(r.timestamp);
      return time >= effectiveStart && time < segmentEnd;
    });
    
    if (segmentReadings.length >= 2) {
      const first = segmentReadings[0];
      const last = segmentReadings[segmentReadings.length - 1];
      const hours = minutesBetween(first.timestamp, last.timestamp) / 60;
      
      if (hours > 0.1) {
        const rate = (last.temp - first.temp) / hours;
        segments.push({
          ovenTemp: ovenEvents[i].setTemp,
          heatingRate: rate,
          duration: minutesBetween(ovenEvents[i].timestamp, segmentEnd.toISOString()),
          readingCount: segmentReadings.length
        });
      }
    }
  }
  
  if (segments.length < 2) {
    return null;
  }
  
  // Calculate correlation between oven temp and heating rate
  const correlation = calculateCorrelation(
    segments.map(s => s.ovenTemp),
    segments.map(s => s.heatingRate)
  );
  
  // Estimate rate change per degree of oven change
  const ovenTemps = segments.map(s => s.ovenTemp);
  const rates = segments.map(s => s.heatingRate);
  const ovenRange = Math.max(...ovenTemps) - Math.min(...ovenTemps);
  const rateRange = Math.max(...rates) - Math.min(...rates);
  
  const responsiveness = ovenRange > 0 ? rateRange / ovenRange : 0;
  
  return {
    segments,
    correlation,
    responsiveness, // °F/hr change per °F oven change
    responsivenessValue: responsiveness,
    descriptionType: getResponsivenessDescriptionType(responsiveness, correlation)
  };
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Determine the type of responsiveness description
 * Returns type and raw values for formatting with proper units
 */
function getResponsivenessDescriptionType(responsiveness, correlation) {
  if (correlation < 0.3) {
    return {
      type: 'limited',
      correlation
    };
  }
  
  if (responsiveness > 0.1) {
    return {
      type: 'high',
      responsiveness,
      correlation
    };
  }
  
  return {
    type: 'moderate',
    correlation
  };
}




