# Phase 5: Charting & Visualization

## Phase Objectives

Implement the visual charting system that displays internal temperature progress over time, oven temperature changes, target temperature reference line, and predicted projection to target. This phase creates the primary visual feedback mechanism that helps users understand cooking progress at a glance.

## Prerequisites

Phase 4 must be complete, providing the calculation engine and status display components.

## Deliverables

1. TemperatureChart component with Chart.js integration
2. Internal temperature line with data points
3. Target temperature horizontal reference line
4. Predicted projection line to target
5. Oven temperature step chart overlay or secondary chart
6. Responsive chart sizing and mobile optimization
7. Interactive chart features (tooltips, zoom)

---

## Task 5.1: Chart.js Configuration and Plugin Setup

### Description

Configure Chart.js with necessary plugins and establish default chart options that will be shared across chart components.

### File: /src/config/chartConfig.js

```javascript
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
  annotationPlugin
);

/**
 * Default chart options for consistent styling
 */
export const defaultChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false
  },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        usePointStyle: true,
        padding: 15,
        font: {
          size: 12
        }
      }
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleFont: { size: 13 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
      displayColors: true
    }
  },
  scales: {
    x: {
      type: 'time',
      time: {
        displayFormats: {
          minute: 'h:mm a',
          hour: 'h:mm a'
        },
        tooltipFormat: 'MMM d, h:mm a'
      },
      title: {
        display: true,
        text: 'Time',
        font: { size: 12, weight: 'bold' }
      },
      grid: {
        display: true,
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 6
      }
    },
    y: {
      title: {
        display: true,
        text: 'Temperature',
        font: { size: 12, weight: 'bold' }
      },
      grid: {
        display: true,
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        callback: function(value) {
          return value + '°';
        }
      }
    }
  }
};

/**
 * Color palette for chart elements
 */
export const chartColors = {
  internalTemp: {
    line: 'rgb(239, 68, 68)',      // red-500
    point: 'rgb(220, 38, 38)',     // red-600
    fill: 'rgba(239, 68, 68, 0.1)'
  },
  ovenTemp: {
    line: 'rgb(245, 158, 11)',     // amber-500
    point: 'rgb(217, 119, 6)',     // amber-600
    fill: 'rgba(245, 158, 11, 0.1)'
  },
  projection: {
    line: 'rgba(239, 68, 68, 0.5)', // red-500 with transparency
    dash: [5, 5]
  },
  target: {
    line: 'rgb(34, 197, 94)',      // green-500
    dash: [10, 5]
  },
  serveTime: {
    line: 'rgb(59, 130, 246)',     // blue-500
    dash: [5, 5]
  }
};

/**
 * Create annotation configuration for target temperature line
 * @param {number} targetTemp - Target temperature value
 * @param {'F'|'C'} units - Display units
 * @returns {Object} Annotation configuration
 */
export function createTargetAnnotation(targetTemp, units) {
  return {
    type: 'line',
    yMin: targetTemp,
    yMax: targetTemp,
    borderColor: chartColors.target.line,
    borderWidth: 2,
    borderDash: chartColors.target.dash,
    label: {
      display: true,
      content: `Target: ${targetTemp}°${units}`,
      position: 'end',
      backgroundColor: 'rgba(34, 197, 94, 0.8)',
      color: 'white',
      font: { size: 11, weight: 'bold' },
      padding: 4
    }
  };
}

/**
 * Create annotation configuration for serve time vertical line
 * @param {Date} serveTime - Desired serve time
 * @returns {Object} Annotation configuration
 */
export function createServeTimeAnnotation(serveTime) {
  return {
    type: 'line',
    xMin: serveTime,
    xMax: serveTime,
    borderColor: chartColors.serveTime.line,
    borderWidth: 2,
    borderDash: chartColors.serveTime.dash,
    label: {
      display: true,
      content: 'Serve Time',
      position: 'start',
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      color: 'white',
      font: { size: 11 },
      padding: 4
    }
  };
}
```

---

## Task 5.2: Temperature Chart Component

### Description

Create the main temperature chart component that displays internal temperature readings over time with the target line and prediction projection.

### File: /src/components/TemperatureChart.vue

