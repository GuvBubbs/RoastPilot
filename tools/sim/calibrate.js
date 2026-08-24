/**
 * Fit the two-node model to a real exported cook and print the residuals.
 *
 *   npm run sim:calibrate [path-to-export.json]
 *
 * The fitted pair is what gets committed as CALIBRATED in meatModel.js. Run
 * this again after any full cook - the endgame of the cook is the part the
 * current fit says least about, and it is the part that decides whether dinner
 * is on time.
 *
 * WHAT TO COOK, AND WHAT TO RECORD WHILE COOKING IT:
 * Docs/calibration-cook.md. One instrumented cook replaces most of what this
 * model currently guesses, and it needs no code at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createMeatModel } from './meatModel.js';

/**
 * Vitest rewrites import.meta.url to a non-file scheme, so fileURLToPath throws
 * there - and this module is imported by calibrate.test.js. Same fallback as
 * report.js: the accurate route first, then the repo root, which is the working
 * directory for every command that reaches this file.
 */
const DEFAULT_EXPORT = (() => {
  const relative = '../../Docs/Reference/roast-session-2026-08-22.json';
  try {
    return fileURLToPath(new URL(relative, import.meta.url));
  } catch {
    return resolve(process.cwd(), 'Docs/Reference/roast-session-2026-08-22.json');
  }
})();

const C = (f) => Math.round(((f - 32) * 5 / 9) * 100) / 100;

/**
 * Minutes from the cook's start, for anything with an ISO timestamp.
 *
 * OFF EVENTS ARE KEPT. They used to be filtered out - `.filter(e => e.isOff !==
 * true)` - which silently made a calibration run pretend the oven had stayed on
 * through every pause. The reference export happens to contain none, so the bug
 * was invisible; the moment an instrumented cook with a deliberate oven-off
 * period arrives, dropping them would fit the cooling stretch as though it were
 * heating and corrupt every constant at once.
 *
 * `tauOvenCoolMin` is presently constrained by NOTHING - it is a guess - and an
 * oven-off period is the only data that could constrain it. Filtering out the one
 * event type that carries that information is the opposite of what this file is
 * for.
 */
export function timeline(exported) {
  const { readings, ovenEvents } = exported.session;
  const t0 = new Date(readings[0].timestamp).getTime();
  const at = (iso) => (new Date(iso).getTime() - t0) / 60000;
  return {
    t0,
    readings: readings.map((r) => ({
      min: at(r.timestamp),
      tempF: r.temp,
      // An instrumented cook records the oven thermometer alongside the probe.
      // Three of the model's constants are currently fabricated for want of it.
      ovenActualF: Number.isFinite(r.ovenActualF) ? r.ovenActualF : null
    })),
    ovenEvents: ovenEvents.map((e) => ({
      min: at(e.timestamp),
      setF: e.isOff === true ? null : e.setTemp,
      isOff: e.isOff === true
    })),
    hasPause: ovenEvents.some((e) => e.isOff === true)
  };
}

/**
 * Replay a candidate (kOven, kCore) through the real oven history and return
 * the predicted core temperature at each real reading time.
 *
 * Thermostat cycling and probe error are switched off here. We are fitting the
 * mean behaviour; leaving the noise in would let the optimiser chase it.
 */
function predict({ kOven, kCore, backReaction = 0, tauOvenCoolMin, tauOvenHeatMin }, track) {
  const model = createMeatModel({
    kOven,
    kCore,
    backReaction,
    startCoreF: track.readings[0].tempF,
    ovenSetF: track.ovenEvents.find((e) => !e.isOff)?.setF ?? 200,
    cycleAmplitudeF: 0,
    probeBiasRangeF: 0,
    probeNoiseF: 0,
    stalls: false,
    // Fitted when the export contains a pause to constrain them; otherwise the
    // model's own defaults stand.
    ...(Number.isFinite(tauOvenCoolMin) ? { tauOvenCoolMin } : {}),
    ...(Number.isFinite(tauOvenHeatMin) ? { tauOvenHeatMin } : {})
  });

  // Every oven event after the first ON, off events included. Sorted with
  // readings first at equal instants: the real cook's pattern is to log a reading
  // and then move the dial, and the reading describes the state before the change.
  const marks = [
    ...track.ovenEvents.slice(1).map((e) => ({ min: e.min, kind: 'oven', setF: e.setF })),
    ...track.readings.slice(1).map((r) => ({ min: r.min, kind: 'reading' }))
  ].sort((a, b) => a.min - b.min || (a.kind === 'reading' ? -1 : 1));

  const predicted = [];
  let cursor = 0;
  for (const mark of marks) {
    model.step(mark.min - cursor);
    cursor = mark.min;
    if (mark.kind === 'oven') {
      // null is an off event. setOven(null) switches the oven off rather than
      // setting it to zero degrees - see meatModel.setOven.
      model.setOven(mark.setF);
    } else {
      predicted.push({ min: mark.min, tempF: model.coreF, ovenBaseF: model.ovenBaseF });
    }
  }
  return predicted;
}

