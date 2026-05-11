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

/** @type {import('vite').Plugin} */
const ffmpegCorePlugin = {
  name: 'ffmpeg-core',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/ffmpeg/ffmpeg-core.js') {
        res.setHeader('Content-Type', 'application/javascript')
        createReadStream(coreJs).pipe(res)
        return
      }
      next()
    })
  },
  closeBundle() {
    const outDir = resolve('dist/ffmpeg')
    mkdirSync(outDir, { recursive: true })
    copyFileSync(coreJs, join(outDir, 'ffmpeg-core.js'))
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
