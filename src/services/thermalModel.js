/**
 * The projection: two first-order thermal lags in series, with one fitted
 * constant.
 *
 * ---
 * WHY NOT A STRAIGHT LINE
 *
 * The app used to fit a line to the last three readings and extrapolate it. That
 * is wrong in a way that matters most exactly when the app first speaks. Fitting
 * Newton's law of cooling to the two intervals in the one real exported cook
 * gives k = 0.00193 /min and then 0.00378 /min: the roast ACCELERATES. A
 * single-lag model cannot produce that - it predicts a decaying approach to the
 * oven temperature - and a straight line through the flat early limb of that
 * S-curve extrapolates far too late. So the first advice of every cook was
 * confidently wrong in DIRECTION: the app said "running late, raise the oven",
 * and the roast then finished early.
 *
 * The cause is physical. Early on the core is still waiting for the thermal wave
 * to arrive, so its rate is governed by the surface-core gradient opening up, not
 * by (oven - core).
 *
 * ---
 * THE MODEL
 *
 * Three nodes in a cascade, each a first-order lag on the one before it:
 *
 *     dTo/dt = a·(Tset - To)        the oven approaching the dial
 *     dTs/dt = k·(To  - Ts)         a thin surface shell following the oven
 *     dTc/dt = k·(Ts  - Tc)         the core following the shell
 *
 * ONE fitted parameter, k. The two meat constants are equal because that is
 * where the fit lands - calibrate.js's ridge check shows the error rising steeply
 * either side of a ratio of 1 - and it makes the pair a critically damped
 * cascade, whose step response 1 - (1 + kt)e^(-kt) is exactly the
 * accelerate-then-decay shape the real readings show.
 *
 * WHY TWO STAGES AND NOT THREE. Worth recording, because the verification step
 * raised the question and the answer is not obvious. Comparing normalised step
 * responses against the closed-form series solutions for a solid body's centre,
 * over the 5 %-to-95 % span of the climb, rms error against the best time scale:
 *
 *     meat lags     sphere    cylinder    slab
 *         1          13.3 %     11.2 %    8.0 %
 *         2           5.5 %      1.9 %    2.5 %
 *         3           1.8 %      4.4 %    6.1 %
 *         4           3.7 %      5.7 %    8.6 %
 *
 * The best cascade length is a property of the GEOMETRY, and a roast is not a
 * sphere. A prime rib, a pork loin, a leg of lamb and a tenderloin are all
 * cylinders to a first approximation, and a rib roast is closer to a slab; both
 * of those want two stages, and want them by a clear margin. Only a sphere - the
 * most compact shape there is, and the one with the most pronounced dead time -
 * prefers three.
 *
 * The one real exported cook agrees, and it was a prime rib: fitted with two
 * stages its worst residual is 0.61 °F, and with three it is 3.28 °F.
 *
 * So the oracle in tools/oracle scores against a CYLINDER as its primary case,
 * and against a sphere as a deliberately adversarial one. Getting that geometry
 * wrong would have argued the model into being worse.
 *
 * The oven lag is MODELLED rather than assumed away, and not only for accuracy:
 * `setTemp` is 0 for an off event, and feeding 0 °F into the surface node would
 * drive the model toward absolute zero. `a` is fixed, not fitted - a 10 minute
 * time constant heating, 45 minutes cooling, which is the other side of the app's
 * own ovenChangeLagMinutes.
 *
 * The thermostat sawtooth is NOT modelled. It attenuates by roughly 1/2000 per
 * lag stage, so at a 30-45 minute reading cadence it is unobservable, and
 * including it would only give the optimiser noise to chase.
 *
 * ---
 * CLOSED FORM, NOT EULER
 *
 * Every segment between two events is integrated exactly. With Tset constant
 * across a segment, substituting p = Tset - To, q = Tset - Ts and r = Tset - Tc,
 * and writing C = k·p₀/(k - a) and G = (e^((k-a)t) - 1)/(k - a):
 *
 *     p(t) = p₀·e^(-at)
 *     q(t) = q₀·e^(-kt) + C·(e^(-at) - e^(-kt))
 *     r(t) = e^(-kt)·[ r₀ + k·q₀·t + k·C·(G - t) ]
 *
 * A handful of exponentials per segment, no step size, no stability constraint,
 * and no accumulation of integration error over a twelve-hour cook. Checked
 * against a 600,000-step Euler integration and agreeing to 1e-4 °F, which is
 * Euler's own truncation error rather than this one's. The k = a degenerate case
 * is handled separately below.
 */

