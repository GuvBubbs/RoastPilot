# Phase 2: Session Management UI

## Phase Objectives

Build the session setup interface that allows users to configure a new cooking session with target temperature, oven settings, desired serve time, and optional metadata. This phase also implements the session lifecycle (start, resume, end) and the core application shell.

## Prerequisites

Phase 1 must be complete, providing data models, storage service, and utility functions.

## Deliverables

1. Application shell component with navigation state
2. Session setup modal with form validation
3. Session state management (Pinia store or Vue composable)
4. Resume session prompt for existing sessions
5. End session confirmation dialog

---

## Task 2.1: Application Shell Component

### Description

Create the main application shell that manages overall layout and session state. This component serves as the root container and orchestrates which views are shown based on session state.

### File: /src/App.vue

The App component must implement the following structure and behavior:

The template section should contain a full-height container with a header bar, main content area, and conditional rendering of child components. The header should display the application name "Roast Tracker" and include a settings gear icon button that opens the settings panel. When no active session exists, display a welcome screen with a "Start New Session" button. When an active session exists, render the main dashboard components (InputPanel, StatusCards, Charts, Logs, RecommendationPanel).

The script section should import and use the session composable (useSession) which will be created in Task 2.3. On component mount, check if a session exists in storage. If a session exists, show a modal asking the user whether to resume the previous session or start fresh. Track three UI state variables: showSessionSetup (boolean for modal visibility), showSettings (boolean for settings panel), isLoading (boolean for initial load state).

Implement the following methods: handleStartNew() which sets showSessionSetup to true, handleResumePrevious() which loads the session from storage and initializes the UI, handleEndSession() which shows a confirmation dialog and then clears the session, handleSessionCreated(config) which creates a new session with the provided config and closes the modal.

The style section should use Tailwind utility classes. The main container needs min-h-screen and a light gray background (bg-gray-50). The header should be sticky with a white background, shadow, and contain the app title and settings button. Use safe area insets for mobile devices with proper padding.

### Reactive State Structure

```javascript
const state = reactive({
  showSessionSetup: false,
  showSettings: false,
  showResumePrompt: false,
  showEndConfirmation: false,
  isLoading: true
});
```

---

## Task 2.2: Session Setup Modal Component

### Description

Create a modal dialog component for configuring a new cooking session. This is the primary data entry point for establishing session parameters.

### File: /src/components/SessionSetupModal.vue

### Props Definition

The component accepts two props: modelValue of type Boolean controlling visibility (for v-model support), and initialConfig of type Object containing optional preset values for form fields.

### Emits Definition

The component emits three events: update:modelValue for v-model binding, submit with the validated SessionConfig object, and cancel when the user dismisses without saving.

### Form State Structure

Create a reactive form object with the following fields, each paired with an error string and a touched boolean for validation display:

```javascript
const form = reactive({
  targetTemp: { value: 125, error: '', touched: false },
  units: { value: 'F', error: '', touched: false },
  startingTemp: { value: null, error: '', touched: false },
  desiredServeTime: { value: '', error: '', touched: false },
  desiredTimeRemaining: { value: null, error: '', touched: false },
  timeInputMode: { value: 'serveTime', error: '', touched: false }, // 'serveTime' or 'remaining'
  initialOvenTemp: { value: 200, error: '', touched: false },
  meatType: { value: '', error: '', touched: false },
  meatCut: { value: '', error: '', touched: false },
  weight: { value: null, error: '', touched: false },
  notes: { value: '', error: '', touched: false }
});
```

### Template Structure

The modal should render as a fixed overlay with a dark semi-transparent backdrop. The modal content container should be centered vertically and horizontally, with max-width of 480px, rounded corners, white background, and shadow. On mobile, the modal should take full width with margins.

Organize the form into logical sections with clear visual hierarchy:

**Section 1: Temperature Settings (Required)**

