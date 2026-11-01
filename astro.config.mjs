// @ts-check
import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://blai30.github.io',
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
    // The export workers are module workers that load the WASM AAC encoder
    // via dynamic import only when the browser lacks native AAC; ES output is
    // required (the default 'iife' cannot code-split).
    worker: { format: 'es' },
  },
})
