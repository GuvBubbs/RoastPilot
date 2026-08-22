<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-30 bg-ground/95 backdrop-blur border-t border-rule pl-safe pr-safe"
  >
    <div class="band flex items-stretch gap-2 py-2.5" :class="hasSecondary ? '' : 'justify-stretch'">
      <div class="flex-1 min-w-0 flex">
        <slot name="primary" />
      </div>
      <div v-if="hasSecondary" class="shrink-0 flex">
        <slot name="secondary" />
      </div>
    </div>
    <!-- Home-indicator clearance. Separate from the padded row so the bar's
         fill extends all the way to the screen edge. -->
    <div class="pb-safe" />
  </div>
</template>

<script setup>
import { computed, useSlots } from 'vue';

/**
 * Fixed thumb-zone bar. The primary actions live here rather than in a card
 * mid-scroll — that relocation is what reclaims the ~200px the two gradient
 * buttons used to spend.
 *
 * Pages that mount this must add `pb-bottombar` to their scroll content so the
 * last row is not covered.
 */
const slots = useSlots();
const hasSecondary = computed(() => Boolean(slots.secondary));
</script>
