# Phase 7: Settings, Export & Polish

## Phase Objectives

Implement the settings panel allowing users to customize application behavior, create robust data export functionality for session backup and analysis, add PWA features for offline capability and home screen installation, and polish the overall user experience with accessibility improvements, error handling, and performance optimizations.

## Prerequisites

Phases 1-6 must be complete, providing the full feature set requiring configuration and data to export.

## Deliverables

1. Settings panel with all configurable options
2. CSV and JSON export functionality with download triggers
3. PWA service worker and offline support
4. Session management (clear, reset) capabilities
5. Accessibility audit and improvements
6. Performance optimizations and loading states
7. Error boundary and graceful error handling
8. Final UI polish and animations

---

## Task 7.1: Settings Panel Component

### Description

Create a comprehensive settings panel that allows users to customize all configurable aspects of the application, including units, calculation parameters, recommendation thresholds, and safety bounds.

### File: /src/components/SettingsPanel.vue

```javascript
<template>
  <div 
    class="fixed inset-0 z-50 overflow-hidden"
    v-if="modelValue"
  >
    <!-- Backdrop -->
    <div 
      class="absolute inset-0 bg-black/50 transition-opacity"
      @click="handleClose"
    />
    
    <!-- Panel -->
    <div 
      class="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl transform transition-transform"
      :class="modelValue ? 'translate-x-0' : 'translate-x-full'"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-lg font-semibold">Settings</h2>
        <button 
          @click="handleClose"
          class="p-2 hover:bg-gray-100 rounded-lg"
          aria-label="Close settings"
        >
          <XIcon class="w-5 h-5" />
        </button>
      </div>
      
      <!-- Content -->
      <div class="overflow-y-auto h-full pb-32">
        <!-- Units Section -->
        <SettingsSection title="Display Units">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700">Temperature Unit</span>
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
              class="w-24"
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
              class="w-28"
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
              :label="`Step (°${localSettings.units})`"
              class="w-28"
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
              :label="`Max (°${localSettings.units})`"
              class="w-28"
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
              class="w-24"
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
              class="w-28"
            />
          </SettingsRow>
        </SettingsSection>
        
        <!-- Safety Bounds -->
        <SettingsSection title="Safety Bounds">
          <p class="text-xs text-gray-500 mb-4">
            The app will not suggest oven temperatures outside these bounds.
          </p>
          
          <SettingsRow 
            label="Minimum Oven Temp"
            description="Lowest temperature the app will suggest"
          >
            <NumberStepper
              v-model="ovenMinDisplay"
              :min="ovenMinBound"
              :max="ovenMaxDisplay - 50"
              :step="10"
              :label="`Min (°${localSettings.units})`"
              class="w-28"
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
              :label="`Max (°${localSettings.units})`"
              class="w-28"
            />
          </SettingsRow>
        </SettingsSection>
        
        <!-- Data Management -->
        <SettingsSection title="Session Data">
          <div class="space-y-3">
            <button
              @click="handleExportJSON"
              class="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50"
            >
              <div class="flex items-center gap-3">
                <FileJsonIcon class="w-5 h-5 text-gray-400" />
                <span class="text-sm font-medium">Export as JSON</span>
              </div>
              <DownloadIcon class="w-4 h-4 text-gray-400" />
            </button>
            
            <button
              @click="handleExportCSV"
              class="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50"
            >
              <div class="flex items-center gap-3">
                <FileSpreadsheetIcon class="w-5 h-5 text-gray-400" />
                <span class="text-sm font-medium">Export as CSV</span>
              </div>
              <DownloadIcon class="w-4 h-4 text-gray-400" />
            </button>
            
            <button
              @click="showClearConfirm = true"
              class="w-full flex items-center justify-between p-3 rounded-lg border border-red-200 hover:bg-red-50 text-red-600"
            >
              <div class="flex items-center gap-3">
                <Trash2Icon class="w-5 h-5" />
                <span class="text-sm font-medium">Clear Session Data</span>
              </div>
            </button>
          </div>
        </SettingsSection>
        
        <!-- About -->
        <SettingsSection title="About">
          <div class="text-sm text-gray-600 space-y-2">
            <p><strong>Reverse Sear Tracker</strong></p>
            <p>Version 1.0.0</p>
            <p class="text-xs text-gray-400 mt-4">
              {{ disclaimer }}
            </p>
          </div>
        </SettingsSection>
      </div>
      
      <!-- Footer -->
      <div class="absolute bottom-0 left-0 right-0 p-4 bg-white border-t">
        <div class="flex gap-3">
          <button
            @click="handleReset"
            class="flex-1 py-2 px-4 rounded-lg border text-gray-600 hover:bg-gray-50"
          >
            Reset to Defaults
          </button>
          <button
            @click="handleSave"
            class="flex-1 py-2 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
    
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
import { toDisplayUnit, toStorageUnit, fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { DISCLAIMER } from '../constants/defaults.js';
import {
  XIcon,
  DownloadIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  Trash2Icon
} from 'lucide-vue-next';

import SettingsSection from './SettingsSection.vue';
import SettingsRow from './SettingsRow.vue';
import NumberStepper from './NumberStepper.vue';
import UnitToggle from './UnitToggle.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);

const { settings, updateSettings, exportSession, endSession } = useSession();
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
  const data = exportSession('json');
  downloadFile(data, 'roast-session.json', 'application/json');
  showToast('Session exported as JSON', 'success');
}

function handleExportCSV() {
  const data = exportSession('csv');
  downloadFile(data, 'roast-session.csv', 'text/csv');
  showToast('Session exported as CSV', 'success');
}

function handleClearSession() {
  endSession();
  showClearConfirm.value = false;
  showToast('Session data cleared', 'info');
  handleClose();
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
</script>
```

