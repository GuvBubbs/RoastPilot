/**
 * Is the oracle itself right?
 *
 * An independent engine is only worth having if it is correct, and "it agrees
 * roughly with the model it is checking" is not evidence of that - it is the
 * circularity this whole directory exists to break, restated.
 *
 * So every geometry the solver supports is checked against its own closed-form
 * series solution for a body with its surface held at a step temperature. All
 * three are textbook and derived from nothing in this repository:
 *
 *   sphere    Σ 2·(-1)^(n+1)·exp(-n²π²·Fo)
 *   cylinder  Σ (2/(βn·J1(βn)))·exp(-βn²·Fo),  βn the roots of J0
 *   slab      Σ (4/((2n-1)π))·(-1)^(n+1)·exp(-((2n-1)π/2)²·Fo)
 *
 * The cylinder is the one that matters most: it is the geometry a roast actually
 * has, and the one the projection is scored against.
 */
import { describe, it, expect } from 'vitest';
import {
  createConductionModel,
  radiusForWeightCm,
  ALPHA_CM2_PER_MIN,
  AMBIENT_F,
  GEOMETRY
} from './conductionModel.js';

/** Roots of J0 and the matching J1 values, for the cylinder series. */
const CYLINDER_ROOTS = [
  2.404826, 5.520078, 8.653728, 11.791534, 14.930918, 18.071064, 21.211637, 24.352472
];
const CYLINDER_COEFFS = [
  1.601974, -1.064780, 0.851375, -0.729626, 0.648504, -0.589538, 0.543846, -0.507007
];

/** Fraction of the climb REMAINING at the centre, per geometry. */
const REMAINING = {
  sphere: (Fo) => {
    let sum = 0;
    for (let n = 1; n <= 400; n++) {
      sum += (-1) ** (n + 1) * Math.exp(-n * n * Math.PI * Math.PI * Fo);
    }
    return 2 * sum;
  },
  cylinder: (Fo) => CYLINDER_ROOTS.reduce(
    (sum, root, i) => sum + CYLINDER_COEFFS[i] * Math.exp(-root * root * Fo), 0
  ),
  slab: (Fo) => {
    let sum = 0;
    for (let n = 1; n <= 200; n++) {
      const lambda = ((2 * n - 1) * Math.PI) / 2;
      sum += (4 / ((2 * n - 1) * Math.PI)) * (-1) ** (n + 1) * Math.exp(-lambda * lambda * Fo);
    }
    return sum;
  }
};

/** Centre temperature of a body whose surface is held at Ts from t = 0. */
function analyticCentre(T0, Ts, Fo, geometry = 'sphere') {
  return Ts + (T0 - Ts) * REMAINING[geometry](Fo);
}

/**
 * The analytic case: surface held at a step temperature, no oven lag. A Dirichlet
 * boundary rather than a huge Biot number - see the note on `heldSurface` in the
 * model.
 */
function held(t, {
  weightLb = 6, geometry = 'sphere', startCoreF = 48, surfaceF = 200, step = 0.1
} = {}) {
  const model = createConductionModel({
    weightLb, geometry, startCoreF, ovenSetF: surfaceF, step, heldSurface: true
  });
  model.ovenBaseF = surfaceF;
  model.step(t);
  return model;
}

