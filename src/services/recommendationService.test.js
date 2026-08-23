import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRecommendationEligibility,
  calculateRecommendation,
  generateRecommendation,
  analyzeOvenResponsiveness,
  assessOvenChangeEffect,
  snapToDial,
  MAX_OVEN_OFF_MINUTES,
  MAX_CUMULATIVE_OVEN_OFF_MINUTES
} from './recommendationService.js';
import { createDefaultSettings } from '../models/dataModels.js';
import { celsiusToFahrenheit, fahrenheitToCelsius } from '../utils/temperatureUtils.js';

// Fixed "now" used by every clock-dependent test
const NOW = '2024-01-01T18:00:00.000Z';

/**
 * Build a reading list ending at `endISO`, spaced `spacingMinutes` apart
 */
function makeReadings(temps, { endISO = NOW, spacingMinutes = 30 } = {}) {
  const end = new Date(endISO).getTime();
  const last = temps.length - 1;
  return temps.map((temp, i) => ({
    temp,
    timestamp: new Date(end - (last - i) * spacingMinutes * 60000).toISOString()
  }));
}

function makeOvenEvent({ setTemp = 225, isOff = false, timestamp = NOW, previousTemp = null } = {}) {
  return { setTemp, isOff, timestamp, previousTemp };
}

const highConfidence = { level: 'high', reason: 'Consistent readings' };

describe('checkRecommendationEligibility', () => {
  /** Minutes before NOW, as an ISO string. */
  const ago = (minutes) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks when there are too few readings', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('insufficient_readings');
    expect(result.progress).toEqual({ current: 2, required: 3, message: '1 more reading needed' });
  });

  it('blocks on a stale reading, AHEAD of the stale oven check', () => {
    /**
     * The ordering IS the bug being fixed. A dial change logged ten minutes ago
     * satisfies the oven gate, so the app would go on advising from a projection
     * whose newest actual measurement of the meat was three hours old. The oven
     * setting is something the cook told the app; the reading is the only thing
     * the app knows about the roast.
     */
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110], { endISO: ago(180) }),
      // Fresh oven data, so stale_oven_data cannot fire and the ordering is what
      // decides the answer.
      ovenEvents: [makeOvenEvent({ timestamp: ago(10) })],
      desiredServeTime: '2024-01-01T22:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence,
      now: NOW
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('stale_reading');
    expect(result.progress.current).toBe(180);
    expect(result.progress.required).toBe(45);
  });

  it('lets a fresh reading through', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110], { endISO: ago(20) }),
      ovenEvents: [makeOvenEvent({ timestamp: ago(10) })],
      desiredServeTime: '2024-01-01T22:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence,
      now: NOW
    });

    expect(result.blockerType).not.toBe('stale_reading');
  });

  it('takes the stale-reading age from settings', () => {
    const params = {
      readings: makeReadings([100, 105, 110], { endISO: ago(50) }),
      ovenEvents: [makeOvenEvent({ timestamp: ago(10) })],
      desiredServeTime: '2024-01-01T22:00:00.000Z',
      confidence: highConfidence,
      now: NOW
    };

    expect(checkRecommendationEligibility({
      ...params, settings: { ...createDefaultSettings(), staleReadingMinutes: 45 }
    }).blockerType).toBe('stale_reading');

    expect(checkRecommendationEligibility({
      ...params, settings: { ...createDefaultSettings(), staleReadingMinutes: 90 }
    }).blockerType).not.toBe('stale_reading');
  });

  it('blocks when readings do not span enough time', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110], { spacingMinutes: 5 }),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('insufficient_time');
    expect(result.progress.current).toBe(10);
  });

  it('blocks when no oven event has been logged', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('no_oven_data');
  });

  it('no longer blocks merely because the oven setting is old', () => {
    /**
     * The stale-oven blocker is gone, and this is the test that says so.
     *
     * It was wrong in principle - a dial nobody has touched for an hour means the
     * cook has not changed it, which is normal - and it LATCHED: the only way to
     * clear it was to log an oven event, and the app's own advice was what
     * generated them. A cook where the app happened to stay quiet for the first
     * hour went permanently silent, sitting on a valid projection saying "50 min
     * late" that it refused to mention.
     *
     * Removing it in isolation was measured WORSE (eight dial moves, four
     * reversals, a cook that never finished): it was suppressing an oscillation by
     * accident. It could only go once the things that genuinely stop that
     * oscillation were in place - the dead-time gate, the hold-is-not-a-request
     * fix, and the stale-READING gate, which withholds advice on the honest
     * grounds that the app has not looked at the meat lately.
     *
     * The age of the setting is still shown, as a chip in the status band.
     */
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      // Four hours old, against a 60 minute ovenTempStaleMinutes.
      ovenEvents: [makeOvenEvent({ timestamp: '2024-01-01T14:00:00.000Z' })],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence,
      now: NOW
    });

    expect(result.canRecommend).toBe(true);
    expect(result.blockerType).toBeNull();
  });

  it('does not apply the stale check while the oven is off', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: '2024-01-01T14:00:00.000Z' })],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: { level: 'insufficient', reason: 'Not enough data' }
    });

    expect(result.canRecommend).toBe(true);
  });

  it('blocks when no serve time is set', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: null,
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('no_serve_time');
  });

  it('blocks on a refused projection, and names the cause', () => {
    /**
     * This replaces three branches that keyed on SUBSTRINGS of a human-readable
     * confidence reason - `reason.includes('slow or negative')` and
     * `reason.includes('fluctuating')` - which made two prose fragments a de-facto
     * API that no test covered and any copy edit could disable.
     *
     * One of the two was also permanently dead: it fired on R² < 0.7, and R² over
     * a three-point window cannot fall below about 0.75, so the `unstable_rate`
     * blocker had never once been reached in the app's life.
     */
    const base = {
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence,
      now: NOW
    };

    for (const code of [
      'insufficient-readings', 'insufficient-span', 'insufficient-rise',
      'insufficient-progress', 'poor-fit', 'unreachable', 'beyond-horizon'
    ]) {
      const result = checkRecommendationEligibility({
        ...base, projectionRefusedReason: code
      });
      expect(result.canRecommend, code).toBe(false);
      expect(result.blockerType, code).toBe('no_projection');
      // The cause travels with it: "raise the oven" is the right suggestion for
      // `unreachable` and nonsense for the rest.
      expect(result.blockerCode, code).toBe(code);
      // And every one of them has its own sentence, not a shared fallback.
      expect(result.blockerReason, code).toBeTruthy();
      expect(result.blockerReason, code).not.toBe('There is no projection to advise from yet.');
    }
  });

  it('still blocks on a confidence the caller has already given up on', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: { level: 'insufficient', code: 'poor-fit', reason: 'Readings scatter' },
      now: NOW
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('no_projection');
    expect(result.blockerCode).toBe('poor-fit');
  });

  it('allows a recommendation when every condition is met', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result).toEqual({
      canRecommend: true,
      blockerReason: null,
      blockerType: null,
      progress: null
    });
  });
});

