import { ref, computed, watch } from 'vue';
import { storageService } from '../services/storageService.js';
import { 
  createSession, 
  createReading, 
  createOvenEvent,
  createDefaultSettings 
} from '../models/dataModels.js';
import { toStorageUnit } from '../utils/temperatureUtils.js';
import { UI_CONSTANTS } from '../constants/defaults.js';

// Singleton state - shared across all component instances
const session = ref(null);
const isInitialized = ref(false);

// App settings as last persisted, independent of any session. Used to seed a
// new session so preferences (smoothing, oven bounds) survive between cooks.
let persistedSettings = null;
// A ref, not a plain let: `preferredUnits` is exposed to templates.
const persistedUnits = ref(null);

/**
 * Save current session to storage
 * storageService stamps updatedAt onto a copy, so this never writes to the
 * reactive session - the autosave watcher below would otherwise retrigger.
 */
function saveSession() {
  if (session.value) {
    storageService.saveSession(session.value);
  }
}

/**
 * Sort readings into chronological order, in place
 * Timestamps are ISO 8601 strings, which sort lexically, so localeCompare is
 * correct here and cheaper than parsing each one into a Date.
 * @param {InternalReading[]} readings
 */
function sortReadings(readings) {
  readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Recalculate deltas for all readings
 * Assumes readings are already in chronological order.
 */
function recalculateDeltas() {
  if (!session.value || session.value.readings.length === 0) return;
  
  const readings = session.value.readings;
  const firstTemp = readings[0].temp;
  
  readings[0].deltaFromStart = 0;
  readings[0].deltaFromPrevious = 0;
  
  for (let i = 1; i < readings.length; i++) {
    readings[i].deltaFromStart = readings[i].temp - firstTemp;
    readings[i].deltaFromPrevious = readings[i].temp - readings[i - 1].temp;
  }
}

/**
 * Restore the reading invariants: chronological order first, then the derived
 * deltas. Every mutation path (add, edit, delete) must go through this -
 * downstream code treats readings[readings.length - 1] as the latest reading
 * and derives rates and deltas from adjacent pairs.
 */
function normalizeReadings() {
  if (!session.value) return;
  
  sortReadings(session.value.readings);
  recalculateDeltas();
}

// Auto-save on changes (debounced). Registered at module scope alongside the
// shared state so exactly one watcher exists no matter how many components
// call useSession().
let saveTimeout = null;
watch(
  session,
  () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSession, UI_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS);
  },
  { deep: true }
);

