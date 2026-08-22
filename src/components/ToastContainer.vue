<template>
  <!-- The app's only announcement channel. Both regions are rendered
       unconditionally and empty: a live region inserted at the same moment as
       its text is not reliably announced, so they have to be in the DOM and
       settled before the first message lands. -->
  <div class="sr-only">
    <div role="status" aria-live="polite" aria-atomic="true">{{ politeMessage }}</div>
    <div role="alert" aria-live="assertive" aria-atomic="true">{{ assertiveMessage }}</div>
  </div>

  <!-- Sits clear of the fixed BottomBar and the home indicator. -->
  <div class="fixed inset-x-0 bottom-0 z-50 band pb-bottombar pointer-events-none flex flex-col items-center gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto w-full max-w-sm flex items-center gap-3 rounded-xl border border-rule border-l-2 bg-raised pl-3 pr-1 py-2"
        :class="accentClass[toast.type] || accentClass.info"
        aria-hidden="true"
        @click="dismissToast(toast.id)"
      >
        <!-- Success icon -->
        <svg v-if="toast.type === 'success'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <!-- Error icon -->
        <svg v-else-if="toast.type === 'error'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <!-- Warning icon -->
        <svg v-else-if="toast.type === 'warning'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <!-- Info icon -->
        <svg v-else class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>

        <span class="flex-1 min-w-0 text-[14px] font-medium text-ink">{{ toast.message }}</span>

        <button
          type="button"
          class="btn-icon shrink-0"
          tabindex="-1"
          aria-label="Dismiss"
          @click.stop="dismissToast(toast.id)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { useToast } from '../composables/useToast.js';

const { toasts, dismissToast } = useToast();

// Muted register: a toast is interpretation, not measurement. The accent is a
// 2px left edge and the icon colour; the surface stays `raised`.
const accentClass = {
  success: 'border-l-ontrack text-ontrack',
  error: 'border-l-danger text-danger',
  warning: 'border-l-late text-late',
  info: 'border-l-early text-early'
};

const politeMessage = ref('');
const assertiveMessage = ref('');

/**
 * Errors interrupt; everything else waits its turn. The toast markup itself is
 * aria-hidden, so this is the only thing a screen reader hears — announcing
 * without moving focus, which matters because a toast can fire mid-typing.
 */
async function announce(target, message) {
  // Clear first: two identical consecutive messages are one unchanged text
  // node otherwise, and an unchanged region is not re-announced.
  target.value = '';
  await nextTick();
  target.value = message;
}

watch(
  () => (toasts.value.length ? toasts.value[toasts.value.length - 1] : null),
  (latest) => {
    if (!latest) return;
    announce(latest.type === 'error' ? assertiveMessage : politeMessage, latest.message);
  }
);
</script>

<style scoped>
/* Local to this component — there is no shared equivalent in transitions.css. */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

/* Fades in place rather than sliding out sideways: a horizontal exit on a
   full-width toast is a frame of horizontal overflow. */
.toast-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
