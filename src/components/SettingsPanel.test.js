/**
 * The other way into the cook plan, and it had no tests.
 *
 * SessionSetupModal validates what the cook types; this panel is the only way to
 * change the same fields once a roast is in the oven, and it wrote straight
 * through to `updateConfig`. So the plan's rules - the pull cannot sit above the
 * plate temperature, rest is 0 to 240 minutes, the serve time has to parse - did
 * not apply to a running cook, which is the one case where getting them wrong
 * costs a dinner.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SettingsPanel from './SettingsPanel.vue';
import { useSession } from '../composables/useSession.js';

const NOW = '2026-08-22T18:00:00.000Z';

describe('SettingsPanel', () => {
  let session;
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    session = useSession();
    session.startSession({
      units: 'F',
      pullTempF: 125,
      servingTempF: 129,
      carryoverF: 4,
      restMinutes: 20,
      initialOvenTemp: 225,
      weight: 6,
      meatType: 'Prime Rib'
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    session.endSession();
    document.body.innerHTML = '';
    vi.useRealTimers();
    localStorage.clear();
  });

  const open = () => {
    wrapper = mount(SettingsPanel, {
      props: { modelValue: true },
      attachTo: document.body
    });
    return nextTick();
  };

  const save = async () => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /save/i.test(b.textContent.trim()));
    if (!button) throw new Error('No save button rendered');
    button.click();
    await nextTick();
  };

  it('saves a valid change to the running cook', async () => {
    /**
     * The half that matters most: the guard must not block ordinary saves. A
     * validator wired up with the wrong property name would reject everything, and
     * the build would not notice.
     */
    await open();
    const before = session.config.value.restMinutes;
    expect(before).toBe(20);

    await save();

    expect(session.config.value.restMinutes).toBe(20);
    // The panel closes on a successful save.
    expect(wrapper.emitted('update:modelValue')?.flat()).toContain(false);
  });

  it('refuses a rest time outside the allowed range', async () => {
    await open();
    // Straight at the reactive local, because the stepper clamps at its own max -
    // the point here is that the write path validates rather than trusting the UI.
    wrapper.vm.localRestMinutes = 5000;
    await nextTick();

    await save();

    expect(session.config.value.restMinutes).toBe(20);
    expect(wrapper.emitted('update:modelValue')?.flat() ?? []).not.toContain(false);
  });

  it('refuses a serve time that does not parse', async () => {
    await open();
    const beforeServe = session.config.value.desiredServeTime ?? null;
    wrapper.vm.localServeTime = 'not a date';
    await nextTick();

    await save();

    expect(session.config.value.desiredServeTime ?? null).toBe(beforeServe);
  });

  it('validates the merged config, not just the fields being changed', async () => {
    /**
     * The patch this panel writes is partial - no oven temperature, no starting
     * reading - so validating it on its own would fail on required fields that are
     * already set and are not being touched. What has to be valid is the session
     * after the write.
     */
    await open();
    await save();
    expect(session.config.value.initialOvenTemp).toBe(225);
    expect(wrapper.emitted('update:modelValue')?.flat()).toContain(false);
  });
});
