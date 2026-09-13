import type { Listing } from '@/lib/search'

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

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function readError(response: Response) {
  const payload: unknown = await response.json().catch(() => null)
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error
  }
  return `토렌트 요청이 실패했어요. (${response.status})`
}

export async function downloadSelectedTorrents(
  items: Listing[],
  signal?: AbortSignal,
) {
  if (items.length === 0) {
    return { saved: 0, skipped: 0 }
  }

  if (items.length === 1) {
    const item = items[0]
    const response = await fetch(`/api/torrent/${item.id}.torrent`, { signal })
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    saveBlob(await response.blob(), torrentFilename(item.title, item.id))
    return { saved: 1, skipped: 0 }
  }

  const response = await fetch('/api/torrents.zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      items: items.map((item) => ({ id: item.id, title: item.title })),
    }),
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  saveBlob(await response.blob(), 'sukebei-torrents.zip')
  const saved = Number(response.headers.get('X-Nyaa-Saved') ?? items.length)
  const skipped = Number(response.headers.get('X-Nyaa-Skipped') ?? 0)
  return {
    saved: Number.isFinite(saved) ? saved : items.length,
    skipped: Number.isFinite(skipped) ? skipped : 0,
  }
}
