import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { formatYmd } from './since.ts'
import { SearchError } from './sukebei-search.ts'

export const DB_PATH = path.resolve(import.meta.dirname, '../data/nyaa.sqlite')

const QUERY_MAX = 200
const TITLE_MAX = 500
const NOTE_MAX = 500
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export type LastDownloadRecord = {
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  id: string
  timestamp: number
  savedAt: string
  sortOrder: number
  note: string
  working: boolean
}

let db: DatabaseSync | null = null

export function queryKey(raw: string) {
  return raw.trim().normalize('NFC')
}

function ensureColumns(db: DatabaseSync) {
  const columns = db.prepare(`PRAGMA table_info(last_download)`).all() as {
    name?: unknown
  }[]
  const names = columns.map((column) => String(column.name))
  if (!names.includes('sort_order')) {
    db.exec(
      `ALTER TABLE last_download ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
    )
  }
  if (!names.includes('note')) {
    db.exec(`ALTER TABLE last_download ADD COLUMN note TEXT NOT NULL DEFAULT ''`)
  }
  if (!names.includes('working')) {
    db.exec(
      `ALTER TABLE last_download ADD COLUMN working INTEGER NOT NULL DEFAULT 0`,
    )
  }
}

export function openLastDownloadDb() {
  if (db) {
    return db
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS last_download (
      query TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      title_ko TEXT NOT NULL,
      item_date TEXT NOT NULL,
      item_iso TEXT NOT NULL,
      item_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      working INTEGER NOT NULL DEFAULT 0
    )
  `)
  ensureColumns(db)
  return db
}

function validYmd(value: string) {
  const match = YMD.exec(value)
  if (!match) {
    return false
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return !Number.isNaN(parsed.getTime()) && formatYmd(parsed) === value
}

function rowToRecord(row: {
  query: string
  title: string
  title_ko: string
  item_date: string
  item_iso: string
  item_id: string
  timestamp: number
  saved_at: string
  sort_order: number
  note: string
  working: number
}): LastDownloadRecord {
  return {
    query: row.query,
    title: row.title,
    titleKo: row.title_ko,
    date: row.item_date,
    iso: row.item_iso,
    id: row.item_id,
    timestamp: row.timestamp,
    savedAt: row.saved_at,
    sortOrder: row.sort_order,
    note: row.note,
    working: row.working === 1,
  }
}

export function getLastDownload(rawQuery: string) {
  const query = queryKey(rawQuery)
  if (!query) {
    return null
  }
  const row = openLastDownloadDb()
    .prepare(
      `SELECT query, title, title_ko, item_date, item_iso, item_id, timestamp, saved_at, sort_order, note, working
       FROM last_download
       WHERE query = ?`,
    )
    .get(query) as
    | {
        query: string
        title: string
        title_ko: string
        item_date: string
        item_iso: string
        item_id: string
        timestamp: number
        saved_at: string
        sort_order: number
        note: string
        working: number
      }
    | undefined
  return row ? rowToRecord(row) : null
}

export function listLastDownloads() {
  const rows = openLastDownloadDb()
    .prepare(
      `SELECT query, title, title_ko, item_date, item_iso, item_id, timestamp, saved_at, sort_order, note, working
       FROM last_download
       ORDER BY sort_order ASC, timestamp DESC, saved_at DESC`,
    )
    .all() as {
    query: string
    title: string
    title_ko: string
    item_date: string
    item_iso: string
    item_id: string
    timestamp: number
    saved_at: string
    sort_order: number
    note: string
    working: number
  }[]
  return rows.map(rowToRecord)
}

export function parseLastDownloadInput(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new SearchError('저장할 내용이 없어요.', 400)
  }
  const source = payload as Record<string, unknown>
  const query = queryKey(typeof source.query === 'string' ? source.query : '')
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const titleKo =
    typeof source.titleKo === 'string' && source.titleKo.trim()
      ? source.titleKo.trim()
      : title
  const date = typeof source.date === 'string' ? source.date.trim() : ''
  const iso = typeof source.iso === 'string' ? source.iso.trim() : ''
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const timestamp =
    typeof source.timestamp === 'number'
      ? source.timestamp
      : Number(source.timestamp)

  if (!query) {
    throw new SearchError('검색어가 없어요.', 400)
  }
  if (query.length > QUERY_MAX) {
    throw new SearchError('검색어가 너무 길어요.', 400)
  }
  if (!title || !id || !validYmd(date)) {
    throw new SearchError('마지막 받은 글 정보가 올바르지 않아요.', 400)
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new SearchError('마지막 받은 글 정보가 올바르지 않아요.', 400)
  }

  return {
    query,
    title: title.slice(0, TITLE_MAX),
    titleKo: titleKo.slice(0, TITLE_MAX),
    date,
    iso: iso.slice(0, 40) || new Date(timestamp * 1000).toISOString(),
    id: id.slice(0, 32),
    timestamp: Math.trunc(timestamp),
    sortOrder:
      typeof source.sortOrder === 'number' && Number.isFinite(source.sortOrder)
        ? Math.trunc(source.sortOrder)
        : 0,
    note:
      typeof source.note === 'string' ? source.note.trim().slice(0, NOTE_MAX) : '',
    working: source.working === true,
  }
}

export function deleteLastDownload(rawQuery: string) {
  const query = queryKey(rawQuery)
  if (!query) {
    throw new SearchError('검색어가 없어요.', 400)
  }
  const info = openLastDownloadDb()
    .prepare(`DELETE FROM last_download WHERE query = ?`)
    .run(query)
  return { query, deleted: Number(info.changes) > 0 }
}

export function upsertLastDownload(input: ReturnType<typeof parseLastDownloadInput>) {
  const savedAt = new Date().toISOString()
  openLastDownloadDb()
    .prepare(
      `INSERT INTO last_download (
         query, title, title_ko, item_date, item_iso, item_id, timestamp, saved_at, sort_order, note, working
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET
         title = excluded.title,
         title_ko = excluded.title_ko,
         item_date = excluded.item_date,
         item_iso = excluded.item_iso,
         item_id = excluded.item_id,
         timestamp = excluded.timestamp,
         saved_at = excluded.saved_at`,
    )
    .run(
      input.query,
      input.title,
      input.titleKo,
      input.date,
      input.iso,
      input.id,
      input.timestamp,
      savedAt,
      input.sortOrder,
      input.note,
      input.working ? 1 : 0,
    )
  return getLastDownload(input.query)
}

export function updateLastDownloadSortOrder(rawQuery: string, sortOrder: unknown) {
  const query = queryKey(rawQuery)
  if (!query) {
    throw new SearchError('검색어가 없어요.', 400)
  }
  const parsed =
    typeof sortOrder === 'number' ? sortOrder : Number(sortOrder)
  if (!Number.isFinite(parsed) || parsed < -1_000_000 || parsed > 1_000_000) {
    throw new SearchError('오더 번호는 -1000000부터 1000000 사이여야 해요.', 400)
  }
  const info = openLastDownloadDb()
    .prepare(`UPDATE last_download SET sort_order = ? WHERE query = ?`)
    .run(Math.trunc(parsed), query)
  if (Number(info.changes) === 0) {
    throw new SearchError('저장된 검색어를 찾지 못했어요.', 404)
  }
  return getLastDownload(query)
}

export function updateLastDownloadNote(rawQuery: string, note: unknown) {
  const query = queryKey(rawQuery)
  if (!query) {
    throw new SearchError('검색어가 없어요.', 400)
  }
  const next =
    typeof note === 'string' ? note.trim().slice(0, NOTE_MAX) : ''
  const info = openLastDownloadDb()
    .prepare(`UPDATE last_download SET note = ? WHERE query = ?`)
    .run(next, query)
  if (Number(info.changes) === 0) {
    throw new SearchError('저장된 검색어를 찾지 못했어요.', 404)
  }
  return getLastDownload(query)
}

export function updateLastDownloadWorking(rawQuery: string, working: unknown) {
  const query = queryKey(rawQuery)
  if (!query) {
    throw new SearchError('검색어가 없어요.', 400)
  }
  const next = working === true || working === 'true' || working === 1
  const info = openLastDownloadDb()
    .prepare(`UPDATE last_download SET working = ? WHERE query = ?`)
    .run(next ? 1 : 0, query)
  if (Number(info.changes) === 0) {
    throw new SearchError('저장된 검색어를 찾지 못했어요.', 404)
  }
  return getLastDownload(query)
}
