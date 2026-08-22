import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSession } from './useSession.js';
import { storageService } from '../services/storageService.js';
import { UI_CONSTANTS, SESSION_DEFAULTS } from '../constants/defaults.js';

const SETTINGS_KEY = 'rstt_settings';

/** ISO timestamp helper - a fixed base day so ordering assertions read clearly */
function at(hour, minute = 0) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `2026-08-22T${hh}:${mm}:00.000Z`;
}

/** The readings array as plain triples, for order/delta assertions */
function shape(readings) {
  return readings.map(r => [r.timestamp, r.temp, r.deltaFromStart, r.deltaFromPrevious]);
}

describe('useSession reading invariants', () => {
  let session;

  beforeEach(() => {
    localStorage.clear();
    session = useSession();
    // Fresh session per test; the composable state is a module singleton
    session.startSession({ targetTemp: 200, units: 'F' });
  });

  afterEach(() => {
    session.endSession();
    localStorage.clear();
  });

  it('places a back-dated reading in timestamp order with correct deltas', () => {
    session.addReading(100, at(10));
    session.addReading(120, at(12));
    session.addReading(110, at(11)); // back-dated, arrives last

    expect(shape(session.readings.value)).toEqual([
      [at(10), 100, 0, 0],
      [at(11), 110, 10, 10],
      [at(12), 120, 20, 10]
    ]);
    // Downstream code reads the tail as "the latest reading"
    expect(session.latestReading.value.temp).toBe(120);
  });

  it('re-sorts and re-derives deltas when a reading timestamp is edited', () => {
    session.addReading(100, at(10));
    session.addReading(110, at(11));
    session.addReading(120, at(12));

    const moved = session.readings.value.find(r => r.temp === 120);
    session.updateReading(moved.id, { timestamp: at(10, 30) });

    expect(shape(session.readings.value)).toEqual([
      [at(10), 100, 0, 0],
      [at(10, 30), 120, 20, 20],
      [at(11), 110, 10, -10]
    ]);
    expect(session.latestReading.value.temp).toBe(110);
  });

  it('re-derives deltas when a reading temperature is edited, without reordering', () => {
    session.addReading(100, at(10));
    session.addReading(110, at(11));
    session.addReading(120, at(12));

    const middle = session.readings.value.find(r => r.temp === 110);
    session.updateReading(middle.id, { temp: 105 });

    expect(shape(session.readings.value)).toEqual([
      [at(10), 100, 0, 0],
      [at(11), 105, 5, 5],
      [at(12), 120, 20, 15]
    ]);
  });

  it('keeps order and deltas consistent after a delete', () => {
    session.addReading(100, at(10));
    session.addReading(110, at(11));
    session.addReading(120, at(12));

    const middle = session.readings.value.find(r => r.temp === 110);
    session.deleteReading(middle.id);

    expect(shape(session.readings.value)).toEqual([
      [at(10), 100, 0, 0],
      [at(12), 120, 20, 20]
    ]);
  });

  it('rebases deltas when the earliest reading is the one back-dated in', () => {
    session.addReading(110, at(11));
    session.addReading(120, at(12));
    session.addReading(100, at(10)); // becomes the new first reading

    expect(shape(session.readings.value)).toEqual([
      [at(10), 100, 0, 0],
      [at(11), 110, 10, 10],
      [at(12), 120, 20, 10]
    ]);
  });

  it('converts display units before storing, then derives deltas in Fahrenheit', () => {
    session.endSession();
    session = useSession();
    session.startSession({ targetTemp: 200, units: 'C' });

    session.addReading(40, at(10)); // 104F
    session.addReading(50, at(11)); // 122F

    const readings = session.readings.value;
    expect(readings[0].temp).toBe(104);
    expect(readings[1].temp).toBe(122);
    expect(readings[1].deltaFromPrevious).toBe(18);
  });
});

