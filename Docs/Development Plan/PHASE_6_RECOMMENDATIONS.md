# Phase 6: Recommendation Engine

## Phase Objectives

Implement the intelligent recommendation system that analyzes cooking progress, schedule variance, and oven temperature history to provide actionable guidance on oven temperature adjustments. This phase creates the core value proposition of the application by helping users make informed decisions about whether to raise, lower, or maintain their oven temperature.

## Prerequisites

Phase 5 must be complete, providing charting capabilities and the calculation infrastructure.

## Deliverables

1. Recommendation service with heuristic-based logic
2. useRecommendations composable for reactive recommendation state
3. RecommendationPanel component with clear actionable guidance
4. Confidence gating system to prevent premature recommendations
5. Safety guardrails for temperature bounds
6. Optional: Learning system for oven responsiveness (nice-to-have)

---

## Task 6.1: Recommendation Service Implementation

### Description

Create the core recommendation service that analyzes session state and produces actionable oven temperature adjustment recommendations. This service implements the heuristic rules defined in the requirements.

### File: /src/services/recommendationService.js

```javascript
import { minutesBetween, isWithinMinutes } from '../utils/timeUtils.js';
import { RECOMMENDATION_MESSAGES, SETTINGS_DEFAULTS } from '../constants/defaults.js';

/**
 * Determine if conditions allow making a recommendation
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @param {Object} params.confidence - Confidence assessment from calculation service
 * @returns {{canRecommend: boolean, blockerReason: string|null, blockerType: string|null}}
 */
export function checkRecommendationEligibility({
  readings,
  ovenEvents,
  desiredServeTime,
  settings,
  confidence
}) {
  // Check minimum readings requirement
  if (readings.length < settings.minReadingsForRecommendation) {
    const needed = settings.minReadingsForRecommendation - readings.length;
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_READINGS.replace('{count}', settings.minReadingsForRecommendation),
      blockerType: 'insufficient_readings',
      progress: {
        current: readings.length,
        required: settings.minReadingsForRecommendation,
        message: `${needed} more reading${needed > 1 ? 's' : ''} needed`
      }
    };
  }
  
  // Check time span requirement
  const timeSpan = readings.length >= 2 
    ? minutesBetween(readings[0].timestamp, readings[readings.length - 1].timestamp)
    : 0;
  
  if (timeSpan < settings.minTimeSpanMinutes) {
    const needed = Math.ceil(settings.minTimeSpanMinutes - timeSpan);
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_TIME.replace('{minutes}', settings.minTimeSpanMinutes),
      blockerType: 'insufficient_time',
      progress: {
        current: Math.round(timeSpan),
        required: settings.minTimeSpanMinutes,
        message: `~${needed} more minutes of data needed`
      }
    };
  }
  
  // Check for recent oven temperature data
  if (ovenEvents.length === 0) {
    return {
      canRecommend: false,
      blockerReason: 'No oven temperature recorded. Please log your current oven setting.',
      blockerType: 'no_oven_data',
      progress: null
    };
  }
  
  const lastOvenEvent = ovenEvents[ovenEvents.length - 1];
  const ovenDataAge = minutesBetween(lastOvenEvent.timestamp, new Date().toISOString());
  
  if (ovenDataAge > settings.ovenTempStaleMinutes) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.OVEN_TEMP_STALE,
      blockerType: 'stale_oven_data',
      progress: {
        current: Math.round(ovenDataAge),
        required: settings.ovenTempStaleMinutes,
        message: 'Please confirm your current oven setting'
      }
    };
  }
  
  // Check confidence level
  if (confidence.level === 'insufficient') {
    return {
      canRecommend: false,
      blockerReason: confidence.reason,
      blockerType: 'insufficient_confidence',
      progress: null
    };
  }
  
  // Check for desired serve time (required for timing recommendations)
  if (!desiredServeTime) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NO_SERVE_TIME,
      blockerType: 'no_serve_time',
      progress: null
    };
  }
  
  // Check for problematic rate
  if (confidence.level === 'low' && confidence.reason.includes('slow or negative')) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.RATE_TOO_LOW,
      blockerType: 'bad_rate',
      progress: null
    };
  }
  
  if (confidence.level === 'low' && confidence.reason.includes('fluctuating')) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.RATE_UNSTABLE,
      blockerType: 'unstable_rate',
      progress: null
    };
  }
  
  return {
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null
  };
}

/**
 * Calculate the recommended oven temperature adjustment
 * 
 * @param {Object} params
 * @param {number} params.currentOvenTemp - Current oven set temperature (°F)
 * @param {number} params.scheduleVarianceMinutes - Positive = late, negative = early
 * @param {'early'|'late'|'on-track'} params.scheduleStatus
 * @param {AppSettings} params.settings
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  currentOvenTemp,
  scheduleVarianceMinutes,
  scheduleStatus,
  settings
}) {
  const {
    recommendationStepF,
    recommendationMaxStepF,
    ovenTempMinF,
    ovenTempMaxF,
    onTrackThresholdMinutes
  } = settings;
  
  // On track - recommend holding steady
  if (scheduleStatus === 'on-track') {
    return {
      action: 'hold',
      suggestedTemp: currentOvenTemp,
      changeAmount: 0,
      message: formatMessage(RECOMMENDATION_MESSAGES.HOLD, { ovenTemp: currentOvenTemp }),
      reasoning: `Predicted to finish within ${onTrackThresholdMinutes} minutes of your target time.`,
      severity: 'normal'
    };
  }
  
  // Running late - suggest raising temperature
  if (scheduleStatus === 'late') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how late
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very late - suggest larger increase
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'urgent';
    } else if (absVariance > 15) {
      // Moderately late
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'moderate';
    } else {
      // Slightly late
      changeAmount = recommendationStepF;
      severity = 'normal';
    }
    
    // Calculate suggested temperature
    let suggestedTemp = currentOvenTemp + changeAmount;
    
    // Apply upper bound guardrail
    if (suggestedTemp > ovenTempMaxF) {
      suggestedTemp = ovenTempMaxF;
      changeAmount = suggestedTemp - currentOvenTemp;
      
      // If already at max, can't recommend higher
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: currentOvenTemp,
          changeAmount: 0,
          message: `Already at maximum recommended temperature (${ovenTempMaxF}°F). Consider extending your timeline if possible.`,
          reasoning: `Running ${Math.round(absVariance)} minutes late, but oven is already at the upper limit for low-and-slow cooking.`,
          severity: 'warning'
        };
      }
    }
    
    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.RAISE_LARGE 
      : RECOMMENDATION_MESSAGES.RAISE_SMALL;
    
    return {
      action: 'raise',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: formatMessage(messageTemplate, { suggestedTemp: Math.round(suggestedTemp) }),
      reasoning: `Running approximately ${Math.round(absVariance)} minutes late. Increasing oven temperature will speed up heating.`,
      severity
    };
  }
  
  // Running early - suggest lowering temperature
  if (scheduleStatus === 'early') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how early
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very early - suggest larger decrease
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'moderate';
    } else if (absVariance > 15) {
      // Moderately early
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'normal';
    } else {
      // Slightly early
      changeAmount = recommendationStepF;
      severity: 'normal';
    }
    
    // Calculate suggested temperature
    let suggestedTemp = currentOvenTemp - changeAmount;
    
    // Apply lower bound guardrail
    if (suggestedTemp < ovenTempMinF) {
      suggestedTemp = ovenTempMinF;
      changeAmount = currentOvenTemp - suggestedTemp;
      
      // If already at min, can't recommend lower
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: currentOvenTemp,
          changeAmount: 0,
          message: `Already at minimum recommended temperature (${ovenTempMinF}°F). You may finish early.`,
          reasoning: `Running ${Math.round(absVariance)} minutes early, but oven is already at the lower limit for food safety.`,
          severity: 'info'
        };
      }
    }
    
    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.LOWER_LARGE 
      : RECOMMENDATION_MESSAGES.LOWER_SMALL;
    
    return {
      action: 'lower',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: formatMessage(messageTemplate, { suggestedTemp: Math.round(suggestedTemp) }),
      reasoning: `Running approximately ${Math.round(absVariance)} minutes early. Lowering oven temperature will slow down heating.`,
      severity
    };
  }
  
  // Unknown status - no recommendation
  return {
    action: 'none',
    suggestedTemp: null,
    changeAmount: null,
    message: 'Unable to determine schedule status.',
    reasoning: 'Insufficient data to calculate timing.',
    severity: 'unknown'
  };
}

/**
 * Generate the full recommendation result including eligibility check
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {number} params.currentOvenTemp - Current oven temp in °F
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  currentOvenTemp,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings
}) {
  // First check eligibility
  const eligibility = checkRecommendationEligibility({
    readings,
    ovenEvents,
    desiredServeTime,
    settings,
    confidence
  });
  
  if (!eligibility.canRecommend) {
    return {
      action: 'none',
      suggestedTemp: null,
      changeAmount: null,
      message: null,
      reasoning: null,
      canRecommend: false,
      blockerReason: eligibility.blockerReason,
      blockerType: eligibility.blockerType,
      progress: eligibility.progress
    };
  }
  
  // Calculate the recommendation
  const recommendation = calculateRecommendation({
    currentOvenTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings
  });
  
  return {
    ...recommendation,
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null
  };
}

/**
 * Format a message template with variable substitution
 * @param {string} template
 * @param {Object} variables
 * @returns {string}
 */
function formatMessage(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
}

/**
 * Analyze how oven temperature changes have affected heating rate (nice-to-have)
 * This provides feedback on observed responsiveness
 * 
 * @param {InternalReading[]} readings
 * @param {OvenTempEvent[]} ovenEvents
 * @returns {Object|null} Responsiveness analysis or null if insufficient data
 */
export function analyzeOvenResponsiveness(readings, ovenEvents) {
  if (ovenEvents.length < 2 || readings.length < 5) {
    return null;
  }
  
  const segments = [];
  
  // Analyze each oven temperature segment
  for (let i = 0; i < ovenEvents.length; i++) {
    const segmentStart = new Date(ovenEvents[i].timestamp);
    const segmentEnd = i < ovenEvents.length - 1 
      ? new Date(ovenEvents[i + 1].timestamp)
      : new Date();
    
    // Find readings within this segment (with some delay for thermal lag)
    const lagMinutes = 15; // Thermal lag before oven change affects meat
    const effectiveStart = new Date(segmentStart.getTime() + lagMinutes * 60 * 1000);
    
    const segmentReadings = readings.filter(r => {
      const time = new Date(r.timestamp);
      return time >= effectiveStart && time < segmentEnd;
    });
    
    if (segmentReadings.length >= 2) {
      const first = segmentReadings[0];
      const last = segmentReadings[segmentReadings.length - 1];
      const hours = minutesBetween(first.timestamp, last.timestamp) / 60;
      
      if (hours > 0.1) {
        const rate = (last.temp - first.temp) / hours;
        segments.push({
          ovenTemp: ovenEvents[i].setTemp,
          heatingRate: rate,
          duration: minutesBetween(ovenEvents[i].timestamp, segmentEnd.toISOString()),
          readingCount: segmentReadings.length
        });
      }
    }
  }
  
  if (segments.length < 2) {
    return null;
  }
  
  // Calculate correlation between oven temp and heating rate
  const correlation = calculateCorrelation(
    segments.map(s => s.ovenTemp),
    segments.map(s => s.heatingRate)
  );
  
  // Estimate rate change per degree of oven change
  const ovenTemps = segments.map(s => s.ovenTemp);
  const rates = segments.map(s => s.heatingRate);
  const ovenRange = Math.max(...ovenTemps) - Math.min(...ovenTemps);
  const rateRange = Math.max(...rates) - Math.min(...rates);
  
  const responsiveness = ovenRange > 0 ? rateRange / ovenRange : 0;
  
  return {
    segments,
    correlation,
    responsiveness, // °F/hr change per °F oven change
    description: generateResponsivenessDescription(responsiveness, correlation)
  };
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Generate human-readable description of oven responsiveness
 */
function generateResponsivenessDescription(responsiveness, correlation) {
  if (correlation < 0.3) {
    return 'Oven temperature changes have had limited observable effect on heating rate so far.';
  }
  
  if (responsiveness > 0.1) {
    return `Higher oven temperatures have increased heating rate. Each +25°F oven increase has added roughly +${(responsiveness * 25).toFixed(1)}°F/hr to the heating rate.`;
  }
  
  return 'Moderate correlation between oven temperature and heating rate observed.';
}
```