```javascript
<template>
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-700">Temperature Progress</h3>
      <div class="flex items-center gap-2">
        <button
          v-if="canToggleOvenOverlay"
          @click="showOvenOverlay = !showOvenOverlay"
          class="text-xs px-2 py-1 rounded border"
          :class="showOvenOverlay ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-gray-50 border-gray-300 text-gray-600'"
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
      <div v-else class="absolute inset-0 flex items-center justify-center text-gray-400">
        <div class="text-center">
          <ThermometerIcon class="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>Add readings to see your progress</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Line } from 'vue-chartjs';
import { useSession } from '../composables/useSession.js';
import { useCalculations } from '../composables/useCalculations.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';
import { addMinutes } from '../utils/timeUtils.js';
import {
  defaultChartOptions,
  chartColors,
  createTargetAnnotation,
  createServeTimeAnnotation
} from '../config/chartConfig.js';
import { ThermometerIcon } from 'lucide-vue-next';

const props = defineProps({
  height: { type: String, default: '280px' }
});

const { readings, ovenEvents, config, displayUnits } = useSession();
const { predictedTargetTime, currentTemp, canPredict } = useCalculations();

const showOvenOverlay = ref(true);

const chartHeight = computed(() => props.height);

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
        max: xAxisBounds.value.max
      },
      y: {
        ...defaultChartOptions.scales.y,
        min: yAxisBounds.value.min,
        max: yAxisBounds.value.max,
        title: {
          display: true,
          text: `Internal Temp (°${displayUnits.value})`
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
        text: `Oven Set (°${displayUnits.value})`
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
```

---

## Task 5.3: Oven Temperature Segment Visualization (Optional Enhancement)

### Description

Create an optional visualization that shows colored segments on the internal temperature line corresponding to different oven temperature periods, helping users understand how oven changes affected heating rate.

### File: /src/components/OvenSegmentOverlay.vue

This component is designed to be used as an overlay or enhancement to the main chart. It creates shaded background regions corresponding to each oven temperature setting period.

```javascript
<script setup>
import { computed } from 'vue';
import { useSession } from '../composables/useSession.js';
import { minutesBetween } from '../utils/timeUtils.js';

const { ovenEvents, readings } = useSession();

/**
 * Generate segment data for visualization
 * Each segment represents a period at a specific oven temperature
 */
const ovenSegments = computed(() => {
  if (ovenEvents.value.length === 0) return [];
  
  const segments = [];
  
  ovenEvents.value.forEach((event, index) => {
    const startTime = new Date(event.timestamp);
    let endTime;
    
    if (index < ovenEvents.value.length - 1) {
      endTime = new Date(ovenEvents.value[index + 1].timestamp);
    } else {
      endTime = new Date(); // Ongoing segment
    }
    
    // Find readings within this segment
    const segmentReadings = readings.value.filter(r => {
      const readingTime = new Date(r.timestamp);
      return readingTime >= startTime && readingTime < endTime;
    });
    
    // Calculate segment statistics
    let segmentRate = null;
    if (segmentReadings.length >= 2) {
      const first = segmentReadings[0];
      const last = segmentReadings[segmentReadings.length - 1];
      const hours = minutesBetween(first.timestamp, last.timestamp) / 60;
      if (hours > 0.01) {
        segmentRate = (last.temp - first.temp) / hours;
      }
    }
    
    segments.push({
      startTime,
      endTime,
      ovenTemp: event.setTemp,
      duration: minutesBetween(event.timestamp, endTime.toISOString()),
      readingCount: segmentReadings.length,
      heatingRate: segmentRate,
      isOngoing: index === ovenEvents.value.length - 1
    });
  });
  
  return segments;
});

defineExpose({ ovenSegments });
</script>
```

To integrate this with Chart.js, create background box annotations for each segment:

```javascript
// In TemperatureChart.vue, add to annotations computation
function createSegmentAnnotations(segments, displayUnits) {
  const annotations = {};
  
  segments.forEach((segment, index) => {
    // Color based on oven temp (warmer = more red/orange, cooler = more blue)
    const hue = Math.max(0, Math.min(60, (300 - segment.ovenTemp) * 0.5));
    const color = `hsla(${hue}, 70%, 50%, 0.1)`;
    
    annotations[`segment_${index}`] = {
      type: 'box',
      xMin: segment.startTime,
      xMax: segment.endTime,
      backgroundColor: color,
      borderWidth: 0
    };
  });
  
  return annotations;
}
```

---

## Task 5.4: Mini Chart for Status Card (Optional)

### Description

Create a compact sparkline-style mini chart that can be embedded in the status cards for a quick visual preview of progress.

### File: /src/components/MiniProgressChart.vue

