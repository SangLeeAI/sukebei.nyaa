import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CalendarPlus,
  Download,
  ListTodo,
  LoaderCircle,
  Magnet,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PendingQbitDialog, QbitPromptDialog } from '@/components/qbit-dialogs'
import { SavedQueriesDialog } from '@/components/saved-queries-dialog'
import { categoryLabel } from '@/lib/categories'
import {
  deleteLastDownload,
  fetchLastDownload,
  fetchLastDownloads,
  queryKey,
  saveLastDownload,
  updateLastDownloadNote,
  updateLastDownloadSortOrder,
  updateLastDownloadWorking,
  type LastDownloadRecord,
} from '@/lib/last-download'
import {
  addPendingToQbittorrent,
  deletePendingTorrents,
  fetchPendingTorrents,
  savePendingTorrents,
  stashDownloadedTorrents,
  type PendingTorrent,
} from '@/lib/pending'
import { searchListings, type Listing, type SearchResponse } from '@/lib/search'
import {
  formatYmd,
  resolveSince,
  todayYmd,
} from '@/lib/since'
import { downloadSelectedTorrents } from '@/lib/torrents'
import { isMostlyKorean, translateTexts } from '@/lib/translate'
import { cn } from '@/lib/utils'

const TRANSLATE_CHUNK = 20
const DEFAULT_MIN_SEEDERS = 3

function readQueryParam() {
  const q = new URLSearchParams(window.location.search).get('q')
  return q?.trim() ?? ''
}

function readSinceParam() {
  return resolveSince(new URLSearchParams(window.location.search).get('since'))
}

function parseMinSeeders(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return DEFAULT_MIN_SEEDERS
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MIN_SEEDERS
  }
  return parsed
}

