import { SearchError, SUKEBEI_ORIGIN } from './sukebei-search.ts'
import { createStoredZip } from './zip-store.ts'

const TORRENT_TIMEOUT_MS = 20_000
const MAX_TORRENT_BYTES = 20 * 1024 * 1024
const ZIP_DELAY_MS = 250
const ZIP_MAX_ITEMS = 40
const TITLE_MAX = 200

export type TorrentRequestItem = {
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

export function parseTorrentId(raw: string) {
  const id = raw.trim()
  if (!/^\d{1,12}$/.test(id)) {
    return null
  }
  return id
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
  return `${sanitizeFilenamePart(title) || id}.torrent`
}

export function contentDisposition(filename: string) {
  const ascii =
    filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') ||
    'download.bin'
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function uniqueZipName(used: Set<string>, filename: string) {
  if (!used.has(filename)) {
    used.add(filename)
    return filename
  }
  const ext = '.torrent'
  const base = filename.endsWith(ext)
    ? filename.slice(0, -ext.length)
    : filename
  let index = 2
  let next = `${base} (${index})${ext}`
  while (used.has(next)) {
    index += 1
    next = `${base} (${index})${ext}`
  }
  used.add(next)
  return next
}

export async function fetchTorrentFile(id: string, signal?: AbortSignal) {
  const parsed = parseTorrentId(id)
  if (!parsed) {
    throw new SearchError('토렌트 번호가 올바르지 않아요.', 400)
  }

  const url = `${SUKEBEI_ORIGIN}/download/${parsed}.torrent`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/x-bittorrent,application/octet-stream,*/*',
      'User-Agent':
        'NyaaLocalSearch/1.0 (personal Vite proxy; torrent download)',
    },
    signal: AbortSignal.any(
      [signal, AbortSignal.timeout(TORRENT_TIMEOUT_MS)].filter(
        (value): value is AbortSignal => Boolean(value),
      ),
    ),
  })

  if (!response.ok) {
    throw new SearchError(
      `토렌트 파일을 받지 못했어요. (HTTP ${response.status})`,
      response.status === 404 ? 404 : 502,
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) {
    throw new SearchError('토렌트 파일이 비어 있어요.', 502)
  }
  if (buffer.byteLength > MAX_TORRENT_BYTES) {
    throw new SearchError('토렌트 파일이 너무 커요.', 502)
  }
  if (buffer[0] !== 0x64) {
    throw new SearchError(
      '받은 내용이 토렌트 파일이 아니에요. 마그넷만 있는 글일 수 있어요.',
      502,
    )
  }
  return buffer
}

export function parseZipItems(payload: unknown): TorrentRequestItem[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  const raw = payload.items
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  if (raw.length > ZIP_MAX_ITEMS) {
    throw new SearchError(
      `한 번에 ${ZIP_MAX_ITEMS}개까지만 받을 수 있어요.`,
      400,
    )
  }

  const items: TorrentRequestItem[] = []
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

export function parseZipIdsParam(raw: string | null): TorrentRequestItem[] {
  const ids = (raw ?? '')
    .split(',')
    .map((part) => parseTorrentId(part))
    .filter((id): id is string => Boolean(id))
  const unique = [...new Set(ids)]
  if (unique.length === 0) {
    throw new SearchError('받을 항목이 없어요.', 400)
  }
  if (unique.length > ZIP_MAX_ITEMS) {
    throw new SearchError(
      `한 번에 ${ZIP_MAX_ITEMS}개까지만 받을 수 있어요.`,
      400,
    )
  }
  return unique.map((id) => ({ id, title: id }))
}

export async function buildTorrentZip(
  items: TorrentRequestItem[],
  signal?: AbortSignal,
) {
  const files: { name: string; data: Buffer }[] = []
  const used = new Set<string>()
  const skipped: string[] = []

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) {
      await sleep(ZIP_DELAY_MS, signal)
    }
    const item = items[index]
    try {
      const data = await fetchTorrentFile(item.id, signal)
      files.push({
        name: uniqueZipName(used, torrentFilename(item.title, item.id)),
        data,
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      const message =
        cause instanceof Error ? cause.message : '알 수 없는 오류'
      skipped.push(`${item.id}\t${item.title}\t${message}`)
    }
  }

  if (files.length === 0) {
    throw new SearchError(
      '선택한 항목에서 토렌트 파일을 받지 못했어요. 마그넷만 있는 글일 수 있어요.',
      502,
    )
  }

  if (skipped.length > 0) {
    files.push({
      name: 'skipped.txt',
      data: Buffer.from(
        `받지 못한 항목 ${skipped.length}개\n${skipped.join('\n')}\n`,
        'utf8',
      ),
    })
  }

  return {
    body: createStoredZip(files),
    saved: files.filter((file) => file.name.endsWith('.torrent')).length,
    skipped: skipped.length,
  }
}
