import { minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { RECOMMENDATION_MESSAGES } from '../constants/defaults.js';
import { assessPullProgress } from './calculationService.js';

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

/**
 * What to tell the cook when the projection was refused. Keyed by
 * predictTimeToTarget's `reason`.
 *
 * Each one is a different situation and only one of them resolves itself by
 * waiting, so they do not share a string.
 */
const PROJECTION_REFUSAL_REASONS = {
  'no-rate': 'Not enough usable readings to measure a heating rate yet.',
  'no-temp': 'A temperature is missing or unreadable. Check the latest reading.',
  'rate-too-low':
    'The core is barely moving, so there is nothing to project from. Check the ' +
    'probe is still seated and the oven is on.',
  'beyond-horizon':
    'At the current rate the target is more than five hours away - too far for ' +
    'this projection to be worth acting on. Log another reading as it speeds up.',
  'no-readings': 'No readings recorded yet.',
  default: 'There is no projection to advise from yet.'
};

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
 * @param {string|null} [params.projectionRefusedReason] - Why the projection was
 *   refused, if it was. See predictTimeToTarget.
 * @returns {{canRecommend: boolean, blockerReason: string|null, blockerType: string|null, progress: Object|null}}
 */
export function checkRecommendationEligibility({
  readings,
  ovenEvents,
  desiredServeTime,
  settings,
  confidence,
  projectionRefusedReason = null,
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
  
  /**
   * Is the newest reading still evidence?
   *
   * Inserted here, between the time-span gate and the oven gates, and it OUTRANKS
   * `stale_oven_data` on purpose. That ordering is the bug: a dial change logged
   * ten minutes ago satisfies the oven gate, so the app would happily advise from
   * a projection whose newest actual measurement of the meat was three hours old.
   * The oven setting is a thing the cook told the app; the reading is the only
   * thing the app knows about the roast.
   *
   * A projection is only as fresh as its newest reading, and past this age the
   * honest answer is to ask for another one rather than to keep extrapolating.
   */
  const staleAfter = settings.staleReadingMinutes ?? 45;
  const newest = readings[readings.length - 1];
  const readingAge = minutesBetween(newest.timestamp, now);
  
  if (readingAge > staleAfter) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.STALE_READING,
      blockerType: 'stale_reading',
      progress: {
        current: Math.round(readingAge),
        required: staleAfter,
        message: 'Log a fresh reading to resume advice'
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
  
  // A refused projection is a blocker, and has to say so.
  //
  // Without this the refusal fell through to calculateRecommendation with
  // scheduleStatus 'unknown', which returns action 'none' and the string
  // "Unable to determine schedule status." - with canRecommend TRUE. So the app
  // presented a non-answer as though it were advice, in the panel where advice
  // goes, styled as advice. Refusing to project and admitting it are the same
  // decision; only one of them was implemented.
  //
  // Placed after the oven and serve-time gates: "confirm your oven setting" and
  // "set a serve time" are things the cook can act on, and this is not.
  if (projectionRefusedReason) {
    return {
      canRecommend: false,
      blockerReason: PROJECTION_REFUSAL_REASONS[projectionRefusedReason]
        ?? PROJECTION_REFUSAL_REASONS.default,
      blockerType: 'no_projection',
      progress: null
    };
  }
  
  // If the oven is off we have already established (in generateRecommendation) that a
  // reading exists since the pause began, so let the recommendation through even though
  // the heating rate measured across the pause will look slow or unstable.
  //
  // Note this short-circuits ahead of every confidence gate, which is why
  // generateRecommendation narrows the ACTION set while paused - see the
  // restart-only branch there. Left unconstrained, this branch happily returned
  // "raise the oven to 225" about an oven that was switched off.
  if (isOvenOff) {
    return {
      canRecommend: true,
      blockerReason: null,
      blockerType: null,
      progress: null,
      ovenIsOff: true
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
 * Coldest core, in Fahrenheit, at which pausing the cook is offered outright.
 *
 * 140 °F is 60 °C - the top of the food-safety danger zone. Below it the meat is
 * in the range where switching the oven off and leaving it there extends the
 * time it spends there, and the app cannot police how long the cook will
 * actually leave it.
 */
export const MIN_CORE_FOR_OVEN_OFF_F = 140;

/**
 * ...with one exemption, without which the pause path would not exist.
 *
 * Every red-meat target is BELOW 140 °F - the app's own default is 125 °F for
 * medium-rare beef - so a flat "no pausing under 140 °F core" rule deletes the
 * feature for the majority of cooks it was built for, along with the whole
 * lower-then-pause ladder. That cannot be the intent of a food-safety guard.
 *
 * What actually makes a pause hazardous is TIME accumulated in the danger zone.
 * Within this band of the target the roast is in its final approach - minutes to
 * an hour from done - and a pause now cannot strand it, because it is about to
 * leave the zone for good. Further out it has hours to run and a pause is a real
 * extension.
 *
 * So: 140 °F core, OR inside the final approach. Both, with the pause itself
 * capped at MAX_OVEN_OFF_MINUTES.
 */
export const FINAL_APPROACH_BAND_F = 25;

/**
 * Is pausing the cook a timing tool here, or a food-safety problem?
 *
 * @param {number|null} latestCoreTempF
 * @param {number|null} targetTempF
 * @returns {boolean}
 */
export function mayPauseCooking(latestCoreTempF, targetTempF) {
  // No reading: this is the caller's problem, not something to guess at. Left
  // permissive so an unrelated caller is not silently changed; every path in
  // this file passes the reading.
  if (latestCoreTempF === null || latestCoreTempF === undefined) return true;
  if (latestCoreTempF >= MIN_CORE_FOR_OVEN_OFF_F) return true;
  if (typeof targetTempF !== 'number') return false;
  return latestCoreTempF >= targetTempF - FINAL_APPROACH_BAND_F;
}

/** Longest pause the app will ever suggest, in minutes. */
export const MAX_OVEN_OFF_MINUTES = 20;

/**
 * How long to pause the cook for.
 *
 * Half of however early the cook is running, capped hard.
 *
 * The cap is 20 minutes, not 45. Measured oven-off efficiency in the harness is
 * 0.4-0.53: a closed oven with the element off gives up its heat slowly
 * (tauOvenCoolMin 45), so the meat keeps climbing through most of the pause and
 * 45 minutes of oven-off buys only about 20 minutes of delay. Suggesting 45
 * therefore promised more than twice what it delivered, and the cook came back
 * to a roast that had carried on cooking.
 *
 * The `!predictedMinutesToTarget` branch that used to sit at the top of this
 * function - a 0.4x heuristic - was unreachable: the only caller is inside the
 * 'early' branch of calculateRecommendation, which is only entered when a
 * schedule variance exists, and a schedule variance requires a projection. It
 * has been deleted rather than left as a second, differently-tuned answer to the
 * same question.
 *
 * @param {number} scheduleVarianceMinutes - How early we're running (positive)
 * @returns {number} Suggested pause duration in minutes
 */
function calculateOvenOffDuration(scheduleVarianceMinutes) {
  const suggestedPause = Math.round(Math.abs(scheduleVarianceMinutes) * 0.5);
  return Math.max(5, Math.min(MAX_OVEN_OFF_MINUTES, suggestedPause));
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
 * @param {number|null} [params.latestCoreTempF] - Newest reading (°F). Pausing
 *   the cook is refused in the danger zone, and without this the function had no
 *   way to know - it was advising oven-off at any core temperature at all.
 * @param {number|null} [params.targetTempF] - Pull target (°F), for the
 *   final-approach exemption in mayPauseCooking
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
  latestCoreTempF = null,
  targetTempF = null,
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
    // Snapping rounds to the NEAREST mark, which can land past
    // recommendationMaxStepF - the cap above is applied to the unsnapped step.
    // On a Celsius dial the marks are 5°C (9°F) apart, so a 25°F cap emitted a
    // 27°F (15°C) suggestion. Step back to the mark below the cap.
    if (suggestedTemp - ovenBaseTemp > recommendationMaxStepF) {
      suggestedTemp = snapToDial(ovenBaseTemp + recommendationMaxStepF, displayUnits, 'down');
    }
    if (suggestedTemp <= ovenBaseTemp) {
      // Snapping swallowed the whole step - move by one dial increment instead
      // of emitting a "change" that leaves the dial where it already is. One
      // increment can itself exceed the cap on a coarse dial; a change the user
      // can actually make is the lesser evil.
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
    if (ovenBaseTemp - suggestedTemp > recommendationMaxStepF) {
      suggestedTemp = snapToDial(ovenBaseTemp - recommendationMaxStepF, displayUnits, 'up');
    }
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
      // ORDER MATTERS HERE, and it used to be wrong.
      //
      // The clamp to the practical minimum comes FIRST, ahead of the
      // enableLowTempRecommendations test. That setting means "may I suggest a
      // temperature below the practical minimum" - lowering the dial TO the
      // practical minimum is not such a suggestion. Testing it first meant a
      // cook with the setting off, whose oven was at 250, was told to switch the
      // oven OFF when "lower the dial to 175" was available, legal, and the
      // obviously better answer.
      if (ovenBaseTemp > practicalMinSetting) {
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
      
      // The dial is already at or below the practical minimum, so the only
      // remaining lever is time: pause the cook.
      //
      // Except below 140 °F core, where it is not a lever at all. Switching the
      // oven off with the meat in the danger zone, for a duration the app cannot
      // enforce, is not a timing decision. Hold and say so.
      if (!mayPauseCooking(latestCoreTempF, targetTempF)) {
        return {
          action: 'hold',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: RECOMMENDATION_MESSAGES.EARLY_NO_PAUSE_YET,
          reasoning: `Running ${Math.round(absVariance)} minutes early with the oven already at its practical minimum. Pausing is not offered this far from target below ${MIN_CORE_FOR_OVEN_OFF_F}°F core: the meat would spend the pause in the food-safety danger zone with hours still to run.`,
          alternativeMessage: null,
          ovenOffMinutes: null,
          practicalMinF: practicalMinSetting,
          severity: 'info'
        };
      }
      
      const ovenOffMinutes = calculateOvenOffDuration(absVariance);
      
      if (!enableLowTemp) {
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
  //
  // A HOLD counts as overshot for the same reason, and this is the case that
  // produced a genuine oscillator once readings got dense enough to expose it:
  //
  //   the app asks for 215; the cook sets 215; the next reading still describes
  //   200, and under 200 the projection now says on-track, so `hold` comes back
  //   with suggestedTemp = 200 - the MEASURED set point, not a request. Read as
  //   a target, that says "go to 200", so the dial is dragged back. One reading
  //   later the 200 is itself unmeasured, evidence is 215, on-track again, and
  //   the app asks for 215. Four reversals in seventy minutes, each one a trip
  //   to the oven, and the roast fine throughout.
  //
  // The projection is not ASKING for anything when it holds. Its suggestedTemp is
  // the set point it was measured at, and treating that as a request is the
  // error. So: hold + an unmeasured change = settling, always.
  const overshot = recommendation.action === 'lower'
    ? gap > 0
    : recommendation.action === 'raise'
      ? gap < 0
      : recommendation.action === 'hold';
  
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
    const asked = recommendation.action === 'lower'
      ? 'a drop to'
      : recommendation.action === 'raise'
        ? 'a rise to'
        : 'no change from';
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
      reasoning: `The oven was changed ${effect.minutesSinceChange} min ago, so the projection still describes the previous setting - it asked for ${asked} {plannedTemp} and the dial has gone past that. Reversing now would be correcting a change no reading has measured yet.`,
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
 * @param {number} params.pullTempF - The temperature the cook stops at, in °F.
 *   NOT the serving temperature - see carryoverService.js.
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target at current rate
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @param {string|null} [params.projectionRefusedReason] - Why there is no
 *   projection, if there is none
 * @param {'F'|'C'} [params.displayUnits] - Unit the user's oven dial is marked in
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  ovenBaseTemp,
  pullTempF,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings,
  predictedMinutesToTarget,
  currentRate,
  projectionRefusedReason = null,
  displayUnits = 'F',
  now = new Date().toISOString()
}) {
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  
  // Already at or past the pull temperature - projections are meaningless from
  // here, so skip straight to the done state rather than advising an oven change.
  //
  // Through assessPullProgress, which is the app's one answer to "is it done
  // yet". There were four separate implementations of this comparison and one of
  // them compared in display units, so a Celsius session could get two different
  // verdicts about the same roast on the same screen.
  const pullProgress = assessPullProgress(latestReading?.temp ?? null, pullTempF);
  if (latestReading && (pullProgress.state === 'at-pull' || pullProgress.state === 'over')) {
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
    projectionRefusedReason,
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
  
  // The oven is off, and a reading since the pause exists (the branch above
  // guarantees it). The eligibility gate lets this through ahead of every
  // confidence check, which is right - the rate measured across a pause is
  // meaningless and there is no point blocking on it - but it left the ACTION
  // unconstrained, so the projection-based branches ran as normal and the app
  // said "raise the oven to 225" about an oven that was switched off. The cook's
  // only real option here is to restart it.
  if (isOvenOff) {
    return buildRecommendationResult({
      action: 'restart-oven',
      suggestedTemp: ovenBaseTemp,
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.RESTART_OVEN,
      reasoning: 'The oven is off. Nothing else can be advised until it is back on: every projection-based suggestion assumes the oven is heating, and the measured rate across a pause describes cooling.',
      latestReadingTemp: latestReading ? latestReading.temp : null,
      severity: 'moderate'
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
      latestCoreTempF: latestReading ? latestReading.temp : null,
      targetTempF: pullTempF,
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
  
  // Normal recommendation. The oven is on: the paused case returned above.
  const recommendation = calculateRecommendation({
    ovenBaseTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings,
    predictedMinutesToTarget,
    currentRate,
    latestCoreTempF: latestReading ? latestReading.temp : null,
    targetTempF: pullTempF,
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




