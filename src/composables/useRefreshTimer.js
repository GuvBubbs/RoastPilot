import { ref, onMounted, onUnmounted } from 'vue';

/**
 * One shared clock tick for everything that renders a time.
 *
 * Module-scope state deliberately: a dozen components asking "what time is it"
 * should not mean a dozen intervals, and they must all agree.
 */
const tick = ref(0);
let intervalId = null;
let currentIntervalMs = null;
let visibilityHandler = null;

/**
 * Every live subscription and the interval it asked for.
 *
 * A COUNT is not enough, which was the bug: the interval was created by whoever
 * mounted first and every later `useRefreshTimer(5000)` was silently ignored -
 * it got 30 s because that is what the first caller happened to want. A
 * component that needs a faster clock has no way to tell, because the tick still
 * ticks.
 */
const subscribers = new Map();
let nextSubscriberId = 0;

/**
 * Floor on the shared interval.
 *
 * Load-bearing for the simulation harness: driver.js winds the clock forward by
 * exactly one 30 s step per advance so the tick fires exactly once, and a faster
 * interval would fire several times per advance and desynchronise every
 * committed transcript. It is also simply the right floor - nothing in this app
 * changes meaningfully inside 30 seconds.
 */
export const MIN_INTERVAL_MS = 30_000;

/** The fastest interval any live subscriber asked for, floored. */
function effectiveIntervalMs() {
  if (subscribers.size === 0) return null;
  return Math.max(MIN_INTERVAL_MS, Math.min(...subscribers.values()));
}

function stopInterval() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  currentIntervalMs = null;
}

function syncInterval() {
  const wanted = effectiveIntervalMs();
  if (wanted === currentIntervalMs) return;
  stopInterval();
  if (wanted === null) return;
  currentIntervalMs = wanted;
  intervalId = setInterval(() => { tick.value++; }, wanted);
}

/**
 * Catch up after the page was hidden.
 *
 * This is a PWA that lives on a kitchen counter, and iOS suspends timers in a
 * backgrounded tab - reliably, and without telling anyone. Come back after forty
 * minutes in a pocket and the interval simply did not fire: every countdown, the
 * reading-age text and the reading prompt are all still showing what they showed
 * when the phone went into the pocket. The app would say the next reading is due
 * in five minutes when it was due half an hour ago.
 *
 * So the tick is bumped the moment the page becomes visible again, before any
 * interval would have fired, and the interval is restarted from that instant
 * rather than left on whatever phase it was suspended on.
 */
function handleVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  tick.value++;
  // Re-phase: an interval that was suspended mid-period would otherwise fire at
  // an arbitrary offset from the moment the cook actually started looking again.
  if (intervalId !== null) {
    const wanted = currentIntervalMs;
    stopInterval();
    currentIntervalMs = wanted;
    intervalId = setInterval(() => { tick.value++; }, wanted);
  }
}

function addVisibilityListener() {
  if (typeof document === 'undefined' || visibilityHandler) return;
  visibilityHandler = handleVisibilityChange;
  document.addEventListener('visibilitychange', visibilityHandler);
}

function removeVisibilityListener() {
  if (typeof document === 'undefined' || !visibilityHandler) return;
  document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
}

/**
 * A reactive tick for time-based displays. Depend on `tick.value` inside a
 * computed and it re-evaluates on every tick.
 *
 * @param {number} [intervalMs] - How often THIS caller needs to re-read the
 *   clock. The shared interval runs at the fastest any live caller asked for,
 *   floored at MIN_INTERVAL_MS.
 * @returns {{tick: import('vue').Ref<number>}}
 */
export function useRefreshTimer(intervalMs = MIN_INTERVAL_MS) {
  // Allocated per call site, not per component: one component may legitimately
  // use two composables that each want their own cadence.
  const id = nextSubscriberId++;

  onMounted(() => {
    subscribers.set(id, intervalMs);
    syncInterval();
    addVisibilityListener();
  });

  onUnmounted(() => {
    subscribers.delete(id);
    syncInterval();
    if (subscribers.size === 0) removeVisibilityListener();
  });

  return { tick };
}

/**
 * Reset the shared clock. For tests only: the state above is module-scoped, so a
 * suite that mounts and unmounts components leaks subscribers into the next one.
 */
export function __resetRefreshTimer() {
  subscribers.clear();
  stopInterval();
  removeVisibilityListener();
  tick.value = 0;
}