---

## Task 6.2: Recommendations Composable

### Description

Create a Vue composable that provides reactive access to recommendation state, automatically updating when session data changes.

### File: /src/composables/useRecommendations.js

```javascript
import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { generateRecommendation, analyzeOvenResponsiveness } from '../services/recommendationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

export function useRecommendations() {
  const { readings, ovenEvents, currentOvenTemp, config, settings, displayUnits } = useSession();
  const { scheduleVariance, scheduleStatus, confidence } = useCalculations();
  
  /**
   * Raw recommendation result (internal units)
   */
  const rawRecommendation = computed(() => {
    if (!config.value || currentOvenTemp.value === null) {
      return {
        action: 'none',
        canRecommend: false,
        blockerReason: 'No active session',
        blockerType: 'no_session'
      };
    }
    
    return generateRecommendation({
      readings: readings.value,
      ovenEvents: ovenEvents.value,
      currentOvenTemp: currentOvenTemp.value,
      desiredServeTime: config.value.desiredServeTime,
      scheduleVarianceMinutes: scheduleVariance.value,
      scheduleStatus: scheduleStatus.value,
      confidence: confidence.value,
      settings: settings.value
    });
  });
  
  /**
   * Whether a recommendation can be made
   */
  const canRecommend = computed(() => rawRecommendation.value.canRecommend);
  
  /**
   * The recommended action
   */
  const action = computed(() => rawRecommendation.value.action);
  
  /**
   * Suggested oven temperature in display units
   */
  const suggestedTemp = computed(() => {
    if (rawRecommendation.value.suggestedTemp === null) return null;
    return toDisplayUnit(rawRecommendation.value.suggestedTemp, displayUnits.value);
  });
  
  /**
   * Formatted suggested temperature with unit
   */
  const suggestedTempFormatted = computed(() => {
    if (rawRecommendation.value.suggestedTemp === null) return null;
    return formatTemperature(rawRecommendation.value.suggestedTemp, displayUnits.value);
  });
  
  /**
   * Change amount in display units
   */
  const changeAmount = computed(() => {
    if (rawRecommendation.value.changeAmount === null) return null;
    // Delta conversion (no 32 offset)
    if (displayUnits.value === 'C') {
      return Math.round((rawRecommendation.value.changeAmount * 5 / 9) * 10) / 10;
    }
    return rawRecommendation.value.changeAmount;
  });
  
  /**
   * Formatted change amount with sign and unit
   */
  const changeAmountFormatted = computed(() => {
    if (changeAmount.value === null || changeAmount.value === 0) return null;
    const sign = rawRecommendation.value.action === 'raise' ? '+' : '-';
    return `${sign}${Math.abs(changeAmount.value)}°${displayUnits.value}`;
  });
  
  /**
   * Primary recommendation message
   */
  const message = computed(() => rawRecommendation.value.message);
  
  /**
   * Detailed reasoning for the recommendation
   */
  const reasoning = computed(() => rawRecommendation.value.reasoning);
  
  /**
   * Reason why recommendation cannot be made
   */
  const blockerReason = computed(() => rawRecommendation.value.blockerReason);
  
  /**
   * Type of blocker for UI customization
   */
  const blockerType = computed(() => rawRecommendation.value.blockerType);
  
  /**
   * Progress toward being able to recommend
   */
  const blockerProgress = computed(() => rawRecommendation.value.progress);
  
  /**
   * Severity level for styling
   */
  const severity = computed(() => rawRecommendation.value.severity || 'normal');
  
  /**
   * Oven responsiveness analysis (optional feature)
   */
  const responsiveness = computed(() => {
    return analyzeOvenResponsiveness(readings.value, ovenEvents.value);
  });
  
  /**
   * Whether responsiveness data is available
   */
  const hasResponsivenessData = computed(() => responsiveness.value !== null);
  
  return {
    // Core recommendation
    canRecommend,
    action,
    suggestedTemp,
    suggestedTempFormatted,
    changeAmount,
    changeAmountFormatted,
    message,
    reasoning,
    severity,
    
    // Blocker info
    blockerReason,
    blockerType,
    blockerProgress,
    
    // Advanced features
    responsiveness,
    hasResponsivenessData
  };
}
```

