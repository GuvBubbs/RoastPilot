<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <header class="bg-white dark:bg-gray-800 shadow">
      <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
          🔥 RoastPilot
        </h1>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Reverse Sear Temperature Tracker
        </p>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <!-- Phase 1 Complete Banner -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
                Phase 1: Foundation Complete ✅
              </h2>
              <p class="text-gray-600 dark:text-gray-400">
                All core utilities and services are ready for Phase 2
              </p>
            </div>
            <div class="text-6xl">🎉</div>
          </div>
        </div>

        <!-- Demo: Custom Tailwind Colors -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Custom Theme Colors
          </h3>
          <div class="flex flex-wrap gap-4">
            <div class="flex items-center space-x-2">
              <div class="w-12 h-12 bg-safe rounded-lg"></div>
              <span class="text-gray-700 dark:text-gray-300">Safe (#22c55e)</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-12 h-12 bg-warning rounded-lg"></div>
              <span class="text-gray-700 dark:text-gray-300">Warning (#f59e0b)</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-12 h-12 bg-danger rounded-lg"></div>
              <span class="text-gray-700 dark:text-gray-300">Danger (#ef4444)</span>
            </div>
          </div>
        </div>

        <!-- Demo: Utility Functions -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Live Utility Demo
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <h4 class="font-medium text-gray-900 dark:text-white mb-2">Temperature Conversion</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Target: {{ formatTemperature(125, 'F') }} / {{ formatTemperature(125, 'C') }}
              </p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <h4 class="font-medium text-gray-900 dark:text-white mb-2">Time Formatting</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Duration: {{ formatDuration(90) }}
              </p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <h4 class="font-medium text-gray-900 dark:text-white mb-2">Session Created</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                ID: {{ sessionId }}
              </p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <h4 class="font-medium text-gray-900 dark:text-white mb-2">Storage Ready</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Initialized: {{ storageInitialized ? '✅' : '❌' }}
              </p>
            </div>
          </div>
        </div>

        <!-- What's Ready -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            What's Built
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">Data Models & Factory Functions</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">Temperature Utilities</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">Time Utilities</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">Validation Utilities</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">Storage Service</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-safe text-xl">✓</span>
              <span class="text-gray-700 dark:text-gray-300">PWA Configuration</span>
            </div>
          </div>
        </div>

        <!-- Next Steps -->
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Next: Phase 2 - Session Management UI
          </h3>
          <ul class="space-y-2 text-gray-700 dark:text-gray-300">
            <li class="flex items-start space-x-2">
              <span class="text-gray-400">→</span>
              <span>Session setup modal with form validation</span>
            </li>
            <li class="flex items-start space-x-2">
              <span class="text-gray-400">→</span>
              <span>Unit toggle (°F / °C) with live conversion</span>
            </li>
            <li class="flex items-start space-x-2">
              <span class="text-gray-400">→</span>
              <span>Meat type presets and target temperature selector</span>
            </li>
            <li class="flex items-start space-x-2">
              <span class="text-gray-400">→</span>
              <span>Desired serve time input for ETA calculations</span>
            </li>
          </ul>
          <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <a 
              href="/test.html" 
              class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-safe hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-safe"
            >
              Run Automated Tests →
            </a>
          </div>
        </div>
      </div>
    </main>

    <footer class="mt-12 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
      <p>{{ DISCLAIMER }}</p>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { createSession } from './models/dataModels.js';
import { formatTemperature } from './utils/temperatureUtils.js';
import { formatDuration } from './utils/timeUtils.js';
import { storageService } from './services/storageService.js';
import { DISCLAIMER } from './constants/defaults.js';

// Demo state
const storageInitialized = ref(false);
const sessionId = ref('');

onMounted(() => {
  // Initialize storage
  storageInitialized.value = storageService.initialize();
  
  // Create a demo session
  const demoSession = createSession({ targetTemp: 125 });
  sessionId.value = demoSession.config.id.substring(0, 8) + '...';
});
</script>

