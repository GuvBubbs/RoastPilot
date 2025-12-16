<template>
  <div class="border-b last:border-b-0 border-gray-200 dark:border-gray-700">
    <div class="px-4 py-3 bg-gray-50 dark:bg-gray-800">
      <h3 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
        {{ title }}
      </h3>
    </div>
    <div class="p-4">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true }
});
</script>

