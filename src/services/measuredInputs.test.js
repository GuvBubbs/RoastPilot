/**
 * Phase 8's one non-negotiable property: a cook who measures nothing gets
 * exactly the app they had before any of this existed.
 *
 * Every field the phase added is optional, absent-means-unknown, and behind a
 * collapsed disclosure - so the default path through the app touches none of
 * them. `npm run sim` proves that across sixteen simulated cooks against a
 * committed baseline; these are the same claim stated at the unit level, and
 * stated against the ONE REAL COOK the app has rather than a synthetic pair.
 *
 * The second half is the reason the fields exist at all: what a cook does record
 * has to survive save, load, export and reimport, in either unit system, or the
 * measurement was never taken.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSessionCalculations, projectScheduleUnderOven } from './calculationService.js';
import { generateRecommendation } from './recommendationService.js';
import { clearFitCache, stallExplainsSlowdown } from './thermalModel.js';
import { exportToJSON, exportToCSV } from './exportService.js';
import { storageService } from './storageService.js';
import {
  createSession, createReading, createDefaultSettings, migrateSessionToV2
} from '../models/dataModels.js';
import { useSession } from '../composables/useSession.js';

const REAL_COOK = JSON.parse(
  readFileSync(resolve(process.cwd(), 'Docs/Reference/roast-session-2026-08-22.json'), 'utf8')
);

/** The real cook's readings and dial history, exactly as exported. */
const readings = () => REAL_COOK.session.readings.map((r) => ({ ...r }));
const ovenEvents = () => REAL_COOK.session.ovenEvents.map((e) => ({ ...e }));

/**
 * The real cook, migrated to the v2 config shape. It was exported by a build
 * that wrote `targetTemp` and none of Phase 8's keys, which makes it the honest
 * test of "a stored session from before this phase still loads and runs".
 */
function realSession() {
  const session = {
    config: { ...REAL_COOK.session.config },
    readings: readings(),
    ovenEvents: ovenEvents(),
    settings: createDefaultSettings()
  };
  return migrateSessionToV2(session);
}

const settings = createDefaultSettings();

