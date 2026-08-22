/**
 * validateSessionConfig had zero call sites when this was written, so none of
 * its rules had ever executed - including the weight bound, which is the one
 * thing in it a cook can get badly wrong. It is now called from
 * SessionSetupModal.handleSubmit, and these are the rules that run.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSessionConfig,
  validateReading,
  validateOvenTemp,
  sanitizeString
} from './validationUtils.js';

/** A config in the shape SessionSetupModal builds, in °F. */
function config(overrides = {}) {
  return {
    servingTempF: 125,
    pullTempF: 121,
    carryoverF: 4,
    restMinutes: 20,
    initialOvenTemp: 200,
    startingTemp: 48,
    desiredServeTime: '2026-08-22T23:00:00.000Z',
    weight: 6,
    ...overrides
  };
}

describe('validateSessionConfig', () => {
  it('accepts a well-formed config', () => {
    const result = validateSessionConfig(config(), 'F');
    expect(result.errors).toEqual({});
    expect(result.valid).toBe(true);
  });

  it('requires the plate temperature, which is the one the cook chooses', () => {
    // The pull is derived. If the app has no plate temperature it has nothing to
    // derive from, so this is the required field rather than pullTempF.
    expect(validateSessionConfig(config({ servingTempF: null }), 'F').errors)
      .toHaveProperty('servingTempF');
    expect(validateSessionConfig(config({ servingTempF: undefined }), 'F').errors)
      .toHaveProperty('servingTempF');
  });

  it('bounds the plate temperature to something edible', () => {
    expect(validateSessionConfig(config({ servingTempF: 31 }), 'F').valid).toBe(false);
    expect(validateSessionConfig(config({ servingTempF: 213 }), 'F').valid).toBe(false);
    // The pull has to come with it: a 32 °F plate temperature with the default
    // 121 °F pull is a separate error, and this assertion is about the bound.
    expect(validateSessionConfig(config({ servingTempF: 32, pullTempF: 28 }), 'F').valid)
      .toBe(true);
    expect(validateSessionConfig(config({ servingTempF: 212, pullTempF: 208 }), 'F').valid)
      .toBe(true);
  });

  it('reads the bound in the caller\'s units', () => {
    // 110 °C is 230 °F, past boiling. The same number is fine as Fahrenheit.
    expect(validateSessionConfig(
      { servingTempF: 110, initialOvenTemp: 100 }, 'C'
    ).errors).toHaveProperty('servingTempF');
    expect(validateSessionConfig(
      { servingTempF: 110, pullTempF: 106, initialOvenTemp: 200 }, 'F'
    ).errors).not.toHaveProperty('servingTempF');
  });

  it('refuses a pull above the plate temperature', () => {
    // Carryover only ever adds heat, so a pull above the plate means the app
    // would be aiming past where the cook wants to end up.
    expect(validateSessionConfig(config({ pullTempF: 130 }), 'F').errors)
      .toHaveProperty('pullTempF');
    // Equal is fine: that is a cook who has set carryover to zero.
    expect(validateSessionConfig(config({ pullTempF: 125 }), 'F').valid).toBe(true);
  });

  it('bounds the rest', () => {
    expect(validateSessionConfig(config({ restMinutes: -5 }), 'F').errors)
      .toHaveProperty('restMinutes');
    expect(validateSessionConfig(config({ restMinutes: 241 }), 'F').errors)
      .toHaveProperty('restMinutes');
    expect(validateSessionConfig(config({ restMinutes: NaN }), 'F').errors)
      .toHaveProperty('restMinutes');
    expect(validateSessionConfig(config({ restMinutes: 0 }), 'F').valid).toBe(true);
    expect(validateSessionConfig(config({ restMinutes: 240 }), 'F').valid).toBe(true);
  });

  it('requires an oven temperature, in range', () => {
    expect(validateSessionConfig(config({ initialOvenTemp: null }), 'F').errors)
      .toHaveProperty('initialOvenTemp');
    expect(validateSessionConfig(config({ initialOvenTemp: 99 }), 'F').errors)
      .toHaveProperty('initialOvenTemp');
    expect(validateSessionConfig(config({ initialOvenTemp: 551 }), 'F').errors)
      .toHaveProperty('initialOvenTemp');
  });

  it('enforces the weight bound that had never run', () => {
    expect(validateSessionConfig(config({ weight: 0 }), 'F').errors).toHaveProperty('weight');
    expect(validateSessionConfig(config({ weight: -3 }), 'F').errors).toHaveProperty('weight');
    expect(validateSessionConfig(config({ weight: 101 }), 'F').errors).toHaveProperty('weight');
    // Optional, so absent is fine.
    expect(validateSessionConfig(config({ weight: null }), 'F').valid).toBe(true);
  });

  it('rejects an unparseable serve time', () => {
    expect(validateSessionConfig(config({ desiredServeTime: 'tea time' }), 'F').errors)
      .toHaveProperty('desiredServeTime');
    // No serve time at all is legal - the app just cannot judge the schedule.
    expect(validateSessionConfig(config({ desiredServeTime: null }), 'F').valid).toBe(true);
  });

  it('reports every problem at once, not just the first', () => {
    const result = validateSessionConfig(
      config({ servingTempF: null, weight: 500, initialOvenTemp: 9000 }), 'F'
    );
    expect(Object.keys(result.errors).sort())
      .toEqual(['initialOvenTemp', 'servingTempF', 'weight']);
  });
});

