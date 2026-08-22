import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  TimeScale
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-date-fns';

// Only what the one chart in this app actually draws. Legend, Title and
// CategoryScale are deliberately absent — the chart has no legend and no axis
// titles, and its x axis is time, not categories.
ChartJS.register(
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  annotationPlugin
);

/**
 * Canvas can't read CSS custom properties, so the chart carries its own copy of
 * the palette. These are the same hex values as tailwind.config.js — if one
 * moves, both move.
 *
 * Saturation encodes register, exactly as it does in the DOM: the heat ramp is
 * live measurement (the internal line, its fill, the oven track) and nothing
 * else. Interpretation — the target rule, the serve rule, the projection —
 * stays in the neutral inks.
 */
export const chartPalette = {
  ground: '#14110F',
  rule: '#2C2621',
  // A notch below `rule`: gridlines are orientation, not content, and the data
  // has to dominate them at arm's length.
  grid: '#221D19',
  ink: '#F5F0EA',
  inkDim: '#A79C91',
  inkMute: '#776C62',
  // The rest band. Interpretation, so neutral - and barely there: it is a region
  // of the plot, not a mark in it, and the meat trace runs straight through it.
  // Two notches under `grid` in effective lightness once alpha is applied.
  restBand: 'rgba(167, 156, 145, 0.09)',

  heatCold: '#4E7FA8',
  heatWarm: '#D98324',
  heatHot: '#E0452A'
};

/** Condensed numerals, same face as `.readout` and `.num`. */
export const DISPLAY_FONT = "'Barlow Semi Condensed', system-ui, sans-serif";

/**
 * Chrome-free defaults. No legend, no axis titles, hairline gridlines, and y
 * ticks drawn *inside* the plot area (`mirror`) so the line gets the full
 * screen width instead of surrendering ~34px to a tick gutter.
 */
export const defaultChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  // Long cook, rare updates — a slow tween just looks like lag.
  animation: { duration: 200 },
  // The plot bleeds to both edges. Top padding is headroom for the labels that
  // sit above the topmost data; the small right inset keeps a flipped label off
  // the bezel.
  layout: { padding: { top: 12, right: 6, bottom: 0, left: 0 } },
  interaction: {
    mode: 'index',
    intersect: false
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      // Dataset 0 is always the internal temperature (see chartData). The
      // projection and the oven track are reference, not readings — offering
      // them in a tooltip invites the user to read precision that isn't there.
      filter: (item) => item.datasetIndex === 0,
      backgroundColor: chartPalette.rule,
      borderColor: chartPalette.rule,
      titleColor: chartPalette.inkDim,
      bodyColor: chartPalette.ink,
      titleFont: { size: 11 },
      bodyFont: { family: DISPLAY_FONT, size: 15, weight: 600 },
      padding: 8,
      cornerRadius: 8,
      displayColors: false
    }
  },
  scales: {
    x: {
      type: 'time',
      time: {
        displayFormats: {
          minute: 'h:mm',
          hour: 'h:mm a'
        },
        tooltipFormat: 'h:mm a'
      },
      // Vertical gridlines add nothing the time labels don't already say.
      grid: { display: false },
      border: { display: false },
      ticks: {
        // 'inner' pulls the first and last label back inside the canvas. Without
        // it Chart.js reserves horizontal padding for their overhang and the
        // plot stops short of the screen edges.
        align: 'inner',
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 4,
        padding: 4,
        color: chartPalette.inkMute,
        font: { family: DISPLAY_FONT, size: 11 }
      }
    },
    y: {
      grid: {
        color: chartPalette.grid,
        lineWidth: 1,
        drawTicks: false
      },
      border: { display: false },
      ticks: {
        mirror: true,
        padding: 6,
        maxTicksLimit: 3,
        color: chartPalette.inkMute,
        font: { family: DISPLAY_FONT, size: 11 },
        callback: (value) => `${value}°`
      }
    }
  }
};

/**
 * The oven's own scale: the bottom fifth of the plot, sharing the time axis.
 * Chart.js 4 stacked cartesian scales (`stack` + `stackWeight`) give the oven a
 * real range of its own without a second axis on the right — the meat's scale
 * stays untouched by oven temperatures, which is the whole point.
 *
 * @param {number} max - Highest oven setting in display units
 * @returns {Object} Scale configuration for `yOven`
 */
