import { useEffect, useState } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  fetchProxyConfig,
  saveProxyConfig,
  type ProxyMode,
} from '@/lib/proxy'
import { cn } from '@/lib/utils'

const MODES: { value: ProxyMode; label: string; hint: string }[] = [
  {
    value: 'env',
    label: '환경 변수',
    hint: 'HTTP_PROXY·HTTPS_PROXY·NO_PROXY 환경 변수를 따라갑니다.',
  },
  {
    value: 'url',
    label: '직접 지정',
    hint: '아래 프록시 주소로만 나갑니다.',
  },
  {
    value: 'direct',
    label: '직접 연결',
    hint: '프록시 없이 게이트웨이로 직접 나갑니다.',
  },
]

export function ProxySettingsDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [mode, setMode] = useState<ProxyMode>('env')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSaved(false)
    fetchProxyConfig(controller.signal)
      .then((config) => {
        setMode(config.mode)
        setUrl(config.url)
      })
      .catch((cause) => {
        if (controller.signal.aborted) {
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : '프록시 설정을 읽지 못했어요.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [open])

  if (!open) {
    return null
  }

  const activeMode = MODES.find((entry) => entry.value === mode)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="proxy-settings-title"
        data-testid="proxy-settings"
        className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg"
      >
        <h2
          id="proxy-settings-title"
          className="flex items-center gap-2 font-heading text-lg"
        >
          <Globe className="size-4" />
          네트워크 프록시 설정
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          검색·번역·토렌트 받기처럼 인터넷으로 나가는 요청에 적용됩니다.
          qBittorrent 연결은 로컬이라 그대로입니다.
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            설정을 불러오는 중…
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-2" role="radiogroup" aria-label="프록시 모드">
              {MODES.map((entry) => (
                <label
                  key={entry.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    mode === entry.value
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name="proxy-mode"
                    value={entry.value}
                    checked={mode === entry.value}
                    onChange={() => {
                      setMode(entry.value)
                      setSaved(false)
                    }}
                    className="mt-0.5"
                    data-testid={`proxy-mode-${entry.value}`}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{entry.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {entry.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {mode === 'url' ? (
              <div className="mt-3">
                <label
                  htmlFor="proxy-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  프록시 주소
                </label>
                <Input
                  id="proxy-url"
                  data-testid="proxy-url"
                  type="text"
                  value={url}
                  placeholder="http://192.168.0.10:3128"
                  onChange={(event) => {
                    setUrl(event.target.value)
                    setSaved(false)
                  }}
                  className="mt-1"
                />
              </div>
            ) : null}

            {activeMode ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {activeMode.hint}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="mt-3 text-sm text-emerald-600" data-testid="proxy-saved">
                저장했습니다. 이제 나가는 요청에 바로 적용됩니다.
              </p>
            ) : null}

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                닫기
              </Button>
              <Button
                type="button"
                data-testid="proxy-save"
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  setError(null)
                  try {
                    const config = await saveProxyConfig({ mode, url })
                    setMode(config.mode)
                    setUrl(config.url)
                    setSaved(true)
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : '프록시 설정을 저장하지 못했어요.',
                    )
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : null}
                저장
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
