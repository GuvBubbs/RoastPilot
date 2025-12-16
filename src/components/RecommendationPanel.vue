<template>
  <div class="mx-4 my-4">
    <div 
      class="rounded-xl border-2 p-4 transition-colors duration-300"
      :class="panelClasses"
    >
      <!-- Header -->
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0">
          <!-- Clock Icon (default/collecting data) -->
          <svg v-if="statusIcon === 'ClockIcon'" class="w-8 h-8" :class="iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- Alert Circle Icon (errors) -->
          <svg v-else-if="statusIcon === 'AlertCircleIcon'" class="w-8 h-8" :class="iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- Check Circle Icon (hold steady) -->
          <svg v-else-if="statusIcon === 'CheckCircleIcon'" class="w-8 h-8" :class="iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- Arrow Up Circle Icon (raise temp) -->
          <svg v-else-if="statusIcon === 'ArrowUpCircleIcon'" class="w-8 h-8" :class="iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z" />
          </svg>
          <!-- Arrow Down Circle Icon (lower temp) -->
          <svg v-else-if="statusIcon === 'ArrowDownCircleIcon'" class="w-8 h-8" :class="iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" />
          </svg>
        </div>
        
        <div class="flex-1 min-w-0">
          <!-- Can recommend -->
          <template v-if="canRecommend">
            <h3 class="font-semibold text-lg" :class="textClass">
              {{ actionTitle }}
            </h3>
            
            <p class="mt-1 text-gray-700 dark:text-gray-300">
              {{ message }}
            </p>
            
            <!-- Alternative message for oven-off recommendation -->
            <div v-if="alternativeMessage" class="mt-3 p-3 bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-700">
              <p class="text-sm font-medium text-purple-800 dark:text-purple-200">
                💡 Alternative Approach:
              </p>
              <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {{ alternativeMessage }}
              </p>
            </div>
            
            <!-- Temperature change visual -->
            <div v-if="action !== 'hold' && action !== 'oven-off'" class="mt-3 flex items-center gap-3">
              <div class="text-center">
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase">Current</div>
                <div class="text-xl font-bold text-gray-600 dark:text-gray-400">
                  {{ currentOvenFormatted }}
                </div>
              </div>
              
              <!-- Arrow Right Icon -->
              <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              
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
            
            <!-- Apply button for raise/lower actions -->
            <div v-if="action === 'raise' || action === 'lower'" class="mt-4">
              <button
                @click="applyRecommendation"
                class="w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors"
                :class="applyButtonClass"
              >
                Apply: Set oven to {{ suggestedTempFormatted }}
              </button>
              <p class="text-xs text-gray-500 dark:text-gray-400 text-center mt-2">
                This will log the oven temperature change
              </p>
            </div>
            
            <!-- Apply button for oven-off action when oven is currently off (restart recommendation) -->
            <div v-if="action === 'oven-off' && isOvenCurrentlyOff && restartTime" class="mt-4 space-y-3">
              <!-- Display estimated current meat temp -->
              <div v-if="estimatedCurrentMeatTempFormatted" class="p-3 bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-700">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  {{ alternativeMessage }}
                </p>
              </div>
              
              <!-- Restart time display -->
              <div class="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg border-2 border-purple-300 dark:border-purple-700">
                <div class="text-center">
                  <p class="text-sm text-purple-600 dark:text-purple-300 font-medium mb-2">
                    {{ shouldRestartNow ? '🔥 Restart Now' : '⏰ Restart Time' }}
                  </p>
                  <p class="text-2xl font-bold text-purple-700 dark:text-purple-200">
                    {{ shouldRestartNow ? 'NOW' : restartTimeFormatted }}
                  </p>
                  <p class="text-sm text-purple-600 dark:text-purple-300 mt-2">
                    at {{ suggestedTempFormatted }}
                  </p>
                  <p v-if="!shouldRestartNow && minutesUntilRestart !== null" class="text-xs text-purple-500 dark:text-purple-400 mt-1">
                    (in {{ Math.round(minutesUntilRestart) }} minutes)
                  </p>
                </div>
              </div>
              
              <!-- Quick restart button -->
              <button
                @click="emit('openRestartModal')"
                class="w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors"
                :class="shouldRestartNow ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800' : 'bg-purple-500 hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700'"
              >
                {{ shouldRestartNow ? 'Restart Oven Now' : 'Log Oven Restart' }}
              </button>
            </div>
            
            <!-- Apply button for oven-off action when oven is ON (pause recommendation) -->
            <div v-else-if="action === 'oven-off' && !isOvenCurrentlyOff && ovenOffMinutes" class="mt-4 space-y-2">
              <button
                @click="emit('openPauseModal')"
                class="w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors"
                :class="applyButtonClass"
              >
                Turn Off Oven ({{ ovenOffMinutes }} min pause)
              </button>
              <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
                Set a timer and restart the oven after {{ ovenOffMinutes }} minutes
              </p>
            </div>
            
            <!-- Oven-off action note (only when recommending pause, not restart) -->
            <div v-if="action === 'oven-off' && !isOvenCurrentlyOff" class="mt-4 p-3 bg-white dark:bg-gray-900 rounded-lg border border-purple-200 dark:border-purple-700">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                <strong>💡 Tip:</strong> Pausing your oven temporarily is a practical way to slow down cooking when you can't lower the temperature any further. Set a timer and restart at the same temperature after the suggested time.
              </p>
            </div>
            
            <!-- Reasoning (collapsible) -->
            <details class="mt-3">
              <summary class="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                Why this recommendation?
              </summary>
              <p class="mt-2 text-sm text-gray-600 dark:text-gray-400 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                {{ reasoning }}
              </p>
            </details>
          </template>
          
          <!-- Cannot recommend -->
          <template v-else>
            <h3 class="font-semibold text-gray-700 dark:text-gray-300">
              {{ blockerTitle }}
            </h3>
            
            <p class="mt-1 text-gray-600 dark:text-gray-400">
              {{ blockerReason }}
            </p>
            
            <!-- Progress indicator -->
            <div v-if="blockerProgress" class="mt-3">
              <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>{{ blockerProgress.message }}</span>
                <span>{{ blockerProgress.current }}/{{ blockerProgress.required }}</span>
              </div>
              <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
                class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
              >
                {{ quickAction.label }} →
              </button>
            </div>
          </template>
        </div>
      </div>
      
      <!-- Disclaimer -->
      <p class="mt-4 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-3">
        {{ disclaimer }}
      </p>
    </div>
    
    <!-- Manual Pause/Restart Button (Always Visible) -->
    <div class="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1">
          <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ isOvenCurrentlyOff ? 'Restart Cooking' : 'Pause Cooking' }}
          </h4>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {{ isOvenCurrentlyOff ? 'Turn the oven back on to continue cooking' : 'Turn off oven temporarily to slow down cooking' }}
          </p>
        </div>
        <button
          @click="isOvenCurrentlyOff ? emit('openRestartModal') : emit('openPauseModal')"
          class="px-4 py-2 rounded-lg font-medium text-white transition-colors whitespace-nowrap"
          :class="isOvenCurrentlyOff ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800' : 'bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800'"
        >
          {{ isOvenCurrentlyOff ? 'Restart Oven' : 'Pause Now' }}
        </button>
      </div>
    </div>
    
    <!-- Oven Responsiveness (optional, collapsible) -->
    <details v-if="hasResponsivenessData" class="mt-3">
      <summary class="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 px-2">
        View observed oven responsiveness
      </summary>
      <div class="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-400">
        {{ responsiveness.description }}
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useRecommendations } from '../composables/useRecommendations.js';
import { useToast } from '../composables/useToast.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { DISCLAIMER } from '../constants/defaults.js';

