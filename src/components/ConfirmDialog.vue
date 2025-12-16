<template>
  <Teleport to="body">
    <Transition name="modal">
      <div 
        v-if="modelValue" 
        class="fixed inset-0 z-[60] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div 
          class="absolute inset-0 bg-black/50" 
          @click="handleCancel"
          aria-hidden="true"
        />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
          <h3 
            :id="titleId"
            class="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {{ title }}
          </h3>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">{{ message }}</p>
          <div class="mt-6 flex gap-3">
            <button
              @click="handleCancel"
              class="flex-1 py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              @click="handleConfirm"
              class="flex-1 py-2 px-4 rounded-lg text-white transition-colors"
              :class="confirmClass"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, default: 'Confirm' },
  confirmClass: { type: String, default: 'bg-blue-600 hover:bg-blue-700' }
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

const titleId = computed(() => `confirm-dialog-${Math.random().toString(36).substr(2, 9)}`);

function handleConfirm() {
  emit('confirm');
  emit('update:modelValue', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>

