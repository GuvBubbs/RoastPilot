import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots of the real app at the checkpoints the simulation captured.
 *
 * These are judged, not asserted. There are no pixel baselines: they would fail
 * on every legitimate design change, and the question these frames answer -
 * "does this advice read sensibly to someone mid-cook?" - is not a question a
 * pixel diff can ask. Layout regressions across 320-430 px remain the job of
 * tools/viewport-audit.html.
 *
 * Browsers are not installed by this project's `npm ci`: ignore-scripts is on
 * globally, so Playwright's postinstall never fetches them. Run
 * `npx playwright install chromium` once by hand.
 */
export default defineConfig({
  testDir: './tools/sim',
  testMatch: 'shots.spec.js',
  // Every frame writes into the same artifacts tree and the app is a singleton
  // per page anyway; serial keeps the output legible.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    // 390 px: an iPhone 14/15 class viewport, the middle of the range the app
    // is actually used at. Height is generous because the frames are full-page.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    // The app follows OS appearance, and a long cook happens in a dim kitchen.
    colorScheme: 'dark',
    baseURL: 'http://localhost:4173/RoastPilot/',
    // The dashboard is the artifact; a trace per frame is not worth the disk.
    trace: 'off',
    // The preview build registers a service worker (registerType: 'autoUpdate').
    // Letting it install would mean one frame's HTML could be served to the
    // next from cache, which is a nondeterminism these frames do not need.
    serviceWorkers: 'block'
  },
  projects: [
    {
      name: 'mobile-dark',
      use: {
        // Spread first: devices[] carries its own viewport and scale factor,
        // and would otherwise overwrite the ones above.
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        // Touch, so hover: none and pointer: coarse media queries resolve the
        // way they do on the phone this is a picture of.
        hasTouch: true,
        colorScheme: 'dark'
      }
    }
  ],
  webServer: {
    // A real build, not the dev server: the PWA plugin, the async chart chunk
    // and the `base` path all behave differently in dev.
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/RoastPilot/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