export function useSession() {
  /**
   * Initialize the session composable
   * Call this once on app startup
   */
  function initialize() {
    if (isInitialized.value) return;
    
    storageService.initialize();
    
    // Settings live outside the session so they survive endSession(). Null
    // means nothing usable was stored, in which case whatever the session
    // carries (or the defaults) stands.
    const storedSettings = storageService.loadSettings();
    const existingSession = storageService.loadSession();
    
    if (existingSession) {
      // Defaults first so keys added in later versions are filled in; the
      // standalone settings entry wins because it is written on every change.
      existingSession.settings = {
        ...createDefaultSettings(),
        ...existingSession.settings,
        ...storedSettings
      };
      session.value = existingSession;
      
      // Stored sessions from older builds may not be in timestamp order.
      normalizeReadings();
    }
    
    persistedSettings = storedSettings ?? session.value?.settings ?? createDefaultSettings();
    persistedUnits.value = storageService.loadUnits();
    
    isInitialized.value = true;
  }
  
  /**
   * Check if a session exists in storage
   */
  const hasStoredSession = computed(() => {
    return storageService.hasSession();
  });
  
  /**
   * Check if there's an active session in memory
   */
  const hasActiveSession = computed(() => {
    return session.value !== null;
  });
  
  /**
   * Get the current session configuration
   */
  const config = computed(() => {
    return session.value?.config ?? null;
  });
  
  /**
   * Get all internal temperature readings
   */
  const readings = computed(() => {
    return session.value?.readings ?? [];
  });
  
  /**
   * Get all oven temperature events
   */
  const ovenEvents = computed(() => {
    return session.value?.ovenEvents ?? [];
  });
  
  /**
   * Get current settings
   */
  const settings = computed(() => {
    return session.value?.settings ?? createDefaultSettings();
  });
  
  /**
   * Get the most recent internal temperature reading
   */
  const latestReading = computed(() => {
    const r = readings.value;
    return r.length > 0 ? r[r.length - 1] : null;
  });
  
  /**
   * Get the current (most recent) oven set temperature
   */
  const currentOvenTemp = computed(() => {
    const events = ovenEvents.value;
    return events.length > 0 ? events[events.length - 1].setTemp : config.value?.initialOvenTemp ?? null;
  });
  
  /**
   * Get the display units for the session
   */
  /**
   * The unit preference to offer a *new* session, before any config exists.
   * Reads the module cache so it survives endSession().
   */
  const preferredUnits = computed(() => persistedUnits.value ?? 'F');
  
  const displayUnits = computed(() => {
    return config.value?.units ?? 'F';
  });
  
  /**
   * Start a new session with the given configuration
   * @param {Partial<SessionConfig>} configOverrides
   */
  function startSession(configOverrides) {
    // Seed the unit preference from the last cook unless this one names its own.
    session.value = createSession(
      configOverrides.units
        ? configOverrides
        : { ...configOverrides, units: persistedUnits.value ?? 'F' }
    );
    
    // If initial oven temp was provided, create the first oven event
    if (configOverrides.initialOvenTemp) {
      const ovenEvent = createOvenEvent(
        configOverrides.initialOvenTemp,
        null // No previous temp
      );
      session.value.ovenEvents.push(ovenEvent);
    }
    
    // If starting temp was provided, create the first reading
    if (configOverrides.startingTemp) {
      session.value.readings.push(createReading(configOverrides.startingTemp));
      normalizeReadings();
    }
    
    // Carry the user's persisted preferences into the new cook
    if (persistedSettings) {
      session.value.settings = { ...session.value.settings, ...persistedSettings };
    }
    
    saveSession();
  }
  
  /**
   * Resume a session from storage
   * @returns {boolean} Success
   */
  function resumeSession() {
    const stored = storageService.loadSession();
    if (stored) {
      session.value = stored;
      // A session stored by an older build may not be in timestamp order
      normalizeReadings();
      return true;
    }
    return false;
  }
  
  /**
   * End the current session and clear storage
   */
  function endSession() {
    session.value = null;
    storageService.clearSession();
  }
  
  /**
   * Add a new internal temperature reading
   * @param {number} temp - Temperature in display units
   * @param {string} [timestamp] - Optional timestamp, defaults to now
   */
  function addReading(temp, timestamp = null) {
    if (!session.value) return;
    
    // Convert to storage unit (Fahrenheit)
    const tempF = toStorageUnit(temp, displayUnits.value);
    
    session.value.readings.push(createReading(tempF, timestamp));
    
    // A back-dated reading has to land in its chronological slot, and every
    // delta after it changes as a result
    normalizeReadings();
    saveSession();
  }
  
  /**
   * Update an existing reading
   * @param {string} id - Reading ID
   * @param {Partial<InternalReading>} updates
   */
  function updateReading(id, updates) {
    if (!session.value) return;
    
    const index = session.value.readings.findIndex(r => r.id === id);
    if (index === -1) return;
    
    // If temp is being updated, convert from display units
    if (updates.temp !== undefined) {
      updates.temp = toStorageUnit(updates.temp, displayUnits.value);
    }
    
    session.value.readings[index] = {
      ...session.value.readings[index],
      ...updates
    };
    
    // An edited timestamp can move the reading, and an edited temp changes
    // every delta from that point on
    normalizeReadings();
    saveSession();
  }
  
  /**
   * Delete a reading
   * @param {string} id - Reading ID
   */
  function deleteReading(id) {
    if (!session.value) return;
    
    session.value.readings = session.value.readings.filter(r => r.id !== id);
    normalizeReadings();
    saveSession();
  }
  
  /**
   * Add a new oven temperature event
   * @param {number} setTemp - Temperature in display units
   * @param {string} [timestamp] - Optional timestamp, defaults to now
   */
  function addOvenEvent(setTemp, timestamp = null) {
    if (!session.value) return;
    
    const tempF = toStorageUnit(setTemp, displayUnits.value);
    const previousTemp = currentOvenTemp.value;
    
    const event = createOvenEvent(tempF, previousTemp, timestamp);
    session.value.ovenEvents.push(event);
    saveSession();
  }
  
  /**
   * Update an existing oven event
   * @param {string} id - Event ID
   * @param {Partial<OvenTempEvent>} updates
   */
  function updateOvenEvent(id, updates) {
    if (!session.value) return;
    
    const index = session.value.ovenEvents.findIndex(e => e.id === id);
    if (index === -1) return;
    
    if (updates.setTemp !== undefined) {
      updates.setTemp = toStorageUnit(updates.setTemp, displayUnits.value);
    }
    
    session.value.ovenEvents[index] = {
      ...session.value.ovenEvents[index],
      ...updates
    };
    
    saveSession();
  }
  
  /**
   * Delete an oven event
   * @param {string} id - Event ID
   */
  function deleteOvenEvent(id) {
    if (!session.value) return;
    
    session.value.ovenEvents = session.value.ovenEvents.filter(e => e.id !== id);
    saveSession();
  }
  
  /**
   * Log that the oven was turned OFF
   * @param {string} [timestamp] - Optional timestamp, defaults to now
   */
  function logOvenOff(timestamp = null) {
    if (!session.value) return;
    
    const previousTemp = currentOvenTemp.value;
    const event = createOvenEvent(0, previousTemp, timestamp, true);
    
    session.value.ovenEvents.push(event);
    saveSession();
  }
  
  /**
   * Log that the oven was turned back ON
   * @param {number} temperature - Oven temperature in display units
   * @param {string} [timestamp] - Optional timestamp, defaults to now
   */
  function logOvenOn(temperature, timestamp = null) {
    if (!session.value) return;
    
    const tempInF = toStorageUnit(temperature, displayUnits.value);
    const event = createOvenEvent(tempInF, 0, timestamp, false);
    
    session.value.ovenEvents.push(event);
    saveSession();
  }
  
  /**
   * Update session settings
   * @param {Partial<AppSettings>} updates
   */
  function updateSettings(updates) {
    if (!session.value) return;
    
    session.value.settings = {
      ...session.value.settings,
      ...updates
    };
    
    // Persist independently of the session so preferences survive the next
    // endSession() and seed the next cook
    persistedSettings = { ...session.value.settings };
    storageService.saveSettings(persistedSettings);
    
    saveSession();
  }
  
  /**
   * Update session configuration
   * @param {Partial<SessionConfig>} updates
   */
  function updateConfig(updates) {
    if (!session.value) return;
    
    session.value.config = {
      ...session.value.config,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    // Units are a standing preference, not a per-session choice.
    if (updates.units) {
      persistedUnits.value = updates.units;
      storageService.saveUnits(updates.units);
    }
    
    saveSession();
  }
  
  return {
    // State
    session,
    isInitialized,
    
    // Computed
    hasStoredSession,
    hasActiveSession,
    config,
    readings,
    ovenEvents,
    settings,
    latestReading,
    currentOvenTemp,
    displayUnits,
    preferredUnits,
    
    // Methods
    initialize,
    startSession,
    resumeSession,
    endSession,
    addReading,
    updateReading,
    deleteReading,
    addOvenEvent,
    updateOvenEvent,
    deleteOvenEvent,
    logOvenOff,
    logOvenOn,
    updateSettings,
    updateConfig
  };
}





