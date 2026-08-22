/**
 * Calculate the difference between two timestamps in minutes
 * @param {string} startISO - Start time as ISO 8601 string
 * @param {string} endISO - End time as ISO 8601 string
 * @returns {number} Difference in minutes
 */
export function minutesBetween(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return (end.getTime() - start.getTime()) / (1000 * 60);
}

/**
 * Calculate the difference between two timestamps in hours
 * @param {string} startISO - Start time as ISO 8601 string
 * @param {string} endISO - End time as ISO 8601 string
 * @returns {number} Difference in hours
 */
export function hoursBetween(startISO, endISO) {
  return minutesBetween(startISO, endISO) / 60;
}

/**
 * Add minutes to a timestamp.
 *
 * Epoch arithmetic, deliberately. `date.setMinutes(date.getMinutes() + n)` is
 * LOCAL wall-clock arithmetic: it adds n to the wall clock and then asks the
 * zone what instant that is. Across a DST boundary the two are not the same
 * question. Adding 120 minutes to 01:30 on a spring-forward morning gives 03:30
 * wall clock, which is 90 real minutes later, not 120 - so every projection that
 * crossed a transition was a whole hour out, in the direction that flips
 * "on track" to "an hour late" or the reverse.
 *
 * This is also the one function the whole projection is built on: predictTimeToTarget
 * derives its target time from it, the schedule variance is measured against
 * that, and the recommendation is derived from the variance.
 *
 * @param {string} timestampISO - Base timestamp as ISO 8601 string
 * @param {number} minutes - Minutes to add (can be negative, or fractional)
 * @returns {string} New timestamp as ISO 8601 string
 */
export function addMinutes(timestampISO, minutes) {
  return new Date(Date.parse(timestampISO) + minutes * 60_000).toISOString();
}

/**
 * Format a duration in minutes to human-readable string
 * @param {number} minutes
 * @param {boolean} [includeSeconds=false]
 * @returns {string} e.g., "2h 30m" or "45m"
 */
export function formatDuration(minutes, includeSeconds = false) {
  if (minutes === null || isNaN(minutes)) {
    return '--';
  }
  
  const absMinutes = Math.abs(minutes);
  const sign = minutes < 0 ? '-' : '';
  
  if (absMinutes < 1 && includeSeconds) {
    const seconds = Math.round(absMinutes * 60);
    return `${sign}${seconds}s`;
  }
  
  if (absMinutes < 60) {
    return `${sign}${Math.round(absMinutes)}m`;
  }
  
  // Round to the minute FIRST, then split. Splitting first and rounding the
  // remainder rendered 119.6 minutes as "1h 60m": floor(119.6/60) is 1 and
  // round(119.6 % 60) is round(59.6) is 60. Sub-minute values reach here from
  // every projection, because the fit works in fractional hours.
  const totalMinutes = Math.round(absMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  
  if (remainingMinutes === 0) {
    return `${sign}${hours}h`;
  }
  
  return `${sign}${hours}h ${remainingMinutes}m`;
}

/**
 * Whether two instants fall on the same local calendar day.
 *
 * Compared as a local Y/M/D triple rather than by dividing the epoch: a day is
 * not always 86400 seconds long, and the days that are not are exactly the ones
 * this has to get right.
 *
 * @param {string} aISO
 * @param {string} bISO
 * @returns {boolean}
 */
export function isSameLocalDay(aISO, bISO) {
  const a = new Date(aISO);
  const b = new Date(bISO);
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/**
 * Format a timestamp to a local time string (HH:MM AM/PM), qualified with the
 * date when it is not the same local day as `referenceISO`.
 *
 * An unqualified clock time is a lie for anything more than a day out. A stalled
 * overnight shoulder could project six days ahead and the ETA cell rendered it
 * as "8:19 PM" - indistinguishable from this evening. The Phase 1 ETA cap makes
 * that projection impossible, but an overnight cook legitimately finishes
 * tomorrow, and so does a reading logged before midnight.
 *
 * @param {string} timestampISO - ISO 8601 timestamp
 * @param {string} [referenceISO] - The day to read "today" as; defaults to now
 * @returns {string} Formatted time, e.g. "8:19 PM" or "Aug 23, 8:19 AM"
 */
export function formatTime(timestampISO, referenceISO = null) {
  if (!timestampISO) return '--';
  
  const date = new Date(timestampISO);
  const reference = referenceISO ?? new Date().toISOString();
  
  if (isSameLocalDay(timestampISO, reference)) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Whole local days between two instants, by calendar date rather than by
 * elapsed time. `+1` for tomorrow however few hours away it is.
 *
 * @param {string} fromISO
 * @param {string} toISO
 * @returns {number}
 */
export function localDayOffset(fromISO, toISO) {
  const midnight = (iso) => {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  // Rounded, not floored: the interval between two local midnights is 23 or 25
  // hours across a DST boundary, and floor would lose a day.
  return Math.round((midnight(toISO) - midnight(fromISO)) / 86_400_000);
}

/**
 * A clock time with a compact day marker: "8:19 PM", or "8:19 PM +1" tomorrow.
 *
 * For the stat row, where formatTime's "Aug 23, 12:22 AM" does not fit. Those
 * cells are 96px wide at 320px viewport - the reason oven state is a chip there
 * rather than a fourth cell - and a truncated date is worse than no date, because
 * "Aug 23, 12:2…" reads as a rendering fault.
 *
 * @param {string} timestampISO
 * @param {string} [referenceISO] - The day to read as "today"; defaults to now
 * @returns {string}
 */
export function formatTimeCompact(timestampISO, referenceISO = null) {
  if (!timestampISO) return '--';
  
  const reference = referenceISO ?? new Date().toISOString();
  const clock = new Date(timestampISO).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  const offset = localDayOffset(reference, timestampISO);
  if (offset === 0) return clock;
  return `${clock} ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
}

/**
 * Format a timestamp to local date and time
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} Formatted date and time
 */
export function formatDateTime(timestampISO) {
  if (!timestampISO) return '--';
  
  const date = new Date(timestampISO);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format time elapsed since a timestamp
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} e.g., "5 min ago", "2 hours ago"
 */
export function formatTimeAgo(timestampISO) {
  const minutes = minutesBetween(timestampISO, new Date().toISOString());
  
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    const m = Math.round(minutes);
    return `${m} min${m !== 1 ? 's' : ''} ago`;
  }
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Check if a timestamp is within the last N minutes
 * @param {string} timestampISO - ISO 8601 timestamp
 * @param {number} minutes - Number of minutes
 * @returns {boolean}
 */
export function isWithinMinutes(timestampISO, minutes) {
  const elapsed = minutesBetween(timestampISO, new Date().toISOString());
  return elapsed <= minutes;
}

/**
 * Parse a time string (HH:MM) and combine with today's date
 * @param {string} timeString - Time in HH:MM format
 * @returns {string} ISO 8601 timestamp
 */
export function parseTimeToday(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/**
 * Get the current timestamp as ISO 8601
 * @returns {string}
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Calculate time remaining until a target timestamp
 * @param {string} targetISO - Target timestamp
 * @returns {number} Minutes remaining (negative if past)
 */
export function minutesUntil(targetISO) {
  return minutesBetween(new Date().toISOString(), targetISO);
}





