# Phase 4: Status Display & Basic Calculations

## Phase Objectives

Implement the status card display system that provides at-a-glance information about cooking progress, and build the calculation engine that computes heating rates, predicts time-to-target, and determines schedule status (early/late/on-track). This phase establishes the core predictive functionality of the application.

## Prerequisites

Phase 3 must be complete, providing the temperature input system and log management.

## Deliverables

1. StatusCards component displaying current state at a glance
2. Calculation service with rate computation and ETA prediction
3. useCalculations composable for reactive calculation results
4. Confidence scoring system for prediction reliability
5. Schedule status indicator with visual feedback

---

## Task 4.1: Calculation Service Implementation

### Description

Create a pure calculation service module containing all mathematical functions for rate computation, prediction, and confidence assessment. This module should be stateless and testable in isolation.

### File: /src/services/calculationService.js

```javascript
import { hoursBetween, minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { CALCULATION_THRESHOLDS } from '../constants/defaults.js';

/**
 * Calculate the heating rate from a set of readings using linear regression
 * Returns rate in degrees Fahrenheit per hour
 * 
 * @param {InternalReading[]} readings - Array of readings sorted by timestamp
 * @param {number} windowSize - Number of most recent readings to use
 * @returns {{rate: number|null, r2: number, readings: number}}
 */
export function calculateHeatingRate(readings, windowSize = 3) {
  if (readings.length < CALCULATION_THRESHOLDS.MIN_READINGS_FOR_RATE) {
    return { rate: null, r2: 0, readings: readings.length };
  }
  
  // Use the most recent N readings
  const windowReadings = readings.slice(-windowSize);
  
  if (windowReadings.length < 2) {
    return { rate: null, r2: 0, readings: windowReadings.length };
  }
  
  // Convert timestamps to hours since first reading in window
  const firstTime = new Date(windowReadings[0].timestamp).getTime();
  const points = windowReadings.map(r => ({
    x: (new Date(r.timestamp).getTime() - firstTime) / (1000 * 60 * 60), // hours
    y: r.temp
  }));
  
  // Simple linear regression: y = mx + b
  // m = (n∑xy - ∑x∑y) / (n∑x² - (∑x)²)
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }
  
  const denominator = n * sumX2 - sumX * sumX;
  
  // Handle edge case of all points at same time (division by zero)
  if (Math.abs(denominator) < 0.0001) {
    return { rate: null, r2: 0, readings: n };
  }
  
  const slope = (n * sumXY - sumX * sumY) / denominator;
  
  // Calculate R² (coefficient of determination) for confidence assessment
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  const intercept = (sumY - slope * sumX) / n;
  
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssTotal += (p.y - meanY) ** 2;
    ssResidual += (p.y - predicted) ** 2;
  }
  
  const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;
  
  return {
    rate: Math.round(slope * 100) / 100, // °F per hour, 2 decimal places
    r2: Math.round(r2 * 1000) / 1000,
    readings: n
  };
}

/**
 * Calculate the session average heating rate (from first to last reading)
 * 
 * @param {InternalReading[]} readings
 * @returns {number|null} Rate in °F/hour
 */
export function calculateAverageRate(readings) {
  if (readings.length < 2) return null;
  
  const first = readings[0];
  const last = readings[readings.length - 1];
  
  const hours = hoursBetween(first.timestamp, last.timestamp);
  if (hours < 0.01) return null; // Less than ~30 seconds, avoid division issues
  
  const tempChange = last.temp - first.temp;
  return Math.round((tempChange / hours) * 100) / 100;
}

/**
 * Calculate time span of readings in minutes
 * 
 * @param {InternalReading[]} readings
 * @returns {number}
 */
export function calculateReadingSpanMinutes(readings) {
  if (readings.length < 2) return 0;
  return minutesBetween(readings[0].timestamp, readings[readings.length - 1].timestamp);
}

/**
 * Predict time to reach target temperature
 * 
 * @param {number} currentTemp - Current internal temperature (°F)
 * @param {number} targetTemp - Target temperature (°F)
 * @param {number} rate - Heating rate (°F/hour)
 * @returns {{minutes: number|null, targetTime: string|null}}
 */
export function predictTimeToTarget(currentTemp, targetTemp, rate) {
  if (rate === null || rate <= CALCULATION_THRESHOLDS.MIN_RATE_FOR_PREDICTION) {
    return { minutes: null, targetTime: null };
  }
  
  const tempRemaining = targetTemp - currentTemp;
  
  if (tempRemaining <= 0) {
    // Already at or past target
    return { minutes: 0, targetTime: new Date().toISOString() };
  }
  
  const hoursRemaining = tempRemaining / rate;
  const minutesRemaining = Math.round(hoursRemaining * 60);
  const targetTime = addMinutes(new Date().toISOString(), minutesRemaining);
  
  return {
    minutes: minutesRemaining,
    targetTime
  };
}

/**
 * Calculate schedule variance (how early or late vs desired serve time)
 * 
 * @param {string} predictedTargetTime - ISO timestamp of predicted completion
 * @param {string} desiredServeTime - ISO timestamp of desired completion
 * @returns {{varianceMinutes: number, status: 'early'|'late'|'on-track'}}
 */
export function calculateScheduleVariance(predictedTargetTime, desiredServeTime) {
  if (!predictedTargetTime || !desiredServeTime) {
    return { varianceMinutes: null, status: 'unknown' };
  }
  
  const variance = minutesBetween(desiredServeTime, predictedTargetTime);
  
  // Default threshold is 10 minutes
  const threshold = 10;
  
  let status;
  if (variance < -threshold) {
    status = 'early';
  } else if (variance > threshold) {
    status = 'late';
  } else {
    status = 'on-track';
  }
  
  return {
    varianceMinutes: Math.round(variance),
    status
  };
}

/**
 * Calculate schedule variance with configurable threshold
 */
export function calculateScheduleVarianceWithThreshold(predictedTargetTime, desiredServeTime, thresholdMinutes) {
  if (!predictedTargetTime || !desiredServeTime) {
    return { varianceMinutes: null, status: 'unknown' };
  }
  
  const variance = minutesBetween(desiredServeTime, predictedTargetTime);
  
  let status;
  if (variance < -thresholdMinutes) {
    status = 'early';
  } else if (variance > thresholdMinutes) {
    status = 'late';
  } else {
    status = 'on-track';
  }
  
  return {
    varianceMinutes: Math.round(variance),
    status
  };
}

/**
 * Assess confidence level of predictions based on data quality
 * 
 * @param {Object} params
 * @param {number} params.readingCount - Number of readings
 * @param {number} params.timeSpanMinutes - Time span of readings
 * @param {number} params.r2 - R² value from rate calculation
 * @param {number} params.rate - Calculated heating rate
 * @returns {{level: 'high'|'medium'|'low'|'insufficient', reason: string}}
 */
export function assessConfidence({ readingCount, timeSpanMinutes, r2, rate }) {
  // Insufficient data
  if (readingCount < 2) {
    return {
      level: 'insufficient',
      reason: 'Need at least 2 readings to calculate rate'
    };
  }
  
  if (readingCount < 3) {
    return {
      level: 'low',
      reason: 'Only 2 readings available; predictions may be inaccurate'
    };
  }
  
  // Check for unreliable rate
  if (rate !== null && rate <= CALCULATION_THRESHOLDS.MIN_RATE_FOR_PREDICTION) {
    return {
      level: 'low',
      reason: 'Heating rate is very slow or negative; check thermometer placement'
    };
  }
  
  // Check time span
  if (timeSpanMinutes < 15) {
    return {
      level: 'low',
      reason: 'Readings span less than 15 minutes; wait for more data'
    };
  }
  
  // Check data fit quality
  if (r2 < 0.7) {
    return {
      level: 'low',
      reason: 'Temperature readings are fluctuating; predictions may be unstable'
    };
  }
  
  if (r2 < 0.9) {
    return {
      level: 'medium',
      reason: 'Good data quality with moderate variation'
    };
  }
  
  // High confidence conditions
  if (readingCount >= 4 && timeSpanMinutes >= 30 && r2 >= 0.9) {
    return {
      level: 'high',
      reason: 'Strong data quality with consistent heating pattern'
    };
  }
  
  return {
    level: 'medium',
    reason: 'Adequate data for reasonable predictions'
  };
}

/**
 * Compute all calculations for the current session state
 * This is the main entry point that combines all calculation functions
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {number} params.targetTemp
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @returns {CalculationResult}
 */
export function computeSessionCalculations({ readings, targetTemp, desiredServeTime, settings }) {
  // Handle empty or insufficient readings
  if (readings.length === 0) {
    return {
      currentRate: null,
      averageRate: null,
      predictedMinutesToTarget: null,
      predictedTargetTime: null,
      scheduleVarianceMinutes: null,
      scheduleStatus: 'unknown',
      confidence: { level: 'insufficient', reason: 'No readings recorded yet' }
    };
  }
  
  const currentTemp = readings[readings.length - 1].temp;
  const timeSpan = calculateReadingSpanMinutes(readings);
  
  // Calculate rates
  const rateResult = calculateHeatingRate(readings, settings.smoothingWindowReadings);
  const averageRate = calculateAverageRate(readings);
  
  // Assess confidence
  const confidence = assessConfidence({
    readingCount: readings.length,
    timeSpanMinutes: timeSpan,
    r2: rateResult.r2,
    rate: rateResult.rate
  });
  
  // Predict time to target
  const prediction = predictTimeToTarget(currentTemp, targetTemp, rateResult.rate);
  
  // Calculate schedule variance if serve time is set
  let scheduleVariance = { varianceMinutes: null, status: 'unknown' };
  if (desiredServeTime && prediction.targetTime) {
    scheduleVariance = calculateScheduleVarianceWithThreshold(
      prediction.targetTime,
      desiredServeTime,
      settings.onTrackThresholdMinutes
    );
  }
  
  return {
    currentRate: rateResult.rate,
    averageRate,
    predictedMinutesToTarget: prediction.minutes,
    predictedTargetTime: prediction.targetTime,
    scheduleVarianceMinutes: scheduleVariance.varianceMinutes,
    scheduleStatus: scheduleVariance.status,
    confidence
  };
}
```

