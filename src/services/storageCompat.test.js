import { describe, it, expect, beforeEach } from 'vitest';
import { storageService } from './storageService.js';
import { useSession } from '../composables/useSession.js';
import { computeSessionCalculations } from './calculationService.js';

/**
 * Forward-compatibility guard.
 *
 * A cook in progress is 4-8 hours of data that cannot be recreated. Deploying a
 * new build mid-cook must not lose it, so these tests pin a session in the
 * EXACT shape the pre-redesign build wrote (captured from `createSession` at
 * commit e054a68) and assert the current code picks it up and keeps going.
 *
 * If a future change breaks this, it breaks someone's dinner.
 */

const STORAGE_KEYS = {
  CURRENT_SESSION: 'rstt_current_session',
  SETTINGS: 'rstt_settings',
  SCHEMA_VERSION: 'rstt_schema_version'
};

/** A session exactly as the old build serialized it: 4 hours into a cook. */
function legacySession() {
  return {
    config: {
      id: '3f2b1c44-0000-4000-8000-000000000001',
      targetTemp: 125,
      units: 'F',
      startingTemp: 48,
      desiredServeTime: '2026-08-22T23:00:00.000Z',
      desiredTimeRemaining: null,
      initialOvenTemp: 200,
      meatType: 'beef',
      meatCut: 'sirloin',
      weight: 2.4,
      notes: 'anniversary',
      createdAt: '2026-08-22T18:00:00.000Z',
      updatedAt: '2026-08-22T21:30:00.000Z'
    },
    readings: [
      { id: 'r1', temp: 48, timestamp: '2026-08-22T18:00:00.000Z', deltaFromStart: 0, deltaFromPrevious: 0 },
      { id: 'r2', temp: 71, timestamp: '2026-08-22T19:30:00.000Z', deltaFromStart: 23, deltaFromPrevious: 23 },
      { id: 'r3', temp: 94, timestamp: '2026-08-22T21:00:00.000Z', deltaFromStart: 46, deltaFromPrevious: 23 },
      { id: 'r4', temp: 103, timestamp: '2026-08-22T21:30:00.000Z', deltaFromStart: 55, deltaFromPrevious: 9 }
    ],
    ovenEvents: [
      { id: 'o1', setTemp: 200, timestamp: '2026-08-22T18:00:00.000Z', previousTemp: null, isOff: false },
      { id: 'o2', setTemp: 225, timestamp: '2026-08-22T20:00:00.000Z', previousTemp: 200, isOff: false }
    ],
    // The old build's createDefaultSettings(), which still carried `units`.
    settings: {
      units: 'F',
      smoothingWindowReadings: 3,
      smoothingWindowMinutes: 30,
      smoothingMode: 'readings',
      onTrackThresholdMinutes: 10,
      recommendationStepF: 10,
      recommendationMaxStepF: 25,
      ovenTempMinF: 150,
      ovenTempMaxF: 300,
      ovenTempPracticalMinF: 175,
      enableLowTempRecommendations: true,
      minReadingsForRecommendation: 3,
      minTimeSpanMinutes: 30,
      ovenTempStaleMinutes: 60
    }
  };
}

/**
 * useSession keeps its state at module scope (deliberately - it is a
 * singleton), so each test has to reset both storage and that shared state.
 */
function freshSession() {
  const api = useSession();
  api.session.value = null;
  api.isInitialized.value = false;
  return api;
}

