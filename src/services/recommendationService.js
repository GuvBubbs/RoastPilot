import { minutesBetween, addMinutes } from '../utils/timeUtils.js';
import { fahrenheitToCelsius, celsiusToFahrenheit } from '../utils/temperatureUtils.js';
import { RECOMMENDATION_MESSAGES } from '../constants/defaults.js';
import { assessPullProgress } from './calculationService.js';

/**
 * Increments a real oven dial can actually be set to, per display unit. A
 * suggestion of 102°C is useless advice: the user rounds it themselves, which
 * used to look to the app like a manual change (see assessOvenChangeEffect).
 */
const DIAL_STEP = { C: 5, F: 5 };

/**
 * Snap an oven temperature to the nearest dial increment in the unit the user
 * is reading. Snapping in Fahrenheit would not help a Celsius dial - the two
 * grids do not line up - so this converts, snaps, and converts back.
 *
 * @param {number} tempF - Temperature in Fahrenheit
 * @param {'F'|'C'} units - Unit the dial is marked in
 * @param {'nearest'|'up'|'down'} [mode] - Rounding direction
 * @returns {number} Snapped temperature in Fahrenheit
 */
export function snapToDial(tempF, units, mode = 'nearest') {
  const step = DIAL_STEP[units] ?? DIAL_STEP.F;
  const inUnit = units === 'C' ? fahrenheitToCelsius(tempF) : tempF;
  const snapped = mode === 'up'
    ? Math.ceil(inUnit / step) * step
    : mode === 'down'
      ? Math.floor(inUnit / step) * step
      : Math.round(inUnit / step) * step;
  return units === 'C' ? celsiusToFahrenheit(snapped) : snapped;
}

/**
 * What to tell the cook when the projection was refused. Keyed by
 * predictTimeToTarget's `reason`.
 *
 * Each one is a different situation and only one of them resolves itself by
 * waiting, so they do not share a string.
 */
const PROJECTION_REFUSAL_REASONS = {
  // --- the dead-time gate: not enough of the cook has happened yet ---------
  'insufficient-readings': 'Need at least three readings before a finish time means anything.',
  'insufficient-span': 'The readings are too close together to tell how fast this roast is heating.',
  'insufficient-rise': 'The core has barely moved. Check the probe is seated in the thickest part.',
  'insufficient-progress':
    'Too early to project a finish time. The first stretch of a roast says almost ' +
    'nothing about the rest of it - a reading or two more will settle it.',
  /**
   * Not a "too early" state at all, which is why it has its own line. A pull
   * temperature at or below the coldest reading cannot be true of a roast being
   * heated towards it, and the old arithmetic reported it as `insufficient-progress`
   * - "too early in the cook" about a roast already past its target.
   */
  'target-below-readings':
    'Every reading is at or above your target temperature. Either the probe is not ' +
    'in the thickest part of the roast, or the target needs raising.',

  /**
   * Not a data problem - a physical one, and the reason there is no longer a
   * 'poor-fit' entry here.
   *
   * The refusal used to key off the fit's RMS residual, which describes the PAST.
   * On the stall - a pork shoulder giving up moisture through 150-165 F genuinely
   * does not follow a single heating curve, because evaporation takes heat the
   * model has no term for - that residual never leaves, so the app fell silent for
   * hours and stayed silent long after the roast started climbing again. The
   * message even promised otherwise ("resumes once they line up again"), which the
   * arithmetic could not deliver. This asks about now instead: has the roast
   * stopped climbing at the rate the curve predicts. It comes back on its own.
   */
  'rate-disagrees':
    'This roast has slowed right down, which is normal in the middle of a large ' +
    'cut. Timing advice comes back as soon as it picks up again.',

  // --- the fit itself ------------------------------------------------------
  /**
   * Two very different causes, and the app cannot tell them apart - so it names
   * both rather than the one it happens to have thought of first.
   *
   * A probe that has shifted is the common one on a small cut. On a big one it is
   * usually the stall: a pork shoulder giving up moisture through 150-165 °F
   * genuinely does not follow a single heating curve, because evaporation is
   * taking heat the model has no term for. That case is now caught by
   * 'rate-disagrees' below rather than by the residual - see its note.
   */
  /**
   * The genuinely new one. A straight line always got to the target eventually,
   * however low the oven was set - it had no notion of a temperature the roast
   * asymptotes to. This is the answer a cook most needs, because no amount of
   * waiting fixes it.
   */
  unreachable:
    'The oven is not hot enough to reach your target. Raise it - waiting will ' +
    'not get there.',

  /**
   * Said "five hours" while PROJECTION_HORIZON_MINUTES was 1440 - wrong by a
   * factor of five, and pointing at a threshold nothing used. The second half was
   * worse: "log another reading as it speeds up" is advice for a roast that is
   * about to get faster, and this state means the projection ran out of horizon,
   * which on a roast this slow it will do again at the next reading too.
   */
  'beyond-horizon':
    'This roast is heating too slowly to put a finish time on yet - more than a ' +
    'day out at the current rate. Raise the oven if you need it sooner.',

  // --- and the older arithmetic guards ------------------------------------
  'no-rate': 'Not enough usable readings to measure a heating rate yet.',
  'no-temp': 'A temperature is missing or unreadable. Check the latest reading.',
  'rate-too-low':
    'The core is barely moving, so there is nothing to project from. Check the ' +
    'probe is still seated and the oven is on.',
  'no-oven-history': 'No oven setting has been recorded. Log the temperature your oven is set to.',
  'no-projection': 'There is no projection to advise from yet.',
  'no-readings': 'No readings recorded yet.',
  default: 'There is no projection to advise from yet.'
};

/** One dial increment expressed in Fahrenheit. */
function dialStepF(units) {
  const step = DIAL_STEP[units] ?? DIAL_STEP.F;
  return units === 'C' ? step * 9 / 5 : step;
}

/**
 * Whether a reading has been logged at or after the given timestamp
 * 
 * @param {InternalReading[]} readings - Readings in chronological order
 * @param {string} sinceISO - ISO timestamp to compare against
 * @returns {boolean}
 */
export function hasReadingSince(readings, sinceISO) {
  if (readings.length === 0) return false;
  const latest = readings[readings.length - 1];
  return minutesBetween(sinceISO, latest.timestamp) >= 0;
}

/**
 * Build a complete Recommendation object, defaulting every field the callers
 * do not set. Keeps the emitted shape identical across all branches.
 * 
 * @param {Partial<Recommendation>} fields
 * @returns {Recommendation}
 */
export function buildRecommendationResult(fields) {
  return {
    action: 'none',
    suggestedTemp: null,
    changeAmount: null,
    message: null,
    reasoning: null,
    alternativeMessage: null,
    ovenOffMinutes: null,
    practicalMinF: null,
    plannedTempF: null,
    latestReadingTemp: null,
    severity: 'normal',
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null,
    awaitingEffect: false,
    ovenChangeMinutesAgo: null,
    waitMinutes: null,
    ...fields
  };
}

/**
 * Determine if conditions allow making a recommendation
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {string|null} params.desiredServeTime
 * @param {AppSettings} params.settings
 * @param {Object} params.confidence - Confidence assessment from calculation service
 * @param {string|null} [params.projectionRefusedReason] - Why the projection was
 *   refused, if it was. See predictTimeToTarget.
 * @returns {{canRecommend: boolean, blockerReason: string|null, blockerType: string|null, progress: Object|null}}
 */
