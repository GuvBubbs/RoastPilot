/**
 * The entry point to every cook, and it had no test file.
 *
 * +258/-66 in the change that split pull from serve, and nobody had mounted it.
 * The bug below was found by mapping coverage, not by reading the file: a value
 * the cook typed was silently replaced by a preset, and because `restMinutes`
 * moves `computeLatestPullTime` one-for-one, the app then steered the entire cook
 * to a deadline the cook never chose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SessionSetupModal from './SessionSetupModal.vue';
import NumberStepper from './NumberStepper.vue';
import { MEAT_PRESETS, SESSION_DEFAULTS } from '../constants/defaults.js';

const SHOULDER = MEAT_PRESETS.find((p) => p.type === 'Pork Shoulder');

let mounted = [];

function open() {
  const wrapper = mount(SessionSetupModal, {
    props: { modelValue: true, initialConfig: null },
    attachTo: document.body
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The stepper carrying a given label, addressed the way a cook would. */
function stepper(wrapper, label) {
  const found = wrapper.findAllComponents(NumberStepper)
    .find((c) => c.props('label') === label);
  if (!found) throw new Error(`No stepper labelled "${label}"`);
  return found;
}

/** What that stepper is currently showing. */
const shown = (wrapper, label) => stepper(wrapper, label).props('modelValue');

/** Set it the way the +/- buttons and the text input both do. */
async function setStepper(wrapper, label, value) {
  stepper(wrapper, label).vm.$emit('update:modelValue', value);
  await nextTick();
}

/**
 * The sheet is teleported, so its markup is not inside the wrapper - the meat
 * select has to be reached through the document, and driven with a real change
 * event because that is what `@change="handleMeatTypeChange"` listens for. Every
 * test unmounts, so there is only ever one.
 */
async function chooseMeat(wrapper, type) {
  const selects = document.querySelectorAll('#meatTypeMain');
  expect(selects.length).toBe(1);
  const select = selects[0];
  select.value = type;
  select.dispatchEvent(new Event('change'));
  await nextTick();
  await nextTick();
}

/** The "Start cook" button, which is a plain click handler rather than a form. */
async function submit() {
  const button = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === 'Start cook');
  if (!button) throw new Error('No "Start cook" button rendered');
  button.click();
  await nextTick();
}

