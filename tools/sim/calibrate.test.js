/**
 * Do the committed constants still reproduce the cook they were fitted to?
 *
 * meatModel.js carries CALIBRATED as two hand-pasted numbers. Nothing checked
 * them: a typo in the sixth decimal place, or a change to the model's own
 * integration, would silently move the ground truth every scenario is measured
 * against - and the deck would go on passing, because the deck is measured
 * against whatever the model does.
 *
 * This is the one test in the harness that is not about the app at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALIBRATED, REFERENCE_WEIGHT_LB, constantsFor, createMeatModel } from './meatModel.js';
import { fit } from './calibrate.js';

const EXPORT_PATH = resolve(process.cwd(), 'Docs/Reference/roast-session-2026-08-22.json');

/** Same reduction calibrate.js's main() performs, kept local to the test. */
function timeline(exported) {
  const { readings, ovenEvents } = exported.session;
  const t0 = new Date(readings[0].timestamp).getTime();
  const at = (iso) => (new Date(iso).getTime() - t0) / 60000;
  return {
    readings: readings.map((r) => ({ min: at(r.timestamp), tempF: r.temp })),
    ovenEvents: ovenEvents
      .filter((e) => e.isOff !== true)
      .map((e) => ({ min: at(e.timestamp), setF: e.setTemp }))
  };
}

/**
 * Replay the committed constants through the real oven history. Cycling and
 * probe error off - this is the mean behaviour the constants describe.
 */
function residuals(track, { kOven, kCore, backReaction }) {
  const model = createMeatModel({
    kOven,
    kCore,
    backReaction,
    startCoreF: track.readings[0].tempF,
    ovenSetF: track.ovenEvents[0]?.setF ?? 200,
    cycleAmplitudeF: 0,
    probeBiasRangeF: 0,
    probeNoiseF: 0,
    stalls: false
  });

  const marks = [
    ...track.ovenEvents.slice(1).map((e) => ({ min: e.min, kind: 'oven', setF: e.setF })),
    ...track.readings.slice(1).map((r) => ({ min: r.min, kind: 'reading' }))
  ].sort((a, b) => a.min - b.min);

  const out = [];
  let cursor = 0;
  let readingIndex = 1;
  for (const mark of marks) {
    model.step(mark.min - cursor);
    cursor = mark.min;
    if (mark.kind === 'oven') {
      model.setOven(mark.setF);
    } else {
      out.push({
        min: mark.min,
        actualF: track.readings[readingIndex].tempF,
        modelF: model.coreF,
        residualF: model.coreF - track.readings[readingIndex].tempF
      });
      readingIndex += 1;
    }
  }
  return out;
}

describe('meatModel calibration', () => {
  const exported = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
  const track = timeline(exported);

  it('reproduces the real export to within 0.7 F at every reading', () => {
    const rows = residuals(track, CALIBRATED);
    const worst = Math.max(...rows.map((r) => Math.abs(r.residualF)));

    // 0.61 F as committed. The bound is 0.7, not 0.61: the number is a fit
    // residual, and pinning it to its own value would make every re-integration
    // of the model a test failure rather than a question.
    expect(worst, rows
      .map((r) => `+${Math.round(r.min)}m: actual ${r.actualF.toFixed(1)} F, ` +
        `model ${r.modelF.toFixed(1)} F, residual ${r.residualF.toFixed(2)} F`)
      .join('\n')).toBeLessThanOrEqual(0.7);
  });

  it('is still where the optimiser lands, to within 1%', () => {
    // The committed pair is supposed to BE the fit. If refitting the same
    // export moves it, either the numbers were edited by hand or the model
    // changed underneath them - both worth knowing before the deck is trusted.
    const best = fit(track, CALIBRATED.backReaction);

    expect(best.kOven).toBeCloseTo(CALIBRATED.kOven, 4);
    expect(best.kCore).toBeCloseTo(CALIBRATED.kCore, 4);
    expect(Math.abs(best.kOven / CALIBRATED.kOven - 1)).toBeLessThan(0.01);
    expect(Math.abs(best.kCore / CALIBRATED.kCore - 1)).toBeLessThan(0.01);
  });

  it('keeps kOven == kCore, which is where the ridge check puts it', () => {
    // Not an assumption in the model - a finding. The pair is a critically
    // damped cascade, and constantsFor scales both by the same factor, so an
    // asymmetric CALIBRATED would silently change the SHAPE of every scenario's
    // heating curve rather than just its speed.
    expect(CALIBRATED.kOven).toBe(CALIBRATED.kCore);
  });

  it('scales the constants as weight^(-2/3) about the reference weight', () => {
    const reference = constantsFor(REFERENCE_WEIGHT_LB, 'prime-rib');
    expect(reference.kOven).toBeCloseTo(CALIBRATED.kOven, 12);

    // Eight times the weight is half the k: (6/48)^(2/3) = 0.25 ... times the
    // shape factor, which is 1 for prime rib. This is the relation the Phase 4
    // prior leans on, so it is worth an assertion rather than a comment.
    const eightTimes = constantsFor(REFERENCE_WEIGHT_LB * 8, 'prime-rib');
    expect(eightTimes.kOven / reference.kOven).toBeCloseTo(0.25, 10);
  });

  it('says out loud what the fit does not constrain', () => {
    // Two residuals against two free parameters is zero degrees of freedom, and
    // the export tops out at 92 F core. Every scenario on the deck targets
    // 125-195 F, so the whole endgame is extrapolation. Asserted so that the
    // day a real instrumented cook lands, this test fails and forces the
    // caveats in the README and in calibrate.js to be revisited with it.
    const freeParameters = 2;
    expect(track.readings.length - 1).toBe(freeParameters);
    expect(track.readings.at(-1).tempF).toBeLessThan(100);
  });
});
