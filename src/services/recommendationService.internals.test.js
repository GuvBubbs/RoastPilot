/**
 * The internals nothing tested directly.
 *
 * `reconcileWithOvenChange` is the function the oscillator lived in, and it had
 * never been called by a test - only reached through `generateRecommendation`,
 * which means every test of it was also a test of eight other things and none of
 * them pinned its actual contract.
 *
 * The contract is narrow and worth stating on its own: given advice computed for
 * the set point the READINGS describe, and a dial that has since moved somewhere
 * else, decide what to say. Three outcomes, and getting the boundary between them
 * wrong is how the app came to argue with itself.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileWithOvenChange,
  calculateRecommendation,
  snapToDial,
  mayPauseCooking,
  totalOvenOffMinutes,
  MIN_CORE_FOR_OVEN_OFF_F,
  MAX_CUMULATIVE_OVEN_OFF_MINUTES,
  MIN_OVEN_HEADROOM_F
} from './recommendationService.js';
import { createDefaultSettings } from '../models/dataModels.js';

const settings = createDefaultSettings();

/** A fixed instant, so the pause arithmetic reads as a timeline. */
const START = Date.parse('2026-08-22T18:00:00.000Z');

/** An unsettled change, as assessOvenChangeEffect reports one. */
const effect = (overrides = {}) => ({
  settled: false,
  evidenceTemp: 200,
  currentTemp: 225,
  minutesSinceChange: 5,
  waitMinutes: 10,
  readingsSinceChange: 0,
  readingsNeeded: 2,
  ...overrides
});

/** Advice as calculateRecommendation would produce it, at the measured set point. */
const advice = (action, suggestedTemp) => ({
  action,
  suggestedTemp,
  changeAmount: Math.abs(suggestedTemp - 200),
  message: 'template',
  reasoning: 'because',
  alternativeMessage: null,
  ovenOffMinutes: null,
  practicalMinF: null,
  severity: 'normal'
});

