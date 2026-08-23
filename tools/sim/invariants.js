/**
 * The properties of the recommendation loop that can be stated numerically.
 *
 * Everything that cannot be is left to the transcripts and the screenshots.
 * Each check returns findings rather than throwing, so one scenario's failure
 * never hides the next scenario's, and so `npm run sim` can write every
 * transcript before anything is asserted.
 */
import { celsiusToFahrenheit } from '../../src/utils/temperatureUtils.js';
import { assessOvenChangeEffect } from '../../src/services/recommendationService.js';
import { METRICS, METRIC_POLICY, judgeMetric, metricsOf } from './baseline.js';
import { scoreOutcome } from './score.js';

/** Convergence tolerance: |target reached - serve time|, in minutes. */
export const CONVERGENCE_TOLERANCE_MIN = 20;
/** Direction reversals allowed across one cook. */
export const MAX_REVERSALS = 2;

const toF = (temp, units) => (units === 'C' ? celsiusToFahrenheit(temp) : temp);
const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

function finding(check, severity, message, detail = {}) {
  return { check, severity, message, detail };
}

/** The dial moves the app itself asked for, in order. */
const dialMoves = (outcome) =>
  outcome.applied.filter((a) => a.action === 'raise' || a.action === 'lower');

/**
 * Did the cook land near its serve time?
 *
 * Measured on the TRUE core, not on the probe: the app can only be as right as
 * the probe lets it be, but the question a cook cares about is when the meat was
 * actually done.
 */
export function checkConvergence(outcome) {
  const out = [];
  const hit = outcome.rows.find((r) => r.trueCoreF >= outcome.targetF);
  // The instant the meat has to be OUT of the oven: the serve time less the
  // rest. Identical to the serve time when no rest is declared.
  const deadlineISO = outcome.pullDeadlineISO ?? outcome.serveISO;
  const restNote = outcome.restMinutes
    ? ` (serve less ${outcome.restMinutes} min rest)`
    : '';

  if (!hit) {
    const shortfall = outcome.targetF - outcome.finalCoreF;
    // The app can only be as right as the probe lets it be. A cook stopped
    // within the probe's own placement bias of the target is the probe's limit,
    // not a control-loop failure - but the number stays on the record, because a
    // roast pulled 1 F short is a different dinner from one pulled 10 F short.
    const withinProbeError = outcome.finished === 'at-target' &&
      shortfall <= Math.abs(outcome.probeBiasF) + 1;
    out.push(finding('convergence', withinProbeError ? 'advisory' : 'error',
      withinProbeError
        ? `called at-target at ${outcome.endedAtMin} min with the true core ` +
          `${shortfall.toFixed(1)} F short of ${outcome.targetF} F - inside the ` +
          `probe's ${outcome.probeBiasF.toFixed(1)} F placement bias`
        : `never reached ${outcome.targetF} F: ended at ${outcome.finalCoreF} F after ` +
          `${outcome.endedAtMin} min (${outcome.finished})`,
      { shortfall }));
    return out;
  }

  const variance = Math.round(minutesBetween(deadlineISO, hit.atISO));
  const label = variance >= 0 ? `${variance} min late` : `${-variance} min early`;

  // Severity comes from the baseline policy, not from the tolerance alone.
  // Five cooks on this deck miss by more than the tolerance today; asserting
  // the tolerance raw would leave the harness permanently red, which is
  // indistinguishable from not asserting. See tools/sim/baseline.js.
  //
  // `advisoryConvergence` still short-circuits ahead of it: that flag says the
  // scenario is ABOUT something else (06 exists to have a reading gap), which
  // is a different statement from "this number is a known miss".
  const verdict = outcome.advisoryConvergence
    ? { severity: 'advisory', message: 'convergence is advisory for this scenario' }
    : judgeMetric(outcome.scenario, 'convergenceAbs', Math.abs(variance));

  out.push(finding('convergence', verdict.severity,
    `pull temperature reached at ${hit.atMin} min, ${label} against the pull ` +
    `deadline${restNote} (tolerance ${CONVERGENCE_TOLERANCE_MIN} min) - ${verdict.message}`,
    { varianceMinutes: variance, atMin: hit.atMin }));
  return out;
}

