<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="handleCancel"
  >
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Update Oven Temperature
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Log when you adjust your oven dial
      </p>
      
      <!-- Current vs New Temperature -->
      <div class="mb-4 grid grid-cols-3 gap-3 items-center">
        <!-- Current temp (read-only) -->
        <div class="text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Current</div>
          <div class="px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <div class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ currentDisplay }}
            </div>
          </div>
        </div>
        
        <!-- Arrow -->
        <div class="text-center text-gray-400">
          <svg class="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>
        
        <!-- New temp (editable) -->
        <div class="text-center">
          <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">New</div>
          <div class="px-4 py-3 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg">
            <input
              v-model.number="newTemperature"
              type="number"
              ref="tempInput"
              :step="displayUnits === 'F' ? 5 : 2"
              :min="displayUnits === 'F' ? 100 : 38"
              :max="displayUnits === 'F' ? 550 : 288"
              class="w-full text-lg font-semibold text-center bg-transparent text-gray-900 dark:text-white focus:outline-none"
              @keydown.enter="handleSubmit"
            />
          </div>
        </div>
      </div>
      
      <!-- Number stepper for easier input -->
      <div class="mb-4">
        <NumberStepper
          v-model="newTemperature"
          label="New Oven Set Temperature"
          :suffix="`°${displayUnits}`"
          :step="displayUnits === 'F' ? 25 : 10"
          :min="displayUnits === 'F' ? 100 : 38"
          :max="displayUnits === 'F' ? 550 : 288"
          :error="validationError"
        />
      </div>
      
      <!-- Change indicator -->
      <div v-if="changeAmount !== null && !isNoChange" class="mb-4 text-center">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-lg" :class="changeColorClass">
          <span class="text-sm font-medium">
            Changing by {{ formatChange }}
          </span>
        </div>
      </div>
      
      <div v-else-if="isNoChange" class="mb-4 text-center">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700">
          <span class="text-sm text-gray-600 dark:text-gray-400">
            No change to record
          </span>
        </div>
      </div>
      
      <!-- Timestamp -->
      <div class="mb-4">
        <TimestampPicker
          v-model="timestamp"
          label="Changed at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />
      </div>
      
      <!-- Action buttons -->
      <div class="flex gap-3">
        <button
          @click="handleCancel"
          type="button"
          class="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          @click="handleSubmit"
          type="button"
          :disabled="isNoChange || !newTemperature"
          class="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Update Oven
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { now } from '../utils/timeUtils.js';
import NumberStepper from './NumberStepper.vue';
import TimestampPicker from './TimestampPicker.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue', 'updated']);

const { addOvenEvent, currentOvenTemp, displayUnits, config } = useSession();
const { showToast } = useToast();

const newTemperature = ref(null);
const timestamp = ref(now());
const validationError = ref('');
const tempInput = ref(null);

const maxTime = computed(() => now());

const sessionStartTime = computed(() => {
  return config.value?.createdAt ?? null;
});

const currentDisplay = computed(() => {
  if (!currentOvenTemp.value) return '--';
  return formatTemperature(currentOvenTemp.value, displayUnits.value);
});

const changeAmount = computed(() => {
  if (!currentOvenTemp.value || !newTemperature.value) return null;
  const currentDisplay = toDisplayUnit(currentOvenTemp.value, displayUnits.value);
  return newTemperature.value - currentDisplay;
});

const isNoChange = computed(() => {
  return changeAmount.value === 0;
});

const formatChange = computed(() => {
  if (changeAmount.value === null) return '';
  return formatDelta(changeAmount.value * (displayUnits.value === 'C' ? 9/5 : 1), displayUnits.value, true);
});

const changeColorClass = computed(() => {
  if (changeAmount.value === null) return '';
  if (changeAmount.value > 0) {
    return 'bg-green-100 dark:bg-green-900 dark:bg-opacity-20 text-green-800 dark:text-green-300';
  } else {
    return 'bg-blue-100 dark:bg-blue-900 dark:bg-opacity-20 text-blue-800 dark:text-blue-300';
  }
});

// Initialize with current oven temp when modal opens
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    timestamp.value = now();
    
    if (currentOvenTemp.value) {
      newTemperature.value = toDisplayUnit(currentOvenTemp.value, displayUnits.value);
    } else {
      // Default to a common oven temp
      newTemperature.value = displayUnits.value === 'F' ? 225 : 107;
    }
    
    validationError.value = '';
    
    // Focus input after modal renders
    nextTick(() => {
      if (tempInput.value) {
        tempInput.value.focus();
        tempInput.value.select();
      }
    });
  }
});

function validate() {
  const result = validateOvenTemp(newTemperature.value, displayUnits.value);
  validationError.value = result.error || '';
  return result.valid;
}

function handleSubmit() {
  if (!validate() || isNoChange.value) {
    if (isNoChange.value) {
      showToast('No change to record', 'info');
    }
    return;
  }
  
  addOvenEvent(newTemperature.value, timestamp.value);
  emit('updated');
  emit('update:modelValue', false);
  
  showToast('Oven temperature updated', 'success');
}

function handleCancel() {
  emit('update:modelValue', false);
}
</script>


