<template>
  <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mt-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Heating Rate Over Time</h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">°{{ displayUnits }}/hour</span>
    </div>
    
    <div class="h-32">
      <Line
        v-if="hasEnoughData"
        :data="chartData"
        :options="chartOptions"
      />
      <div v-else class="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
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
import { chartColors } from '../config/chartConfig.js';

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
    borderColor: chartColors.rate.line,
    backgroundColor: chartColors.rate.fill,
    pointBackgroundColor: chartColors.rate.point,
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.3,
    fill: true
  }]
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleFont: { size: 13 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
      callbacks: {
        label: (ctx) => `Rate: ${ctx.parsed.y.toFixed(1)}°/hr`
      }
    }
  },
  scales: {
    x: {
      type: 'time',
      display: true,
      time: {
        displayFormats: {
          minute: 'h:mm a',
          hour: 'h:mm a'
        }
      },
      grid: { display: false },
      ticks: { 
        display: true,
        maxTicksLimit: 4,
        font: { size: 10 }
      }
    },
    y: {
      title: {
        display: false
      },
      grid: { 
        display: true,
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        callback: function(value) {
          return value.toFixed(1) + '°/hr';
        },
        font: { size: 10 }
      }
    }
  }
};
</script>


