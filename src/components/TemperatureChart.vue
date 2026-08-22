<template>
  <section class="rule">
    <!-- Full bleed. No card, no gutter, no header: the y ticks are drawn inside
         the plot area, so the line runs from screen edge to screen edge. -->
    <div v-if="hasData" class="band-flush relative" :style="{ height: chartHeight }">
      <Line :data="chartData" :options="chartOptions" />
    </div>

    <!-- Zero readings. An invitation at its natural size — not an empty axis
         padded out to chart height. -->
    <div v-else class="band py-7 text-center">
      <p class="text-[15px] text-ink-dim">No curve yet</p>
      <p class="mt-1 text-[13px] text-ink-mute">
        Log a reading and the projection draws itself.
      </p>
    </div>

    <!-- The oven track has no axis of its own, so its current setting is spelled
         out here. This is the only text allowed inside the gutter. -->
    <p v-if="hasData && ovenFootnote" class="band pt-1 pb-3 text-[11px] text-ink-mute truncate">
      {{ ovenFootnote }}
    </p>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { useWindowSize } from '@vueuse/core';
import { useSession } from '../composables/useSession.js';
import { hasReadingSince } from '../services/recommendationService.js';
import { useCalculations } from '../composables/useCalculations.js';
import { toDisplayUnit } from '../utils/temperatureUtils.js';
import { formatTime } from '../utils/timeUtils.js';
import {
  defaultChartOptions,
  createOvenScale,
  createTargetAnnotation,
  createRestBandAnnotation,
  createServeTimeAnnotation,
  createCrossingMarker,
  createDataLabel,
  createHeatStroke,
  createHeatFill,
  chartPalette
} from '../config/chartConfig.js';

const props = defineProps({
  height: { type: String, default: null }
});

const { readings, ovenEvents, config, displayUnits } = useSession();
const {
  predictedTargetTime, currentTemp, canPredict, restMinutes, predictedServeTime
} = useCalculations();

const { width } = useWindowSize();

/** A one-reading cook has no duration yet; give the time axis a real window. */
const MIN_SPAN_MS = 45 * 60 * 1000;

/**
 * Rough rendered widths of the direct labels, in px. Only used to decide which
 * side of its anchor a label hangs off — annotations are clipped to the plot, so
 * a label that doesn't fit gets sliced rather than overflowing.
 */
const LABEL_WIDTHS = {
  crossing: 70,
  serve: 76,
  reading: 36
};

/**
 * The mirrored y ticks live in the left ~34px of the plot. A direct label placed
 * over them is unreadable, so the series end label gives up when its point is
 * that far left.
 */
const TICK_GUTTER_FRACTION = 0.18;

const hasData = computed(() => readings.value.length > 0);

const chartHeight = computed(() => {
  if (props.height) return props.height;

  let base = 300;
  if (width.value < 640) base = 220;
  else if (width.value < 1024) base = 260;

  // The oven takes a fifth of the plot; pay for it rather than squeezing the
  // meat's band.
  return `${hasOvenTrack.value ? base + 36 : base}px`;
});

/**
 * Time domain. Also the data horizon: the right edge is the latest thing the
 * chart knows about, and the oven track is extended to exactly this point.
 *
 * Deliberately clock-free. Nothing here reads `new Date()` for a session that
 * has any data, so the domain can't freeze at first evaluation.
 */
const xDomain = computed(() => {
  const starts = [];
  const firstReading = readings.value[0];
  const firstOven = ovenEvents.value[0];

  if (firstReading) starts.push(new Date(firstReading.timestamp).getTime());
  // The oven is normally set before the probe goes in, and the track should be
  // visible from that moment. Oven events widen the *time* domain only — never
  // the temperature range.
  if (firstOven) starts.push(new Date(firstOven.timestamp).getTime());

  const start = starts.length ? Math.min(...starts) : Date.now();

  const ends = [start];
  const lastReading = readings.value[readings.value.length - 1];
  if (lastReading) ends.push(new Date(lastReading.timestamp).getTime());
  if (predictedTargetTime.value) ends.push(new Date(predictedTargetTime.value).getTime());
  if (config.value?.desiredServeTime) {
    ends.push(new Date(config.value.desiredServeTime).getTime());
  }

  let end = Math.max(...ends);
  if (end - start < MIN_SPAN_MS) {
    end = start + MIN_SPAN_MS;
  }

  const pad = (end - start) * 0.04;
  return { min: start - pad, max: end + pad };
});

/** Where a timestamp falls across the plot width, 0..1. */
function xFraction(time) {
  const { min, max } = xDomain.value;
  if (max === min) return 0;
  return (new Date(time).getTime() - min) / (max - min);
}

/**
 * The plot is full bleed, so its width is the viewport less the small right
 * inset from `layout.padding`.
 */
