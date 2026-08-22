<template>
  <Sheet
    :model-value="modelValue"
    title="Add reading"
    size="auto"
    @update:model-value="handleCancel"
  >
    <template #body>
      <!-- Enter submits from anywhere in the sheet. Was a window-level
           keydown listener that was never removed on unmount. -->
      <div class="space-y-4" @keydown.enter="handleEnter">
        <!-- Target reference: context, not a control, so it stays quiet. -->
        <div v-if="config" class="flex items-baseline justify-between gap-3 text-[13px]">
          <span class="section-label">Target</span>
          <span class="num text-[15px] text-ink-dim">
            {{ formatTemperature(config.pullTempF, displayUnits) }}
          </span>
        </div>

        <NumberStepper
          v-model="temperature"
          label="Internal temperature"
          :suffix="`°${displayUnits}`"
          :step="displayUnits === 'F' ? 1 : 0.5"
          :min="displayUnits === 'F' ? 32 : 0"
          :max="displayUnits === 'F' ? 212 : 100"
          :error="validationError"
        />

        <!-- Delta preview. Neutral ink: saturated heat colours belong to the
             chart's temperature line, not to a form. -->
        <p v-if="deltaPreview" class="text-[13px] text-ink-mute">
          <span class="num text-ink">{{ deltaPreview.delta }}</span>
          from last reading
          <span class="text-ink-mute">({{ deltaPreview.timeAgo }})</span>
        </p>

        <TimestampPicker
          v-model="timestamp"
          label="Recording at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />

        <p v-if="validationWarning" class="text-[13px] text-late">
          {{ validationWarning }}
        </p>
      </div>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button @click="handleCancel" type="button" class="btn-ghost flex-1">
          Cancel
        </button>
        <button
          @click="handleSubmit"
          type="button"
          :disabled="!temperature"
          class="btn-primary flex-1"
        >
          Add reading
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateReading } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatTimeAgo, now } from '../utils/timeUtils.js';
import Sheet from './Sheet.vue';
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

// A ref refreshed on open, not a computed: `computed(() => now())` has no
// reactive dependency, so it cached the instant the sheet was first opened and
// then refused every later timestamp for the rest of the session.
const maxTime = ref(now());

const sessionStartTime = computed(() => {
  return config.value?.createdAt ?? null;
});

// Initialize temperature with sensible default
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    // The cap is "now, as of opening this sheet".
    maxTime.value = now();
    timestamp.value = maxTime.value;

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
  }
});

// No autofocus: the stepper's -/+ buttons cover most edits, and focusing the
// input would raise the iOS keyboard over the sheet the moment it opens.

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

function handleEnter() {
  if (temperature.value && !validationError.value) {
    handleSubmit();
  }
}
</script>
