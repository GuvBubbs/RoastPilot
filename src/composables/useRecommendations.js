import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { generateRecommendation, analyzeOvenResponsiveness } from '../services/recommendationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';

export function useRecommendations() {
  const { readings, ovenEvents, currentOvenTemp, config, settings, displayUnits } = useSession();
  const { scheduleVariance, scheduleStatus, confidence, predictedMinutesToTarget, currentRateRaw } = useCalculations();
  
  /**
   * Raw recommendation result (internal units)
   */
  const rawRecommendation = computed(() => {
    if (!config.value || currentOvenTemp.value === null) {
      return {
        action: 'none',
        canRecommend: false,
        blockerReason: 'No active session',
        blockerType: 'no_session',
        suggestedTemp: null,
        changeAmount: null,
        message: null,
        reasoning: null,
        progress: null
      };
    }
    
    return generateRecommendation({
      readings: readings.value,
      ovenEvents: ovenEvents.value,
      currentOvenTemp: currentOvenTemp.value,
      targetTemp: config.value.targetTemp,
      desiredServeTime: config.value.desiredServeTime,
      scheduleVarianceMinutes: scheduleVariance.value,
      scheduleStatus: scheduleStatus.value,
      confidence: confidence.value,
      settings: settings.value,
      predictedMinutesToTarget: predictedMinutesToTarget.value,
      currentRate: currentRateRaw.value
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
    
    // Handle {ovenTemp} placeholder - used in HOLD, OVEN_RESTART_NOW, OVEN_RESTART_TIMED, etc.
    if (msg.includes('{ovenTemp}')) {
      let tempToFormat = null;
      
      // For restart messages, use restartTemp
      if (rawRecommendation.value.restartTemp !== null) {
        tempToFormat = rawRecommendation.value.restartTemp;
      }
      // For other messages (like HOLD), use currentOvenTemp
      else if (currentOvenTemp.value !== null) {
        tempToFormat = currentOvenTemp.value;
      }
      
      if (tempToFormat !== null) {
        const tempFormatted = formatTemperature(tempToFormat, displayUnits.value);
        msg = msg.replace(/{ovenTemp}/g, tempFormatted);
      }
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
    
    // Handle {restartTime} placeholder - used in OVEN_RESTART_TIMED message
    if (msg.includes('{restartTime}') && rawRecommendation.value.restartTime) {
      const restartTimeFormatted = formatTime(rawRecommendation.value.restartTime);
      msg = msg.replace(/{restartTime}/g, restartTimeFormatted);
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
    
    // Handle {ovenTemp} placeholder - use currentOvenTemp for alternative messages
    if (altMsg.includes('{ovenTemp}') && currentOvenTemp.value !== null) {
      const ovenTempFormatted = formatTemperature(currentOvenTemp.value, displayUnits.value);
      altMsg = altMsg.replace(/{ovenTemp}/g, ovenTempFormatted);
    }
    
    // Handle {estimatedTemp} placeholder - used in OVEN_OFF_COOLING message
    if (altMsg.includes('{estimatedTemp}') && rawRecommendation.value.estimatedCurrentMeatTemp !== null) {
      const estimatedTempFormatted = formatTemperature(rawRecommendation.value.estimatedCurrentMeatTemp, displayUnits.value);
      altMsg = altMsg.replace(/{estimatedTemp}/g, estimatedTempFormatted);
    }
    
    return altMsg;
  });
  
  /**
   * Suggested minutes to turn oven off
   */
  const ovenOffMinutes = computed(() => rawRecommendation.value.ovenOffMinutes);
  
  /**
   * Restart time (ISO timestamp)
   */
  const restartTime = computed(() => rawRecommendation.value.restartTime || null);
  
  /**
   * Formatted restart time
   */
  const restartTimeFormatted = computed(() => {
    if (!restartTime.value) return null;
    return formatTime(restartTime.value);
  });
  
  /**
   * Whether should restart oven now
   */
  const shouldRestartNow = computed(() => rawRecommendation.value.shouldRestartNow || false);
  
  /**
   * Estimated current meat temperature (in display units)
   */
  const estimatedCurrentMeatTemp = computed(() => {
    if (!rawRecommendation.value.estimatedCurrentMeatTemp) return null;
    return toDisplayUnit(rawRecommendation.value.estimatedCurrentMeatTemp, displayUnits.value);
  });
  
  /**
   * Formatted estimated current meat temperature
   */
  const estimatedCurrentMeatTempFormatted = computed(() => {
    if (!rawRecommendation.value.estimatedCurrentMeatTemp) return null;
    return formatTemperature(rawRecommendation.value.estimatedCurrentMeatTemp, displayUnits.value);
  });
  
  /**
   * Minutes until should restart oven
   */
  const minutesUntilRestart = computed(() => rawRecommendation.value.minutesUntilRestart || null);
  
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
    
    // Restart recommendation (when oven is off)
    restartTime,
    restartTimeFormatted,
    shouldRestartNow,
    minutesUntilRestart,
    estimatedCurrentMeatTemp,
    estimatedCurrentMeatTempFormatted,
    
    // Blocker info
    blockerReason,
    blockerType,
    blockerProgress,
    
    // Advanced features
    responsiveness,
    hasResponsivenessData
  };
}