/**
 * Reversals: raise answered by lower, or the other way round. A control loop
 * that hunts is worse than one that is slightly wrong, because the cook has to
 * get up each time.
 */
export function checkNoFlapping(outcome) {
  const out = [];
  const moves = dialMoves(outcome);
  const lag = outcome.settings.ovenChangeLagMinutes ?? 15;
  const readingTimes = outcome.rows.filter((r) => r.kind === 'reading').map((r) => r.atMin);
  const reversals = [];

  for (let i = 1; i < moves.length; i++) {
    if (moves[i].action !== moves[i - 1].action) reversals.push([moves[i - 1], moves[i]]);
  }

  if (reversals.length > MAX_REVERSALS) {
    out.push(finding('no-flapping', 'error',
      `${reversals.length} direction reversals (limit ${MAX_REVERSALS}): ` +
      reversals.map(([a, b]) => `${a.action}@${a.atMin}->${b.action}@${b.atMin}`).join(', '),
      { reversals: reversals.length }));
  } else {
    out.push(finding('no-flapping', 'ok', `${reversals.length} direction reversals`));
  }

  // The harder half: a reversal inside one lag window with no new reading
  // between the two moves is the app arguing with itself about data it does not
  // have yet.
  for (const [first, second] of reversals) {
    const span = second.atMin - first.atMin;
    const readingBetween = readingTimes.some((t) => t > first.atMin && t <= second.atMin);
    if (span <= lag && !readingBetween) {
      out.push(finding('no-flapping', 'error',
        `${first.action} at ${first.atMin} min reversed to ${second.action} at ` +
        `${second.atMin} min - inside the ${lag} min lag window with no reading between`,
        { first, second }));
    }
  }
  return out;
}

/**
 * Every suggestion has to be a temperature the oven can be set to and the
 * settings allow.
 */
export function checkBounds(outcome) {
  const out = [];
  const s = outcome.settings;
  const units = outcome.units;
  const practicalMin = s.ovenTempPracticalMinF ?? 175;
  let breaches = 0;
  let boundedSteps = 0;
  const oversized = new Set();

  for (const r of outcome.rows) {
    if (r.suggestedTempDisplay === null || r.suggestedTempDisplay === undefined) continue;
    const suggestedF = toF(r.suggestedTempDisplay, units);

    if (suggestedF < s.ovenTempMinF - 0.6 || suggestedF > s.ovenTempMaxF + 0.6) {
      breaches++;
      out.push(finding('bounds', 'error',
        `suggested ${suggestedF.toFixed(1)} F at ${r.atMin} min is outside ` +
        `[${s.ovenTempMinF}, ${s.ovenTempMaxF}]`, { row: r.atMin }));
    }

    // The practical minimum is a floor on advice, not on the oven: the service
    // clamps to the lowest *settable* value at or above it, so allow a dial
    // increment of slack.
    if ((r.action === 'raise' || r.action === 'lower') && suggestedF < practicalMin - 5.4) {
      breaches++;
      out.push(finding('bounds', 'error',
        `suggested ${suggestedF.toFixed(1)} F at ${r.atMin} min is below the ` +
        `practical minimum ${practicalMin} F (enableLowTempRecommendations=` +
        `${s.enableLowTempRecommendations})`, { row: r.atMin }));
    }

    if (r.changeAmountDisplay) {
      const changeF = units === 'C' ? r.changeAmountDisplay * 9 / 5 : r.changeAmountDisplay;
      if (changeF > s.recommendationMaxStepF + 0.6) {
        // Two legitimate ways to exceed the step limit, neither a defect:
        //
        //  - a clamp: the suggestion landed on a guardrail, so the service had
        //    no smaller legal value to offer;
        //  - a retarget: while a change is unmeasured, reconcileWithOvenChange
        //    restates the projection's target as an ABSOLUTE temperature rather
        //    than deriving a step from the current dial - that is precisely how
        //    it avoids stacking changes. The distance from wherever the cook put
        //    the dial back to that target is not a step and is not bounded by
        //    one.
        //
        // Both are counted and reported in the ok line rather than silently
        // dropped, because the amount still reaches the screen as a "-50°F"
        // chip and that is a legibility question worth seeing.
        const onBound = [s.ovenTempMinF, s.ovenTempMaxF, practicalMin]
          .some((bound) => Math.abs(suggestedF - bound) <= 5.4);
        if (onBound || r.awaitingEffect) {
          boundedSteps++;
          oversized.add(`${changeF.toFixed(0)} F at +${r.atMin} min ` +
            `(${r.awaitingEffect ? 'retarget while unmeasured' : 'clamped to a guardrail'})`);
        } else {
          breaches++;
          out.push(finding('bounds', 'error',
            `change of ${changeF.toFixed(1)} F at ${r.atMin} min exceeds ` +
            `recommendationMaxStepF ${s.recommendationMaxStepF}`, { row: r.atMin }));
        }
      }
    }
  }

  if (breaches === 0) {
    out.push(finding('bounds', 'ok',
      `every suggestion inside [${s.ovenTempMinF}, ${s.ovenTempMaxF}] and >= ` +
      `${practicalMin} F` +
      (boundedSteps
        ? `; ${boundedSteps} change amount(s) over the ${s.recommendationMaxStepF} F ` +
          `step limit by design - ${[...oversized].join('; ')}`
        : '')));
  }
  return out;
}

