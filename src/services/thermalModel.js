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
 * When the cook began, as far as the model is concerned.
 *
 * The earliest oven event before the first reading, if there is one - otherwise
 * the first reading itself.
 *
 * THIS IS THE FIX FOR A DEFECT THAT INVERTED THE ADVICE ON MOST COOKS. The
 * timeline used to start at the first PROBE READING, and every oven event at or
 * before it was folded into an opening dial setting and otherwise discarded. So
 * the minutes between the roast going into a hot oven and the cook getting round
 * to logging a temperature were never integrated: the model was told the roast
 * entered the oven at the moment of that first reading, with its surface and core
 * equal. In reality the surface is already a long way ahead of the core by then,
 * and the only way to explain the rise that follows without that stored gradient
 * is to inflate k - so the projection ran fast, reported "early", and advised
 * LOWERING a roast that was late.
 *
 * Measured against the 1-D conduction oracle on a 20 lb shoulder at 250 F, truth
 * 230 min, three readings in: a first reading at t=0 gave +38 min and "late"; the
 * same roast with the first reading at t=30 gave -30 min and "early". Opposite
 * advice from the same cook.
 *
 * It was not an edge case. The starting reading in SessionSetupModal is optional,
 * and with no readings at all the reading schedule falls back to prompting 30
 * minutes after the session was created - so the app itself asked for the first
 * reading in the middle of the worst case. Neither verification layer could see
 * it: every scenario in the deck and every oracle case began with a reading at
 * t=0.
 */
export function cookStartISO(readings, ovenEvents) {
  const firstReading = Date.parse(readings[0].timestamp);
  let earliest = null;
  for (const event of ovenEvents ?? []) {
    const t = Date.parse(event.timestamp);
    if (!Number.isFinite(t) || t >= firstReading) continue;
    if (earliest === null || t < earliest) earliest = t;
  }
  return earliest === null ? readings[0].timestamp : new Date(earliest).toISOString();
}

/**
 * Turn a reading and oven-event history into the segment list the model walks.
 *
 * Anchored at `startISO` - see cookStartISO. Every reading strictly after the
 * anchor becomes a residual, so a cook with a head start contributes one MORE
 * observation than it used to rather than one fewer: the first reading stops
 * being an exact initial condition and becomes something the fit has to explain.
 *
 * @param {Array<{timestamp: string, temp: number}>} readings - Chronological
 * @param {Array<{timestamp: string, setTemp: number, isOff: boolean}>} ovenEvents
 * @param {string} untilISO - Walk the timeline out to here
 * @param {string} [startISO] - The anchor; defaults to the first reading
 * @returns {{startISO: string, marks: Array<Object>}}
 */
