<template>
  <Sheet
    :model-value="modelValue"
    title="Settings"
    size="tall"
    @update:model-value="handleClose"
  >
    <template #body>
      <!-- The cook plan. EDITABLE, and first.
           The advice band's `no_serve_time` blocker used to offer a button that
           opened this sheet - which had no serve-time control anywhere in it. A
           blocker whose one action leads somewhere that cannot clear it is a
           dead end, and this is the section that fixes it.

           Pull / Rest / Serve, the same vocabulary as the status band and the
           chart. The cook states the plate temperature; the pull is derived. -->
      <SettingsSection v-if="hasActiveSession" title="Cook plan">
        <SettingsRow
          label="Serve time"
          description="When you want to eat. Without it the app can't tell you whether you're early or late."
        >
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="localServeTime"
              type="datetime-local"
              class="field flex-1 min-w-0"
              aria-label="Serve time"
            />
            <button
              v-if="localServeTime"
              type="button"
              class="chip tap shrink-0"
              @click="localServeTime = ''"
            >
              Clear
            </button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="On the plate"
          :description="`What you want to eat, in °${localUnits}. The oven target is worked back from this.`"
        >
          <NumberStepper
            v-model="localServingTemp"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            :step="1"
            :min="localUnits === 'C' ? 0 : 32"
            :max="localUnits === 'C' ? 100 : 212"
          />
        </SettingsRow>

        <SettingsRow
          label="Carryover"
          :description="carryoverDescription"
        >
          <div class="flex flex-wrap items-center gap-2">
            <NumberStepper
              v-model="localCarryover"
              :label="`°${localUnits}`"
              :suffix="`°${localUnits}`"
              :step="1"
              :min="0"
              :max="localUnits === 'C' ? 11 : 20"
            />
            <button
              v-if="localCarryoverIsUserSet"
              type="button"
              class="chip tap shrink-0"
              @click="resetCarryover"
            >
              Use estimate
            </button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Rest"
          description="Minutes on the board before carving. Subtracted from the serve time to get the moment the meat must be out of the oven."
        >
          <NumberStepper
            v-model="localRestMinutes"
            label="min"
            suffix="min"
            :step="5"
            :min="0"
            :max="90"
          />
        </SettingsRow>

        <!-- The derived line. Everything above is an input; this is what the
             app will actually steer to, so it is stated rather than implied. -->
        <!-- "Pull at 121°F, rest 20 min, serve at 125°F" reads as though the
             last figure were a time. Naming what each number describes keeps a
             temperature from being mistaken for a clock. -->
        <p class="pt-3 text-[13px] text-ink-dim">
          Out of the oven at <span class="num text-ink">{{ localPullText }}</span>,
          <span class="num text-ink">{{ localRestMinutes || 0 }} min</span> on the board,
          <span class="num text-ink">{{ localServingText }}</span> on the plate.
        </p>
      </SettingsSection>

      <!-- Reference, not a control: what is left of the setup that is not part
           of the plan above. -->
      <SettingsSection v-if="hasActiveSession && sessionFacts.length" title="This session">
        <dl>
          <div
            v-for="fact in sessionFacts"
            :key="fact.label"
            class="flex items-baseline justify-between gap-3 py-2 border-b border-rule last:border-b-0"
          >
            <dt class="shrink-0 text-[13px] text-ink-dim">{{ fact.label }}</dt>
            <dd class="min-w-0 text-[14px] text-ink text-right truncate" :class="fact.numeric ? 'num' : ''">
              {{ fact.value }}
            </dd>
          </div>
        </dl>
      </SettingsSection>

      <SettingsSection title="Display units">
        <SettingsRow
          label="Temperature"
          :description="hasActiveSession
            ? 'Applies everywhere, and to your next cook'
            : 'Applies to your next cook'"
          inline
        >
          <UnitToggle v-model="localUnits" />
        </SettingsRow>
      </SettingsSection>

      <!-- The "Smoothing window" control lived here, setting how many recent
           readings went into the rate fit. There is no window any more: the
           thermal model fits every reading, because the EARLY ones carry the
           curvature that identifies how fast this particular roast heats, and
           discarding them leaves the fit unable to tell an accelerating roast
           from a decelerating one.

           Removed rather than left in place. A control a user can change and see
           nothing happen is worse than no control. -->
      <SettingsSection title="Calculation">
        <SettingsRow
          label="On-track threshold"
          description="Minutes of variance still counted as on track"
        >
          <NumberStepper
            v-model="localSettings.onTrackThresholdMinutes"
            :min="5"
            :max="30"
            :step="5"
            label="Minutes"
            suffix="min"
            hide-label
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Recommendations">
        <SettingsRow
          label="Default step size"
          :description="`Standard oven adjustment (°${localUnits})`"
        >
          <NumberStepper
            v-model="stepSizeDisplay"
            :min="stepSizeMin"
            :max="stepSizeMax"
            :step="5"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Maximum step size"
          description="Largest single adjustment the app will suggest"
        >
          <NumberStepper
            v-model="maxStepSizeDisplay"
            :min="maxStepMin"
            :max="maxStepMax"
            :step="5"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Minimum readings"
          description="Readings required before showing a recommendation"
        >
          <NumberStepper
            v-model="localSettings.minReadingsForRecommendation"
            :min="2"
            :max="10"
            :step="1"
            label="Readings"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Minimum time span"
          description="Minutes of data required for a recommendation"
        >
          <NumberStepper
            v-model="localSettings.minTimeSpanMinutes"
            :min="15"
            :max="90"
            :step="15"
            label="Minutes"
            suffix="min"
            hide-label
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Safety bounds">
        <p class="mb-1 text-[12px] leading-snug text-ink-mute">
          The app will not suggest oven temperatures outside these bounds.
        </p>

        <!-- This is a floor on the floor, not on the suggestion. The app will
             not suggest below the PRACTICAL minimum below, which is higher - so
             describing this one as "the lowest temperature the app will suggest"
             was false, and the code that made it true was an unreachable branch
             in calculateRecommendation that has been deleted. What it does do is
             stop the practical minimum being set into unsafe territory. -->
        <SettingsRow
          label="Absolute floor"
          description="The practical minimum below cannot be set under this"
        >
          <NumberStepper
            v-model="ovenMinDisplay"
            :min="ovenMinBound"
            :max="ovenMaxDisplay - 50"
            :step="10"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Lowest oven temp to suggest"
          description="The floor that actually binds. Most ovens can't go below ~80°C / 175°F"
        >
          <NumberStepper
            v-model="ovenPracticalMinDisplay"
            :min="ovenMinDisplay"
            :max="ovenMaxDisplay - 25"
            :step="5"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Maximum oven temp"
          description="Highest temperature the app will suggest"
        >
          <NumberStepper
            v-model="ovenMaxDisplay"
            :min="ovenMinDisplay + 50"
            :max="ovenMaxBound"
            :step="10"
            :label="`°${localUnits}`"
            :suffix="`°${localUnits}`"
            hide-label
          />
        </SettingsRow>

        <SettingsRow
          label="Allow low-temperature suggestions"
          description="Permit recommendations below your oven's practical minimum"
          inline
        >
          <!-- The label is the 44px target; the box itself is 24px. -->
          <label class="tap cursor-pointer">
            <input
              type="checkbox"
              v-model="localSettings.enableLowTempRecommendations"
              class="w-6 h-6 rounded border border-rule bg-raised accent-heat-warm"
            />
            <span class="sr-only">Allow low-temperature suggestions</span>
          </label>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection v-if="hasActiveSession" title="Session data">
        <button type="button" @click="handleExportJSON" class="data-row">
          <span class="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">Export as JSON</span>
          <svg class="w-4 h-4 shrink-0 text-ink-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        <button type="button" @click="handleExportCSV" class="data-row">
          <span class="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">Export as CSV</span>
          <svg class="w-4 h-4 shrink-0 text-ink-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        <button type="button" @click="showClearConfirm = true" class="data-row">
          <span class="min-w-0 flex-1 truncate text-[14px] font-medium text-danger">Clear session data</span>
        </button>
      </SettingsSection>

      <!-- Moved out of the header, where it wrapped to two lines at 390px. -->
      <SettingsSection v-if="hasActiveSession" title="End cook">
        <p class="mb-3 text-[12px] leading-snug text-ink-mute">
          Finishes this session. You get a chance to export first.
        </p>
        <button type="button" class="btn-danger" @click="handleEndSession">
          End session
        </button>
      </SettingsSection>

      <SettingsSection title="About">
        <p class="text-[14px] text-ink">RoastPilot</p>
        <p class="text-[13px] text-ink-mute num">Version {{ appVersion }}</p>
        <p class="text-[12px] text-ink-mute">{{ appBuildLabel }}</p>
      </SettingsSection>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" @click="handleReset" class="btn-ghost flex-1">
          Reset defaults
        </button>
        <button type="button" @click="handleSave" class="btn-primary flex-1">
          Save changes
        </button>
      </div>
    </template>
  </Sheet>

  <!-- Clear Confirmation Dialog -->
  <ConfirmDialog
    v-model="showClearConfirm"
    title="Clear Session Data?"
    message="This will permanently delete all readings and oven events. This cannot be undone."
    confirmText="Clear Data"
    confirmClass="bg-danger active:bg-[#b9351f]"
    @confirm="handleClearSession"
  />
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { createDefaultSettings } from '../models/dataModels.js';
import {
  toDisplayUnit, toStorageUnit, formatTemperature,
  fahrenheitToCelsius, celsiusToFahrenheit, weightToDisplay
} from '../utils/temperatureUtils.js';
import { estimateCarryoverF, pullTempFor } from '../services/carryoverService.js';
import { storageService as weightStore } from '../services/storageService.js';
import { formatDateTime } from '../utils/timeUtils.js';
import { exportToJSON, exportToCSV, downloadFile, generateFilename } from '../services/exportService.js';
import { APP_VERSION, buildLabel } from '../config/version.js';

