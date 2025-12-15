import { celsiusToFahrenheit } from './temperatureUtils.js';

/**
 * Validate session configuration
 * @param {Partial<SessionConfig>} config
 * @param {'F'|'C'} units - Current display units
 * @returns {{valid: boolean, errors: Object<string, string>}}
 */
export function validateSessionConfig(config, units) {
  const errors = {};
  
  // Target temp is required
  if (config.targetTemp === undefined || config.targetTemp === null) {
    errors.targetTemp = 'Target temperature is required';
  } else {
    const targetF = units === 'C' ? celsiusToFahrenheit(config.targetTemp) : config.targetTemp;
    if (targetF < 32 || targetF > 212) {
      errors.targetTemp = 'Target must be between 32°F and 212°F (0°C and 100°C)';
    }
  }
  
  // Initial oven temp is required
  if (config.initialOvenTemp === undefined || config.initialOvenTemp === null) {
    errors.initialOvenTemp = 'Initial oven temperature is required';
  } else {
    const ovenF = units === 'C' ? celsiusToFahrenheit(config.initialOvenTemp) : config.initialOvenTemp;
    if (ovenF < 100 || ovenF > 550) {
      errors.initialOvenTemp = 'Oven temp must be between 100°F and 550°F (38°C and 288°C)';
    }
  }
  
  // Optional starting temp validation
  if (config.startingTemp !== undefined && config.startingTemp !== null) {
    const startF = units === 'C' ? celsiusToFahrenheit(config.startingTemp) : config.startingTemp;
    if (startF < 32 || startF > 212) {
      errors.startingTemp = 'Starting temp must be between 32°F and 212°F';
    }
  }
  
  // Desired serve time validation
  if (config.desiredServeTime) {
    const serveTime = new Date(config.desiredServeTime);
    if (isNaN(serveTime.getTime())) {
      errors.desiredServeTime = 'Invalid date/time format';
    }
  }
  
  // Weight validation
  if (config.weight !== undefined && config.weight !== null) {
    if (config.weight <= 0 || config.weight > 100) {
      errors.weight = 'Weight must be between 0 and 100 pounds';
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate a temperature reading input
 * @param {number} temp
 * @param {'F'|'C'} units
 * @param {number|null} previousTempF - Previous reading in Fahrenheit (for delta check)
 * @returns {{valid: boolean, error: string|null, warning: string|null}}
 */
export function validateReading(temp, units, previousTempF = null) {
  if (temp === undefined || temp === null || temp === '') {
    return { valid: false, error: 'Temperature is required', warning: null };
  }
  
  const tempNum = parseFloat(temp);
  if (isNaN(tempNum)) {
    return { valid: false, error: 'Temperature must be a number', warning: null };
  }
  
  const tempF = units === 'C' ? celsiusToFahrenheit(tempNum) : tempNum;
  
  if (tempF < 32) {
    return { valid: false, error: 'Temperature is below freezing', warning: null };
  }
  
  if (tempF > 212) {
    return { valid: false, error: 'Temperature exceeds boiling point', warning: null };
  }
  
  // Warning for large jumps from previous reading
  let warning = null;
  if (previousTempF !== null) {
    const delta = Math.abs(tempF - previousTempF);
    if (delta > 20) {
      warning = `Large change from previous reading (${delta.toFixed(1)}°F). Please verify.`;
    }
  }
  
  return { valid: true, error: null, warning };
}

/**
 * Validate an oven temperature input
 * @param {number} temp
 * @param {'F'|'C'} units
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateOvenTemp(temp, units) {
  if (temp === undefined || temp === null || temp === '') {
    return { valid: false, error: 'Oven temperature is required' };
  }
  
  const tempNum = parseFloat(temp);
  if (isNaN(tempNum)) {
    return { valid: false, error: 'Temperature must be a number' };
  }
  
  const tempF = units === 'C' ? celsiusToFahrenheit(tempNum) : tempNum;
  
  if (tempF < 100) {
    return { valid: false, error: 'Oven temperature too low (minimum 100°F / 38°C)' };
  }
  
  if (tempF > 550) {
    return { valid: false, error: 'Oven temperature too high (maximum 550°F / 288°C)' };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate settings values
 * @param {Partial<AppSettings>} settings
 * @returns {{valid: boolean, errors: Object<string, string>}}
 */
export function validateSettings(settings) {
  const errors = {};
  
  if (settings.smoothingWindowReadings !== undefined) {
    if (settings.smoothingWindowReadings < 2 || settings.smoothingWindowReadings > 10) {
      errors.smoothingWindowReadings = 'Must be between 2 and 10';
    }
  }
  
  if (settings.smoothingWindowMinutes !== undefined) {
    if (settings.smoothingWindowMinutes < 5 || settings.smoothingWindowMinutes > 120) {
      errors.smoothingWindowMinutes = 'Must be between 5 and 120 minutes';
    }
  }
  
  if (settings.onTrackThresholdMinutes !== undefined) {
    if (settings.onTrackThresholdMinutes < 1 || settings.onTrackThresholdMinutes > 60) {
      errors.onTrackThresholdMinutes = 'Must be between 1 and 60 minutes';
    }
  }
  
  if (settings.recommendationStepF !== undefined) {
    if (settings.recommendationStepF < 5 || settings.recommendationStepF > 50) {
      errors.recommendationStepF = 'Must be between 5 and 50 degrees';
    }
  }
  
  if (settings.ovenTempMinF !== undefined && settings.ovenTempMaxF !== undefined) {
    if (settings.ovenTempMinF >= settings.ovenTempMaxF) {
      errors.ovenTempMinF = 'Minimum must be less than maximum';
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Sanitize string input
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeString(input, maxLength = 500) {
  if (!input) return '';
  return String(input).trim().slice(0, maxLength);
}


