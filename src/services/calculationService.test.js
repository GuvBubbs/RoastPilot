import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  calculateHeatingRate,
  calculateAverageRate,
  calculateReadingSpanMinutes,
  predictTimeToTarget,
  calculateScheduleVarianceWithThreshold,
  assessConfidence,
  computeSessionCalculations,
  readingsForRateFit,
  computeLatestPullTime,
  assessPullProgress,
  APPROACHING_BAND_F,
  OVERSHOOT_BAND_F
} from './calculationService.js';

// Several suites pin the clock so that "now"-relative results are exact rather
// than a moving target; this keeps a pinned clock from leaking between tests.
afterEach(() => {
  vi.useRealTimers();
});

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
  
  it('refuses a rate under the floor, and says why', () => {
    // The floor is 2 F/hr. It was 0.1, which is about 100x too low to
    // distinguish a slow roast from a probe that has fallen out of one.
    const stalled = predictTimeToTarget(100, 125, 0.05);
    expect(stalled.minutes).toBeNull();
    expect(stalled.targetTime).toBeNull();
    expect(stalled.reason).toBe('rate-too-low');

    expect(predictTimeToTarget(100, 125, 1.9).reason).toBe('rate-too-low');
    // Just over the floor is a projection, not a refusal. Only 5 F to go here:
    // 25 F at 2.1 F/hr is 11 hours, which the horizon refuses for its own
    // reasons, and this assertion is about the floor.
    expect(predictTimeToTarget(100, 105, 2.1).minutes).toBe(143);
  });

  it('refuses a projection past the horizon rather than naming an hour', () => {
    // 155 F to climb at 0.11 F/hr - a shoulder deep in the stall with a probe
    // barely moving - used to return 55.7 DAYS, which formatTime rendered as an
    // ordinary time of day. The rate floor catches this one; the horizon catches
    // the same absurdity arrived at with a plausible rate.
    expect(predictTimeToTarget(48, 195, 0.11).minutes).toBeNull();

    // 30 F at 5 F/hr is six hours of heating still needed. A straight line
    // fitted to three readings has no business projecting that far.
    const long = predictTimeToTarget(100, 130, 5);
    expect(long.minutes).toBeNull();
    expect(long.targetTime).toBeNull();
    expect(long.reason).toBe('beyond-horizon');

    // 300 minutes exactly is inside the horizon; 301 is not.
    expect(predictTimeToTarget(0, 300, 60).minutes).toBe(300);
    expect(predictTimeToTarget(0, 301, 60).reason).toBe('beyond-horizon');
  });

  it('refuses a non-finite rate instead of throwing out of the panel', () => {
    // NaN fails every `<=` comparison, so it used to sail through the rate gate,
    // get divided into the remaining degrees, and reach addMinutes - where
    // `new Date(NaN).toISOString()` throws RangeError, taking the whole status
    // panel down rather than producing a bad number.
    for (const rate of [NaN, Infinity, -Infinity]) {
      const result = predictTimeToTarget(100, 125, rate);
      expect(result.minutes).toBeNull();
      expect(result.targetTime).toBeNull();
      expect(result.reason).toBe('no-rate');
    }

    expect(predictTimeToTarget(NaN, 125, 20).reason).toBe('no-temp');
    expect(predictTimeToTarget(100, NaN, 20).reason).toBe('no-temp');
  });
  
  it('calculates correct time for positive rate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
    
    const result = predictTimeToTarget(100, 125, 15); // 25°F to go at 15°F/hr
    expect(result.minutes).toBe(100); // 1h 40m
    expect(result.targetTime).toBe('2024-01-01T13:40:00.000Z');
  });
  
  it('projects from the supplied anchor time rather than from now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
    
    // Anchor is 30 minutes stale: the meat has already been climbing for those
    // 30 minutes, so the target lands 30 minutes earlier than a now-anchored
    // projection would claim.
    const result = predictTimeToTarget(100, 125, 15, '2024-01-01T11:30:00.000Z');
    expect(result.minutes).toBe(100);
    expect(result.targetTime).toBe('2024-01-01T13:10:00.000Z');
  });
  
  it('reports the countdown from now separately from the heating time needed', () => {
    const result = predictTimeToTarget(
      100,
      125,
      15,
      '2024-01-01T11:30:00.000Z', // anchor
      '2024-01-01T12:00:00.000Z'  // now
    );
    expect(result.minutes).toBe(100); // heating still needed from the anchor
    expect(result.minutesFromNow).toBe(70); // 30 of those minutes already elapsed
  });
  
  it('returns the anchor as the target time when already past target', () => {
    const result = predictTimeToTarget(130, 125, 5, '2024-01-01T11:30:00.000Z');
    expect(result.minutes).toBe(0);
    expect(result.minutesFromNow).toBe(0);
    expect(result.targetTime).toBe('2024-01-01T11:30:00.000Z');
  });
  
  it('returns a null countdown alongside a null prediction', () => {
    const result = predictTimeToTarget(100, 125, 0);
    expect(result.minutesFromNow).toBeNull();
  });
  
  it('rounds minutes to nearest integer', () => {
    const result = predictTimeToTarget(100, 123, 7); // 23°F to go at 7°F/hr
    expect(result.minutes).toBe(197); // 23/7*60 = 197.14
  });
});