export function createOvenScale(max) {
  return {
    type: 'linear',
    position: 'left',
    stack: 'roast',
    stackWeight: 1,
    // Lower `weight` than the meat's scale, which is what puts the oven at the
    // bottom of the stack. Both scales must set it explicitly — Chart.js sorts
    // stacked boxes by weight, and an undefined one falls back to insertion
    // order.
    weight: 0,
    min: 0,
    // Headroom so the top step isn't welded to the band's ceiling.
    max: Math.max(Math.ceil(max * 1.18), 1),
    grid: { display: false },
    border: { display: false },
    // No axis, no ticks: the track is a reference silhouette, and its current
    // value is spelled out in the footnote below the plot.
    ticks: { display: false }
  };
}

/**
 * Horizontal rule at the PULL temperature. Interpretation, so it stays in the
 * neutral inks — it must never read as a third heat series.
 *
 * ONE rule, not two. There are now two temperatures worth naming, but they are
 * typically 3–8° apart, which at this plot's scale is a handful of pixels: two
 * rules would overlap, and their labels certainly would. So the rule is drawn
 * where the projection actually lands — the pull — and the plate temperature
 * rides in the same label.
 *
 * @param {number} pullTemp - Pull temperature in display units
 * @param {'F'|'C'} units - Display units
 * @param {number|null} [servingTemp] - Plate temperature in display units, named
 *   alongside when it differs
 * @returns {Object} Annotation configuration
 */
export function createTargetAnnotation(pullTemp, units, servingTemp = null) {
  const showPlate = servingTemp !== null &&
    servingTemp !== undefined &&
    Math.round(servingTemp) !== Math.round(pullTemp);
  
  return {
    type: 'line',
    yMin: pullTemp,
    yMax: pullTemp,
    borderColor: chartPalette.inkMute,
    borderWidth: 1,
    borderDash: [2, 4],
    label: {
      display: true,
      content: showPlate
        ? `PULL ${Math.round(pullTemp)}° · PLATE ${Math.round(servingTemp)}°`
        : `PULL ${Math.round(pullTemp)}°${units}`,
      position: 'start',
      rotation: 0,
      // Inset from the left edge, lifted clear of the rule itself.
      xAdjust: 2,
      yAdjust: -9,
      backgroundColor: 'transparent',
      borderWidth: 0,
      color: chartPalette.inkDim,
      font: { family: DISPLAY_FONT, size: 10, weight: 600 },
      padding: 0
    }
  };
}

/**
 * The rest, as a shaded band from the projected pull to the projected serve.
 *
 * Its LEFT edge is the thing worth seeing: that is the moment the meat has to be
 * out of the oven, which is the deadline the app is actually steering towards.
 * The serve rule sits at the right-hand end, and the width between them is the
 * rest — so a cook can see at a glance why "on track" means coming out of the
 * oven well before dinner.
 *
 * Drawn behind everything (`drawTime: 'beforeDatasetsDraw'`) so the meat and
 * oven traces stay on top of it.
 *
 * @param {number} fromMs - Projected pull time
 * @param {number} toMs - Projected serve time
 * @returns {Object} Annotation configuration
 */
export function createRestBandAnnotation(fromMs, toMs) {
  return {
    type: 'box',
    xMin: fromMs,
    xMax: toMs,
    backgroundColor: chartPalette.restBand,
    borderWidth: 0,
    drawTime: 'beforeDatasetsDraw',
    label: {
      display: true,
      content: 'REST',
      position: { x: 'center', y: 'start' },
      rotation: 0,
      yAdjust: 8,
      backgroundColor: 'transparent',
      borderWidth: 0,
      color: chartPalette.inkMute,
      font: { family: DISPLAY_FONT, size: 9, weight: 600 },
      padding: 0
    }
  };
}

/**
 * Vertical rule at the desired serve time. Bare hairline — its label is placed
 * separately (see createDataLabel) so the caller can flip it away from the
 * right edge and keep it clear of the crossing marker.
 *
 * @param {Date} serveTime - Desired serve time
 * @returns {Object} Annotation configuration
 */
export function createServeTimeAnnotation(serveTime) {
  return {
    type: 'line',
    xMin: serveTime,
    xMax: serveTime,
    borderColor: chartPalette.inkMute,
    borderWidth: 1,
    borderDash: [3, 3]
  };
}

/**
 * The crossing marker: where the projection lands on the target rule. The
 * horizontal distance between this dot and the serve rule *is* the early/late
 * verdict, which is why it's the one loud mark on the plot.
 *
 * @param {Date} time - Predicted target time
 * @param {number} temp - Target temperature in display units
 * @returns {Object} Annotation configuration
 */
