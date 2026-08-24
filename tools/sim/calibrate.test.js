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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALIBRATED, REFERENCE_WEIGHT_LB, constantsFor, createMeatModel } from './meatModel.js';
import { fit, timeline } from './calibrate.js';
import { exportToJSON } from '../../src/services/exportService.js';
import { useSession } from '../../src/composables/useSession.js';

const EXPORT_PATH = resolve(process.cwd(), 'Docs/Reference/roast-session-2026-08-22.json');

/*
 * `timeline` used to be reimplemented here, and the copy was wrong in both of the
 * ways the production one documents: it dropped `ovenActualF` entirely, and it
 * filtered oven-off events - `.filter(e => e.isOff !== true)`, the exact line
 * calibrate.js removed because it makes a calibration run pretend the oven stayed
 * on through every pause. The reference export happens to contain no pause and no
 * oven readings, so both bugs were invisible here; the moment an instrumented cook
 * arrived, this file would have been testing a reduction the CLI does not perform.
 *
 * So it is imported from calibrate.js now. A local copy of the thing under test is
 * not a test.
 */

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

/**
 * Can the CLI fit a file the app produced, with no hand editing?
 *
 * This is Phase 8's A3, and until that phase there was no way to answer it: the
 * app had no oven-temperature input anywhere, so `ovenActualF` - which the
 * objective in calibrate.js has weighted at 0.25 since before it could be
 * recorded - could only be put into a file by editing the JSON by hand. The
 * consumer existed; only the producer was missing.
 *
 * So the cook here is built through the REAL useSession and createReading path
 * and serialised by the REAL exportToJSON. Nothing in this describe block
 * constructs an export by hand, because a hand-built fixture would prove that
 * calibrate.js can read a file this test knows how to write, which is not the
 * question.
 */
describe('calibrate against a file the app produced', () => {
  const START = Date.parse('2026-08-22T02:00:00.000Z');
  const at = (min) => new Date(START + min * 60000).toISOString();

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A cook with a dial change, optionally a pause, and a thermometer on the shelf.
   *
   * DELIBERATELY SHORT - three readings over 90 minutes, the same shape as the
   * reference export. fitPair sweeps a 400x400 grid and every candidate replays
   * the whole timeline, so the fit's cost scales with the length of the cook: a
   * four-hour synthetic cook with a pause in it took this file past its timeout.
   * The pause is asserted structurally instead, which is where the interesting
   * claim about it lives anyway.
   */
  function exportedCook({ withOvenActual = true, withPause = false } = {}) {
    localStorage.clear();
    /**
     * THE CLOCK HAS TO BE THE COOK'S CLOCK.
     *
     * startSession stamps the first oven event and the starting reading with
     * `new Date()`, and there is no parameter for either. Left at the wall clock
     * they land days after the timestamps below, normalizeReadings sorts them to
     * the end, and the track handed to `fit` spans two days instead of ninety
     * minutes - which the optimiser then spends minutes failing to fit.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    const session = useSession();
    session.startSession({
      units: 'F',
      servingTempF: 129,
      pullTempF: 125,
      carryoverF: 4,
      restMinutes: 20,
      initialOvenTemp: 200,
      meatType: 'Prime Rib',
      weight: 6,
      thicknessCm: 13,
      lengthCm: 20,
      covering: 'open',
      ambientF: 68,
      ovenIsFanForced: false,
      startingTemp: 46
    });

    const rows = [[30, 55, 196], [60, 66, 248], [90, 80, 251]];
    // The dial moves once, mid-cook.
    session.addOvenEvent(250, at(45));
    if (withPause) {
      session.logOvenOff(at(100));
      session.logOvenOn(250, at(130));
    }

    for (const [min, tempF, ovenF] of rows) {
      session.addReading(tempF, at(min), withOvenActual ? ovenF : null);
    }

    const exported = JSON.parse(exportToJSON({
      config: session.config.value,
      readings: session.readings.value,
      ovenEvents: session.ovenEvents.value,
      settings: session.settings.value
    }));
    session.endSession();
    localStorage.clear();
    vi.useRealTimers();
    return exported;
  }

  it('reduces an app export to a track the fitter can read', () => {
    const track = timeline(exportedCook({ withPause: true }));

    /**
     * Every reading the cook LOGGED carries a number, because the app recorded
     * one. The first does not: it comes from the setup sheet's starting reading,
     * which has no oven field and gets none - the setup form asks about the oven
     * once, as a dial setting, and R2 deliberately adds no further input there.
     */
    expect(track.readings[0].ovenActualF).toBeNull();
    expect(track.readings.slice(1).every((r) => Number.isFinite(r.ovenActualF))).toBe(true);
    // The pause is IN the track, not filtered out of it. An off event reaches the
    // fitter as setF null, which meatModel.setOven reads as "switch off" rather
    // than "set to zero degrees".
    expect(track.hasPause).toBe(true);
    expect(track.ovenEvents.some((e) => e.isOff && e.setF === null)).toBe(true);
    // And the dial change survives as a real set point.
    expect(track.ovenEvents.some((e) => e.setF === 250)).toBe(true);

    // Ninety minutes, four readings - the starting reading plus three. Asserted
    // because a track that silently spans days still fits, just very slowly.
    expect(track.readings).toHaveLength(4);
    expect(track.readings.at(-1).min).toBeCloseTo(90, 6);
  });

  it('keeps the field null, not missing, when no thermometer was read', () => {
    /**
     * Null rather than absent, on every reading. An export where the key is
     * sometimes there and sometimes not makes "no thermometer on the shelf"
     * indistinguishable from "written by a build that could not record it", and
     * telling those apart is the offline fitter's problem.
     */
    const exported = exportedCook({ withOvenActual: false });
    for (const r of exported.session.readings) {
      expect(r).toHaveProperty('ovenActualF', null);
    }
    const track = timeline(exported);
    expect(track.readings.every((r) => r.ovenActualF === null)).toBe(true);
  });

  it('fits the oven constants against the values the file contains', () => {
    /**
     * `fitTauCool: false` on purpose. The point being asserted is that the oven
     * residual reaches the objective from a real app export; sweeping the seven
     * cooling candidates as well multiplies the run time by seven and tests the
     * outer loop, which the reference-export cases above already exercise.
     */
    const withOven = fit(timeline(exportedCook()), 0, { fitTauCool: false });
    const withoutOven = fit(timeline(exportedCook({ withOvenActual: false })), 0, { fitTauCool: false });

    expect(Number.isFinite(withOven.kOven)).toBe(true);
    expect(Number.isFinite(withOven.kCore)).toBe(true);
    expect(Number.isFinite(withOven.sse)).toBe(true);

    /**
     * The oven readings CHANGED the objective, which is the whole claim.
     *
     * Without this the test would pass against a build that dropped the field on
     * the way out of the app - Number.isFinite guards the consumer, so a missing
     * value is silently skipped rather than producing a NaN anyone would notice.
     * That guard was itself added after `undefined !== null` put Infinity into
     * every candidate's score.
     */
    expect(withOven.sse).not.toBe(withoutOven.sse);
  });
});
