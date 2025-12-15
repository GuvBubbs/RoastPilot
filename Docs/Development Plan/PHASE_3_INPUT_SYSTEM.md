# Phase 3: Temperature Input System

## Phase Objectives

Implement the primary user interaction components for logging internal temperature readings and oven temperature changes. This phase creates the "Add Internal Reading" and "Update Oven Temp" interfaces with auto-timestamping, validation, and log management capabilities including edit and delete functionality.

## Prerequisites

Phase 2 must be complete, providing the session state management composable and form input components.

## Deliverables

1. InputPanel component with both temperature input forms
2. Internal reading quick-add modal with validation
3. Oven temperature update modal with change tracking
4. ReadingsLog component with edit/delete capabilities
5. OvenEventsLog component with edit/delete capabilities
6. Toast notification system for feedback

---

## Task 3.1: Input Panel Component

### Description

Create the primary input panel component that contains the two main action buttons and serves as the hub for temperature logging interactions.

### File: /src/components/InputPanel.vue

### Component Behavior

The InputPanel renders two prominent action buttons and manages the visibility of the associated input modals. It should be positioned in a fixed or sticky location on mobile for easy thumb access.

### Template Structure

Create a container that holds two large, tappable buttons arranged horizontally on wider screens and stacked vertically on narrow mobile screens (breakpoint at 400px). The left button is "Add Reading" for internal temperature, styled with a primary color theme (e.g., red/orange to suggest heat). The right button is "Update Oven" for oven temperature, styled with a secondary but still prominent color (e.g., amber/yellow).

Each button should display an icon above the text label. For "Add Reading" use a thermometer icon; for "Update Oven" use a flame or oven icon. Below each button's label, display contextual helper text: for the reading button, show "Last: [temp] at [time]" if readings exist, or "No readings yet" if none; for the oven button, show "Current: [temp]" with the current oven set temperature.

The buttons should have minimum height of 80px for comfortable touch interaction. Use rounded corners and subtle shadows to make them feel tappable.

### State Management

```javascript
import { ref, computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { formatTemperature, toDisplayUnit } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';

const { latestReading, currentOvenTemp, displayUnits } = useSession();

const showReadingModal = ref(false);
const showOvenModal = ref(false);

const lastReadingDisplay = computed(() => {
  if (!latestReading.value) return 'No readings yet';
  const temp = formatTemperature(latestReading.value.temp, displayUnits.value);
  const time = formatTime(latestReading.value.timestamp);
  return `Last: ${temp} at ${time}`;
});

const currentOvenDisplay = computed(() => {
  if (!currentOvenTemp.value) return 'Not set';
  return `Current: ${formatTemperature(currentOvenTemp.value, displayUnits.value)}`;
});
```

### Accessibility

Each button must be a proper button element with descriptive aria-label. The buttons should have visible focus states for keyboard navigation.

---

## Task 3.2: Add Reading Modal Component

### Description

Create the modal for quickly adding a new internal temperature reading. The modal captures the temperature value and auto-assigns the current timestamp, with an option to adjust the timestamp if needed.

### File: /src/components/AddReadingModal.vue

### Props

```javascript
defineProps({
  modelValue: { type: Boolean, required: true }
});
```

### Emits

```javascript
defineEmits(['update:modelValue', 'added']);
```

### Template Structure

The modal should be optimized for rapid data entry. The design should minimize taps required to log a reading.

The modal content should contain the following sections in order:

**Temperature Input Section**

Display a large NumberStepper component for temperature input, pre-focused when the modal opens. The stepper should show the current display units (°F or °C) as a suffix. Set appropriate min/max bounds based on the unit (32-212°F or 0-100°C). Default step size should be 1 degree, with a large step of 5 degrees for long press.

Above the input, display the current target temperature for reference: "Target: 125°F" to help the user contextualize their reading.

**Timestamp Section**

Below the temperature input, show the auto-captured timestamp in a readable format: "Recording at 2:45 PM". Include a small "adjust" link/button that expands a datetime picker when clicked. The datetime picker should default to the current time but allow selecting any time within the session duration. Most users will not need to adjust the time, so keep this collapsed by default.

**Delta Preview**

If there are previous readings, show a preview of what the delta will be: "Change from last: +3°F (12 min ago)". This provides immediate feedback before submission.

**Action Buttons**

A single prominent "Add Reading" button that validates and submits. A smaller "Cancel" link or button that closes the modal. The Add button should be large enough for easy thumb tapping and positioned at the bottom of the modal content.

### Validation Logic

