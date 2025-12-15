# Phase 2 Context - Essential Information

This document provides all the context Phase 2 developers need to build the Session Management UI.

## ✅ Phase 1 Status: COMPLETE

All foundation components are implemented and tested. The dev server is running at `http://localhost:5173/`.

## 📂 Project Structure

```
RoastPilot/
├── src/
│   ├── constants/
│   │   └── defaults.js              # SESSION_DEFAULTS, SETTINGS_DEFAULTS, MEAT_PRESETS, etc.
│   ├── models/
│   │   └── dataModels.js            # createSession(), createReading(), createOvenEvent(), etc.
│   ├── services/
│   │   └── storageService.js        # saveSession(), loadSession(), clearSession(), etc.
│   ├── utils/
│   │   ├── temperatureUtils.js      # Unit conversion, formatting, validation
│   │   ├── timeUtils.js             # Time calculations and formatting
│   │   └── validationUtils.js       # validateSessionConfig(), validateReading(), etc.
│   ├── App.vue                      # Root component (currently shows Phase 1 demo)
│   ├── main.js                      # Entry point with Pinia setup
│   └── style.css                    # Global styles with Tailwind
├── public/
│   └── test.html                    # Automated test suite (for reference)
├── package.json                     # All dependencies installed
├── vite.config.js                   # Vite + PWA config
└── tailwind.config.js               # Custom theme (safe, warning, danger colors)
```

## 🎯 Key Design Decisions

### Temperature Storage Strategy
- **All temperatures stored internally in Fahrenheit** (canonical unit)
- **Conversion happens ONLY at UI boundaries** (input and display)
- Use `toStorageUnit()` when saving user input
- Use `toDisplayUnit()` or `formatTemperature()` when displaying

### Timestamp Format
- **All timestamps use ISO 8601 strings** (e.g., `"2024-12-16T10:30:00.000Z"`)
- Use `new Date().toISOString()` to create timestamps
- Parse with `new Date(timestampISO)` for calculations

### Validation Pattern
- Validate at input entry
- Return objects with `{valid: boolean, errors: {...}}` or `{valid: boolean, error: string}`
- Show errors inline in forms
- Warnings (like large temp jumps) are separate from errors

## 📚 Available Utilities & Services

### Data Models (`src/models/dataModels.js`)

```javascript
import { createSession, createDefaultSettings } from './models/dataModels.js';

// Create a new session with defaults
const session = createSession({
  targetTemp: 130,
  initialOvenTemp: 200,
  units: 'F'
});

// Session structure:
// {
//   config: { id, targetTemp, units, initialOvenTemp, ... },
//   readings: [],
//   ovenEvents: [],
//   settings: { ... }
// }
```

### Storage Service (`src/services/storageService.js`)

```javascript
import { storageService } from './services/storageService.js';

// Initialize (call once at app start)
storageService.initialize();

// Save session
storageService.saveSession(session);

// Load session (returns null if none exists)
const session = storageService.loadSession();

// Check if session exists
if (storageService.hasSession()) { ... }

// Clear session
storageService.clearSession();

// Settings (separate from session)
storageService.saveSettings(settings);
const settings = storageService.loadSettings();
```

### Temperature Utilities (`src/utils/temperatureUtils.js`)

```javascript
import { 
  fahrenheitToCelsius, 
  celsiusToFahrenheit,
  toDisplayUnit,
  toStorageUnit,
  formatTemperature,
  formatDelta,
  getCommonTargets
} from './utils/temperatureUtils.js';

// Conversion
const celsius = fahrenheitToCelsius(212); // 100
const fahrenheit = celsiusToFahrenheit(100); // 212

// Display conversion (for UI)
const displayTemp = toDisplayUnit(125, 'C'); // 51.7
const storageTemp = toStorageUnit(51.7, 'C'); // 125

// Formatting
formatTemperature(125, 'F'); // "125°F"
formatTemperature(125, 'C'); // "51.7°C"
formatDelta(10, 'F'); // "+10°F"

// Common targets for presets
const targets = getCommonTargets();
// Returns array of {name, targetF, description}
```

### Time Utilities (`src/utils/timeUtils.js`)

```javascript
import { 
  formatDuration,
  formatTime,
  formatDateTime,
  formatTimeAgo,
  addMinutes,
  minutesBetween,
  now
} from './utils/timeUtils.js';

formatDuration(90); // "1h 30m"
formatTime('2024-12-16T10:30:00.000Z'); // "10:30 AM"
formatDateTime('2024-12-16T10:30:00.000Z'); // "Dec 16, 10:30 AM"
formatTimeAgo('2024-12-16T09:30:00.000Z'); // "1 hour ago"
addMinutes(now(), 30); // ISO string 30 minutes from now
```

### Validation Utilities (`src/utils/validationUtils.js`)

```javascript
import { 
  validateSessionConfig,
  validateReading,
  validateOvenTemp
} from './utils/validationUtils.js';

// Session config validation
const result = validateSessionConfig({
  targetTemp: 130,
  initialOvenTemp: 200
}, 'F');

if (!result.valid) {
  // result.errors.targetTemp, result.errors.initialOvenTemp, etc.
}

// Reading validation (returns warning for large jumps)
const readingResult = validateReading(125, 'F', previousTempF);
if (!readingResult.valid) {
  // readingResult.error
}
if (readingResult.warning) {
  // readingResult.warning - show as warning, not error
}
```

