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

  it('shows the pull temperature in the cook\'s own unit', async () => {
    await open({ units: 'C' });
    // 125 °F pull is 51.7 °C. Showing "125°" to a Celsius cook would read as a
    // target well past boiling.
    expect(sheetText()).toMatch(/51\.7|52/);
    expect(sheetText()).not.toMatch(/125°C/);
  });
});