```javascript
import { ref, computed, onMounted } from 'vue';
import { useSession } from '../composables/useSession.js';
import { validateReading } from '../utils/validationUtils.js';
import { toDisplayUnit, toStorageUnit } from '../utils/temperatureUtils.js';
import { formatDelta, formatTimeAgo } from '../utils/timeUtils.js';

const { addReading, latestReading, displayUnits, config } = useSession();

const temperature = ref(null);
const timestamp = ref(new Date().toISOString());
const showTimestampPicker = ref(false);
const validationError = ref('');
const validationWarning = ref('');

// Pre-populate with a sensible default near the last reading or starting temp
onMounted(() => {
  if (latestReading.value) {
    temperature.value = toDisplayUnit(latestReading.value.temp, displayUnits.value);
  } else if (config.value?.startingTemp) {
    temperature.value = toDisplayUnit(config.value.startingTemp, displayUnits.value);
  }
});

const deltaPreview = computed(() => {
  if (!latestReading.value || !temperature.value) return null;
  
  const currentTempF = toStorageUnit(temperature.value, displayUnits.value);
  const deltaF = currentTempF - latestReading.value.temp;
  const timeAgo = formatTimeAgo(latestReading.value.timestamp);
  
  return {
    delta: formatDelta(deltaF, displayUnits.value),
    timeAgo
  };
});

function validate() {
  const previousTempF = latestReading.value?.temp ?? null;
  const result = validateReading(temperature.value, displayUnits.value, previousTempF);
  
  validationError.value = result.error || '';
  validationWarning.value = result.warning || '';
  
  return result.valid;
}

function handleSubmit() {
  if (!validate()) return;
  
  addReading(temperature.value, timestamp.value);
  emit('added');
  emit('update:modelValue', false);
  
  // Show success toast
  showToast('Reading added');
}
```

### Quick Entry Optimization

To enable the fastest possible data entry, implement the following UX optimizations:

When the modal opens, immediately focus the temperature input field. If on a touch device, this should trigger the numeric keyboard. The input field should be pre-selected (highlighted) so the user can immediately start typing to replace the default value.

If the user enters a value and presses Enter, submit the form automatically without requiring a button tap.

Consider adding a "quick entry" mode where tapping the main "Add Reading" button immediately opens a minimal overlay with just the number input and a submit button, without the full modal chrome.

---

## Task 3.3: Update Oven Temperature Modal Component

### Description

Create the modal for logging oven temperature changes. This modal captures when the user adjusts their oven dial to a new temperature setting.

### File: /src/components/UpdateOvenModal.vue

### Props

```javascript
defineProps({
  modelValue: { type: Boolean, required: true }
});
```

### Emits

```javascript
defineEmits(['update:modelValue', 'updated']);
```

### Template Structure

The modal should clearly communicate that this is for logging changes to the oven setting, not the actual oven temperature.

**Header Section**

Display a clear title: "Update Oven Set Temperature". Include helper text: "Log when you adjust your oven dial."

**Current vs New Temperature**

Create a visual layout that shows the transition from current to new temperature. Display the current oven temperature on the left with a label "Current", an arrow icon in the middle, and the new temperature input on the right with a label "New".

The current temperature display should be non-editable, styled as a static value. The new temperature input should be a NumberStepper component with appropriate bounds for oven temperatures (100-550°F or 38-288°C).

**Change Indicator**

Below the temperature inputs, show the change magnitude: "Changing by +25°F" (or negative for decreases). Use color coding: green for increases, blue for decreases, gray for no change.

**Timestamp Section**

Same pattern as AddReadingModal: show auto-captured time with an expandable picker for adjustment.

**Action Buttons**

"Update Oven Temp" as the primary action button, "Cancel" as secondary. If the new temperature equals the current temperature, disable the submit button and show "No change to record".

### Validation Logic

```javascript
import { ref, computed, onMounted } from 'vue';
import { useSession } from '../composables/useSession.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';

const { addOvenEvent, currentOvenTemp, displayUnits } = useSession();

const newTemperature = ref(null);
const timestamp = ref(new Date().toISOString());
const validationError = ref('');

// Default to current oven temp
onMounted(() => {
  if (currentOvenTemp.value) {
    newTemperature.value = toDisplayUnit(currentOvenTemp.value, displayUnits.value);
  }
});

const currentDisplay = computed(() => {
  if (!currentOvenTemp.value) return '--';
  return toDisplayUnit(currentOvenTemp.value, displayUnits.value);
});

const changeAmount = computed(() => {
  if (!currentOvenTemp.value || !newTemperature.value) return null;
  return newTemperature.value - currentDisplay.value;
});

const isNoChange = computed(() => {
  return changeAmount.value === 0;
});

function validate() {
  const result = validateOvenTemp(newTemperature.value, displayUnits.value);
  validationError.value = result.error || '';
  return result.valid;
}

function handleSubmit() {
  if (!validate() || isNoChange.value) return;
  
  addOvenEvent(newTemperature.value, timestamp.value);
  emit('updated');
  emit('update:modelValue', false);
  
  showToast('Oven temperature updated');
}
```

