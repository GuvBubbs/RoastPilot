/**
 * The clamping vitest.config.js cites as the reason jsdom is the default
 * environment - for a test that did not exist.
 *
 * It is worth having for a real reason: this component is the only way a user
 * changes any number in this app, so its bounds ARE the app's bounds. The Phase 5
 * work leaned on that directly - `validateSettings` was deleted on the grounds
 * that every bound it checked is already enforced by these props, which is only
 * a safe thing to say if the props actually enforce them.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import NumberStepper from './NumberStepper.vue';

const factory = (props = {}) => mount(NumberStepper, {
  props: { label: 'Value', modelValue: 10, min: 0, max: 100, step: 5, ...props }
});

const input = (wrapper) => wrapper.find('input');
const buttons = (wrapper) => wrapper.findAll('button');
const decrement = (wrapper) => buttons(wrapper)[0];
const increment = (wrapper) => buttons(wrapper)[1];

describe('NumberStepper clamping', () => {
  it('clamps a typed value on blur, and emits the clamped one', async () => {
    const wrapper = factory({ modelValue: 10, min: 5, max: 50 });

    await input(wrapper).setValue('999');
    await input(wrapper).trigger('blur');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted[emitted.length - 1]).toEqual([50]);
  });

  it('clamps below the minimum too', async () => {
    const wrapper = factory({ modelValue: 10, min: 5, max: 50 });
    await input(wrapper).setValue('-40');
    await input(wrapper).trigger('blur');
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted[emitted.length - 1]).toEqual([5]);
  });

  it('leaves an in-range value alone', async () => {
    const wrapper = factory({ modelValue: 10, min: 5, max: 50 });
    await input(wrapper).setValue('23');
    await input(wrapper).trigger('blur');
    // The input event emits 23; blur must not emit a second, different value.
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted[emitted.length - 1]).toEqual([23]);
    expect(wrapper.emitted('blur')).toBeTruthy();
  });

  it('accepts an off-step value rather than rejecting it', async () => {
    /**
     * Deliberate, and documented on the component: values routinely land off-step
     * after a unit conversion - a 54.4 °C target, a 41.3 °F probe reading - and
     * native step validation would silently block the form submit with no visible
     * reason.
     */
    const wrapper = factory({ modelValue: 10, min: 0, max: 100, step: 5 });
    await input(wrapper).setValue('23.7');
    await input(wrapper).trigger('blur');
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted[emitted.length - 1]).toEqual([23.7]);
  });

  it('treats an emptied field as no value, not as zero', async () => {
    // Zero is a temperature. `null` is "the cook has not said".
    const wrapper = factory({ modelValue: 10 });
    await input(wrapper).setValue('');
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([null]);
  });

  it('ignores unparseable input rather than emitting NaN', async () => {
    const wrapper = factory({ modelValue: 10 });
    await input(wrapper).setValue('abc');
    // jsdom's number input coerces junk to '', which is the null case; either way
    // a NaN must never be emitted.
    for (const [value] of wrapper.emitted('update:modelValue') ?? []) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});

describe('NumberStepper buttons', () => {
  it('steps by the step, clamped at both ends', async () => {
    const wrapper = factory({ modelValue: 10, min: 0, max: 100, step: 5 });
    await increment(wrapper).trigger('mousedown');
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([15]);
    await decrement(wrapper).trigger('mousedown');
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([5]);
  });

  it('cannot step past the bounds', async () => {
    const atMax = factory({ modelValue: 100, min: 0, max: 100, step: 5 });
    await increment(atMax).trigger('mousedown');
    expect(atMax.emitted('update:modelValue')).toBeUndefined();

    const atMin = factory({ modelValue: 0, min: 0, max: 100, step: 5 });
    await decrement(atMin).trigger('mousedown');
    expect(atMin.emitted('update:modelValue')).toBeUndefined();
  });

  it('disables the button that cannot move', () => {
    expect(increment(factory({ modelValue: 100, max: 100 })).attributes('disabled'))
      .toBeDefined();
    expect(decrement(factory({ modelValue: 0, min: 0 })).attributes('disabled'))
      .toBeDefined();
    expect(increment(factory({ modelValue: 50, max: 100 })).attributes('disabled'))
      .toBeUndefined();
  });

  it('treats a null value as zero for the first step', async () => {
    const wrapper = factory({ modelValue: null, min: 0, max: 100, step: 5 });
    await increment(wrapper).trigger('mousedown');
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([5]);
  });

  it('accelerates on a long press, and stops on release', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = factory({ modelValue: 0, min: 0, max: 1000, step: 1, largeStep: 10 });
      await increment(wrapper).trigger('mousedown');
      expect(wrapper.emitted('update:modelValue')).toHaveLength(1);

      // Nothing until the hold threshold.
      vi.advanceTimersByTime(400);
      expect(wrapper.emitted('update:modelValue')).toHaveLength(1);

      vi.advanceTimersByTime(400);
      const during = wrapper.emitted('update:modelValue').length;
      expect(during).toBeGreaterThan(1);

      await increment(wrapper).trigger('mouseup');
      vi.advanceTimersByTime(2000);
      expect(wrapper.emitted('update:modelValue')).toHaveLength(during);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NumberStepper accessibility', () => {
  it('always has an accessible name, visible or not', () => {
    const visible = factory({ label: 'Weight' });
    expect(visible.find('label').text()).toBe('Weight');
    expect(visible.find('label').classes()).not.toContain('sr-only');

    const hidden = factory({ label: 'Weight', hideLabel: true });
    expect(hidden.find('label').text()).toBe('Weight');
    // Still in the accessibility tree, just not on screen - a stepper inside a
    // SettingsRow already has a visible label above it.
    expect(hidden.find('label').classes()).toContain('sr-only');
  });

  it('ties the label and the error to the input', () => {
    const wrapper = factory({ label: 'Weight', error: 'Too heavy' });
    const id = input(wrapper).attributes('id');
    expect(wrapper.find('label').attributes('for')).toBe(id);
    expect(input(wrapper).attributes('aria-describedby')).toBe(`${id}-error`);
    expect(input(wrapper).attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('Too heavy');
  });

  it('is not marked invalid without an error', () => {
    const wrapper = factory();
    expect(input(wrapper).attributes('aria-invalid')).toBe('false');
    expect(input(wrapper).attributes('aria-describedby')).toBeUndefined();
  });
});