describe('calculateRecommendation', () => {
  const settings = createDefaultSettings();

  it('recommends holding when on track', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: 2,
      scheduleStatus: 'on-track',
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12
    });

    expect(result.action).toBe('hold');
    expect(result.suggestedTemp).toBe(225);
    expect(result.changeAmount).toBe(0);
    expect(result.severity).toBe('normal');
  });

  it('raises by one step when slightly late', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: 10,
      scheduleStatus: 'late',
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12
    });

    expect(result.action).toBe('raise');
    expect(result.suggestedTemp).toBe(235);
    expect(result.changeAmount).toBe(10);
    expect(result.severity).toBe('normal');
  });

  it('raises by the maximum step and flags urgency when very late', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: 45,
      scheduleStatus: 'late',
      settings,
      predictedMinutesToTarget: 120,
      currentRate: 10
    });

    expect(result.action).toBe('raise');
    expect(result.changeAmount).toBe(25); // capped by recommendationMaxStepF
    expect(result.suggestedTemp).toBe(250);
    expect(result.severity).toBe('urgent');
  });

  it('holds with a warning when already at the maximum oven temperature', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 300,
      scheduleVarianceMinutes: 40,
      scheduleStatus: 'late',
      settings,
      predictedMinutesToTarget: 120,
      currentRate: 10
    });

    expect(result.action).toBe('hold');
    expect(result.severity).toBe('warning');
    expect(result.maxTempF).toBe(300);
    expect(result.message).toContain('{maxTemp}');
  });

  it('lowers the oven when running early', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 250,
      scheduleVarianceMinutes: -20,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12
    });

    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBe(235);
    expect(result.changeAmount).toBe(15);
  });

  it('suggests pausing when the oven is as low as it can usefully go', () => {
    // 150 °F core clears the 140 °F food-safety floor, and a 145 °F target leaves
    // the 175 °F oven its 25 °F of headroom - both conditions the pause needs.
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -45,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 120,
      currentRate: 10,
      latestCoreTempF: 150,
      targetTempF: 145
    });

    expect(result.action).toBe('oven-off');
    expect(result.ovenOffMinutes).toBeGreaterThan(0);
    expect(result.alternativeMessage).toContain('{ovenTemp}');
  });

  it('lowers to the practical minimum even with low temps disabled', () => {
    // The dial is at 180 and the practical minimum is 175, so "lower to 175" is
    // available and legal. enableLowTempRecommendations governs suggestions
    // BELOW the practical minimum; lowering to it is not one of those.
    //
    // This used to return oven-off. The setting was tested before the clamp, so
    // a cook with it switched off was told to turn the oven OFF when turning the
    // dial down 5 degrees was right there.
    const result = calculateRecommendation({
      ovenBaseTemp: 180,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings: { ...settings, enableLowTempRecommendations: false },
      predictedMinutesToTarget: 120,
      currentRate: 10,
      latestCoreTempF: 118,
      targetTempF: 125
    });

    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBe(175);
  });

  it('only reaches the low-temps-disabled pause once the dial is at the floor', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings: { ...settings, enableLowTempRecommendations: false },
      predictedMinutesToTarget: 120,
      currentRate: 10,
      // 150 °F core: above the 140 °F food-safety floor, so the pause path is
      // reachable. It is not reachable below that for any target - see
      // mayPauseCooking.
      latestCoreTempF: 150,
      targetTempF: 175
    });

    expect(result.action).toBe('oven-off');
    expect(result.practicalMinF).toBe(175);
    expect(result.message).toContain('{minTemp}');
  });

  it('will not lower the oven so far the roast cannot finish', () => {
    /**
     * The core asymptotes to the oven, so an oven at the target means the roast
     * approaches it and never arrives - lowering into that region does not slow a
     * roast, it stops one.
     *
     * Found by the harness, and it cost a whole cook: a 9 lb shoulder heading for
     * 195 °F, running 254 minutes early, was told to lower the oven to 200 °F. It
     * spent seven more hours creeping upward and finished 38 °F short.
     */
    const stalled = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: -250,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 150,
      targetTempF: 195
    });

    // 195 + 25 headroom = 220, snapped up to the dial: never below that.
    expect(stalled.suggestedTemp).toBeGreaterThanOrEqual(220);

    // And with the oven already on that floor there is nothing to lower to.
    // And with the oven already on that floor there is nothing left to lower -
    // but a PAUSE is temporary and does not change the steady state, so it is
    // still on the table when the core allows one (150 °F clears the 140 °F
    // food-safety floor).
    const onFloor = calculateRecommendation({
      ovenBaseTemp: 220,
      // 40 min early: within what a pause can buy.
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 150,
      targetTempF: 195
    });
    expect(onFloor.action).toBe('oven-off');

    // A cold core on that same floor has nothing left at all.
    const coldOnFloor = calculateRecommendation({
      ovenBaseTemp: 220,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 300,
      currentRate: 25,
      latestCoreTempF: 120,
      targetTempF: 195
    });
    expect(coldOnFloor.action).toBe('hold');
    expect(coldOnFloor.minTempF).toBe(220);
  });

  it('refuses to pause below 140 F core, at any target', () => {
    /**
     * The food-safety guard, restored after an exemption weakened it. Switching
     * the oven off below 140 °F lets the surface - the part the heat has actually
     * been pasteurising - cool back toward the danger zone, for a stretch the app
     * cannot police.
     *
     * This does mean red-meat cooks get no pause suggestion: every red-meat pull
     * is under 140 °F. That is the correct outcome. What is left for a cook
     * running early is the lower-the-dial ladder, which is most of the effect and
     * carries none of the risk.
     */
    for (const [core, target] of [[90, 195], [118, 125], [100, 125], [139, 130]]) {
      const result = calculateRecommendation({
        ovenBaseTemp: 175,
        scheduleVarianceMinutes: -60,
        scheduleStatus: 'early',
        settings,
        predictedMinutesToTarget: 200,
        currentRate: 20,
        latestCoreTempF: core,
        targetTempF: target
      });
      expect(result.action, `core ${core} / target ${target}`).toBe('hold');
      expect(result.ovenOffMinutes).toBeNull();
    }
  });

  it('stops offering pauses once the cook has spent its budget', () => {
    // MAX_OVEN_OFF_MINUTES bounds one pause; nothing bounded how many. A cook
    // hours early who does as they are told used to get a fresh 20 minutes every
    // time they restarted.
    const params = {
      ovenBaseTemp: 175,
      // Within what a pause can buy, so the budget is what decides it.
      scheduleVarianceMinutes: -45,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 200,
      currentRate: 20,
      latestCoreTempF: 160,
      targetTempF: 190
    };
    expect(calculateRecommendation({ ...params, pausedMinutesSoFar: 0 }).action)
      .toBe('oven-off');
    expect(calculateRecommendation({ ...params, pausedMinutesSoFar: 60 }).action)
      .toBe('hold');
    expect(calculateRecommendation({ ...params, pausedMinutesSoFar: 60 }).reasoning)
      .toMatch(/already been off/);
  });

  it('caps the pause at 20 minutes at the largest gap it will act on', () => {
    /**
     * Measured oven-off efficiency is 0.4-0.53: a closed oven gives up its heat
     * slowly, so the meat keeps climbing through most of a pause and 45 minutes of
     * oven-off buys about 20 minutes of delay. The old bound was 45, which
     * promised more than twice what it delivered.
     *
     * "However early" no longer applies, and that is a separate fix: past
     * MAX_CUMULATIVE_OVEN_OFF_MINUTES of gap the pause is refused outright rather
     * than offered as a remedy it cannot be. So the cap is exercised at the
     * largest gap the app will still act on.
     */
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -MAX_CUMULATIVE_OVEN_OFF_MINUTES,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 60,
      currentRate: 10,
      latestCoreTempF: 145,
      targetTempF: 145
    });

    expect(result.action).toBe('oven-off');
    // 60 * 0.5 = 30, capped to 20.
    expect(result.ovenOffMinutes).toBe(MAX_OVEN_OFF_MINUTES);
  });

  it('pauses for half of however early the cook is, up to the cap', () => {
    const pauseFor = (variance) => calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: variance,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 60,
      currentRate: 10,
      latestCoreTempF: 145,
      targetTempF: 145
    }).ovenOffMinutes;

    // Half the variance, inside the [5, 20] bounds. Asserted across a range
    // rather than at one point: the old test picked a single variance where the
    // two branches it claimed to discriminate BOTH returned 20, so it could not
    // have failed whichever one ran.
    expect(pauseFor(-6)).toBe(5);    // floor
    expect(pauseFor(-24)).toBe(12);
    expect(pauseFor(-30)).toBe(15);
    expect(pauseFor(-50)).toBe(20);  // cap
  });

  it('ignores the projection entirely when sizing the pause', () => {
    // predictedMinutesToTarget and currentRate no longer reach the pause
    // duration at all. The 0.4x branch that used to read them was unreachable:
    // its only caller sits inside the 'early' branch, which needs a schedule
    // variance, which needs a projection.
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -50,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: null,
      currentRate: null,
      latestCoreTempF: 145,
      targetTempF: 145
    });

    // Same answer as the branch that has a projection: 50 * 0.5, capped at 20.
    expect(result.ovenOffMinutes).toBe(20);
  });

  it('returns no recommendation for an unknown schedule status', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: null,
      scheduleStatus: 'unknown',
      settings,
      predictedMinutesToTarget: null,
      currentRate: null
    });

    expect(result.action).toBe('none');
    expect(result.severity).toBe('unknown');
  });

  it('emits placeholders rather than pre-rendered Fahrenheit temperatures', () => {
    const cases = [
      { scheduleStatus: 'on-track', scheduleVarianceMinutes: 0, ovenBaseTemp: 225 },
      { scheduleStatus: 'late', scheduleVarianceMinutes: 12, ovenBaseTemp: 225 },
      { scheduleStatus: 'late', scheduleVarianceMinutes: 45, ovenBaseTemp: 225 },
      { scheduleStatus: 'early', scheduleVarianceMinutes: -12, ovenBaseTemp: 250 },
      { scheduleStatus: 'early', scheduleVarianceMinutes: -45, ovenBaseTemp: 200 }
    ];

    for (const testCase of cases) {
      const result = calculateRecommendation({
        ...testCase,
        settings,
        predictedMinutesToTarget: 90,
        currentRate: 12
      });

      expect(result.message).not.toMatch(/°F/);
      // Any temperature mentioned in a message must still be a placeholder
      expect(result.message).not.toMatch(/\d+°/);
      if (result.action === 'hold' || result.action === 'raise' || result.action === 'lower') {
        expect(result.message).toMatch(/\{(ovenTemp|suggestedTemp|maxTemp|minTemp)\}/);
      }
    }
  });
});

