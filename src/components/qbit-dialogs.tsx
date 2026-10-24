import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { PendingTorrent } from '@/lib/pending'

function queryKoOf(queryKoMap: Record<string, string>, raw: string) {
  const query = raw.trim().normalize('NFC')
  const translated = query ? queryKoMap[query] : undefined
  return translated && translated !== query ? translated : null
}

export function QbitPromptDialog({
  open,
  count,
  busy,
  error,
  onAdd,
  onLater,
}: {
  open: boolean
  count: number
  busy: boolean
  error: string | null
  onAdd: () => void
  onLater: () => void
}) {
  if (!open) {
    return null
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qbit-prompt-title"
        data-testid="qbit-prompt"
        className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg"
      >
        <h2 id="qbit-prompt-title" className="font-heading text-lg">
          qBittorrent에 추가할까요?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          받은 토렌트 {count}개를 이 컴퓨터의 qBittorrent에 넣을까요? 나중에 하면
          미추가 목록에 남겨 둡니다. 파일은 디스크에 그대로 있습니다.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            data-testid="qbit-later"
            onClick={onLater}
            disabled={busy}
          >
            나중에
          </Button>
          <Button
            type="button"
            data-testid="qbit-add-now"
            onClick={onAdd}
            disabled={busy}
          >
            추가
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PendingQbitDialog({
  open,
  items,
  queryKoMap,
  selected,
  busy,
  error,
  onClose,
  onToggle,
  onSelectAll,
  onClear,
  onAdd,
  onDelete,
}: {
  open: boolean
  items: PendingTorrent[]
  queryKoMap: Record<string, string>
  selected: Set<number>
  busy: boolean
  error: string | null
  onClose: () => void
  onToggle: (id: number, checked: boolean) => void
  onSelectAll: () => void
  onClear: () => void
  onAdd: () => void
  onDelete: () => void
}) {
  if (!open) {
    return null
  }
  const selectedCount = selected.size
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-title"
        data-testid="pending-dialog"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-card shadow-lg"
      >
        <div className="border-b p-4">
          <h2 id="pending-title" className="font-heading text-lg">
            미추가 파일
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            qBittorrent에 아직 넣지 않은 토렌트입니다. 고른 뒤 추가하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 border-b px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            disabled={items.length === 0 || selectedCount === items.length || busy}
          >
            전체 선택
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={selectedCount === 0 || busy}
          >
            선택 해제
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="pending-delete"
            onClick={onDelete}
            disabled={selectedCount === 0 || busy}
          >
            선택 지움
            {selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto divide-y">
          {items.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">
              미추가 파일이 없어요.
            </li>
          ) : (
            items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-4">
                <Checkbox
                  data-testid={`pending-checkbox-${item.id}`}
                  checked={selected.has(item.id)}
                  onCheckedChange={(value) => onToggle(item.id, value === true)}
                  aria-label={`${item.titleKo} 선택`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{item.titleKo}</p>
                  {item.titleKo !== item.title ? (
                    <p className="break-all text-xs text-muted-foreground">
                      {item.title}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.query}
                    {queryKoOf(queryKoMap, item.query) ? (
                      <span
                        data-testid={`pending-query-ko-${item.id}`}
                        className="ml-1.5"
                      >
                        ({queryKoOf(queryKoMap, item.query)})
                      </span>
                    ) : null}{' '}
                    · {item.date}
                  </p>
                </div>
              </li>
            ))
          )}
        </ul>
        {error ? (
          <p role="alert" className="px-4 pb-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            닫기
          </Button>
          <Button
            type="button"
            data-testid="pending-add"
            onClick={onAdd}
            disabled={selectedCount === 0 || busy}
          >
            qBittorrent에 추가
            {selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
