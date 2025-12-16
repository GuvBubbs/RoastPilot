import { minutesBetween } from '../utils/timeUtils.js';
import { RECOMMENDATION_MESSAGES, SETTINGS_DEFAULTS } from '../constants/defaults.js';

/**
 * Estimate meat temperature after cooling period
 * Uses exponential decay (Newton's Law of Cooling)
 * 
 * @param {number} initialTemp - Initial meat temperature in °F
 * @param {number} minutesElapsed - Time elapsed since cooling started
 * @param {number} ambientTemp - Room/ambient temperature in °F (default 70°F)
 * @param {number} coolingRate - Cooling constant k (default 0.02 per minute for typical roasts)
 * @returns {number} Estimated current temperature in °F
 */
function estimateMeatCooling(initialTemp, minutesElapsed, ambientTemp = 70, coolingRate = 0.02) {
  // T(t) = T_ambient + (T_initial - T_ambient) * e^(-k*t)
  return ambientTemp + (initialTemp - ambientTemp) * Math.exp(-coolingRate * minutesElapsed);
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
  confidence
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
  const ovenDataAge = minutesBetween(lastOvenEvent.timestamp, new Date().toISOString());
  
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
  
  // If oven is off, we can provide restart recommendations regardless of confidence/rate stability
  // Restart recommendations don't rely on stable heating rate predictions
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
  
  // Calculate how much we need to delay
  // When oven is off, meat continues to heat from residual heat (slower rate)
  // Typical carryover: meat gains 3-5°F after oven off, then cools slowly
  // Estimate: oven off reduces effective rate by ~80-90%
  const effectiveRateWhenOff = currentRate * 0.15; // 85% reduction
  
  // We want to delay by scheduleVarianceMinutes
  // Time needed = variance / (1 - effectiveRate/currentRate)
  // Simplified: we want to "stretch" the remaining time
  const pauseFactor = scheduleVarianceMinutes / predictedMinutesToTarget;
  const suggestedPause = Math.round(predictedMinutesToTarget * pauseFactor * 0.5);
  
  // Constrain to reasonable bounds (5-45 minutes)
  return Math.max(5, Math.min(45, suggestedPause));
}

/**
 * Estimate heating rate at a different oven temperature
 * Uses proportional scaling based on temp difference
 * 
 * @param {number} newOvenTemp - Proposed new oven temperature in °F
 * @param {number} currentRate - Current observed heating rate in °F/hour
 * @param {number} currentOvenTemp - Current oven temperature in °F
 * @returns {number} Estimated heating rate at new oven temp in °F/hour
 */
function estimateHeatingRate(newOvenTemp, currentRate, currentOvenTemp) {
  if (!currentRate || currentRate <= 0 || !currentOvenTemp) {
    // No rate data, use typical rate: ~10-15°F/hr at 225°F
    return (newOvenTemp / 225) * 12;
  }
  
  // Simple proportional model: rate scales with oven temp
  // This is a rough approximation
  const scaleFactor = newOvenTemp / currentOvenTemp;
  return currentRate * scaleFactor;
}

/**
 * Calculate when to restart oven and at what temperature
 * 
 * @param {Object} params
 * @param {number} params.lastMeatTemp - Last recorded meat temperature in °F
 * @param {number} params.targetTemp - Target meat temperature in °F
 * @param {number} params.minutesSinceOvenOff - Minutes since oven was turned off
 * @param {string} params.desiredServeTime - ISO timestamp of desired serve time
 * @param {number} params.previousOvenTemp - Oven temperature before it was turned off in °F
 * @param {number|null} params.currentRate - Current/recent heating rate in °F/hour
 * @param {AppSettings} params.settings
 * @returns {Object} Restart recommendation
 */
