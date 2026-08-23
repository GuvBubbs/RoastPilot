/**
 * Rewrite tools/sim/baseline.json from the last simulation run.
 *
 *   npm run sim:baseline
 *
 * A separate entry point rather than a flag on baseline.js: that module is
 * imported by the invariants under vitest, and a main-guard there would be one
 * more thing that has to be right for the harness to be trustworthy.
 *
 * Run this ONLY in the same commit as the change that moved the numbers. The
 * whole point of the ratchet in baseline.js is that a stale baseline fails; a
 * habit of re-recording to make the red go away defeats it exactly.
 */
import { readFileSync } from 'node:fs';
import { writeBaseline, readLastSummary, BASELINE_PATH, METRICS, metricsOf } from './baseline.js';

const summary = readLastSummary();
// Read the outgoing baseline before it is overwritten, so the table below can
// show what moved. A missing or unparseable file is the first-run case.
const before = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).scenarios ?? {};
  } catch {
    return {};
  }
})();

writeBaseline(summary.scenarios);

const width = Math.max(...summary.scenarios.map((s) => s.scenario.length));
console.log(`\nBaseline rewritten: ${BASELINE_PATH}\n`);
console.log(`  ${'scenario'.padEnd(width)}  ${METRICS.map((m) => m.padStart(16)).join('')}`);
for (const score of summary.scenarios) {
  const now = metricsOf(score);
  const cells = METRICS.map((m) => {
    const was = before[score.scenario]?.[m];
    const is = now[m];
    const text = was === undefined || was === is ? String(is) : `${was} -> ${is}`;
    return text.padStart(16);
  });
  console.log(`  ${score.scenario.padEnd(width)}  ${cells.join('')}`);
}
console.log('\nCommit this alongside the change that moved the numbers.\n');