const plotWidth = computed(() => Math.max(width.value - 6, 280));

/**
 * Which side of its anchor a label should sit on: the preferred side while it
 * fits, otherwise the other one. A measurement rather than a magic fraction, so
 * it holds at 320px and at 430px.
 *
 * @param {Date|number} time - Anchor on the time axis
 * @param {number} labelWidth - Approximate rendered width of the label
 * @param {'left'|'right'} [prefer] - Side to use when both fit
 * @returns {'left'|'right'}
 */
function labelSide(time, labelWidth, prefer = 'right') {
  const gap = 9;
  const x = xFraction(time) * plotWidth.value;

  const fits = {
    right: x + gap + labelWidth <= plotWidth.value,
    left: x - gap - labelWidth >= 0
  };

  if (fits[prefer]) return prefer;

  const other = prefer === 'right' ? 'left' : 'right';
  return fits[other] ? other : prefer;
}

/**
 * Time ticks a person reads without doing arithmetic. Left to itself Chart.js
 * divides a pinned domain into equal parts and prints things like "2:37, 3:21,
 * 4:05"; naming the unit and step keeps them on the quarter hour or the hour.
 */
const timeTicks = computed(() => {
  const hours = (xDomain.value.max - xDomain.value.min) / 3600000;
  const wanted = hours / (width.value < 640 ? 3.2 : 5);

  const steps = [
    { unit: 'minute', stepSize: 15, hours: 0.25 },
    { unit: 'minute', stepSize: 30, hours: 0.5 },
    { unit: 'hour', stepSize: 1, hours: 1 },
    { unit: 'hour', stepSize: 2, hours: 2 },
    { unit: 'hour', stepSize: 3, hours: 3 }
  ];

  const step = steps.find(s => s.hours >= wanted) ?? steps[steps.length - 1];
  return { unit: step.unit, stepSize: step.stepSize };
});

/**
 * The meat's own temperature range, derived from the readings and the target
 * ONLY. Folding oven temperatures in here is what crushed a single 8° reading
 * into the floor of a 0..110 plot.
 */
const meatRange = computed(() => {
  const temps = readings.value.map(r => toDisplayUnit(r.temp, displayUnits.value));

  if (config.value) {
    temps.push(toDisplayUnit(config.value.pullTempF, displayUnits.value));
  }

  if (temps.length === 0) return { min: 0, max: 200 };

  let lo = Math.min(...temps);
  let hi = Math.max(...temps);

  // A single reading, or a cook that has barely moved, would otherwise collapse
  // to a zero-height window and magnify probe noise into a cliff.
  const floor = displayUnits.value === 'C' ? 12 : 20;
  if (hi - lo < floor) {
    const mid = (hi + lo) / 2;
    lo = mid - floor / 2;
    hi = mid + floor / 2;
  }

  const span = hi - lo;
  // Snap the window to a round step so the ticks read as temperatures rather
  // than as padding arithmetic.
  const step = displayUnits.value === 'C' ? 2 : 5;
  // More air above than below: the target rule, its label and the crossing pill
  // all live at the top of the range.
  const min = Math.floor((lo - span * 0.08) / step) * step;

  return {
    // Don't invent below-zero temperatures for a cook that never went there.
    min: lo >= 0 ? Math.max(0, min) : min,
    max: Math.ceil((hi + span * 0.14) / step) * step
  };
});

const internalTempData = computed(() =>
  readings.value.map(r => ({
    x: new Date(r.timestamp).getTime(),
    y: toDisplayUnit(r.temp, displayUnits.value)
  }))
);

/**
 * Cooking is paused and no reading post-dates the pause. Shares the service's
 * own predicate so the chart and the advice cannot disagree.
 */
const awaitingPostPauseReading = computed(() => {
  const events = ovenEvents.value;
  const last = events.length > 0 ? events[events.length - 1] : null;
  if (!last || last.isOff !== true) return false;
  return !hasReadingSince(readings.value, last.timestamp);
});

/**
 * Dashed projection from the latest reading to the predicted crossing.
 */
const projectionData = computed(() => {
  if (!canPredict.value || !predictedTargetTime.value || currentTemp.value === null) {
    return [];
  }

  // While cooking is paused with nothing logged since, the app deliberately
  // refuses to estimate the meat - the advice band asks for a fresh reading.
  // Projecting here would contradict it with the brightest mark on the screen,
  // and it would be wrong in a known direction: the fit is the pre-pause
  // heating rate, but the meat is cooling.
  if (awaitingPostPauseReading.value) return [];

  const lastReading = readings.value[readings.value.length - 1];
  const currentTempDisplay = toDisplayUnit(currentTemp.value, displayUnits.value);
  // In °F, against the stored pull temperature, NOT in display units. The old
  // comparison converted both sides and then compared - which on a Celsius
  // session rounds to 0.1 °C and can land on the other side of the boundary from
  // the advice band's own at-target test. Two verdicts about the same roast.
  if (currentTemp.value >= config.value.pullTempF) return [];

  const pullTempDisplay = toDisplayUnit(config.value.pullTempF, displayUnits.value);

  return [
    { x: new Date(lastReading.timestamp).getTime(), y: currentTempDisplay },
    { x: new Date(predictedTargetTime.value).getTime(), y: pullTempDisplay }
  ];
});

