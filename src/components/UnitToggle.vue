<template>
  <div 
    role="radiogroup" 
    aria-label="Temperature unit selection"
    class="unit-toggle-container"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === 'F'"
      :disabled="disabled"
      @click="selectUnit('F')"
      class="unit-toggle-button"
      :class="{
        'active': modelValue === 'F',
        'inactive': modelValue !== 'F',
        'disabled': disabled
      }"
    >
      °F
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === 'C'"
      :disabled="disabled"
      @click="selectUnit('C')"
      class="unit-toggle-button"
      :class="{
        'active': modelValue === 'C',
        'inactive': modelValue !== 'C',
        'disabled': disabled
      }"
    >
      °C
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: {
    type: String,
    required: true,
    validator: (v) => ['F', 'C'].includes(v)
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue']);

function selectUnit(unit) {
  if (props.disabled) return;
  emit('update:modelValue', unit);
}
</script>

<style scoped>
.unit-toggle-container {
  @apply inline-flex rounded-lg border border-gray-300 dark:border-gray-600;
  @apply overflow-hidden;
}

.unit-toggle-button {
  @apply px-4 py-2 text-sm font-medium;
  @apply transition-all duration-150;
  @apply min-w-[60px];
  @apply focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10;
}

.unit-toggle-button.active {
  @apply bg-blue-600 text-white;
  @apply hover:bg-blue-700;
}

.unit-toggle-button.inactive {
  @apply bg-white dark:bg-gray-800;
  @apply text-gray-700 dark:text-gray-300;
  @apply hover:bg-gray-50 dark:hover:bg-gray-700;
}

.unit-toggle-button.disabled {
  @apply opacity-50 cursor-not-allowed;
  @apply hover:bg-white dark:hover:bg-gray-800;
}

.unit-toggle-button.active.disabled {
  @apply hover:bg-blue-600;
}
</style>



