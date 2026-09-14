import fs from 'node:fs'
import path from 'node:path'
import { SearchError } from './sukebei-search.ts'
import { fetchTorrentFile, parseTorrentId } from './sukebei-torrent.ts'
import { formatYmd } from './since.ts'

export const TORRENT_STASH_DIR = path.resolve(
  import.meta.dirname,
  '../data/torrents',
)

export type StashItemInput = {
  itemId: string
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  timestamp: number
  torrentBase64?: string
}

export type StashedTorrent = StashItemInput & {
  filePath: string
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function validYmd(value: string) {
  const match = YMD.exec(value)
  if (!match) {
    return false
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return !Number.isNaN(parsed.getTime()) && formatYmd(parsed) === value
}

function decodeBase64Torrent(raw: string) {
  const compact = raw.replace(/\s+/g, '')
  if (!compact) {
    return null
  }
  try {
    const buffer = Buffer.from(compact, 'base64')
    if (buffer.byteLength === 0 || buffer[0] !== 0x64) {
      return null
    }
    return buffer
  } catch {
    return null
  }
}

export function parseStashItems(payload: unknown): StashItemInput[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    throw new SearchError('저장할 토렌트가 없어요.', 400)
  }
  const query =
    'query' in payload && typeof payload.query === 'string'
      ? payload.query.trim().normalize('NFC')
      : ''
  const raw = (payload as { items: unknown }).items
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SearchError('저장할 토렌트가 없어요.', 400)
  }
  if (raw.length > 80) {
    throw new SearchError('한 번에 저장할 파일이 너무 많아요.', 400)
  }

  const items: StashItemInput[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const source = entry as Record<string, unknown>
    const itemId = parseTorrentId(
      typeof source.itemId === 'string'
        ? source.itemId
        : typeof source.id === 'string'
          ? source.id
          : '',
    )
    if (!itemId || seen.has(itemId)) {
      continue
    }
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    const titleKo =
      typeof source.titleKo === 'string' && source.titleKo.trim()
        ? source.titleKo.trim()
        : title
    const date = typeof source.date === 'string' ? source.date.trim() : ''
    const iso = typeof source.iso === 'string' ? source.iso.trim() : ''
    const timestamp =
      typeof source.timestamp === 'number'
        ? source.timestamp
        : Number(source.timestamp)
    const itemQuery =
      typeof source.query === 'string' && source.query.trim()
        ? source.query.trim().normalize('NFC')
        : query
    if (!title || !itemQuery || !validYmd(date) || !Number.isFinite(timestamp)) {
      continue
    }
    seen.add(itemId)
    items.push({
      itemId,
      query: itemQuery.slice(0, 200),
      title: title.slice(0, 500),
      titleKo: titleKo.slice(0, 500),
      date,
      iso: iso.slice(0, 40) || new Date(timestamp * 1000).toISOString(),
      timestamp: Math.trunc(timestamp),
      torrentBase64:
        typeof source.torrentBase64 === 'string'
          ? source.torrentBase64
          : undefined,
    })
  }
  if (items.length === 0) {
    throw new SearchError('저장할 토렌트가 없어요.', 400)
  }
  return items
}

export async function stashTorrentFiles(
  items: StashItemInput[],
  signal?: AbortSignal,
) {
  fs.mkdirSync(TORRENT_STASH_DIR, { recursive: true })
  const saved: StashedTorrent[] = []

  for (const item of items) {
    const target = path.join(TORRENT_STASH_DIR, `${item.itemId}.torrent`)
    let body = item.torrentBase64
      ? decodeBase64Torrent(item.torrentBase64)
      : null
    if (!body) {
      body = await fetchTorrentFile(item.itemId, signal)
    }
    fs.writeFileSync(target, body)
    saved.push({ ...item, filePath: target })
  }

  return saved
}