export function checkRecommendationEligibility({
  readings,
  ovenEvents,
  desiredServeTime,
  settings,
  confidence,
  projectionRefusedReason = null,
  now = new Date().toISOString()
}) {
  // Check minimum readings requirement
  if (readings.length < settings.minReadingsForRecommendation) {
    const needed = settings.minReadingsForRecommendation - readings.length;
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_READINGS.replace('{count}', settings.minReadingsForRecommendation),
      blockerType: 'insufficient_readings',
      progress: {
        current: readings.length,
        required: settings.minReadingsForRecommendation,
        message: `${needed} more reading${needed > 1 ? 's' : ''} needed`
      }
    };
  }
  
  // Check time span requirement
  const timeSpan = readings.length >= 2 
    ? minutesBetween(readings[0].timestamp, readings[readings.length - 1].timestamp)
    : 0;
  
  if (timeSpan < settings.minTimeSpanMinutes) {
    const needed = Math.ceil(settings.minTimeSpanMinutes - timeSpan);
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NEED_MORE_TIME.replace('{minutes}', settings.minTimeSpanMinutes),
      blockerType: 'insufficient_time',
      progress: {
        current: Math.round(timeSpan),
        required: settings.minTimeSpanMinutes,
        message: `~${needed} more minutes of data needed`
      }
    };
  }
  
  /**
   * Is the newest reading still evidence?
   *
   * Inserted here, between the time-span gate and the oven gates, and it OUTRANKS
   * `stale_oven_data` on purpose. That ordering is the bug: a dial change logged
   * ten minutes ago satisfies the oven gate, so the app would happily advise from
   * a projection whose newest actual measurement of the meat was three hours old.
   * The oven setting is a thing the cook told the app; the reading is the only
   * thing the app knows about the roast.
   *
   * A projection is only as fresh as its newest reading, and past this age the
   * honest answer is to ask for another one rather than to keep extrapolating.
   */
  const staleAfter = settings.staleReadingMinutes ?? 45;
  const newest = readings[readings.length - 1];
  const readingAge = minutesBetween(newest.timestamp, now);
  
  if (readingAge > staleAfter) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.STALE_READING,
      blockerType: 'stale_reading',
      progress: {
        current: Math.round(readingAge),
        required: staleAfter,
        message: 'Log a fresh reading to resume advice'
      }
    };
  }
  
  // Check for recent oven temperature data
  if (ovenEvents.length === 0) {
    return {
      canRecommend: false,
      blockerReason: 'No oven temperature recorded. Please log your current oven setting.',
      blockerType: 'no_oven_data',
      progress: null
    };
  }
  
  const lastOvenEvent = ovenEvents[ovenEvents.length - 1];
  const isOvenOff = lastOvenEvent.isOff === true;
  
  /**
   * THE STALE-OVEN BLOCKER IS GONE, and this is the note explaining why it was
   * safe to remove now and not earlier.
   *
   * It was wrong in principle: an oven event that has not been touched for an
   * hour means the cook has not changed the dial, which is normal and good. It
   * also latched. The gate could only be cleared by logging an oven event, and
   * the app's own advice was what generated them - so a cook where the app
   * happened not to advise anything in the first hour went permanently silent,
   * with a valid projection saying "50 min late" that it refused to mention.
   *
   * Measured on its own, removing it made things WORSE: eight dial moves, four
   * reversals and a cook that never finished. It was suppressing an oscillation
   * by accident. So it stayed until the things that actually stop the oscillation
   * were in place - the dead-time gate, so the app is quiet until it has
   * something to say; the hold-is-not-a-request fix in reconcileWithOvenChange;
   * and the stale-READING gate, which withholds advice on the honest grounds
   * that the app has not looked at the meat lately rather than that it has not
   * been told about the oven lately.
   *
   * The age of the setting is still worth a glance, so it keeps its chip in the
   * status band (StatusCards, `isOvenStale`). What it no longer does is withhold
   * advice the app is otherwise ready to give.
   */
  
  // Check for desired serve time (required for timing recommendations)
  if (!desiredServeTime) {
    return {
      canRecommend: false,
      blockerReason: RECOMMENDATION_MESSAGES.NO_SERVE_TIME,
      blockerType: 'no_serve_time',
      progress: null
    };
  }
  
  // A refused projection is a blocker, and has to say so.
  //
  // Without this the refusal fell through to calculateRecommendation with
  // scheduleStatus 'unknown', which returns action 'none' and the string
  // "Unable to determine schedule status." - with canRecommend TRUE. So the app
  // presented a non-answer as though it were advice, in the panel where advice
  // goes, styled as advice. Refusing to project and admitting it are the same
  // decision; only one of them was implemented.
  //
  // Placed after the oven and serve-time gates: "confirm your oven setting" and
  // "set a serve time" are things the cook can act on, and this is not.
  if (projectionRefusedReason) {
    return {
      canRecommend: false,
      blockerReason: PROJECTION_REFUSAL_REASONS[projectionRefusedReason]
        ?? PROJECTION_REFUSAL_REASONS.default,
      blockerType: 'no_projection',
      // The specific cause, so the UI can offer the right control - "raise the
      // oven" for `unreachable` is a very different suggestion from "wait".
      blockerCode: projectionRefusedReason,
      progress: null
    };
  }
  
  /**
   * An off oven is not a data problem, so it is not blocked here.
   *
   * generateRecommendation now returns its restart-only advice BEFORE calling
   * this function, so this branch is only reached by a direct caller. It is kept
   * because the statement is still true - the rate measured across a pause is
   * meaningless and there is no point blocking on it - and because a direct
   * caller getting `canRecommend: false` for a paused oven would be wrong.
   */
  if (isOvenOff) {
    return {
      canRecommend: true,
      blockerReason: null,
      blockerType: null,
      progress: null,
      ovenIsOff: true
    };
  }
  
  /**
   * The confidence gate, on a CODE rather than on a substring of the reason.
   *
   * This block used to read `confidence.reason.includes('slow or negative')` and
   * `confidence.reason.includes('fluctuating')`, which made two prose fragments a
   * de-facto API: no test covered the coupling, and any copy edit to a
   * human-readable sentence would silently disable a blocker.
   *
   * One of those two branches was also permanently dead. It fired on R² < 0.7,
   * and R² over a three-point window cannot fall below about 0.75 - so the
   * `unstable_rate` blocker and the "readings are fluctuating" message had never
   * once been reached. The equivalent condition IS detectable now, from the RMS
   * residual of the curved fit in degrees, and the projection refuses upstream on
   * a rate that has stopped matching the readings ('rate-disagrees') - which is
   * why there is no branch for it here.
   *
   * `insufficient` now means the projection refused, and that has already been
   * caught by the no_projection gate above with a reason specific to the cause.
   * This is the belt to those braces, for a caller that supplies a confidence
   * without a matching refusal.
   */
  if (confidence.level === 'insufficient') {
    return {
      canRecommend: false,
      blockerReason: confidence.reason,
      blockerType: 'no_projection',
      blockerCode: confidence.code ?? null,
      progress: null
    };
  }
  
  return {
    canRecommend: true,
    blockerReason: null,
    blockerType: null,
    progress: null
  };
}

