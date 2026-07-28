import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // В дев-режиме фронтенд (5173) и Express-бэкенд (ADMIN_PORT) — разные порты;
      // проксируем /api, чтобы cookie-сессия работала так же, как в проде (один origin).
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