function calculateOvenRestartRecommendation({
  lastMeatTemp,
  targetTemp,
  minutesSinceOvenOff,
  desiredServeTime,
  previousOvenTemp,
  currentRate,
  settings
}) {
  // 1. Estimate current meat temp (after cooling)
  const estimatedCurrentTemp = estimateMeatCooling(lastMeatTemp, minutesSinceOvenOff);
  
  // 2. Calculate temp deficit
  const tempDeficit = targetTemp - estimatedCurrentTemp;
  
  // If already at or past target, recommend restart immediately
  if (tempDeficit <= 0) {
    return {
      restartTime: new Date().toISOString(),
      restartTemp: previousOvenTemp,
      minutesUntilRestart: 0,
      shouldRestartNow: true,
      estimatedCurrentMeatTemp: estimatedCurrentTemp,
      reasoning: 'Meat is already at or past target temperature.'
    };
  }
  
  // 3. Calculate time remaining to serve time
  const now = new Date().toISOString();
  const minutesToServeTime = minutesBetween(now, desiredServeTime);
  
  // If no time left or past serve time, restart immediately at higher temp
  if (minutesToServeTime <= 0) {
    const urgentTemp = Math.min(
      previousOvenTemp + 50,
      settings.ovenTempMaxF
    );
    return {
      restartTime: now,
      restartTemp: urgentTemp,
      minutesUntilRestart: 0,
      shouldRestartNow: true,
      estimatedCurrentMeatTemp: estimatedCurrentTemp,
      reasoning: 'Past desired serve time - restart immediately at higher temperature.'
    };
  }
  
  // 4. Determine required heating rate
  const requiredRatePerHour = (tempDeficit / minutesToServeTime) * 60;
  
  // 5. Select appropriate oven temperature
  let restartTemp = previousOvenTemp;
  
  if (currentRate && currentRate > 0) {
    if (requiredRatePerHour > currentRate * 1.2) {
      // Need to heat faster - increase temp
      restartTemp = Math.min(previousOvenTemp + 25, settings.ovenTempMaxF);
    } else if (requiredRatePerHour < currentRate * 0.8) {
      // Can afford to heat slower - decrease temp
      restartTemp = Math.max(previousOvenTemp - 25, settings.ovenTempMinF);
    }
  }
  
  // 6. Estimate time needed at restart temp
  const estimatedRateAtRestartTemp = estimateHeatingRate(restartTemp, currentRate, previousOvenTemp);
  const minutesNeeded = (tempDeficit / estimatedRateAtRestartTemp) * 60;
  
  // 7. Calculate restart time
  const restartTimeMs = new Date(desiredServeTime).getTime() - minutesNeeded * 60000;
  const restartTime = new Date(restartTimeMs).toISOString();
  
  // 8. Determine if should restart now or wait
  const minutesUntilRestart = minutesBetween(now, restartTime);
  
  return {
    restartTime,
    restartTemp: Math.round(restartTemp),
    minutesUntilRestart: Math.round(minutesUntilRestart),
    shouldRestartNow: minutesUntilRestart <= 0,
    estimatedCurrentMeatTemp: estimatedCurrentTemp,
    reasoning: minutesUntilRestart > 0
      ? `Wait ${Math.round(minutesUntilRestart)} minutes to finish on time.`
      : 'Restart now to reach target by desired serve time.'
  };
}

