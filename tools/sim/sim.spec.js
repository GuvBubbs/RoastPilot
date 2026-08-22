/**
 * Runs the whole deck, writes the artifacts, then asserts the invariants.
 *
 *   npm run sim             run the deck and assert
 *   npm run sim:baseline    run the deck, then re-record baseline.json from it
 *
 * There is one entry point and it asserts. There used to be a SIM_REPORT_ONLY
 * mode that wrote every transcript and asserted nothing, and `npm run sim` -
 * the obvious command, the one in the README, the one anybody actually types -
 * was wired to it. A harness that cannot fail is not a harness.
 *
 * The transcripts and summary.json are still written on a failing run: the
 * artifacts are written per scenario before anything is asserted, and the
 * summary in afterAll runs either way. So a red run still leaves everything
 * needed to see why, and `npm run sim:baseline` can still re-record from it.
 *
 * Known misses are absorbed by tools/sim/baseline.json rather than by silence -
 * see baseline.js. A cook that is over tolerance but no worse than its recorded
 * baseline is an advisory; one that regressed, or one that IMPROVED past its
 * baseline, is an error.
 *
 * Runs on every pull request via .github/workflows/test.yml. Deliberately not
 * in the same vitest project as the unit suite: vitest.config.js excludes
 * tools/**, so `npm run test:run` never sees this file.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SCENARIOS } from './scenarios.js';
import { runScenario, loadAppModules } from './driver.js';
import { evaluate } from './invariants.js';
import { resetArtifacts, writeScenarioArtifacts, writeSummary, ARTIFACT_DIR } from './report.js';

const ONLY = process.env.SIM_ONLY;

/**
 * Settings applied on top of every scenario's own, from a JSON env var. This is
 * how a proposed change gets measured against the deck instead of argued about:
 *
 *   SIM_SETTINGS='{"ovenTempStaleMinutes":100000}' npm run sim
 *
 * Only useful for changes expressible as settings. Anything deeper has to be
 * tried in src/ and re-run.
 */
const SETTINGS_OVERRIDE = process.env.SIM_SETTINGS
  ? JSON.parse(process.env.SIM_SETTINGS)
  : null;

const deck = ONLY ? SCENARIOS.filter((s) => s.name.includes(ONLY)) : SCENARIOS;
const results = [];

beforeAll(() => {
  resetArtifacts();
});

afterAll(() => {
  if (!results.length) return;
  const summary = writeSummary(results);
  const errors = results.reduce((n, r) => n + r.evaluation.errors.length, 0);
  // eslint-disable-next-line no-console
  console.log(
    `\n${results.length} cooks simulated, ${errors} invariant error(s).` +
    `\nTranscripts: ${ARTIFACT_DIR}\nSummary: ${summary}\n`
  );
});

describe('simulated long cooks', () => {
  for (const scenario of deck) {
    it(`${scenario.name} — ${scenario.title}`, async () => {
      // Fake timers before the module load: useRefreshTimer's interval and the
      // autosave debounce both have to be created against the fake clock.
      vi.useFakeTimers();
      let outcome;
      try {
        const deps = await loadAppModules(vi);
        const subject = SETTINGS_OVERRIDE
          ? { ...scenario, settings: { ...scenario.settings, ...SETTINGS_OVERRIDE } }
          : scenario;
        outcome = await runScenario(subject, { vi, ...deps });
      } finally {
        vi.useRealTimers();
      }

      const evaluation = evaluate(outcome);
      // Before the assertion, so a failing cook still leaves its transcript.
      writeScenarioArtifacts(outcome, evaluation);
      results.push({ outcome, evaluation });

      const report = evaluation.errors
        .map((f) => `  ${f.check}: ${f.message}`)
        .join('\n');
      expect(report, `${scenario.name} invariant failures:\n${report}`).toBe('');
    }, 120_000);
  }
});
