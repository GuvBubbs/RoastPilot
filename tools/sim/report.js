/**
 * Transcripts and checkpoint snapshots.
 *
 * The transcripts exist for the things assertions cannot state: a suggestion
 * that is technically in bounds but physically silly, a confidence level that
 * disagrees with the data, advice that contradicts the previous update. They are
 * meant to be read, so they are one table per cook with the substituted message
 * on the row that produced it.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateBudget, overshoot, blockedMinutes, scoreOutcome } from './score.js';

// Re-exported: these used to live here, and the transcripts are not the only
// caller any more - the invariants score an outcome too, and the two must not
// derive the same number twice. See score.js.
export { stateBudget, overshoot };

/**
 * Vitest rewrites import.meta.url to a non-file scheme, so fileURLToPath throws
 * there. Playwright and plain node give a real file URL. Try the accurate route
 * first and fall back to the repo root, which is the working directory for every
 * command that reaches this file.
 */
function artifactDir() {
  try {
    return fileURLToPath(new URL('./artifacts/', import.meta.url));
  } catch {
    return resolve(process.cwd(), 'tools/sim/artifacts');
  }
}

export const ARTIFACT_DIR = artifactDir();
export const SNAPSHOT_DIR = join(ARTIFACT_DIR, 'snapshots');
export const SHOT_DIR = join(ARTIFACT_DIR, 'shots');

const C = (f) => Math.round(((f - 32) * 5 / 9) * 10) / 10;