describe('generateRecommendation', () => {
  const settings = createDefaultSettings();

  function baseParams(overrides = {}) {
    return {
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [makeOvenEvent()],
      ovenBaseTemp: 225,
      pullTempF: 125,
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      scheduleVarianceMinutes: 0,
      scheduleStatus: 'on-track',
      confidence: highConfidence,
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12,
      ...overrides
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('at-target short circuit', () => {
    it('reports at-target when the latest reading has reached the target', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 115, 126]),
        scheduleStatus: 'late',
        scheduleVarianceMinutes: 40
      }));

      expect(result.action).toBe('at-target');
      expect(result.canRecommend).toBe(true);
      expect(result.latestReadingTemp).toBe(126);
      expect(result.suggestedTemp).toBeNull();
      expect(result.message).toContain('{latestTemp}');
    });

    it('reports at-target on an exact match', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 115, 125])
      }));

      expect(result.action).toBe('at-target');
    });

    it('short circuits ahead of the eligibility blockers', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([126]), // below minReadingsForRecommendation
        desiredServeTime: null,
        ovenEvents: []
      }));

      expect(result.action).toBe('at-target');
      expect(result.blockerType).toBeNull();
    });

    it('never suggests raising the oven once the target is reached', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 118, 130]),
        scheduleStatus: 'late',
        scheduleVarianceMinutes: 60
      }));

      expect(result.action).not.toBe('raise');
      expect(result.changeAmount).toBeNull();
    });

    it('does not short circuit below the target', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 110, 124])
      }));

      expect(result.action).toBe('hold');
    });
  });

  describe('needs-reading pause state', () => {
    const pauseStart = '2024-01-01T17:30:00.000Z';

    it('asks for a fresh reading when paused with no reading since the pause', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 108, 116], { endISO: '2024-01-01T17:00:00.000Z' }),
        ovenEvents: [
          makeOvenEvent({ timestamp: '2024-01-01T15:00:00.000Z' }),
          makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart, previousTemp: 225 })
        ]
      }));

      expect(result.action).toBe('needs-reading');
      expect(result.canRecommend).toBe(true);
      expect(result.message).toMatch(/log a fresh reading/i);
      expect(result.suggestedTemp).toBeNull();
    });

    it('carries no estimated meat temperature or restart timing', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 108, 116], { endISO: '2024-01-01T17:00:00.000Z' }),
        ovenEvents: [
          makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart, previousTemp: 225 })
        ]
      }));

      expect(result.action).toBe('needs-reading');
      expect(result).not.toHaveProperty('estimatedCurrentMeatTemp');
      expect(result).not.toHaveProperty('restartTime');
      expect(result).not.toHaveProperty('minutesUntilRestart');
      expect(result).not.toHaveProperty('shouldRestartNow');
    });

    it('asks for a reading when paused with no readings at all', () => {
      const result = generateRecommendation(baseParams({
        readings: [],
        ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart })]
      }));

      expect(result.action).toBe('needs-reading');
    });

    it('does not change as the clock advances', () => {
      const params = baseParams({
        readings: makeReadings([100, 108, 116], { endISO: '2024-01-01T17:00:00.000Z' }),
        ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart })]
      });

      const first = generateRecommendation(params);
      vi.advanceTimersByTime(90 * 60 * 1000);
      const second = generateRecommendation(params);

      expect(second).toEqual(first);
    });

    it('asks for the oven back on, not for a dial change, while it is off', () => {
      // A post-pause reading exists, so the app knows where the meat is and the
      // needs-reading branch is behind us. It used to fall straight through to
      // the projection-based branches and advise "raise the oven to 235" - about
      // an oven that was switched off. The eligibility gate lets the paused state
      // through ahead of every confidence check by design; nothing constrained
      // the ACTION that came out the other side.
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 108, 116], { endISO: NOW }),
        ovenEvents: [
          makeOvenEvent({ timestamp: '2024-01-01T15:00:00.000Z' }),
          makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart, previousTemp: 225 })
        ],
        scheduleStatus: 'late',
        scheduleVarianceMinutes: 12
      }));

      expect(result.action).toBe('restart-oven');
      expect(result.canRecommend).toBe(true);
      expect(result.changeAmount).toBe(0);
      expect(result.latestReadingTemp).toBe(116);
    });

    it('treats a reading logged at the pause timestamp as a post-pause reading', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 108, 116], { endISO: pauseStart }),
        ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart })]
      }));

      expect(result.action).not.toBe('needs-reading');
    });
  });

  describe('blocked and normal results', () => {
    it('returns the blocker information when ineligible', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 110])
      }));

      expect(result.canRecommend).toBe(false);
      expect(result.action).toBe('none');
      expect(result.blockerType).toBe('insufficient_readings');
      expect(result.progress.required).toBe(3);
    });

    it('passes the normal recommendation through with the latest reading attached', () => {
      const result = generateRecommendation(baseParams());

      expect(result.action).toBe('hold');
      expect(result.canRecommend).toBe(true);
      expect(result.latestReadingTemp).toBe(116);
      expect(result.message).toContain('{ovenTemp}');
    });

    describe('every branch emits the same shape', () => {
      /**
       * This used to pin an EXACT key set, transcribed as an array of eighteen
       * strings. Two problems with that. It broke on every field the builder
       * gained - `blockerCode` and `plannedTempF` both did, and a test that fails
       * for a correct change teaches people to edit the test. And it did not
       * actually assert the thing worth asserting: that the branches agree with
       * EACH OTHER. A shared omission would have satisfied it perfectly.
       *
       * Two properties instead. Every branch carries the keys the UI reads, and
       * every branch carries the same keys as every other. Neither has to be
       * updated when the builder gains a field; both fail if one branch quietly
       * stops emitting one.
       */

      /** The fields useRecommendations reads unconditionally. */
      const REQUIRED = [
        'action', 'suggestedTemp', 'changeAmount', 'message', 'reasoning',
        'alternativeMessage', 'ovenOffMinutes', 'severity', 'canRecommend',
        'blockerReason', 'blockerType', 'progress', 'awaitingEffect', 'waitMinutes'
      ];

      /** One result from each structurally different path through the service. */
      const branches = () => ({
        'normal advice': generateRecommendation(baseParams()),
        'at target': generateRecommendation(baseParams({ readings: makeReadings([126]) })),
        'blocked on readings': generateRecommendation(baseParams({
          readings: makeReadings([100, 110])
        })),
        'needs a post-pause reading': generateRecommendation(baseParams({
          readings: makeReadings([100, 108, 116], { endISO: '2024-01-01T17:00:00.000Z' }),
          ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: '2024-01-01T17:30:00.000Z' })]
        })),
        'restart the oven': generateRecommendation(baseParams({
          readings: makeReadings([100, 108, 116], { endISO: NOW }),
          ovenEvents: [
            makeOvenEvent({ timestamp: '2024-01-01T15:00:00.000Z' }),
            makeOvenEvent({ setTemp: 0, isOff: true, timestamp: '2024-01-01T17:00:00.000Z', previousTemp: 225 })
          ]
        })),
        'no projection': generateRecommendation(baseParams({
          projectionRefusedReason: 'unreachable'
        }))
      });

      it('emits at least every field the UI reads', () => {
        for (const [name, result] of Object.entries(branches())) {
          for (const key of REQUIRED) {
            expect(result, `${name} is missing ${key}`).toHaveProperty(key);
          }
        }
      });

      it('emits the same field set as every other branch', () => {
        const entries = Object.entries(branches());
        const [referenceName, reference] = entries[0];
        const expected = Object.keys(reference).sort();
        for (const [name, result] of entries.slice(1)) {
          expect(Object.keys(result).sort(), `${name} differs from ${referenceName}`)
            .toEqual(expected);
        }
      });
    });
  });
});

