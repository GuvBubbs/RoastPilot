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
  MIN_CORE_FOR_OVEN_OFF_F,
  FINAL_APPROACH_BAND_F,
  MIN_OVEN_HEADROOM_F
} from './recommendationService.js';
import { createDefaultSettings } from '../models/dataModels.js';

const settings = createDefaultSettings();

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
  it('refuses a cold roast with hours still to run', () => {
    // Switching the oven off with the core in the 40-140 °F danger zone extends
    // the time it spends there, and the app cannot police how long the pause
    // actually lasts.
    expect(mayPauseCooking(90, 195)).toBe(false);
    expect(mayPauseCooking(120, 195)).toBe(false);
  });

  it('allows it above the danger zone whatever the target', () => {
    expect(mayPauseCooking(MIN_CORE_FOR_OVEN_OFF_F, 195)).toBe(true);
    expect(mayPauseCooking(160, 195)).toBe(true);
  });

  it('allows it in the final approach, which is why the feature exists at all', () => {
    /**
     * Every red-meat target is BELOW 140 °F - the app's own default is 125 for
     * medium-rare beef - so a flat "no pausing under 140 °F core" rule would
     * delete the pause path for the majority of cooks it was built for, along
     * with the whole lower-then-pause ladder.
     *
     * What makes a pause hazardous is TIME in the zone. Inside this band the
     * roast is minutes from leaving it for good.
     */
    expect(mayPauseCooking(125 - FINAL_APPROACH_BAND_F, 125)).toBe(true);
    expect(mayPauseCooking(125 - FINAL_APPROACH_BAND_F - 1, 125)).toBe(false);
    expect(mayPauseCooking(118, 125)).toBe(true);
  });

  it('is permissive with no reading rather than guessing', () => {
    expect(mayPauseCooking(null, 125)).toBe(true);
    expect(mayPauseCooking(undefined, 125)).toBe(true);
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

  it('holds once the oven is on that floor', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: snapToDial(195 + MIN_OVEN_HEADROOM_F, 'F', 'up'),
      scheduleVarianceMinutes: -250,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 150,
      targetTempF: 195
    });
    expect(result.action).toBe('hold');
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
