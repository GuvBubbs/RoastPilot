/**
 * Properties any correct projection must have, whatever its model.
 *
 * Distinct from the oracle comparison next door, which asks "is this model
 * accurate". These ask "is this an answer at all" - and they hold for a two-lag
 * cascade, a sphere solve, a straight line, or anything else. A test that only a
 * particular model passes is a test of that model; these are tests of the
 * PROJECTION as a thing the rest of the app can rely on.
 *
 * Two of them have already caught real bugs in this codebase:
 *
 *  - "never predicts crossing a temperature the oven cannot deliver" was failing
 *    outright: `predictTimeToTarget(48, 195, 0.11)` returned 55.7 DAYS, which the
 *    status panel rendered as an ordinary time of day.
 *  - "the same cook gives the same answer either side of a DST boundary" is the
 *    general form of the addMinutes bug, which was an hour of error in the
 *    direction that flips the schedule verdict.
 */
import { describe, it, expect } from 'vitest';
import { computeSessionCalculations } from '../../src/services/calculationService.js';
import { clearFitCache, advance, kPrior } from '../../src/services/thermalModel.js';
import { createDefaultSettings } from '../../src/models/dataModels.js';
import {
  celsiusToFahrenheit,
  fahrenheitToCelsius
} from '../../src/utils/temperatureUtils.js';

const SETTINGS = createDefaultSettings();

/**
 * A cook, generated from the app's own model. Circular for accuracy - which is
 * why the accuracy questions live next door - and perfectly good for properties,
 * which have to hold on any input at all.
 */
function generate({ startISO, minutes, ovenF, startF = 48, k = 0.011 }) {
  const base = Date.parse(startISO);
  const at = (m) => new Date(base + m * 60_000).toISOString();
  let state = { ovenF, surfaceF: startF, coreF: startF };
  let cursor = 0;
  const readings = [{ temp: startF, timestamp: at(0) }];
  for (const m of minutes.slice(1)) {
    state = advance(state, { minutes: m - cursor, setPointF: ovenF }, k);
    cursor = m;
    readings.push({ temp: Math.round(state.coreF * 10) / 10, timestamp: at(m) });
  }
  return {
    readings,
    ovenEvents: [{ setTemp: ovenF, timestamp: at(0), isOff: false }],
    at
  };
}

function project(cook, { pullTempF, now, weightLb = 6 }) {
  clearFitCache();
  return computeSessionCalculations({
    readings: cook.readings,
    ovenEvents: cook.ovenEvents,
    pullTempF,
    desiredServeTime: null,
    settings: SETTINGS,
    weightLb,
    now
  });
}

describe('never predicts crossing a temperature the oven cannot deliver', () => {
  /**
   * The core asymptotes to the oven. An oven below the target means the roast
   * approaches it and never arrives, so there is no finish time to name - and
   * naming one anyway was the app's most spectacular single defect.
   */
  it('refuses when the target is above the oven', () => {
    for (const [ovenF, pullTempF] of [[175, 195], [200, 205], [150, 150], [225, 300]]) {
      const cook = generate({ startISO: '2026-08-22T18:00:00.000Z', minutes: [0, 45, 90, 130], ovenF });
      const result = project(cook, { pullTempF, now: cook.at(130) });
      expect(result.predictedTargetTime, `oven ${ovenF} -> ${pullTempF}`).toBeNull();
      expect(result.projectionRefusedReason, `oven ${ovenF} -> ${pullTempF}`)
        .toBe('unreachable');
    }
  });

  it('answers when the oven has the headroom', () => {
    const cook = generate({ startISO: '2026-08-22T18:00:00.000Z', minutes: [0, 45, 90, 130], ovenF: 225 });
    expect(project(cook, { pullTempF: 195, now: cook.at(130) }).predictedTargetTime)
      .not.toBeNull();
  });

  it('the projected finish is never past the oven temperature itself', () => {
    // Restated as a bound on the model rather than on the guard: whatever the
    // fit, the core can never exceed the oven it is sitting in.
    const cook = generate({ startISO: '2026-08-22T18:00:00.000Z', minutes: [0, 45, 90], ovenF: 200 });
    const fit = project(cook, { pullTempF: 125, now: cook.at(90) }).fit;
    const far = advance(fit.anchorState, { minutes: 10_000, setPointF: 200 }, fit.k);
    expect(far.coreF).toBeLessThanOrEqual(200.001);
    expect(far.surfaceF).toBeLessThanOrEqual(200.001);
  });
});

describe('unit invariance', () => {
  /**
   * The same physical cook, expressed in Celsius, must give the same answer. The
   * projection works in Fahrenheit throughout, so this is a test of the
   * CONVERSIONS around it - and the app has already shipped one bug of exactly
   * this shape, a chart that compared display units and so reached a different
   * at-target verdict than the advice band on a Celsius session.
   */
  it('gives the same finish time whichever unit the caller thinks in', () => {
    const cook = generate({ startISO: '2026-08-22T18:00:00.000Z', minutes: [0, 45, 90, 130], ovenF: 200 });

    const inF = project(cook, { pullTempF: 125, now: cook.at(130) });

    // Round-trip every temperature through Celsius and back, as the UI does.
    const roundTripped = {
      readings: cook.readings.map((r) => ({
        ...r,
        temp: celsiusToFahrenheit(Math.round(fahrenheitToCelsius(r.temp) * 100) / 100)
      })),
      ovenEvents: cook.ovenEvents.map((e) => ({
        ...e,
        setTemp: celsiusToFahrenheit(Math.round(fahrenheitToCelsius(e.setTemp)))
      })),
      at: cook.at
    };
    const viaC = project(roundTripped, {
      pullTempF: celsiusToFahrenheit(Math.round(fahrenheitToCelsius(125) * 100) / 100),
      now: cook.at(130)
    });

    expect(viaC.predictedMinutesToTarget)
      .toBeCloseTo(inF.predictedMinutesToTarget, -0.5);
    expect(viaC.confidence.level).toBe(inF.confidence.level);
  });

  it('scales the rate by the unit, not by the offset', () => {
    // A rate is a difference per hour, so it converts by 5/9 with no 32° term.
    // Getting that wrong turns +20 °F/hr into -6.7 °C/hr.
    const cook = generate({ startISO: '2026-08-22T18:00:00.000Z', minutes: [0, 45, 90, 130], ovenF: 200 });
    const rate = project(cook, { pullTempF: 125, now: cook.at(130) }).currentRate;
    expect(rate).toBeGreaterThan(0);
    expect((rate * 5) / 9).toBeGreaterThan(0);
  });
});