describe('analyzeOvenResponsiveness', () => {
  it('returns null without enough oven events or readings', () => {
    expect(analyzeOvenResponsiveness([], [])).toBeNull();
    expect(analyzeOvenResponsiveness(makeReadings([100, 105, 110, 115, 120]), [makeOvenEvent()])).toBeNull();
  });

  it('describes a positive correlation between oven temp and heating rate', () => {
    const ovenEvents = [
      makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T12:00:00.000Z' }),
      makeOvenEvent({ setTemp: 275, timestamp: '2024-01-01T15:00:00.000Z' })
    ];
    const readings = [
      { temp: 60, timestamp: '2024-01-01T12:30:00.000Z' },
      { temp: 70, timestamp: '2024-01-01T13:30:00.000Z' },
      { temp: 80, timestamp: '2024-01-01T14:30:00.000Z' },
      { temp: 100, timestamp: '2024-01-01T15:30:00.000Z' },
      { temp: 130, timestamp: '2024-01-01T16:30:00.000Z' },
      { temp: 160, timestamp: '2024-01-01T17:30:00.000Z' }
    ];

    const result = analyzeOvenResponsiveness(readings, ovenEvents);

    expect(result).not.toBeNull();
    expect(result.segments).toHaveLength(2);
    expect(result.responsiveness).toBeGreaterThan(0);
    expect(result.descriptionType.type).toBe('high');
  });
});

