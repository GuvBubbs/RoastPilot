import { celsiusToFahrenheit } from './temperatureUtils.js';

/**
 * Validate session configuration
 * @param {Partial<SessionConfig>} config
 * @param {'F'|'C'} units - Current display units
 * @returns {{valid: boolean, errors: Object<string, string>}}
 */
export function validateSessionConfig(config, units) {
  const errors = {};
  
  // The plate temperature is the one the cook chooses, so it is the one that has
  // to be present and in range. pullTempF is derived from it and is checked
  // separately below only for internal consistency.
  if (config.servingTempF === undefined || config.servingTempF === null) {
    errors.servingTempF = 'Serving temperature is required';
  } else {
    const servingF = units === 'C' ? celsiusToFahrenheit(config.servingTempF) : config.servingTempF;
    if (servingF < 32 || servingF > 212) {
      errors.servingTempF = 'Serving temperature must be between 32°F and 212°F (0°C and 100°C)';
    }
  }
  
  // The pull has to be at or below the plate temperature: carryover only ever
  // adds heat. A pull above it would mean the app aiming past where the cook
  // wants to end up.
  if (config.pullTempF !== undefined && config.pullTempF !== null &&
      config.servingTempF !== undefined && config.servingTempF !== null &&
      config.pullTempF > config.servingTempF) {
    errors.pullTempF = 'Pull temperature cannot be above the serving temperature';
  }
  
  if (config.restMinutes !== undefined && config.restMinutes !== null) {
    if (!Number.isFinite(config.restMinutes) || config.restMinutes < 0 || config.restMinutes > 240) {
      errors.restMinutes = 'Rest must be between 0 and 240 minutes';
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
  
  /**
   * The measured dimensions.
   *
   * ALWAYS CENTIMETRES, never converted here. Note the asymmetry above: the
   * temperature fields arrive in display units and are converted, because they
   * come straight off the form; `weight` arrives as canonical pounds and is
   * checked as-is. Lengths follow weight, because the form converts them through
   * lengthToStorage before submitting. Converting them a second time here would
   * be the same class of bug as running carryover through the absolute
   * temperature converter.
   *
   * Absent is VALID. Every field in this block is optional and nothing downstream
   * requires it - see PHASE_8_MEASURED_INPUTS.md's A1.
   *
   * BOTH SCALES IN EVERY MESSAGE, like the temperature messages above. A cook
   * measuring in inches sees a field whose suffix reads `in`, and a message quoting
   * only centimetres cannot tell them whether the number they typed is the problem.
   * The stepper ceilings in SessionSetupModal are derived from these same bounds -
   * see lengthLimits there - so an in-range value can no longer be offered and then
   * refused.
   */
  if (config.thicknessCm !== undefined && config.thicknessCm !== null) {
    if (!Number.isFinite(config.thicknessCm) || config.thicknessCm < 2 || config.thicknessCm > 30) {
      errors.thicknessCm = 'Thickness must be between 2 and 30 cm (0.8 and 11.8 in)';
    }
  }
  
  if (config.lengthCm !== undefined && config.lengthCm !== null) {
    if (!Number.isFinite(config.lengthCm) || config.lengthCm < 3 || config.lengthCm > 100) {
      errors.lengthCm = 'Length must be between 3 and 100 cm (1.2 and 39.4 in)';
    } else if (Number.isFinite(config.thicknessCm) && config.lengthCm < config.thicknessCm) {
      /**
       * A roast cannot be shorter than it is thick, and this is the rule most
       * likely to be lost. `validateSettings` carried exactly this class of
       * cross-field check, was deleted as dead code, and its rule went unstated
       * until someone noticed it missing - see the tombstone below.
       *
       * It also catches the realistic mistake: the two fields swapped.
       */
      errors.lengthCm = 'Length cannot be less than the thickness';
    }
  }
  
  if (config.covering !== undefined && config.covering !== null) {
    if (!['open', 'foil', 'lid'].includes(config.covering)) {
      errors.covering = 'Covering must be open, foil or lid';
    }
  }
  
  if (config.ambientF !== undefined && config.ambientF !== null) {
    // Canonical °F, like weight and the lengths: the form converts on submit.
    if (!Number.isFinite(config.ambientF) || config.ambientF < 32 || config.ambientF > 120) {
      errors.ambientF = 'Kitchen temperature must be between 32°F and 120°F (0°C and 49°C)';
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/*
 * There used to be a `validateSettings` here. It had no call sites, and every
 * bound it checked is already enforced by the `min`/`max` props on the settings
 * steppers - which is the enforcement the user actually experiences, since the
 * only way to change a setting is through one of them. Two statements of the
 * same bound, one of them never executed, is one more place for them to
 * disagree.
 */

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
  
  // Warning for large jumps from previous reading. The threshold stays in
  // Fahrenheit so the behaviour is unit-independent, but the delta is shown
  // in the user's units. A temperature difference converts by scale only --
  // no 32 degree offset -- so fahrenheitToCelsius must not be used here.
  let warning = null;
  if (previousTempF !== null) {
    const deltaF = Math.abs(tempF - previousTempF);
    if (deltaF > 20) {
      const delta = units === 'C' ? deltaF / 1.8 : deltaF;
      warning = `Large change from previous reading (${delta.toFixed(1)}°${units}). Please verify.`;
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
 * Sanitize string input
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeString(input, maxLength = 500) {
  if (!input) return '';
  return String(input).trim().slice(0, maxLength);
}
