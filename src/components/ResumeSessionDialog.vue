<template>
  <!-- Not dismissible: this is a genuine fork in the road. Backdrop or Escape
       would have to pick one of the two branches on the user's behalf. -->
  <Sheet
    v-if="sessionInfo"
    :model-value="true"
    title="Resume previous cook?"
    size="auto"
    :dismissible="false"
  >
    <template #body>
      <dl class="divide-y divide-rule text-[14px]">
        <div class="flex items-baseline justify-between gap-3 py-2.5">
          <dt class="text-ink-dim shrink-0">Started</dt>
          <dd class="min-w-0 truncate text-right text-ink">{{ formatDateTime(sessionInfo.createdAt) }}</dd>
        </div>

        <div class="flex items-baseline justify-between gap-3 py-2.5">
          <dt class="text-ink-dim shrink-0">Target</dt>
          <dd class="num min-w-0 truncate text-right text-ink">
            {{ formatTemperature(sessionInfo.targetTemp, sessionInfo.units) }}
          </dd>
        </div>

        <div class="flex items-baseline justify-between gap-3 py-2.5">
          <dt class="text-ink-dim shrink-0">Readings</dt>
          <dd class="num min-w-0 truncate text-right text-ink">{{ sessionInfo.readingCount }}</dd>
        </div>

        <div
          v-if="sessionInfo.lastReadingTemp !== null"
          class="flex items-baseline justify-between gap-3 py-2.5"
        >
          <dt class="text-ink-dim shrink-0">Last reading</dt>
          <dd class="min-w-0 truncate text-right">
            <span class="num text-ink">{{ formatTemperature(sessionInfo.lastReadingTemp, sessionInfo.units) }}</span>
            <span class="text-ink-mute text-[13px]"> {{ formatTimeAgo(sessionInfo.lastReadingTime) }}</span>
          </dd>
        </div>

        <div v-if="sessionInfo.meatType" class="flex items-baseline justify-between gap-3 py-2.5">
          <dt class="text-ink-dim shrink-0">Meat</dt>
          <dd class="min-w-0 truncate text-right text-ink">{{ sessionInfo.meatType }}</dd>
        </div>
      </dl>
    </template>

    <template #actions>
      <button type="button" class="btn-primary" @click="$emit('resume')">
        Resume cook
      </button>
      <button type="button" class="btn-ghost w-full mt-2" @click="$emit('startNew')">
        Start a new cook
      </button>
      <p class="mt-2 text-center text-[12px] text-ink-mute">
        Starting new discards the cook above.
      </p>
    </template>
  </Sheet>
</template>

<script setup>
import Sheet from './Sheet.vue';
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