/** Everything the projection and the advice actually decide, in one object. */
function outcomeFor(configOverrides = {}, readingOverrides = null) {
  clearFitCache();
  const session = realSession();
  const config = { ...session.config, ...configOverrides };
  const rows = readingOverrides ?? session.readings;

  const calc = computeSessionCalculations({
    readings: rows,
    ovenEvents: session.ovenEvents,
    pullTempF: config.pullTempF,
    desiredServeTime: config.desiredServeTime,
    settings,
    restMinutes: config.restMinutes ?? 0,
    weightLb: config.weight,
    meatType: config.meatType,
    thicknessCm: config.thicknessCm ?? null,
    meatCut: config.meatCut ?? null,
    now: rows[rows.length - 1].timestamp
  });

  const rec = generateRecommendation({
    readings: rows,
    ovenEvents: session.ovenEvents,
    ovenBaseTemp: config.initialOvenTemp,
    pullTempF: config.pullTempF,
    desiredServeTime: config.desiredServeTime,
    scheduleVarianceMinutes: calc.scheduleVarianceMinutes,
    scheduleStatus: calc.scheduleStatus,
    confidence: calc.confidence,
    settings,
    predictedMinutesToTarget: calc.predictedMinutesToTarget,
    currentRate: calc.currentRate,
    /**
     * The REFUSAL, not the confidence code. This used to pass
     * `calc.confidence.code`, which on this fixture is 'thin-fit' - a
     * medium-confidence projection that does exist. generateRecommendation treats
     * any truthy value here as "there is no projection", so every arm of every
     * test in this file was comparing the same generic "no projection to advise
     * from yet" blocker, and no wording difference could ever have shown up.
     */
    projectionRefusedReason: calc.projectionRefusedReason ?? null,
    stallExplains: stallExplainsSlowdown(config.meatType, rows[rows.length - 1].temp),
    now: rows[rows.length - 1].timestamp
  });

  /**
   * And the same projection through the call that takes the WHOLE config.
   *
   * Part of what gives the non-consumption assertions teeth. computeSessionCalculations
   * takes named parameters, so a test that drives only it can never notice a new
   * config field being read - the field is not passed and cannot be. Whereas
   * projectScheduleUnderOven({ config }) hands the entire object to the model.
   *
   * What this catches, and what it does not: it catches a consumed field with a
   * visible effect on the schedule under a given dial setting. It does NOT catch a
   * small one, because these outputs are minute-rounded - that is what `fitPrior`
   * and `fitK` above are for, and between them the two cover this call site's
   * shared kPrior invocation and the main path's.
   */
  clearFitCache();
  const underOven = projectScheduleUnderOven({
    readings: rows,
    ovenEvents: session.ovenEvents,
    setPointF: config.initialOvenTemp,
    config,
    settings,
    now: rows[rows.length - 1].timestamp
  });

  return {
    predictedMinutesToTarget: calc.predictedMinutesToTarget,
    predictedTargetTime: calc.predictedTargetTime,
    scheduleVarianceMinutes: calc.scheduleVarianceMinutes,
    scheduleStatus: calc.scheduleStatus,
    confidenceLevel: calc.confidence?.level ?? null,
    confidenceCode: calc.confidence?.code ?? null,
    confidenceReason: calc.confidence?.reason ?? null,
    projectionRefusedReason: calc.projectionRefusedReason ?? null,
    /**
     * THE SHARP INSTRUMENT for non-consumption.
     *
     * The projection's own outputs are a blunt one: the prior is worth about a
     * tenth of a percent of the fit once three readings exist, and the ETA is
     * rounded to the minute, so a coefficient quietly applied to `covering` or
     * `ambientF` can change the prior by 10% and move no visible number at all. A
     * 1.1x multiplier on the prior was verified to leave every other field in this
     * object identical. `fit.prior` is where such a change lands exactly, and
     * `fit.k` is where it lands after the readings have had their say.
     *
     * WHAT IT CATCHES: a coefficient keyed on the VALUE of a captured field -
     * `covering === 'foil' ? 1.1 : 1` - which is the R7.4/R6 failure. Verified by
     * mutation: that change fails the assertions below, where the same 1.1x applied
     * unconditionally does not. The unconditional case is not consumption at all
     * and belongs to thermalModel.test.js's bit-identical kPrior assertion, which
     * catches it exactly.
     */
    fitPrior: calc.fit?.prior ?? null,
    fitK: calc.fit?.k ?? null,
    currentRate: calc.currentRate,
    action: rec.action,
    suggestedTemp: rec.suggestedTemp,
    blockerReason: rec.blockerReason,
    blockerCode: rec.blockerCode ?? null,
    underOvenVariance: underOven?.scheduleVarianceMinutes ?? null,
    underOvenStatus: underOven?.scheduleStatus ?? null,
    underOvenTargetTime: underOven?.predictedTargetTime ?? null
  };
}

describe('a cook who measures nothing', () => {
  const baseline = outcomeFor();

  it('gets an outcome worth comparing against', () => {
    /**
     * A DEGENERATE BASELINE WOULD MAKE EVERY ASSERTION BELOW PASS FOR FREE, so the
     * baseline is pinned as a real one: a live projection with an ETA, a rate, a
     * schedule verdict and a confidence level - not a refusal whose every field is
     * null and whose every comparison is therefore trivially equal.
     */
    expect(baseline.projectionRefusedReason).toBeNull();
    expect(baseline.predictedMinutesToTarget).toBeGreaterThan(0);
    expect(baseline.currentRate).toBeGreaterThan(0);
    expect(baseline.confidenceCode).toBeTruthy();
    expect(baseline.confidenceLevel).not.toBe('insufficient');
    expect(baseline.scheduleStatus).not.toBe('unknown');
    expect(baseline.action).toBeTruthy();
    // And the whole-config path projected too, or the non-consumption assertions
    // below would be asserting equality between two nulls.
    expect(baseline.underOvenTargetTime).toBeTruthy();
    expect(baseline.underOvenStatus).not.toBe('unknown');
    // And the sharp instrument reads something, or the non-consumption assertions
    // are comparing two nulls.
    expect(baseline.fitPrior).toBeGreaterThan(0);
    expect(baseline.fitK).toBeGreaterThan(0);
  });

  it('is unaffected by the new keys being present and null', () => {
    /**
     * The shape a session written by THIS build has when the cook filled nothing
     * in: every key there, every value null. It must be indistinguishable from a
     * session written before the keys existed.
     */
    expect(outcomeFor({
      thicknessCm: null,
      lengthCm: null,
      covering: 'open',
      ambientF: null,
      ovenIsFanForced: false
    })).toEqual(baseline);
  });

  it('is unaffected by every field this phase captures but does not consume', () => {
    /**
     * R1.3, R6, R7.3, R7.4 and R3.3, as one assertion.
     *
     * Length is recorded, not modelled - the app's cascade has a single length in
     * it. Covering, the kitchen temperature and the fan have no coefficient,
     * because no measured cook justifies one and inventing one is the failure this
     * whole line of work has been correcting. AMBIENT_F stays 70 even when the
     * kitchen is stated to be 95, on purpose: wiring it through would move the
     * pause and oven-off projections of cooks already running.
     */
    expect(outcomeFor({
      lengthCm: 40,
      covering: 'foil',
      ambientF: 95,
      ovenIsFanForced: true,
      meatCut: 'Bone-in'
    })).toEqual(baseline);
  });

  it('is unaffected by an oven thermometer reading on every reading', () => {
    // R3.3. The model drives its oven node from the DIAL, because that is what
    // the cook controls and what the recommendation engine writes. An observation
    // fed back in would close a loop from a measurement into the advice that
    // produced it - so it is stored, exported, and fitted offline.
    const withOvenActual = readings().map((r, i) => ({ ...r, ovenActualF: 180 + i * 30 }));
    expect(outcomeFor({}, withOvenActual)).toEqual(baseline);
  });

  it('IS affected by a measured thickness, which is the one field that acts', () => {
    // The negative control for all of the above: if nothing here could move the
    // outcome, the assertions above would prove nothing about the plumbing.
    const thin = outcomeFor({ thicknessCm: 8 });
    const thick = outcomeFor({ thicknessCm: 26 });
    expect(thin).not.toEqual(thick);
  });
});

