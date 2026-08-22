/**
 * The DST bug, and the property that generalises it.
 *
 * `addMinutes` used to do LOCAL WALL-CLOCK arithmetic:
 *
 *     const date = new Date(timestampISO);
 *     date.setMinutes(date.getMinutes() + minutes);
 *
 * `setMinutes` adds to the local wall clock and then asks the zone what instant
 * that is. Those are different questions across a DST boundary, and the answers
 * differ by exactly one hour - which is enough to flip the schedule verdict from
 * "on track" to "an hour late", or the reverse, and to move the ETA on screen to
 * a time the roast will not be ready at.
 *
 * It matters because `addMinutes` is the function the whole projection rests on:
 * predictTimeToTarget derives the target time from it, the schedule variance is
 * measured against that, and the recommendation comes out of the variance.
 *
 * ---
 *
 * THE ZONE IS THE TEST. In UTC there are no transitions, so every assertion here
 * passes vacuously - and CI runs in UTC. So the zone is pinned twice:
 *
 *   1. `TZ=Pacific/Auckland` on the vitest project in vitest.config.js, and on
 *      the CI job in .github/workflows/test.yml;
 *   2. a guard below whose FIRST assertion is on the offset itself, so that a
 *      run in the wrong zone fails loudly rather than passing empty.
 *
 * Auckland, not a US zone: its transitions fall in the small hours of a Sunday
 * local time but in the *afternoon* UTC, so a bug that only shows up when the
 * local date and the UTC date disagree is exercised too. The developer machine
 * is already in this zone, which is how the bug survived - the tests that
 * existed were written and run somewhere the wall clock and the epoch agreed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { addMinutes, minutesBetween, isSameLocalDay, localDayOffset } from './timeUtils.js';
import { predictTimeToTarget, calculateScheduleVarianceWithThreshold } from '../services/calculationService.js';

/** The two real 2026 Pacific/Auckland transitions, as UTC instants. */
const SPRING_FORWARD = '2026-09-26T14:00:00.000Z'; // local 02:00 NZST -> 03:00 NZDT
const FALL_BACK = '2026-04-04T14:00:00.000Z';      // local 03:00 NZDT -> 02:00 NZST

/**
 * The committed fixture table. Every row was computed by running both
 * implementations in Pacific/Auckland and recording the answers, so
 * `wallClockBug` is what the old code actually returned rather than a guess -
 * see the `offBy` column, which is the size of the defect in each case.
 */
const FIXTURES = [
  {
    name: 'spring forward, +120 across the gap',
    from: '2026-09-26T13:30:00.000Z',  // local 01:30 NZST
    minutes: 120,
    expect: '2026-09-26T15:30:00.000Z', // local 04:30 NZDT
    wallClockBug: '2026-09-26T14:30:00.000Z',
    offBy: -60
  },
  {
    name: 'spring forward, +60 landing inside the skipped hour',
    from: '2026-09-26T13:30:00.000Z',
    minutes: 60,
    expect: '2026-09-26T14:30:00.000Z', // local 03:30 NZDT
    // The one case the old code got right, and by accident: 02:30 local does
    // not exist, and Date normalises the non-existent time forward by an hour -
    // which happens to be the correct instant. Kept in the table precisely
    // because a test suite built only from cases like this would have proved the
    // old code correct.
    wallClockBug: '2026-09-26T14:30:00.000Z',
    offBy: 0
  },
  {
    name: 'spring forward, -120 backwards across the gap',
    from: '2026-09-26T15:30:00.000Z',  // local 04:30 NZDT
    minutes: -120,
    expect: '2026-09-26T13:30:00.000Z', // local 01:30 NZST
    wallClockBug: '2026-09-26T14:30:00.000Z',
    offBy: 60
  },
  {
    name: 'fall back, +120 across the repeated hour',
    from: '2026-04-04T13:30:00.000Z',  // local 02:30 NZDT (first pass)
    minutes: 120,
    expect: '2026-04-04T15:30:00.000Z', // local 03:30 NZST
    wallClockBug: '2026-04-04T16:30:00.000Z',
    offBy: 60
  },
  {
    name: 'fall back, +60 landing in the second pass of 02:30',
    from: '2026-04-04T13:30:00.000Z',
    minutes: 60,
    expect: '2026-04-04T14:30:00.000Z', // local 02:30 NZST - the same wall clock
    wallClockBug: '2026-04-04T15:30:00.000Z',
    offBy: 60
  },
  {
    name: 'fall back, -120 backwards across the repeated hour',
    from: '2026-04-04T15:30:00.000Z',  // local 03:30 NZST
    minutes: -120,
    expect: '2026-04-04T13:30:00.000Z', // local 02:30 NZDT
    wallClockBug: '2026-04-04T12:30:00.000Z',
    offBy: -60
  },
  {
    name: 'control: mid-winter, no transition anywhere near',
    from: '2026-06-15T02:00:00.000Z',
    minutes: 90,
    expect: '2026-06-15T03:30:00.000Z',
    // Identical. Without a row like this the table would only show that the two
    // implementations differ, not that the new one is right about ordinary days.
    wallClockBug: '2026-06-15T03:30:00.000Z',
    offBy: 0
  }
];