export function createCrossingMarker(time, temp) {
  return {
    type: 'point',
    xValue: time,
    yValue: temp,
    radius: 5,
    backgroundColor: chartPalette.ink,
    // A ground-coloured ring separates the dot from the rule it sits on.
    borderColor: chartPalette.ground,
    borderWidth: 2
  };
}

const LABEL_TONES = {
  // The crossing time. The brightest thing on the plot, on purpose.
  signature: {
    color: chartPalette.ground,
    backgroundColor: chartPalette.ink,
    borderRadius: 4,
    padding: { x: 6, y: 3 },
    font: { family: DISPLAY_FONT, size: 14, weight: 700 }
  },
  // A live measurement labelled at its own end, in place of a legend entry.
  live: {
    color: chartPalette.heatHot,
    backgroundColor: chartPalette.ground,
    borderRadius: 3,
    padding: { x: 3, y: 1 },
    font: { family: DISPLAY_FONT, size: 12, weight: 700 }
  },
  // Reference text: the serve time, and anything else the eye should skip.
  quiet: {
    color: chartPalette.inkDim,
    backgroundColor: chartPalette.ground,
    borderRadius: 2,
    padding: { x: 3, y: 1 },
    font: { family: DISPLAY_FONT, size: 10, weight: 600 }
  }
};

/**
 * A label pinned to a data coordinate — the direct-labelling primitive that
 * replaces the legend.
 *
 * `side` and `vertical` decide which side of the anchor the box hangs off, so
 * the caller can flip a label inward near an edge. Annotations are clipped to
 * the plot area, so an unflipped label at the right edge would be sliced in
 * half at 320px rather than overflowing.
 *
 * @param {Object} spec
 * @param {Date|number} spec.x - Anchor on the x scale
 * @param {number} spec.y - Anchor on the y scale named by `scaleID`
 * @param {string} spec.content - Label text
 * @param {'right'|'left'} [spec.side] - Which side of the anchor to sit on
 * @param {'above'|'below'|'middle'} [spec.vertical] - Vertical placement
 * @param {'signature'|'live'|'quiet'} [spec.tone] - Visual weight
 * @param {string} [spec.scaleID] - y scale to anchor against ('y' or 'yOven')
 * @returns {Object} Annotation configuration
 */
export function createDataLabel({
  x,
  y,
  content,
  side = 'right',
  vertical = 'middle',
  tone = 'quiet',
  scaleID = 'y'
}) {
  const gap = tone === 'signature' ? 9 : 6;

  return {
    type: 'label',
    xValue: x,
    yValue: y,
    yScaleID: scaleID,
    content,
    // 'start' puts the box's leading edge on the anchor (label to the right of
    // it); 'end' puts its trailing edge there (label to the left).
    position: {
      x: side === 'right' ? 'start' : 'end',
      y: vertical === 'above' ? 'end' : vertical === 'below' ? 'start' : 'center'
    },
    xAdjust: side === 'right' ? gap : -gap,
    yAdjust: vertical === 'above' ? -5 : vertical === 'below' ? 5 : 0,
    borderWidth: 0,
    ...LABEL_TONES[tone]
  };
}

/**
 * Stroke for the internal temperature line: a vertical ramp across the meat's
 * own scale, so the line's hue reports roughly where in the range the meat sits
 * — cold blue at the bottom, hot red as it approaches target.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{top: number, bottom: number}} scale - The `y` scale, not chartArea:
 *   chartArea includes the oven band, which would shift the ramp.
 * @returns {CanvasGradient|string}
 */
export function createHeatStroke(ctx, scale) {
  if (!scale || scale.bottom === scale.top) {
    return chartPalette.heatWarm;
  }

  const gradient = ctx.createLinearGradient(0, scale.bottom, 0, scale.top);
  gradient.addColorStop(0, chartPalette.heatCold);
  gradient.addColorStop(0.55, chartPalette.heatWarm);
  gradient.addColorStop(1, chartPalette.heatHot);
  return gradient;
}

/**
 * Wash under the internal temperature line. Warm, and faint enough that the
 * gridlines still read through it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{top: number, bottom: number}} scale - The `y` scale
 * @returns {CanvasGradient|string}
 */
export function createHeatFill(ctx, scale) {
  if (!scale || scale.bottom === scale.top) {
    return 'rgba(217, 131, 36, 0.12)';
  }

  const gradient = ctx.createLinearGradient(0, scale.top, 0, scale.bottom);
  gradient.addColorStop(0, 'rgba(217, 131, 36, 0.22)');
  gradient.addColorStop(1, 'rgba(217, 131, 36, 0)');
  return gradient;
}
