<template>
  <ErrorBoundary>
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <!-- Header -->
      <header class="sticky top-0 z-40 bg-white dark:bg-gray-800 shadow">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            🔥 Roast Tracker
          </h1>
          <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
            Reverse Sear Temperature Tracker
          </p>
        </div>
        
        <!-- Header Actions -->
        <div class="flex items-center gap-2">
          <!-- End Session Button (only when session active) -->
          <button
            v-if="hasActiveSession"
            @click="handleShowEndDialog"
            class="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="End Session"
          >
            End Session
          </button>
          
          <!-- Settings Button -->
          <button
            @click="state.showSettings = true"
            class="p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Settings"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- Loading State -->
      <div v-if="state.isLoading" class="flex items-center justify-center py-12">
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p class="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>

      <!-- No Active Session - Welcome Screen -->
      <div v-else-if="!hasActiveSession" class="max-w-2xl mx-auto">
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-8 text-center">
          <div class="text-6xl mb-4">🥩</div>
          <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-3">
            Welcome to Roast Tracker
          </h2>
          <p class="text-gray-600 dark:text-gray-400 mb-8 max-w-lg mx-auto">
            Track your reverse sear cooking with precision. Monitor internal temperature, 
            predict finish time, and get recommendations for oven adjustments.
          </p>
          
          <button
            @click="handleStartNew"
            class="px-8 py-4 bg-safe hover:bg-green-600 text-white text-lg font-medium rounded-lg shadow-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-safe focus:ring-offset-2"
          >
            Start New Session
          </button>
          
          <div class="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Features
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
              <div class="flex items-start space-x-3">
                <span class="text-safe text-xl">✓</span>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">Temperature Tracking</p>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Log internal temps with timestamps</p>
                </div>
              </div>
              <div class="flex items-start space-x-3">
                <span class="text-safe text-xl">✓</span>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">ETA Predictions</p>
                  <p class="text-sm text-gray-600 dark:text-gray-400">See when you'll hit your target</p>
                </div>
              </div>
              <div class="flex items-start space-x-3">
                <span class="text-safe text-xl">✓</span>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">Smart Recommendations</p>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Get oven adjustment suggestions</p>
                </div>
              </div>
              <div class="flex items-start space-x-3">
                <span class="text-safe text-xl">✓</span>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">Data Export</p>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Export session as CSV or JSON</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Phase 4 Complete Info -->
        <div class="mt-6 bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p class="text-sm text-blue-800 dark:text-blue-300">
            <strong>Phase 4 Complete!</strong> Status cards with ETA predictions and rate calculations are ready. 
            Start a session to begin tracking your roast.
          </p>
        </div>
      </div>

      <!-- Active Session - Dashboard -->
      <div v-else class="space-y-6">
        <!-- Session Info Card -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Active Session
              </h2>
              <div class="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  <span class="font-medium">Target:</span> 
                  {{ formatTemperature(config.targetTemp, displayUnits) }}
                </p>
                <p>
                  <span class="font-medium">Started:</span> 
                  {{ formatDateTime(config.createdAt) }}
                </p>
                <p v-if="config.meatType">
                  <span class="font-medium">Meat:</span> 
                  {{ config.meatType }}{{ config.meatCut ? ` (${config.meatCut})` : '' }}
                </p>
                <p v-if="config.desiredServeTime">
                  <span class="font-medium">Desired Serve Time:</span> 
                  {{ formatTime(config.desiredServeTime) }}
                </p>
              </div>
            </div>
            
            <div class="flex flex-col items-end gap-2">
              <div class="text-right">
                <div class="text-2xl font-bold text-gray-900 dark:text-white">
                  {{ readings.length }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  Readings
                </div>
              </div>
              <div v-if="latestReading" class="text-right">
                <div class="text-lg font-semibold text-blue-600 dark:text-blue-400">
                  {{ formatTemperature(latestReading.temp, displayUnits) }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  Current
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Input Panel -->
        <InputPanel ref="inputPanelRef" />

        <!-- Status Display -->
        <StatusCards />

        <!-- Recommendation Panel -->
        <RecommendationPanel 
          @openOvenModal="handleOpenOvenModal"
          @openReadingModal="handleOpenReadingModal"
          @openSettings="handleOpenSettings"
        />

        <!-- Temperature Chart -->
        <TemperatureChart />

        <!-- Rate Chart (shown when 3+ readings) -->
        <RateChart v-if="readings.length >= 3" />

        <!-- Temperature Logs -->
        <div class="space-y-4">
          <ReadingsLog />
          <OvenEventsLog />
        </div>
      </div>
    </main>

      <!-- Footer -->
      <footer class="mt-12 py-6 text-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
        <p>{{ DISCLAIMER }}</p>
      </footer>
    </div>

    <!-- Modals -->
    <SessionSetupModal
      v-model="state.showSessionSetup"
      @submit="handleSessionCreated"
      @cancel="state.showSessionSetup = false"
    />

    <ResumeSessionDialog
      v-if="state.showResumePrompt && sessionInfo"
      :session-info="sessionInfo"
      @resume="handleResumePrevious"
      @start-new="handleStartNewFromResume"
    />

    <EndSessionDialog
      v-model="state.showEndConfirmation"
      @confirm="handleEndSession"
      @cancel="state.showEndConfirmation = false"
      @export="handleExportBeforeEnd"
    />

    <!-- Toast Notifications -->
    <ToastContainer />

    <!-- Settings Panel -->
    <SettingsPanel v-model="state.showSettings" />

    <!-- Offline Indicator -->
    <OfflineIndicator />
  </ErrorBoundary>
</template>

<script setup>
import { ref, reactive, computed, onMounted, defineAsyncComponent } from 'vue';
import { useSession } from './composables/useSession.js';
import SessionSetupModal from './components/SessionSetupModal.vue';
import ResumeSessionDialog from './components/ResumeSessionDialog.vue';
import EndSessionDialog from './components/EndSessionDialog.vue';
import InputPanel from './components/InputPanel.vue';
import StatusCards from './components/StatusCards.vue';
import RecommendationPanel from './components/RecommendationPanel.vue';
import ReadingsLog from './components/ReadingsLog.vue';
import OvenEventsLog from './components/OvenEventsLog.vue';
import ToastContainer from './components/ToastContainer.vue';
import ErrorBoundary from './components/ErrorBoundary.vue';
import OfflineIndicator from './components/OfflineIndicator.vue';

// Lazy load heavy components for better performance
const TemperatureChart = defineAsyncComponent(() => 
  import('./components/TemperatureChart.vue')
);
const RateChart = defineAsyncComponent(() => 
  import('./components/RateChart.vue')
);
const SettingsPanel = defineAsyncComponent(() =>
  import('./components/SettingsPanel.vue')
);

import { formatTemperature } from './utils/temperatureUtils.js';
import { formatDateTime, formatTime } from './utils/timeUtils.js';
import { DISCLAIMER } from './constants/defaults.js';
import { storageService } from './services/storageService.js';

// Session composable
const {
  hasActiveSession,
  hasStoredSession,
  config,
  readings,
  latestReading,
  displayUnits,
  initialize,
  startSession,
  resumeSession,
  endSession
} = useSession();

// UI state
const state = reactive({
  showSessionSetup: false,
  showSettings: false,
  showResumePrompt: false,
  showEndConfirmation: false,
  isLoading: true
});

const sessionInfo = ref(null);

// Get session info for resume dialog
function getSessionInfo() {
  const stored = storageService.loadSession();
  if (!stored) return null;
  
  const readingCount = stored.readings.length;
  const lastReading = readingCount > 0 ? stored.readings[readingCount - 1] : null;
  
  return {
    createdAt: stored.config.createdAt,
    targetTemp: stored.config.targetTemp,
    units: stored.config.units,
    readingCount: readingCount,
    lastReadingTemp: lastReading?.temp ?? null,
    lastReadingTime: lastReading?.timestamp ?? null,
    meatType: stored.config.meatType
  };
}

// Handler: Start new session
function handleStartNew() {
  state.showSessionSetup = true;
}

// Handler: Resume previous session
function handleResumePrevious() {
  state.showResumePrompt = false;
  resumeSession();
}

// Handler: Start new from resume dialog
function handleStartNewFromResume() {
  state.showResumePrompt = false;
  // Clear the old session first
  endSession();
  // Show setup modal
  state.showSessionSetup = true;
}

// Handler: Show end dialog
function handleShowEndDialog() {
  state.showEndConfirmation = true;
}

// Handler: End session confirmed
function handleEndSession() {
  endSession();
  state.showEndConfirmation = false;
}

// Handler: Export before ending
function handleExportBeforeEnd() {
  // Export is now available through the settings panel
  state.showSettings = true;
  state.showEndConfirmation = false;
}

// Handler: Session created from modal
function handleSessionCreated(configData) {
  startSession(configData);
  state.showSessionSetup = false;
}

// Handlers for RecommendationPanel quick actions
const inputPanelRef = ref(null);

function handleOpenOvenModal() {
  // Open the oven modal in InputPanel
  if (inputPanelRef.value) {
    inputPanelRef.value.openOvenModal();
  }
}

function handleOpenReadingModal() {
  // Open the reading modal in InputPanel
  if (inputPanelRef.value) {
    inputPanelRef.value.openReadingModal();
  }
}

function handleOpenSettings() {
  state.showSettings = true;
}

// Initialize on mount
onMounted(() => {
  initialize();
  
  // Check if session exists and show resume prompt
  if (hasStoredSession.value && !hasActiveSession.value) {
    sessionInfo.value = getSessionInfo();
    if (sessionInfo.value) {
      state.showResumePrompt = true;
    }
  }
  
  state.isLoading = false;
});
</script>
