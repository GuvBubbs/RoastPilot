import { describe, it, expect } from 'vitest';
import {
  advance,
  projectToTarget,
  cookStartISO,
  buildTimeline,
  fitThermalModel,
  clearFitCache,
  kPrior,
  assessRateAgreement,
  assessDeadTimeGate,
  confidenceFromFit,
  instantaneousRate,
  CONFIDENCE_BANDS,
  PROJECTION_HORIZON_MINUTES,
  AMBIENT_F
} from './thermalModel.js';

/**
 * Integrate minute by minute and report when the core first reaches the target,
 * and the highest core temperature it sees. This is the ground truth the
 * projection is checked against: `advance` is itself verified against a
 * fine-grained Euler integration elsewhere, so stepping it in one-minute
 * increments is an independent read on `projectToTarget`'s root finding.
 */
function integrateToTarget(state, setPointF, k, targetF) {
  let firstCrossingMinutes = null;
  let peakCoreF = state.coreF;
  for (let minutes = 1; minutes <= PROJECTION_HORIZON_MINUTES; minutes += 1) {
    const { coreF } = advance(state, { minutes, setPointF }, k);
    if (firstCrossingMinutes === null && coreF >= targetF) firstCrossingMinutes = minutes;
    peakCoreF = Math.max(peakCoreF, coreF);
  }
  return { firstCrossingMinutes, peakCoreF };
}

describe('projectToTarget', () => {
  const k = 0.008;

  it('finds a crossing the oven set point alone says is impossible', () => {
    // The dial has come down to 190 °F against a 195 °F target, but the roast's
    // surface is still holding 320 °F from the hotter oven before it. That stored
    // heat carries the core past the target and well past the set point.
    const state = { ovenF: 350, surfaceF: 320, coreF: 170 };
    const truth = integrateToTarget(state, 190, k, 195);
    expect(truth.firstCrossingMinutes).toBeCloseTo(24, 0);
    expect(truth.peakCoreF).toBeGreaterThan(230);

    const projection = projectToTarget({ state, k, setPointF: 190, targetF: 195 });

    // The regression this pins: the projection used to compare the target against
    // the set point and return `unreachable` without integrating anything, so the
    // app advised raising the oven on a roast about to overshoot by 40 °F.
    expect(projection.reason).toBeNull();
    expect(projection.minutes).toBeCloseTo(24, 0);
  });

  it('reports unreachable only when no stored heat can carry the core there', () => {
    // Same set point and target, but the roast is in thermal equilibrium with the
    // oven - there is no stored heat, so 195 °F genuinely never arrives.
    const state = { ovenF: 190, surfaceF: 188, coreF: 170 };
    const truth = integrateToTarget(state, 190, k, 195);
    expect(truth.firstCrossingMinutes).toBeNull();

    const projection = projectToTarget({ state, k, setPointF: 190, targetF: 195 });
    expect(projection.minutes).toBeNull();
    expect(projection.reason).toBe('unreachable');
    expect(projection.steadyStateF).toBe(190);
  });

  it('finds the first crossing when the core rises, crosses and falls back', () => {
    // A non-monotone core is exactly what a dial change produces, and it broke the
    // old bracket search: doubling `hi` until the core exceeded the target could
    // step over the window in which it did.
    const state = { ovenF: 300, surfaceF: 290, coreF: 150 };
    const truth = integrateToTarget(state, 160, k, 175);
    expect(truth.firstCrossingMinutes).not.toBeNull();

    const projection = projectToTarget({ state, k, setPointF: 160, targetF: 175 });
    expect(projection.reason).toBeNull();
    expect(Math.abs(projection.minutes - truth.firstCrossingMinutes)).toBeLessThan(6);

    // And the crossing it found is the FIRST one - after the peak the core falls
    // back below the target, so a later root would be the wrong answer entirely.
    const later = advance(state, { minutes: PROJECTION_HORIZON_MINUTES, setPointF: 160 }, k);
    expect(later.coreF).toBeLessThan(175);
  });

  it('coasts to the target on a switched-off oven', () => {
    const state = { ovenF: 250, surfaceF: 240, coreF: 190 };
    const truth = integrateToTarget(state, null, k, 195);
    expect(truth.firstCrossingMinutes).not.toBeNull();

    const projection = projectToTarget({ state, k, setPointF: null, targetF: 195 });
    expect(projection.reason).toBeNull();
    expect(Math.abs(projection.minutes - truth.firstCrossingMinutes)).toBeLessThan(6);
    expect(projection.steadyStateF).toBe(AMBIENT_F);
  });

  it('reports unreachable on a switched-off oven with nothing left to give', () => {
    const state = { ovenF: 200, surfaceF: 180, coreF: 150 };
    const projection = projectToTarget({ state, k, setPointF: null, targetF: 195 });
    expect(projection.minutes).toBeNull();
    expect(projection.reason).toBe('unreachable');
  });

  it('distinguishes beyond-horizon from unreachable', () => {
    // The oven CAN deliver this target, just not inside the horizon. The two
    // refusals must stay distinct because the UI says opposite things about them:
    // `unreachable` tells the cook to raise the dial, `beyond-horizon` to wait.
    const state = { ovenF: 200, surfaceF: 100, coreF: 40 };
    const projection = projectToTarget({ state, k: 0.00002, setPointF: 200, targetF: 195 });
    expect(projection.minutes).toBeNull();
    expect(projection.reason).toBe('beyond-horizon');
  });

  it('returns zero minutes when the target is already met', () => {
    const state = { ovenF: 200, surfaceF: 198, coreF: 196 };
    const projection = projectToTarget({ state, k, setPointF: 200, targetF: 195 });
    expect(projection.minutes).toBe(0);
    expect(projection.reason).toBeNull();
  });
});

