<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Restart Oven
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Enter the oven temperature to restart at (typically the same temperature as before):
      </p>
      
      <form @submit.prevent="handleSubmit">
      
      <div class="mb-6">
        <label for="ovenTemp" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Oven Temperature (°{{ displayUnits }})
        </label>
        <input
          id="ovenTemp"
          v-model.number="temperature"
          type="number"
          step="1"
          :min="tempMin"
          :max="tempMax"
          required
          class="w-full px-4 py-3 text-lg border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          autofocus
        />
        <p v-if="validationError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ validationError }}
        </p>
        <p v-else class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Recommended: {{ lastOvenTempFormatted }} (previous setting)
        </p>
      </div>
        
        <div class="flex gap-3">
          <button
            type="button"
            @click="$emit('update:modelValue', false)"
            class="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800 text-white rounded-lg font-medium transition-colors"
            :disabled="!!validationError"
          >
            Restart Oven
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue', 'restarted']);

const { ovenEvents, displayUnits, logOvenOn } = useSession();
const { showToast } = useToast();

// Get the last oven temperature before it was turned off
const lastOvenTemp = computed(() => {
  if (!ovenEvents.value || ovenEvents.value.length < 2) return null;
  
  // Find the last non-off event
  for (let i = ovenEvents.value.length - 1; i >= 0; i--) {
    if (!ovenEvents.value[i].isOff && ovenEvents.value[i].setTemp > 0) {
      return ovenEvents.value[i].setTemp;
    }
  }
  return null;
});

const lastOvenTempFormatted = computed(() => {
  if (!lastOvenTemp.value) return '--';
  return formatTemperature(lastOvenTemp.value, displayUnits.value);
});

// Initialize with last oven temp in display units
const temperature = ref(lastOvenTemp.value ? toDisplayUnit(lastOvenTemp.value, displayUnits.value) : 80);

// Reset when modal opens
watch(() => props.modelValue, (isOpen) => {
  if (isOpen && lastOvenTemp.value) {
    temperature.value = toDisplayUnit(lastOvenTemp.value, displayUnits.value);
  }
});

// Temperature bounds based on units
const tempMin = computed(() => displayUnits.value === 'C' ? 65 : 150);
const tempMax = computed(() => displayUnits.value === 'C' ? 175 : 350);

// Validation
const validationError = computed(() => {
  if (!temperature.value) return 'Temperature is required';
  
  const validation = validateOvenTemp(temperature.value, displayUnits.value);
  return validation.valid ? null : validation.error;
});

function handleSubmit() {
  if (validationError.value) return;
  
  logOvenOn(temperature.value);
  const tempFormatted = `${temperature.value}°${displayUnits.value}`;
  showToast(`Oven restarted at ${tempFormatted}`, 'success');
  emit('restarted');
  emit('update:modelValue', false);
}
</script>
