// @ts-check
import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const coopCoep = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
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
    plugins: [tailwindcss()],
    // The WebCodecs export worker is a module worker that code-splits its
    // demuxers via dynamic import; ES output is required (the default 'iife'
    // cannot code-split).
    worker: { format: 'es' },
    server: { headers: coopCoep },
    preview: { headers: coopCoep },
  },
})
