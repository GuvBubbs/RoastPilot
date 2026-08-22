import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// package.json is the single source of truth for the version. CI bumps it
// before this build runs, so whatever is read here is what ships.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// CI hands us the SHA in the environment; locally we ask git, and a source
// copy with no git at all still has to build.
function shortCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch {
    return 'local';
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // Served from https://guvbubbs.github.io/RoastPilot/ — set unconditionally so
  // dev, preview and production all resolve assets at the same path.
  base: '/RoastPilot/',
  // Read back through src/config/version.js, which guards each one so tests
  // (which run without this config) still work.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(shortCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString())
  },
  resolve: {
    // vitest.config.js already defines this alias, so without it here a
    // `@/`-importing component passes tests and fails the build.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'generateSW',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Reverse Sear Temperature Tracker',
        short_name: 'RoastTracker',
        description: 'Track and predict cooking temperatures for perfect reverse sear results',
        theme_color: '#14110F',
        background_color: '#14110F',
        display: 'standalone',
        orientation: 'portrait',
        // vite-plugin-pwa does not derive these from `base` — set them by hand.
        scope: '/RoastPilot/',
        start_url: '/RoastPilot/',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/RoastPilot/index.html',
        // woff2 is not in workbox's default glob. Without it the self-hosted
        // type falls back to system fonts offline, which is the whole reason
        // the fonts are self-hosted.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      },
      devOptions: {
        enabled: true
      }
    })
  ]
});