---

## Task 7.2: Settings Sub-Components

### Description

Create helper components for the settings panel to maintain clean organization and reusability.

### File: /src/components/SettingsSection.vue

```javascript
<template>
  <div class="border-b last:border-b-0">
    <div class="px-4 py-3 bg-gray-50">
      <h3 class="text-sm font-semibold text-gray-600 uppercase tracking-wide">
        {{ title }}
      </h3>
    </div>
    <div class="p-4">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true }
});
</script>
```

### File: /src/components/SettingsRow.vue

```javascript
<template>
  <div class="flex items-center justify-between py-3 border-b last:border-b-0">
    <div class="flex-1 pr-4">
      <div class="text-sm font-medium text-gray-700">{{ label }}</div>
      <div v-if="description" class="text-xs text-gray-500 mt-0.5">{{ description }}</div>
    </div>
    <div class="flex-shrink-0">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  description: { type: String, default: '' }
});
</script>
```

### File: /src/components/ConfirmDialog.vue

```javascript
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="handleCancel" />
        <div class="relative bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
          <h3 class="text-lg font-semibold text-gray-900">{{ title }}</h3>
          <p class="mt-2 text-sm text-gray-600">{{ message }}</p>
          <div class="mt-6 flex gap-3">
            <button
              @click="handleCancel"
              class="flex-1 py-2 px-4 rounded-lg border text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              @click="handleConfirm"
              class="flex-1 py-2 px-4 rounded-lg text-white"
              :class="confirmClass"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, default: 'Confirm' },
  confirmClass: { type: String, default: 'bg-blue-600 hover:bg-blue-700' }
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

function handleConfirm() {
  emit('confirm');
  emit('update:modelValue', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
```

---

## Task 7.3: Export Service Enhancement

### Description

Enhance the export functionality with additional formats and metadata.

### File: /src/services/exportService.js

