<template>
  <Sheet
    :model-value="modelValue"
    title="Settings"
    size="tall"
    @update:model-value="handleClose"
  >
    <template #body>
      <!-- Reference, not a control: the only place in the app the session's
           setup is still visible, so it has to be here, but it stays quiet and
           sits above the things you can actually change. -->
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

      <SettingsSection title="Calculation">
        <SettingsRow
          label="Smoothing window"
          description="Recent readings used to calculate heating rate"
        >
          <NumberStepper
            v-model="localSettings.smoothingWindowReadings"
            :min="2"
            :max="10"
            :step="1"
            label="Readings"
            hide-label
          />
        </SettingsRow>

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

        <SettingsRow
          label="Minimum oven temp"
          description="Lowest temperature the app will suggest, for food safety"
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
          label="Practical minimum oven temp"
          description="Most ovens can't go below ~80°C / 175°F"
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
import { toDisplayUnit, toStorageUnit, formatTemperature } from '../utils/temperatureUtils.js';
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
  }
});

/** Read-only session reference lines. Empty entries are dropped. */
const sessionFacts = computed(() => {
  const cfg = config.value;
  if (!cfg) return [];

  const meat = [cfg.meatType, cfg.meatCut].filter(Boolean).join(' - ');

  return [
    { label: 'Target', value: formatTemperature(cfg.targetTemp, localUnits.value), numeric: true },
    { label: 'Started', value: cfg.createdAt ? formatDateTime(cfg.createdAt) : null, numeric: true },
    { label: 'Meat', value: meat || null, numeric: false },
    {
      label: 'Serve by',
      value: cfg.desiredServeTime ? formatDateTime(cfg.desiredServeTime) : null,
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
    localSettings.ovenTempMinF = toStorageUnit(val, localUnits.value);
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
  // Separate store, separate call. setUnits records the standing preference
  // whether or not a cook is running, and switches the running one when it is.
  if (localUnits.value !== displayUnits.value) {
    setUnits(localUnits.value);
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
