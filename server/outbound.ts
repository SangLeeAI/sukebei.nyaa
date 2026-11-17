import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  EnvHttpProxyAgent,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from 'undici'

const CONFIG_PATH = path.join(
  import.meta.dirname,
  '..',
  'data',
  'proxy-config.json',
)

export type ProxyMode = 'env' | 'url' | 'direct'

export type ProxyConfig = {
  mode: ProxyMode
  url: string
}

const DEFAULT_CONFIG: ProxyConfig = { mode: 'env', url: '' }

let cachedConfig: ProxyConfig | null = null
let cachedDispatcher: Dispatcher | null = null
let cachedDispatcherKey = ''

function normalizeUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

function normalizeMode(raw: string): ProxyMode {
  if (raw === 'url' || raw === 'direct') {
    return raw
  }
  return 'env'
}

function readConfig(): ProxyConfig {
  if (cachedConfig) {
    return cachedConfig
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      'mode' in parsed &&
      typeof (parsed as Record<string, unknown>).mode === 'string'
    ) {
      const record = parsed as Record<string, unknown>
      cachedConfig = {
        mode: normalizeMode(record.mode as string),
        url:
          typeof record.url === 'string' ? normalizeUrl(record.url) : '',
      }
      return cachedConfig
    }
  } catch {
    // 설정 파일이 없거나 읽을 수 없으면 기본값 사용
  }
  cachedConfig = { ...DEFAULT_CONFIG }
  return cachedConfig
}

function writeConfig(next: ProxyConfig) {
  cachedConfig = next
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n')
}

export function getProxyConfig() {
  return { ...readConfig() }
}

export function setProxyConfig(rawMode: unknown, rawUrl: unknown) {
  const mode = normalizeMode(typeof rawMode === 'string' ? rawMode : 'env')
  const url = normalizeUrl(typeof rawUrl === 'string' ? rawUrl : '')
  if (mode === 'url' && !url) {
    throw new Error(
      'http:// 또는 https:// 로 시작하는 프록시 주소를 입력해 주세요.',
    )
  }
  writeConfig({ mode, url })
  return getProxyConfig()
}

function currentDispatcherKey(config: ProxyConfig) {
  return config.mode === 'url' ? `url:${config.url}` : config.mode
}

function dispatcherFor(config: ProxyConfig): Dispatcher | null {
  if (config.mode === 'direct') {
    return null
  }
  const key = currentDispatcherKey(config)
  if (cachedDispatcher && cachedDispatcherKey === key) {
    return cachedDispatcher
  }
  cachedDispatcher?.close()
  const next =
    config.mode === 'url' && config.url
      ? new ProxyAgent(config.url)
      : new EnvHttpProxyAgent()
  cachedDispatcher = next
  cachedDispatcherKey = key
  return next
}

/**
 * 외부(인터넷) 요청용 fetch.
 * 설정된 프록시 모드에 따라 undici dispatcher를 지정해 나갑니다.
 */
export function outboundFetch(
  url: string | URL,
  init: RequestInit = {},
) {
  const config = readConfig()
  const dispatcher = dispatcherFor(config)
  return undiciFetch(url, {
    ...(init as UndiciRequestInit),
    dispatcher: dispatcher ?? undefined,
  })
}