---

## Task 4.2: Calculations Composable

### Description

Create a Vue composable that wraps the calculation service and provides reactive computed properties that automatically update when session data changes.

### File: /src/composables/useCalculations.js

```javascript
import { computed } from 'vue';
import { useSession } from './useSession.js';
import { computeSessionCalculations } from '../services/calculationService.js';
import { toDisplayUnit, convertRate, formatRate } from '../utils/temperatureUtils.js';
import { formatDuration, formatTime } from '../utils/timeUtils.js';

export function useCalculations() {
  const { readings, config, settings, displayUnits } = useSession();
  
  /**
   * Raw calculation results (internal units)
   */
  const rawCalculations = computed(() => {
    if (!config.value) {
      return null;
    }
    
    return computeSessionCalculations({
      readings: readings.value,
      targetTemp: config.value.targetTemp,
      desiredServeTime: config.value.desiredServeTime,
      settings: settings.value
    });
  });
  
  /**
   * Current heating rate in display units
   */
  const currentRate = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw === null) return null;
    return convertRate(raw, displayUnits.value);
  });
  
  /**
   * Formatted current rate string
   */
  const currentRateFormatted = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw === null) return '--';
    return formatRate(raw, displayUnits.value);
  });
  
  /**
   * Average session rate in display units
   */
  const averageRate = computed(() => {
    const raw = rawCalculations.value?.averageRate;
    if (raw === null) return null;
    return convertRate(raw, displayUnits.value);
  });
  
  /**
   * Predicted minutes until target is reached
   */
  const predictedMinutes = computed(() => {
    return rawCalculations.value?.predictedMinutesToTarget ?? null;
  });
  
  /**
   * Formatted time remaining string
   */
  const timeRemainingFormatted = computed(() => {
    const minutes = predictedMinutes.value;
    if (minutes === null) return '--';
    if (minutes <= 0) return 'Target reached';
    return formatDuration(minutes);
  });
  
  /**
   * Predicted target completion time (ISO string)
   */
  const predictedTargetTime = computed(() => {
    return rawCalculations.value?.predictedTargetTime ?? null;
  });
  
  /**
   * Formatted predicted completion time
   */
  const predictedTargetTimeFormatted = computed(() => {
    const time = predictedTargetTime.value;
    if (!time) return '--';
    return formatTime(time);
  });
  
  /**
   * Schedule variance in minutes (positive = late, negative = early)
   */
  const scheduleVariance = computed(() => {
    return rawCalculations.value?.scheduleVarianceMinutes ?? null;
  });
  
  /**
   * Formatted schedule variance string
   */
  const scheduleVarianceFormatted = computed(() => {
    const variance = scheduleVariance.value;
    if (variance === null) return '--';
    if (Math.abs(variance) < 1) return 'On time';
    
    const absVariance = Math.abs(variance);
    const formatted = formatDuration(absVariance);
    
    if (variance > 0) {
      return `${formatted} late`;
    } else {
      return `${formatted} early`;
    }
  });
  
  /**
   * Schedule status enum
   */
  const scheduleStatus = computed(() => {
    return rawCalculations.value?.scheduleStatus ?? 'unknown';
  });
  
  /**
   * Confidence assessment
   */
  const confidence = computed(() => {
    return rawCalculations.value?.confidence ?? { level: 'insufficient', reason: 'No data' };
  });
  
  /**
   * Whether we have enough data to show predictions
   */
  const canPredict = computed(() => {
    const level = confidence.value.level;
    return level === 'high' || level === 'medium' || level === 'low';
  });
  
  /**
   * Current internal temperature (from most recent reading)
   */
  const currentTemp = computed(() => {
    if (readings.value.length === 0) return null;
    return readings.value[readings.value.length - 1].temp;
  });
  
  /**
   * Current temperature in display units
   */
  const currentTempDisplay = computed(() => {
    if (currentTemp.value === null) return null;
    return toDisplayUnit(currentTemp.value, displayUnits.value);
  });
  
  /**
   * Target temperature in display units
   */
  const targetTempDisplay = computed(() => {
    if (!config.value) return null;
    return toDisplayUnit(config.value.targetTemp, displayUnits.value);
  });
  
  /**
   * Progress percentage toward target (0-100)
   */
  const progressPercent = computed(() => {
    if (currentTemp.value === null || !config.value) return 0;
    
    const startTemp = config.value.startingTemp ?? 
      (readings.value.length > 0 ? readings.value[0].temp : currentTemp.value);
    const target = config.value.targetTemp;
    
    if (target <= startTemp) return 100;
    
    const progress = (currentTemp.value - startTemp) / (target - startTemp);
    return Math.min(100, Math.max(0, Math.round(progress * 100)));
  });
  
  /**
   * Whether target has been reached
   */
  const targetReached = computed(() => {
    if (currentTemp.value === null || !config.value) return false;
    return currentTemp.value >= config.value.targetTemp;
  });
  
  return {
    // Raw values
    currentRate,
    averageRate,
    predictedMinutes,
    predictedTargetTime,
    scheduleVariance,
    scheduleStatus,
    confidence,
    currentTemp,
    progressPercent,
    targetReached,
    canPredict,
    
    // Display values
    currentRateFormatted,
    timeRemainingFormatted,
    predictedTargetTimeFormatted,
    scheduleVarianceFormatted,
    currentTempDisplay,
    targetTempDisplay
  };
}
```