This section must appear first and contain the target temperature input and units toggle. Create a number input for target temperature with increment/decrement buttons for easy touch interaction. The increment/decrement should adjust by 5 degrees. Adjacent to the input, place a segmented control toggle for °F/°C selection. Below the target input, add a "Quick select" row showing common target temperatures (Rare 120°F, Medium-Rare 130°F, Medium 140°F) as tappable chips that populate the target field when clicked.

**Section 2: Oven Temperature (Required)**

Create a number input for initial oven set temperature with the same increment/decrement pattern. Display the common range hint below: "Typical range: 150-300°F for low-and-slow"

**Section 3: Timing (Optional but Recommended)**

Implement a radio group or segmented control to switch between two timing input modes: "Set serve time" and "Time remaining". When "Set serve time" is selected, show a datetime-local input pre-populated with a time 4-6 hours from now. When "Time remaining" is selected, show inputs for hours and minutes. Display helper text explaining that setting a target time enables the app to tell whether you're running early or late.

**Section 4: Starting Internal Temp (Optional)**

Create a number input for starting internal temperature. Show helper text: "If you've already taken a reading, enter it here to establish a baseline."

**Section 5: Meat Details (Optional, Collapsible)**

Create a collapsible section (collapsed by default) containing: a dropdown for meat type populated from MEAT_PRESETS, a dropdown for cut that updates options based on selected meat type, a number input for weight in pounds, and a textarea for notes. When a meat type is selected from the dropdown, auto-populate the target temperature and oven temperature with suggested values from the preset, but only if the user hasn't manually edited those fields.

**Modal Footer**

The footer contains two buttons: a secondary "Cancel" button that emits the cancel event, and a primary "Start Session" button that validates and submits. The primary button should be disabled when required fields are invalid. Use a green or red color scheme consistent with cooking/heat themes.

### Validation Implementation

Create a validateForm() function that validates all fields using validateSessionConfig() from validationUtils.js. The function should update the error property of each form field and return a boolean indicating overall validity.

Implement field-level validation on blur (when touched becomes true) and on input for fields already in error state. Show error messages below each input only when the field is touched and has an error.

For the target temperature field, validate that it's a number between 32°F and 212°F (converting from Celsius if that unit is selected). For oven temperature, validate between 100°F and 550°F. For weight, if provided, validate between 0 and 100 pounds.

### Submit Handler

```javascript
function handleSubmit() {
  // Mark all fields as touched to show any errors
  Object.keys(form).forEach(key => {
    if (form[key].touched !== undefined) {
      form[key].touched = true;
    }
  });
  
  if (!validateForm()) {
    return;
  }
  
  // Convert units if necessary
  const units = form.units.value;
  const targetTempF = units === 'C' 
    ? celsiusToFahrenheit(form.targetTemp.value)
    : form.targetTemp.value;
  
  const ovenTempF = units === 'C'
    ? celsiusToFahrenheit(form.initialOvenTemp.value)
    : form.initialOvenTemp.value;
  
  const startingTempF = form.startingTemp.value && units === 'C'
    ? celsiusToFahrenheit(form.startingTemp.value)
    : form.startingTemp.value;
  
  // Calculate desired serve time from remaining time if that mode is selected
  let desiredServeTime = null;
  if (form.timeInputMode.value === 'serveTime' && form.desiredServeTime.value) {
    desiredServeTime = new Date(form.desiredServeTime.value).toISOString();
  } else if (form.timeInputMode.value === 'remaining' && form.desiredTimeRemaining.value) {
    const minutesRemaining = form.desiredTimeRemaining.value;
    desiredServeTime = addMinutes(new Date().toISOString(), minutesRemaining);
  }
  
  const config = {
    targetTemp: targetTempF,
    units: units,
    startingTemp: startingTempF,
    desiredServeTime: desiredServeTime,
    initialOvenTemp: ovenTempF,
    meatType: sanitizeString(form.meatType.value) || null,
    meatCut: sanitizeString(form.meatCut.value) || null,
    weight: form.weight.value || null,
    notes: sanitizeString(form.notes.value) || null
  };
  
  emit('submit', config);
}
```

