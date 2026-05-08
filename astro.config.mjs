// @ts-check
import preact from '@astrojs/preact'
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

const coopCoep = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  integrations: [preact({ compat: false })],
  vite: {
    plugins: [tailwindcss()],
    server: { headers: coopCoep },
    preview: { headers: coopCoep },
  },
})
