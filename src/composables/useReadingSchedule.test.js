/**
 * The reading prompt is the overshoot lever, and it is the only one. Measured
 * against the simulated deck, nothing in the formulas moved overshoot by more
 * than a degree; asking for a reading took the mean from 13.7 °F to 3.5 and the
 * worst case from 31.5 °F to 7.2. So the cadence rule is worth pinning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useSession } from './useSession.js';
import {
  useReadingSchedule, spacingForRate, DEGREES_BETWEEN_READINGS,
  MIN_SPACING_MINUTES, FALLBACK_SPACING_MINUTES, SOON_MINUTES, OVERDUE_MINUTES
} from './useReadingSchedule.js';
import { __resetRefreshTimer } from './useRefreshTimer.js';

const NOW = '2026-08-22T12:00:00.000Z';
const ago = (minutes) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

describe('spacingForRate', () => {
  it('states the rule in degrees, so the minutes follow the rate', () => {
    // 8 °F of unobserved core is the budget. At 24 °F/hr that is 20 minutes; at
    // 48 °F/hr it is 10. A fixed timer is wrong at both ends of a cook - 45
    // minutes in the last stretch is 30 °F of blindness, which is how a roast
    // ends up 31 °F past target.
    expect(spacingForRate(24, 45)).toBeCloseTo(20, 5);
    expect(spacingForRate(12, 45)).toBeCloseTo(40, 5);
    expect(spacingForRate(DEGREES_BETWEEN_READINGS * 6, 45)).toBeCloseTo(10, 5);
  });

  it('never asks more often than the floor', () => {
    // A roast climbing 200 °F/hr would nominally want a reading every 2.4
    // minutes, which is not a thing to ask of a cook.
    expect(spacingForRate(200, 45)).toBe(MIN_SPACING_MINUTES);
    expect(spacingForRate(1000, 45)).toBe(MIN_SPACING_MINUTES);
  });

  it('never waits longer than the settings allow', () => {
    expect(spacingForRate(2, 45)).toBe(45);
    expect(spacingForRate(2, 20)).toBe(20);
  });

  it('falls back to a fixed cadence with no rate to derive one from', () => {
    // NOT null. Returning null would silence the prompt for exactly the first
    // hour of every cook - the stretch where readings are scarcest and one more
    // is worth the most.
    for (const bad of [null, undefined, NaN, 0, -5]) {
      expect(spacingForRate(bad, 45)).toBe(FALLBACK_SPACING_MINUTES);
    }
    // Still bounded by the settings.
    expect(spacingForRate(null, 20)).toBe(20);
  });

  it('shortens monotonically as the roast speeds up', () => {
    let previous = Infinity;
    for (let rate = 5; rate <= 60; rate += 5) {
      const spacing = spacingForRate(rate, 45);
      expect(spacing).toBeLessThanOrEqual(previous);
      previous = spacing;
    }
  });
});

/**
 * The composable needs a mounted component: useRefreshTimer registers its
 * interval in onMounted, and without it the tick never exists and every
 * clock-dependent computed is frozen.
 */
function mountSchedule() {
  const captured = {};
  const Probe = defineComponent({
    setup() {
      captured.session = useSession();
      captured.schedule = useReadingSchedule();
      return () => h('div');
    }
  });
  const wrapper = mount(Probe);
  return { ...captured, wrapper };
}