/**
 * Coldest core, in Fahrenheit, at which the app will suggest switching the oven
 * off.
 *
 * 140 °F is 60 °C, the top of the food-safety danger zone. Below it, switching
 * the oven off does two things the app cannot see the consequences of: it extends
 * the time the meat spends in the zone, and it lets the SURFACE - where the
 * bacteria are, and the only part the oven has actually been pasteurising - cool
 * back toward it.
 *
 * ---
 * THIS GUARD WAS WEAKENED ONCE AND HAS BEEN PUT BACK.
 *
 * A `FINAL_APPROACH_BAND_F = 25` exemption was added here, permitting a pause at
 * `pullTempF - 25`, on the reasoning that every red-meat target is below 140 °F
 * so a flat rule deletes the pause feature for the majority of cooks - and that
 * inside that band the roast is "about to leave the zone for good".
 *
 * The second half of that is false, and it was the half doing the work. For a
 * 121 °F pull the finished core never leaves the danger zone at all, so there is
 * no "leaving" for a pause to be safely adjacent to; the exemption simply opened
 * pausing at a 96 °F core, which is the middle of the zone. Measured across the
 * app's own presets it moved the threshold to:
 *
 *     pull 121 °F  ->  pause allowed from  96 °F core
 *     pull 125 °F  ->                     100 °F
 *     pull 130 °F  ->                     105 °F
 *
 * The first observation stands: this does remove the pause path for red meat.
 * That is the correct outcome and not a bug to design around. What remains for a
 * cook running early is the lower-the-dial ladder, which is most of the effect
 * and carries none of the risk; the pause is worth about twenty minutes. Pork and
 * poultry, whose targets are above 140 °F and whose cooks are long enough for a
 * hold to matter, keep it.
 */
export const MIN_CORE_FOR_OVEN_OFF_F = 140;

/**
 * Total oven-off minutes the app will suggest across one whole cook.
 *
 * MAX_OVEN_OFF_MINUTES bounds ONE suggestion; nothing bounded how many. The app
 * re-evaluates after every reading, so a cook who is hours early and does as they
 * are told gets a fresh 20-minute pause each time they restart - an unbounded
 * string of them, with the core sitting wherever it was. Four in a row was
 * reproducible on a single scenario.
 *
 * An hour in total is generous for a timing tool and finite, which is the point.
 */
export const MAX_CUMULATIVE_OVEN_OFF_MINUTES = 60;

/**
 * Minutes the oven has spent off across this cook, including any pause that is
 * still open.
 *
 * @param {OvenTempEvent[]} ovenEvents - Chronological
 * @param {string} now - ISO
 * @returns {number}
 */
export function totalOvenOffMinutes(ovenEvents, now) {
  if (!ovenEvents || ovenEvents.length === 0) return 0;
  let total = 0;
  let offSince = null;
  for (const event of ovenEvents) {
    if (event.isOff === true) {
      // Consecutive off events are one pause, not two.
      if (offSince === null) offSince = event.timestamp;
    } else if (offSince !== null) {
      total += Math.max(0, minutesBetween(offSince, event.timestamp));
      offSince = null;
    }
  }
  // A pause that has not ended yet still counts, and grows.
  if (offSince !== null) total += Math.max(0, minutesBetween(offSince, now));
  return total;
}

/**
 * Has a reading been logged since the oven last came back on?
 *
 * This is the pause's equivalent of assessOvenChangeEffect, and it exists because
 * that function deliberately does NOT cover pauses: it filters off events out
 * (`ovenEvents.filter(e => e.isOff !== true)`) on the grounds that an off event
 * suspends the set point rather than changing it. True as far as it goes, and it
 * left a hole - a pause never counted as an unmeasured change, so the instant the
 * cook restarted, the app re-evaluated against the same pre-pause readings,
 * concluded it was still early, and offered another pause.
 *
 * Measured on the deck: three pauses in eighty minutes on the overnight shoulder,
 * six trips to the oven, none of them informed by anything the previous one did.
 *
 * @param {InternalReading[]} readings - Chronological
 * @param {OvenTempEvent[]} ovenEvents - Chronological
 * @returns {boolean} true when there has been no pause, or a reading since it
 */
export function hasReadingSinceLastRestart(readings, ovenEvents) {
  if (!ovenEvents || ovenEvents.length === 0) return true;

  // The most recent restart: the first non-off event after the last off event.
  let lastOffIndex = -1;
  for (let i = ovenEvents.length - 1; i >= 0; i--) {
    if (ovenEvents[i].isOff === true) { lastOffIndex = i; break; }
  }
  if (lastOffIndex === -1) return true;                    // never paused
  const restart = ovenEvents.slice(lastOffIndex + 1).find((e) => e.isOff !== true);
  if (!restart) return true;                               // still paused now

  return (readings ?? []).some((r) => r.timestamp >= restart.timestamp);
}

/**
 * Is pausing the cook a timing tool here, or a food-safety problem?
 *
 * @param {number|null} latestCoreTempF
 * @param {Object} [options]
 * @param {number} [options.pausedMinutesSoFar] - From totalOvenOffMinutes
 * @param {boolean} [options.pauseEffectMeasured] - From hasReadingSinceLastRestart
 * @param {number} [options.minutesEarly] - How early the cook is running. A pause
 *   buys ~8-10 min, so past the whole budget it cannot help and should not be
 *   offered as though it could.
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function mayPauseCooking(
  latestCoreTempF,
  { pausedMinutesSoFar = 0, pauseEffectMeasured = true, minutesEarly = null } = {}
) {
  // No reading: nothing to reason from, and guessing about food safety is not
  // the thing to do. Every path in this file passes the newest reading.
  if (!Number.isFinite(latestCoreTempF)) {
    return { allowed: false, reason: 'no-reading' };
  }
  if (latestCoreTempF < MIN_CORE_FOR_OVEN_OFF_F) {
    return { allowed: false, reason: 'danger-zone' };
  }
  if (pausedMinutesSoFar >= MAX_CUMULATIVE_OVEN_OFF_MINUTES) {
    return { allowed: false, reason: 'pause-budget-spent' };
  }
  /**
   * Checked LAST of the three, so the message a cook sees names the durable
   * reason rather than the transient one: "the core is too cool for this" and
   * "you have paused enough today" both outrank "wait for a reading".
   */
  if (!pauseEffectMeasured) {
    return { allowed: false, reason: 'pause-unmeasured' };
  }
  /**
   * Is a pause big enough to be worth suggesting?
   *
   * Measured oven-off efficiency is 0.4-0.53 - a closed oven gives up its heat
   * slowly, so the meat keeps climbing through most of the pause. One 20-minute
   * pause therefore buys about 8-10 minutes, and the whole
   * MAX_CUMULATIVE_OVEN_OFF_MINUTES budget buys around half an hour.
   *
   * So offering a pause to a cook who is four hours early is not conservative
   * advice, it is ineffective advice dressed as a remedy. On the overnight
   * shoulder it produced three pauses and six trips to the oven against a
   * 229-minute gap it could not begin to close - and, because that gap came from
   * a projection the unmodelled stall had made too fast, the pauses made a roast
   * that was really going to be LATE later still.
   *
   * Past this, the honest answer is that the roast will be early and the oven is
   * already as low as it goes.
   */
  if (Number.isFinite(minutesEarly) && minutesEarly > MAX_CUMULATIVE_OVEN_OFF_MINUTES) {
    return { allowed: false, reason: 'pause-cannot-help' };
  }
  return { allowed: true, reason: null };
}

/** Longest pause the app will ever suggest, in minutes. */
export const MAX_OVEN_OFF_MINUTES = 20;