/**
 * The b823705 regression, stated as a property: an oven change must not be
 * charged for twice.
 *
 * Two halves.
 *
 * (a) While a change is younger than ovenChangeLagMinutes, the app must know it
 *     is waiting - awaitingEffect true. Anything else means the projection is
 *     being read as if it had already seen the change.
 *
 * (b) Consecutive moves in the same direction, DERIVED FROM THE SAME
 *     MEASUREMENT, must not in total go further than the first of them asked for
 *     by more than one step. The plan states this without the qualifier, but
 *     escalating after a reading has shown the previous change was not enough is
 *     correct behaviour, not a bug - the property that matters is that the app
 *     never re-charges for a change it has not measured. "The same measurement"
 *     is read off the evidence set point; see the note on newEvidenceBetween.
 */
export function checkNoDoubleCharging(outcome) {
  const out = [];
  const s = outcome.settings;
  const lag = s.ovenChangeLagMinutes ?? 15;
  const step = s.recommendationStepF ?? 10;
  const units = outcome.units;
  const moves = dialMoves(outcome);
  let breaches = 0;

  // ---- (a) the UI's settling state agrees with the service ---------------
  // Asserted against the app's own assessOvenChangeEffect, re-run at each row's
  // instant, rather than against a restatement of its rules here. The point of
  // this check is the WIRING: whether useRecommendations passes the right `now`,
  // the right event list (off events included), and surfaces the result. A
  // harness that reimplemented the settling rules would agree with itself and
  // learn nothing.
  //
  // It also encodes the two behaviours the service documents and a naive
  // restatement gets wrong: a dial moved away and back nets out, and a change
  // is only unsettled while the readings still describe an older set point.
  for (const r of outcome.rows) {
    if (!r.ovenHistory || !r.readingTimes) continue;
    // at-target and every blocker short-circuit ahead of the settling branch by
    // design, so awaitingEffect is legitimately false there.
    if (r.action === 'at-target' || !r.canRecommend) continue;
    if (r.action === 'needs-reading') continue;
    // The oven is off, so the settling question is moot: the projection cannot
    // describe a set point that is not in force. Restart is the only advice.
    if (r.action === 'restart-oven') continue;

    const truth = assessOvenChangeEffect({
      readings: r.readingTimes.map((timestamp) => ({ timestamp })),
      ovenEvents: r.ovenHistory,
      settings: outcome.settings,
      now: r.atISO
    });

    if (truth.settled === r.awaitingEffect) {
      breaches++;
      out.push(finding('no-double-charging', 'error',
        `at ${r.atMin} min the service says ${truth.settled ? 'settled' : 'NOT settled'} ` +
        `(evidence ${truth.evidenceTemp} F, dial ${truth.currentTemp} F) but the UI ` +
        `shows awaitingEffect=${r.awaitingEffect}, action "${r.action}"`,
        { row: r.atMin, truth }));
    }

    // The substantive half of (a): while a change is unmeasured, the advice must
    // be anchored to the measured set point. `settling`, or a retarget naming an
    // absolute temperature, are both fine; a fresh raise/lower derived from the
    // new set point is the double charge.
    if (!truth.settled && r.action !== 'settling' &&
        (r.action === 'raise' || r.action === 'lower')) {
      const suggestedF = toF(r.suggestedTempDisplay, units);
      // The retarget branch restates the projection's absolute target, so the
      // suggestion must not be a step away from where the dial already is.
      if (Math.abs(suggestedF - truth.currentTemp) <= (s.recommendationStepF ?? 10) * 0.5) {
        breaches++;
        out.push(finding('no-double-charging', 'error',
          `at ${r.atMin} min an unmeasured change is answered with "${r.action}" to ` +
          `${suggestedF.toFixed(0)} F, one step off the current dial ` +
          `${truth.currentTemp} F - the change is being charged for twice`,
          { row: r.atMin }));
      }
    }
  }

  // ---- (b) unsettled moves in one direction do not compound --------------
  //
  // "Unsettled" needs care, and the first attempt at it was wrong once the
  // reading prompt made readings dense.
  //
  // The property is that the app never re-charges for a change it has not
  // MEASURED. Walking the oven down five steps because each new reading says the
  // roast is earlier still than the last one said is not that - it is the loop
  // working. 04 does exactly that: 250 F against a four-hour serve, the variance
  // going +15 -> -26 -> -110 as the rate climbs, and the dial stepping down from
  // 235 to 185 over five readings. Every step is one increment off the newest
  // MEASURED set point, in response to information the app did not have before.
  //
  // Requiring a fully settled row between moves called that a 50 F double
  // charge, because with ovenChangeSettleReadings = 2 the evidence set point
  // trails the dial and awaitingEffect is still true when the next reading
  // arrives.
  //
  // So the discriminator is the EVIDENCE SET POINT, which is the precise
  // statement of "what have the readings actually measured":
  //
  //   evidence moved between the two moves   new ground; a further step is a
  //                                          response, not a re-charge
  //   evidence unchanged                     both moves were derived from the
  //                                          same measurement - that is stacking
  //
  // Read off the app's own assessOvenChangeEffect at each move's instant rather
  // than restated here, for the same reason half (a) is.
  const evidenceAt = (atMin) => {
    // The row stamped by the driver at the moment the dial moved carries the
    // session as it then stood.
    const row = outcome.rows.find((r) => r.kind === 'apply' && Math.abs(r.atMin - atMin) < 0.01)
      ?? [...outcome.rows].reverse().find((r) => r.atMin <= atMin && r.ovenHistory);
    if (!row?.ovenHistory) return null;
    return assessOvenChangeEffect({
      readings: (row.readingTimes ?? []).map((timestamp) => ({ timestamp })),
      ovenEvents: row.ovenHistory,
      settings: outcome.settings,
      now: row.atISO
    }).evidenceTemp;
  };

  const newEvidenceBetween = (previousMove, move) => {
    const before = evidenceAt(previousMove.atMin);
    const after = evidenceAt(move.atMin);
    return before !== null && after !== null && before !== after;
  };

  let run = [];
  const flushRun = () => {
    if (run.length < 2) { run = []; return; }
    const firstAskF = run[0].toF;
    const finalF = run[run.length - 1].toF;
    const overshoot = run[0].action === 'raise' ? finalF - firstAskF : firstAskF - finalF;
    if (overshoot > step + 0.6) {
      breaches++;
      out.push(finding('no-double-charging', 'error',
        `${run.length} unsettled ${run[0].action} moves compounded from ` +
        `${firstAskF.toFixed(0)} F to ${finalF.toFixed(0)} F - ` +
        `${overshoot.toFixed(0)} F past the first ask, more than one ${step} F step`,
        { run: run.map((m) => ({ atMin: m.atMin, toF: m.toF })) }));
    }
    run = [];
  };

  for (const move of moves) {
    const moveF = move.toF ?? toF(move.toDisplay, units);
    const enriched = { ...move, toF: moveF };
    if (run.length === 0) { run = [enriched]; continue; }
    const previous = run[run.length - 1];
    if (move.action !== previous.action || newEvidenceBetween(previous, move)) {
      flushRun();
      run = [enriched];
    } else {
      run.push(enriched);
    }
  }
  flushRun();

  if (breaches === 0) {
    out.push(finding('no-double-charging', 'ok',
      `${moves.length} dial move(s), none charged twice`));
  }
  return out;
}

