import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Ignore emulator/debug logs that can trigger useless full reloads while developing
    watch: {
      ignored: ['**/firestore-debug.log', '**/firebase-debug.log', '**/.netlify/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
