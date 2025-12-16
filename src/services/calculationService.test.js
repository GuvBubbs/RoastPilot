import { describe, it, expect } from 'vitest';
import {
  calculateHeatingRate,
  calculateAverageRate,
  calculateReadingSpanMinutes,
  predictTimeToTarget,
  calculateScheduleVariance,
  calculateScheduleVarianceWithThreshold,
  assessConfidence,
  computeSessionCalculations
} from './calculationService.js';

describe('calculateHeatingRate', () => {
  it('returns null when fewer than 2 readings provided', () => {
    const result = calculateHeatingRate([]);
    expect(result.rate).toBeNull();
    expect(result.readings).toBe(0);
    
    const result2 = calculateHeatingRate([{ temp: 100, timestamp: '2024-01-01T12:00:00Z' }]);
    expect(result2.rate).toBeNull();
    expect(result2.readings).toBe(1);
  });
  
  it('calculates correct rate for linear temperature increase', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' }
    ];
    
    const result = calculateHeatingRate(readings);
    expect(result.rate).toBe(5); // 5°F per hour
    expect(result.r2).toBeCloseTo(1, 2); // Perfect linear fit
    expect(result.readings).toBe(3);
  });
  
  it('handles readings taken at same time gracefully', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T12:00:00Z' }
    ];
    
    const result = calculateHeatingRate(readings);
    expect(result.rate).toBeNull();
  });
  
  it('uses only the most recent N readings based on window size', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 102, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 104, timestamp: '2024-01-01T14:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T15:00:00Z' }, // Sudden jump
      { temp: 116, timestamp: '2024-01-01T16:00:00Z' }
    ];
    
    // With window of 3, should use last 3 readings (rate of 6°F/hr)
    const result = calculateHeatingRate(readings, 3);
    expect(result.rate).toBeCloseTo(6, 1);
  });
  
  it('handles negative heating rate (cooling)', () => {
    const readings = [
      { temp: 120, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 115, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' }
    ];
    
    const result = calculateHeatingRate(readings);
    expect(result.rate).toBe(-5); // -5°F per hour
  });
});

describe('calculateAverageRate', () => {
  it('returns null for fewer than 2 readings', () => {
    expect(calculateAverageRate([])).toBeNull();
    expect(calculateAverageRate([{ temp: 100, timestamp: '2024-01-01T12:00:00Z' }])).toBeNull();
  });
  
  it('calculates correct average rate across entire session', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 115, timestamp: '2024-01-01T14:00:00Z' } // Average: 15°F over 2 hours = 7.5°F/hr
    ];
    
    const result = calculateAverageRate(readings);
    expect(result).toBe(7.5);
  });
  
  it('handles readings taken very close together', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00.000Z' },
      { temp: 100.5, timestamp: '2024-01-01T12:00:01.000Z' } // 1 second apart
    ];
    
    const result = calculateAverageRate(readings);
    expect(result).toBeNull(); // Too short time span
  });
});

describe('calculateReadingSpanMinutes', () => {
  it('returns 0 for fewer than 2 readings', () => {
    expect(calculateReadingSpanMinutes([])).toBe(0);
    expect(calculateReadingSpanMinutes([{ temp: 100, timestamp: '2024-01-01T12:00:00Z' }])).toBe(0);
  });
  
  it('calculates correct span in minutes', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T12:30:00Z' },
      { temp: 110, timestamp: '2024-01-01T13:00:00Z' }
    ];
    
    const span = calculateReadingSpanMinutes(readings);
    expect(span).toBe(60); // 1 hour = 60 minutes
  });
});

