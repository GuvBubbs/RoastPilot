<template>
  <div class="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
    <!-- Header -->
    <button
      @click="isExpanded = !isExpanded"
      class="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
        Oven Temperature History ({{ ovenEvents.length }})
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
      <div v-if="ovenEvents.length === 0" class="px-6 py-8 text-center">
        <div class="text-gray-400 dark:text-gray-500 mb-2">
          <svg class="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd" />
          </svg>
        </div>
        <p class="text-gray-600 dark:text-gray-400">
          No oven temperature changes recorded yet.
        </p>
      </div>
      
      <!-- Timeline -->
      <div v-else class="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
        <div 
          v-for="(event, index) in eventsWithDuration" 
          :key="event.id"
          class="relative"
        >
          <!-- Timeline node -->
          <div class="flex items-start gap-4">
            <!-- Timeline line and dot -->
            <div class="flex flex-col items-center">
              <div 
                class="w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 shadow"
                :class="getNodeColor(event.setTemp)"
              ></div>
              <div 
                v-if="index < eventsWithDuration.length - 1"
                class="w-0.5 h-full min-h-[60px] bg-gray-300 dark:bg-gray-600"
              ></div>
            </div>
            
            <!-- Event content -->
            <div class="flex-1 pb-6">
              <!-- Edit mode -->
              <div v-if="editingId === event.id" class="space-y-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div class="flex items-center gap-2">
                  <input
                    v-model.number="editTemp"
                    type="number"
                    :step="displayUnits === 'F' ? 25 : 10"
                    class="w-32 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    ref="editInput"
                  />
                  <span class="text-sm text-gray-500">°{{ displayUnits }}</span>
                </div>
                <div class="flex gap-2">
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
              </div>
              
              <!-- Delete confirmation -->
              <div v-else-if="deletingId === event.id" class="space-y-2 p-3 bg-red-50 dark:bg-red-900 dark:bg-opacity-20 rounded-lg">
                <p class="text-sm text-gray-900 dark:text-white">Delete this oven event?</p>
                <div class="flex gap-2">
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
              </div>
              
              <!-- Normal display -->
              <div v-else>
                <div class="flex items-start justify-between">
                  <div>
                    <div class="text-xl font-bold text-gray-900 dark:text-white">
                      {{ formatTemperature(event.setTemp, displayUnits) }}
                    </div>
                    <div class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {{ formatDateTime(event.timestamp) }}
                    </div>
                    <div v-if="event.previousTemp !== null" class="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {{ getChangeText(event) }}
                    </div>
                  </div>
                  
                  <!-- Actions menu -->
                  <div class="flex gap-1">
                    <button
                      @click="startEdit(event)"
                      class="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 dark:hover:bg-opacity-20 rounded transition-colors"
                      title="Edit"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      @click="startDelete(event.id)"
                      class="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900 dark:hover:bg-opacity-20 rounded transition-colors"
                      title="Delete"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                <!-- Duration display -->
                <div v-if="event.duration !== null" class="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  <span v-if="event.isOngoing">Active for {{ formatDuration(event.duration) }}</span>
                  <span v-else>Held for {{ formatDuration(event.duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useToast } from '../composables/useToast.js';
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatDateTime, formatDuration, minutesBetween, now } from '../utils/timeUtils.js';

const { ovenEvents, displayUnits, updateOvenEvent, deleteOvenEvent } = useSession();
const { showToast } = useToast();

const isExpanded = ref(false);
const editingId = ref(null);
const editTemp = ref(null);
const deletingId = ref(null);
const editInput = ref(null);

const eventsWithDuration = computed(() => {
  const events = ovenEvents.value;
  return events.map((event, index) => {
    let duration = null;
    let isOngoing = false;
    
    if (index < events.length - 1) {
      // Duration until next event
      duration = minutesBetween(event.timestamp, events[index + 1].timestamp);
    } else {
      // Duration from this event until now (ongoing)
      duration = minutesBetween(event.timestamp, now());
      isOngoing = true;
    }
    
    return {
      ...event,
      duration,
      isOngoing
    };
  }).reverse(); // Show newest first
});

function getNodeColor(tempF) {
  const tempDisplay = toDisplayUnit(tempF, displayUnits.value);
  const tempForCalc = displayUnits.value === 'F' ? tempDisplay : tempDisplay * 9/5 + 32;
  
  if (tempForCalc >= 400) return 'bg-red-600';
  if (tempForCalc >= 300) return 'bg-orange-600';
  if (tempForCalc >= 200) return 'bg-amber-500';
  return 'bg-yellow-500';
}

function getChangeText(event) {
  if (event.previousTemp === null) return 'Initial setting';
  
  const change = event.setTemp - event.previousTemp;
  const changeDisplay = formatDelta(change, displayUnits.value, true);
  const prevDisplay = formatTemperature(event.previousTemp, displayUnits.value);
  
  return `${changeDisplay} from ${prevDisplay}`;
}

function startEdit(event) {
  editingId.value = event.id;
  editTemp.value = toDisplayUnit(event.setTemp, displayUnits.value);
  
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
}

function saveEdit() {
  if (!editingId.value) return;
  
  const result = validateOvenTemp(editTemp.value, displayUnits.value);
  if (!result.valid) {
    showToast(result.error, 'error');
    return;
  }
  
  updateOvenEvent(editingId.value, {
    setTemp: editTemp.value
  });
  
  cancelEdit();
  showToast('Oven event updated', 'success');
}

function startDelete(id) {
  deletingId.value = id;
}

function cancelDelete() {
  deletingId.value = null;
}

function confirmDelete() {
  if (!deletingId.value) return;
  
  deleteOvenEvent(deletingId.value);
  deletingId.value = null;
  showToast('Oven event deleted', 'success');
}
</script>


