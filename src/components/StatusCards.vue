<template>
  <!-- The readout: the top of the instrument. One band, four stacked rows —
       number, heat rail, dense stat row, interpretation. The band owns its own
       bottom rule so the chart below it starts on a hairline. -->
  <section class="rule" aria-label="Cook status">
    <!-- Row 1: the number. -->
    <div class="band pt-4 pb-3">
      <template v-if="currentTempDisplay !== null">
        <!-- Baseline alignment keeps the unit sitting on the numeral's feet
             instead of floating; it must not compete with the number. -->
        <div class="flex items-baseline gap-1 min-w-0">
          <span class="readout">{{ currentTempDisplay }}</span>
          <span class="font-display font-semibold text-[26px] leading-none text-ink-dim">
            °{{ displayUnits }}
          </span>
        </div>
        <p class="mt-2 text-[13px] text-ink-dim truncate">
          internal · target {{ targetTempDisplay }}°{{ displayUnits }}
          <span v-if="lastReadingAgo" class="text-ink-mute">· {{ lastReadingAgo }}</span>
        </p>
      </template>

      <!-- No readings yet. A 76px "--" reads as a fault, not an empty state, so
           the readout stands down to a sentence. -->
      <template v-else>
        <p class="font-display font-semibold text-[30px] leading-none text-ink-dim">
          No readings yet
        </p>
        <p class="mt-2 text-[13px] text-ink-mute truncate">
          target {{ targetTempDisplay }}°{{ displayUnits }} · add your first reading
        </p>
      </template>
    </div>

    <!-- Row 2: the heat rail. Full-bleed, 3px, no radius, no label — a gauge.
         The gradient is laid across the full width and then masked from the
         right, so the colour at the leading edge encodes absolute progress
         rather than being restretched every time the fill grows. -->
    <div
      class="band-flush relative h-[3px] w-full overflow-hidden bg-raised"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Progress to target temperature"
    >
      <div class="absolute inset-0 bg-gradient-to-r from-heat-cold via-heat-warm to-heat-hot"></div>
      <div
        class="absolute inset-y-0 right-0 bg-raised transition-[width] duration-500"
        :style="{ width: `${100 - progressPercent}%` }"
      ></div>
    </div>

    <!-- Row 3: the dense 3-up. Tabular figures via .stat-value so the digits
         don't jitter on the 30s tick. Every cell truncates — three unbounded
         strings at 320px is exactly how horizontal overflow gets in. -->
    <div class="band rule-t grid grid-cols-3 divide-x divide-rule">
      <div class="stat pr-3">
        <div class="flex items-center gap-1 min-w-0">
          <span class="stat-label">ETA</span>
          <!-- Confidence is interpretation *about* the ETA, so it rides with
               it rather than sitting centred underneath the whole band. -->
          <template v-if="canPredict">
            <svg
              v-if="confidence.level === 'high'"
              class="w-3 h-3 shrink-0 text-ontrack"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              role="img" :aria-label="confidenceAriaLabel"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg
              v-else-if="confidence.level === 'medium'"
              class="w-3 h-3 shrink-0 text-ink-dim"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              role="img" :aria-label="confidenceAriaLabel"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg
              v-else
              class="w-3 h-3 shrink-0 text-late"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              role="img" :aria-label="confidenceAriaLabel"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </template>
        </div>
        <div class="stat-value">{{ predictedTargetTimeFormatted }}</div>
        <!-- Only when the third cell is showing SERVE (otherwise it would say
             the same thing twice) and only when there is a real projection —
             a "--" stacked under a "--" is noise. -->
        <div v-if="hasServeTime && canPredict" class="text-[11px] text-ink-mute truncate">
          {{ remainingText }}
        </div>
      </div>

      <div class="stat px-3">
        <span class="stat-label">Rate</span>
        <div class="stat-value">{{ currentRateFormatted }}</div>
      </div>

      <!-- No serve time is the common case, so the cell carries the countdown
           rather than leaving a hole in the row. -->
      <div class="stat pl-3">
        <span class="stat-label">{{ hasServeTime ? 'Serve' : 'Remaining' }}</span>
        <div class="stat-value">
          {{ hasServeTime ? serveTimeFormatted : remainingText }}
        </div>
      </div>
    </div>

    <!-- Row 4: interpretation. Muted colours only — the stat row sits between
         this and the rail's saturated gradient, which is what keeps the two
         colour languages from bleeding into each other. -->
    <div v-if="showVerdict || showOvenChip || showConfidenceReason" class="band rule-t py-2.5">
      <div class="flex items-center gap-3">
        <p
          v-if="showVerdict"
          class="flex items-center gap-2 min-w-0 flex-1 text-[14px]"
          :class="verdictClass"
        >
          <span class="h-2 w-2 shrink-0 rounded-full bg-current"></span>
          <span class="min-w-0 truncate">{{ verdictText }}</span>
        </p>
        <!-- Oven set is not a headline — the chart's oven track and the oven log
             both carry it. What is worth a glance is that it may be out of date,
             so it takes a chip rather than a fourth stat cell (four cells of
             clock times do not read at 320px). -->
        <span v-if="showOvenChip" class="chip min-w-0" :class="{ 'ml-auto': !showVerdict }">
          <svg
            v-if="isOvenStale"
            class="w-3 h-3 shrink-0 text-late"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
            role="img" aria-label="Oven setting may be out of date"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span class="shrink-0">Oven</span>
          <!-- Truncates before the verdict does: the age is the least important
               thing in this band. -->
          <span class="num truncate" :class="isOvenStale ? 'text-late' : 'text-ink'">
            {{ ovenValueText }}
          </span>
        </span>
      </div>

      <!-- The reason names the actual fit size, so it is worth reading once;
           clamped so it can never grow the band by a third line. -->
      <p
        v-if="showConfidenceReason"
        class="mt-1 text-[11px] text-ink-mute line-clamp-2"
      >
        {{ confidence.reason }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useCalculations } from '../composables/useCalculations.js';