describe('the anchor, when the roast went in before anyone measured it', () => {
  const BASE = Date.parse('2026-08-22T12:00:00.000Z');
  const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();

  it('starts the timeline at the oven, not at the first reading', () => {
    const readings = [{ temp: 45, timestamp: at(30) }, { temp: 60, timestamp: at(70) }];
    const ovenEvents = [{ setTemp: 250, timestamp: at(0), isOff: false }];
    expect(cookStartISO(readings, ovenEvents)).toBe(at(0));
  });

  it('falls back to the first reading when nothing precedes it', () => {
    const readings = [{ temp: 45, timestamp: at(0) }];
    expect(cookStartISO(readings, [{ setTemp: 250, timestamp: at(0), isOff: false }]))
      .toBe(at(0));
    expect(cookStartISO(readings, [])).toBe(at(0));
    // An oven event AFTER the first reading is not a head start.
    expect(cookStartISO(readings, [{ setTemp: 250, timestamp: at(10), isOff: false }]))
      .toBe(at(0));
  });

  it('makes a delayed first reading a residual rather than an initial condition', () => {
    const readings = [
      { temp: 45, timestamp: at(30) },
      { temp: 60, timestamp: at(70) },
      { temp: 78, timestamp: at(110) }
    ];
    const ovenEvents = [{ setTemp: 250, timestamp: at(0), isOff: false }];

    const anchored = buildTimeline(readings, ovenEvents, at(110), at(0));
    expect(anchored.marks.filter((m) => m.kind === 'reading')).toHaveLength(3);

    // With no head start the first reading states the initial condition, exactly
    // as it always did.
    const flush = buildTimeline(readings, ovenEvents, at(110), at(30));
    expect(flush.marks.filter((m) => m.kind === 'reading')).toHaveLength(2);
  });

  it('stops the head start from inverting the fitted rate', () => {
    /**
     * The defect this exists for. The pre-reading minutes under a hot dial were
     * never integrated, so the model believed the roast entered the oven at the
     * first reading with its surface and core equal. The only way to explain the
     * rise that followed without that stored gradient is to inflate k - so the
     * projection ran fast, said "early", and advised LOWERING a roast that was
     * late.
     *
     * Here the same three observations are presented twice against the same oven
     * history: once as a cook that started when the readings did, and once as one
     * whose oven had been on for half an hour first. The second is a slower roast
     * - the core is further along than its own readings suggest - so its fitted k
     * must come out LOWER, not higher.
     */
    const ovenEvents = [{ setTemp: 250, timestamp: at(0), isOff: false }];
    const readings = [
      { temp: 45, timestamp: at(30) },
      { temp: 62, timestamp: at(70) },
      { temp: 82, timestamp: at(110) }
    ];
    const prior = kPrior({ weightLb: 14, meatType: 'Pork Shoulder' });

    clearFitCache();
    const withHeadStart = fitThermalModel({ readings, ovenEvents, prior });
    clearFitCache();
    const withoutHeadStart = fitThermalModel({
      readings,
      // The same dial, declared at the first reading instead of half an hour
      // earlier: no head start to account for.
      ovenEvents: [{ setTemp: 250, timestamp: at(30), isOff: false }],
      prior
    });

    expect(withHeadStart.k).toBeLessThan(withoutHeadStart.k);
    // And the head-start fit sees one more observation, because its first reading
    // is something to explain rather than a free initial condition.
    expect(withHeadStart.residuals.length).toBe(withoutHeadStart.residuals.length + 1);
  });
});