```javascript
import { formatDateTime, formatDuration } from '../utils/timeUtils.js';
import { formatTemperature, toDisplayUnit } from '../utils/temperatureUtils.js';

/**
 * Generate a comprehensive JSON export of the session
 * @param {Session} session
 * @returns {string} Formatted JSON string
 */
export function exportToJSON(session) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    session: {
      config: session.config,
      readings: session.readings,
      ovenEvents: session.ovenEvents,
      settings: session.settings
    },
    summary: generateSessionSummary(session)
  };
  
  return JSON.stringify(exportData, null, 2);
}

/**
 * Generate a CSV export optimized for spreadsheet analysis
 * @param {Session} session
 * @returns {string} CSV content
 */
export function exportToCSV(session) {
  const units = session.config.units;
  const lines = [];
  
  // Metadata section
  lines.push('# Reverse Sear Tracker - Session Export');
  lines.push(`# Exported: ${formatDateTime(new Date().toISOString())}`);
  lines.push('');
  
  // Configuration
  lines.push('## Session Configuration');
  lines.push(`Target Temperature,${toDisplayUnit(session.config.targetTemp, units)},°${units}`);
  lines.push(`Initial Oven Temp,${toDisplayUnit(session.config.initialOvenTemp, units)},°${units}`);
  lines.push(`Started,${formatDateTime(session.config.createdAt)}`);
  if (session.config.desiredServeTime) {
    lines.push(`Target Serve Time,${formatDateTime(session.config.desiredServeTime)}`);
  }
  if (session.config.meatType) {
    lines.push(`Meat Type,${session.config.meatType}`);
  }
  if (session.config.meatCut) {
    lines.push(`Cut,${session.config.meatCut}`);
  }
  if (session.config.weight) {
    lines.push(`Weight,${session.config.weight},lbs`);
  }
  if (session.config.notes) {
    lines.push(`Notes,"${session.config.notes.replace(/"/g, '""')}"`);
  }
  lines.push('');
  
  // Internal readings table
  lines.push('## Internal Temperature Readings');
  lines.push(`Timestamp,Time,Temperature (°${units}),Delta From Start,Delta From Previous,Minutes Elapsed`);
  
  const startTime = session.readings.length > 0 
    ? new Date(session.readings[0].timestamp).getTime()
    : 0;
  
  session.readings.forEach(r => {
    const time = formatDateTime(r.timestamp);
    const temp = toDisplayUnit(r.temp, units);
    const deltaStart = r.deltaFromStart !== null 
      ? toDisplayUnit(r.deltaFromStart + (units === 'C' ? 32 : 0), units) - toDisplayUnit(32, units)
      : '';
    const deltaPrev = r.deltaFromPrevious !== null
      ? toDisplayUnit(r.deltaFromPrevious + (units === 'C' ? 32 : 0), units) - toDisplayUnit(32, units)
      : '';
    const elapsed = Math.round((new Date(r.timestamp).getTime() - startTime) / 60000);
    
    lines.push(`${r.timestamp},${time},${temp},${deltaStart},${deltaPrev},${elapsed}`);
  });
  lines.push('');
  
  // Oven events table
  lines.push('## Oven Temperature Events');
  lines.push(`Timestamp,Time,Set Temperature (°${units}),Previous Temperature,Change`);
  
  session.ovenEvents.forEach(e => {
    const time = formatDateTime(e.timestamp);
    const setTemp = toDisplayUnit(e.setTemp, units);
    const prevTemp = e.previousTemp !== null ? toDisplayUnit(e.previousTemp, units) : '';
    const change = e.previousTemp !== null 
      ? setTemp - toDisplayUnit(e.previousTemp, units)
      : '';
    
    lines.push(`${e.timestamp},${time},${setTemp},${prevTemp},${change}`);
  });
  
  return lines.join('\n');
}

/**
 * Generate a summary of the session for export metadata
 */
function generateSessionSummary(session) {
  const readings = session.readings;
  const events = session.ovenEvents;
  
  if (readings.length === 0) {
    return {
      totalReadings: 0,
      totalOvenChanges: events.length,
      sessionDuration: null
    };
  }
  
  const firstReading = readings[0];
  const lastReading = readings[readings.length - 1];
  const durationMs = new Date(lastReading.timestamp) - new Date(firstReading.timestamp);
  
  return {
    totalReadings: readings.length,
    totalOvenChanges: events.length,
    sessionDurationMinutes: Math.round(durationMs / 60000),
    startingTemp: firstReading.temp,
    endingTemp: lastReading.temp,
    totalTempChange: lastReading.temp - firstReading.temp,
    averageReadingInterval: readings.length > 1 
      ? Math.round(durationMs / (readings.length - 1) / 60000)
      : null
  };
}

