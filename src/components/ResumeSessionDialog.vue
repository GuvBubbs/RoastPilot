<template>
  <div 
    v-if="sessionInfo"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="$emit('startNew')"
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black bg-opacity-50"></div>
    
    <!-- Dialog -->
    <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Resume Previous Session?
      </h2>
      
      <!-- Session Summary -->
      <div class="space-y-3 mb-6 text-gray-700 dark:text-gray-300">
        <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
          <span class="text-sm font-medium">Started:</span>
          <span class="text-sm">{{ formatDateTime(sessionInfo.createdAt) }}</span>
        </div>
        
        <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
          <span class="text-sm font-medium">Target:</span>
          <span class="text-sm font-semibold">{{ formatTemperature(sessionInfo.targetTemp, sessionInfo.units) }}</span>
        </div>
        
        <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
          <span class="text-sm font-medium">Readings:</span>
          <span class="text-sm">{{ sessionInfo.readingCount }} recorded</span>
        </div>
        
        <div 
          v-if="sessionInfo.lastReadingTemp !== null"
          class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700"
        >
          <span class="text-sm font-medium">Last Reading:</span>
          <span class="text-sm">
            {{ formatTemperature(sessionInfo.lastReadingTemp, sessionInfo.units) }}
            <span class="text-gray-500 dark:text-gray-400 text-xs">
              ({{ formatTimeAgo(sessionInfo.lastReadingTime) }})
            </span>
          </span>
        </div>
        
        <div 
          v-if="sessionInfo.meatType"
          class="flex items-center justify-between py-2"
        >
          <span class="text-sm font-medium">Meat:</span>
          <span class="text-sm">{{ sessionInfo.meatType }}</span>
        </div>
      </div>
      
      <!-- Actions -->
      <div class="space-y-3">
        <button
          @click="$emit('resume')"
          class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Resume Session
        </button>
        
        <button
          @click="$emit('startNew')"
          class="w-full px-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Start New Session
        </button>
        
        <p class="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
          Starting a new session will discard the previous session data
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { formatTemperature } from '../utils/temperatureUtils.js';
import { formatDateTime, formatTimeAgo } from '../utils/timeUtils.js';

defineProps({
  sessionInfo: {
    type: Object,
    required: true,
    validator: (info) => {
      return info && 
        typeof info.createdAt === 'string' &&
        typeof info.targetTemp === 'number' &&
        typeof info.readingCount === 'number';
    }
  }
});

defineEmits(['resume', 'startNew']);
</script>