/**
 * The one calibrated number in the app, and where it comes from.
 *
 * Fitted by tools/sim/calibrate.js against Docs/Reference/roast-session-
 * 2026-08-22.json: two residuals against two free parameters, over 88 minutes,
 * topping out at 92 °F core. That is ZERO degrees of freedom and says nothing
 * about the endgame, which is the part that decides whether dinner is on time.
 * It is used as a PRIOR, not as an answer - see kPrior.
 */
export const K_REFERENCE = 0.010991;

/** Weight the reference constant belongs to, in pounds. */
export const REFERENCE_WEIGHT_LB = 6;

/** Oven time constants, minutes. Fixed, never fitted. */
export const TAU_OVEN_HEAT_MIN = 10;
export const TAU_OVEN_COOL_MIN = 45;

/** Kitchen temperature an oven with the element off decays towards, °F. */
export const AMBIENT_F = 70;

/**
 * The part of the geometry a weight cannot express: a tenderloin and a pork
 * shoulder of equal weight do not heat alike. Keyed by the meat type the session
 * config records.
 */
export const SHAPE_FACTORS = {
  'prime rib': 1.0,
  'beef tenderloin': 1.6,
  'pork loin': 1.25,
  'pork shoulder': 0.85,
  'leg of lamb': 1.1
};

/**
 * Weight to clamp the prior's weight into, in pounds.
 *
 * The weight field says "lbs" and the validator allows 0-100, so a cook who
 * enters kilograms is not stopped. The prior is about 0.1 % of the fit once three
 * readings exist, so the clamp costs nothing and removes an absurd starting
 * point.
 */
export const PRIOR_WEIGHT_BOUNDS = { minLb: 1, maxLb: 40 };

/**
 * Regularisation weight, in °F² per (natural log of k)².
 *
 * Small on purpose. Its job is not to shape the answer - with three readings it
 * contributes about a tenth of a percent of the objective - but to guarantee the
 * fit always RETURNS one. That matters because it moves the entire show/don't-show
 * decision into the gate, where it can be reasoned about, instead of leaving it
 * split between "the optimiser diverged" and "the gate said no".
 */
export const PRIOR_LAMBDA = 0.05;

/**
 * Assumed probe noise, °F, used as the floor for the confidence bands.
 *
 * Derived rather than invented: the harness models a ±0.3 °C per-reading noise
 * and a ±1.5 °C constant placement bias. A constant bias does not inflate the
 * residual of a fit that can absorb it into its own shape, so the floor is set by
 * the per-reading term plus a margin for the readings not landing exactly when
 * they are logged: 1.6 °F.
 */
export const NOISE_FLOOR_F = 1.6;

/**
 * Expected k for a roast of this weight and shape.
 *
 * The constants scale with how far heat has to travel, which is a length, so they
 * go as weight^(-2/3) for a fixed shape.
 *
 * @param {Object} params
 * @param {number|null} [params.weightLb]
 * @param {string|null} [params.meatType]
 * @returns {number} k in per-minute
 */
export function kPrior({ weightLb = null, meatType = null } = {}) {
  const shape = SHAPE_FACTORS[String(meatType ?? '').trim().toLowerCase()] ?? 1.0;
  const weight = Number.isFinite(weightLb)
    ? Math.min(PRIOR_WEIGHT_BOUNDS.maxLb, Math.max(PRIOR_WEIGHT_BOUNDS.minLb, weightLb))
    : REFERENCE_WEIGHT_LB;
  return K_REFERENCE * (REFERENCE_WEIGHT_LB / weight) ** (2 / 3) * shape;
}

/**
 * Advance the cascade exactly across one segment of constant dial setting.
 *
 * @param {{ovenF: number, surfaceF: number, coreF: number}} state
 * @param {Object} segment
 * @param {number} segment.minutes - Segment length
 * @param {number|null} segment.setPointF - Dial setting; null means the oven is off
 * @param {number} k - Fitted meat constant, per minute
 * @returns {{ovenF: number, surfaceF: number, coreF: number}}
 */
