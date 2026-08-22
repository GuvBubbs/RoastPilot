<template>
  <!-- Sheet owns role/aria-modal, the focus trap, focus restore, Escape,
       backdrop dismiss and the scroll container. -->
  <Sheet
    :model-value="modelValue"
    :title="title"
    size="auto"
    @update:model-value="onSheetToggle"
  >
    <template #body>
      <p class="text-[15px] text-ink-dim">{{ message }}</p>
    </template>

    <template #actions>
      <div class="flex gap-3">
        <button type="button" class="btn-ghost flex-1" @click="handleCancel">
          Cancel
        </button>
        <button
          type="button"
          class="tap flex-1 min-w-0 rounded-xl px-4 text-[15px] font-semibold text-white transition-colors duration-150"
          :class="confirmClass"
          @click="handleConfirm"
        >
          <span class="truncate">{{ confirmText }}</span>
        </button>
      </div>
    </template>
  </Sheet>
</template>

<script setup>
import Sheet from './Sheet.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, default: 'Confirm' },
  /** Fill for the confirm button only — geometry and the 44px target are fixed. */
  confirmClass: { type: String, default: 'bg-heat-hot active:bg-[#c23a22]' }
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

function handleConfirm() {
  emit('confirm');
  emit('update:modelValue', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}

// Backdrop, Escape and the close button all come back through Sheet as a
// close — which for a two-button question is a cancel.
function onSheetToggle(open) {
  if (!open) handleCancel();
}
</script>
