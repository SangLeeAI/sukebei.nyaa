import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { queryKey, type LastDownloadRecord } from '@/lib/last-download'

function queryKoOf(
  queryKoMap: Record<string, string>,
  raw: string,
) {
  const query = queryKey(raw)
  const translated = query ? queryKoMap[query] : undefined
  return translated && translated !== query ? translated : null
}

export type SavedQuerySortMode = 'date' | 'order'

export function SavedQueriesDialog({
  open,
  items,
  queryKoMap,
  loading,
  error,
  deletingQuery,
  updatingOrderQuery,
  onClose,
  onPick,
  onDelete,
  onUpdateOrder,
  onToggleWorking,
}: {
  open: boolean
  items: LastDownloadRecord[]
  queryKoMap: Record<string, string>
  loading: boolean
  error: string | null
  deletingQuery: string | null
  updatingOrderQuery: string | null
  onClose: () => void
  onPick: (record: LastDownloadRecord) => void
  onDelete: (record: LastDownloadRecord) => void
  onUpdateOrder: (record: LastDownloadRecord, sortOrder: number) => void
  onToggleWorking: (record: LastDownloadRecord) => void
}) {
  const [sortMode, setSortMode] = useState<SavedQuerySortMode>('date')

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const sortedItems = useMemo(() => {
    const copy = [...items]
    if (sortMode === 'order') {
      copy.sort(
        (a, b) => a.sortOrder - b.sortOrder || b.timestamp - a.timestamp,
      )
    } else {
      copy.sort((a, b) => b.timestamp - a.timestamp)
    }
    return copy
  }, [items, sortMode])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      data-testid="saved-queries-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-queries-title"
        data-testid="saved-queries-dialog"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2 border-b p-4">
          <h2 id="saved-queries-title" className="font-heading text-lg">
            저장된 검색어
          </h2>
          <p className="text-sm text-muted-foreground">
            토렌트를 받았던 검색어와 마지막 글입니다. 제목을 고르면 검색창과
            시작일에 넣습니다. 삭제는 오른쪽 버튼으로만 합니다.
          </p>
          <div className="flex items-center gap-2 text-sm">
            <label
              htmlFor="saved-query-sort"
              className="shrink-0 font-medium text-muted-foreground"
            >
              정렬
            </label>
            <select
              id="saved-query-sort"
              data-testid="saved-query-sort"
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as SavedQuerySortMode)
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="date">날짜별 (최근순)</option>
              <option value="order">오더번호별</option>
            </select>
            {sortMode === 'order' ? (
              <span className="text-xs text-muted-foreground">
                오더 번호가 작은 순서로 나열합니다.
              </span>
            ) : null}
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            className="border-b px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <ul className="min-h-0 flex-1 overflow-y-auto divide-y">
          {loading ? (
            <li className="p-4 text-sm text-muted-foreground">불러오는 중…</li>
          ) : sortedItems.length === 0 ? (
            <li
              data-testid="saved-queries-empty"
              className="p-4 text-sm text-muted-foreground"
            >
              저장된 검색어가 없어요. 토렌트를 받으면 검색어가 여기에 남습니다.
            </li>
          ) : (
            sortedItems.map((item) => (
              <SavedQueryRow
                key={`${item.query}:${item.sortOrder}:${item.working}`}
                item={item}
                queryKo={queryKoOf(queryKoMap, item.query)}
                deleting={deletingQuery === item.query}
                updatingOrder={updatingOrderQuery === item.query}
                onPick={onPick}
                onDelete={onDelete}
                onUpdateOrder={onUpdateOrder}
                onToggleWorking={onToggleWorking}
              />
            ))
          )}
        </ul>
        <div className="flex justify-end border-t p-4">
          <Button
            type="button"
            variant="outline"
            data-testid="saved-queries-close"
            onClick={onClose}
          >
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}

function SavedQueryRow({
  item,
  queryKo,
  deleting,
  updatingOrder,
  onPick,
  onDelete,
  onUpdateOrder,
  onToggleWorking,
}: {
  item: LastDownloadRecord
  queryKo: string | null
  deleting: boolean
  updatingOrder: boolean
  onPick: (record: LastDownloadRecord) => void
  onDelete: (record: LastDownloadRecord) => void
  onUpdateOrder: (record: LastDownloadRecord, sortOrder: number) => void
  onToggleWorking: (record: LastDownloadRecord) => void
}) {
  const [orderDraft, setOrderDraft] = useState(String(item.sortOrder))

  function commitOrder() {
    const next = Number.parseInt(orderDraft, 10)
    if (Number.isFinite(next) && next !== item.sortOrder) {
      onUpdateOrder(item, next)
      return
    }
    setOrderDraft(String(item.sortOrder))
  }

  return (
    <li className="flex items-stretch">
      <div className="flex shrink-0 items-center pl-3">
        <Checkbox
          data-testid={`saved-query-working-${item.query}`}
          checked={item.working}
          disabled={updatingOrder || deleting}
          onCheckedChange={() => onToggleWorking(item)}
          aria-label={`${item.query} 작업중 표시`}
        />
      </div>
      <button
        type="button"
        data-testid={`saved-query-${item.query}`}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 p-4 text-left hover:bg-muted/60"
        onClick={() => onPick(item)}
      >
        <p className="font-medium">
          {item.query}
          {item.working ? (
            <span
              data-testid={`saved-query-working-badge-${item.query}`}
              className="ml-1.5 align-middle text-xs font-semibold text-primary"
            >
              ● 작업중
            </span>
          ) : null}
          {queryKo ? (
            <span
              data-testid={`saved-query-ko-${item.query}`}
              className="ml-1.5 align-middle text-xs font-normal text-muted-foreground"
            >
              ({queryKo})
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          마지막 날짜 {item.date}
        </p>
        {item.note ? (
          <p
            data-testid={`saved-query-note-${item.query}`}
            className="break-all text-xs italic text-muted-foreground"
          >
            비고: {item.note}
          </p>
        ) : null}
        <p className="leading-snug">{item.titleKo}</p>
        {item.titleKo !== item.title ? (
          <p className="break-all text-xs text-muted-foreground">
            {item.title}
          </p>
        ) : null}
      </button>
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-l px-3">
        <label
          htmlFor={`saved-query-order-${item.query}`}
          className="text-[10px] font-medium leading-none text-muted-foreground"
        >
          오더
        </label>
        <Input
          id={`saved-query-order-${item.query}`}
          type="number"
          inputMode="numeric"
          step={1}
          value={orderDraft}
          data-testid={`saved-query-order-${item.query}`}
          aria-label={`${item.query} 오더 번호`}
          title="정렬에 쓰는 오더 번호. 바꾸고 엔터나 바깥 클릭으로 저장합니다."
          disabled={updatingOrder}
          onChange={(event) => setOrderDraft(event.target.value)}
          onBlur={commitOrder}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          className="h-8 w-16 text-center"
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          data-testid={`saved-query-delete-${item.query}`}
          disabled={deleting}
          aria-label={`${item.query} 검색어 삭제`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const ok = window.confirm(
              `“${item.query}” 검색어를 삭제할까요?\n마지막 받은 글 기록도 함께 지워집니다.`,
            )
            if (!ok) {
              return
            }
            onDelete(item)
          }}
        >
          {deleting ? '지우는 중…' : '삭제'}
        </Button>
      </div>
    </li>
  )
}