export function advance(state, { minutes, setPointF }, k) {
  if (!(minutes > 0)) return { ...state };

  const isOff = setPointF === null || setPointF === undefined;
  const target = isOff ? AMBIENT_F : setPointF;
  const a = 1 / (isOff ? TAU_OVEN_COOL_MIN : TAU_OVEN_HEAT_MIN);

  const p0 = target - state.ovenF;
  const q0 = target - state.surfaceF;
  const r0 = target - state.coreF;

  const t = minutes;
  const ek = Math.exp(-k * t);
  const ea = Math.exp(-a * t);
  const gap = k - a;

  const p = p0 * ea;
  let q;
  let r;

  // The repeated-root case. `a` is fixed at 1/10 or 1/45 per minute and k runs
  // from about 0.003 to 0.06, so a collision is reachable for a small fast roast
  // - and the expressions below divide by (k - a), where a NaN would reach
  // addMinutes and throw out of the whole status panel.
  if (Math.abs(gap) < 1e-9) {
    q = (q0 + k * p0 * t) * ek;
    r = (r0 + k * q0 * t + 0.5 * k * k * p0 * t * t) * ek;
  } else {
    const C = (k * p0) / gap;
    // expm1 rather than exp(x) - 1: for small gap·t the subtraction loses every
    // significant digit, and gap·t IS small whenever k approaches a.
    const G = Math.expm1(gap * t) / gap;
    q = q0 * ek + C * (ea - ek);
    r = ek * (r0 + k * q0 * t + k * C * (G - t));
  }

  return {
    ovenF: target - p,
    surfaceF: target - q,
    coreF: target - r
  };
}

/**
 * Turn a reading and oven-event history into the segment list the model walks.
 *
 * Anchored at the FIRST reading: that is the earliest instant the app knows
 * anything about the meat, and the model's initial state is stated there.
 *
 * @param {Array<{timestamp: string, temp: number}>} readings - Chronological
 * @param {Array<{timestamp: string, setTemp: number, isOff: boolean}>} ovenEvents
 * @param {string} untilISO - Walk the timeline out to here
 * @returns {{startISO: string, marks: Array<Object>}}
 */
export function buildTimeline(readings, ovenEvents, untilISO) {
  const startISO = readings[0].timestamp;
  const start = Date.parse(startISO);
  const at = (iso) => (Date.parse(iso) - start) / 60_000;

  const marks = [];

  for (let i = 1; i < readings.length; i++) {
    marks.push({ minutes: at(readings[i].timestamp), kind: 'reading', temp: readings[i].temp, index: i });
  }
  for (const event of ovenEvents) {
    const minutes = at(event.timestamp);
    // Events before the first reading set the INITIAL dial rather than being a
    // change to walk to; they are folded into initialSetPoint below.
    if (minutes <= 0) continue;
    marks.push({
      minutes,
      kind: 'oven',
      setPointF: event.isOff === true ? null : event.setTemp
    });
  }

  marks.push({ minutes: at(untilISO), kind: 'end' });
  // Oven changes before readings at the same instant: the real cook's pattern is
  // to log a reading and then move the dial, and the reading describes the state
  // before the change.
  marks.sort((x, y) => x.minutes - y.minutes || (x.kind === 'reading' ? -1 : 1));

  return { startISO, marks };
}

/** The dial setting in force at the first reading. */
export function initialSetPoint(readings, ovenEvents) {
  const start = Date.parse(readings[0].timestamp);
  let setPointF = null;
  let found = false;
  for (const event of ovenEvents) {
    if (Date.parse(event.timestamp) > start) break;
    setPointF = event.isOff === true ? null : event.setTemp;
    found = true;
  }
  return { setPointF, found };
}

/**
 * Replay a candidate k through the real oven history.
 *
 * @param {number} k
 * @param {Object} timeline - From buildTimeline
 * @param {Object} initial - { ovenF, surfaceF, coreF }
 * @param {number|null} openingSetPointF
 * @returns {{predicted: number[], state: Object, endState: Object,
 *   stateAtLastReading: Object, setPointF: number|null}}
 */
