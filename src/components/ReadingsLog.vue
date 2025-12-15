<template>
  <div class="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
    <!-- Header -->
    <button
      @click="isExpanded = !isExpanded"
      class="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
        Internal Readings ({{ readings.length }})
      </h3>
      <svg 
        class="w-5 h-5 text-gray-500 transition-transform" 
        :class="{ 'rotate-180': isExpanded }"
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    
    <!-- Collapsible content -->
    <div v-show="isExpanded" class="border-t border-gray-200 dark:border-gray-700">
      <!-- Empty state -->
      <div v-if="readings.length === 0" class="px-6 py-8 text-center">
        <div class="text-gray-400 dark:text-gray-500 mb-2">
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <p class="text-gray-600 dark:text-gray-400">
          No readings recorded yet. Tap "Add Reading" to start tracking.
        </p>
      </div>
      
      <!-- Table -->
      <div v-else class="overflow-x-auto max-h-96 overflow-y-auto">
        <table class="w-full">
          <thead class="bg-gray-50 dark:bg-gray-700 sticky top-0">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Time
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Temp
              </th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                Δ Start
              </th>
              <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr 
              v-for="reading in reversedReadings" 
              :key="reading.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <!-- Normal row -->
              <template v-if="editingId !== reading.id && deletingId !== reading.id">
                <td class="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                  {{ formatTime(reading.timestamp) }}
                </td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {{ formatTemperature(reading.temp, displayUnits) }}
                </td>
                <td class="px-4 py-3 text-sm hidden sm:table-cell" :class="getDeltaClass(reading.deltaFromStart)">
                  {{ formatDelta(reading.deltaFromStart, displayUnits) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button
                      @click="startEdit(reading)"
                      class="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 dark:hover:bg-opacity-20 rounded transition-colors"
                      title="Edit"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      @click="startDelete(reading.id)"
                      class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900 dark:hover:bg-opacity-20 rounded transition-colors"
                      title="Delete"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </template>
              
              <!-- Edit mode -->
              <template v-else-if="editingId === reading.id">
                <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                  <input
                    v-model="editTimestamp"
                    type="datetime-local"
                    :max="maxDateTime"
                    class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <input
                      v-model.number="editTemp"
                      type="number"
                      :step="displayUnits === 'F' ? 1 : 0.5"
                      class="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      ref="editInput"
                    />
                    <span class="text-sm text-gray-500">°{{ displayUnits }}</span>
                  </div>
                </td>
                <td class="px-4 py-3 text-sm hidden sm:table-cell">
                  <span class="text-gray-400">—</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      @click="saveEdit"
                      class="px-3 py-1 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
                    >
                      Save
                    </button>
                    <button
                      @click="cancelEdit"
                      class="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </template>
              
              <!-- Delete confirmation -->
              <template v-else-if="deletingId === reading.id">
                <td colspan="4" class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-900 dark:text-white">Delete this reading?</span>
                    <div class="flex-1"></div>
                    <button
                      @click="confirmDelete"
                      class="px-3 py-1 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                    >
                      Yes, delete
                    </button>
                    <button
                      @click="cancelDelete"
                      class="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateReading } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';

const { readings, displayUnits, updateReading, deleteReading } = useSession();
const { showToast } = useToast();

const isExpanded = ref(true);
const editingId = ref(null);
const editTemp = ref(null);
const editTimestamp = ref(null);
const deletingId = ref(null);
const editInput = ref(null);

// Max datetime for editing (current time)
const maxDateTime = computed(() => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
});

// Reverse readings to show newest first
const reversedReadings = computed(() => {
  return [...readings.value].reverse();
});

function getDeltaClass(delta) {
  if (delta > 0) return 'text-orange-600 dark:text-orange-400 font-medium';
  if (delta < 0) return 'text-blue-600 dark:text-blue-400 font-medium';
  return 'text-gray-600 dark:text-gray-400';
}

function startEdit(reading) {
  editingId.value = reading.id;
  editTemp.value = toDisplayUnit(reading.temp, displayUnits.value);
  
  // Convert ISO timestamp to datetime-local format (YYYY-MM-DDTHH:mm)
  const date = new Date(reading.timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  editTimestamp.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  
  nextTick(() => {
    if (editInput.value) {
      editInput.value.focus();
      editInput.value.select();
    }
  });
}

function cancelEdit() {
  editingId.value = null;
  editTemp.value = null;
  editTimestamp.value = null;
}

function saveEdit() {
  if (!editingId.value) return;
  
  const result = validateReading(editTemp.value, displayUnits.value);
  if (!result.valid) {
    showToast(result.error, 'error');
    return;
  }
  
  // Convert datetime-local format back to ISO string
  const timestampISO = new Date(editTimestamp.value).toISOString();
  
  updateReading(editingId.value, {
    temp: editTemp.value,
    timestamp: timestampISO
  });
  
  cancelEdit();
  showToast('Reading updated', 'success');
}

function startDelete(id) {
  deletingId.value = id;
}

function cancelDelete() {
  deletingId.value = null;
}

function confirmDelete() {
  if (!deletingId.value) return;
  
  deleteReading(deletingId.value);
  deletingId.value = null;
  showToast('Reading deleted', 'success');
}
</script>

