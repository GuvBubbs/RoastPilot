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

        <!-- The oven thermometer, subordinate on purpose.
             Three of the model's constants - the oven's heating and cooling time
             constants and the thermostat's swing - are presently fabricated for
             want of exactly this, and tools/sim/calibrate.js has weighted it into
             its objective at 0.25 since before there was any way to record it.

             It NEVER reaches the runtime projection. The model drives its oven
             node from the dial, because that is what the cook controls and what
             the recommendation engine writes; feeding an observation back in
             would close a loop from a measurement into the advice that produced
             it. Stored, exported, fitted offline. -->
        <div class="pt-1">
          <!-- NO :min, and that is deliberate.
               NumberStepper treats a null value as 0 for the -/+ buttons and
               clamps a typed value up into range on blur, so with :min="100" a
               single stray tap on a blank field became `100` - a legal,
               plausible-looking oven reading, indistinguishable downstream from a
               measurement, which calibrate.js then folds into its objective at
               weight 0.25 against a dial that was set to 225. That is the one
               failure this field must not have: blank has to stay
               distinguishable from measured.
               Without a floor, the same stray tap yields 5 (or -5), which
               validateOvenTemp refuses out loud below. A loud wrong number the
               cook must clear beats a quiet plausible one they never notice. -->
          <NumberStepper
            v-model="ovenActual"
            label="Oven thermometer — optional"
            :suffix="`°${displayUnits}`"
            :step="displayUnits === 'F' ? 5 : 2.5"
            :max="displayUnits === 'F' ? 550 : 287"
            :error="ovenActualError"
          />
          <p class="mt-1.5 text-[12px] leading-snug text-ink-mute">
            If you have one on the shelf. Leave blank otherwise.
          </p>
        </div>

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
import { validateReading, validateOvenTemp } from '../utils/validationUtils.js';
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
const ovenActual = ref(null);
const timestamp = ref(now());
const validationError = ref('');
const validationWarning = ref('');
const ovenActualError = ref('');

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

    /**
     * THE OVEN FIELD IS NEVER PREFILLED. Not from the last reading, and above all
     * not from the current set point.
     *
     * The core temperature above IS prefilled, and should be - a cook probing
     * again is starting from roughly the last number, and it saves the stepper a
     * dozen taps. The oven field is the opposite case: seeded with the dial
     * setting, a cook who taps straight through would record a measurement that
     * agrees perfectly with the assumption it exists to test, and nothing
     * downstream could tell it from a real reading off a real thermometer. The
     * whole point of the field is that it disagrees with the dial.
     *
     * So: blank every time. Empty means "no thermometer on the shelf", which is
     * the truth for most cooks and most readings.
     */
    ovenActual.value = null;

    // Clear validation messages
    validationError.value = '';
    validationWarning.value = '';
    ovenActualError.value = '';
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

  /**
   * The oven field is checked only when it has something in it - blank is the
   * normal case and is not an error. validateOvenTemp already carries the
   * 100-550 °F bound and does the unit conversion, so this is the same rule the
   * setup sheet's oven field is held to rather than a second statement of it.
   */
  let ovenValid = true;
  if (ovenActual.value !== null && ovenActual.value !== '') {
    const ovenResult = validateOvenTemp(ovenActual.value, displayUnits.value);
    ovenActualError.value = ovenResult.error || '';
    ovenValid = ovenResult.valid;
  } else {
    ovenActualError.value = '';
  }

  return result.valid && ovenValid;
}

function handleSubmit() {
  if (!validate()) return;

  // If there's a warning, show it in the toast but still allow submission
  if (validationWarning.value) {
    showToast(validationWarning.value, 'warning', 4000);
  }

  // Third argument in DISPLAY units; addReading converts it alongside the core.
  addReading(
    temperature.value,
    timestamp.value,
    ovenActual.value === '' ? null : ovenActual.value
  );
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
