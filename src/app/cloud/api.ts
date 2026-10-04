/**
 * REST wrappers (docs/CLOUD.md § REST API). Same origin, session cookie, JSON. Every failure is a
 * CloudError(code, message, status): server errors keep the server's code, a failed fetch is
 * 'network', a missing server 'unavailable'. Requests keep the default referrer policy (the server
 * checks Origin; `no-referrer` would send `Origin: null`).
 */
import { BASE, SERVER_CAPABLE } from './env'
import {
  CloudError,
  unavailable,
  type CloudUser,
  type CloudWorkspace,
  type EmailInviteResult,
  type Invite,
  type InviteOptions,
  type InvitePreview,
  type Member,
  type Role,
  type SignupLink,
  type SignupPreview,
} from './state'

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
/** The session is gone (a 401, or GET api/session answered `user: null`). */
export function notifyUnauthenticated(): void {
  unauthListeners.forEach((l) => l())
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
  if (res.status === 401) notifyUnauthenticated()
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
  personal?: boolean
}

const toUser = (u: RawUser): CloudUser => ({ id: u.id, email: u.email, name: u.name ?? '' })
const toWorkspace = (w: RawWorkspace): CloudWorkspace => ({ id: w.id, name: w.name, icon: (w.icon ?? null) as string | null, role: w.role, ...(w.personal ? { personal: true } : {}) })
const toMs = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0)

/* ------------------------------------------------------------------ endpoints */

/** Who is signed in; `serverAdmin`: one of this server's admins (ADMIN_EMAILS). */
export interface Account {
  user: CloudUser
  workspaces: CloudWorkspace[]
  serverAdmin: boolean
}
type RawAccount = { user: RawUser; workspaces?: RawWorkspace[]; server_admin?: boolean }
const toAccount = (r: RawAccount): Account => ({ user: toUser(r.user), workspaces: (r.workspaces ?? []).map(toWorkspace), serverAdmin: r.server_admin === true })

export async function getMe(): Promise<Account> {
  return toAccount(await request<RawAccount>('GET', 'api/me'))
}

/** GET api/session: like /api/me, but signed out is `user: null` (200), not a 401 in the console. */
export async function getSession(): Promise<Account | null> {
  const r = await request<RawAccount | { user: null }>('GET', 'api/session')
  return r?.user ? toAccount(r as RawAccount) : null
}

/**
 * Drop the stored content document of a page deleted for good (409 page_exists while it is still in
 * the meta document). `priv`: this member's private content document of the page.
 */
export function delPageDocument(wsId: string, pageId: string, priv = false): Promise<void> {
  return request<void>('DELETE', `api/workspaces/${encodeURIComponent(wsId)}/documents/${encodeURIComponent(pageId)}${priv ? '?scope=private' : ''}`)
}

export async function patchMe(name: string): Promise<CloudUser> {
  return toUser(await request<RawUser>('PATCH', 'api/me', { name }))
}