---

## Task 4.3: Status Cards Component

### Description

Create the status cards component that displays key metrics at a glance. This is the primary dashboard element showing current state and predictions.

### File: /src/components/StatusCards.vue

### Template Structure

The component renders a grid of status cards. On mobile, display cards in a 2-column grid. On wider screens, display in a single row with 4-5 cards.

Each card has a consistent structure containing a label at the top in small muted text, the primary value in large bold text, and optional secondary information in smaller text below the value.

The cards to display are as follows:

**Card 1: Current Internal Temperature**

The label is "Internal Temp". The value displays the most recent reading in large text (e.g., "118°F"). Secondary text shows time since last reading: "Updated 5 min ago". If no readings exist, show "--" as the value and "No readings" as secondary text.

**Card 2: Target Temperature**

The label is "Target". The value shows the target temperature (e.g., "125°F"). Secondary text shows progress percentage: "94% complete". Apply a subtle progress bar background to visually indicate completion.

**Card 3: Current Oven Setting**

The label is "Oven Set". The value shows the current oven temperature (e.g., "200°F"). Secondary text shows how long at this setting: "For 2h 15m". If oven has not been updated recently (based on settings.ovenTempStaleMinutes), show a warning indicator.

**Card 4: Time Remaining / ETA**

The label is "ETA" when showing a time, or "Time Left" when showing duration. The value shows either the predicted completion time (e.g., "3:45 PM") or time remaining (e.g., "1h 23m"). Toggle between these displays on tap, with a small swap icon. Secondary text shows the schedule status indicator when a serve time is set.