describe('readingsForRateFit', () => {
  /**
   * A pause is not a slow patch of the same cook, it is a different experiment.
   * This service had no oven-off coverage at all, which is how a rate fit that
   * averaged a 40 minute pause into the heating rate went unnoticed - it
   * reported 4.5 F/hr against a true 10.
   */
  const readings = [
    { temp: 100, timestamp: '2024-01-01T12:00:00.000Z' }, // before the pause
    { temp: 106, timestamp: '2024-01-01T12:30:00.000Z' }, // before the pause
    { temp: 107, timestamp: '2024-01-01T13:30:00.000Z' }, // during the pause
    { temp: 113, timestamp: '2024-01-01T14:00:00.000Z' }, // after the restart
    { temp: 119, timestamp: '2024-01-01T14:30:00.000Z' }  // after the restart
  ];

  const on = (iso, setTemp = 200) => ({ setTemp, isOff: false, timestamp: iso });
  const off = (iso) => ({ setTemp: 0, isOff: true, timestamp: iso });

  it('returns everything when the oven never went off', () => {
    expect(readingsForRateFit(readings, [on('2024-01-01T11:00:00.000Z')]))
      .toEqual(readings);
    expect(readingsForRateFit(readings, [])).toEqual(readings);
    expect(readingsForRateFit(readings)).toEqual(readings);
  });

  it('keeps only the readings since the restart', () => {
    const events = [
      on('2024-01-01T11:00:00.000Z'),
      off('2024-01-01T13:00:00.000Z'),
      on('2024-01-01T13:45:00.000Z')
    ];
    expect(readingsForRateFit(readings, events).map(r => r.temp)).toEqual([113, 119]);
  });

  it('keeps only the readings since the pause began while the oven is still off', () => {
    // Measuring cooling is the truth about what is happening now, and it is a
    // different truth from the heating that preceded it.
    const events = [on('2024-01-01T11:00:00.000Z'), off('2024-01-01T13:00:00.000Z')];
    expect(readingsForRateFit(readings, events).map(r => r.temp)).toEqual([107, 113, 119]);
  });

  it('uses the most recent pause when there have been several', () => {
    const events = [
      on('2024-01-01T11:00:00.000Z'),
      off('2024-01-01T12:10:00.000Z'),
      on('2024-01-01T12:20:00.000Z'),
      off('2024-01-01T13:00:00.000Z'),
      on('2024-01-01T13:45:00.000Z')
    ];
    expect(readingsForRateFit(readings, events).map(r => r.temp)).toEqual([113, 119]);
  });

  it('may legitimately leave too few readings to fit', () => {
    // Immediately after a restart the app has not measured the new state, and
    // saying so beats reporting a rate that belongs to the previous one.
    const events = [
      on('2024-01-01T11:00:00.000Z'),
      off('2024-01-01T13:00:00.000Z'),
      on('2024-01-01T14:15:00.000Z')
    ];
    const kept = readingsForRateFit(readings, events);
    expect(kept.map(r => r.temp)).toEqual([119]);
    expect(calculateHeatingRate(kept).rate).toBeNull();
  });
});

