<template>
  <Sheet v-model="isOpen" title="Pause cooking" size="auto">
    <template #body>
      <p class="text-[13px] leading-snug text-ink-dim">
        Record when you turned the oven off to slow cooking down.
      </p>

      <div class="mt-4">
        <TimestampPicker
          v-model="ovenOffTime"
          label="Oven turned off at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />
      </div>

      <!-- The whole label is the target, so the 20px box is not the only thing
           you can hit. -->
      <label
        class="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] text-ink"
        for="pause-has-restart"
      >
        <input
          id="pause-has-restart"
          v-model="hasRestartTime"
          type="checkbox"
          class="h-5 w-5 shrink-0 rounded border border-rule bg-raised accent-heat-warm"
        />
        <span class="min-w-0">Oven was already restarted</span>
      </label>

      <div v-if="hasRestartTime" class="mt-3 space-y-4 border-l border-rule pl-3">
        <TimestampPicker
          v-model="ovenOnTime"
          label="Oven restarted at"
          :min-time="ovenOffTime"
          :max-time="maxTime"
        />

        <NumberStepper
          v-model="restartTemperature"
          label="Restart temperature"
          :suffix="`°${displayUnits}`"
          :step="displayUnits === 'F' ? 25 : 10"
          :min="displayUnits === 'F' ? 100 : 38"
          :max="displayUnits === 'F' ? 550 : 288"
          :error="tempValidationError"
        />
      </div>

      <!-- Pause length comes from the two timestamps the cook entered, not from
           a clock reading or a cooling model. -->
      <p v-if="pauseDuration" class="mt-4 text-[13px] text-ink-dim">
        Pause duration
        <span class="num ml-1 text-[15px] text-ink">{{ pauseDuration }}</span>
      </p>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" class="btn-ghost flex-1" @click="isOpen = false">
          Cancel
        </button>
        <button type="button" class="btn-primary flex-1" @click="handleSubmit">
          Record pause
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';
import Sheet from './Sheet.vue';
import TimestampPicker from './TimestampPicker.vue';
import NumberStepper from './NumberStepper.vue';

const props = defineProps({
  modelValue: Boolean
});

const emit = defineEmits(['update:modelValue', 'paused']);

const { config, ovenEvents, displayUnits, logOvenOff, logOvenOn } = useSession();
const { showToast } = useToast();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

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
const maxTime = ref(new Date().toISOString());

watch(() => props.modelValue, (isOpening) => {
  if (isOpening) {
    ovenOffTime.value = new Date().toISOString();
    ovenOnTime.value = new Date().toISOString();
    // Refreshed on every open, not derived once. As a dependency-free computed
    // this froze at the sheet's first-ever render, and since the component stays
    // mounted the pickers then clamped every later edit back to that instant -
    // so a pause could not be logged at the time it actually happened.
    maxTime.value = new Date().toISOString();
    hasRestartTime.value = false;

    if (lastOvenTemp.value) {
      restartTemperature.value = Math.round(toDisplayUnit(lastOvenTemp.value, displayUnits.value));
    } else {
      restartTemperature.value = displayUnits.value === 'F' ? 350 : 177;
    }
  }
}, { immediate: true });


const sessionStartTime = computed(() => {
  return config.value?.createdAt ?? null;
});

// validateOvenTemp returns {valid, error}. Reading the whole object here left an
// always-truthy error flag, which made the restart path unsubmittable with any
// input at all — only the error string belongs in this ref.
const tempValidationError = computed(() => {
  if (!hasRestartTime.value) return null;
  return validateOvenTemp(restartTemperature.value, displayUnits.value).error;
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
    showToast(tempValidationError.value, 'error');
    return;
  }

  // A null duration here means the restart lands before the shut-off, which
  // would log a negative pause.
  if (hasRestartTime.value && !pauseDuration.value) {
    showToast('Restart time must be after the oven was turned off', 'error');
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
  isOpen.value = false;
}
</script>
