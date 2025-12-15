import { createSession, createDefaultSettings } from '../models/dataModels.js';

const STORAGE_KEYS = {
  CURRENT_SESSION: 'rstt_current_session',
  SETTINGS: 'rstt_settings',
  SCHEMA_VERSION: 'rstt_schema_version'
};

const CURRENT_SCHEMA_VERSION = 1;

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
    
    // Migration logic for future schema changes
    // Each migration step should be idempotent
    
    if (fromVersion < 1 && toVersion >= 1) {
      // Initial schema setup - no migration needed
      // Future migrations would go here:
      // if (fromVersion < 2 && toVersion >= 2) { ... }
    }
    
    this.setSchemaVersion(toVersion);
  },

  /**
   * Save the current session to storage
   * @param {Session} session
   * @returns {boolean} Success status
   */
  saveSession(session) {
    try {
      // Update the updatedAt timestamp
      session.config.updatedAt = new Date().toISOString();
      
      const serialized = JSON.stringify(session);
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
   * @returns {AppSettings}
   */
  loadSettings() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!serialized) {
        return createDefaultSettings();
      }
      
      const stored = JSON.parse(serialized);
      // Merge with defaults to handle new settings fields
      return { ...createDefaultSettings(), ...stored };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return createDefaultSettings();
    }
  },

  /**
   * Export session data for download
   * @param {Session} session
   * @param {'json'|'csv'} format
   * @returns {string}
   */
  exportSession(session, format) {
    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    }
    
    if (format === 'csv') {
      return this.sessionToCSV(session);
    }
    
    throw new Error(`Unsupported export format: ${format}`);
  },

  /**
   * Convert session to CSV format
   * @param {Session} session
   * @returns {string}
   */
  sessionToCSV(session) {
    const lines = [];
    
    // Session metadata header
    lines.push('# Session Configuration');
    lines.push(`Target Temp,${session.config.targetTemp}`);
    lines.push(`Units,${session.config.units}`);
    lines.push(`Started,${session.config.createdAt}`);
    if (session.config.meatType) lines.push(`Meat Type,${session.config.meatType}`);
    if (session.config.weight) lines.push(`Weight,${session.config.weight}`);
    lines.push('');
    
    // Internal readings
    lines.push('# Internal Temperature Readings');
    lines.push('Timestamp,Temperature,Delta From Start,Delta From Previous');
    session.readings.forEach(r => {
      lines.push(`${r.timestamp},${r.temp},${r.deltaFromStart ?? ''},${r.deltaFromPrevious ?? ''}`);
    });
    lines.push('');
    
    // Oven events
    lines.push('# Oven Temperature Events');
    lines.push('Timestamp,Set Temperature,Previous Temperature');
    session.ovenEvents.forEach(e => {
      lines.push(`${e.timestamp},${e.setTemp},${e.previousTemp ?? ''}`);
    });
    
    return lines.join('\n');
  },

  /**
   * Get storage usage information
   * @returns {{used: number, available: number, percentage: number}}
   */
  getStorageInfo() {
    let used = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage.getItem(key).length * 2; // UTF-16 = 2 bytes per char
      }
    }
    
    // localStorage limit is typically 5-10MB
    const estimatedLimit = 5 * 1024 * 1024; // 5MB
    
    return {
      used,
      available: estimatedLimit - used,
      percentage: (used / estimatedLimit) * 100
    };
  }
};


