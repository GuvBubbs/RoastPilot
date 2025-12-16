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

