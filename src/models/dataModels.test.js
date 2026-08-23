/**
 * dataModels had no tests, and it is now where the pull / serving / carryover
 * triple is resolved and where the legacy `targetTemp` shim lives. Those are the
 * two things that decide whether a cook in progress survives a deploy.
 */
import { describe, it, expect } from 'vitest';
import {
  createSession,
  createDefaultSettings,
  createReading,
  createOvenEvent,
  migrateSessionToV2,
  generateUUID
} from './dataModels.js';
import { SESSION_DEFAULTS } from '../constants/defaults.js';

describe('createSession temperature resolution', () => {
  it('derives the pull from the plate temperature for a new cook', () => {
    const { config } = createSession({ servingTempF: 125, initialOvenTemp: 200 });
    expect(config.servingTempF).toBe(125);
    expect(config.carryoverF).toBe(4);
    expect(config.pullTempF).toBe(121);
    expect(config.carryoverIsUserSet).toBe(false);
  });

  it('defaults to medium-rare on the plate', () => {
    const { config } = createSession({});
    expect(config.servingTempF).toBe(SESSION_DEFAULTS.SERVING_TEMP_F);
    expect(config.pullTempF).toBe(SESSION_DEFAULTS.SERVING_TEMP_F - 4);
  });

  it('reads the legacy targetTemp as the PULL temperature', () => {
    // The old build stopped the cook exactly at targetTemp. Reading it as a
    // plate temperature would derive a pull several degrees lower and move a
    // running cook's finish line the instant the new build shipped.
    const { config } = createSession({ targetTemp: 195, initialOvenTemp: 225 });
    expect(config.pullTempF).toBe(195);
    expect(config.carryoverF).toBe(5);
    expect(config.servingTempF).toBe(200);
  });

  it('does not let the legacy key survive into the config', () => {
    // The shim is one function. If the ambiguous name reached storage, something
    // that never went through the shim could read it again.
    const { config } = createSession({ targetTemp: 125 });
    expect('targetTemp' in config).toBe(false);
  });

  it('honours an explicit pull that disagrees with the derived one', () => {
    // The settings panel sends all three, having derived the pull itself from
    // the unit the cook is reading. It must win over a re-derivation here.
    const { config } = createSession({
      servingTempF: 130,
      pullTempF: 122,
      carryoverF: 8,
      carryoverIsUserSet: true
    });
    expect(config.pullTempF).toBe(122);
    expect(config.servingTempF).toBe(130);
    expect(config.carryoverF).toBe(8);
    expect(config.carryoverIsUserSet).toBe(true);
  });

  it('scales carryover with the oven the cook chose', () => {
    expect(createSession({ initialOvenTemp: 175 }).config.carryoverF).toBe(3);
    expect(createSession({ initialOvenTemp: 300 }).config.carryoverF).toBe(8);
  });

  it('gives a NEW session a real rest', () => {
    expect(createSession({}).config.restMinutes).toBe(SESSION_DEFAULTS.REST_MINUTES);
    expect(createSession({ restMinutes: 30 }).config.restMinutes).toBe(30);
    expect(createSession({ restMinutes: 0 }).config.restMinutes).toBe(0);
  });

  it('starts with empty readings, events and default settings', () => {
    const session = createSession({});
    expect(session.readings).toEqual([]);
    expect(session.ovenEvents).toEqual([]);
    expect(session.settings).toEqual(createDefaultSettings());
  });
});

describe('migrateSessionToV2', () => {
  const v1 = () => ({
    config: {
      id: 'x',
      targetTemp: 125,
      units: 'F',
      initialOvenTemp: 200,
      desiredServeTime: '2026-08-22T23:00:00.000Z'
    },
    readings: [],
    ovenEvents: [],
    settings: createDefaultSettings()
  });

  it('maps targetTemp to pullTempF and derives the plate upward', () => {
    const { config } = migrateSessionToV2(v1());
    expect(config.pullTempF).toBe(125);
    expect(config.carryoverF).toBe(4);
    expect(config.servingTempF).toBe(129);
    /**
     * The legacy key is KEPT, as a shadow of pullTempF rather than as a second
     * source of truth. It was deleted here until a rollback was tried: a session
     * this build wrote carried no key the previous build could read, so it came
     * back undefined and reached `new Date(NaN)` inside a render. See
     * legacyCompatConfig, and the backward-compatibility block in
     * storageCompat.test.js which runs the actual previous build against it.
     */
    expect(config.targetTemp).toBe(config.pullTempF);
  });

  it('gives a migrated cook ZERO rest', () => {
    // Not the 20-minute new-session default. A cook already running chose their
    // serve time against a projection with no rest in it; subtracting 20 minutes
    // retroactively would flip them from "on track" to "20 min late".
    expect(migrateSessionToV2(v1()).config.restMinutes).toBe(0);
  });

  it('is idempotent', () => {
    const session = migrateSessionToV2(v1());
    const first = { ...session.config };
    migrateSessionToV2(session);
    expect(session.config).toEqual(first);
  });

  it('leaves an already-migrated session alone', () => {
    const v2 = {
      config: {
        pullTempF: 118, servingTempF: 125, carryoverF: 7,
        carryoverIsUserSet: true, restMinutes: 45, initialOvenTemp: 300
      },
      readings: [], ovenEvents: [], settings: createDefaultSettings()
    };
    const { config } = migrateSessionToV2(v2);
    expect(config.pullTempF).toBe(118);
    expect(config.carryoverF).toBe(7);
    expect(config.carryoverIsUserSet).toBe(true);
    expect(config.restMinutes).toBe(45);
  });

  it('survives a config with neither key', () => {
    const orphan = { config: { units: 'F' }, readings: [], ovenEvents: [] };
    const { config } = migrateSessionToV2(orphan);
    expect(Number.isFinite(config.pullTempF)).toBe(true);
    expect(Number.isFinite(config.servingTempF)).toBe(true);
    expect(config.restMinutes).toBe(0);
  });

  it('survives a session with no config at all', () => {
    expect(() => migrateSessionToV2(null)).not.toThrow();
    expect(() => migrateSessionToV2({})).not.toThrow();
  });
});

describe('createReading / createOvenEvent', () => {
  it('stores an off event as 0 whatever temperature was passed', () => {
    // The field an off event writes is read as a set point in several places;
    // an off event carrying 225 would look like the oven being set to 225.
    expect(createOvenEvent(225, null, null, true).setTemp).toBe(0);
    expect(createOvenEvent(225, null, null, false).setTemp).toBe(225);
  });

  it('defaults timestamps to now and accepts an explicit one', () => {
    expect(createReading(100, '2026-01-01T00:00:00.000Z').timestamp)
      .toBe('2026-01-01T00:00:00.000Z');
    expect(Number.isNaN(Date.parse(createReading(100).timestamp))).toBe(false);
  });

  it('leaves the deltas for normalizeReadings to fill in', () => {
    const reading = createReading(100);
    expect(reading.deltaFromStart).toBeNull();
    expect(reading.deltaFromPrevious).toBeNull();
  });
});

describe('generateUUID', () => {
  it('produces a v4-shaped id', () => {
    expect(generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('does not collide across a thousand draws', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(generateUUID());
    expect(seen.size).toBe(1000);
  });
});
