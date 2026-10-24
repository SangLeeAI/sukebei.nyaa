import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { SearchError, searchRecentListings } from './server/sukebei-search.ts'
import {
  contentDisposition,
  fetchTorrentFile,
  parseTorrentId,
} from './server/sukebei-torrent.ts'
import { parseSaveItems, saveTorrentsToDownloads } from './server/save-torrents.ts'
import {
  deleteLastDownload,
  getLastDownload,
  listLastDownloads,
  parseLastDownloadInput,
  updateLastDownloadNote,
  updateLastDownloadSortOrder,
  updateLastDownloadWorking,
  upsertLastDownload,
} from './server/last-download-db.ts'
import {
  countPendingTorrents,
  deletePendingByIds,
  getPendingByIds,
  listPendingTorrents,
  parsePendingIds,
  parsePendingInputs,
  upsertPendingTorrents,
} from './server/pending-db.ts'
import { addTorrentFilesToQbittorrent } from './server/qbittorrent.ts'
import { parseStashItems, removeStashedTorrentFiles, stashTorrentFiles } from './server/torrent-stash.ts'
import { translateTexts } from './server/translate-ko.ts'

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendFile(
  res: ServerResponse,
  body: Buffer,
  headers: Record<string, string>,
) {
  res.statusCode = 200
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

const TORRENT_PATH = /^\/api\/torrent\/([^/]+)$/

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const size = chunks.reduce((sum, part) => sum + part.length, 0)
      if (size > 8_000_000) {
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

        const torrentMatch = TORRENT_PATH.exec(url.pathname)
        if (torrentMatch) {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET')
            res.end()
            return
          }

          const id = parseTorrentId(
            decodeURIComponent(torrentMatch[1]).replace(/\.torrent$/i, ''),
          )
          if (!id) {
            sendJson(res, 400, { error: '토렌트 번호가 올바르지 않아요.' })
            return
          }

          const controller = new AbortController()
          req.on('aborted', () => controller.abort())

          try {
            const body = await fetchTorrentFile(id, controller.signal)
            sendFile(res, body, {
              'Content-Type': 'application/x-bittorrent',
              'Content-Disposition': contentDisposition(`${id}.torrent`),
              'Content-Length': String(body.byteLength),
            })
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
                : '토렌트 파일을 받지 못했어요.'
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/torrents/save') {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'POST')
            res.end()
            return
          }

          const controller = new AbortController()
          req.on('aborted', () => controller.abort())

          try {
            const items = parseSaveItems(JSON.parse((await readBody(req)) || '{}'))
            const result = await saveTorrentsToDownloads(items, controller.signal)
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
                : '토렌트 파일을 저장하지 못했어요.'
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/last-downloads') {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET')
            res.end()
            return
          }
          try {
            sendJson(res, 200, { records: listLastDownloads() })
          } catch (cause) {
            const message =
              cause instanceof Error
                ? cause.message
                : '저장된 검색어를 읽지 못했어요.'
            sendJson(res, 500, { error: message })
          }
          return
        }

        if (url.pathname === '/api/last-download') {
          if (req.method === 'GET') {
            try {
              const record = getLastDownload(url.searchParams.get('q') ?? '')
              sendJson(res, 200, { record })
            } catch (cause) {
              const message =
                cause instanceof Error
                  ? cause.message
                  : '마지막 받은 글을 읽지 못했어요.'
              sendJson(res, 500, { error: message })
            }
            return
          }

          if (req.method === 'DELETE') {
            try {
              const result = deleteLastDownload(url.searchParams.get('q') ?? '')
              sendJson(res, 200, result)
            } catch (cause) {
              const status = cause instanceof SearchError ? cause.status : 500
              const message =
                cause instanceof Error
                  ? cause.message
                  : '저장된 검색어를 지우지 못했어요.'
              sendJson(res, status, { error: message })
            }
            return
          }

          if (req.method === 'PATCH') {
            try {
              const parsed: unknown = JSON.parse((await readBody(req)) || '{}')
              const source = (parsed ?? {}) as Record<string, unknown>
              const patchQuery =
                url.searchParams.get('q') ??
                (typeof source.query === 'string' ? source.query : '')
              let record = null
              if ('note' in source) {
                record = updateLastDownloadNote(patchQuery, source.note)
              } else if ('working' in source) {
                record = updateLastDownloadWorking(patchQuery, source.working)
              } else {
                record = updateLastDownloadSortOrder(
                  patchQuery,
                  typeof source.sortOrder === 'number' ||
                    typeof source.sortOrder === 'string'
                    ? source.sortOrder
                    : url.searchParams.get('sortOrder'),
                )
              }
              sendJson(res, 200, { record })
            } catch (cause) {
              const status = cause instanceof SearchError ? cause.status : 500
              const message =
                cause instanceof Error
                  ? cause.message
                  : '저장하지 못했어요.'
              sendJson(res, status, { error: message })
            }
            return
          }

          if (req.method !== 'PUT' && req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET, PUT, POST, PATCH, DELETE')
            res.end()
            return
          }

          try {
            const input = parseLastDownloadInput(
              JSON.parse((await readBody(req)) || '{}'),
            )
            const record = upsertLastDownload(input)
            sendJson(res, 200, { record })
          } catch (cause) {
            const status = cause instanceof SearchError ? cause.status : 500
            const message =
              cause instanceof Error
                ? cause.message
                : '마지막 받은 글을 저장하지 못했어요.'
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/torrents/stash') {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'POST')
            res.end()
            return
          }
          const controller = new AbortController()
          req.on('aborted', () => controller.abort())
          try {
            const items = parseStashItems(JSON.parse((await readBody(req)) || '{}'))
            const stashed = await stashTorrentFiles(items, controller.signal)
            sendJson(res, 200, { items: stashed })
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
                : '토렌트 파일을 보관하지 못했어요.'
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/pending') {
          if (req.method === 'GET') {
            try {
              sendJson(res, 200, {
                items: listPendingTorrents(),
                count: countPendingTorrents(),
              })
            } catch (cause) {
              const message =
                cause instanceof Error
                  ? cause.message
                  : '미추가 목록을 읽지 못했어요.'
              sendJson(res, 500, { error: message })
            }
            return
          }

          if (req.method === 'DELETE') {
            try {
              const ids = parsePendingIds(
                JSON.parse((await readBody(req)) || '{}'),
              )
              const rows = getPendingByIds(ids)
              if (rows.length === 0) {
                sendJson(res, 400, { error: '고른 미추가 항목이 없어요.' })
                return
              }
              const removedFiles = removeStashedTorrentFiles(
                rows.map((row) => row.filePath),
              )
              const removed = deletePendingByIds(rows.map((row) => row.id))
              sendJson(res, 200, {
                removed,
                removedFiles,
                items: listPendingTorrents(),
                count: countPendingTorrents(),
              })
            } catch (cause) {
              const status = cause instanceof SearchError ? cause.status : 500
              const message =
                cause instanceof Error
                  ? cause.message
                  : '미추가 목록을 지우지 못했어요.'
              sendJson(res, status, {
                error: message,
                items: listPendingTorrents(),
                count: countPendingTorrents(),
              })
            }
            return
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'GET, POST, DELETE')
            res.end()
            return
          }

          try {
            const items = parsePendingInputs(JSON.parse((await readBody(req)) || '{}'))
            sendJson(res, 200, {
              items: upsertPendingTorrents(items),
              count: countPendingTorrents(),
            })
          } catch (cause) {
            const status = cause instanceof SearchError ? cause.status : 500
            const message =
              cause instanceof Error
                ? cause.message
                : '미추가 목록을 저장하지 못했어요.'
            sendJson(res, status, { error: message })
          }
          return
        }

        if (url.pathname === '/api/qbittorrent/add') {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'POST')
            res.end()
            return
          }

          try {
            const ids = parsePendingIds(JSON.parse((await readBody(req)) || '{}'))
            const rows = getPendingByIds(ids)
            if (rows.length === 0) {
              sendJson(res, 400, { error: '고른 미추가 항목이 없어요.' })
              return
            }
            const added = await addTorrentFilesToQbittorrent(
              rows.map((row) => row.filePath),
            )
            deletePendingByIds(rows.map((row) => row.id))
            sendJson(res, 200, {
              added: added.added,
              origin: added.origin,
              items: listPendingTorrents(),
              count: countPendingTorrents(),
            })
          } catch (cause) {
            const status = cause instanceof SearchError ? cause.status : 500
            const message =
              cause instanceof Error
                ? cause.message
                : 'qBittorrent에 넣지 못했어요.'
            sendJson(res, status, {
              error: message,
              items: listPendingTorrents(),
              count: countPendingTorrents(),
            })
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
