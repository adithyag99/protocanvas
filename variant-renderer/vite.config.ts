import { resolve, join, extname } from 'path'
import { readFileSync } from 'fs'
import react from '@vitejs/plugin-react'
import { defineConfig, Plugin } from 'vite'

const variantsDir = process.env.VARIANTS_DIR
if (!variantsDir) {
  throw new Error(
    'VARIANTS_DIR env var is required. Set it to the absolute path of the variants directory.'
  )
}

const resolvedVariantsDir = resolve(variantsDir)

// Serve static assets (images, fonts) from the variants directory at /variants/*
// The resolve.alias only handles JS/TS imports — this middleware handles runtime <img src> etc.
function serveVariantsStatic(): Plugin {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  return {
    name: 'serve-variants-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/variants/')) return next()
        const cleanUrl = req.url.split('?')[0]
        const ext = extname(cleanUrl)
        if (!mimeMap[ext]) return next()
        try {
          const filePath = join(resolvedVariantsDir, cleanUrl.replace('/variants/', ''))
          const data = readFileSync(filePath)
          res.writeHead(200, {
            'Content-Type': mimeMap[ext],
            'Cache-Control': 'public, max-age=3600',
          })
          res.end(data)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [serveVariantsStatic(), react()],
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
