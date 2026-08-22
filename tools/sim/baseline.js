/**
 * The baseline policy layer.
 *
 * The deck does not pass today. Five cooks miss their serve time by more than
 * the tolerance, and several overshoot the target by 15-30 F. Asserting the
 * tolerance directly would leave `npm run sim` permanently red, which is the
 * same as not asserting at all - so the known misses are recorded in
 * baseline.json and the harness asserts against *those* numbers instead.
 *
 * Four verdicts per metric:
 *
 *   within tolerance          ok         the metric is where it should be; the
 *                                        baseline is not consulted at all
 *   over tolerance, <= base+m advisory   a known miss, no worse than recorded
 *   worse than base+m         ERROR      a regression
 *   better than base-ratchet  ERROR      the fix landed; re-baseline
 *
 * The last one is the point of the file. A baseline that only ever loosens is a
 * baseline nobody tightens: the improvement lands, the number stays stale, and
 * six months later the harness is asserting a bound that stopped being true.
 * Making a stale baseline a hard failure forces the fix and the tightened
 * number into the same commit.
 *
 *   npm run sim:baseline    rewrite baseline.json from the last run
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vitest rewrites import.meta.url to a non-file scheme, so the path has to be
 * derived from the working directory - which is the repo root for every command
 * that reaches this file. Same trick as report.js.
 */
export const BASELINE_PATH = resolve(process.cwd(), 'tools/sim/baseline.json');

/**
 * The metrics under baseline control, and the tolerance each one is *meant* to
 * meet. A scenario inside its tolerance never consults the baseline, so the
 * tolerances are the real acceptance thresholds; the baseline is scaffolding
 * that comes down as they are met.
 *
 *  - `tolerance`  at or under this, the metric is ok outright.
 *  - `advisory`   slack over the recorded baseline before a regression is
 *                 called. Absorbs the last digit of scenario noise, nothing
 *                 more.
 *  - `ratchet`    beat the baseline by this much and the baseline is stale.
 *                 Set per metric: 10 minutes of convergence is a real
 *                 improvement, 10 reversals is not a number that exists.
 */
export const METRIC_POLICY = {
  convergenceAbs: {
    label: '|convergence|',
    unit: 'min',
    tolerance: 20,
    advisory: 1,
    ratchet: 10
  },
  overshootF: {
    label: 'overshoot',
    unit: 'F',
    tolerance: 8,
    advisory: 1,
    ratchet: 4
  },
  blindMinutes: {
    label: 'blind minutes',
    unit: 'min',
    tolerance: 10,
    advisory: 1,
    ratchet: 5
  },
  blockedMinutes: {
    label: 'blocked minutes',
    unit: 'min',
    // No tolerance: silence is not a metric with a "good" value. Deferring
    // advice was measured inert (485 -> 1100 min of silence bought one minute
    // of accuracy), so this one is watched in BOTH directions and is never
    // simply ok - it always reports against the baseline.
    tolerance: null,
    advisory: 5,
    ratchet: 60
  },
  noAdviceMinutes: {
    label: 'no-advice minutes',
    unit: 'min',
    // The honest silence number: blocked gates plus the 'none' and 'unknown'
    // non-answers, which reach the advice band as advice. Tracked alongside
    // blockedMinutes so a change that only relabels one as the other cannot look
    // like a regression. Same both-directions treatment, same reasoning.
    tolerance: null,
    advisory: 5,
    ratchet: 60
  },
  reversals: {
    label: 'reversals',
    unit: '',
    tolerance: 2,
    advisory: 0,
    ratchet: 1
  }
};

/** The metrics, in the order a summary should list them. */
export const METRICS = Object.keys(METRIC_POLICY);

let cached = null;

/**
 * The recorded baseline, or null if there is none. Cached: the deck reads it
 * once per scenario and the file does not change mid-run.
 */
export function loadBaseline() {
  if (cached !== null) return cached;
  if (!existsSync(BASELINE_PATH)) {
    cached = { scenarios: {} };
    return cached;
  }
  cached = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return cached;
}

/** For tests, which write a baseline and then read it back. */
export function clearBaselineCache() {
  cached = null;
}

/**
 * The metrics one outcome produced, in the shape baseline.json stores.
 *
 * Takes the already-computed score rather than recomputing from rows: the
 * summary and the baseline must be describing the same numbers, and two
 * derivations of "overshoot" would eventually disagree.
 *
 * @param {Object} score - One entry from summary.json's `scenarios`
 */
