# Phase 4 Context - Status Display & Calculations

## Quick Status Check
- ✅ **Phase 1**: Complete - Utilities, models, storage service
- ✅ **Phase 2**: Complete - Session management UI
- ✅ **Phase 3**: Complete - Temperature input system with logs
- 🎯 **Phase 4**: Ready to build - Status display and calculations

## What Phase 3 Delivered

### Working Components
All Phase 3 components are functional and integrated:
- Input panel with Add Reading / Update Oven buttons
- Modals for data entry (with validation)
- Readings log table (with inline edit/delete)
- Oven events log timeline (with inline edit/delete)
- Toast notification system
- Timestamp picker with quick adjustments

### Data is Flowing
Users can now:
1. Add internal temperature readings
2. Update oven temperature settings
3. View/edit/delete both reading types
4. Data auto-saves to localStorage
5. Deltas automatically calculate

## What's Available for Phase 4

### 1. Session Data Structure
Access via `useSession()` composable:

```javascript
const {
  // Configuration
  config,              // { targetTemp, startingTemp, desiredServeTime, units, etc }
  
  // Data arrays
  readings,            // Array<{ id, temp, timestamp, deltaFromStart, deltaFromPrevious }>
  ovenEvents,          // Array<{ id, setTemp, timestamp, previousTemp }>
  
  // Computed helpers
  latestReading,       // Most recent reading
  currentOvenTemp,     // Current oven set temperature
  displayUnits         // 'F' or 'C'
} = useSession();
```

### 2. Utility Functions Ready to Use

**Time Calculations:**
```javascript
import { 
  minutesBetween,      // (startISO, endISO) => minutes
  hoursBetween,        // (startISO, endISO) => hours
  formatDuration,      // (minutes) => "2h 30m"
  formatTime,          // (isoString) => "2:45 PM"
  now                  // () => current ISO string
} from './utils/timeUtils.js';
```

**Temperature Utilities:**
```javascript
import {
  toDisplayUnit,       // (tempF, unit) => converted temp
  formatTemperature,   // (tempF, unit) => "54°C"
  formatRate,          // (rateF, unit) => "5.2°C/hr"
  convertRate          // (rateF, unit) => converted rate number
} from './utils/temperatureUtils.js';
```

**Toast Notifications:**
```javascript
import { useToast } from './composables/useToast.js';
const { showToast } = useToast();
showToast('Message here', 'success'); // 'success' | 'error' | 'warning' | 'info'
```

### 3. Key Data Model Details

**InternalReading:**
- `temp`: Always in Fahrenheit (storage unit)
- `deltaFromStart`: Degrees F from first reading
- `deltaFromPrevious`: Degrees F from previous reading
- `timestamp`: ISO 8601 string

**Important**: All internal storage is Fahrenheit. Use `toDisplayUnit()` for UI display.

## Phase 4 Requirements (from Development Plan)

### Task 4.1: Status Cards Component
Create status display cards showing:
- **Current Temperature**: Latest reading in large font
- **Target Temperature**: With visual progress bar
- **Current Oven Setting**: Display current oven temp
- **Session Duration**: Time elapsed since session start

Layout: Grid of 2-4 cards, responsive (stack on mobile, row on tablet+)

### Task 4.2: Rate Calculation Service
**File**: `src/services/calculationService.js` or `src/composables/useCalculations.js`

Calculate heating rate from readings:
- Need at least 2 readings
- Consider time window (e.g., last 3-5 readings or last 30-60 minutes)
- Handle outliers/anomalies
- Return rate in °F/hour (or null if insufficient data)

**Formula**: 
```
rate = (tempChange) / (timeElapsed in hours)
```

**Smoothing suggestion**: Use a moving average or linear regression for more stable rate

### Task 4.3: ETA Calculation
Calculate estimated time to reach target:

```javascript
function calculateETA(currentTemp, targetTemp, rate) {
  if (!rate || rate <= 0) return null;
  
  const remainingTemp = targetTemp - currentTemp;
  const hoursRemaining = remainingTemp / rate;
  const minutesRemaining = hoursRemaining * 60;
  
  const etaTime = addMinutes(now(), minutesRemaining);
  return {
    minutesRemaining,
    etaTime,           // ISO string of when target will be reached
    confidence: 'medium' // Could calculate based on rate stability
  };
}
```

### Task 4.4: On-Track Indicator
Compare ETA to desired serve time (if set):

```javascript
function getTrackingStatus(etaTime, desiredServeTime, thresholdMinutes = 15) {
  if (!desiredServeTime || !etaTime) return 'unknown';
  
  const difference = minutesBetween(etaTime, desiredServeTime);
  
  if (Math.abs(difference) <= thresholdMinutes) return 'on-track';
  if (difference > 0) return 'ahead';  // Will finish before desired time
  return 'behind';  // Will finish after desired time
}
```