### Accessibility Requirements

The modal must trap focus when open, meaning Tab and Shift+Tab cycle through modal elements only. The modal should close on Escape key press. The backdrop click should close the modal (with cancel). The first focusable element (target temp input) should receive focus when the modal opens. All form fields must have associated labels with proper for/id linkage. Error messages must be associated with inputs via aria-describedby.

---

## Task 2.3: Session State Management Composable

### Description

Create a Vue composable that manages all session state, providing reactive access to session data and methods for modifications. This serves as the single source of truth for session state.

### File: /src/composables/useSession.js

```javascript
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
    updateSettings,
    updateConfig,
    exportSession
  };
}
```

---

## Task 2.4: Resume Session Dialog Component

### Description

Create a dialog component that prompts the user when an existing session is detected, asking whether to resume or start fresh.

### File: /src/components/ResumeSessionDialog.vue

### Props

The component accepts one prop: sessionInfo of type Object containing summary information about the stored session (created date, reading count, last reading temp and time).

### Emits

The component emits two events: resume when the user chooses to continue the previous session, and startNew when the user chooses to discard and start fresh.

### Template Structure

Render as a modal overlay similar to SessionSetupModal. The dialog content should be compact, centered, with the following sections:

Display a heading "Resume Previous Session?" followed by a summary of the stored session including: when it was started (formatted as "Started Dec 15 at 2:30 PM"), number of readings recorded, last recorded temperature and time, and target temperature.

Below the summary, display two full-width buttons stacked vertically: "Resume Session" as the primary action with a blue or green background, and "Start New Session" as a secondary action with an outline style. Include small helper text below the secondary button: "This will discard the previous session data."

### Session Info Computation

The parent component (App.vue) should compute sessionInfo from the stored session before showing this dialog:

```javascript
function getSessionInfo() {
  const stored = storageService.loadSession();
  if (!stored) return null;
  
  const readingCount = stored.readings.length;
  const lastReading = readingCount > 0 ? stored.readings[readingCount - 1] : null;
  
  return {
    createdAt: stored.config.createdAt,
    targetTemp: stored.config.targetTemp,
    units: stored.config.units,
    readingCount: readingCount,
    lastReadingTemp: lastReading?.temp ?? null,
    lastReadingTime: lastReading?.timestamp ?? null,
    meatType: stored.config.meatType
  };
}
```

---

## Task 2.5: End Session Confirmation Dialog

### Description

Create a confirmation dialog for ending/clearing the current session.

### File: /src/components/EndSessionDialog.vue

### Props

The component accepts modelValue (boolean) for v-model visibility binding.

### Emits

The component emits: update:modelValue for v-model, confirm when user confirms ending the session, and cancel when user cancels.

### Template Structure

Render as a small centered modal with: a warning icon (exclamation triangle), heading "End Session?", body text "This will clear all recorded data. You may want to export your data first.", and two buttons: "Cancel" (secondary) and "End Session" (destructive, red styling).

Include an "Export Data First" link or button that triggers the export flow before ending.

### Behavior

When "End Session" is clicked, emit the confirm event. The parent component handles calling endSession() on the composable and resetting the UI state.

---

## Task 2.6: Number Input with Stepper Component

### Description

Create a reusable number input component with increment/decrement buttons optimized for touch interaction.

### File: /src/components/NumberStepper.vue

### Props

```javascript
defineProps({
  modelValue: { type: Number, default: null },
  min: { type: Number, default: -Infinity },
  max: { type: Number, default: Infinity },
  step: { type: Number, default: 1 },
  largeStep: { type: Number, default: null }, // For long-press acceleration
  placeholder: { type: String, default: '' },
  label: { type: String, required: true },
  suffix: { type: String, default: '' }, // e.g., "°F"
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});
```

### Emits

The component emits: update:modelValue when value changes, blur when input loses focus.

### Template Structure

Create a horizontal layout with three elements: a decrement button on the left (minus icon), a centered number input field, and an increment button on the right (plus icon).