/**
 * The oven as a staircase. `stepped: 'after'` holds each setting forward from
 * the moment it was made; an oven-off event emits the outgoing value followed by
 * a null so the run is drawn and then the line breaks.
 */
const ovenTrackData = computed(() => {
  const events = ovenEvents.value;
  if (events.length === 0) return [];

  const data = [];

  events.forEach((event, index) => {
    const x = new Date(event.timestamp).getTime();

    if (event.isOff) {
      const previous = events[index - 1];
      // Carry the previous setting up to the instant the oven went off,
      // otherwise the gap swallows that whole run.
      if (previous && !previous.isOff) {
        data.push({ x, y: toDisplayUnit(previous.setTemp, displayUnits.value) });
      }
      data.push({ x, y: null });
    } else {
      data.push({ x, y: toDisplayUnit(event.setTemp, displayUnits.value) });
    }
  });

  // The last setting holds to the end of the MEASURED period, not to the right
  // edge of the plot. Two constraints meet here: reading `new Date()` inside a
  // computed froze the track at its first evaluation (it stopped growing for
  // the rest of the cook), but running it out to `xDomain.max` drew the
  // saturated oven bar hours into the future, asserting the oven would still be
  // at that setting at the predicted crossing. The latest thing actually
  // observed satisfies both: no clock read, no claim about the future.
  const last = events[events.length - 1];
  if (last && !last.isOff) {
    const lastReading = readings.value[readings.value.length - 1];
    const measuredUntil = Math.max(
      new Date(last.timestamp).getTime(),
      lastReading ? new Date(lastReading.timestamp).getTime() : 0
    );
    data.push({
      x: measuredUntil,
      y: toDisplayUnit(last.setTemp, displayUnits.value)
    });
  }

  return data;
});

const hasOvenTrack = computed(() => ovenTrackData.value.length > 0);

const ovenMaxTemp = computed(() => {
  const temps = ovenEvents.value
    .filter(e => !e.isOff)
    .map(e => toDisplayUnit(e.setTemp, displayUnits.value));

  return temps.length > 0 ? Math.max(...temps) : 0;
});

/** Stands in for the oven track's missing axis. */
const ovenFootnote = computed(() => {
  const last = ovenEvents.value[ovenEvents.value.length - 1];
  if (!last) return null;
  if (last.isOff) return 'Oven off';

  const temp = toDisplayUnit(last.setTemp, displayUnits.value);
  return `Oven ${Math.round(temp)}°${displayUnits.value}`;
});

const chartData = computed(() => {
  // Dataset 0 is always the internal temperature — the tooltip filter in
  // chartConfig depends on that.
  const datasets = [
    {
      label: 'Internal',
      data: internalTempData.value,
      borderColor: (ctx) => createHeatStroke(ctx.chart.ctx, ctx.chart.scales.y),
      backgroundColor: (ctx) => createHeatFill(ctx.chart.ctx, ctx.chart.scales.y),
      pointBackgroundColor: (ctx) => createHeatStroke(ctx.chart.ctx, ctx.chart.scales.y),
      pointBorderWidth: 0,
      // The latest reading is the one the eye is looking for.
      pointRadius: (ctx) => (ctx.dataIndex === internalTempData.value.length - 1 ? 3.5 : 2),
      pointHoverRadius: 5,
      borderWidth: 2.5,
      // Straight segments: a spline between sparse readings would invent
      // temperatures the probe never saw.
      tension: 0,
      fill: 'start',
      order: 1
    }
  ];

  if (projectionData.value.length > 0) {
    datasets.push({
      label: 'Projected',
      data: projectionData.value,
      // Interpretation, so it stays out of the heat ramp.
      borderColor: 'rgba(167, 156, 145, 0.55)',
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      fill: false,
      order: 2
    });
  }

  if (hasOvenTrack.value) {
    datasets.push({
      label: 'Oven',
      data: ovenTrackData.value,
      borderColor: chartPalette.heatWarm,
      // Faint enough that the stepped edge, not the mass, is what reads.
      backgroundColor: 'rgba(217, 131, 36, 0.10)',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      stepped: 'after',
      // Don't bridge oven-off gaps.
      spanGaps: false,
      fill: 'start',
      order: 3,
      yAxisID: 'yOven'
    });
  }

  return { datasets };
});

