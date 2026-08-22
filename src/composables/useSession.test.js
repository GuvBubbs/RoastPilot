import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSession } from './useSession.js';
import { storageService } from '../services/storageService.js';
import { UI_CONSTANTS } from '../constants/defaults.js';

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
