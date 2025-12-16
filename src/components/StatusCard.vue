<template>
  <div
    class="relative overflow-hidden rounded-xl p-3 bg-white dark:bg-gray-800 shadow-sm border"
    :class="borderClass"
  >
    <!-- Progress background -->
    <div
      v-if="progress !== undefined"
      class="absolute inset-0 bg-green-100 dark:bg-green-900 dark:bg-opacity-20 transition-all duration-500"
      :style="{ width: `${progress}%` }"
    />
    
    <!-- Content -->
    <div class="relative">
      <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {{ label }}
      </div>
      
      <div class="mt-1 text-2xl font-bold" :class="valueClass">
        {{ value }}
        <span v-if="warning" class="ml-1 text-amber-500 dark:text-amber-400">
          <!-- Alert Triangle Icon -->
          <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </span>
      </div>
      
      <div v-if="secondary" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {{ secondary }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  secondary: { type: String, default: '' },
  status: { type: String, default: null }, // 'success', 'warning', 'info', 'error'
  progress: { type: Number, default: undefined },
  warning: { type: Boolean, default: false }
});

const borderClass = computed(() => {
  switch (props.status) {
    case 'success': return 'border-green-300 dark:border-green-700';
    case 'warning': return 'border-amber-300 dark:border-amber-700';
    case 'info': return 'border-blue-300 dark:border-blue-700';
    case 'error': return 'border-red-300 dark:border-red-700';
    default: return 'border-gray-200 dark:border-gray-700';
  }
});

const valueClass = computed(() => {
  switch (props.status) {
    case 'success': return 'text-green-700 dark:text-green-400';
    case 'warning': return 'text-amber-700 dark:text-amber-400';
    case 'info': return 'text-blue-700 dark:text-blue-400';
    case 'error': return 'text-red-700 dark:text-red-400';
    default: return 'text-gray-900 dark:text-white';
  }
});
</script>