export function replay(k, timeline, initial, openingSetPointF) {
  let state = { ...initial };
  let setPointF = openingSetPointF;
  let cursor = 0;
  const predicted = [];
  let stateAtLastReading = { ...initial };

  for (const mark of timeline.marks) {
    state = advance(state, { minutes: mark.minutes - cursor, setPointF }, k);
    cursor = mark.minutes;

    if (mark.kind === 'reading') {
      predicted.push(state.coreF);
      stateAtLastReading = { ...state };
    } else if (mark.kind === 'oven') {
      setPointF = mark.setPointF;
    }
  }

  return { predicted, endState: state, stateAtLastReading, setPointF };
}

/**
 * Sum of squared residuals plus the prior penalty.
 *
 * @returns {{objective: number, sse: number, residuals: number[], replayed: Object}}
 */
export function evaluateCandidate(k, timeline, initial, openingSetPointF, actual, prior) {
  const replayed = replay(k, timeline, initial, openingSetPointF);
  let sse = 0;
  const residuals = [];
  for (let i = 0; i < actual.length; i++) {
    const residual = replayed.predicted[i] - actual[i];
    residuals.push(residual);
    sse += residual * residual;
  }
  const penalty = PRIOR_LAMBDA * (Math.log(k) - Math.log(prior)) ** 2;
  return { objective: sse + penalty, sse, residuals, replayed };
}

/** Grid points in the coarse sweep. */
const GRID_POINTS = 48;
/** Golden-section iterations after it. */
const GOLDEN_ITERATIONS = 20;
const INV_PHI = (Math.sqrt(5) - 1) / 2;

/**
 * Fit k to the readings.
 *
 * A 48-point logarithmic sweep spanning a 40x range about the prior, then golden
 * section on the bracketing triple. Sixty-eight replays in total, each a handful
 * of exponentials per segment - under a millisecond for a typical cook.
 *
 * Log-spaced because k is a rate: the interesting question is a factor, not a
 * difference, and a linear grid wastes almost all its points at the fast end.
 *
 * @param {Object} params
 * @param {Array} params.readings - Chronological, at least 2
 * @param {Array} params.ovenEvents - Chronological
 * @param {number} params.prior
 * @param {string} [params.nowISO] - Walk the timeline out to here
 * @returns {Object|null}
 */
export function fitThermalModel(params) {
  const key = fitCacheKey(params);
  if (key !== null) {
    const cached = FIT_CACHE.get(key);
    if (cached !== undefined) return cached;
  }
  const result = computeFit(params);
  if (key !== null) {
    // A tiny cache, because the only reuse that matters is within one render
    // pass and across the handful of ticks between two readings.
    if (FIT_CACHE.size >= FIT_CACHE_LIMIT) FIT_CACHE.clear();
    FIT_CACHE.set(key, result);
  }
  return result;
}

const FIT_CACHE = new Map();
const FIT_CACHE_LIMIT = 8;

/**
 * The cache key.
 *
 * `nowISO` is deliberately EXCLUDED. It only extends the timeline past the last
 * reading, which changes nothing the fit depends on - the residuals are all at
 * reading times. Including it would make the key change on every 30-second tick,
 * which is both a guaranteed cache miss and, worse, would give the caller's
 * `rawCalculations` a dependency on the clock. That computed is deliberately
 * clock-free: the predicted finish TIME does not move as the clock advances, only
 * the distance to it does, and the harness asserts exactly that.
 *
 * Content-addressed rather than identity-addressed: useSession normalises its
 * arrays in place on every mutation, so array identity is not stable even when
 * the contents are.
 */
function fitCacheKey({ readings, ovenEvents = [], prior }) {
  if (!readings || readings.length === 0) return null;
  const r = readings.map((x) => `${x.timestamp}:${x.temp}`).join('|');
  const o = ovenEvents.map((x) => `${x.timestamp}:${x.setTemp}:${x.isOff === true ? 1 : 0}`).join('|');
  return `${prior}#${r}#${o}`;
}

/** For tests, and for anything that needs a genuinely fresh fit. */
export function clearFitCache() {
  FIT_CACHE.clear();
}

