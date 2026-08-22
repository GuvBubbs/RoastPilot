import { describe, it, expect } from 'vitest';
import { convertRate, formatRate } from './temperatureUtils.js';

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
