export type LastDownloadRecord = {
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  id: string
  timestamp: number
  savedAt: string
}

export function queryKey(raw: string) {
  return raw.trim().normalize('NFC')
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
  return `요청이 실패했어요. (${response.status})`
}

function asRecord(payload: unknown): LastDownloadRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  if (!('record' in payload)) {
    return null
  }
  const record = payload.record
  if (!record || typeof record !== 'object') {
    return null
  }
  const row = record as Record<string, unknown>
  if (
    typeof row.query !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.titleKo !== 'string' ||
    typeof row.date !== 'string' ||
    typeof row.id !== 'string'
  ) {
    return null
  }
  return {
    query: row.query,
    title: row.title,
    titleKo: row.titleKo,
    date: row.date,
    iso: typeof row.iso === 'string' ? row.iso : '',
    id: row.id,
    timestamp: typeof row.timestamp === 'number' ? row.timestamp : 0,
    savedAt: typeof row.savedAt === 'string' ? row.savedAt : '',
  }
}

export async function fetchLastDownload(query: string, signal?: AbortSignal) {
  const trimmed = query.trim()
  if (!trimmed) {
    return null
  }
  const response = await fetch(
    `/api/last-download?q=${encodeURIComponent(trimmed)}`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return asRecord(await response.json())
}

export async function saveLastDownload(
  record: {
    query: string
    title: string
    titleKo: string
    date: string
    iso: string
    id: string
    timestamp: number
  },
  signal?: AbortSignal,
) {
  const response = await fetch('/api/last-download', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(record),
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return asRecord(await response.json())
}
