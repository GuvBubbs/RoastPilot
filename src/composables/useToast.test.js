import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToast } from './useToast.js';
import { UI_CONSTANTS } from '../constants/defaults.js';

describe('useToast', () => {
  let toast;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = useToast();
    toast.toasts.value.splice(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a toast with the default duration', () => {
    // Regression guard: `duration` defaults to a value read off an imported
    // constant. A missing import made that a runtime ReferenceError that no
    // build step and no other test would have caught.
    expect(() => toast.showToast('Settings saved', 'success')).not.toThrow();
    expect(toast.toasts.value).toHaveLength(1);
    expect(toast.toasts.value[0].message).toBe('Settings saved');
    expect(toast.toasts.value[0].type).toBe('success');
  });

  it('auto-dismisses after the configured duration', () => {
    toast.showToast('Oven updated');
    expect(toast.toasts.value[0].visible).toBe(true);

    vi.advanceTimersByTime(UI_CONSTANTS.TOAST_DURATION_MS);
    expect(toast.toasts.value[0].visible).toBe(false);
  });

  it('honours an explicit duration', () => {
    toast.showToast('Quick', 'info', 500);
    vi.advanceTimersByTime(499);
    expect(toast.toasts.value[0].visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast.toasts.value[0].visible).toBe(false);
  });

  it('keeps several toasts distinct', () => {
    toast.showToast('One');
    toast.showToast('Two', 'error');
    expect(toast.toasts.value.map((t) => t.message)).toEqual(['One', 'Two']);
    expect(new Set(toast.toasts.value.map((t) => t.id)).size).toBe(2);
  });
});
