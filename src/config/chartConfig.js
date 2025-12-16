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
 * Color palette for chart elements (Tailwind-based)
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
  },
  rate: {
    line: 'rgb(168, 85, 247)',     // purple-500
    point: 'rgb(147, 51, 234)',    // purple-600
    fill: 'rgba(168, 85, 247, 0.1)'
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

/**
 * Create segment annotations for oven temperature periods
 * @param {Array} segments - Array of segment objects with startTime, endTime, ovenTemp
 * @returns {Object} Annotations object
 */
export function createSegmentAnnotations(segments) {
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