/**
 * How far above the pull temperature the oven must stay, in °F.
 *
 * The core asymptotes to the oven, so an oven at the pull temperature means the
 * roast approaches it and never arrives. This is the headroom that keeps the last
 * few degrees a matter of minutes rather than hours.
 */
export const MIN_OVEN_HEADROOM_F = 25;

/**
 * How long to pause the cook for.
 *
 * Half of however early the cook is running, capped hard.
 *
 * The cap is 20 minutes, not 45. Measured oven-off efficiency in the harness is
 * 0.4-0.53: a closed oven with the element off gives up its heat slowly
 * (tauOvenCoolMin 45), so the meat keeps climbing through most of the pause and
 * 45 minutes of oven-off buys only about 20 minutes of delay. Suggesting 45
 * therefore promised more than twice what it delivered, and the cook came back
 * to a roast that had carried on cooking.
 *
 * The `!predictedMinutesToTarget` branch that used to sit at the top of this
 * function - a 0.4x heuristic - was unreachable: the only caller is inside the
 * 'early' branch of calculateRecommendation, which is only entered when a
 * schedule variance exists, and a schedule variance requires a projection. It
 * has been deleted rather than left as a second, differently-tuned answer to the
 * same question.
 *
 * @param {number} scheduleVarianceMinutes - How early we're running (positive)
 * @returns {number} Suggested pause duration in minutes
 */
function calculateOvenOffDuration(scheduleVarianceMinutes) {
  const suggestedPause = Math.round(Math.abs(scheduleVarianceMinutes) * 0.5);
  return Math.max(5, Math.min(MAX_OVEN_OFF_MINUTES, suggestedPause));
}

/**
 * Calculate the recommended oven temperature adjustment
 * 
 * @param {Object} params
 * @param {number} params.ovenBaseTemp - The oven temperature to adjust FROM (°F).
 *   This is the last temperature actually set, not `currentOvenTemp`, which is 0
 *   while the oven is off - adjusting from 0 yields a nonsense set point.
 * @param {number} params.scheduleVarianceMinutes - Positive = late, negative = early
 * @param {'early'|'late'|'on-track'} params.scheduleStatus
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @param {number|null} [params.latestCoreTempF] - Newest reading (°F). Pausing
 *   the cook is refused in the danger zone, and without this the function had no
 *   way to know - it was advising oven-off at any core temperature at all.
 * @param {number|null} [params.targetTempF] - Pull target (°F), for the
 *   oven-headroom floor
 * @param {number} [params.pausedMinutesSoFar] - Oven-off minutes already spent
 *   this cook, from totalOvenOffMinutes. Bounds the TOTAL, where
 *   MAX_OVEN_OFF_MINUTES only bounds one suggestion.
 * @param {boolean} [params.pauseEffectMeasured] - Whether a reading has been
 *   logged since the oven last came back on; see hasReadingSinceLastRestart
 * @param {'F'|'C'} [params.displayUnits] - Unit the user's dial is marked in;
 *   suggestions are snapped to a settable increment in that unit
 * @returns {Object} Recommendation details
 */
