import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const variantsDir = process.env.VARIANTS_DIR
if (!variantsDir) {
  throw new Error(
    'VARIANTS_DIR env var is required. Set it to the absolute path of the variants directory.'
  )
}

const resolvedVariantsDir = resolve(variantsDir)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '/variants': resolvedVariantsDir,
    },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5174,
    fs: {
      allow: [resolvedVariantsDir, '.'],
    },
  },
  // SPA fallback so /v19 serves index.html
  appType: 'spa',
})
