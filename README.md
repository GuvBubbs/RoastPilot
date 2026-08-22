# 🔥 RoastPilot - Reverse Sear Temperature Tracker

A lightweight, mobile-friendly Progressive Web App (PWA) that helps home cooks predict when a roast will reach a target internal temperature during low-and-slow cooking.

You log internal temperature readings as you take them; RoastPilot works out your heating rate, predicts when you'll hit your target, tells you whether you're running early or late against your serve time, and suggests oven adjustments to bring the two together.

## Project Status

All seven planned phases are implemented. The app is feature-complete for its intended use: setting up a cook, logging readings, tracking progress against a serve time, and exporting the session.

## Features

**Session setup**
- Target temperature with quick-select doneness presets (Rare / Medium-Rare / Medium)
- Meat type presets with suggested oven temperatures and carryover notes
- °F / °C toggle that converts values in place
- Desired serve time, or a "time remaining" countdown
- Optional starting temperature to establish a baseline

**Tracking**
- Internal temperature readings with auto-timestamps and editable history
- Oven temperature changes recorded as a separate event log
- Pause cooking (oven off) and restart, tracked as oven events
- Status cards: current temp, target progress, oven set point, ETA, schedule status

**Analysis**
- Heating rate calculation from recent readings
- ETA prediction with target and serve-time annotations on the chart
- Early / late / on-track schedule status
- Oven adjustment recommendations with confidence scoring and plain-English reasoning
- Temperature progress chart with oven overlay, plus a heating-rate-over-time chart

**Platform**
- Installable PWA with offline support and an offline indicator
- Session persists across reloads via localStorage, with resume prompt
- Dark mode (follows your OS appearance setting)
- Export the session as JSON or CSV

## Tech Stack

- **Framework**: Vue 3 with Composition API
- **Build Tool**: Vite
- **State Management**: Pinia
- **Styling**: Tailwind CSS
- **Charting**: Chart.js with annotation plugin
- **PWA**: vite-plugin-pwa
- **Testing**: Vitest
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

The dev server prints its URL on startup — usually `http://localhost:5173`, but it
will pick the next free port if that one is taken.

Note that `vite.config.js` sets `base: '/RoastPilot/'` for GitHub Pages hosting,
and this applies in dev too. The app itself redirects from `/`, but anything
served out of `public/` is only reachable under that prefix — `/test.html` is a
404, `/RoastPilot/test.html` is the real URL.

### Testing

```bash
# Run the unit tests in watch mode
npm test

# Run once and exit
npx vitest run

# Run with the Vitest UI
npm run test:ui
```

Unit tests currently cover `calculationService` (rate, ETA, and schedule maths).
Component and validation behaviour is not yet covered — changes to the setup
form, steppers, or unit conversion need to be checked in the browser.

There is also a standalone harness for the foundation utilities at
`http://<dev-server>/RoastPilot/test.html`.

## Project Structure

```
/src
├── /components        # Vue components (setup, logging, charts, settings, dialogs)
├── /composables       # Reusable reactive logic
│   ├── useCalculations.js
│   ├── usePWA.js
│   ├── useRecommendations.js
│   ├── useRefreshTimer.js
│   ├── useSession.js
│   └── useToast.js
├── /models            # Data models and factory functions
│   └── dataModels.js
├── /services          # Business logic services
│   ├── calculationService.js
│   ├── calculationService.test.js
│   ├── exportService.js
│   ├── recommendationService.js
│   └── storageService.js
├── /utils             # Utility functions
│   ├── temperatureUtils.js
│   ├── timeUtils.js
│   └── validationUtils.js
├── /constants         # Application constants, meat presets, defaults
│   └── defaults.js
├── App.vue            # Root component
├── main.js            # Application entry point
└── style.css          # Global styles
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

Note that the app *defaults* to Celsius for display (`DEFAULTS.UNITS`), so the
display unit and the storage unit differ out of the box. Anything comparing a
displayed value against a stored one has to convert first.

## Conventions and Gotchas

Points worth knowing before changing temperature input code:

- **Celsius values are not whole numbers.** Target and starting temperatures keep
  one decimal place in °C, so an F-to-C conversion routinely yields values like
  `48.9` or `51.7`. Any code that assumes integer degrees will be wrong in °C.
- **`NumberStepper`'s `step` prop is the -/+ button increment only.** It is
  deliberately *not* bound to the underlying input's `step` attribute, which is
  set to `any`. Binding it would make the browser reject the off-step decimals
  above and silently block form submission. Range and format checks are done in
  the component and surfaced through its `error` prop.
- **Don't pair `v-model` with an `@update:model-value` handler that needs the old
  value.** Both listen to the same event and `v-model` assigns first, so the
  handler sees the new value in both places. `SessionSetupModal` binds
  `UnitToggle` with `:model-value` and lets `handleUnitChange` own the
  assignment, so it can convert the form's values before the unit flips.
- **Temperature *differences* convert by scale only.** A 20°F delta is 11.1°C, not
  −6.7°C. Use `deltaF / 1.8`, never `fahrenheitToCelsius()`, on a difference.

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

### Export Service
- `exportToJSON()` / `exportToCSV()`
- `downloadFile()` / `generateFilename()`

## Development Plan

Detailed phase-by-phase development notes are in `/Docs/Development Plan/`,
covering the original architecture and each phase's scope.

These documents are a historical record of intent, not a verified status report —
some of their completion checkmarks describe what was attempted rather than what
was confirmed working. Treat the code and the browser as the source of truth.

## License

This is a personal project for learning and practical use.

## Disclaimer

Ovens and roasts vary. Use this app as a guide and rely on thermometer readings. This application does not provide food safety guarantees.