/**
 * Calculate the recommended oven temperature adjustment
 * 
 * @param {Object} params
 * @param {number} params.currentOvenTemp - Current oven set temperature (°F)
 * @param {number} params.scheduleVarianceMinutes - Positive = late, negative = early
 * @param {'early'|'late'|'on-track'} params.scheduleStatus
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  currentOvenTemp,
  scheduleVarianceMinutes,
  scheduleStatus,
  settings,
  predictedMinutesToTarget,
  currentRate
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
      suggestedTemp: currentOvenTemp,
      changeAmount: 0,
      message: formatMessage(RECOMMENDATION_MESSAGES.HOLD, { ovenTemp: currentOvenTemp }),
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
    
    // Calculate suggested temperature
    let suggestedTemp = currentOvenTemp + changeAmount;
    
    // Apply upper bound guardrail
    if (suggestedTemp > ovenTempMaxF) {
      suggestedTemp = ovenTempMaxF;
      changeAmount = suggestedTemp - currentOvenTemp;
      
      // If already at max, can't recommend higher
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: currentOvenTemp,
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
      message: formatMessage(messageTemplate, { suggestedTemp: Math.round(suggestedTemp) }),
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
    
    // Calculate suggested temperature
    let suggestedTemp = currentOvenTemp - changeAmount;
    
    // Check practical minimum first (most ovens can't go below ~175°F/80°C)
    const practicalMinF = settings.ovenTempPracticalMinF || 175;
    const enableLowTemp = settings.enableLowTempRecommendations !== false;
    
    if (suggestedTemp < practicalMinF) {
      // Calculate optimal oven-off duration using physics-based approach
      const ovenOffMinutes = calculateOvenOffDuration(absVariance, predictedMinutesToTarget, currentRate);
      
      // Check if low temp recommendations are disabled
      if (!enableLowTemp) {
        // Suggest oven-off instead of just saying "hold steady"
        return {
          action: 'oven-off',
          suggestedTemp: currentOvenTemp,
          changeAmount: 0,
          message: RECOMMENDATION_MESSAGES.LOW_TEMP_DISABLED,
          reasoning: `Running ${Math.round(absVariance)} minutes early. Low temperature recommendations are disabled, but you can pause cooking temporarily.`,
          alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_ALTERNATIVE,
          ovenOffMinutes,
          practicalMinF: practicalMinF,
          severity: 'moderate'
        };
      }
      
      // Already at practical minimum - suggest turning oven off temporarily
      if (currentOvenTemp <= practicalMinF) {
        return {
          action: 'oven-off',
          suggestedTemp: currentOvenTemp,
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
      suggestedTemp = practicalMinF;
      changeAmount = currentOvenTemp - suggestedTemp;
      
      const messageTemplate = absVariance > 30 
        ? RECOMMENDATION_MESSAGES.LOWER_LARGE 
        : RECOMMENDATION_MESSAGES.LOWER_SMALL;
      
      return {
        action: 'lower',
        suggestedTemp: Math.round(suggestedTemp),
        changeAmount: Math.round(changeAmount),
        message: formatMessage(messageTemplate, { suggestedTemp: Math.round(suggestedTemp) }),
        reasoning: `Running approximately ${Math.round(absVariance)} minutes early. This is the practical minimum for most ovens.`,
        alternativeMessage: null,
        ovenOffMinutes: null,
        practicalMinF: null,
        severity
      };
    }
    
    // Apply food safety lower bound guardrail
    if (suggestedTemp < ovenTempMinF) {
      suggestedTemp = ovenTempMinF;
      changeAmount = currentOvenTemp - suggestedTemp;
      
      // If already at min, can't recommend lower
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: currentOvenTemp,
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
      message: formatMessage(messageTemplate, { suggestedTemp: Math.round(suggestedTemp) }),
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
 * Generate the full recommendation result including eligibility check
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {number} params.currentOvenTemp - Current oven temp in °F
 * @param {number} params.targetTemp - Target internal meat temp in °F
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target at current rate
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  currentOvenTemp,
  targetTemp,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings,
  predictedMinutesToTarget,
  currentRate
}) {
  // First check eligibility
  const eligibility = checkRecommendationEligibility({
    readings,
    ovenEvents,
    desiredServeTime,
    settings,
    confidence
  });
  
  if (!eligibility.canRecommend) {
    return {
      action: 'none',
      suggestedTemp: null,
      changeAmount: null,
      message: null,
      reasoning: null,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      restartTime: null,
      restartTemp: null,
      minutesUntilRestart: null,
      shouldRestartNow: false,
      estimatedCurrentMeatTemp: null,
      canRecommend: false,
      blockerReason: eligibility.blockerReason,
      blockerType: eligibility.blockerType,
      progress: eligibility.progress
    };
  }
  
  // Check if oven is currently off
  const lastOvenEvent = ovenEvents[ovenEvents.length - 1];
  const isOvenOff = lastOvenEvent.isOff === true;
  
  if (isOvenOff && desiredServeTime) {
    // Oven is off - calculate restart recommendation
    const lastReading = readings[readings.length - 1];
    const ovenOffTime = new Date(lastOvenEvent.timestamp);
    const minutesSinceOvenOff = minutesBetween(lastOvenEvent.timestamp, new Date().toISOString());
    
    // Find the oven temp before it was turned off
    const previousOvenTemp = lastOvenEvent.previousTemp || currentOvenTemp || 225;
    
    const restartRec = calculateOvenRestartRecommendation({
      lastMeatTemp: lastReading.temp,
      targetTemp,
      minutesSinceOvenOff,
      desiredServeTime,
      previousOvenTemp,
      currentRate,
      settings
    });
    
    return {
      action: 'oven-off',
      suggestedTemp: restartRec.restartTemp,
      changeAmount: null,
      message: restartRec.shouldRestartNow 
        ? RECOMMENDATION_MESSAGES.OVEN_RESTART_NOW
        : RECOMMENDATION_MESSAGES.OVEN_RESTART_TIMED,
      reasoning: restartRec.reasoning,
      alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_COOLING,
      ovenOffMinutes: null,
      practicalMinF: null,
      restartTime: restartRec.restartTime,
      restartTemp: restartRec.restartTemp,
      minutesUntilRestart: restartRec.minutesUntilRestart,
      shouldRestartNow: restartRec.shouldRestartNow,
      estimatedCurrentMeatTemp: restartRec.estimatedCurrentMeatTemp,
      canRecommend: true,
      blockerReason: null,
      blockerType: null,
      progress: null,
      severity: restartRec.shouldRestartNow ? 'moderate' : 'normal'
    };
  }
  
  // Calculate the normal recommendation (oven is on)
  const recommendation = calculateRecommendation({
    currentOvenTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings,
    predictedMinutesToTarget,
    currentRate
  });
  
  return {
    ...recommendation,
    restartTime: null,
    restartTemp: null,
    minutesUntilRestart: null,
    shouldRestartNow: false,
    estimatedCurrentMeatTemp: null,
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null
  };
}

/**
 * Format a message template with variable substitution
 * @param {string} template
 * @param {Object} variables
 * @returns {string}
 */
function formatMessage(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
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


