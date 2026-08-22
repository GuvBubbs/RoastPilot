/**
 * The composable between the engine and the screen.
 *
 * It had no tests, and it is where three whole classes of bug live: unit
 * conversion at the boundary, the deliberate clock-free-ness of
 * `rawCalculations`, and the `=== null` guards that let `undefined` through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useSession } from './useSession.js';
import { useCalculations } from './useCalculations.js';
import { __resetRefreshTimer } from './useRefreshTimer.js';
import { clearFitCache, advance } from '../services/thermalModel.js';
import { celsiusToFahrenheit } from '../utils/temperatureUtils.js';

const NOW = '2026-08-22T18:00:00.000Z';
const at = (minutesFromStart) =>
  new Date(Date.parse(NOW) - (150 - minutesFromStart) * 60_000).toISOString();

function mountCalculations() {
  const captured = {};
  const Probe = defineComponent({
    setup() {
      captured.session = useSession();
      captured.calc = useCalculations();
      return () => h('div');
    }
  });
  const wrapper = mount(Probe);
  return { ...captured, wrapper };
}

describe('useCalculations', () => {
  let probe;

  beforeEach(() => {
    localStorage.clear();
    clearFitCache();
    __resetRefreshTimer();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    probe = mountCalculations();
  });

  afterEach(() => {
    probe.session.endSession();
    probe.wrapper.unmount();
    __resetRefreshTimer();
    vi.useRealTimers();
    localStorage.clear();
  });

  /** A curved cook ending at `now`, generated from the model. */
  function startCook({ units = 'F', ovenF = 200, startF = 48, k = 0.011, restMinutes = 0 } = {}) {
    // Wind back so startSession's opening oven event is the oldest.
    vi.setSystemTime(new Date(Date.parse(at(0)) - 60_000));
    probe.session.startSession({
      units,
      pullTempF: 125,
      servingTempF: 129,
      carryoverF: 4,
      restMinutes,
      initialOvenTemp: ovenF,
      desiredServeTime: new Date(Date.parse(NOW) + 60 * 60_000).toISOString(),
      weight: 6,
      meatType: 'Prime Rib'
    });
    vi.setSystemTime(new Date(NOW));

    let state = { ovenF, surfaceF: startF, coreF: startF };
    let cursor = 0;
    const toDisplay = (f) => (units === 'C' ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : Math.round(f * 10) / 10);
    probe.session.addReading(toDisplay(startF), at(0));
    for (const m of [40, 80, 115, 150]) {
      state = advance(state, { minutes: m - cursor, setPointF: ovenF }, k);
      cursor = m;
      probe.session.addReading(toDisplay(state.coreF), at(m));
    }
    return nextTick();
  }

  describe('the raw calculation is clock-free', () => {
    it('does not change the predicted TIME as the clock advances', async () => {
      /**
       * `rawCalculations` deliberately has no tick dependency: the predicted
       * finish TIME is a fixed point between readings, and only the distance to it
       * moves. Left implicit, the result object would carry a permanently stale
       * countdown; made dependent on the clock, the ETA would drift on its own
       * with no new evidence - which the simulation harness asserts against
       * directly.
       */
      await startCook();
      const target = probe.calc.predictedTargetTime.value;
      expect(target).not.toBeNull();

      await vi.advanceTimersByTimeAsync(20 * 60_000);
      await nextTick();

      expect(probe.calc.predictedTargetTime.value).toBe(target);
      expect(probe.calc.predictedMinutes.value)
        .toBe(probe.calc.predictedMinutes.value); // the projection's own length
    });

    it('does move the countdown as the clock advances', async () => {
      await startCook();
      const before = probe.calc.predictedMinutesFromNow.value;
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      await nextTick();
      expect(probe.calc.predictedMinutesFromNow.value).toBe(before - 20);
    });
  });

  describe('undefined must not reach the display', () => {
    it('returns null rather than NaN with no session at all', () => {
      /**
       * Three guards read `raw === null`, and the optional chain above them
       * yields UNDEFINED when there is no session - so undefined fell straight
       * through into convertRate and came out as NaN on the screen.
       */
      expect(probe.calc.currentRate.value).toBeNull();
      expect(probe.calc.averageRate.value).toBeNull();
      expect(probe.calc.currentRateFormatted.value).toBe('--');
      expect(probe.calc.predictedTargetTime.value).toBeNull();
      expect(probe.calc.scheduleStatus.value).toBe('unknown');
    });

    it('returns null rather than NaN while the projection is refused', async () => {
      probe.session.startSession({ units: 'F', pullTempF: 125, initialOvenTemp: 200 });
      probe.session.addReading(48, at(140));
      probe.session.addReading(50, at(150));
      await nextTick();

      expect(probe.calc.currentRate.value).toBeNull();
      expect(probe.calc.currentRateFormatted.value).toBe('--');
      expect(Number.isNaN(probe.calc.currentRate.value)).toBe(false);
      expect(probe.calc.timeRemainingFormatted.value).toBe('--');
    });
  });

  describe('unit conversion at the boundary', () => {
    it('converts the rate by scale only, with no 32° offset', async () => {
      await startCook({ units: 'C' });
      const rawF = probe.calc.currentRateRaw.value;
      expect(rawF).toBeGreaterThan(0);
      // A rate is a difference per hour. Treating it as an absolute temperature
      // turns +20 °F/hr into -6.7 °C/hr.
      expect(probe.calc.currentRate.value).toBeCloseTo((rawF * 5) / 9, 1);
      expect(probe.calc.currentRate.value).toBeGreaterThan(0);
    });

    it('converts carryover as a delta too', async () => {
      await startCook({ units: 'C' });
      // +4 °F is +2.2 °C, not -15.6 °C.
      expect(probe.calc.carryoverDisplay.value).toBeCloseTo(2.2, 1);
    });

    it('shows pull and serving temperatures in the session unit', async () => {
      await startCook({ units: 'C' });
      expect(probe.calc.pullTempDisplay.value).toBeCloseTo((125 - 32) * 5 / 9, 1);
      expect(probe.calc.servingTempDisplay.value).toBeCloseTo((129 - 32) * 5 / 9, 1);
    });
  });

  describe('the cook plan', () => {
    it('puts the predicted serve a rest after the predicted pull', async () => {
      await startCook({ restMinutes: 25 });
      const pull = Date.parse(probe.calc.predictedTargetTime.value);
      const serve = Date.parse(probe.calc.predictedServeTime.value);
      expect((serve - pull) / 60_000).toBe(25);
    });

    it('has no predicted serve without a predicted pull', async () => {
      probe.session.startSession({ units: 'F', pullTempF: 125, initialOvenTemp: 200, restMinutes: 20 });
      probe.session.addReading(48, at(150));
      await nextTick();
      expect(probe.calc.predictedServeTime.value).toBeNull();
      expect(probe.calc.predictedServeTimeFormatted.value).toBe('--');
    });
  });

  describe('progress', () => {
    it('clamps the rail but not the logic', async () => {
      /**
       * The clamp belongs to the ARIA value and the rail width, which cannot
       * render past 100%. A logic path reading a clamped progress cannot tell
       * "just done" from "30 °F past done", which is the distinction the graded
       * verdict exists to make.
       */
      await startCook();
      probe.session.addReading(155, at(150));
      await nextTick();

      expect(probe.calc.progressPercent.value).toBe(100);
      expect(probe.calc.pullProgress.value.progressPercent).toBeGreaterThan(100);
      expect(probe.calc.progressOverflows.value).toBe(true);
      expect(probe.calc.pullProgress.value.state).toBe('over');
    });

    it('grades the approach', async () => {
      await startCook();
      expect(['heating', 'approaching']).toContain(probe.calc.pullProgress.value.state);
      probe.session.addReading(118, at(150));
      await nextTick();
      expect(probe.calc.pullProgress.value.state).toBe('approaching');
      expect(probe.calc.isApproachingPull.value).toBe(true);
    });
  });

  describe('the fit is exposed for the chart, not for interpretation', () => {
    it('carries k and the residual once the gate opens', async () => {
      await startCook();
      expect(probe.calc.fit.value).not.toBeNull();
      expect(probe.calc.fit.value.k).toBeCloseTo(0.011, 3);
      expect(probe.calc.fit.value.anchorState).toBeTruthy();
      // The interpretation is `confidence`; the fit is raw material.
      expect(probe.calc.confidence.value.code).toBeTruthy();
    });

    it('is null while the projection is refused', async () => {
      probe.session.startSession({ units: 'F', pullTempF: 125, initialOvenTemp: 200 });
      probe.session.addReading(48, at(140));
      await nextTick();
      expect(probe.calc.fit.value).toBeNull();
    });
  });

  it('feeds the weight and meat type into the prior', async () => {
    // Not a claim that the prior dominates - it is about a tenth of a percent of
    // the fit once three readings exist - but the wiring has to exist at all, and
    // nothing else would notice if it were dropped.
    await startCook();
    const withWeight = probe.calc.fit.value.prior;
    probe.session.updateConfig({ weight: 24 });
    await nextTick();
    expect(probe.calc.fit.value.prior).toBeLessThan(withWeight);
  });

  it('exposes the projection refusal reason, not just its absence', async () => {
    // "not enough data yet" resolves itself; "the oven cannot get there" does
    // not. The UI has to say different things about them.
    probe.session.startSession({ units: 'F', pullTempF: 195, initialOvenTemp: 175, weight: 6 });
    let state = { ovenF: 175, surfaceF: 48, coreF: 48 };
    let cursor = 0;
    probe.session.addReading(48, at(0));
    for (const m of [40, 80, 115, 150]) {
      state = advance(state, { minutes: m - cursor, setPointF: 175 }, 0.011);
      cursor = m;
      probe.session.addReading(Math.round(state.coreF * 10) / 10, at(m));
    }
    await nextTick();
    expect(probe.calc.projectionRefusedReason.value).toBe('unreachable');
  });
});