const emit = defineEmits(['openOvenModal', 'openReadingModal', 'openSettings', 'openPauseModal', 'openRestartModal']);

const { currentOvenTemp, displayUnits, addOvenEvent, ovenEvents } = useSession();
const {
  canRecommend,
  action,
  suggestedTemp,
  suggestedTempFormatted,
  changeAmountFormatted,
  message,
  reasoning,
  severity,
  alternativeMessage,
  ovenOffMinutes,
  restartTime,
  restartTimeFormatted,
  shouldRestartNow,
  minutesUntilRestart,
  estimatedCurrentMeatTemp,
  estimatedCurrentMeatTempFormatted,
  blockerReason,
  blockerType,
  blockerProgress,
  responsiveness,
  hasResponsivenessData
} = useRecommendations();
const { showToast } = useToast();

const disclaimer = DISCLAIMER;

// Check if oven is currently off
const isOvenCurrentlyOff = computed(() => {
  if (!ovenEvents.value || ovenEvents.value.length === 0) return false;
  const lastEvent = ovenEvents.value[ovenEvents.value.length - 1];
  return lastEvent.isOff === true;
});

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
    case 'oven-off': 
      // Check if this is a restart recommendation (oven currently off)
      if (isOvenCurrentlyOff.value && restartTime.value) {
        return shouldRestartNow.value ? 'Restart Oven Now' : 'Oven Restart Scheduled';
      }
      return 'Pause Cooking Temporarily';
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
    return blockerType.value === 'bad_rate' ? 'AlertCircleIcon' : 'ClockIcon';
  }
  switch (action.value) {
    case 'raise': return 'ArrowUpCircleIcon';
    case 'lower': return 'ArrowDownCircleIcon';
    case 'hold': return 'CheckCircleIcon';
    case 'oven-off': return 'ClockIcon';
    default: return 'ClockIcon';
  }
});