/**
 * Trigger a file download
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Generate a timestamped filename
 * @param {string} baseName
 * @param {string} extension
 * @returns {string}
 */
export function generateFilename(baseName, extension) {
  const date = new Date();
  const timestamp = date.toISOString().slice(0, 10);
  return `${baseName}-${timestamp}.${extension}`;
}
```

---

## Task 7.4: PWA Configuration and Service Worker

### Description

Configure the Progressive Web App features including service worker, manifest, and offline support.

### File: vite.config.js (PWA section)

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Reverse Sear Temperature Tracker',
        short_name: 'Roast Tracker',
        description: 'Track and predict cooking temperatures for perfect reverse sear results',
        theme_color: '#dc2626',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
```

### File: /src/composables/usePWA.js

```javascript
import { ref, onMounted } from 'vue';

export function usePWA() {
  const needRefresh = ref(false);
  const offlineReady = ref(false);
  const canInstall = ref(false);
  let deferredPrompt = null;
  
  onMounted(() => {
    // Handle PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      canInstall.value = true;
    });
    
    // Handle successful installation
    window.addEventListener('appinstalled', () => {
      canInstall.value = false;
      deferredPrompt = null;
    });
    
    // Check if running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      canInstall.value = false;
    }
  });
  
  async function installPWA() {
    if (!deferredPrompt) return false;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    deferredPrompt = null;
    canInstall.value = false;
    
    return outcome === 'accepted';
  }
  
  function updateServiceWorker() {
    // This will be connected to the VitePWA update mechanism
    needRefresh.value = false;
    window.location.reload();
  }
  
  return {
    needRefresh,
    offlineReady,
    canInstall,
    installPWA,
    updateServiceWorker
  };
}
```

---

## Task 7.5: Offline Indicator Component

### Description

Create a component that indicates offline status and prompts for PWA installation.

### File: /src/components/OfflineIndicator.vue

```javascript
<template>
  <Transition name="slide">
    <div 
      v-if="isOffline"
      class="fixed bottom-4 left-4 right-4 z-40 bg-amber-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3"
    >
      <WifiOffIcon class="w-5 h-5 flex-shrink-0" />
      <span class="text-sm font-medium">You're offline. Data is saved locally.</span>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { WifiOffIcon } from 'lucide-vue-next';

const isOffline = ref(!navigator.onLine);

function updateOnlineStatus() {
  isOffline.value = !navigator.onLine;
}

onMounted(() => {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
});

onUnmounted(() => {
  window.removeEventListener('online', updateOnlineStatus);
  window.removeEventListener('offline', updateOnlineStatus);
});
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
```

---

## Task 7.6: Error Boundary Component

### Description

Create an error boundary component that catches and handles rendering errors gracefully.

### File: /src/components/ErrorBoundary.vue

```javascript
<template>
  <slot v-if="!error" />
  <div v-else class="min-h-screen flex items-center justify-center p-4 bg-gray-50">
    <div class="max-w-md w-full bg-white rounded-xl shadow-lg p-6 text-center">
      <AlertCircleIcon class="w-16 h-16 text-red-500 mx-auto mb-4" />
      <h2 class="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h2>
      <p class="text-gray-600 mb-6">
        The app encountered an unexpected error. Your data is safely stored.
      </p>
      <div class="space-y-3">
        <button
          @click="handleRetry"
          class="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
        <button
          @click="handleReset"
          class="w-full py-2 px-4 border text-gray-600 rounded-lg hover:bg-gray-50"
        >
          Reset App
        </button>
      </div>
      <details class="mt-6 text-left">
        <summary class="text-sm text-gray-400 cursor-pointer">Error details</summary>
        <pre class="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto">{{ errorDetails }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';
import { AlertCircleIcon } from 'lucide-vue-next';

const error = ref(null);
const errorDetails = ref('');

onErrorCaptured((err, instance, info) => {
  error.value = err;
  errorDetails.value = `${err.message}\n\nComponent: ${instance?.$options?.name || 'Unknown'}\nInfo: ${info}\n\nStack:\n${err.stack}`;
  
  // Log to console for debugging
  console.error('ErrorBoundary caught:', err, info);
  
  // Prevent error from propagating
  return false;
});

function handleRetry() {
  error.value = null;
  errorDetails.value = '';
}

function handleReset() {
  // Clear storage and reload
  localStorage.clear();
  window.location.reload();
}
</script>
```