---

## Task 3.4: Readings Log Component

### Description

Create a scrollable log table displaying all internal temperature readings with timestamps, deltas, and edit/delete capabilities.

### File: /src/components/ReadingsLog.vue

### Template Structure

The component should render as a collapsible section with a header that shows the count of readings: "Internal Readings (7)". The section should be expanded by default if there are readings, collapsed if empty.

**Table Header Row**

Create a header row with four columns: Time, Temp, Δ Start (delta from first reading), and Actions. On narrow screens, the Δ Start column may be hidden or abbreviated.

**Table Body Rows**

Each reading renders as a row with the following cells:

The Time cell displays the timestamp formatted as "2:45 PM". If the reading is from a previous day, include the date: "Dec 15, 2:45 PM".

The Temp cell displays the temperature in the current display units with the unit symbol.

The Δ Start cell displays the delta from the first reading. Use color coding: positive deltas in a warm color (indicating heating progress), negative in a cool color (unexpected cooling), zero in neutral. Format as "+12.5°F" or "-2.0°C".

The Actions cell contains icon buttons for Edit (pencil icon) and Delete (trash icon). These should be small but still meet 44px touch target minimums through padding.

**Empty State**

If no readings exist, display a centered message: "No readings recorded yet. Tap 'Add Reading' to start tracking."

**Scrolling Behavior**

If there are many readings, the table body should scroll while the header remains fixed. Set a max-height on the table container with overflow-y: auto.

### Edit Functionality

When the Edit button is clicked for a row, transform that row into an inline edit mode:

The Temp cell becomes an editable NumberStepper, pre-populated with the current value. The Time cell becomes a datetime-local input if the user clicks an "adjust time" link. Display Save and Cancel buttons in the Actions cell, replacing Edit and Delete.

```javascript
const editingId = ref(null);
const editTemp = ref(null);
const editTimestamp = ref(null);

function startEdit(reading) {
  editingId.value = reading.id;
  editTemp.value = toDisplayUnit(reading.temp, displayUnits.value);
  editTimestamp.value = reading.timestamp;
}

function cancelEdit() {
  editingId.value = null;
  editTemp.value = null;
  editTimestamp.value = null;
}

function saveEdit() {
  if (!editingId.value) return;
  
  const result = validateReading(editTemp.value, displayUnits.value);
  if (!result.valid) {
    showToast(result.error, 'error');
    return;
  }
  
  updateReading(editingId.value, {
    temp: editTemp.value,
    timestamp: editTimestamp.value
  });
  
  cancelEdit();
  showToast('Reading updated');
}
```

### Delete Functionality

When the Delete button is clicked, show a confirmation prompt before deleting. Use a small inline confirmation rather than a full modal to keep the interaction lightweight:

Replace the row content with: "Delete this reading?" and two buttons: "Yes, delete" and "Cancel". If confirmed, call deleteReading(id) and show a toast confirmation.

```javascript
const deletingId = ref(null);

function startDelete(id) {
  deletingId.value = id;
}

function cancelDelete() {
  deletingId.value = null;
}

function confirmDelete() {
  if (!deletingId.value) return;
  
  deleteReading(deletingId.value);
  deletingId.value = null;
  showToast('Reading deleted');
}
```

---

## Task 3.5: Oven Events Log Component

### Description

Create a log component for displaying the history of oven temperature changes, styled as a timeline or step visualization to reflect the discrete nature of oven adjustments.

### File: /src/components/OvenEventsLog.vue

### Template Structure

The component renders as a collapsible section with header "Oven Temperature History (4)". Default to collapsed state since users will reference this less frequently than the readings log.

**Timeline Visualization**

Rather than a traditional table, present oven events as a vertical timeline. Each event is a node on the timeline with the following information:

The node displays the set temperature prominently, the timestamp below it, and if not the first event, the change from the previous temperature (e.g., "+25°F from 175°F").

Connect nodes with a vertical line. Style the line and nodes to suggest temperature: warmer colors for higher temperatures, cooler colors for lower.

**Segment Duration**

