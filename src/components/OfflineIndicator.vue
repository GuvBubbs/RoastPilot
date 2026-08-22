<template>
  <!-- Rendered unconditionally so the region is settled in the DOM before the
       first transition; the visual pill below is what appears and disappears. -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</div>

  <!-- In flow inside the sticky command bar rather than fixed to the bottom
       edge: being offline is a persistent state, not a transient message, and
       the bottom edge already belongs to the BottomBar and the toast stack -
       a toast used to land on top of this pill. -->
  <Transition name="slide">
    <div
      v-if="isOffline"
      class="band rule py-1.5 bg-raised"
      aria-hidden="true"
    >
      <div class="flex items-center justify-center gap-2 max-w-full">
        <svg class="w-4 h-4 shrink-0 text-late" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
        </svg>
        <span class="min-w-0 truncate text-[13px] font-medium text-ink-dim">Offline — saving locally</span>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue';

const isOffline = ref(!navigator.onLine);

// The pill is aria-hidden, so this is what a screen reader hears. Both edges
// are announced: coming back online is the news, and nothing appears on screen
// to convey it.
const announcement = ref('');

function updateOnlineStatus() {
  const offline = !navigator.onLine;
  if (offline === isOffline.value) return;
  isOffline.value = offline;
  announcement.value = offline
    ? 'You are offline. Readings are saved on this device.'
    : 'Back online.';
}

onMounted(async () => {
  // Launched offline: the region is already in the DOM empty, so filling it a
  // tick later reads as a change and is announced.
  if (isOffline.value) {
    await nextTick();
    announcement.value = 'You are offline. Readings are saved on this device.';
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
});

onUnmounted(() => {
  window.removeEventListener('online', updateOnlineStatus);
  window.removeEventListener('offline', updateOnlineStatus);
});
</script>

<style scoped>
/* Local to this component — there is no shared equivalent in transitions.css. */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
</style>
