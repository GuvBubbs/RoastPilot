<template>
  <Sheet
    :model-value="modelValue"
    title="End this cook?"
    size="auto"
    @update:model-value="onSheetToggle"
  >
    <template #body>
      <p class="text-[15px] text-ink-dim">
        Every reading and oven change is cleared. Export first if you want to keep the log.
      </p>

      <button type="button" class="btn-ghost w-full mt-4 gap-2" @click="handleExport">
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Export data first
      </button>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" class="btn-ghost flex-1" @click="handleCancel">
          Cancel
        </button>
        <button type="button" class="btn-danger flex-1" @click="handleConfirm">
          End cook
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import Sheet from './Sheet.vue';

defineProps({
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

// Escape and the backdrop mean "not now", not "end the cook".
function onSheetToggle(open) {
  if (!open) handleCancel();
}
</script>
