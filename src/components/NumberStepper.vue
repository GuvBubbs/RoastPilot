<template>
  <div>
    <label
      v-if="label"
      :for="inputId"
      class="label"
      :class="{ 'sr-only': hideLabel }"
    >
      {{ label }}
    </label>

    <div class="flex items-center gap-2">
      <!-- Decrement -->
      <button
        type="button"
        :disabled="disabled || (modelValue !== null && modelValue <= min)"
        @mousedown="startDecrement"
        @mouseup="stopIncrement"
        @mouseleave="stopIncrement"
        @touchstart.prevent="startDecrement"
        @touchend.prevent="stopIncrement"
        class="stepper-button"
        aria-label="Decrease value"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
        </svg>
      </button>

      <!-- Number input. min-w-0 so a long value can never push the buttons
           off a 320px screen. -->
      <div class="relative flex-1 min-w-0">
        <input
          :id="inputId"
          type="number"
          :value="modelValue"
          :min="min"
          :max="max"
          step="any"
          :placeholder="placeholder"
          :disabled="disabled"
          :aria-describedby="error ? `${inputId}-error` : undefined"
          :aria-invalid="error ? 'true' : 'false'"
          inputmode="decimal"
          class="field num text-center text-[18px]"
          :class="{ 'border-danger': error, 'pr-10': suffix }"
          @input="handleInput"
          @blur="handleBlur"
        />
        <span
          v-if="suffix"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-mute pointer-events-none"
        >
          {{ suffix }}
        </span>
      </div>

      <!-- Increment -->
      <button
        type="button"
        :disabled="disabled || (modelValue !== null && modelValue >= max)"
        @mousedown="startIncrement"
        @mouseup="stopIncrement"
        @mouseleave="stopIncrement"
        @touchstart.prevent="startIncrement"
        @touchend.prevent="stopIncrement"
        class="stepper-button"
        aria-label="Increase value"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>

    <p
      v-if="error"
      :id="`${inputId}-error`"
      class="mt-1.5 text-[12px] text-danger"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: Number,
    default: null
  },
  min: {
    type: Number,
    default: -Infinity
  },
  max: {
    type: Number,
    default: Infinity
  },
  // Increment applied by the -/+ buttons. Deliberately not bound to the
  // input's step attribute: values often land off-step (e.g. a target of
  // 54.4 after an F->C conversion, or a 41.3 probe reading), and native
  // step validation would silently block form submit. Range and format
  // checks are handled by handleBlur and the `error` prop instead.
  step: {
    type: Number,
    default: 1
  },
  largeStep: {
    type: Number,
    default: null
  },
  placeholder: {
    type: String,
    default: ''
  },
  label: {
    type: String,
    required: true
  },
  // The label is required for the accessible name, but a stepper sitting
  // inside a SettingsRow already has a visible label above it — rendering
  // both reads as a duplicate.
  hideLabel: {
    type: Boolean,
    default: false
  },
  suffix: {
    type: String,
    default: ''
  },
  error: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'blur']);

// Generate unique ID for accessibility
const inputId = computed(() => `number-stepper-${Math.random().toString(36).substr(2, 9)}`);

// Long press state
let pressInterval = null;
let pressTimeout = null;

function updateValue(delta) {
  const currentValue = props.modelValue ?? 0;
  const newValue = Math.min(props.max, Math.max(props.min, currentValue + delta));
  emit('update:modelValue', newValue);
}

function startIncrement() {
  if (props.disabled || (props.modelValue !== null && props.modelValue >= props.max)) return;

  // Immediate first step
  updateValue(props.step);

  // Start continuous after delay
  pressTimeout = setTimeout(() => {
    pressInterval = setInterval(() => {
      updateValue(props.largeStep ?? props.step);
    }, 100);
  }, 500);
}

function startDecrement() {
  if (props.disabled || (props.modelValue !== null && props.modelValue <= props.min)) return;

  // Immediate first step
  updateValue(-props.step);

  // Start continuous after delay
  pressTimeout = setTimeout(() => {
    pressInterval = setInterval(() => {
      updateValue(-(props.largeStep ?? props.step));
    }, 100);
  }, 500);
}

function stopIncrement() {
  if (pressTimeout) clearTimeout(pressTimeout);
  if (pressInterval) clearInterval(pressInterval);
  pressTimeout = null;
  pressInterval = null;
}

function handleInput(event) {
  const value = event.target.value;
  if (value === '' || value === null) {
    emit('update:modelValue', null);
    return;
  }

  const numValue = parseFloat(value);
  if (!isNaN(numValue)) {
    emit('update:modelValue', numValue);
  }
}

function handleBlur(event) {
  const value = event.target.value;

  if (value === '' || value === null) {
    emit('blur');
    return;
  }

  const numValue = parseFloat(value);
  if (!isNaN(numValue)) {
    // Clamp to min/max
    const clampedValue = Math.min(props.max, Math.max(props.min, numValue));
    if (clampedValue !== numValue) {
      emit('update:modelValue', clampedValue);
    }
  } else {
    // Revert to previous valid value or 0
    emit('update:modelValue', props.modelValue ?? 0);
  }

  emit('blur');
}
</script>

<style scoped>
/* `.tap` is the 44px guarantee this component used to hand-roll. */
.stepper-button {
  @apply tap shrink-0 rounded-xl;
  @apply bg-raised border border-rule text-ink-dim;
  @apply transition-colors duration-150;
  @apply active:bg-rule;
  @apply disabled:opacity-40 disabled:cursor-not-allowed;
}

/* Native spin buttons duplicate the -/+ controls and eat input width. */
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
}
</style>