import Sheet from './Sheet.vue';
import SettingsSection from './SettingsSection.vue';
import SettingsRow from './SettingsRow.vue';
import NumberStepper from './NumberStepper.vue';
import UnitToggle from './UnitToggle.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue', 'end-session']);

const {
  session,
  config,
  settings,
  updateSettings,
  updateConfig,
  setUnits,
  displayUnits,
  preferredUnits,
  endSession,
  hasActiveSession
} = useSession();
const { showToast } = useToast();

const showClearConfirm = ref(false);

// Fixed for the life of the bundle — no need for reactivity.
const appVersion = APP_VERSION;
const appBuildLabel = buildLabel();

// Local copy of settings for editing
const localSettings = reactive({ ...settings.value });

// Units are NOT part of settings — the single source of truth is
// session.config.units (read via displayUnits, written via setUnits).
// This is a staged copy so the toggle only takes effect on save, like every
// other control in this sheet.
// `displayUnits` is 'F' with no session; `preferredUnits` is the persisted
// choice, which is the honest thing to show in that state.
const localUnits = ref(hasActiveSession.value ? displayUnits.value : preferredUnits.value);

/**
 * The cook plan, staged like everything else in this sheet: nothing reaches the
 * session until Save. Held as display-unit numbers plus a `datetime-local`
 * string, and converted on the way out.
 */
