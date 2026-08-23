import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { useRefreshTimer } from './useRefreshTimer.js';
import { addMinutes, minutesBetween, formatTimeCompact } from '../utils/timeUtils.js';

/**
 * When the next reading is due, and how loudly to say so.
 *
 * WHY THIS EXISTS AT ALL. Nothing in the app ever asked for a reading. The
 * harness measured the consequence: overshoot averaged 13.6 °F and reached
 * 31.5 °F, and the meat was done for 22 minutes on average before the app knew
 * it. Every formula change measured against that deck moved overshoot by less
 * than a degree, because overshoot is not a modelling error - it is the app
 * being blind between readings. Asking for one is the only lever there is.
 *
 * WHY THE CADENCE IS DERIVED. A fixed timer is wrong at both ends of a cook.
 * Early on a roast climbs 10 °F/hr and a 20-minute reminder is noise; in the
 * last half hour it climbs 40 °F/hr and 45 minutes is 30 °F of unobserved core -
 * which is exactly how a roast ends up 31 °F past target. So the rule is stated
 * in degrees, not minutes:
 *
 *     never let more than DEGREES_BETWEEN_READINGS of core pass unobserved
 *
 * and the minutes fall out of the current rate.
 */

/** °F of core the app is willing to be blind for. */
export const DEGREES_BETWEEN_READINGS = 8;

/** Never ask more often than this, however fast the roast is climbing. */
export const MIN_SPACING_MINUTES = 10;

/**
 * Cadence with no projection to derive one from.
 *
 * Not null. Returning null would silence the prompt for exactly the first hour
 * of every cook - the stretch where readings are scarcest, where the app has the
 * least data, and where one more reading is worth the most.
 */
export const FALLBACK_SPACING_MINUTES = 30;

/** How close to the pull the last reading should be taken. */
export const PRE_PULL_MARGIN_MINUTES = 5;

/** Ramp of urgency, in minutes either side of the due time. */
export const SOON_MINUTES = 5;
export const OVERDUE_MINUTES = 10;

/**
 * Derive the spacing between readings from the heating rate.
 *
 * @param {number|null} rateFPerHour
 * @param {number} maxMinutes - The longest gap the settings allow
 * @returns {number} Minutes
 */
export function spacingForRate(rateFPerHour, maxMinutes) {
  if (!Number.isFinite(rateFPerHour) || rateFPerHour <= 0) {
    return Math.min(FALLBACK_SPACING_MINUTES, maxMinutes);
  }
  const minutes = (DEGREES_BETWEEN_READINGS / rateFPerHour) * 60;
  return Math.min(maxMinutes, Math.max(MIN_SPACING_MINUTES, minutes));
}

