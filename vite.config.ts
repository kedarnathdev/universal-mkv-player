import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['mediabunny'],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    headers: {
      // Required for SharedArrayBuffer / WASM (used by mediabunny internals)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
