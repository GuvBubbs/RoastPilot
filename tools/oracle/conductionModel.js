/**
 * A SECOND physics engine, deliberately from a different family.
 *
 * ---
 * THE CIRCULARITY PROBLEM THIS EXISTS TO BREAK
 *
 * The app's projection is a two-lag cascade. The simulation harness's roast is a
 * two-node lumped model, which with its fitted `backReaction: 0` IS a two-lag
 * cascade. Same family, fitted to the same three readings below 92 °F, and every
 * scenario extrapolates from there. Scored on that deck alone the projection
 * looks near-perfect and proves nothing: it would look near-perfect if the
 * physics were wrong in any way both models shared.
 *
 * So the readings here come from 1-D conduction in a solid body, solved on a
 * 120-node grid and validated against the closed-form series solution. The
 * distinction that matters is spectral. A solid body's response to a step at its
 * surface is an INFINITE sum of modes whose decay rates grow as the square of the
 * mode number; a two-lag cascade has one repeated pole. The cascade can
 * approximate the leading behaviour and cannot reproduce the short-time
 * behaviour at all - a solid body's centre stays nearly flat for a real interval
 * after its surface is heated, where the cascade starts moving immediately at
 * second order.
 *
 * ---
 * GEOMETRY IS NOT A DETAIL, AND GETTING IT WRONG ARGUES FOR THE WRONG MODEL
 *
 * This started as a sphere, which is what a plan written before the measurement
 * asked for. Scored against a sphere, the app's two-lag cascade misses badly and
 * a THREE-lag cascade fits three times better - so the sphere argues, quite
 * clearly and quite wrongly, for changing the model.
 *
 * Best cascade length by geometry, rms error of the normalised step response over
 * the 5 %-to-95 % span of the climb:
 *
 *     meat lags     sphere    cylinder    slab
 *         1          13.3 %     11.2 %    8.0 %
 *         2           5.5 %      1.9 %    2.5 %
 *         3           1.8 %      4.4 %    6.1 %
 *
 * A roast is not a sphere. A prime rib, a pork loin, a leg of lamb and a
 * tenderloin are cylinders to a first approximation; a rib roast is closer to a
 * slab. Both want two stages, by a clear margin. The sphere is the outlier -
 * the most compact shape there is, with the most pronounced dead time - and the
 * one real exported cook, a prime rib, agrees with the cylinder: two stages fit
 * it to 0.61 °F where three manage 3.28 °F.
 *
 * So the model takes a geometry. CYLINDER is the primary case, because it is what
 * a roast resembles. SPHERE is kept as a deliberately adversarial one: the
 * projection should degrade gracefully against it rather than clear the same
 * thresholds, and that distinction is worth being able to state.
 *
 * ---
 * THE SCHEME
 *
 * Crank-Nicolson on the 1-D heat equation with a geometry term,
 *
 *     ∂T/∂t = α·(∂²T/∂r² + (m/r)·∂T/∂r),   m = 2 sphere, 1 cylinder, 0 slab
 *
 * with symmetry at the centre and a Robin condition at the surface for convective
 * transfer from the oven. Unconditionally stable and second order in space, so
 * the step size is a matter of cost rather than of stability - which matters,
 * because a twelve-hour cook at an explicit scheme's stable step would be a
 * million steps.
 *
 * The oven's own lag is modelled the same way the app models it, and for the same
 * unavoidable reason: an off event carries a set point of 0, and feeding that to a
 * boundary condition drives the surface toward absolute zero. That much IS
 * shared, and it is shared because it is bookkeeping about what a dial means
 * rather than a claim about heat.
 */

/**
 * The geometry term's exponent, and the characteristic-length divisor for
 * converting a weight into a half-thickness.
 */
export const GEOMETRY = {
  sphere: { m: 2, label: 'sphere' },
  cylinder: { m: 1, label: 'cylinder' },
  slab: { m: 0, label: 'slab' }
};

/** Nodes across the radius. 120 puts the discretisation error well under the °F. */
export const NODES = 120;

/** Integration step, minutes. Stability is not the constraint; accuracy is. */
export const STEP_MINUTES = 0.5;

/**
 * Thermal diffusivity of lean beef, in cm²/min.
 *
 * ~1.4e-3 cm²/s from the food-engineering literature (k ≈ 0.45 W/m·K, ρ ≈ 1050
 * kg/m³, c ≈ 3400 J/kg·K), which is 0.084 cm²/min. Not fitted to anything in this
 * repo - the point of an oracle is that its parameters come from somewhere else.
 */
export const ALPHA_CM2_PER_MIN = 0.084;

/**
 * Surface heat-transfer coefficient as a Biot-like number, dimensionless.
 *
 * h·R/k for a domestic oven with natural convection. Large enough that the
 * surface tracks the oven closely, which is what the app's "thermally thin
 * surface shell" assumption amounts to - so this is the parameter that decides
 * how much the two engines are being asked to agree about.
 */