const localServeTime = ref('');
const localServingTemp = ref(null);
const localCarryover = ref(null);
const localCarryoverIsUserSet = ref(false);
const localRestMinutes = ref(0);

/** ISO instant -> the local-time `YYYY-MM-DDTHH:mm` a datetime-local wants. */
function toLocalInputValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Carryover is a DELTA, so it converts without the 32° offset. */
const carryoverToDisplay = (raw, units) =>
  units === 'C' ? Math.round((raw * 5 / 9) * 10) / 10 : raw;
const carryoverToStorage = (value, units) =>
  units === 'C' ? Math.round(value * 9 / 5) : Math.round(value);

function seedCookPlan() {
  const cfg = config.value;
  if (!cfg) return;
  localServeTime.value = toLocalInputValue(cfg.desiredServeTime);
  localServingTemp.value = Number.isFinite(cfg.servingTempF)
    ? toDisplayUnit(cfg.servingTempF, localUnits.value)
    : null;
  localCarryover.value = Number.isFinite(cfg.carryoverF)
    ? carryoverToDisplay(cfg.carryoverF, localUnits.value)
    : carryoverToDisplay(estimateCarryoverF(cfg.initialOvenTemp), localUnits.value);
  localCarryoverIsUserSet.value = cfg.carryoverIsUserSet === true;
  localRestMinutes.value = Number.isFinite(cfg.restMinutes) ? cfg.restMinutes : 0;
}

/** The app's own estimate for this session's oven, in display units. */
const estimatedCarryoverDisplay = computed(() =>
  carryoverToDisplay(estimateCarryoverF(config.value?.initialOvenTemp), localUnits.value)
);

const carryoverDescription = computed(() => {
  const estimate = `+${estimatedCarryoverDisplay.value}°${localUnits.value}`;
  return localCarryoverIsUserSet.value
    ? `Your value. The app's estimate for a ${formatTemperature(config.value?.initialOvenTemp ?? 0, localUnits.value)} oven is ${estimate}.`
    : `How much further the core climbs off the heat. Estimated at ${estimate} for this oven - a rough figure, worth overriding if you have measured your own.`;
});

