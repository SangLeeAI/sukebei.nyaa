import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  LoaderCircle,
  Magnet,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { categoryLabel } from '@/lib/categories'
import { searchListings, type Listing, type SearchResponse } from '@/lib/search'
import {
  resolveSince,
  todayYmd,
} from '@/lib/since'
import { downloadSelectedTorrents } from '@/lib/torrents'
import { translateTexts } from '@/lib/translate'
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
  const abortRef = useRef<AbortController | null>(null)
  const translateAbortRef = useRef<AbortController | null>(null)
  const downloadAbortRef = useRef<AbortController | null>(null)
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
        : `토렌트 파일을 하나씩 받는 중… 0/${items.length}`,
    )

    try {
      const outcome = await downloadSelectedTorrents(items, {
        signal: controller.signal,
        onProgress: (done, total) => {
          setDownloadNote(`토렌트 파일을 하나씩 받는 중… ${done}/${total}`)
        },
      })
      if (controller.signal.aborted) {
        return
      }
      if (outcome.skipped > 0) {
        setDownloadNote(
          `${outcome.saved}개 토렌트를 저장했어요. ${outcome.skipped}개는 파일이 없어 건너뛰었어요.`,
        )
      } else {
        setDownloadNote(
          outcome.saved === 1
            ? '토렌트 파일 1개를 저장했어요.'
            : `토렌트 파일 ${outcome.saved}개를 각각 저장했어요.`,
        )
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
              “{result.query}”에 해당하는 글이 {result.since}부터 오늘 사이에 없거나,
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
                  '기본은 선택 안 됨. 체크한 글만 .torrent 파일로 하나씩 받습니다.'}
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