export function buildTimeline(readings, ovenEvents, untilISO, startISO = readings[0].timestamp) {
  const start = Date.parse(startISO);
  const at = (iso) => (Date.parse(iso) - start) / 60_000;

  const marks = [];

  for (let i = 0; i < readings.length; i++) {
    // A reading sitting exactly on the anchor states the initial condition
    // rather than testing it - which with no head start is readings[0], exactly
    // as before.
    const minutes = at(readings[i].timestamp);
    if (minutes <= 0) continue;
    marks.push({ minutes, kind: 'reading', temp: readings[i].temp, index: i });
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

/** The dial setting in force at the anchor (by default, the first reading). */
export function initialSetPoint(readings, ovenEvents, startISO = readings[0].timestamp) {
  const start = Date.parse(startISO);
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

/** The dial setting in force at a given instant, or null if the oven is off. */
export function setPointAt(ovenEvents, iso) {
  const t = Date.parse(iso);
  let setPointF = null;
  for (const event of ovenEvents ?? []) {
    if (Date.parse(event.timestamp) > t) break;
    setPointF = event.isOff === true ? null : event.setTemp;
  }
  return setPointF;
}

/**
 * Carry a state forward from one instant to another through the real oven
 * history, honouring every dial change in between.
 *
 * This is what the fit cannot do for you. The fit is anchored at the newest
 * reading and is deliberately clock-free, so anything that needs to know where
 * the roast is NOW - rather than where it was when it was last measured - has to
 * integrate the gap itself.
 *
 * The case that made this necessary: while the oven is off the app offers an
 * estimate of what would happen once it is back on, and that estimate was
 * computed from the anchor. With no new readings during a pause the anchor does
 * not move, so the figure was identical after three minutes of pause and after
 * three hours - the same "5m" either way, while the real roast had been shedding
 * heat the whole time. The estimate has to be taken from where the roast is now.
 *
 * @param {Object} state - { ovenF, surfaceF, coreF }
 * @param {Object} span
 * @param {Array} span.ovenEvents - Chronological
 * @param {string} span.fromISO
 * @param {string} span.toISO
 * @param {number} k
 */
export function advanceThroughOven(state, { ovenEvents = [], fromISO, toISO }, k) {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { ...state };

  let cursor = from;
  let setPointF = setPointAt(ovenEvents, fromISO);
  let current = { ...state };

  for (const event of ovenEvents) {
    const t = Date.parse(event.timestamp);
    if (t <= from || t >= to) continue;
    current = advance(current, { minutes: (t - cursor) / 60_000, setPointF }, k);
    cursor = t;
    setPointF = event.isOff === true ? null : event.setTemp;
  }

  return advance(current, { minutes: (to - cursor) / 60_000, setPointF }, k);
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
  const startISO = cookStartISO(readings, ovenEvents);
  const timeline = buildTimeline(readings, ovenEvents, untilISO, startISO);
  /**
   * The observations, taken FROM THE MARKS rather than from `readings.slice(1)`.
   *
   * `replay` emits one prediction per reading mark, and the two lists have to
   * line up element for element. A slice happens to agree with the marks when the
   * anchor is the first reading and silently disagrees when it is not - an
   * off-by-one in the residuals, which is the one place in this file where being
   * wrong is invisible: every residual would be compared against the wrong
   * reading, the fit would still converge, and it would converge on nonsense.
   */
  const actual = timeline.marks
    .filter((m) => m.kind === 'reading')
    .map((m) => m.temp);

  const opening = initialSetPoint(readings, ovenEvents, startISO);
  // With no oven event at or before the first reading there is nothing to say the
  // oven was doing anything; the earliest event the cook did log is the best
  // available statement of what the oven was set to.
  const openingSetPointF = opening.found
    ? opening.setPointF
    : (ovenEvents.find((e) => e.isOff !== true)?.setTemp ?? null);

  /**
   * Initial state, stated at the anchor. The cook preheated, so the oven starts AT
   * its set point; the meat came out of the fridge, so surface and core start
   * together.
   *
   * The temperature used is the first reading's. When the anchor is that reading
   * this is exact. When the anchor is earlier - the roast went into the oven
   * before anyone logged a temperature - it is an approximation, and a biased one:
   * the roast was slightly COLDER going in than it was when first measured. The
   * bias is small (a roast big enough to have a meaningful head start is also one
   * whose core has barely moved in it) and it is in the safe direction, because
   * understating the starting temperature understates how far the core has already
   * come. Fitting the initial temperature as a second free parameter is the
   * principled alternative and is not identifiable at three readings.
   *
   * `Ts(0) = Tc(0)` is still false for a session started mid-cook - the app is
   * opened with a roast already an hour in and no oven event to anchor to. That
   * case inflates k, projects too fast, and reports "early", which is the opposite
   * of the old failure direction and so will not look wrong to anyone eyeballing
   * it. Detected and flagged rather than fitted - see the warm-start check.
   */
  /**
   * THE COLDEST READING, not the first one. A roast only heats, so the coldest
   * observation is the better estimate of where it started - and unlike the first
   * reading, no single spurious value can move it upwards.
   *
   * This is not a refinement, it is the difference between a working fit and a
   * destroyed one. The initial temperature is not just another residual: it is the
   * INITIAL CONDITION, so a first reading of 150 F told the model the roast began
   * at 150 and then had to explain readings below that. No value of k can produce
   * a falling core in a hot oven, so the search ran to the bottom of its bracket -
   * k collapsed from 0.00692 to 0.00035, twenty times too small and pinned at the
   * floor - and every subsequent residual came out near 100 F. That is why the
   * cook stayed mute: not because one reading was wrong, but because one reading
   * being wrong made every other reading look wrong too.
   */
  const startingTempF = Math.min(...readings.map((r) => r.temp));

  const initial = {
    ovenF: openingSetPointF ?? AMBIENT_F,
    surfaceF: startingTempF,
    coreF: startingTempF
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
    /**
     * The same thing over the most recent readings only, and it is this one that
     * decides confidence. See CONFIDENCE_WINDOW_READINGS.
     */
    recentRmsResidual: rmsOfRecent(chosen.residuals),
    dof,
    timeline,
    initial,
    openingSetPointF,
    // The state at the newest reading is the anchor every projection starts from.
    anchorState,
    fittedAnchorState: chosen.replayed.stateAtLastReading,
    /**
     * There is deliberately NO `nowState` here. It used to be exported, and it
     * was a trap: the cache key excludes `nowISO` (see fitCacheKey, and that
     * exclusion is correct), so "the state right now" was frozen at whatever the
     * clock said the first time this reading set was fitted. Nothing consumed it,
     * which is the only reason it never produced a visible bug. Anything wanting
     * the state at a particular moment must ask for that moment explicitly:
     * `advanceThroughOven(fit.anchorState, {...}, fit.k)`.
     */
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
  // `k` here is the prior - see G3.
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
   * THE BASELINE IS THE COLDEST READING, NOT THE FIRST ONE.
   *
   * Both the rise test and the progress test measure from where the roast
   * started, and using readings[0] for that made a single bad first reading
   * permanently fatal. The first reading is also the one most likely to be wrong -
   * it is taken while the cook is still getting the probe seated, and a probe
   * resting against the pan reads hot.
   *
   * With an honest opening reading of 48 F and the rest at 60/72/84, the gate
   * opens. Replace that first reading with 150 F, change nothing else, and the
   * gate shuts with `insufficient-rise` (rise -66 F) and never reopens however
   * many honest readings follow, because every one of them is still measured
   * against the 150. The app then says "The core has barely moved. Check the probe
   * is seated in the thickest part." for the whole cook - blaming the probe for
   * the one reading it got right - and only changes its excuse as the other gates
   * take over in turn: insufficient-rise, then insufficient-span, then
   * insufficient-progress. Recovery required the cook to find and delete that
   * reading in the log, and nothing anywhere hinted at it.
   *
   * A roast only heats, so the coldest observation is the better estimate of where
   * it started, and it is robust to any number of spuriously HIGH readings. It is
   * not robust to a spuriously low one, which would open the gate slightly early -
   * a much cheaper error than never opening it, and one the fit's own residual
   * still reports as poor confidence.
   */
  const baselineF = Math.min(...readings.map((r) => r.temp));

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
  const riseF = last.temp - baselineF;
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
   *
   * The k used is the WEIGHT-DERIVED PRIOR, not the fitted one, and the difference
   * matters. This gate exists to decide whether the fit can be trusted; gating it
   * on the fit's own output is circular, and the circularity has teeth. Feed the
   * cook one spurious 150 F first reading and the fit collapses to a tiny k, which
   * makes `0.25 / k` enormous, which shuts the gate on `insufficient-span` for the
   * rest of the cook - a corrupted fit voting itself unfalsifiable. The prior
   * comes from the weight and the cut and no reading can move it.
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
  /**
   * A pull temperature at or below where the roast started is not "too early in
   * the cook" - it is a statement that cannot be true of a roast being heated
   * towards it, so it gets its own answer rather than a share of G4's.
   *
   * The old arithmetic turned it into a permanent lock: readings of 148/160/172/184
   * against a 120 F pull gave `progress: -1.29`, which is below any threshold, so
   * the gate reported `insufficient-progress` about a roast 64 degrees PAST its
   * target. Either the probe is in the wrong place or the target is, and both are
   * worth saying out loud; "not far enough into the cook" is neither.
   */
  if (pullTempF <= baselineF) {
    return {
      passed: false,
      code: 'target-below-readings',
      detail: { pullTempF, baselineF }
    };
  }

  const progress = (last.temp - baselineF) / (pullTempF - baselineF);
  if (progress < MIN_PROGRESS_FRACTION) {
    return {
      passed: false,
      code: 'insufficient-progress',
      detail: { progress, required: MIN_PROGRESS_FRACTION }
    };
  }

  return { passed: true, code: null, detail: { spanMinutes, riseF, progress, baselineF } };
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
 * How many of the most recent readings the confidence residual is taken over.
 *
 * THE FIT STILL USES EVERY READING - that is deliberate and unchanged, because
 * the early readings carry the curvature that identifies k and throwing them away
 * leaves the fit unable to tell an accelerating roast from a decelerating one.
 * This window governs only the JUDGEMENT of the fit, and those are different
 * questions. The projection starts at the newest reading and extrapolates, so what
 * matters for whether it can be trusted is whether the model describes the roast's
 * RECENT behaviour. A reading from three hours ago that the model never explained
 * says nothing about that.
 *
 * Judging it over the whole history made refusal permanent, and permanent in a way
 * the copy explicitly denied: "timing advice resumes once they line up again" was
 * unreachable. One spurious 150 F first reading on a 12 lb roast left an RMS above
 * the 12 F refusal band for the entire cook - a residual of that size contributes
 * roughly 100/sqrt(n), so it would have taken about seventy readings to decay out,
 * and the app stayed mute from the fifth reading to the end while the probe climbed
 * past the pull temperature. The overnight shoulder's stall did the same thing for
 * 410 minutes with the serve deadline inside the silence.
 *
 * This does NOT make the gate toothless. A model that has stopped describing the
 * roast - the stall, a probe that has shifted - produces large residuals on exactly
 * the recent readings this looks at, so it still refuses, and now it refuses for as
 * long as the disagreement lasts rather than for ever afterwards.
 *
 * Five: enough that one bad reading cannot dominate, few enough to still be about
 * "now" on any cadence the app permits.
 */
export const CONFIDENCE_WINDOW_READINGS = 5;

/** RMS of the last CONFIDENCE_WINDOW_READINGS residuals. */
function rmsOfRecent(residuals) {
  if (!residuals || residuals.length === 0) return 0;
  const window = residuals.slice(-CONFIDENCE_WINDOW_READINGS);
  const sse = window.reduce((total, r) => total + r * r, 0);
  return Math.sqrt(sse / window.length);
}

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
  /**
   * A large residual no longer REFUSES, it caps confidence at low.
   *
   * The residual describes the past; refusing on it silenced the app about a
   * present it was getting right. On the overnight shoulder the stall is
   * permanently in the residual and can never leave it, so the app stayed mute for
   * 410 minutes with the serve deadline inside the silence - and still mute at
   * 194 F with the pull one degree away, on a projection accurate to half an hour.
   * Meanwhile the same threshold let it speak confidently at the START of the
   * stall, when the residual was still only 6.2 and the projection was 330 minutes
   * out.
   *
   * Whether to speak at all is now decided by assessRateAgreement, which asks
   * about now rather than about the whole history and separates those two cases
   * cleanly. The residual keeps the job it is good at: saying how much to trust
   * what is said.
   */
  if (rmsResidual >= CONFIDENCE_BANDS.low) {
    return {
      level: 'low',
      code: 'loose-fit',
      reason: `These readings do not all sit on one heating curve - the fit is off by ${rmsResidual.toFixed(1)}°F on average - so treat the timing as approximate. If the probe has been moved, the readings before the move are the ones pulling it.`
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
/**
 * How many readings the observed slope is measured over, and how far the model's
 * own rate may differ from it before the projection is refused.
 *
 * WHY THIS EXISTS, AND WHY THE RESIDUAL COULD NOT DO IT. The confidence residual
 * asks "has the model explained the readings so far". The projection asks "will
 * the model describe the next few hours". Through a stall those two questions have
 * opposite answers, and the residual gets both of them wrong:
 *
 *   t     probe   model rate   observed rate   ratio   projection error   recentRms
 *   345   152.5      22.4           2.5         8.9        -330 min          6.2
 *   400   153.3      22.7           0.1       189.2        -278 min         13.4
 *   700   156.6      19.7           0.8        24.6         +32 min         40.0
 *   770   177.6      12.9          20.1         0.6         +30 min         36.1
 *   845   193.4       8.4          12.0         0.7         +17 min         22.9
 *
 * (Real numbers, from the overnight-shoulder cook's own 40 readings.)
 *
 * At t=345 the residual was 6.2 - inside the band that speaks - so the app said
 * "running early" and offered to lower the oven, while the probe was moving at
 * 2.5 F/hr against a claimed 22.4 and the roast went on to finish two hours late.
 * At t=770 the residual was 36.1, far past the refusal band, so the app said
 * nothing at all - about a projection that was accurate to half an hour. The stall
 * is permanently in the residual and can never leave it; the app was mute for 410
 * minutes with the serve deadline inside that silence, and still mute at 194 F
 * with the pull one degree away.
 *
 * Comparing the model's instantaneous rate against the slope the readings actually
 * show separates the two cases cleanly - the ratio is 1.0 or 0.6-0.8 when the
 * projection is good and 9 to 189 when it is not - because it asks about NOW
 * rather than about the whole history.
 *
 * Only the "roast has slowed" direction refuses. A model running slower than the
 * readings is the ordinary state just after the oven comes up, and the settling
 * machinery already owns that window.
 */
export const RATE_WINDOW_READINGS = 3;
export const MAX_RATE_OVERSTATEMENT = 2.5;
/**
 * Below this the ratio is meaningless. A probe reading +/-0.54 F of noise, sampled
 * across a 40-minute window, carries about 1.6 F/hr of slope noise on its own, so
 * a model claiming 1.0 F/hr against an observed 0.3 is not evidence of anything.
 */
export const MIN_RATE_DISAGREEMENT_F_PER_HR = 4;

/**
 * Does the model's rate agree with the rate the readings show?
 *
 * @returns {{agrees: boolean, code: string|null, detail: Object}}
 */
export function assessRateAgreement({ readings, ovenEvents = [], anchorState, k }) {
  if (!readings || readings.length < RATE_WINDOW_READINGS) {
    return { agrees: true, code: 'not-assessable', detail: { readings: readings?.length ?? 0 } };
  }

  const window = readings.slice(-RATE_WINDOW_READINGS);
  const spanHours =
    (Date.parse(window[window.length - 1].timestamp) - Date.parse(window[0].timestamp)) / 3_600_000;
  if (!(spanHours > 0)) {
    return { agrees: true, code: 'not-assessable', detail: { spanHours } };
  }

  /**
   * A window straddling a dial change describes two different ovens, and its
   * slope is a blend of both. Same reasoning as excluding pause-straddling
   * readings from the fit: without this, every raise would look like a roast that
   * had suddenly slowed, because the observed slope is still the old oven's.
   */
  const from = Date.parse(window[0].timestamp);
  const to = Date.parse(window[window.length - 1].timestamp);
  const straddles = (ovenEvents ?? []).some((e) => {
    const t = Date.parse(e.timestamp);
    return t > from && t < to;
  });
  if (straddles) {
    return { agrees: true, code: 'not-assessable', detail: { straddlesOvenChange: true } };
  }

  const observedRate = (window[window.length - 1].temp - window[0].temp) / spanHours;
  const modelRate = instantaneousRate(anchorState, k);
  const excess = modelRate - observedRate;

  if (excess > MIN_RATE_DISAGREEMENT_F_PER_HR
      && observedRate > 0
      && modelRate > observedRate * MAX_RATE_OVERSTATEMENT) {
    return {
      agrees: false,
      code: 'rate-disagrees',
      detail: { modelRate, observedRate, spanHours }
    };
  }
  // A roast that has stopped moving at all, while the model says it is climbing.
  if (observedRate <= 0 && excess > MIN_RATE_DISAGREEMENT_F_PER_HR) {
    return {
      agrees: false,
      code: 'rate-disagrees',
      detail: { modelRate, observedRate, spanHours }
    };
  }

  return { agrees: true, code: null, detail: { modelRate, observedRate } };
}

export const WARM_START_THRESHOLD_F = 90;