/** The implementation that was there before, verbatim. */
function wallClockAddMinutes(timestampISO, minutes) {
  const date = new Date(timestampISO);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

/**
 * Abort the file, not just one test, if the zone is wrong. An assertion inside
 * an `it` reports one red test among fifteen green ones, which reads like a bug
 * in the fixture table; this makes it unmistakable that nothing here ran.
 */
beforeAll(() => {
  const winter = new Date('2026-06-15T00:00:00.000Z').getTimezoneOffset();
  const summer = new Date('2026-12-15T00:00:00.000Z').getTimezoneOffset();
  if (winter !== -720 || summer !== -780) {
    throw new Error(
      'This suite requires TZ=Pacific/Auckland. Got offsets ' +
      `${winter}/${summer}, expected -720/-780. In a zone without DST every ` +
      'assertion in this file passes vacuously, which is worse than failing. ' +
      'See the `dst` project in vitest.config.js.'
    );
  }
});

describe('Pacific/Auckland is actually in force', () => {
  it('has a DST transition, so the assertions below are not vacuous', () => {
    // FIRST assertion, deliberately: everything else in this file is meaningless
    // in a zone with no transitions, and CI defaults to UTC.
    const beforeSpring = new Date('2026-09-26T13:00:00.000Z').getTimezoneOffset();
    const afterSpring = new Date('2026-09-26T15:00:00.000Z').getTimezoneOffset();

    expect(beforeSpring, 'this suite requires TZ=Pacific/Auckland').toBe(-720);
    expect(afterSpring, 'this suite requires TZ=Pacific/Auckland').toBe(-780);
    expect(afterSpring - beforeSpring).toBe(-60);
  });

  it('is the zone the fixture table was computed in', () => {
    // Belt to the braces above: if the offsets happened to match some other
    // zone, the transition instants would still be wrong.
    expect(new Date(FALL_BACK).getTimezoneOffset()).toBe(-720);
    expect(new Date(Date.parse(FALL_BACK) - 1000).getTimezoneOffset()).toBe(-780);
    expect(new Date(SPRING_FORWARD).getTimezoneOffset()).toBe(-780);
    expect(new Date(Date.parse(SPRING_FORWARD) - 1000).getTimezoneOffset()).toBe(-720);
  });
});

describe('addMinutes across a DST boundary', () => {
  for (const row of FIXTURES) {
    it(row.name, () => {
      expect(addMinutes(row.from, row.minutes)).toBe(row.expect);
    });
  }

  it('adds real minutes, not wall-clock minutes', () => {
    // The property, stated directly: n minutes later is n minutes later.
    for (const row of FIXTURES) {
      const result = addMinutes(row.from, row.minutes);
      expect(minutesBetween(row.from, result), row.name).toBe(row.minutes);
    }
  });

  it('differs from the old implementation by exactly the recorded amount', () => {
    // This is the row that makes the table evidence rather than decoration: it
    // pins how wrong the old code was, case by case, so nobody has to take the
    // claim on trust - and it fails if a future zone-database update moves a
    // transition out from under the fixtures.
    for (const row of FIXTURES) {
      const buggy = wallClockAddMinutes(row.from, row.minutes);
      expect(buggy, row.name).toBe(row.wallClockBug);
      const offBy = (Date.parse(buggy) - Date.parse(row.expect)) / 60_000;
      expect(offBy, row.name).toBe(row.offBy);
    }
  });

  it('round-trips: adding then subtracting returns the same instant', () => {
    for (const row of FIXTURES) {
      const there = addMinutes(row.from, row.minutes);
      expect(addMinutes(there, -row.minutes), row.name).toBe(row.from);
    }
  });

  it('is associative across a boundary: two hops equal one', () => {
    // 45 + 75 straddles the spring-forward gap in the middle of the first hop.
    const start = '2026-09-26T13:15:00.000Z';
    const twoHops = addMinutes(addMinutes(start, 45), 75);
    expect(addMinutes(start, 120)).toBe(twoHops);
  });
});

describe('the projection survives a DST boundary', () => {
  it('lands on the right instant when the cook straddles spring forward', () => {
    // A roast at 95 F climbing 15 F/hr toward 125 F, last read at local 01:30
    // NZST on the morning the clocks go forward. Two hours of heating left.
    const anchor = '2026-09-26T13:30:00.000Z';
    const result = predictTimeToTarget(95, 125, 15, anchor);

    expect(result.minutes).toBe(120);
    expect(result.targetTime).toBe('2026-09-26T15:30:00.000Z');
    // The wall clock reads 04:30, not 03:30: an hour of clock time vanished and
    // the roast does not care.
    expect(new Date(result.targetTime).getHours()).toBe(4);
    expect(new Date(result.targetTime).getMinutes()).toBe(30);
  });

  it('does not flip the schedule verdict across a boundary', () => {
    // THE defect, in the terms a cook would notice.
    //
    // Fall-back morning. Last reading at local 02:30 NZDT, 15 F short of target
    // at 15 F/hr, so exactly one hour of heating left. Serve time is that hour
    // away. The roast is dead on time.
    const anchor = '2026-04-04T13:30:00.000Z';
    const projection = predictTimeToTarget(110, 125, 15, anchor);
    expect(projection.minutes).toBe(60);
    expect(projection.targetTime).toBe('2026-04-04T14:30:00.000Z');

    const serveTime = '2026-04-04T14:30:00.000Z';
    const variance = calculateScheduleVarianceWithThreshold(
      projection.targetTime, serveTime, 10
    );
    expect(variance.varianceMinutes).toBe(0);
    expect(variance.status).toBe('on-track');

    // The old code put that same one hour of heating an hour further out, because
    // the wall clock gained an hour that the roast did not. 60 minutes late is
    // past the "very late" threshold, so the cook was told to RAISE the oven -
    // by the largest step the app offers - on a roast that was exactly on time.
    const buggyTarget = wallClockAddMinutes(anchor, projection.minutes);
    expect(buggyTarget).toBe('2026-04-04T15:30:00.000Z');
    const buggyVariance = calculateScheduleVarianceWithThreshold(
      buggyTarget, serveTime, 10
    );
    expect(buggyVariance.varianceMinutes).toBe(60);
    expect(buggyVariance.status).toBe('late');
  });

  it('counts a day correctly across a 23- and a 25-hour day', () => {
    // The local interval between midnights is 23 hours on the spring-forward day
    // and 25 on the fall-back day. Dividing the epoch difference by 86400000 and
    // flooring gets both of them wrong.
    // Local midnight to local midnight across spring forward: 23 REAL hours,
    // one calendar day. Dividing the epoch difference by 86400000 gives 0.958,
    // which floors to 0 - the day disappears.
    expect(localDayOffset('2026-09-26T12:00:00.000Z', '2026-09-27T11:00:00.000Z')).toBe(1);
    // And across fall back: 25 real hours, still one calendar day.
    expect(localDayOffset('2026-04-04T11:00:00.000Z', '2026-04-05T12:00:00.000Z')).toBe(1);
    // Eight hours that straddle the transition, and the same local day either
    // side of it.
    expect(localDayOffset('2026-09-26T12:00:00.000Z', '2026-09-26T20:00:00.000Z')).toBe(0);
  });

  it('recognises the same local day either side of a fall-back', () => {
    // The repeated hour is the same local date twice, and 02:30 appears on both
    // sides of the transition. formatTime's date qualifier hangs off this.
    expect(isSameLocalDay('2026-04-04T13:30:00.000Z', '2026-04-04T15:30:00.000Z'))
      .toBe(true);
    // 23 hours apart in real time, but a different local day - which a naive
    // "divide the epoch by 86400000" comparison gets wrong on exactly the days
    // that are not 24 hours long.
    expect(isSameLocalBoundary('2026-04-04T10:00:00.000Z', '2026-04-05T09:00:00.000Z'))
      .toBe(false);
  });
});

/** Named so the assertion above reads as the claim it is making. */
function isSameLocalBoundary(a, b) {
  return isSameLocalDay(a, b);
}
