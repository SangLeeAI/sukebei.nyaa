import type { Listing } from '@/lib/search'

const DOWNLOAD_GAP_MS = 800

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

function uniqueTorrentFilename(
  used: Set<string>,
  title: string,
  id: string,
) {
  const filename = torrentFilename(title, id)
  if (!used.has(filename)) {
    used.add(filename)
    return filename
  }
  const stem = filename.replace(/\.torrent$/i, '')
  let index = 2
  let next = `${stem} (${index}).torrent`
  while (used.has(next)) {
    index += 1
    next = `${stem} (${index}).torrent`
  }
  used.add(next)
  return next
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

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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
  options?: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  },
) {
  const signal = options?.signal
  if (items.length === 0) {
    return { saved: 0, skipped: 0 }
  }

  const usedNames = new Set<string>()
  let saved = 0
  let skipped = 0

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (index > 0) {
      await sleep(DOWNLOAD_GAP_MS, signal)
    }

    const item = items[index]
    try {
      const response = await fetch(`/api/torrent/${item.id}.torrent`, {
        signal,
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const blob = await response.blob()
      saveBlob(blob, uniqueTorrentFilename(usedNames, item.title, item.id))
      saved += 1
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      skipped += 1
    }
    options?.onProgress?.(index + 1, items.length)
  }

  if (saved === 0) {
    throw new Error(
      '선택한 항목에서 토렌트 파일을 받지 못했어요. 마그넷만 있는 글일 수 있어요.',
    )
  }

  return { saved, skipped }
}