export function calculateRecommendation({
  ovenBaseTemp,
  scheduleVarianceMinutes,
  scheduleStatus,
  settings,
  predictedMinutesToTarget,
  currentRate,
  latestCoreTempF = null,
  targetTempF = null,
  pausedMinutesSoFar = 0,
  pauseEffectMeasured = true,
  displayUnits = 'F'
}) {
  const {
    recommendationStepF,
    recommendationMaxStepF,
    ovenTempMaxF,
    onTrackThresholdMinutes
  } = settings;

  /**
   * Every branch below does arithmetic on `ovenBaseTemp`, and none of them
   * checked it. An absent or non-numeric dial produced `suggestedTemp: NaN` with
   * `action: 'lower'` and a confident sentence around it - the UI would render
   * "Set oven to NaN" and the Apply button would write it. Same class as the
   * unguarded rate that used to throw a RangeError out of the whole status panel:
   * a missing input has to become a refusal, not a number.
   */
  if (!Number.isFinite(ovenBaseTemp)) {
    return {
      action: 'none',
      suggestedTemp: null,
      changeAmount: null,
      message: 'The oven setting is not known, so there is no change to suggest.',
      reasoning: 'Log the oven temperature and advice will resume.',
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal'
    };
  }
  
  // On track - recommend holding steady
  if (scheduleStatus === 'on-track') {
    return {
      action: 'hold',
      suggestedTemp: ovenBaseTemp,
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.HOLD,
      reasoning: `Predicted to finish within ${onTrackThresholdMinutes} minutes of your target time.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal'
    };
  }
  
  /**
   * TOO LATE FOR THE DIAL TO MATTER.
   *
   * `predictedMinutesToTarget` and `currentRate` were destructured at the top of
   * this function and then referenced nowhere in its body: the step ladder chose
   * its size purely from how far off schedule the cook was, with no notion of
   * whether there was time left for a change to do anything.
   *
   * So `{ predictedMinutesToTarget: 1, scheduleVarianceMinutes: 31 }` returned
   * "raise to 300". With ovenChangeLagMinutes at 15 and the oven's own time
   * constant at 10, a change made one minute from the target cannot move the
   * finish time at all. It is a wasted trip to the kitchen, and worse than that:
   * it puts surface heat into the roast during the final approach, which is
   * exactly where overshoot comes from. The last few minutes are the ones where
   * the dial should be left alone.
   *
   * Both directions, because neither works. Not applied to the pause path below,
   * which is reached from the early branch and is a different lever.
   */
  const changeLagMinutes = settings.ovenChangeLagMinutes ?? 15;
  if (Number.isFinite(predictedMinutesToTarget)
      && predictedMinutesToTarget < changeLagMinutes
      && (scheduleStatus === 'late' || scheduleStatus === 'early')) {
    return {
      action: 'hold',
      suggestedTemp: ovenBaseTemp,
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.HOLD_ENDGAME,
      reasoning:
        `About ${Math.round(predictedMinutesToTarget)} minutes to go, and a dial ` +
        `change takes around ${changeLagMinutes} to show up in the core - so ` +
        'nothing set now would change when this is done. It will be roughly ' +
        `${Math.round(Math.abs(scheduleVarianceMinutes))} minutes ` +
        `${scheduleStatus === 'late' ? 'late' : 'early'}.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal'
    };
  }

  // Running late - suggest raising temperature
  if (scheduleStatus === 'late') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how late
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very late - suggest larger increase
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'urgent';
    } else if (absVariance > 15) {
      // Moderately late
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'moderate';
    } else {
      // Slightly late
      changeAmount = recommendationStepF;
      severity = 'normal';
    }
    
    // Snap to something the dial can actually be set to, then take the change
    // amount back off the snapped value so the two can never disagree.
    let suggestedTemp = snapToDial(ovenBaseTemp + changeAmount, displayUnits);
    // Snapping rounds to the NEAREST mark, which can land past
    // recommendationMaxStepF - the cap above is applied to the unsnapped step.
    // On a Celsius dial the marks are 5°C (9°F) apart, so a 25°F cap emitted a
    // 27°F (15°C) suggestion. Step back to the mark below the cap.
    if (suggestedTemp - ovenBaseTemp > recommendationMaxStepF) {
      suggestedTemp = snapToDial(ovenBaseTemp + recommendationMaxStepF, displayUnits, 'down');
    }
    if (suggestedTemp <= ovenBaseTemp) {
      // Snapping swallowed the whole step - move by one dial increment instead
      // of emitting a "change" that leaves the dial where it already is. One
      // increment can itself exceed the cap on a coarse dial; a change the user
      // can actually make is the lesser evil.
      suggestedTemp = snapToDial(ovenBaseTemp + dialStepF(displayUnits), displayUnits, 'up');
    }
    changeAmount = suggestedTemp - ovenBaseTemp;
    
    // Apply upper bound guardrail
    if (suggestedTemp > ovenTempMaxF) {
      suggestedTemp = snapToDial(ovenTempMaxF, displayUnits, 'down');
      changeAmount = suggestedTemp - ovenBaseTemp;
      
      // If already at max, can't recommend higher
      if (changeAmount <= 0) {
        return {
          action: 'hold',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: `Already at maximum recommended temperature ({maxTemp}). Consider extending your timeline if possible.`,
          reasoning: `Running ${Math.round(absVariance)} minutes late, but oven is already at the upper limit for low-and-slow cooking.`,
          alternativeMessage: null,
          ovenOffMinutes: null,
          practicalMinF: null,
          maxTempF: ovenTempMaxF, // For formatting in composable
          severity: 'warning'
        };
      }
    }
    
    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.RAISE_LARGE 
      : RECOMMENDATION_MESSAGES.RAISE_SMALL;
    
    return {
      action: 'raise',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: messageTemplate,
      reasoning: `Running approximately ${Math.round(absVariance)} minutes late. Increasing oven temperature will speed up heating.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity
    };
  }
  
  // Running early - suggest lowering temperature
  if (scheduleStatus === 'early') {
    const absVariance = Math.abs(scheduleVarianceMinutes);
    
    // Determine step size based on how early
    let changeAmount;
    let severity;
    
    if (absVariance > 30) {
      // Very early - suggest larger decrease
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 2.5);
      severity = 'moderate';
    } else if (absVariance > 15) {
      // Moderately early
      changeAmount = Math.min(recommendationMaxStepF, recommendationStepF * 1.5);
      severity = 'normal';
    } else {
      // Slightly early
      changeAmount = recommendationStepF;
      severity = 'normal';
    }
    
    // Snap to something the dial can actually be set to (see the raise branch)
    let suggestedTemp = snapToDial(ovenBaseTemp - changeAmount, displayUnits);
    if (ovenBaseTemp - suggestedTemp > recommendationMaxStepF) {
      suggestedTemp = snapToDial(ovenBaseTemp - recommendationMaxStepF, displayUnits, 'up');
    }
    if (suggestedTemp >= ovenBaseTemp) {
      suggestedTemp = snapToDial(ovenBaseTemp - dialStepF(displayUnits), displayUnits, 'down');
    }

    /**
     * ONE FLOOR ON LOWERING, not two competing ones.
     *
     * Two separate reasons the dial cannot go lower, and they used to be checked
     * in sequence with the first one returning - which meant the second was
     * unreachable whenever the first bound, and the pause path below was
     * unreachable whenever either did.
     *
     *  - the PRACTICAL minimum: most ovens will not hold below ~175 °F.
     *  - the TARGET HEADROOM: the core asymptotes to the oven, so an oven within
     *    MIN_OVEN_HEADROOM_F of the target means the roast approaches it and
     *    never arrives. Found by the harness costing a whole cook - a shoulder
     *    told to lower to 200 °F for a 195 °F target crept for seven hours and
     *    finished 38 °F short.
     *
     * The binding floor is whichever is higher.
     */
    const practicalMinF = settings.ovenTempPracticalMinF || 175;
    const practicalMinSetting = snapToDial(practicalMinF, displayUnits, 'up');
    const headroomFloor = Number.isFinite(targetTempF)
      ? snapToDial(targetTempF + MIN_OVEN_HEADROOM_F, displayUnits, 'up')
      : -Infinity;
    const loweringFloor = Math.max(practicalMinSetting, headroomFloor);
    const headroomBinds = headroomFloor > practicalMinSetting;
    const enableLowTemp = settings.enableLowTempRecommendations !== false;

    if (suggestedTemp < loweringFloor) {
      // There is still room to come down - just not as far as asked.
      if (ovenBaseTemp > loweringFloor) {
        suggestedTemp = loweringFloor;
        const changeToFloor = ovenBaseTemp - suggestedTemp;
        return {
          action: 'lower',
          suggestedTemp: Math.round(suggestedTemp),
          changeAmount: Math.round(changeToFloor),
          message: absVariance > 30
            ? RECOMMENDATION_MESSAGES.LOWER_LARGE
            : RECOMMENDATION_MESSAGES.LOWER_SMALL,
          /**
           * Placeholders, not literals. This sentence used to be assembled here
           * with `${MIN_OVEN_HEADROOM_F}°F` and `${targetTempF}°F` in it, so a
           * Celsius cook read "25°F above your 191°F pull" beside a screen showing
           * 88 °C. The substitution layer in useRecommendations converts and
           * formats; the service's job is to say which numbers, not how to write
           * them.
           */
          reasoning: headroomBinds
            ? `Running approximately ${Math.round(absVariance)} minutes early. This is as low as the oven can go and still finish the roast - it has to stay at least {headroom} above your {pullTemp} pull temperature.`
            : `Running approximately ${Math.round(absVariance)} minutes early. This is the practical minimum for most ovens.`,
          alternativeMessage: null,
          ovenOffMinutes: null,
          practicalMinF: null,
          headroomF: MIN_OVEN_HEADROOM_F,
          pullTempF: Math.round(targetTempF),
          severity
        };
      }

      /**
       * The dial is already at or below the floor, so lowering is finished as a
       * lever. A PAUSE still is not: it is temporary, and it does not change the
       * oven's steady state - which is the only thing the headroom floor is
       * about. Gating the pause on that floor was wrong, and it made the pause
       * feature unreachable for every cook whose target was within 25 °F of its
       * oven.
       */
      const pauseCheck = mayPauseCooking(latestCoreTempF, {
        pausedMinutesSoFar,
        pauseEffectMeasured,
        minutesEarly: absVariance
      });

      if (!pauseCheck.allowed) {
        /**
         * Nothing left to do but let it run. The message has to name the dial the
         * cook is ACTUALLY on: the earlier version reported the floor
         * ("220°F is as low as the oven can go") while the dial sat at 200, which
         * is simply false.
         */
        const reasons = {
          'danger-zone': `Running ${Math.round(absVariance)} minutes early, and the oven is as low as it can usefully go. Pausing is not offered below {safeTemp} core: switching the oven off lets the surface - the part the heat has actually been pasteurising - cool back toward the food-safety danger zone, for a stretch the app cannot police.`,
          'pause-budget-spent': `Running ${Math.round(absVariance)} minutes early, but the oven has already been off for about ${Math.round(pausedMinutesSoFar)} minutes this cook. Each further pause keeps the meat cool for longer in total, so there are no more to offer.`,
          'no-reading': `Running ${Math.round(absVariance)} minutes early. A fresh reading is needed before pausing can be considered.`,
          'pause-unmeasured': `Running ${Math.round(absVariance)} minutes early, but nothing has been measured since the oven came back on - so how much the last pause bought is unknown. Log a reading before pausing again.`,
          'pause-cannot-help': `Running ${Math.round(absVariance)} minutes early with the oven already as low as it can usefully go. Switching it off would not close a gap that size - a pause buys eight or ten minutes, not hours - so there is nothing further to do but serve a little early or find something to hold the meat in.`
        };
        return {
          action: 'hold',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: {
            'pause-budget-spent': RECOMMENDATION_MESSAGES.EARLY_PAUSE_BUDGET_SPENT,
            'pause-unmeasured': RECOMMENDATION_MESSAGES.EARLY_PAUSE_UNMEASURED,
            'pause-cannot-help': RECOMMENDATION_MESSAGES.EARLY_BEYOND_HELP
          }[pauseCheck.reason] ?? RECOMMENDATION_MESSAGES.EARLY_NO_PAUSE_YET,
          reasoning: reasons[pauseCheck.reason] ?? reasons['danger-zone'],
          alternativeMessage: null,
          ovenOffMinutes: null,
          // The dial the cook is on, so {minTemp} names something true.
          minTempF: Math.round(ovenBaseTemp),
          // EARLY_NO_PAUSE_YET names the food-safety floor; it used to write it as
          // a "140°F" literal, which a Celsius cook read verbatim.
          safeCoreF: MIN_CORE_FOR_OVEN_OFF_F,
          practicalMinF: null,
          severity: 'info'
        };
      }

      const ovenOffMinutes = calculateOvenOffDuration(absVariance);

      if (!enableLowTemp) {
        return {
          action: 'oven-off',
          suggestedTemp: ovenBaseTemp,
          changeAmount: 0,
          message: RECOMMENDATION_MESSAGES.LOW_TEMP_DISABLED,
          reasoning: `Running ${Math.round(absVariance)} minutes early. Low temperature recommendations are disabled, but you can pause cooking temporarily.`,
          alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_ALTERNATIVE,
          ovenOffMinutes,
          practicalMinF: Math.round(ovenBaseTemp),
          severity: 'moderate'
        };
      }

      return {
        action: 'oven-off',
        suggestedTemp: ovenBaseTemp,
        changeAmount: 0,
        message: RECOMMENDATION_MESSAGES.OVEN_OFF_SUGGESTED,
        reasoning: `Running ${Math.round(absVariance)} minutes early. Your oven is already as low as it can usefully go.`,
        alternativeMessage: RECOMMENDATION_MESSAGES.OVEN_OFF_ALTERNATIVE,
        ovenOffMinutes,
        practicalMinF: null,
        severity: 'moderate'
      };
    }

    const messageTemplate = absVariance > 30 
      ? RECOMMENDATION_MESSAGES.LOWER_LARGE 
      : RECOMMENDATION_MESSAGES.LOWER_SMALL;
    
    return {
      action: 'lower',
      suggestedTemp: Math.round(suggestedTemp),
      changeAmount: Math.round(changeAmount),
      message: messageTemplate,
      reasoning: `Running approximately ${Math.round(absVariance)} minutes early. Lowering oven temperature will slow down heating.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity
    };
  }
  
  // Unknown status - no recommendation
  return {
    action: 'none',
    suggestedTemp: null,
    changeAmount: null,
    message: 'Unable to determine schedule status.',
    reasoning: 'Insufficient data to calculate timing.',
    alternativeMessage: null,
    ovenOffMinutes: null,
    practicalMinF: null,
    severity: 'unknown'
  };
}

