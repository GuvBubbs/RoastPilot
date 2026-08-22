/**
 * The numbers a cook is judged by, derived from the outcome alone.
 *
 * Split out of report.js because two consumers need them and they must not
 * disagree: the transcripts report them, and the invariants assert them against
 * tools/sim/baseline.json. Deriving "overshoot" twice would eventually produce
 * two different overshoots.
 *
 * Nothing here reads an evaluation, so the invariants can score an outcome
 * while they are still deciding what to say about it.
 */

const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

/**
 * How long the cook spent in each recommendation state.
 *
 * The single most useful number in a transcript turned out to be this one: a
 * state that is correct but occupies two hours of a three hour cook is a
 * different thing from the same state occupying five minutes, and reading it off
 * a 40-row table by eye does not work.
 *
 * Each row holds until the next one, so a row's weight is the gap after it.
 */
export function stateBudget(rows) {
  const spans = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const until = rows[i + 1]?.atMin ?? r.atMin;
    const minutes = until - r.atMin;
    if (minutes <= 0) continue;
    const label = r.canRecommend ? r.action : `blocked: ${r.blockerType ?? 'unknown'}`;
    spans.set(label, (spans.get(label) ?? 0) + minutes);
  }
  return [...spans.entries()].sort((a, b) => b[1] - a[1]);
}

/** How far past target the meat went before the app noticed. */
export function overshoot(outcome) {
  const atTarget = outcome.rows.find((r) => r.action === 'at-target');
  const trueHit = outcome.rows.find((r) => r.trueCoreF >= outcome.targetF);
  return {
    calledAtMin: atTarget?.atMin ?? null,
    trueHitAtMin: trueHit?.atMin ?? null,
    coreWhenCalledF: atTarget?.trueCoreF ?? outcome.finalCoreF,
    overshootF: (atTarget?.trueCoreF ?? outcome.finalCoreF) - outcome.targetF,
    blindMinutes: atTarget && trueHit ? atTarget.atMin - trueHit.atMin : null
  };
}

/** Minutes with no advice at all because an eligibility gate fired. */
export function blockedMinutes(rows) {
  return stateBudget(rows)
    .filter(([label]) => label.startsWith('blocked:'))
    .reduce((n, [, m]) => n + m, 0);
}

/**
 * |serve time - the moment the TRUE core reached target|, signed: positive is
 * late. Null if the cook never got there.
 *
 * Measured on the true core, not on the probe: the app can only be as right as
 * the probe lets it be, but the question a cook cares about is when the meat was
 * actually done.
 */
export function convergenceMinutes(outcome) {
  const hit = outcome.rows.find((r) => r.trueCoreF >= outcome.targetF);
  if (!hit) return null;
  return Math.round(minutesBetween(outcome.serveISO, hit.atISO));
}

/** Direction reversals across one cook: a raise answered by a lower, or back. */
export function countReversals(applied) {
  const moves = applied.filter((a) => a.action === 'raise' || a.action === 'lower');
  let reversals = 0;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].action !== moves[i - 1].action) reversals++;
  }
  return { moves: moves.length, reversals };
}

/** The numbers that decide whether a candidate change helped. */
export function scoreOutcome(outcome) {
  const over = overshoot(outcome);
  const budget = new Map(stateBudget(outcome.rows));
  const { moves, reversals } = countReversals(outcome.applied);
  return {
    scenario: outcome.scenario,
    finished: outcome.finished,
    reachedTarget: over.trueHitAtMin !== null,
    endedAtMin: outcome.endedAtMin,
    overshootF: over.overshootF,
    blindMinutes: over.blindMinutes,
    convergenceMinutes: convergenceMinutes(outcome),
    blockedMinutes: blockedMinutes(outcome.rows),
    settlingMinutes: budget.get('settling') ?? 0,
    dialMoves: moves,
    reversals
  };
}