**Card 5: Status Indicator (conditional)**

This card only appears when a desired serve time is set. The label is "Status". The value shows "On Track", "Running Early", or "Running Late" with appropriate color coding. Secondary text shows the variance: "12 min early" or "25 min late".

### Implementation

```javascript
<template>
  <div class="px-4 py-3">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <!-- Current Temp Card -->
      <StatusCard
        label="Internal Temp"
        :value="currentTempDisplay !== null ? `${currentTempDisplay}°${displayUnits}` : '--'"
        :secondary="lastReadingAgo"
        :status="getInternalTempStatus()"
      />
      
      <!-- Target Card -->
      <StatusCard
        label="Target"
        :value="`${targetTempDisplay}°${displayUnits}`"
        :secondary="`${progressPercent}% complete`"
        :progress="progressPercent"
      />
      
      <!-- Oven Card -->
      <StatusCard
        label="Oven Set"
        :value="currentOvenDisplay"
        :secondary="ovenDuration"
        :warning="isOvenStale"
      />
      
      <!-- ETA Card -->
      <StatusCard
        label="ETA"
        :value="predictedTargetTimeFormatted"
        :secondary="timeRemainingFormatted"
        :status="targetReached ? 'success' : null"
      />
      
      <!-- Status Card (only when serve time set) -->
      <StatusCard
        v-if="hasServeTime"
        :label="'Status'"
        :value="statusLabel"
        :secondary="scheduleVarianceFormatted"
        :status="statusCardStatus"
      />
    </div>
    
    <!-- Confidence indicator -->
    <div v-if="canPredict" class="mt-2 text-xs text-center" :class="confidenceClass">
      <span class="inline-flex items-center gap-1">
        <component :is="confidenceIcon" class="w-3 h-3" />
        {{ confidence.reason }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useCalculations } from '../composables/useCalculations.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { formatTimeAgo, formatDuration, minutesBetween } from '../utils/timeUtils.js';
import { CheckCircleIcon, AlertCircleIcon, InfoIcon } from 'lucide-vue-next';
import StatusCard from './StatusCard.vue';

const { latestReading, currentOvenTemp, ovenEvents, config, displayUnits, settings } = useSession();
const {
  currentTempDisplay,
  targetTempDisplay,
  progressPercent,
  targetReached,
  currentRateFormatted,
  timeRemainingFormatted,
  predictedTargetTimeFormatted,
  scheduleStatus,
  scheduleVarianceFormatted,
  confidence,
  canPredict
} = useCalculations();

// Computed helpers
const lastReadingAgo = computed(() => {
  if (!latestReading.value) return 'No readings';
  return `Updated ${formatTimeAgo(latestReading.value.timestamp)}`;
});

const currentOvenDisplay = computed(() => {
  if (!currentOvenTemp.value) return '--';
  return formatTemperature(currentOvenTemp.value, displayUnits.value);
});

const ovenDuration = computed(() => {
  if (ovenEvents.value.length === 0) return 'Not set';
  const lastEvent = ovenEvents.value[ovenEvents.value.length - 1];
  const minutes = minutesBetween(lastEvent.timestamp, new Date().toISOString());
  return `For ${formatDuration(minutes)}`;
});

const isOvenStale = computed(() => {
  if (ovenEvents.value.length === 0) return true;
  const lastEvent = ovenEvents.value[ovenEvents.value.length - 1];
  const minutes = minutesBetween(lastEvent.timestamp, new Date().toISOString());
  return minutes > settings.value.ovenTempStaleMinutes;
});

const hasServeTime = computed(() => {
  return config.value?.desiredServeTime !== null;
});

const statusLabel = computed(() => {
  switch (scheduleStatus.value) {
    case 'early': return 'Running Early';
    case 'late': return 'Running Late';
    case 'on-track': return 'On Track';
    default: return '--';
  }
});

const statusCardStatus = computed(() => {
  switch (scheduleStatus.value) {
    case 'early': return 'info';
    case 'late': return 'warning';
    case 'on-track': return 'success';
    default: return null;
  }
});

const confidenceClass = computed(() => {
  switch (confidence.value.level) {
    case 'high': return 'text-green-600';
    case 'medium': return 'text-amber-600';
    case 'low': return 'text-orange-600';
    default: return 'text-gray-500';
  }
});

const confidenceIcon = computed(() => {
  switch (confidence.value.level) {
    case 'high': return CheckCircleIcon;
    case 'medium': return InfoIcon;
    default: return AlertCircleIcon;
  }
});

function getInternalTempStatus() {
  if (targetReached.value) return 'success';
  if (!latestReading.value) return null;
  return null;
}
</script>
```

