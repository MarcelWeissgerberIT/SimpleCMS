/**
 * Gmail REST (read-only) straight from the browser: fetch to gmail.googleapis.com with the bearer token.
 * Rate limits (429, 403 rateLimitExceeded) and server hiccups (5xx) are retried with exponential
 * backoff (Retry-After honoured). Errors carry a code, never mail content or the token.
 */
import type { GmailMessage } from './parse'

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** auth (token expired / revoked) · forbidden (API off, no access) · not_found · rate · offline · server · bad */
export type GmailCode = 'auth' | 'forbidden' | 'not_found' | 'rate' | 'offline' | 'server' | 'bad' | 'aborted'

export class GmailError extends Error {
  code: GmailCode
  status: number
  constructor(code: GmailCode, status = 0, detail?: string) {
    super(detail ? `Gmail ${status || code}: ${detail}` : `Gmail ${status || code}`)
    this.name = 'GmailError'
    this.code = code
    this.status = status
  }
}

export interface GmailCtx {
  token: () => string | null
  signal?: AbortSignal
  /** a request is waiting before its next attempt (rate limit / server error) */
  onRetry?: (waitMs: number) => void
}

export interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
}

/** Retries after the first attempt (429 / 5xx / rate-limit 403). */
export const MAX_RETRIES = 5
const MAX_WAIT_MS = 30_000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GmailError('aborted'))
    const timer = window.setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      window.clearTimeout(timer)
      reject(new GmailError('aborted'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** How long to wait before attempt `attempt` (1-based): Retry-After, else 0.5 s · 2^n with a little jitter. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const sec = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN
  if (Number.isFinite(sec)) return Math.min(MAX_WAIT_MS, Math.max(0, sec * 1000))
  return Math.min(MAX_WAIT_MS, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250))
}

type Query = Record<string, string | number | boolean | string[] | undefined>

function url(path: string, q?: Query): string {
  const u = new URL(`${GMAIL_API}/${path}`)
  for (const [key, v] of Object.entries(q ?? {})) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(key, x))
    else u.searchParams.set(key, String(v))
  }
  return u.toString()
}

async function call<T>(c: GmailCtx, path: string, q?: Query): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = c.token()
    if (!token) throw new GmailError('auth', 401)
    let res: Response
    try {
      res = await fetch(url(path, q), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: c.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch (e) {
      if (c.signal?.aborted) throw new GmailError('aborted')
      throw new GmailError('offline', 0, e instanceof Error ? e.message : String(e))
    }
    if (res.ok) return (await res.json()) as T
    const body = await res.text().catch(() => '')
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(body))
    const retryable = rateLimited || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504
    if (retryable && attempt < MAX_RETRIES) {
      const wait = backoffMs(attempt + 1, res.headers.get('retry-after'))
      c.onRetry?.(wait)
      await sleep(wait, c.signal)
      continue
    }
    if (res.status === 401) throw new GmailError('auth', 401)
    if (rateLimited) throw new GmailError('rate', res.status)
    if (res.status === 403) throw new GmailError('forbidden', 403, reasonOf(body))
    if (res.status === 404) throw new GmailError('not_found', 404)
    if (res.status >= 500) throw new GmailError('server', res.status)
    throw new GmailError('bad', res.status, reasonOf(body))
  }
}

/** The API's own short reason ("accessNotConfigured" …) — never anything from a mail. */
function reasonOf(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { errors?: Array<{ reason?: string }>; status?: string } }).error
    return String(e?.errors?.[0]?.reason ?? e?.status ?? '').slice(0, 60)
  } catch {
    return ''
  }
}

/** Run `fn` over `items` with at most `limit` at a time; results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function profile(c: GmailCtx): Promise<{ emailAddress: string; historyId: string; messagesTotal?: number }> {
  return call(c, 'profile')
}

export async function labels(c: GmailCtx): Promise<GmailLabel[]> {
  const r = await call<{ labels?: Array<{ id: string; name: string; type?: string }> }>(c, 'labels')
  return (r.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type === 'user' ? 'user' : 'system' }))
}

/** Every message id matching (newest first), at most `max`. */
export async function listIds(c: GmailCtx, o: { q?: string; labelIds?: string[]; includeSpamTrash?: boolean; max?: number }): Promise<string[]> {
  const ids: string[] = []
  const max = o.max ?? 5000
  let pageToken: string | undefined
  do {
    const r = await call<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(c, 'messages', {
      q: o.q,
      labelIds: o.labelIds,
      includeSpamTrash: o.includeSpamTrash,
      maxResults: Math.min(500, max - ids.length),
      pageToken,
    })
    for (const m of r.messages ?? []) ids.push(m.id)
    pageToken = r.nextPageToken
  } while (pageToken && ids.length < max)
  return ids
}

export interface HistoryResult {
  /** message id → its labels after the change (null = not given) */
  added: Map<string, string[] | null>
  changed: Map<string, string[] | null>
  /** the mailbox's current history id */
  historyId: string
}

type HistoryMsg = { message?: { id?: string; labelIds?: string[] } }

/** Changes since `startHistoryId` (new mails, label changes). GmailError 'not_found' = that history is gone. */
export async function history(c: GmailCtx, startHistoryId: string): Promise<HistoryResult> {
  const out: HistoryResult = { added: new Map(), changed: new Map(), historyId: startHistoryId }
  let pageToken: string | undefined
  let pages = 0
  do {
    const r = await call<{
      history?: Array<{ messagesAdded?: HistoryMsg[]; labelsAdded?: HistoryMsg[]; labelsRemoved?: HistoryMsg[]; messagesDeleted?: HistoryMsg[] }>
      historyId?: string
      nextPageToken?: string
    }>(c, 'history', { startHistoryId, historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'], maxResults: 500, pageToken })
    for (const h of r.history ?? []) {
      for (const a of h.messagesAdded ?? []) if (a.message?.id) out.added.set(a.message.id, a.message.labelIds ?? null)
      for (const a of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) {
        const id = a.message?.id
        if (!id) continue
        if (out.added.has(id)) out.added.set(id, a.message?.labelIds ?? out.added.get(id) ?? null)
        else out.changed.set(id, a.message?.labelIds ?? null)
      }
    }
    if (r.historyId) out.historyId = r.historyId
    pageToken = r.nextPageToken
  } while (pageToken && ++pages < 50)
  return out
}

export function message(c: GmailCtx, id: string, format: 'full' | 'minimal' = 'full'): Promise<GmailMessage> {
  return call(c, `messages/${encodeURIComponent(id)}`, { format })
}

/** A body part Gmail sent separately (large text bodies) — never used for attachments in v1. */
export function attachment(c: GmailCtx, messageId: string, attachmentId: string): Promise<{ data?: string; size?: number }> {
  return call(c, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
}