---

## Task 6.3: Recommendation Panel Component

### Description

Create the main recommendation display component that shows actionable guidance prominently in the UI.

### File: /src/components/RecommendationPanel.vue

```javascript
<template>
  <div class="mx-4 my-4">
    <div 
      class="rounded-xl border-2 p-4 transition-colors duration-300"
      :class="panelClasses"
    >
      <!-- Header -->
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0">
          <component :is="statusIcon" class="w-8 h-8" :class="iconClass" />
        </div>
        
        <div class="flex-1 min-w-0">
          <!-- Can recommend -->
          <template v-if="canRecommend">
            <h3 class="font-semibold text-lg" :class="textClass">
              {{ actionTitle }}
            </h3>
            
            <p class="mt-1 text-gray-700">
              {{ message }}
            </p>
            
            <!-- Temperature change visual -->
            <div v-if="action !== 'hold'" class="mt-3 flex items-center gap-3">
              <div class="text-center">
                <div class="text-xs text-gray-500 uppercase">Current</div>
                <div class="text-xl font-bold text-gray-600">
                  {{ currentOvenFormatted }}
                </div>
              </div>
              
              <ArrowRightIcon class="w-6 h-6 text-gray-400" />
              
              <div class="text-center">
                <div class="text-xs uppercase" :class="suggestedLabelClass">Suggested</div>
                <div class="text-2xl font-bold" :class="textClass">
                  {{ suggestedTempFormatted }}
                </div>
              </div>
              
              <div class="ml-2 px-2 py-1 rounded-full text-sm font-medium" :class="changeBadgeClass">
                {{ changeAmountFormatted }}
              </div>
            </div>
            
            <!-- Reasoning (collapsible) -->
            <details class="mt-3">
              <summary class="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                Why this recommendation?
              </summary>
              <p class="mt-2 text-sm text-gray-600 pl-4 border-l-2 border-gray-200">
                {{ reasoning }}
              </p>
            </details>
          </template>
          
          <!-- Cannot recommend -->
          <template v-else>
            <h3 class="font-semibold text-gray-700">
              {{ blockerTitle }}
            </h3>
            
            <p class="mt-1 text-gray-600">
              {{ blockerReason }}
            </p>
            
            <!-- Progress indicator -->
            <div v-if="blockerProgress" class="mt-3">
              <div class="flex justify-between text-xs text-gray-500 mb-1">
                <span>{{ blockerProgress.message }}</span>
                <span>{{ blockerProgress.current }}/{{ blockerProgress.required }}</span>
              </div>
              <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  class="h-full bg-blue-500 rounded-full transition-all duration-500"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
            </div>
            
            <!-- Quick action for missing data -->
            <div v-if="quickAction" class="mt-3">
              <button 
                @click="handleQuickAction"
                class="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {{ quickAction.label }} →
              </button>
            </div>
          </template>
        </div>
      </div>
      
      <!-- Disclaimer -->
      <p class="mt-4 text-xs text-gray-400 border-t pt-3">
        {{ disclaimer }}
      </p>
    </div>
    
    <!-- Oven Responsiveness (optional, collapsible) -->
    <details v-if="hasResponsivenessData" class="mt-3">
      <summary class="text-sm text-gray-500 cursor-pointer hover:text-gray-700 px-2">
        View observed oven responsiveness
      </summary>
      <div class="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
        {{ responsiveness.description }}
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useRecommendations } from '../composables/useRecommendations.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { DISCLAIMER } from '../constants/defaults.js';
import {
  CheckCircleIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  ClockIcon,
  AlertCircleIcon,
  ArrowRightIcon
} from 'lucide-vue-next';

const emit = defineEmits(['openOvenModal', 'openReadingModal']);

const { currentOvenTemp, displayUnits } = useSession();
const {
  canRecommend,
  action,
  suggestedTempFormatted,
  changeAmountFormatted,
  message,
  reasoning,
  severity,
  blockerReason,
  blockerType,
  blockerProgress,
  responsiveness,
  hasResponsivenessData
} = useRecommendations();

const disclaimer = DISCLAIMER;

// Computed display values
const currentOvenFormatted = computed(() => {
  if (currentOvenTemp.value === null) return '--';
  return formatTemperature(currentOvenTemp.value, displayUnits.value);
});

const progressPercent = computed(() => {
  if (!blockerProgress.value) return 0;
  return Math.min(100, (blockerProgress.value.current / blockerProgress.value.required) * 100);
});

// Action title based on recommendation
const actionTitle = computed(() => {
  switch (action.value) {
    case 'raise': return 'Raise Oven Temperature';
    case 'lower': return 'Lower Oven Temperature';
    case 'hold': return 'Hold Steady';
    default: return 'No Recommendation';
  }
});

// Blocker title based on blocker type
const blockerTitle = computed(() => {
  switch (blockerType.value) {
    case 'insufficient_readings': return 'Collecting Data...';
    case 'insufficient_time': return 'Gathering More Data...';
    case 'no_oven_data': return 'Oven Temperature Needed';
    case 'stale_oven_data': return 'Confirm Oven Temperature';
    case 'no_serve_time': return 'Set a Target Time';
    case 'bad_rate': return 'Check Thermometer';
    case 'unstable_rate': return 'Waiting for Stability';
    default: return 'Cannot Recommend Yet';
  }
});

// Status icon based on action/state
const statusIcon = computed(() => {
  if (!canRecommend.value) {
    return blockerType.value === 'bad_rate' ? AlertCircleIcon : ClockIcon;
  }
  switch (action.value) {
    case 'raise': return ArrowUpCircleIcon;
    case 'lower': return ArrowDownCircleIcon;
    case 'hold': return CheckCircleIcon;
    default: return ClockIcon;
  }
});

// Panel styling based on state
const panelClasses = computed(() => {
  if (!canRecommend.value) {
    return 'bg-gray-50 border-gray-200';
  }
  switch (action.value) {
    case 'raise': 
      return severity.value === 'urgent' 
        ? 'bg-red-50 border-red-300' 
        : 'bg-amber-50 border-amber-300';
    case 'lower': return 'bg-blue-50 border-blue-300';
    case 'hold': return 'bg-green-50 border-green-300';
    default: return 'bg-gray-50 border-gray-200';
  }
});

const iconClass = computed(() => {
  if (!canRecommend.value) return 'text-gray-400';
  switch (action.value) {
    case 'raise': return severity.value === 'urgent' ? 'text-red-500' : 'text-amber-500';
    case 'lower': return 'text-blue-500';
    case 'hold': return 'text-green-500';
    default: return 'text-gray-400';
  }
});

const textClass = computed(() => {
  if (!canRecommend.value) return 'text-gray-700';
  switch (action.value) {
    case 'raise': return severity.value === 'urgent' ? 'text-red-700' : 'text-amber-700';
    case 'lower': return 'text-blue-700';
    case 'hold': return 'text-green-700';
    default: return 'text-gray-700';
  }
});

const suggestedLabelClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'text-amber-600';
    case 'lower': return 'text-blue-600';
    default: return 'text-gray-500';
  }
});

const changeBadgeClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'bg-amber-100 text-amber-700';
    case 'lower': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-700';
  }
});

// Quick action for certain blocker types
const quickAction = computed(() => {
  switch (blockerType.value) {
    case 'no_oven_data':
    case 'stale_oven_data':
      return { label: 'Update oven temperature', action: 'openOvenModal' };
    case 'insufficient_readings':
      return { label: 'Add a reading', action: 'openReadingModal' };
    case 'no_serve_time':
      return { label: 'Set target time in session settings', action: 'openSettings' };
    default:
      return null;
  }
});

function handleQuickAction() {
  if (!quickAction.value) return;
  emit(quickAction.value.action);
}
</script>
```