/**
 * Work out which oven set point the current readings actually describe.
 *
 * A dial change cannot show up in the meat's heating rate immediately - there is
 * thermal lag, and then readings have to be taken. Until that has happened the
 * measured rate, and every projection built on it, still describes the PREVIOUS
 * setting. Recommendations that ignore this compound: each change is re-applied
 * on top of the one just made, walking the oven a step further every update.
 *
 * The evidence set point is the newest one with enough post-lag readings behind
 * it. Anything set after that is, so far, unmeasured.
 *
 * @param {Object} params
 * @param {InternalReading[]} params.readings - Readings in chronological order
 * @param {OvenTempEvent[]} params.ovenEvents - Oven events in chronological order
 * @param {AppSettings} params.settings
 * @param {string} [params.now]
 * @returns {{settled: boolean, evidenceTemp: number|null, currentTemp: number|null,
 *   minutesSinceChange: number|null, waitMinutes: number|null,
 *   readingsSinceChange: number, readingsNeeded: number}}
 */
export function assessOvenChangeEffect({
  readings,
  ovenEvents,
  settings,
  now = new Date().toISOString()
}) {
  const lagMinutes = settings.ovenChangeLagMinutes ?? 15;
  const readingsNeeded = settings.ovenChangeSettleReadings ?? 2;
  
  const settledResult = {
    settled: true,
    evidenceTemp: null,
    currentTemp: null,
    minutesSinceChange: null,
    waitMinutes: null,
    readingsSinceChange: 0,
    readingsNeeded
  };
  
  // Off events do not move the set point - they suspend it - so they are not
  // changes to reason about here. The pause branch handles that state.
  const active = ovenEvents.filter(e => e.isOff !== true);
  if (active.length === 0) return settledResult;
  
  const readingsAfterLag = (timestamp) => {
    const visibleFrom = addMinutes(timestamp, lagMinutes);
    return readings.filter(r => minutesBetween(visibleFrom, r.timestamp) >= 0).length;
  };
  
  const currentIndex = active.length - 1;
  
  let evidenceIndex = -1;
  for (let i = currentIndex; i >= 0; i--) {
    if (readingsAfterLag(active[i].timestamp) >= readingsNeeded) {
      evidenceIndex = i;
      break;
    }
  }
  
  // Nothing has been measured yet. With a single set point that is simply the
  // start of the cook (the eligibility gate vouches for the data); with several,
  // the oldest is the safest thing to anchor to - it is the one the earliest
  // readings belong to.
  const baseIndex = evidenceIndex === -1 ? 0 : evidenceIndex;
  
  const evidenceTemp = active[baseIndex].setTemp;
  const currentTemp = active[currentIndex].setTemp;
  const current = active[currentIndex];
  
  // A dial moved away and back again nets out: the readings describe the setting
  // that is in force, so there is nothing to wait for.
  if (baseIndex === currentIndex || evidenceTemp === currentTemp) {
    return { ...settledResult, evidenceTemp, currentTemp };
  }
  
  const visibleFrom = addMinutes(current.timestamp, lagMinutes);
  
  return {
    settled: false,
    evidenceTemp,
    currentTemp,
    minutesSinceChange: Math.round(minutesBetween(current.timestamp, now)),
    waitMinutes: Math.max(0, Math.round(minutesBetween(now, visibleFrom))),
    readingsSinceChange: readingsAfterLag(current.timestamp),
    readingsNeeded
  };
}

/**
 * Turn a recommendation computed from the *measured* set point into advice about
 * the set point the oven is actually on.
 *
 * Two cases matter. If the dial is already at (or acceptably near) the
 * temperature the projection calls for, the change is accepted and nothing more
 * is asked for - the app says so rather than re-issuing the same step. If the
 * dial is somewhere else, the target is restated as an absolute temperature; it
 * is never re-derived from the new set point, which is what made repeated
 * changes drift.
 *
 * @param {Object} params
 * @param {Object} params.recommendation - Result of calculateRecommendation for
 *   the measured (pre-change) set point
 * @param {number} params.currentOvenTemp - Set point the oven is on now (°F)
 * @param {Object} params.effect - Result of assessOvenChangeEffect
 * @param {AppSettings} params.settings
 * @param {'F'|'C'} [params.displayUnits]
 * @returns {Partial<Recommendation>}
 */
