import { hoursBetween, minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { CALCULATION_THRESHOLDS } from '../constants/defaults.js';

/**
 * Calculate the heating rate from a set of readings using linear regression
 * Returns rate in degrees Fahrenheit per hour
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
  
  return {
    rate: Math.round(slope * 100) / 100, // °F per hour, 2 decimal places
    r2: Math.round(r2 * 1000) / 1000,
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
 * @param {number} currentTemp - Current internal temperature (°F)
 * @param {number} targetTemp - Target temperature (°F)
 * @param {number} rate - Heating rate (°F/hour)
 * @returns {{minutes: number|null, targetTime: string|null}}
 */
export function predictTimeToTarget(currentTemp, targetTemp, rate) {
  if (rate === null || rate <= CALCULATION_THRESHOLDS.MIN_RATE_FOR_PREDICTION) {
    return { minutes: null, targetTime: null };
  }
  
  const tempRemaining = targetTemp - currentTemp;
  
  if (tempRemaining <= 0) {
    // Already at or past target
    return { minutes: 0, targetTime: new Date().toISOString() };
  }
  
  const hoursRemaining = tempRemaining / rate;
  const minutesRemaining = Math.round(hoursRemaining * 60);
  const targetTime = addMinutes(new Date().toISOString(), minutesRemaining);
  
  return {
    minutes: minutesRemaining,
    targetTime
  };
}

/**
 * Calculate schedule variance (how early or late vs desired serve time)
 * 
 * @param {string} predictedTargetTime - ISO timestamp of predicted completion
 * @param {string} desiredServeTime - ISO timestamp of desired completion
 * @returns {{varianceMinutes: number, status: 'early'|'late'|'on-track'}}
 */
export function calculateScheduleVariance(predictedTargetTime, desiredServeTime) {
  if (!predictedTargetTime || !desiredServeTime) {
    return { varianceMinutes: null, status: 'unknown' };
  }
  
  const variance = minutesBetween(desiredServeTime, predictedTargetTime);
  
  // Default threshold is 10 minutes
  const threshold = 10;
  
  let status;
  if (variance < -threshold) {
    status = 'early';
  } else if (variance > threshold) {
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
 * @returns {{level: 'high'|'medium'|'low'|'insufficient', reason: string}}
 */
export function assessConfidence({ readingCount, timeSpanMinutes, r2, rate }) {
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
 * Compute all calculations for the current session state
 * This is the main entry point that combines all calculation functions
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {number} params.targetTemp
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @returns {CalculationResult}
 */
export function computeSessionCalculations({ readings, targetTemp, desiredServeTime, settings }) {
  // Handle empty or insufficient readings
  if (readings.length === 0) {
    return {
      currentRate: null,
      averageRate: null,
      predictedMinutesToTarget: null,
      predictedTargetTime: null,
      scheduleVarianceMinutes: null,
      scheduleStatus: 'unknown',
      confidence: { level: 'insufficient', reason: 'No readings recorded yet' }
    };
  }
  
  const currentTemp = readings[readings.length - 1].temp;
  const timeSpan = calculateReadingSpanMinutes(readings);
  
  // Calculate rates
  const rateResult = calculateHeatingRate(readings, settings.smoothingWindowReadings);
  const averageRate = calculateAverageRate(readings);
  
  // Assess confidence
  const confidence = assessConfidence({
    readingCount: readings.length,
    timeSpanMinutes: timeSpan,
    r2: rateResult.r2,
    rate: rateResult.rate
  });
  
  // Predict time to target
  const prediction = predictTimeToTarget(currentTemp, targetTemp, rateResult.rate);
  
  // Calculate schedule variance if serve time is set
  let scheduleVariance = { varianceMinutes: null, status: 'unknown' };
  if (desiredServeTime && prediction.targetTime) {
    scheduleVariance = calculateScheduleVarianceWithThreshold(
      prediction.targetTime,
      desiredServeTime,
      settings.onTrackThresholdMinutes
    );
  }
  
  return {
    currentRate: rateResult.rate,
    averageRate,
    predictedMinutesToTarget: prediction.minutes,
    predictedTargetTime: prediction.targetTime,
    scheduleVarianceMinutes: scheduleVariance.varianceMinutes,
    scheduleStatus: scheduleVariance.status,
    confidence
  };
}


