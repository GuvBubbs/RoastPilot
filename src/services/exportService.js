import { formatDateTime, formatDuration } from '../utils/timeUtils.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';

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
  const lines = [];
  
  // Metadata section
  lines.push('# Reverse Sear Tracker - Session Export');
  lines.push(`# Exported: ${formatDateTime(new Date().toISOString())}`);
  lines.push('');
  
  // Configuration
  lines.push('## Session Configuration');
  lines.push(`Target Temperature,${toDisplayUnit(session.config.targetTemp, units)},°${units}`);
  lines.push(`Initial Oven Temp,${toDisplayUnit(session.config.initialOvenTemp, units)},°${units}`);
  lines.push(`Started,${formatDateTime(session.config.createdAt)}`);
  if (session.config.desiredServeTime) {
    lines.push(`Target Serve Time,${formatDateTime(session.config.desiredServeTime)}`);
  }
  if (session.config.meatType) {
    lines.push(`Meat Type,${session.config.meatType}`);
  }
  if (session.config.meatCut) {
    lines.push(`Cut,${session.config.meatCut}`);
  }
  if (session.config.weight) {
    lines.push(`Weight,${session.config.weight},lbs`);
  }
  if (session.config.notes) {
    // Escape quotes in notes
    const escapedNotes = session.config.notes.replace(/"/g, '""');
    lines.push(`Notes,"${escapedNotes}"`);
  }
  lines.push('');
  
  // Internal readings table
  lines.push('## Internal Temperature Readings');
  lines.push(`Timestamp,Time,Temperature (°${units}),Delta From Start (°${units}),Delta From Previous (°${units}),Minutes Elapsed`);
  
  const startTime = session.readings.length > 0 
    ? new Date(session.readings[0].timestamp).getTime()
    : 0;
  
  session.readings.forEach(r => {
    const time = formatDateTime(r.timestamp);
    const temp = toDisplayUnit(r.temp, units).toFixed(1);
    
    // Delta calculations need to convert the delta itself (which is a temperature difference)
    const deltaStart = r.deltaFromStart !== null 
      ? (units === 'C' ? (r.deltaFromStart * 5 / 9).toFixed(1) : r.deltaFromStart.toFixed(1))
      : '';
    const deltaPrev = r.deltaFromPrevious !== null
      ? (units === 'C' ? (r.deltaFromPrevious * 5 / 9).toFixed(1) : r.deltaFromPrevious.toFixed(1))
      : '';
    const elapsed = Math.round((new Date(r.timestamp).getTime() - startTime) / 60000);
    
    lines.push(`${r.timestamp},${time},${temp},${deltaStart},${deltaPrev},${elapsed}`);
  });
  lines.push('');
  
  // Oven events table
  lines.push('## Oven Temperature Events');
  lines.push(`Timestamp,Time,Set Temperature (°${units}),Previous Temperature (°${units}),Change (°${units})`);
  
  session.ovenEvents.forEach(e => {
    const time = formatDateTime(e.timestamp);
    const setTemp = toDisplayUnit(e.setTemp, units).toFixed(0);
    const prevTemp = e.previousTemp !== null ? toDisplayUnit(e.previousTemp, units).toFixed(0) : '';
    const change = e.previousTemp !== null 
      ? (units === 'C' 
        ? ((e.setTemp - e.previousTemp) * 5 / 9).toFixed(0)
        : (e.setTemp - e.previousTemp).toFixed(0))
      : '';
    
    lines.push(`${e.timestamp},${time},${setTemp},${prevTemp},${change}`);
  });
  
  return lines.join('\n');
}

/**
 * Generate a summary of the session for export metadata
 */
function generateSessionSummary(session) {
  const readings = session.readings;
  const events = session.ovenEvents;
  
  if (readings.length === 0) {
    return {
      totalReadings: 0,
      totalOvenChanges: events.length,
      sessionDuration: null
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

