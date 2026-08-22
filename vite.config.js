import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // Served from https://guvbubbs.github.io/RoastPilot/ — set unconditionally so
  // dev, preview and production all resolve assets at the same path.
  base: '/RoastPilot/',
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
        theme_color: '#dc2626',
        background_color: '#ffffff',
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
        navigateFallback: '/RoastPilot/index.html'
      },
      devOptions: {
        enabled: true
      }
    })
  ]
});