describe('oven-off regressions', () => {
  const settings = createDefaultSettings();

  /** Minutes before NOW, as an ISO string. */
  function ago(minutes) {
    return new Date(Date.parse(NOW) - minutes * 60000).toISOString();
  }

  /** Three readings spanning 90 minutes, climbing steadily. */
  const readings = [
    { id: 'a', temp: 100, timestamp: ago(90), deltaFromStart: 0, deltaFromPrevious: 0 },
    { id: 'b', temp: 110, timestamp: ago(60), deltaFromStart: 10, deltaFromPrevious: 10 },
    { id: 'c', temp: 120, timestamp: ago(30), deltaFromStart: 20, deltaFromPrevious: 10 }
  ];

  it('names the last temperature actually set, not the 0 of an off event', () => {
    // The cook paused, then logged a fresh reading, and is running late. The
    // advice is to restart - see the restart-only branch - and the temperature it
    // names has to be the one the dial was on, not the 0 an off event stores.
    // Adjusting from that 0 used to produce a 25°F set point that the Apply
    // button wrote straight into the oven history.
    const result = generateRecommendation({
      readings,
      ovenEvents: [
        { id: 'o1', setTemp: 225, timestamp: ago(120), previousTemp: null, isOff: false },
        { id: 'o2', setTemp: 0, timestamp: ago(45), previousTemp: 225, isOff: true }
      ],
      ovenBaseTemp: 225,
      pullTempF: 200,
      desiredServeTime: ago(-20),
      scheduleVarianceMinutes: 25,
      scheduleStatus: 'late',
      confidence: { level: 'high', reason: 'good' },
      settings,
      predictedMinutesToTarget: 60,
      currentRate: 20,
      now: NOW
    });

    expect(result.action).toBe('restart-oven');
    expect(result.suggestedTemp).toBe(225);
    expect(Number.isNaN(result.suggestedTemp)).toBe(false);
  });

  it('still asks for a reading when nothing has been logged since the pause', () => {
    const result = generateRecommendation({
      readings,
      ovenEvents: [
        { id: 'o1', setTemp: 225, timestamp: ago(120), previousTemp: null, isOff: false },
        { id: 'o2', setTemp: 0, timestamp: ago(10), previousTemp: 225, isOff: true }
      ],
      ovenBaseTemp: 225,
      pullTempF: 200,
      desiredServeTime: ago(-20),
      scheduleVarianceMinutes: 25,
      scheduleStatus: 'late',
      confidence: { level: 'high', reason: 'good' },
      settings,
      predictedMinutesToTarget: 60,
      currentRate: 20,
      now: NOW
    });

    expect(result.action).toBe('needs-reading');
  });
});

