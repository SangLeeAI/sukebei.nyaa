export type Listing = {
  id: string
  title: string
  date: string
  timestamp: number
  size: string
  seeders: number
  leechers: number
  category: string
  magnet: string | null
  torrent: string | null
  viewUrl: string
  trusted: boolean
}

export type SearchResponse = {
  query: string
  windowDays: number
  pagesFetched: number
  itemCount: number
  items: Listing[]
  stoppedReason: 'window' | 'no-more' | 'page-limit'
}

export async function searchListings(query: string, signal?: AbortSignal) {
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(query)}`,
    { signal },
  )
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `검색 요청이 실패했어요. (${response.status})`
    throw new Error(message)
  }

  return payload as SearchResponse
}
