import { describe, it, expect } from 'vitest';
import {
  advance,
  projectToTarget,
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
