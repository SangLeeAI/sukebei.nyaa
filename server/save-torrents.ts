import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SearchError } from './sukebei-search.ts'
import { fetchTorrentFile, parseTorrentId } from './sukebei-torrent.ts'

const SAVE_DELAY_MS = 250
const SAVE_MAX_ITEMS = 80
const TITLE_MAX = 200

export type TorrentSaveItem = {
  id: string
  title: string
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function sanitizeFilenamePart(title: string) {
  let cleaned = ''
  for (const char of title) {
    const code = char.charCodeAt(0)
    if (code < 32 || '<>:"/\\|?*'.includes(char)) {
      cleaned += '_'
    } else {
      cleaned += char
    }
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function torrentFilename(title: string, id: string) {
  const base = `${sanitizeFilenamePart(title) || id}.torrent`
  return path.basename(base)
}

export function downloadsDirectory() {
  const override = process.env.NYAA_TORRENT_DIR?.trim()
  if (override) {
    return path.resolve(override)
  }
  return path.join(os.homedir(), 'Downloads')
}

async function uniqueFilename(
  directory: string,
  filename: string,
  used: Set<string>,
) {
  const ext = '.torrent'
  const stem = filename.endsWith(ext)
    ? filename.slice(0, -ext.length)
    : filename
  let name = filename.endsWith(ext) ? filename : `${filename}${ext}`
  let index = 2
  while (used.has(name)) {
    name = `${stem} (${index})${ext}`
    index += 1
  }
  while (true) {
    try {
      await fs.access(path.join(directory, name))
      name = `${stem} (${index})${ext}`
      index += 1
    } catch {
      break
    }
  }
  used.add(name)
  return name
}

export function parseSaveItems(payload: unknown): TorrentSaveItem[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  const raw = payload.items
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  if (raw.length > SAVE_MAX_ITEMS) {
    throw new SearchError(
      `한 번에 ${SAVE_MAX_ITEMS}개까지만 받을 수 있어요.`,
      400,
    )
  }

  const items: TorrentSaveItem[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const id =
      'id' in entry && typeof entry.id === 'string'
        ? parseTorrentId(entry.id)
        : null
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const title =
      'title' in entry && typeof entry.title === 'string'
        ? entry.title.slice(0, TITLE_MAX)
        : id
    items.push({ id, title })
  }

  if (items.length === 0) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  return items
}

export async function saveTorrentsToDownloads(
  items: TorrentSaveItem[],
  signal?: AbortSignal,
) {
  const directory = downloadsDirectory()
  await fs.mkdir(directory, { recursive: true })
  const used = new Set<string>()
  const files: string[] = []
  let skipped = 0

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) {
      await sleep(SAVE_DELAY_MS, signal)
    }
    const item = items[index]
    try {
      const data = await fetchTorrentFile(item.id, signal)
      const name = await uniqueFilename(
        directory,
        torrentFilename(item.title, item.id),
        used,
      )
      await fs.writeFile(path.join(directory, name), data)
      files.push(name)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      skipped += 1
    }
  }

  if (files.length === 0) {
    throw new SearchError(
      '선택한 항목에서 토렌트 파일을 받지 못했어요. 마그넷만 있는 글일 수 있어요.',
      502,
    )
  }

  return {
    directory,
    files,
    saved: files.length,
    skipped,
  }
}
