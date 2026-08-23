import { describe, it, expect } from 'vitest';
import {
  advance,
  projectToTarget,
  cookStartISO,
  buildTimeline,
  fitThermalModel,
  clearFitCache,
  kPrior,
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