describe('the rate fit does not span a pause', () => {
  it('reports the post-restart rate, not one averaged across the pause', () => {
    // The measured case, reproduced: five readings, window of 5, with a flat
    // 40 minute pause in the middle of the window.
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00.000Z' },
      { temp: 105, timestamp: '2024-01-01T12:30:00.000Z' },
      { temp: 105, timestamp: '2024-01-01T13:10:00.000Z' },
      { temp: 110, timestamp: '2024-01-01T13:40:00.000Z' },
      { temp: 115, timestamp: '2024-01-01T14:10:00.000Z' }
    ];
    const ovenEvents = [
      { setTemp: 200, isOff: false, timestamp: '2024-01-01T11:00:00.000Z' },
      { setTemp: 0, isOff: true, timestamp: '2024-01-01T12:30:00.000Z' },
      { setTemp: 200, isOff: false, timestamp: '2024-01-01T13:10:00.000Z' }
    ];
    const wide = { smoothingWindowReadings: 5, onTrackThresholdMinutes: 10 };

    const straddling = computeSessionCalculations({
      readings, pullTempF: 125, desiredServeTime: null, settings: wide,
      now: '2024-01-01T14:10:00.000Z'
    });
    const segmented = computeSessionCalculations({
      readings, ovenEvents, pullTempF: 125, desiredServeTime: null, settings: wide,
      now: '2024-01-01T14:10:00.000Z'
    });

    // The pause drags the fitted slope well below the rate the roast is actually
    // climbing at either side of it.
    expect(straddling.currentRate).toBeLessThan(8);
    // Confined to the post-restart segment, 105 -> 110 -> 115 over 60 minutes.
    expect(segmented.currentRate).toBeCloseTo(10, 1);
  });
});

describe('assessPullProgress', () => {
  /**
   * The graded verdict, which replaced FOUR separate implementations of "is it
   * done yet" - here, in useCalculations, in the recommendation service's short
   * circuit, and in TemperatureChart. The chart's compared DISPLAY units, which
   * round to 0.1 °C, so on a Celsius session it could reach a different answer
   * than the advice band about the same roast on the same screen.
   */
  it('grades the four states', () => {
    expect(assessPullProgress(80, 125).state).toBe('heating');
    expect(assessPullProgress(120, 125).state).toBe('approaching');
    expect(assessPullProgress(125, 125).state).toBe('at-pull');
    expect(assessPullProgress(128, 125).state).toBe('at-pull');
    expect(assessPullProgress(140, 125).state).toBe('over');
  });

  it('puts the boundaries where the bands say', () => {
    expect(assessPullProgress(125 - APPROACHING_BAND_F, 125).state).toBe('approaching');
    expect(assessPullProgress(125 - APPROACHING_BAND_F - 1, 125).state).toBe('heating');
    expect(assessPullProgress(125 + OVERSHOOT_BAND_F, 125).state).toBe('at-pull');
    expect(assessPullProgress(125 + OVERSHOOT_BAND_F + 1, 125).state).toBe('over');
  });

  it('reports the distance in both directions', () => {
    expect(assessPullProgress(118, 125).degreesToPull).toBe(7);
    expect(assessPullProgress(118, 125).degreesOver).toBeNull();
    expect(assessPullProgress(140, 125).degreesOver).toBe(15);
  });

  it('leaves the progress fraction UNCLAMPED', () => {
    // The clamp belongs to the ARIA value and the rail width, which cannot
    // render past 100%. A logic path reading a clamped progress cannot tell
    // "just done" from "30 °F past done", which is the whole distinction the
    // graded verdict exists to make.
    expect(assessPullProgress(125, 125, 45).progressPercent).toBeCloseTo(100, 5);
    expect(assessPullProgress(165, 125, 45).progressPercent).toBeGreaterThan(100);
    expect(assessPullProgress(45, 125, 45).progressPercent).toBe(0);
  });

  it('has no progress fraction without a start temperature', () => {
    expect(assessPullProgress(100, 125).progressPercent).toBeNull();
    // Nor when the target is at or below the start, which would divide by zero
    // or invert.
    expect(assessPullProgress(100, 45, 45).progressPercent).toBeNull();
    expect(assessPullProgress(100, 40, 45).progressPercent).toBeNull();
  });

  it('is inert on missing numbers rather than reporting a false verdict', () => {
    for (const [current, pull] of [[null, 125], [100, null], [NaN, 125], [100, NaN]]) {
      const result = assessPullProgress(current, pull);
      expect(result.state).toBe('heating');
      expect(result.degreesToPull).toBeNull();
    }
  });

  it('gives the same verdict whatever unit the caller thinks in', () => {
    // The Celsius disagreement, as a property. Both sides in °F, always.
    const cToF = (c) => c * 9 / 5 + 32;
    for (const coreC of [50, 51, 51.6, 51.7, 52, 60]) {
      const fromF = assessPullProgress(cToF(coreC), cToF(51.7));
      // Rounding the same pair to 0.1 °C and comparing there is what the chart
      // used to do; the verdict must not depend on it.
      const roundedC = Math.round(coreC * 10) / 10;
      const fromRounded = assessPullProgress(cToF(roundedC), cToF(51.7));
      expect(fromF.state).toBe(fromRounded.state);
    }
  });
});