/** Fields a screen actually renders. A NaN here is a NaN on the dashboard. */
const DISPLAYED_NUMERIC = [
  'rateFPerHour', 'etaMinutesFromNow', 'varianceMinutes',
  'suggestedTempDisplay', 'changeAmountDisplay', 'waitMinutes'
];

export function checkSaneNumbers(outcome) {
  const out = [];
  let breaches = 0;

  for (const r of outcome.rows) {
    for (const field of DISPLAYED_NUMERIC) {
      const v = r[field];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        breaches++;
        out.push(finding('sane-numbers', 'error',
          `${field} is ${String(v)} at ${r.atMin} min`, { row: r.atMin }));
      }
    }
    for (const field of ['timeRemainingFormatted', 'varianceFormatted']) {
      if (typeof r[field] === 'string' && /NaN|Infinity|undefined|null/.test(r[field])) {
        breaches++;
        out.push(finding('sane-numbers', 'error',
          `${field} renders as "${r[field]}" at ${r.atMin} min`, { row: r.atMin }));
      }
    }

    // A projected finish before the reading it was projected from is nonsense.
    if (r.predictedTargetTime && r.latestReadingISO) {
      const slack = minutesBetween(r.latestReadingISO, r.predictedTargetTime);
      if (slack < -0.6) {
        breaches++;
        out.push(finding('sane-numbers', 'error',
          `predictedTargetTime is ${(-slack).toFixed(1)} min before the last ` +
          `reading at ${r.atMin} min`, { row: r.atMin }));
      }
    }
  }

  /**
   * Between readings the projected finish time is a fixed point; only the
   * distance to it may move. Anything else means the clock is feeding back into
   * the projection.
   *
   * The anchor resets on a change in the OVEN EVENT COUNT, not on `kind ===
   * 'reading'`. The old rule was right for an oven-blind projection: only a new
   * reading could move it, so a row of kind 'apply' was a row whose projection
   * had better not have changed. The projection now integrates the actual dial
   * timeline, so a dial change legitimately moves the finish time with no reading
   * in between - which is the whole point of modelling the oven.
   *
   * Both resets are needed. A reading is new evidence; an oven change is a new
   * future. Anything else that moves the number is the bug this check is for.
   */
  let anchor = null;
  let ovenEventCount = null;
  for (const r of outcome.rows) {
    const events = r.ovenHistory ? r.ovenHistory.length : ovenEventCount;
    if (r.kind === 'reading' || events !== ovenEventCount) anchor = null;
    ovenEventCount = events;
    if (!r.predictedTargetTime) { anchor = null; continue; }
    if (anchor === null) { anchor = r; continue; }
    if (r.predictedTargetTime !== anchor.predictedTargetTime) {
      breaches++;
      out.push(finding('sane-numbers', 'error',
        `predictedTargetTime moved from ${anchor.predictedTargetTime} to ` +
        `${r.predictedTargetTime} between ${anchor.atMin} and ${r.atMin} min with ` +
        'no reading in between', { row: r.atMin }));
      anchor = r;
      continue;
    }
    if (r.etaMinutesFromNow !== null && anchor.etaMinutesFromNow !== null &&
        r.etaMinutesFromNow > anchor.etaMinutesFromNow + 0.6) {
      breaches++;
      out.push(finding('sane-numbers', 'error',
        `ETA grew from ${anchor.etaMinutesFromNow} to ${r.etaMinutesFromNow} min ` +
        `between ${anchor.atMin} and ${r.atMin} min with no reading in between`,
        { row: r.atMin }));
    }
    anchor = r;
  }

  if (breaches === 0) {
    out.push(finding('sane-numbers', 'ok',
      'no NaN/Infinity in a displayed field; projection anchored and monotonic'));
  }
  return out;
}

