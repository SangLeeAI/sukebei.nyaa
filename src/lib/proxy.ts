export type ProxyMode = 'env' | 'url' | 'direct'

export type ProxyConfig = {
  mode: ProxyMode
  url: string
}

export async function fetchProxyConfig(signal?: AbortSignal) {
  const response = await fetch('/api/proxy', { signal })
  if (!response.ok) {
    throw new Error('프록시 설정을 읽지 못했어요.')
  }
  const payload = (await response.json()) as { config: ProxyConfig }
  return payload.config
}

export async function saveProxyConfig(config: ProxyConfig) {
  const response = await fetch('/api/proxy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const payload = (await response.json().catch(() => null)) as {
    config?: ProxyConfig
    error?: string
  } | null
  if (!response.ok || !payload?.config) {
    throw new Error(payload?.error ?? '프록시 설정을 저장하지 못했어요.')
  }
  return payload.config
}