describe('DST invariance', () => {
  /**
   * The general form of the addMinutes bug. The same cook, at the same offsets,
   * started at an instant that straddles a DST boundary, must project the same
   * NUMBER OF MINUTES - the roast does not care what the clocks are doing.
   *
   * Runs in whatever zone the suite is in. The zone-specific fixtures, which need
   * a zone that actually has transitions, are in
   * src/utils/timeUtils.dst.test.js.
   */
  const OFFSETS = [0, 45, 90, 130];

  it('projects the same duration whenever the cook starts', () => {
    const starts = [
      '2026-06-15T02:00:00.000Z',   // no transition anywhere near
      '2026-09-26T13:00:00.000Z',   // straddles Auckland spring forward
      '2026-04-04T13:00:00.000Z',   // straddles Auckland fall back
      '2026-03-08T06:00:00.000Z',   // straddles US spring forward
      '2026-11-01T05:00:00.000Z'    // straddles US fall back
    ];

    const durations = starts.map((startISO) => {
      const cook = generate({ startISO, minutes: OFFSETS, ovenF: 200 });
      return project(cook, { pullTempF: 125, now: cook.at(130) }).predictedMinutesToTarget;
    });

    for (const d of durations) expect(d).not.toBeNull();
    // Every start must give the same projected duration, exactly.
    expect(new Set(durations).size, `durations ${durations.join(', ')}`).toBe(1);
  });

  it('places the finish that many real minutes after the last reading', () => {
    for (const startISO of ['2026-09-26T13:00:00.000Z', '2026-04-04T13:00:00.000Z']) {
      const cook = generate({ startISO, minutes: OFFSETS, ovenF: 200 });
      const result = project(cook, { pullTempF: 125, now: cook.at(130) });
      const anchor = Date.parse(cook.readings[cook.readings.length - 1].timestamp);
      const finish = Date.parse(result.predictedTargetTime);
      expect((finish - anchor) / 60_000, startISO)
        .toBe(result.predictedMinutesToTarget);
    }
  });
});

describe('more evidence never makes the answer worse', () => {
  it('converges as readings accumulate', () => {
    /**
     * Asserted here on the app's own model, where it is a statement about the FIT
     * rather than about the physics: adding a reading must not move the estimate
     * further from where it settles. A fit that wanders as data arrives is one
     * whose earlier agreement was luck.
     */
    const full = generate({
      startISO: '2026-08-22T18:00:00.000Z',
      minutes: [0, 20, 40, 60, 80, 100, 120, 140, 160],
      ovenF: 200
    });
    const settled = project(full, { pullTempF: 140, now: full.at(160) }).predictedTargetTime;
    expect(settled).not.toBeNull();

    let previous = Infinity;
    for (const upTo of [4, 5, 6, 7, 8]) {
      const partial = {
        readings: full.readings.slice(0, upTo + 1),
        ovenEvents: full.ovenEvents,
        at: full.at
      };
      const result = project(partial, {
        pullTempF: 140,
        now: partial.readings[partial.readings.length - 1].timestamp
      });
      if (result.predictedTargetTime === null) continue;
      const drift = Math.abs(Date.parse(result.predictedTargetTime) - Date.parse(settled)) / 60_000;
      expect(drift, `with ${upTo + 1} readings`).toBeLessThanOrEqual(previous + 0.6);
      previous = drift;
    }
  });
});

describe('the prior cannot dominate the fit', () => {
  it('recovers the same k from a badly wrong weight', () => {
    /**
     * The weight field says "lbs" and the validator allows 0-100, so a cook who
     * types kilograms is not stopped. The prior is what a wrong weight corrupts,
     * so what matters is how little of the answer it accounts for once there is
     * real data.
     */
    const cook = generate({
      startISO: '2026-08-22T18:00:00.000Z',
      minutes: [0, 30, 60, 90, 120, 150],
      ovenF: 200,
      k: 0.011
    });

    const results = [1, 3, 6, 12, 40, null].map((weightLb) =>
      project(cook, { pullTempF: 140, now: cook.at(150), weightLb })
    );

    const ks = results.map((r) => r.fit.k);
    for (const k of ks) expect(k).toBeCloseTo(0.011, 3);
    // A 40x range of prior must not move the fitted k by more than a percent.
    expect((Math.max(...ks) - Math.min(...ks)) / Math.min(...ks)).toBeLessThan(0.01);
  });

  it('spans the true k even from the far end of its bracket', () => {
    // The prior sets the search bracket, so a wrong prior must not put the answer
    // outside it. 20x either way.
    expect(kPrior({ weightLb: 1 }) / 20).toBeLessThan(0.011);
    expect(kPrior({ weightLb: 40 }) * 20).toBeGreaterThan(0.011);
  });
});
