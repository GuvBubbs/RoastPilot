import { createDefaultSettings, migrateSessionToV2 } from '../models/dataModels.js';

const STORAGE_KEYS = {
  CURRENT_SESSION: 'rstt_current_session',
  SETTINGS: 'rstt_settings',
  UNITS: 'rstt_units',
  // Separate from UNITS: weight has nothing to do with the temperature scale, and
  // a cook may well want pounds alongside Celsius.
  WEIGHT_UNIT: 'rstt_weight_unit',
  SCHEMA_VERSION: 'rstt_schema_version'
};

/**
 * v2 split the single ambiguous `targetTemp` into pullTempF / servingTempF /
 * carryoverF and added restMinutes. See migrateSessionToV2.
 */
const CURRENT_SCHEMA_VERSION = 2;

/**
 * Storage service for persisting application state to localStorage
 */
export const storageService = {
  /**
   * Initialize storage, performing migrations if necessary
   * @returns {boolean} Success status
   */
  initialize() {
    try {
      const storedVersion = this.getSchemaVersion();
      if (storedVersion < CURRENT_SCHEMA_VERSION) {
        this.migrateSchema(storedVersion, CURRENT_SCHEMA_VERSION);
      }
      return true;
    } catch (error) {
      console.error('Storage initialization failed:', error);
      return false;
    }
  },

  /**
   * Get the current schema version from storage
   * @returns {number}
   */
  getSchemaVersion() {
    const version = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
    return version ? parseInt(version, 10) : 0;
  },

  /**
   * Set the schema version
   * @param {number} version
   */
  setSchemaVersion(version) {
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, version.toString());
  },

  /**
   * Migrate schema from one version to another
   * @param {number} fromVersion
   * @param {number} toVersion
   */
  migrateSchema(fromVersion, toVersion) {
    console.log(`Migrating schema from v${fromVersion} to v${toVersion}`);
    
    // Each step must be idempotent, and must not change the meaning of a cook
    // that is happening right now. A session in storage is 4-8 hours of data
    // that cannot be recreated.
    
    if (fromVersion < 1 && toVersion >= 1) {
      // Initial schema setup - nothing to migrate.
    }
    
    if (fromVersion < 2 && toVersion >= 2) {
      // targetTemp -> pullTempF / servingTempF / carryoverF, plus restMinutes.
      // Rewritten in storage rather than patched on every load, so exactly one
      // place in the codebase ever sees the old key.
      const session = this.readSessionRaw();
      if (session?.config) {
        migrateSessionToV2(session);
        this.saveSession(session);
      }
    }
    
    this.setSchemaVersion(toVersion);
  },

  /**
   * The stored session exactly as it sits on disk, with no repair applied.
   *
   * Separate from loadSession because a migration has to see the raw shape -
   * loadSession is entitled to assume the current one.
   * @returns {Session|null}
   */
  readSessionRaw() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
      return serialized ? JSON.parse(serialized) : null;
    } catch (error) {
      console.error('Failed to read stored session:', error);
      return null;
    }
  },

  /**
   * Save the current session to storage
   * @param {Session} session
   * @returns {boolean} Success status
   */
  saveSession(session) {
    try {
      // Stamp updatedAt onto a copy, never onto the caller's object. The
      // autosave watcher in useSession watches the reactive session deeply, so
      // writing to it from here would retrigger the watcher that called us.
      const payload = {
        ...session,
        config: { ...session.config, updatedAt: new Date().toISOString() }
      };
      
      const serialized = JSON.stringify(payload);
      localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, serialized);
      return true;
    } catch (error) {
      console.error('Failed to save session:', error);
      // Handle quota exceeded error
      if (error.name === 'QuotaExceededError') {
        console.error('localStorage quota exceeded');
      }
      return false;
    }
  },

  /**
   * Load the current session from storage
   * @returns {Session|null}
   */
  loadSession() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
      if (!serialized) {
        return null;
      }
      
      const session = JSON.parse(serialized);
      
      // Validate required fields exist
      if (!session.config || !Array.isArray(session.readings) || !Array.isArray(session.ovenEvents)) {
        console.warn('Invalid session structure, returning null');
        return null;
      }
      
      // Ensure settings exist (for sessions created before settings were added)
      if (!session.settings) {
        session.settings = createDefaultSettings();
      }
      
      // Belt to migrateSchema's braces. resumeSession() and the screenshot
      // harness both reach loadSession without going through initialize(), and a
      // config with no pullTempF would project against undefined - which is a
      // blank ETA rather than a wrong one, but still a broken screen.
      // Idempotent, so running it on an already-migrated session is free.
      migrateSessionToV2(session);
      
      return session;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  },

  /**
   * Check if a session exists in storage
   * @returns {boolean}
   */
  hasSession() {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION) !== null;
  },

  /**
   * Clear the current session from storage
   * @returns {boolean} Success status
   */
  clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
      return true;
    } catch (error) {
      console.error('Failed to clear session:', error);
      return false;
    }
  },

  /**
   * Remove every key this app owns. Deliberately not localStorage.clear() —
   * the origin is shared with other sites on the same host.
   * @returns {boolean} Success status
   */
  clearAll() {
    try {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      return true;
    } catch (error) {
      console.error('Failed to clear storage:', error);
      return false;
    }
  },

  /**
   * Save application settings independent of session
   * @param {AppSettings} settings
   * @returns {boolean} Success status
   */
  saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error('Failed to save settings:', error);
      return false;
    }
  },

  /**
   * Load application settings
   * Returns null when nothing usable is stored so callers can tell "never
   * saved" from "saved the defaults" and avoid clobbering a session's own
   * settings on first run.
   * @returns {AppSettings|null}
   */
  loadSettings() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!serialized) {
        return null;
      }
      
      const stored = JSON.parse(serialized);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        console.warn('Invalid settings structure, ignoring stored settings');
        return null;
      }
      
      // Merge over defaults: tolerates partial stored data and keys added in
      // later versions.
      return { ...createDefaultSettings(), ...stored };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return null;
    }
  },

  /**
   * Save the preferred temperature units
   *
   * Units live in `session.config.units` for the active cook - that is the one
   * field the UI reads. This slot exists only to seed the *next* cook, so a
   * Celsius user does not start every session back on Fahrenheit.
   * @param {'F'|'C'} units
   * @returns {boolean} Success
   */
  saveUnits(units) {
    try {
      localStorage.setItem(STORAGE_KEYS.UNITS, units);
      return true;
    } catch (error) {
      console.error('Failed to save units:', error);
      return false;
    }
  },

  /**
   * Load the preferred temperature units
   * @returns {'F'|'C'|null} null when nothing valid is stored
   */
  loadUnits() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.UNITS);
      return stored === 'F' || stored === 'C' ? stored : null;
    } catch (error) {
      console.error('Failed to load units:', error);
      return null;
    }
  },

  /**
   * Save the preferred weight unit
   * @param {'lb'|'kg'} unit
   * @returns {boolean} Success
   */
  saveWeightUnit(unit) {
    try {
      localStorage.setItem(STORAGE_KEYS.WEIGHT_UNIT, unit);
      return true;
    } catch (error) {
      console.error('Failed to save weight unit:', error);
      return false;
    }
  },

  /**
   * Load the preferred weight unit
   * @returns {'lb'|'kg'|null} null when nothing valid is stored
   */
  loadWeightUnit() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.WEIGHT_UNIT);
      return stored === 'lb' || stored === 'kg' ? stored : null;
    } catch (error) {
      console.error('Failed to load weight unit:', error);
      return null;
    }
  },

  /**
   * Get storage usage information
   * @returns {{used: number, available: number, percentage: number}}
   */
  getStorageInfo() {
    // Only count our own keys — the origin is shared with other sites on the
    // same host, so a full scan would over-report.
    let used = 0;
    Object.values(STORAGE_KEYS).forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null) {
        used += (key.length + value.length) * 2; // UTF-16 = 2 bytes per char
      }
    });
    
    // localStorage limit is typically 5-10MB
    const estimatedLimit = 5 * 1024 * 1024; // 5MB
    
    return {
      used,
      available: estimatedLimit - used,
      percentage: (used / estimatedLimit) * 100
    };
  }
};





