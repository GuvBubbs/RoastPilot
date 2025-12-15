<template>
  <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <!-- Add Reading Button -->
      <button
        @click="showReadingModal = true"
        class="flex flex-col items-center justify-center p-4 min-h-[100px] bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
        aria-label="Add temperature reading"
      >
        <!-- Thermometer Icon -->
        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <div class="text-lg font-semibold">Add Reading</div>
        <div class="text-xs opacity-90 mt-1">
          {{ lastReadingDisplay }}
        </div>
      </button>
      
      <!-- Update Oven Button -->
      <button
        @click="showOvenModal = true"
        class="flex flex-col items-center justify-center p-4 min-h-[100px] bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
        aria-label="Update oven temperature"
      >
        <!-- Flame Icon -->
        <svg class="w-8 h-8 mb-2" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd" />
        </svg>
        <div class="text-lg font-semibold">Update Oven</div>
        <div class="text-xs opacity-90 mt-1">
          {{ currentOvenDisplay }}
        </div>
      </button>
    </div>
    
    <!-- Modals -->
    <AddReadingModal
      v-model="showReadingModal"
      @added="handleReadingAdded"
    />
    
    <UpdateOvenModal
      v-model="showOvenModal"
      @updated="handleOvenUpdated"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';
import AddReadingModal from './AddReadingModal.vue';
import UpdateOvenModal from './UpdateOvenModal.vue';

const { latestReading, currentOvenTemp, displayUnits } = useSession();

const showReadingModal = ref(false);
const showOvenModal = ref(false);

const lastReadingDisplay = computed(() => {
  if (!latestReading.value) return 'No readings yet';
  const temp = formatTemperature(latestReading.value.temp, displayUnits.value);
  const time = formatTime(latestReading.value.timestamp);
  return `Last: ${temp} at ${time}`;
});

const currentOvenDisplay = computed(() => {
  if (!currentOvenTemp.value) return 'Not set';
  return `Current: ${formatTemperature(currentOvenTemp.value, displayUnits.value)}`;
});

function handleReadingAdded() {
  // Additional logic if needed after reading is added
}

function handleOvenUpdated() {
  // Additional logic if needed after oven is updated
}
</script>