---

## Task 4.4: StatusCard Sub-Component

### Description

Create a reusable card component for individual status metrics.

### File: /src/components/StatusCard.vue

```javascript
<template>
  <div
    class="relative overflow-hidden rounded-xl p-3 bg-white shadow-sm border"
    :class="borderClass"
  >
    <!-- Progress background -->
    <div
      v-if="progress !== undefined"
      class="absolute inset-0 bg-green-100 transition-all duration-500"
      :style="{ width: `${progress}%` }"
    />
    
    <!-- Content -->
    <div class="relative">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {{ label }}
      </div>
      
      <div class="mt-1 text-2xl font-bold" :class="valueClass">
        {{ value }}
        <span v-if="warning" class="ml-1 text-amber-500">
          <AlertTriangleIcon class="w-4 h-4 inline" />
        </span>
      </div>
      
      <div v-if="secondary" class="mt-0.5 text-xs text-gray-500">
        {{ secondary }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { AlertTriangleIcon } from 'lucide-vue-next';

const props = defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  secondary: { type: String, default: '' },
  status: { type: String, default: null }, // 'success', 'warning', 'info', 'error'
  progress: { type: Number, default: undefined },
  warning: { type: Boolean, default: false }
});

const borderClass = computed(() => {
  switch (props.status) {
    case 'success': return 'border-green-300';
    case 'warning': return 'border-amber-300';
    case 'info': return 'border-blue-300';
    case 'error': return 'border-red-300';
    default: return 'border-gray-200';
  }
});

const valueClass = computed(() => {
  switch (props.status) {
    case 'success': return 'text-green-700';
    case 'warning': return 'text-amber-700';
    case 'info': return 'text-blue-700';
    case 'error': return 'text-red-700';
    default: return 'text-gray-900';
  }
});
</script>
```