const PLACEHOLDER = /\{[a-zA-Z]\w*\}/;
const TEXT_FIELDS = ['message', 'alternativeMessage', 'reasoning', 'blockerReason'];

/**
 * Checked on the SUBSTITUTED output of useRecommendations, which is what reaches
 * the screen - the service's own strings are templates and are supposed to
 * contain placeholders.
 */
export function checkRenderedText(outcome) {
  const out = [];
  const seen = new Set();

  for (const r of outcome.rows) {
    for (const field of TEXT_FIELDS) {
      const text = r[field];
      if (typeof text !== 'string') continue;
      const match = text.match(PLACEHOLDER);
      if (!match) continue;
      const key = `${field}:${match[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding('rendered-text', 'error',
        `unsubstituted ${match[0]} in ${field} at ${r.atMin} min (action ` +
        `"${r.action}"): ${text}`, { row: r.atMin, field }));
    }
  }

  /**
   * THE WRONG UNIT, WHICH IS THE OTHER HALF OF THIS CHECK.
   *
   * The scan above only finds placeholders that failed to substitute, and a
   * hardcoded literal is not a placeholder - so a Celsius cook was shown "not safe
   * until the core is above 140°F" and "25°F above your 191°F pull" beside a screen
   * reading 88 °C, five times in one cook, and this invariant reported no problem.
   * Three separate sentences were assembling their own degree symbols in the
   * service instead of emitting a placeholder for the substitution layer.
   *
   * A cook running in one unit must never be shown the other. Cheap to check and
   * it closes the class rather than the three instances.
   */
  const wrongUnit = outcome.units === 'C' ? /°\s?F\b/ : /°\s?C\b/;
  let unitBreaches = 0;

  for (const r of outcome.rows) {
    for (const field of TEXT_FIELDS) {
      const text = r[field];
      if (typeof text !== 'string') continue;
      if (!wrongUnit.test(text)) continue;
      const key = `unit:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unitBreaches++;
      out.push(finding('rendered-text', 'error',
        `a ${outcome.units === 'C' ? 'Fahrenheit' : 'Celsius'} temperature reached ` +
        `${field} in a ${outcome.units} cook at ${r.atMin} min (action ` +
        `"${r.action}"): ${text}`, { row: r.atMin, field }));
    }
  }

  if (seen.size === 0) {
    out.push(finding('rendered-text', 'ok',
      `no unsubstituted placeholders reached the screen, and nothing was shown in ` +
      `the wrong unit for a ${outcome.units} cook`));
  }
  return out;
}