export const BIOT = 8;

export const TAU_OVEN_HEAT_MIN = 10;
export const TAU_OVEN_COOL_MIN = 45;
export const AMBIENT_F = 70;

/**
 * Characteristic half-thickness of a body of this weight, in cm.
 *
 * Density 1050 kg/m³ throughout.
 *
 *  - sphere:   the radius of a ball of that mass.
 *  - cylinder: the radius of a cylinder of that mass whose length is four times
 *              its diameter, which is a prime rib's rough proportion.
 *  - slab:     half the thickness of a slab of that mass whose face is a square
 *              six times the thickness on a side.
 *
 * The proportions matter because they set the absolute time scale, and the time
 * scale is what the projection is being scored on. They are stated here as
 * assumptions rather than buried as constants.
 */
export function radiusForWeightCm(weightLb, geometry = 'cylinder') {
  const cm3 = (weightLb * 453.592) / 1.05;
  if (geometry === 'sphere') return Math.cbrt((3 * cm3) / (4 * Math.PI));
  if (geometry === 'slab') {
    // volume = (6h)·(6h)·(2h) = 72h³
    return Math.cbrt(cm3 / 72);
  }
  /**
   * cylinder: volume = pi·r²·(3r) = 3·pi·r³, i.e. length = 1.5 diameters.
   *
   * It was 8r - length four times the diameter - which for a 6 lb roast is 3.7 in
   * across and 14.8 in long. That is a tenderloin. A bone-in prime rib of that
   * weight is about 5 in across and 8 in long, and the difference is not cosmetic:
   * the conduction length is the radius, so a wrong aspect ratio is a wrong roast
   * at the same weight, and every error figure this oracle certifies is measured
   * on it.
   *
   * Against the repo's one real instrumented cook - a 6 lb bone-in prime rib from
   * 46.4 F, replayed through its actual dial history of 212 then 266 F - the truth
   * is 59.9 F at +44 min and 91.9 F at +89:
   *
   *   L/D    radius    dimensions        +44 min   +89 min
   *   4.0    4.69 cm   3.7 in x 14.8 in      94.4     167.7
   *   1.5    6.50 cm   5.1 in x  7.7 in      56.5     100.5
   *
   * 1.5 is chosen from what a rib roast measures, not fitted to that cook - the
   * agreement is corroboration, and it has to be, or this stops being an
   * independent engine and becomes a second copy of the app's calibration.
   *
   * The solver is 1-D radial, so it still ignores heat entering through the ends.
   * At this aspect ratio that is no longer negligible, and it biases the oracle
   * SLOW - which is the safe direction for something used as a hard target.
   */
  return Math.cbrt(cm3 / (3 * Math.PI));
}

/**
 * Solve a tridiagonal system in place (Thomas algorithm).
 *
 * @param {Float64Array} a - Sub-diagonal, a[0] unused
 * @param {Float64Array} b - Diagonal
 * @param {Float64Array} c - Super-diagonal, c[n-1] unused
 * @param {Float64Array} d - Right-hand side; overwritten with the solution
 */
function solveTridiagonal(a, b, c, d) {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);

  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }

  d[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) d[i] = dp[i] - cp[i] * d[i + 1];
  return d;
}

/**
 * Create a sphere at a uniform temperature.
 *
 * @param {Object} options
 * @param {number} options.weightLb
 * @param {number} options.startCoreF
 * @param {number|null} options.ovenSetF - null means the oven is off
 * @returns {Object} The oracle, exposing the same five methods the driver uses
 */