describe('predictTimeToTarget', () => {
  it('returns 0 minutes when target already reached', () => {
    const result = predictTimeToTarget(130, 125, 5);
    expect(result.minutes).toBe(0);
    expect(result.targetTime).toBeTruthy();
  });
  
  it('returns null when rate is zero or negative', () => {
    const result = predictTimeToTarget(100, 125, 0);
    expect(result.minutes).toBeNull();
    expect(result.targetTime).toBeNull();
    
    const result2 = predictTimeToTarget(100, 125, -2);
    expect(result2.minutes).toBeNull();
    expect(result2.targetTime).toBeNull();
  });
  
  it('returns null when rate is too low (below threshold)', () => {
    const result = predictTimeToTarget(100, 125, 0.05); // Below MIN_RATE_FOR_PREDICTION (0.1)
    expect(result.minutes).toBeNull();
    expect(result.targetTime).toBeNull();
  });
  
  it('calculates correct time for positive rate', () => {
    const result = predictTimeToTarget(100, 125, 5); // 25°F to go at 5°F/hr
    expect(result.minutes).toBe(300); // 5 hours = 300 minutes
    expect(result.targetTime).toBeTruthy();
  });
  
  it('rounds minutes to nearest integer', () => {
    const result = predictTimeToTarget(100, 123, 5); // 23°F to go at 5°F/hr = 4.6 hours
    expect(result.minutes).toBe(276); // 4.6 * 60 = 276 minutes
  });
});

describe('calculateScheduleVariance', () => {
  it('returns unknown status when times are null', () => {
    const result = calculateScheduleVariance(null, '2024-01-01T15:00:00Z');
    expect(result.status).toBe('unknown');
    expect(result.varianceMinutes).toBeNull();
  });
  
  it('identifies early status correctly', () => {
    const result = calculateScheduleVariance(
      '2024-01-01T14:30:00Z', // Predicted: 2:30 PM
      '2024-01-01T15:00:00Z'  // Desired: 3:00 PM (30 min late)
    );
    expect(result.status).toBe('early');
    expect(result.varianceMinutes).toBe(-30);
  });
  
  it('identifies late status correctly', () => {
    const result = calculateScheduleVariance(
      '2024-01-01T15:30:00Z', // Predicted: 3:30 PM
      '2024-01-01T15:00:00Z'  // Desired: 3:00 PM (30 min late)
    );
    expect(result.status).toBe('late');
    expect(result.varianceMinutes).toBe(30);
  });
  
  it('identifies on-track status within threshold', () => {
    const result = calculateScheduleVariance(
      '2024-01-01T15:05:00Z', // Predicted: 3:05 PM
      '2024-01-01T15:00:00Z'  // Desired: 3:00 PM (5 min late, within 10 min threshold)
    );
    expect(result.status).toBe('on-track');
    expect(result.varianceMinutes).toBe(5);
  });
});

describe('calculateScheduleVarianceWithThreshold', () => {
  it('uses custom threshold correctly', () => {
    const predicted = '2024-01-01T15:20:00Z';
    const desired = '2024-01-01T15:00:00Z';
    
    // With 10 min threshold, 20 min variance is late
    const result1 = calculateScheduleVarianceWithThreshold(predicted, desired, 10);
    expect(result1.status).toBe('late');
    
    // With 30 min threshold, 20 min variance is on-track
    const result2 = calculateScheduleVarianceWithThreshold(predicted, desired, 30);
    expect(result2.status).toBe('on-track');
  });
});