```javascript
<template>
  <div class="h-12 w-full">
    <Line
      v-if="hasData"
      :data="chartData"
      :options="chartOptions"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { useSession } from '../composables/useSession.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';
import { chartColors } from '../config/chartConfig.js';

const { readings, config, displayUnits } = useSession();

const hasData = computed(() => readings.value.length >= 2);

const chartData = computed(() => {
  const data = readings.value.map(r => ({
    x: new Date(r.timestamp),
    y: toDisplayUnit(r.temp, displayUnits.value)
  }));
  
  return {
    datasets: [{
      data,
      borderColor: chartColors.internalTemp.line,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false
    }]
  };
});

const chartOptions = computed(() => {
  const targetTemp = config.value ? toDisplayUnit(config.value.targetTemp, displayUnits.value) : null;
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      annotation: targetTemp ? {
        annotations: {
          target: {
            type: 'line',
            yMin: targetTemp,
            yMax: targetTemp,
            borderColor: chartColors.target.line,
            borderWidth: 1,
            borderDash: [3, 3]
          }
        }
      } : {}
    },
    scales: {
      x: {
        display: false,
        type: 'time'
      },
      y: {
        display: false
      }
    },
    elements: {
      line: {
        borderWidth: 2
      }
    }
  };
});
</script>
```

---

## Task 5.5: Chart Touch and Interaction Handling

### Description

Implement touch-friendly interactions for the chart including pan, zoom, and tooltip behavior optimized for mobile devices.

### File: /src/composables/useChartInteraction.js

```javascript
import { ref, onMounted, onUnmounted } from 'vue';

/**
 * Composable for managing chart touch interactions
 * @param {Ref<HTMLElement>} chartContainerRef - Reference to the chart container element
 */
export function useChartInteraction(chartContainerRef) {
  const isZoomed = ref(false);
  const zoomLevel = ref(1);
  const panOffset = ref({ x: 0, y: 0 });
  
  let lastTouchDistance = null;
  let lastTouchCenter = null;
  
  function handleTouchStart(event) {
    if (event.touches.length === 2) {
      // Pinch zoom start
      lastTouchDistance = getTouchDistance(event.touches);
      lastTouchCenter = getTouchCenter(event.touches);
    }
  }
  
  function handleTouchMove(event) {
    if (event.touches.length === 2 && lastTouchDistance !== null) {
      event.preventDefault();
      
      const currentDistance = getTouchDistance(event.touches);
      const scale = currentDistance / lastTouchDistance;
      
      zoomLevel.value = Math.max(1, Math.min(4, zoomLevel.value * scale));
      isZoomed.value = zoomLevel.value > 1;
      
      lastTouchDistance = currentDistance;
    }
  }
  
  function handleTouchEnd() {
    lastTouchDistance = null;
    lastTouchCenter = null;
  }
  
  function resetZoom() {
    zoomLevel.value = 1;
    panOffset.value = { x: 0, y: 0 };
    isZoomed.value = false;
  }
  
  function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  function getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  }
  
  onMounted(() => {
    const container = chartContainerRef.value;
    if (container) {
      container.addEventListener('touchstart', handleTouchStart, { passive: false });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd);
    }
  });
  
  onUnmounted(() => {
    const container = chartContainerRef.value;
    if (container) {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    }
  });
  
  return {
    isZoomed,
    zoomLevel,
    panOffset,
    resetZoom
  };
}
```

---

## Task 5.6: Chart Tooltip Customization

### Description

Create custom tooltip content that provides detailed information when users interact with data points on the chart.

### Integration with Chart Options

```javascript
// In chartConfig.js or within TemperatureChart.vue
const customTooltip = {
  callbacks: {
    title: function(context) {
      const date = new Date(context[0].parsed.x);
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    },
    label: function(context) {
      const datasetLabel = context.dataset.label || '';
      const value = context.parsed.y;
      
      // Add additional context based on dataset
      if (datasetLabel.includes('Internal')) {
        return `Internal: ${value.toFixed(1)}°`;
      }
      if (datasetLabel.includes('Oven')) {
        return `Oven Set: ${value.toFixed(0)}°`;
      }
      if (datasetLabel.includes('Projected')) {
        return `Projected: ${value.toFixed(1)}°`;
      }
      
      return `${datasetLabel}: ${value}`;
    },
    afterBody: function(context) {
      // Find the corresponding reading to show delta
      const timestamp = context[0].parsed.x;
      const reading = findReadingByTimestamp(timestamp);
      
      if (reading && reading.deltaFromStart !== null) {
        return [`Change from start: ${formatDelta(reading.deltaFromStart)}`];
      }
      return [];
    }
  }
};
```

---

## Task 5.7: Rate of Change Visualization (Optional)

### Description

Create an optional secondary chart or overlay that visualizes the heating rate over time, helping users understand how quickly the temperature is rising.

### File: /src/components/RateChart.vue