describe('forward compatibility with a pre-redesign stored session', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, '1');
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(legacySession()));
  });

  it('migrates v1 to v2 and keeps the session', () => {
    expect(storageService.getSchemaVersion()).toBe(1);
    storageService.initialize();
    expect(storageService.getSchemaVersion()).toBe(2);
    expect(storageService.loadSession()).not.toBeNull();
  });

  it('maps the legacy targetTemp to the PULL temperature, not the plate', () => {
    // The migration rule that matters most. The old build stopped the cook
    // exactly at targetTemp, so that number is where the meat comes OUT. Reading
    // it as a plate temperature would derive a pull 3-8 °F lower and move a
    // running cook's finish line the moment the new build deployed - the roast
    // would be declared done while it was still short.
    storageService.initialize();
    const stored = storageService.loadSession();

    expect(stored.config.pullTempF).toBe(125);
    expect(stored.config.servingTempF).toBe(129); // 125 + 4 carryover at 200 °F
    expect(stored.config.carryoverF).toBe(4);
    expect(stored.config.carryoverIsUserSet).toBe(false);
    // Gone, so nothing downstream can read the ambiguous key again.
    expect('targetTemp' in stored.config).toBe(false);
  });

  it('gives a migrated cook ZERO rest, not the new-session default', () => {
    // A cook already running set their serve time against a projection with no
    // rest in it. Inserting 20 minutes now would announce that dinner is late,
    // about a decision the cook never made.
    storageService.initialize();
    expect(storageService.loadSession().config.restMinutes).toBe(0);
  });

  it('does not move the schedule verdict across the migration', () => {
    // The whole point, stated as the number a cook would see. Same readings,
    // same serve time, same projection - so the same verdict.
    const before = computeSessionCalculations({
      readings: legacySession().readings,
      pullTempF: 125,
      desiredServeTime: '2026-08-22T23:00:00.000Z',
      settings: legacySession().settings,
      now: '2026-08-22T21:30:00.000Z'
    });

    storageService.initialize();
    const stored = storageService.loadSession();
    const after = computeSessionCalculations({
      readings: stored.readings,
      ovenEvents: stored.ovenEvents,
      pullTempF: stored.config.pullTempF,
      desiredServeTime: stored.config.desiredServeTime,
      restMinutes: stored.config.restMinutes,
      settings: stored.settings,
      now: '2026-08-22T21:30:00.000Z'
    });

    expect(after.predictedTargetTime).toBe(before.predictedTargetTime);
    expect(after.scheduleVarianceMinutes).toBe(before.scheduleVarianceMinutes);
    expect(after.scheduleStatus).toBe(before.scheduleStatus);
  });

  it('is idempotent: migrating twice changes nothing', () => {
    storageService.initialize();
    const once = JSON.parse(JSON.stringify(storageService.loadSession().config));

    // Force the migration to run again over the already-migrated blob.
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, '1');
    storageService.initialize();
    const twice = storageService.loadSession().config;

    expect(twice.pullTempF).toBe(once.pullTempF);
    expect(twice.servingTempF).toBe(once.servingTempF);
    expect(twice.carryoverF).toBe(once.carryoverF);
    expect(twice.restMinutes).toBe(once.restMinutes);
  });

  it('resumes the cook with every reading and oven event intact', () => {
    const { initialize, readings, ovenEvents, config, hasActiveSession } = freshSession();
    initialize();

    expect(hasActiveSession.value).toBe(true);
    expect(readings.value).toHaveLength(4);
    expect(readings.value.map((r) => r.temp)).toEqual([48, 71, 94, 103]);
    expect(ovenEvents.value).toHaveLength(2);
    expect(config.value.meatType).toBe('beef');
    expect(config.value.pullTempF).toBe(125);
    expect(config.value.desiredServeTime).toBe('2026-08-22T23:00:00.000Z');
  });

  it('keeps the session units the cook chose', () => {
    // `units` moved out of settings and onto config this wave. A stored
    // session's config.units is what the UI reads, so it must be honoured.
    const { initialize, displayUnits } = freshSession();
    initialize();
    expect(displayUnits.value).toBe('F');
  });

  it('honours Celsius from a stored session', () => {
    const stored = legacySession();
    stored.config.units = 'C';
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(stored));

    const { initialize, displayUnits } = freshSession();
    initialize();
    expect(displayUnits.value).toBe('C');
  });

  it('does not lose settings the old build stored', () => {
    const { initialize, settings } = freshSession();
    initialize();
    // Read from the session's own settings; the standalone settings key was
    // never written by the old build, so there is nothing to override with.
    expect(settings.value.smoothingWindowReadings).toBe(3);
    expect(settings.value.ovenTempMaxF).toBe(300);
    expect(settings.value.minReadingsForRecommendation).toBe(3);
  });

  it('lets the cook carry on logging readings', () => {
    const { initialize, addReading, readings, latestReading } = freshSession();
    initialize();

    addReading(112, '2026-08-22T22:00:00.000Z');

    expect(readings.value).toHaveLength(5);
    expect(latestReading.value.temp).toBe(112);
    expect(latestReading.value.deltaFromPrevious).toBe(9);
    expect(latestReading.value.deltaFromStart).toBe(64);
  });

  it('lets the cook carry on logging oven changes', () => {
    const { initialize, addOvenEvent, ovenEvents, currentOvenTemp } = freshSession();
    initialize();

    addOvenEvent(250, '2026-08-22T22:00:00.000Z');

    expect(ovenEvents.value).toHaveLength(3);
    expect(currentOvenTemp.value).toBe(250);
  });

  it('still predicts an ETA from the restored readings', () => {
    const { initialize, readings, config, settings } = freshSession();
    initialize();

    // Driven through the service rather than useCalculations so the test needs
    // no component instance for the refresh timer.
    const result = computeSessionCalculations({
      readings: readings.value,
      pullTempF: config.value.pullTempF,
      restMinutes: config.value.restMinutes,
      desiredServeTime: config.value.desiredServeTime,
      settings: settings.value,
      now: '2026-08-22T21:30:00.000Z'
    });

    expect(result.currentRate).toBeGreaterThan(0);
    expect(result.predictedTargetTime).not.toBeNull();
    expect(result.scheduleStatus).not.toBe('unknown');
  });

  it('persists the resumed session back without corrupting it', () => {
    const { initialize, addReading } = freshSession();
    initialize();
    addReading(112, '2026-08-22T22:00:00.000Z');

    const reloaded = storageService.loadSession();
    expect(reloaded.readings).toHaveLength(5);
    expect(reloaded.config.meatType).toBe('beef');
    expect(reloaded.config.units).toBe('F');
    // The autosave stamp reaches storage...
    expect(reloaded.config.updatedAt).not.toBe('2026-08-22T21:30:00.000Z');
  });

  it('repairs a session whose readings were stored out of order', () => {
    // The old build could persist an out-of-order list when a reading was
    // back-dated. Loading now sorts and re-derives - the deltas change, and
    // the new ones are the correct ones.
    const stored = legacySession();
    stored.readings = [
      { id: 'r1', temp: 48, timestamp: '2026-08-22T18:00:00.000Z', deltaFromStart: 0, deltaFromPrevious: 0 },
      { id: 'r3', temp: 94, timestamp: '2026-08-22T21:00:00.000Z', deltaFromStart: 46, deltaFromPrevious: 46 },
      { id: 'r2', temp: 71, timestamp: '2026-08-22T19:30:00.000Z', deltaFromStart: 23, deltaFromPrevious: -23 }
    ];
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(stored));

    const { initialize, readings } = freshSession();
    initialize();

    expect(readings.value.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    // The first reading has no predecessor, so `recalculateDeltas` gives it 0 -
    // unchanged from the old build. Rendering that as a dash is the log's job.
    expect(readings.value.map((r) => r.deltaFromPrevious)).toEqual([0, 23, 23]);
    expect(readings.value).toHaveLength(3);
  });

  it('repairs a session whose oven events were stored out of order', () => {
    // The tail of ovenEvents is "the current setting" for currentOvenTemp,
    // lastActiveOvenTemp, isPaused, the chart's oven track and the
    // responsiveness analysis. Readings were normalised on load; oven events
    // were not, so a reversed list reported the wrong oven temperature.
    const stored = legacySession();
    stored.ovenEvents = [
      { id: 'o2', setTemp: 275, timestamp: '2026-08-22T20:00:00.000Z', previousTemp: 200, isOff: false },
      { id: 'o1', setTemp: 200, timestamp: '2026-08-22T18:00:00.000Z', previousTemp: null, isOff: false }
    ];
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(stored));

    const { initialize, ovenEvents, currentOvenTemp } = freshSession();
    initialize();

    expect(ovenEvents.value.map((e) => e.id)).toEqual(['o1', 'o2']);
    expect(currentOvenTemp.value).toBe(275);
    expect(ovenEvents.value.map((e) => e.previousTemp)).toEqual([null, 200]);
  });

  it('survives a stored session carrying keys this build does not know', () => {
    const stored = legacySession();
    stored.config.someFutureField = 'ignore me';
    stored.settings.someRemovedSetting = 42;
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(stored));

    const { initialize, readings, hasActiveSession } = freshSession();
    initialize();

    expect(hasActiveSession.value).toBe(true);
    expect(readings.value).toHaveLength(4);
  });
});