The input field should be of type "number" with inputmode="decimal" for proper mobile keyboard. The input should be styled to hide browser-native spin buttons. Text should be centered and large enough for easy reading.

The stepper buttons should be minimum 44x44 pixels for touch targets. Style them with a light background that darkens on press. The minus button should be disabled (visually muted) when value equals min, and the plus button when value equals max.

### Interaction Behavior

Implement the following interactions:

On single tap of a stepper button, increment or decrement by the step value. On long press (holding the button), begin rapidly incrementing/decrementing after a 500ms delay, at a rate of 100ms per step. If largeStep is defined, use largeStep instead of step during long press.

Direct input in the field should be allowed. On blur, clamp the value to min/max bounds. Validate that the input is a number; if not, revert to the previous valid value.

```javascript
// Long press implementation
let pressInterval = null;
let pressTimeout = null;

function startIncrement(delta) {
  // Immediate first step
  updateValue(delta);
  
  // Start continuous after delay
  pressTimeout = setTimeout(() => {
    pressInterval = setInterval(() => {
      updateValue(props.largeStep ?? props.step * (delta > 0 ? 1 : -1));
    }, 100);
  }, 500);
}

function stopIncrement() {
  if (pressTimeout) clearTimeout(pressTimeout);
  if (pressInterval) clearInterval(pressInterval);
  pressTimeout = null;
  pressInterval = null;
}

function updateValue(delta) {
  const newValue = Math.min(props.max, Math.max(props.min, (props.modelValue ?? 0) + delta));
  emit('update:modelValue', newValue);
}
```

Register touchstart/mousedown for startIncrement and touchend/mouseup/mouseleave for stopIncrement.

---

## Task 2.7: Unit Toggle Component

### Description

Create a segmented control component for toggling between Fahrenheit and Celsius.

### File: /src/components/UnitToggle.vue

### Props

```javascript
defineProps({
  modelValue: { type: String, required: true, validator: v => ['F', 'C'].includes(v) },
  disabled: { type: Boolean, default: false }
});
```

### Emits

The component emits update:modelValue with the new unit string.

### Template Structure

Create a horizontal container with two segments of equal width. Each segment contains the unit label ("°F" and "°C"). The selected segment should have a contrasting background (e.g., filled) while the unselected segment has a subtle or outline style.

Use role="radiogroup" on the container and role="radio" with aria-checked on each segment for accessibility.

### Styling

The component should have rounded corners with a 1px border. The selected segment should have a filled background (e.g., blue-600) with white text. The unselected segment should have a transparent background with dark text. Add a smooth transition (150ms) when switching between states.

---

## Phase 2 Completion Checklist

Before proceeding to Phase 3, verify the following:

1. **Session setup flow works end-to-end**: Launch the app, click "Start New Session", fill out the form, submit, and verify a session is created and persisted to localStorage.

2. **Resume flow works**: Refresh the page with an existing session and verify the resume dialog appears. Test both "Resume" and "Start New" paths.

3. **Form validation works**: Attempt to submit with missing required fields and verify error messages appear. Verify that entering out-of-range values shows appropriate errors.

4. **Unit toggle converts values**: Change the unit toggle and verify the displayed values in the form update accordingly.

5. **Number stepper works**: Test increment/decrement buttons, direct input, and long-press acceleration.

6. **Session state persists**: Add any data, refresh the page, and verify data is retained.

7. **End session works**: End the session and verify localStorage is cleared and the welcome screen returns.

8. **Mobile responsiveness**: Test the modal and forms on viewport widths of 320px, 375px, and 414px. Verify all elements are usable.

9. **Accessibility**: Test keyboard navigation through the form. Verify focus trapping in modals. Run a screen reader through the form flow.

---

## Dependencies for Next Phase

Phase 3 (Temperature Input System) will depend on:
- useSession composable for addReading() and addOvenEvent()
- NumberStepper component for temperature input
- UnitToggle component for unit display
- Session state reactivity for real-time UI updates