### Constants (`src/constants/defaults.js`)

```javascript
import { 
  SESSION_DEFAULTS,
  MEAT_PRESETS,
  RECOMMENDATION_MESSAGES,
  DISCLAIMER
} from './constants/defaults.js';

// Default values
SESSION_DEFAULTS.TARGET_TEMP_F // 125
SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F // 200

// Meat presets for dropdowns
MEAT_PRESETS // Array of {type, cuts[], defaultTargetF, suggestedOvenF, notes}

// Message templates (for future phases)
RECOMMENDATION_MESSAGES.HOLD // Template string
```

## 🎨 Tailwind CSS Custom Theme

Custom colors available:
- `bg-safe` / `text-safe` - Green (#22c55e) for on-track status
- `bg-warning` / `text-warning` - Amber (#f59e0b) for attention needed  
- `bg-danger` / `text-danger` - Red (#ef4444) for critical issues

Custom spacing:
- `h-chart-sm` - 200px (for small charts)
- `h-chart-lg` - 300px (for large charts)

## 🔧 Tech Stack

- **Vue 3** with Composition API (`<script setup>`)
- **Pinia** for state management (already configured in `main.js`)
- **Tailwind CSS** for styling
- **Vite** for build tooling
- **@vueuse/core** available for composables (localStorage, etc.)

## 📋 Phase 2 Requirements (From Development Plan)

Phase 2 should build:

1. **Session Setup Modal**
   - Target temperature input (with unit toggle)
   - Initial oven temperature input
   - Optional starting temperature
   - Desired serve time (date/time picker or time input)
   - Optional: Meat type, cut, weight
   - Optional: Notes field

2. **Pinia Store for Session State**
   - Global session state
   - Actions to create/update session
   - Auto-save to localStorage
   - Load existing session on app mount

3. **Form Components**
   - Input components with validation feedback
   - Unit toggle (°F/°C) with live conversion
   - Preset selector for common targets
   - Date/time picker for serve time

4. **Integration**
   - Use `validateSessionConfig()` for form validation
   - Use `storageService` for persistence
   - Use temperature utilities for unit conversion
   - Use `MEAT_PRESETS` for preset dropdown

## ⚠️ Important Notes

### Unit Conversion in Forms
When user inputs a temperature:
1. User types value in their preferred unit (F or C)
2. Convert to Fahrenheit for storage: `toStorageUnit(userInput, currentUnit)`
3. Store in session.config (always Fahrenheit)
4. Display using: `formatTemperature(storedTempF, displayUnit)`

### Session Creation Flow
```javascript
// 1. User fills form (values in display units)
const formData = {
  targetTemp: 130, // User entered in their unit preference
  initialOvenTemp: 200,
  units: 'F' // or 'C'
};

// 2. Validate (validation handles unit conversion)
const validation = validateSessionConfig(formData, formData.units);
if (!validation.valid) {
  // Show errors
  return;
}

// 3. Convert to storage units
const config = {
  ...formData,
  targetTemp: toStorageUnit(formData.targetTemp, formData.units),
  initialOvenTemp: toStorageUnit(formData.initialOvenTemp, formData.units)
};

// 4. Create session
const session = createSession(config);

// 5. Save to storage
storageService.saveSession(session);
```

### Pinia Store Pattern
```javascript
// src/stores/session.js (to be created)
import { defineStore } from 'pinia';
import { createSession } from '../models/dataModels.js';
import { storageService } from '../services/storageService.js';

export const useSessionStore = defineStore('session', {
  state: () => ({
    session: null
  }),
  
  actions: {
    loadSession() {
      this.session = storageService.loadSession();
    },
    
    createSession(config) {
      this.session = createSession(config);
      storageService.saveSession(this.session);
    },
    
    updateSession(updates) {
      // Update session and auto-save
    }
  }
});
```

## 🧪 Testing

- Automated tests available at `/test.html`
- All Phase 1 utilities are tested and working
- Dev server running: `npm run dev`
- No linter errors

## 🚀 Getting Started for Phase 2

1. **Create Pinia Store** (`src/stores/session.js`)
   - State: current session
   - Actions: load, create, update, clear
   - Auto-save on changes

2. **Create Session Setup Modal Component** (`src/components/SessionSetupModal.vue`)
   - Form with all session config fields
   - Unit toggle (°F/°C)
   - Validation with error display
   - Meat preset selector
   - Submit creates session and saves

3. **Update App.vue**
   - Show modal if no session exists
   - Load session from storage on mount
   - Display session info when active

4. **Form Input Components** (optional, can inline)
   - Temperature input with unit display
   - Date/time picker for serve time
   - Validation feedback components

## 📖 Reference Files

- **Development Plan**: `/Docs/Development Plan/PHASE_2_SESSION_MANAGEMENT.md`
- **Phase 1 Spec**: `/Docs/Development Plan/PHASE_1_FOUNDATION.md`
- **Master Plan**: `/Docs/Development Plan/DEVELOPMENT_PLAN.md`

## ✅ Phase 1 Verification

All Phase 1 components are working:
- ✅ Data models create sessions correctly
- ✅ Storage service saves/loads sessions
- ✅ Temperature conversions accurate (212°F = 100°C verified)
- ✅ Time formatting works
- ✅ Validation functions return correct errors
- ✅ Tailwind custom theme available
- ✅ PWA manifest configured

---

**Ready for Phase 2!** All dependencies and utilities are in place. 🎉