export function metricsOf(score) {
  return {
    convergenceAbs: score.convergenceMinutes === null
      ? null
      : Math.abs(score.convergenceMinutes),
    overshootF: score.overshootF === null || score.overshootF === undefined
      ? null
      : Math.round(score.overshootF * 10) / 10,
    blindMinutes: score.blindMinutes,
    blockedMinutes: score.blockedMinutes,
    noAdviceMinutes: score.noAdviceMinutes,
    reversals: score.reversals
  };
}

/**
 * Judge one metric against its tolerance and its recorded baseline.
 *
 * @param {string} scenario
 * @param {string} metric - A key of METRIC_POLICY
 * @param {number|null} actual
 * @returns {{severity: 'ok'|'advisory'|'error', message: string}}
 */
export function judgeMetric(scenario, metric, actual) {
  const policy = METRIC_POLICY[metric];
  if (!policy) throw new Error(`Unknown baseline metric: ${metric}`);

  const u = policy.unit ? ` ${policy.unit}` : '';
  const show = (v) => (v === null || v === undefined ? '--' : `${v}${u}`);

  if (actual === null || actual === undefined) {
    return {
      severity: 'advisory',
      message: `${policy.label} not measurable in this cook`
    };
  }

  if (policy.tolerance !== null && actual <= policy.tolerance) {
    return {
      severity: 'ok',
      message: `${policy.label} ${show(actual)} is within the ` +
        `${show(policy.tolerance)} tolerance`
    };
  }

  const recorded = loadBaseline().scenarios?.[scenario]?.[metric];

  if (recorded === null || recorded === undefined) {
    return {
      severity: 'error',
      message: `${policy.label} ${show(actual)} is over the ` +
        `${show(policy.tolerance)} tolerance and there is no baseline for ` +
        `${scenario}. Record one with \`npm run sim:baseline\` if this is the ` +
        'state of the world, or fix it.'
    };
  }

  // The ratchet. Checked before the regression bound so that a scenario which
  // has improved past its baseline is never quietly reported as "no worse".
  if (actual <= recorded - policy.ratchet) {
    return {
      severity: 'error',
      message: `${policy.label} improved from ${show(recorded)} to ` +
        `${show(actual)} - better than the baseline by ${policy.ratchet}${u} or ` +
        'more. The baseline is stale: re-record it with ' +
        '`npm run sim:baseline` in the same commit as the fix.'
    };
  }

  if (actual <= recorded + policy.advisory) {
    return {
      severity: 'advisory',
      message: `${policy.label} ${show(actual)} is over the ` +
        `${show(policy.tolerance)} tolerance but no worse than the recorded ` +
        `baseline ${show(recorded)}`
    };
  }

  return {
    severity: 'error',
    message: `${policy.label} regressed from the baseline ${show(recorded)} to ` +
      `${show(actual)}` +
      (policy.advisory ? ` (slack ${policy.advisory}${u})` : '')
  };
}

/**
 * Rewrite baseline.json from a completed run's scores.
 *
 * @param {Array<Object>} scores - summary.json's `scenarios`
 * @param {string} [path]
 */
export function writeBaseline(scores, path = BASELINE_PATH) {
  const scenarios = {};
  for (const score of scores) scenarios[score.scenario] = metricsOf(score);
  const body = {
    // No timestamp: this file is committed, and a stamp that changes on every
    // re-record turns "did the numbers move?" into a diff nobody reads.
    note:
      'Recorded misses the simulation harness asserts against. See ' +
      'tools/sim/baseline.js. Regenerate with `npm run sim:baseline` - and only ' +
      'in the same commit as the change that moved the numbers.',
    metrics: Object.fromEntries(
      METRICS.map((m) => [m, {
        tolerance: METRIC_POLICY[m].tolerance,
        unit: METRIC_POLICY[m].unit || null
      }])
    ),
    scenarios
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return path;
}

/** Read a run's summary.json back off disk. Used by `npm run sim:baseline`. */
export function readLastSummary(dir = resolve(process.cwd(), 'tools/sim/artifacts')) {
  const path = resolve(dir, 'summary.json');
  if (!existsSync(path)) {
    throw new Error(
      `No run to baseline from: ${path} does not exist. Run \`npm run sim:report\` first.`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
