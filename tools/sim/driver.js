/**
 * The closed loop: step simulated time, log readings through the app's real
 * session actions, read what the app advises, and do what it says.
 *
 * This drives the app's ACTUAL composables. It would have been easier to call
 * computeSessionCalculations and generateRecommendation directly, but the wiring
 * between them - which `now` each one gets, which oven temperature is passed as
 * the base, whether the recommendation re-reads the clock - is exactly where the
 * bugs live. A harness that reimplemented that wiring would be blind to them.
 *
 * Two things about the environment matter:
 *  - useSession keeps its state and its deep autosave watcher at module scope,
 *    so every scenario needs a fresh module registry (vi.resetModules) and a
 *    clean localStorage. Sharing them leaks one cook into the next.
 *  - useRefreshTimer registers its interval in onMounted, so the composables
 *    have to be used from a mounted component, not called bare. Without that
 *    the 30 s tick never exists and every clock-dependent computed is frozen.
 */
import { celsiusToFahrenheit } from '../../src/utils/temperatureUtils.js';
import { TICK_MINUTES, COOK_START_ISO } from './scenarios.js';
import { createMeatModel } from './meatModel.js';

/** The cook takes ~30 s to walk to the oven and turn the dial. */
const APPLY_DELAY_MIN = 0.5;
/** How far the clock is wound on each advance, so the 30 s tick fires once. */
const TICK_FIRE_MS = 30_000;
const EPS = 1e-6;

const toF = (temp, units) => (units === 'C' ? celsiusToFahrenheit(temp) : temp);
const near = (a, b) => Math.abs(a - b) < EPS;

/**
 * Run one scenario end to end.
 *
 * @param {Object} scenario - See scenarios.js
 * @param {Object} deps
 * @param {Object} deps.vi - vitest's `vi`, for fake timers and module reset
 * @param {Function} deps.mount - @vue/test-utils mount, imported fresh
 * @param {Function} deps.defineComponent
 * @param {Function} deps.h
 * @param {Function} deps.nextTick
 * @returns {Promise<Object>} The run record: rows, snapshots, applied changes
 */
