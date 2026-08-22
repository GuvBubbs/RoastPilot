<template>
  <!-- Every row and detail panel ends in its own hairline, so the section only
       needs to draw the band separator itself when there are no rows. -->
  <section :class="rows.length === 0 ? 'rule' : ''" aria-labelledby="readings-log-label">
    <h2 id="readings-log-label" class="band section-label pt-4 pb-2">Readings</h2>

    <!-- Empty state: one quiet line. A log with nothing in it is the normal
         first 30 seconds of a cook, not an error worth an illustration. -->
    <p v-if="rows.length === 0" class="band pb-4 text-[15px] text-ink-mute">
      No readings yet.
    </p>

    <template v-else>
      <div v-for="row in visibleRows" :key="row.id">
        <!-- The row IS the tap target. Edit/delete used to be 32px icons
             squeezed into the right-hand cell; they now live in the expanded
             detail below, at full size. -->
        <button
          :id="`reading-row-${row.id}`"
          type="button"
          class="row min-h-[44px]"
          :class="expandedId === row.id ? 'bg-raised' : ''"
          :aria-expanded="expandedId === row.id"
          :aria-controls="`reading-detail-${row.id}`"
          @click="toggle(row.id)"
        >
          <span class="num w-[62px] shrink-0 text-[13px] text-ink-dim truncate">
            {{ formatTime(row.timestamp) }}
          </span>
          <span class="num flex-1 min-w-0 text-right text-[17px] text-ink truncate">
            {{ formatTemperature(row.temp, displayUnits) }}
          </span>
          <span
            class="num w-[66px] shrink-0 text-right text-[15px] truncate"
            :class="row.isFirst ? 'text-ink-mute' : 'text-ink-dim'"
          >
            {{ row.isFirst ? '—' : formatDelta(row.deltaFromPrevious, displayUnits) }}
          </span>
          <svg
            class="w-3.5 h-3.5 shrink-0 text-ink-mute transition-transform duration-150"
            :class="expandedId === row.id ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Detail. Sibling of the row rather than a child, so we never nest
             a button inside a button. -->
        <div
          v-if="expandedId === row.id"
          :id="`reading-detail-${row.id}`"
          role="region"
          :aria-labelledby="`reading-row-${row.id}`"
          class="band rule bg-raised py-3"
        >
          <!-- Edit -->
          <div v-if="mode === 'edit'" class="space-y-3">
            <div>
              <label :for="`reading-temp-${row.id}`" class="label">
                Temperature (°{{ displayUnits }})
              </label>
              <input
                :id="`reading-temp-${row.id}`"
                ref="editInput"
                v-model.number="editTemp"
                type="number"
                inputmode="decimal"
                :step="displayUnits === 'F' ? 1 : 0.5"
                class="field num"
              />
            </div>
            <div>
              <label :for="`reading-time-${row.id}`" class="label">Time</label>
              <input
                :id="`reading-time-${row.id}`"
                v-model="editTimestamp"
                type="datetime-local"
                :max="maxDateTime"
                class="field"
              />
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn-primary flex-1" @click="saveEdit">Save</button>
              <button type="button" class="btn-ghost flex-1" @click="collapse">Cancel</button>
            </div>
          </div>

          <!-- Delete confirmation. Deleting the newest reading moves the whole
               forecast, so it takes a second deliberate tap. -->
          <div v-else-if="mode === 'confirmDelete'" class="space-y-3">
            <p class="text-[15px] text-ink">
              Delete the {{ formatTime(row.timestamp) }} reading?
            </p>
            <div class="flex gap-2">
              <button type="button" class="btn-danger flex-1" @click="confirmDelete(row.id)">
                Delete
              </button>
              <button type="button" class="btn-ghost flex-1" @click="mode = 'actions'">
                Cancel
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div v-else class="flex gap-2">
            <button type="button" class="btn-ghost flex-1" @click="startEdit(row)">Edit</button>
            <button
              type="button"
              class="btn-ghost flex-1 text-danger"
              @click="mode = 'confirmDelete'"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- A 6-hour cook produces 20+ readings; the tail must not bury the
           footer. Newest are always the ones on screen. -->
      <button
        v-if="rows.length > COLLAPSED_COUNT"
        type="button"
        class="row min-h-[44px] justify-center text-[13px] text-ink-dim"
        @click="toggleShowAll"
      >
        {{ showAll ? 'Show fewer' : `Show all ${rows.length}` }}
      </button>
    </template>
  </section>
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

// How many rows before the "show all" affordance kicks in.
const COLLAPSED_COUNT = 8;

const expandedId = ref(null);
// 'actions' | 'edit' | 'confirmDelete' — what the open row's detail shows.
const mode = ref('actions');
const showAll = ref(false);
const editTemp = ref(null);
const editTimestamp = ref(null);
// Lives inside the v-for, so Vue hands this back as an array. See resolveEditInput().
const editInput = ref(null);

// Max datetime for editing (current time)
const maxDateTime = computed(() => toDateTimeLocal(new Date()));

/**
 * Display order is newest-first, but `readings` is a chronological invariant
 * (readings[length - 1] is the latest everywhere else in the app). Copy before
 * reversing — reverse() on the reactive array would silently break that.
 */
const rows = computed(() => {
  const chronological = readings.value;
  return chronological
    .map((reading, index) => ({
      ...reading,
      // The oldest reading has deltaFromPrevious === 0, which reads as a real
      // measurement of "no change". It has no predecessor, so show a dash.
      isFirst: index === 0
    }))
    .reverse();
});

const visibleRows = computed(() =>
  showAll.value ? rows.value : rows.value.slice(0, COLLAPSED_COUNT)
);

function toDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * `ref="editInput"` sits inside a v-for, so Vue collects it into an array even
 * though only one row is ever expanded. Calling .focus() on the array is a
 * no-op, which is why the edit field never took focus.
 */
function resolveEditInput() {
  const el = editInput.value;
  return Array.isArray(el) ? el[0] : el;
}

function toggle(id) {
  if (expandedId.value === id) {
    collapse();
    return;
  }
  // One row open at a time, always starting from the neutral action list.
  expandedId.value = id;
  mode.value = 'actions';
}

function toggleShowAll() {
  // Collapsing the list can hide the open row; close it rather than leaving an
  // orphaned detail panel referenced by aria-controls.
  showAll.value = !showAll.value;
  if (!showAll.value) collapse();
}

function collapse() {
  expandedId.value = null;
  mode.value = 'actions';
  editTemp.value = null;
  editTimestamp.value = null;
}

function startEdit(reading) {
  mode.value = 'edit';
  editTemp.value = toDisplayUnit(reading.temp, displayUnits.value);
  editTimestamp.value = toDateTimeLocal(new Date(reading.timestamp));

  nextTick(() => {
    const el = resolveEditInput();
    el?.focus();
    el?.select();
  });
}

function saveEdit() {
  if (!expandedId.value) return;

  const result = validateReading(editTemp.value, displayUnits.value);
  if (!result.valid) {
    showToast(result.error, 'error');
    return;
  }

  updateReading(expandedId.value, {
    temp: editTemp.value,
    timestamp: new Date(editTimestamp.value).toISOString()
  });

  collapse();
  showToast('Reading updated', 'success');
}

function confirmDelete(id) {
  deleteReading(id);
  collapse();
  showToast('Reading deleted', 'success');
}
</script>
