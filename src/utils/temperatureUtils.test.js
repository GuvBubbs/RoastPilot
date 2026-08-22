import { describe, it, expect } from 'vitest';
import {
  convertRate, formatRate, weightToDisplay, weightToStorage, kgToLb, lbToKg
} from './temperatureUtils.js';

describe('formatRate', () => {
  // The Rate stat card is `truncate`d at 390px, and two decimal places overflowed
  // it - "33.77°F/hr" rendered as "33.77°F/...". Two decimals is also spurious
  // precision on a slope fitted to three noisy readings. Found by reviewing the
  // simulated-cook screenshots, where it clipped in every frame.
  it('shows at most three significant figures', () => {
    expect(formatRate(33.77, 'F')).toBe('34°F/hr');
    expect(formatRate(11.08, 'F')).toBe('11°F/hr');
    expect(formatRate(103.4, 'F')).toBe('103°F/hr');
  });

  it('keeps a decimal place below 10, where it is the difference that matters', () => {
    expect(formatRate(8.42, 'F')).toBe('8.4°F/hr');
    expect(formatRate(3.1, 'C')).toBe('1.7°C/hr');
  });

  it('never renders wider than the card can hold', () => {
    for (const rate of [0, 0.05, -2.35, 9.99, 10.01, 33.77, 103.4, -103.4]) {
      for (const unit of ['F', 'C']) {
        expect(formatRate(rate, unit).length).toBeLessThanOrEqual(9);
      }
    }
  });

  it('converts to the display unit as a delta, with no 32° offset', () => {
    // 45°F/hr of heating is 25°C/hr of heating, not -7.
    expect(formatRate(45, 'C')).toBe('25°C/hr');
  });

  it('leaves convertRate alone for callers doing arithmetic', () => {
    // The extra precision is still available where it is not being rendered.
    expect(convertRate(33.77, 'F')).toBe(33.77);
  });
});

describe('weight conversion', () => {
  /**
   * Weight is stored canonically in POUNDS - the unit the thermal prior's
   * reference constant is expressed in - and displayed in whichever unit the cook
   * prefers. That preference is separate from the °C/°F choice: someone who
   * thinks in Celsius may still buy meat in pounds.
   */
  it('round-trips to within half a display step', () => {
    /**
     * Not exactly, and it cannot be: the display holds one decimal place, so a
     * kilogram round trip is quantised to 0.05 kg - about 0.11 lb. That is the
     * bound asserted, rather than a tighter one that would only pass for weights
     * whose conversion happens to land on the grid.
     *
     * It matters not at all for the projection: the prior on k goes as
     * weight^(-2/3), so 0.11 lb on a 6 lb roast moves it by 1.2 %, against a
     * prior that is itself about a tenth of a percent of the fit once three
     * readings exist.
     */
    const HALF_STEP_LB = 0.5 / 2;
    const HALF_STEP_KG_IN_LB = kgToLb(0.1 / 2);
    for (const lb of [1, 2.4, 6, 9.5, 24, 40]) {
      expect(Math.abs(weightToStorage(weightToDisplay(lb, 'lb'), 'lb') - lb), `${lb} lb`)
        .toBeLessThanOrEqual(HALF_STEP_LB);
      expect(Math.abs(weightToStorage(weightToDisplay(lb, 'kg'), 'kg') - lb), `${lb} lb via kg`)
        .toBeLessThanOrEqual(HALF_STEP_KG_IN_LB);
    }
  });

  it('converts rather than reinterpreting', () => {
    // A cook who typed 6 lb and then taps kg means 2.7 kg, not 6 kg.
    expect(weightToDisplay(6, 'kg')).toBe(2.7);
    expect(weightToDisplay(6, 'lb')).toBe(6);
    expect(weightToStorage(2.7, 'kg')).toBeCloseTo(5.95, 2);
  });

  it('rounds per unit, not uniformly', () => {
    // 0.1 kg is 0.22 lb, so a shared precision would either lose resolution in
    // kilograms or invent it in pounds.
    expect(weightToDisplay(9.5, 'lb')).toBe(9.5);
    expect(weightToDisplay(9.5, 'kg')).toBe(4.3);
  });

  it('passes nothing through as nothing', () => {
    for (const bad of [null, undefined, NaN]) {
      expect(weightToDisplay(bad, 'lb')).toBeNull();
      expect(weightToStorage(bad, 'kg')).toBeNull();
    }
  });

  it('uses the real conversion factor, not 2.2', () => {
    // 2.2 is 0.2% low, which is 0.05 lb on a 24 lb bird - invisible, and the kind
    // of thing that turns a round-trip into a slow drift.
    expect(kgToLb(1)).toBeCloseTo(2.20462262, 6);
    expect(lbToKg(kgToLb(3.7))).toBeCloseTo(3.7, 10);
  });
});