export function checkTerminalState(outcome) {
  const last = outcome.rows[outcome.rows.length - 1];
  if (outcome.finished === 'at-target' && last.action === 'at-target') {
    return [finding('terminal-state', 'ok', 'ended at-target')];
  }
  return [finding('terminal-state', 'error',
    `ended "${outcome.finished}" with action "${last.action}"` +
    (last.blockerType ? ` (blocker: ${last.blockerType})` : ''),
    { finished: outcome.finished, action: last.action, blockerType: last.blockerType })];
}


/**
 * The acceptance metrics, each against its tolerance and its recorded baseline.
 *
 * Convergence has its own check above, which says more about *what* happened;
 * this one covers the rest of the deck's numbers - overshoot, blind minutes,
 * blocked minutes, reversals - so that every acceptance threshold in the plan
 * is enforced by the harness rather than by someone reading SUMMARY.md.
 *
 * blockedMinutes is watched in both directions on purpose. A new eligibility
 * gate is a new way to fall silent, and silence alone was measured inert:
 * deferring advice took the deck from 485 to 1100 minutes of no advice at all
 * and bought one minute of accuracy.
 */
export function checkAcceptanceMetrics(outcome) {
  // Through metricsOf, not off the raw score: that is the function
  // baseline.json is written with, so the number asserted here is bit-for-bit
  // the number recorded there. Comparing a raw 17.900000000000006 against a
  // stored 17.9 would put float dust into every message.
  const metrics = metricsOf(scoreOutcome(outcome));
  const out = [];

  for (const metric of METRICS) {
    // Convergence is reported by checkConvergence, which has the context to say
    // whether the cook even reached target.
    if (metric === 'convergenceAbs') continue;
    const value = metrics[metric];
    const verdict = judgeMetric(outcome.scenario, metric, value);
    out.push(finding('acceptance', verdict.severity, verdict.message,
      { metric, value, tolerance: METRIC_POLICY[metric].tolerance }));
  }

  return out;
}


