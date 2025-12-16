import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { generateRecommendation, analyzeOvenResponsiveness } from '../services/recommendationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

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
    const msg = rawRecommendation.value.message;
    if (!msg) return null;
    
    // Handle LOW_TEMP_DISABLED message with proper unit conversion
    if (rawRecommendation.value.practicalMinF !== null && rawRecommendation.value.practicalMinF !== undefined) {
      const minTempFormatted = formatTemperature(rawRecommendation.value.practicalMinF, displayUnits.value);
      return msg.replace('{minTemp}', minTempFormatted);
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
    const altMsg = rawRecommendation.value.alternativeMessage;
    if (!altMsg) return null;
    
    // Handle OVEN_OFF_ALTERNATIVE message with proper unit conversion
    if (rawRecommendation.value.ovenOffMinutes && currentOvenTemp.value !== null) {
      const ovenTempFormatted = formatTemperature(currentOvenTemp.value, displayUnits.value);
      return altMsg
        .replace('{minutes}', rawRecommendation.value.ovenOffMinutes)
        .replace('{ovenTemp}', ovenTempFormatted);
    }
    
    return altMsg;
  });
  
  /**
   * Suggested minutes to turn oven off
   */
  const ovenOffMinutes = computed(() => rawRecommendation.value.ovenOffMinutes);
  
  /**
   * Oven responsiveness analysis (optional feature)
   */
  const responsiveness = computed(() => {
    return analyzeOvenResponsiveness(readings.value, ovenEvents.value);
  });
  
  /**
   * Whether responsiveness data is available
   */
  const hasResponsivenessData = computed(() => responsiveness.value !== null);
  
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
    
    // Blocker info
    blockerReason,
    blockerType,
    blockerProgress,
    
    // Advanced features
    responsiveness,
    hasResponsivenessData
  };
}