---

## Task 7.7: Loading States and Skeletons

### Description

Implement loading states and skeleton screens for better perceived performance.

### File: /src/components/SkeletonCard.vue

```javascript
<template>
  <div class="bg-white rounded-xl border border-gray-200 p-3 animate-pulse">
    <div class="h-3 bg-gray-200 rounded w-16 mb-2" />
    <div class="h-7 bg-gray-200 rounded w-24 mb-1" />
    <div class="h-3 bg-gray-200 rounded w-20" />
  </div>
</template>
```

### File: /src/components/SkeletonChart.vue

```javascript
<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
    <div class="h-4 bg-gray-200 rounded w-32 mb-4" />
    <div class="h-48 bg-gray-100 rounded flex items-end justify-around px-4 pb-4">
      <div class="w-8 bg-gray-200 rounded-t" style="height: 30%" />
      <div class="w-8 bg-gray-200 rounded-t" style="height: 45%" />
      <div class="w-8 bg-gray-200 rounded-t" style="height: 60%" />
      <div class="w-8 bg-gray-200 rounded-t" style="height: 75%" />
      <div class="w-8 bg-gray-200 rounded-t" style="height: 55%" />
    </div>
  </div>
</template>
```

---

## Task 7.8: Accessibility Audit and Improvements

### Description

Conduct an accessibility audit and implement necessary improvements to ensure WCAG 2.1 AA compliance.

### Accessibility Checklist and Implementations

**Keyboard Navigation**: Ensure all interactive elements are focusable and operable via keyboard. Add tabindex where needed, implement focus trapping in modals, and ensure visible focus indicators.

```css
/* Focus styles in global CSS */
*:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

button:focus-visible,
input:focus-visible,
select:focus-visible {
  ring: 2px;
  ring-color: #3b82f6;
}
```

**Screen Reader Support**: Add appropriate ARIA labels and roles.

```javascript
// In NumberStepper.vue
<button
  @click="decrement"
  :aria-label="`Decrease ${label} by ${step}`"
  :disabled="modelValue <= min"
>
  <MinusIcon class="w-4 h-4" aria-hidden="true" />
</button>

<input
  type="number"
  :aria-label="label"
  :aria-describedby="error ? `${id}-error` : undefined"
  v-model="localValue"
/>

<span v-if="error" :id="`${id}-error`" role="alert" class="text-red-500 text-xs">
  {{ error }}
</span>
```

**Color Contrast**: Ensure all text meets minimum contrast ratios (4.5:1 for normal text, 3:1 for large text).

**Motion Sensitivity**: Respect user's motion preferences.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Form Labels**: Ensure all form inputs have associated labels.

---

## Task 7.9: Performance Optimizations

### Description

Implement performance optimizations for smooth operation on mobile devices.

### Implementation Guidelines

**Component Lazy Loading**: Use dynamic imports for heavy components.

```javascript
// In App.vue or router
const TemperatureChart = defineAsyncComponent(() => 
  import('./components/TemperatureChart.vue')
);

const SettingsPanel = defineAsyncComponent(() =>
  import('./components/SettingsPanel.vue')
);
```

**Computed Property Optimization**: Use shallowRef for large arrays and objects that don't need deep reactivity.

```javascript
import { shallowRef } from 'vue';

// For chart data that's replaced wholesale, not mutated
const chartData = shallowRef([]);
```

**Debounced Updates**: Debounce expensive operations.

