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

export type StashItem = {
  itemId: string
  query: string
  title: string
  titleKo: string
  date: string
  iso: string
  timestamp: number
  torrentBase64?: string
  filePath: string
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

function asPendingList(payload: unknown): PendingTorrent[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    return []
  }
  const raw = (payload as { items: unknown }).items
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((row): row is PendingTorrent => {
    return (
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as PendingTorrent).id === 'number' &&
      typeof (row as PendingTorrent).itemId === 'string' &&
      typeof (row as PendingTorrent).title === 'string'
    )
  })
}

export async function stashDownloadedTorrents(
  query: string,
  items: StashItem[],
  signal?: AbortSignal,
) {
  const response = await fetch('/api/torrents/stash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ query, items }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  if (!payload || typeof payload !== 'object' || !('items' in payload)) {
    return []
  }
  const raw = (payload as { items: unknown }).items
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((row): row is StashItem => {
    return (
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as StashItem).itemId === 'string' &&
      typeof (row as StashItem).filePath === 'string'
    )
  })
}

export async function fetchPendingTorrents(signal?: AbortSignal) {
  const response = await fetch('/api/pending', { signal })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return {
    items: asPendingList(payload),
    count:
      payload &&
      typeof payload === 'object' &&
      'count' in payload &&
      typeof payload.count === 'number'
        ? payload.count
        : asPendingList(payload).length,
  }
}

export async function savePendingTorrents(
  items: Omit<StashItem, 'torrentBase64'>[],
  signal?: AbortSignal,
) {
  const response = await fetch('/api/pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ items }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return asPendingList(payload)
}

export async function addPendingToQbittorrent(
  ids: number[],
  signal?: AbortSignal,
) {
  const response = await fetch('/api/qbittorrent/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ids }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return {
    added:
      payload &&
      typeof payload === 'object' &&
      'added' in payload &&
      typeof payload.added === 'number'
        ? payload.added
        : ids.length,
    items: asPendingList(payload),
  }
}

export async function deletePendingTorrents(
  ids: number[],
  signal?: AbortSignal,
) {
  const response = await fetch('/api/pending', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ids }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return {
    removed:
      payload &&
      typeof payload === 'object' &&
      'removed' in payload &&
      typeof payload.removed === 'number'
        ? payload.removed
        : ids.length,
    items: asPendingList(payload),
  }
}
