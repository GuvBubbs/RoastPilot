import { minutesBetween } from '../utils/timeUtils.js';
import { RECOMMENDATION_MESSAGES } from '../constants/defaults.js';

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
    latestReadingTemp: null,
    severity: 'normal',
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null,
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
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  ovenBaseTemp,
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
    
    // Calculate suggested temperature
    let suggestedTemp = ovenBaseTemp + changeAmount;
    
    // Apply upper bound guardrail
    if (suggestedTemp > ovenTempMaxF) {
      suggestedTemp = ovenTempMaxF;
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
    
    // Calculate suggested temperature
    let suggestedTemp = ovenBaseTemp - changeAmount;
    
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
          suggestedTemp: ovenBaseTemp,
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
      if (ovenBaseTemp <= practicalMinF) {
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
      suggestedTemp = practicalMinF;
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
      suggestedTemp = ovenTempMinF;
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
  
  // Normal recommendation - from the latest reading, whether or not the oven is
  // currently off (a post-pause reading is guaranteed by the branch above).
  const recommendation = calculateRecommendation({
    ovenBaseTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings,
    predictedMinutesToTarget,
    currentRate
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




