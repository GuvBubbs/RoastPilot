/**
 * Runs the whole deck, writes the artifacts, then asserts the invariants.
 *
 * Two entry points share this file:
 *   npm run sim       SIM_REPORT_ONLY=1 - write everything, assert nothing
 *   npm run sim:test  assert
 *
 * One code path rather than two deliberately: a reporting run and an asserting
 * run that could drift apart would eventually disagree about what happened.
 *
 * NOT part of the deploy gate. vitest.config.js excludes tools/**, so
 * `npm run test:run` - which .github/workflows/deploy.yml runs - never sees this.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SCENARIOS } from './scenarios.js';
import { runScenario, loadAppModules } from './driver.js';
import { evaluate } from './invariants.js';
import { resetArtifacts, writeScenarioArtifacts, writeSummary, ARTIFACT_DIR } from './report.js';

const REPORT_ONLY = process.env.SIM_REPORT_ONLY === '1';
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
      writeScenarioArtifacts(outcome, evaluation);
      results.push({ outcome, evaluation });

      if (REPORT_ONLY) {
        for (const f of evaluation.errors) {
          // eslint-disable-next-line no-console
          console.log(`  [${scenario.name}] ${f.check}: ${f.message}`);
        }
        return;
      }

      const report = evaluation.errors
        .map((f) => `  ${f.check}: ${f.message}`)
        .join('\n');
      expect(report, `${scenario.name} invariant failures:\n${report}`).toBe('');
    }, 120_000);
  }
});