describe('useReadingSchedule', () => {
  let probe;

  beforeEach(() => {
    localStorage.clear();
    __resetRefreshTimer();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    probe = mountSchedule();
  });

  afterEach(() => {
    probe.session.endSession();
    probe.wrapper.unmount();
    __resetRefreshTimer();
    vi.useRealTimers();
    localStorage.clear();
  });

  /**
   * A cook with readings at the given ages, climbing steadily.
   *
   * The clock is wound back for the startSession call. startSession stamps its
   * opening oven event with `new Date()`, so building the cook at NOW leaves that
   * event as the NEWEST one - after any oven-off logged in the past - and
   * `ovenEvents[length - 1].isOff` then reads false about a paused oven. The same
   * shape of fixture bug that made a useSession assertion fail on one particular
   * calendar day.
   */
  function startCook({ ages = [90, 60, 30], temps = [80, 95, 110], extra = {} } = {}) {
    const oldest = Math.max(...ages, 0);
    vi.setSystemTime(new Date(Date.parse(NOW) - (oldest + 30) * 60_000));
    probe.session.startSession({
      pullTempF: 125, units: 'F', initialOvenTemp: 200,
      desiredServeTime: new Date(Date.parse(NOW) + 60 * 60_000).toISOString(),
      restMinutes: 0, ...extra
    });
    vi.setSystemTime(new Date(NOW));
    ages.forEach((age, i) => probe.session.addReading(temps[i], ago(age)));
    return nextTick();
  }

  it('is quiet while the next reading is comfortably ahead', async () => {
    // 30 °F/hr fits from these readings, so the spacing is 16 minutes and the
    // last reading was 1 minute ago.
    await startCook({ ages: [61, 31, 1], temps: [80, 95, 110] });
    expect(probe.schedule.status.value).toBe('scheduled');
    expect(probe.schedule.isPrompting.value).toBe(false);
    expect(probe.schedule.promptText.value).toBeNull();
  });

  it('asks once the derived spacing has elapsed', async () => {
    await startCook({ ages: [90, 60, 30], temps: [80, 95, 110] });
    // 30 minutes since the last reading, against a 16 minute spacing.
    expect(probe.schedule.status.value).toBe('overdue');
    expect(probe.schedule.promptText.value).toMatch(/overdue/i);
    expect(probe.schedule.promptTone.value).toBe('text-late');
  });

  it('walks up the ramp rather than switching on', async () => {
    // The tones reuse the app's existing interpretation ramp: ink-mute ->
    // ink-dim -> ink -> late.
    //
    // Advanced with advanceTimersByTimeAsync, not setSystemTime: everything
    // clock-derived here depends on the shared refresh tick, and moving the
    // system clock without firing that interval leaves every computed cached at
    // the value it had before - which is the exact production bug 3.0 fixes for
    // a suspended iOS tab.
    await startCook({ ages: [62, 32, 2], temps: [80, 95, 110] });
    expect(probe.schedule.status.value).toBe('scheduled');

    /**
     * Advanced RELATIVE to the reported due time rather than to a hardcoded
     * spacing. The spacing is derived from the heating rate, and the rate is now
     * the instantaneous k·(Ts - Tc) of the fitted curve rather than a
     * least-squares slope - so pinning a minute count here would be asserting the
     * physics from inside a test about the urgency ramp.
     */
    const untilDue = probe.schedule.minutesUntilDue.value;
    expect(untilDue).toBeGreaterThan(SOON_MINUTES);

    await vi.advanceTimersByTimeAsync((untilDue - 2) * 60_000);
    await nextTick();
    expect(probe.schedule.status.value).toBe('soon');
    expect(probe.schedule.promptTone.value).toBe('text-ink-dim');

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await nextTick();
    expect(probe.schedule.status.value).toBe('now');
    expect(probe.schedule.promptTone.value).toBe('text-ink');

    await vi.advanceTimersByTimeAsync((OVERDUE_MINUTES + 2) * 60_000);
    await nextTick();
    expect(probe.schedule.status.value).toBe('overdue');
    expect(probe.schedule.promptTone.value).toBe('text-late');
  });

  it('brings the due time forward as the projected pull approaches', async () => {
    // THE endgame case. A projection landing in twelve minutes must not be
    // answered with "next reading in forty" - that is precisely how the app came
    // to be told about a finished roast half an hour after the fact.
    await startCook({ ages: [40, 20, 0], temps: [100, 110, 120] });
    const dueMinutes = probe.schedule.minutesUntilDue.value;
    // 30 °F/hr, 5 °F to go: the pull is 10 minutes out, so the reading is wanted
    // inside that, not at the 16-minute spacing.
    expect(dueMinutes).toBeLessThan(16);
  });

  it('never demands a reading in the past because the pull is imminent', async () => {
    // Without the floor, a projection landing in three minutes would put the due
    // time before the reading it was projected from, and the prompt would be
    // permanently overdue however often the cook logged.
    await startCook({ ages: [40, 20, 0], temps: [100, 112, 124] });
    expect(probe.schedule.minutesUntilDue.value).toBeGreaterThanOrEqual(0);
  });

  it('still gives a due time before any rate can be fitted', async () => {
    probe.session.startSession({ pullTempF: 125, units: 'F', initialOvenTemp: 200 });
    await nextTick();
    // Counted from createdAt, which is NOW here, so nothing is due yet - the
    // point is that a due time EXISTS. Returning null would silence the prompt
    // for the whole first hour.
    // Counted from the session start, at the fallback cadence.
    expect(probe.schedule.dueAt.value).not.toBeNull();
    expect(probe.schedule.spacingMinutes.value).toBe(FALLBACK_SPACING_MINUTES);
  });

  it('goes quiet once the pull temperature is reached', async () => {
    // The cook should be taking the meat out, not measuring it again.
    await startCook({ ages: [60, 30, 0], temps: [100, 115, 130] });
    expect(probe.schedule.status.value).toBe('none');
    expect(probe.schedule.promptText.value).toBeNull();
  });

  it('leaves the paused case to the advice band', async () => {
    // With the oven off and nothing logged since, the recommendation band is
    // already asking for a reading in its own words. A second ask, in a
    // different place, in different words, is one message too many.
    await startCook({ ages: [90, 60, 30], temps: [80, 95, 110] });
    probe.session.logOvenOff(ago(10));
    await nextTick();
    expect(probe.schedule.status.value).toBe('none');

    // ...and resumes once a post-pause reading exists.
    probe.session.addReading(112, ago(5));
    await nextTick();
    expect(probe.schedule.status.value).not.toBe('none');
  });

  it('says nothing at all with no session', () => {
    expect(probe.schedule.status.value).toBe('none');
    expect(probe.schedule.dueAt.value).toBeNull();
    expect(probe.schedule.promptText.value).toBeNull();
  });

  it('honours the settings ceiling on the gap', async () => {
    await startCook({ ages: [90, 60, 30], temps: [50, 52, 54] });
    probe.session.updateSettings({ readingIntervalMinutes: 20 });
    await nextTick();
    // A very slow roast would nominally want a 4-hour gap; the ceiling wins.
    expect(probe.schedule.spacingMinutes.value).toBeLessThanOrEqual(20);
  });
});