Color coding:
- On-track: Green
- Ahead: Blue (not urgent)
- Behind: Yellow/Orange (may need adjustment)
- Unknown: Gray (insufficient data)

### Task 4.5: Status Cards Implementation

**Card 1: Current Progress**
- Large display of current temp
- Progress bar from starting temp to target
- Percentage complete

**Card 2: Heating Rate**
- "5.2°C/hr" or "9.4°F/hr"
- Trend indicator (stable, increasing, decreasing)
- Show confidence level if available

**Card 3: ETA**
- "Target in 1h 23m"
- Estimated finish time "Expected: 3:45 PM"
- On-track indicator badge

**Card 4: Session Info**
- Time elapsed
- Number of readings
- Current oven setting

### Task 4.6: Handling Edge Cases

**Not enough data:**
- Show "Need more readings" message
- Display gray/disabled state
- Guide user to add another reading

**Stalled/cooling:**
- If rate is negative, show warning
- Suggest checking oven or adding heat
- Don't show ETA (or show "Cooling - check oven")

**Rate too fast/slow:**
- If rate seems unrealistic, show confidence warning
- Could happen with a single large jump

## Suggested File Structure for Phase 4

```
src/
├── components/
│   ├── StatusCards.vue          (main container)
│   ├── CurrentTempCard.vue      (optional: individual cards)
│   ├── HeatingRateCard.vue
│   ├── ETACard.vue
│   └── SessionInfoCard.vue
├── composables/
│   └── useCalculations.js       (rate, ETA, tracking calculations)
└── services/
    └── calculationService.js    (pure calculation functions)
```

**Recommendation**: Use a composable (`useCalculations.js`) that wraps the calculation service and provides reactive computed properties.

## Integration Point in App.vue

Replace the placeholder at **lines 178-187** in `App.vue`:

```vue
<!-- Placeholder for Phase 4: Status Display -->
<div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
  <h3>Status & ETA</h3>
  <p>⏱️ Status Cards Coming in Phase 4</p>
</div>
```

With:
```vue
<StatusCards />
```

## Important Implementation Notes

### 1. Calculation Frequency
Don't recalculate on every render. Use `computed()` or memoization:

```javascript
const heatingRate = computed(() => {
  if (readings.value.length < 2) return null;
  return calculateHeatingRate(readings.value);
});
```

### 2. Unit Handling Pattern (CRITICAL)
```javascript
// All calculations in Fahrenheit
const rateF = calculateRate(readings); // readings have temp in F

// Convert for display only
const rateDisplay = formatRate(rateF, displayUnits.value); // "5.2°C/hr"
```

### 3. Smoothing Window Suggestion
For stable rate calculation:
- Use last 3-5 readings, OR
- Use readings from last 30-60 minutes
- Ignore the very first reading if it's at session start (may be before oven heated)

### 4. Confidence Scoring (Optional Enhancement)
```javascript
function calculateConfidence(readings, rate) {
  if (readings.length < 3) return 'low';
  
  // Check rate consistency across windows
  const recentRate = calculateRate(readings.slice(-3));
  const olderRate = calculateRate(readings.slice(-5, -2));
  
  const variance = Math.abs(recentRate - olderRate) / rate;
  
  if (variance < 0.1) return 'high';    // Stable within 10%
  if (variance < 0.3) return 'medium';  // Stable within 30%
  return 'low';                          // High variance
}
```

## Testing Checklist for Phase 4

- [ ] Status cards appear with correct values
- [ ] Rate calculation works with 2+ readings
- [ ] ETA displays after 2+ readings
- [ ] ETA updates when new reading added
- [ ] On-track indicator shows correct status (green/yellow/blue)
- [ ] "Need more readings" shows when only 1 reading
- [ ] Progress bar visually represents completion
- [ ] All temps/rates display in user's chosen units
- [ ] Switching units updates all calculated values
- [ ] Cards are responsive (stack on mobile)

## Data You Can Use for Testing

If you need test data, the current session has:
- 1 internal reading (54°C at 11:18 AM)
- 2 oven events (initial: 95°C, updated: 115°C)
- Target temp: (check session config)

For meaningful calculations, you'll want to add 2-3 more readings with different temps and timestamps.

## Common Pitfalls to Avoid

1. **Don't forget unit conversion**: All internal calcs use Fahrenheit
2. **Handle null/undefined gracefully**: Check for sufficient data before calculating
3. **Time is in milliseconds**: Use `minutesBetween()` instead of manual division
4. **Don't mutate readings array**: It's reactive, use computed properties
5. **Rate can be zero or negative**: Handle these edge cases in UI

## Next After Phase 4

Phase 5 will add charting/visualization, building on the calculations from Phase 4.

---

**Current Branch**: main  
**Last Updated**: December 16, 2024  
**Ready for**: Phase 4 Implementation - Status Display & Calculations  
**Dev Server**: Run `npm run dev` → http://localhost:5173

