# Phase 1: Foundation & Data Layer

## Phase Objectives

Establish the project foundation including build tooling, core data models, type definitions, storage service, and utility functions. This phase creates the architectural backbone that all subsequent phases build upon.

## Prerequisites

None - this is the first phase.

## Deliverables

1. Initialized Vite + Vue 3 project with Tailwind CSS
2. PWA manifest and service worker configuration
3. Complete data model definitions
4. Storage service with localStorage persistence
5. Temperature and time utility functions
6. Constants and default configuration values

---

## Task 1.1: Project Initialization

### Description
Initialize a new Vite project with Vue 3 and configure essential tooling.

### Implementation Steps

Create a new Vite project using the Vue template. The project should be configured for modern ES modules and include the following dependencies.

**Production Dependencies:**
- vue@^3.4
- pinia@^2.1 (state management)
- chart.js@^4.4
- chartjs-plugin-annotation@^3.0
- @vueuse/core@^10 (utility composables, particularly for localStorage)

**Development Dependencies:**
- tailwindcss@^3.4
- postcss
- autoprefixer
- vite-plugin-pwa@^0.19

### Configuration Files Required

**vite.config.js** must include the PWA plugin configuration with the following manifest properties: name set to "Reverse Sear Tracker", short_name set to "RoastTracker", theme_color of "#dc2626" (a red tone appropriate for cooking apps), background_color of "#ffffff", display set to "standalone", and appropriate icons at 192x192 and 512x512 sizes.

