const DEFAULT_LOOKBACK_DAYS = 30
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayYmd(now = new Date()) {
  return formatYmd(now)
}

export function defaultSinceYmd(now = new Date()) {
  return formatYmd(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - DEFAULT_LOOKBACK_DAYS),
  )
}

export function resolveSince(raw: string | null | undefined, now = new Date()) {
  const today = todayYmd(now)
  const fallback = defaultSinceYmd(now)
  const value = raw?.trim() ?? ''
  const match = YMD.exec(value)
  if (!match) {
    return fallback
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime()) || formatYmd(parsed) !== value) {
    return fallback
  }
  if (value > today) {
    return today
  }
  return value
}

export function sinceCutoffUnix(ymd: string) {
  const match = YMD.exec(ymd)
  if (!match) {
    return sinceCutoffUnix(defaultSinceYmd())
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}
