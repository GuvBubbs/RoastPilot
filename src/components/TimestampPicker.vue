<template>
  <div class="space-y-2">
    <label v-if="label" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
    </label>
    
    <!-- Collapsed mode - show formatted time -->
    <div v-if="!isExpanded" class="flex items-center justify-between gap-2">
      <div class="text-sm text-gray-600 dark:text-gray-400">
        {{ displayText }}
      </div>
      <button
        type="button"
        @click="isExpanded = true"
        class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        Adjust time
      </button>
    </div>
    
    <!-- Expanded mode - show adjustment controls -->
    <div v-else class="space-y-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
      <!-- Quick adjustment buttons -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="offset in quickOffsets"
          :key="offset"
          type="button"
          @click="adjustBy(offset)"
          class="px-3 py-1 text-xs font-medium rounded bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors"
        >
          {{ formatOffset(offset) }}
        </button>
      </div>
      
      <!-- Current time display -->
      <div class="text-center text-sm font-medium text-gray-900 dark:text-white">
        {{ displayText }}
      </div>
      
      <!-- Precise time input (fallback) -->
      <input
        type="datetime-local"
        :value="localValueForInput"
        @input="handleManualInput"
        :min="minTimeForInput"
        :max="maxTimeForInput"
        class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      
      <!-- Action buttons -->
      <div class="flex gap-2">
        <button
          type="button"
          @click="resetToNow"
          class="flex-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors"
        >
          Reset to now
        </button>
        <button
          type="button"
          @click="handleDone"
          class="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { formatTime, formatDateTime, addMinutes, now } from '../utils/timeUtils.js';

const props = defineProps({
  modelValue: { type: String, required: true }, // ISO 8601 string
  minTime: { type: String, default: null }, // Minimum selectable time
  maxTime: { type: String, default: null }, // Maximum selectable time (usually "now")
  label: { type: String, default: 'Time' }
});

const emit = defineEmits(['update:modelValue']);

const isExpanded = ref(false);
const localValue = ref(props.modelValue);

const quickOffsets = [-15, -5, -1, 1, 5, 15]; // minutes

// Keep local value in sync with prop
watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal;
});

const displayText = computed(() => {
  const date = new Date(localValue.value);
  const today = new Date();
  
  if (date.toDateString() === today.toDateString()) {
    return formatTime(localValue.value) + ' today';
  }
  return formatDateTime(localValue.value);
});

const localValueForInput = computed(() => {
  // Convert ISO to datetime-local format (YYYY-MM-DDTHH:mm)
  const date = new Date(localValue.value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
});

const minTimeForInput = computed(() => {
  if (!props.minTime) return null;
  const date = new Date(props.minTime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
});

const maxTimeForInput = computed(() => {
  if (!props.maxTime) return null;
  const date = new Date(props.maxTime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
});

function formatOffset(minutes) {
  if (minutes > 0) {
    return `+${minutes} min`;
  }
  return `${minutes} min`;
}

function adjustBy(minutes) {
  let newTime = addMinutes(localValue.value, minutes);
  
  // Clamp to bounds
  if (props.minTime && newTime < props.minTime) {
    newTime = props.minTime;
  }
  if (props.maxTime && newTime > props.maxTime) {
    newTime = props.maxTime;
  }
  
  localValue.value = newTime;
  emit('update:modelValue', newTime);
}

function handleManualInput(event) {
  const value = event.target.value;
  if (!value) return;
  
  const newTime = new Date(value).toISOString();
  localValue.value = newTime;
  emit('update:modelValue', newTime);
}

function resetToNow() {
  const newTime = now();
  localValue.value = newTime;
  emit('update:modelValue', newTime);
}

function handleDone() {
  isExpanded.value = false;
}
</script>

