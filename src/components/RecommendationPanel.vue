<template>
  <!--
    The next-action band. One sentence, at most one control.

    The sentence comes straight from the composable's `message` / `blockerReason`
    — both are already substituted and unit-correct, so the UI never assembles a
    temperature string of its own. The dot carries the verdict, which lets the
    sentence stay in a single ink register instead of tinting a whole panel.
  -->
  <section class="band rule py-4" aria-label="What to do next">
    <div class="flex items-start gap-2.5">
      <span
        class="mt-[7px] h-2 w-2 shrink-0 rounded-full"
        :class="dotClass"
        aria-hidden="true"
      />
      <p class="min-w-0 flex-1 text-[17px] leading-snug text-ink">
        {{ headline }}
      </p>
    </div>

    <!-- Supporting line: the oven-off alternative, or the blocker's progress
         hint. "Need one more reading" is information, not an alarm. -->
    <p v-if="detail" class="mt-1.5 pl-[18px] text-[13px] leading-snug text-ink-dim">
      {{ detail }}
    </p>

    <!-- How long the oven has been off. Driven by the shared tick, not by a
         `new Date()` read inside a dependency-free computed — that pattern
         froze at first evaluation. -->
    <p v-if="pausedLine" class="mt-1.5 pl-[18px] text-[13px] leading-snug text-ink-mute">
      {{ pausedLine }}
    </p>

    <div v-if="control" class="mt-3">
      <button
        type="button"
        :class="control.kind === 'primary' ? 'btn-primary' : 'btn-ghost'"
        @click="runControl"
      >
        {{ control.label }}
      </button>
    </div>

    <details v-if="explanation" class="mt-2">
      <summary class="flex min-h-[44px] cursor-pointer items-center text-[13px] text-ink-mute">
        Why?
      </summary>
      <p class="pb-1 text-[13px] leading-relaxed text-ink-dim">
        {{ explanation }}
      </p>
    </details>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { useRecommendations } from '../composables/useRecommendations.js';
import { useRefreshTimer } from '../composables/useRefreshTimer.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration, formatTime, minutesBetween, now } from '../utils/timeUtils.js';

const emit = defineEmits(['openOvenModal', 'openReadingModal', 'openSettings', 'openPauseModal', 'openRestartModal', 'openEndSession']);

const { addOvenEvent, ovenEvents } = useSession();
const {
  canRecommend,
  action,
  suggestedTemp,
  suggestedTempFormatted,
  message,
  reasoning,
  alternativeMessage,
  ovenOffMinutes,
  isPaused,
  awaitingEffect,
  blockerReason,
  blockerType,
  blockerProgress,
  responsiveness,
  hasResponsivenessData
} = useRecommendations();
const { showToast } = useToast();
const { tick } = useRefreshTimer();

/** Timestamp of the oven-off event we are currently sitting in, if any. */
const pausedSince = computed(() => {
  if (!isPaused.value) return null;
  const events = ovenEvents.value;
  return events[events.length - 1]?.timestamp ?? null;
});

const pausedLine = computed(() => {
  if (!pausedSince.value) return null;
  // Touch the tick so the elapsed figure actually advances.
  tick.value;
  const elapsed = minutesBetween(pausedSince.value, now());
  return `Oven off since ${formatTime(pausedSince.value)} · ${formatDuration(Math.max(0, elapsed))}`;
});

const headline = computed(() => {
  if (!canRecommend.value) return blockerReason.value || 'Not enough data yet.';
  return message.value || 'No recommendation yet.';
});

const detail = computed(() => {
  if (!canRecommend.value) return blockerProgress.value?.message ?? null;
  // Only oven-off carries an alternative, and it is the whole point of it — but
  // it describes turning the oven off, so it is noise once the oven is already
  // off (and its {ovenTemp} resolves to 0° in that state).
  if (isPaused.value) return null;
  if (alternativeMessage.value) return alternativeMessage.value;
  // A suggestion issued while the last change is still unmeasured needs to say
  // so, or it reads as a second correction on top of the first.
  if (awaitingEffect.value && action.value !== 'settling') {
    return 'Still measuring your last oven change — this is the same target, not another step.';
  }
  return null;
});

/** Muted interpretation colours only — the heat ramp is reserved for measurement. */
const dotClass = computed(() => {
  if (!canRecommend.value) return 'bg-ink-mute';
  switch (action.value) {
    case 'at-target': return 'bg-ontrack';
    case 'hold': return 'bg-ontrack';
    case 'raise': return 'bg-late';
    case 'lower': return 'bg-early';
    case 'oven-off': return 'bg-early';
    // The dial is where it needs to be; we are only waiting to see it land.
    case 'settling': return 'bg-ontrack';
    // Pause is an action, not a status, so it gets neutral treatment. Both of
    // these are the app waiting on the cook rather than judging the cook.
    case 'needs-reading': return 'bg-ink-dim';
    case 'restart-oven': return 'bg-ink-dim';
    default: return 'bg-ink-mute';
  }
});