const localPullText = computed(() => {
  if (localServingTemp.value === null) return '--';
  const servingF = toStorageUnit(localServingTemp.value, localUnits.value);
  const carryF = carryoverToStorage(localCarryover.value ?? 0, localUnits.value);
  return formatTemperature(pullTempFor(servingF, carryF), localUnits.value);
});

const localServingText = computed(() =>
  localServingTemp.value === null
    ? '--'
    : `${localServingTemp.value}°${localUnits.value}`
);

function resetCarryover() {
  localCarryover.value = estimatedCarryoverDisplay.value;
  localCarryoverIsUserSet.value = false;
}

// Any hand edit of the carryover makes it the cook's number, and no later
// re-estimate touches it. Watched rather than bound to an input handler so the
// stepper's own +/- buttons count too.
watch(localCarryover, (value, previous) => {
  if (previous === null || value === null) return;
  if (value !== previous) localCarryoverIsUserSet.value = true;
});

// Watch for external settings changes
watch(() => settings.value, (newSettings) => {
  Object.assign(localSettings, newSettings);
}, { deep: true });

watch(displayUnits, (units) => {
  if (hasActiveSession.value) localUnits.value = units;
});

// Re-seed on open: an abandoned edit shouldn't survive to the next open.
watch(() => props.modelValue, (open) => {
  if (open) {
    Object.assign(localSettings, settings.value);
    localUnits.value = hasActiveSession.value ? displayUnits.value : preferredUnits.value;
    seedCookPlan();
  }
}, { immediate: true });

// Switching the unit toggle has to re-express the staged plan in the new unit,
// or Save would write the Fahrenheit number as a Celsius one.
watch(localUnits, (units, previous) => {
  if (!previous || units === previous) return;
  if (localServingTemp.value !== null) {
    localServingTemp.value = units === 'C'
      ? Math.round(fahrenheitToCelsius(localServingTemp.value) * 10) / 10
      : Math.round(celsiusToFahrenheit(localServingTemp.value));
  }
  if (localCarryover.value !== null) {
    const asF = carryoverToStorage(localCarryover.value, previous);
    localCarryover.value = carryoverToDisplay(asF, units);
  }
});

/** Read-only session reference lines. Empty entries are dropped. */
const sessionFacts = computed(() => {
  const cfg = config.value;
  if (!cfg) return [];
  const weightUnit = weightStore.loadWeightUnit() ?? 'lb';

  const meat = [cfg.meatType, cfg.meatCut].filter(Boolean).join(' - ');

  // Pull, serve, rest and carryover are all editable in the Cook plan section
  // above, so repeating them here would be two readouts of the same value that
  // can disagree while an edit is staged.
  return [
    { label: 'Started', value: cfg.createdAt ? formatDateTime(cfg.createdAt) : null, numeric: true },
    { label: 'Meat', value: meat || null, numeric: false },
    {
      label: 'Weight',
      // Shown in the cook's own unit. Stored canonically in pounds; the display
      // preference is standing and independent of the temperature scale.
      value: cfg.weight
        ? `${weightToDisplay(cfg.weight, weightUnit)} ${weightUnit}`
        : null,
      numeric: true
    },
    {
      label: 'Started at',
      value: Number.isFinite(cfg.startingTemp)
        ? formatTemperature(cfg.startingTemp, localUnits.value)
        : null,
      numeric: true
    }
  ].filter((fact) => Boolean(fact.value));
});

// Unit-aware computed properties for temperature bounds. Every one of these
// reads localUnits — a stale unit here silently corrupts the stored °F values.
const stepSizeDisplay = computed({
  get: () => localUnits.value === 'C'
    ? Math.round(localSettings.recommendationStepF * 5 / 9)
    : localSettings.recommendationStepF,
  set: (val) => {
    localSettings.recommendationStepF = localUnits.value === 'C'
      ? Math.round(val * 9 / 5)
      : val;
  }
});

const stepSizeMin = computed(() => localUnits.value === 'C' ? 3 : 5);
const stepSizeMax = computed(() => localUnits.value === 'C' ? 28 : 50);

