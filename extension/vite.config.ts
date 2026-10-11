import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two extension pages: the toolbar popup and a one-time microphone permission page
// (Chrome cannot show the mic prompt inside a popup).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        mic: resolve(__dirname, 'mic.html'),
      },
    },
  },
})
