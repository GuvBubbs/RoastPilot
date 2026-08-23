import { describe, it, expect } from 'vitest';
import {
  estimateCarryoverF,
  pullTempFor,
  servingTempFor,
  CARRYOVER_ANCHORS
} from './carryoverService.js';

describe('estimateCarryoverF', () => {
  it('lands on +4 °F for the app default 200 °F oven', () => {
    // The one value worth pinning exactly, because it is what every new session
    // gets: 3 + (200-175)/(300-175) * (8-3) = 4.
    expect(estimateCarryoverF(200)).toBe(4);
  });

  it('hits both anchors', () => {
    expect(estimateCarryoverF(CARRYOVER_ANCHORS.lowOvenF)).toBe(CARRYOVER_ANCHORS.lowRiseF);
    expect(estimateCarryoverF(CARRYOVER_ANCHORS.highOvenF)).toBe(CARRYOVER_ANCHORS.highRiseF);
  });

  it('clamps rather than extrapolating outside the oven band', () => {
    // There is no evidence out past the ends of the line to extrapolate along,
    // and a linear extension would give a negative carryover for a cold oven.
    expect(estimateCarryoverF(100)).toBe(CARRYOVER_ANCHORS.lowRiseF);
    expect(estimateCarryoverF(0)).toBe(CARRYOVER_ANCHORS.lowRiseF);
    expect(estimateCarryoverF(-40)).toBe(CARRYOVER_ANCHORS.lowRiseF);
    expect(estimateCarryoverF(550)).toBe(CARRYOVER_ANCHORS.highRiseF);
  });

  it('rises monotonically with oven temperature', () => {
    let previous = -Infinity;
    for (let oven = 150; oven <= 350; oven += 5) {
      const rise = estimateCarryoverF(oven);
      expect(rise).toBeGreaterThanOrEqual(previous);
      previous = rise;
    }
  });

  it('is always a whole number', () => {
    // A carryover of "5.7 °F" claims a precision nothing behind this estimate
    // supports: an evaporation-free solve of the app's own model gives +19 °F
    // where instrumented measurement gives +5 to +6.5 for the same cut class.
    for (let oven = 150; oven <= 350; oven += 1) {
      expect(Number.isInteger(estimateCarryoverF(oven))).toBe(true);
    }
  });

  it('stays inside the range the two anchors bracket', () => {
    for (let oven = 100; oven <= 550; oven += 7) {
      const rise = estimateCarryoverF(oven);
      expect(rise).toBeGreaterThanOrEqual(CARRYOVER_ANCHORS.lowRiseF);
      expect(rise).toBeLessThanOrEqual(CARRYOVER_ANCHORS.highRiseF);
    }
  });

  it('falls back to the low end with nothing to reason from', () => {
    // The least the app can claim, rather than an average of two guesses.
    for (const bad of [null, undefined, NaN, Infinity, 'hot']) {
      expect(estimateCarryoverF(bad)).toBe(CARRYOVER_ANCHORS.lowRiseF);
    }
  });
});

describe('pullTempFor / servingTempFor', () => {
  it('are inverses', () => {
    for (const serving of [120, 125, 130, 145, 195, 205]) {
      for (const carryover of [0, 3, 4, 5, 8]) {
        const pull = pullTempFor(serving, carryover);
        expect(servingTempFor(pull, carryover)).toBe(serving);
      }
    }
  });

  it('pulls below the plate, never above', () => {
    // Carryover only ever adds heat.
    expect(pullTempFor(125, 4)).toBe(121);
    expect(pullTempFor(195, 5)).toBe(190);
    expect(pullTempFor(125, 0)).toBe(125);
  });

  it('treats a missing carryover as zero rather than as NaN', () => {
    // These feed the projection target. A NaN here used to reach addMinutes and
    // throw RangeError out of the whole status panel.
    expect(pullTempFor(125, null)).toBe(125);
    expect(pullTempFor(125, undefined)).toBe(125);
    expect(pullTempFor(125, NaN)).toBe(125);
    expect(servingTempFor(121, null)).toBe(121);
  });

  it('passes a non-numeric temperature straight through', () => {
    expect(pullTempFor(null, 4)).toBeNull();
    expect(Number.isNaN(pullTempFor(NaN, 4))).toBe(true);
  });
});
