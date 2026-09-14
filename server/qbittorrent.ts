import fs from 'node:fs'
import path from 'node:path'
import { SearchError } from './sukebei-search.ts'

const DEFAULT_ORIGINS = ['http://127.0.0.1:8080', 'http://127.0.0.1:8081']

type QbitSession = {
  origin: string
  sid: string
}

let session: QbitSession | null = null

function envOrigin() {
  return process.env.QBITTORRENT_URL?.trim().replace(/\/$/, '') ?? ''
}

function envUser() {
  return process.env.QBITTORRENT_USER?.trim() || 'admin'
}

function envPassword() {
  return (
    process.env.QBITTORRENT_PASSWORD ??
    process.env.QBITTORRENT_PASS ??
    'adminadmin'
  )
}

function takeSid(response: Response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
  const fallback = response.headers.get('set-cookie')
  const list = cookies.length > 0 ? cookies : fallback ? [fallback] : []
  for (const cookie of list) {
    const match = /(?:^|;\s*)SID=([^;]+)/.exec(cookie)
    if (match) {
      return match[1]
    }
  }
  return ''
}

async function qbitRequest(
  origin: string,
  pathname: string,
  init: RequestInit & { sid?: string } = {},
) {
  const headers = new Headers(init.headers)
  headers.set('Referer', `${origin}/`)
  headers.set('Origin', origin)
  if (init.sid) {
    headers.set('Cookie', `SID=${init.sid}`)
  }
  return fetch(`${origin}${pathname}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })
}

async function login(origin: string) {
  const body = new URLSearchParams({
    username: envUser(),
    password: envPassword(),
  })
  const response = await qbitRequest(origin, '/api/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const sid = takeSid(response)
  const text = (await response.text()).trim()
  if (!response.ok || (text && text !== 'Ok.' && !sid)) {
    throw new SearchError(
      'qBittorrent Web UI 로그인에 실패했어요. 사용자 이름과 비밀번호를 확인해 주세요.',
      502,
    )
  }
  return sid || takeSid(response)
}

async function probe(origin: string) {
  try {
    const response = await qbitRequest(origin, '/api/v2/app/version')
    if (!response.ok) {
      return null
    }
    return { origin, sid: takeSid(response) }
  } catch {
    return null
  }
}

export async function connectQbittorrent() {
  if (session) {
    const alive = await probe(session.origin)
    if (alive) {
      session = { origin: alive.origin, sid: alive.sid || session.sid }
      return session
    }
    session = null
  }

  const origins = [...new Set([envOrigin(), ...DEFAULT_ORIGINS].filter(Boolean))]
  for (const origin of origins) {
    const found = await probe(origin)
    if (!found) {
      continue
    }
    let sid = found.sid
    if (!sid) {
      try {
        sid = await login(origin)
      } catch (cause) {
        if (origins.length === 1) {
          throw cause
        }
        continue
      }
    }
    session = { origin, sid }
    return session
  }

  throw new SearchError(
    '이 컴퓨터에서 qBittorrent에 연결하지 못했어요. Web UI가 127.0.0.1:8080 에서 켜져 있는지 확인해 주세요.',
    503,
  )
}

export async function addTorrentFilesToQbittorrent(filePaths: string[]) {
  if (filePaths.length === 0) {
    throw new SearchError('추가할 토렌트 파일이 없어요.', 400)
  }

  const files = filePaths.map((filePath) => {
    const resolved = path.resolve(filePath)
    if (!resolved.endsWith('.torrent') || !fs.existsSync(resolved)) {
      throw new SearchError(`토렌트 파일이 없어요: ${filePath}`, 404)
    }
    const data = fs.readFileSync(resolved)
    if (data[0] !== 0x64) {
      throw new SearchError(`토렌트 파일이 아니에요: ${filePath}`, 400)
    }
    return { name: path.basename(resolved), data }
  })

  const connected = await connectQbittorrent()
  const form = new FormData()
  for (const file of files) {
    form.append(
      'torrents',
      new File([file.data], file.name, {
        type: 'application/x-bittorrent',
      }),
    )
  }

  const response = await qbitRequest(
    connected.origin,
    '/api/v2/torrents/add',
    {
      method: 'POST',
      body: form,
      sid: connected.sid,
    },
  )
  const text = (await response.text()).trim()
  if (!response.ok || (text && text !== 'Ok.')) {
    session = null
    throw new SearchError(
      text
        ? `qBittorrent가 토렌트를 받지 않았어요. (${text})`
        : `qBittorrent가 HTTP ${response.status}로 거절했어요.`,
      502,
    )
  }
  return { origin: connected.origin, added: files.length }
}
