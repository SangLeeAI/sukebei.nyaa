export async function translateTexts(texts: string[], signal?: AbortSignal) {
  if (texts.length === 0) {
    return []
  }

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
    signal,
  })
  const payload: unknown = await response.json().catch(() => null)
  const translations =
    payload &&
    typeof payload === 'object' &&
    'translations' in payload &&
    Array.isArray(payload.translations)
      ? payload.translations
      : []

  return texts.map((text, index) => {
    const next = translations[index]
    return typeof next === 'string' && next.trim() ? next : text
  })
}