describe('the dead-time gate, against a bad first reading', () => {
  const BASE = Date.parse('2026-08-22T12:00:00.000Z');
  const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();
  const mk = (temps) => temps.map((temp, i) => ({ temp, timestamp: at(i * 25) }));
  const gate = (temps, pullTempF) =>
    assessDeadTimeGate({ readings: mk(temps), k: 0.011, pullTempF });

  it('is not shut for the whole cook by one spurious reading', () => {
    /**
     * The rise and progress tests measured from readings[0], so a probe resting
     * against the pan on the first reading was permanently fatal: with 48/60/72/84
     * the gate opens, and with 150/60/72/84 it shuts on `insufficient-rise` (rise
     * -66 F) and never reopens however many honest readings follow. The app said
     * "The core has barely moved. Check the probe is seated in the thickest part."
     * for the whole cook - blaming the probe for the one reading it got right.
     */
    expect(gate([48, 60, 72, 84], 121).passed).toBe(true);
    expect(gate([150, 60, 72, 84], 121).passed).toBe(true);
  });

  it('still shuts on a roast that genuinely has not moved', () => {
    // The case the gate exists for: a probe in the air, or one that fell out.
    const shut = gate([48, 49, 50, 51], 121);
    expect(shut.passed).toBe(false);
    expect(shut.code).toBe('insufficient-rise');
  });

  it('still shuts on a cook that is genuinely too young', () => {
    const shut = gate([48, 52, 56, 60], 195);
    expect(shut.passed).toBe(false);
    expect(shut.code).toBe('insufficient-progress');
  });

  it('says what is wrong when the target is below every reading', () => {
    /**
     * The old arithmetic gave `progress: -1.29` here and reported
     * `insufficient-progress` - "too early in the cook" about a roast 64 degrees
     * PAST its target. A negative denominator was a permanent lock.
     */
    const shut = gate([148, 160, 172, 184], 120);
    expect(shut.passed).toBe(false);
    expect(shut.code).toBe('target-below-readings');
  });
});

describe('assessRateAgreement', () => {
  const BASE = Date.parse('2026-08-22T12:00:00.000Z');
  const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();
  const readingsAt = (temps) => temps.map((temp, i) => ({ temp, timestamp: at(i * 25) }));

  it('refuses when the roast has stalled and the model has not', () => {
    /**
     * The overnight shoulder, in miniature. The model's rate comes from the
     * surface-to-core gradient and says the core should be climbing; the readings
     * say it has stopped. Extrapolating the model through that produced errors of
     * 330 minutes in the EARLY direction, so the app offered to lower the oven on
     * a roast that finished two hours late.
     */
    const anchorState = { ovenF: 225, surfaceF: 210, coreF: 155 };
    expect(instantaneousRate(anchorState, 0.007)).toBeGreaterThan(20);

    const check = assessRateAgreement({
      readings: readingsAt([154.5, 154.8, 155.0]),
      ovenEvents: [{ setTemp: 225, timestamp: at(-10), isOff: false }],
      anchorState,
      k: 0.007
    });
    expect(check.agrees).toBe(false);
    expect(check.code).toBe('rate-disagrees');
  });

  it('agrees when the readings and the model tell the same story', () => {
    const anchorState = { ovenF: 225, surfaceF: 190, coreF: 120 };
    const modelRate = instantaneousRate(anchorState, 0.007);
    // Readings climbing at roughly the modelled rate.
    const perReading = (modelRate / 60) * 25;
    const check = assessRateAgreement({
      readings: readingsAt([120 - 2 * perReading, 120 - perReading, 120]),
      ovenEvents: [{ setTemp: 225, timestamp: at(-10), isOff: false }],
      anchorState,
      k: 0.007
    });
    expect(check.agrees).toBe(true);
    expect(check.code).toBeNull();
  });

  it('does not fire on a roast climbing FASTER than modelled', () => {
    // That is the ordinary state just after the oven comes up, and the settling
    // machinery owns it. Refusing here would silence every dial change.
    const anchorState = { ovenF: 300, surfaceF: 200, coreF: 120 };
    const check = assessRateAgreement({
      readings: readingsAt([90, 105, 120]),
      ovenEvents: [{ setTemp: 300, timestamp: at(-10), isOff: false }],
      anchorState,
      k: 0.007
    });
    expect(check.agrees).toBe(true);
  });

  it('declines to judge a window that straddles a dial change', () => {
    /**
     * The window would be describing two different ovens, and its slope a blend of
     * both. Without this every raise looks like a roast that has suddenly slowed,
     * because the observed slope is still the old oven's.
     */
    const check = assessRateAgreement({
      readings: readingsAt([154.5, 154.8, 155.0]),
      ovenEvents: [
        { setTemp: 225, timestamp: at(-10), isOff: false },
        { setTemp: 300, timestamp: at(30), isOff: false }
      ],
      anchorState: { ovenF: 300, surfaceF: 260, coreF: 155 },
      k: 0.007
    });
    expect(check.agrees).toBe(true);
    expect(check.code).toBe('not-assessable');
  });

  it('ignores a disagreement too small to be more than probe noise', () => {
    // A probe carrying half a degree of noise across a 50-minute window is worth
    // about 1.6 F/hr of slope on its own.
    const anchorState = { ovenF: 200, surfaceF: 196, coreF: 194 };
    expect(instantaneousRate(anchorState, 0.007)).toBeLessThan(4);
    const check = assessRateAgreement({
      readings: readingsAt([193.9, 193.9, 194.0]),
      ovenEvents: [{ setTemp: 200, timestamp: at(-10), isOff: false }],
      anchorState,
      k: 0.007
    });
    expect(check.agrees).toBe(true);
  });
});