---

## Task 6.4: One-Tap Apply Recommendation Feature

### Description

Implement a feature that allows users to quickly apply the recommended oven temperature change with a single tap, streamlining the workflow.

### Implementation in RecommendationPanel.vue

Add the following to the template when a raise or lower recommendation is shown:

```javascript
<!-- Add after the temperature change visual -->
<div v-if="action !== 'hold' && action !== 'none'" class="mt-4">
  <button
    @click="applyRecommendation"
    class="w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors"
    :class="applyButtonClass"
  >
    Apply: Set oven to {{ suggestedTempFormatted }}
  </button>
  <p class="text-xs text-gray-500 text-center mt-2">
    This will log the oven temperature change
  </p>
</div>
```

Add to script:

```javascript
import { useToast } from '../composables/useToast.js';

const { addOvenEvent } = useSession();
const { suggestedTemp } = useRecommendations();
const { showToast } = useToast();

const applyButtonClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'bg-amber-500 hover:bg-amber-600';
    case 'lower': return 'bg-blue-500 hover:bg-blue-600';
    default: return 'bg-gray-500 hover:bg-gray-600';
  }
});

function applyRecommendation() {
  if (suggestedTemp.value === null) return;
  
  addOvenEvent(suggestedTemp.value);
  
  const actionVerb = action.value === 'raise' ? 'raised' : 'lowered';
  showToast(`Oven ${actionVerb} to ${suggestedTempFormatted.value}`, 'success');
}
```