/**
 * The app must not advise from evidence it has admitted is stale.
 *
 * "On track for serve time" printed beside a three-hour-old reading is the
 * contradiction the missing reading prompt used to produce, and it is the one
 * thing the forgetful cook - who ignores the prompt entirely - is there to test.
 * The app cannot make that cook take a reading; it can decline to pretend it
 * knows where the roast is.
 *
 * Asserted against the app's OWN staleness setting rather than a number restated
 * here, so raising the setting cannot silently widen the window this check
 * allows.
 */
/**
 * How far the TRUE core may drift, in degrees, between the reading a piece of
 * advice rests on and the moment that advice is given.
 *
 * Owned by the harness, deliberately not by the app. The minutes half of this
 * check reads `settings.staleReadingMinutes`, which makes it a consistency
 * assertion - the app must respect its own limit - and NOT an independent one: a
 * scenario configuring `staleReadingMinutes: 600` passed while the app advised
 * off a ten-hour-old reading, because the check widened with the setting it was
 * supposed to be policing. A degree limit cannot be widened by configuration, and
 * it is measured against the simulated roast's true core, which the app cannot
 * see. It is also the right question: a 180-minute-old reading on an overnight
 * shoulder is fine, and a 60-minute-old one in the endgame is not.
 *
 * BOTH conditions have to hold: the reading has to be older than
 * MAX_ADVICE_AGE_MIN *and* the roast has to have outrun it by MAX_ADVICE_DRIFT_F.
 * Either alone is wrong. Age alone punishes an overnight shoulder for a
 * three-hour gap in which the core moved 2 F, which is not staleness. Drift alone
 * punishes a 3 lb tenderloin for a ten-minute-old reading, because the app's
 * reading schedule has a deliberate 10-minute floor and a roast climbing at
 * 124 F/hr will always outrun it - that is the floor's cost, not a stale-advice
 * bug.
 *
 * 20 F is two and a half times the 8 F the app's own reading schedule tries to
 * keep between readings. 45 min is the shipped default `staleReadingMinutes`, so
 * a scenario cannot configure itself more lenient than the product ships.
 */
export const MAX_ADVICE_DRIFT_F = 20;
export const MAX_ADVICE_AGE_MIN = 45;

