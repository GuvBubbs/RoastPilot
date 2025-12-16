import { ref, computed, watch } from 'vue';
import { storageService } from '../services/storageService.js';
import { 
  createSession, 
  createReading, 
  createOvenEvent,
  createDefaultSettings 
} from '../models/dataModels.js';
import { toStorageUnit } from '../utils/temperatureUtils.js';

// Singleton state - shared across all component instances
const session = ref(null);
const isInitialized = ref(false);

export function useSession() {
  /**
   * Initialize the session composable
   * Call this once on app startup
   */
  function initialize() {
    if (isInitialized.value) return;
    
    storageService.initialize();
    const existingSession = storageService.loadSession();
    
    if (existingSession) {
      session.value = existingSession;
    }
    
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
  const displayUnits = computed(() => {
    return config.value?.units ?? 'F';
  });
  
  /**
   * Start a new session with the given configuration
   * @param {Partial<SessionConfig>} configOverrides
   */
  function startSession(configOverrides) {
    session.value = createSession(configOverrides);
    
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
      const reading = createReading(configOverrides.startingTemp);
      reading.deltaFromStart = 0;
      reading.deltaFromPrevious = 0;
      session.value.readings.push(reading);
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
    
    const reading = createReading(tempF, timestamp);
    
    // Calculate deltas
    const allReadings = session.value.readings;
    if (allReadings.length > 0) {
      const firstReading = allReadings[0];
      const lastReading = allReadings[allReadings.length - 1];
      reading.deltaFromStart = tempF - firstReading.temp;
      reading.deltaFromPrevious = tempF - lastReading.temp;
    } else {
      reading.deltaFromStart = 0;
      reading.deltaFromPrevious = 0;
    }
    
    session.value.readings.push(reading);
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
    
    // Recalculate deltas for this and subsequent readings
    recalculateDeltas();
    saveSession();
  }
  
  /**
   * Delete a reading
   * @param {string} id - Reading ID
   */
  function deleteReading(id) {
    if (!session.value) return;
    
    session.value.readings = session.value.readings.filter(r => r.id !== id);
    recalculateDeltas();
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
    session.value.config.updatedAt = new Date().toISOString();
    storageService.saveSession(session.value);
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
    session.value.config.updatedAt = new Date().toISOString();
    storageService.saveSession(session.value);
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
    saveSession();
  }
  
  /**
   * Recalculate deltas for all readings
   * Called after edits/deletes that might affect delta calculations
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
   * Save current session to storage
   */
  function saveSession() {
    if (session.value) {
      storageService.saveSession(session.value);
    }
  }
  
  /**
   * Export session data
   * @param {'json'|'csv'} format
   * @returns {string}
   */
  function exportSession(format) {
    if (!session.value) return '';
    return storageService.exportSession(session.value, format);
  }
  
  // Auto-save on changes (debounced)
  let saveTimeout = null;
  watch(
    session,
    () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveSession, 1000);
    },
    { deep: true }
  );
  
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
    updateConfig,
    exportSession
  };
}