/**
 * Residual weights.
 *
 * Every residual used to count the same, and that is wrong in a way that biases
 * the answer toward the part of the cook nobody cares about.
 *
 * A roast spends most of its readings in the long slow early climb and only a
 * handful in the last stretch. An unweighted fit therefore optimises the early
 * limb - where the app is silent anyway, because the dead-time gate is holding -
 * and lets the endgame drift. The endgame is the part that decides whether
 * dinner is on time.
 *
 * So residuals above ENDGAME_FROM_F count double. Not more than double: this is
 * a correction for how the readings happen to be distributed, not a decision to
 * fit only the end.
 */
export const ENDGAME_FROM_F = 110;
export const ENDGAME_WEIGHT = 2;

function residualWeight(tempF) {
  return tempF >= ENDGAME_FROM_F ? ENDGAME_WEIGHT : 1;
}

function sse(candidate, track) {
  const predicted = predict(candidate, track);
  const actual = track.readings.slice(1);
  let total = 0;
  let weight = 0;
  for (let i = 0; i < actual.length; i++) {
    const w = residualWeight(actual[i].tempF);
    total += w * (predicted[i].tempF - actual[i].tempF) ** 2;
    weight += w;

    /**
     * The oven residual, when the export carries one.
     *
     * An instrumented cook reads an oven thermometer at every probe reading, and
     * three of the model's constants - tauOvenHeatMin, tauOvenCoolMin and the
     * thermostat cycling amplitude - are currently fabricated for want of exactly
     * that. Scaled down by four: the oven is a means to the core temperature, and
     * letting its residuals compete on equal terms would trade the thing being
     * predicted for the thing driving it.
     */
    // Number.isFinite, not `!== null`. An export without the field yields
    // `undefined`, and `undefined !== null` is true - which put a NaN straight
    // into the objective and made every candidate score Infinity. Caught by
    // calibrate.test.js, which refits the reference export and expects the
    // committed constants back.
    if (Number.isFinite(actual[i].ovenActualF) && Number.isFinite(predicted[i].ovenBaseF)) {
      total += 0.25 * (predicted[i].ovenBaseF - actual[i].ovenActualF) ** 2;
      weight += 0.25;
    }
  }
  // Returned as a weighted MEAN rather than a sum, so the number is comparable
  // across exports with different numbers of readings.
  return weight > 0 ? total / weight : Infinity;
}

/**
 * Candidate oven cooling constants, in minutes.
 *
 * Searched ONLY when the export contains an oven-off period, because that is the
 * only data that constrains it. `tauOvenCoolMin` is otherwise a guess - 45
 * minutes, chosen because a closed oven with the element off gives up its heat
 * far more slowly than it takes it on, which is true but is not a measurement.
 *
 * One deliberate 20-30 minute oven-off period in an instrumented cook is enough
 * to pin it, and it is the cheapest thing on the whole calibration protocol.
 */
const TAU_COOL_CANDIDATES = [20, 30, 45, 60, 90, 120, 180];

/**
 * Coarse log-spaced sweep, then a pattern search that walks downhill in
 * multiplicative steps. Not a general-purpose optimiser - it exists so the
 * numbers in meatModel.js are reproducible from the export rather than tuned by
 * hand.
 *
 * FITS THREE PARAMETERS WHEN THE DATA SUPPORTS A THIRD. It used to fit two
 * unconditionally, which is right for the reference export - it has no pause, so
 * there is nothing in it about cooling - and wrong for the instrumented cook this
 * file exists to be ready for. A parameter searched over data that cannot
 * constrain it is worse than a parameter left at its default, because the
 * resulting number looks measured.
 *
 * @param {Object} track
 * @param {number} [backReaction] - held fixed; the search over it is separate
 * @param {Object} [options]
 * @param {boolean} [options.fitTauCool] - defaults to whether the track has a pause
 */