export function useReadingSchedule() {
  const { readings, config, settings, ovenEvents } = useSession();
  const { currentRateRaw, predictedTargetTime, targetReached } = useCalculations();
  const { tick } = useRefreshTimer();

  const maxSpacingMinutes = computed(() => settings.value?.readingIntervalMinutes ?? 45);

  const latestReading = computed(() => {
    const list = readings.value;
    return list.length > 0 ? list[list.length - 1] : null;
  });

  /** Minutes the app is willing to wait, at the current rate. */
  const spacingMinutes = computed(() =>
    Math.round(spacingForRate(currentRateRaw.value, maxSpacingMinutes.value))
  );

  /**
   * Whether a prompt makes sense at all.
   *
   * Two states where asking for a reading is the wrong thing to say. Once the
   * pull temperature is reached the cook should be taking the meat out, not
   * measuring it again. And while the oven is off with nothing logged since, the
   * advice band is ALREADY asking for a reading in its own words - a second
   * ask, in a different place, in different words, is one message too many.
   */
  const isRelevant = computed(() => {
    if (!config.value) return false;
    if (targetReached.value) return false;
    const events = ovenEvents.value;
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    if (lastEvent?.isOff === true) {
      const hasReadingSincePause = latestReading.value !== null &&
        latestReading.value.timestamp >= lastEvent.timestamp;
      if (!hasReadingSincePause) return false;
    }
    return true;
  });

  /**
   * When the next reading is due.
   *
   * The earlier of "one spacing after the last reading" and "shortly before the
   * projected pull". The second clamp is what catches the endgame: a projection
   * landing in twelve minutes should not be answered with "next reading in
   * forty", which is how the app came to be told about a finished roast half an
   * hour after the fact.
   */
  const dueAt = computed(() => {
    if (!isRelevant.value) return null;

    const last = latestReading.value;
    // No readings at all: the cook has just started, and the session's own start
    // is the thing to count from.
    const anchor = last ? last.timestamp : config.value.createdAt;
    if (!anchor) return null;

    let due = addMinutes(anchor, spacingMinutes.value);

    const pull = predictedTargetTime.value;
    if (pull) {
      const beforePull = addMinutes(pull, -PRE_PULL_MARGIN_MINUTES);
      // Only pull the deadline earlier, never later: a projection an hour out
      // must not license a longer gap than the rate already justifies.
      if (beforePull < due) due = beforePull;
      // ...and never earlier than the floor, or a projection landing in three
      // minutes would demand a reading in the past forever.
      const floor = addMinutes(anchor, MIN_SPACING_MINUTES);
      if (due < floor) due = floor;
    }

    return due;
  });

  /** Minutes until the next reading is due; negative once it is overdue. */
  const minutesUntilDue = computed(() => {
    tick.value;
    if (!dueAt.value) return null;
    return Math.round(minutesBetween(new Date().toISOString(), dueAt.value));
  });

  /** How old the newest reading is, in minutes. */
  const readingAgeMinutes = computed(() => {
    tick.value;
    if (!latestReading.value) return null;
    return Math.round(minutesBetween(latestReading.value.timestamp, new Date().toISOString()));
  });

  /**
   * The ramp: 'none' | 'scheduled' | 'soon' | 'now' | 'overdue'.
   *
   * Four states rather than a boolean because they earn different surfaces.
   * `scheduled` is a clause appended to text that is already on screen; the
   * other three are a band of their own.
   */
  const status = computed(() => {
    if (!isRelevant.value || minutesUntilDue.value === null) return 'none';
    const remaining = minutesUntilDue.value;
    if (remaining > SOON_MINUTES) return 'scheduled';
    if (remaining > 0) return 'soon';
    if (remaining > -OVERDUE_MINUTES) return 'now';
    return 'overdue';
  });

  const isPrompting = computed(() => ['soon', 'now', 'overdue'].includes(status.value));

  /** Clock time the next reading is due, for the recency line. */
  const dueAtFormatted = computed(() => {
    tick.value;
    return dueAt.value ? formatTimeCompact(dueAt.value) : null;
  });

  /** One line, sized to the surface it lands on. */
  const promptText = computed(() => {
    const remaining = minutesUntilDue.value;
    const age = readingAgeMinutes.value;
    switch (status.value) {
      case 'soon':
        return `Next reading in ${remaining} min`;
      case 'now':
        return 'Time for a reading';
      case 'overdue':
        return age === null
          ? 'Reading overdue'
          : `Reading overdue — last one ${formatAge(age)} ago`;
      default:
        return null;
    }
  });

  /**
   * Tone, reusing the app's existing interpretation ramp rather than inventing a
   * colour: ink-mute -> ink-dim -> ink -> late.
   */
  const promptTone = computed(() => {
    switch (status.value) {
      case 'soon': return 'text-ink-dim';
      case 'now': return 'text-ink';
      case 'overdue': return 'text-late';
      default: return 'text-ink-mute';
    }
  });

  return {
    status,
    isPrompting,
    dueAt,
    dueAtFormatted,
    minutesUntilDue,
    readingAgeMinutes,
    spacingMinutes,
    promptText,
    promptTone
  };
}

/** Compact age for a single line: "12 min", "1h 20m". */
function formatAge(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