describe('reconcileWithOvenChange', () => {
  it('accepts a dial that landed where the projection asked', () => {
    const result = reconcileWithOvenChange({
      recommendation: advice('raise', 225),
      currentOvenTemp: 225,
      effect: effect(),
      settings
    });

    expect(result.action).toBe('settling');
    expect(result.changeAmount).toBe(0);
    expect(result.suggestedTemp).toBe(225);
    expect(result.awaitingEffect).toBe(true);
  });

  it('tolerates a cook rounding to a mark they can actually hit', () => {
    // Half a dial increment either way. Without this, a user nudging 225 to 220
    // because that is where their dial has a notch looked like a fresh manual
    // change and got answered with another step.
    for (const dial of [222, 225, 228]) {
      expect(reconcileWithOvenChange({
        recommendation: advice('raise', 225),
        currentOvenTemp: dial,
        effect: effect({ currentTemp: dial }),
        settings
      }).action, `dial at ${dial}`).toBe('settling');
    }
  });

  it('holds rather than reversing when the dial went FURTHER than asked', () => {
    /**
     * The reported failure, in the shape it was seen. The projection asked for a
     * drop to 210; the cook dropped to 175. The projection was measured at the
     * old set point, so it cannot see - and cannot judge the size of - either
     * change. Answering "raise" here is advising the opposite of what the
     * schedule needs, on evidence that does not exist yet.
     */
    const result = reconcileWithOvenChange({
      recommendation: advice('lower', 210),
      currentOvenTemp: 175,
      effect: effect({ evidenceTemp: 250, currentTemp: 175 }),
      settings
    });

    expect(result.action).toBe('settling');
    expect(result.suggestedTemp).toBe(175);      // the dial, unchanged
    expect(result.plannedTempF).toBe(210);       // what was actually asked for
    expect(result.changeAmount).toBe(0);
  });

  it('holds when the projection asks for no change at all', () => {
    /**
     * THE OSCILLATOR, and the case a `hold` has no direction for.
     *
     * The app asks for 225; the cook sets 225; the next reading still describes
     * 200, and under 200 the projection now says on-track - so `hold` comes back
     * with suggestedTemp 200, the MEASURED set point. Read as a target that says
     * "go to 200", and the dial is dragged back. One reading later the 200 is
     * itself unmeasured, evidence is 225, on-track again, and the app asks for
     * 225. Four reversals in seventy minutes on a roast that was fine throughout.
     *
     * A hold is not a request. Its suggestedTemp is where it was measured.
     */
    const result = reconcileWithOvenChange({
      recommendation: advice('hold', 200),
      currentOvenTemp: 225,
      effect: effect(),
      settings
    });

    expect(result.action).toBe('settling');
    expect(result.changeAmount).toBe(0);
    expect(result.suggestedTemp).toBe(225);
    expect(result.plannedTempF).toBe(200);
  });

  it('restates the target absolutely when the dial went the wrong way', () => {
    // Running early and the oven went UP. Nothing about an unmeasured change
    // excuses that, so the target is restated - as an ABSOLUTE temperature, never
    // as a step off the new set point, which is what made repeated changes drift.
    const result = reconcileWithOvenChange({
      recommendation: advice('lower', 210),
      currentOvenTemp: 250,
      effect: effect({ evidenceTemp: 225, currentTemp: 250 }),
      settings
    });

    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBe(210);
    expect(result.awaitingEffect).toBe(true);
  });

  it('shows no step for a retarget, because there is not one', () => {
    /**
     * The retarget names an absolute temperature. The distance from wherever the
     * cook just put the dial to that target is not a step, is not bounded by
     * recommendationMaxStepF, and reached the screen as a "-40°F" chip that read
     * as a request exceeding the app's own limit. Capping it would have been
     * worse: a false number beside a true suggestion.
     */
    const result = reconcileWithOvenChange({
      recommendation: advice('lower', 210),
      currentOvenTemp: 250,
      effect: effect({ evidenceTemp: 225, currentTemp: 250 }),
      settings
    });
    expect(result.changeAmount).toBeNull();
  });

  it('leaves pause advice alone but names the new setting to restart at', () => {
    // Pausing is advice about the clock, not the dial: a set point change does
    // not invalidate it, but the restart should name where the dial now is.
    const result = reconcileWithOvenChange({
      recommendation: { ...advice('oven-off', 200), ovenOffMinutes: 15 },
      currentOvenTemp: 190,
      effect: effect({ currentTemp: 190 }),
      settings
    });

    expect(result.action).toBe('oven-off');
    expect(result.ovenOffMinutes).toBe(15);
    expect(result.suggestedTemp).toBe(190);
    expect(result.awaitingEffect).toBe(true);
  });

  it('carries the settling fields on every path', () => {
    const paths = [
      reconcileWithOvenChange({ recommendation: advice('raise', 225), currentOvenTemp: 225, effect: effect(), settings }),
      reconcileWithOvenChange({ recommendation: advice('hold', 200), currentOvenTemp: 225, effect: effect(), settings }),
      reconcileWithOvenChange({ recommendation: advice('lower', 210), currentOvenTemp: 250, effect: effect(), settings }),
      reconcileWithOvenChange({ recommendation: { ...advice('oven-off', 200), ovenOffMinutes: 15 }, currentOvenTemp: 190, effect: effect(), settings })
    ];
    for (const result of paths) {
      expect(result.awaitingEffect).toBe(true);
      expect(result.ovenChangeMinutesAgo).toBe(5);
      expect(result.waitMinutes).toBe(10);
    }
  });

  it('passes advice through untouched when there is no target to compare', () => {
    const result = reconcileWithOvenChange({
      recommendation: advice('none', null),
      currentOvenTemp: 225,
      effect: effect(),
      settings
    });
    expect(result.action).toBe('none');
    expect(result.awaitingEffect).toBe(true);
  });

  it('never answers running early with a raise, at any dial position', () => {
    // The property, swept. 42 minutes early, the dial stepped anywhere.
    for (const dial of [250, 235, 225, 215, 205, 195, 185, 175, 150, 120]) {
      const result = reconcileWithOvenChange({
        recommendation: advice('lower', 210),
        currentOvenTemp: dial,
        effect: effect({ evidenceTemp: 250, currentTemp: dial }),
        settings
      });
      expect(result.action, `dial at ${dial}`).not.toBe('raise');
    }
  });
});

describe('snapToDial', () => {
  it('snaps in the unit the dial is marked in', () => {
    // Snapping in Fahrenheit does not help a Celsius dial: the two grids do not
    // line up, and 102°C is useless advice.
    expect(snapToDial(227, 'F')).toBe(225);
    expect(snapToDial(214, 'C') % 1).toBeCloseTo(0, 6);
    const asC = (f) => (f - 32) * 5 / 9;
    for (const f of [180, 197, 214, 233, 251]) {
      expect(Math.round(asC(snapToDial(f, 'C'))) % 5, `${f}F`).toBe(0);
    }
  });

  it('respects the rounding direction', () => {
    expect(snapToDial(227, 'F', 'down')).toBe(225);
    expect(snapToDial(227, 'F', 'up')).toBe(230);
    expect(snapToDial(225, 'F', 'up')).toBe(225);
  });
});

