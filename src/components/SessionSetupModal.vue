<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
    @click.self="handleCancel"
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    
    <!-- Modal -->
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full my-8">
      <div class="p-6 max-h-[90vh] overflow-y-auto">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Start New Session
        </h2>
        
        <form @submit.prevent="handleSubmit" class="space-y-6">
          <!-- Section 1: Temperature Settings -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Temperature Settings
            </h3>
            
            <div class="flex items-start gap-3">
              <div class="flex-1">
                <NumberStepper
                  v-model="form.targetTemp.value"
                  label="Target Temperature"
                  :suffix="'°' + form.units.value"
                  :step="1"
                  :min="tempRanges.min"
                  :max="tempRanges.max"
                  :error="form.targetTemp.touched ? form.targetTemp.error : ''"
                  @blur="form.targetTemp.touched = true"
                />
              </div>
              
              <div class="pt-8">
                <UnitToggle
                  v-model="form.units.value"
                  @update:model-value="handleUnitChange"
                />
              </div>
            </div>
            
            <!-- Quick Select Chips -->
            <div class="flex flex-wrap gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400 mr-2">Quick select:</span>
              <button
                v-for="preset in quickSelectTargets"
                :key="preset.name"
                type="button"
                @click="selectQuickTarget(preset)"
                class="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-full transition-colors"
              >
                {{ preset.name }} ({{ formatTemperature(preset.targetF, form.units.value) }})
              </button>
            </div>
          </div>
          
          <!-- Section 2: Oven Temperature -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Oven Temperature
            </h3>
            
            <NumberStepper
              v-model="form.initialOvenTemp.value"
              label="Initial Oven Set Temperature"
              :suffix="'°' + form.units.value"
              :step="1"
              :largeStep="10"
              :min="ovenTempRanges.min"
              :max="ovenTempRanges.max"
              :error="form.initialOvenTemp.touched ? form.initialOvenTemp.error : ''"
              @blur="form.initialOvenTemp.touched = true"
            />
            
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Typical range: {{ formatTemperature(150, form.units.value) }} - {{ formatTemperature(300, form.units.value) }} for low-and-slow
            </p>
          </div>
          
          <!-- Section 3: Timing (Optional) -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Timing <span class="text-sm font-normal text-gray-500">(Optional)</span>
            </h3>
            
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Setting a target time enables the app to tell whether you're running early or late
            </p>
            
            <!-- Time Input Mode Toggle -->
            <div class="flex gap-2">
              <button
                type="button"
                @click="form.timeInputMode.value = 'serveTime'"
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                :class="form.timeInputMode.value === 'serveTime' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
              >
                Set Serve Time
              </button>
              <button
                type="button"
                @click="form.timeInputMode.value = 'remaining'"
                class="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                :class="form.timeInputMode.value === 'remaining' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
              >
                Time Remaining
              </button>
            </div>
            
            <!-- Serve Time Input -->
            <div v-if="form.timeInputMode.value === 'serveTime'">
              <label for="serveTime" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Desired Serve Time
              </label>
              <input
                id="serveTime"
                type="datetime-local"
                v-model="form.desiredServeTime.value"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <!-- Time Remaining Input -->
            <div v-else class="grid grid-cols-2 gap-3">
              <div>
                <label for="hours" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Hours
                </label>
                <input
                  id="hours"
                  type="number"
                  v-model.number="timeRemaining.hours"
                  min="0"
                  max="24"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label for="minutes" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Minutes
                </label>
                <input
                  id="minutes"
                  type="number"
                  v-model.number="timeRemaining.minutes"
                  min="0"
                  max="59"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          
          <!-- Section 4: Starting Internal Temp (Optional) -->
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              Starting Temperature <span class="text-sm font-normal text-gray-500">(Optional)</span>
            </h3>
            
            <NumberStepper
              v-model="form.startingTemp.value"
              label="Current Internal Temperature"
              :suffix="'°' + form.units.value"
              :step="1"
              :min="tempRanges.min"
              :max="tempRanges.max"
              :error="form.startingTemp.touched ? form.startingTemp.error : ''"
              @blur="form.startingTemp.touched = true"
            />
            
            <p class="text-sm text-gray-500 dark:text-gray-400">
              If you've already taken a reading, enter it here to establish a baseline
            </p>
          </div>
          
          <!-- Section 5: Meat Details (Collapsible, Optional) -->
          <div class="space-y-4">
            <button
              type="button"
              @click="showMeatDetails = !showMeatDetails"
              class="flex items-center justify-between w-full text-lg font-semibold text-gray-900 dark:text-white"
            >
              <span>
                Meat Details <span class="text-sm font-normal text-gray-500">(Optional)</span>
              </span>
              <svg 
                class="w-5 h-5 transition-transform"
                :class="{ 'rotate-180': showMeatDetails }"
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            <div v-show="showMeatDetails" class="space-y-4 pl-2">
              <!-- Meat Type Dropdown -->
              <div>
                <label for="meatType" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Meat Type
                </label>
                <select
                  id="meatType"
                  v-model="form.meatType.value"
                  @change="handleMeatTypeChange"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a meat type...</option>
                  <option v-for="preset in MEAT_PRESETS" :key="preset.type" :value="preset.type">
                    {{ preset.type }}
                  </option>
                </select>
              </div>
              
              <!-- Cut Dropdown -->
              <div v-if="selectedMeatPreset">
                <label for="meatCut" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Cut
                </label>
                <select
                  id="meatCut"
                  v-model="form.meatCut.value"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a cut...</option>
                  <option v-for="cut in selectedMeatPreset.cuts" :key="cut" :value="cut">
                    {{ cut }}
                  </option>
                </select>
              </div>
              
              <!-- Weight -->
              <NumberStepper
                v-model="form.weight.value"
                label="Weight (pounds)"
                suffix="lbs"
                :step="0.5"
                :min="0"
                :max="100"
                :error="form.weight.touched ? form.weight.error : ''"
                @blur="form.weight.touched = true"
              />
              
              <!-- Notes -->
              <div>
                <label for="notes" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Notes
                </label>
                <textarea
                  id="notes"
                  v-model="form.notes.value"
                  rows="3"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Any additional notes about this cook..."
                ></textarea>
              </div>
              
              <!-- Preset Notes -->
              <div v-if="selectedMeatPreset && selectedMeatPreset.notes" class="p-3 bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 rounded-lg">
                <p class="text-sm text-blue-800 dark:text-blue-300">
                  💡 {{ selectedMeatPreset.notes }}
                </p>
              </div>
            </div>
          </div>
          
          <!-- Form Actions -->
          <div class="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              @click="handleCancel"
              class="flex-1 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              :disabled="!isFormValid"
              class="flex-1 px-4 py-2 bg-safe hover:bg-green-600 text-white font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-safe focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-safe"
            >
              Start Session
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import NumberStepper from './NumberStepper.vue';
import UnitToggle from './UnitToggle.vue';
import { validateSessionConfig, sanitizeString } from '../utils/validationUtils.js';
import { toStorageUnit, toDisplayUnit, formatTemperature, fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { addMinutes } from '../utils/timeUtils.js';
import { MEAT_PRESETS, SESSION_DEFAULTS } from '../constants/defaults.js';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  initialConfig: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel']);

// Initialize form values based on default unit
const getInitialTargetTemp = () => {
  if (SESSION_DEFAULTS.UNITS === 'C') {
    // Target temp with 1 decimal place for Celsius
    return Math.round(fahrenheitToCelsius(SESSION_DEFAULTS.TARGET_TEMP_F) * 10) / 10;
  }
  return SESSION_DEFAULTS.TARGET_TEMP_F;
};

const getInitialOvenTemp = () => {
  if (SESSION_DEFAULTS.UNITS === 'C') {
    // Oven temp as whole number
    return Math.round(fahrenheitToCelsius(SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F));
  }
  return SESSION_DEFAULTS.INITIAL_OVEN_TEMP_F;
};

// Form state
const form = reactive({
  targetTemp: { value: getInitialTargetTemp(), error: '', touched: false },
  units: { value: SESSION_DEFAULTS.UNITS, error: '', touched: false },
  startingTemp: { value: null, error: '', touched: false },
  desiredServeTime: { value: '', error: '', touched: false },
  timeInputMode: { value: 'serveTime', error: '', touched: false },
  initialOvenTemp: { value: getInitialOvenTemp(), error: '', touched: false },
  meatType: { value: '', error: '', touched: false },
  meatCut: { value: '', error: '', touched: false },
  weight: { value: null, error: '', touched: false },
  notes: { value: '', error: '', touched: false }
});

const timeRemaining = reactive({
  hours: 4,
  minutes: 0
});

const showMeatDetails = ref(false);
const userHasEditedTarget = ref(false);
const userHasEditedOven = ref(false);

// Quick select targets
const quickSelectTargets = [
  { name: 'Rare', targetF: 120 },
  { name: 'Medium-Rare', targetF: 130 },
  { name: 'Medium', targetF: 140 }
];

// Temperature ranges based on current unit
const tempRanges = computed(() => {
  if (form.units.value === 'F') {
    return { min: 32, max: 212 };
  } else {
    return { min: 0, max: 100 };
  }
});

const ovenTempRanges = computed(() => {
  if (form.units.value === 'F') {
    return { min: 100, max: 550 };
  } else {
    return { min: 38, max: 288 };
  }
});

// Selected meat preset
const selectedMeatPreset = computed(() => {
  return MEAT_PRESETS.find(p => p.type === form.meatType.value);
});

// Form validation
const isFormValid = computed(() => {
  return form.targetTemp.value !== null && 
         form.targetTemp.value >= tempRanges.value.min && 
         form.targetTemp.value <= tempRanges.value.max &&
         form.initialOvenTemp.value !== null &&
         form.initialOvenTemp.value >= ovenTempRanges.value.min &&
         form.initialOvenTemp.value <= ovenTempRanges.value.max;
});

// Handle unit change - convert displayed values
function handleUnitChange(newUnit) {
  const oldUnit = form.units.value;
  
  if (oldUnit === newUnit) return;
  
  // Convert target temp with 1 decimal for Celsius, whole number for Fahrenheit
  if (form.targetTemp.value !== null) {
    if (newUnit === 'C') {
      form.targetTemp.value = Math.round(fahrenheitToCelsius(form.targetTemp.value) * 10) / 10;
    } else {
      form.targetTemp.value = Math.round(celsiusToFahrenheit(form.targetTemp.value));
    }
  }
  
  // Convert oven temp - whole numbers for both
  if (form.initialOvenTemp.value !== null) {
    if (newUnit === 'C') {
      form.initialOvenTemp.value = Math.round(fahrenheitToCelsius(form.initialOvenTemp.value));
    } else {
      form.initialOvenTemp.value = Math.round(celsiusToFahrenheit(form.initialOvenTemp.value));
    }
  }
  
  // Convert starting temp with 1 decimal for Celsius, whole number for Fahrenheit
  if (form.startingTemp.value !== null) {
    if (newUnit === 'C') {
      form.startingTemp.value = Math.round(fahrenheitToCelsius(form.startingTemp.value) * 10) / 10;
    } else {
      form.startingTemp.value = Math.round(celsiusToFahrenheit(form.startingTemp.value));
    }
  }
}

// Select quick target
function selectQuickTarget(preset) {
  if (form.units.value === 'F') {
    form.targetTemp.value = preset.targetF;
  } else {
    // Use precise conversion with 1 decimal place for Celsius
    form.targetTemp.value = Math.round(fahrenheitToCelsius(preset.targetF) * 10) / 10;
  }
  userHasEditedTarget.value = true;
}

// Handle meat type change
function handleMeatTypeChange() {
  const preset = selectedMeatPreset.value;
  if (!preset) return;
  
  // Auto-populate target and oven temps if not manually edited
  if (!userHasEditedTarget.value) {
    if (form.units.value === 'F') {
      form.targetTemp.value = preset.defaultTargetF;
    } else {
      // Use precise conversion with 1 decimal place for target temp
      form.targetTemp.value = Math.round(fahrenheitToCelsius(preset.defaultTargetF) * 10) / 10;
    }
  }
  
  if (!userHasEditedOven.value) {
    if (form.units.value === 'F') {
      form.initialOvenTemp.value = preset.suggestedOvenF;
    } else {
      // Whole number for oven temp
      form.initialOvenTemp.value = Math.round(fahrenheitToCelsius(preset.suggestedOvenF));
    }
  }
  
  // Clear cut selection
  form.meatCut.value = '';
}

// Track manual edits
watch(() => form.targetTemp.value, () => {
  if (form.targetTemp.touched) {
    userHasEditedTarget.value = true;
  }
});

watch(() => form.initialOvenTemp.value, () => {
  if (form.initialOvenTemp.touched) {
    userHasEditedOven.value = true;
  }
});

// Handle form submission
function handleSubmit() {
  // Mark all fields as touched
  Object.keys(form).forEach(key => {
    if (form[key].touched !== undefined) {
      form[key].touched = true;
    }
  });
  
  // Validate
  if (!isFormValid.value) {
    return;
  }
  
  // Convert temps to Fahrenheit for storage
  const targetTempF = toStorageUnit(form.targetTemp.value, form.units.value);
  const ovenTempF = toStorageUnit(form.initialOvenTemp.value, form.units.value);
  const startingTempF = form.startingTemp.value !== null 
    ? toStorageUnit(form.startingTemp.value, form.units.value) 
    : null;
  
  // Calculate desired serve time
  let desiredServeTime = null;
  if (form.timeInputMode.value === 'serveTime' && form.desiredServeTime.value) {
    desiredServeTime = new Date(form.desiredServeTime.value).toISOString();
  } else if (form.timeInputMode.value === 'remaining') {
    const totalMinutes = (timeRemaining.hours * 60) + timeRemaining.minutes;
    if (totalMinutes > 0) {
      desiredServeTime = addMinutes(new Date().toISOString(), totalMinutes);
    }
  }
  
  // Build config
  const config = {
    targetTemp: targetTempF,
    units: form.units.value,
    startingTemp: startingTempF,
    desiredServeTime: desiredServeTime,
    initialOvenTemp: ovenTempF,
    meatType: sanitizeString(form.meatType.value) || null,
    meatCut: sanitizeString(form.meatCut.value) || null,
    weight: form.weight.value || null,
    notes: sanitizeString(form.notes.value) || null
  };
  
  emit('submit', config);
  emit('update:modelValue', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}

// Keyboard handling
function handleKeydown(event) {
  if (event.key === 'Escape' && props.modelValue) {
    handleCancel();
  }
}

// Initialize default serve time (4 hours from now)
onMounted(() => {
  const fourHoursFromNow = new Date();
  fourHoursFromNow.setHours(fourHoursFromNow.getHours() + 4);
  const year = fourHoursFromNow.getFullYear();
  const month = String(fourHoursFromNow.getMonth() + 1).padStart(2, '0');
  const day = String(fourHoursFromNow.getDate()).padStart(2, '0');
  const hours = String(fourHoursFromNow.getHours()).padStart(2, '0');
  const minutes = String(fourHoursFromNow.getMinutes()).padStart(2, '0');
  form.desiredServeTime.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

