<template>
  <div class="px-4 py-3">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" :class="{ 'lg:grid-cols-5': hasServeTime }">
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
        :value="targetTempDisplay !== null ? `${targetTempDisplay}°${displayUnits}` : '--'"
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
        label="Status"
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
import { useRefreshTimer } from '../composables/useRefreshTimer.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { formatTimeAgo, formatDuration, minutesBetween } from '../utils/timeUtils.js';
import StatusCard from './StatusCard.vue';

const { latestReading, currentOvenTemp, ovenEvents, config, displayUnits, settings } = useSession();
const {
  currentTempDisplay,
  targetTempDisplay,
  progressPercent,
  targetReached,
  timeRemainingFormatted,
  predictedTargetTimeFormatted,
  scheduleStatus,
  scheduleVarianceFormatted,
  confidence,
  canPredict
} = useCalculations();

// Auto-refresh timer for time-based displays
const { tick } = useRefreshTimer(30000);

// Computed helpers
const lastReadingAgo = computed(() => {
  tick.value; // Create dependency for auto-refresh
  if (!latestReading.value) return 'No readings';
  return `Updated ${formatTimeAgo(latestReading.value.timestamp)}`;
});

const currentOvenDisplay = computed(() => {
  if (!currentOvenTemp.value) return '--';
  return formatTemperature(currentOvenTemp.value, displayUnits.value);
});

const ovenDuration = computed(() => {
  tick.value; // Create dependency for auto-refresh
  if (ovenEvents.value.length === 0) return 'Not set';
  const lastEvent = ovenEvents.value[ovenEvents.value.length - 1];
  const minutes = minutesBetween(lastEvent.timestamp, new Date().toISOString());
  return `For ${formatDuration(minutes)}`;
});

const isOvenStale = computed(() => {
  tick.value; // Create dependency for auto-refresh
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
    case 'high': return 'text-green-600 dark:text-green-400';
    case 'medium': return 'text-amber-600 dark:text-amber-400';
    case 'low': return 'text-orange-600 dark:text-orange-400';
    default: return 'text-gray-500 dark:text-gray-400';
  }
});

const confidenceIcon = computed(() => {
  // Return SVG component names
  switch (confidence.value.level) {
    case 'high': return 'CheckCircleIcon';
    case 'medium': return 'InfoIcon';
    default: return 'AlertCircleIcon';
  }
});

function getInternalTempStatus() {
  if (targetReached.value) return 'success';
  if (!latestReading.value) return null;
  return null;
}
</script>

<script>
// Icon components using inline SVG
const CheckCircleIcon = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  `
};

const InfoIcon = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  `
};

const AlertCircleIcon = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  `
};

export default {
  components: {
    CheckCircleIcon,
    InfoIcon,
    AlertCircleIcon
  }
};
</script>


