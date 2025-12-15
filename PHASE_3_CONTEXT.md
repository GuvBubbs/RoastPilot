# Phase 3 Context - Temperature Input System

## Quick Status Check
- ✅ **Phase 1**: Complete - All utilities, models, storage service ready
- ✅ **Phase 2**: Complete - Session management UI fully functional
- 🎯 **Phase 3**: Ready to build - Temperature input forms and log tables

## What's Already Built & Ready to Use

### 1. useSession Composable (`src/composables/useSession.js`)
The singleton state manager with all methods you need:

**Key Methods for Phase 3:**
```javascript
const {
  // State
  hasActiveSession,      // Boolean - is there a session?
  config,                // Session configuration
  readings,              // Array of all internal temp readings
  ovenEvents,            // Array of all oven temp events
  latestReading,         // Most recent reading
  currentOvenTemp,       // Current oven set temp
  displayUnits,          // 'F' or 'C'
  
  // CRUD Methods (these are what you'll use most!)
  addReading,            // (temp, timestamp?) - adds reading with deltas
  updateReading,         // (id, updates) - edit a reading
  deleteReading,         // (id) - remove a reading
  addOvenEvent,          // (setTemp, timestamp?) - log oven change
  updateOvenEvent,       // (id, updates) - edit an event
  deleteOvenEvent        // (id) - remove an event
} = useSession();
```

**Important**: All temps passed to these methods should be in **display units** - the composable handles conversion to Fahrenheit for storage.

### 2. Reusable Components

**`NumberStepper.vue`** - Already built, ready to use for temp input
- Props: `modelValue`, `label`, `suffix`, `step`, `min`, `max`, `error`
- Steps by 1° (configurable)
- Touch-optimized with long-press

**`UnitToggle.vue`** - Already built for °F/°C switching
- Can be reused if you want unit display in Phase 3

### 3. Utility Functions You'll Need

```javascript
// Temperature formatting and conversion
import { 
  formatTemperature,    // (tempF, unit) => "54.4°C" or "130°F"
  formatDelta,          // (deltaF, unit) => "+2.5°C"
  toDisplayUnit,        // (tempF, unit) => number in display unit
  toStorageUnit         // (temp, unit) => Fahrenheit
} from './utils/temperatureUtils.js';

// Time formatting
import { 
  formatTime,           // (isoString) => "2:30 PM"
  formatTimeAgo,        // (isoString) => "5 minutes ago"
  formatDateTime        // (isoString) => "Dec 16, 2:30 PM"
} from './utils/timeUtils.js';

// Validation
import { 
  validateReading       // (temp, unit, previousTemp) - returns {valid, error, warning}
} from './utils/validationUtils.js';
```

### 4. Data Models Reference

**InternalReading structure:**
```javascript
{
  id: "uuid",
  temp: 125,                    // Always in Fahrenheit
  timestamp: "2024-12-16T...",  // ISO 8601
  deltaFromStart: 5,            // Degrees F from first reading
  deltaFromPrevious: 2          // Degrees F from previous reading
}
```

**OvenTempEvent structure:**
```javascript
{
  id: "uuid",
  setTemp: 200,                 // Always in Fahrenheit
  timestamp: "2024-12-16T...",  // ISO 8601
  previousTemp: 225             // Previous oven temp (or null)
}
```

## Critical Design Decisions

### Temperature Storage
- **Store**: All temps in Fahrenheit (canonical unit)
- **Display**: Convert using `toDisplayUnit()` or `formatTemperature()`
- **Input**: Accept in display units, convert with `toStorageUnit()` before saving

### App Defaults to Celsius
- `SESSION_DEFAULTS.UNITS = 'C'`
- All new sessions default to Celsius
- User can still toggle between units

### Auto-Save is Already Working
- useSession has a deep watch on session state
- 1000ms debounce before saving to localStorage
- You don't need to manually save - just update state!

### Timestamps
- Always use ISO 8601 strings: `new Date().toISOString()`
- Auto-timestamp on input (with option to override)
- Display using time utils for formatting

## Phase 3 Requirements

From the development plan, Phase 3 needs:

### Task 3.1: Temperature Reading Input Component
- Number input for internal temp
- Auto-capture timestamp button (or datetime override)
- "Add Reading" action
- Validation (warnings for large jumps)
- Show current/last reading

### Task 3.2: Oven Temperature Input Component
- Number input for oven set temp
- Auto-capture timestamp
- "Log Oven Change" action
- Show current oven temp

