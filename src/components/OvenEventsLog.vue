<template>
  <!-- Every row and detail panel ends in its own hairline, so the section only
       needs to draw the band separator itself when there are no rows. -->
  <section :class="rows.length === 0 ? 'rule' : ''" aria-labelledby="oven-log-label">
    <h2 id="oven-log-label" class="band section-label pt-4 pb-2">Oven</h2>

    <p v-if="rows.length === 0" class="band pb-4 text-[15px] text-ink-mute">
      No oven changes yet.
    </p>

    <template v-else>
      <div v-for="row in visibleRows" :key="row.id">
        <!-- The row IS the tap target. The old ~24px icon buttons are gone;
             edit/delete live in the detail below at full size. -->
        <button
          :id="`oven-row-${row.id}`"
          type="button"
          class="row min-h-[44px]"
          :class="expandedId === row.id ? 'bg-raised' : ''"
          :aria-expanded="expandedId === row.id"
          :aria-controls="`oven-detail-${row.id}`"
          @click="toggle(row.id)"
        >
          <span class="num w-[62px] shrink-0 text-[13px] text-ink-dim truncate">
            {{ formatTime(row.timestamp) }}
          </span>

          <!-- An oven-off entry is a state change, not a measurement, so it
               drops out of the numeral column entirely: no tabular figures, no
               heat colour, just a label. -->
          <span
            v-if="row.isOff"
            class="flex-1 min-w-0 text-right text-[13px] uppercase tracking-[0.08em] text-ink-dim truncate"
          >
            Oven off
          </span>
          <span v-else class="num flex-1 min-w-0 text-right text-[17px] text-ink truncate">
            {{ formatTemperature(row.setTemp, displayUnits) }}
          </span>

          <span class="num w-[62px] shrink-0 text-right text-[13px] text-ink-mute truncate">
            {{ row.duration === null ? '' : formatDuration(row.duration) }}
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

        <!-- Detail. Sibling of the row rather than a child, so we never nest a
             button inside a button. -->
        <div
          v-if="expandedId === row.id"
          :id="`oven-detail-${row.id}`"
          role="region"
          :aria-labelledby="`oven-row-${row.id}`"
          class="band rule bg-raised py-3"
        >
          <!-- Edit -->
          <div v-if="mode === 'edit'" class="space-y-3">
            <div>
              <label :for="`oven-temp-${row.id}`" class="label">
                Set temperature (°{{ displayUnits }})
              </label>
              <input
                :id="`oven-temp-${row.id}`"
                ref="editInput"
                v-model.number="editTemp"
                type="number"
                inputmode="numeric"
                :step="displayUnits === 'F' ? 25 : 10"
                class="field num"
              />
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn-primary flex-1" @click="saveEdit">Save</button>
              <button type="button" class="btn-ghost flex-1" @click="collapse">Cancel</button>
            </div>
          </div>

          <!-- Delete confirmation. Removing an oven event rewrites the heating
               model, so it takes a second deliberate tap. -->
          <div v-else-if="mode === 'confirmDelete'" class="space-y-3">
            <p class="text-[15px] text-ink">
              Delete the {{ formatTime(row.timestamp) }}
              {{ row.isOff ? 'oven-off entry' : 'oven change' }}?
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

          <!-- Actions, under the metadata that would otherwise clutter the row -->
          <div v-else class="space-y-3">
            <p class="text-[13px] text-ink-dim">
              {{ detailText(row) }}
            </p>
            <div class="flex gap-2">
              <!-- An off entry has no set temperature to edit — setTemp is 0,
                   which the oven validator rejects by design. Delete only. -->
              <button
                v-if="!row.isOff"
                type="button"
                class="btn-ghost flex-1"
                @click="startEdit(row)"
              >
                Edit
              </button>
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
      </div>

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
import { validateOvenTemp } from '../utils/validationUtils.js';
import { toDisplayUnit, formatTemperature, formatDelta } from '../utils/temperatureUtils.js';
import { formatTime, formatDuration, minutesBetween, now } from '../utils/timeUtils.js';
import { useRefreshTimer } from '../composables/useRefreshTimer.js';

const { ovenEvents, displayUnits, updateOvenEvent, deleteOvenEvent } = useSession();
const { showToast } = useToast();

// How many rows before the "show all" affordance kicks in. Oven changes are
// rarer than readings, so a shorter list still shows the whole story.
const COLLAPSED_COUNT = 6;

const expandedId = ref(null);
// 'actions' | 'edit' | 'confirmDelete' — what the open row's detail shows.
const mode = ref('actions');
const showAll = ref(false);
const editTemp = ref(null);
// Lives inside the v-for, so Vue hands this back as an array. See resolveEditInput().
const editInput = ref(null);

/**
 * Display order is newest-first. `.map()` already produced a fresh array, so
 * reversing it cannot touch the stored (chronological) event list.
 */
const { tick } = useRefreshTimer(30000);

const rows = computed(() => {
  tick.value; // the current setting's "active for" is measured against the clock
  const chronological = ovenEvents.value;
  return chronological
    .map((event, index) => {
      const isLatest = index === chronological.length - 1;
      return {
        ...event,
        // How long this setting held: until the next change, or until now for
        // the setting still in force.
        duration: isLatest
          ? minutesBetween(event.timestamp, now())
          : minutesBetween(event.timestamp, chronological[index + 1].timestamp),
        isOngoing: isLatest
      };
    })
    .reverse();
});

const visibleRows = computed(() =>
  showAll.value ? rows.value : rows.value.slice(0, COLLAPSED_COUNT)
);

/**
 * The metadata the row itself deliberately omits: where the setting came from,
 * and how long it lasted.
 */
function detailText(row) {
  const parts = [];

  if (row.isOff) {
    parts.push(
      row.previousTemp ? `Turned off from ${formatTemperature(row.previousTemp, displayUnits.value)}` : 'Oven turned off'
    );
  } else if (row.previousTemp === null) {
    parts.push('Initial setting');
  } else {
    const change = formatDelta(row.setTemp - row.previousTemp, displayUnits.value, true);
    parts.push(`${change} from ${formatTemperature(row.previousTemp, displayUnits.value)}`);
  }

  if (row.duration !== null) {
    parts.push(`${row.isOngoing ? 'active for' : 'held for'} ${formatDuration(row.duration)}`);
  }

  return parts.join(' · ');
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
}

function startEdit(event) {
  mode.value = 'edit';
  editTemp.value = toDisplayUnit(event.setTemp, displayUnits.value);

  nextTick(() => {
    const el = resolveEditInput();
    el?.focus();
    el?.select();
  });
}

function saveEdit() {
  if (!expandedId.value) return;

  const result = validateOvenTemp(editTemp.value, displayUnits.value);
  if (!result.valid) {
    showToast(result.error, 'error');
    return;
  }

  updateOvenEvent(expandedId.value, { setTemp: editTemp.value });

  collapse();
  showToast('Oven event updated', 'success');
}

function confirmDelete(id) {
  deleteOvenEvent(id);
  collapse();
  showToast('Oven event deleted', 'success');
}
</script>
