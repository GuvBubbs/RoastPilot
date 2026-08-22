<template>
  <slot v-if="!error" />

  <!-- Last resort UI: none of the app's own state is trustworthy here, so this
       leans only on the global token layer. -->
  <div v-else class="min-h-screen bg-ground band pt-safe pb-safe flex flex-col justify-center">
    <div class="w-full max-w-sm mx-auto py-8">
      <svg class="w-10 h-10 text-late mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>

      <h2 class="text-[22px] font-semibold text-ink">Something went wrong</h2>
      <p class="mt-2 text-[15px] text-ink-dim">
        The app hit an unexpected error. Your cook data is still stored on this device.
      </p>

      <div class="mt-6">
        <button type="button" class="btn-primary" @click="handleRetry">
          Try again
        </button>
      </div>

      <!-- Reset is separated and labelled for what it does. It used to sit as a
           peer of "Try again", directly under the line promising the cook their
           data was safe - one mis-tap from erasing hours of readings. -->
      <div class="mt-8 rule-t pt-4">
        <p class="text-[13px] text-ink-mute">
          Still broken after trying again? Resetting clears this device's saved
          cook and starts over. Export from Settings first if you can.
        </p>
        <button type="button" class="btn-ghost w-full mt-3 text-danger" @click="handleReset">
          Erase saved cook and reset
        </button>
      </div>

      <details class="mt-8">
        <summary class="cursor-pointer list-none">
          <span class="tap section-label">Error details</span>
        </summary>
        <pre class="mt-2 p-3 rounded-xl bg-raised border border-rule text-[11px] text-ink-mute overflow-auto max-h-48 whitespace-pre-wrap break-words">{{ errorDetails }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';
import { storageService } from '../services/storageService.js';

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
  // Clear this app's storage keys only, then reload. Native confirm on purpose:
  // the component tree that would render a Sheet is what just failed.
  if (confirm('Erase the saved cook and all settings on this device? This cannot be undone.')) {
    storageService.clearAll();
    window.location.reload();
  }
}
</script>