/**
 * Annotations: the target rule, the serve rule, and the crossing marker whose
 * distance from that rule is the early/late verdict.
 */
const annotations = computed(() => {
  const result = {};
  const range = meatRange.value;

  if (config.value) {
    result.targetRule = createTargetAnnotation(
      toDisplayUnit(config.value.pullTempF, displayUnits.value),
      displayUnits.value,
      Number.isFinite(config.value.servingTempF)
        ? toDisplayUnit(config.value.servingTempF, displayUnits.value)
        : null
    );
  }

  // Label the internal series at its own end instead of in a legend. It hangs
  // *below* the last point because the projection leaves upward from there.
  // Suppressed early in the cook, when the point is still over the y ticks.
  const lastPoint = internalTempData.value[internalTempData.value.length - 1];
  if (lastPoint && xFraction(lastPoint.x) > TICK_GUTTER_FRACTION) {
    result.internalLabel = createDataLabel({
      x: lastPoint.x,
      y: lastPoint.y,
      content: `${Math.round(lastPoint.y)}°`,
      side: labelSide(lastPoint.x, LABEL_WIDTHS.reading),
      vertical: 'below',
      tone: 'live'
    });
  }

  if (config.value?.desiredServeTime) {
    const serveTime = new Date(config.value.desiredServeTime);
    result.serveRule = createServeTimeAnnotation(serveTime);

    // Pinned to the floor of the meat's range, which keeps it a full band away
    // from the crossing pill up on the target rule.
    result.serveLabel = createDataLabel({
      x: serveTime.getTime(),
      y: range.min,
      content: `SERVE ${formatTime(config.value.desiredServeTime)}`,
      side: labelSide(serveTime, LABEL_WIDTHS.serve),
      vertical: 'above',
      tone: 'quiet'
    });
  }

  // The rest, as a band whose LEFT edge is the pull deadline. Behind the
  // datasets, so it is a region of the plot rather than a mark in it. Only when
  // there is both a projection to hang it off and a rest to draw.
  if (projectionData.value.length > 0 && restMinutes.value > 0 && predictedServeTime.value) {
    result.restBand = createRestBandAnnotation(
      projectionData.value[1].x,
      new Date(predictedServeTime.value).getTime()
    );
  }

  // The signature. Only drawn when there is a projection to land.
  if (projectionData.value.length > 0) {
    const crossing = projectionData.value[1];
    const fraction = xFraction(crossing.x);
    const serve = config.value?.desiredServeTime
      ? new Date(config.value.desiredServeTime).getTime()
      : null;

    // Hang the pill on the far side of the crossing from the serve rule. The
    // gap between those two marks *is* the verdict, and a label parked inside
    // it hides the thing the eye came to read.
    const away = serve === null || crossing.x >= serve ? 'right' : 'left';

    result.crossingMarker = createCrossingMarker(crossing.x, crossing.y);
    result.crossingLabel = createDataLabel({
      x: crossing.x,
      y: crossing.y,
      content: formatTime(predictedTargetTime.value),
      side: labelSide(crossing.x, LABEL_WIDTHS.crossing, away),
      // Centred on the target rule, except at the far left where the rule's own
      // TARGET label already occupies that line.
      vertical: fraction < 0.25 ? 'below' : 'middle',
      tone: 'signature'
    });
  }

  if (hasOvenTrack.value) {
    // Hairline where the oven's band meets the meat's, so the two tracks read as
    // two tracks rather than one crowded plot.
    result.trackDivider = {
      type: 'line',
      yMin: range.min,
      yMax: range.min,
      borderColor: chartPalette.rule,
      borderWidth: 1
    };
  }

  return result;
});

const chartOptions = computed(() => {
  const options = {
    ...defaultChartOptions,
    scales: {
      x: {
        ...defaultChartOptions.scales.x,
        min: xDomain.value.min,
        max: xDomain.value.max,
        time: {
          ...defaultChartOptions.scales.x.time,
          ...timeTicks.value
        },
        ticks: {
          ...defaultChartOptions.scales.x.ticks,
          maxTicksLimit: width.value < 640 ? 4 : 6
        }
      },
      y: {
        ...defaultChartOptions.scales.y,
        min: meatRange.value.min,
        max: meatRange.value.max
      }
    },
    plugins: {
      ...defaultChartOptions.plugins,
      annotation: { annotations: annotations.value }
    }
  };

  // Stack the oven under the meat — same time axis, its own range, roughly the
  // bottom fifth of the plot height. No second axis, no legend.
  if (hasOvenTrack.value) {
    options.scales.y.stack = 'roast';
    options.scales.y.stackWeight = 4;
    options.scales.y.weight = 1;
    options.scales.yOven = createOvenScale(ovenMaxTemp.value);
  }

  return options;
});
</script>
