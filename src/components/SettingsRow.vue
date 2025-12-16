<template>
  <div class="flex items-center justify-between py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-700">
    <div class="flex-1 pr-4">
      <div class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ label }}</div>
      <div v-if="description" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ description }}</div>
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

