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
import { Input } from '@/components/ui/input'
import { categoryLabel } from '@/lib/categories'
import { searchListings, type SearchResponse } from '@/lib/search'
import { translateTexts } from '@/lib/translate'
import { cn } from '@/lib/utils'

const TRANSLATE_CHUNK = 20

function readQueryParam() {
  const q = new URLSearchParams(window.location.search).get('q')
  return q?.trim() ?? ''
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
    return '공개 검색 페이지 한도에 닿아 여기서 멈췄어요. 검색어를 더 구체적으로 줄이면 최근 한 달을 빠짐없이 보기 쉬워요.'
  }
  if (result.stoppedReason === 'window') {
    return '약 30일보다 오래된 항목이 나와 여기서 멈췄어요.'
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
  const abortRef = useRef<AbortController | null>(null)
  const translateAbortRef = useRef<AbortController | null>(null)

  const hasItems = (result?.items.length ?? 0) > 0
  const summary = useMemo(() => {
    if (!result) {
      return null
    }
    return `${result.windowDays}일 · ${result.itemCount}건 · ${result.pagesFetched}페이지`
  }, [result])

  async function runSearch(raw: string) {
    const query = raw.trim()
    if (!query) {
      setError('검색어를 입력하세요.')
      setStatus('error')
      setResult(null)
      setTranslated({})
      return
    }

    abortRef.current?.abort()
    translateAbortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const next = new URL(window.location.href)
    next.searchParams.set('q', query)
    window.history.replaceState({}, '', `${next.pathname}?q=${encodeURIComponent(query)}`)

    setStatus('loading')
    setError(null)
    setTranslated({})
    setTranslating(false)

    try {
      const payload = await searchListings(query, controller.signal)
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
              사이트 검색창에 넣는 것과 같은 검색어를 입력하세요. 공개 검색으로 최근 약
              30일 결과를 모으고, 제목은 한국어로 옮겨 보여 줍니다.
            </p>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row"
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
              className="h-12 text-base"
              autoComplete="off"
              autoFocus
              disabled={status === 'loading'}
            />
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
              최신 페이지부터 순서대로 확인하고, 약 30일보다 오래된 항목이 나오면
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

        {status !== 'loading' && result && !hasItems ? (
          <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center">
            <p className="font-medium">최근 30일 안에 맞는 결과가 없어요</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              “{result.query}”에 해당하는 최신 글이 없거나, 모두 한 달보다 오래됐어요.
              다른 검색어를 시도해 보세요.
            </p>
          </div>
        ) : null}

        {status !== 'loading' && result && hasItems ? (
          <section className="space-y-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="font-heading text-lg">
                  “{result.query}” 최근 {result.windowDays}일
                </h2>
                <p className="text-sm text-muted-foreground">{summary}</p>
              </div>
              <p className="text-xs text-muted-foreground md:max-w-sm md:text-right">
                {translating
                  ? '제목을 한국어로 옮기는 중… 실패하면 원문을 그대로 둡니다.'
                  : stoppedCopy(result)}
              </p>
            </div>

            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {result.items.map((item) => {
                const titleKo = translated[item.title] ?? item.title
                const showOriginal = titleKo !== item.title
                const categoryKo =
                  translated[item.category] ?? categoryLabel(item.category)
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 p-4 md:flex-row md:items-start"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <a
                        href={item.viewUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={item.title}
                        className={cn(
                          'font-medium leading-snug hover:underline',
                          item.trusted
                            ? 'text-sukebei-trusted'
                            : 'text-foreground',
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
                    <div className="flex shrink-0 gap-2">
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
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
