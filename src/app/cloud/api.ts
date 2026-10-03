/**
 * REST wrappers (docs/CLOUD.md § REST API). Same origin, session cookie, JSON. Every failure is a
 * CloudError(code, message, status): server errors keep the server's code, a failed fetch is
 * 'network', a missing server 'unavailable'. Requests keep the default referrer policy (the server
 * checks Origin; `no-referrer` would send `Origin: null`).
 */
import { BASE, SERVER_CAPABLE } from './env'
import { CloudError, unavailable, type CloudUser, type CloudWorkspace, type Invite, type InvitePreview, type Member, type Role } from './state'

export interface ServerConfig {
  version: string
  signup: { mode: string; domains?: string[] }
  max_upload_mb: number
  dev_mode: boolean
  source_url: string
}

/** Set once a server answered (or definitely didn't). REST helpers throw 'unavailable' without one. */
let serverKnown: boolean | null = null
export function setServerKnown(v: boolean): void {
  serverKnown = v
}

/** Before the first answer of GET api/config, REST calls ask it first (boot.ts registers this). */
let probe: (() => Promise<boolean>) | null = null
export function setServerProbe(fn: () => Promise<boolean>): void {
  probe = fn
}

/** Listeners for 401 answers (the session ended while the app was open). */
const unauthListeners = new Set<() => void>()
export function onUnauthenticated(fn: () => void): () => void {
  unauthListeners.add(fn)
  return () => unauthListeners.delete(fn)
}

const httpCode = (status: number) =>
  status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 413 ? 'payload_too_large' : status === 429 ? 'rate_limited' : status >= 500 ? 'internal' : 'invalid_request'

async function readError(res: Response): Promise<CloudError> {
  let code = httpCode(res.status)
  let message = res.statusText || `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) message = body.error.message
  } catch {
    /* not JSON */
  }
  const err = new CloudError(code, message, res.status)
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'))
    if (Number.isFinite(retry) && retry > 0) err.retryAfter = retry
  }
  if (res.status === 401) unauthListeners.forEach((l) => l())
  return err
}

/** Low-level request. `path` is relative to the app base, e.g. 'api/me'. */
export async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  if (!SERVER_CAPABLE || serverKnown === false) throw unavailable()
  // e.g. an invite link opened before the boot's detection answered: a missing server is
  // 'unavailable', never a confusing 404 from a static host
  if (serverKnown === null && probe && !(await probe())) throw unavailable()
  const headers: Record<string, string> = { ...opts.headers }
  // every mutating request carries the JSON content type (CSRF guard), even without a body
  if (method !== 'GET' && method !== 'HEAD' && opts.raw === undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: opts.raw ?? (body === undefined ? (method === 'GET' || method === 'HEAD' ? undefined : '{}') : JSON.stringify(body)),
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new CloudError('aborted', 'The request was cancelled.')
    throw new CloudError('network', (e as Error)?.message || 'Network error')
  }
  if (!res.ok) throw await readError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  try {
    return (text ? JSON.parse(text) : undefined) as T
  } catch {
    throw new CloudError('invalid_response', 'The server answered with something that is not JSON.', res.status)
  }
}

/** GET api/config without throwing: the config, 'absent' (no server here) or 'network' (can't tell right now). */
export async function fetchConfig(timeoutMs: number): Promise<ServerConfig | 'absent' | 'network'> {
  if (!SERVER_CAPABLE) return 'absent'
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}api/config`, { credentials: 'same-origin', signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return res.status >= 500 ? 'network' : 'absent'
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('json')) return 'absent' // a static host's HTML fallback
    const json = (await res.json()) as ServerConfig
    return json && typeof json === 'object' && 'version' in json ? json : 'absent'
  } catch {
    return 'network'
  } finally {
    window.clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ shapes */

interface RawUser {
  id: string
  email: string
  name: string | null
}
interface RawWorkspace {
  id: string
  name: string
  icon: unknown
  role: Role
}

const toUser = (u: RawUser): CloudUser => ({ id: u.id, email: u.email, name: u.name ?? '' })
const toWorkspace = (w: RawWorkspace): CloudWorkspace => ({ id: w.id, name: w.name, icon: (w.icon ?? null) as string | null, role: w.role })
const toMs = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0)

/* ------------------------------------------------------------------ endpoints */

export async function getMe(): Promise<{ user: CloudUser; workspaces: CloudWorkspace[] }> {
  const r = await request<{ user: RawUser; workspaces: RawWorkspace[] }>('GET', 'api/me')
  return { user: toUser(r.user), workspaces: (r.workspaces ?? []).map(toWorkspace) }
}

export async function patchMe(name: string): Promise<CloudUser> {
  return toUser(await request<RawUser>('PATCH', 'api/me', { name }))
}

