import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * Separate config so the simulation harness is never part of the deploy gate.
 * `npm run test:run` uses vitest.config.js, which excludes tools/** for the
 * same reason - see the note there.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    // The driver mounts a component so useRefreshTimer's onMounted hook runs,
    // and useSession writes through to localStorage.
    environment: 'jsdom',
    include: ['tools/sim/sim.spec.js'],
    // Eight long cooks in one file; the scenarios share nothing but they do
    // share a module registry, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 30_000
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
