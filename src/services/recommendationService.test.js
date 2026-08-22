import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRecommendationEligibility,
  calculateRecommendation,
  generateRecommendation,
  analyzeOvenResponsiveness
} from './recommendationService.js';
import { createDefaultSettings } from '../models/dataModels.js';

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

  it('blocks when the oven temperature is stale', () => {
    const result = checkRecommendationEligibility({
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent({ timestamp: '2024-01-01T14:00:00.000Z' })],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings(),
      confidence: highConfidence
    });

    expect(result.canRecommend).toBe(false);
    expect(result.blockerType).toBe('stale_oven_data');
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

  it('blocks on insufficient, slow and unstable confidence', () => {
    const base = {
      readings: makeReadings([100, 105, 110]),
      ovenEvents: [makeOvenEvent()],
      desiredServeTime: '2024-01-01T20:00:00.000Z',
      settings: createDefaultSettings()
    };

    expect(checkRecommendationEligibility({
      ...base,
      confidence: { level: 'insufficient', reason: 'Not enough readings' }
    }).blockerType).toBe('insufficient_confidence');

    expect(checkRecommendationEligibility({
      ...base,
      confidence: { level: 'low', reason: 'Heating rate is slow or negative' }
    }).blockerType).toBe('bad_rate');

    expect(checkRecommendationEligibility({
      ...base,
      confidence: { level: 'low', reason: 'Readings are fluctuating' }
    }).blockerType).toBe('unstable_rate');
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

  it('suggests pausing when the oven is already at the practical minimum', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: 120,
      currentRate: 10
    });

    expect(result.action).toBe('oven-off');
    // Half of the 40-minute variance, clamped to the 5-45 minute range
    expect(result.ovenOffMinutes).toBe(20);
    expect(result.alternativeMessage).toContain('{minutes}');
    expect(result.severity).toBe('moderate');
  });

  it('suggests pausing instead of a low temperature when low temps are disabled', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 180,
      scheduleVarianceMinutes: -40,
      scheduleStatus: 'early',
      settings: { ...settings, enableLowTempRecommendations: false },
      predictedMinutesToTarget: 120,
      currentRate: 10
    });

    expect(result.action).toBe('oven-off');
    expect(result.practicalMinF).toBe(175);
    expect(result.message).toContain('{minTemp}');
  });

  it('falls back to a simple pause heuristic without prediction data', () => {
    const result = calculateRecommendation({
      ovenBaseTemp: 175,
      scheduleVarianceMinutes: -50,
      scheduleStatus: 'early',
      settings,
      predictedMinutesToTarget: null,
      currentRate: null
    });

    // 50 * 0.4 = 20, within the 5-30 minute fallback range
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
      targetTemp: 125,
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

    it('resumes normal recommendations once a post-pause reading exists', () => {
      const result = generateRecommendation(baseParams({
        readings: makeReadings([100, 108, 116], { endISO: NOW }),
        ovenEvents: [
          makeOvenEvent({ timestamp: '2024-01-01T15:00:00.000Z' }),
          makeOvenEvent({ setTemp: 0, isOff: true, timestamp: pauseStart, previousTemp: 225 })
        ],
        scheduleStatus: 'late',
        scheduleVarianceMinutes: 12
      }));

      expect(result.action).toBe('raise');
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

    it('emits the same field set for every branch', () => {
      const expectedKeys = [
        'action',
        'suggestedTemp',
        'changeAmount',
        'message',
        'reasoning',
        'alternativeMessage',
        'ovenOffMinutes',
        'practicalMinF',
        'latestReadingTemp',
        'severity',
        'canRecommend',
        'blockerReason',
        'blockerType',
        'progress'
      ];

      const results = [
        generateRecommendation(baseParams()),
        generateRecommendation(baseParams({ readings: makeReadings([126]) })),
        generateRecommendation(baseParams({ readings: makeReadings([100, 110]) })),
        generateRecommendation(baseParams({
          readings: makeReadings([100, 108, 116], { endISO: '2024-01-01T17:00:00.000Z' }),
          ovenEvents: [makeOvenEvent({ setTemp: 0, isOff: true, timestamp: '2024-01-01T17:30:00.000Z' })]
        }))
      ];

      for (const result of results) {
        expect(Object.keys(result).sort()).toEqual(expectedKeys.slice().sort());
      }
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

  it('adjusts from the last temperature actually set, not the 0 of an off event', () => {
    // The cook paused, then logged a fresh reading, and is running late. Before
    // the fix this adjusted from currentOvenTemp (0), producing a 25°F set
    // point that the Apply button wrote straight into the oven history.
    const result = generateRecommendation({
      readings,
      ovenEvents: [
        { id: 'o1', setTemp: 225, timestamp: ago(120), previousTemp: null, isOff: false },
        { id: 'o2', setTemp: 0, timestamp: ago(45), previousTemp: 225, isOff: true }
      ],
      ovenBaseTemp: 225,
      targetTemp: 200,
      desiredServeTime: ago(-20),
      scheduleVarianceMinutes: 25,
      scheduleStatus: 'late',
      confidence: { level: 'high', reason: 'good' },
      settings,
      predictedMinutesToTarget: 60,
      currentRate: 20,
      now: NOW
    });

    expect(result.action).toBe('raise');
    expect(result.suggestedTemp).toBeGreaterThan(225);
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
      targetTemp: 200,
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

describe('stale oven data is measured against an injected clock', () => {
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

  it('passes while the oven reading is fresh', () => {
    // 65 min after the oven event but the default threshold is 60... so use a
    // deliberately close-in clock to prove the boundary is the clock, not luck.
    expect(eligibilityAt('2024-01-01T16:30:00.000Z').canRecommend).toBe(true);
  });

  it('blocks once the same data has aged past the threshold', () => {
    // Nothing about the session changed - only `now`. Before the fix this was
    // read from the real clock inside a tick-free computed, so the block never
    // appeared while the app sat idle.
    const later = eligibilityAt('2024-01-01T18:00:00.000Z');
    expect(later.canRecommend).toBe(false);
    expect(later.blockerType).toBe('stale_oven_data');
  });
});
