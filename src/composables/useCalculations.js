import { computed } from 'vue';
import { useSession } from './useSession.js';
import { computeSessionCalculations, assessPullProgress } from '../services/calculationService.js';
import { toDisplayUnit, convertRate, formatRate } from '../utils/temperatureUtils.js';
import {
  formatDuration, formatTime, formatTimeCompact, minutesBetween, addMinutes
} from '../utils/timeUtils.js';
import { useRefreshTimer } from './useRefreshTimer.js';
import { advanceThroughOven, projectToTarget } from '../services/thermalModel.js';

export function useCalculations() {
  const { readings, ovenEvents, config, settings, displayUnits } = useSession();

  // Anything derived from "now" needs a reactive clock. Without this the
  // countdown is computed once and then frozen for the rest of the cook.
  const { tick } = useRefreshTimer(30000);
  
  /**
   * Raw calculation results (internal units)
   */
  const rawCalculations = computed(() => {
    if (!config.value) {
      return null;
    }
    
    return computeSessionCalculations({
      readings: readings.value,
      // The oven history is part of the physics now, not just a pause marker:
      // the model integrates the actual dial timeline.
      ovenEvents: ovenEvents.value,
      pullTempF: config.value.pullTempF,
      desiredServeTime: config.value.desiredServeTime,
      // Feed the prior on k. Worth about 0.1% of the fit once three readings
      // exist; what it buys is that the fit always returns, so the whole
      // show/don't-show decision lives in the gate.
      weightLb: config.value.weight,
      meatType: config.value.meatType,
      // The projection is judged against the latest PULL time, not the serve
      // time: the meat has to be out of the oven early enough to rest.
      restMinutes: config.value.restMinutes ?? 0,
      settings: settings.value,
      // Pinned to the anchor, not the live clock: this computed deliberately has
      // no tick dependency, so the countdown is derived separately below. Left
      // implicit, the result object would carry a permanently stale
      // predictedMinutesFromNow.
      now: readings.value.length > 0
        ? readings.value[readings.value.length - 1].timestamp
        : undefined
    });
  });
  
  /**
   * Current heating rate in raw units (Fahrenheit per hour)
   */
  const currentRateRaw = computed(() => {
    return rawCalculations.value?.currentRate ?? null;
  });
  
  /**
   * Current heating rate in display units
   */
  // `== null`, not `=== null`: the optional chain above yields *undefined* when
  // there is no session, and `undefined === null` is false - so undefined fell
  // straight through into convertRate, which returned NaN, which reached the
  // screen. The three guards below were all written the same wrong way.
  const currentRate = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw == null) return null;
    return convertRate(raw, displayUnits.value);
  });
  
  /**
   * Formatted current rate string
   */
  const currentRateFormatted = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw == null) return '--';
    return formatRate(raw, displayUnits.value);
  });
  
  /**
   * Average session rate in display units
   */
  const averageRate = computed(() => {
    const raw = rawCalculations.value?.averageRate;
    if (raw == null) return null;
    return convertRate(raw, displayUnits.value);
  });
  
  /**
   * Heating minutes still needed, measured from the last reading's timestamp.
   * This is the projection's own length - NOT a countdown. The recommendation
   * service consumes it in that sense.
   */
  const predictedMinutes = computed(() => {
    return rawCalculations.value?.predictedMinutesToTarget ?? null;
  });
  
  /**
   * The same projection as a live countdown from now. Part of `predictedMinutes`
   * has already elapsed since the last reading was taken, so the two differ by
   * exactly the age of that reading. This is the one a display should show.
   *
   * Derived here rather than inside the calculation so `rawCalculations` stays
   * clock-free: the predicted target *time* does not move as the clock advances,
   * only the distance to it does.
   */
  const predictedMinutesFromNow = computed(() => {
    tick.value; // re-read the clock on each tick
    const targetTime = rawCalculations.value?.predictedTargetTime;
    if (!targetTime) return null;
    return Math.round(minutesBetween(new Date().toISOString(), targetTime));
  });
  
  /**
   * The countdown as a string.
   *
   * When it runs out this used to say "Target reached", and that was a claim the
   * app was in no position to make. Whether the target IS reached is a
   * MEASUREMENT - `targetReached`, off the latest reading - and callers render
   * that first. So the only way this branch ever appeared on screen was when the
   * measurement said the target had NOT been reached: the projection's moment had
   * arrived and nothing had confirmed it. That is precisely the moment to ask for
   * a reading, not to announce a result. A cook could leave the roast in on the
   * strength of a wall clock ticking past a prediction made an hour earlier.
   */
  const timeRemainingFormatted = computed(() => {
    const minutes = predictedMinutesFromNow.value;
    if (minutes === null) return '--';
    if (minutes > 0) return formatDuration(minutes);
    // Within the rounding of a minute, "now" is the honest word.
    if (minutes > -2) return 'Due now';
    return `Due ${formatDuration(-minutes)} ago`;
  });
  
  /**
   * Predicted target completion time (ISO string)
   */
  const predictedTargetTime = computed(() => {
    return rawCalculations.value?.predictedTargetTime ?? null;
  });
  
  /**
   * Formatted predicted completion time
   */
  const predictedTargetTimeFormatted = computed(() => {
    // Compact, because this lands in a 96px stat cell. The day marker has to
    // re-run on the tick or "today" is decided once, at page load.
    tick.value;
    const time = predictedTargetTime.value;
    if (!time) return '--';
    return formatTimeCompact(time);
  });
  
  /**
   * Schedule variance in minutes (positive = late, negative = early)
   */
  const scheduleVariance = computed(() => {
    return rawCalculations.value?.scheduleVarianceMinutes ?? null;
  });
  
  /**
   * Formatted schedule variance string
   */
  const scheduleVarianceFormatted = computed(() => {
    const variance = scheduleVariance.value;
    if (variance === null) return '--';
    if (Math.abs(variance) < 1) return 'On time';
    
    const absVariance = Math.abs(variance);
    const formatted = formatDuration(absVariance);
    
    if (variance > 0) {
      return `${formatted} late`;
    } else {
      return `${formatted} early`;
    }
  });
  
  /**
   * Schedule status enum
   */
  const scheduleStatus = computed(() => {
    return rawCalculations.value?.scheduleStatus ?? 'unknown';
  });
  
  /**
   * Why there is no projection, when there is none: 'no-readings' | 'no-rate' |
   * 'no-temp' | 'rate-too-low' | 'beyond-horizon', or null when there is one.
   *
   * The UI needs to distinguish "not enough data yet", which resolves itself,
   * from "the arithmetic came out absurd and was refused", which does not.
   */
  const projectionRefusedReason = computed(() => {
    return rawCalculations.value?.projectionRefusedReason ?? null;
  });
  
  /**
   * The latest moment the meat can come out and still be rested by serve time.
   * This, not the serve time, is what the projection is judged against.
   */
  const latestPullTime = computed(() => {
    return rawCalculations.value?.latestPullTime ?? null;
  });
  
  /**
   * Confidence assessment. Carries a machine-readable `code` alongside the prose;
   * nothing downstream may match on the prose.
   */
  const confidence = computed(() => {
    return rawCalculations.value?.confidence
      ?? { level: 'insufficient', code: 'no-session', reason: 'No data' };
  });
  
  /**
   * What the projection would say once the oven is back on, at the setting the
   * cook last used. Null unless the oven is off.
   *
   * The ETA correctly disappears while the oven is off - there is no finish time
   * for a cooling roast - but that is a visible regression, so the pause UI can
   * say "about 2 h 10 m once the oven is back on" rather than a dash.
   *
   * RECOMPUTED HERE, AGAINST THE CLOCK, rather than taken from the service.
   * `rawCalculations` pins `now` to the newest reading so that it has no tick
   * dependency, which is the right call for the finish TIME but makes this figure
   * a constant: nobody logs readings during a pause, so the anchor never moves
   * and the service's answer was identical after three minutes of pause and after
   * three hours. Observed as a flat "5m" across 208 minutes of a switched-off
   * oven, while the real roast shed heat the entire time - the one number the
   * pause UI exists to show, and it was the one number that could not change.
   *
   * So the anchor is carried forward through the pause to now, and the restart is
   * projected from there. The answer grows the longer the oven stays off, which is
   * both correct and the thing a cook needs to see.
   */
  const projectionIfRestarted = computed(() => {
    tick.value; // this one genuinely does move with the clock
    const base = rawCalculations.value?.projectionIfRestarted ?? null;
    if (!base) return null;

    const currentFit = rawCalculations.value?.fit;
    const anchorISO = readings.value.length > 0
      ? readings.value[readings.value.length - 1].timestamp
      : null;
    if (!currentFit?.anchorState || !anchorISO) return base;

    const nowISO = new Date().toISOString();
    const stateNow = advanceThroughOven(
      currentFit.anchorState,
      { ovenEvents: ovenEvents.value, fromISO: anchorISO, toISO: nowISO },
      currentFit.k
    );
    const restarted = projectToTarget({
      state: stateNow,
      k: currentFit.k,
      setPointF: base.atOvenTempF,
      targetF: config.value?.pullTempF
    });

    return {
      minutes: restarted.minutes === null ? null : Math.round(restarted.minutes),
      reason: restarted.reason,
      atOvenTempF: base.atOvenTempF
    };
  });
  
  /** The fit itself, for the chart and the harness. Not for the UI to interpret. */
  const fit = computed(() => rawCalculations.value?.fit ?? null);
  
  /**
   * Whether we have enough data to show predictions
   */
  const canPredict = computed(() => {
    const level = confidence.value.level;
    return level === 'high' || level === 'medium' || level === 'low';
  });
  
  /**
   * Current internal temperature (from most recent reading)
   */
  const currentTemp = computed(() => {
    if (readings.value.length === 0) return null;
    return readings.value[readings.value.length - 1].temp;
  });
  
  /**
   * Current temperature in display units
   */
  const currentTempDisplay = computed(() => {
    if (currentTemp.value === null) return null;
    return toDisplayUnit(currentTemp.value, displayUnits.value);
  });
  
  /**
   * Pull temperature in display units - where the cook stops.
   */
  const pullTempDisplay = computed(() => {
    if (!config.value) return null;
    return toDisplayUnit(config.value.pullTempF, displayUnits.value);
  });
  
  /**
   * Serving temperature in display units - what lands on the plate.
   */
  const servingTempDisplay = computed(() => {
    if (!config.value || !Number.isFinite(config.value.servingTempF)) return null;
    return toDisplayUnit(config.value.servingTempF, displayUnits.value);
  });
  
  /**
   * Carryover as a DELTA in display units - no 32° offset. Converting it as an
   * absolute temperature would turn +4 °F into -15.6 °C.
   */
  const carryoverDisplay = computed(() => {
    const raw = config.value?.carryoverF;
    if (!Number.isFinite(raw)) return null;
    return displayUnits.value === 'C'
      ? Math.round((raw * 5 / 9) * 10) / 10
      : raw;
  });
  
  /** Minutes the meat rests before carving. */
  const restMinutes = computed(() => config.value?.restMinutes ?? 0);
  
  /**
   * When dinner is actually going to be on the table: the projected pull, plus
   * the rest.
   *
   * The third stat cell used to show the serve time the cook had already chosen,
   * which tells them nothing they did not type in themselves. This is the
   * prediction.
   */
  const predictedServeTime = computed(() => {
    const pull = predictedTargetTime.value;
    if (!pull) return null;
    return addMinutes(pull, restMinutes.value);
  });
  
  const predictedServeTimeFormatted = computed(() => {
    tick.value;
    const time = predictedServeTime.value;
    if (!time) return '--';
    return formatTimeCompact(time);
  });
  
  /** Where the cook started from, for the progress fraction. */
  const startTempF = computed(() => {
    if (!config.value) return null;
    return config.value.startingTemp ??
      (readings.value.length > 0 ? readings.value[0].temp : currentTemp.value);
  });
  
  /**
   * Progress toward the pull, CLAMPED to 0-100.
   *
   * The clamp is for the two things that cannot render past 100%: the ARIA value
   * and the rail's width. Logic that needs to tell "just done" from "30 °F past
   * done" reads pullProgress.progressPercent, which is unclamped.
   */
  const progressPercent = computed(() => {
    const raw = pullProgress.value.progressPercent;
    if (raw === null) return currentTemp.value === null ? 0 : 100;
    return Math.min(100, Math.max(0, Math.round(raw)));
  });
  
  /** True once the rail is pinned, so it can show a cap rather than overflow. */
  const progressOverflows = computed(() => (pullProgress.value.progressPercent ?? 0) > 100);
  
  /**
   * How close the roast is to coming out, graded. The single source of truth for
   * "is it done yet" - see assessPullProgress.
   */
  const pullProgress = computed(() => {
    if (!config.value) {
      return { state: 'heating', degreesToPull: null, degreesOver: null, progressPercent: null };
    }
    return assessPullProgress(currentTemp.value, config.value.pullTempF, startTempF.value);
  });
  
  /** Whether the pull temperature has been reached. Derived, not re-tested. */
  const targetReached = computed(
    () => pullProgress.value.state === 'at-pull' || pullProgress.value.state === 'over'
  );
  
  /** Inside the last few degrees: the endgame, where overshoot happens. */
  const isApproachingPull = computed(() => pullProgress.value.state === 'approaching');
  
  return {
    // Raw values (internal Fahrenheit)
    currentRateRaw,
    currentRate,
    averageRate,
    predictedMinutes,
    predictedMinutesToTarget: predictedMinutes, // Alias for recommendation service
    predictedMinutesFromNow,
    predictedTargetTime,
    scheduleVariance,
    scheduleStatus,
    projectionRefusedReason,
    projectionIfRestarted,
    latestPullTime,
    confidence,
    fit,
    currentTemp,
    progressPercent,
    progressOverflows,
    pullProgress,
    targetReached,
    isApproachingPull,
    canPredict,
    
    // The cook plan: pull -> rest -> serve
    restMinutes,
    predictedServeTime,
    
    // Display values
    currentRateFormatted,
    timeRemainingFormatted,
    predictedTargetTimeFormatted,
    predictedServeTimeFormatted,
    scheduleVarianceFormatted,
    currentTempDisplay,
    pullTempDisplay,
    servingTempDisplay,
    carryoverDisplay
  };
}




