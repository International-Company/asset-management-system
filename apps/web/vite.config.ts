/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['brand/logo.png', 'brand/favicon-64.png', 'brand/apple-touch-icon.png'],
      manifest: {
        name: 'أصولي — نظام إدارة الأصول',
        short_name: 'أصولي',
        description: 'نظام إدارة أصول الشركة',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4f91',
        // Android builds its launch screen from these, the name and background_color.
        icons: [
          { src: 'brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. API responses are never cached by the service
        // worker; offline data is handled explicitly by the Offline module.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'brand/*.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    // Same-origin API in development, as in production (nginx proxy), so the
    // SameSite=Strict session cookie works.
    proxy: { '/api': 'http://localhost:3000' },
  },
  preview: {
    port: 4173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    css: false,
  },
});