describe('staleness is measured against an injected clock', () => {
  const settings = createDefaultSettings();

  const readings = [
    { id: 'a', temp: 100, timestamp: '2024-01-01T16:00:00.000Z', deltaFromStart: 0, deltaFromPrevious: 0 },
    { id: 'b', temp: 110, timestamp: '2024-01-01T16:45:00.000Z', deltaFromStart: 10, deltaFromPrevious: 10 },
    { id: 'c', temp: 120, timestamp: '2024-01-01T17:30:00.000Z', deltaFromStart: 20, deltaFromPrevious: 10 }
  ];
  const ovenEvents = [
    { id: 'o1', setTemp: 225, timestamp: '2024-01-01T15:55:00.000Z', previousTemp: null, isOff: false }
  ];

  function eligibilityAt(now) {
    return checkRecommendationEligibility({
      readings,
      ovenEvents,
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings,
      confidence: { level: 'high', reason: 'good' },
      now
    });
  }

  it('passes while the newest reading is fresh', () => {
    // 20 minutes after the last reading, against a 45 minute limit.
    expect(eligibilityAt('2024-01-01T17:50:00.000Z').canRecommend).toBe(true);
  });

  it('blocks once the same data has aged past the threshold', () => {
    /**
     * Nothing about the session changed - only `now`. This is the property the
     * describe block exists for: the gate has to read the clock it is GIVEN, not
     * the wall clock, because it is called from a computed that is deliberately
     * tick-free and the block would otherwise never appear while the app sat
     * idle.
     *
     * Repointed from stale_oven_data to stale_reading when the former was
     * removed. The property is the same and it is worth keeping; only the gate
     * that demonstrates it changed.
     */
    const later = eligibilityAt('2024-01-01T19:00:00.000Z');
    expect(later.canRecommend).toBe(false);
    expect(later.blockerType).toBe('stale_reading');
  });
});

