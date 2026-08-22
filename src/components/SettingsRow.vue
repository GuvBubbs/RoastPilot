<template>
  <!-- Stacked by default: a label plus a three-part stepper side by side
       overflows a 320px screen. `inline` is for controls narrow enough to sit
       on the same line (a toggle, a checkbox). -->
  <div class="py-3 border-b border-rule last:border-b-0" :class="inline ? 'flex items-center gap-3' : ''">
    <div class="min-w-0" :class="inline ? 'flex-1' : ''">
      <div class="text-[14px] font-medium text-ink">{{ label }}</div>
      <div v-if="description" class="mt-0.5 text-[12px] leading-snug text-ink-mute">{{ description }}</div>
    </div>
    <div :class="inline ? 'shrink-0' : 'mt-2.5'">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  description: { type: String, default: '' },
  inline: { type: Boolean, default: false }
});
</script>