describe('useSession autosave watcher', () => {
  let session;

  beforeEach(() => {
    localStorage.clear();
    // Only the timers - Vitest fakes Date too by default, and these assertions
    // depend on real timestamps advancing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    session = useSession();
    session.startSession({ targetTemp: 200, units: 'F' });
  });

  afterEach(() => {
    session.endSession();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('does not mutate the reactive session it watches', async () => {
    const stamp = '2020-01-01T00:00:00.000Z';
    session.session.value.config.updatedAt = stamp;

    session.addReading(100, at(10));
    await nextTick();
    vi.advanceTimersByTime(UI_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS + 1);
    await nextTick();

    // The stamp landed in storage but never on the watched object
    expect(session.session.value.config.updatedAt).toBe(stamp);
    const stored = JSON.parse(localStorage.getItem('rstt_current_session'));
    expect(stored.config.updatedAt).not.toBe(stamp);
  });

  it('does not retrigger itself once the debounce has flushed', async () => {
    const saveSpy = vi.spyOn(storageService, 'saveSession');

    session.addReading(100, at(10));
    await nextTick();
    vi.advanceTimersByTime(UI_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS + 1);
    await nextTick();

    const afterFlush = saveSpy.mock.calls.length;
    expect(afterFlush).toBeGreaterThan(0);

    // No further mutation: a self-retriggering watcher would keep saving
    vi.advanceTimersByTime(UI_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS * 5);
    await nextTick();
    vi.advanceTimersByTime(UI_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS * 5);
    await nextTick();

    expect(saveSpy.mock.calls.length).toBe(afterFlush);
  });
});

describe('useSession settings persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** Fresh module instance - the composable state is a singleton */
  async function freshSession() {
    vi.resetModules();
    const mod = await import('./useSession.js');
    return mod.useSession();
  }

  it('writes settings to their own storage key when they change', async () => {
    const s = await freshSession();
    s.initialize();
    s.startSession({ targetTemp: 200, units: 'F' });

    s.updateSettings({ smoothingWindowReadings: 7, ovenTempMaxF: 275 });

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    expect(stored.smoothingWindowReadings).toBe(7);
    expect(stored.ovenTempMaxF).toBe(275);
  });

  it('restores persisted settings on initialize for an existing session', async () => {
    const first = await freshSession();
    first.initialize();
    first.startSession({ targetTemp: 200, units: 'F' });
    first.updateSettings({ smoothingWindowReadings: 7, ovenTempMaxF: 275 });

    const second = await freshSession();
    second.initialize();

    expect(second.hasActiveSession.value).toBe(true);
    expect(second.settings.value.smoothingWindowReadings).toBe(7);
    expect(second.settings.value.ovenTempMaxF).toBe(275);
  });

  it('carries settings into the next cook after the session is ended', async () => {
    const first = await freshSession();
    first.initialize();
    first.startSession({ targetTemp: 200, units: 'F' });
    first.updateSettings({ smoothingWindowMinutes: 45 });
    first.endSession();

    const second = await freshSession();
    second.initialize();
    expect(second.hasActiveSession.value).toBe(false);

    second.startSession({ targetTemp: 190, units: 'F' });
    expect(second.settings.value.smoothingWindowMinutes).toBe(45);
  });

  it('tolerates partial stored settings by filling in defaults', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ smoothingWindowReadings: 9 }));

    const s = await freshSession();
    s.initialize();
    s.startSession({ targetTemp: 200, units: 'F' });

    expect(s.settings.value.smoothingWindowReadings).toBe(9);
    expect(s.settings.value.ovenTempMaxF).toBe(300);
    expect(s.settings.value.minReadingsForRecommendation).toBe(3);
  });

  it('falls back to the session\'s own settings when stored settings are corrupt', async () => {
    const first = await freshSession();
    first.initialize();
    first.startSession({ targetTemp: 200, units: 'F' });
    first.updateSettings({ ovenTempMaxF: 260 });

    localStorage.setItem(SETTINGS_KEY, '{{{ not json');

    const second = await freshSession();
    second.initialize();

    expect(second.settings.value.ovenTempMaxF).toBe(260);
  });
});