---

## Task 4.5: Auto-Refresh Timer

### Description

Implement a timer system that periodically updates time-based displays (like "5 min ago") without requiring user interaction.

### File: /src/composables/useRefreshTimer.js

```javascript
import { ref, onMounted, onUnmounted } from 'vue';

const tick = ref(0);
let intervalId = null;
let subscriberCount = 0;

/**
 * Composable that provides a reactive tick value that updates periodically.
 * Components can depend on this to trigger re-renders for time-based displays.
 * 
 * @param {number} intervalMs - Update interval in milliseconds (default 30 seconds)
 */
export function useRefreshTimer(intervalMs = 30000) {
  onMounted(() => {
    subscriberCount++;
    
    // Start the interval if this is the first subscriber
    if (subscriberCount === 1) {
      intervalId = setInterval(() => {
        tick.value++;
      }, intervalMs);
    }
  });
  
  onUnmounted(() => {
    subscriberCount--;
    
    // Stop the interval if no more subscribers
    if (subscriberCount === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
  
  return { tick };
}
```

Use this composable in StatusCards to ensure time-relative displays update:

```javascript
// In StatusCards.vue
import { useRefreshTimer } from '../composables/useRefreshTimer.js';

const { tick } = useRefreshTimer(30000); // Update every 30 seconds

// Make computed properties depend on tick to trigger re-evaluation
const lastReadingAgo = computed(() => {
  tick.value; // Create dependency
  if (!latestReading.value) return 'No readings';
  return `Updated ${formatTimeAgo(latestReading.value.timestamp)}`;
});
```