import { useRefreshTimer } from '../composables/useRefreshTimer.js';
import { formatTemperature } from '../utils/temperatureUtils.js';
import { formatTime, formatTimeAgo, formatDuration, minutesBetween } from '../utils/timeUtils.js';

const { latestReading, currentOvenTemp, ovenEvents, config, displayUnits, settings } = useSession();
const {
  currentTempDisplay,
  targetTempDisplay,
  progressPercent,
  timeRemainingFormatted,
  targetReached,
  predictedTargetTimeFormatted,
  currentRateFormatted,
  scheduleStatus,
  scheduleVarianceFormatted,
  confidence,
  canPredict
} = useCalculations();

// Anything measured against "now" needs this dependency, or it freezes at
// first render.
const { tick } = useRefreshTimer(30000);

const lastReadingAgo = computed(() => {
  tick.value;
  if (!latestReading.value) return '';
  return formatTimeAgo(latestReading.value.timestamp);
});

const hasServeTime = computed(() => Boolean(config.value?.desiredServeTime));

// "Target reached" is 14 characters at 22px — it will not survive a 96px cell,
// and the composable has no reason to know the cell width.
const remainingText = computed(() =>
  targetReached.value ? 'Reached' : timeRemainingFormatted.value
);

const serveTimeFormatted = computed(() => {
  if (!config.value?.desiredServeTime) return '--';
  return formatTime(config.value.desiredServeTime);
});

/**
 * When the current oven setting was made. With no logged event this is session
 * start, because `currentOvenTemp` itself falls back to the configured initial
 * oven temp — that setting is as old as the cook.
 */
const ovenSetAt = computed(() => {
  const events = ovenEvents.value;
  if (events.length > 0) return events[events.length - 1].timestamp;
  return config.value?.createdAt ?? null;
});

const ovenSetMinutesAgo = computed(() => {
  tick.value;
  if (!ovenSetAt.value) return null;
  return minutesBetween(ovenSetAt.value, new Date().toISOString());
});

/** The oven is off, per its own last logged event - not per a 0 temperature. */
const isOvenOff = computed(() => {
  const events = ovenEvents.value;
  return events.length > 0 && events[events.length - 1].isOff === true;
});

const isOvenStale = computed(() => {
  // An off oven is not stale data - it is a deliberate state, and the
  // recommendation service skips its own stale check for the same reason.
  if (isOvenOff.value) return false;
  if (currentOvenTemp.value === null) return true;
  const minutes = ovenSetMinutesAgo.value;
  if (minutes === null) return true;
  return minutes > (settings.value?.ovenTempStaleMinutes ?? 60);
});

const showOvenChip = computed(() => Boolean(config.value));

/**
 * The chip shows the setting, and — once it is stale — how long ago it was set,
 * because the age is the evidence for the warning.
 */
const ovenValueText = computed(() => {
  // currentOvenTemp is 0 while the oven is off, which read as "Oven 0°F" - and
  // as "-17.8°C" for a Celsius cook.
  if (isOvenOff.value) return 'off';
  if (currentOvenTemp.value === null) return 'not set';
  const temp = formatTemperature(currentOvenTemp.value, displayUnits.value);
  if (!isOvenStale.value || ovenSetMinutesAgo.value === null) return temp;
  return `${temp} · ${formatDuration(ovenSetMinutesAgo.value)} ago`;
});

const showVerdict = computed(() => {
  if (!hasServeTime.value) return false;
  return ['on-track', 'early', 'late'].includes(scheduleStatus.value);
});

/**
 * One sentence. For early/late the variance *is* the sentence — prefixing a
 * status word ("Running early — 18m early") only says it twice.
 */
const verdictText = computed(() => {
  const variance = scheduleVarianceFormatted.value;
  if (scheduleStatus.value === 'on-track') {
    return variance === 'On time' || variance === '--'
      ? 'On track for serve time'
      : `On track — ${variance}`;
  }
  return `Running ${variance}`;
});

const verdictClass = computed(() => {
  switch (scheduleStatus.value) {
    case 'early': return 'text-early';
    case 'late': return 'text-late';
    default: return 'text-ontrack';
  }
});

// A high-confidence reason is just bookkeeping ("fitted from 8 readings"); it
// only earns a line when it qualifies the ETA.
const showConfidenceReason = computed(
  () => canPredict.value && confidence.value.level !== 'high'
);

const confidenceAriaLabel = computed(
  () => `Prediction confidence: ${confidence.value.level}. ${confidence.value.reason}`
);
</script>
