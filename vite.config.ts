import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { SearchError, searchRecentListings } from './server/sukebei-search.ts'
import { translateTexts } from './server/translate-ko.ts'

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const size = chunks.reduce((sum, part) => sum + part.length, 0)
      if (size > 1_000_000) {
        reject(new Error('요청이 너무 커요.'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function localApiPlugin(): Plugin {
  return {
    name: 'nyaa-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null
        if (!url) {
          next()
          return
        }

        if (url.pathname === '/api/search') {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET')
            res.end()
            return
          }

          const controller = new AbortController()
          req.on('aborted', () => controller.abort())

          try {
            const result = await searchRecentListings(
              url.searchParams.get('q') ?? '',
              controller.signal,
              url.searchParams.get('since'),
            )
            sendJson(res, 200, result)
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
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/translate') {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'POST')
            res.end()
            return
          }

          const controller = new AbortController()
          req.on('aborted', () => controller.abort())

          try {
            const parsed: unknown = JSON.parse((await readBody(req)) || '{}')
            const texts =
              parsed &&
              typeof parsed === 'object' &&
              'texts' in parsed &&
              Array.isArray(parsed.texts)
                ? parsed.texts.filter((item): item is string => typeof item === 'string')
                : []
            if (texts.length > 80) {
              sendJson(res, 400, { error: '한 번에 옮길 문장이 너무 많아요.' })
              return
            }
            const translations = await translateTexts(texts, controller.signal)
            sendJson(res, 200, { translations })
          } catch (cause) {
            if (controller.signal.aborted) {
              res.statusCode = 499
              res.end()
              return
            }
            const message =
              cause instanceof Error
                ? cause.message
                : '번역에 실패했어요. 원문을 그대로 보여 줄게요.'
            sendJson(res, 200, { translations: [], error: message })
          }
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
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