describe('the stall, named rather than modelled', () => {
  /**
   * A ROAST THAT HAS ACTUALLY STOPPED CLIMBING, because that is the only state in
   * which any of this copy is reachable.
   *
   * The real cook fixture used above cannot exercise it: it tops out at 92 °F with
   * a healthy fit, so it never trips assessRateAgreement and never refuses for
   * 'rate-disagrees'. A test that varied only `meatType` on that fixture asserted
   * nothing at all - which is what the first version of this block did.
   *
   * So: a long cook whose readings flatten to a crawl, with the plateau placed
   * either inside the stall band or well below it.
   */
  function stalled({ meatType, plateauF }) {
    const start = Date.parse('2026-08-22T00:00:00.000Z');
    const at = (min) => new Date(start + min * 60000).toISOString();
    const climb = [45, 90, 130, plateauF - 4, plateauF - 1];
    const crawl = [plateauF, plateauF + 0.2, plateauF + 0.4];
    const temps = [...climb, ...crawl];

    clearFitCache();
    const readings = temps.map((temp, i) => ({
      id: `r${i}`,
      temp,
      timestamp: at(i * 60),
      deltaFromStart: temp - temps[0],
      deltaFromPrevious: i === 0 ? 0 : temp - temps[i - 1]
    }));
    const ovenEvents = [
      { id: 'o0', setTemp: 250, timestamp: at(0), previousTemp: null, isOff: false }
    ];
    const pullTempF = 203;

    const calc = computeSessionCalculations({
      readings,
      ovenEvents,
      pullTempF,
      desiredServeTime: at(temps.length * 60 + 240),
      settings,
      restMinutes: 30,
      weightLb: 9,
      meatType,
      now: readings[readings.length - 1].timestamp
    });

    const rec = generateRecommendation({
      readings,
      ovenEvents,
      ovenBaseTemp: 250,
      pullTempF,
      desiredServeTime: at(temps.length * 60 + 240),
      scheduleVarianceMinutes: calc.scheduleVarianceMinutes,
      scheduleStatus: calc.scheduleStatus,
      confidence: calc.confidence,
      settings,
      predictedMinutesToTarget: calc.predictedMinutesToTarget,
      currentRate: calc.currentRate,
      projectionRefusedReason: calc.projectionRefusedReason ?? null,
      stallExplains: stallExplainsSlowdown(meatType, readings[readings.length - 1].temp),
      now: readings[readings.length - 1].timestamp
    });

    return {
      refusedReason: calc.projectionRefusedReason,
      confidenceReason: calc.confidence?.reason ?? '',
      blockerReason: rec.blockerReason ?? '',
      /**
       * blockerTYPE, not blockerCode. generateRecommendation's refusal path calls
       * buildRecommendationResult with only reason/type/progress, so the specific
       * `blockerCode` that checkRecommendationEligibility sets never reaches a
       * caller of generateRecommendation - it is visible only to a direct caller of
       * the eligibility function, which is what recommendationService.test.js is.
       * Pre-existing, and not this phase's to change; noted so this test asserts on
       * a field that actually arrives.
       */
      blockerType: rec.blockerType ?? null
    };
  }

  it('actually reaches the rate-disagreement refusal, or asserts nothing', () => {
    // The guard on every assertion below. Without this, a change that stopped the
    // gate firing would turn this whole block green and silent - which is precisely
    // how the first version of this block managed to assert nothing at all.
    const s = stalled({ meatType: 'Pork Shoulder', plateauF: 155 });
    expect(s.refusedReason).toBe('rate-disagrees');
    expect(s.blockerType).toBe('no_projection');
    expect(s.blockerReason).toBeTruthy();
    expect(s.confidenceReason).toBeTruthy();
  });

  it('names the stall for a shoulder stalling in the band', () => {
    const s = stalled({ meatType: 'Pork Shoulder', plateauF: 155 });
    expect(s.blockerReason).toMatch(/this is the stall/i);
    expect(s.confidenceReason).toMatch(/this is the stall/i);
  });

  it('keeps the generic wording for a prime rib on the same numbers', () => {
    /**
     * The one that carries R8's actual argument: an unexplained slowdown on a rib
     * might well be a probe that has moved, and that wants checking rather than
     * waiting out. Same readings, same gate, different sentence.
     */
    const rib = stalled({ meatType: 'Prime Rib', plateauF: 155 });
    expect(rib.refusedReason).toBe('rate-disagrees');
    expect(rib.blockerReason).not.toMatch(/this is the stall/i);
    expect(rib.blockerReason).toMatch(/slowed right down/i);
    expect(rib.confidenceReason).not.toMatch(/this is the stall/i);

    const shoulder = stalled({ meatType: 'Pork Shoulder', plateauF: 155 });
    expect(shoulder.blockerReason).not.toBe(rib.blockerReason);
    expect(shoulder.confidenceReason).not.toBe(rib.confidenceReason);
  });

  it('does NOT claim a stall on a shoulder nowhere near the band', () => {
    /**
     * The defect this gate exists for. assessRateAgreement has no temperature term,
     * so a shoulder whose probe has worked its way out of the thickest part trips it
     * at 101 °F exactly as a real stall does at 155 - and keyed on the cut alone the
     * app told that cook "this is the stall - normal for a shoulder around
     * 150-165 °F" while the reading beside it said 101. The sentence was false, and
     * it inverted the advice: wait it out, on a roast that wanted the probe re-seated.
     */
    const low = stalled({ meatType: 'Pork Shoulder', plateauF: 101 });
    expect(low.refusedReason).toBe('rate-disagrees');
    expect(low.blockerReason).not.toMatch(/this is the stall/i);
    expect(low.blockerReason).not.toMatch(/150|165/);
    expect(low.confidenceReason).not.toMatch(/this is the stall/i);
    // It gets the same sentence a prime rib would, which is the honest answer.
    expect(low.blockerReason).toBe(stalled({ meatType: 'Prime Rib', plateauF: 101 }).blockerReason);
  });

  it('does not claim a stall above the band either', () => {
    // Past 165 a shoulder's moisture loss is largely done and a slowdown is the
    // ordinary approach to the oven temperature, so the band would be misquoted
    // in the other direction.
    const high = stalled({ meatType: 'Pork Shoulder', plateauF: 185 });
    expect(high.refusedReason).toBe('rate-disagrees');
    expect(high.blockerReason).not.toMatch(/this is the stall/i);
  });
});

