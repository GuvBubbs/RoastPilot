<template>
  <div>
    <label v-if="label" class="label">{{ label }}</label>

    <!-- Collapsed: the timestamp is almost always "now", so the default state
         is a readout with one way in, not a form. -->
    <div v-if="!isExpanded" class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1 text-[15px] text-ink truncate">
        {{ displayText }}
      </div>
      <button
        type="button"
        @click="isExpanded = true"
        class="tap shrink-0 -mr-2 px-2 text-[13px] font-medium text-heat-warm"
      >
        Adjust
      </button>
    </div>

    <!-- Expanded -->
    <div v-else class="rounded-xl bg-raised border border-rule p-3 space-y-3">
      <!-- Nudges. Three per row so six of them still fit at 320px. -->
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="offset in quickOffsets"
          :key="offset"
          type="button"
          @click="adjustBy(offset)"
          class="tap w-full rounded-lg border border-rule bg-ground text-[13px] font-medium text-ink-dim transition-colors duration-150 active:bg-rule"
        >
          {{ formatOffset(offset) }}
        </button>
      </div>

      <div class="text-center text-[15px] font-medium text-ink truncate">
        {{ displayText }}
      </div>

      <!-- Precise entry. 16px minimum, or iOS zooms the viewport on focus. -->
      <input
        type="datetime-local"
        :value="localValueForInput"
        @input="handleManualInput"
        :min="minTimeForInput"
        :max="maxTimeForInput"
        class="field"
      />

      <div class="flex gap-2">
        <button type="button" @click="resetToNow" class="btn-ghost flex-1">
          Reset to now
        </button>
        <button type="button" @click="handleDone" class="btn-ghost flex-1 font-semibold">
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

const localValueForInput = computed(() => toInputValue(localValue.value));
const minTimeForInput = computed(() => (props.minTime ? toInputValue(props.minTime) : null));
const maxTimeForInput = computed(() => (props.maxTime ? toInputValue(props.maxTime) : null));

/** ISO -> the local-time `YYYY-MM-DDTHH:mm` datetime-local wants. */
function toInputValue(iso) {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

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