function computeFit({ readings, ovenEvents = [], prior, nowISO = null }) {
  if (!readings || readings.length < 2) return null;

  const untilISO = nowISO ?? readings[readings.length - 1].timestamp;
  const timeline = buildTimeline(readings, ovenEvents, untilISO);
  const actual = readings.slice(1).map((r) => r.temp);

  const opening = initialSetPoint(readings, ovenEvents);
  // With no oven event at or before the first reading there is nothing to say the
  // oven was doing anything; the earliest event the cook did log is the best
  // available statement of what the oven was set to.
  const openingSetPointF = opening.found
    ? opening.setPointF
    : (ovenEvents.find((e) => e.isOff !== true)?.setTemp ?? null);

  /**
   * Initial state. The cook preheated, so the oven starts AT its set point; the
   * meat came out of the fridge, so surface and core start together at the first
   * reading.
   *
   * `Ts(0) = Tc(0)` is false for a session started mid-cook, and the fit
   * cannot recover from it - it inflates k, projects too fast, and reports
   * "early", which is the opposite of the old failure direction and so will not
   * look wrong to anyone eyeballing it. Not fixable by fitting Ts(0) as well:
   * that is not identifiable from three readings. Detected and flagged instead -
   * see the warm-start check in projectCook.
   */
  const initial = {
    ovenF: openingSetPointF ?? AMBIENT_F,
    surfaceF: readings[0].temp,
    coreF: readings[0].temp
  };

  const evaluate = (k) =>
    evaluateCandidate(k, timeline, initial, openingSetPointF, actual, prior);

  // ---- Coarse sweep ------------------------------------------------------
  // A 40x span about the prior. Wide because the prior is a weight-scaled guess
  // and a badly wrong weight - kilograms typed into a pounds field, say - must
  // still leave the true k inside the bracket.
  const lo = prior / 20;
  const hi = prior * 20;
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  let best = null;
  let bestIndex = 0;
  const grid = [];

  for (let i = 0; i < GRID_POINTS; i++) {
    const k = Math.exp(logLo + ((logHi - logLo) * i) / (GRID_POINTS - 1));
    const result = evaluate(k);
    grid.push({ k, objective: result.objective });
    if (best === null || result.objective < best.objective) {
      best = { k, ...result };
      bestIndex = i;
    }
  }

  // ---- Golden section on the bracketing interval -------------------------
  let leftLog = Math.log(grid[Math.max(0, bestIndex - 1)].k);
  let rightLog = Math.log(grid[Math.min(GRID_POINTS - 1, bestIndex + 1)].k);

  let x1 = rightLog - INV_PHI * (rightLog - leftLog);
  let x2 = leftLog + INV_PHI * (rightLog - leftLog);
  let f1 = evaluate(Math.exp(x1));
  let f2 = evaluate(Math.exp(x2));

  for (let i = 0; i < GOLDEN_ITERATIONS; i++) {
    if (f1.objective < f2.objective) {
      rightLog = x2;
      x2 = x1;
      f2 = f1;
      x1 = rightLog - INV_PHI * (rightLog - leftLog);
      f1 = evaluate(Math.exp(x1));
    } else {
      leftLog = x1;
      x1 = x2;
      f1 = f2;
      x2 = leftLog + INV_PHI * (rightLog - leftLog);
      f2 = evaluate(Math.exp(x2));
    }
  }

  const finalLog = (leftLog + rightLog) / 2;
  const k = Math.exp(finalLog);
  const fit = evaluate(k);
  const chosen = fit.objective <= best.objective ? { k, ...fit } : best;

  const residualCount = actual.length;
  // One free parameter, so the degrees of freedom are residuals minus one.
  const dof = residualCount - 1;
  const rmsResidual = residualCount > 0
    ? Math.sqrt(fit.sse / residualCount)
    : 0;

  /**
   * THE ANCHOR IS RE-SEATED ON THE MEASUREMENT.
   *
   * The fit gives k and the surface state; the core is the one node that was
   * actually MEASURED, so the projection starts from the reading rather than from
   * where the curve happens to pass.
   *
   * Without this, a loose fit could claim the roast was done while the probe
   * disagreed. Caught in the browser: readings ending at 114 °F against a 121 °F
   * pull, a fit with an 8 °F residual whose curve ran above the readings at the
   * end, and a status panel reading "PULL 11:57 PM" with "Target reached" under
   * it. A projection is entitled to be wrong about the future; it is not entitled
   * to disagree with a thermometer about the present.
   *
   * The surface node keeps its fitted value, because there is nothing better -
   * nobody measures the outside of a roast. So the gradient the projection starts
   * from is (fitted surface - measured core), which is exactly the quantity the
   * residual is uncertainty about.
   */
  const measuredCoreF = readings[readings.length - 1].temp;
  const anchorState = {
    ...chosen.replayed.stateAtLastReading,
    coreF: measuredCoreF
  };

  return {
    k: chosen.k,
    prior,
    sse: chosen.sse,
    residuals: chosen.residuals,
    rmsResidual: Math.sqrt(chosen.sse / Math.max(1, residualCount)),
    dof,
    timeline,
    initial,
    openingSetPointF,
    // The state at the newest reading is the anchor every projection starts from.
    anchorState,
    fittedAnchorState: chosen.replayed.stateAtLastReading,
    // ...and the state right now, which differs from it by however long ago that
    // reading was taken.
    nowState: chosen.replayed.endState,
    currentSetPointF: chosen.replayed.setPointF,
    integrations: GRID_POINTS + GOLDEN_ITERATIONS
  };
}

