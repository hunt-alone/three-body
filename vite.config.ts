import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode: _mode }) => ({
  plugins: [
    react(),
    // singlefile only for widget deploy (DEPLOY=1 npx vite build)
    ...(process.env.DEPLOY === '1'
      ? [import('vite-plugin-singlefile').then(m => m.viteSingleFile())]
      : []),
  ],
  base: './',
  build: {
    assetsInlineLimit: process.env.DEPLOY === '1' ? 1024 * 1024 : 4096,
  },
}))
