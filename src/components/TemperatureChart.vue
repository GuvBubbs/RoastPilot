<template>
  <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Temperature Progress</h3>
      <div class="flex items-center gap-2">
        <button
          v-if="canToggleOvenOverlay"
          @click="showOvenOverlay = !showOvenOverlay"
          class="text-xs px-2 py-1 rounded border transition-colors"
          :class="showOvenOverlay ? 'bg-amber-50 dark:bg-amber-900 dark:bg-opacity-30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300' : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'"
        >
          {{ showOvenOverlay ? 'Hide Oven' : 'Show Oven' }}
        </button>
      </div>
    </div>
    
    <div class="relative" :style="{ height: chartHeight }">
      <Line
        v-if="hasData"
        :data="chartData"
        :options="chartOptions"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p>Add readings to see your progress</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Line } from 'vue-chartjs';
import { useWindowSize } from '@vueuse/core';
import { useSession } from '../composables/useSession.js';
import { useCalculations } from '../composables/useCalculations.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';
import {
  defaultChartOptions,
  chartColors,
  createTargetAnnotation,
  createServeTimeAnnotation
} from '../config/chartConfig.js';

const props = defineProps({
  height: { type: String, default: null }
});

const { readings, ovenEvents, config, displayUnits } = useSession();
const { predictedTargetTime, currentTemp, canPredict } = useCalculations();

const showOvenOverlay = ref(true);
const { width } = useWindowSize();

const chartHeight = computed(() => {
  if (props.height) return props.height;
  
  // Responsive height based on screen width
  if (width.value < 640) return '200px';
  if (width.value < 1024) return '240px';
  return '280px';
});

const hasData = computed(() => readings.value.length > 0);

const canToggleOvenOverlay = computed(() => ovenEvents.value.length > 0);

/**
 * Transform readings into chart data points
 */
const internalTempData = computed(() => {
  return readings.value.map(r => ({
    x: new Date(r.timestamp),
    y: toDisplayUnit(r.temp, displayUnits.value)
  }));
});

/**
 * Generate projection line from current point to predicted target
 */
const projectionData = computed(() => {
  if (!canPredict.value || !predictedTargetTime.value || !currentTemp.value) {
    return [];
  }
  
  const lastReading = readings.value[readings.value.length - 1];
  const currentTempDisplay = toDisplayUnit(currentTemp.value, displayUnits.value);
  const targetTempDisplay = toDisplayUnit(config.value.targetTemp, displayUnits.value);
  
  // Don't show projection if target is reached
  if (currentTempDisplay >= targetTempDisplay) {
    return [];
  }
  
  return [
    { x: new Date(lastReading.timestamp), y: currentTempDisplay },
    { x: new Date(predictedTargetTime.value), y: targetTempDisplay }
  ];
});

/**
 * Transform oven events into step chart data
 */
const ovenTempData = computed(() => {
  if (ovenEvents.value.length === 0) return [];
  
  const data = [];
  
  ovenEvents.value.forEach((event, index) => {
    const temp = toDisplayUnit(event.setTemp, displayUnits.value);
    const time = new Date(event.timestamp);
    
    // For step chart: add point at previous temp just before this timestamp
    if (index > 0) {
      const prevTemp = toDisplayUnit(ovenEvents.value[index - 1].setTemp, displayUnits.value);
      data.push({ x: time, y: prevTemp });
    }
    
    // Add point at new temp
    data.push({ x: time, y: temp });
  });
  
  // Extend last value to current time
  if (ovenEvents.value.length > 0) {
    const lastEvent = ovenEvents.value[ovenEvents.value.length - 1];
    const lastTemp = toDisplayUnit(lastEvent.setTemp, displayUnits.value);
    data.push({ x: new Date(), y: lastTemp });
  }
  
  return data;
});

/**
 * Compute Y-axis bounds to include all relevant temperatures
 */
const yAxisBounds = computed(() => {
  const temps = [];
  
  // Include all internal readings
  readings.value.forEach(r => {
    temps.push(toDisplayUnit(r.temp, displayUnits.value));
  });
  
  // Include target
  if (config.value) {
    temps.push(toDisplayUnit(config.value.targetTemp, displayUnits.value));
  }
  
  // Include oven temps if overlay is shown
  if (showOvenOverlay.value) {
    ovenEvents.value.forEach(e => {
      temps.push(toDisplayUnit(e.setTemp, displayUnits.value));
    });
  }
  
  if (temps.length === 0) {
    return { min: 0, max: 200 };
  }
  
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const padding = (max - min) * 0.1 || 10;
  
  return {
    min: Math.floor(min - padding),
    max: Math.ceil(max + padding)
  };
});

