/**
 * The only path in the app that writes a dial move.
 *
 * `applyRecommendation` takes the number the service suggested and puts it in the
 * oven history. Everything upstream — the whole projection, the settling logic,
 * the guardrails — exists to make that number right, and this is where it lands.
 * It had no test.
 *
 * The bug class this guards is specific: the suggestion is in DISPLAY units and
 * `addOvenEvent` converts, so a panel that applied the raw Fahrenheit value would
 * write 225 °F as 437 °F on a Celsius session — and the button label would have
 * read correctly while doing it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import RecommendationPanel from './RecommendationPanel.vue';
import { useSession } from '../composables/useSession.js';
import { __resetRefreshTimer } from '../composables/useRefreshTimer.js';
import { clearFitCache, advance } from '../services/thermalModel.js';

const NOW = '2026-08-22T18:00:00.000Z';
const at = (minutesFromStart) =>
  new Date(Date.parse(NOW) - (150 - minutesFromStart) * 60_000).toISOString();

describe('RecommendationPanel', () => {
  let session;
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    clearFitCache();
    __resetRefreshTimer();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    session = useSession();
  });

  afterEach(() => {
    wrapper?.unmount();
    session.endSession();
    __resetRefreshTimer();
    vi.useRealTimers();
    localStorage.clear();
  });

  /**
   * A cook running early enough that the advice is "lower", generated from the
   * model so the readings are a shape the fit accepts.
   */
  function startEarlyCook({ units = 'F', ovenF = 250 } = {}) {
    vi.setSystemTime(new Date(Date.parse(at(0)) - 60_000));
    session.startSession({
      units,
      pullTempF: 125,
      servingTempF: 129,
      carryoverF: 4,
      restMinutes: 0,
      initialOvenTemp: ovenF,
      // Four hours out: comfortably early.
      desiredServeTime: new Date(Date.parse(NOW) + 240 * 60_000).toISOString(),
      weight: 6,
      meatType: 'Prime Rib'
    });
    vi.setSystemTime(new Date(NOW));

    let state = { ovenF, surfaceF: 48, coreF: 48 };
    let cursor = 0;
    const toDisplay = (f) => (units === 'C' ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : Math.round(f * 10) / 10);
    session.addReading(toDisplay(48), at(0));
    /**
     * Stopping at +75 leaves the core near 88 °F, well short of the 125 °F pull -
     * so there is real time left and the advice is a DIAL CHANGE, which is what
     * these tests are about.
     *
     * It used to stop at +110, ten minutes from the target. That is inside the
     * window where a dial change cannot land before the roast is done, so the
     * advice is now "leave it alone" and there is no suggestion to apply. The
     * fixture was relying on the app offering a change it should never have
     * offered.
     */
    for (const m of [40, 75]) {
      state = advance(state, { minutes: m - cursor, setPointF: ovenF }, 0.011);
      cursor = m;
      session.addReading(toDisplay(state.coreF), at(m));
    }
    // `now` is the last reading, so the panel is not also fighting a stale one.
    vi.setSystemTime(new Date(at(77)));
    wrapper = mount(RecommendationPanel);
    return nextTick();
  }

  /** The panel's single control. */
  const control = () => wrapper.findAll('button').filter((b) => b.text().length > 0).at(-1);

  it('applies the suggestion in the unit the cook is reading', async () => {
    await startEarlyCook({ units: 'C' });

    const before = session.ovenEvents.value.length;
    const label = control().text();
    expect(label).toMatch(/Set oven to/);

    await control().trigger('click');
    await nextTick();

    const events = session.ovenEvents.value;
    expect(events.length).toBe(before + 1);

    /**
     * Stored in Fahrenheit, and it has to be the SAME temperature the button
     * offered. Applying the raw suggestion without converting would write a
     * Celsius number into a Fahrenheit field: the label would say 120 °C and the
     * history would record 120 °F.
     */
    const written = events[events.length - 1].setTemp;
    const asCelsius = Math.round(((written - 32) * 5) / 9);
    expect(label).toContain(`${asCelsius}°C`);
    // And it is a real oven temperature, not a Celsius value in a Fahrenheit slot.
    expect(written).toBeGreaterThan(150);
    expect(written).toBeLessThan(550);
  });

  it('writes exactly the Fahrenheit value it displayed', async () => {
    await startEarlyCook({ units: 'F' });
    const label = control().text();
    const shown = Number(label.match(/(\d+)°F/)[1]);

    await control().trigger('click');
    await nextTick();

    expect(session.ovenEvents.value.at(-1).setTemp).toBe(shown);
  });

  it('writes nothing at all when there is nothing to apply', async () => {
    // Two readings: the dead-time gate is holding, so the control is the
    // pause/restart escape hatch and must not touch the oven history.
    vi.setSystemTime(new Date(Date.parse(at(0)) - 60_000));
    session.startSession({
      units: 'F', pullTempF: 125, initialOvenTemp: 200, restMinutes: 0,
      desiredServeTime: new Date(Date.parse(NOW) + 120 * 60_000).toISOString()
    });
    vi.setSystemTime(new Date(NOW));
    session.addReading(48, at(100));
    session.addReading(56, at(150));
    wrapper = mount(RecommendationPanel);
    await nextTick();

    const before = session.ovenEvents.value.length;
    const button = control();
    expect(button.text()).not.toMatch(/Set oven to/);
    await button.trigger('click');
    await nextTick();
    expect(session.ovenEvents.value.length).toBe(before);
  });

  it('shows the blocker rather than advice while the gate holds', async () => {
    vi.setSystemTime(new Date(Date.parse(at(0)) - 60_000));
    session.startSession({
      units: 'F', pullTempF: 125, initialOvenTemp: 200, restMinutes: 0,
      desiredServeTime: new Date(Date.parse(NOW) + 120 * 60_000).toISOString()
    });
    vi.setSystemTime(new Date(NOW));
    session.addReading(48, at(140));
    session.addReading(50, at(150));
    wrapper = mount(RecommendationPanel);
    await nextTick();

    // Whatever the wording, it must not be a suggestion, and it must not leave a
    // raw placeholder on screen.
    expect(wrapper.text()).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(wrapper.text()).toMatch(/reading/i);
  });

  it('never renders an unsubstituted placeholder', async () => {
    // Every message the service emits is a template. The composable substitutes
    // them; a missed one reaches the screen as literal "{ovenTemp}".
    await startEarlyCook({ units: 'C' });
    expect(wrapper.text()).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});