export function checkNoStaleAdvice(outcome) {
  const out = [];
  const staleAfter = outcome.settings.staleReadingMinutes ?? 45;
  // Advice derived from the projection. at-target is a fact about the newest
  // reading, restart-oven is about the oven, and needs-reading is itself a
  // request for fresher evidence - none of them claim to know the schedule.
  const PROJECTION_ADVICE = ['raise', 'lower', 'hold', 'oven-off', 'settling'];
  let breaches = 0;

  for (const r of outcome.rows) {
    if (!r.canRecommend || !PROJECTION_ADVICE.includes(r.action)) continue;
    if (!r.latestReadingISO) continue;

    const age = minutesBetween(r.latestReadingISO, r.atISO);
    // One tick of slack: a row stamped exactly on the boundary is the gate
    // firing, not the gate failing.
    if (age > staleAfter + 5.1) {
      breaches++;
      out.push(finding('no-stale-advice', 'error',
        `at ${r.atMin} min the app advised "${r.action}" (${r.scheduleStatus}) from a ` +
        `reading ${age.toFixed(0)} min old, past the ${staleAfter} min staleness ` +
        'limit', { row: r.atMin, ageMinutes: age }));
    }
  }

  /**
   * The independent half: how much did the roast actually move since the reading
   * the advice rested on? The true core at that instant is taken from the nearest
   * transcript row, which is ground truth in Fahrenheit regardless of the
   * session's display units.
   */
  let driftBreaches = 0;
  const trueCoreAt = (iso) => {
    const target = Date.parse(iso);
    let best = null;
    let bestGap = Infinity;
    for (const row of outcome.rows) {
      const gap = Math.abs(Date.parse(row.atISO) - target);
      if (gap < bestGap) { bestGap = gap; best = row; }
    }
    // Only trust it if a row actually sits near that instant.
    return bestGap <= 6 * 60_000 ? best?.trueCoreF ?? null : null;
  };

  for (const r of outcome.rows) {
    if (!r.canRecommend || !PROJECTION_ADVICE.includes(r.action)) continue;
    if (!r.latestReadingISO) continue;
    const coreThen = trueCoreAt(r.latestReadingISO);
    if (coreThen === null) continue;
    const drift = r.trueCoreF - coreThen;
    const age = minutesBetween(r.latestReadingISO, r.atISO);
    if (drift > MAX_ADVICE_DRIFT_F && age > MAX_ADVICE_AGE_MIN) {
      driftBreaches++;
      out.push(finding('no-stale-advice', 'error',
        `at ${r.atMin} min the app advised "${r.action}" (${r.scheduleStatus}) from a ` +
        `reading ${age.toFixed(0)} min old, by which time the true core had moved ` +
        `${drift.toFixed(1)} F - past both the ${MAX_ADVICE_AGE_MIN} min and the ` +
        `${MAX_ADVICE_DRIFT_F} F the harness allows, whatever staleReadingMinutes ` +
        'is set to',
        { row: r.atMin, ageMinutes: age, driftF: drift }));
    }
  }

  if (breaches === 0 && driftBreaches === 0) {
    out.push(finding('no-stale-advice', 'ok',
      `no advice given from a reading older than ${staleAfter} min, and none from ` +
      `one over ${MAX_ADVICE_AGE_MIN} min old that the true core had outrun by ` +
      `${MAX_ADVICE_DRIFT_F} F`));
  }
  return out;
}

export const CHECKS = [
  checkConvergence,
  checkAcceptanceMetrics,
  checkNoFlapping,
  checkBounds,
  checkNoDoubleCharging,
  checkNoStaleAdvice,
  checkSaneNumbers,
  checkRenderedText,
  checkTerminalState
];

/**
 * Run every check over one outcome.
 * @returns {{findings: Array, errors: Array, advisories: Array}}
 */
export function evaluate(outcome) {
  const findings = CHECKS.flatMap((check) => check(outcome));
  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error'),
    advisories: findings.filter((f) => f.severity === 'advisory')
  };
}
