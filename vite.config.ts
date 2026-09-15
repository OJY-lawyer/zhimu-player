import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'

// The Electron plugin also targets Rolldown; Vite 7 uses Rollup, which has no
// `platform` input option. Node built-ins are already externalized by the plugin.
const nodeRollupCompatibility = (): Plugin => ({
  name: 'electron-vite7-rollup-compatibility',
  configResolved(config) { delete (config.build.rollupOptions as Record<string, unknown>).platform },
})

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version) },
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, 'src/main/index.ts'),
        onstart(args) {
          void args.startup(['.'])
        },
        vite: {
          plugins: [nodeRollupCompatibility()],
          build: {
            outDir: resolve(__dirname, 'dist/main'),
            emptyOutDir: true,
            rollupOptions: {
              external: ['electron', 'electron-updater']
            }
          }
        }
      },
      {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        onstart(args) {
          args.reload()
        },
        vite: {
          plugins: [nodeRollupCompatibility()],
          build: {
            outDir: resolve(__dirname, 'dist/preload'),
            emptyOutDir: true
          }
        }
      }
    ])
  ],
  root: 'src/renderer',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer')
    }
  }
})
