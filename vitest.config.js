import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * Shared by both projects below. Split out rather than repeated so the two
 * cannot drift into disagreeing about what a test environment is.
 */
const shared = {
  globals: true,
  // jsdom, not node: the component behaviours worth asserting (NumberStepper
  // clamping, PauseCookingModal submit) need a DOM.
  environment: 'jsdom',
  // Load-bearing. Vitest's default include glob would otherwise sweep
  // tools/sim/*.spec.js into `npm run test:run`, and the deck's assertions are
  // scored against a committed baseline that has to be re-recorded deliberately -
  // not something to discover halfway through a unit run.
  //
  // It IS a CI gate, in its own job in .github/workflows/test.yml, and it is not
  // slow: the whole deck of eight simulated cooks runs in about 1.3 s against
  // 6.6 s for this suite. (The comment here used to claim the opposite - "a
  // judgement tool, and a slow one" - which was the excuse for `npm run sim`
  // asserting nothing at all.)
  exclude: ['**/node_modules/**', '**/dist/**', 'tools/**']
};

export default defineConfig({
  plugins: [vue()],
  test: {
    projects: [
      {
        plugins: [vue()],
        test: {
          ...shared,
          name: 'unit',
          // Everything except the DST suite, which needs its own zone.
          exclude: [...shared.exclude, '**/*.dst.test.js']
        },
        resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
      },
      {
        plugins: [vue()],
        test: {
          ...shared,
          name: 'dst',
          include: ['src/**/*.dst.test.js'],
          /**
           * THE POINT OF THIS PROJECT.
           *
           * The DST suite asserts that addMinutes does epoch arithmetic rather
           * than local wall-clock arithmetic. In a zone with no DST transitions
           * the two are identical, so in UTC - which is what CI runs in - every
           * assertion in that file passes without testing anything.
           *
           * Pacific/Auckland has transitions whose local time is the small hours
           * of a Sunday but whose UTC time is mid-afternoon, so it also exercises
           * the case where the local date and the UTC date disagree.
           *
           * Belt and braces: the suite ALSO guards on the offset itself in a
           * beforeAll, because an env var is easy to lose and a vacuous pass is
           * indistinguishable from a real one.
           */
          env: { TZ: 'Pacific/Auckland' }
        },
        resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
      }
    ]
  }
});
