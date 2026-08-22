<template>
  <Sheet
    :model-value="modelValue"
    title="Restart oven"
    size="auto"
    @update:model-value="onSheetToggle"
  >
    <template #body>
      <p class="text-[15px] text-ink-dim">
        What are you setting the oven to? Usually the same temperature as before.
      </p>

      <div class="mt-4">
        <label for="restart-oven-temp" class="label">
          Oven temperature (&deg;{{ displayUnits }})
        </label>
        <!-- Enter submits: the actions slot lives outside this element's DOM
             subtree, so a <form> cannot span input and button here. -->
        <input
          id="restart-oven-temp"
          v-model.number="temperature"
          type="number"
          inputmode="numeric"
          step="1"
          :min="tempMin"
          :max="tempMax"
          class="field num text-[20px]"
          :class="{ 'border-danger': validationError }"
          :aria-invalid="validationError ? 'true' : 'false'"
          aria-describedby="restart-oven-hint"
          @keyup.enter="handleSubmit"
        />
        <p v-if="validationError" id="restart-oven-hint" class="mt-2 text-[13px] text-danger">
          {{ validationError }}
        </p>
        <p v-else id="restart-oven-hint" class="mt-2 text-[13px] text-ink-mute">
          Previous setting: {{ lastOvenTempFormatted }}
        </p>
      </div>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" class="btn-ghost flex-1" @click="close">
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary flex-1"
          :disabled="!!validationError"
          @click="handleSubmit"
        >
          Restart oven
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import Sheet from './Sheet.vue';
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

function close() {
  emit('update:modelValue', false);
}

function onSheetToggle(open) {
  if (!open) close();
}

function handleSubmit() {
  if (validationError.value) return;
  
  logOvenOn(temperature.value);
  const tempFormatted = `${temperature.value}°${displayUnits.value}`;
  showToast(`Oven restarted at ${tempFormatted}`, 'success');
  emit('restarted');
  close();
}
</script>
