<template>
  <div class="number-stepper">
    <label 
      v-if="label" 
      :for="inputId" 
      class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
    >
      {{ label }}
    </label>
    
    <div class="flex items-center gap-2">
      <!-- Decrement Button -->
      <button
        type="button"
        :disabled="disabled || (modelValue !== null && modelValue <= min)"
        @mousedown="startDecrement"
        @mouseup="stopIncrement"
        @mouseleave="stopIncrement"
        @touchstart.prevent="startDecrement"
        @touchend.prevent="stopIncrement"
        class="stepper-button"
        :class="{ 'opacity-50 cursor-not-allowed': disabled || (modelValue !== null && modelValue <= min) }"
        aria-label="Decrease value"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
        </svg>
      </button>
      
      <!-- Number Input -->
      <div class="flex-1 relative">
        <input
          :id="inputId"
          type="number"
          :value="modelValue"
          :min="min"
          :max="max"
          :step="step"
          :placeholder="placeholder"
          :disabled="disabled"
          :aria-describedby="error ? `${inputId}-error` : undefined"
          :aria-invalid="error ? 'true' : 'false'"
          inputmode="decimal"
          class="number-input"
          :class="{ 'border-danger focus:ring-danger': error }"
          @input="handleInput"
          @blur="handleBlur"
        />
        <span 
          v-if="suffix" 
          class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none"
        >
          {{ suffix }}
        </span>
      </div>
      
      <!-- Increment Button -->
      <button
        type="button"
        :disabled="disabled || (modelValue !== null && modelValue >= max)"
        @mousedown="startIncrement"
        @mouseup="stopIncrement"
        @mouseleave="stopIncrement"
        @touchstart.prevent="startIncrement"
        @touchend.prevent="stopIncrement"
        class="stepper-button"
        :class="{ 'opacity-50 cursor-not-allowed': disabled || (modelValue !== null && modelValue >= max) }"
        aria-label="Increase value"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
    
    <!-- Error Message -->
    <p 
      v-if="error" 
      :id="`${inputId}-error`"
      class="mt-1 text-sm text-danger"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

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
.stepper-button {
  @apply min-w-[44px] min-h-[44px] flex items-center justify-center;
  @apply bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600;
  @apply border border-gray-300 dark:border-gray-600 rounded-lg;
  @apply text-gray-700 dark:text-gray-300;
  @apply transition-colors duration-150;
  @apply active:bg-gray-300 dark:active:bg-gray-500;
  @apply disabled:opacity-50 disabled:cursor-not-allowed;
}

.number-input {
  @apply w-full px-3 py-2 text-center text-lg;
  @apply border border-gray-300 dark:border-gray-600 rounded-lg;
  @apply bg-white dark:bg-gray-800;
  @apply text-gray-900 dark:text-white;
  @apply focus:ring-2 focus:ring-blue-500 focus:border-blue-500;
  @apply disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-700;
  @apply transition-colors duration-150;
}

/* Hide browser native spin buttons */
.number-input::-webkit-inner-spin-button,
.number-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input[type=number] {
  -moz-appearance: textfield;
}
</style>



