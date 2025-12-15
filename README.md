# 🔥 RoastPilot - Reverse Sear Temperature Tracker

A lightweight, mobile-friendly Progressive Web App (PWA) that helps home cooks predict when a roast will reach a target internal temperature during low-and-slow cooking.

## Project Status

**Phase 1: Foundation & Data Layer** ✅ COMPLETE

The foundation has been successfully implemented with all core utilities and services in place.

## Features (Phase 1)

- ✅ Complete data model definitions with TypeScript-style JSDoc comments
- ✅ localStorage persistence with schema migration support
- ✅ Temperature conversion utilities (Fahrenheit ↔ Celsius)
- ✅ Time formatting and calculation utilities
- ✅ Input validation for temperatures, sessions, and settings
- ✅ Storage service with JSON/CSV export capabilities
- ✅ PWA configuration with service worker support
- ✅ Tailwind CSS with custom theme for cooking app UI

## Tech Stack

- **Framework**: Vue 3 with Composition API
- **Build Tool**: Vite
- **State Management**: Pinia
- **Styling**: Tailwind CSS
- **Charting**: Chart.js with annotation plugin
- **PWA**: vite-plugin-pwa
- **Utilities**: @vueuse/core

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing Phase 1 Foundation

Visit `http://localhost:5173/test.html` while the dev server is running to see automated tests of all Phase 1 utilities.

## Project Structure

```
/src
├── /components        # Vue components (Phase 2+)
├── /models           # Data models and factory functions ✅
│   └── dataModels.js
├── /services         # Business logic services ✅
│   └── storageService.js
├── /utils            # Utility functions ✅
│   ├── temperatureUtils.js
│   ├── timeUtils.js
│   └── validationUtils.js
├── /constants        # Application constants ✅
│   └── defaults.js
├── App.vue           # Root component ✅
├── main.js           # Application entry point ✅
└── style.css         # Global styles ✅
```

## Data Models

### Session
The main data structure containing:
- **SessionConfig**: Target temp, oven settings, meat details
- **InternalReading[]**: Array of temperature readings with timestamps
- **OvenTempEvent[]**: Array of oven temperature changes
- **AppSettings**: User preferences and calculation parameters

### Storage Strategy

All temperatures are stored internally in Fahrenheit. Conversion to Celsius happens only at the UI boundary (input and display). This prevents conversion errors and simplifies calculations.

All timestamps use ISO 8601 format for consistency and easy serialization.

## Available Utilities

### Temperature Utils
- `fahrenheitToCelsius()` / `celsiusToFahrenheit()`
- `toDisplayUnit()` / `toStorageUnit()`
- `formatTemperature()` / `formatDelta()`
- `validateTemperature()`
- `getCommonTargets()`

### Time Utils
- `minutesBetween()` / `hoursBetween()`
- `addMinutes()`
- `formatDuration()` / `formatTime()` / `formatDateTime()`
- `formatTimeAgo()`
- `isWithinMinutes()`

### Validation Utils
- `validateSessionConfig()`
- `validateReading()`
- `validateOvenTemp()`
- `validateSettings()`
- `sanitizeString()`

### Storage Service
- `initialize()` - Set up storage with migrations
- `saveSession()` / `loadSession()` / `clearSession()`
- `saveSettings()` / `loadSettings()`
- `exportSession()` - Export to JSON or CSV
- `getStorageInfo()` - Check localStorage usage

## Next Steps

**Phase 2: Session Management UI**
- Session setup modal with form validation
- Unit toggle (°F / °C)
- Meat type presets
- Desired serve time input

**Phase 3: Temperature Input System**
- Internal temp reading input with auto-timestamp
- Oven temp adjustment input
- Reading and event log tables

**Phase 4: Status Display & Calculations**
- Current rate calculation
- ETA prediction
- Schedule status (early/late/on-track)

**Phase 5: Charting & Visualization**
- Internal temp line chart
- Oven temp step chart overlay
- Target line with projection

**Phase 6: Recommendation Engine**
- Oven temperature adjustment suggestions
- Confidence scoring
- Explanation of recommendations

**Phase 7: Polish & Export**
- Settings panel
- CSV/JSON export UI
- PWA installation prompt
- Final UX polish

## Development Plan

Detailed development plans are available in `/Docs/Development Plan/`:
- `DEVELOPMENT_PLAN.md` - Overall architecture and strategy
- `PHASE_1_FOUNDATION.md` - Foundation layer (completed)
- `PHASE_2_SESSION_MANAGEMENT.md` - Session setup UI (next)

## License

This is a personal project for learning and practical use.

## Disclaimer

Ovens and roasts vary. Use this app as a guide and rely on thermometer readings. This application does not provide food safety guarantees.


