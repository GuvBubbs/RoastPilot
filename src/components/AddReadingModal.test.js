/**
 * The unit round-trip on the one input a cook uses more than any other.
 *
 * A reading is typed in DISPLAY units and stored in Fahrenheit. Everything
 * downstream - the fit, the projection, the advice - is built on that conversion
 * being right, and a modal that stored the raw typed number would put 54 °C into
 * the readings as 54 °F: a roast the app thinks is barely warm.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import AddReadingModal from './AddReadingModal.vue';
import { useSession } from '../composables/useSession.js';
import { __resetRefreshTimer } from '../composables/useRefreshTimer.js';
import { celsiusToFahrenheit } from '../utils/temperatureUtils.js';

const NOW = '2026-08-22T18:00:00.000Z';

describe('AddReadingModal', () => {
  let session;
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    __resetRefreshTimer();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    session = useSession();
  });

  afterEach(() => {
    wrapper?.unmount();
    // Teleported content lives on body; a leftover sheet would be found by the
    // next test's queries.
    document.body.innerHTML = '';
    session.endSession();
    __resetRefreshTimer();
    vi.useRealTimers();
    localStorage.clear();
  });

  /**
   * Sheet teleports its content to `document.body`, so the mounted wrapper is
   * empty and every query has to go through the document. `attachTo` puts the
   * host in the document too, so the teleport target exists.
   */
  function open({ units = 'F' } = {}) {
    session.startSession({
      units, pullTempF: 125, servingTempF: 129, carryoverF: 4,
      initialOvenTemp: 200, restMinutes: 20
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    wrapper = mount(AddReadingModal, { props: { modelValue: true }, attachTo: host });
    return nextTick();
  }

  /** The temperature input: the first numeric field in the sheet. */
  const tempInput = () =>
    document.querySelector('input[inputmode="decimal"], input[type="number"]');
  const sheetText = () => document.body.textContent ?? '';
  const submit = () =>
    [...document.querySelectorAll('button')]
      .filter((b) => /add reading|save/i.test(b.textContent ?? ''))
      .at(-1);

  /** Type into a raw DOM input and let Vue see it. */
  async function type(value) {
    const el = tempInput();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }

  async function press() {
    submit().click();
    await nextTick();
  }

  it('stores a Fahrenheit reading unchanged', async () => {
    await open({ units: 'F' });
    await type('118');
    await press();

    expect(session.readings.value).toHaveLength(1);
    expect(session.readings.value[0].temp).toBe(118);
  });

  it('converts a Celsius reading to Fahrenheit for storage', async () => {
    await open({ units: 'C' });
    await type('54');
    await press();

    expect(session.readings.value).toHaveLength(1);
    // 54 °C is 129.2 °F. Stored raw it would be 54 °F - a roast the app thinks
    // has barely started, on which every projection would then be built.
    expect(session.readings.value[0].temp).toBeCloseTo(celsiusToFahrenheit(54), 6);
    expect(session.readings.value[0].temp).toBeGreaterThan(125);
  });

  it('round-trips a decimal Celsius reading', async () => {
    await open({ units: 'C' });
    await type('51.7');
    await press();

    /**
     * Not exact, and it cannot be: storage keeps one decimal place of Fahrenheit,
     * which is 0.056 °C of quantisation. So the round trip is accurate to half of
     * that - well inside the probe's own 0.3 °C noise, and worth pinning as a
     * bound rather than hoping the number lands on the grid.
     */
    const storedF = session.readings.value[0].temp;
    expect(Math.abs(((storedF - 32) * 5) / 9 - 51.7)).toBeLessThan(0.03);
  });

  it('refuses a reading outside the physical range', async () => {
    await open({ units: 'F' });
    await type('900');
    await press();

    // Nothing stored, and the reason is on screen rather than silent.
    expect(session.readings.value).toHaveLength(0);
    expect(sheetText()).toMatch(/boiling|between|too high|212/i);
  });

  it('refuses a reading below freezing', async () => {
    await open({ units: 'C' });
    await type('-5');
    await press();
    expect(session.readings.value).toHaveLength(0);
  });

  it('warns about a large jump but still records it', async () => {
    /**
     * A cook who moved the probe gets a warning, not a refusal - the new reading
     * may well be the true one and the old placement the bad one. Refusing it
     * would leave the app fitting a curve to a probe that is no longer in the
     * meat.
     */
    await open({ units: 'F' });
    session.addReading(100);
    await nextTick();

    await type('140');
    await press();

    expect(session.readings.value).toHaveLength(2);
    expect(session.readings.value[1].temp).toBe(140);
  });

  /**
   * The oven thermometer field, by a query that cannot drift onto the core input.
   *
   * `tempInput()` above matches the FIRST numeric field in the sheet, which is
   * the core temperature - so it would silently pass every assertion below while
   * testing the wrong control.
   */
  const ovenInput = () => {
    const labelled = [...document.querySelectorAll('label')]
      .find((l) => /oven thermometer/i.test(l.textContent ?? ''));
    return labelled ? document.getElementById(labelled.getAttribute('for')) : null;
  };

  async function typeOven(value) {
    const el = ovenInput();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }

  it('never prefills the oven field, least of all with the dial setting', async () => {
    /**
     * THE CONSTRAINT MOST LIKELY TO BE HELPFULLY "IMPROVED" AWAY.
     *
     * Seeded with the set point, a cook who taps straight through would record a
     * measurement that agrees perfectly with the assumption the field exists to
     * test, and nothing downstream could tell it from a real thermometer reading.
     * The core field above IS prefilled, and should be; this one must not be.
     */
    session.startSession({
      units: 'F', pullTempF: 125, servingTempF: 129, carryoverF: 4,
      initialOvenTemp: 225, restMinutes: 20, startingTemp: 48
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Mounted CLOSED and then opened, because the prefill lives in a watch on
    // `modelValue` with no `immediate` - a sheet mounted already-open never runs
    // it, and the assertion below would pass against an empty form either way.
    wrapper = mount(AddReadingModal, { props: { modelValue: false }, attachTo: host });
    await wrapper.setProps({ modelValue: true });

    // The core field carries the starting reading forward, as it always has.
    expect(tempInput().value).toBe('48');
    // The oven field is empty - not 225, and not the last reading either.
    expect(ovenInput()).not.toBeNull();
    expect(ovenInput().value).toBe('');
  });

  it('stays empty after a reading that carried one, on the next open', async () => {
    await open({ units: 'F' });
    await type('118');
    await typeOven('220');
    await press();

    expect(session.readings.value[0].ovenActualF).toBe(220);

    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    expect(ovenInput().value).toBe('');
  });

  it('records the oven reading in Fahrenheit from a Celsius cook', async () => {
    await open({ units: 'C' });
    await type('54');
    await typeOven('105');
    await press();

    const reading = session.readings.value[0];
    // 105 °C is 221 °F. Stored raw it would describe an oven barely above body
    // temperature, and calibrate.js would fit the oven constants to it.
    expect(reading.ovenActualF).toBeCloseTo(celsiusToFahrenheit(105), 6);
    expect(reading.ovenActualF).toBeGreaterThan(200);
  });

  it('stores null, never a missing key, when no thermometer was read', async () => {
    await open({ units: 'F' });
    await type('118');
    await press();

    const reading = session.readings.value[0];
    expect(reading).toHaveProperty('ovenActualF');
    expect(reading.ovenActualF).toBeNull();
  });

  it('saves the reading with the oven field left blank', async () => {
    // The half that matters more: a guard on the optional field must not be able
    // to block an ordinary save. `disabled` stays keyed on the core temperature.
    await open({ units: 'F' });
    await type('118');
    expect(submit().disabled).toBe(false);
    await press();
    expect(session.readings.value).toHaveLength(1);
  });

  it('does not turn a stray tap on a blank oven field into a measurement', async () => {
    /**
     * NumberStepper reads a null value as 0 for its -/+ buttons and clamps a typed
     * value up into range on blur, so a `min` of 100 turned one stray tap on the
     * blank field into exactly 100 °F - legal, plausible, and indistinguishable
     * from a real reading, against a dial set to 225. tools/sim/calibrate.js folds
     * ovenActualF into its objective with no outlier rejection, so that fabricated
     * value would drag the oven's time constants toward an oven nobody observed.
     *
     * The field therefore has no floor: a stray tap produces a number the validator
     * refuses out loud instead of one it accepts in silence.
     */
    await open({ units: 'F' });
    await type('118');

    const decrement = [...ovenInput().closest('div').parentElement.querySelectorAll('button')]
      .find((b) => /decrease/i.test(b.getAttribute('aria-label') ?? ''));
    const increment = [...ovenInput().closest('div').parentElement.querySelectorAll('button')]
      .find((b) => /increase/i.test(b.getAttribute('aria-label') ?? ''));
    expect(increment, 'the oven stepper buttons were not found').toBeTruthy();

    increment.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    increment.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();

    // Whatever one tap produced, it is NOT a legal oven temperature.
    expect(Number(ovenInput().value)).toBeLessThan(100);
    await press();
    expect(session.readings.value).toHaveLength(0);
    expect(sheetText()).toMatch(/oven temperature too low|minimum 100/i);
    expect(decrement).toBeTruthy();
  });

  it('refuses an impossible oven reading without discarding the core one', async () => {
    await open({ units: 'F' });
    await type('118');
    await typeOven('900');
    await press();

    expect(session.readings.value).toHaveLength(0);
    expect(sheetText()).toMatch(/oven temperature too high|550/i);
  });

  it('shows the pull temperature in the cook\'s own unit', async () => {
    await open({ units: 'C' });
    // 125 °F pull is 51.7 °C. Showing "125°" to a Celsius cook would read as a
    // target well past boiling.
    expect(sheetText()).toMatch(/51\.7|52/);
    expect(sheetText()).not.toMatch(/125°C/);
  });
});
