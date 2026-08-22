/**
 * One screenshot per simulation checkpoint, from the real built app.
 *
 * Reads the session snapshots that `npm run sim` wrote, seeds each one into
 * localStorage before any app JS runs, freezes the clock at that checkpoint's
 * simulated instant, and captures the dashboard.
 *
 * Run `npm run sim` first - without snapshots this suite has nothing to shoot.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { SNAPSHOT_DIR, SHOT_DIR } from './report.js';

const snapshots = existsSync(SNAPSHOT_DIR)
  ? readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

test.describe('checkpoint screenshots', () => {
  test.skip(snapshots.length === 0,
    `no snapshots in ${SNAPSHOT_DIR} - run \`npm run sim\` first`);

  for (const file of snapshots) {
    const snapshot = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8'));
    const stem = file.replace(/\.json$/, '');

    test(`${snapshot.scenario} · ${snapshot.checkpoint}`, async ({ page }) => {
      // Before goto, in this order:
      //
      // 1. The clock. formatTimeAgo, the ETA countdown and the staleness chip
      //    are all read off Date.now(), so a live clock would render a cook
      //    that finished in 2026 as one abandoned months ago.
      await page.clock.install({ time: new Date(snapshot.simNowISO) });

      // 2. Storage. addInitScript runs before the page's own scripts, which is
      //    the only window in which this is useful - useSession.initialize()
      //    reads storage during onMounted and never looks again.
      await page.addInitScript(({ session }) => {
        localStorage.setItem('rstt_schema_version', '1');
        localStorage.setItem('rstt_current_session', JSON.stringify(session));
        // initialize() merges the standalone settings entry OVER the session's
        // own, so seeding it from anywhere else would silently change the cook.
        localStorage.setItem('rstt_settings', JSON.stringify(session.settings));
        localStorage.setItem('rstt_units', session.config.units);
      }, { session: snapshot.session });

      await page.goto('./');

      // A seeded session means hasActiveSession is true, so App.vue skips the
      // resume prompt and boots straight to the dashboard.
      await expect(page.locator('section[aria-label="Cook status"]')).toBeVisible();
      await expect(page.locator('section[aria-label="What to do next"]')).toBeVisible();

      // The chart is an async chunk, and Chart.js animates for 200 ms
      // (src/config/chartConfig.js). Playwright's clock fakes
      // requestAnimationFrame too, so without winding it on the chart freezes
      // part-drawn - a blank or half-drawn plot in every frame.
      await page.locator('canvas').first().waitFor({ state: 'visible' });
      await page.clock.runFor(1000);
      // Web fonts are self-hosted, so this resolves without a network round trip.
      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({
        path: join(SHOT_DIR, `${stem}.png`),
        fullPage: true,
        animations: 'disabled'
      });
    });
  }
});
