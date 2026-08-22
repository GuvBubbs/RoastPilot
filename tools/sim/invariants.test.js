/**
 * The invariants themselves, tested.
 *
 * They are the thing standing between a wrong projection and a green run, and
 * nothing checked them. That matters most for the two heuristics that had to be
 * loosened once the reading prompt made readings dense: a check that has been
 * relaxed and never re-tested is a check that has been deleted slowly.
 */
import { describe, it, expect } from 'vitest';
import { createDefaultSettings } from '../../src/models/dataModels.js';
import { assessOvenChangeEffect } from '../../src/services/recommendationService.js';
import { checkNoDoubleCharging, checkNoStaleAdvice, checkNoFlapping } from './invariants.js';

const START = Date.parse('2026-08-22T18:00:00.000Z');
const at = (min) => new Date(START + min * 60_000).toISOString();

/**
 * Build the minimum of an outcome these checks read.
 *
 * `readingsAt` and `ovenAt` drive the app's own assessOvenChangeEffect, which is
 * what the checks consult - so the fixtures are stated as histories rather than
 * as the conclusions drawn from them.
 */
function outcome({ moves, readingsAt, ovenAt, settings = {} }) {
  const merged = { ...createDefaultSettings(), ...settings };
  const rows = moves.map((move) => {
    const readingTimes = readingsAt.filter((t) => t <= move.atMin).map(at);
    // Strictly BEFORE the move: the row represents the instant the advice was
    // given, which is before the cook has touched the dial. Including the move's
    // own event would make every suggestion look like it named the temperature
    // the oven was already on.
    const ovenHistory = ovenAt
      .filter((e) => e.atMin < move.atMin)
      .map((e) => ({ timestamp: at(e.atMin), setTemp: e.setTemp, isOff: false }));

    // awaitingEffect derived from the service rather than hardcoded, so half (a)
    // of the check - "the UI's settling state agrees with the service" - is
    // satisfied by construction and these tests isolate half (b).
    const truth = assessOvenChangeEffect({
      readings: readingTimes.map((timestamp) => ({ timestamp })),
      ovenEvents: ovenHistory,
      settings: merged,
      now: at(move.atMin)
    });

    return {
      kind: 'apply',
      atMin: move.atMin,
      atISO: at(move.atMin),
      action: move.action,
      canRecommend: true,
      awaitingEffect: !truth.settled,
      // A retarget names an ABSOLUTE temperature, so it is not one step off the
      // current dial - which is what half (a)'s substantive test looks for.
      suggestedTempDisplay: move.toF,
      latestReadingISO: readingTimes[readingTimes.length - 1] ?? at(0),
      readingTimes,
      ovenHistory
    };
  });

  return {
    scenario: 'fixture',
    units: 'F',
    settings: merged,
    serveISO: at(300),
    pullDeadlineISO: at(300),
    rows,
    applied: moves.map((m) => ({ ...m, toDisplay: m.toF }))
  };
}

