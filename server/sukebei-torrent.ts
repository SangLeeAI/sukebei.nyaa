import { SearchError, SUKEBEI_ORIGIN } from './sukebei-search.ts'

const TORRENT_TIMEOUT_MS = 20_000
const MAX_TORRENT_BYTES = 20 * 1024 * 1024

export function parseTorrentId(raw: string) {
  const id = raw.trim()
  if (!/^\d{1,12}$/.test(id)) {
    return null
  }
  return id
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