describe('the round trip', () => {
  let session;

  beforeEach(() => {
    localStorage.clear();
    session = useSession();
  });

  afterEach(() => {
    session.endSession();
    localStorage.clear();
  });

  const MEASURED = {
    thicknessCm: 13.5,
    lengthCm: 21,
    covering: 'foil',
    ovenIsFanForced: true
  };

  for (const units of ['F', 'C']) {
    it(`survives save, load, export and reimport in a ${units} cook`, () => {
      const ambientF = 68;
      session.startSession({
        units,
        servingTempF: 129,
        pullTempF: 125,
        carryoverF: 4,
        restMinutes: 20,
        initialOvenTemp: 225,
        meatType: 'Pork Shoulder',
        meatCut: 'Bone-in',
        weight: 9,
        ambientF,
        ...MEASURED
      });

      // A reading with a thermometer on the shelf and one without, both typed in
      // the cook's own unit and both stored in Fahrenheit.
      session.addReading(units === 'F' ? 120 : 49, null, units === 'F' ? 218 : 103);
      session.addReading(units === 'F' ? 130 : 54);

      // --- through storage -------------------------------------------------
      const reloaded = storageService.loadSession();
      expect(reloaded.config).toMatchObject({ ...MEASURED, ambientF });
      expect(reloaded.readings[0].ovenActualF).toBeGreaterThan(200);
      expect(reloaded.readings[1].ovenActualF).toBeNull();

      // --- through the JSON export -----------------------------------------
      // exportToJSON serialises config and readings wholesale, which is the
      // property tools/sim/calibrate.js depends on. Asserted rather than assumed:
      // a refactor that named fields explicitly would silently stop exporting
      // every measurement a cook took.
      const exported = JSON.parse(exportToJSON(reloaded));
      expect(exported.session.config).toMatchObject({ ...MEASURED, ambientF });
      expect(exported.session.readings[0].ovenActualF)
        .toBe(reloaded.readings[0].ovenActualF);
      expect(exported.session.readings[1]).toHaveProperty('ovenActualF', null);

      // --- and back in ------------------------------------------------------
      const reimported = migrateSessionToV2({
        config: { ...exported.session.config },
        readings: exported.session.readings.map((r) => ({ ...r })),
        ovenEvents: exported.session.ovenEvents.map((e) => ({ ...e })),
        settings: exported.session.settings
      });
      expect(reimported.config).toMatchObject({ ...MEASURED, ambientF });
      expect(reimported.readings[0].ovenActualF).toBe(reloaded.readings[0].ovenActualF);
    });
  }

  it('states the lengths in centimetres in the CSV, whatever the cook reads', () => {
    /**
     * Canonical cm with a literal unit, matching the Weight row's raw pounds. A
     * file whose units depend on a preference the file does not record is harder
     * to reconstruct a cook from - and a length must never go near csvTemp or
     * csvDelta, which is the carryover bug in a new place.
     */
    for (const units of ['F', 'C']) {
      const s = createSession({ units, initialOvenTemp: 225, ...MEASURED, ambientF: 68 });
      s.readings.push(createReading(120, '2026-08-22T02:00:00.000Z', 218));
      const csv = exportToCSV(s);

      expect(csv, units).toContain('Thickness,13.5,cm');
      expect(csv, units).toContain('Length,21,cm');
      expect(csv, units).toContain('Covering,foil');
      expect(csv, units).toContain('Fan-forced,yes');
      // The kitchen temperature IS a temperature, so it converts.
      expect(csv, units).toMatch(units === 'F' ? /Kitchen Ambient,68\.0/ : /Kitchen Ambient,20\.0/);
    }
  });

  it('leaves the oven column empty rather than absent when nothing was read', () => {
    const s = createSession({ units: 'F', initialOvenTemp: 225 });
    s.readings.push(createReading(120, '2026-08-22T02:00:00.000Z'));
    const csv = exportToCSV(s);

    const header = csv.split('\n').find((l) => l.startsWith('Timestamp,'));
    expect(header).toContain('Oven Actual (°F)');
    // Trailing empty field: the column is there and the value is not.
    const row = csv.split('\n').find((l) => l.startsWith('2026-08-22T02:00:00.000Z'));
    expect(row.endsWith(',')).toBe(true);
  });
});