export function postSignIn(input: { email: string; redirect?: string; lang?: string; invite?: string }): Promise<void> {
  return request<void>('POST', 'api/auth/request', input)
}

export function postLogout(): Promise<void> {
  return request<void>('POST', 'api/auth/logout')
}

export async function postWorkspace(name: string): Promise<CloudWorkspace> {
  return toWorkspace(await request<RawWorkspace>('POST', 'api/workspaces', { name }))
}

export async function patchWorkspace(id: string, patch: { name?: string; icon?: unknown }): Promise<CloudWorkspace> {
  return toWorkspace(await request<RawWorkspace>('PATCH', `api/workspaces/${encodeURIComponent(id)}`, patch))
}

export function delWorkspace(id: string): Promise<void> {
  return request<void>('DELETE', `api/workspaces/${encodeURIComponent(id)}`)
}

export async function getMembers(wsId: string): Promise<Member[]> {
  const list = await request<Array<{ user: RawUser; role: Role; created_at: unknown }>>('GET', `api/workspaces/${encodeURIComponent(wsId)}/members`)
  return list.map((m) => ({ user: toUser(m.user), role: m.role, created_at: toMs(m.created_at) }))
}

export function patchMember(wsId: string, userId: string, role: Role): Promise<void> {
  return request<void>('PATCH', `api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, { role })
}

export function delMember(wsId: string, userId: string): Promise<void> {
  return request<void>('DELETE', `api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`)
}

interface RawInvite {
  id: string
  role: Role
  email: string | null
  created_at: unknown
  expires_at: unknown
  link?: string
  email_sent?: boolean
  inviter?: { id: string; name: string | null; email: string } | null
}

const toInvite = (i: RawInvite): Invite => ({
  id: i.id,
  role: i.role,
  email: i.email ?? null,
  created_at: toMs(i.created_at) || Date.now(),
  expires_at: toMs(i.expires_at),
  ...(i.link ? { link: i.link } : {}),
  ...(i.email_sent !== undefined ? { email_sent: i.email_sent } : {}),
  ...(i.inviter !== undefined ? { inviter: i.inviter ? { id: i.inviter.id, name: i.inviter.name ?? '', email: i.inviter.email } : null } : {}),
})

export async function postInvite(wsId: string, role: Role, email?: string, lang?: string): Promise<Invite> {
  return toInvite(await request<RawInvite>('POST', `api/workspaces/${encodeURIComponent(wsId)}/invites`, { role, ...(email ? { email } : {}), ...(lang ? { lang } : {}) }))
}

export async function getInvites(wsId: string): Promise<Invite[]> {
  return (await request<RawInvite[]>('GET', `api/workspaces/${encodeURIComponent(wsId)}/invites`)).map(toInvite)
}

export function delInvite(wsId: string, inviteId: string): Promise<void> {
  return request<void>('DELETE', `api/workspaces/${encodeURIComponent(wsId)}/invites/${encodeURIComponent(inviteId)}`)
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const r = await request<{ workspace: { name: string; icon?: unknown }; role: Role; inviter: { name: string | null; email: string } | null; email?: string | null; expires_at?: unknown }>(
    'GET',
    `api/invites/${encodeURIComponent(token)}`,
  )
  return {
    workspace: { name: r.workspace?.name ?? '', icon: r.workspace?.icon ?? null },
    role: r.role,
    inviter: r.inviter ? r.inviter.name || r.inviter.email || null : null,
    email: r.email ?? null,
    ...(r.expires_at !== undefined ? { expires_at: toMs(r.expires_at) } : {}),
  }
}

export function postAcceptInvite(token: string): Promise<{ workspaceId: string; role?: Role }> {
  return request<{ workspaceId: string; role?: Role }>('POST', `api/invites/${encodeURIComponent(token)}/accept`)
}

export function putFile(wsId: string, fileId: string, blob: Blob, name: string): Promise<{ id: string }> {
  return request<{ id: string }>('PUT', `api/workspaces/${encodeURIComponent(wsId)}/files/${encodeURIComponent(fileId)}`, undefined, {
    raw: blob,
    headers: { 'content-type': blob.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(name || fileId) },
  })
}

/** GET a file's bytes (null when the server doesn't have it). */
export async function getFileBlob(wsId: string, fileId: string): Promise<{ blob: Blob; name: string } | null> {
  if (!SERVER_CAPABLE || serverKnown === false) return null
  let res: Response
  try {
    res = await fetch(`${BASE}api/workspaces/${encodeURIComponent(wsId)}/files/${encodeURIComponent(fileId)}`, { credentials: 'same-origin' })
  } catch {
    return null
  }
  if (!res.ok) return null
  const disposition = res.headers.get('content-disposition') ?? ''
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  let name = fileId
  try {
    if (star) name = decodeURIComponent(star[1])
  } catch {
    /* keep the id */
  }
  return { blob: await res.blob(), name }
}