Between timeline nodes, display the duration that temperature was held: "Held for 1h 23m". This helps users understand how long each oven setting was active.

```javascript
const eventsWithDuration = computed(() => {
  const events = ovenEvents.value;
  return events.map((event, index) => {
    let duration = null;
    if (index < events.length - 1) {
      // Duration until next event
      duration = minutesBetween(event.timestamp, events[index + 1].timestamp);
    } else {
      // Duration from this event until now (ongoing)
      duration = minutesBetween(event.timestamp, new Date().toISOString());
    }
    
    return {
      ...event,
      duration,
      isOngoing: index === events.length - 1
    };
  });
});
```

**Edit and Delete**

Each timeline node has a small menu (three dots icon) that reveals Edit and Delete options. Editing opens a small inline form similar to the readings log. Deleting shows an inline confirmation.

Note: Deleting an oven event that isn't the most recent requires recalculating previousTemp for subsequent events. Handle this in the session composable.

---

## Task 3.6: Toast Notification System

### Description

Implement a lightweight toast notification system for providing feedback on user actions (reading added, oven updated, errors, etc.).

### File: /src/composables/useToast.js

```javascript
import { ref } from 'vue';

const toasts = ref([]);
let toastId = 0;

export function useToast() {
  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {'success'|'error'|'warning'|'info'} [type='success'] - Toast type for styling
   * @param {number} [duration=3000] - Duration in milliseconds
   */
  function showToast(message, type = 'success', duration = 3000) {
    const id = ++toastId;
    
    toasts.value.push({
      id,
      message,
      type,
      visible: true
    });
    
    // Auto-dismiss after duration
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
  
  /**
   * Dismiss a specific toast
   * @param {number} id
   */
  function dismissToast(id) {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index !== -1) {
      // Mark as not visible to trigger exit animation
      toasts.value[index].visible = false;
      
      // Remove from array after animation completes
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 300);
    }
  }
  
  /**
   * Dismiss all toasts
   */
  function dismissAll() {
    toasts.value.forEach(t => t.visible = false);
    setTimeout(() => {
      toasts.value = [];
    }, 300);
  }
  
  return {
    toasts,
    showToast,
    dismissToast,
    dismissAll
  };
}
```

### File: /src/components/ToastContainer.vue

```javascript
<template>
  <div class="fixed bottom-4 left-4 right-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="[
          'pointer-events-auto px-4 py-3 rounded-lg shadow-lg max-w-sm w-full',
          'flex items-center gap-3 text-sm font-medium',
          toastStyles[toast.type]
        ]"
        @click="dismissToast(toast.id)"
      >
        <component :is="toastIcons[toast.type]" class="w-5 h-5 flex-shrink-0" />
        <span class="flex-1">{{ toast.message }}</span>
        <button class="text-current opacity-60 hover:opacity-100" aria-label="Dismiss">
          <XIcon class="w-4 h-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useToast } from '../composables/useToast.js';
import { CheckCircleIcon, XCircleIcon, AlertTriangleIcon, InfoIcon, XIcon } from 'lucide-vue-next';

const { toasts, dismissToast } = useToast();

const toastStyles = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-blue-600 text-white'
};

const toastIcons = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon
};
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
```

Add ToastContainer to App.vue template, positioned outside the main content flow.

---

## Task 3.7: Timestamp Picker Component

### Description

Create a reusable timestamp picker component for adjusting auto-captured timestamps. The picker should be mobile-friendly and allow quick adjustments.

### File: /src/components/TimestampPicker.vue

### Props

```javascript
defineProps({
  modelValue: { type: String, required: true }, // ISO 8601 string
  minTime: { type: String, default: null }, // Minimum selectable time
  maxTime: { type: String, default: null }, // Maximum selectable time (usually "now")
  label: { type: String, default: 'Time' }
});
```

### Emits

```javascript
defineEmits(['update:modelValue']);
```

### Template Structure

The component has two display modes: collapsed (default) and expanded.

**Collapsed Mode**

Display the current timestamp in a readable format: "2:45 PM today" or "Dec 15, 2:45 PM". Show a small "edit" button or make the entire element tappable to expand.

**Expanded Mode**

When expanded, show input controls for adjusting the time:

For quick adjustments, provide buttons for common offsets: "-15 min", "-5 min", "-1 min", "+1 min", "+5 min". These allow rapid adjustment without typing.

For precise selection, provide a native datetime-local input as a fallback. Note that datetime-local support varies across browsers and devices, so style it to fit the design and provide the quick adjustment buttons as the primary interface.

Include a "Done" button to collapse back to display mode and a "Reset to now" button.