export function createConductionModel({
  weightLb = 6,
  geometry = 'cylinder',
  startCoreF = 48,
  ovenSetF = 200,
  nodes = NODES,
  step = STEP_MINUTES,
  alpha = ALPHA_CM2_PER_MIN,
  biot = BIOT,
  probeBiasF = 0,
  probeNoiseF = 0,
  seed = 1,
  /**
   * Pin the surface to the oven temperature instead of coupling it through the
   * Biot number.
   *
   * Exists for one purpose: the analytic series solution is derived for a surface
   * HELD at a step temperature, so validating the solver against it needs that
   * exact boundary condition. Approximating it with an enormous Biot number does
   * not work - at 1e7 the Robin row's coefficients differ by seven orders of
   * magnitude and the surface node itself loses all its significant digits (it
   * came out at 51 °F against a 200 °F oven, while the interior stayed correct
   * because its neighbour pinned it). A Dirichlet condition is both exact and
   * simpler than the thing it replaces.
   */
  heldSurface = false
} = {}) {
  const shape = GEOMETRY[geometry];
  if (!shape) throw new Error(`Unknown geometry: ${geometry}`);
  const radius = radiusForWeightCm(weightLb, geometry);
  const dr = radius / (nodes - 1);
  // Temperature at each node, node 0 the centre and node nodes-1 the surface.
  const T = new Float64Array(nodes).fill(startCoreF);

  // Deterministic PRNG, same generator the harness uses: a scenario that cannot
  // be replayed exactly cannot be triaged.
  let randState = seed >>> 0;
  const rand = () => {
    randState = (randState + 0x6d2b79f5) >>> 0;
    let t = randState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const bias = probeBiasF === 0 ? 0 : (rand() * 2 - 1) * probeBiasF;

  const model = {
    t: 0,
    ovenBaseF: ovenSetF === null ? AMBIENT_F : ovenSetF,
    ovenSetF: ovenSetF === null ? AMBIENT_F : ovenSetF,
    ovenOff: ovenSetF === null,
    probeBiasF: bias,
    radiusCm: radius,
    geometry,

    get coreF() { return T[0]; },
    get surfaceF() { return T[nodes - 1]; },
    get ovenEffectiveF() { return model.ovenBaseF; },

    /** The whole radial profile, for the fixtures. */
    profile() { return Array.from(T); },

    setOven(setF) {
      if (setF === null || setF === 0) {
        model.ovenOff = true;
      } else {
        model.ovenOff = false;
        model.ovenSetF = setF;
      }
    },

    setOvenOff() { model.ovenOff = true; },

    probeF() {
      const noise = probeNoiseF === 0 ? 0 : (rand() * 2 - 1) * probeNoiseF;
      return T[0] + bias + noise;
    },

    /** Advance by `minutes`, in Crank-Nicolson steps. */
    step(minutes) {
      let remaining = minutes;
      while (remaining > 1e-9) {
        const dt = Math.min(step, remaining);
        model.t += dt;

        // The oven's own first-order lag toward the dial.
        const ovenTarget = model.ovenOff ? AMBIENT_F : model.ovenSetF;
        const tau = model.ovenOff ? TAU_OVEN_COOL_MIN : TAU_OVEN_HEAT_MIN;
        model.ovenBaseF += (ovenTarget - model.ovenBaseF) * (1 - Math.exp(-dt / tau));

        crankNicolsonStep(T, nodes, dr, dt, alpha, biot, model.ovenBaseF, heldSurface, shape.m);
        remaining -= dt;
      }
    }
  };

  return model;
}

/**
 * One Crank-Nicolson step on ∂u/∂t = α·∂²u/∂r², u = r·T.
 *
 * Node 0 (the centre) is handled by the symmetry condition ∂T/∂r = 0 rather than
 * through u, because u(0) = 0 identically and the centre temperature has to come
 * out of a one-sided form.
 */
function crankNicolsonStep(T, n, dr, dt, alpha, biot, ovenF, heldSurface = false, m = 1) {
  const lambda = (alpha * dt) / (2 * dr * dr);

  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);

  // --- Centre: symmetry gives ∂T/∂t = (m+1)·α·∂²T/∂r² as r -> 0 --------------
  // The (m+1) is the limit of the (m/r)·∂T/∂r term at the origin: 3 for a
  // sphere, 2 for a cylinder, 1 for a slab. Getting it wrong is the classic
  // error in this scheme, and it shows up as a centre heating at a fraction of
  // the right rate - which looks plausible rather than broken.
  const centre = 2 * (m + 1) * lambda;
  b[0] = 1 + centre;
  c[0] = -centre;
  d[0] = (1 - centre) * T[0] + centre * T[1];

  // --- Interior --------------------------------------------------------------
  for (let i = 1; i < n - 1; i++) {
    const r = i * dr;
    // Central differences for both the second derivative and the (m/r) term.
    const west = lambda * (1 - (m * dr) / (2 * r));
    const east = lambda * (1 + (m * dr) / (2 * r));
    a[i] = -west;
    b[i] = 1 + west + east;
    c[i] = -east;
    d[i] = west * T[i - 1] + (1 - west - east) * T[i] + east * T[i + 1];
  }

  if (heldSurface) {
    // --- Surface: Dirichlet, T = Toven ------------------------------------
    a[n - 1] = 0;
    b[n - 1] = 1;
    c[n - 1] = 0;
    d[n - 1] = ovenF;
  } else {
    // --- Surface: Robin condition -k·∂T/∂r = h·(T - Toven) ----------------
    // Expressed through the Biot number: dr·h/k = biot·dr/R = biot/(n-1).
    const h = biot / (n - 1);
    a[n - 1] = -2 * lambda;
    b[n - 1] = 1 + 2 * lambda * (1 + h);
    c[n - 1] = 0;
    d[n - 1] = (1 - 2 * lambda * (1 + h)) * T[n - 1]
      + 2 * lambda * T[n - 2]
      + 4 * lambda * h * ovenF;
  }

  solveTridiagonal(a, b, c, d);
  for (let i = 0; i < n; i++) T[i] = d[i];
}

/**
 * Back-compatible alias. The original file was sphere-only; the geometry turned
 * out to matter enough that it is now a parameter, with `cylinder` the default
 * because that is what a roast is.
 */
export function createSphereModel(options = {}) {
  return createConductionModel({ ...options, geometry: 'sphere' });
}
