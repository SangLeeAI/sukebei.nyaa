import type { Listing } from '@/lib/search'

export type DownloadOutcome = {
  saved: number
  skipped: number
  cancelled?: boolean
  directory?: string
  method?: 'blob' | 'folder' | 'downloads'
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

async function fetchTorrentBlob(id: string, signal?: AbortSignal) {
  const response = await fetch(`/api/torrent/${id}.torrent`, { signal })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return response.blob()
}

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

async function fileExistsInDirectory(
  directory: FileSystemDirectoryHandle,
  name: string,
) {
  try {
    await directory.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

async function uniqueDirectoryFilename(
  directory: FileSystemDirectoryHandle,
  used: Set<string>,
  title: string,
  id: string,
) {
  let name = torrentFilename(title, id)
  let index = 2
  const stem = name.replace(/\.torrent$/i, '')
  while (used.has(name) || (await fileExistsInDirectory(directory, name))) {
    name = `${stem} (${index}).torrent`
    index += 1
  }
  used.add(name)
  return name
}

async function writeBlobToDirectory(
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
) {
  const handle = await directory.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(await blob.arrayBuffer())
  } finally {
    await writable.close()
  }
}

type DirectoryPickerOptions = {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: 'downloads' | 'desktop' | 'documents' | FileSystemHandle
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>
}

async function pickSaveDirectory() {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (typeof picker !== 'function') {
    return null
  }
  try {
    return await picker({
      id: 'nyaa-torrents',
      mode: 'readwrite',
      startIn: 'downloads',
    })
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause
    }
    return null
  }
}

async function saveWithFolderPicker(
  items: Listing[],
  directory: FileSystemDirectoryHandle,
  options?: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  },
) {
  const used = new Set<string>()
  let saved = 0
  let skipped = 0

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    try {
      const blob = await fetchTorrentBlob(item.id, options?.signal)
      const name = await uniqueDirectoryFilename(
        directory,
        used,
        item.title,
        item.id,
      )
      await writeBlobToDirectory(directory, name, blob)
      saved += 1
    } catch (cause) {
      if (isAbortError(cause)) {
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

  return { saved, skipped, method: 'folder' as const }
}

async function saveWithLocalDownloads(
  items: Listing[],
  signal?: AbortSignal,
) {
  const response = await fetch('/api/torrents/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      items: items.map((item) => ({ id: item.id, title: item.title })),
    }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const saved =
    payload &&
    typeof payload === 'object' &&
    'saved' in payload &&
    typeof payload.saved === 'number'
      ? payload.saved
      : items.length
  const skipped =
    payload &&
    typeof payload === 'object' &&
    'skipped' in payload &&
    typeof payload.skipped === 'number'
      ? payload.skipped
      : 0
  const directory =
    payload &&
    typeof payload === 'object' &&
    'directory' in payload &&
    typeof payload.directory === 'string'
      ? payload.directory
      : undefined
  return { saved, skipped, directory, method: 'downloads' as const }
}

export async function downloadSelectedTorrents(
  items: Listing[],
  options?: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  },
): Promise<DownloadOutcome> {
  const signal = options?.signal
  if (items.length === 0) {
    return { saved: 0, skipped: 0 }
  }

  if (items.length === 1) {
    const item = items[0]
    const blob = await fetchTorrentBlob(item.id, signal)
    saveBlob(blob, torrentFilename(item.title, item.id))
    options?.onProgress?.(1, 1)
    return { saved: 1, skipped: 0, method: 'blob' }
  }

  let directory: FileSystemDirectoryHandle | null = null
  try {
    directory = await pickSaveDirectory()
  } catch (cause) {
    if (isAbortError(cause)) {
      if (signal?.aborted) {
        throw cause
      }
      return { saved: 0, skipped: 0, cancelled: true }
    }
    throw cause
  }

  if (directory) {
    return saveWithFolderPicker(items, directory, options)
  }

  const confirmed = window.confirm(
    `선택한 ${items.length}개 토렌트를 다운로드 폴더에 각각 저장할까요?`,
  )
  if (!confirmed) {
    return { saved: 0, skipped: 0, cancelled: true }
  }

  options?.onProgress?.(0, items.length)
  return saveWithLocalDownloads(items, signal)
}