describe('SessionSetupModal', () => {
  beforeEach(() => {
    localStorage.clear();
    // The sheet teleports into the body, and a wrapper that threw before
    // unmounting leaves its markup there - so the next test's querySelector finds
    // the previous test's modal.
    document.body.innerHTML = '';
    mounted = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'));
  });

  afterEach(() => {
    mounted.forEach((w) => w.unmount());
    mounted = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('a value the cook set survives a later preset', () => {
    /**
     * The Rest stepper was the only one of five with no `@blur`, so
     * `form.restMinutes.touched` was set nowhere before submit, the watch that
     * read it never fired, and the `!userHasEditedRest` guard was dead code.
     * Typing 45 into "Minutes resting" and then choosing Pork Shoulder left 30.
     */
    it('keeps a rest time entered before the meat type', async () => {
      const wrapper = open();
      await setStepper(wrapper, 'Minutes resting', 45);
      expect(shown(wrapper, 'Minutes resting')).toBe(45);

      await chooseMeat(wrapper, 'Pork Shoulder');

      expect(shown(wrapper, 'Minutes resting')).toBe(45);
    });

    it('keeps an oven temperature set with the +/- buttons', async () => {
      // `@blur` never fires for the stepper buttons, so this half-worked too: a
      // cook who clicked up to 275 and then chose a preset lost it.
      const wrapper = open();
      await setStepper(wrapper, 'Starting oven setting', 275);
      await chooseMeat(wrapper, 'Pork Shoulder');

      expect(shown(wrapper, 'Starting oven setting')).toBe(275);
    });

    it('keeps a serve temperature set with the +/- buttons', async () => {
      const wrapper = open();
      await setStepper(wrapper, 'Internal temperature when served', 137);
      await chooseMeat(wrapper, 'Pork Shoulder');

      expect(shown(wrapper, 'Internal temperature when served')).toBe(137);
    });
  });

  describe('a preset still fills in what the cook has not touched', () => {
    // The guard must not become "never apply a preset" - the per-cut rest time is
    // the whole reason the preset carries one.
    it('applies the cut\'s rest, oven and serve temperature', async () => {
      const wrapper = open();
      expect(shown(wrapper, 'Minutes resting')).toBe(SESSION_DEFAULTS.REST_MINUTES);
      const ovenBefore = shown(wrapper, 'Starting oven setting');

      await chooseMeat(wrapper, 'Pork Shoulder');

      // Rest is unit-free. The two temperatures are asserted as "moved to the
      // preset", not as a Fahrenheit literal, because the sheet opens in whatever
      // units the last cook used.
      expect(shown(wrapper, 'Minutes resting')).toBe(SHOULDER.restMinutes);
      expect(shown(wrapper, 'Starting oven setting')).not.toBe(ovenBefore);
      expect(shown(wrapper, 'Starting oven setting')).toBeGreaterThan(0);
      expect(shown(wrapper, 'Internal temperature when served')).toBeGreaterThan(0);
    });

    it('a second preset still moves an untouched field', async () => {
      const wrapper = open();
      await chooseMeat(wrapper, 'Pork Shoulder');
      expect(shown(wrapper, 'Minutes resting')).toBe(SHOULDER.restMinutes);

      const lamb = MEAT_PRESETS.find((p) => p.type === 'Leg of Lamb');
      await chooseMeat(wrapper, 'Leg of Lamb');
      expect(shown(wrapper, 'Minutes resting')).toBe(lamb.restMinutes);
    });
  });

  /**
   * The measured inputs, and the rule that governs all of them: a value the form
   * offers must be a value the validator accepts. Every one of these tests exists
   * because the two disagreed.
   */
  describe('the measured inputs', () => {
    /** The unit toggle in a segmented group, addressed by its label. */
    async function tapUnit(label) {
      const button = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === label);
      if (!button) throw new Error(`No "${label}" button rendered`);
      button.click();
      await nextTick();
    }

    it('never offers a dimension the validator will refuse', async () => {
      /**
       * The steppers used to cap thickness at 100 (or 40 in) and length at 40 in,
       * against a validator that refuses thickness over 30 cm and length over
       * 100 cm. So the thickness stepper's own maximum was always illegal, and
       * long-pressing Length to 40 in produced "Length must be between 3 and
       * 100 cm" on a field reading `40 in` - a number inside the range the message
       * quoted, in a unit it did not mention, with Start cook doing nothing.
       */
      const wrapper = open();
      const CM_PER_IN = 2.54;

      for (const [unit, factor] of [['cm', 1], ['in', CM_PER_IN]]) {
        await tapUnit(unit);
        const thickness = stepper(wrapper, `Thickness in ${unit === 'in' ? 'inches' : 'centimetres'}`);
        const length = stepper(wrapper, 'Length');

        expect(thickness.props('max') * factor, `thickness max in ${unit}`)
          .toBeLessThanOrEqual(30);
        expect(length.props('max') * factor, `length max in ${unit}`)
          .toBeLessThanOrEqual(100);
      }
    });

    it('accepts a measured roast at the stepper ceiling', async () => {
      // The half that matters more. A ceiling pulled tight enough to be legal is
      // no use if an ordinary measurement is now refused.
      const wrapper = open();
      await chooseMeat(wrapper, 'Pork Shoulder');
      await setStepper(wrapper, 'Thickness in centimetres', 30);
      await setStepper(wrapper, 'Length', 100);
      await submit();

      const submitted = wrapper.emitted('submit');
      expect(submitted, 'the sheet refused a roast at its own maximum').toBeTruthy();
      expect(submitted[0][0].thicknessCm).toBe(30);
      expect(submitted[0][0].lengthCm).toBe(100);
    });

    it('converts a measurement when the unit changes, rather than reinterpreting it', async () => {
      const wrapper = open();
      await setStepper(wrapper, 'Thickness in centimetres', 13);
      await tapUnit('in');
      // 13 cm is 5.1 in. Left at 13 it would be a 33 cm roast.
      expect(shown(wrapper, 'Thickness in inches')).toBeCloseTo(5.1, 5);
    });

    it('still starts a cook with nothing measured', async () => {
      // A1: none of this may become required or block starting a cook.
      const wrapper = open();
      await chooseMeat(wrapper, 'Pork Shoulder');
      await submit();

      const submitted = wrapper.emitted('submit');
      expect(submitted).toBeTruthy();
      expect(submitted[0][0].thicknessCm).toBeNull();
      expect(submitted[0][0].lengthCm).toBeNull();
      expect(submitted[0][0].ambientF).toBeNull();
      expect(submitted[0][0].covering).toBe('open');
    });

    it('keeps a kitchen temperature submittable across a unit switch', async () => {
      /**
       * 120 °F is the stepper's own maximum, and the validator's ceiling. Switching
       * the sheet to °C converted it with Math.round(48.888) = 49, which submits
       * back as 120.2 °F - refused, with Start cook silently doing nothing over a
       * value no stepper would let the cook type and that the message called valid.
       * The toggle is the only way to reach it, so the clamp lives there.
       */
      const wrapper = open();
      // The sheet opens in the app's default unit, which is Celsius - so switch to
      // Fahrenheit first, or the °C tap below is a no-op and the test asserts
      // nothing. (handleUnitChange returns early when the unit has not changed.)
      await tapUnit('°F');
      await chooseMeat(wrapper, 'Pork Shoulder');
      await setStepper(wrapper, 'Kitchen temperature', 120);
      await tapUnit('°C');
      expect(shown(wrapper, 'Kitchen temperature')).toBeLessThanOrEqual(48);

      await submit();
      const submitted = wrapper.emitted('submit');
      expect(submitted, 'a kitchen temperature reached by the unit toggle was refused')
        .toBeTruthy();
      expect(submitted[0][0].ambientF).toBeLessThanOrEqual(120);
    });

    it('records the oven this cook was in, and remembers it for the next', async () => {
      const wrapper = open();
      await chooseMeat(wrapper, 'Pork Shoulder');

      const change = [...document.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === 'Fan-forced oven');
      expect(change, 'the fan-forced control has no accessible name').toBeTruthy();
      expect(change.getAttribute('aria-pressed')).toBe('false');

      change.click();
      await nextTick();
      expect(change.getAttribute('aria-pressed')).toBe('true');

      await submit();
      expect(wrapper.emitted('submit')[0][0].ovenIsFanForced).toBe(true);
      // And it is the default the next cook starts from.
      expect(JSON.parse(localStorage.getItem('rstt_settings')).ovenIsFanForced).toBe(true);
    });
  });

  it('emits the rest time the cook actually chose', async () => {
    /**
     * The end of the chain, and why the field matters: restMinutes moves
     * computeLatestPullTime one-for-one, so a wrong value here steers every piece
     * of advice for the rest of the cook.
     */
    const wrapper = open();
    await setStepper(wrapper, 'Minutes resting', 45);
    // The preset fills the two temperatures the submit button is gated on, in
    // whatever units the sheet opened in - so this submits without the test having
    // to know which.
    await chooseMeat(wrapper, 'Pork Shoulder');
    await submit();

    const submitted = wrapper.emitted('submit');
    expect(submitted).toBeTruthy();
    expect(submitted[0][0].restMinutes).toBe(45);
  });
});
