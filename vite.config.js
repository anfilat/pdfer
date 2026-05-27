import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/pdfer/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
      manifest: {
        name: 'PDFer',
        short_name: 'PDFer',
        description: 'PDF viewer',
        id: '/pdfer/',
        start_url: '/pdfer/',
        display: 'standalone',
        background_color: '#1a1a2e',
        theme_color: '#1a1a2e',
        icons: [
          {
            src: '/pdfer/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pdfer/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
});