function normalizeSeedDraft(raw: string) {
  return String(parseMinSeeders(raw))
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function newestListing(items: Listing[]) {
  return items.reduce((best, item) =>
    item.timestamp > best.timestamp ? item : best,
  )
}

function listingDateYmd(item: Listing) {
  return formatYmd(new Date(item.timestamp * 1000))
}

function stoppedCopy(result: SearchResponse) {
  if (result.stoppedReason === 'page-limit') {
    return '공개 검색 페이지 한도에 닿아 여기서 멈췄어요. 검색어를 더 구체적으로 줄이면 빠짐없이 보기 쉬워요.'
  }
  if (result.stoppedReason === 'window') {
    return `${result.since}보다 오래된 항목이 나와 여기서 멈췄어요.`
  }
  return '더 이상 다음 페이지가 없어요.'
}

export default function App() {
  const [draft, setDraft] = useState(readQueryParam)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [translated, setTranslated] = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState(false)
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_MIN_SEEDERS))
  const [sinceDraft, setSinceDraft] = useState(readSinceParam)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [downloading, setDownloading] = useState(false)
  const [downloadNote, setDownloadNote] = useState<string | null>(null)
  const [lastDownload, setLastDownload] = useState<LastDownloadRecord | null>(
    null,
  )
  const [pendingItems, setPendingItems] = useState<PendingTorrent[]>([])
  const [pendingOpen, setPendingOpen] = useState(false)
  const [pendingSelected, setPendingSelected] = useState<Set<number>>(
    () => new Set(),
  )
  const [qbitPromptOpen, setQbitPromptOpen] = useState(false)
  const [promptIds, setPromptIds] = useState<number[]>([])
  const [qbitBusy, setQbitBusy] = useState(false)
  const [qbitError, setQbitError] = useState<string | null>(null)
  const [savedOpen, setSavedOpen] = useState(false)
  const [savedQueries, setSavedQueries] = useState<LastDownloadRecord[]>([])
  const [savedQueryCount, setSavedQueryCount] = useState(0)
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [deletingQuery, setDeletingQuery] = useState<string | null>(null)
  const [updatingOrderQuery, setUpdatingOrderQuery] = useState<string | null>(
    null,
  )
  const [updatingNoteQuery, setUpdatingNoteQuery] = useState<string | null>(
    null,
  )
  const [noteError, setNoteError] = useState<string | null>(null)
  const [workingBusyQuery, setWorkingBusyQuery] = useState<string | null>(null)
  const [queryKoMap, setQueryKoMap] = useState<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)
  const translateAbortRef = useRef<AbortController | null>(null)
  const downloadAbortRef = useRef<AbortController | null>(null)
  const queryKoRef = useRef<Record<string, string>>({})
  const queryKoInflight = useRef<Set<string>>(new Set())
  const minSeeders = parseMinSeeders(seedDraft)

  const fetchedItems = result?.items ?? []
  const visibleItems = useMemo(
    () => fetchedItems.filter((item) => item.seeders >= minSeeders),
    [fetchedItems, minSeeders],
  )
  const hasFetchedItems = fetchedItems.length > 0
  const hasVisibleItems = visibleItems.length > 0
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selected.has(item.id)),
    [selected, visibleItems],
  )
  const selectedCount = selectedItems.length
  const allVisibleSelected =
    hasVisibleItems && visibleItems.every((item) => selected.has(item.id))
  const summary = useMemo(() => {
    if (!result) {
      return null
    }
    if (visibleItems.length === result.itemCount) {
      return `${result.since}–오늘 · ${visibleItems.length}건 · ${result.pagesFetched}페이지 · 시드 ${minSeeders}↑`
    }
    return `${result.since}–오늘 · ${visibleItems.length}건 표시 · 전체 ${result.itemCount}건 · 시드 ${minSeeders}↑`
  }, [minSeeders, result, visibleItems.length])
  const matchingLastDownload =
    lastDownload && queryKey(lastDownload.query) === queryKey(draft)
      ? lastDownload
      : null

  const ensureQueryKo = useCallback((raw: string) => {
    const query = queryKey(raw)
    if (!query || isMostlyKorean(query)) {
      return
    }
    if (queryKoRef.current[query] || queryKoInflight.current.has(query)) {
      return
    }
    const controller = new AbortController()
    queryKoInflight.current.add(query)
    void translateTexts([query], controller.signal)
      .then((next) => {
        const translated = next[0]?.trim() ?? ''
        if (
          controller.signal.aborted ||
          !translated ||
          translated === query
        ) {
          return
        }
        if (queryKoRef.current[query] === translated) {
          return
        }
        queryKoRef.current[query] = translated
        setQueryKoMap({ ...queryKoRef.current })
      })
      .catch(() => {})
      .finally(() => {
        queryKoInflight.current.delete(query)
      })
  }, [])

  function queryKoOf(raw: string) {
    const query = queryKey(raw)
    const translated = query ? queryKoMap[query] : undefined
    return translated && translated !== query ? translated : null
  }

  useEffect(() => {
    const query = queryKey(draft)
    if (!query || isMostlyKorean(query)) {
      return
    }
    if (queryKoMap[query] || queryKoInflight.current.has(query)) {
      return
    }
    const timer = window.setTimeout(() => ensureQueryKo(draft), 300)
    return () => window.clearTimeout(timer)
  }, [draft, queryKoMap, ensureQueryKo])

  useEffect(() => {
    if (!result) {
      return
    }
    ensureQueryKo(result.query)
  }, [result, ensureQueryKo])

  useEffect(() => {
    for (const item of savedQueries) {
      ensureQueryKo(item.query)
    }
  }, [savedQueries, ensureQueryKo])

  useEffect(() => {
    for (const item of pendingItems) {
      ensureQueryKo(item.query)
    }
  }, [pendingItems, ensureQueryKo])

  function clearSelection() {
    setSelected(new Set())
  }

  function selectAllVisible() {
    setSelected(new Set(visibleItems.map((item) => item.id)))
    setDownloadNote(null)
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
    setDownloadNote(null)
  }

  async function downloadChecked() {
    if (selectedCount === 0 || downloading) {
      return
    }

    const items = selectedItems
    if (items.length === 0) {
      return
    }

    downloadAbortRef.current?.abort()
    const controller = new AbortController()
    downloadAbortRef.current = controller
    setDownloading(true)
    setDownloadNote(
      items.length === 1
        ? '토렌트 파일을 받는 중…'
        : '저장할 폴더를 고르면 토렌트 파일을 각각 넣습니다…',
    )

    try {
      const outcome = await downloadSelectedTorrents(items, {
        signal: controller.signal,
        onProgress: (done, total) => {
          setDownloadNote(`선택한 폴더에 저장하는 중… ${done}/${total}`)
        },
      })
      if (controller.signal.aborted) {
        return
      }
      if (outcome.cancelled) {
        setDownloadNote('저장을 취소했어요.')
        return
      }
      if (outcome.skipped > 0) {
        setDownloadNote(
          `${outcome.saved}개 토렌트를 저장했어요. ${outcome.skipped}개는 파일이 없어 건너뛰었어요.${
            outcome.directory ? ` (${outcome.directory})` : ''
          }`,
        )
      } else if (outcome.method === 'downloads' && outcome.directory) {
        setDownloadNote(
          `토렌트 파일 ${outcome.saved}개를 ${outcome.directory}에 저장했어요.`,
        )
      } else if (outcome.method === 'folder') {
        setDownloadNote(
          `토렌트 파일 ${outcome.saved}개를 선택한 폴더에 저장했어요.`,
        )
      } else {
        setDownloadNote(
          outcome.saved === 1
            ? '토렌트 파일 1개를 저장했어요.'
            : `토렌트 파일 ${outcome.saved}개를 저장했어요.`,
        )
      }

      const savedItems = outcome.savedItems ?? []
      const query = result?.query ?? draft.trim()
      if (savedItems.length > 0 && query) {
        const newest = newestListing(savedItems)
        try {
          const recorded = await saveLastDownload({
            query,
            title: newest.title,
            titleKo: translated[newest.title] ?? newest.title,
            date: listingDateYmd(newest),
            iso: newest.date,
            id: newest.id,
            timestamp: newest.timestamp,
          })
          if (recorded) {
            setLastDownload(recorded)
            try {
              const rows = await fetchLastDownloads()
              setSavedQueries(rows)
              setSavedQueryCount(rows.length)
            } catch {}
          }
        } catch (recordError) {
          console.warn('last download record failed', recordError)
        }
      }

      if (savedItems.length > 0 && query) {
        try {
          const stashed = await stashDownloadedTorrents(
            query,
            savedItems.map((item) => ({
              itemId: item.id,
              query,
              title: item.title,
              titleKo: translated[item.title] ?? item.title,
              date: listingDateYmd(item),
              iso: item.date,
              timestamp: item.timestamp,
              torrentBase64: outcome.torrentBase64ById?.[item.id],
              filePath: '',
            })),
          )
          const pendingRows = await savePendingTorrents(
            stashed.map((item) => ({
              itemId: item.itemId,
              query: item.query,
              title: item.title,
              titleKo: item.titleKo,
              date: item.date,
              iso: item.iso,
              timestamp: item.timestamp,
              filePath: item.filePath,
            })),
          )
          setPendingItems(pendingRows)
          const justIds = pendingRows
            .filter((row) =>
              savedItems.some((item) => item.id === row.itemId),
            )
            .map((row) => row.id)
          setPromptIds(justIds)
          setQbitError(null)
          setQbitPromptOpen(true)
        } catch (stashError) {
          setDownloadNote(
            stashError instanceof Error
              ? `${stashError.message} 파일은 저장됐지만 qBittorrent 목록에 넣지 못했어요.`
              : '파일은 저장됐지만 qBittorrent 목록에 넣지 못했어요.',
          )
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        return
      }
      setDownloadNote(
        cause instanceof Error
          ? cause.message
          : '토렌트 파일을 받지 못했어요.',
      )
    } finally {
      if (!controller.signal.aborted) {
        setDownloading(false)
      }
    }
  }

  async function addIdsToQbittorrent(ids: number[]) {
    if (ids.length === 0 || qbitBusy) {
      return false
    }
    setQbitBusy(true)
    setQbitError(null)
    try {
      const result = await addPendingToQbittorrent(ids)
      setPendingItems(result.items)
      setPendingSelected((current) => {
        const remaining = new Set(result.items.map((item) => item.id))
        return new Set([...current].filter((id) => remaining.has(id)))
      })
      setDownloadNote(`qBittorrent에 토렌트 ${result.added}개를 추가했어요.`)
      return true
    } catch (cause) {
      setQbitError(
        cause instanceof Error
          ? cause.message
          : 'qBittorrent에 넣지 못했어요.',
      )
      return false
    } finally {
      setQbitBusy(false)
    }
  }

  async function deletePendingSelection() {
    const ids = [...pendingSelected]
    if (ids.length === 0 || qbitBusy) {
      return
    }
    const ok = window.confirm(
      `고른 토렌트 ${ids.length}개를 미추가 목록에서 지울까요?\n보관 폴더의 토렌트 파일도 함께 지워집니다.`,
    )
    if (!ok) {
      return
    }
    setQbitBusy(true)
    setQbitError(null)
    try {
      const result = await deletePendingTorrents(ids)
      setPendingItems(result.items)
      setPendingSelected(new Set())
      setDownloadNote(
        `미추가 목록에서 토렌트 ${result.removed}개를 지웠어요.`,
      )
    } catch (cause) {
      setQbitError(
        cause instanceof Error
          ? cause.message
          : '미추가 목록을 지우지 못했어요.',
      )
    } finally {
      setQbitBusy(false)
    }
  }

  function applyLastDownloadSince() {
    if (!lastDownload) {
      return
    }
    const date = resolveSince(lastDownload.date)
    setSinceDraft(date)
    if (draft.trim()) {
      void runSearch(draft, date)
    }
  }

  async function openSavedQueries() {
    setSavedOpen(true)
    setSavedLoading(true)
    setSavedError(null)
    try {
      const rows = await fetchLastDownloads()
      setSavedQueries(rows)
      setSavedQueryCount(rows.length)
    } catch (cause) {
      setSavedError(
        cause instanceof Error
          ? cause.message
          : '저장된 검색어를 읽지 못했어요.',
      )
    } finally {
      setSavedLoading(false)
    }
  }

  function applySavedQuery(record: LastDownloadRecord) {
    const date = resolveSince(record.date)
    setDraft(record.query)
    setSinceDraft(date)
    setLastDownload(record)
    setSavedOpen(false)
    void runSearch(record.query, date)
  }

  async function handleDeleteSavedQuery(record: LastDownloadRecord) {
    setDeletingQuery(record.query)
    setSavedError(null)
    try {
      await deleteLastDownload(record.query)
      const rows = await fetchLastDownloads()
      setSavedQueries(rows)
      setSavedQueryCount(rows.length)
      setLastDownload((prev) =>
        prev && queryKey(prev.query) === queryKey(record.query) ? null : prev,
      )
    } catch (cause) {
      setSavedError(
        cause instanceof Error
          ? cause.message
          : '저장된 검색어를 지우지 못했어요.',
      )
    } finally {
      setDeletingQuery(null)
    }
  }

  async function handleUpdateOrder(
    record: LastDownloadRecord,
    sortOrder: number,
  ) {
    setUpdatingOrderQuery(record.query)
    setSavedError(null)
    try {
      const updated = await updateLastDownloadSortOrder(
        record.query,
        sortOrder,
      )
      const rows = await fetchLastDownloads()
      setSavedQueries(rows)
      if (
        updated &&
        lastDownload &&
        queryKey(lastDownload.query) === queryKey(record.query)
      ) {
        setLastDownload(updated)
      }
    } catch (cause) {
      setSavedError(
        cause instanceof Error
          ? cause.message
          : '오더 번호를 저장하지 못했어요.',
      )
    } finally {
      setUpdatingOrderQuery(null)
    }
  }

  async function handleUpdateNote(record: LastDownloadRecord, note: string) {
    setUpdatingNoteQuery(record.query)
    setNoteError(null)
    try {
      const updated = await updateLastDownloadNote(record.query, note)
      const rows = await fetchLastDownloads()
      setSavedQueries(rows)
      if (
        updated &&
        lastDownload &&
        queryKey(lastDownload.query) === queryKey(record.query)
      ) {
        setLastDownload(updated)
      }
    } catch (cause) {
      setNoteError(
        cause instanceof Error
          ? cause.message
          : '비고를 저장하지 못했어요.',
      )
    } finally {
      setUpdatingNoteQuery(null)
    }
  }

  async function handleToggleWorking(record: LastDownloadRecord) {
    setWorkingBusyQuery(record.query)
    setNoteError(null)
    try {
      const updated = await updateLastDownloadWorking(
        record.query,
        !record.working,
      )
      const rows = await fetchLastDownloads()
      setSavedQueries(rows)
      if (
        updated &&
        lastDownload &&
        queryKey(lastDownload.query) === queryKey(record.query)
      ) {
        setLastDownload(updated)
      }
    } catch (cause) {
      setNoteError(
        cause instanceof Error
          ? cause.message
          : '작업중 표시를 바꾸지 못했어요.',
      )
    } finally {
      setWorkingBusyQuery(null)
    }
  }

  async function runSearch(raw: string, sinceValue = resolveSince(sinceDraft)) {
    const query = raw.trim()
    if (!query) {
      setError('검색어를 입력하세요.')
      setStatus('error')
      setResult(null)
      setTranslated({})
      clearSelection()
      return
    }

    abortRef.current?.abort()
    translateAbortRef.current?.abort()
    downloadAbortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const next = new URL(window.location.href)
    next.searchParams.set('q', query)
    next.searchParams.set('since', sinceValue)
    window.history.replaceState(
      {},
      '',
      `${next.pathname}?${next.searchParams.toString()}`,
    )

    setStatus('loading')
    setError(null)
    setTranslated({})
    setTranslating(false)
    clearSelection()
    setDownloadNote(null)
    setDownloading(false)

    try {
      const payload = await searchListings(query, sinceValue, controller.signal)
      setResult(payload)
      setStatus('idle')
    } catch (cause) {
      if (controller.signal.aborted) {
        return
      }
      setResult(null)
      setStatus('error')
      setError(
        cause instanceof Error
          ? cause.message
          : '목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
    }
  }

  useEffect(() => {
    const initial = readQueryParam()
    if (initial) {
      void runSearch(initial)
    }
    return () => {
      abortRef.current?.abort()
      translateAbortRef.current?.abort()
      downloadAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    void fetchPendingTorrents()
      .then(({ items }) => setPendingItems(items))
      .catch(() => {
        setPendingItems([])
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchLastDownloads(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) {
          return
        }
        setSavedQueries(rows)
        setSavedQueryCount(rows.length)
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const q = queryKey(draft)
    if (!q) {
      setLastDownload(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchLastDownload(q, controller.signal)
        .then((record) => {
          if (controller.signal.aborted) {
            return
          }
          setLastDownload((current) => {
            if (record) {
              return record
            }
            if (current && queryKey(current.query) === q) {
              return current
            }
            return null
          })
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return
          }
          setLastDownload((current) =>
            current && queryKey(current.query) === q ? current : null,
          )
        })
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [draft])

  useEffect(() => {
    if (!result?.items.length) {
      setTranslating(false)
      return
    }

    const unique = [...new Set(result.items.map((item) => item.title))]
    const categories = [
      ...new Set(
        result.items
          .map((item) => item.category)
          .filter((category) => categoryLabel(category) === category),
      ),
    ]
    const pending = [...unique, ...categories]
    if (pending.length === 0) {
      return
    }

    const controller = new AbortController()
    translateAbortRef.current?.abort()
    translateAbortRef.current = controller
    setTranslating(true)

    void (async () => {
      try {
        for (let offset = 0; offset < pending.length; offset += TRANSLATE_CHUNK) {
          if (controller.signal.aborted) {
            return
          }
          const slice = pending.slice(offset, offset + TRANSLATE_CHUNK)
          const next = await translateTexts(slice, controller.signal)
          setTranslated((current) => {
            const merged = { ...current }
            slice.forEach((original, index) => {
              merged[original] = next[index] ?? original
            })
            return merged
          })
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          return
        }
        console.warn('translation fallback to original', cause)
      } finally {
        if (!controller.signal.aborted) {
          setTranslating(false)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [result])

  return (
    <div className="min-h-svh bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-primary">Nyaa</p>
              <h1 className="font-heading text-3xl tracking-tight md:text-4xl">
                sukebei 검색
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
                사이트 검색창에 넣는 것과 같은 검색어를 입력하세요. 시작일부터 오늘까지
                공개 검색으로 모으고, 제목은 한국어로 옮겨 보여 줍니다.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <Button
                type="button"
                variant="outline"
                data-testid="open-saved-queries"
                data-saved-query-count={savedQueryCount}
                onClick={() => void openSavedQueries()}
              >
                <Bookmark data-icon="inline-start" />
                저장된 검색어 ({savedQueryCount})
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="open-pending"
                onClick={() => {
                  setQbitError(null)
                  setPendingOpen(true)
                }}
              >
                <ListTodo data-icon="inline-start" />
                미추가 파일 다운로드
                {pendingItems.length > 0 ? ` (${pendingItems.length})` : ''}
              </Button>
            </div>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-stretch"
            onSubmit={(event) => {
              event.preventDefault()
              void runSearch(draft)
            }}
          >
            <label className="sr-only" htmlFor="nyaa-query">
              검색어
            </label>
            <Input
              id="nyaa-query"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="sukebei.nyaa.si와 같은 검색어"
              className="h-12 min-w-0 flex-1 text-base"
              autoComplete="off"
              autoFocus
              disabled={status === 'loading'}
            />
            <div className="flex h-12 shrink-0 items-center gap-2 rounded-lg border border-input px-3 sm:w-auto">
              <label
                htmlFor="since-date"
                className="shrink-0 text-sm font-medium text-muted-foreground"
              >
                시작일
              </label>
              <Input
                id="since-date"
                type="date"
                max={todayYmd()}
                value={sinceDraft}
                onChange={(event) => {
                  const next = resolveSince(event.target.value)
                  setSinceDraft(next)
                  if (draft.trim()) {
                    void runSearch(draft, next)
                  }
                }}
                aria-label="검색 시작일"
                className="h-11 w-[11.5rem] border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-sm"
                disabled={status === 'loading'}
              />
            </div>
            <div className="flex h-12 shrink-0 items-center gap-2 rounded-lg border border-input px-3 sm:w-32">
              <label
                htmlFor="min-seeders"
                className="shrink-0 text-sm font-medium text-muted-foreground"
              >
                시드
              </label>
              <Input
                id="min-seeders"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={seedDraft}
                onChange={(event) => setSeedDraft(event.target.value)}
                onBlur={() => setSeedDraft(normalizeSeedDraft(seedDraft))}
                aria-label="최소 시드 수"
                className="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-base"
                disabled={status === 'loading'}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-12 px-5 sm:w-auto"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              검색
            </Button>
          </form>

          {queryKoOf(draft) ? (
            <p
              data-testid="query-translation"
              className="text-sm text-muted-foreground"
            >
              <span className="font-medium text-foreground">{draft.trim()}</span>{' '}
              → {queryKoOf(draft)}
            </p>
          ) : null}

          {matchingLastDownload ? (
            <div
              data-testid="last-download-card"
              className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    data-testid="query-working-toggle"
                    checked={matchingLastDownload.working}
                    disabled={workingBusyQuery === matchingLastDownload.query}
                    onCheckedChange={() =>
                      void handleToggleWorking(matchingLastDownload)
                    }
                    aria-label="이 검색어 작업중 표시"
                  />
                  <p
                    className={cn(
                      'text-xs font-medium',
                      matchingLastDownload.working
                        ? 'text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    작업중
                  </p>
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  이 검색에서 마지막으로 받은 글 · {matchingLastDownload.date}
                </p>
                <p
                  className="font-medium leading-snug"
                  title={matchingLastDownload.title}
                  data-testid="last-download-title"
                >
                  {matchingLastDownload.titleKo}
                </p>
                {matchingLastDownload.titleKo !== matchingLastDownload.title ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {matchingLastDownload.title}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {formatDate(matchingLastDownload.iso)} · 시작일로 넣으면 이 날짜부터
                  다시 찾습니다.
                </p>
                <QueryNoteInput
                  key={`${matchingLastDownload.query}:${matchingLastDownload.note}`}
                  record={matchingLastDownload}
                  saving={updatingNoteQuery === matchingLastDownload.query}
                  onSave={(note) =>
                    void handleUpdateNote(matchingLastDownload, note)
                  }
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="apply-since"
                className="shrink-0"
                onClick={applyLastDownloadSince}
                disabled={status === 'loading'}
              >
                <CalendarPlus data-icon="inline-start" />
                이 날짜를 시작일로
              </Button>
            </div>
          ) : null}

          {noteError ? (
            <p
              role="alert"
              data-testid="note-error"
              className="text-sm text-destructive"
            >
              {noteError}
            </p>
          ) : null}
        </header>

        {status === 'error' && error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {status === 'loading' ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-16 text-center">
            <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
            <p className="font-medium">목록을 불러오는 중…</p>
            <p className="max-w-md text-sm text-muted-foreground">
              최신 페이지부터 순서대로 확인하고, 시작일보다 오래된 항목이 나오면
              멈춥니다.
            </p>
          </div>
        ) : null}

        {status !== 'loading' && status !== 'error' && !result ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center">
            <Search className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">검색어를 입력하세요</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              예: 작품명, 제작사, 숫자 코드. 결과는 이 컴퓨터의 개발 서버가
              sukebei.nyaa.si 공개 검색을 대신 요청합니다.
            </p>
          </div>
        ) : null}

        {status !== 'loading' && result && !hasFetchedItems ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center">
            <p className="font-medium">시작일 이후 맞는 결과가 없어요</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              “{result.query}”{queryKoOf(result.query) ? ` (${queryKoOf(result.query)})` : ''}
              에 해당하는 글이 {result.since}부터 오늘 사이에 없거나,
              더 오래됐어요. 시작일을 앞당기거나 다른 검색어를 시도해 보세요.
            </p>
          </div>
        ) : null}

        {status !== 'loading' && result && hasFetchedItems && !hasVisibleItems ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center">
            <p className="font-medium">시드 {minSeeders}개 이상인 항목이 없어요</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              최근 {result.itemCount}건 가운데 시드가 {minSeeders} 이상인 글이
              없습니다. 시드 숫자를 낮춰 보세요.
            </p>
          </div>
        ) : null}

        {status !== 'loading' && result && hasVisibleItems ? (
          <section className="space-y-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="font-heading text-lg">
                  “{result.query}” {result.since} – 오늘
                  {queryKoOf(result.query) ? (
                    <span
                      data-testid="result-query-translation"
                      className="ml-2 align-middle text-sm font-normal text-muted-foreground"
                    >
                      {queryKoOf(result.query)}
                    </span>
                  ) : null}
                </h2>
                <p className="text-sm text-muted-foreground">{summary}</p>
              </div>
              <p className="text-xs text-muted-foreground md:max-w-sm md:text-right">
                {translating
                  ? '제목을 한국어로 옮기는 중… 실패하면 원문을 그대로 둡니다.'
                  : stoppedCopy(result)}
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="select-all"
                onClick={selectAllVisible}
                disabled={!hasVisibleItems || allVisibleSelected || downloading}
              >
                전체 선택
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="deselect-all"
                onClick={() => {
                  clearSelection()
                  setDownloadNote(null)
                }}
                disabled={selectedCount === 0 || downloading}
              >
                선택 해제
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="download-selected"
                onClick={() => void downloadChecked()}
                disabled={selectedCount === 0 || downloading}
              >
                {downloading ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                선택한 토렌트 받기
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </Button>
              <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-md sm:text-right">
                {downloadNote ??
                  '기본은 선택 안 됨. 여러 개를 받으면 폴더를 한 번만 고르고, 그 안에 .torrent을 각각 저장합니다.'}
              </p>
            </div>

            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {visibleItems.map((item) => (
                <ResultRow
                  key={item.id}
                  item={item}
                  titleKo={translated[item.title] ?? item.title}
                  categoryKo={
                    translated[item.category] ?? categoryLabel(item.category)
                  }
                  checked={selected.has(item.id)}
                  onCheckedChange={(checked) => toggleSelected(item.id, checked)}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <QbitPromptDialog
        open={qbitPromptOpen}
        count={promptIds.length}
        busy={qbitBusy}
        error={qbitError}
        onLater={() => {
          setQbitPromptOpen(false)
          setQbitError(null)
          setDownloadNote(
            `토렌트 ${promptIds.length}개를 미추가 목록에 남겨 두었어요.`,
          )
        }}
        onAdd={() => {
          void addIdsToQbittorrent(promptIds).then((ok) => {
            if (ok) {
              setQbitPromptOpen(false)
            }
          })
        }}
      />
      <PendingQbitDialog
        open={pendingOpen}
        items={pendingItems}
        queryKoMap={queryKoMap}
        selected={pendingSelected}
        busy={qbitBusy}
        error={qbitError}
        onClose={() => {
          setPendingOpen(false)
          setQbitError(null)
        }}
        onToggle={(id, checked) => {
          setPendingSelected((current) => {
            const next = new Set(current)
            if (checked) {
              next.add(id)
            } else {
              next.delete(id)
            }
            return next
          })
        }}
        onSelectAll={() =>
          setPendingSelected(new Set(pendingItems.map((item) => item.id)))
        }
        onClear={() => setPendingSelected(new Set())}
        onAdd={() => {
          void addIdsToQbittorrent([...pendingSelected]).then((ok) => {
            if (ok) {
              setPendingSelected(new Set())
            }
          })
        }}
        onDelete={() => void deletePendingSelection()}
      />
      <SavedQueriesDialog
        open={savedOpen}
        items={savedQueries}
        queryKoMap={queryKoMap}
        loading={savedLoading}
        error={savedError}
        deletingQuery={deletingQuery}
        updatingOrderQuery={updatingOrderQuery}
        onClose={() => setSavedOpen(false)}
        onPick={applySavedQuery}
        onDelete={(record) => void handleDeleteSavedQuery(record)}
        onUpdateOrder={(record, sortOrder) =>
          void handleUpdateOrder(record, sortOrder)
        }
        onToggleWorking={(record) => void handleToggleWorking(record)}
      />
    </div>
  )
}

function QueryNoteInput({
  record,
  saving,
  onSave,
}: {
  record: LastDownloadRecord
  saving: boolean
  onSave: (note: string) => void
}) {
  const [noteDraft, setNoteDraft] = useState(record.note)

  function commitNote() {
    const next = noteDraft.trim()
    if (next !== record.note) {
      onSave(next.slice(0, 500))
      return
    }
    setNoteDraft(record.note)
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <label
        htmlFor="query-note"
        className="shrink-0 text-xs font-medium text-muted-foreground"
      >
        비고
      </label>
      <Input
        id="query-note"
        value={noteDraft}
        data-testid="query-note-input"
        placeholder="이 검색어에 대한 메모 (없어도 됨)"
        title="검색어 메모. 바꾸고 엔터나 바깥 클릭으로 저장합니다."
        disabled={saving}
        onChange={(event) => setNoteDraft(event.target.value)}
        onBlur={commitNote}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        className="h-8 flex-1 text-xs"
      />
    </div>
  )
}

function ResultRow({
  item,
  titleKo,
  categoryKo,
  checked,
  onCheckedChange,
}: {
  item: Listing
  titleKo: string
  categoryKo: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const showOriginal = titleKo !== item.title
  return (
    <li className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Checkbox
          data-testid={`row-checkbox-${item.id}`}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={`${titleKo} 선택`}
          className="mt-1"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <a
            href={item.viewUrl}
            target="_blank"
            rel="noreferrer"
            title={item.title}
            className={cn(
              'font-medium leading-snug hover:underline',
              item.trusted ? 'text-sukebei-trusted' : 'text-foreground',
            )}
          >
            {titleKo}
          </a>
          {showOriginal ? (
            <p
              className={cn(
                'break-all text-xs',
                item.trusted
                  ? 'text-sukebei-trusted'
                  : 'text-muted-foreground',
              )}
              title="원문"
            >
              {item.title}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" title={item.category}>
              {categoryKo}
            </Badge>
            <span>{formatDate(item.date)}</span>
            <span>{item.size || '용량 없음'}</span>
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3.5" />
              시드 {item.seeders}
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="size-3.5" />
              리치 {item.leechers}
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-7 md:pl-0">
        {item.magnet ? (
          <Button asChild variant="outline" size="sm">
            <a href={item.magnet} title={item.title}>
              <Magnet data-icon="inline-start" />
              마그넷
            </a>
          </Button>
        ) : null}
        {item.torrent ? (
          <Button asChild variant="outline" size="sm">
            <a href={item.torrent} title={item.title}>
              <Download data-icon="inline-start" />
              토렌트
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  )
}
