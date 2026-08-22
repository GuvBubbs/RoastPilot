/**
 * The committed static fixtures.
 *
 * Data the model was not built from, so a change to the model cannot quietly
 * move the truth it is judged against - which is what happens when every test
 * generates its own fixture from the code under test.
 *
 * Six are conduction solves across two geometries. Two are adversarial and come
 * from no thermal model at all; those are asserted on graceful degradation
 * rather than on accuracy. See fixtures/README.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSessionCalculations } from '../../src/services/calculationService.js';
import { createDefaultSettings } from '../../src/models/dataModels.js';
import { clearFitCache } from '../../src/services/thermalModel.js';

const DIR = resolve(process.cwd(), 'tools/oracle/fixtures');
const SETTINGS = createDefaultSettings();

const FIXTURES = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')));

const BASE = Date.parse('2026-08-22T18:00:00.000Z');
const minuteOf = (iso) => (Date.parse(iso) - BASE) / 60_000;

function appAt(fixture, upTo) {
  clearFitCache();
  const cutoff = BASE + upTo * 60_000;
  const result = computeSessionCalculations({
    readings: fixture.readings.filter((r) => Date.parse(r.timestamp) <= cutoff),
    ovenEvents: fixture.ovenEvents.filter((e) => Date.parse(e.timestamp) <= cutoff),
    pullTempF: fixture.pullTempF,
    desiredServeTime: null,
    settings: SETTINGS,
    weightLb: fixture.weightLb,
    now: new Date(cutoff).toISOString()
  });
  return {
    ...result,
    finishMin: result.predictedTargetTime === null ? null : minuteOf(result.predictedTargetTime)
  };
}

/** The reading times strictly inside the cook. */
const scoringPoints = (fixture) =>
  fixture.readings.map((r) => minuteOf(r.timestamp)).filter((t) => t > 0 && t < fixture.trueHitMin);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

it('has the eight fixtures it is supposed to have', () => {
  // A guard against a fixture being deleted to make a suite pass.
  expect(FIXTURES).toHaveLength(8);
  expect(FIXTURES.filter((f) => f.adversarial)).toHaveLength(2);
});

describe.each(FIXTURES.filter((f) => !f.adversarial).map((f) => [f.name, f]))(
  '%s',
  (_name, fixture) => {
    it('describes a cook that reaches its target', () => {
      expect(fixture.trueHitMin).toBeGreaterThan(0);
      expect(fixture.readings.length).toBeGreaterThan(5);
    });

    it('lands within 25 minutes over the second half', () => {
      const points = scoringPoints(fixture).filter((t) => t >= fixture.trueHitMin * 0.4);
      const errors = points
        .map((t) => appAt(fixture, t))
        .filter((r) => r.finishMin !== null)
        .map((r) => Math.abs(r.finishMin - fixture.trueHitMin));

      expect(errors.length, 'the gate never opened').toBeGreaterThan(0);
      expect(mean(errors), `worst ${Math.max(...errors).toFixed(0)} min`)
        .toBeLessThanOrEqual(25);
    });

    it('never names a finish before the reading it came from', () => {
      for (const t of scoringPoints(fixture)) {
        const result = appAt(fixture, t);
        if (result.finishMin === null) continue;
        const anchor = fixture.readings
          .filter((r) => Date.parse(r.timestamp) <= BASE + t * 60_000)
          .pop();
        expect(result.finishMin, `at +${t}`).toBeGreaterThanOrEqual(minuteOf(anchor.timestamp) - 0.01);
      }
    });

    it('says nothing at the second reading', () => {
      // The dead-time gate. Two readings is zero degrees of freedom against one
      // fitted parameter, so any answer here is a guess dressed as a projection.
      const second = minuteOf(fixture.readings[1].timestamp);
      expect(appAt(fixture, second).predictedTargetTime).toBeNull();
    });
  }
);

describe.each(FIXTURES.filter((f) => f.adversarial).map((f) => [f.name, f]))(
  'adversarial: %s',
  (_name, fixture) => {
    /**
     * ACCURACY IS NOT ASSERTED HERE. These are shapes no roast produces, and the
     * app's model cannot describe them - `08` in particular is the one shape a
     * two-lag cascade structurally cannot make, since its own response starts
     * flat and this one starts at full speed.
     *
     * What is asserted is that the app is not CONFIDENTLY wrong. A cook who is
     * told the timing is approximate, and why, can act on that; a cook shown a
     * precise clock time derived from readings the model cannot fit cannot.
     */
    it('never claims a good fit', () => {
      const codes = new Set();
      for (const t of scoringPoints(fixture)) {
        const code = appAt(fixture, t).confidence.code;
        if (code) codes.add(code);
      }
      expect(codes.size).toBeGreaterThan(0);
      expect([...codes], `codes seen: ${[...codes].join(', ')}`).not.toContain('good-fit');
    });

    it('still produces no nonsense: finite, forward, or nothing at all', () => {
      // The floor under every refusal. Whatever the app decides about data it
      // cannot fit, it must not emit a NaN, an Infinity, or a finish time in the
      // past - those reach the screen as a blank panel or a RangeError.
      for (const t of scoringPoints(fixture)) {
        const result = appAt(fixture, t);
        if (result.finishMin !== null) {
          expect(Number.isFinite(result.finishMin), `at +${t}`).toBe(true);
          const anchor = fixture.readings
            .filter((r) => Date.parse(r.timestamp) <= BASE + t * 60_000)
            .pop();
          expect(result.finishMin).toBeGreaterThanOrEqual(minuteOf(anchor.timestamp) - 0.01);
        }
        if (result.currentRate !== null) {
          expect(Number.isFinite(result.currentRate), `rate at +${t}`).toBe(true);
        }
      }
    });

    it('reports a residual that reflects how badly the shape misfits', () => {
      // The mechanism behind the confidence claim above, asserted directly: it is
      // the residual in DEGREES that carries the information, and it has to be
      // large here or the confidence downgrade is luck.
      const residuals = scoringPoints(fixture)
        .map((t) => appAt(fixture, t).fit?.rmsResidual)
        .filter((v) => v !== undefined);
      expect(residuals.length).toBeGreaterThan(0);
      expect(Math.max(...residuals)).toBeGreaterThan(2.5);
    });
  }
);
