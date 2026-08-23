import { describe, it, expect, beforeEach } from 'vitest';
import { storageService } from './storageService.js';
import { createSession, createDefaultSettings } from '../models/dataModels.js';

const SESSION_KEY = 'rstt_current_session';
const SETTINGS_KEY = 'rstt_settings';

describe('storageService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveSession', () => {
    it('stamps updatedAt on the persisted copy, not on the caller\'s object', () => {
      const session = createSession({ targetTemp: 125, units: 'F' });
      session.config.updatedAt = '2020-01-01T00:00:00.000Z';

      const before = JSON.stringify(session);
      expect(storageService.saveSession(session)).toBe(true);

      // The reactive session the autosave watcher watches must be untouched
      expect(JSON.stringify(session)).toBe(before);
      expect(session.config.updatedAt).toBe('2020-01-01T00:00:00.000Z');
    });

    it('persists a stamped payload that still round-trips', () => {
      const session = createSession({ targetTemp: 130, units: 'C' });
      session.config.updatedAt = '2020-01-01T00:00:00.000Z';

      storageService.saveSession(session);
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY));

      // The legacy `targetTemp` was where the cook STOPS, so it lands on
      // pullTempF. It is also written back out beside it, as a shadow, so a
      // rolled-back build can still read this cook - see legacyCompatConfig.
      expect(stored.config.pullTempF).toBe(130);
      expect(stored.config.targetTemp).toBe(130);
      expect(stored.config.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
      expect(Number.isNaN(Date.parse(stored.config.updatedAt))).toBe(false);
      expect(stored.readings).toEqual([]);
      expect(stored.settings).toBeTruthy();
    });
  });

  describe('settings persistence', () => {
    it('round-trips saved settings', () => {
      const settings = { ...createDefaultSettings(), readingIntervalMinutes: 35, ovenTempMaxF: 275 };

      expect(storageService.saveSettings(settings)).toBe(true);
      expect(storageService.loadSettings()).toEqual(settings);
    });

    it('returns null when nothing has ever been saved', () => {
      expect(storageService.loadSettings()).toBeNull();
    });

    it('merges partial stored settings over defaults, so keys added later are filled in', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ readingIntervalMinutes: 25 }));

      const loaded = storageService.loadSettings();
      expect(loaded.readingIntervalMinutes).toBe(25);
      expect(loaded.ovenTempMaxF).toBe(createDefaultSettings().ovenTempMaxF);
      expect(loaded.staleReadingMinutes).toBe(createDefaultSettings().staleReadingMinutes);
    });

    it('returns null for corrupt or non-object stored settings', () => {
      localStorage.setItem(SETTINGS_KEY, 'not json at all');
      expect(storageService.loadSettings()).toBeNull();

      localStorage.setItem(SETTINGS_KEY, JSON.stringify([1, 2, 3]));
      expect(storageService.loadSettings()).toBeNull();

      localStorage.setItem(SETTINGS_KEY, JSON.stringify(null));
      expect(storageService.loadSettings()).toBeNull();
    });

    it('keeps settings when the session is cleared', () => {
      storageService.saveSession(createSession());
      storageService.saveSettings({ ...createDefaultSettings(), staleReadingMinutes: 75 });

      storageService.clearSession();

      expect(storageService.hasSession()).toBe(false);
      expect(storageService.loadSettings().staleReadingMinutes).toBe(75);
    });
  });

  it('no longer carries the dead export helpers', () => {
    expect(storageService.exportSession).toBeUndefined();
    expect(storageService.sessionToCSV).toBeUndefined();
  });
});