describe('computeLatestPullTime', () => {
  it('subtracts the rest from the serve time', () => {
    // Rest was never subtracted anywhere. The projection aimed at the target
    // temperature and the schedule was compared straight against the serve time,
    // so a roast needing 30 minutes on the board was called "on track" to come
    // out of the oven at the moment dinner was meant to be on the table.
    expect(computeLatestPullTime('2024-01-01T19:00:00.000Z', 30))
      .toBe('2024-01-01T18:30:00.000Z');
  });

  it('is the serve time itself when there is no rest', () => {
    expect(computeLatestPullTime('2024-01-01T19:00:00.000Z', 0))
      .toBe('2024-01-01T19:00:00.000Z');
    expect(computeLatestPullTime('2024-01-01T19:00:00.000Z'))
      .toBe('2024-01-01T19:00:00.000Z');
  });

  it('has nothing to compute without a serve time', () => {
    expect(computeLatestPullTime(null, 30)).toBeNull();
    expect(computeLatestPullTime(undefined, 30)).toBeNull();
  });

  it('ignores a nonsensical rest rather than moving the deadline the wrong way', () => {
    expect(computeLatestPullTime('2024-01-01T19:00:00.000Z', -30))
      .toBe('2024-01-01T19:00:00.000Z');
    expect(computeLatestPullTime('2024-01-01T19:00:00.000Z', NaN))
      .toBe('2024-01-01T19:00:00.000Z');
  });

  it('moves the schedule verdict by exactly the rest', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00.000Z' },
      { temp: 110, timestamp: '2024-01-01T12:30:00.000Z' },
      { temp: 120, timestamp: '2024-01-01T13:00:00.000Z' }
    ];
    const settings = { smoothingWindowReadings: 3, onTrackThresholdMinutes: 10 };
    const common = {
      readings, pullTempF: 125,
      // Rate is 20 F/hr, 5 F to go, so the pull lands at 13:15.
      desiredServeTime: '2024-01-01T13:15:00.000Z',
      settings, now: '2024-01-01T13:00:00.000Z'
    };

    const noRest = computeSessionCalculations(common);
    expect(noRest.predictedTargetTime).toBe('2024-01-01T13:15:00.000Z');
    expect(noRest.scheduleVarianceMinutes).toBe(0);
    expect(noRest.scheduleStatus).toBe('on-track');

    // With 30 minutes of rest the meat had to be out at 12:45, so the same
    // projection is half an hour LATE and the app can say so.
    const rested = computeSessionCalculations({ ...common, restMinutes: 30 });
    expect(rested.latestPullTime).toBe('2024-01-01T12:45:00.000Z');
    expect(rested.scheduleVarianceMinutes).toBe(30);
    expect(rested.scheduleStatus).toBe('late');
  });
});