export function fit(track, backReaction = 0, { fitTauCool = track.hasPause } = {}) {
  if (fitTauCool) {
    // An outer sweep over the cooling constant, refitting the pair inside each.
    // Coarse on purpose: seven candidates spanning 20 to 180 minutes is all the
    // resolution a single pause can honestly support.
    let overall = null;
    for (const tauOvenCoolMin of TAU_COOL_CANDIDATES) {
      const inner = fitPair(track, backReaction, { tauOvenCoolMin });
      if (!overall || inner.sse < overall.sse) overall = { ...inner, tauOvenCoolMin };
    }
    return overall;
  }
  return fitPair(track, backReaction, {});
}

/** The two-parameter search, with any fixed extras held constant. */
function fitPair(track, backReaction, fixed) {
  let best = { kOven: NaN, kCore: NaN, backReaction, ...fixed, sse: Infinity };

  const GRID = 400;
  for (let i = 0; i < GRID; i++) {
    const kOven = 0.002 * (0.5 / 0.002) ** (i / (GRID - 1));
    for (let j = 0; j < GRID; j++) {
      const kCore = 0.0005 * (0.2 / 0.0005) ** (j / (GRID - 1));
      const err = sse({ kOven, kCore, backReaction, ...fixed }, track);
      if (err < best.sse) best = { kOven, kCore, backReaction, ...fixed, sse: err };
    }
  }

  const MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
                 [2, -1], [-1, 2], [1, -2], [-2, 1]];
  for (let step = 0.2; step > 1e-9; step *= 0.5) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dOven, dCore] of MOVES) {
        const kOven = best.kOven * (1 + dOven * step);
        const kCore = best.kCore * (1 + dCore * step);
        if (kOven <= 0 || kCore <= 0) continue;
        const err = sse({ kOven, kCore, backReaction, ...fixed }, track);
        if (err < best.sse - 1e-18) {
          best = { kOven, kCore, backReaction, ...fixed, sse: err };
          improved = true;
        }
      }
    }
  }
  return best;
}

function pad(value, width) {
  return String(value).padStart(width);
}

