import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { useRefreshTimer } from './useRefreshTimer.js';
import { generateRecommendation, analyzeOvenResponsiveness, buildRecommendationResult } from '../services/recommendationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

export function useRecommendations() {
  const { readings, ovenEvents, currentOvenTemp, lastActiveOvenTemp, config, settings, displayUnits } = useSession();
  const { scheduleVariance, scheduleStatus, confidence, predictedMinutesToTarget, currentRateRaw } = useCalculations();
  
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
      targetTemp: config.value.targetTemp,
      desiredServeTime: config.value.desiredServeTime,
      scheduleVarianceMinutes: scheduleVariance.value,
      scheduleStatus: scheduleStatus.value,
      confidence: confidence.value,
      settings: settings.value,
      predictedMinutesToTarget: predictedMinutesToTarget.value,
      currentRate: currentRateRaw.value,
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
   * Primary recommendation message with unit conversion
   */
  const message = computed(() => {
    let msg = rawRecommendation.value.message;
    if (!msg) return null;
    
    // Handle {ovenTemp} placeholder - used in HOLD, OVEN_OFF_ALTERNATIVE, etc.
    // lastActiveOvenTemp, not currentOvenTemp: the latter is 0 while the oven is
    // off, which rendered "then restart at 0°F".
    if (msg.includes('{ovenTemp}') && lastActiveOvenTemp.value !== null) {
      const tempFormatted = formatTemperature(lastActiveOvenTemp.value, displayUnits.value);
      msg = msg.replace(/{ovenTemp}/g, tempFormatted);
    }
    
    // Handle {suggestedTemp} placeholder - used in RAISE/LOWER messages
    if (msg.includes('{suggestedTemp}') && rawRecommendation.value.suggestedTemp !== null) {
      const tempFormatted = formatTemperature(rawRecommendation.value.suggestedTemp, displayUnits.value);
      msg = msg.replace(/{suggestedTemp}/g, tempFormatted);
    }
    
    // Handle {minTemp} placeholder - used in LOW_TEMP_DISABLED and MIN_TEMP messages
    if (msg.includes('{minTemp}')) {
      const minTempF = rawRecommendation.value.practicalMinF || rawRecommendation.value.minTempF;
      if (minTempF !== null && minTempF !== undefined) {
        const minTempFormatted = formatTemperature(minTempF, displayUnits.value);
        msg = msg.replace(/{minTemp}/g, minTempFormatted);
      }
    }
    
    // Handle {maxTemp} placeholder - used in MAX_TEMP message
    if (msg.includes('{maxTemp}') && rawRecommendation.value.maxTempF !== null) {
      const maxTempFormatted = formatTemperature(rawRecommendation.value.maxTempF, displayUnits.value);
      msg = msg.replace(/{maxTemp}/g, maxTempFormatted);
    }
    
    // Handle {latestTemp} placeholder - used in the at-target message
    if (msg.includes('{latestTemp}') && rawRecommendation.value.latestReadingTemp !== null) {
      const latestFormatted = formatTemperature(rawRecommendation.value.latestReadingTemp, displayUnits.value);
      msg = msg.replace(/{latestTemp}/g, latestFormatted);
    }
    
    return msg;
  });
  
  /**
   * Detailed reasoning for the recommendation
   */
  const reasoning = computed(() => rawRecommendation.value.reasoning);
  
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
  const alternativeMessage = computed(() => {
    let altMsg = rawRecommendation.value.alternativeMessage;
    if (!altMsg) return null;
    
    // Handle {minutes} placeholder
    if (altMsg.includes('{minutes}') && rawRecommendation.value.ovenOffMinutes !== null) {
      altMsg = altMsg.replace(/{minutes}/g, rawRecommendation.value.ovenOffMinutes);
    }
    
    // Same as above: OVEN_OFF_ALTERNATIVE reads "...then restart at {ovenTemp}",
    // so it needs the temperature to restart at, not the 0 of an off event.
    if (altMsg.includes('{ovenTemp}') && lastActiveOvenTemp.value !== null) {
      const ovenTempFormatted = formatTemperature(lastActiveOvenTemp.value, displayUnits.value);
      altMsg = altMsg.replace(/{ovenTemp}/g, ovenTempFormatted);
    }

    
    return altMsg;
  });
  
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




