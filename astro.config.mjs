import { createReadStream, copyFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// @ts-check
import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const coopCoep = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

const coreJs = resolve('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js')
const coreWasm = resolve('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm')

const mtCoreJs = resolve('node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js')
const mtCoreWasm = resolve('node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm')
const mtCoreWorker = resolve('node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js')

/** @type {import('vite').Plugin} */
const ffmpegCorePlugin = {
  name: 'ffmpeg-core',
  configureServer(server) {
    const routes = {
      '/ffmpeg/ffmpeg-core.js': { path: coreJs, type: 'application/javascript' },
      '/ffmpeg/ffmpeg-core.wasm': { path: coreWasm, type: 'application/wasm' },
      '/ffmpeg/mt/ffmpeg-core.js': { path: mtCoreJs, type: 'application/javascript' },
      '/ffmpeg/mt/ffmpeg-core.wasm': { path: mtCoreWasm, type: 'application/wasm' },
      '/ffmpeg/mt/ffmpeg-core.worker.js': { path: mtCoreWorker, type: 'application/javascript' },
    }
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0]
      const route = url ? routes[url] : undefined
      if (route) {
        res.setHeader('Content-Type', route.type)
        createReadStream(route.path).pipe(res)
        return
      }
      next()
    })
  },
  closeBundle() {
    const outDir = resolve('dist/ffmpeg')
    const mtDir = join(outDir, 'mt')
    mkdirSync(outDir, { recursive: true })
    mkdirSync(mtDir, { recursive: true })
    copyFileSync(coreJs, join(outDir, 'ffmpeg-core.js'))
    copyFileSync(coreWasm, join(outDir, 'ffmpeg-core.wasm'))
    copyFileSync(mtCoreJs, join(mtDir, 'ffmpeg-core.js'))
    copyFileSync(mtCoreWasm, join(mtDir, 'ffmpeg-core.wasm'))
    copyFileSync(mtCoreWorker, join(mtDir, 'ffmpeg-core.worker.js'))
  },
}

export default defineConfig({
  site: 'https://github.com/blai30/splicer',
  trailingSlash: 'always',
  base: process.env.NODE_ENV === 'production' ? '/splicer' : undefined,
  integrations: [
    preact({ compat: false }),
    sitemap({
      changefreq: 'monthly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  vite: {
    plugins: [tailwindcss(), ffmpegCorePlugin],
    optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
    server: { headers: coopCoep },
    preview: { headers: coopCoep },
  },
})