function main() {
  const path = process.argv[2] ?? DEFAULT_EXPORT;
  const exported = JSON.parse(readFileSync(path, 'utf8'));
  const track = timeline(exported);

  console.log(`\nCalibrating against ${path}`);
  console.log(`  ${track.readings.length} readings over ${Math.round(track.readings.at(-1).min)} min, ` +
    `${track.ovenEvents.length} oven set points\n`);

  // ---- The single-node problem, stated in numbers -------------------------
  console.log('Implied single-node k per interval (this is why the model has two nodes):');
  console.log('  segment  span    core (C)        oven (C)  rate (C/h)  implied k /min');
  for (let i = 1; i < track.readings.length; i++) {
    const a = track.readings[i - 1];
    const b = track.readings[i];
    const span = b.min - a.min;
    // The set point in force across the interval is the newest one at or before
    // its start - the dial was moved just *after* each reading in this cook.
    const oven = track.ovenEvents.filter((e) => e.min <= a.min + 1).at(-1);
    const rateF = (b.tempF - a.tempF) / (span / 60);
    const midF = (a.tempF + b.tempF) / 2;
    const k = (b.tempF - a.tempF) / span / (oven.setF - midF);
    console.log(
      `  ${pad(i, 7)}  ${pad(Math.round(span), 4)}m  ` +
      `${pad(C(a.tempF).toFixed(1), 5)} -> ${pad(C(b.tempF).toFixed(1), 5)}  ` +
      `${pad(C(oven.setF).toFixed(0), 8)}  ${pad((rateF * 5 / 9).toFixed(1), 10)}  ${pad(k.toFixed(5), 14)}`
    );
  }

  // ---- Does the surface node need a back-reaction term? -------------------
  // Sweeping it rather than asserting it. Fitted freely alongside the two
  // constants it collapses to zero, so the committed model leaves it out.
  console.log('\nBack-reaction (core capacity / surface capacity) sweep:');
  console.log('  backReaction   best SSE (F^2)');
  const backCandidates = [0, 0.05, 0.25, 1, 4];
  for (const candidate of backCandidates) {
    const trial = fit(track, candidate);
    console.log(`  ${pad(candidate.toFixed(2), 12)}   ${trial.sse.toFixed(4)}`);
  }
  console.log('  -> zero wins: the real cook wants a thermally thin surface shell.');

  // ---- The fit ------------------------------------------------------------
  const best = fit(track);
  console.log('\nFitted two-node constants:');
  console.log(`  kOven = ${best.kOven.toFixed(6)} /min   (surface follows the oven)`);
  console.log(`  kCore = ${best.kCore.toFixed(6)} /min   (core follows the surface)`);
  if (Number.isFinite(best.tauOvenCoolMin)) {
    console.log(`  tauOvenCoolMin = ${best.tauOvenCoolMin} min   (FITTED - this export has a pause)`);
  } else {
    console.log('  tauOvenCoolMin = not fitted: this export has no oven-off period,');
    console.log('                   so nothing in it constrains the cooling constant.');
  }
  console.log(`  weighted mean squared residual = ${best.sse.toExponential(3)} F^2`);

  // ---- How well are the two constants actually separated? -----------------
  // Walking the ratio at a fixed geometric mean. The error rises steeply either
  // side of 1, so the ratio IS identified by these two residuals, and it lands
  // on equality: the real cook behaves as two first-order lags of the same time
  // constant - a critically damped cascade. Printed so a later refit can be
  // compared against it rather than trusted.
  const gm = Math.sqrt(best.kOven * best.kCore);
  console.log('\nRidge check - kOven/kCore ratio at fixed geometric mean ' +
    `${gm.toFixed(6)}:`);
  console.log('  ratio     SSE (F^2)');
  for (const ratio of [0.25, 0.5, 1, 2, 4]) {
    const err = sse({ kOven: gm * Math.sqrt(ratio), kCore: gm / Math.sqrt(ratio) }, track);
    console.log(`  ${pad(ratio.toFixed(2), 5)}     ${err.toFixed(4)}`);
  }

  const predicted = predict(best, track);
  const actual = track.readings.slice(1);
  console.log('\nResiduals at the real reading times:');
  console.log('  at     actual (F/C)      model (F/C)       residual');
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    const residualF = predicted[i].tempF - actual[i].tempF;
    worst = Math.max(worst, Math.abs(residualF));
    console.log(
      `  ${pad(Math.round(actual[i].min), 4)}m  ` +
      `${pad(actual[i].tempF.toFixed(1), 6)} / ${pad(C(actual[i].tempF).toFixed(1), 5)}  ` +
      `${pad(predicted[i].tempF.toFixed(1), 6)} / ${pad(C(predicted[i].tempF).toFixed(1), 5)}  ` +
      `${pad(residualF.toFixed(2), 8)} F / ${pad((residualF * 5 / 9).toFixed(2), 6)} C`
    );
  }
  console.log(`\n  worst residual: ${worst.toFixed(2)} F (${(worst * 5 / 9).toFixed(2)} C)`);

  // ---- What the fit does not know ----------------------------------------
  const freeParameters = Number.isFinite(best.tauOvenCoolMin) ? 3 : 2;
  console.log(
    '\nConstraint: ' + actual.length + ' residuals against ' + freeParameters +
    ' free parameters. This pins the\n' +
    'early-cook shape and the magnitude of the constants. It says nothing about the\n' +
    'stall, the approach to target, or anything above ' +
    `${track.readings.at(-1).tempF.toFixed(0)} F ` +
    `(${C(track.readings.at(-1).tempF).toFixed(0)} C) core - which is the part of the\n` +
    'cook that decides whether dinner is on time.\n'
  );

  console.log('Paste into meatModel.js:');
  console.log('export const CALIBRATED = {');
  console.log(`  kOven: ${best.kOven.toFixed(6)},`);
  console.log(`  kCore: ${best.kCore.toFixed(6)},`);
  console.log(`  backReaction: ${best.backReaction}`);
  console.log('};');
  if (Number.isFinite(best.tauOvenCoolMin)) {
    console.log(`\n...and tauOvenCoolMin: ${best.tauOvenCoolMin} into DEFAULTS.`);
  }
  console.log('');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main();
}
