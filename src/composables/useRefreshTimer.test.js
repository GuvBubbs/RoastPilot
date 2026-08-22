/**
 * The shared clock. Two bugs lived here, and both of them are silent: the tick
 * keeps ticking either way, so nothing on screen looks broken while showing a
 * value from forty minutes ago.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useRefreshTimer, __resetRefreshTimer, MIN_INTERVAL_MS } from './useRefreshTimer.js';

/** Mount a component that subscribes at the given interval. */
function subscriber(intervalMs) {
  const captured = {};
  const Probe = defineComponent({
    setup() {
      captured.timer = useRefreshTimer(intervalMs);
      return () => h('div');
    }
  });
  const wrapper = mount(Probe);
  return { ...captured, wrapper };
}

describe('useRefreshTimer', () => {
  beforeEach(() => {
    __resetRefreshTimer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetRefreshTimer();
    vi.useRealTimers();
  });

  it('ticks on its interval', async () => {
    const a = subscriber(MIN_INTERVAL_MS);
    expect(a.timer.tick.value).toBe(0);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(a.timer.tick.value).toBe(1);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 3);
    expect(a.timer.tick.value).toBe(4);

    a.wrapper.unmount();
  });

  it('shares one tick across every subscriber', async () => {
    const a = subscriber(MIN_INTERVAL_MS);
    const b = subscriber(MIN_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    // Same ref, not two - a dozen components asking what time it is should not
    // mean a dozen intervals, and they must all agree.
    expect(a.timer.tick.value).toBe(1);
    expect(b.timer.tick.value).toBe(1);
    expect(a.timer.tick).toBe(b.timer.tick);

    a.wrapper.unmount();
    b.wrapper.unmount();
  });

  it('honours the FASTEST interval asked for, not the first', async () => {
    // The bug. The interval was created by whoever mounted first, and every
    // later useRefreshTimer(shorter) was silently ignored - it got the first
    // caller's cadence. A component that needs a faster clock had no way to
    // tell, because the tick still ticked.
    const slow = subscriber(MIN_INTERVAL_MS * 4);
    const fast = subscriber(MIN_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(fast.timer.tick.value).toBe(1);

    slow.wrapper.unmount();
    fast.wrapper.unmount();
  });

  it('slows back down when the fast subscriber leaves', async () => {
    const slow = subscriber(MIN_INTERVAL_MS * 4);
    const fast = subscriber(MIN_INTERVAL_MS);
    fast.wrapper.unmount();

    const before = slow.timer.tick.value;
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(slow.timer.tick.value).toBe(before);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 3);
    expect(slow.timer.tick.value).toBe(before + 1);

    slow.wrapper.unmount();
  });

  it('floors the interval', async () => {
    // Load-bearing for the simulation harness: driver.js winds the clock forward
    // by exactly one 30 s step per advance so the tick fires exactly once, and a
    // faster interval would fire several times and desynchronise every committed
    // transcript.
    const eager = subscriber(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(eager.timer.tick.value).toBe(0);

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 1000);
    expect(eager.timer.tick.value).toBe(1);

    eager.wrapper.unmount();
  });

  it('stops when the last subscriber unmounts', async () => {
    const a = subscriber(MIN_INTERVAL_MS);
    const at = a.timer.tick.value;
    a.wrapper.unmount();

    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 5);
    expect(a.timer.tick.value).toBe(at);
  });

  it('catches up the moment the page becomes visible again', async () => {
    /**
     * This is a PWA on a kitchen counter, and iOS suspends timers in a
     * backgrounded tab - reliably, and without telling anyone. Forty minutes in
     * a pocket and the interval simply did not fire, so every countdown, the
     * reading age and the reading prompt were all still showing what they showed
     * when the phone went away. The app would say the next reading was due in
     * five minutes when it had been due for half an hour.
     */
    const a = subscriber(MIN_INTERVAL_MS);
    const before = a.timer.tick.value;

    // Suspended: the clock moves, the interval does not fire. Modelled by
    // moving the system time without advancing timers, which is exactly what a
    // suspended tab looks like from inside the page.
    vi.setSystemTime(new Date(Date.now() + 40 * 60_000));
    expect(a.timer.tick.value).toBe(before);

    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(a.timer.tick.value).toBe(before + 1);

    a.wrapper.unmount();
  });

  it('ignores a visibilitychange that hides the page', async () => {
    const a = subscriber(MIN_INTERVAL_MS);
    const before = a.timer.tick.value;

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(a.timer.tick.value).toBe(before);
    spy.mockRestore();

    a.wrapper.unmount();
  });

  it('stops listening for visibility once nobody is subscribed', async () => {
    const a = subscriber(MIN_INTERVAL_MS);
    a.wrapper.unmount();

    const before = a.timer.tick.value;
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(a.timer.tick.value).toBe(before);
  });
});
