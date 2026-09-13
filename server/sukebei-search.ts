import { parse } from 'node-html-parser'

export const SUKEBEI_ORIGIN = 'https://sukebei.nyaa.si'
export const WINDOW_DAYS = 30
const PAGE_SIZE = 75
const MAX_PAGES = 16
const PAGE_DELAY_MS = 250
const QUERY_MAX = 200
const FETCH_TIMEOUT_MS = 20_000

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
}

export type SearchResponse = {
  query: string
  windowDays: number
  pagesFetched: number
  itemCount: number
  items: Listing[]
  stoppedReason: 'window' | 'no-more' | 'page-limit'
}

export class SearchError extends Error {
  status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'SearchError'
    this.status = status
  }
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

function textContent(el: { text?: string } | null | undefined) {
  return (el?.text ?? '').replace(/\s+/g, ' ').trim()
}

function absUrl(href: string | undefined) {
  if (!href) {
    return null
  }
  try {
    return new URL(href, SUKEBEI_ORIGIN).toString()
  } catch {
    return null
  }
}

function decodeHref(href: string | undefined) {
  if (!href) {
    return null
  }
  return href.replaceAll('&amp;', '&')
}

export function parseSearchPage(html: string): Listing[] {
  const root = parse(html)
  const rows = root.querySelectorAll('table.torrent-list tbody tr')
  const items: Listing[] = []

  for (const row of rows) {
    const view = row.querySelector('a[href^="/view/"]')
    const href = view?.getAttribute('href') ?? ''
    const idMatch = href.match(/\/view\/(\d+)/)
    if (!idMatch) {
      continue
    }
    const id = idMatch[1]
    const title =
      view?.getAttribute('title')?.trim() || textContent(view)
    if (!title) {
      continue
    }

    const category =
      row.querySelector('a[href^="/?c="]')?.getAttribute('title')?.trim() ||
      '기타'

    const dateTd = row.querySelector('td[data-timestamp]')
    const timestamp = Number(dateTd?.getAttribute('data-timestamp'))
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      continue
    }

    const cells = row.querySelectorAll('td')
    const dateIndex = cells.findIndex((cell) => cell.getAttribute('data-timestamp'))
    const size =
      dateIndex > 0 ? textContent(cells[dateIndex - 1]) : ''
    const seeders =
      dateIndex >= 0 ? Number(textContent(cells[dateIndex + 1])) || 0 : 0
    const leechers =
      dateIndex >= 0 ? Number(textContent(cells[dateIndex + 2])) || 0 : 0

    const torrentHref = row
      .querySelector('a[href*="/download/"]')
      ?.getAttribute('href')
    const magnetHref = decodeHref(
      row.querySelector('a[href^="magnet:"]')?.getAttribute('href'),
    )

    items.push({
      id,
      title,
      date: new Date(timestamp * 1000).toISOString(),
      timestamp,
      size,
      seeders,
      leechers,
      category,
      magnet: magnetHref,
      torrent: absUrl(torrentHref ?? undefined),
      viewUrl: absUrl(`/view/${id}`) ?? `${SUKEBEI_ORIGIN}/view/${id}`,
    })
  }

  return items
}

async function fetchSearchPage(
  query: string,
  page: number,
  signal?: AbortSignal,
) {
  const url = new URL(SUKEBEI_ORIGIN)
  url.searchParams.set('f', '0')
  url.searchParams.set('c', '0_0')
  url.searchParams.set('q', query)
  url.searchParams.set('s', 'id')
  url.searchParams.set('o', 'desc')
  if (page > 1) {
    url.searchParams.set('p', String(page))
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'NyaaLocalSearch/1.0 (personal Vite proxy; sequential public search)',
    },
    signal: AbortSignal.any(
      [signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)].filter(
        (value): value is AbortSignal => Boolean(value),
      ),
    ),
  })

  if (!response.ok) {
    throw new SearchError(
      `sukebei.nyaa.si가 HTTP ${response.status}로 응답했어요.`,
      502,
    )
  }

  return response.text()
}

export async function searchRecentListings(
  rawQuery: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const query = rawQuery.trim()
  if (!query) {
    throw new SearchError('검색어를 입력하세요.', 400)
  }
  if (query.length > QUERY_MAX) {
    throw new SearchError('검색어가 너무 길어요. 200자 이하로 줄여 주세요.', 400)
  }

  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 60 * 60
  const items: Listing[] = []
  let pagesFetched = 0
  let stoppedReason: SearchResponse['stoppedReason'] = 'no-more'

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) {
      await sleep(PAGE_DELAY_MS, signal)
    }

    const html = await fetchSearchPage(query, page, signal)
    pagesFetched += 1
    const pageItems = parseSearchPage(html)

    if (pageItems.length === 0) {
      stoppedReason = 'no-more'
      break
    }

    let reachedWindow = false
    for (const item of pageItems) {
      if (item.timestamp >= cutoff) {
        items.push(item)
      } else {
        reachedWindow = true
      }
    }

    if (reachedWindow) {
      stoppedReason = 'window'
      break
    }

    if (pageItems.length < PAGE_SIZE) {
      stoppedReason = 'no-more'
      break
    }

    if (page === MAX_PAGES) {
      stoppedReason = 'page-limit'
    }
  }

  return {
    query,
    windowDays: WINDOW_DAYS,
    pagesFetched,
    itemCount: items.length,
    items,
    stoppedReason,
  }
}
