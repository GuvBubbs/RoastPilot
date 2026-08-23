/**
 * timeUtils had no tests at all, and it is the layer the entire projection is
 * built on: every ETA, every schedule variance and every recommendation is
 * derived from addMinutes and minutesBetween.
 *
 * The DST behaviour of addMinutes lives in timeUtils.dst.test.js, which runs in
 * a zone that has transitions. This file is about everything else, and it pins
 * the clock rather than reading it: a suite that asserts on `new Date()` is a
 * suite that fails on a particular day of the year, which is exactly how the
 * one date-dependent assertion in useSession.test.js survived until it fired.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  minutesBetween,
  hoursBetween,
  addMinutes,
  formatDuration,
  formatTime,
  formatTimeCompact,
  localDayOffset,
  formatDateTime,
  formatTimeAgo,
  isWithinMinutes,
  isSameLocalDay,
  parseTimeToday,
  now,
  minutesUntil
} from './timeUtils.js';

const NOW = '2026-08-22T10:00:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

/** Pin the clock. Every "now"-relative helper below reads it. */
function atNow(iso = NOW) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('minutesBetween / hoursBetween', () => {
  it('measures forwards and backwards', () => {
    expect(minutesBetween('2026-08-22T10:00:00Z', '2026-08-22T11:30:00Z')).toBe(90);
    expect(minutesBetween('2026-08-22T11:30:00Z', '2026-08-22T10:00:00Z')).toBe(-90);
    expect(hoursBetween('2026-08-22T10:00:00Z', '2026-08-22T11:30:00Z')).toBe(1.5);
  });

  it('keeps sub-minute resolution rather than rounding', () => {
    // The rate fit divides by this, so a rounded 0 would be a division by zero
    // rather than a very small number.
    expect(minutesBetween('2026-08-22T10:00:00Z', '2026-08-22T10:00:30Z')).toBe(0.5);
  });

  it('is zero for identical instants written differently', () => {
    expect(minutesBetween('2026-08-22T10:00:00Z', '2026-08-22T12:00:00+02:00')).toBe(0);
  });
});

describe('addMinutes', () => {
  it('adds, subtracts, and returns a canonical ISO string', () => {
    expect(addMinutes('2026-08-22T10:00:00.000Z', 90)).toBe('2026-08-22T11:30:00.000Z');
    expect(addMinutes('2026-08-22T10:00:00.000Z', -90)).toBe('2026-08-22T08:30:00.000Z');
    expect(addMinutes('2026-08-22T10:00:00.000Z', 0)).toBe('2026-08-22T10:00:00.000Z');
  });

  it('normalises a non-canonical input', () => {
    // Storage from older builds, and every hand-written test fixture, uses the
    // short `Z` form. The output has to be comparable to the long one.
    expect(addMinutes('2026-08-22T10:00:00Z', 30)).toBe('2026-08-22T10:30:00.000Z');
    expect(addMinutes('2026-08-22T22:00:00+12:00', 30)).toBe('2026-08-22T10:30:00.000Z');
  });

  it('carries across day, month and year boundaries', () => {
    expect(addMinutes('2026-08-31T23:30:00.000Z', 45)).toBe('2026-09-01T00:15:00.000Z');
    expect(addMinutes('2026-12-31T23:30:00.000Z', 45)).toBe('2027-01-01T00:15:00.000Z');
    // A leap day, in the direction that skips it.
    expect(addMinutes('2028-02-28T23:30:00.000Z', 60)).toBe('2028-02-29T00:30:00.000Z');
  });

  it('handles fractional minutes', () => {
    // The harness advances the clock in half-minute steps, and the settling
    // window is derived with addMinutes.
    expect(addMinutes('2026-08-22T10:00:00.000Z', 0.5)).toBe('2026-08-22T10:00:30.000Z');
  });

  it('round-trips exactly', () => {
    for (const minutes of [1, 17, 60, 240, 1440, -1, -17, -1440]) {
      const there = addMinutes(NOW, minutes);
      expect(addMinutes(there, -minutes), `${minutes} min`).toBe(NOW);
    }
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('signs a negative duration rather than dropping the sign', () => {
    expect(formatDuration(-45)).toBe('-45m');
    expect(formatDuration(-90)).toBe('-1h 30m');
  });

  it('returns the placeholder for nothing measurable', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(NaN)).toBe('--');
    // Undefined reaches here from an optional chain on a missing session.
    expect(formatDuration(undefined)).toBe('--');
  });

  it('shows seconds only when asked, and only under a minute', () => {
    expect(formatDuration(0.5, true)).toBe('30s');
    // Without the flag it is rounded to the nearest minute like anything else.
    expect(formatDuration(0.5)).toBe('1m');
    expect(formatDuration(0.4)).toBe('0m');
    expect(formatDuration(90, true)).toBe('1h 30m');
  });

  it('rounds to the minute rather than truncating', () => {
    expect(formatDuration(59.6)).toBe('60m');
    // Rendered "1h 60m" before the fix: the split happened before the rounding,
    // so floor(119.6/60)=1 was paired with round(59.6)=60.
    expect(formatDuration(119.6)).toBe('2h');
    expect(formatDuration(179.7)).toBe('3h');
    expect(formatDuration(119.4)).toBe('1h 59m');
  });
});