### Task 3.3: Readings Log Table
- Display all internal temp readings
- Columns: Time, Temp, Delta from Start, Delta from Previous
- Actions: Edit, Delete
- Most recent at top

### Task 3.4: Oven Events Log Table
- Display all oven temp changes
- Columns: Time, New Temp, Previous Temp, Change Amount
- Actions: Edit, Delete
- Most recent at top

### Task 3.5: Edit/Delete Modals
- Inline editing or modal for updates
- Confirmation dialog for deletes
- Re-validate and recalculate deltas on edit

## Where to Add Phase 3 Components

In `App.vue`, there are placeholder sections ready:

**Line ~255-265**: Input Panel placeholder
```vue
<!-- Placeholder for Phase 3: Input Panel -->
<div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
  <h3>Temperature Input</h3>
  <!-- ADD InputPanel component here -->
</div>
```

Replace with:
```vue
<InputPanel />
```

## Suggested File Structure for Phase 3

```
src/components/
  ├── InputPanel.vue           # Main input component (both temps)
  ├── ReadingsLog.vue          # Internal temp history table
  ├── OvenEventsLog.vue        # Oven temp history table
  └── EditReadingDialog.vue    # (Optional) Modal for editing
```

Or break it down further:
```
src/components/
  ├── TemperatureInput.vue     # Internal temp input form
  ├── OvenTempInput.vue        # Oven temp input form
  ├── ReadingsLog.vue
  ├── OvenEventsLog.vue
  └── ...dialogs as needed
```

## Common Patterns for Phase 3

### Adding a Reading
```javascript
import { useSession } from '../composables/useSession.js';

const { addReading, displayUnits, latestReading } = useSession();
const tempInput = ref(null);

function handleAddReading() {
  // Validate
  const validation = validateReading(tempInput.value, displayUnits.value, latestReading.value?.temp);
  if (!validation.valid) {
    // Show error
    return;
  }
  
  // Warn if big jump
  if (validation.warning) {
    // Show warning, ask to confirm
  }
  
  // Add (temp is in display units, composable converts)
  addReading(tempInput.value);
  
  // Clear input
  tempInput.value = null;
}
```

### Displaying Readings Table
```vue
<template>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Temperature</th>
        <th>Δ from Start</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="reading in readings" :key="reading.id">
        <td>{{ formatTime(reading.timestamp) }}</td>
        <td>{{ formatTemperature(reading.temp, displayUnits) }}</td>
        <td>{{ formatDelta(reading.deltaFromStart, displayUnits) }}</td>
        <td>
          <button @click="editReading(reading.id)">Edit</button>
          <button @click="deleteReading(reading.id)">Delete</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup>
import { useSession } from '../composables/useSession.js';
import { formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';

const { readings, displayUnits, deleteReading } = useSession();
</script>
```

### Important Gotcha: Delta Recalculation
When a reading is updated or deleted, the composable **automatically recalculates deltas** for all readings. You don't need to do this manually!

## Testing Checklist for Phase 3

- [ ] Add internal temp reading with auto-timestamp
- [ ] Add internal temp reading with custom timestamp
- [ ] Validation catches invalid temps
- [ ] Warning shown for large temp jumps
- [ ] Readings appear in log table (newest first)
- [ ] Edit reading updates temperature
- [ ] Delete reading removes from list and recalcs deltas
- [ ] Add oven temp change
- [ ] Oven events appear in log table
- [ ] Edit/delete oven event works
- [ ] All tables show formatted temps in user's preferred unit
- [ ] Switching units updates all displayed temps
- [ ] Data persists after page refresh

## Quick Reference: Reading the Codebase

**If you need to see how something works:**
- Session state management: `src/composables/useSession.js`
- Number input examples: `src/components/SessionSetupModal.vue` (lines 24-35, 67-77)
- Table styling: Look at existing components for Tailwind patterns
- Validation: `src/utils/validationUtils.js` (especially `validateReading`)

## Known Issues / Considerations

1. **No readings yet**: On a fresh session, `readings` array is empty - handle the empty state
2. **Single reading**: With only 1 reading, can't calculate rate yet (Phase 4)
3. **Mobile tables**: Consider card layout on mobile instead of tables
4. **Timestamp editing**: If allowing timestamp edits, readings should stay sorted by timestamp

---

**Ready to Start**: All dependencies are in place. Just import `useSession`, add your UI components, and call the CRUD methods. The auto-save and validation are already handled! 🚀