**tailwind.config.js** must extend the default theme with custom colors for status indicators: a "safe" green (#22c55e), "warning" amber (#f59e0b), and "danger" red (#ef4444). Add custom spacing values for the chart container heights: "chart-sm" at 200px and "chart-lg" at 300px.

**postcss.config.js** should include tailwindcss and autoprefixer plugins in the standard configuration.

### File Output
Create an index.html with a root div element having id "app", appropriate meta viewport tag for mobile responsiveness, and a link to a favicon.

---

## Task 1.2: Data Model Definitions

### Description
Define TypeScript-style interfaces as JSDoc comments for all data structures. Even if not using TypeScript, these serve as canonical documentation for data shapes.

### File: /src/models/dataModels.js

```javascript
/**
 * @typedef {Object} SessionConfig
 * @property {string} id - Unique session identifier (UUID v4)
 * @property {number} targetTemp - Target internal temperature in Fahrenheit
 * @property {'F'|'C'} units - Display unit preference
 * @property {number|null} startingTemp - Optional starting internal temp in Fahrenheit
 * @property {string|null} desiredServeTime - ISO 8601 datetime string or null
 * @property {number|null} desiredTimeRemaining - Minutes until desired serve time (alternative to serveTime)
 * @property {number} initialOvenTemp - Initial oven set temperature in Fahrenheit
 * @property {string|null} meatType - Optional: e.g., "Prime Rib", "Pork Shoulder"
 * @property {string|null} meatCut - Optional: e.g., "Bone-in", "Boneless"
 * @property {number|null} weight - Optional: weight in pounds
 * @property {string|null} notes - Optional: free-form notes
 * @property {string} createdAt - ISO 8601 datetime when session started
 * @property {string} updatedAt - ISO 8601 datetime of last modification
 */

/**
 * @typedef {Object} InternalReading
 * @property {string} id - Unique reading identifier (UUID v4)
 * @property {number} temp - Internal temperature in Fahrenheit (canonical unit)
 * @property {string} timestamp - ISO 8601 datetime when reading was taken
 * @property {number|null} deltaFromStart - Computed: degrees change from first reading
 * @property {number|null} deltaFromPrevious - Computed: degrees change from previous reading
 */

/**
 * @typedef {Object} OvenTempEvent
 * @property {string} id - Unique event identifier (UUID v4)
 * @property {number} setTemp - Oven set temperature in Fahrenheit (canonical unit)
 * @property {string} timestamp - ISO 8601 datetime when oven was adjusted
 * @property {number|null} previousTemp - The oven temp before this change (null for first entry)
 */

/**
 * @typedef {Object} CalculationResult
 * @property {number|null} currentRate - Degrees F per hour, null if insufficient data
 * @property {number|null} averageRate - Session average rate in degrees F per hour
 * @property {number|null} predictedMinutesToTarget - Minutes until target reached
 * @property {string|null} predictedTargetTime - ISO 8601 datetime of predicted target
 * @property {number|null} scheduleVarianceMinutes - Positive = late, negative = early
 * @property {'early'|'late'|'on-track'|'unknown'} scheduleStatus
 * @property {'high'|'medium'|'low'|'insufficient'} confidence
 * @property {string|null} confidenceReason - Human-readable explanation
 */

/**
 * @typedef {Object} Recommendation
 * @property {'raise'|'lower'|'hold'|'none'} action
 * @property {number|null} suggestedTemp - New oven set temp in Fahrenheit
 * @property {number|null} changeAmount - Degrees to change (always positive)
 * @property {string} message - Human-readable recommendation
 * @property {string|null} reasoning - Explanation of why this recommendation
 * @property {boolean} canRecommend - Whether conditions allow a recommendation
 * @property {string|null} blockerReason - If canRecommend is false, why
 */

/**
 * @typedef {Object} AppSettings
 * @property {'F'|'C'} units - Temperature display units
 * @property {number} smoothingWindowReadings - Number of readings for rate smoothing (default 3)
 * @property {number} smoothingWindowMinutes - Alternative: time window for smoothing (default 30)
 * @property {'readings'|'time'} smoothingMode - Which smoothing approach to use
 * @property {number} onTrackThresholdMinutes - Minutes variance considered "on track" (default 10)
 * @property {number} recommendationStepF - Default temp change step in F (default 10)
 * @property {number} recommendationMaxStepF - Maximum single change in F (default 25)
 * @property {number} ovenTempMinF - Minimum suggested oven temp in F (default 150)
 * @property {number} ovenTempMaxF - Maximum suggested oven temp in F (default 300)
 * @property {number} minReadingsForRecommendation - Minimum readings required (default 3)
 * @property {number} minTimeSpanMinutes - Minimum time span for recommendations (default 30)
 * @property {number} ovenTempStaleMinutes - Max age of oven temp for recommendations (default 60)
 */

/**
 * @typedef {Object} Session
 * @property {SessionConfig} config
 * @property {InternalReading[]} readings
 * @property {OvenTempEvent[]} ovenEvents
 * @property {AppSettings} settings
 */

/**
 * Factory function to create a new empty session
 * @param {Partial<SessionConfig>} configOverrides
 * @returns {Session}
 */
export function createSession(configOverrides = {}) {
  const now = new Date().toISOString();
  return {
    config: {
      id: generateUUID(),
      targetTemp: 125, // Default for medium-rare beef
      units: 'F',
      startingTemp: null,
      desiredServeTime: null,
      desiredTimeRemaining: null,
      initialOvenTemp: 200,
      meatType: null,
      meatCut: null,
      weight: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      ...configOverrides
    },
    readings: [],
    ovenEvents: [],
    settings: createDefaultSettings()
  };
}

/**
 * Factory function to create default settings
 * @returns {AppSettings}
 */
export function createDefaultSettings() {
  return {
    units: 'F',
    smoothingWindowReadings: 3,
    smoothingWindowMinutes: 30,
    smoothingMode: 'readings',
    onTrackThresholdMinutes: 10,
    recommendationStepF: 10,
    recommendationMaxStepF: 25,
    ovenTempMinF: 150,
    ovenTempMaxF: 300,
    minReadingsForRecommendation: 3,
    minTimeSpanMinutes: 30,
    ovenTempStaleMinutes: 60
  };
}

/**
 * Factory function to create an internal reading
 * @param {number} temp - Temperature in current display units (will be converted)
 * @param {string} [timestamp] - Optional timestamp, defaults to now
 * @returns {InternalReading}
 */
export function createReading(temp, timestamp = null) {
  return {
    id: generateUUID(),
    temp: temp, // Caller responsible for ensuring this is in Fahrenheit
    timestamp: timestamp || new Date().toISOString(),
    deltaFromStart: null, // Computed after creation
    deltaFromPrevious: null // Computed after creation
  };
}

/**
 * Factory function to create an oven temperature event
 * @param {number} setTemp - Oven set temp in current display units (will be converted)
 * @param {number|null} previousTemp - Previous oven temp or null
 * @param {string} [timestamp] - Optional timestamp, defaults to now
 * @returns {OvenTempEvent}
 */
export function createOvenEvent(setTemp, previousTemp = null, timestamp = null) {
  return {
    id: generateUUID(),
    setTemp: setTemp, // Caller responsible for ensuring this is in Fahrenheit
    timestamp: timestamp || new Date().toISOString(),
    previousTemp: previousTemp
  };
}

/**
 * Generate a UUID v4
 * @returns {string}
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

---

## Task 1.3: Storage Service Implementation

### Description
Implement a storage service that persists session data to localStorage with automatic serialization/deserialization, migration support for schema changes, and error handling.

### File: /src/services/storageService.js

```javascript
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
```

---

## Task 1.4: Temperature Utility Functions

### Description
Implement utility functions for temperature unit conversion, formatting, and validation. All internal storage uses Fahrenheit; conversions happen at UI boundaries.

### File: /src/utils/temperatureUtils.js

```javascript
/**
 * Convert Fahrenheit to Celsius
 * @param {number} fahrenheit
 * @returns {number} Celsius rounded to 1 decimal
 */
export function fahrenheitToCelsius(fahrenheit) {
  return Math.round(((fahrenheit - 32) * 5 / 9) * 10) / 10;
}

/**
 * Convert Celsius to Fahrenheit
 * @param {number} celsius
 * @returns {number} Fahrenheit rounded to 1 decimal
 */
export function celsiusToFahrenheit(celsius) {
  return Math.round((celsius * 9 / 5 + 32) * 10) / 10;
}

/**
 * Convert temperature to display units
 * @param {number} tempF - Temperature in Fahrenheit (internal storage unit)
 * @param {'F'|'C'} displayUnit - Target display unit
 * @returns {number}
 */
export function toDisplayUnit(tempF, displayUnit) {
  if (displayUnit === 'C') {
    return fahrenheitToCelsius(tempF);
  }
  return Math.round(tempF * 10) / 10;
}

/**
 * Convert temperature from display units to Fahrenheit for storage
 * @param {number} temp - Temperature in display units
 * @param {'F'|'C'} displayUnit - Current display unit
 * @returns {number} Temperature in Fahrenheit
 */
export function toStorageUnit(temp, displayUnit) {
  if (displayUnit === 'C') {
    return celsiusToFahrenheit(temp);
  }
  return temp;
}

/**
 * Format temperature for display with unit symbol
 * @param {number} tempF - Temperature in Fahrenheit
 * @param {'F'|'C'} displayUnit - Display unit
 * @param {boolean} [includeSymbol=true] - Whether to include °F or °C
 * @returns {string}
 */
export function formatTemperature(tempF, displayUnit, includeSymbol = true) {
  const converted = toDisplayUnit(tempF, displayUnit);
  const symbol = includeSymbol ? `°${displayUnit}` : '';
  return `${converted}${symbol}`;
}

/**
 * Format temperature delta (change)
 * @param {number} deltaF - Temperature change in Fahrenheit
 * @param {'F'|'C'} displayUnit
 * @param {boolean} [includeSign=true] - Whether to include +/- prefix
 * @returns {string}
 */
export function formatDelta(deltaF, displayUnit, includeSign = true) {
  const converted = displayUnit === 'C' 
    ? Math.round((deltaF * 5 / 9) * 10) / 10  // Delta conversion doesn't use 32 offset
    : Math.round(deltaF * 10) / 10;
  
  const sign = includeSign && converted > 0 ? '+' : '';
  return `${sign}${converted}°${displayUnit}`;
}

/**
 * Convert a rate from °F/hour to °C/hour if needed
 * @param {number} rateF - Rate in degrees F per hour
 * @param {'F'|'C'} displayUnit
 * @returns {number}
 */
export function convertRate(rateF, displayUnit) {
  if (displayUnit === 'C') {
    return Math.round((rateF * 5 / 9) * 100) / 100;
  }
  return Math.round(rateF * 100) / 100;
}

/**
 * Format a heating rate for display
 * @param {number} rateF - Rate in degrees F per hour
 * @param {'F'|'C'} displayUnit
 * @returns {string}
 */
export function formatRate(rateF, displayUnit) {
  const converted = convertRate(rateF, displayUnit);
  return `${converted}°${displayUnit}/hr`;
}

/**
 * Validate that a temperature value is reasonable for cooking
 * @param {number} temp - Temperature in the given unit
 * @param {'F'|'C'} unit
 * @param {'internal'|'oven'} type - Type of temperature being validated
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateTemperature(temp, unit, type) {
  if (typeof temp !== 'number' || isNaN(temp)) {
    return { valid: false, error: 'Temperature must be a number' };
  }
  
  // Convert to Fahrenheit for validation
  const tempF = unit === 'C' ? celsiusToFahrenheit(temp) : temp;
  
  if (type === 'internal') {
    // Internal meat temps typically 32°F to 212°F
    if (tempF < 32) {
      return { valid: false, error: 'Temperature too low (below freezing)' };
    }
    if (tempF > 212) {
      return { valid: false, error: 'Temperature too high (above boiling)' };
    }
  }
  
  if (type === 'oven') {
    // Oven temps typically 100°F to 550°F
    if (tempF < 100) {
      return { valid: false, error: 'Oven temperature too low' };
    }
    if (tempF > 550) {
      return { valid: false, error: 'Oven temperature too high' };
    }
  }
  
  return { valid: true, error: null };
}

/**
 * Get common target temperatures for meat types
 * @returns {Array<{name: string, targetF: number, description: string}>}
 */
export function getCommonTargets() {
  return [
    { name: 'Beef - Rare', targetF: 120, description: 'Cool red center' },
    { name: 'Beef - Medium Rare', targetF: 130, description: 'Warm red center' },
    { name: 'Beef - Medium', targetF: 140, description: 'Warm pink center' },
    { name: 'Beef - Medium Well', targetF: 150, description: 'Slightly pink center' },
    { name: 'Beef - Well Done', targetF: 160, description: 'No pink' },
    { name: 'Pork', targetF: 145, description: 'USDA recommended' },
    { name: 'Poultry', targetF: 165, description: 'USDA recommended' },
    { name: 'Lamb - Medium Rare', targetF: 130, description: 'Warm red center' },
    { name: 'Lamb - Medium', targetF: 140, description: 'Warm pink center' }
  ];
}
```

---

## Task 1.5: Time Utility Functions

### Description
Implement utility functions for time calculations, formatting, and manipulation.

### File: /src/utils/timeUtils.js

```javascript
/**
 * Calculate the difference between two timestamps in minutes
 * @param {string} startISO - Start time as ISO 8601 string
 * @param {string} endISO - End time as ISO 8601 string
 * @returns {number} Difference in minutes
 */
export function minutesBetween(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return (end.getTime() - start.getTime()) / (1000 * 60);
}

/**
 * Calculate the difference between two timestamps in hours
 * @param {string} startISO - Start time as ISO 8601 string
 * @param {string} endISO - End time as ISO 8601 string
 * @returns {number} Difference in hours
 */
export function hoursBetween(startISO, endISO) {
  return minutesBetween(startISO, endISO) / 60;
}

/**
 * Add minutes to a timestamp
 * @param {string} timestampISO - Base timestamp as ISO 8601 string
 * @param {number} minutes - Minutes to add (can be negative)
 * @returns {string} New timestamp as ISO 8601 string
 */
export function addMinutes(timestampISO, minutes) {
  const date = new Date(timestampISO);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

/**
 * Format a duration in minutes to human-readable string
 * @param {number} minutes
 * @param {boolean} [includeSeconds=false]
 * @returns {string} e.g., "2h 30m" or "45m"
 */
export function formatDuration(minutes, includeSeconds = false) {
  if (minutes === null || isNaN(minutes)) {
    return '--';
  }
  
  const absMinutes = Math.abs(minutes);
  const sign = minutes < 0 ? '-' : '';
  
  if (absMinutes < 1 && includeSeconds) {
    const seconds = Math.round(absMinutes * 60);
    return `${sign}${seconds}s`;
  }
  
  if (absMinutes < 60) {
    return `${sign}${Math.round(absMinutes)}m`;
  }
  
  const hours = Math.floor(absMinutes / 60);
  const remainingMinutes = Math.round(absMinutes % 60);
  
  if (remainingMinutes === 0) {
    return `${sign}${hours}h`;
  }
  
  return `${sign}${hours}h ${remainingMinutes}m`;
}

/**
 * Format a timestamp to local time string (HH:MM AM/PM)
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} Formatted time
 */
export function formatTime(timestampISO) {
  if (!timestampISO) return '--';
  
  const date = new Date(timestampISO);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format a timestamp to local date and time
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} Formatted date and time
 */
export function formatDateTime(timestampISO) {
  if (!timestampISO) return '--';
  
  const date = new Date(timestampISO);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format time elapsed since a timestamp
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} e.g., "5 min ago", "2 hours ago"
 */
export function formatTimeAgo(timestampISO) {
  const minutes = minutesBetween(timestampISO, new Date().toISOString());
  
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    const m = Math.round(minutes);
    return `${m} min${m !== 1 ? 's' : ''} ago`;
  }
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Check if a timestamp is within the last N minutes
 * @param {string} timestampISO - ISO 8601 timestamp
 * @param {number} minutes - Number of minutes
 * @returns {boolean}
 */
export function isWithinMinutes(timestampISO, minutes) {
  const elapsed = minutesBetween(timestampISO, new Date().toISOString());
  return elapsed <= minutes;
}

/**
 * Parse a time string (HH:MM) and combine with today's date
 * @param {string} timeString - Time in HH:MM format
 * @returns {string} ISO 8601 timestamp
 */
export function parseTimeToday(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/**
 * Get the current timestamp as ISO 8601
 * @returns {string}
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Calculate time remaining until a target timestamp
 * @param {string} targetISO - Target timestamp
 * @returns {number} Minutes remaining (negative if past)
 */
export function minutesUntil(targetISO) {
  return minutesBetween(new Date().toISOString(), targetISO);
}
```

---

## Task 1.6: Constants and Default Configuration

### Description
Define application constants and default values in a central location.

### File: /src/constants/defaults.js

```javascript
/**
 * Default session configuration values
 */
export const SESSION_DEFAULTS = {
  TARGET_TEMP_F: 125, // Medium-rare beef
  INITIAL_OVEN_TEMP_F: 200,
  UNITS: 'F'
};

/**
 * Default settings values
 */
export const SETTINGS_DEFAULTS = {
  SMOOTHING_WINDOW_READINGS: 3,
  SMOOTHING_WINDOW_MINUTES: 30,
  ON_TRACK_THRESHOLD_MINUTES: 10,
  RECOMMENDATION_STEP_F: 10,
  RECOMMENDATION_MAX_STEP_F: 25,
  OVEN_TEMP_MIN_F: 150,
  OVEN_TEMP_MAX_F: 300,
  MIN_READINGS_FOR_RECOMMENDATION: 3,
  MIN_TIME_SPAN_MINUTES: 30,
  OVEN_TEMP_STALE_MINUTES: 60
};

/**
 * Calculation thresholds
 */
export const CALCULATION_THRESHOLDS = {
  MIN_READINGS_FOR_RATE: 2,
  MIN_READINGS_FOR_PROJECTION: 2,
  RATE_VARIANCE_THRESHOLD: 0.5, // Coefficient of variation threshold for "noisy" data
  MIN_RATE_FOR_PREDICTION: 0.1 // °F/hr minimum to consider valid heating
};

/**
 * UI-related constants
 */
export const UI_CONSTANTS = {
  CHART_UPDATE_DEBOUNCE_MS: 250,
  AUTO_SAVE_DEBOUNCE_MS: 1000,
  TOAST_DURATION_MS: 3000
};

/**
 * Recommendation message templates
 */
export const RECOMMENDATION_MESSAGES = {
  HOLD: 'Hold steady at {ovenTemp}. You\'re on track to hit your target.',
  RAISE_SMALL: 'Consider raising oven to {suggestedTemp} to speed things up.',
  RAISE_LARGE: 'Running late. Consider raising oven to {suggestedTemp}.',
  LOWER_SMALL: 'Running ahead of schedule. Consider lowering oven to {suggestedTemp}.',
  LOWER_LARGE: 'Running very early. Lower oven to {suggestedTemp} to avoid overshooting.',
  NEED_MORE_READINGS: 'Need at least {count} readings to make recommendations.',
  NEED_MORE_TIME: 'Need readings spanning at least {minutes} minutes.',
  NO_SERVE_TIME: 'Set a desired serve time to get timing recommendations.',
  RATE_TOO_LOW: 'Heating rate is very slow or negative. Check thermometer placement.',
  RATE_UNSTABLE: 'Temperature readings are fluctuating. Wait for more stable data.',
  OVEN_TEMP_STALE: 'Oven temperature hasn\'t been updated recently. Please confirm current oven setting.'
};

/**
 * Disclaimer text
 */
export const DISCLAIMER = 'Ovens and roasts vary. Use this as a guide and rely on thermometer readings. This app does not provide food safety guarantees.';

/**
 * Common meat presets
 */
export const MEAT_PRESETS = [
  {
    type: 'Prime Rib',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 125,
    suggestedOvenF: 200,
    notes: 'Remove 5°F below target for carryover'
  },
  {
    type: 'Beef Tenderloin',
    cuts: ['Whole', 'Center-cut'],
    defaultTargetF: 125,
    suggestedOvenF: 225,
    notes: 'Cooks faster due to smaller diameter'
  },
  {
    type: 'Pork Loin',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 140,
    suggestedOvenF: 225,
    notes: 'USDA recommends 145°F minimum'
  },
  {
    type: 'Pork Shoulder',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 195,
    suggestedOvenF: 225,
    notes: 'For pulled pork, aim for 195-205°F'
  },
  {
    type: 'Leg of Lamb',
    cuts: ['Bone-in', 'Boneless'],
    defaultTargetF: 130,
    suggestedOvenF: 225,
    notes: 'Remove 5°F below target for carryover'
  }
];
```

---

## Task 1.7: Validation Utility Functions

### Description
Implement input validation functions used throughout the application.

### File: /src/utils/validationUtils.js

```javascript
import { celsiusToFahrenheit } from './temperatureUtils.js';

/**
 * Validate session configuration
 * @param {Partial<SessionConfig>} config
 * @param {'F'|'C'} units - Current display units
 * @returns {{valid: boolean, errors: Object<string, string>}}
 */
export function validateSessionConfig(config, units) {
  const errors = {};
  
  // Target temp is required
  if (config.targetTemp === undefined || config.targetTemp === null) {
    errors.targetTemp = 'Target temperature is required';
  } else {
    const targetF = units === 'C' ? celsiusToFahrenheit(config.targetTemp) : config.targetTemp;
    if (targetF < 32 || targetF > 212) {
      errors.targetTemp = 'Target must be between 32°F and 212°F (0°C and 100°C)';
    }
  }
  
  // Initial oven temp is required
  if (config.initialOvenTemp === undefined || config.initialOvenTemp === null) {
    errors.initialOvenTemp = 'Initial oven temperature is required';
  } else {
    const ovenF = units === 'C' ? celsiusToFahrenheit(config.initialOvenTemp) : config.initialOvenTemp;
    if (ovenF < 100 || ovenF > 550) {
      errors.initialOvenTemp = 'Oven temp must be between 100°F and 550°F (38°C and 288°C)';
    }
  }
  
  // Optional starting temp validation
  if (config.startingTemp !== undefined && config.startingTemp !== null) {
    const startF = units === 'C' ? celsiusToFahrenheit(config.startingTemp) : config.startingTemp;
    if (startF < 32 || startF > 212) {
      errors.startingTemp = 'Starting temp must be between 32°F and 212°F';
    }
  }
  
  // Desired serve time validation
  if (config.desiredServeTime) {
    const serveTime = new Date(config.desiredServeTime);
    if (isNaN(serveTime.getTime())) {
      errors.desiredServeTime = 'Invalid date/time format';
    }
  }
  
  // Weight validation
  if (config.weight !== undefined && config.weight !== null) {
    if (config.weight <= 0 || config.weight > 100) {
      errors.weight = 'Weight must be between 0 and 100 pounds';
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate a temperature reading input
 * @param {number} temp
 * @param {'F'|'C'} units
 * @param {number|null} previousTempF - Previous reading in Fahrenheit (for delta check)
 * @returns {{valid: boolean, error: string|null, warning: string|null}}
 */
export function validateReading(temp, units, previousTempF = null) {
  if (temp === undefined || temp === null || temp === '') {
    return { valid: false, error: 'Temperature is required', warning: null };
  }
  
  const tempNum = parseFloat(temp);
  if (isNaN(tempNum)) {
    return { valid: false, error: 'Temperature must be a number', warning: null };
  }
  
  const tempF = units === 'C' ? celsiusToFahrenheit(tempNum) : tempNum;
  
  if (tempF < 32) {
    return { valid: false, error: 'Temperature is below freezing', warning: null };
  }
  
  if (tempF > 212) {
    return { valid: false, error: 'Temperature exceeds boiling point', warning: null };
  }
  
  // Warning for large jumps from previous reading
  let warning = null;
  if (previousTempF !== null) {
    const delta = Math.abs(tempF - previousTempF);
    if (delta > 20) {
      warning = `Large change from previous reading (${delta.toFixed(1)}°F). Please verify.`;
    }
  }
  
  return { valid: true, error: null, warning };
}

/**
 * Validate an oven temperature input
 * @param {number} temp
 * @param {'F'|'C'} units
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateOvenTemp(temp, units) {
  if (temp === undefined || temp === null || temp === '') {
    return { valid: false, error: 'Oven temperature is required' };
  }
  
  const tempNum = parseFloat(temp);
  if (isNaN(tempNum)) {
    return { valid: false, error: 'Temperature must be a number' };
  }
  
  const tempF = units === 'C' ? celsiusToFahrenheit(tempNum) : tempNum;
  
  if (tempF < 100) {
    return { valid: false, error: 'Oven temperature too low (minimum 100°F / 38°C)' };
  }
  
  if (tempF > 550) {
    return { valid: false, error: 'Oven temperature too high (maximum 550°F / 288°C)' };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate settings values
 * @param {Partial<AppSettings>} settings
 * @returns {{valid: boolean, errors: Object<string, string>}}
 */
export function validateSettings(settings) {
  const errors = {};
  
  if (settings.smoothingWindowReadings !== undefined) {
    if (settings.smoothingWindowReadings < 2 || settings.smoothingWindowReadings > 10) {
      errors.smoothingWindowReadings = 'Must be between 2 and 10';
    }
  }
  
  if (settings.smoothingWindowMinutes !== undefined) {
    if (settings.smoothingWindowMinutes < 5 || settings.smoothingWindowMinutes > 120) {
      errors.smoothingWindowMinutes = 'Must be between 5 and 120 minutes';
    }
  }
  
  if (settings.onTrackThresholdMinutes !== undefined) {
    if (settings.onTrackThresholdMinutes < 1 || settings.onTrackThresholdMinutes > 60) {
      errors.onTrackThresholdMinutes = 'Must be between 1 and 60 minutes';
    }
  }
  
  if (settings.recommendationStepF !== undefined) {
    if (settings.recommendationStepF < 5 || settings.recommendationStepF > 50) {
      errors.recommendationStepF = 'Must be between 5 and 50 degrees';
    }
  }
  
  if (settings.ovenTempMinF !== undefined && settings.ovenTempMaxF !== undefined) {
    if (settings.ovenTempMinF >= settings.ovenTempMaxF) {
      errors.ovenTempMinF = 'Minimum must be less than maximum';
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Sanitize string input
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeString(input, maxLength = 500) {
  if (!input) return '';
  return String(input).trim().slice(0, maxLength);
}
```

---

## Phase 1 Completion Checklist

Before proceeding to Phase 2, verify the following:

1. **Project builds and runs**: Execute `npm run dev` and confirm the development server starts without errors.

2. **All files exist**: Verify the following files are created and contain the specified code:
   - `/src/models/dataModels.js`
   - `/src/services/storageService.js`
   - `/src/utils/temperatureUtils.js`
   - `/src/utils/timeUtils.js`
   - `/src/utils/validationUtils.js`
   - `/src/constants/defaults.js`

3. **Storage service works**: Test by opening browser console and running:
   ```javascript
   import { storageService } from './services/storageService.js';
   storageService.initialize();
   console.log(storageService.hasSession()); // Should be false
   ```

4. **Utility functions work**: Create a test file or use the console to verify temperature conversions:
   ```javascript
   import { fahrenheitToCelsius, celsiusToFahrenheit } from './utils/temperatureUtils.js';
   console.log(fahrenheitToCelsius(212)); // Should be 100
   console.log(celsiusToFahrenheit(100)); // Should be 212
   ```

5. **Tailwind CSS configured**: Verify custom theme extensions appear in `tailwind.config.js`.

6. **PWA manifest configured**: Verify `vite.config.js` includes PWA plugin with correct manifest.

---

## Dependencies for Next Phase

Phase 2 (Session Management UI) will depend on:
- `createSession()` from dataModels.js
- `storageService` for persistence
- `validateSessionConfig()` from validationUtils.js
- Temperature utility functions for unit conversion in forms
- Constants from defaults.js for default values