describe('formatTime', () => {
  it('gives a bare clock time for today', () => {
    atNow();
    // Asserted by shape, not by locale: the machine's locale decides whether
    // this is "10:30 PM" or "22:30", and pinning either would make the suite
    // fail on a differently configured machine for no useful reason.
    const text = formatTime('2026-08-22T10:30:00.000Z');
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/[A-Za-z]{3}/);
  });

  it('qualifies with the date when the target is not today', () => {
    atNow();
    // Two days out. An unqualified "8:19 PM" here is indistinguishable from
    // this evening, which is how a projection days away was rendered as an
    // ordinary time of day.
    const text = formatTime('2026-08-24T10:30:00.000Z');
    expect(text).toMatch(/[A-Za-z]{3}/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });

  it('reads "today" from an explicit reference when given one', () => {
    // No fake timers: the reference is the point, so the clock must not be.
    const sameDay = formatTime('2026-08-24T10:30:00.000Z', '2026-08-24T02:00:00.000Z');
    const otherDay = formatTime('2026-08-24T10:30:00.000Z', '2026-08-22T02:00:00.000Z');
    expect(sameDay).not.toMatch(/[A-Za-z]{3}/);
    expect(otherDay).toMatch(/[A-Za-z]{3}/);
  });

  it('returns the placeholder for no timestamp', () => {
    expect(formatTime(null)).toBe('--');
    expect(formatTime(undefined)).toBe('--');
    expect(formatTime('')).toBe('--');
  });
});

describe('formatTimeCompact / localDayOffset', () => {
  /** Local components, so the fixtures mean the same thing in any zone. */
  const local = (y, m, d, h, min) => new Date(y, m, d, h, min).toISOString();

  it('gives a bare clock time for the same local day', () => {
    const text = formatTimeCompact(local(2026, 7, 22, 20, 19), local(2026, 7, 22, 9, 0));
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/[+−]/);
  });

  it('marks the day offset instead of spelling out the date', () => {
    // "Aug 23, 12:22 AM" does not fit a 96px stat cell, and a truncated date
    // reads as a rendering fault rather than as a time.
    expect(formatTimeCompact(local(2026, 7, 23, 0, 22), local(2026, 7, 22, 22, 0)))
      .toMatch(/\+1$/);
    expect(formatTimeCompact(local(2026, 7, 25, 12, 0), local(2026, 7, 22, 12, 0)))
      .toMatch(/\+3$/);
    expect(formatTimeCompact(local(2026, 7, 21, 12, 0), local(2026, 7, 22, 12, 0)))
      .toMatch(/−1$/);
  });

  it('counts calendar days, not elapsed hours', () => {
    // Two hours apart, but tomorrow.
    expect(localDayOffset(local(2026, 7, 22, 23, 0), local(2026, 7, 23, 1, 0))).toBe(1);
    // Twenty-three hours apart, and the same day.
    expect(localDayOffset(local(2026, 7, 22, 0, 30), local(2026, 7, 22, 23, 30))).toBe(0);
  });

  it('returns the placeholder for no timestamp', () => {
    expect(formatTimeCompact(null)).toBe('--');
  });
});

