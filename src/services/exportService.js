import { formatDateTime } from '../utils/timeUtils.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';

/**
 * Escape a single value for use as one CSV field (RFC 4180).
 *
 * Every value written into the CSV must go through this. Free text (meat type,
 * cut, notes) can contain delimiters, and so can generated text:
 * `formatDateTime` emits "Aug 22, 2:31 PM", which without quoting splits one
 * timestamp across two columns and shifts every field after it.
 *
 * @param {*} value - Value to render; null/undefined become an empty field
 * @returns {string} The field, quoted only when it needs to be
 */
function csvField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // String() on a number is locale-independent (no thousands separators);
  // non-finite numbers have no useful CSV representation.
  const str = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : '')
    : String(value);

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Build one CSV row from a list of values, escaping each one
 * @param {Array<*>} values
 * @returns {string} A single CSV line
 */
function csvRow(values) {
  return values.map(csvField).join(',');
}

/**
 * Format a temperature for CSV output, in display units
 * @param {number} tempF - Temperature in Fahrenheit (internal storage unit)
 * @param {'F'|'C'} units
 * @param {number} decimals
 * @returns {string|null} Fixed-decimal string, or null if not a number
 */
function csvTemp(tempF, units, decimals) {
  if (typeof tempF !== 'number' || !Number.isFinite(tempF)) {
    return null;
  }
  return toDisplayUnit(tempF, units).toFixed(decimals);
}

/**
 * Format a temperature difference for CSV output. Deltas convert without the
 * 32° offset, so they can't go through toDisplayUnit.
 * @param {number} deltaF - Temperature change in Fahrenheit
 * @param {'F'|'C'} units
 * @param {number} decimals
 * @returns {string|null} Fixed-decimal string, or null if not a number
 */
function csvDelta(deltaF, units, decimals) {
  if (typeof deltaF !== 'number' || !Number.isFinite(deltaF)) {
    return null;
  }
  const converted = units === 'C' ? deltaF * 5 / 9 : deltaF;
  return converted.toFixed(decimals);
}

/**
 * Generate a comprehensive JSON export of the session
 * @param {Session} session
 * @returns {string} Formatted JSON string
 */
export function exportToJSON(session) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    session: {
      config: session.config,
      readings: session.readings,
      ovenEvents: session.ovenEvents,
      settings: session.settings
    },
    summary: generateSessionSummary(session)
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Generate a CSV export optimized for spreadsheet analysis
 * @param {Session} session
 * @returns {string} CSV content
 */