export function resetArtifacts() {
  // Screenshots are expensive to regenerate and are produced by a separate
  // command, so they survive a transcript rebuild.
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

const num = (v, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '--' : Number(v).toFixed(digits);

/** hh:mm of the simulated clock, plus the offset, so both readings are available. */
function clock(iso, startISO) {
  const minutes = Math.round((new Date(iso) - new Date(startISO)) / 60_000);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Markdown table escape: a pipe in a message would break the row. */
const cell = (text) => (text === null || text === undefined ? '' : String(text).replace(/\|/g, '\\|'));

export function transcript(outcome, evaluation) {
  const units = outcome.units;
  const T = (f) => (f === null || f === undefined ? '--' : units === 'C' ? num(C(f), 1) : num(f, 1));
  const lines = [];

  lines.push(`# ${outcome.scenario} — ${outcome.title}`);
  lines.push('');
  lines.push(`- **Outcome**: ${outcome.finished} after ${outcome.endedAtMin} min ` +
    `(final true core ${T(outcome.finalCoreF)}°${units})`);
  lines.push(`- **Target**: ${T(outcome.targetF)}°${units} · ` +
    `**serve** at +${outcome.serveAfterMin} min · **display units** ${units}`);
  lines.push(`- **Probe placement bias**: ${outcome.probeBiasF > 0 ? '+' : ''}` +
    `${units === 'C' ? num(outcome.probeBiasF * 5 / 9, 2) : num(outcome.probeBiasF, 2)}°${units} ` +
    '(constant for the whole cook)');
  lines.push(`- **Dial moves**: ${outcome.applied.length} ` +
    `(${outcome.applied.map((a) => a.action).join(', ') || 'none'})`);

  const over = overshoot(outcome);
  if (over.blindMinutes !== null) {
    lines.push(`- **Overshoot**: the true core passed ${T(outcome.targetF)}°${units} at ` +
      `+${num(over.trueHitAtMin)} min; the app said at-target at +${num(over.calledAtMin)} min, ` +
      `${num(over.blindMinutes)} min later. It reached ` +
      `**${T(over.coreWhenCalledF)}°${units}, ` +
      `${units === 'C' ? num(over.overshootF * 5 / 9, 1) : num(over.overshootF, 1)}` +
      `°${units} past target**.`);
  }
  lines.push('');

  lines.push('## Time in each state');
  lines.push('');
  lines.push('| state | minutes | share of cook |');
  lines.push('|---|---|---|');
  for (const [label, minutes] of stateBudget(outcome.rows)) {
    lines.push(`| \`${label}\` | ${num(minutes)} | ` +
      `${num((minutes / Math.max(1, outcome.endedAtMin)) * 100)}% |`);
  }
  lines.push('');

  lines.push('## Invariants');
  lines.push('');
  for (const f of evaluation.findings) {
    const mark = f.severity === 'ok' ? '✓' : f.severity === 'advisory' ? '~' : '✗';
    lines.push(`- ${mark} **${f.check}** — ${f.message}`);
  }
  lines.push('');

  lines.push('## Transcript');
  lines.push('');
  lines.push(`Temperatures in °${units}. "core" is the model's true core; "probe" is what ` +
    'the app was told. "oven set/eff" is the dial versus the temperature the meat ' +
    'actually sees, which lags the dial and cycles with the thermostat.');
  lines.push('');
  lines.push('| at | | core | probe | oven set/eff | rate/h | ETA | variance | conf | action | message |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');

  for (const r of outcome.rows) {
    const marker = { reading: '📖', apply: '🔧', cook: '👤', start: '▶', 'at-target': '🏁' }[r.kind] ?? '';
    const rate = r.rateFPerHour === null
      ? '--'
      : num(units === 'C' ? r.rateFPerHour * 5 / 9 : r.rateFPerHour, 1);
    const oven = r.ovenOff
      ? `off / ${T(r.ovenEffectiveF)}`
      : `${T(r.ovenSetF)} / ${T(r.ovenEffectiveF)}`;
    const eta = r.etaMinutesFromNow === null ? '--' : `${num(r.etaMinutesFromNow)}m`;
    const variance = r.varianceMinutes === null
      ? '--'
      : `${r.varianceMinutes > 0 ? '+' : ''}${num(r.varianceMinutes)}m`;
    const text = r.canRecommend
      ? cell(r.message ?? r.reasoning ?? '')
      : `⛔ ${cell(r.blockerReason ?? r.blockerType ?? '')}`;
    const note = r.note ? ` _(${cell(r.note)})_` : '';

    lines.push([
      `${clock(r.atISO, outcome.cookStartISO)} (+${num(r.atMin)})`,
      marker,
      T(r.trueCoreF),
      r.latestReadingF === null ? '--' : T(r.latestReadingF),
      oven,
      rate,
      eta,
      variance,
      r.confidence ?? '--',
      `\`${r.action}\`${r.awaitingEffect ? ' ⏳' : ''}`,
      text + note
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');

  if (outcome.applied.length) {
    lines.push('## Dial moves in full');
    lines.push('');
    lines.push('| at | action | to | note |');
    lines.push('|---|---|---|---|');
    for (const a of outcome.applied) {
      lines.push(`| +${num(a.atMin)} | \`${a.action}\` | ` +
        `${a.toDisplay ?? '--'}${a.toDisplay ? `°${units}` : ''} | ` +
        `${a.minutes ? `${a.minutes} min off` : ''} |`);
    }
    lines.push('');
  }

  lines.push('## Checkpoints captured');
  lines.push('');
  for (const s of outcome.snapshots) {
    lines.push(`- \`${s.checkpoint}\` at +${num(s.atMin)} min (${s.simNowISO})`);
  }
  lines.push('');

  return lines.join('\n');
}

export function writeScenarioArtifacts(outcome, evaluation) {
  const transcriptPath = join(ARTIFACT_DIR, `${outcome.scenario}.md`);
  ensureDir(transcriptPath);
  writeFileSync(transcriptPath, transcript(outcome, evaluation), 'utf8');

  for (const snap of outcome.snapshots) {
    const path = join(SNAPSHOT_DIR, `${outcome.scenario}--${snap.checkpoint}.json`);
    ensureDir(path);
    writeFileSync(path, JSON.stringify({
      scenario: outcome.scenario,
      title: outcome.title,
      checkpoint: snap.checkpoint,
      atMin: snap.atMin,
      simNowISO: snap.simNowISO,
      session: snap.session
    }, null, 2), 'utf8');
  }

  return transcriptPath;
}

/** One index across all eight cooks - the thing to read first. */
export function writeSummary(results) {
  const lines = [];
  lines.push('# Simulated cook harness — run summary');
  lines.push('');
  lines.push(`${results.length} scenarios. Transcripts are the per-scenario files in this ` +
    'directory; snapshots under `snapshots/` feed the screenshot pass.');
  lines.push('');
  lines.push('| scenario | ended | overshoot | blind | blocked | settling | errors |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const { outcome, evaluation } of results) {
    const over = overshoot(outcome);
    const budget = new Map(stateBudget(outcome.rows));
    const blocked = blockedMinutes(outcome.rows);
    lines.push(`| [${outcome.scenario}](./${outcome.scenario}.md) | ` +
      `${outcome.endedAtMin} min | ` +
      `${over.overshootF > 0 ? `+${num(over.overshootF, 1)} F` : '--'} | ` +
      `${over.blindMinutes === null ? '--' : `${num(over.blindMinutes)} min`} | ` +
      `${num(blocked)} min | ${num(budget.get('settling') ?? 0)} min | ` +
      `${evaluation.errors.length} |`);
  }
  lines.push('');
  lines.push('- **overshoot** — how far past target the true core went before the app said ' +
    'at-target. **blind** — how long the meat was done while the app did not know. ' +
    '**blocked** — minutes with no advice at all because an eligibility gate fired.');
  lines.push('');

  lines.push('| scenario | convergence | advisories |');
  lines.push('|---|---|---|');
  for (const { outcome, evaluation } of results) {
    const convergence = evaluation.findings.find((f) => f.check === 'convergence');
    lines.push(`| ${outcome.scenario} | ${cell(convergence?.message ?? '--')} | ` +
      `${evaluation.advisories.length} |`);
  }
  lines.push('');

  const failing = results.filter((r) => r.evaluation.errors.length);
  if (failing.length) {
    lines.push('## Every finding, by scenario');
    lines.push('');
    for (const { outcome, evaluation } of failing) {
      lines.push(`### ${outcome.scenario}`);
      lines.push('');
      for (const f of evaluation.errors) lines.push(`- **${f.check}** — ${f.message}`);
      lines.push('');
    }
  } else {
    lines.push('No invariant errors across the deck.');
    lines.push('');
  }

  const path = join(ARTIFACT_DIR, 'SUMMARY.md');
  ensureDir(path);
  writeFileSync(path, lines.join('\n'), 'utf8');

  // Machine-readable twin, so a candidate change can be scored against the deck
  // rather than eyeballed. See tools/sim/README.md - "Testing a change".
  // This file is also what `npm run sim:baseline` reads to re-record the
  // baseline, so the numbers here and the numbers asserted are the same numbers.
  writeFileSync(join(ARTIFACT_DIR, 'summary.json'),
    JSON.stringify({
      scenarios: results.map(({ outcome, evaluation }) => ({
        ...scoreOutcome(outcome),
        errors: evaluation.errors.length
      }))
    }, null, 2), 'utf8');

  return path;
}