/** Longest a projection is allowed to run forward, in minutes. */
export const PROJECTION_HORIZON_MINUTES = 24 * 60;

/**
 * How long until the core reaches `targetF`, from a given state and dial.
 *
 * Bisection on the closed-form forward solution rather than an inverse: the
 * cascade's response is monotone in t while the oven is above the core, so a
 * bracket-and-halve converges in about forty exponentials and needs no algebra
 * that could be wrong.
 *
 * @returns {{minutes: number|null, reason: string|null, steadyStateF: number}}
 */
export function projectToTarget({ state, k, setPointF, targetF }) {
  const isOff = setPointF === null || setPointF === undefined;
  const steadyStateF = isOff ? AMBIENT_F : setPointF;

  if (state.coreF >= targetF) return { minutes: 0, reason: null, steadyStateF };

  const coreAt = (minutes) => advance(state, { minutes, setPointF }, k).coreF;

  /**
   * SCAN FORWARD FOR THE FIRST CROSSING. Two things went wrong when this did not.
   *
   * (1) It used to shortcut on the asymptote - `if (steadyStateF <= targetF)
   *     return 'unreachable'` - BEFORE integrating anything. The asymptote is
   *     where the core ends up, not the most it reaches: heat already stored in
   *     the surface node carries the core past it. Drop the dial to 190 °F on a
   *     roast whose surface is at 320 and the core crosses a 195 °F target in 24
   *     minutes and peaks at 236 - while the app said "the oven is not hot enough
   *     to reach your target, raise it". Advice to add heat to a roast about to
   *     overshoot by 40 °F.
   *
   * (2) The bracket was found by doubling `hi` until the core exceeded the
   *     target, which assumes the core rises monotonically. It does not: after the
   *     dial comes down the core rises, crosses, and then falls back toward the
   *     new steady state. Doubling can step straight over that window and report
   *     `beyond-horizon`, and the bisection that follows would find the wrong root
   *     if it did not.
   *
   * A grid scan has neither problem. The step is fine enough for the fastest
   * roast the app's k range allows (the smallest time constant is about 17
   * minutes) and the whole scan is a few hundred exponentials - this runs a couple
   * of times per recompute, not inside the optimiser.
   */
  const STEP_MINUTES = 5;
  let previousT = 0;
  for (let t = STEP_MINUTES; t <= PROJECTION_HORIZON_MINUTES; t += STEP_MINUTES) {
    if (coreAt(t) >= targetF) {
      // Bisect inside the bracket the scan found.
      let lo = previousT;
      let hi = t;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (coreAt(mid) < targetF) lo = mid;
        else hi = mid;
      }
      return { minutes: (lo + hi) / 2, reason: null, steadyStateF };
    }
    previousT = t;
  }

  /**
   * No crossing anywhere in the horizon. Now the asymptote decides WHICH refusal,
   * and the distinction matters because the UI says opposite things about them:
   * `unreachable` tells the cook to raise the oven, and no amount of waiting is an
   * alternative. `beyond-horizon` tells them to wait.
   */
  return {
    minutes: null,
    reason: steadyStateF <= targetF ? 'unreachable' : 'beyond-horizon',
    steadyStateF
  };
}

/**
 * The instantaneous heating rate at a state, °F/hour.
 *
 * k·(Ts - Tc)·60. Late in a cook this reads visibly LOWER than the ordinary
 * least-squares slope over the same readings, because the core is decelerating as
 * it closes on the surface and a line through the last three readings cannot know
 * that. That difference is the improvement, not a discrepancy to reconcile.
 */
