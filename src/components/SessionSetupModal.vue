<template>
  <Sheet
    :model-value="modelValue"
    title="Start a cook"
    size="tall"
    @update:model-value="onSheetToggle"
  >
    <template #body>
      <!-- Two decisions carry the whole cook: what temperature, and by when.
           They are first and need no unfolding. Everything below them is a
           refinement of a working default. -->
      <div class="space-y-5">
        <!-- On the plate --------------------------------------------------
             The cook states the doneness they want to EAT. The temperature to
             pull at is derived from it, because that is a fact about the roast
             rather than a decision the cook should have to make in their head -
             two of the presets used to carry a note telling them to do exactly
             that arithmetic. -->
        <section>
          <div class="flex items-center justify-between gap-3">
            <span class="section-label">On the plate</span>
            <UnitToggle
              :model-value="form.units.value"
              @update:model-value="handleUnitChange"
            />
          </div>

          <div class="mt-3">
            <NumberStepper
              v-model="form.servingTemp.value"
              label="Internal temperature when served"
              :suffix="'°' + form.units.value"
              :step="1"
              :min="tempRanges.min"
              :max="tempRanges.max"
              :error="form.servingTemp.touched ? form.servingTemp.error : ''"
              @blur="form.servingTemp.touched = true"
            />
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="preset in quickSelectTargets"
              :key="preset.name"
              type="button"
              class="chip tap gap-2"
              :class="isQuickTarget(preset) ? 'text-ink border border-heat-warm' : ''"
              @click="selectQuickTarget(preset)"
            >
              <span class="truncate">{{ preset.name }}</span>
              <span class="num text-ink-mute">{{ formatTemperature(preset.targetF, form.units.value) }}</span>
            </button>
          </div>

          <!-- The derived half, stated rather than hidden: this is the number
               the app will actually steer to, and a cook who disagrees with the
               carryover estimate needs to see it to know that. -->
          <p class="mt-3 text-[13px] text-ink-dim">
            Comes out of the oven at
            <span class="num text-ink">{{ derivedPullText }}</span>,
            then climbs about
            <span class="num text-ink">{{ carryoverText }}</span>
            while it rests.
          </p>
        </section>

        <!-- Rest ----------------------------------------------------------
             Subtracted from the serve time to get the moment the meat has to be
             out of the oven. Nothing subtracted it before, which is why dinner
             ran 20-45 minutes late as a matter of course. -->
        <section class="rule-t pt-5">
          <span class="section-label">Rest</span>
          <p class="mt-1 text-[13px] text-ink-mute">
            Time on the board before carving. The app aims to have the meat out
            of the oven this far ahead of your serve time.
          </p>
          <div class="mt-3">
            <NumberStepper
              v-model="form.restMinutes.value"
              label="Minutes resting"
              suffix="min"
              :step="5"
              :min="0"
              :max="90"
            />
          </div>
        </section>

        <!-- Serve time --------------------------------------------------- -->
        <section class="rule-t pt-5">
          <span class="section-label">Serve time</span>
          <p class="mt-1 text-[13px] text-ink-mute">
            Optional. Without it the app can't tell you whether you're early or late.
          </p>

          <!-- Segmented: same decision, two ways of saying it. -->
          <div class="mt-3 flex gap-1 p-1 rounded-xl bg-raised border border-rule" role="group" aria-label="How to set the serve time">
            <button
              type="button"
              class="tap flex-1 rounded-lg text-[14px] font-medium transition-colors duration-150"
              :class="form.timeInputMode.value === 'serveTime' ? 'bg-rule text-ink' : 'text-ink-dim'"
              :aria-pressed="form.timeInputMode.value === 'serveTime'"
              @click="form.timeInputMode.value = 'serveTime'"
            >
              Clock time
            </button>
            <button
              type="button"
              class="tap flex-1 rounded-lg text-[14px] font-medium transition-colors duration-150"
              :class="form.timeInputMode.value === 'remaining' ? 'bg-rule text-ink' : 'text-ink-dim'"
              :aria-pressed="form.timeInputMode.value === 'remaining'"
              @click="form.timeInputMode.value = 'remaining'"
            >
              From now
            </button>
          </div>

          <div v-if="form.timeInputMode.value === 'serveTime'" class="mt-3">
            <label for="serveTime" class="label">Serving at</label>
            <input
              id="serveTime"
              v-model="form.desiredServeTime.value"
              type="datetime-local"
              class="field"
            />
          </div>

          <div v-else class="mt-3 grid grid-cols-2 gap-3">
            <div class="min-w-0">
              <label for="hours" class="label">Hours</label>
              <input
                id="hours"
                v-model.number="timeRemaining.hours"
                type="number"
                inputmode="numeric"
                min="0"
                max="24"
                class="field num"
              />
            </div>
            <div class="min-w-0">
              <label for="minutes" class="label">Minutes</label>
              <input
                id="minutes"
                v-model.number="timeRemaining.minutes"
                type="number"
                inputmode="numeric"
                min="0"
                max="59"
                class="field num"
              />
            </div>
          </div>
        </section>

        <!-- Oven --------------------------------------------------------- -->
        <section class="rule-t pt-5">
          <span class="section-label">Oven</span>

          <div class="mt-3">
            <NumberStepper
              v-model="form.initialOvenTemp.value"
              label="Starting oven setting"
              :suffix="'°' + form.units.value"
              :step="1"
              :largeStep="10"
              :min="ovenTempRanges.min"
              :max="ovenTempRanges.max"
              :error="form.initialOvenTemp.touched ? form.initialOvenTemp.error : ''"
              @blur="form.initialOvenTemp.touched = true"
            />
          </div>

          <p class="mt-2 text-[13px] text-ink-mute">
            Low and slow is {{ formatTemperature(150, form.units.value) }}–{{ formatTemperature(300, form.units.value) }}.
          </p>
        </section>

        <!-- Starting reading --------------------------------------------- -->
        <section class="rule-t pt-5">
          <span class="section-label">Starting reading</span>

          <div class="mt-3">
            <NumberStepper
              v-model="form.startingTemp.value"
              label="Internal temperature now"
              :suffix="'°' + form.units.value"
              :step="1"
              :min="tempRanges.min"
              :max="tempRanges.max"
              :error="form.startingTemp.touched ? form.startingTemp.error : ''"
              @blur="form.startingTemp.touched = true"
            />
          </div>

          <p class="mt-2 text-[13px] text-ink-mute">
            Optional. If you've already probed it, this becomes the baseline.
          </p>
        </section>

        <!-- Meat details (folded away — nothing here changes the maths) --- -->
        <section class="rule-t pt-5">
          <button
            type="button"
            class="tap flex items-center justify-between gap-3 w-full text-left"
            :aria-expanded="showMeatDetails"
            @click="showMeatDetails = !showMeatDetails"
          >
            <span class="section-label">Meat details — optional</span>
            <svg
              class="w-4 h-4 shrink-0 text-ink-dim transition-transform duration-150"
              :class="{ 'rotate-180': showMeatDetails }"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <div v-show="showMeatDetails" class="mt-3 space-y-4">
            <div>
              <label for="meatType" class="label">Type</label>
              <select
                id="meatType"
                v-model="form.meatType.value"
                class="field-select"
                @change="handleMeatTypeChange"
              >
                <option value="">Not specified</option>
                <option v-for="preset in MEAT_PRESETS" :key="preset.type" :value="preset.type">
                  {{ preset.type }}
                </option>
              </select>
            </div>

            <div v-if="selectedMeatPreset">
              <label for="meatCut" class="label">Cut</label>
              <select id="meatCut" v-model="form.meatCut.value" class="field-select">
                <option value="">Not specified</option>
                <option v-for="cut in selectedMeatPreset.cuts" :key="cut" :value="cut">
                  {{ cut }}
                </option>
              </select>
            </div>

            <NumberStepper
              v-model="form.weight.value"
              label="Weight"
              suffix="lbs"
              :step="0.5"
              :min="0"
              :max="100"
              :error="form.weight.touched ? form.weight.error : ''"
              @blur="form.weight.touched = true"
            />

            <div>
              <label for="notes" class="label">Notes</label>
              <textarea
                id="notes"
                v-model="form.notes.value"
                rows="3"
                class="field py-2 resize-none"
                placeholder="Anything worth remembering about this cook"
              ></textarea>
            </div>

            <p
              v-if="selectedMeatPreset && selectedMeatPreset.notes"
              class="rounded-xl bg-raised border border-rule p-3 text-[13px] text-ink-dim"
            >
              {{ selectedMeatPreset.notes }}
            </p>
          </div>
        </section>
      </div>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" class="btn-ghost flex-1" @click="handleCancel">
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary flex-1"
          :disabled="!isFormValid"
          @click="handleSubmit"
        >
          Start cook
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import Sheet from './Sheet.vue';
import NumberStepper from './NumberStepper.vue';
import UnitToggle from './UnitToggle.vue';
import { useSession } from '../composables/useSession.js';
import { sanitizeString } from '../utils/validationUtils.js';
import { toStorageUnit, formatTemperature, fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { addMinutes } from '../utils/timeUtils.js';
import { MEAT_PRESETS, SESSION_DEFAULTS } from '../constants/defaults.js';
import { estimateCarryoverF, pullTempFor } from '../services/carryoverService.js';
import { validateSessionConfig } from '../utils/validationUtils.js';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  initialConfig: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel']);

// The unit the last cook was run in. A Celsius cook shouldn't have to switch
// units every time they start a new one.
const { preferredUnits } = useSession();

// Defaults are stored in Fahrenheit; the form works in display units.
const getInitialServingTemp = (units) => {
  if (units === 'C') {
    // 1 decimal place for Celsius: 1 °F is finer than 1 °C, and a doneness
    // target rounded to the whole degree Celsius moves by nearly two °F.
    return Math.round(fahrenheitToCelsius(SESSION_DEFAULTS.SERVING_TEMP_F) * 10) / 10;
  }
  return SESSION_DEFAULTS.SERVING_TEMP_F;
};

const getInitialOvenTemp = (units) => {
  if (units === 'C') {
    // Oven temp as whole number
    return Math.round(fahrenheitToCelsius(SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F));
  }
  return SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F;
};

/** `datetime-local` wants a local-time string, not an ISO instant. */
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const startingUnits = preferredUnits.value;

// Form state
const form = reactive({
  servingTemp: { value: getInitialServingTemp(startingUnits), error: '', touched: false },
  restMinutes: { value: SESSION_DEFAULTS.REST_MINUTES, error: '', touched: false },
  units: { value: startingUnits, error: '', touched: false },
  startingTemp: { value: null, error: '', touched: false },
  desiredServeTime: { value: '', error: '', touched: false },
  timeInputMode: { value: 'serveTime', error: '', touched: false },
  initialOvenTemp: { value: getInitialOvenTemp(startingUnits), error: '', touched: false },
  meatType: { value: '', error: '', touched: false },
  meatCut: { value: '', error: '', touched: false },
  weight: { value: null, error: '', touched: false },
  notes: { value: '', error: '', touched: false }
});

const timeRemaining = reactive({
  hours: 4,
  minutes: 0
});

const showMeatDetails = ref(false);
const userHasEditedTarget = ref(false);
const userHasEditedOven = ref(false);
const userHasEditedRest = ref(false);

/**
 * Carryover for the oven the cook has chosen, in °F.
 *
 * Computed live *while setting up*, which is the one moment it is safe to: no
 * cook is running, so there is no finish line to move and no loop from the
 * recommendation engine back into its own target. Once the session exists the
 * value is frozen on it - see carryoverService.js.
 */
const carryoverF = computed(() => {
  const ovenF = form.initialOvenTemp.value === null
    ? SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F
    : toStorageUnit(form.initialOvenTemp.value, form.units.value);
  return estimateCarryoverF(ovenF);
});

/** The serving temperature in °F, whatever unit the form is in. */
const servingTempF = computed(() =>
  form.servingTemp.value === null
    ? null
    : toStorageUnit(form.servingTemp.value, form.units.value)
);

const pullTempF = computed(() =>
  servingTempF.value === null ? null : pullTempFor(servingTempF.value, carryoverF.value)
);

const derivedPullText = computed(() =>
  pullTempF.value === null ? '--' : formatTemperature(pullTempF.value, form.units.value)
);

/** A DELTA, so no 32° offset: +4 °F is +2.2 °C, not -15.6 °C. */
const carryoverText = computed(() => {
  const raw = carryoverF.value;
  const value = form.units.value === 'C' ? Math.round((raw * 5 / 9) * 10) / 10 : raw;
  return `+${value}°${form.units.value}`;
});

// Quick select targets
const quickSelectTargets = [
  { name: 'Rare', targetF: 120 },
  { name: 'Medium-rare', targetF: 130 },
  { name: 'Medium', targetF: 140 }
];

// Temperature ranges based on current unit
const tempRanges = computed(() => {
  if (form.units.value === 'F') {
    return { min: 32, max: 212 };
  } else {
    return { min: 0, max: 100 };
  }
});

const ovenTempRanges = computed(() => {
  if (form.units.value === 'F') {
    return { min: 100, max: 550 };
  } else {
    return { min: 38, max: 288 };
  }
});

// Selected meat preset
const selectedMeatPreset = computed(() => {
  return MEAT_PRESETS.find(p => p.type === form.meatType.value);
});

// Form validation
const isFormValid = computed(() => {
  return form.servingTemp.value !== null && 
         form.servingTemp.value >= tempRanges.value.min && 
         form.servingTemp.value <= tempRanges.value.max &&
         form.initialOvenTemp.value !== null &&
         form.initialOvenTemp.value >= ovenTempRanges.value.min &&
         form.initialOvenTemp.value <= ovenTempRanges.value.max;
});

/** Display value of a quick-select preset in the form's current unit. */
function quickTargetValue(preset) {
  return form.units.value === 'F'
    ? preset.targetF
    : Math.round(fahrenheitToCelsius(preset.targetF) * 10) / 10;
}

function isQuickTarget(preset) {
  return form.servingTemp.value === quickTargetValue(preset);
}

// Handle unit change - convert displayed values
// Note: UnitToggle is bound with :model-value rather than v-model on purpose.
// v-model would assign form.units.value from the same update:modelValue event
// and, being registered first, would run before this handler -- making the
// oldUnit check below always true and silently skipping every conversion.
// This function owns the assignment instead (see the end of the body).
function handleUnitChange(newUnit) {
  const oldUnit = form.units.value;
  
  if (oldUnit === newUnit) return;
  
  // Convert serving temp with 1 decimal for Celsius, whole number for Fahrenheit
  if (form.servingTemp.value !== null) {
    if (newUnit === 'C') {
      form.servingTemp.value = Math.round(fahrenheitToCelsius(form.servingTemp.value) * 10) / 10;
    } else {
      form.servingTemp.value = Math.round(celsiusToFahrenheit(form.servingTemp.value));
    }
  }
  
  // Convert oven temp - whole numbers for both
  if (form.initialOvenTemp.value !== null) {
    if (newUnit === 'C') {
      form.initialOvenTemp.value = Math.round(fahrenheitToCelsius(form.initialOvenTemp.value));
    } else {
      form.initialOvenTemp.value = Math.round(celsiusToFahrenheit(form.initialOvenTemp.value));
    }
  }
  
  // Convert starting temp with 1 decimal for Celsius, whole number for Fahrenheit
  if (form.startingTemp.value !== null) {
    if (newUnit === 'C') {
      form.startingTemp.value = Math.round(fahrenheitToCelsius(form.startingTemp.value) * 10) / 10;
    } else {
      form.startingTemp.value = Math.round(celsiusToFahrenheit(form.startingTemp.value));
    }
  }
  
  // Switch units only after the values above have been converted out of oldUnit
  form.units.value = newUnit;
}

// Select quick target
function selectQuickTarget(preset) {
  form.servingTemp.value = quickTargetValue(preset);
  userHasEditedTarget.value = true;
}

// Handle meat type change
function handleMeatTypeChange() {
  const preset = selectedMeatPreset.value;
  if (!preset) return;
  
  // Auto-populate serving temp, oven temp and rest if not manually edited
  if (!userHasEditedTarget.value) {
    if (form.units.value === 'F') {
      form.servingTemp.value = preset.servingTempF;
    } else {
      form.servingTemp.value = Math.round(fahrenheitToCelsius(preset.servingTempF) * 10) / 10;
    }
  }
  
  // A shoulder rests 30 minutes and a tenderloin 15. Per-preset because it
  // genuinely varies by cut, not as a nicety.
  if (!userHasEditedRest.value && Number.isFinite(preset.restMinutes)) {
    form.restMinutes.value = preset.restMinutes;
  }
  
  if (!userHasEditedOven.value) {
    if (form.units.value === 'F') {
      form.initialOvenTemp.value = preset.suggestedOvenF;
    } else {
      // Whole number for oven temp
      form.initialOvenTemp.value = Math.round(fahrenheitToCelsius(preset.suggestedOvenF));
    }
  }
  
  // Clear cut selection
  form.meatCut.value = '';
}

// Track manual edits
watch(() => form.servingTemp.value, () => {
  if (form.servingTemp.touched) {
    userHasEditedTarget.value = true;
  }
});

watch(() => form.restMinutes.value, () => {
  if (form.restMinutes.touched) {
    userHasEditedRest.value = true;
  }
});

watch(() => form.initialOvenTemp.value, () => {
  if (form.initialOvenTemp.touched) {
    userHasEditedOven.value = true;
  }
});

/**
 * The sheet stays mounted between cooks, so opening it has to rebuild the
 * defaults -- otherwise a cancelled setup leaves a serve time in the past and
 * a unit choice from a cook that never started.
 */
function resetForm() {
  const units = preferredUnits.value;

  form.units.value = units;
  form.servingTemp.value = getInitialServingTemp(units);
  form.restMinutes.value = SESSION_DEFAULTS.REST_MINUTES;
  form.initialOvenTemp.value = getInitialOvenTemp(units);
  form.startingTemp.value = null;
  form.timeInputMode.value = 'serveTime';
  form.meatType.value = '';
  form.meatCut.value = '';
  form.weight.value = null;
  form.notes.value = '';

  Object.values(form).forEach((field) => {
    field.error = '';
    field.touched = false;
  });

  timeRemaining.hours = 4;
  timeRemaining.minutes = 0;

  showMeatDetails.value = false;
  userHasEditedTarget.value = false;
  userHasEditedOven.value = false;
  userHasEditedRest.value = false;

  const fourHoursFromNow = new Date();
  fourHoursFromNow.setHours(fourHoursFromNow.getHours() + 4);
  form.desiredServeTime.value = toLocalInputValue(fourHoursFromNow);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  },
  { immediate: true }
);

