# Reverse Sear Temperature Tracker - Master Development Plan

## Project Overview

Build a lightweight, mobile-friendly Progressive Web App (PWA) that helps home cooks predict when a roast will reach a target internal temperature during low-and-slow cooking. The application captures periodic thermometer readings and oven temperature settings, visualizes progress, estimates time-to-target, and provides oven adjustment recommendations.

## Technology Stack

### Frontend Framework
- **Vue 3** with Composition API (recommended for reactive state management and component architecture)
- **Alternative**: React 18 with hooks, or vanilla JavaScript with Web Components

### Styling
- **Tailwind CSS** for utility-first responsive design
- Mobile-first approach targeting viewport widths 320px and above

### Charting
- **Chart.js 4.x** with the chartjs-plugin-annotation plugin for target lines
- **Alternative**: Lightweight options like uPlot if bundle size is critical

### State Management
- Vue's built-in reactivity (ref/reactive) for local component state
- Pinia store for global session state (if using Vue)
- localStorage API for persistence

### Build Tooling
- **Vite** for fast development and optimized production builds
- PWA plugin for service worker generation

### Data Export
- Native Blob API for CSV generation
- JSON.stringify for JSON export

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Shell                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Session   │  │   Input     │  │      Status Display     │  │
│  │   Setup     │  │   Panel     │  │      (Cards + ETA)      │  │
│  │   Modal     │  │             │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Chart Container                          ││
│  │  ┌─────────────────────┐  ┌───────────────────────────────┐││
│  │  │  Internal Temp      │  │  Oven Temp Step Chart         │││
│  │  │  Line Chart         │  │  (overlay or separate)        │││
│  │  └─────────────────────┘  └───────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Log Tables                               ││
│  │  ┌─────────────────────┐  ┌───────────────────────────────┐││
│  │  │  Internal Readings  │  │  Oven Temp Events             │││
│  │  └─────────────────────┘  └───────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Recommendation Panel                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

```
User Input → Validation → State Update → Persistence → UI Update
                                ↓
                    Calculation Engine
                    (Rate, ETA, Recommendation)
                                ↓
                    Chart Data Transform
                                ↓
                    Render Updates
```

## Development Phases Summary

| Phase | Name | Focus Area | Estimated Complexity |
|-------|------|------------|---------------------|
| 1 | Foundation & Data Layer | Project setup, data models, storage service | Medium |
| 2 | Session Management UI | Session setup modal, form validation | Medium |
| 3 | Temperature Input System | Input forms, auto-timestamp, log management | Medium |
| 4 | Status Display & Basic Calculations | Status cards, rate calculation, ETA | Medium-High |
| 5 | Charting & Visualization | Internal temp chart, oven temp overlay, projections | High |
| 6 | Recommendation Engine | Adjustment logic, confidence scoring, guardrails | High |
| 7 | Settings, Export & Polish | Settings panel, CSV/JSON export, PWA features | Medium |

## File Structure

```
/src
├── /components
│   ├── SessionSetupModal.vue
│   ├── InputPanel.vue
│   ├── StatusCards.vue
│   ├── TemperatureChart.vue
│   ├── OvenTempChart.vue
│   ├── ReadingsLog.vue
│   ├── OvenEventsLog.vue
│   ├── RecommendationPanel.vue
│   └── SettingsPanel.vue
├── /composables (or /hooks for React)
│   ├── useSession.js
│   ├── useCalculations.js
│   ├── useRecommendations.js
│   └── useStorage.js
├── /services
│   ├── storageService.js
│   ├── exportService.js
│   └── calculationService.js
├── /models
│   └── dataModels.js
├── /utils
│   ├── temperatureUtils.js
│   ├── timeUtils.js
│   └── validationUtils.js
├── /constants
│   └── defaults.js
├── App.vue
├── main.js
└── style.css
```

## Cross-Phase Considerations

### Unit Handling Strategy
All internal calculations use a canonical unit (Fahrenheit for temperature, milliseconds for time). Conversion to/from Celsius happens only at the UI boundary (input and display). This prevents conversion errors and simplifies the calculation engine.

### Timestamp Strategy
All timestamps stored as ISO 8601 strings for JSON serialization compatibility and human readability in exports. Use `new Date().toISOString()` for capture, parse back to Date objects for calculations.

### Responsive Design Breakpoints
- Mobile: 320px - 639px (primary target)
- Tablet: 640px - 1023px
- Desktop: 1024px+

### Error Handling Philosophy
- Validate all user input at entry
- Graceful degradation when calculations cannot be performed
- Clear user feedback explaining what's missing or wrong
- Never crash; always show a usable state

## Detailed Phase Documentation

Each phase has its own detailed document:

1. [Phase 1: Foundation & Data Layer](./PHASE_1_FOUNDATION.md)
2. [Phase 2: Session Management UI](./PHASE_2_SESSION_MANAGEMENT.md)
3. [Phase 3: Temperature Input System](./PHASE_3_INPUT_SYSTEM.md)
4. [Phase 4: Status Display & Calculations](./PHASE_4_STATUS_CALCULATIONS.md)
5. [Phase 5: Charting & Visualization](./PHASE_5_CHARTING.md)
6. [Phase 6: Recommendation Engine](./PHASE_6_RECOMMENDATIONS.md)
7. [Phase 7: Settings, Export & Polish](./PHASE_7_SETTINGS_EXPORT.md)

## Acceptance Criteria Mapping

| Requirement | Implemented In |
|-------------|----------------|
| Log internal temps with auto timestamps | Phase 3 |
| Log oven set temps with auto timestamps | Phase 3 |
| Show current oven temp and history | Phase 3, Phase 4 |
| Predict ETA after 2+ readings | Phase 4 |
| Early/late/on-track indicator | Phase 4 |
| Oven adjustment recommendation | Phase 6 |
| Explain missing data for recommendations | Phase 6 |
| Local session persistence | Phase 1 |
| CSV/JSON export | Phase 7 |
