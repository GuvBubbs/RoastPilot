<template>
  <Sheet
    :model-value="modelValue"
    title="Update oven"
    size="auto"
    @update:model-value="handleCancel"
  >
    <template #body>
      <div class="space-y-4" @keydown.enter="handleSubmit">
        <p class="text-[13px] text-ink-mute">
          Log it when you turn the dial.
        </p>

        <!-- Where the dial is now. Read-only reference; the single editable
             control below is the stepper. -->
        <div class="flex items-baseline justify-between gap-3">
          <span class="section-label">Currently set to</span>
          <span class="num text-[18px] text-ink">{{ currentDisplay }}</span>
        </div>

        <NumberStepper
          v-model="newTemperature"
          label="New oven set temperature"
          :suffix="`°${displayUnits}`"
          :step="displayUnits === 'F' ? 25 : 10"
          :min="displayUnits === 'F' ? 100 : 38"
          :max="displayUnits === 'F' ? 550 : 288"
          :error="validationError"
        />

        <div v-if="isNoChange" class="chip">No change to record</div>
        <div v-else-if="changeAmount !== null" class="chip">
          Changing by <span class="num text-ink">{{ formatChange }}</span>
        </div>

        <TimestampPicker
          v-model="timestamp"
          label="Changed at"
          :min-time="sessionStartTime"
          :max-time="maxTime"
        />
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
          :disabled="isNoChange || !newTemperature"
          class="btn-primary flex-1"
        >
          Update oven
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
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { now } from '../utils/timeUtils.js';
import Sheet from './Sheet.vue';
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

// Same fix as AddReadingModal: a dependency-free `computed(() => now())`
// froze the cap at the first open of the session.
const maxTime = ref(now());

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

// Initialize with current oven temp when modal opens
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    maxTime.value = now();
    timestamp.value = maxTime.value;

    if (currentOvenTemp.value) {
      newTemperature.value = toDisplayUnit(currentOvenTemp.value, displayUnits.value);
    } else {
      // Default to a common oven temp
      newTemperature.value = displayUnits.value === 'F' ? 225 : 107;
    }

    validationError.value = '';
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
