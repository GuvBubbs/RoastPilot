/**
 * Convert Fahrenheit to Celsius
 * @param {number} fahrenheit
 * @returns {number} Celsius rounded to 1 decimal
 */
export function fahrenheitToCelsius(fahrenheit) {
  return Math.round(((fahrenheit - 32) * 5 / 9) * 10) / 10;
}

/**
 * Convert Celsius to Fahrenheit
 * @param {number} celsius
 * @returns {number} Fahrenheit rounded to 1 decimal
 */
export function celsiusToFahrenheit(celsius) {
  return Math.round((celsius * 9 / 5 + 32) * 10) / 10;
}

/**
 * Convert temperature to display units
 * @param {number} tempF - Temperature in Fahrenheit (internal storage unit)
 * @param {'F'|'C'} displayUnit - Target display unit
 * @returns {number}
 */
export function toDisplayUnit(tempF, displayUnit) {
  if (displayUnit === 'C') {
    return fahrenheitToCelsius(tempF);
  }
  return Math.round(tempF * 10) / 10;
}

/**
 * Convert temperature from display units to Fahrenheit for storage
 * @param {number} temp - Temperature in display units
 * @param {'F'|'C'} displayUnit - Current display unit
 * @returns {number} Temperature in Fahrenheit
 */
export function toStorageUnit(temp, displayUnit) {
  if (displayUnit === 'C') {
    return celsiusToFahrenheit(temp);
  }
  return temp;
}

/**
 * Format temperature for display with unit symbol
 * @param {number} tempF - Temperature in Fahrenheit
 * @param {'F'|'C'} displayUnit - Display unit
 * @param {boolean} [includeSymbol=true] - Whether to include °F or °C
 * @returns {string}
 */
export function formatTemperature(tempF, displayUnit, includeSymbol = true) {
  const converted = toDisplayUnit(tempF, displayUnit);
  const symbol = includeSymbol ? `°${displayUnit}` : '';
  return `${converted}${symbol}`;
}

/**
 * Format temperature delta (change)
 * @param {number} deltaF - Temperature change in Fahrenheit
 * @param {'F'|'C'} displayUnit
 * @param {boolean} [includeSign=true] - Whether to include +/- prefix
 * @returns {string}
 */
export function formatDelta(deltaF, displayUnit, includeSign = true) {
  const converted = displayUnit === 'C' 
    ? Math.round((deltaF * 5 / 9) * 10) / 10  // Delta conversion doesn't use 32 offset
    : Math.round(deltaF * 10) / 10;
  
  const sign = includeSign && converted > 0 ? '+' : '';
  return `${sign}${converted}°${displayUnit}`;
}

/**
 * Convert a rate from °F/hour to °C/hour if needed
 * @param {number} rateF - Rate in degrees F per hour
 * @param {'F'|'C'} displayUnit
 * @returns {number}
 */
export function convertRate(rateF, displayUnit) {
  if (displayUnit === 'C') {
    return Math.round((rateF * 5 / 9) * 100) / 100;
  }
  return Math.round(rateF * 100) / 100;
}

/**
 * Format a heating rate for display
 * @param {number} rateF - Rate in degrees F per hour
 * @param {'F'|'C'} displayUnit
 * @returns {string}
 */
export function formatRate(rateF, displayUnit) {
  const converted = convertRate(rateF, displayUnit);
  return `${converted}°${displayUnit}/hr`;
}

/**
 * Validate that a temperature value is reasonable for cooking
 * @param {number} temp - Temperature in the given unit
 * @param {'F'|'C'} unit
 * @param {'internal'|'oven'} type - Type of temperature being validated
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateTemperature(temp, unit, type) {
  if (typeof temp !== 'number' || isNaN(temp)) {
    return { valid: false, error: 'Temperature must be a number' };
  }
  
  // Convert to Fahrenheit for validation
  const tempF = unit === 'C' ? celsiusToFahrenheit(temp) : temp;
  
  if (type === 'internal') {
    // Internal meat temps typically 32°F to 212°F
    if (tempF < 32) {
      return { valid: false, error: 'Temperature too low (below freezing)' };
    }
    if (tempF > 212) {
      return { valid: false, error: 'Temperature too high (above boiling)' };
    }
  }
  
  if (type === 'oven') {
    // Oven temps typically 100°F to 550°F
    if (tempF < 100) {
      return { valid: false, error: 'Oven temperature too low' };
    }
    if (tempF > 550) {
      return { valid: false, error: 'Oven temperature too high' };
    }
  }
  
  return { valid: true, error: null };
}

/**
 * Get common target temperatures for meat types
 * @returns {Array<{name: string, targetF: number, description: string}>}
 */
export function getCommonTargets() {
  return [
    { name: 'Beef - Rare', targetF: 120, description: 'Cool red center' },
    { name: 'Beef - Medium Rare', targetF: 130, description: 'Warm red center' },
    { name: 'Beef - Medium', targetF: 140, description: 'Warm pink center' },
    { name: 'Beef - Medium Well', targetF: 150, description: 'Slightly pink center' },
    { name: 'Beef - Well Done', targetF: 160, description: 'No pink' },
    { name: 'Pork', targetF: 145, description: 'USDA recommended' },
    { name: 'Poultry', targetF: 165, description: 'USDA recommended' },
    { name: 'Lamb - Medium Rare', targetF: 130, description: 'Warm red center' },
    { name: 'Lamb - Medium', targetF: 140, description: 'Warm pink center' }
  ];
}