describe('the Crank-Nicolson conduction solver', () => {
  it('matches the analytic series at the centre, in every geometry', () => {
    // The cylinder is the case that matters - it is what the projection is scored
    // against - but a solver that is right for one geometry and wrong for another
    // is a solver whose geometry term is wrong, so all three are checked.
    for (const geometry of Object.keys(GEOMETRY)) {
      const R = radiusForWeightCm(6, geometry);
      for (const t of [30, 60, 120, 180, 240, 360, 480]) {
        const Fo = (ALPHA_CM2_PER_MIN * t) / (R * R);
        const expected = analyticCentre(48, 200, Fo, geometry);
        const actual = held(t, { geometry }).coreF;
        expect(Math.abs(actual - expected), `${geometry}, t = ${t} min, Fo = ${Fo.toFixed(4)}`)
          .toBeLessThan(0.15);
      }
    }
  });

  it('gets the geometry term right, not just the shape of the curve', () => {
    /**
     * The three geometries must NOT agree. If they did, the (m/r)·∂T/∂r term
     * would be doing nothing and the solver would be a slab solver wearing three
     * labels - which would still pass a single-geometry check against a
     * time-rescaled series, because the shapes are similar.
     *
     * Compared at equal Fourier number, so the weight-to-radius conversion cannot
     * account for the difference.
     */
    const Fo = 0.15;
    const centres = Object.keys(GEOMETRY).map((geometry) => {
      const R = radiusForWeightCm(6, geometry);
      const t = (Fo * R * R) / ALPHA_CM2_PER_MIN;
      return { geometry, core: held(t, { geometry }).coreF };
    });
    // At equal Fo a sphere is furthest along (heat enters from every direction),
    // then a cylinder, then a slab.
    expect(centres[0].core).toBeGreaterThan(centres[1].core);
    expect(centres[1].core).toBeGreaterThan(centres[2].core);
  });

  it('gets the factor of three at the origin right', () => {
    /**
     * The classic error in this scheme. As r -> 0 the (2/r)·∂T/∂r term has the
     * limit 2·∂²T/∂r², so the centre obeys ∂T/∂t = 3α·∂²T/∂r². Using α instead of
     * 3α gives a centre that heats at a third of the correct rate, which looks
     * plausible - a roast with a lot of dead time - and is wrong.
     *
     * Checked at a short time, where the centre's behaviour is governed almost
     * entirely by that coefficient.
     */
    const R = radiusForWeightCm(6, 'sphere');
    const t = 45;
    const Fo = (ALPHA_CM2_PER_MIN * t) / (R * R);
    expect(held(t, { geometry: 'sphere' }).coreF)
      .toBeCloseTo(analyticCentre(48, 200, Fo, 'sphere'), 1);
  });

  it('converges with the step size, and is accurate at the default', () => {
    /**
     * Crank-Nicolson is unconditionally STABLE, not exact - a coarse step is a
     * wrong answer rather than a divergent one, which is the failure mode worth
     * pinning. Stability is what makes the scheme usable at all here: a
     * twelve-hour cook at an explicit scheme's stable step would be a million
     * steps.
     *
     * Measured against the analytic solution at t = 180 min:
     *
     *     step (min)   error (°F)
     *        4.0         -0.89
     *        2.0         -0.45
     *        1.0         -0.22
     *        0.5         -0.11     <- the default
     *        0.25        -0.06
     *        0.05        -0.01
     *
     * Halving the step halves the error, and the default is fifteen times inside
     * the probe's own noise - so the oracle's discretisation cannot be mistaken
     * for a disagreement with the app's model.
     */
    const R = radiusForWeightCm(6, 'sphere');
    const truth = analyticCentre(48, 200, (ALPHA_CM2_PER_MIN * 180) / (R * R), 'sphere');

    const errorAt = (step) =>
      Math.abs(held(180, { geometry: 'sphere', step }).coreF - truth);

    expect(errorAt(0.5)).toBeLessThan(0.2);
    // Second-order in space, first-order-limited in time by the boundary
    // treatment: halving the step must roughly halve the error, not leave it.
    expect(errorAt(0.5)).toBeLessThan(errorAt(1) * 0.75);
    expect(errorAt(4)).toBeLessThan(1.5);
  });

  it('has a real dead time at the centre, which a two-lag cascade does not', () => {
    /**
     * The spectral difference, stated as a number. A sphere's step response is an
     * infinite sum of modes decaying as n², and their cancellation holds the
     * centre exactly flat for a genuine interval. A two-lag cascade has one
     * repeated pole and starts moving immediately, at second order.
     *
     * This is the hardest thing about the oracle for the app's model to fit, and
     * therefore the reason it is worth fitting against.
     */
    const early = held(20).coreF;
    expect(early - 48).toBeLessThan(0.5);
    // ...and then it moves in earnest.
    expect(held(120).coreF - 48).toBeGreaterThan(50);
  });

  it('keeps the radial profile monotone and inside the boundary temperatures', () => {
    // At the REALISTIC Biot number, which is the condition every other consumer
    // of this model runs under.
    const model = createConductionModel({ weightLb: 6, startCoreF: 48, ovenSetF: 200 });
    model.ovenBaseF = 200;
    model.step(150);
    const profile = model.profile();
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i], `node ${i}`).toBeGreaterThanOrEqual(profile[i - 1] - 1e-9);
    }
    expect(profile[0]).toBeGreaterThan(48);
    expect(profile[profile.length - 1]).toBeLessThanOrEqual(200.001);
  });

  it('cools toward ambient with the oven off', () => {
    const model = createConductionModel({ weightLb: 6, startCoreF: 48, ovenSetF: 200 });
    model.step(180);
    const hot = model.coreF;
    model.setOvenOff();
    model.step(600);
    expect(model.coreF).toBeLessThan(hot);
    expect(model.coreF).toBeGreaterThan(AMBIENT_F - 1);
  });

  it('scales with weight the way a solid body does', () => {
    // Time to a given Fourier number goes as R², and R goes as weight^(1/3), so
    // the time to a fixed fraction of the climb goes as weight^(2/3). Eight times
    // the weight is four times the time. This is the relation the app's own
    // weight-scaled prior on k assumes, so it is worth checking independently.
    const target = 100;
    const timeTo = (weightLb) => {
      const model = createConductionModel({
        weightLb, startCoreF: 48, ovenSetF: 200, heldSurface: true
      });
      model.ovenBaseF = 200;
      let t = 0;
      while (model.coreF < target && t < 5000) { model.step(1); t += 1; }
      return t;
    };
    const ratio = timeTo(48) / timeTo(6);
    expect(ratio).toBeGreaterThan(3.6);
    expect(ratio).toBeLessThan(4.4);
  });
});