describe('mayPauseCooking', () => {
  it('refuses a pause that cannot close the gap', () => {
    /**
     * Measured oven-off efficiency is 0.4-0.53, so one 20-minute pause buys about
     * eight or ten minutes and the whole budget buys around half an hour.
     * Offering one to a cook four hours early is not caution, it is an ineffective
     * remedy presented as a remedy - and on the overnight shoulder it produced
     * three pauses and six trips to the oven against a gap it could not touch.
     */
    expect(mayPauseCooking(160, { minutesEarly: 30 }).allowed).toBe(true);
    expect(mayPauseCooking(160, { minutesEarly: MAX_CUMULATIVE_OVEN_OFF_MINUTES }).allowed)
      .toBe(true);
    expect(mayPauseCooking(160, { minutesEarly: 229 }).allowed).toBe(false);
    expect(mayPauseCooking(160, { minutesEarly: 229 }).reason).toBe('pause-cannot-help');
  });

  it('refuses below 140 F core, whatever the target', () => {
    /**
     * The whole rule, and it took two goes to get right. Switching the oven off
     * below 140 °F both extends the meat's time in the 40-140 °F danger zone and
     * lets the SURFACE - the part the heat has actually been pasteurising, and
     * where the bacteria are - cool back toward it.
     *
     * An earlier version exempted `core >= pullTempF - 25` on the reasoning that
     * the roast was "about to leave the zone for good". For every red-meat target
     * that is false: a 121 °F pull never leaves the zone, so the exemption just
     * opened pausing at a 96 °F core.
     */
    for (const [core, pull] of [[90, 195], [120, 195], [96, 121], [100, 125], [105, 130], [139, 125]]) {
      expect(mayPauseCooking(core, {}).allowed, `core ${core} / pull ${pull}`).toBe(false);
      expect(mayPauseCooking(core, {}).reason).toBe('danger-zone');
    }
  });

  it('allows it above 140 F core', () => {
    expect(mayPauseCooking(MIN_CORE_FOR_OVEN_OFF_F, {}).allowed).toBe(true);
    expect(mayPauseCooking(160, {}).allowed).toBe(true);
    expect(mayPauseCooking(190, {}).allowed).toBe(true);
  });

  it('refuses with no reading rather than guessing about food safety', () => {
    for (const bad of [null, undefined, NaN]) {
      const result = mayPauseCooking(bad, {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('no-reading');
    }
  });

  it('bounds the TOTAL pause time, not just one pause', () => {
    /**
     * MAX_OVEN_OFF_MINUTES bounds one suggestion; nothing bounded how many. The
     * app re-evaluates after every reading, so a cook hours early who does as
     * they are told got a fresh 20-minute pause each time they restarted - four
     * in a row was reproducible on one scenario.
     */
    expect(mayPauseCooking(150, { pausedMinutesSoFar: 0 }).allowed).toBe(true);
    expect(mayPauseCooking(150, { pausedMinutesSoFar: 40 }).allowed).toBe(true);
    expect(mayPauseCooking(150, { pausedMinutesSoFar: MAX_CUMULATIVE_OVEN_OFF_MINUTES }).allowed)
      .toBe(false);
    expect(mayPauseCooking(150, { pausedMinutesSoFar: MAX_CUMULATIVE_OVEN_OFF_MINUTES }).reason)
      .toBe('pause-budget-spent');
    expect(mayPauseCooking(150, { pausedMinutesSoFar: 500 }).allowed).toBe(false);
  });

  it('puts the danger zone ahead of the budget', () => {
    // A cold roast is refused for the safety reason even when it also has budget
    // left, so the message the cook sees names the thing that actually matters.
    expect(mayPauseCooking(100, { pausedMinutesSoFar: 0 }).reason).toBe('danger-zone');
  });
});

describe('totalOvenOffMinutes', () => {
  const at = (m) => new Date(START + m * 60_000).toISOString();
  const off = (m) => ({ setTemp: 0, isOff: true, timestamp: at(m) });
  const on = (m) => ({ setTemp: 200, isOff: false, timestamp: at(m) });

  it('sums completed pauses', () => {
    expect(totalOvenOffMinutes([on(0), off(30), on(50), off(100), on(115)], at(200)))
      .toBe(35);
  });

  it('counts an open pause as it grows', () => {
    expect(totalOvenOffMinutes([on(0), off(60)], at(70))).toBe(10);
    expect(totalOvenOffMinutes([on(0), off(60)], at(200))).toBe(140);
  });

  it('treats consecutive off events as one pause', () => {
    // The UI can emit a second off event; two in a row is still one pause.
    expect(totalOvenOffMinutes([on(0), off(30), off(35), on(50)], at(200))).toBe(20);
  });

  it('is zero with no pause', () => {
    expect(totalOvenOffMinutes([on(0), on(60)], at(100))).toBe(0);
    expect(totalOvenOffMinutes([], at(100))).toBe(0);
    expect(totalOvenOffMinutes(undefined, at(100))).toBe(0);
  });
});

describe('the oven-headroom floor', () => {
  it('will not lower the oven to where the roast cannot finish', () => {
    /**
     * The core asymptotes to the oven, so an oven at the target means the roast
     * approaches it and never arrives - lowering into that region does not slow a
     * roast, it stops one.
     *
     * Found by the harness costing a whole cook: a 9 lb shoulder heading for
     * 195 °F, running 254 minutes early, was told to lower to 200 °F. It crept
     * for seven more hours and finished 38 °F short.
     */
    const floor = snapToDial(195 + MIN_OVEN_HEADROOM_F, 'F', 'up');
    for (const base of [300, 275, 250, 240, 230]) {
      const result = calculateRecommendation({
        ovenBaseTemp: base,
        scheduleVarianceMinutes: -250,
        scheduleStatus: 'early',
        settings,
        predictedMinutesToTarget: 300,
        currentRate: 25,
        latestCoreTempF: 150,
        targetTempF: 195
      });
      if (result.action === 'lower') {
        expect(result.suggestedTemp, `from ${base}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('offers a PAUSE once the oven is on that floor, if the core allows it', () => {
    /**
     * The headroom floor bounds LOWERING, which is a sustained change to the
     * oven's steady state. It has no business bounding a pause, which is
     * temporary and leaves the steady state exactly where it was - and gating the
     * pause on it made the feature unreachable for every cook whose target was
     * within 25 °F of its oven.
     *
     * 160 °F core clears the food-safety floor, so the pause is on the table.
     */
    const result = calculateRecommendation({
      ovenBaseTemp: snapToDial(195 + MIN_OVEN_HEADROOM_F, 'F', 'up'),
      // 40 minutes early: inside what the pause budget can actually buy. Further
      // ahead than that and the pause is refused as ineffective - see
      // mayPauseCooking's `pause-cannot-help`.
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 160,
      targetTempF: 195
    });
    expect(result.action).toBe('oven-off');
    expect(result.ovenOffMinutes).toBeGreaterThan(0);
  });

  it('holds, naming the ACTUAL dial, when the core forbids a pause', () => {
    /**
     * The message used to name the FLOOR while the dial sat below it - "220°F is
     * as low as the oven can go" with the oven on 200. False, and confusing in a
     * state the cook cannot act on anyway.
     */
    const result = calculateRecommendation({
      ovenBaseTemp: 200,
      scheduleVarianceMinutes: -250,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 120,      // below the food-safety floor
      targetTempF: 195
    });
    expect(result.action).toBe('hold');
    expect(result.minTempF).toBe(200);   // the dial, not the floor
    expect(result.severity).toBe('info');
  });

  it('does not interfere when the target leaves plenty of headroom', () => {
    // A 125 °F pull under a 250 °F oven: the floor is 150, so the ordinary
    // practical-minimum ladder is untouched.
    const result = calculateRecommendation({
      ovenBaseTemp: 250,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 20,
      latestCoreTempF: 110,
      targetTempF: 125
    });
    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBeLessThan(250);
  });
});

describe('a missing oven setting', () => {
  it('refuses rather than suggesting NaN', () => {
    /**
     * Every branch of calculateRecommendation does arithmetic on `ovenBaseTemp`
     * and none of them checked it. An absent dial produced
     * `{ action: 'lower', suggestedTemp: NaN }` with a confident sentence around
     * it - the panel would render "Set oven to NaN" and the Apply button would
     * write it into the oven log. Same class as the unguarded rate that threw a
     * RangeError out of the whole status panel: a missing input has to become a
     * refusal, not a number.
     */
    for (const dial of [undefined, null, NaN, 'abc']) {
      const result = calculateRecommendation({
        ovenBaseTemp: dial,
        scheduleVarianceMinutes: -40,
        scheduleStatus: 'early',
        targetTempF: 192,
        latestCoreTempF: 170,
        displayUnits: 'F',
        settings: createDefaultSettings(),
        predictedMinutesToTarget: 60,
        currentRate: 10
      });
      expect(result.action).toBe('none');
      expect(result.suggestedTemp).toBeNull();
      expect(result.message).not.toMatch(/NaN/);
    }
  });
});

describe('temperatures in the copy are placeholders, not Fahrenheit literals', () => {
  /**
   * Three sentences used to be assembled in this service with `°F` baked in, so a
   * Celsius cook read "not safe until the core is above 140°F" and "25°F above
   * your 191°F pull" beside a screen showing 88 °C. The `rendered-text` invariant
   * could not catch it, because it only looks for placeholders that failed to
   * substitute and a hardcoded literal is not a placeholder. These assert the
   * service emits a placeholder and the number beside it, leaving the conversion
   * to the substitution layer.
   */
  const early = (dial) => calculateRecommendation({
    ovenBaseTemp: dial,
    scheduleVarianceMinutes: -40,
    scheduleStatus: 'early',
    targetTempF: 192,
    latestCoreTempF: 100,
    displayUnits: 'F',
    settings: createDefaultSettings(),
    predictedMinutesToTarget: 60,
    currentRate: 10
  });

  it('names the food-safety floor as {safeTemp}', () => {
    // Core 100 F, so the pause is refused on danger-zone.
    const result = early(180);
    const text = `${result.message} ${result.reasoning}`;
    expect(text).toMatch(/\{safeTemp\}/);
    expect(text).not.toMatch(/140°F/);
    expect(result.safeCoreF).toBe(140);
  });

  it('names the headroom and the pull as placeholders', () => {
    // 225 is one dial step above the headroom floor for a 192 F pull, so the
    // ordinary step lands below it and the clamp-to-floor branch fires.
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      targetTempF: 192,
      latestCoreTempF: 170,
      displayUnits: 'F',
      settings: createDefaultSettings(),
      predictedMinutesToTarget: 60,
      currentRate: 10
    });
    expect(result.action).toBe('lower');
    expect(result.reasoning).toMatch(/\{headroom\}/);
    expect(result.reasoning).toMatch(/\{pullTemp\}/);
    expect(result.reasoning).not.toMatch(/°F/);
    expect(result.headroomF).toBe(25);
    expect(result.pullTempF).toBe(192);
  });
});

describe('the endgame, where the dial stops mattering', () => {
  /**
   * `predictedMinutesToTarget` and `currentRate` were destructured at the top of
   * calculateRecommendation and referenced nowhere in its body. The step ladder
   * chose its size purely from how far off schedule the cook was, with no notion of
   * whether there was time left for a change to do anything - so one minute from
   * the target, 31 minutes late, it said "raise to 300".
   *
   * With ovenChangeLagMinutes at 15 and the oven's own time constant at 10, that
   * change cannot move the finish time. It is a wasted trip to the kitchen, and it
   * puts surface heat into the roast during the final approach, which is where
   * overshoot comes from.
   */
  const endgame = ({ minutesLeft, status }) => calculateRecommendation({
    ovenBaseTemp: 250,
    scheduleVarianceMinutes: status === 'late' ? 31 : -31,
    scheduleStatus: status,
    targetTempF: 195,
    latestCoreTempF: 185,
    displayUnits: 'F',
    settings: createDefaultSettings(),
    predictedMinutesToTarget: minutesLeft,
    currentRate: 12
  });

  it('leaves the dial alone when a change cannot land in time', () => {
    for (const status of ['late', 'early']) {
      for (const minutesLeft of [1, 5, 14]) {
        const result = endgame({ minutesLeft, status });
        expect(result.action, `${status}, ${minutesLeft} min left`).toBe('hold');
        expect(result.suggestedTemp).toBe(250);
        expect(result.changeAmount).toBe(0);
      }
    }
  });

  it('says how far off it will be, rather than pretending it is on track', () => {
    // "Hold" must not read as "on track" here - the cook is 31 minutes out and
    // nothing can fix it, which is a different sentence.
    const result = endgame({ minutesLeft: 5, status: 'late' });
    expect(result.reasoning).toMatch(/31 minutes late/);
    expect(result.message).not.toMatch(/on track/i);
  });

  it('still acts while there is time for the change to work', () => {
    expect(endgame({ minutesLeft: 15, status: 'late' }).action).toBe('raise');
    expect(endgame({ minutesLeft: 60, status: 'late' }).action).toBe('raise');
    expect(endgame({ minutesLeft: 60, status: 'early' }).action).toBe('lower');
  });

  it('does not fire when there is no projection to measure against', () => {
    // A null horizon is not a short one. The eligibility gates own that case.
    expect(endgame({ minutesLeft: null, status: 'late' }).action).toBe('raise');
  });
});