export function postSignIn(input: { email: string; redirect?: string; lang?: string; invite?: string; signup?: string }): Promise<void> {
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

type RawPerson = { id: string; name: string | null; email: string | null } | null

interface RawInvite {
  id: string
  role: Role
  email: string | null
  created_at: unknown
  expires_at: unknown
  link?: string
  email_sent?: boolean
  inviter?: RawPerson
  max_uses?: number
  uses?: number
  domains?: string[] | null
  last_joined?: RawPerson
  last_joined_at?: unknown
}

const toPerson = (p: NonNullable<RawPerson>) => ({ id: p.id, name: p.name ?? '', email: p.email ?? '' })

const toInvite = (i: RawInvite): Invite => ({
  id: i.id,
  role: i.role,
  email: i.email ?? null,
  created_at: toMs(i.created_at) || Date.now(),
  expires_at: toMs(i.expires_at),
  ...(i.link ? { link: i.link } : {}),
  ...(i.email_sent !== undefined ? { email_sent: i.email_sent } : {}),
  ...(i.inviter !== undefined ? { inviter: i.inviter ? toPerson(i.inviter) : null } : {}),
  ...(typeof i.max_uses === 'number' ? { max_uses: i.max_uses } : {}),
  ...(typeof i.uses === 'number' ? { uses: i.uses } : {}),
  ...(i.domains !== undefined ? { domains: i.domains } : {}),
  ...(i.last_joined !== undefined ? { last_joined: i.last_joined ? toPerson(i.last_joined) : null } : {}),
  ...(i.last_joined_at !== undefined ? { last_joined_at: i.last_joined_at ? toMs(i.last_joined_at) : null } : {}),
})

/** Option names on the wire (docs/CLOUD.md § Invites & registration links). */
const linkOptions = (o?: InviteOptions) => ({
  ...(o?.maxUses !== undefined ? { max_uses: o.maxUses } : {}),
  ...(o?.days !== undefined ? { expires_in_days: o.days } : {}),
  ...(o?.domains?.length ? { domains: o.domains } : {}),
})

export async function postInvite(wsId: string, role: Role, email?: string, lang?: string, opts?: InviteOptions): Promise<Invite> {
  return toInvite(
    await request<RawInvite>('POST', `api/workspaces/${encodeURIComponent(wsId)}/invites`, { role, ...(email ? { email } : {}), ...(lang ? { lang } : {}), ...linkOptions(opts) }),
  )
}

export async function postInviteEmails(wsId: string, emails: string[], role: Role, opts?: { days?: number; lang?: string }): Promise<EmailInviteResult[]> {
  const r = await request<{ results: EmailInviteResult[] }>('POST', `api/workspaces/${encodeURIComponent(wsId)}/invites/emails`, {
    emails,
    role,
    ...(opts?.days !== undefined ? { expires_in_days: opts.days } : {}),
    ...(opts?.lang ? { lang: opts.lang } : {}),
  })
  return (r?.results ?? []).map((x) => ({ email: x.email, status: x.status, ...(x.link ? { link: x.link } : {}) }))
}

export async function getInvites(wsId: string): Promise<Invite[]> {
  return (await request<RawInvite[]>('GET', `api/workspaces/${encodeURIComponent(wsId)}/invites`)).map(toInvite)
}

export function delInvite(wsId: string, inviteId: string): Promise<void> {
  return request<void>('DELETE', `api/workspaces/${encodeURIComponent(wsId)}/invites/${encodeURIComponent(inviteId)}`)
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const r = await request<{
    workspace: { name: string; icon?: unknown }
    role: Role
    inviter: { name: string | null; email: string } | null
    email?: string | null
    expires_at?: unknown
    domains?: string[] | null
    places_left?: number
    max_uses?: number
  }>('GET', `api/invites/${encodeURIComponent(token)}`)
  return {
    workspace: { name: r.workspace?.name ?? '', icon: r.workspace?.icon ?? null },
    role: r.role,
    inviter: r.inviter ? r.inviter.name || r.inviter.email || null : null,
    email: r.email ?? null,
    ...(r.expires_at !== undefined ? { expires_at: toMs(r.expires_at) } : {}),
    ...(Array.isArray(r.domains) ? { domains: r.domains } : {}),
    ...(typeof r.places_left === 'number' ? { places_left: r.places_left, max_uses: r.max_uses } : {}),
  }
}

export function postAcceptInvite(token: string): Promise<{ workspaceId: string; role?: Role }> {
  return request<{ workspaceId: string; role?: Role }>('POST', `api/invites/${encodeURIComponent(token)}/accept`)
}

/* ------------------------------------------------------------------ registration links (server admins) */

interface RawSignupLink {
  id: string
  label?: string | null
  created_at: unknown
  expires_at: unknown
  max_uses: number
  uses: number
  last_used_at?: unknown
  domains?: string[] | null
  created_by?: RawPerson
  link?: string
}

const toSignupLink = (l: RawSignupLink): SignupLink => ({
  id: l.id,
  label: l.label ?? null,
  created_at: toMs(l.created_at) || Date.now(),
  expires_at: toMs(l.expires_at),
  max_uses: l.max_uses,
  uses: l.uses,
  last_used_at: l.last_used_at ? toMs(l.last_used_at) : null,
  domains: l.domains ?? null,
  ...(l.created_by !== undefined ? { created_by: l.created_by ? toPerson(l.created_by) : null } : {}),
  ...(l.link ? { link: l.link } : {}),
})

export async function getSignupLinks(): Promise<SignupLink[]> {
  return (await request<RawSignupLink[]>('GET', 'api/server/signup-links')).map(toSignupLink)
}

export async function postSignupLink(opts: InviteOptions & { label?: string }): Promise<SignupLink> {
  return toSignupLink(await request<RawSignupLink>('POST', 'api/server/signup-links', { ...linkOptions(opts), ...(opts.label?.trim() ? { label: opts.label.trim() } : {}) }))
}

export function delSignupLink(id: string): Promise<void> {
  return request<void>('DELETE', `api/server/signup-links/${encodeURIComponent(id)}`)
}

export async function getSignupPreview(token: string): Promise<SignupPreview> {
  const r = await request<{ server: string; expires_at: unknown; domains?: string[] | null; places_left?: number; max_uses?: number; label?: string | null }>(
    'GET',
    `api/signup/${encodeURIComponent(token)}`,
  )
  return {
    server: r.server ?? '',
    expires_at: toMs(r.expires_at),
    domains: r.domains ?? null,
    ...(typeof r.places_left === 'number' ? { places_left: r.places_left, max_uses: r.max_uses, label: r.label ?? null } : {}),
  }
}

/** `priv`: uploaded from a private page — only this member may download it until it is published. */
export function putFile(wsId: string, fileId: string, blob: Blob, name: string, priv = false): Promise<{ id: string }> {
  return request<{ id: string }>('PUT', `api/workspaces/${encodeURIComponent(wsId)}/files/${encodeURIComponent(fileId)}`, undefined, {
    raw: blob,
    headers: { 'content-type': blob.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(name || fileId), ...(priv ? { 'x-file-scope': 'private' } : {}) },
  })
}

/** This member's private files among `ids` become workspace files (others' and unknown ids are ignored). */
export function publishFiles(wsId: string, ids: string[]): Promise<{ published: number }> {
  return request<{ published: number }>('POST', `api/workspaces/${encodeURIComponent(wsId)}/files/publish`, { ids })
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