describe('a session stored before any of this existed', () => {
  it('loads and runs with none of the new keys present', () => {
    /**
     * NO MIGRATION was written for this phase, deliberately: every new field is
     * optional and absent-means-unknown, so there is nothing to backfill. This is
     * the assertion that says so - and the real cook's export is a genuine
     * pre-Phase-8 file rather than a fixture written to look like one.
     */
    const stored = realSession();
    for (const key of ['thicknessCm', 'lengthCm', 'covering', 'ambientF', 'ovenIsFanForced']) {
      expect(stored.config, key).not.toHaveProperty(key);
    }
    for (const r of stored.readings) {
      expect(r).not.toHaveProperty('ovenActualF');
    }

    /**
     * And it projects exactly as a session carrying the new keys as nulls does.
     *
     * This line used to read `expect(outcomeFor()).toEqual(outcomeFor({}))`, which
     * compares two identical calls - `configOverrides` defaults to `{}` - and so
     * could only fail if the fit were non-deterministic. The comparison that means
     * something is the pre-Phase-8 config against a post-Phase-8 one.
     */
    expect(outcomeFor()).toEqual(outcomeFor({
      thicknessCm: null,
      lengthCm: null,
      covering: 'open',
      ambientF: null,
      ovenIsFanForced: false
    }));
  });
});
