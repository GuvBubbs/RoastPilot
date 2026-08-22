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
          :max="displayUnits === 'F' ? 550 : 287"
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
      <div class="space-y-3">
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

        <!-- Off is not a dial setting, so it cannot be a value in the stepper -
             but it is an oven action, and this sheet is the one oven affordance
             that is always reachable. The next-action band only ever shows a
             single control, so when it is busy asking for a temperature change
             this is the cook's only route to stopping the heat. -->
        <button
          type="button"
          class="w-full min-h-[44px] text-[15px] text-ink-dim underline decoration-ink-mute underline-offset-4"
          @click="handleOffRoute"
        >
          {{ isPaused ? 'Log oven restart instead' : 'Turn the oven off instead' }}
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

const emit = defineEmits(['update:modelValue', 'updated', 'pause', 'restart']);

const { addOvenEvent, currentOvenTemp, lastActiveOvenTemp, ovenEvents, displayUnits, config } = useSession();
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

/**
 * Last oven event is an off event. The dial reads 0 in that state, which is why
 * the sheet has to say "off" rather than render a temperature.
 */
const isPaused = computed(() => {
  const events = ovenEvents.value;
  return events.length > 0 && events[events.length - 1].isOff === true;
});

const currentDisplay = computed(() => {
  if (isPaused.value) return 'Off';
  if (!currentOvenTemp.value) return '--';
  return formatTemperature(currentOvenTemp.value, displayUnits.value);
});

/**
 * The current setting as the stepper would express it.
 *
 * Rounded, because that is the only thing the stepper CAN hold, and the
 * comparison below has to be between two numbers a cook could actually have
 * typed.
 */
const currentAsSteppable = computed(() => {
  if (!currentOvenTemp.value) return null;
  return Math.round(toDisplayUnit(currentOvenTemp.value, displayUnits.value));
});

const changeAmount = computed(() => {
  // A restart is never a "no change to record", however the number compares to
  // the setting from before the pause.
  if (isPaused.value) return null;
  if (currentAsSteppable.value === null || !newTemperature.value) return null;
  return newTemperature.value - currentAsSteppable.value;
});

/**
 * PHANTOM OVEN EVENTS.
 *
 * Compared against the ROUNDED current setting, not the raw one. On a Celsius
 * session an oven at 225 °F is 107.22 °C, the stepper is seeded with 107, and
 * comparing 107 against 107.22 gave a change of -0.22 - so a cook who opened this
 * sheet, changed nothing, and pressed save logged an oven event moving the dial
 * four tenths of a degree.
 *
 * That was not a cosmetic wrong number. A new oven event is an UNMEASURED change
 * as far as assessOvenChangeEffect is concerned, so the app went into `settling`
 * and withheld advice for a lag window plus two readings - on the strength of a
 * change that never happened.
 */
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

    // While paused, currentOvenTemp is 0 - seed the stepper from the last
    // temperature actually set so a restart starts from something plausible.
    const baseline = isPaused.value ? lastActiveOvenTemp.value : currentOvenTemp.value;
    if (baseline) {
      newTemperature.value = Math.round(toDisplayUnit(baseline, displayUnits.value));
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

  /**
   * Submitted in DISPLAY units, which round-trip through toStorageUnit. On a
   * Celsius session that is lossy - 107 °C stores as 224.6 °F where the oven is
   * on 225 - so an unchanged value is written back as the setting it already was
   * rather than as its own round trip.
   */
  const unchangedInGrid = !isPaused.value &&
    currentAsSteppable.value !== null &&
    newTemperature.value === currentAsSteppable.value;
  if (unchangedInGrid) {
    showToast('No change to record', 'info');
    emit('update:modelValue', false);
    return;
  }

  addOvenEvent(newTemperature.value, timestamp.value);
  emit('updated');
  emit('update:modelValue', false);

  showToast('Oven temperature updated', 'success');
}

/**
 * Hand off to the dedicated off / restart sheets. Those own the timestamps (and
 * the optional restart pair), so this sheet closes rather than duplicating them.
 */
function handleOffRoute() {
  emit('update:modelValue', false);
  emit(isPaused.value ? 'restart' : 'pause');
}

function handleCancel() {
  emit('update:modelValue', false);
}
</script>
