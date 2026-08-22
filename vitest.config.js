import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    // jsdom, not node: the two component behaviours worth asserting
    // (NumberStepper clamping, PauseCookingModal submit) need a DOM.
    environment: 'jsdom',
    // Load-bearing. Vitest's default include glob would otherwise sweep
    // tools/sim/*.spec.js into `npm run test:run`, and the deck's assertions
    // are scored against a committed baseline that has to be re-recorded
    // deliberately - not something to discover halfway through a unit run.
    //
    // It IS a CI gate, in its own job in .github/workflows/test.yml, and it is
    // not slow: the whole deck of eight simulated cooks runs in about 1.3 s
    // against 6.6 s for this suite. (The comment here used to claim the
    // opposite - "a judgement tool, and a slow one" - which was the excuse for
    // `npm run sim` asserting nothing at all.)
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
