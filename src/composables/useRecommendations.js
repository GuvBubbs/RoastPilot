import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { useRefreshTimer } from './useRefreshTimer.js';
import {
  generateRecommendation, analyzeOvenResponsiveness, buildRecommendationResult,
  assessOvenChangeEffect
} from '../services/recommendationService.js';
import { projectScheduleUnderOven } from '../services/calculationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

export function useRecommendations() {
  const { readings, ovenEvents, currentOvenTemp, lastActiveOvenTemp, config, settings, displayUnits } = useSession();
  const {
    scheduleVariance, scheduleStatus, confidence, predictedMinutesToTarget,
    currentRateRaw, projectionRefusedReason
  } = useCalculations();
  
  /**
   * THE COLLISION, AND WHY THIS FUNCTION EXISTS.
   *
   * `generateRecommendation` feeds `calculateRecommendation` from
   * `changeEffect.evidenceTemp` - the set point the READINGS describe - while a
   * dial change is still unmeasured. That is right, and it is what stops the same
   * step being charged for twice.
   *
   * It only worked because the projection was oven-blind. Now the projection
   * integrates the actual dial timeline, so the variance handed in describes the
   * oven as it IS while the recommendation is being computed for the oven as it
   * was MEASURED. That mismatch is a reversal generator:
   *
   *   project under 250 -> on-track -> `hold` at evidenceTemp 200 ->
   *   reconcileWithOvenChange sees a -50 gap -> "lower to 200",
   *
   * one reading after telling the cook to raise it. Both checkNoFlapping and
   * checkNoDoubleCharging go red on it.
   *
   * So while a change is unmeasured, the variance is recomputed under the set
   * point the readings describe. The recommendation is then internally
   * consistent: a projection of the measured oven, judged against the deadline,
   * advising from the measured oven.
   */
  const scheduleUnderEvidence = computed(() => {
    tick.value;
    if (!config.value || readings.value.length === 0) return null;

    const effect = assessOvenChangeEffect({
      readings: readings.value,
      ovenEvents: ovenEvents.value,
      settings: settings.value,
      now: new Date().toISOString()
    });

    // Settled, or nothing to reconcile: the ordinary projection already
    // describes the oven the readings describe.
    if (effect.settled || effect.evidenceTemp === null) return null;

    return projectScheduleUnderOven({
      readings: readings.value,
      ovenEvents: ovenEvents.value,
      setPointF: effect.evidenceTemp,
      config: config.value,
      settings: settings.value,
      now: new Date().toISOString()
    });
  });
  
  // The eligibility gate ages the last oven event against the clock. Without a
  // tick this computed never re-ran, so "your oven setting is stale" only fired
  // if some unrelated mutation happened to invalidate it - meanwhile the status
  // band's oven chip, which IS tick-driven, showed the stale warning. The two
  // bands contradicted each other on screen.
  const { tick } = useRefreshTimer(30000);
  
  /**
   * Raw recommendation result (internal units)
   */
  const rawRecommendation = computed(() => {
    tick.value; // re-read the clock on each tick
    
    if (!config.value || currentOvenTemp.value === null) {
      // Through the shared builder, so this branch emits the same key set as
      // every other - it is the one path that used to hand-roll its object and
      // silently omit severity, alternativeMessage and ovenOffMinutes.
      return buildRecommendationResult({
        canRecommend: false,
        blockerReason: 'No active session',
        blockerType: 'no_session'
      });
    }
    
    return generateRecommendation({
      readings: readings.value,
      ovenEvents: ovenEvents.value,
      // The temperature to adjust FROM. Not currentOvenTemp, which is 0 while
      // the oven is off - "0 + 25" produced a 25°F set point the Apply button
      // then wrote into the oven history.
      ovenBaseTemp: lastActiveOvenTemp.value,
      pullTempF: config.value.pullTempF,
      desiredServeTime: config.value.desiredServeTime,
      // Under the MEASURED set point while a change is unmeasured; see
      // scheduleUnderEvidence.
      scheduleVarianceMinutes: scheduleUnderEvidence.value
        ? scheduleUnderEvidence.value.scheduleVarianceMinutes
        : scheduleVariance.value,
      scheduleStatus: scheduleUnderEvidence.value
        ? scheduleUnderEvidence.value.scheduleStatus
        : scheduleStatus.value,
      confidence: confidence.value,
      settings: settings.value,
      predictedMinutesToTarget: predictedMinutesToTarget.value,
      currentRate: currentRateRaw.value,
      // A refused projection has to reach the user as a blocker with a reason,
      // not as "Unable to determine schedule status" dressed up as advice.
      projectionRefusedReason: projectionRefusedReason.value,
      // The dial's markings depend on the unit on screen, so the service snaps
      // its suggestions in that unit rather than emitting 102°C.
      displayUnits: displayUnits.value,
      now: new Date().toISOString()
    });
  });
  
  /**
   * Whether a recommendation can be made
   */
  const canRecommend = computed(() => rawRecommendation.value.canRecommend);
  
  /**
   * The recommended action
   */
  const action = computed(() => rawRecommendation.value.action);
  
  /**
   * Suggested oven temperature in display units
   */
  const suggestedTemp = computed(() => {
    if (rawRecommendation.value.suggestedTemp === null) return null;
    return toDisplayUnit(rawRecommendation.value.suggestedTemp, displayUnits.value);
  });
  
  /**
   * Formatted suggested temperature with unit
   */
  const suggestedTempFormatted = computed(() => {
    if (rawRecommendation.value.suggestedTemp === null) return null;
    return formatTemperature(rawRecommendation.value.suggestedTemp, displayUnits.value);
  });
  
  /**
   * Change amount in display units
   */
  const changeAmount = computed(() => {
    if (rawRecommendation.value.changeAmount === null) return null;
    // Delta conversion (no 32 offset)
    if (displayUnits.value === 'C') {
      return Math.round((rawRecommendation.value.changeAmount * 5 / 9) * 10) / 10;
    }
    return rawRecommendation.value.changeAmount;
  });
  
  /**
   * Formatted change amount with sign and unit
   */
  const changeAmountFormatted = computed(() => {
    if (changeAmount.value === null || changeAmount.value === 0) return null;
    const sign = rawRecommendation.value.action === 'raise' ? '+' : '-';
    return `${sign}${Math.abs(changeAmount.value)}°${displayUnits.value}`;
  });
  
  /**
   * Resolve the placeholders the service emits. One helper for every string it
   * emits - message, alternative and reasoning all draw on the same values, and
   * substituting them in only some of them is how a raw {ovenTemp} reaches the
   * screen.
   */
  function substitute(text) {
    if (!text) return null;
    const raw = rawRecommendation.value;
    let out = text;
    
    // {ovenTemp}: lastActiveOvenTemp, not currentOvenTemp - the latter is 0
    // while the oven is off, which rendered "then restart at 0°F".
    if (out.includes('{ovenTemp}') && lastActiveOvenTemp.value !== null) {
      out = out.replace(/{ovenTemp}/g, formatTemperature(lastActiveOvenTemp.value, displayUnits.value));
    }
    
    if (out.includes('{suggestedTemp}') && raw.suggestedTemp !== null) {
      out = out.replace(/{suggestedTemp}/g, formatTemperature(raw.suggestedTemp, displayUnits.value));
    }
    
    // The target the dial has overshot, named by SETTLING_BEYOND_PLAN. Kept
    // separate from {suggestedTemp} - in that state the suggestion IS the
    // current setting, so the two must not collapse into one number.
    if (out.includes('{plannedTemp}') && raw.plannedTempF !== null && raw.plannedTempF !== undefined) {
      out = out.replace(/{plannedTemp}/g, formatTemperature(raw.plannedTempF, displayUnits.value));
    }
    
    // Used by LOW_TEMP_DISABLED and the at-minimum hold
    if (out.includes('{minTemp}')) {
      const minTempF = raw.practicalMinF || raw.minTempF;
      if (minTempF !== null && minTempF !== undefined) {
        out = out.replace(/{minTemp}/g, formatTemperature(minTempF, displayUnits.value));
      }
    }
    
    /**
     * The food-safety floor, the oven headroom and the pull temperature.
     *
     * All three used to be written into their sentences as Fahrenheit literals in
     * the service, so a Celsius cook was told "not safe until the core is above
     * 140°F" and "25°F above your 191°F pull" while every number on the screen
     * beside them was in °C. The `rendered-text` invariant did not catch it: it
     * only looks for placeholders that failed to substitute, and a hardcoded
     * literal is not a placeholder.
     *
     * {headroom} is a DIFFERENCE, so it converts as a difference - 25 °F of
     * headroom is 14 °C, not -4 °C.
     */
    if (out.includes('{safeTemp}') && raw.safeCoreF !== null && raw.safeCoreF !== undefined) {
      out = out.replace(/{safeTemp}/g, formatTemperature(raw.safeCoreF, displayUnits.value));
    }

    if (out.includes('{pullTemp}') && raw.pullTempF !== null && raw.pullTempF !== undefined) {
      out = out.replace(/{pullTemp}/g, formatTemperature(raw.pullTempF, displayUnits.value));
    }

    if (out.includes('{headroom}') && raw.headroomF !== null && raw.headroomF !== undefined) {
      const degrees = displayUnits.value === 'C'
        ? Math.round(raw.headroomF * 5 / 9)
        : raw.headroomF;
      out = out.replace(/{headroom}/g, `${degrees}°${displayUnits.value}`);
    }

    if (out.includes('{maxTemp}') && raw.maxTempF !== null && raw.maxTempF !== undefined) {
      out = out.replace(/{maxTemp}/g, formatTemperature(raw.maxTempF, displayUnits.value));
    }
    
    if (out.includes('{latestTemp}') && raw.latestReadingTemp !== null) {
      out = out.replace(/{latestTemp}/g, formatTemperature(raw.latestReadingTemp, displayUnits.value));
    }
    
    if (out.includes('{minutes}') && raw.ovenOffMinutes !== null) {
      out = out.replace(/{minutes}/g, raw.ovenOffMinutes);
    }
    
    // How long until a dial change should be visible in a reading
    if (out.includes('{waitMinutes}') && raw.waitMinutes !== null) {
      out = out.replace(/{waitMinutes}/g, raw.waitMinutes);
    }
    
    return out;
  }
  
  /**
   * Primary recommendation message with unit conversion
   */
  const message = computed(() => substitute(rawRecommendation.value.message));
  
  /**
   * Detailed reasoning for the recommendation
   */
  const reasoning = computed(() => substitute(rawRecommendation.value.reasoning));
  
  /**
   * Reason why recommendation cannot be made
   */
  const blockerReason = computed(() => rawRecommendation.value.blockerReason);
  
  /**
   * Type of blocker for UI customization
   */
  const blockerType = computed(() => rawRecommendation.value.blockerType);
  
  /**
   * Progress toward being able to recommend
   */
  const blockerProgress = computed(() => rawRecommendation.value.progress);
  
  /**
   * Severity level for styling
   */
  const severity = computed(() => rawRecommendation.value.severity || 'normal');
  
  /**
   * Alternative message (e.g., turn oven off) with unit conversion
   */
  // OVEN_OFF_ALTERNATIVE reads "...then restart at {ovenTemp}", so it needs the
  // temperature to restart at, not the 0 of an off event - see substitute().
  const alternativeMessage = computed(() => substitute(rawRecommendation.value.alternativeMessage));
  
  /**
   * Suggested minutes to turn oven off
   */
  const ovenOffMinutes = computed(() => rawRecommendation.value.ovenOffMinutes);
  
  /**
   * Whether cooking is currently paused (last oven event was an "off" event).
   * Derived from logged events only - never from the wall clock.
   */
  const isPaused = computed(() => {
    const events = ovenEvents.value;
    if (!events || events.length === 0) return false;
    return events[events.length - 1].isOff === true;
  });
  
  /**
   * Whether a fresh reading is required before recommendations can resume
   */
  const needsReading = computed(() => rawRecommendation.value.action === 'needs-reading');
  
  /**
   * Whether the last oven change has yet to show up in the readings. While this
   * is true the advice is anchored to the set point the readings describe, so it
   * does not stack another step on top of a change already made.
   */
  const awaitingEffect = computed(() => rawRecommendation.value.awaitingEffect === true);
  
  /** Minutes until that change should be visible in a reading */
  const waitMinutes = computed(() => rawRecommendation.value.waitMinutes);
  
  /**
   * Latest logged reading temperature in display units
   */
  const latestReadingTemp = computed(() => {
    if (rawRecommendation.value.latestReadingTemp === null || rawRecommendation.value.latestReadingTemp === undefined) return null;
    return toDisplayUnit(rawRecommendation.value.latestReadingTemp, displayUnits.value);
  });
  
  /**
   * Formatted latest logged reading temperature
   */
  const latestReadingTempFormatted = computed(() => {
    if (rawRecommendation.value.latestReadingTemp === null || rawRecommendation.value.latestReadingTemp === undefined) return null;
    return formatTemperature(rawRecommendation.value.latestReadingTemp, displayUnits.value);
  });
  
  /**
   * Oven responsiveness analysis (optional feature)
   */
  const responsivenessRaw = computed(() => {
    return analyzeOvenResponsiveness(readings.value, ovenEvents.value);
  });
  
  /**
   * Formatted responsiveness with proper unit conversion
   */
  const responsiveness = computed(() => {
    const raw = responsivenessRaw.value;
    if (!raw) return null;
    
    // Format description based on type
    let description = '';
    const descType = raw.descriptionType;
    
    if (descType.type === 'limited') {
      description = 'Oven temperature changes have had limited observable effect on heating rate so far.';
    } else if (descType.type === 'high') {
      // Convert: +25°F/°C oven increase and the resulting rate change
      const ovenDelta = displayUnits.value === 'C' ? Math.round(25 * 5 / 9) : 25;
      const rateChange = descType.responsiveness * 25; // In °F/hr
      const rateChangeConverted = displayUnits.value === 'C' 
        ? Math.round((rateChange * 5 / 9) * 10) / 10 
        : Math.round(rateChange * 10) / 10;
      
      description = `Higher oven temperatures have increased heating rate. Each +${ovenDelta}°${displayUnits.value} oven increase has added roughly +${rateChangeConverted}°${displayUnits.value}/hr to the heating rate.`;
    } else {
      description = 'Moderate correlation between oven temperature and heating rate observed.';
    }
    
    return {
      ...raw,
      description
    };
  });
  
  /**
   * Whether responsiveness data is available
   */
  const hasResponsivenessData = computed(() => responsivenessRaw.value !== null);
  
  return {
    // Core recommendation
    canRecommend,
    action,
    suggestedTemp,
    suggestedTempFormatted,
    changeAmount,
    changeAmountFormatted,
    message,
    reasoning,
    severity,
    alternativeMessage,
    ovenOffMinutes,
    
    // Pause state (when oven is off)
    isPaused,
    needsReading,
    
    // Settling state (oven changed, effect not measured yet)
    awaitingEffect,
    waitMinutes,
    latestReadingTemp,
    latestReadingTempFormatted,
    
    // Blocker info
    blockerReason,
    blockerType,
    blockerProgress,
    
    // Advanced features
    responsiveness,
    hasResponsivenessData
  };
}




