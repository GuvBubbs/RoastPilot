<template>
  <div 
    class="fixed inset-0 z-50 overflow-hidden"
    v-if="modelValue"
    @keydown.esc="handleClose"
  >
    <!-- Backdrop -->
    <div 
      class="absolute inset-0 bg-black/50 transition-opacity"
      @click="handleClose"
      aria-hidden="true"
    />
    
    <!-- Panel -->
    <Transition name="slide-right">
      <div 
        v-if="modelValue"
        class="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white dark:bg-gray-800 shadow-xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 id="settings-title" class="text-lg font-semibold text-gray-900 dark:text-white">Settings</h2>
          <button 
            @click="handleClose"
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Close settings"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <!-- Content -->
        <div class="overflow-y-auto flex-1">
          <!-- Units Section -->
          <SettingsSection title="Display Units">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-700 dark:text-gray-300">Temperature Unit</span>
              <UnitToggle v-model="localSettings.units" />
            </div>
          </SettingsSection>
          
          <!-- Calculation Settings -->
          <SettingsSection title="Calculation Settings">
            <SettingsRow 
              label="Smoothing Window"
              description="Number of recent readings used to calculate heating rate"
            >
              <NumberStepper
                v-model="localSettings.smoothingWindowReadings"
                :min="2"
                :max="10"
                :step="1"
                label="Readings"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="On-Track Threshold"
              description="Minutes of variance considered 'on track'"
            >
              <NumberStepper
                v-model="localSettings.onTrackThresholdMinutes"
                :min="5"
                :max="30"
                :step="5"
                label="Minutes"
                suffix=" min"
              />
            </SettingsRow>
          </SettingsSection>
          
          <!-- Recommendation Settings -->
          <SettingsSection title="Recommendation Settings">
            <SettingsRow 
              label="Default Step Size"
              :description="`Standard temperature adjustment (${localSettings.units === 'F' ? '°F' : '°C'})`"
            >
              <NumberStepper
                v-model="stepSizeDisplay"
                :min="stepSizeMin"
                :max="stepSizeMax"
                :step="5"
                :label="`°${localSettings.units}`"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Maximum Step Size"
              description="Largest single adjustment the app will suggest"
            >
              <NumberStepper
                v-model="maxStepSizeDisplay"
                :min="maxStepMin"
                :max="maxStepMax"
                :step="5"
                :label="`°${localSettings.units}`"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Minimum Readings"
              description="Readings required before showing recommendations"
            >
              <NumberStepper
                v-model="localSettings.minReadingsForRecommendation"
                :min="2"
                :max="10"
                :step="1"
                label="Readings"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Minimum Time Span"
              description="Minutes of data required for recommendations"
            >
              <NumberStepper
                v-model="localSettings.minTimeSpanMinutes"
                :min="15"
                :max="90"
                :step="15"
                label="Minutes"
                suffix=" min"
              />
            </SettingsRow>
          </SettingsSection>
          
          <!-- Safety Bounds -->
          <SettingsSection title="Safety Bounds">
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
              The app will not suggest oven temperatures outside these bounds.
            </p>
            
            <SettingsRow 
              label="Minimum Oven Temp (Food Safety)"
              description="Lowest temperature the app will suggest for food safety"
            >
              <NumberStepper
                v-model="ovenMinDisplay"
                :min="ovenMinBound"
                :max="ovenMaxDisplay - 50"
                :step="10"
                :label="`°${localSettings.units}`"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Practical Minimum Oven Temp"
              description="Most ovens can't go below ~80°C/175°F"
            >
              <NumberStepper
                v-model="ovenPracticalMinDisplay"
                :min="ovenMinDisplay"
                :max="ovenMaxDisplay - 25"
                :step="5"
                :label="`°${localSettings.units}`"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Maximum Oven Temp"
              description="Highest temperature the app will suggest"
            >
              <NumberStepper
                v-model="ovenMaxDisplay"
                :min="ovenMinDisplay + 50"
                :max="ovenMaxBound"
                :step="10"
                :label="`°${localSettings.units}`"
              />
            </SettingsRow>
            
            <SettingsRow 
              label="Enable Low Temperature Recommendations"
              description="Allow recommendations below your oven's practical minimum"
            >
              <label class="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  v-model="localSettings.enableLowTempRecommendations"
                  class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
              </label>
            </SettingsRow>
          </SettingsSection>
          
          <!-- Data Management -->
          <SettingsSection v-if="hasActiveSession" title="Session Data">
            <div class="space-y-3">
              <button
                @click="handleExportJSON"
                class="w-full flex items-center justify-between p-3 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">Export as JSON</span>
                </div>
                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              
              <button
                @click="handleExportCSV"
                class="w-full flex items-center justify-between p-3 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">Export as CSV</span>
                </div>
                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              
              <button
                @click="showClearConfirm = true"
                class="w-full flex items-center justify-between p-3 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span class="text-sm font-medium">Clear Session Data</span>
                </div>
              </button>
            </div>
          </SettingsSection>
          
          <!-- About -->
          <SettingsSection title="About">
            <div class="text-sm text-gray-600 dark:text-gray-400 space-y-2">
              <p><strong class="text-gray-900 dark:text-white">Reverse Sear Temperature Tracker</strong></p>
              <p>Version 1.0.0</p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-4">
                {{ disclaimer }}
              </p>
            </div>
          </SettingsSection>
        </div>
        
        <!-- Footer -->
        <div class="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div class="flex gap-3">
            <button
              @click="handleReset"
              class="flex-1 py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Reset to Defaults
            </button>
            <button
              @click="handleSave"
              class="flex-1 py-2 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </Transition>
    
    <!-- Clear Confirmation Dialog -->
    <ConfirmDialog
      v-model="showClearConfirm"
      title="Clear Session Data?"
      message="This will permanently delete all readings and oven events. This cannot be undone."
      confirmText="Clear Data"
      confirmClass="bg-red-600 hover:bg-red-700"
      @confirm="handleClearSession"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { createDefaultSettings } from '../models/dataModels.js';
