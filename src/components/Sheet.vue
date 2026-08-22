<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pl-safe pr-safe"
        @click.self="requestClose('backdrop')"
      >
        <div
          ref="panel"
          class="sheet-panel w-full sm:max-w-md flex flex-col bg-ground border-t border-rule sm:border sm:rounded-2xl sm:mb-6 rounded-t-2xl overflow-hidden"
          :class="heightClass"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="hasTitle ? titleId : undefined"
          :aria-label="hasTitle ? undefined : ariaLabel"
          @keydown="onKeydown"
        >
          <!-- Title -->
          <header v-if="hasTitle" class="band rule flex items-center gap-3 py-3 shrink-0">
            <h2 :id="titleId" class="flex-1 min-w-0 text-[17px] font-semibold text-ink truncate">
              <slot name="title">{{ title }}</slot>
            </h2>
            <button
              v-if="dismissible"
              type="button"
              class="btn-icon -mr-2 shrink-0"
              aria-label="Close"
              @click="requestClose('button')"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <!-- Body. The only scroll container — this is what keeps content
               reachable with the iOS keyboard open. -->
          <div class="flex-1 overflow-y-auto overscroll-contain band py-4">
            <slot name="body"><slot /></slot>
          </div>

          <!-- Actions, pinned below the scroll area and clear of the home indicator. -->
          <footer v-if="$slots.actions" class="band rule-t py-3 pb-safe shrink-0 bg-ground">
            <slot name="actions" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
// Module scope, not `<script setup>` — a `let` inside script setup is
// re-initialised per instance, which would hand every open sheet the same
// element id.
let instanceCount = 0;
</script>

<script setup>
import { ref, computed, watch, onBeforeUnmount, useSlots } from 'vue';

/**
 * The single modal shell for the app. Replaces nine hand-rolled overlays, none
 * of which had a focus trap and most of which had no scroll container — so
 * their content was unreachable with the iOS keyboard open.
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** Fallback accessible name when no title is rendered. */
  ariaLabel: { type: String, default: 'Dialog' },
  /** Backdrop click, Escape and the close button all honour this. */
  dismissible: { type: Boolean, default: true },
  /** 'auto' hugs content up to 90dvh; 'tall' always takes 90dvh. */
  size: { type: String, default: 'auto' }
});

const emit = defineEmits(['update:modelValue', 'close']);

const slots = useSlots();
const panel = ref(null);

const titleId = `sheet-title-${++instanceCount}`;

const hasTitle = computed(() => Boolean(props.title) || Boolean(slots.title));

// dvh rather than vh: on iOS Safari, vh includes the collapsing toolbar, so a
// 90vh sheet is taller than the visible viewport.
const heightClass = computed(() =>
  props.size === 'tall' ? 'h-[90dvh] max-h-[90dvh]' : 'max-h-[90dvh]'
);

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusable() {
  if (!panel.value) return [];
  return Array.from(panel.value.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  );
}

function requestClose(_source) {
  if (!props.dismissible) return;
  emit('update:modelValue', false);
  emit('close');
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    requestClose('escape');
    return;
  }

  if (event.key !== 'Tab') return;

  const items = focusable();
  if (items.length === 0) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !panel.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.value.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

// -- Focus restore and body scroll lock ------------------------------------

let previousFocus = null;
let lockedByThis = false;

// Nested sheets exist (Settings opens confirmations), so the lock is counted
// rather than a boolean.
function lockBody() {
  if (lockedByThis) return;
  lockedByThis = true;
  const depth = Number(document.body.dataset.sheetDepth || 0) + 1;
  document.body.dataset.sheetDepth = String(depth);
  if (depth === 1) document.body.style.overflow = 'hidden';
}

function unlockBody() {
  if (!lockedByThis) return;
  lockedByThis = false;
  const depth = Math.max(0, Number(document.body.dataset.sheetDepth || 0) - 1);
  document.body.dataset.sheetDepth = String(depth);
  if (depth === 0) document.body.style.overflow = '';
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement;
      lockBody();
      // Wait for the Transition to mount the panel before reaching into it.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const items = focusable();
      // Prefer the panel itself over auto-focusing a field: focusing an input
      // raises the iOS keyboard the instant the sheet opens.
      if (panel.value) {
        panel.value.setAttribute('tabindex', '-1');
        panel.value.focus({ preventScroll: true });
      } else if (items.length) {
        items[0].focus();
      }
    } else {
      unlockBody();
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
    }
  },
  { immediate: true }
);

onBeforeUnmount(unlockBody);
</script>