// Handle form submission
function handleSubmit() {
  // Mark all fields as touched
  Object.keys(form).forEach(key => {
    if (form[key].touched !== undefined) {
      form[key].touched = true;
    }
  });
  
  // Validate
  if (!isFormValid.value) {
    return;
  }
  
  // Convert temps to Fahrenheit for storage
  const ovenTempF = toStorageUnit(form.initialOvenTemp.value, form.units.value);
  const startingTempF = form.startingTemp.value !== null 
    ? toStorageUnit(form.startingTemp.value, form.units.value) 
    : null;
  
  // Calculate desired serve time
  let desiredServeTime = null;
  if (form.timeInputMode.value === 'serveTime' && form.desiredServeTime.value) {
    desiredServeTime = new Date(form.desiredServeTime.value).toISOString();
  } else if (form.timeInputMode.value === 'remaining') {
    const totalMinutes = (timeRemaining.hours * 60) + timeRemaining.minutes;
    if (totalMinutes > 0) {
      desiredServeTime = addMinutes(new Date().toISOString(), totalMinutes);
    }
  }
  
  // Build config. servingTempF is what the cook chose; pullTempF and carryoverF
  // are derived by createSession from it and the oven temperature, so they are
  // passed explicitly here rather than recomputed there from a stale oven value.
  const config = {
    servingTempF: servingTempF.value,
    pullTempF: pullTempF.value,
    carryoverF: carryoverF.value,
    carryoverIsUserSet: false,
    restMinutes: form.restMinutes.value ?? 0,
    units: form.units.value,
    startingTemp: startingTempF,
    desiredServeTime: desiredServeTime,
    initialOvenTemp: ovenTempF,
    meatType: sanitizeString(form.meatType.value) || null,
    meatCut: sanitizeString(form.meatCut.value) || null,
    weight: form.weight.value || null,
    notes: sanitizeString(form.notes.value) || null
  };
  
  /**
   * The last gate before a session exists.
   *
   * validateSessionConfig had ZERO call sites, so none of its rules had ever
   * run - including the weight bound, and now the pull-below-plate and rest
   * bounds this wave added. A validator nothing calls is a validator whose rules
   * are wrong and nobody knows.
   *
   * Called with °F values, so `units: 'F'` regardless of what the form is in:
   * everything in `config` has already been through toStorageUnit.
   */
  const validation = validateSessionConfig(config, 'F');
  if (!validation.valid) {
    Object.entries(validation.errors).forEach(([field, message]) => {
      // Surface it where the field lives if the form has that field; the derived
      // temperatures have no control of their own, so they land on the one the
      // cook can actually change.
      const target = form[field] ?? form.servingTemp;
      target.error = message;
      target.touched = true;
    });
    return;
  }

  emit('submit', config);
  emit('update:modelValue', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}

// Backdrop, Escape and the close button are all "not now".
function onSheetToggle(open) {
  if (!open) handleCancel();
}
</script>