describe('checkNoDoubleCharging: consecutive moves in one direction', () => {
  /**
   * The fixture that must FAIL. Three lowers inside one lag window, with only
   * two readings in the whole cook - so the evidence set point never advances and
   * every step is derived from the same measurement. This is b823705: each change
   * re-applied on top of the one just made, walking the oven a step further every
   * update.
   */
  it('fires when every move comes from the same measurement', () => {
    const findings = checkNoDoubleCharging(outcome({
      readingsAt: [0, 20],
      ovenAt: [{ atMin: 0, setTemp: 250 }],
      moves: [
        { atMin: 22, action: 'lower', toF: 240 },
        { atMin: 24, action: 'lower', toF: 225 },
        { atMin: 26, action: 'lower', toF: 205 }
      ]
    }));

    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/compounded/);
    expect(errors[0].message).toMatch(/240 F to 205 F/);
  });

  /**
   * The fixture that must PASS, and the reason the check was made
   * evidence-based. Scenario 04 walks the oven down five steps because each new
   * reading says the roast is earlier still than the last one said. Requiring a
   * fully SETTLED row between moves called that a 50 °F double charge, because
   * with ovenChangeSettleReadings = 2 the evidence trails the dial and
   * awaitingEffect is still true when the next reading lands.
   */
  it('does not fire when each move follows new measurement', () => {
    // Moves spaced far enough apart that the evidence set point advances between
    // them: with ovenChangeLagMinutes 15, ovenChangeSettleReadings 2 and readings
    // every 20 minutes, a set point becomes evidence about an hour after it was
    // made. So the dial walks 250 -> 200 over four steps, each one derived from a
    // set point the readings have actually measured.
    const findings = checkNoDoubleCharging(outcome({
      readingsAt: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240],
      ovenAt: [
        { atMin: 0, setTemp: 250 },
        { atMin: 42, setTemp: 235 },
        { atMin: 102, setTemp: 225 },
        { atMin: 162, setTemp: 210 },
        { atMin: 222, setTemp: 200 }
      ],
      moves: [
        { atMin: 42, action: 'lower', toF: 235 },
        { atMin: 102, action: 'lower', toF: 225 },
        { atMin: 162, action: 'lower', toF: 210 },
        { atMin: 222, action: 'lower', toF: 200 }
      ]
    }));

    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('never complains about a single move', () => {
    const findings = checkNoDoubleCharging(outcome({
      readingsAt: [0, 20, 40],
      ovenAt: [{ atMin: 0, setTemp: 250 }],
      moves: [{ atMin: 42, action: 'lower', toF: 235 }]
    }));
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('does not join moves in opposite directions into a run', () => {
    // A reversal is checkNoFlapping's business, not this check's.
    const findings = checkNoDoubleCharging(outcome({
      readingsAt: [0, 20],
      ovenAt: [{ atMin: 0, setTemp: 200 }],
      moves: [
        { atMin: 22, action: 'raise', toF: 225 },
        { atMin: 24, action: 'lower', toF: 200 }
      ]
    }));
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
});

describe('checkNoStaleAdvice', () => {
  const advising = (ageMinutes, action = 'hold') => ({
    scenario: 'fixture',
    units: 'F',
    settings: createDefaultSettings(),
    serveISO: at(300),
    pullDeadlineISO: at(300),
    applied: [],
    rows: [{
      kind: 'tick',
      atMin: 200,
      atISO: at(200),
      action,
      scheduleStatus: 'on-track',
      canRecommend: true,
      latestReadingISO: at(200 - ageMinutes)
    }]
  });

  it('fires when the app advises from a stale reading', () => {
    // "On track for serve time" beside a three-hour-old reading is the exact
    // contradiction the missing reading prompt used to produce.
    const errors = checkNoStaleAdvice(advising(180)).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/180 min old/);
  });

  it('allows a tick of slack at the boundary', () => {
    // A row stamped on the boundary is the gate firing, not the gate failing.
    expect(checkNoStaleAdvice(advising(45)).filter((f) => f.severity === 'error')).toEqual([]);
    expect(checkNoStaleAdvice(advising(50)).filter((f) => f.severity === 'error')).toEqual([]);
    expect(checkNoStaleAdvice(advising(60)).filter((f) => f.severity === 'error')).toHaveLength(1);
  });

  it('exempts the states that make no claim about the schedule', () => {
    // at-target is a fact about the newest reading, restart-oven is about the
    // oven, needs-reading is itself a request for fresher evidence.
    for (const action of ['at-target', 'restart-oven', 'needs-reading']) {
      expect(checkNoStaleAdvice(advising(180, action)).filter((f) => f.severity === 'error'))
        .toEqual([]);
    }
  });

  it('reads the limit from the app settings, not from a restatement', () => {
    const loose = advising(180);
    loose.settings = { ...loose.settings, staleReadingMinutes: 240 };
    expect(checkNoStaleAdvice(loose).filter((f) => f.severity === 'error')).toEqual([]);
  });
});

describe('checkNoFlapping', () => {
  it('counts reversals and reports the pairs', () => {
    const findings = checkNoFlapping(outcome({
      readingsAt: [0, 20, 40, 60, 80, 100],
      ovenAt: [{ atMin: 0, setTemp: 200 }],
      moves: [
        { atMin: 22, action: 'raise', toF: 225 },
        { atMin: 42, action: 'lower', toF: 200 },
        { atMin: 62, action: 'raise', toF: 225 },
        { atMin: 82, action: 'lower', toF: 200 }
      ]
    }));
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/3 direction reversals/);
  });

  it('is quiet about a monotone walk', () => {
    const findings = checkNoFlapping(outcome({
      readingsAt: [0, 20, 40, 60],
      ovenAt: [{ atMin: 0, setTemp: 250 }],
      moves: [
        { atMin: 22, action: 'lower', toF: 235 },
        { atMin: 42, action: 'lower', toF: 225 },
        { atMin: 62, action: 'lower', toF: 210 }
      ]
    }));
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
});
