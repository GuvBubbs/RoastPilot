<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Pause Cooking
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Record when you turned off the oven to slow down cooking
      </p>
      
      <!-- Oven Off Time -->
      <div class="mb-4">
        <TimestampPicker
          v-model="ovenOffTime"
          label="Oven turned off at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />
      </div>
      
      <!-- Optional: Oven Restart Time -->
      <div class="mb-4">
        <div class="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="has-restart"
            v-model="hasRestartTime"
            class="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />
          <label for="has-restart" class="text-sm font-medium text-gray-700 dark:text-gray-300">
            Oven was already restarted
          </label>
        </div>
        
        <div v-if="hasRestartTime" class="ml-6">
          <TimestampPicker
            v-model="ovenOnTime"
            label="Oven restarted at"
            :min-time="ovenOffTime"
            :max-time="maxTime"
          />
          
          <!-- Restart Temperature -->
          <div class="mt-3">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Restart Temperature
            </label>
            <NumberStepper
              v-model="restartTemperature"
              :suffix="`°${displayUnits}`"
              :step="displayUnits === 'F' ? 25 : 10"
              :min="displayUnits === 'F' ? 100 : 38"
              :max="displayUnits === 'F' ? 550 : 288"
              :error="tempValidationError"
            />
          </div>
        </div>
      </div>
      
      <!-- Duration Display -->
      <div v-if="pauseDuration" class="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
        <p class="text-sm text-purple-800 dark:text-purple-200">
          <strong>Pause Duration:</strong> {{ pauseDuration }}
        </p>
      </div>
      
      <!-- Action buttons -->
      <div class="flex gap-3">
        <button
          type="button"
          @click="$emit('update:modelValue', false)"
          class="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSubmit"
          class="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800 text-white font-medium rounded-lg transition-colors"
        >
          Record Pause
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';
import TimestampPicker from './TimestampPicker.vue';
import NumberStepper from './NumberStepper.vue';

const props = defineProps({
  modelValue: Boolean
});

const emit = defineEmits(['update:modelValue', 'paused']);

const { config, currentOvenTemp, ovenEvents, displayUnits, logOvenOff, logOvenOn } = useSession();
const { showToast } = useToast();

// State
const ovenOffTime = ref(new Date().toISOString());
const hasRestartTime = ref(false);
const ovenOnTime = ref(new Date().toISOString());
const restartTemperature = ref(null);

// Get the last oven temp for default restart temperature
const lastOvenTemp = computed(() => {
  if (!ovenEvents.value || ovenEvents.value.length === 0) return null;
  const lastNonZero = [...ovenEvents.value]
    .reverse()
    .find(event => event.setTemp > 0);
  return lastNonZero?.setTemp || null;
});

// Initialize restart temperature with last oven temp (in display units)
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    ovenOffTime.value = new Date().toISOString();
    ovenOnTime.value = new Date().toISOString();
    hasRestartTime.value = false;
    
    if (lastOvenTemp.value) {
      restartTemperature.value = Math.round(toDisplayUnit(lastOvenTemp.value, displayUnits.value));
    } else {
      restartTemperature.value = displayUnits.value === 'F' ? 350 : 177;
    }
  }
});

const maxTime = computed(() => new Date().toISOString());

const sessionStartTime = computed(() => {
  return config.value?.createdAt ?? null;
});

const tempValidationError = computed(() => {
  if (!hasRestartTime.value) return null;
  return validateOvenTemp(restartTemperature.value, displayUnits.value);
});

// Calculate pause duration
const pauseDuration = computed(() => {
  if (!hasRestartTime.value) return null;
  
  const offTime = new Date(ovenOffTime.value);
  const onTime = new Date(ovenOnTime.value);
  const durationMs = onTime - offTime;
  
  if (durationMs < 0) return null;
  
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  
  if (minutes === 0) {
    return `${seconds} seconds`;
  } else if (minutes === 1) {
    return `1 minute ${seconds} seconds`;
  } else {
    return `${minutes} minutes ${seconds} seconds`;
  }
});

function handleSubmit() {
  if (hasRestartTime.value && tempValidationError.value) {
    showToast('Please enter a valid oven temperature', 'error');
    return;
  }
  
  // Log oven off event
  logOvenOff(ovenOffTime.value);
  
  // If restarted, log oven on event
  if (hasRestartTime.value) {
    logOvenOn(restartTemperature.value, ovenOnTime.value);
    showToast(`Pause recorded: ${pauseDuration.value}`, 'success');
  } else {
    showToast('Oven pause recorded', 'success');
  }
  
  emit('paused');
  emit('update:modelValue', false);
}
</script>