describe('isSameLocalDay', () => {
  /**
   * Fixtures built from LOCAL components, so they mean the same thing in every
   * zone this project might run in. Two UTC instants on the same UTC day are not
   * on the same local day everywhere - 00:30Z and 23:30Z on 22 August are 22 and
   * 23 August in Auckland - and writing the fixture in UTC is exactly the
   * mistake this function exists to prevent.
   */
  const local = (y, m, d, h, min) => new Date(y, m, d, h, min).toISOString();

  it('compares the local calendar date, not the elapsed time', () => {
    expect(isSameLocalDay(local(2026, 7, 22, 0, 30), local(2026, 7, 22, 23, 30)))
      .toBe(true);
    // 23 hours apart, but a different local day either side of local midnight.
    expect(isSameLocalDay(local(2026, 7, 22, 23, 30), local(2026, 7, 23, 0, 30)))
      .toBe(false);
    // A whole year apart on the same day-of-month.
    expect(isSameLocalDay(local(2026, 7, 22, 10, 0), local(2027, 7, 22, 10, 0)))
      .toBe(false);
    // Same day-of-month, different month.
    expect(isSameLocalDay(local(2026, 7, 22, 10, 0), local(2026, 8, 22, 10, 0)))
      .toBe(false);
  });

  it('is symmetric and reflexive', () => {
    const a = local(2026, 7, 22, 10, 0);
    const b = local(2026, 7, 23, 10, 0);
    expect(isSameLocalDay(a, a)).toBe(true);
    expect(isSameLocalDay(a, b)).toBe(isSameLocalDay(b, a));
  });
});

describe('formatDateTime', () => {
  it('always names the date', () => {
    const text = formatDateTime('2026-08-22T10:30:00.000Z');
    expect(text).toMatch(/[A-Za-z]{3}/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns the placeholder for no timestamp', () => {
    expect(formatDateTime(null)).toBe('--');
  });
});

describe('formatTimeAgo', () => {
  it('describes the recent past in the coarsest unit that fits', () => {
    atNow();
    expect(formatTimeAgo('2026-08-22T09:59:30.000Z')).toBe('just now');
    expect(formatTimeAgo('2026-08-22T09:59:00.000Z')).toBe('1 min ago');
    expect(formatTimeAgo('2026-08-22T09:48:00.000Z')).toBe('12 mins ago');
    expect(formatTimeAgo('2026-08-22T09:00:00.000Z')).toBe('1 hour ago');
    expect(formatTimeAgo('2026-08-22T07:00:00.000Z')).toBe('3 hours ago');
    expect(formatTimeAgo('2026-08-21T09:00:00.000Z')).toBe('1 day ago');
    expect(formatTimeAgo('2026-08-19T09:00:00.000Z')).toBe('3 days ago');
  });

  it('gets the singular right at every boundary', () => {
    atNow();
    // "1 mins ago" and "1 hours ago" both shipped at some point in this app.
    expect(formatTimeAgo('2026-08-22T09:59:00.000Z')).not.toContain('mins');
    expect(formatTimeAgo('2026-08-22T09:00:00.000Z')).not.toContain('hours');
    expect(formatTimeAgo('2026-08-21T09:00:00.000Z')).not.toContain('days');
  });
});

describe('isWithinMinutes', () => {
  it('is inclusive at the boundary', () => {
    atNow();
    expect(isWithinMinutes('2026-08-22T09:30:00.000Z', 30)).toBe(true);
    expect(isWithinMinutes('2026-08-22T09:29:00.000Z', 30)).toBe(false);
  });

  it('treats a future timestamp as within', () => {
    atNow();
    // Negative elapsed time. A back-dated-in-the-future reading is odd but it is
    // not stale, and reporting it as stale would ask the cook to re-log it.
    expect(isWithinMinutes('2026-08-22T10:30:00.000Z', 30)).toBe(true);
  });
});

describe('parseTimeToday', () => {
  it('places a wall-clock time on today, in the local zone', () => {
    atNow();
    const iso = parseTimeToday('19:30');
    const parsed = new Date(iso);
    // Local hours, deliberately: the cook typed a time on their own clock. This
    // is the one place in the file where wall-clock arithmetic is the right
    // arithmetic, which is why it is not addMinutes.
    expect(parsed.getHours()).toBe(19);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.getSeconds()).toBe(0);
    expect(parsed.getMilliseconds()).toBe(0);
    expect(isSameLocalDay(iso, NOW)).toBe(true);
  });
});

describe('now / minutesUntil', () => {
  it('reads the clock', () => {
    atNow();
    expect(now()).toBe(NOW);
    expect(minutesUntil('2026-08-22T11:00:00.000Z')).toBe(60);
    expect(minutesUntil('2026-08-22T09:00:00.000Z')).toBe(-60);
  });
});