import { toDisplayUnit, toStorageUnit } from '../utils/temperatureUtils.js';
import { DISCLAIMER } from '../constants/defaults.js';
import { exportToJSON, exportToCSV, downloadFile, generateFilename } from '../services/exportService.js';

import SettingsSection from './SettingsSection.vue';
import SettingsRow from './SettingsRow.vue';
import NumberStepper from './NumberStepper.vue';
import UnitToggle from './UnitToggle.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);

const { session, settings, updateSettings, endSession, hasActiveSession } = useSession();
const { showToast } = useToast();

const disclaimer = DISCLAIMER;
const showClearConfirm = ref(false);

// Local copy of settings for editing
const localSettings = reactive({ ...settings.value });

// Watch for external settings changes
watch(() => settings.value, (newSettings) => {
  Object.assign(localSettings, newSettings);
}, { deep: true });

// Unit-aware computed properties for temperature bounds
const stepSizeDisplay = computed({
  get: () => localSettings.units === 'C' 
    ? Math.round(localSettings.recommendationStepF * 5 / 9)
    : localSettings.recommendationStepF,
  set: (val) => {
    localSettings.recommendationStepF = localSettings.units === 'C'
      ? Math.round(val * 9 / 5)
      : val;
  }
});

const stepSizeMin = computed(() => localSettings.units === 'C' ? 3 : 5);
const stepSizeMax = computed(() => localSettings.units === 'C' ? 28 : 50);

const maxStepSizeDisplay = computed({
  get: () => localSettings.units === 'C'
    ? Math.round(localSettings.recommendationMaxStepF * 5 / 9)
    : localSettings.recommendationMaxStepF,
  set: (val) => {
    localSettings.recommendationMaxStepF = localSettings.units === 'C'
      ? Math.round(val * 9 / 5)
      : val;
  }
});

const maxStepMin = computed(() => localSettings.units === 'C' ? 8 : 15);
const maxStepMax = computed(() => localSettings.units === 'C' ? 28 : 50);

const ovenMinDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempMinF, localSettings.units),
  set: (val) => {
    localSettings.ovenTempMinF = toStorageUnit(val, localSettings.units);
  }
});

const ovenPracticalMinDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempPracticalMinF, localSettings.units),
  set: (val) => {
    localSettings.ovenTempPracticalMinF = toStorageUnit(val, localSettings.units);
  }
});

const ovenMaxDisplay = computed({
  get: () => toDisplayUnit(localSettings.ovenTempMaxF, localSettings.units),
  set: (val) => {
    localSettings.ovenTempMaxF = toStorageUnit(val, localSettings.units);
  }
});

const ovenMinBound = computed(() => localSettings.units === 'C' ? 65 : 150);
const ovenMaxBound = computed(() => localSettings.units === 'C' ? 175 : 350);

function handleClose() {
  emit('update:modelValue', false);
}

function handleSave() {
  updateSettings(localSettings);
  showToast('Settings saved', 'success');
  handleClose();
}

function handleReset() {
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
/* Slide transition already defined in transitions.css */
</style>

