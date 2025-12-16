<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="handleCancel"
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    
    <!-- Dialog -->
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <!-- Warning Icon -->
      <div class="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-danger bg-opacity-10 rounded-full">
        <svg class="w-6 h-6 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-3 text-center">
        End Session?
      </h2>
      
      <p class="text-gray-600 dark:text-gray-400 mb-6 text-center">
        This will clear all recorded data. You may want to export your data first.
      </p>
      
      <!-- Export Link -->
      <div class="mb-6 p-3 bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 rounded-lg">
        <button
          @click="handleExport"
          class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium flex items-center mx-auto"
        >
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Data First
        </button>
      </div>
      
      <!-- Actions -->
      <div class="flex gap-3">
        <button
          @click="handleCancel"
          class="flex-1 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Cancel
        </button>
        
        <button
          @click="handleConfirm"
          class="flex-1 px-4 py-2 bg-danger hover:bg-red-600 text-white font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
        >
          End Session
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  }
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel', 'export']);

function handleCancel() {
  emit('update:modelValue', false);
  emit('cancel');
}

function handleConfirm() {
  emit('update:modelValue', false);
  emit('confirm');
}

function handleExport() {
  emit('export');
}

// Close on Escape key
function handleKeydown(event) {
  if (event.key === 'Escape' && props.modelValue) {
    handleCancel();
  }
}

// Add keyboard listener when component is mounted
import { onMounted, onUnmounted } from 'vue';

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>