### Implementation Notes

```javascript
import { ref, computed, watch } from 'vue';
import { formatTime, formatDateTime, addMinutes, now } from '../utils/timeUtils.js';

const props = defineProps({...});
const emit = defineEmits(['update:modelValue']);

const isExpanded = ref(false);
const localValue = ref(props.modelValue);

// Keep local value in sync with prop
watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal;
});

const displayText = computed(() => {
  const date = new Date(localValue.value);
  const today = new Date();
  
  if (date.toDateString() === today.toDateString()) {
    return formatTime(localValue.value) + ' today';
  }
  return formatDateTime(localValue.value);
});

function adjustBy(minutes) {
  let newTime = addMinutes(localValue.value, minutes);
  
  // Clamp to bounds
  if (props.minTime && newTime < props.minTime) {
    newTime = props.minTime;
  }
  if (props.maxTime && newTime > props.maxTime) {
    newTime = props.maxTime;
  }
  
  localValue.value = newTime;
  emit('update:modelValue', newTime);
}

function resetToNow() {
  localValue.value = now();
  emit('update:modelValue', localValue.value);
}

function handleDone() {
  isExpanded.value = false;
}
```

---

## Task 3.8: Integration with App Shell

### Description

Integrate all Phase 3 components into the main application layout.

### File: /src/App.vue (modifications)

Add the following components to the template in the active session view:

Place InputPanel at the top of the main content area, below the status cards (which will be added in Phase 4). The InputPanel should be in a sticky container on mobile so it's always accessible even when scrolling through logs.

Place ReadingsLog and OvenEventsLog below the charts area (charts will be added in Phase 5). These logs can be tabbed or stacked vertically. On desktop, they can be displayed side by side.

Include ToastContainer at the root level of the App template, outside the main content container.

### Layout Structure for Active Session

```html
<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Header (existing) -->
    
    <main v-if="hasActiveSession" class="pb-24">
      <!-- Status Cards (Phase 4) -->
      <StatusCards />
      
      <!-- Input Panel - sticky on mobile -->
      <div class="sticky top-14 z-10 bg-gray-50 pb-2">
        <InputPanel />
      </div>
      
      <!-- Charts (Phase 5) -->
      <div class="px-4 mt-4">
        <TemperatureChart />
      </div>
      
      <!-- Recommendation Panel (Phase 6) -->
      <RecommendationPanel />
      
      <!-- Logs -->
      <div class="px-4 mt-4 space-y-4">
        <ReadingsLog />
        <OvenEventsLog />
      </div>
    </main>
    
    <!-- Modals -->
    <SessionSetupModal v-model="showSessionSetup" @submit="handleSessionCreated" />
    <AddReadingModal v-if="hasActiveSession" />
    <UpdateOvenModal v-if="hasActiveSession" />
    
    <!-- Toast Notifications -->
    <ToastContainer />
  </div>
</template>
```

---

## Phase 3 Completion Checklist

Before proceeding to Phase 4, verify the following:

1. **Add reading flow works**: Tap "Add Reading", enter a temperature, submit, and verify the reading appears in the log with the correct timestamp and delta.

2. **Update oven flow works**: Tap "Update Oven", change the temperature, submit, and verify the event appears in the oven log with the correct change amount.

3. **Auto-timestamp is accurate**: Verify that timestamps captured reflect the actual time the modal was opened (not when it was submitted, unless time elapsed is minimal).

4. **Timestamp adjustment works**: Expand the timestamp picker, adjust using quick buttons and manual input, verify the adjusted time is saved correctly.

5. **Edit functionality works**: Edit a reading's temperature and timestamp, save, and verify the changes persist and deltas are recalculated correctly.

6. **Delete functionality works**: Delete a reading, confirm the prompt, verify the reading is removed and subsequent deltas are recalculated.

7. **Validation prevents bad data**: Attempt to enter out-of-range temperatures and verify error messages appear and submission is blocked.

8. **Toast notifications appear**: Verify success toasts appear for add, update, edit, and delete operations. Verify error toasts appear for validation failures.

9. **Persistence works**: Add several readings and oven events, refresh the page, resume the session, and verify all data is intact.

10. **Mobile usability**: Test on a 320px viewport. Verify buttons are easily tappable, modals are scrollable if content overflows, and keyboard doesn't obscure inputs.

---

## Dependencies for Next Phase

Phase 4 (Status Display & Calculations) will depend on:
- readings and ovenEvents arrays from useSession
- Temperature and time utility functions for calculations
- Toast system for displaying calculation warnings
- The component layout structure established in this phase