export function instantaneousRate(state, k) {
  return k * (state.surfaceF - state.coreF) * 60;
}

/**
 * The dead-time gate.
 *
 * THE most important thing in this file, and the one the old code had no
 * equivalent of. A line - or a curve - fitted to the flat early limb of an
 * S-curve is not a weak projection, it is a projection that is wrong in
 * DIRECTION: it says the roast is running late, so the app says "raise the
 * oven", and the roast then finishes early. Scenario 04 does exactly that: the
 * first advice on a 250 °F oven is "raise", on a cook that finishes 110 minutes
 * early.
 *
 * There is no amount of cleverness in the fit that fixes this, because the
 * information is not in the data yet. The only correct behaviour is silence, and
 * these are the four conditions for breaking it.
 *
 * G1 does most of the work: two readings against one free parameter is zero
 * degrees of freedom, so the fit is interpolation and its residual is
 * meaningless.
 *
 * @param {Object} params
 * @param {Array} params.readings
 * @param {number} params.k - Fitted constant
 * @param {number} params.pullTempF
 * @returns {{passed: boolean, code: string|null, detail: Object}}
 */
export function assessDeadTimeGate({ readings, k, pullTempF }) {
  const count = readings.length;

  // G1 - enough readings for the fit to be a fit.
  if (count < MIN_READINGS_FOR_FIT) {
    return {
      passed: false,
      code: 'insufficient-readings',
      detail: { readings: count, required: MIN_READINGS_FOR_FIT }
    };
  }

  const first = readings[0];
  const last = readings[count - 1];
  const spanMinutes = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 60_000;

  /**
   * G2 - the core has to have actually moved. A probe sitting in the air, or one
   * that fell out of the roast, produces a beautifully consistent flat line.
   *
   * Checked BEFORE the span requirement, which is the opposite of the order the
   * plan lists them in, and deliberately. Flat readings fit a tiny k, and the
   * span requirement below is `0.25 / k` - so a probe that fell out ninety minutes
   * ago gets told "the readings are too close together", which is both confusing
   * and false. The rise check is the honest diagnosis of that data, and it is the
   * cheaper test.
   */
  const riseF = last.temp - first.temp;
  if (riseF < MIN_RISE_F) {
    return { passed: false, code: 'insufficient-rise', detail: { riseF, required: MIN_RISE_F } };
  }

  /**
   * G3 - the readings must span enough of the roast's own time scale.
   *
   * `0.25 / k` is a quarter of the meat's time constant, which is what makes this
   * scale-free: 15 minutes is plenty of a 3 lb tenderloin's curvature and nothing
   * at all of a 9 lb shoulder's. A fixed minute count is right for exactly one
   * size of roast.
   */
  const requiredSpan = Math.max(MIN_SPAN_MINUTES, 0.25 / k);
  if (spanMinutes < requiredSpan) {
    return {
      passed: false,
      code: 'insufficient-span',
      detail: { spanMinutes, requiredSpan }
    };
  }

  /**
   * G4 - and it has to be a real way into the cook.
   *
   * This is the dial on the whole gate: it decides how long the app stays quiet at
   * the start, and silence was measured inert once before (485 -> 1100 minutes of
   * it bought one minute of accuracy). Swept against the ten-cook deck:
   *
   *     G4     mean |convergence|   blocked min   mean overshoot   reversals
   *    0.15          36.0              415            1.5             0
   *    0.12          33.5              355            1.5             0
   *    0.10          32.7              345            1.9             0
   *    0.08          32.7              345            1.9             0
   *
   * 0.12 rather than the 0.15 the plan specified: it buys 60 minutes of the
   * deck's silence at no cost in overshoot or reversals, and below it the gate
   * stops being the binding constraint so nothing further is bought.
   *
   * The number that actually justifies the choice is not in that table. It is
   * that at 0.12 the FIRST advice of every cook on the deck is still correct in
   * DIRECTION - every cook that finishes early is told to lower, every cook that
   * finishes late is not told to lower. That is the defect this gate exists for:
   * before it, scenario 04's first advice was "raise" on a roast that finishes
   * 110 minutes early.
   */
  const progress = (last.temp - first.temp) / (pullTempF - first.temp);
  if (Number.isFinite(progress) && progress < MIN_PROGRESS_FRACTION) {
    return {
      passed: false,
      code: 'insufficient-progress',
      detail: { progress, required: MIN_PROGRESS_FRACTION }
    };
  }

  return { passed: true, code: null, detail: { spanMinutes, riseF, progress } };
}

