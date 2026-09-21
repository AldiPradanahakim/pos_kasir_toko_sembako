import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'favicon.svg'],
      manifest: {
        name: 'Toko Hakim POS',
        short_name: 'Toko Hakim',
        description: 'Kasir grosir sembako Toko Hakim',
        lang: 'id',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Master data pull: always try the network, fall back to the last copy.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname === '/api/sync/pull',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-sync-pull',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Backend Express (127.0.0.1:3000, IPv4) mendengarkan di 0.0.0.0:3000. Pakai 127.0.0.1,
      // bukan "localhost", karena Node di mesin ini me-resolve localhost ke ::1 dan proxy gagal.
      // Aplikasi selalu memanggil path relatif /api, jadi origin tetap sama di dev & produksi.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
});
