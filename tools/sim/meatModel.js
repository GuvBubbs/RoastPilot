/**
 * Two-node lumped thermal model of a roast in an oven.
 *
 * Why two nodes and not one: fitting Newton's law of cooling to the two
 * intervals in Docs/Reference/roast-session-2026-08-22.json gives k = 0.00193
 * and then 0.00378 per minute. A single-node model cannot produce that - it
 * predicts a *decaying* approach to the oven temperature, and the real cook
 * accelerates. The cause is physical: early on the core is still waiting for
 * the thermal wave to arrive, so its rate is governed by the surface-core
 * gradient opening up, not by (oven - core).
 *
 *   dTsurface/dt = kOven * (Toven - Tsurface) - backReaction * kCore * (Tsurface - Tcore)
 *   dTcore/dt    = kCore * (Tsurface - Tcore)
 *
 * `backReaction` is the ratio of the core node's heat capacity to the surface
 * node's - how much the surface is cooled by feeding the core. Fitted as a free
 * parameter it goes to zero (see calibrate.js): the real cook wants a
 * thermally thin surface shell that simply tracks the oven, with the core
 * lagging behind it. Left at its fitted value rather than at a physically
 * tidier guess the data rejects. Carrying it at zero collapses the pair into a
 * cascade of two first-order lags, whose step response - 1 - (1 + kt)e^-kt -
 * is exactly the accelerate-then-decay shape the real readings show.
 *
 * Everything here is in Fahrenheit, which is the app's canonical storage unit.
 * Working in one unit end to end keeps conversion bugs in the harness from
 * being mistaken for conversion bugs in the app.
 */

/** Weight the calibrated constants belong to. See README - the real export has
 *  `weight: null`, so this is an assumption, not a measurement. */
export const REFERENCE_WEIGHT_LB = 6;

/**
 * Fitted against the real cook by tools/sim/calibrate.js. Residuals are
 * recorded in the README; re-run `npm run sim:calibrate` after any full cook.
 */
export const CALIBRATED = {
  kOven: 0.010991,
  kCore: 0.010991,
  // Fitted to 0 (to within 5e-14) against the real cook. See README.
  backReaction: 0
  // kOven == kCore is not an assumption - it is where the fit lands, and
  // calibrate.js's ridge check shows the error rises steeply either side of it.
};

/**
 * Per-cut geometry. The constants scale with how far heat has to travel, which
 * is a length, so they go as weight^(-2/3) for a given shape; `shapeFactor`
 * carries the part of that a weight cannot express - a tenderloin and a pork
 * shoulder of equal weight do not heat alike.
 */
export const CUTS = {
  'prime-rib': { shapeFactor: 1.0, stalls: false },
  'tenderloin': { shapeFactor: 1.6, stalls: false },
  'pork-shoulder': { shapeFactor: 0.85, stalls: true },
  'pork-loin': { shapeFactor: 1.25, stalls: false },
  'leg-of-lamb': { shapeFactor: 1.1, stalls: false }
};

/** Stall band in Fahrenheit (150-165 F is 66-74 C). */
export const STALL_BAND_F = [150, 165];

const DEFAULTS = {
  seed: 1,
  weightLb: REFERENCE_WEIGHT_LB,
  cut: 'prime-rib',
  startCoreF: 48,
  startSurfaceF: null,        // defaults to startCoreF: the whole roast leaves the fridge cold
  ambientF: 70,
  ovenSetF: 200,
  ovenOff: false,
  // The dial does not become the oven. A new set point is approached with its
  // own time constant, which is the other side of the app's ovenChangeLagMinutes.
  tauOvenHeatMin: 10,
  // A closed oven with the element off gives up its heat far more slowly than
  // it takes it on.
  tauOvenCoolMin: 45,
  // +/- 6 C sawtooth on a ~12 min period: a domestic oven thermostat, not a lab.
  cycleAmplitudeF: 10.8,
  cyclePeriodMin: 12,
  // A badly placed probe is a constant offset, not noise - and a constant
  // offset is a state the app has to survive.
  probeBiasRangeF: 2.7,       // +/- 1.5 C
  probeNoiseF: 0.54,          // +/- 0.3 C
  // Evaporative cooling through the stall band, in F/min of suppressed rise.
  // Fabricated, NOT calibrated - the real export never reaches 150 F.
  evapMaxF: 0.42,
  stalls: null,               // null = take it from the cut
  backReaction: CALIBRATED.backReaction
};

/** Deterministic PRNG. No Math.random anywhere in the harness: a scenario that
 *  cannot be replayed exactly cannot be triaged. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangle wave in [-1, 1] with period 1. */