export async function runScenario(scenario, deps) {
  const { vi, mount, defineComponent, h, nextTick } = deps;

  // Per-scenario start, so a cook can be placed across a daylight-saving
  // transition. Everything else in the run is relative to it.
  const cookStartISO = scenario.startISO ?? COOK_START_ISO;
  const startMs = new Date(cookStartISO).getTime();
  const units = scenario.config.units;
  const model = createMeatModel({ seed: scenario.seed, ...scenario.model });

  // ---- Boot the app's composables on a clean slate -----------------------
  localStorage.clear();
  vi.setSystemTime(new Date(startMs));

  const captured = {};
  const Probe = defineComponent({
    name: 'SimProbe',
    setup() {
      captured.session = deps.useSession();
      captured.calc = deps.useCalculations();
      captured.rec = deps.useRecommendations();
      // The reading prompt is the Phase 3 intervention, and it is only testable
      // if the virtual cook can see it. Mounted with the rest so its
      // useRefreshTimer subscription is registered against the fake clock.
      captured.schedule = deps.useReadingSchedule();
      return () => h('div');
    }
  });
  const wrapper = mount(Probe);
  const { session, calc, rec, schedule } = captured;

  session.initialize();
  session.setUnits(units);
  // startSession turns config.startingTemp into the opening reading, so that
  // number has to come off the same probe as every later one. Seeding it with
  // the true core instead left reading 1 unbiased and readings 2..n biased,
  // which put a step into the very first rate the app ever computes.
  //
  // In Fahrenheit, not display units: startSession pushes config.startingTemp
  // straight through createReading, which documents its argument as canonical
  // F. SessionSetupModal converts before it calls this (toStorageUnit at
  // SessionSetupModal.vue:536), so a Celsius value here is the harness getting
  // it wrong, not the app - it showed up as a -13.9 C opening reading.
  const openingProbeF = Math.round(model.probeF() * 10) / 10;
  session.startSession({
    // pullTempF, not servingTempF: every scenario's `targetTemp` names the
    // temperature the cook stops at, which is what the deck measures against.
    // Passing it as a plate temperature would silently move every scenario's
    // finish line by the carryover.
    pullTempF: scenario.config.targetTemp,
    // Rest defaults to 0 for the existing deck so the recorded convergence
    // numbers still mean the same thing. The rest-and-carryover scenario sets
    // its own.
    restMinutes: scenario.config.restMinutes ?? 0,
    units,
    /**
     * A scenario can decline the opening reading with `noStartingReading`, which
     * is what the setup modal's optional starting temperature does in the app.
     * Every cook in the deck used to pass one, so the minutes between the roast
     * going into a hot oven and the first logged temperature were never
     * exercised - the interval where the projection was most wrong.
     */
    startingTemp: scenario.noStartingReading ? null : openingProbeF,
    desiredServeTime: new Date(startMs + scenario.config.serveAfterMin * 60_000).toISOString(),
    initialOvenTemp: scenario.config.initialOvenTemp,
    meatType: scenario.config.meatType,
    meatCut: scenario.config.meatCut,
    weight: scenario.config.weight,
    notes: scenario.config.notes
  });
  if (scenario.settings) session.updateSettings(scenario.settings);
  await nextTick();

  // ---- State the run accumulates -----------------------------------------
  let cursor = 0;                 // simulated minutes since COOK_START_ISO
  let finished = null;            // why the run stopped
  let pendingRestart = null;      // { atMin, tempDisplay }
  // Set while the cook has deliberately paused and intends to stay paused. The
  // app keeps offering "Set oven to N" in that state, which would silently end
  // the pause; a cook who just decided to pause ignores that.
  let deliberatePauseUntilMin = null;
  const rows = [];
  const applied = [];             // every dial move the app caused
  const snapshots = [];
  const scripted = (scenario.cookActions ?? []).map((a) => ({ ...a, done: false }));

  const simISO = () => new Date(startMs + Math.round(cursor * 60_000)).toISOString();

  /**
   * Advance simulated time to `minutes`. Sets the system clock a tick short of
   * the target and then winds it forward, so the 30 s refresh interval fires
   * exactly once per advance and lands the clock precisely on the target -
   * vi.setSystemTime alone jumps `now` without firing anything, which would
   * leave every tick-dependent computed reading a stale clock.
   */
  async function advanceTo(minutes) {
    if (minutes <= cursor + EPS) return;
    model.step(minutes - cursor);
    cursor = minutes;
    vi.setSystemTime(new Date(startMs + Math.round(cursor * 60_000) - TICK_FIRE_MS));
    await vi.advanceTimersByTimeAsync(TICK_FIRE_MS);
    await nextTick();
  }

  /** Let the reactive graph and the debounced autosave settle. */
  async function settle() {
    await nextTick();
    await vi.advanceTimersByTimeAsync(1200);
    await nextTick();
  }

  function snapshot(checkpoint) {
    if (snapshots.some((s) => s.checkpoint === checkpoint)) return;
    snapshots.push({
      checkpoint,
      atMin: cursor,
      simNowISO: simISO(),
      // The whole session, exactly as the app has it in memory. This is what
      // gets written into localStorage for the screenshot pass.
      session: JSON.parse(JSON.stringify(session.session.value))
    });
  }

  function row(kind, note = null) {
    const r = {
      atMin: Math.round(cursor * 100) / 100,
      atISO: simISO(),
      kind,
      note,
      trueCoreF: round1(model.coreF),
      surfaceF: round1(model.surfaceF),
      ovenSetF: model.ovenOff ? 0 : round1(model.ovenSetF),
      ovenEffectiveF: round1(model.ovenEffectiveF),
      ovenOff: model.ovenOff,
      readingCount: session.readings.value.length,
      latestReadingF: session.latestReading.value?.temp ?? null,
      latestReadingISO: session.latestReading.value?.timestamp ?? null,
      rateFPerHour: calc.currentRateRaw.value,
      etaMinutesFromNow: calc.predictedMinutesFromNow.value,
      predictedTargetTime: calc.predictedTargetTime.value,
      varianceMinutes: calc.scheduleVariance.value,
      scheduleStatus: calc.scheduleStatus.value,
      confidence: calc.confidence.value?.level ?? null,
      canRecommend: rec.canRecommend.value,
      action: rec.action.value,
      suggestedTempDisplay: rec.suggestedTemp.value,
      changeAmountDisplay: rec.changeAmount.value,
      awaitingEffect: rec.awaitingEffect.value,
      waitMinutes: rec.waitMinutes.value,
      severity: rec.severity.value,
      // The substituted strings - what actually reaches the screen.
      message: rec.message.value,
      alternativeMessage: rec.alternativeMessage.value,
      reasoning: rec.reasoning.value,
      blockerReason: rec.blockerReason.value,
      blockerType: rec.blockerType.value,
      isPaused: rec.isPaused.value,
      timeRemainingFormatted: calc.timeRemainingFormatted.value,
      varianceFormatted: calc.scheduleVarianceFormatted.value,
      // The reading prompt, as the cook sees it.
      readingStatus: schedule.status.value,
      readingDueAt: schedule.dueAt.value,
      readingSpacingMinutes: schedule.spacingMinutes.value,
      // Enough of the session for an invariant to re-run the app's own
      // assessOvenChangeEffect at this instant and check the settling state the
      // UI is showing agrees with it. Kept out of the transcript - it is for
      // assertions, not for reading.
      readingTimes: session.readings.value.map((x) => x.timestamp),
      ovenHistory: session.ovenEvents.value.map((e) => ({
        timestamp: e.timestamp, setTemp: e.setTemp, isOff: e.isOff === true
      }))
    };
    rows.push(r);
    return r;
  }

  // ---- Checkpoints -------------------------------------------------------
  const targetF = scenario.config.targetTemp;
  const startF = scenario.config.startingTemp;
  const nearTargetF = startF + 0.85 * (targetF - startF);
  let firstChangeAtMin = null;

  function considerCheckpoints(current) {
    if (current.canRecommend && ['raise', 'lower', 'hold', 'oven-off'].includes(current.action)) {
      snapshot('first-recommendation');
    }
    // A settling frame is only interesting once the wait has had time to run
    // down a little; the instant after the change is 'after-dial-change'.
    if (current.awaitingEffect && firstChangeAtMin !== null && cursor - firstChangeAtMin >= TICK_MINUTES) {
      snapshot('settling');
    }
    if (model.coreF >= nearTargetF) snapshot('near-target');
  }

  /**
   * Do what the app says. A virtual cook who follows instructions is the control
   * loop under test; one who improvises is testing nothing.
   */
  async function obey() {
    const action = rec.action.value;

    if (action === 'at-target') {
      finished = 'at-target';
      return;
    }

    if (deliberatePauseUntilMin !== null && cursor < deliberatePauseUntilMin) return;
    // A replayed stretch is a record of what a human did, so the app does not
    // get to overrule it. Without this the app's applied change and the
    // replayed dial move land in the same instant and neither is what happened.
    if (scenario.obeyFromMin !== undefined && cursor < scenario.obeyFromMin) return;

    if (action === 'raise' || action === 'lower') {
      const suggested = rec.suggestedTemp.value;
      if (suggested === null) return;
      await advanceTo(cursor + APPLY_DELAY_MIN);
      // Display units and no explicit timestamp - the same call the Apply
      // button makes in RecommendationPanel.applyRecommendation().
      session.addOvenEvent(suggested);
      model.setOven(toF(suggested, units));
      await settle();
      applied.push({
        atMin: cursor, action, toDisplay: suggested, toF: toF(suggested, units)
      });
      if (firstChangeAtMin === null) firstChangeAtMin = cursor;
      snapshot('after-dial-change');
      row('apply', `${action} to ${suggested}${units === 'C' ? 'C' : 'F'}`);
      return;
    }

    // The oven is off and the app is asking for it back on. A cook who has just
    // deliberately paused ignores this (deliberatePauseUntilMin, checked above);
    // any other paused state, the cook does what it says.
    if (action === 'restart-oven') {
      await advanceTo(cursor + APPLY_DELAY_MIN);
      await restartOven();
      return;
    }

    if (action === 'oven-off') {
      await advanceTo(cursor + APPLY_DELAY_MIN);
      if (rec.isPaused.value) {
        // RecommendationPanel offers "Log oven restart" in this state, not
        // another pause.
        await restartOven();
        return;
      }
      const offMinutes = rec.ovenOffMinutes.value ?? 20;
      session.logOvenOff();
      model.setOvenOff();
      await settle();
      applied.push({ atMin: cursor, action: 'oven-off', minutes: offMinutes });
      // No temperature captured here: it is read from lastActiveOvenTemp when
      // the restart actually happens, which is what RestartOvenModal does.
      pendingRestart = { atMin: cursor + offMinutes, tempDisplay: null };
      deliberatePauseUntilMin = cursor + offMinutes;
      row('apply', `oven off for ${offMinutes} min`);
    }
    // hold, settling, needs-reading, none: the cook does nothing, which is the
    // instruction.
  }

  function displayOf(tempF) {
    if (tempF === null || tempF === undefined) return null;
    return units === 'C' ? Math.round(((tempF - 32) * 5 / 9) * 10) / 10 : tempF;
  }

  async function restartOven(atDisplay = null) {
    // lastActiveOvenTemp is the app's own answer to "what do I restart at?" -
    // the field that reads 0 if an off event is mistaken for a set point.
    const temp = atDisplay ?? pendingRestart?.tempDisplay ?? displayOf(session.lastActiveOvenTemp.value);
    deliberatePauseUntilMin = null;
    session.logOvenOn(temp);
    model.setOven(toF(temp, units));
    pendingRestart = null;
    await settle();
    applied.push({ atMin: cursor, action: 'restart', toDisplay: temp });
    row('apply', `restart oven at ${temp}${units === 'C' ? 'C' : 'F'}`);
  }

  async function runScripted(action) {
    if (action.kind === 'set-oven') {
      const display = displayOf(action.tempF);
      session.addOvenEvent(display);
      model.setOven(action.tempF);
      await settle();
      applied.push({ atMin: cursor, action: 'cook-set-oven', toDisplay: display, toF: action.tempF });
      if (firstChangeAtMin === null) firstChangeAtMin = cursor;
      row('cook', `cook set oven to ${display}${units === 'C' ? 'C' : 'F'}`);
    } else if (action.kind === 'oven-off') {
      pendingRestart = null;
      session.logOvenOff();
      model.setOvenOff();
      await settle();
      applied.push({ atMin: cursor, action: 'cook-oven-off' });
      row('cook', 'cook turned the oven off');
      // The scripted restart carries its own time; until then the cook stays
      // paused whatever the app offers.
      const restartAt = (scenario.cookActions ?? [])
        .find((a) => a.kind === 'restart-oven' && a.atMin > cursor)?.atMin;
      deliberatePauseUntilMin = restartAt ?? Infinity;
    } else if (action.kind === 'restart-oven') {
      await restartOven(action.tempF ? displayOf(action.tempF) : null);
    }
  }

  // ---- The loop ----------------------------------------------------------
  const readingsAt = scenario.readingsAt.filter((t) => t <= scenario.maxMinutes);
  let readingIndex = 0;

  /**
   * Does this cook do what the reading prompt asks?
   *
   * Default yes, because that is the intervention being measured: the prompt is
   * only worth anything if acting on it moves overshoot, and a cook who cannot
   * see it cannot tell us. Each scenario's own `readingsAt` remains its baseline
   * habit - the readings it would have taken unprompted - and the prompt adds to
   * it.
   *
   * Set false for the forgetful cook, which is the README's own stated limit of
   * this harness: the virtual cook is otherwise perfectly obedient, and a control
   * loop that only works with a perfectly obedient operator has not been tested.
   */
  const obeysPrompt = scenario.obeysReadingPrompt !== false;

  /** Log a reading off the probe, exactly as the Add Reading modal would. */
  async function logReading() {
    // The probe is the only thing the app is allowed to see: true core plus this
    // cook's placement bias plus per-reading noise.
    const probeF = model.probeF();
    session.addReading(displayOf(probeF));
    await settle();
  }

  // The opening state, before any time passes.
  considerCheckpoints(row('start'));

  while (!finished && cursor < scenario.maxMinutes) {
    const nextReading = readingsAt[readingIndex] ?? Infinity;
    const nextScripted = scripted.find((a) => !a.done)?.atMin ?? Infinity;
    const nextRestart = pendingRestart?.atMin ?? Infinity;
    const nextObservation = Math.floor((cursor + EPS) / TICK_MINUTES) * TICK_MINUTES + TICK_MINUTES;
    const next = Math.min(nextReading, nextScripted, nextRestart, nextObservation, scenario.maxMinutes);

    await advanceTo(next);

    // Restart first: it changes what the oven is doing before anything else in
    // this instant gets to read the recommendation.
    if (near(next, nextRestart)) await restartOven();

    if (near(next, nextScripted)) {
      const action = scripted.find((a) => !a.done && near(a.atMin, next));
      if (action) {
        action.done = true;
        await runScripted(action);
      }
    }

    if (near(next, nextReading)) {
      readingIndex += 1;
      await logReading();
      const current = row('reading');
      considerCheckpoints(current);
      if (current.action === 'at-target') {
        snapshot('at-target');
        finished = 'at-target';
        break;
      }
      const movesBefore = applied.length;
      await obey();
      // Only worth a row if the cook actually did something; otherwise it
      // repeats the reading row verbatim.
      if (!finished && applied.length > movesBefore) considerCheckpoints(row('post-advice'));
      continue;
    }

    const current = row('tick');
    considerCheckpoints(current);
    if (current.action === 'at-target') {
      snapshot('at-target');
      finished = 'at-target';
      continue;
    }

    /**
     * The app asked for a reading, so the cook takes one.
     *
     * Checked on the tick rather than folded into `next`, because the due time
     * moves as the projection does - computing it once per loop would be reading
     * a schedule that has already changed. `now` and `overdue` only: `soon` is
     * information, not an instruction.
     */
    if (obeysPrompt && (current.readingStatus === 'now' || current.readingStatus === 'overdue')) {
      await logReading();
      const prompted = row('reading', 'prompted by the app');
      considerCheckpoints(prompted);
      if (prompted.action === 'at-target') {
        snapshot('at-target');
        finished = 'at-target';
        continue;
      }
      const movesBefore = applied.length;
      await obey();
      if (!finished && applied.length > movesBefore) considerCheckpoints(row('post-advice'));
    }
  }

  if (!finished) finished = cursor >= scenario.maxMinutes ? 'gave-up' : 'stopped';

  // A run that never reached the target still needs a final frame to review.
  snapshot('at-target');

  const outcome = {
    scenario: scenario.name,
    title: scenario.title,
    finished,
    endedAtMin: Math.round(cursor),
    units,
    targetF,
    serveAfterMin: scenario.config.serveAfterMin,
    serveISO: new Date(startMs + scenario.config.serveAfterMin * 60_000).toISOString(),
    /**
     * Minutes of rest, and the deadline it implies.
     *
     * Convergence is measured against the PULL deadline, not the serve time: the
     * app steers the roast out of the oven early enough to rest, so a cook that
     * lands on the serve time with 30 minutes of rest declared is 30 minutes
     * LATE, not on time. With no rest the two are the same instant, which is why
     * the existing deck's recorded numbers do not move.
     */
    restMinutes: scenario.config.restMinutes ?? 0,
    pullDeadlineISO: new Date(
      startMs + (scenario.config.serveAfterMin - (scenario.config.restMinutes ?? 0)) * 60_000
    ).toISOString(),
    cookStartISO,
    finalCoreF: round1(model.coreF),
    probeBiasF: round1(model.probeBiasF),
    settings: JSON.parse(JSON.stringify(session.settings.value)),
    rows,
    applied,
    snapshots,
    advisoryConvergence: scenario.advisoryConvergence === true,
    excludeFromAcceptance: scenario.excludeFromAcceptance === true
  };

  wrapper.unmount();
  session.endSession();
  localStorage.clear();

  return outcome;
}

function round1(value) {
  return typeof value === 'number' ? Math.round(value * 10) / 10 : value;
}

/**
 * Fresh-registry import of everything the probe needs. Called per scenario.
 * @param {Object} vi
 */
export async function loadAppModules(vi) {
  vi.resetModules();
  const vue = await import('vue');
  const testUtils = await import('@vue/test-utils');
  const { useSession } = await import('../../src/composables/useSession.js');
  const { useCalculations } = await import('../../src/composables/useCalculations.js');
  const { useRecommendations } = await import('../../src/composables/useRecommendations.js');
  const { useReadingSchedule } = await import('../../src/composables/useReadingSchedule.js');
  return {
    mount: testUtils.mount,
    defineComponent: vue.defineComponent,
    h: vue.h,
    nextTick: vue.nextTick,
    useSession,
    useCalculations,
    useRecommendations,
    useReadingSchedule
  };
}