describe('assessConfidence', () => {
  it('returns insufficient when fewer than 2 readings', () => {
    const result = assessConfidence({ 
      readingCount: 1, 
      timeSpanMinutes: 0, 
      r2: 0, 
      rate: null 
    });
    expect(result.level).toBe('insufficient');
    expect(result.reason).toContain('at least 2 readings');
  });
  
  it('returns low confidence with only 2 readings', () => {
    const result = assessConfidence({ 
      readingCount: 2, 
      timeSpanMinutes: 30, 
      r2: 0.95, 
      rate: 5 
    });
    expect(result.level).toBe('low');
    expect(result.reason).toContain('2 readings');
  });
  
  it('returns low confidence for very slow or negative rate', () => {
    const result = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 60, 
      r2: 0.95, 
      rate: 0.05 // Below MIN_RATE_FOR_PREDICTION
    });
    expect(result.level).toBe('low');
    expect(result.reason).toContain('slow or negative');
  });
  
  it('returns low confidence for short time span', () => {
    const result = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 10, // Less than 15 minutes
      r2: 0.95, 
      rate: 5 
    });
    expect(result.level).toBe('low');
    expect(result.reason).toContain('less than 15 minutes');
  });
  
  it('returns low confidence for poor R² fit', () => {
    const result = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 60, 
      r2: 0.5, // Below 0.7 threshold
      rate: 5 
    });
    expect(result.level).toBe('low');
    expect(result.reason).toContain('fluctuating');
  });
  
  it('returns medium confidence for moderate R²', () => {
    const result = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 60, 
      r2: 0.85, // Between 0.7 and 0.9
      rate: 5 
    });
    expect(result.level).toBe('medium');
  });
  
  it('returns high confidence for ideal conditions', () => {
    const result = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 60, 
      r2: 0.95, 
      rate: 5 
    });
    expect(result.level).toBe('high');
    expect(result.reason).toContain('Strong data quality');
  });
  
  it('requires both count and time for high confidence', () => {
    // Good R² but not enough readings
    const result1 = assessConfidence({ 
      readingCount: 3, 
      timeSpanMinutes: 60, 
      r2: 0.95, 
      rate: 5 
    });
    expect(result1.level).not.toBe('high');
    
    // Good R² but not enough time
    const result2 = assessConfidence({ 
      readingCount: 5, 
      timeSpanMinutes: 20, 
      r2: 0.95, 
      rate: 5 
    });
    expect(result2.level).not.toBe('high');
  });
});

describe('computeSessionCalculations', () => {
  const defaultSettings = {
    smoothingWindowReadings: 3,
    onTrackThresholdMinutes: 10
  };
  
  it('handles empty readings gracefully', () => {
    const result = computeSessionCalculations({
      readings: [],
      targetTemp: 125,
      desiredServeTime: null,
      settings: defaultSettings
    });
    
    expect(result.currentRate).toBeNull();
    expect(result.averageRate).toBeNull();
    expect(result.predictedMinutesToTarget).toBeNull();
    expect(result.predictedTargetTime).toBeNull();
    expect(result.scheduleStatus).toBe('unknown');
    expect(result.confidence.level).toBe('insufficient');
  });
  
  it('computes all values with sufficient data', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' },
      { temp: 115, timestamp: '2024-01-01T15:00:00Z' }
    ];
    
    const result = computeSessionCalculations({
      readings,
      targetTemp: 125,
      desiredServeTime: null,
      settings: defaultSettings
    });
    
    expect(result.currentRate).toBe(5); // 5°F/hr
    expect(result.averageRate).toBe(5); // Also 5°F/hr for linear data
    expect(result.predictedMinutesToTarget).toBe(120); // 10°F at 5°F/hr = 2 hours
    expect(result.predictedTargetTime).toBeTruthy();
    expect(result.confidence.level).toBe('high'); // 4 readings, 180 min span, perfect fit
  });
  
  it('calculates schedule variance when serve time is set', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' },
      { temp: 115, timestamp: '2024-01-01T15:00:00Z' }
    ];
    
    const result = computeSessionCalculations({
      readings,
      targetTemp: 125,
      desiredServeTime: '2024-01-01T16:00:00Z', // 1 hour after last reading
      settings: defaultSettings
    });
    
    // Current temp is 115, target is 125, rate is 5°F/hr
    // Time to target: (125-115)/5 = 2 hours from 15:00 = 17:00
    // Desired: 16:00, Predicted: 17:00 -> Running late by 1 hour
    expect(result.scheduleStatus).toBe('late');
    expect(result.scheduleVarianceMinutes).toBeGreaterThan(0); // Positive variance = running late
  });
  
  it('uses configured smoothing window', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 102, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 104, timestamp: '2024-01-01T14:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T15:00:00Z' }, // Sudden jump
      { temp: 116, timestamp: '2024-01-01T16:00:00Z' }
    ];
    
    const customSettings = {
      ...defaultSettings,
      smoothingWindowReadings: 2 // Use only last 2 readings
    };
    
    const result = computeSessionCalculations({
      readings,
      targetTemp: 125,
      desiredServeTime: null,
      settings: customSettings
    });
    
    // Last 2 readings: 110->116 in 1 hour = 6°F/hr
    expect(result.currentRate).toBe(6);
  });
});