// Panel styling based on state
const panelClasses = computed(() => {
  if (!canRecommend.value) {
    return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
  switch (action.value) {
    case 'raise': 
      return severity.value === 'urgent' 
        ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800' 
        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800';
    case 'lower': return 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-800';
    case 'hold': return 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-800';
    case 'oven-off': return 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-800';
    default: return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
});

const iconClass = computed(() => {
  if (!canRecommend.value) return 'text-gray-400';
  switch (action.value) {
    case 'raise': return severity.value === 'urgent' ? 'text-red-500' : 'text-amber-500';
    case 'lower': return 'text-blue-500';
    case 'hold': return 'text-green-500';
    case 'oven-off': return 'text-purple-500';
    default: return 'text-gray-400';
  }
});

const textClass = computed(() => {
  if (!canRecommend.value) return 'text-gray-700 dark:text-gray-300';
  switch (action.value) {
    case 'raise': return severity.value === 'urgent' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300';
    case 'lower': return 'text-blue-700 dark:text-blue-300';
    case 'hold': return 'text-green-700 dark:text-green-300';
    case 'oven-off': return 'text-purple-700 dark:text-purple-300';
    default: return 'text-gray-700 dark:text-gray-300';
  }
});

const suggestedLabelClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'text-amber-600 dark:text-amber-400';
    case 'lower': return 'text-blue-600 dark:text-blue-400';
    default: return 'text-gray-500 dark:text-gray-400';
  }
});

const changeBadgeClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300';
    case 'lower': return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300';
    default: return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
  }
});

const applyButtonClass = computed(() => {
  switch (action.value) {
    case 'raise': return 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700';
    case 'lower': return 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700';
    case 'oven-off': return 'bg-purple-500 hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700';
    default: return 'bg-gray-500 hover:bg-gray-600';
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

function applyRecommendation() {
  if (suggestedTemp.value === null) return;
  
  addOvenEvent(suggestedTemp.value);
  
  const actionVerb = action.value === 'raise' ? 'raised' : 'lowered';
  showToast(`Oven ${actionVerb} to ${suggestedTempFormatted.value}`, 'success');
}
</script>


