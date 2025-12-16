import { computed } from 'vue';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { generateRecommendation, analyzeOvenResponsiveness } from '../services/recommendationService.js';
import { toDisplayUnit, formatTemperature } from '../utils/temperatureUtils.js';

export function useRecommendations() {
  const { readings, ovenEvents, currentOvenTemp, config, settings, displayUnits } = useSession();
  const { scheduleVariance, scheduleStatus, confidence } = useCalculations();
  
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
      settings: settings.value
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
   * Primary recommendation message
   */
  const message = computed(() => rawRecommendation.value.message);
  
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
    
    // Blocker info
    blockerReason,
    blockerType,
    blockerProgress,
    
    // Advanced features
    responsiveness,
    hasResponsivenessData
  };
}

