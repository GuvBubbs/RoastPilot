import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  calculateHeatingRate,
  calculateAverageRate,
  calculateReadingSpanMinutes,
  predictTimeToTarget,
  calculateScheduleVarianceWithThreshold,
  computeSessionCalculations,
  computeLatestPullTime,
  assessPullProgress,
  APPROACHING_BAND_F,
  OVERSHOOT_BAND_F
} from './calculationService.js';
import { advance, assessDeadTimeGate } from './thermalModel.js';
import { minutesBetween } from '../utils/timeUtils.js';

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
    // ordinary time of day. The rate floor catches this one.
    expect(predictTimeToTarget(48, 195, 0.11).minutes).toBeNull();

    // The horizon is now a backstop against arithmetic absurdity rather than a
    // tight cap: the CURVE has `unreachable` for the case a tight cap was
    // defending against, and at 300 minutes the app refused to speak for 90 % of
    // an eleven-hour shoulder. A day is the bound; no domestic roast exceeds it.
    const day = 24 * 60;
    expect(predictTimeToTarget(0, day, 60).minutes).toBe(day);
    expect(predictTimeToTarget(0, day + 1, 60).reason).toBe('beyond-horizon');

    // Eleven hours of heating still needed is a real overnight shoulder, and it
    // must NOT be refused.
    expect(predictTimeToTarget(40, 195, 14).minutes).toBeGreaterThan(600);
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

  it('shifts the deadline by exactly the rest, whatever the projection says', () => {
    // The pure arithmetic. The end-to-end version - that the schedule VERDICT
    // moves with it - is in computeSessionCalculations, against a curved cook.
    const serve = '2024-01-01T19:00:00.000Z';
    for (const rest of [0, 15, 20, 30, 45]) {
      const pull = computeLatestPullTime(serve, rest);
      expect(minutesBetween(pull, serve), `${rest} min rest`).toBe(rest);
    }
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


describe('computeSessionCalculations', () => {
  /**
   * WHAT THESE TESTS ARE AND ARE NOT.
   *
   * The fixtures below are generated by the app's own thermal model, so nothing
   * here can tell you the PHYSICS is right - that would be fitting a model to its
   * own output and calling the agreement evidence, which is exactly the
   * circularity the old suite had (every projection fixture fitted a straight
   * line to straight-line data, so no test would have failed if the model were
   * replaced with any other internally consistent wrong one).
   *
   * What these tests cover is the PLUMBING and the POLICY: which timestamp the
   * projection is anchored to, that a refusal refuses rather than degrading to a
   * worse answer, that the gate holds, that the oven-off case says something
   * useful. The physics is checked against an independent engine in
   * tools/oracle - a 1-D radial conduction solve, a different model family
   * entirely - and against the one real exported cook in
   * tools/sim/calibrate.test.js.
   */
  const defaultSettings = { onTrackThresholdMinutes: 10 };

  const BASE = Date.parse('2026-08-22T18:00:00.000Z');
  const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();

  /**
   * A plausible cook, generated by walking the model forward. Reading times and
   * an oven history in, core temperatures out.
   */
  function cook({ minutes, ovenF = 200, startF = 48, k = 0.011, noise = 0 }) {
    let state = { ovenF, surfaceF: startF, coreF: startF };
    let cursor = 0;
    const readings = [{ temp: startF, timestamp: at(0) }];
    for (const m of minutes.slice(1)) {
      state = advance(state, { minutes: m - cursor, setPointF: ovenF }, k);
      cursor = m;
      readings.push({
        temp: Math.round((state.coreF + noise * Math.sin(m)) * 10) / 10,
        timestamp: at(m)
      });
    }
    return readings;
  }

  const OVEN_200 = [{ setTemp: 200, timestamp: at(0), isOff: false }];

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
    expect(result.confidence.code).toBe('no-readings');
  });

  it('projects a curved cook and reports its fit', () => {
    const readings = cook({ minutes: [0, 45, 90, 125] });
    const result = computeSessionCalculations({
      readings,
      ovenEvents: OVEN_200,
      pullTempF: 125,
      desiredServeTime: null,
      settings: defaultSettings,
      weightLb: 6,
      now: at(125)
    });

    expect(result.confidence.level).toBe('high');
    expect(result.confidence.code).toBe('good-fit');
    // Recovers the constant it was generated with.
    expect(result.fit.k).toBeCloseTo(0.011, 3);
    expect(result.fit.rmsResidual).toBeLessThan(0.2);
    expect(result.predictedMinutesToTarget).toBeGreaterThan(0);
    expect(result.predictedTargetTime).toBeTruthy();
  });

  it('reports the INSTANTANEOUS rate, which is not the least-squares slope', () => {
    /**
     * Late in a cook the core decelerates as it closes on the surface, and a line
     * through the last readings cannot know that - it reports the average of the
     * interval it spans, which is faster than the rate right now. That difference
     * is the improvement, not a discrepancy.
     */
    const readings = cook({ minutes: [0, 60, 120, 180, 240] });
    const result = computeSessionCalculations({
      readings,
      ovenEvents: OVEN_200,
      pullTempF: 190,
      desiredServeTime: null,
      settings: defaultSettings,
      weightLb: 6,
      now: at(240)
    });

    const linearSlope = calculateHeatingRate(readings.slice(-3)).rate;
    expect(result.currentRate).toBeLessThan(linearSlope);
    expect(result.currentRate).toBeGreaterThan(0);
  });

  it('anchors the projection to the last reading, not to now', () => {
    // The projection's own length is measured from the reading it was computed
    // from; the countdown a display shows is measured from now. They differ by
    // exactly the age of that reading.
    const readings = cook({ minutes: [0, 45, 90] });
    const result = computeSessionCalculations({
      readings,
      ovenEvents: OVEN_200,
      pullTempF: 125,
      desiredServeTime: null,
      settings: defaultSettings,
      weightLb: 6,
      now: at(120) // 30 minutes after the last reading
    });

    expect(result.predictedMinutesToTarget - result.predictedMinutesFromNow).toBe(30);
    expect(result.predictedTargetTime)
      .toBe(at(90 + result.predictedMinutesToTarget));
  });

  it('does not move the predicted TIME as the clock advances', () => {
    // The projected finish time is a fixed point between readings; only the
    // distance to it moves. The harness asserts this too, because a clock feeding
    // back into the projection is how an ETA starts drifting on its own.
    const readings = cook({ minutes: [0, 45, 90] });
    const params = {
      readings, ovenEvents: OVEN_200, pullTempF: 125,
      desiredServeTime: null, settings: defaultSettings, weightLb: 6
    };

    const early = computeSessionCalculations({ ...params, now: at(95) });
    const later = computeSessionCalculations({ ...params, now: at(125) });

    expect(later.predictedTargetTime).toBe(early.predictedTargetTime);
    expect(later.predictedMinutesToTarget).toBe(early.predictedMinutesToTarget);
    expect(later.predictedMinutesFromNow).toBe(early.predictedMinutesFromNow - 30);
  });

  it('judges the schedule against the pull deadline', () => {
    const readings = cook({ minutes: [0, 45, 90] });
    const params = {
      readings, ovenEvents: OVEN_200, pullTempF: 125,
      settings: defaultSettings, weightLb: 6, now: at(90)
    };

    const bare = computeSessionCalculations({ ...params, desiredServeTime: null });
    const finish = Date.parse(bare.predictedTargetTime);

    // A serve time exactly at the projected finish, with no rest, is on track.
    const onTrack = computeSessionCalculations({
      ...params, desiredServeTime: new Date(finish).toISOString(), restMinutes: 0
    });
    expect(onTrack.scheduleStatus).toBe('on-track');
    expect(onTrack.scheduleVarianceMinutes).toBe(0);

    // The same serve time with 40 minutes of rest means the meat had to be out
    // 40 minutes earlier, so the same projection is late.
    const late = computeSessionCalculations({
      ...params, desiredServeTime: new Date(finish).toISOString(), restMinutes: 40
    });
    expect(late.scheduleStatus).toBe('late');
    expect(late.scheduleVarianceMinutes).toBe(40);
  });

  describe('the dead-time gate', () => {
    /**
     * The single most important behaviour in this file. Before it, the first
     * advice of every cook came from a fit to the flat early limb of an S-curve,
     * which is not a weak projection but one wrong in DIRECTION - the app said
     * "running late, raise the oven" and the roast finished early.
     */
    it('refuses with fewer than three readings', () => {
      const result = computeSessionCalculations({
        readings: cook({ minutes: [0, 45] }),
        ovenEvents: OVEN_200, pullTempF: 125, desiredServeTime: null,
        settings: defaultSettings, weightLb: 6, now: at(45)
      });
      expect(result.projectionRefusedReason).toBe('insufficient-readings');
      expect(result.predictedTargetTime).toBeNull();
      expect(result.currentRate).toBeNull();
    });

    it('refuses while the readings barely span any of the cook', () => {
      const result = computeSessionCalculations({
        readings: cook({ minutes: [0, 3, 6] }),
        ovenEvents: OVEN_200, pullTempF: 125, desiredServeTime: null,
        settings: defaultSettings, weightLb: 6, now: at(6)
      });
      expect(['insufficient-span', 'insufficient-rise', 'insufficient-progress'])
        .toContain(result.projectionRefusedReason);
    });

    it('refuses while the core has barely moved', () => {
      // A probe in the air, or one that fell out, gives a beautifully consistent
      // flat line.
      const flat = [
        { temp: 48, timestamp: at(0) },
        { temp: 48.4, timestamp: at(30) },
        { temp: 48.9, timestamp: at(60) },
        { temp: 49.2, timestamp: at(90) }
      ];
      const result = computeSessionCalculations({
        readings: flat, ovenEvents: OVEN_200, pullTempF: 125,
        desiredServeTime: null, settings: defaultSettings, weightLb: 6, now: at(90)
      });
      expect(result.projectionRefusedReason).toBe('insufficient-rise');
    });

    it('refuses while too little of the climb has happened', () => {
      // 10 % of the way to a 195 °F target: the flattest part of the limb, where
      // a fit says almost nothing about the rest.
      const readings = cook({ minutes: [0, 20, 40], ovenF: 225 });
      const result = computeSessionCalculations({
        readings,
        ovenEvents: [{ setTemp: 225, timestamp: at(0), isOff: false }],
        pullTempF: 195, desiredServeTime: null,
        settings: defaultSettings, weightLb: 9, meatType: 'Pork Shoulder', now: at(40)
      });
      expect(result.projectionRefusedReason).toBeTruthy();
      expect(result.predictedTargetTime).toBeNull();
    });

    it('opens once enough of the cook has happened', () => {
      const readings = cook({ minutes: [0, 45, 90, 130] });
      const result = computeSessionCalculations({
        readings, ovenEvents: OVEN_200, pullTempF: 125, desiredServeTime: null,
        settings: defaultSettings, weightLb: 6, now: at(130)
      });
      expect(result.projectionRefusedReason).toBeNull();
      expect(result.predictedTargetTime).toBeTruthy();
    });

    it('scales the span requirement to the roast, not to a fixed clock', () => {
      // A quarter of the meat's own time constant. Fifteen minutes is plenty of a
      // small roast's curvature and nothing at all of a large one's, so a fixed
      // minute count is right for exactly one size of roast.
      const small = assessDeadTimeGate({
        readings: [
          { temp: 48, timestamp: at(0) },
          { temp: 70, timestamp: at(10) },
          { temp: 95, timestamp: at(20) }
        ],
        k: 0.05, pullTempF: 125
      });
      const large = assessDeadTimeGate({
        readings: [
          { temp: 48, timestamp: at(0) },
          { temp: 70, timestamp: at(10) },
          { temp: 95, timestamp: at(20) }
        ],
        k: 0.004, pullTempF: 125
      });
      expect(small.passed).toBe(true);
      expect(large.code).toBe('insufficient-span');
    });
  });

  describe('refusals that are not about the data', () => {
    it('says unreachable when the oven cannot get there', () => {
      /**
       * The genuinely new signal. A straight line always reached the target
       * eventually - it had no notion of a temperature the roast asymptotes to -
       * so `predictTimeToTarget(48, 195, 0.11)` used to return 55.7 DAYS, which
       * the status panel rendered as an ordinary clock time.
       */
      const readings = cook({ minutes: [0, 45, 90, 130], ovenF: 175 });
      const result = computeSessionCalculations({
        readings,
        ovenEvents: [{ setTemp: 175, timestamp: at(0), isOff: false }],
        pullTempF: 195, desiredServeTime: null,
        settings: defaultSettings, weightLb: 6, now: at(130)
      });

      expect(result.projectionRefusedReason).toBe('unreachable');
      expect(result.predictedTargetTime).toBeNull();
      expect(result.scheduleStatus).toBe('unknown');

      /**
       * The rate and the fit ARE reported here, and that distinction is the
       * point. The app knows exactly how this roast heats - 20-odd °F/hr, k
       * recovered to three places - and it is still climbing. What does not exist
       * is a finish time, because the roast asymptotes below the target.
       *
       * A gate failure is the other kind of refusal: there, the fit is not
       * trustworthy and the rate is withheld with it. Keeping the two apart is
       * what lets the UI say "raise the oven" for one and "wait" for the other.
       */
      expect(result.currentRate).toBeGreaterThan(0);
      expect(result.fit.k).toBeCloseTo(0.011, 3);
    });

    it('NEVER falls back to the straight line', () => {
      // Measured against the deck, the line gave 17.5 minutes of mean absolute
      // error against the curve's 3.0. The fallback for "cannot fit" is silence,
      // not a worse answer wearing the same confidence.
      const refusals = [
        cook({ minutes: [0, 30] }),
        [
          { temp: 48, timestamp: at(0) },
          { temp: 48.2, timestamp: at(40) },
          { temp: 48.5, timestamp: at(80) }
        ]
      ];
      for (const readings of refusals) {
        const result = computeSessionCalculations({
          readings, ovenEvents: OVEN_200, pullTempF: 125, desiredServeTime: null,
          settings: defaultSettings, weightLb: 6, now: at(90)
        });
        expect(result.predictedMinutesToTarget).toBeNull();
        expect(result.predictedTargetTime).toBeNull();
        expect(result.currentRate).toBeNull();
        expect(result.scheduleStatus).toBe('unknown');
      }
    });

    it('flags a warm start rather than trusting it', () => {
      /**
       * `Ts(0) = Tc(0)` assumes the roast went in cold. A session begun mid-cook
       * breaks it: the fit inflates k, projects too fast, and reports "early" -
       * the OPPOSITE of the old failure direction, so nobody eyeballing the screen
       * will recognise it as wrong. Not fixable by fitting the initial surface
       * temperature too; that is not identifiable from three readings.
       */
      const readings = cook({ minutes: [0, 45, 90, 130], startF: 110 });
      const result = computeSessionCalculations({
        readings, ovenEvents: OVEN_200, pullTempF: 160, desiredServeTime: null,
        settings: defaultSettings, weightLb: 6, now: at(130)
      });

      expect(result.confidence.code).toBe('warm-start');
      expect(result.confidence.level).toBe('low');
      // Still projects: a downgraded projection is more use than none, and the
      // cook is told why.
      expect(result.predictedTargetTime).toBeTruthy();
    });
  });

  describe('while the oven is off', () => {
    const paused = () => ({
      readings: [
        { temp: 48, timestamp: at(0) },
        { temp: 74, timestamp: at(45) },
        { temp: 100, timestamp: at(90) },
        { temp: 108, timestamp: at(120) }
      ],
      ovenEvents: [
        { setTemp: 225, timestamp: at(0), isOff: false },
        { setTemp: 0, timestamp: at(100), isOff: true }
      ],
      pullTempF: 125,
      desiredServeTime: null,
      settings: defaultSettings,
      weightLb: 6,
      now: at(120)
    });

    it('refuses a finish time, because there is not one', () => {
      const result = computeSessionCalculations(paused());
      expect(result.predictedTargetTime).toBeNull();
      expect(result.projectionRefusedReason).toBe('unreachable');
    });

    it('says what would happen once the oven is back on', () => {
      // Correct behaviour, but a visible regression: the ETA simply disappears.
      // So the pause UI can say "about 2 h once the oven is back on" instead of
      // a dash.
      const result = computeSessionCalculations(paused());
      expect(result.projectionIfRestarted).not.toBeNull();
      expect(result.projectionIfRestarted.atOvenTempF).toBe(225);
      expect(result.projectionIfRestarted.minutes).toBeGreaterThan(0);
    });

    it('restarts at the last real setting, not at the 0 an off event stores', () => {
      const result = computeSessionCalculations(paused());
      expect(result.projectionIfRestarted.atOvenTempF).not.toBe(0);
    });
  });
});