```javascript
import { useDebounceFn } from '@vueuse/core';

const debouncedSave = useDebounceFn(() => {
  storageService.saveSession(session.value);
}, 1000);
```

**Virtual Scrolling**: For long reading logs, consider virtual scrolling.

```javascript
// If readings exceed 50 items, implement virtual scrolling
// Using a library like vue-virtual-scroller
<RecycleScroller
  :items="readings"
  :item-size="60"
  key-field="id"
>
  <template #default="{ item }">
    <ReadingRow :reading="item" />
  </template>
</RecycleScroller>
```

---

## Task 7.10: Final UI Polish

### Description

Apply final visual polish including animations, transitions, and micro-interactions.

### File: /src/styles/transitions.css

```css
/* Page transitions */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Modal transitions */
.modal-enter-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active .modal-content {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content {
  transform: scale(0.95) translateY(20px);
  opacity: 0;
}

/* List transitions */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.list-move {
  transition: transform 0.3s ease;
}

/* Button press effect */
.btn-press:active {
  transform: scale(0.98);
}

/* Pulse animation for attention */
@keyframes pulse-attention {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
}

.pulse-attention {
  animation: pulse-attention 2s infinite;
}

/* Skeleton loading animation */
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.skeleton {
  background: linear-gradient(
    90deg,
    #f0f0f0 25%,
    #e0e0e0 50%,
    #f0f0f0 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

---

## Phase 7 Completion Checklist

Before declaring the project complete, verify the following:

1. **Settings panel opens and closes smoothly**: Test the slide-in animation and backdrop interaction.

2. **All settings save correctly**: Modify each setting, close the panel, reopen it, and verify values persisted.

3. **Unit changes propagate everywhere**: Change units in settings and verify all temperatures throughout the app update (status cards, charts, logs, recommendations).

4. **Reset to defaults works**: Click reset and verify all settings return to default values.

5. **JSON export contains complete data**: Export JSON and verify it includes config, all readings, all oven events, and settings.

6. **CSV export is spreadsheet-compatible**: Export CSV and open in Excel or Google Sheets; verify data imports correctly with proper columns.

7. **Clear session works**: Clear session data and verify the app returns to the welcome state with no residual data.

8. **PWA installs correctly**: On a mobile device, trigger the install prompt and verify the app installs to the home screen.

9. **Offline mode works**: Disable network, verify the app continues to function and shows the offline indicator.

10. **Error boundary catches errors**: Introduce a deliberate error and verify the error boundary displays the recovery UI.

11. **Keyboard navigation works**: Navigate the entire app using only keyboard (Tab, Enter, Escape, Arrow keys).

12. **Screen reader announces correctly**: Test with VoiceOver or NVDA and verify all interactive elements are properly announced.

13. **Animations respect motion preferences**: Enable "reduce motion" in OS settings and verify animations are minimized.

14. **Performance is acceptable**: Test on a lower-end mobile device and verify smooth scrolling and interactions.

15. **Loading states display**: On slow connections, verify skeleton screens appear before content loads.

---

## Project Completion Summary

Upon completing all seven phases, the Reverse Sear Temperature Tracker application will provide the following capabilities as specified in the requirements:

The application allows users to create cooking sessions with target internal temperature, oven settings, and optional serve time targets. Users can log internal temperature readings with automatic timestamps and view their progress on an interactive chart showing actual readings, target line, and predicted trajectory.

The application tracks oven temperature changes as discrete events and displays them as a step chart overlay. Based on accumulated data, it calculates heating rates, predicts time to target, and determines whether the cook is running early, late, or on track relative to the desired serve time.

When sufficient data is available and confidence is adequate, the application provides oven temperature adjustment recommendations with clear rationale, safety guardrails, and one-tap application. Users can customize calculation parameters, recommendation thresholds, and safety bounds through a comprehensive settings panel.

All session data persists locally and can be exported in JSON or CSV format for analysis or backup. The application functions offline as a Progressive Web App and can be installed to the device home screen for quick access.

The implementation prioritizes mobile-first design with touch-friendly interactions, accessibility compliance, and performance optimization for smooth operation on a wide range of devices.
