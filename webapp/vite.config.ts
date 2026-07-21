import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Миниапп отдаётся с корня публичного URL (см. src/webapp.ts), сборка кладётся в
// dist/ — оттуда её раздаёт HTTP-сервер бота. Прокси нужен только для локального
// `npm run dev` против запущенного бэкенда (WEBAPP_PORT=8080).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Совпадает с уровнем JS в старом vanilla-миниаппе (optional chaining, ??, и т.п.):
    // телеграм-webview'ы — свежие Chromium, es2020 покрывает их с запасом.
    target: 'es2020',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/avatar.jpg': 'http://localhost:8080',
      '/visit.ics': 'http://localhost:8080',
    },
  },
})
