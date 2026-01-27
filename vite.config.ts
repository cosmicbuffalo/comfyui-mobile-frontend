import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/mobile/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true
  },
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: `http://${process.env.COMFY_HOST ?? 'localhost'}:8188`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://${process.env.COMFY_HOST ?? 'localhost'}:8188`,
        ws: true
      },
      '/view': {
        target: `http://${process.env.COMFY_HOST ?? 'localhost'}:8188`,
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