---

## Task 4.6: Progress Ring Component (Optional Enhancement)

### Description

Create an optional visual progress ring component that provides a more engaging display of cooking progress.

### File: /src/components/ProgressRing.vue

```javascript
<template>
  <div class="relative inline-flex items-center justify-center">
    <svg :width="size" :height="size" class="transform -rotate-90">
      <!-- Background circle -->
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="trackColor"
        :stroke-width="strokeWidth"
      />
      
      <!-- Progress circle -->
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="progressColor"
        :stroke-width="strokeWidth"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        stroke-linecap="round"
        class="transition-all duration-500"
      />
    </svg>
    
    <!-- Center content -->
    <div class="absolute inset-0 flex items-center justify-center">
      <slot>
        <span class="text-lg font-bold">{{ percent }}%</span>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  percent: { type: Number, required: true, default: 0 },
  size: { type: Number, default: 120 },
  strokeWidth: { type: Number, default: 8 },
  trackColor: { type: String, default: '#e5e7eb' },
  progressColor: { type: String, default: '#22c55e' }
});

const radius = computed(() => (props.size - props.strokeWidth) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashOffset = computed(() => {
  const progress = Math.min(100, Math.max(0, props.percent)) / 100;
  return circumference.value * (1 - progress);
});
</script>
```

---

## Task 4.7: Calculation Testing Suite

### Description

Create a comprehensive test suite for the calculation service to ensure accuracy of all mathematical functions.

### File: /src/services/calculationService.test.js

This file should contain unit tests for all exported functions. The tests should cover edge cases including empty readings arrays, single readings, negative rates, and boundary conditions.

Test cases to implement include checking that calculateHeatingRate returns null with fewer than 2 readings, verifying that the rate calculation produces accurate results for known linear data, testing that predictTimeToTarget returns 0 minutes when current temp exceeds target, confirming that schedule variance correctly identifies early, late, and on-track states, and validating that confidence assessment correctly categorizes data quality scenarios.