---

## Task 6.5: Recommendation History Log (Optional)

### Description

Track recommendations that were shown to the user and whether they were followed, providing data for the optional learning system.

### File: /src/services/recommendationHistoryService.js

```javascript
/**
 * @typedef {Object} RecommendationHistoryEntry
 * @property {string} id - Unique identifier
 * @property {string} timestamp - When recommendation was shown
 * @property {'raise'|'lower'|'hold'} action - Recommended action
 * @property {number} suggestedTemp - Suggested oven temperature (°F)
 * @property {number} currentOvenTemp - Oven temp when recommendation was made
 * @property {number} scheduleVariance - Minutes early/late
 * @property {boolean|null} wasFollowed - Whether user followed the recommendation
 * @property {number|null} actualChange - Actual oven change made (if any)
 * @property {string|null} followedAt - When the recommendation was acted upon
 */

const MAX_HISTORY_ENTRIES = 50;

/**
 * Add a recommendation to history
 */
export function logRecommendation(session, recommendation) {
  if (!session.recommendationHistory) {
    session.recommendationHistory = [];
  }
  
  const entry = {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    action: recommendation.action,
    suggestedTemp: recommendation.suggestedTemp,
    currentOvenTemp: recommendation.currentOvenTemp,
    scheduleVariance: recommendation.scheduleVariance,
    wasFollowed: null,
    actualChange: null,
    followedAt: null
  };
  
  session.recommendationHistory.push(entry);
  
  // Trim old entries
  if (session.recommendationHistory.length > MAX_HISTORY_ENTRIES) {
    session.recommendationHistory = session.recommendationHistory.slice(-MAX_HISTORY_ENTRIES);
  }
  
  return entry.id;
}

/**
 * Mark a recommendation as followed or ignored
 */
export function markRecommendationOutcome(session, recommendationId, wasFollowed, actualChange) {
  const entry = session.recommendationHistory?.find(e => e.id === recommendationId);
  if (entry) {
    entry.wasFollowed = wasFollowed;
    entry.actualChange = actualChange;
    entry.followedAt = new Date().toISOString();
  }
}

/**
 * Analyze how well recommendations have been working
 */
export function analyzeRecommendationEffectiveness(session) {
  const history = session.recommendationHistory || [];
  const followed = history.filter(e => e.wasFollowed === true);
  const ignored = history.filter(e => e.wasFollowed === false);
  
  return {
    totalRecommendations: history.length,
    followed: followed.length,
    ignored: ignored.length,
    followRate: history.length > 0 ? followed.length / history.length : 0
  };
}
```

