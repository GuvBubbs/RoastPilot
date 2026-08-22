import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSession } from './useSession.js';
import { useRecommendations } from './useRecommendations.js';
import { celsiusToFahrenheit } from '../utils/temperatureUtils.js';

/** ISO timestamp on a fixed day, so the assertions read as a timeline */
function at(hour, minute = 0) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `2026-08-22T${hh}:${mm}:00.000Z`;
}

/**
 * The reported bug, end to end and in the units it was reported in: a Celsius
 * cook where the suggested temperature has to be settable on a real dial, and
 * where logging the change must not move the suggestion by the same amount
 * again.
 */
describe('a Celsius cook told to lower the oven', () => {
  let session;
  let rec;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at(13)));

    session = useSession();
    session.startSession({
      units: 'C',
      pullTempF: celsiusToFahrenheit(65),
      initialOvenTemp: celsiusToFahrenheit(112),
      desiredServeTime: at(16)
    });

    // Four hours of steady climbing, well ahead of a 16:00 serve
    session.addReading(30, at(10));
    session.addReading(40, at(11));
    session.addReading(48, at(12));
    session.addReading(55, at(13));

    rec = useRecommendations();
  });

  afterEach(() => {
    session.endSession();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('suggests a temperature the dial can actually be set to', () => {
    expect(rec.action.value).toBe('lower');
    // Not 98°C, which is what the raw Fahrenheit arithmetic works out to
    expect(rec.suggestedTemp.value % 5).toBe(0);
    expect(rec.suggestedTempFormatted.value).toBe('100°C');
    expect(rec.message.value).toContain('100°C');
  });

  it('accepts the change instead of asking for the same one again', () => {
    vi.setSystemTime(new Date(at(13, 6)));
    session.addOvenEvent(100, at(13, 5));

    expect(rec.awaitingEffect.value).toBe(true);
    expect(rec.action.value).toBe('settling');
    expect(rec.changeAmount.value).toBe(0);
    // The old behaviour: another full step down, to 90°C
    expect(rec.suggestedTempFormatted.value).toBe('100°C');
    expect(rec.message.value).toContain('100°C');
    expect(rec.message.value).not.toMatch(/[{}]/);
    expect(rec.waitMinutes.value).toBe(14);
    expect(rec.message.value).toContain('14 min');
  });

  it('accepts a setting the user rounded to their own dial', () => {
    vi.setSystemTime(new Date(at(13, 6)));
    session.addOvenEvent(100, at(13, 5));
    // Then nudged it again, to a mark they preferred
    vi.setSystemTime(new Date(at(13, 8)));
    session.addOvenEvent(98, at(13, 7));

    expect(rec.action.value).toBe('settling');
    expect(rec.suggestedTempFormatted.value).toBe('98°C');
    expect(rec.reasoning.value).toMatch(/nothing to change/);
  });

  it('reassesses from the new setting once readings show its effect', () => {
    vi.setSystemTime(new Date(at(13, 6)));
    session.addOvenEvent(100, at(13, 5));

    // Two readings past the thermal lag, and the climb has flattened out
    session.addReading(56, at(13, 25));
    session.addReading(57, at(13, 45));
    vi.setSystemTime(new Date(at(13, 46)));

    expect(rec.awaitingEffect.value).toBe(false);
    expect(rec.action.value).toBe('raise');
    // Measured from 100°C, the setting that produced those readings
    expect(rec.suggestedTemp.value).toBeGreaterThan(100);
    expect(rec.suggestedTemp.value % 5).toBe(0);
  });
});
