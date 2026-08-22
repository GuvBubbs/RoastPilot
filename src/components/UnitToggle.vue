<template>
  <div
    role="radiogroup"
    aria-label="Temperature unit selection"
    class="inline-flex shrink-0 gap-0.5 rounded-xl bg-raised border border-rule p-0.5"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === 'F'"
      :disabled="disabled"
      @click="selectUnit('F')"
      class="unit-button"
      :class="modelValue === 'F' ? 'unit-button--on' : 'unit-button--off'"
    >
      °F
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue === 'C'"
      :disabled="disabled"
      @click="selectUnit('C')"
      class="unit-button"
      :class="modelValue === 'C' ? 'unit-button--on' : 'unit-button--off'"
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
/* Was ~36px tall — under the 44px floor, and this is a control the user hits
   while holding a probe in the other hand. */
.unit-button {
  @apply tap rounded-[10px] px-4 text-[15px] font-semibold;
  @apply transition-colors duration-150;
  @apply disabled:opacity-40 disabled:cursor-not-allowed;
}

/* Selected state is neutral-inverted rather than a heat colour: saturation in
   this app means live measurement, and a unit preference is not one. */
.unit-button--on {
  @apply bg-ink text-ground;
}

.unit-button--off {
  @apply text-ink-dim active:bg-rule;
}
</style>