export const MIN_READINGS_FOR_FIT = 3;
export const MIN_SPAN_MINUTES = 15;
export const MIN_RISE_F = 8;
export const MIN_PROGRESS_FRACTION = 0.12;

/**
 * Confidence bands on the RMS residual of the CURVED fit, in °F.
 *
 * R² is gone, and it had to go: over a three-point window R² cannot fall below
 * about 0.75, which made the "readings are fluctuating" branch and the
 * `unstable_rate` blocker unreachable dead code. It was also the wrong quantity -
 * a normalised measure of how much of the variance the fit explains says nothing
 * about whether the model is right, and a straight line through three points on a
 * curve gets an excellent R² while being wrong by half an hour.
 *
 * A residual in degrees is directly comparable to the probe's own noise, which is
 * the only scale that means anything: a fit that agrees with the readings to
 * within their noise cannot be improved on with this data, and one that misses
 * them by 12 °F is describing a different roast.
 */
export const CONFIDENCE_BANDS = { high: 2.5, medium: 6, low: 12 };

/**
 * Confidence level and machine-readable code for a fit.
 *
 * The code is the point. The eligibility gate used to decide what to do by
 * SUBSTRING-MATCHING the human-readable reason - `confidence.reason.includes
 * ('fluctuating')` - which made two prose fragments a de-facto API that no test
 * covered and any copy edit could break.
 *
 * @param {Object} params
 * @param {number} params.rmsResidual
 * @param {number} params.dof
 * @param {boolean} [params.warmStart]
 * @returns {{level: string, code: string, reason: string}}
 */
export function confidenceFromFit({ rmsResidual, dof, warmStart = false }) {
  if (rmsResidual >= CONFIDENCE_BANDS.low) {
    return {
      level: 'insufficient',
      code: 'poor-fit',
      reason: `The readings do not fit any single heating curve (off by ${rmsResidual.toFixed(1)}°F on average). Check the probe has not moved.`
    };
  }

  /**
   * Warm start. `Ts(0) = Tc(0)` assumes the roast went into the oven cold, and a
   * session begun mid-cook breaks it: the fit inflates k, projects too fast, and
   * reports "early" - the OPPOSITE of the old failure direction, so nobody
   * eyeballing the screen will recognise it as wrong.
   *
   * Not fixable by fitting the initial surface temperature as well; that is not
   * identifiable from three readings. Flagged and capped instead.
   */
  if (warmStart) {
    return {
      level: 'low',
      code: 'warm-start',
      reason: 'This cook was already under way when the first reading was logged, so the projection has to guess how hot the outside is. Treat it as approximate until a few more readings are in.'
    };
  }

  let level;
  let code;
  if (rmsResidual < CONFIDENCE_BANDS.high) {
    level = 'high';
    code = 'good-fit';
  } else if (rmsResidual < CONFIDENCE_BANDS.medium) {
    level = 'medium';
    code = 'moderate-fit';
  } else {
    level = 'low';
    code = 'loose-fit';
  }

  /**
   * One free parameter, so two readings give zero degrees of freedom and three
   * give one. A fit with one degree of freedom can be perfect by luck, so it
   * never earns high confidence however small its residual looks.
   */
  if (dof <= 1 && level === 'high') {
    return {
      level: 'medium',
      code: 'thin-fit',
      reason: `Fitted from only ${dof + 2} readings, so the agreement may be luck. One more will settle it.`
    };
  }

  const reason = level === 'high'
    ? `The readings agree with a single heating curve to within ${rmsResidual.toFixed(1)}°F.`
    : level === 'medium'
      ? `The readings follow a heating curve with some scatter (${rmsResidual.toFixed(1)}°F).`
      : `The readings only loosely follow a heating curve (${rmsResidual.toFixed(1)}°F). Treat the timing as approximate.`;

  return { level, code, reason };
}

/** Core temperature above which a first reading means the cook started warm. */
export const WARM_START_THRESHOLD_F = 90;
