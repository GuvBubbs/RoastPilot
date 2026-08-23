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
