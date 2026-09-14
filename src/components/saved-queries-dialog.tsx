import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { LastDownloadRecord } from '@/lib/last-download'

export function SavedQueriesDialog({
  open,
  items,
  loading,
  error,
  deletingQuery,
  onClose,
  onPick,
  onDelete,
}: {
  open: boolean
  items: LastDownloadRecord[]
  loading: boolean
  error: string | null
  deletingQuery: string | null
  onClose: () => void
  onPick: (record: LastDownloadRecord) => void
  onDelete: (record: LastDownloadRecord) => void
}) {
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
        <div className="border-b p-4">
          <h2 id="saved-queries-title" className="font-heading text-lg">
            저장된 검색어
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            토렌트를 받았던 검색어와 마지막 글입니다. 제목을 고르면 검색창과
            시작일에 넣습니다. 삭제는 오른쪽 버튼으로만 합니다.
          </p>
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
          ) : items.length === 0 ? (
            <li
              data-testid="saved-queries-empty"
              className="p-4 text-sm text-muted-foreground"
            >
              저장된 검색어가 없어요. 토렌트를 받으면 검색어가 여기에 남습니다.
            </li>
          ) : (
            items.map((item) => (
              <li key={item.query} className="flex items-stretch">
                <button
                  type="button"
                  data-testid={`saved-query-${item.query}`}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 p-4 text-left hover:bg-muted/60"
                  onClick={() => onPick(item)}
                >
                  <p className="font-medium">{item.query}</p>
                  <p className="text-xs text-muted-foreground">
                    마지막 날짜 {item.date}
                  </p>
                  <p className="leading-snug">{item.titleKo}</p>
                  {item.titleKo !== item.title ? (
                    <p className="break-all text-xs text-muted-foreground">
                      {item.title}
                    </p>
                  ) : null}
                </button>
                <div className="flex shrink-0 items-center border-l px-3">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    data-testid={`saved-query-delete-${item.query}`}
                    disabled={deletingQuery === item.query}
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
                    {deletingQuery === item.query ? '지우는 중…' : '삭제'}
                  </Button>
                </div>
              </li>
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
