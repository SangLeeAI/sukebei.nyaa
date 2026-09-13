import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { SearchError, searchRecentListings } from './server/sukebei-search.ts'

function sukebeiSearchPlugin(): Plugin {
  return {
    name: 'sukebei-search-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null
        if (!url || url.pathname !== '/api/search') {
          next()
          return
        }

        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.end()
          return
        }

        const controller = new AbortController()
        req.on('close', () => controller.abort())

        try {
          const result = await searchRecentListings(
            url.searchParams.get('q') ?? '',
            controller.signal,
          )
          const body = JSON.stringify(result)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (cause) {
          if (controller.signal.aborted) {
            res.statusCode = 499
            res.end()
            return
          }
          const status = cause instanceof SearchError ? cause.status : 500
          const message =
            cause instanceof Error
              ? cause.message
              : '검색 중 알 수 없는 오류가 났어요.'
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sukebeiSearchPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 48621,
    strictPort: true,
    open: true,
  },
})