/**
 * Compute X-axis bounds to show appropriate time range
 */
const xAxisBounds = computed(() => {
  if (readings.value.length === 0) {
    const now = new Date();
    return {
      min: now,
      max: new Date(now.getTime() + 60 * 60 * 1000) // 1 hour from now
    };
  }
  
  const firstTime = new Date(readings.value[0].timestamp);
  let lastTime = new Date(readings.value[readings.value.length - 1].timestamp);
  
  // Extend to predicted target time if available
  if (predictedTargetTime.value) {
    const predicted = new Date(predictedTargetTime.value);
    if (predicted > lastTime) {
      lastTime = predicted;
    }
  }
  
  // Extend to serve time if set and visible
  if (config.value?.desiredServeTime) {
    const serveTime = new Date(config.value.desiredServeTime);
    if (serveTime > lastTime) {
      lastTime = serveTime;
    }
  }
  
  // Add padding
  const duration = lastTime.getTime() - firstTime.getTime();
  const padding = duration * 0.05 || 5 * 60 * 1000;
  
  return {
    min: new Date(firstTime.getTime() - padding),
    max: new Date(lastTime.getTime() + padding)
  };
});

/**
 * Responsive tick limits based on screen width
 */
const maxXTicks = computed(() => {
  if (width.value < 640) return 4;
  if (width.value < 1024) return 6;
  return 8;
});

/**
 * Build chart datasets
 */
const chartData = computed(() => {
  const datasets = [];
  
  // Internal temperature line
  datasets.push({
    label: `Internal Temp (°${displayUnits.value})`,
    data: internalTempData.value,
    borderColor: chartColors.internalTemp.line,
    backgroundColor: chartColors.internalTemp.fill,
    pointBackgroundColor: chartColors.internalTemp.point,
    pointRadius: 4,
    pointHoverRadius: 6,
    tension: 0.1,
    fill: false,
    order: 1
  });
  
  // Projection line
  if (projectionData.value.length > 0) {
    datasets.push({
      label: 'Projected',
      data: projectionData.value,
      borderColor: chartColors.projection.line,
      borderDash: chartColors.projection.dash,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      fill: false,
      order: 2
    });
  }
  
  // Oven temperature overlay (step line)
  if (showOvenOverlay.value && ovenTempData.value.length > 0) {
    datasets.push({
      label: `Oven Set (°${displayUnits.value})`,
      data: ovenTempData.value,
      borderColor: chartColors.ovenTemp.line,
      backgroundColor: chartColors.ovenTemp.fill,
      pointRadius: 0,
      pointHoverRadius: 4,
      stepped: 'before',
      tension: 0,
      fill: false,
      order: 3,
      yAxisID: 'yOven'
    });
  }
  
  return { datasets };
});

/**
 * Build chart options with annotations
 */
const chartOptions = computed(() => {
  const annotations = {};
  
  // Target temperature line
  if (config.value) {
    annotations.targetLine = createTargetAnnotation(
      toDisplayUnit(config.value.targetTemp, displayUnits.value),
      displayUnits.value
    );
  }
  
  // Serve time vertical line
  if (config.value?.desiredServeTime) {
    annotations.serveTimeLine = createServeTimeAnnotation(
      new Date(config.value.desiredServeTime)
    );
  }
  
  const options = {
    ...defaultChartOptions,
    scales: {
      ...defaultChartOptions.scales,
      x: {
        ...defaultChartOptions.scales.x,
        min: xAxisBounds.value.min,
        max: xAxisBounds.value.max,
        ticks: {
          ...defaultChartOptions.scales.x.ticks,
          maxTicksLimit: maxXTicks.value
        }
      },
      y: {
        ...defaultChartOptions.scales.y,
        min: yAxisBounds.value.min,
        max: yAxisBounds.value.max,
        title: {
          display: true,
          text: `Internal Temp (°${displayUnits.value})`,
          font: { size: 12, weight: 'bold' }
        }
      }
    },
    plugins: {
      ...defaultChartOptions.plugins,
      annotation: {
        annotations
      }
    }
  };
  
  // Add secondary Y axis for oven temp if overlay is shown
  if (showOvenOverlay.value && ovenTempData.value.length > 0) {
    options.scales.yOven = {
      type: 'linear',
      position: 'right',
      min: yAxisBounds.value.min,
      max: yAxisBounds.value.max,
      title: {
        display: true,
        text: `Oven Set (°${displayUnits.value})`,
        font: { size: 12, weight: 'bold' }
      },
      grid: {
        drawOnChartArea: false
      },
      ticks: {
        callback: function(value) {
          return value + '°';
        }
      }
    };
  }
  
  return options;
});
</script>

