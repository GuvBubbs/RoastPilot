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
    // tools/sim/*.spec.js into `npm run test:run`, which is the deploy gate in
    // .github/workflows/deploy.yml. The simulation harness runs from
    // vitest.sim.config.js and is deliberately not a CI gate: it is a
    // judgement tool, and a slow one.
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