```javascript
<template>
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mt-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-700">Heating Rate Over Time</h3>
      <span class="text-xs text-gray-500">°{{ displayUnits }}/hour</span>
    </div>
    
    <div class="h-32">
      <Line
        v-if="hasEnoughData"
        :data="chartData"
        :options="chartOptions"
      />
      <div v-else class="h-full flex items-center justify-center text-gray-400 text-sm">
        Need more readings to show rate trend
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { useSession } from '../composables/useSession.js';
import { hoursBetween } from '../utils/timeUtils.js';
import { convertRate } from '../utils/temperatureUtils.js';

const { readings, displayUnits } = useSession();

const hasEnoughData = computed(() => readings.value.length >= 3);

/**
 * Calculate instantaneous rate at each reading (using surrounding points)
 */
const rateData = computed(() => {
  if (readings.value.length < 3) return [];
  
  const rates = [];
  
  for (let i = 1; i < readings.value.length; i++) {
    const prev = readings.value[i - 1];
    const current = readings.value[i];
    
    const hours = hoursBetween(prev.timestamp, current.timestamp);
    if (hours > 0.001) {
      const rateF = (current.temp - prev.temp) / hours;
      const rateDisplay = convertRate(rateF, displayUnits.value);
      
      rates.push({
        x: new Date(current.timestamp),
        y: rateDisplay
      });
    }
  }
  
  return rates;
});

const chartData = computed(() => ({
  datasets: [{
    label: 'Heating Rate',
    data: rateData.value,
    borderColor: 'rgb(168, 85, 247)', // purple-500
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    pointRadius: 3,
    tension: 0.3,
    fill: true
  }]
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => `Rate: ${ctx.parsed.y.toFixed(1)}°/hr`
      }
    }
  },
  scales: {
    x: {
      type: 'time',
      display: true,
      grid: { display: false },
      ticks: { display: false }
    },
    y: {
      title: {
        display: false
      },
      grid: { 
        display: true,
        color: 'rgba(0, 0, 0, 0.05)'
      }
    }
  }
};
</script>
```

---

## Task 5.8: Chart Responsive Behavior

### Description

Implement responsive behavior for charts that adapts to different screen sizes and orientations.

### Implementation Guidelines

The chart container should have responsive height: smaller on mobile (200-240px), larger on tablet and desktop (280-350px). Use CSS container queries or media queries to adjust the chart height prop.

The legend should be positioned at the top on mobile (to avoid overlapping with touch controls), and can be positioned on the right on wider screens if there's room.

On mobile in landscape orientation, allow the chart to expand to use more vertical space since width is limited.

Axis tick density should be reduced on narrow screens to prevent label overlap. Use the maxTicksLimit option to control this dynamically based on container width.

```javascript
// In TemperatureChart.vue
import { useWindowSize } from '@vueuse/core';

const { width } = useWindowSize();

const chartHeight = computed(() => {
  if (width.value < 400) return '200px';
  if (width.value < 768) return '240px';
  return '300px';
});

const maxXTicks = computed(() => {
  if (width.value < 400) return 4;
  if (width.value < 768) return 6;
  return 8;
});
```

---

## Phase 5 Completion Checklist

Before proceeding to Phase 6, verify the following:

1. **Chart renders with data**: Add several readings and verify the line chart displays correctly with points at the correct positions.

2. **Target line is visible**: Verify the horizontal target temperature line appears at the correct Y value with its label.

3. **Projection line extends correctly**: With enough data for prediction, verify the dashed projection line extends from the last reading to the predicted target time and temperature.

4. **Oven temperature overlay works**: Toggle the oven overlay and verify the step chart displays correctly, showing temperature changes as discrete steps.

5. **Serve time line appears**: When a desired serve time is set, verify the vertical serve time indicator line appears at the correct X position.

6. **Tooltips show correct information**: Hover or tap on data points and verify the tooltip displays accurate time, temperature, and delta information.

7. **Chart scales appropriately**: Verify that Y-axis bounds adjust to include all data points and the target, with appropriate padding.

8. **X-axis extends to show projection**: When a prediction is available, verify the X-axis extends far enough to show the entire projection line.

9. **Unit conversion works in charts**: Toggle between °F and °C and verify all chart labels, values, and annotations update correctly.

10. **Mobile responsiveness**: Test on narrow viewports and verify the chart remains usable, with appropriately sized touch targets and readable labels.

11. **Empty state displays**: With no readings, verify an appropriate empty state message is shown instead of an empty chart.

---

## Dependencies for Next Phase

Phase 6 (Recommendation Engine) will depend on:
- Calculation results from useCalculations
- Oven event history for context
- Schedule variance for timing recommendations
- Confidence levels for gating recommendations
