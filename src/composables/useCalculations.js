import { computed } from 'vue';
import { useSession } from './useSession.js';
import { computeSessionCalculations } from '../services/calculationService.js';
import { toDisplayUnit, convertRate, formatRate } from '../utils/temperatureUtils.js';
import { formatDuration, formatTime, minutesBetween } from '../utils/timeUtils.js';
import { useRefreshTimer } from './useRefreshTimer.js';

export function useCalculations() {
  const { readings, config, settings, displayUnits } = useSession();

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
      targetTemp: config.value.targetTemp,
      desiredServeTime: config.value.desiredServeTime,
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
  const currentRate = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw === null) return null;
    return convertRate(raw, displayUnits.value);
  });
  
  /**
   * Formatted current rate string
   */
  const currentRateFormatted = computed(() => {
    const raw = rawCalculations.value?.currentRate;
    if (raw === null) return '--';
    return formatRate(raw, displayUnits.value);
  });
  
  /**
   * Average session rate in display units
   */
  const averageRate = computed(() => {
    const raw = rawCalculations.value?.averageRate;
    if (raw === null) return null;
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
   * Formatted time remaining string
   */
  const timeRemainingFormatted = computed(() => {
    const minutes = predictedMinutesFromNow.value;
    if (minutes === null) return '--';
    if (minutes <= 0) return 'Target reached';
    return formatDuration(minutes);
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
    const time = predictedTargetTime.value;
    if (!time) return '--';
    return formatTime(time);
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
   * Confidence assessment
   */
  const confidence = computed(() => {
    return rawCalculations.value?.confidence ?? { level: 'insufficient', reason: 'No data' };
  });
  
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
   * Target temperature in display units
   */
  const targetTempDisplay = computed(() => {
    if (!config.value) return null;
    return toDisplayUnit(config.value.targetTemp, displayUnits.value);
  });
  
  /**
   * Progress percentage toward target (0-100)
   */
  const progressPercent = computed(() => {
    if (currentTemp.value === null || !config.value) return 0;
    
    const startTemp = config.value.startingTemp ?? 
      (readings.value.length > 0 ? readings.value[0].temp : currentTemp.value);
    const target = config.value.targetTemp;
    
    if (target <= startTemp) return 100;
    
    const progress = (currentTemp.value - startTemp) / (target - startTemp);
    return Math.min(100, Math.max(0, Math.round(progress * 100)));
  });
  
  /**
   * Whether target has been reached
   */
  const targetReached = computed(() => {
    if (currentTemp.value === null || !config.value) return false;
    return currentTemp.value >= config.value.targetTemp;
  });
  
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
    confidence,
    currentTemp,
    progressPercent,
    targetReached,
    canPredict,
    
    // Display values
    currentRateFormatted,
    timeRemainingFormatted,
    predictedTargetTimeFormatted,
    scheduleVarianceFormatted,
    currentTempDisplay,
    targetTempDisplay
  };
}




