import fs from 'node:fs'
import path from 'node:path'
import { formatYmd } from './since.ts'
import { SearchError } from './sukebei-search.ts'
import { openLastDownloadDb, queryKey } from './last-download-db.ts'

const TITLE_MAX = 500
const PATH_MAX = 1000
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export type PendingTorrent = {
  id: number
  itemId: string
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  timestamp: number
  filePath: string
  createdAt: string
}

export type PendingTorrentInput = {
  itemId: string
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  timestamp: number
  filePath: string
}

function validYmd(value: string) {
  const match = YMD.exec(value)
  if (!match) {
    return false
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return !Number.isNaN(parsed.getTime()) && formatYmd(parsed) === value
}

function ensureTable() {
  openLastDownloadDb().exec(`
    CREATE TABLE IF NOT EXISTS pending_qbittorrent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL UNIQUE,
      query TEXT NOT NULL,
      title TEXT NOT NULL,
      title_ko TEXT NOT NULL,
      item_date TEXT NOT NULL,
      item_iso TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)
}

function rowToPending(row: {
  id: number
  item_id: string
  query: string
  title: string
  title_ko: string
  item_date: string
  item_iso: string
  timestamp: number
  file_path: string
  created_at: string
}): PendingTorrent {
  return {
    id: row.id,
    itemId: row.item_id,
    query: row.query,
    title: row.title,
    titleKo: row.title_ko,
    date: row.item_date,
    iso: row.item_iso,
    timestamp: row.timestamp,
    filePath: row.file_path,
    createdAt: row.created_at,
  }
}

export function listPendingTorrents() {
  ensureTable()
  const rows = openLastDownloadDb()
    .prepare(
      `SELECT id, item_id, query, title, title_ko, item_date, item_iso, timestamp, file_path, created_at
       FROM pending_qbittorrent
       ORDER BY timestamp DESC, id DESC`,
    )
    .all() as {
    id: number
    item_id: string
    query: string
    title: string
    title_ko: string
    item_date: string
    item_iso: string
    timestamp: number
    file_path: string
    created_at: string
  }[]
  return rows.map(rowToPending)
}

export function countPendingTorrents() {
  ensureTable()
  const row = openLastDownloadDb()
    .prepare(`SELECT COUNT(*) AS count FROM pending_qbittorrent`)
    .get() as { count: number }
  return row.count
}

export function parsePendingInputs(payload: unknown): PendingTorrentInput[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    throw new SearchError('미추가 항목이 없어요.', 400)
  }
  const raw = (payload as { items: unknown }).items
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SearchError('미추가 항목이 없어요.', 400)
  }
  if (raw.length > 80) {
    throw new SearchError('한 번에 넣을 항목이 너무 많아요.', 400)
  }

  const items: PendingTorrentInput[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const source = entry as Record<string, unknown>
    const itemId = typeof source.itemId === 'string' ? source.itemId.trim() : ''
    const query = queryKey(typeof source.query === 'string' ? source.query : '')
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    const titleKo =
      typeof source.titleKo === 'string' && source.titleKo.trim()
        ? source.titleKo.trim()
        : title
    const date = typeof source.date === 'string' ? source.date.trim() : ''
    const iso = typeof source.iso === 'string' ? source.iso.trim() : ''
    const filePath =
      typeof source.filePath === 'string' ? source.filePath.trim() : ''
    const timestamp =
      typeof source.timestamp === 'number'
        ? source.timestamp
        : Number(source.timestamp)
    if (
      !itemId ||
      !query ||
      !title ||
      !validYmd(date) ||
      !filePath ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      continue
    }
    if (filePath.includes('\0') || filePath.length > PATH_MAX) {
      continue
    }
    if (seen.has(itemId)) {
      continue
    }
    seen.add(itemId)
    items.push({
      itemId: itemId.slice(0, 32),
      query: query.slice(0, 200),
      title: title.slice(0, TITLE_MAX),
      titleKo: titleKo.slice(0, TITLE_MAX),
      date,
      iso: iso.slice(0, 40) || new Date(timestamp * 1000).toISOString(),
      timestamp: Math.trunc(timestamp),
      filePath,
    })
  }
  if (items.length === 0) {
    throw new SearchError('미추가 항목이 없어요.', 400)
  }
  return items
}

export function upsertPendingTorrents(items: PendingTorrentInput[]) {
  ensureTable()
  const db = openLastDownloadDb()
  const insert = db.prepare(
    `INSERT INTO pending_qbittorrent (
       item_id, query, title, title_ko, item_date, item_iso, timestamp, file_path, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       query = excluded.query,
       title = excluded.title,
       title_ko = excluded.title_ko,
       item_date = excluded.item_date,
       item_iso = excluded.item_iso,
       timestamp = excluded.timestamp,
       file_path = excluded.file_path,
       created_at = excluded.created_at`,
  )
  const createdAt = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const item of items) {
      insert.run(
        item.itemId,
        item.query,
        item.title,
        item.titleKo,
        item.date,
        item.iso,
        item.timestamp,
        item.filePath,
        createdAt,
      )
    }
    db.exec('COMMIT')
  } catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
  return listPendingTorrents()
}

export function getPendingByIds(ids: number[]) {
  ensureTable()
  if (ids.length === 0) {
    return []
  }
  const rows = listPendingTorrents()
  const wanted = new Set(ids)
  return rows.filter((row) => wanted.has(row.id))
}

export function deletePendingByIds(ids: number[]) {
  ensureTable()
  if (ids.length === 0) {
    return 0
  }
  const db = openLastDownloadDb()
  const del = db.prepare(`DELETE FROM pending_qbittorrent WHERE id = ?`)
  let removed = 0
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      const result = del.run(id)
      removed += Number(result.changes ?? 0)
    }
    db.exec('COMMIT')
  } catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
  return removed
}

export function parsePendingIds(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('ids' in payload)) {
    throw new SearchError('고를 항목이 없어요.', 400)
  }
  const raw = (payload as { ids: unknown }).ids
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SearchError('고를 항목이 없어요.', 400)
  }
  const ids = [
    ...new Set(
      raw
        .map((value) =>
          typeof value === 'number' ? value : Number.parseInt(String(value), 10),
        )
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ]
  if (ids.length === 0) {
    throw new SearchError('고를 항목이 없어요.', 400)
  }
  return ids
}

export function assertReadableTorrentPath(filePath: string) {
  const resolved = path.resolve(filePath)
  if (!resolved.endsWith('.torrent')) {
    throw new SearchError('토렌트 파일 경로가 올바르지 않아요.', 400)
  }
  if (!fs.existsSync(resolved)) {
    throw new SearchError(`토렌트 파일이 없어요: ${resolved}`, 404)
  }
  return resolved
}