describe('useSession oven-event invariants', () => {
  let session;

  beforeEach(() => {
    localStorage.clear();
    session = useSession();
    // No initialOvenTemp override: createSession still defaults config
    // .initialOvenTemp to 200, but startSession only logs an opening event
    // when one is passed explicitly. These tests want a clean event list.
    session.startSession({ targetTemp: 200, units: 'F' });
  });

  afterEach(() => {
    session.endSession();
    localStorage.clear();
  });

  it('places a back-dated oven event in timestamp order', () => {
    session.addOvenEvent(225, at(10));
    session.addOvenEvent(275, at(12));
    session.addOvenEvent(250, at(11)); // back-dated, arrives last

    expect(session.ovenEvents.value.map(e => e.timestamp)).toEqual([at(10), at(11), at(12)]);
    expect(session.ovenEvents.value.map(e => e.setTemp)).toEqual([225, 250, 275]);
  });

  it('derives previousTemp as a chain, with no predecessor for the first event', () => {
    session.addOvenEvent(225, at(10));
    session.addOvenEvent(275, at(11));

    // null, not config.initialOvenTemp: startSession builds the opening event
    // FROM that value, so seeding with it rendered "200°F from 200°F".
    expect(session.ovenEvents.value.map(e => e.previousTemp)).toEqual([null, 225]);
  });

  it('re-derives the next event\'s previousTemp when one is edited', () => {
    session.addOvenEvent(225, at(10));
    session.addOvenEvent(275, at(11));

    const first = session.ovenEvents.value[0];
    session.updateOvenEvent(first.id, { setTemp: 240 });

    // Without re-derivation the second event would still claim it changed
    // from 225, describing a step that never happened.
    expect(session.ovenEvents.value.map(e => e.setTemp)).toEqual([240, 275]);
    expect(session.ovenEvents.value.map(e => e.previousTemp)).toEqual([null, 240]);
  });

  it('re-derives previousTemp when an event is deleted from the middle', () => {
    session.addOvenEvent(225, at(10));
    session.addOvenEvent(250, at(11));
    session.addOvenEvent(275, at(12));

    const middle = session.ovenEvents.value[1];
    session.deleteOvenEvent(middle.id);

    expect(session.ovenEvents.value.map(e => e.setTemp)).toEqual([225, 275]);
    expect(session.ovenEvents.value.map(e => e.previousTemp)).toEqual([null, 225]);
  });

  it('reports the last temperature actually set, not the zero of an off event', () => {
    session.addOvenEvent(225, at(10));
    session.logOvenOff(at(11));

    // currentOvenTemp is what the oven is at: nothing.
    expect(session.currentOvenTemp.value).toBe(0);
    // lastActiveOvenTemp is what to restart it at. Rendering the former into
    // "then restart at {ovenTemp}" produced "restart at 0°F".
    expect(session.lastActiveOvenTemp.value).toBe(225);
  });

  it('falls back to the configured initial temp when no event has been logged', () => {
    expect(session.lastActiveOvenTemp.value).toBe(200);
  });

  it('keeps reporting the last active temp across an off/on cycle', () => {
    session.addOvenEvent(225, at(10));
    session.logOvenOff(at(11));
    session.logOvenOn(225, at(12));

    expect(session.lastActiveOvenTemp.value).toBe(225);
  });

  it('holds the last real setting across an oven-off event', () => {
    session.addOvenEvent(225, at(10));
    session.logOvenOff(at(11));
    session.logOvenOn(250, at(12));

    // The restart resumed from 225, not from the off event's stored 0 - which
    // the log would otherwise read as "no predecessor", i.e. an initial setting.
    expect(session.ovenEvents.value.map(e => e.previousTemp)).toEqual([null, 225, 225]);
  });

  it('leaves the opening event with no predecessor when startSession logged it', () => {
    // The opening event is stamped with `new Date()`, and every other event
    // here is stamped from at(), whose base day is fixed. Left to the real
    // clock this test asserts on whichever side of at(10) today happens to
    // fall - it passed for months and then failed on 2026-08-22, when the
    // fixture day WAS today and the opening event sorted second.
    //
    // Date only: the composable's autosave debounce is a real setTimeout and
    // faking it here would leave a pending write for the next test.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at(9)));
    try {
      session.endSession();
      session.startSession({ targetTemp: 200, units: 'F', initialOvenTemp: 200 });
      // The opening event exists; a later mutation must not rewrite its origin.
      session.addOvenEvent(225, at(10));

      expect(session.ovenEvents.value.map(e => e.setTemp)).toEqual([200, 225]);
      expect(session.ovenEvents.value[0].previousTemp).toBeNull();
      expect(session.ovenEvents.value[0].setTemp).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useSession units preference', () => {
  /**
   * The composable's state is a module singleton, so a genuinely fresh one
   * needs the module re-imported.
   */
  async function freshSession() {
    vi.resetModules();
    const mod = await import('./useSession.js');
    return mod.useSession();
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('records a units choice made with no cook running', async () => {
    const s = await freshSession();
    s.initialize();

    s.setUnits('C');

    // Settings is reachable from the header at all times, so this has to land
    // somewhere even with no session to write onto.
    expect(s.preferredUnits.value).toBe('C');
    expect(storageService.loadUnits()).toBe('C');
  });

  it('switches the running cook and the standing preference together', async () => {
    const s = await freshSession();
    s.initialize();
    s.startSession({ targetTemp: 200, units: 'F' });

    s.setUnits('C');

    expect(s.displayUnits.value).toBe('C');
    expect(storageService.loadUnits()).toBe('C');
  });

  it('seeds a new cook from the stored preference', async () => {
    const first = await freshSession();
    first.initialize();
    first.setUnits('C');
    first.endSession();

    const second = await freshSession();
    second.initialize();
    second.startSession({ targetTemp: 200 }); // no explicit units

    expect(second.displayUnits.value).toBe('C');
  });

  it('lets an explicit units choice at setup win over the preference', async () => {
    const first = await freshSession();
    first.initialize();
    first.setUnits('C');

    const second = await freshSession();
    second.initialize();
    second.startSession({ targetTemp: 200, units: 'F' });

    expect(second.displayUnits.value).toBe('F');
  });

  it('ignores a bogus units value', async () => {
    const s = await freshSession();
    s.initialize();
    s.setUnits('K');
    expect(s.preferredUnits.value).toBe(SESSION_DEFAULTS.UNITS);
  });

  it('offers the documented first-run default with nothing stored', async () => {
    const s = await freshSession();
    s.initialize();
    // Celsius. A hardcoded 'F' here silently changed the app's first-run
    // default for every fresh install and every upgrade from the old build.
    expect(s.preferredUnits.value).toBe('C');
    expect(SESSION_DEFAULTS.UNITS).toBe('C');
  });
});
