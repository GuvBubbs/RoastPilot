<template>
  <ErrorBoundary>
    <!-- Command bar. 48px, one line, no subtitle. End Session lives in
         Settings now — it is a once-per-cook action and does not earn a
         permanent slot next to the title. -->
    <header class="sticky top-0 z-40 bg-ground/95 backdrop-blur rule pt-safe">
      <div class="band h-12 flex items-center gap-3">
        <h1 class="flex-1 min-w-0 text-[17px] font-semibold text-ink truncate">
          <span aria-hidden="true">🔥</span> Roast Tracker
        </h1>
        <button
          type="button"
          class="btn-icon -mr-2 shrink-0"
          aria-label="Settings"
          @click="state.showSettings = true"
        >
          <svg class="w-[22px] h-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
      <OfflineIndicator />
    </header>

    <!-- Loading -->
    <main v-if="state.isLoading" class="band py-16 text-center text-ink-mute">
      <p>Loading…</p>
    </main>

    <!-- No active session -->
    <main v-else-if="!hasActiveSession" class="pb-bottombar">
      <div class="band py-10 text-center">
        <div class="text-5xl mb-5" aria-hidden="true">🥩</div>
        <h2 class="text-[22px] font-semibold text-ink mb-2">Reverse sear, on schedule</h2>
        <p class="text-[15px] text-ink-dim max-w-sm mx-auto">
          Log internal temperature as you go. Roast Tracker fits the heating rate,
          predicts when you'll hit target, and tells you what to do about it.
        </p>
      </div>
      <footer class="band rule-t py-4 text-center text-xs text-ink-mute">
        <p>{{ DISCLAIMER }}</p>
      </footer>
    </main>

    <!-- Active session. Bands in glance-priority order, separated by hairline
         rules — not a scroll of equal-weight cards. -->
    <main v-else class="pb-bottombar">
      <StatusCards />

      <!-- Full bleed: the chart draws to the screen edge. -->
      <TemperatureChart />

      <RecommendationPanel
        @openOvenModal="state.showOvenModal = true"
        @openReadingModal="state.showReadingModal = true"
        @openSettings="state.showSettings = true"
        @openPauseModal="state.showPauseCookingModal = true"
        @openRestartModal="state.showRestartOvenModal = true"
        @openEndSession="state.showEndConfirmation = true"
      />

      <ReadingsLog />
      <OvenEventsLog />

      <!-- The app's only disclaimer. It used to render in three places. -->
      <footer class="band py-5 text-center text-xs text-ink-mute">
        <p>{{ DISCLAIMER }}</p>
      </footer>
    </main>

    <!-- Primary actions in the thumb zone. This is what reclaims the ~200px the
         two gradient buttons used to spend mid-scroll. -->
    <BottomBar v-if="!state.isLoading">
      <template #primary>
        <button
          v-if="hasActiveSession"
          type="button"
          class="btn-primary"
          @click="state.showReadingModal = true"
        >
          + Add reading
        </button>
        <button v-else type="button" class="btn-primary" @click="handleStartNew">
          Start new session
        </button>
      </template>
      <template v-if="hasActiveSession" #secondary>
        <button type="button" class="btn-ghost" @click="state.showOvenModal = true">
          Oven
        </button>
      </template>
    </BottomBar>

    <!-- Sheets and dialogs -->
    <AddReadingModal v-model="state.showReadingModal" />
    <UpdateOvenModal v-model="state.showOvenModal" />

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

    <SettingsPanel
      v-model="state.showSettings"
      @end-session="handleShowEndDialog"
    />

    <RestartOvenModal v-model="state.showRestartOvenModal" />
    <PauseCookingModal v-model="state.showPauseCookingModal" />

    <ToastContainer />
  </ErrorBoundary>
</template>

<script setup>
import { ref, reactive, onMounted, defineAsyncComponent } from 'vue';
import { useSession } from './composables/useSession.js';
import BottomBar from './components/BottomBar.vue';
import StatusCards from './components/StatusCards.vue';
import RecommendationPanel from './components/RecommendationPanel.vue';
import ReadingsLog from './components/ReadingsLog.vue';
import OvenEventsLog from './components/OvenEventsLog.vue';
import AddReadingModal from './components/AddReadingModal.vue';
import UpdateOvenModal from './components/UpdateOvenModal.vue';
import SessionSetupModal from './components/SessionSetupModal.vue';
import ResumeSessionDialog from './components/ResumeSessionDialog.vue';
import EndSessionDialog from './components/EndSessionDialog.vue';
import RestartOvenModal from './components/RestartOvenModal.vue';
import PauseCookingModal from './components/PauseCookingModal.vue';
import ToastContainer from './components/ToastContainer.vue';
import ErrorBoundary from './components/ErrorBoundary.vue';
import OfflineIndicator from './components/OfflineIndicator.vue';

// Chart.js and the settings sheet are the two heavy chunks.
const TemperatureChart = defineAsyncComponent(() =>
  import('./components/TemperatureChart.vue')
);
const SettingsPanel = defineAsyncComponent(() =>
  import('./components/SettingsPanel.vue')
);

import { DISCLAIMER } from './constants/defaults.js';
import { storageService } from './services/storageService.js';

const {
  hasActiveSession,
  hasStoredSession,
  initialize,
  startSession,
  resumeSession,
  endSession
} = useSession();

const state = reactive({
  showSessionSetup: false,
  showSettings: false,
  showResumePrompt: false,
  showReadingModal: false,
  showOvenModal: false,
  showRestartOvenModal: false,
  showPauseCookingModal: false,
  showEndConfirmation: false,
  isLoading: true
});

const sessionInfo = ref(null);

/** Summary of the stored session, for the resume prompt. */
function getSessionInfo() {
  const stored = storageService.loadSession();
  if (!stored) return null;

  const readingCount = stored.readings.length;
  const lastReading = readingCount > 0 ? stored.readings[readingCount - 1] : null;

  return {
    createdAt: stored.config.createdAt,
    targetTemp: stored.config.targetTemp,
    units: stored.config.units,
    readingCount,
    lastReadingTemp: lastReading?.temp ?? null,
    lastReadingTime: lastReading?.timestamp ?? null,
    meatType: stored.config.meatType
  };
}

function handleStartNew() {
  state.showSessionSetup = true;
}

function handleSessionCreated(configData) {
  startSession(configData);
  state.showSessionSetup = false;
}

function handleResumePrevious() {
  state.showResumePrompt = false;
  resumeSession();
}

function handleStartNewFromResume() {
  state.showResumePrompt = false;
  endSession();
  state.showSessionSetup = true;
}

function handleShowEndDialog() {
  // Reached from Settings, so close that first — two stacked sheets would
  // leave the user unsure which one Escape dismisses.
  state.showSettings = false;
  state.showEndConfirmation = true;
}

function handleEndSession() {
  endSession();
  state.showEndConfirmation = false;
}

function handleExportBeforeEnd() {
  state.showEndConfirmation = false;
  state.showSettings = true;
}

onMounted(() => {
  initialize();

  if (hasStoredSession.value && !hasActiveSession.value) {
    sessionInfo.value = getSessionInfo();
    if (sessionInfo.value) {
      state.showResumePrompt = true;
    }
  }

  state.isLoading = false;
});
</script>