function triangle(x) {
  const frac = x - Math.floor(x);
  return 4 * Math.abs(frac - 0.5) - 1;
}

/** Smooth 0..1 hump across the stall band, 1 at its centre. */
function stallBump(tempF) {
  const [lo, hi] = STALL_BAND_F;
  if (tempF <= lo || tempF >= hi) return 0;
  const u = (tempF - lo) / (hi - lo);       // 0..1 across the band
  return Math.sin(Math.PI * u) ** 2;
}

/**
 * Scale the calibrated constants to a given roast.
 * @param {number} weightLb
 * @param {string} cut
 */
export function constantsFor(weightLb, cut) {
  const geometry = CUTS[cut] ?? CUTS['prime-rib'];
  const massScale = (REFERENCE_WEIGHT_LB / weightLb) ** (2 / 3);
  const scale = massScale * geometry.shapeFactor;
  return {
    kOven: CALIBRATED.kOven * scale,
    kCore: CALIBRATED.kCore * scale,
    stalls: geometry.stalls
  };
}

export function createMeatModel(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const fitted = options.kOven !== undefined && options.kCore !== undefined
    ? { kOven: options.kOven, kCore: options.kCore, stalls: CUTS[opts.cut]?.stalls ?? false }
    : constantsFor(opts.weightLb, opts.cut);

  const rand = mulberry32(opts.seed);
  // Drawn once, before any reading noise, so adding readings never shifts the
  // bias and two runs of the same scenario get the same badly placed probe.
  const probeBiasF = (rand() * 2 - 1) * opts.probeBiasRangeF;
  const cyclePhase = rand();

  return {
    kOven: fitted.kOven,
    kCore: fitted.kCore,
    stalls: opts.stalls === null ? fitted.stalls : opts.stalls,
    probeBiasF,

    t: 0,                                   // minutes since the cook started
    coreF: opts.startCoreF,
    surfaceF: opts.startSurfaceF ?? opts.startCoreF,
    // The oven's own temperature, before thermostat cycling is added. Starts at
    // the set point: the cook preheated.
    ovenBaseF: opts.ovenOff ? opts.ambientF : opts.ovenSetF,
    ovenSetF: opts.ovenSetF,
    ovenOff: opts.ovenOff,
    readingCount: 0,

    /** Move the dial. Pass null (or call setOvenOff) to switch the oven off. */
    setOven(setF) {
      if (setF === null || setF === 0) {
        this.ovenOff = true;
      } else {
        this.ovenOff = false;
        this.ovenSetF = setF;
      }
    },

    setOvenOff() {
      this.ovenOff = true;
    },

    /** The oven temperature the meat actually sees right now. */
    get ovenEffectiveF() {
      const cycling = this.ovenOff
        ? 0
        : opts.cycleAmplitudeF * triangle(this.t / opts.cyclePeriodMin + cyclePhase);
      return this.ovenBaseF + cycling;
    },

    /**
     * What the probe says. True core plus this cook's placement bias plus
     * per-reading noise. This is the only number the app is ever allowed to see.
     */
    probeF() {
      this.readingCount += 1;
      const noise = (rand() * 2 - 1) * opts.probeNoiseF;
      return this.coreF + probeBiasF + noise;
    },

    /** Advance the simulation by `minutes`, sub-stepped for stability. */
    step(minutes) {
      const SUB_MIN = 0.25;
      let remaining = minutes;
      while (remaining > 1e-9) {
        const dt = Math.min(SUB_MIN, remaining);
        this.t += dt;

        const ovenTarget = this.ovenOff ? opts.ambientF : this.ovenSetF;
        const tau = this.ovenOff ? opts.tauOvenCoolMin : opts.tauOvenHeatMin;
        this.ovenBaseF += (ovenTarget - this.ovenBaseF) * (1 - Math.exp(-dt / tau));

        const ovenEff = this.ovenEffectiveF;
        const gradient = this.surfaceF - this.coreF;

        const dSurface = this.kOven * (ovenEff - this.surfaceF) - opts.backReaction * this.kCore * gradient;
        let dCore = this.kCore * gradient;
        if (this.stalls) {
          // Evaporation from the surface caps how fast the core can climb
          // through the band. Clamped at zero: the stall holds a roast, it
          // does not cool one.
          dCore = Math.max(0, dCore - opts.evapMaxF * stallBump(this.coreF));
        }

        this.surfaceF += dSurface * dt;
        this.coreF += dCore * dt;
        remaining -= dt;
      }
    }
  };
}
