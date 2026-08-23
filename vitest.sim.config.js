import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * Separate config so the deck's baseline-scored assertions are never mixed into
 * the unit suite. `npm run test:run` uses vitest.config.js, which excludes
 * tools/** for the same reason - see the note there.
 *
 * Both configs are CI gates, in separate jobs, from
 * .github/workflows/test.yml.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    // The driver mounts a component so useRefreshTimer's onMounted hook runs,
    // and useSession writes through to localStorage.
    environment: 'jsdom',
    // The deck plus the harness's own tests. calibrate.test.js checks the
    // committed thermal constants still reproduce the cook they were fitted to;
    // it belongs with the harness, and vitest.config.js excludes tools/**.
    include: ['tools/sim/sim.spec.js', 'tools/**/*.test.js'],
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