export function reconcileWithOvenChange({
  recommendation,
  currentOvenTemp,
  effect,
  settings,
  displayUnits = 'F'
}) {
  const settleFields = {
    awaitingEffect: true,
    ovenChangeMinutesAgo: effect.minutesSinceChange,
    waitMinutes: effect.waitMinutes
  };
  
  // Pausing advice is about the clock, not the dial: it survives a set point
  // change intact, except that the restart should name the new setting.
  if (recommendation.action === 'oven-off') {
    return { ...recommendation, suggestedTemp: currentOvenTemp, ...settleFields };
  }
  
  const implied = recommendation.suggestedTemp;
  if (implied === null || currentOvenTemp === null) {
    return { ...recommendation, ...settleFields };
  }
  
  const step = settings.recommendationStepF ?? 10;
  // Half a dial increment covers a user rounding the suggestion to a mark they
  // can actually hit; half a step covers the coarseness of the step itself.
  const tolerance = Math.max(dialStepF(displayUnits) / 2, step / 2);
  const gap = implied - currentOvenTemp; // positive: the oven is still too cool
  
  // Moving FURTHER than asked, in the direction that was asked for, must never
  // be answered by asking for the opposite move. The projection this target
  // came from was measured at the old set point, so it cannot yet see - and
  // cannot judge the size of - the change that has since been made. Reversing
  // on it is how "running 42 min early" ended up being told to raise the oven.
  // Hold, and let a reading decide.
  //
  // A HOLD counts as overshot for the same reason, and this is the case that
  // produced a genuine oscillator once readings got dense enough to expose it:
  //
  //   the app asks for 215; the cook sets 215; the next reading still describes
  //   200, and under 200 the projection now says on-track, so `hold` comes back
  //   with suggestedTemp = 200 - the MEASURED set point, not a request. Read as
  //   a target, that says "go to 200", so the dial is dragged back. One reading
  //   later the 200 is itself unmeasured, evidence is 215, on-track again, and
  //   the app asks for 215. Four reversals in seventy minutes, each one a trip
  //   to the oven, and the roast fine throughout.
  //
  // The projection is not ASKING for anything when it holds. Its suggestedTemp is
  // the set point it was measured at, and treating that as a request is the
  // error. So: hold + an unmeasured change = settling, always.
  const overshot = recommendation.action === 'lower'
    ? gap > 0
    : recommendation.action === 'raise'
      ? gap < 0
      : recommendation.action === 'hold';
  
  if (Math.abs(gap) <= tolerance) {
    return {
      action: 'settling',
      suggestedTemp: currentOvenTemp,
      changeAmount: 0,
      message: effect.waitMinutes > 0
        ? RECOMMENDATION_MESSAGES.SETTLING_ON_PLAN
        : RECOMMENDATION_MESSAGES.SETTLING_ON_PLAN_READY,
      reasoning: `The oven was changed ${effect.minutesSinceChange} min ago and the readings so far still describe the previous setting. The setting you chose is what the projection calls for, so there is nothing to change until a reading shows the effect.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal',
      ...settleFields
    };
  }
  
  if (overshot) {
    const asked = recommendation.action === 'lower'
      ? 'a drop to'
      : recommendation.action === 'raise'
        ? 'a rise to'
        : 'no change from';
    return {
      action: 'settling',
      suggestedTemp: currentOvenTemp,
      // The plan the dial has overshot, named so the message can say what was
      // asked for without the button offering to undo it.
      plannedTempF: Math.round(implied),
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.SETTLING_BEYOND_PLAN,
      // {plannedTemp} rather than a formatted number: only the composable
      // knows which unit the cook is reading.
      reasoning: `The oven was changed ${effect.minutesSinceChange} min ago, so the projection still describes the previous setting - it asked for ${asked} {plannedTemp} and the dial has gone past that. Reversing now would be correcting a change no reading has measured yet.`,
      alternativeMessage: null,
      ovenOffMinutes: null,
      practicalMinF: null,
      severity: 'normal',
      ...settleFields
    };
  }
  
  return {
    ...recommendation,
    action: gap > 0 ? 'raise' : 'lower',
    suggestedTemp: Math.round(implied),
    /**
     * NO CHANGE AMOUNT, deliberately.
     *
     * This branch restates the projection's target as an ABSOLUTE temperature -
     * that is precisely how it avoids stacking one change on another. The distance
     * from wherever the cook has just put the dial to that target is not a step,
     * is not bounded by recommendationMaxStepF, and reached the screen as a
     * "-50°F" chip that looked like a step the app was asking for and exceeded its
     * own limit.
     *
     * Capping the number would have been worse: a chip reading "-25°F" beside a
     * suggestion to go from 250 to 200 is simply false. The honest answer is that
     * there is no step to show here, so the chip does not render.
     */
    changeAmount: null,
    message: RECOMMENDATION_MESSAGES.SETTLING_RETARGET,
    reasoning: `The oven was changed ${effect.minutesSinceChange} min ago, so the projection still reflects the previous setting. This target comes from that projection - it is not stacked on top of the change you already made.`,
    ...settleFields
  };
}

/**
 * Generate the full recommendation result including eligibility check
 * 
 * Branch order matters: reaching the target and needing a post-pause reading both
 * short-circuit ahead of the eligibility check and the projection-based branches.
 * 
 * @param {Object} params
 * @param {InternalReading[]} params.readings - Readings in chronological order
 * @param {OvenTempEvent[]} params.ovenEvents
 * @param {number} params.ovenBaseTemp - Current oven temp in °F
 * @param {number} params.pullTempF - The temperature the cook stops at, in °F.
 *   NOT the serving temperature - see carryoverService.js.
 * @param {string|null} params.desiredServeTime
 * @param {number|null} params.scheduleVarianceMinutes
 * @param {'early'|'late'|'on-track'|'unknown'} params.scheduleStatus
 * @param {Object} params.confidence
 * @param {AppSettings} params.settings
 * @param {number|null} params.predictedMinutesToTarget - Minutes until target at current rate
 * @param {number|null} params.currentRate - Current heating rate in °F/hour
 * @param {string|null} [params.projectionRefusedReason] - Why there is no
 *   projection, if there is none
 * @param {'F'|'C'} [params.displayUnits] - Unit the user's oven dial is marked in
 * @returns {Recommendation}
 */
export function generateRecommendation({
  readings,
  ovenEvents,
  ovenBaseTemp,
  pullTempF,
  desiredServeTime,
  scheduleVarianceMinutes,
  scheduleStatus,
  confidence,
  settings,
  predictedMinutesToTarget,
  currentRate,
  projectionRefusedReason = null,
  displayUnits = 'F',
  now = new Date().toISOString()
}) {
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  
  // Already at or past the pull temperature - projections are meaningless from
  // here, so skip straight to the done state rather than advising an oven change.
  //
  // Through assessPullProgress, which is the app's one answer to "is it done
  // yet". There were four separate implementations of this comparison and one of
  // them compared in display units, so a Celsius session could get two different
  // verdicts about the same roast on the same screen.
  const pullProgress = assessPullProgress(latestReading?.temp ?? null, pullTempF);
  if (latestReading && (pullProgress.state === 'at-pull' || pullProgress.state === 'over')) {
    return buildRecommendationResult({
      action: 'at-target',
      message: RECOMMENDATION_MESSAGES.AT_TARGET,
      reasoning: 'The latest reading is at or above your target temperature, so no further oven changes will help.',
      latestReadingTemp: latestReading.temp,
      severity: 'info'
    });
  }
  
  const lastOvenEvent = ovenEvents.length > 0 ? ovenEvents[ovenEvents.length - 1] : null;
  const isOvenOff = lastOvenEvent !== null && lastOvenEvent.isOff === true;
  
  // Cooking is paused and nothing has been logged since. We deliberately do not
  // estimate how far the meat has cooled - ask for a real measurement instead.
  if (isOvenOff && !hasReadingSince(readings, lastOvenEvent.timestamp)) {
    return buildRecommendationResult({
      action: 'needs-reading',
      message: RECOMMENDATION_MESSAGES.NEEDS_READING,
      reasoning: 'Meat temperature while the oven is off is not estimated. A reading taken since the pause started is needed before recommendations can resume.',
      severity: 'moderate'
    });
  }
  
  /**
   * The oven is off, and a reading since the pause exists (the branch above
   * guarantees it). Restarting it is the only advice that means anything.
   *
   * AHEAD OF THE ELIGIBILITY GATE, and that ordering was a bug when it was the
   * other way round. The projection under an off oven is legitimately
   * `unreachable` - a cooling roast never reaches its target - so the gate fired
   * first and the panel told the cook "the oven is not hot enough to reach your
   * target, raise it" about an oven that was switched off. True, useless, and
   * confusing.
   *
   * It also sits ahead of the data-quality gates on purpose. Whether the readings
   * span thirty minutes or three has no bearing on it: the oven is off, and it
   * needs to be on.
   */
  if (isOvenOff) {
    return buildRecommendationResult({
      action: 'restart-oven',
      suggestedTemp: ovenBaseTemp,
      changeAmount: 0,
      message: RECOMMENDATION_MESSAGES.RESTART_OVEN,
      reasoning: 'The oven is off. Nothing else can be advised until it is back on: every projection-based suggestion assumes the oven is heating, and the measured rate across a pause describes cooling.',
      latestReadingTemp: latestReading ? latestReading.temp : null,
      severity: 'moderate'
    });
  }
  
  // Then check eligibility
  const eligibility = checkRecommendationEligibility({
    readings,
    ovenEvents,
    desiredServeTime,
    settings,
    confidence,
    projectionRefusedReason,
    now
  });
  
  if (!eligibility.canRecommend) {
    return buildRecommendationResult({
      canRecommend: false,
      blockerReason: eligibility.blockerReason,
      blockerType: eligibility.blockerType,
      progress: eligibility.progress
    });
  }
  
  // A dial change that has not reached the readings yet is the one case where
  // the current set point is the wrong thing to advise from: the projection
  // still describes the previous setting, so the advice is anchored there and
  // then reconciled against where the dial actually is. Without this the same
  // step is re-applied on top of every change, manual or applied from here.
  const changeEffect = assessOvenChangeEffect({ readings, ovenEvents, settings, now });
  
  if (!changeEffect.settled) {
    const measured = calculateRecommendation({
      ovenBaseTemp: changeEffect.evidenceTemp,
      scheduleVarianceMinutes,
      scheduleStatus,
      settings,
      predictedMinutesToTarget,
      currentRate,
      latestCoreTempF: latestReading ? latestReading.temp : null,
      targetTempF: pullTempF,
      pausedMinutesSoFar: totalOvenOffMinutes(ovenEvents, now),
      pauseEffectMeasured: hasReadingSinceLastRestart(readings, ovenEvents),
      displayUnits
    });
    
    return buildRecommendationResult({
      ...reconcileWithOvenChange({
        recommendation: measured,
        currentOvenTemp: ovenBaseTemp,
        effect: changeEffect,
        settings,
        displayUnits
      }),
      latestReadingTemp: latestReading ? latestReading.temp : null
    });
  }
  
  // Normal recommendation. The oven is on: the paused case returned above.
  const recommendation = calculateRecommendation({
    ovenBaseTemp,
    scheduleVarianceMinutes,
    scheduleStatus,
    settings,
    predictedMinutesToTarget,
    currentRate,
    latestCoreTempF: latestReading ? latestReading.temp : null,
    targetTempF: pullTempF,
    pausedMinutesSoFar: totalOvenOffMinutes(ovenEvents, now),
    pauseEffectMeasured: hasReadingSinceLastRestart(readings, ovenEvents),
    displayUnits
  });
  
  return buildRecommendationResult({
    ...recommendation,
    latestReadingTemp: latestReading ? latestReading.temp : null
  });
}

/**
 * Analyze how oven temperature changes have affected heating rate (nice-to-have)
 * This provides feedback on observed responsiveness
 * 
 * @param {InternalReading[]} readings
 * @param {OvenTempEvent[]} ovenEvents
 * @returns {Object|null} Responsiveness analysis or null if insufficient data
 */
export function analyzeOvenResponsiveness(readings, ovenEvents) {
  if (ovenEvents.length < 2 || readings.length < 5) {
    return null;
  }
  
  const segments = [];
  
  // Analyze each oven temperature segment
  for (let i = 0; i < ovenEvents.length; i++) {
    const segmentStart = new Date(ovenEvents[i].timestamp);
    const segmentEnd = i < ovenEvents.length - 1 
      ? new Date(ovenEvents[i + 1].timestamp)
      : new Date();
    
    // Find readings within this segment (with some delay for thermal lag)
    const lagMinutes = 15; // Thermal lag before oven change affects meat
    const effectiveStart = new Date(segmentStart.getTime() + lagMinutes * 60 * 1000);
    
    const segmentReadings = readings.filter(r => {
      const time = new Date(r.timestamp);
      return time >= effectiveStart && time < segmentEnd;
    });
    
    if (segmentReadings.length >= 2) {
      const first = segmentReadings[0];
      const last = segmentReadings[segmentReadings.length - 1];
      const hours = minutesBetween(first.timestamp, last.timestamp) / 60;
      
      if (hours > 0.1) {
        const rate = (last.temp - first.temp) / hours;
        segments.push({
          ovenTemp: ovenEvents[i].setTemp,
          heatingRate: rate,
          duration: minutesBetween(ovenEvents[i].timestamp, segmentEnd.toISOString()),
          readingCount: segmentReadings.length
        });
      }
    }
  }
  
  if (segments.length < 2) {
    return null;
  }
  
  // Calculate correlation between oven temp and heating rate
  const correlation = calculateCorrelation(
    segments.map(s => s.ovenTemp),
    segments.map(s => s.heatingRate)
  );
  
  // Estimate rate change per degree of oven change
  const ovenTemps = segments.map(s => s.ovenTemp);
  const rates = segments.map(s => s.heatingRate);
  const ovenRange = Math.max(...ovenTemps) - Math.min(...ovenTemps);
  const rateRange = Math.max(...rates) - Math.min(...rates);
  
  const responsiveness = ovenRange > 0 ? rateRange / ovenRange : 0;
  
  return {
    segments,
    correlation,
    responsiveness, // °F/hr change per °F oven change
    responsivenessValue: responsiveness,
    descriptionType: getResponsivenessDescriptionType(responsiveness, correlation)
  };
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Determine the type of responsiveness description
 * Returns type and raw values for formatting with proper units
 */
function getResponsivenessDescriptionType(responsiveness, correlation) {
  if (correlation < 0.3) {
    return {
      type: 'limited',
      correlation
    };
  }
  
  if (responsiveness > 0.1) {
    return {
      type: 'high',
      responsiveness,
      correlation
    };
  }
  
  return {
    type: 'moderate',
    correlation
  };
}




