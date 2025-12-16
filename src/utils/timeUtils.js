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
 * Add minutes to a timestamp
 * @param {string} timestampISO - Base timestamp as ISO 8601 string
 * @param {number} minutes - Minutes to add (can be negative)
 * @returns {string} New timestamp as ISO 8601 string
 */
export function addMinutes(timestampISO, minutes) {
  const date = new Date(timestampISO);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
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
  
  const hours = Math.floor(absMinutes / 60);
  const remainingMinutes = Math.round(absMinutes % 60);
  
  if (remainingMinutes === 0) {
    return `${sign}${hours}h`;
  }
  
  return `${sign}${hours}h ${remainingMinutes}m`;
}

/**
 * Format a timestamp to local time string (HH:MM AM/PM)
 * @param {string} timestampISO - ISO 8601 timestamp
 * @returns {string} Formatted time
 */
export function formatTime(timestampISO) {
  if (!timestampISO) return '--';
  
  const date = new Date(timestampISO);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
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