---

## Phase 6 Completion Checklist

Before proceeding to Phase 7, verify the following:

1. **Eligibility gating works**: With fewer than 3 readings, verify the panel shows "Collecting Data..." with appropriate progress indicator.

2. **Time span check works**: With 3 readings taken within 10 minutes, verify it shows "Gathering More Data..." asking for more time span.

3. **Stale oven data detected**: Wait longer than the configured stale period without updating oven temp and verify the warning appears.

4. **Missing serve time handled**: Without a serve time set, verify the panel explains that setting a serve time enables timing recommendations.

5. **Hold recommendation shows correctly**: When on track, verify the panel shows "Hold Steady" with green styling and encouraging message.

6. **Raise recommendation shows correctly**: When running late, verify the panel shows "Raise Oven Temperature" with the correct suggested temperature and amber/red styling based on severity.

7. **Lower recommendation shows correctly**: When running early, verify the panel shows "Lower Oven Temperature" with blue styling.

8. **Guardrails prevent extreme suggestions**: Set oven at 290°F and run late; verify it won't suggest above the configured maximum (300°F default).

9. **Apply button works**: Tap "Apply" on a recommendation and verify an oven event is logged with the suggested temperature.

10. **Unit conversion works**: Toggle between °F and °C and verify all displayed temperatures in the recommendation panel convert correctly.

11. **Reasoning expandable**: Tap "Why this recommendation?" and verify the detailed reasoning expands.

12. **Disclaimer always visible**: Verify the safety disclaimer appears at the bottom of the panel.

---

## Dependencies for Next Phase

Phase 7 (Settings, Export & Polish) will depend on:
- All recommendation settings being configurable
- Session data structure for export
- Complete UI component set for settings panel
