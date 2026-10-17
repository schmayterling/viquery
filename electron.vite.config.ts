import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {
    // sandboxed preloads must be a single cjs file: https://electron-vite.org/guide/dev
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      target: 'chrome152',
      minify: 'esbuild',
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    server: { host: '127.0.0.1' },
  },
})
