import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CHROME_TRANSLATE =
  'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=ko'
const LINGVA_TRANSLATE = 'https://lingva.ml/api/v1/auto/ko/'
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BATCH_SIZE = 10
const BATCH_DELAY_MS = 80
const CACHE_PATH = path.join(import.meta.dirname, '..', '.translate-cache.json')

const memoryCache = new Map<string, string>()
let cacheLoaded = false
let cacheDirty = false

function loadCache() {
  if (cacheLoaded) {
    return
  }
  cacheLoaded = true
  try {
    const parsed: unknown = JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) {
          memoryCache.set(key, value)
        }
      }
    }
  } catch {
    // first run or unreadable cache
  }
}

function persistCache() {
  if (!cacheDirty) {
    return
  }
  try {
    const entries = [...memoryCache.entries()].slice(-8000)
    writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(entries)))
    cacheDirty = false
  } catch {
    // cache is optional
  }
}

function remember(original: string, translated: string) {
  memoryCache.set(original, translated)
  cacheDirty = true
}

export function isMostlyKorean(text: string) {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) {
    return true
  }
  const hangul = text.match(/\p{Script=Hangul}/gu) ?? []
  return hangul.length / letters.length >= 0.55
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function parseChromeResponse(data: unknown, count: number) {
  if (!Array.isArray(data) || data.length === 0) {
    return []
  }
  const rows = data.map((row) => {
    if (Array.isArray(row)) {
      return String(row[0] ?? '').trim()
    }
    if (typeof row === 'string') {
      return row.trim()
    }
    return ''
  })
  if (rows.length !== count) {
    return []
  }
  return rows
}

async function translateBatchChrome(texts: string[], signal?: AbortSignal) {
  const body = texts.map((text) => `q=${encodeURIComponent(text)}`).join('&')
  const response = await fetch(CHROME_TRANSLATE, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': USER_AGENT,
    },
    body,
    signal: withTimeout(signal, 15_000),
  })
  if (!response.ok) {
    throw new Error(`translate HTTP ${response.status}`)
  }
  const parsed = parseChromeResponse(await response.json(), texts.length)
  if (parsed.length !== texts.length) {
    throw new Error('translate batch size mismatch')
  }
  return parsed
}

async function translateOneLingva(text: string, signal?: AbortSignal) {
  const response = await fetch(`${LINGVA_TRANSLATE}${encodeURIComponent(text)}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: withTimeout(signal, 12_000),
  })
  if (!response.ok) {
    throw new Error(`lingva HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  if (
    payload &&
    typeof payload === 'object' &&
    'translation' in payload &&
    typeof payload.translation === 'string' &&
    payload.translation.trim()
  ) {
    return payload.translation.trim()
  }
  throw new Error('lingva empty')
}

async function translateMissing(texts: string[], signal?: AbortSignal) {
  if (texts.length === 0) {
    return
  }
  try {
    const translated = await translateBatchChrome(texts, signal)
    texts.forEach((original, index) => {
      const next = translated[index]?.trim()
      if (next) {
        remember(original, next)
      }
    })
    return
  } catch {
    // fall through to per-item fallback
  }

  for (const original of texts) {
    if (memoryCache.has(original)) {
      continue
    }
    try {
      remember(original, await translateOneLingva(original, signal))
    } catch {
      // leave uncached so a later search can retry; UI keeps the original
    }
  }
}

export async function translateTexts(texts: string[], signal?: AbortSignal) {
  loadCache()
  const unique = [...new Set(texts.map((text) => text.trim()).filter(Boolean))]
  const missing = unique.filter(
    (text) => !memoryCache.has(text) && !isMostlyKorean(text),
  )

  for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
    if (offset > 0) {
      await sleep(BATCH_DELAY_MS, signal)
    }
    await translateMissing(missing.slice(offset, offset + BATCH_SIZE), signal)
  }
  persistCache()

  return texts.map((text) => {
    const trimmed = text.trim()
    if (!trimmed || isMostlyKorean(trimmed)) {
      return text
    }
    return memoryCache.get(trimmed) || text
  })
}