export function exportToCSV(session) {
  const units = session.config.units;
  const readings = session.readings || [];
  const ovenEvents = session.ovenEvents || [];
  const lines = [];

  // Metadata section — single-field rows, so a comma in the timestamp does not
  // spill into a second column
  lines.push(csvRow(['# Reverse Sear Tracker - Session Export']));
  lines.push(csvRow([`# Exported: ${formatDateTime(new Date().toISOString())}`]));
  lines.push('');

  // Configuration: Setting,Value,Unit for every row, so the section is a table
  lines.push(csvRow(['## Session Configuration']));
  lines.push(csvRow(['Setting', 'Value', 'Unit']));
  lines.push(csvRow(['Pull Temperature', csvTemp(session.config.pullTempF, units, 1), `°${units}`]));
  lines.push(csvRow(['Serving Temperature', csvTemp(session.config.servingTempF, units, 1), `°${units}`]));
  // csvDelta, not csvTemp: carryover is a DIFFERENCE. Run through the absolute
  // converter it came out as `Carryover,-15.0,°C` for a carryoverF of 5, next to a
  // correctly converted pull/serve pair - the freezing-point offset applied to a
  // number that has no zero.
  lines.push(csvRow(['Carryover', csvDelta(session.config.carryoverF, units, 1), `°${units}`]));
  lines.push(csvRow(['Rest', session.config.restMinutes ?? 0, 'minutes']));
  lines.push(csvRow(['Initial Oven Temp', csvTemp(session.config.initialOvenTemp, units, 1), `°${units}`]));
  lines.push(csvRow(['Started', formatDateTime(session.config.createdAt), '']));
  if (session.config.desiredServeTime) {
    lines.push(csvRow(['Target Serve Time', formatDateTime(session.config.desiredServeTime), '']));
  }
  if (session.config.meatType) {
    lines.push(csvRow(['Meat Type', session.config.meatType, '']));
  }
  if (session.config.meatCut) {
    lines.push(csvRow(['Cut', session.config.meatCut, '']));
  }
  if (session.config.weight) {
    lines.push(csvRow(['Weight', session.config.weight, 'lbs']));
  }
  if (session.config.notes) {
    lines.push(csvRow(['Notes', session.config.notes, '']));
  }
  lines.push('');

  // Internal readings table
  lines.push(csvRow(['## Internal Temperature Readings']));
  lines.push(csvRow([
    'Timestamp',
    'Time',
    `Temperature (°${units})`,
    `Delta From Start (°${units})`,
    `Delta From Previous (°${units})`,
    'Minutes Elapsed'
  ]));

  const startTime = readings.length > 0
    ? new Date(readings[0].timestamp).getTime()
    : 0;

  readings.forEach(r => {
    const elapsed = Math.round((new Date(r.timestamp).getTime() - startTime) / 60000);

    lines.push(csvRow([
      r.timestamp,
      formatDateTime(r.timestamp),
      csvTemp(r.temp, units, 1),
      csvDelta(r.deltaFromStart, units, 1),
      csvDelta(r.deltaFromPrevious, units, 1),
      elapsed
    ]));
  });
  lines.push('');

  // Oven events table
  lines.push(csvRow(['## Oven Temperature Events']));
  lines.push(csvRow([
    'Timestamp',
    'Time',
    `Set Temperature (°${units})`,
    `Previous Temperature (°${units})`,
    `Change (°${units})`
  ]));

  ovenEvents.forEach(e => {
    const change = typeof e.previousTemp === 'number' && typeof e.setTemp === 'number'
      ? csvDelta(e.setTemp - e.previousTemp, units, 0)
      : null;

    lines.push(csvRow([
      e.timestamp,
      formatDateTime(e.timestamp),
      csvTemp(e.setTemp, units, 0),
      csvTemp(e.previousTemp, units, 0),
      change
    ]));
  });

  return lines.join('\n');
}

/**
 * Generate a summary of the session for export metadata
 */
function generateSessionSummary(session) {
  const readings = session.readings || [];
  const events = session.ovenEvents || [];

  if (readings.length === 0) {
    // Same keys as the populated case, so consumers see a stable shape
    return {
      totalReadings: 0,
      totalOvenChanges: events.length,
      sessionDurationMinutes: null,
      startingTemp: null,
      endingTemp: null,
      totalTempChange: null,
      averageReadingInterval: null
    };
  }

  const firstReading = readings[0];
  const lastReading = readings[readings.length - 1];
  const durationMs = new Date(lastReading.timestamp) - new Date(firstReading.timestamp);

  return {
    totalReadings: readings.length,
    totalOvenChanges: events.length,
    sessionDurationMinutes: Math.round(durationMs / 60000),
    startingTemp: firstReading.temp,
    endingTemp: lastReading.temp,
    totalTempChange: lastReading.temp - firstReading.temp,
    averageReadingInterval: readings.length > 1
      ? Math.round(durationMs / (readings.length - 1) / 60000)
      : null
  };
}

/**
 * Trigger a file download
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Generate a timestamped filename
 * @param {string} baseName
 * @param {string} extension
 * @returns {string}
 */
export function generateFilename(baseName, extension) {
  const date = new Date();
  const timestamp = date.toISOString().slice(0, 10);
  return `${baseName}-${timestamp}.${extension}`;
}

