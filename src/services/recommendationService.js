import { minutesBetween } from '../utils/timeUtils.js';
import { RECOMMENDATION_MESSAGES, SETTINGS_DEFAULTS } from '../constants/defaults.js';

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
  
  if (ovenDataAge > settings.ovenTempStaleMinutes) {
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
  
  // Check confidence level
  if (confidence.level === 'insufficient') {
    return {
      canRecommend: false,
      blockerReason: confidence.reason,
      blockerType: 'insufficient_confidence',
      progress: null
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
  
  // Check for problematic rate
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
 * Calculate the recommended oven temperature adjustment
 * 
 * @param {Object} params
 * @param {number} params.currentOvenTemp - Current oven set temperature (°F)
 * @param {number} params.scheduleVarianceMinutes - Positive = late, negative = early
 * @param {'early'|'late'|'on-track'} params.scheduleStatus
 * @param {AppSettings} params.settings
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  currentOvenTemp,
  scheduleVarianceMinutes,
  scheduleStatus,
  settings
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
          message: `Already at maximum recommended temperature (${ovenTempMaxF}°F). Consider extending your timeline if possible.`,
          reasoning: `Running ${Math.round(absVariance)} minutes late, but oven is already at the upper limit for low-and-slow cooking.`,
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
    
    // Apply lower bound guardrail
    if (suggestedTemp < ovenTempMinF) {
      suggestedTemp = ovenTempMinF;
      changeAmount = currentOvenTemp - suggestedTemp;
      
      // If already at min, can't recommend lower
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: currentOvenTemp,
          changeAmount: 0,
          message: `Already at minimum recommended temperature (${ovenTempMinF}°F). You may finish early.`,
          reasoning: `Running ${Math.round(absVariance)} minutes early, but oven is already at the lower limit for food safety.`,
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
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  currentOvenTemp,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings
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
      canRecommend: false,
      blockerReason: eligibility.blockerReason,
      blockerType: eligibility.blockerType,
      progress: eligibility.progress
    };
  }
  
  // Calculate the recommendation
  const recommendation = calculateRecommendation({
    currentOvenTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings
  });
  
  return {
    ...recommendation,
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
    description: generateResponsivenessDescription(responsiveness, correlation)
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
 * Generate human-readable description of oven responsiveness
 */
function generateResponsivenessDescription(responsiveness, correlation) {
  if (correlation < 0.3) {
    return 'Oven temperature changes have had limited observable effect on heating rate so far.';
  }
  
  if (responsiveness > 0.1) {
    return `Higher oven temperatures have increased heating rate. Each +25°F oven increase has added roughly +${(responsiveness * 25).toFixed(1)}°F/hr to the heating rate.`;
  }
  
  return 'Moderate correlation between oven temperature and heating rate observed.';
}