describe('dial-settable suggestions', () => {
  const settings = createDefaultSettings();

  it('snaps to marks the user can actually set, in the unit on screen', () => {
    // 102°C is not a dial position; 100°C is
    expect(snapToDial(celsiusToFahrenheit(102), 'C')).toBe(celsiusToFahrenheit(100));
    expect(snapToDial(celsiusToFahrenheit(103), 'C')).toBe(celsiusToFahrenheit(105));
    expect(snapToDial(213, 'F')).toBe(215);
    expect(snapToDial(213, 'F', 'down')).toBe(210);
    expect(snapToDial(211, 'F', 'up')).toBe(215);
  });

  it('never suggests a Celsius temperature between the marks', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: celsiusToFahrenheit(112),
      scheduleVarianceMinutes: -20,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12,
      displayUnits: 'C'
    });

    expect(result.action).toBe('lower');
    expect(fahrenheitToCelsius(result.suggestedTemp) % 5).toBe(0);
    expect(result.suggestedTemp).toBeLessThan(celsiusToFahrenheit(112));
  });

  it('still moves the dial when snapping would have swallowed the whole step', () => {
    // A 10°F step from 227°F lands on 237°F, which snaps back to 235°F - fine -
    // but a base already on a mark with a sub-increment step must still move.
    const result = calculateRecommendation({
      ovenBaseTemp: 225,
      scheduleVarianceMinutes: 10,
      scheduleStatus: 'late',
      settings: { ...settings, recommendationStepF: 5 },
      predictedMinutesToTarget: 90,
      currentRate: 12,
      displayUnits: 'F'
    });

    expect(result.suggestedTemp).toBeGreaterThan(225);
    expect(result.changeAmount).toBeGreaterThan(0);
  });

  // recommendationMaxStepF used to be applied to the step BEFORE the dial snap,
  // and the snap rounds to the nearest mark - so on a Celsius dial, whose marks
  // are 5°C (9°F) apart, a 25°F cap emitted a 27°F (15°C) suggestion. Found by
  // the simulated-cook harness, which flagged it in both Celsius scenarios and
  // in neither Fahrenheit one.
  describe('recommendationMaxStepF survives the dial snap', () => {
    /**
     * The cap is written out, not read back off the settings object.
     *
     * `expect(changeAmount).toBeLessThanOrEqual(settings.recommendationMaxStepF)`
     * asserts against the same value the implementation reads, so it holds for
     * ANY cap - raise the default to 100 °F and the app would emit 100 °F steps
     * with this test still green. A test that cannot distinguish the intended
     * behaviour from a changed constant is measuring the constant.
     *
     * So: the number, plus a separate assertion that the default is still what
     * these cases were written against. Change the default and exactly one test
     * fails, loudly, naming the reason.
     */
    const MAX_STEP_F = 25;

    it('is written against the default this suite assumes', () => {
      expect(settings.recommendationMaxStepF).toBe(MAX_STEP_F);
      expect(settings.recommendationStepF).toBe(10);
    });

    const cases = [
      { label: 'raise, Celsius', baseC: 95, status: 'late', variance: 40 },
      { label: 'raise, Celsius on an odd mark', baseC: 100, status: 'late', variance: 40 },
      { label: 'lower, Celsius', baseC: 130, status: 'early', variance: -40 },
      { label: 'raise, Celsius, moderate', baseC: 95, status: 'late', variance: 20 },
      { label: 'lower, Celsius, moderate', baseC: 130, status: 'early', variance: -20 }
    ];

    for (const { label, baseC, status, variance } of cases) {
      it(`caps the change at recommendationMaxStepF (${label})`, () => {
        const result = calculateRecommendation({
          ovenBaseTemp: celsiusToFahrenheit(baseC),
          scheduleVarianceMinutes: variance,
          scheduleStatus: status,
          settings,
          predictedMinutesToTarget: 100,
          currentRate: 30,
          displayUnits: 'C'
        });

        expect(result.changeAmount).toBeLessThanOrEqual(MAX_STEP_F);
        // Still a real dial position, and still a real move.
        expect(fahrenheitToCelsius(result.suggestedTemp) % 5).toBe(0);
        expect(result.changeAmount).toBeGreaterThan(0);
      });
    }

    it('leaves Fahrenheit suggestions on the cap exactly, as before', () => {
      const raise = calculateRecommendation({
        ovenBaseTemp: 200,
        scheduleVarianceMinutes: 40,
        scheduleStatus: 'late',
        settings,
        predictedMinutesToTarget: 100,
        currentRate: 30,
        displayUnits: 'F'
      });
      expect(raise.suggestedTemp).toBe(225);
      expect(raise.changeAmount).toBe(MAX_STEP_F);
    });
  });
});

describe('assessOvenChangeEffect', () => {
  const settings = createDefaultSettings();

  it('treats a cook with no oven change as settled', () => {
    expect(assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [makeOvenEvent({ timestamp: '2024-01-01T17:00:00.000Z' })],
      settings,
      now: NOW
    }).settled).toBe(true);

    expect(assessOvenChangeEffect({
      readings: [], ovenEvents: [], settings, now: NOW
    }).settled).toBe(true);
  });

  it('reports a fresh change as unmeasured and names the set point the readings describe', () => {
    const effect = assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T17:55:00.000Z' })
      ],
      settings,
      now: NOW
    });

    expect(effect.settled).toBe(false);
    expect(effect.evidenceTemp).toBe(225);
    expect(effect.currentTemp).toBe(200);
    expect(effect.minutesSinceChange).toBe(5);
    expect(effect.waitMinutes).toBe(10); // 15 min lag, 5 of them elapsed
  });

  it('settles once enough readings sit past the thermal lag', () => {
    const effect = assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116], { spacingMinutes: 20 }),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T17:20:00.000Z' })
      ],
      settings,
      now: NOW
    });

    expect(effect.settled).toBe(true);
  });

  it('anchors a chain of unmeasured changes to the oldest set point, not the previous one', () => {
    const effect = assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [
        makeOvenEvent({ setTemp: 250, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 235, timestamp: '2024-01-01T17:50:00.000Z' }),
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:55:00.000Z' })
      ],
      settings,
      now: NOW
    });

    expect(effect.settled).toBe(false);
    expect(effect.evidenceTemp).toBe(250);
    expect(effect.currentTemp).toBe(225);
  });

  it('treats a dial moved away and back again as settled', () => {
    const effect = assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T17:50:00.000Z' }),
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:55:00.000Z' })
      ],
      settings,
      now: NOW
    });

    expect(effect.settled).toBe(true);
  });

  it('ignores oven-off events, which suspend the set point rather than move it', () => {
    const effect = assessOvenChangeEffect({
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 0, isOff: true, timestamp: '2024-01-01T17:50:00.000Z' })
      ],
      settings,
      now: NOW
    });

    expect(effect.settled).toBe(true);
  });
});