/**
 * Manual pause / restart. This band is the only route to those two sheets, so
 * it stays reachable whenever the recommendation has no action of its own.
 */
const pauseControl = computed(() =>
  isPaused.value
    ? { kind: 'ghost', label: 'Log oven restart', event: 'openRestartModal' }
    : { kind: 'ghost', label: 'Pause cooking', event: 'openPauseModal' }
);

/**
 * Exactly one control, ever. `kind: 'primary'` is the recommendation's own
 * action; `'ghost'` is the session escape hatch we offer when the
 * recommendation itself needs no button.
 */
const control = computed(() => {
  if (!canRecommend.value) {
    switch (blockerType.value) {
      case 'no_oven_data':
      case 'stale_oven_data':
        return { kind: 'ghost', label: 'Update oven temp', event: 'openOvenModal' };
      // The BottomBar already carries "+ Add reading" in the thumb zone, and the
      // status band's prompt strip is already saying this louder. Spend the one
      // control on the escape hatch nothing else reaches.
      case 'stale_reading':
        return pauseControl.value;
      // No "Add reading" control here: App.vue's BottomBar already carries
      // "+ Add reading" as its primary button whenever a session is active, and
      // this band renders directly above it - the two rendered as a stack of
      // identical buttons. The pause/restart escape hatch is the one action the
      // bottom bar does not offer.
      case 'insufficient_readings':
        return pauseControl.value;
      // This used to be a dead end: the button opened the settings sheet, which
      // had no serve-time control anywhere in it. Settings now leads with an
      // editable Cook plan section, so the one action this blocker offers can
      // actually clear it.
      case 'no_serve_time':
        return { kind: 'ghost', label: 'Set serve time', event: 'openSettings' };
      // Nothing the cook can do but take another reading, which the BottomBar
      // already offers. Fall through to the pause/restart escape hatch.
      case 'no_projection':
        return pauseControl.value;
      // Nothing to offer before there is a session to act on.
      case 'no_session':
        return null;
      default:
        return pauseControl.value;
    }
  }

  switch (action.value) {
    // Both of these states are waiting on a reading, and both used to offer
    // their own "Add reading" button directly above the BottomBar's identical
    // one. The headline already says a reading is what is needed, and the
    // bottom bar is where the thumb already is - so this band spends its single
    // control on pause/restart, which nothing else reaches.
    case 'needs-reading':
      // The locked decision: measure the meat, never estimate how far it cooled.
      // With the oven off, pauseControl resolves to "Log oven restart", which is
      // the other half of what a paused cook needs.
      return pauseControl.value;

    case 'restart-oven':
      // The oven is off and a post-pause reading exists, so the app knows where
      // the meat is - it just cannot advise anything about a cold oven. The one
      // action that means something here is turning it back on.
      return { kind: 'primary', label: 'Log oven restart', event: 'openRestartModal' };

    case 'settling':
      // Nothing to apply - the change has been accepted, and the only thing that
      // moves this state forward is a reading that shows its effect.
      return pauseControl.value;

    case 'raise':
    case 'lower':
      return { kind: 'primary', label: `Set oven to ${suggestedTempFormatted.value}`, apply: true };

    case 'oven-off':
      // oven-off can fire while the oven is already off (paused, fresh reading,
      // still early), so the oven's actual state decides the control.
      if (isPaused.value) return { kind: 'primary', label: 'Log oven restart', event: 'openRestartModal' };
      return {
        kind: 'primary',
        label: ovenOffMinutes.value ? `Turn oven off for ${ovenOffMinutes.value} min` : 'Turn oven off',
        event: 'openPauseModal'
      };

    case 'at-target':
      // Nothing to apply - the cook is done, so the only thing left to offer is
      // finishing it. Straight to the confirmation rather than via Settings.
      return { kind: 'ghost', label: 'End session…', event: 'openEndSession' };

    default:
      return pauseControl.value;
  }
});

// "Why?" is only a fair label when there is a recommendation to explain. The
// oven-responsiveness note rides along here rather than earning a second
// disclosure of its own.
const explanation = computed(() => {
  if (!canRecommend.value || !reasoning.value) return null;
  const parts = [reasoning.value];
  if (hasResponsivenessData.value) parts.push(responsiveness.value.description);
  return parts.join(' ');
});

function runControl() {
  const next = control.value;
  if (!next) return;
  if (next.apply) {
    applyRecommendation();
    return;
  }
  emit(next.event);
}

function applyRecommendation() {
  if (suggestedTemp.value === null) return;
  addOvenEvent(suggestedTemp.value);
  const verb = action.value === 'raise' ? 'raised' : 'lowered';
  showToast(`Oven ${verb} to ${suggestedTempFormatted.value}`, 'success');
}
</script>