describe('confidenceFromFit', () => {
  it('caps a large residual at low confidence rather than refusing', () => {
    /**
     * It used to return `insufficient` above 12 F, which silenced the app. The
     * residual describes the PAST: the shoulder's stall is permanently in it and
     * can never leave, so the app stayed mute for 410 minutes with the serve
     * deadline inside the silence, and was still mute at 194 F on a projection
     * accurate to half an hour. Whether to speak is assessRateAgreement's job now.
     */
    const verdict = confidenceFromFit({ rmsResidual: 30, dof: 8 });
    expect(verdict.level).toBe('low');
    expect(verdict.code).toBe('loose-fit');
  });

  it('still grades a good fit as good', () => {
    expect(confidenceFromFit({ rmsResidual: 1.0, dof: 8 }).level).toBe('high');
    expect(confidenceFromFit({ rmsResidual: 4.0, dof: 8 }).level).toBe('medium');
    expect(confidenceFromFit({ rmsResidual: CONFIDENCE_BANDS.medium + 1, dof: 8 }).level)
      .toBe('low');
  });
});

describe('the fit, against a bad first reading', () => {
  const BASE = Date.parse('2026-08-22T12:00:00.000Z');
  const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();

  it('takes its starting temperature from the coldest reading', () => {
    /**
     * The initial temperature is not just another residual - it is the INITIAL
     * CONDITION. A first reading of 150 F told the model the roast began at 150 and
     * then had to explain readings below it, which no value of k can do in a hot
     * oven, so the search ran to the bottom of its bracket: k collapsed from
     * 0.00692 to 0.00035, twenty times too small, and every later residual came out
     * near 100 F. One wrong reading made every other reading look wrong.
     */
    const ovenEvents = [{ setTemp: 225, timestamp: at(-5), isOff: false }];
    const honest = [48, 57, 66, 75, 84, 92];
    const readings = (temps) => temps.map((temp, i) => ({ temp, timestamp: at(i * 25) }));
    const prior = kPrior({ weightLb: 12, meatType: 'Prime Rib' });

    clearFitCache();
    const clean = fitThermalModel({ readings: readings(honest), ovenEvents, prior });
    clearFitCache();
    const poisoned = fitThermalModel({
      readings: readings([150, ...honest.slice(1)]), ovenEvents, prior
    });

    // Within a factor of two of the clean fit, rather than at the bracket floor.
    expect(poisoned.k).toBeGreaterThan(clean.k / 2);
    expect(poisoned.k).toBeLessThan(clean.k * 2);
    // And the whole-history residual still reports the bad reading honestly.
    expect(poisoned.rmsResidual).toBeGreaterThan(10);
  });

  it('lets the recent residual recover as honest readings accumulate', () => {
    const ovenEvents = [{ setTemp: 225, timestamp: at(-5), isOff: false }];
    const prior = kPrior({ weightLb: 12, meatType: 'Prime Rib' });
    const curve = [48, 57, 66, 75, 84, 92, 100, 108, 115];
    const poison = (n) => curve.slice(0, n)
      .map((temp, i) => ({ temp: i === 0 ? 150 : temp, timestamp: at(i * 25) }));

    clearFitCache();
    const early = fitThermalModel({ readings: poison(5), ovenEvents, prior });
    clearFitCache();
    const later = fitThermalModel({ readings: poison(9), ovenEvents, prior });

    // The window has moved past the bad reading, so the number confidence is
    // judged on comes back down while the full history keeps reporting it.
    expect(later.recentRmsResidual).toBeLessThan(early.recentRmsResidual);
    expect(later.recentRmsResidual).toBeLessThan(CONFIDENCE_BANDS.low);
    expect(later.rmsResidual).toBeGreaterThan(CONFIDENCE_BANDS.low);
  });
});
