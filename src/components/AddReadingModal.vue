<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="handleCancel"
  >
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Add Temperature Reading
      </h2>
      
      <!-- Target reference -->
      <div v-if="config" class="mb-4 px-3 py-2 bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 rounded text-sm text-blue-800 dark:text-blue-300">
        <span class="font-medium">Target:</span> {{ formatTemperature(config.targetTemp, displayUnits) }}
      </div>
      
      <!-- Temperature input -->
      <div class="mb-4">
        <NumberStepper
          v-model="temperature"
          label="Internal Temperature"
          :suffix="`°${displayUnits}`"
          :step="displayUnits === 'F' ? 1 : 0.5"
          :min="displayUnits === 'F' ? 32 : 0"
          :max="displayUnits === 'F' ? 212 : 100"
          :error="validationError"
          ref="tempInput"
        />
      </div>
      
      <!-- Delta preview -->
      <div v-if="deltaPreview" class="mb-4 text-sm text-gray-600 dark:text-gray-400">
        <span class="font-medium">Change from last:</span> 
        <span :class="deltaPreview.delta.startsWith('+') ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'">
          {{ deltaPreview.delta }}
        </span>
        <span class="text-gray-500"> ({{ deltaPreview.timeAgo }})</span>
      </div>
      
      <!-- Timestamp -->
      <div class="mb-4">
        <TimestampPicker
          v-model="timestamp"
          label="Recording at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />
      </div>
      
      <!-- Validation warning -->
      <div v-if="validationWarning" class="mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900 dark:bg-opacity-20 rounded text-sm text-amber-800 dark:text-amber-300">
        {{ validationWarning }}
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
          :disabled="!temperature"
          class="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Add Reading
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateReading } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatTimeAgo, now } from '../utils/timeUtils.js';
import NumberStepper from './NumberStepper.vue';
import TimestampPicker from './TimestampPicker.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue', 'added']);

const { addReading, latestReading, displayUnits, config } = useSession();
const { showToast } = useToast();

const temperature = ref(null);
const timestamp = ref(now());
const validationError = ref('');
const validationWarning = ref('');
const tempInput = ref(null);

const maxTime = computed(() => now());

const sessionStartTime = computed(() => {
  return config.value?.createdAt ?? null;
});

// Initialize temperature with sensible default
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    // Reset timestamp to now when modal opens
    timestamp.value = now();
    
    // Pre-populate with last reading or starting temp
    if (latestReading.value) {
      temperature.value = toDisplayUnit(latestReading.value.temp, displayUnits.value);
    } else if (config.value?.startingTemp) {
      temperature.value = toDisplayUnit(config.value.startingTemp, displayUnits.value);
    } else {
      // Default to a common starting temp
      temperature.value = displayUnits.value === 'F' ? 120 : 49;
    }
    
    // Clear validation messages
    validationError.value = '';
    validationWarning.value = '';
    
    // Focus input after modal renders
    nextTick(() => {
      if (tempInput.value && tempInput.value.$el) {
        const input = tempInput.value.$el.querySelector('input');
        if (input) {
          input.focus();
          input.select();
        }
      }
    });
  }
});

const deltaPreview = computed(() => {
  if (!latestReading.value || !temperature.value) return null;
  
  const currentTempDisplay = temperature.value;
  const lastTempDisplay = toDisplayUnit(latestReading.value.temp, displayUnits.value);
  const deltaDisplay = currentTempDisplay - lastTempDisplay;
  
  const timeAgo = formatTimeAgo(latestReading.value.timestamp);
  
  return {
    delta: formatDelta(deltaDisplay * (displayUnits.value === 'C' ? 9/5 : 1), displayUnits.value, true),
    timeAgo
  };
});

function validate() {
  const previousTempF = latestReading.value?.temp ?? null;
  const result = validateReading(temperature.value, displayUnits.value, previousTempF);
  
  validationError.value = result.error || '';
  validationWarning.value = result.warning || '';
  
  return result.valid;
}

function handleSubmit() {
  if (!validate()) return;
  
  // If there's a warning, show it in the toast but still allow submission
  if (validationWarning.value) {
    showToast(validationWarning.value, 'warning', 4000);
  }
  
  addReading(temperature.value, timestamp.value);
  emit('added');
  emit('update:modelValue', false);
  
  showToast('Reading added', 'success');
}

function handleCancel() {
  emit('update:modelValue', false);
}

// Handle Enter key to submit
function handleKeydown(event) {
  if (event.key === 'Enter' && temperature.value && !validationError.value) {
    handleSubmit();
  }
}

// Add keyboard listener when modal is open
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    window.addEventListener('keydown', handleKeydown);
  } else {
    window.removeEventListener('keydown', handleKeydown);
  }
});
</script>