```javascript
// Example test structure (using Vitest or Jest)
import { describe, it, expect } from 'vitest';
import {
  calculateHeatingRate,
  calculateAverageRate,
  predictTimeToTarget,
  calculateScheduleVariance,
  assessConfidence
} from './calculationService.js';

describe('calculateHeatingRate', () => {
  it('returns null when fewer than 2 readings provided', () => {
    const result = calculateHeatingRate([]);
    expect(result.rate).toBeNull();
    
    const result2 = calculateHeatingRate([{ temp: 100, timestamp: '2024-01-01T12:00:00Z' }]);
    expect(result2.rate).toBeNull();
  });
  
  it('calculates correct rate for linear temperature increase', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T13:00:00Z' },
      { temp: 110, timestamp: '2024-01-01T14:00:00Z' }
    ];
    
    const result = calculateHeatingRate(readings);
    expect(result.rate).toBe(5); // 5°F per hour
    expect(result.r2).toBeCloseTo(1, 2); // Perfect linear fit
  });
  
  it('handles readings taken at same time gracefully', () => {
    const readings = [
      { temp: 100, timestamp: '2024-01-01T12:00:00Z' },
      { temp: 105, timestamp: '2024-01-01T12:00:00Z' }
    ];
    
    const result = calculateHeatingRate(readings);
    expect(result.rate).toBeNull();
  });
});

describe('predictTimeToTarget', () => {
  it('returns 0 minutes when target already reached', () => {
    const result = predictTimeToTarget(130, 125, 5);
    expect(result.minutes).toBe(0);
  });
  
  it('returns null when rate is zero or negative', () => {
    const result = predictTimeToTarget(100, 125, 0);
    expect(result.minutes).toBeNull();
    
    const result2 = predictTimeToTarget(100, 125, -2);
    expect(result2.minutes).toBeNull();
  });
  
  it('calculates correct time for positive rate', () => {
    const result = predictTimeToTarget(100, 125, 5); // 25°F to go at 5°F/hr
    expect(result.minutes).toBe(300); // 5 hours = 300 minutes
  });
});

describe('assessConfidence', () => {
  it('returns insufficient when fewer than 2 readings', () => {
    const result = assessConfidence({ readingCount: 1, timeSpanMinutes: 0, r2: 0, rate: null });
    expect(result.level).toBe('insufficient');
  });
  
  it('returns high confidence for ideal conditions', () => {
    const result = assessConfidence({ readingCount: 5, timeSpanMinutes: 60, r2: 0.95, rate: 5 });
    expect(result.level).toBe('high');
  });
  
  it('returns low confidence for unstable data', () => {
    const result = assessConfidence({ readingCount: 5, timeSpanMinutes: 60, r2: 0.5, rate: 5 });
    expect(result.level).toBe('low');
    expect(result.reason).toContain('fluctuating');
  });
});
```

---

## Phase 4 Completion Checklist

Before proceeding to Phase 5, verify the following:

1. **Rate calculation accuracy**: Add several readings with known temperature changes over known time spans. Verify the calculated rate matches expected values (e.g., +10°F over 2 hours should show 5°F/hr).

2. **ETA prediction accuracy**: With a known rate and remaining temperature gap, verify the predicted completion time is mathematically correct.

3. **Status cards update in real-time**: Add a new reading and verify all relevant cards update immediately without page refresh.

4. **Progress percentage is accurate**: If starting at 100°F targeting 125°F, a current reading of 112.5°F should show 50% progress.

5. **Schedule status works**: Set a serve time and verify the status correctly shows early/late/on-track based on predicted completion time.

6. **Confidence levels are sensible**: Verify low confidence with few readings, medium with adequate data, and high with substantial consistent data.

7. **Time-relative displays update**: Wait for the refresh interval and verify "X min ago" displays update without interaction.

8. **Unit conversion is consistent**: Toggle between °F and °C and verify all displayed values convert correctly.

9. **Edge cases handled**: Test with no readings, single reading, negative rate scenarios, and verify graceful handling without crashes.

10. **Oven stale warning appears**: Wait for the configured stale period without updating oven temp and verify warning indicator appears.

---

## Dependencies for Next Phase

Phase 5 (Charting & Visualization) will depend on:
- useCalculations composable for prediction data
- readings and ovenEvents arrays for chart data
- predictedTargetTime for projection line endpoint
- targetTemp for target line
- Temperature conversion utilities for axis labels
