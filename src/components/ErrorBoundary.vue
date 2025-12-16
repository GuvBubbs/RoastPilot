<template>
  <slot v-if="!error" />
  <div v-else class="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
    <div class="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 text-center">
      <svg class="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        The app encountered an unexpected error. Your data is safely stored.
      </p>
      <div class="space-y-3">
        <button
          @click="handleRetry"
          class="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
        <button
          @click="handleReset"
          class="w-full py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Reset App
        </button>
      </div>
      <details class="mt-6 text-left">
        <summary class="text-sm text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Error details</summary>
        <pre class="mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-48">{{ errorDetails }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';

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
  if (confirm('This will clear all saved data and reload the app. Continue?')) {
    localStorage.clear();
    window.location.reload();
  }
}
</script>