describe('calculateScheduleVarianceWithThreshold', () => {
  it('returns unknown status when times are null', () => {
    const result = calculateScheduleVarianceWithThreshold(null, '2024-01-01T15:00:00Z', 10);
    expect(result.status).toBe('unknown');
    expect(result.varianceMinutes).toBeNull();
  });
  
  it('identifies early status correctly', () => {
    const result = calculateScheduleVarianceWithThreshold(
      '2024-01-01T14:30:00Z', // Predicted: 2:30 PM
      '2024-01-01T15:00:00Z', // Desired: 3:00 PM (30 min early)
      10
    );
    expect(result.status).toBe('early');
    expect(result.varianceMinutes).toBe(-30);
  });
  
  it('identifies late status correctly', () => {
    const result = calculateScheduleVarianceWithThreshold(
      '2024-01-01T15:30:00Z', // Predicted: 3:30 PM
      '2024-01-01T15:00:00Z', // Desired: 3:00 PM (30 min late)
      10
    );
    expect(result.status).toBe('late');
    expect(result.varianceMinutes).toBe(30);
  });
  
  it('identifies on-track status within threshold', () => {
    const result = calculateScheduleVarianceWithThreshold(
      '2024-01-01T15:05:00Z', // Predicted: 3:05 PM
      '2024-01-01T15:00:00Z', // Desired: 3:00 PM (5 min late, within threshold)
      10
    );
    expect(result.status).toBe('on-track');
    expect(result.varianceMinutes).toBe(5);
  });
  
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
  
  it('caps confidence at medium when the fit spans fewer than 3 readings', () => {
    const result = assessConfidence({
      readingCount: 6,
      timeSpanMinutes: 120,
      r2: 1, // A 2-point fit is perfect by construction, so R² proves nothing
      rate: 5,
      fitReadings: 2
    });
    expect(result.level).toBe('medium');
    expect(result.reason).toContain('only 2 readings');
  });
  
  it('still reports low confidence for a thin fit over poor data', () => {
    const result = assessConfidence({
      readingCount: 6,
      timeSpanMinutes: 5,
      r2: 1,
      rate: 5,
      fitReadings: 2
    });
    expect(result.level).toBe('low');
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
      pullTempF: 125,
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
      pullTempF: 125,
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
      pullTempF: 125,
      desiredServeTime: '2024-01-01T16:00:00Z', // 1 hour after last reading
      settings: defaultSettings
    });
    
    // Current temp is 115, target is 125, rate is 5°F/hr
    // Time to target: (125-115)/5 = 2 hours from 15:00 = 17:00
    // Desired: 16:00, Predicted: 17:00 -> Running late by 1 hour
    expect(result.scheduleStatus).toBe('late');
    expect(result.scheduleVarianceMinutes).toBeGreaterThan(0); // Positive variance = running late
  });
  
  it('anchors the ETA to the last reading rather than to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    
    // 100/105/110°F at 90/60/30 minutes ago fits 10°F/hr. The remaining 15°F is
    // 90 more minutes of heating measured from the last reading, which was 30
    // minutes ago - so the target lands 60 minutes from now, not 90.
    const readings = [
      { temp: 100, timestamp: '2024-06-01T10:30:00.000Z' },
      { temp: 105, timestamp: '2024-06-01T11:00:00.000Z' },
      { temp: 110, timestamp: '2024-06-01T11:30:00.000Z' }
    ];
    
    const result = computeSessionCalculations({
      readings,
      pullTempF: 125,
      desiredServeTime: '2024-06-01T14:30:00.000Z', // now + 150 minutes
      settings: defaultSettings
    });
    
    expect(result.currentRate).toBe(10);
    expect(result.predictedMinutesToTarget).toBe(90);
    expect(result.predictedMinutesFromNow).toBe(60);
    expect(result.predictedTargetTime).toBe('2024-06-01T13:00:00.000Z');
    expect(result.scheduleStatus).toBe('early');
    expect(result.scheduleVarianceMinutes).toBe(-90);
  });
  
  it('accepts an explicit now so the countdown is not read from the clock', () => {
    const readings = [
      { temp: 100, timestamp: '2024-06-01T10:30:00.000Z' },
      { temp: 105, timestamp: '2024-06-01T11:00:00.000Z' },
      { temp: 110, timestamp: '2024-06-01T11:30:00.000Z' }
    ];
    
    const result = computeSessionCalculations({
      readings,
      pullTempF: 125,
      desiredServeTime: null,
      settings: defaultSettings,
      now: '2024-06-01T12:45:00.000Z'
    });
    
    expect(result.predictedTargetTime).toBe('2024-06-01T13:00:00.000Z');
    expect(result.predictedMinutesFromNow).toBe(15);
  });
  
  it('does not report high confidence when the window fits only 2 readings', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' },
      { temp: 115, timestamp: '2024-01-01T15:00:00Z' },
      { temp: 120, timestamp: '2024-01-01T16:00:00Z' }
    ];
    
    const result = computeSessionCalculations({
      readings,
      pullTempF: 125,
      desiredServeTime: null,
      settings: { ...defaultSettings, smoothingWindowReadings: 2 },
      now: '2024-01-01T16:00:00Z'
    });
    
    // Plenty of readings and a flawless fit, but only 2 points went into it
    expect(result.confidence.level).toBe('medium');
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
      pullTempF: 125,
      desiredServeTime: null,
      settings: customSettings
    });
    
    // Last 2 readings: 110->116 in 1 hour = 6°F/hr
    expect(result.currentRate).toBe(6);
  });
});