describe('validateReading', () => {
  it('requires a number', () => {
    expect(validateReading(null, 'F').valid).toBe(false);
    expect(validateReading('', 'F').valid).toBe(false);
    expect(validateReading('warm', 'F').valid).toBe(false);
  });

  it('bounds the reading in the caller\'s units', () => {
    expect(validateReading(31, 'F').valid).toBe(false);
    expect(validateReading(213, 'F').valid).toBe(false);
    expect(validateReading(0, 'C').valid).toBe(true);
    expect(validateReading(-1, 'C').valid).toBe(false);
    expect(validateReading(100, 'C').valid).toBe(true);
  });

  it('warns on a jump but still accepts it', () => {
    // A cook who moved the probe gets a warning, not a refusal - the reading may
    // well be the true one and the previous placement the bad one.
    const result = validateReading(130, 'F', 100);
    expect(result.valid).toBe(true);
    expect(result.warning).toMatch(/30\.0°F/);
  });

  it('states the jump as a delta, with no 32° offset', () => {
    // 30 °F of change is 16.7 °C of change, not -1.1 °C.
    const result = validateReading(65, 'C', celsiusish(35));
    expect(result.warning).toMatch(/30\.0°C/);
  });

  it('does not warn on an ordinary step', () => {
    expect(validateReading(110, 'F', 100).warning).toBeNull();
    expect(validateReading(120, 'F', 100).warning).toBeNull();
  });
});

/** 35 °C expressed in °F, which is what previousTempF wants. */
function celsiusish(c) {
  return c * 9 / 5 + 32;
}

describe('validateOvenTemp', () => {
  it('bounds the oven in the caller\'s units', () => {
    expect(validateOvenTemp(99, 'F').valid).toBe(false);
    expect(validateOvenTemp(100, 'F').valid).toBe(true);
    expect(validateOvenTemp(551, 'F').valid).toBe(false);
    expect(validateOvenTemp(38, 'C').valid).toBe(true);
    expect(validateOvenTemp(37, 'C').valid).toBe(false);
  });

  it('requires a number', () => {
    expect(validateOvenTemp('', 'F').valid).toBe(false);
    expect(validateOvenTemp('hot', 'F').valid).toBe(false);
  });
});

describe('sanitizeString', () => {
  it('trims and truncates', () => {
    expect(sanitizeString('  prime rib  ')).toBe('prime rib');
    expect(sanitizeString('x'.repeat(600)).length).toBe(500);
    expect(sanitizeString('x'.repeat(600), 10).length).toBe(10);
  });

  it('handles nothing gracefully', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
    expect(sanitizeString('')).toBe('');
    // Coerced, not rejected: these fields come off text inputs, and a number
    // that arrived as a number is still a name the cook typed.
    expect(sanitizeString(123)).toBe('123');
  });
});