const maxStepSizeDisplay = computed({
  get: () => localUnits.value === 'C'
    ? Math.round(localSettings.recommendationMaxStepF * 5 / 9)
    : localSettings.recommendationMaxStepF,
  set: (val) => {
    localSettings.recommendationMaxStepF = localUnits.value === 'C'
      ? Math.round(val * 9 / 5)
      : val;
  }
});

const maxStepMin = computed(() => localUnits.value === 'C' ? 8 : 15);
const maxStepMax = computed(() => localUnits.value === 'C' ? 28 : 50);

const ovenMinDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempMinF, localUnits.value),
  set: (val) => {
    const floorF = toStorageUnit(val, localUnits.value);
    localSettings.ovenTempMinF = floorF;
    /**
     * Push the practical minimum up with it. The row below is bounded by
     * `:min="ovenMinDisplay"`, but a stepper's min only constrains the next edit -
     * it does not move a value already stored. So raising this floor to 250 while
     * the practical minimum sat at 175 left the app advising "lower to 225", below
     * the floor the cook had just set, with this row still describing itself as
     * "The practical minimum below cannot be set under this".
     *
     * This is the cross-field rule `validateSettings` used to carry. That function
     * was deleted as dead - its bounds really are enforced by the stepper props -
     * but this one rule was not a bound, and nothing replaced it.
     */
    if (localSettings.ovenTempPracticalMinF < floorF) {
      localSettings.ovenTempPracticalMinF = floorF;
    }
  }
});

const ovenPracticalMinDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempPracticalMinF, localUnits.value),
  set: (val) => {
    localSettings.ovenTempPracticalMinF = toStorageUnit(val, localUnits.value);
  }
});

const ovenMaxDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempMaxF, localUnits.value),
  set: (val) => {
    localSettings.ovenTempMaxF = toStorageUnit(val, localUnits.value);
  }
});

const ovenMinBound = computed(() => localUnits.value === 'C' ? 65 : 150);
const ovenMaxBound = computed(() => localUnits.value === 'C' ? 175 : 350);

function handleClose() {
  emit('update:modelValue', false);
}

// App.vue closes this sheet and owns the confirmation dialog, so this only
// announces the intent.
function handleEndSession() {
  emit('end-session');
}

function handleSave() {
  updateSettings(localSettings);
  
  // Units BEFORE the config write. updateConfig stores Fahrenheit either way,
  // but toStorageUnit below reads localUnits, and the two must describe the same
  // unit at the moment of conversion.
  if (localUnits.value !== displayUnits.value) {
    setUnits(localUnits.value);
  }
  
  if (hasActiveSession.value) {
    const carryoverF = carryoverToStorage(localCarryover.value ?? 0, localUnits.value);
    const servingTempF = localServingTemp.value === null
      ? config.value?.servingTempF
      : toStorageUnit(localServingTemp.value, localUnits.value);
    
    updateConfig({
      desiredServeTime: localServeTime.value
        ? new Date(localServeTime.value).toISOString()
        : null,
      servingTempF,
      // Derived, never stored independently of the pair it comes from.
      pullTempF: pullTempFor(servingTempF, carryoverF),
      carryoverF,
      carryoverIsUserSet: localCarryoverIsUserSet.value,
      restMinutes: localRestMinutes.value ?? 0
    });
  }
  
  showToast('Settings saved', 'success');
  handleClose();
}

function handleReset() {
  // Units are not part of createDefaultSettings(), so the toggle is untouched.
  const defaults = createDefaultSettings();
  Object.assign(localSettings, defaults);
  showToast('Settings reset to defaults', 'info');
}

function handleExportJSON() {
  if (!session.value) return;
  const data = exportToJSON(session.value);
  const filename = generateFilename('roast-session', 'json');
  downloadFile(data, filename, 'application/json');
  showToast('Session exported as JSON', 'success');
}

function handleExportCSV() {
  if (!session.value) return;
  const data = exportToCSV(session.value);
  const filename = generateFilename('roast-session', 'csv');
  downloadFile(data, filename, 'text/csv');
  showToast('Session exported as CSV', 'success');
}

function handleClearSession() {
  endSession();
  showClearConfirm.value = false;
  showToast('Session data cleared', 'info');
  handleClose();
}
</script>

<style scoped>
/* Full-bleed tap row. Not `.row`, which carries its own horizontal gutter —
   the Sheet body already owns that. */
.data-row {
  @apply flex w-full items-center gap-3 text-left;
  @apply border-b border-rule last:border-b-0;
  min-height: 44px;
  @apply transition-colors duration-150 active:bg-raised;
}
</style>