describe('an oven change already made is not charged twice', () => {
  const settings = createDefaultSettings();

  // Running early at 225°F: the engine wants 210°F. Every case below shares that
  // projection - only the set point the user actually chose differs.
  function paramsWithDial(dialTemp, overrides = {}) {
    return {
      readings: makeReadings([100, 108, 116]),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: dialTemp, timestamp: '2024-01-01T17:55:00.000Z' })
      ],
      ovenBaseTemp: dialTemp,
      pullTempF: 125,
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      scheduleVarianceMinutes: -20,
      scheduleStatus: 'early',
      confidence: highConfidence,
      settings,
      predictedMinutesToTarget: 90,
      currentRate: 12,
      displayUnits: 'F',
      now: NOW,
      ...overrides
    };
  }

  it('accepts a change that lands where the projection asked for', () => {
    const result = generateRecommendation(paramsWithDial(210));

    expect(result.action).toBe('settling');
    expect(result.awaitingEffect).toBe(true);
    expect(result.changeAmount).toBe(0);
    expect(result.suggestedTemp).toBe(210);
    expect(result.waitMinutes).toBe(10);
  });

  it('accepts a change the user rounded to a mark they could hit', () => {
    // 205°F rather than the 210°F asked for: inside the step's own precision
    const result = generateRecommendation(paramsWithDial(205));

    expect(result.action).toBe('settling');
    expect(result.changeAmount).toBe(0);
  });

  it('does not re-apply the step from the new set point', () => {
    // The original regression: from a dial at 175°F the old code recommended
    // 175 - 15 = 160°F, and would keep walking down a step per update.
    const result = generateRecommendation(paramsWithDial(175));

    expect(result.changeAmount).toBe(0);
    expect(result.awaitingEffect).toBe(true);
  });

  it('accepts a dial taken well past the plan rather than pulling it back', () => {
    // Running EARLY, so the projection asked for a drop. The cook dropped
    // further than asked. Telling them to raise the oven would be advising the
    // opposite of what the schedule needs, on a projection that has not yet
    // measured either change.
    const result = generateRecommendation(paramsWithDial(175));

    expect(result.action).toBe('settling');
    expect(result.suggestedTemp).toBe(175);   // the dial, unchanged
    expect(result.plannedTempF).toBe(210);    // what the projection had asked for
  });

  it('still retargets when the dial moved the wrong way', () => {
    // Running early and the oven went UP. Nothing about the unmeasured change
    // excuses that, so the 210°F the projection called for is restated.
    const result = generateRecommendation(paramsWithDial(250));

    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBe(210);
    expect(result.awaitingEffect).toBe(true);
  });

  it('never answers running early with a raise', () => {
    // The reported failure, in the shape it was seen: 42 min early, the dial
    // already stepped down twice, and the band asked for a raise.
    for (const dial of [215, 205, 195, 185, 175, 150, 120]) {
      const result = generateRecommendation(paramsWithDial(dial, {
        scheduleVarianceMinutes: -42
      }));

      expect(result.action).not.toBe('raise');
    }
  });

  it('never chases the dial downward across a run of unmeasured changes', () => {
    // The old behaviour: each of these returned dial - 15, so the advice walked
    // away from the target every time the user logged a change.
    for (const dial of [215, 205, 195, 185, 175]) {
      const result = generateRecommendation(paramsWithDial(dial));

      if (result.action === 'settling') {
        expect(result.changeAmount).toBe(0);
      } else {
        expect(result.suggestedTemp).toBe(210);
      }
      expect(result.suggestedTemp).toBeGreaterThanOrEqual(175);
    }
  });

  it('goes back to advising from the current set point once the change is measured', () => {
    const result = generateRecommendation(paramsWithDial(200, {
      readings: makeReadings([100, 108, 116], { spacingMinutes: 20 }),
      ovenEvents: [
        makeOvenEvent({ setTemp: 225, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T17:20:00.000Z' })
      ]
    }));

    expect(result.awaitingEffect).toBe(false);
    expect(result.action).toBe('lower');
    expect(result.suggestedTemp).toBe(185); // 200 - 15, from the measured setting
  });

  it('keeps pause advice intact but restarts at the new setting', () => {
    /**
     * Pausing is advice about the clock, not the dial: a set point change does not
     * invalidate it, but the restart should name where the dial now is.
     *
     * The readings here run to 116 °F, which is BELOW the 140 °F food-safety floor
     * - so the fixture pushes the core above it. That floor is why this fixture
     * had to change: the earlier version relied on a final-approach exemption
     * that let a pause be offered at ~100 °F core, which was wrong.
     */
    const result = generateRecommendation(paramsWithDial(200, {
      readings: makeReadings([120, 140, 152]),
      pullTempF: 175,
      scheduleVarianceMinutes: -40,
      ovenEvents: [
        makeOvenEvent({ setTemp: 175, timestamp: '2024-01-01T17:00:00.000Z' }),
        makeOvenEvent({ setTemp: 200, timestamp: '2024-01-01T17:55:00.000Z' })
      ]
    }));

    expect(result.action).toBe('oven-off');
    expect(result.ovenOffMinutes).toBe(20);
    // Restart at what the dial says now, not at the setting it was measured on
    expect(result.suggestedTemp).toBe(200);
    expect(result.awaitingEffect).toBe(true);
  });
});
