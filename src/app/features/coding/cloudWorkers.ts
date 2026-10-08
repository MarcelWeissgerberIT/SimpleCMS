/**
 * Cloud workers over REST (docs/CLOUD.md § Coding relay) — only through the cloud area's `cloudRequest`:
 * list (a member: their own; admins: everyone's), create (= a download: a PENDING token, its secret goes straight
 * into the file and nowhere else), revoke, and whether this server has the relay at all.
 */
import { CloudError, cloudRequest, useCloud } from '../../cloud'
import { cloudOriginAllowed } from './protocol'

export interface CloudWorker {
  id: string
  label: string
  /** pending: downloaded, never connected yet (the older worker keeps working until it does) */
  state: 'active' | 'pending'
  user: { id: string; name: string | null; email: string }
  mine: boolean
  createdAt: number
  /** the browser that downloaded it (user agent) */
  createdFrom: string | null
  lastUsedAt: number | null
  online: boolean
  /** its member's tab is connected to it right now */
  tab: boolean
}

interface RawWorker {
  id: string
  label: string
  state: string
  user: { id: string; name: string | null; email: string }
  mine: boolean
  created_at: string
  created_from: string | null
  last_used_at: string | null
  online: boolean
  tab: boolean
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) || null : null)

const fromRaw = (r: RawWorker): CloudWorker => ({
  id: String(r.id),
  label: String(r.label ?? ''),
  state: r.state === 'pending' ? 'pending' : 'active',
  user: { id: String(r.user?.id ?? ''), name: r.user?.name ?? null, email: String(r.user?.email ?? '') },
  mine: r.mine === true,
  createdAt: ms(r.created_at) ?? 0,
  createdFrom: typeof r.created_from === 'string' ? r.created_from.slice(0, 200) : null,
  lastUsedAt: ms(r.last_used_at),
  online: r.online === true,
  tab: r.tab === true,
})

/**
 * Can this page run a cloud link at all? The tab's end-to-end box needs WebCrypto (a secure context), and the worker
 * dials only an https origin (plain http only on this computer) — the same rule (protocol.ts cloudOriginAllowed).
 */
export function cloudContextOk(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true && typeof crypto !== 'undefined' && !!crypto.subtle && cloudOriginAllowed(window.location.origin)
}

/** The server workspace id of this tab's team workspace (null: a local workspace). */
export function serverWorkspaceId(): string | null {
  const active = useCloud.getState().active
  return active.kind === 'cloud' ? active.id : null
}

const path = (wsId: string, rest = '') => `api/workspaces/${encodeURIComponent(wsId)}/coding/workers${rest}`

export async function listCloudWorkers(wsId: string): Promise<CloudWorker[]> {
  const rows = await cloudRequest<RawWorker[]>('GET', path(wsId))
  return Array.isArray(rows) ? rows.map(fromRaw) : []
}

/** A new download's token (pending). The secret is returned ONCE — the caller writes it into the file only. */
export async function createCloudWorker(wsId: string): Promise<{ worker: CloudWorker; token: string }> {
  const res = await cloudRequest<RawWorker & { token: string }>('POST', path(wsId), {})
  if (!res || typeof res.token !== 'string' || !/^onew_[A-Za-z0-9_-]{43}$/.test(res.token)) throw new CloudError('invalid_response', 'The server did not return a worker token.')
  return { worker: fromRaw(res), token: res.token }
}

export async function revokeCloudWorker(wsId: string, id: string): Promise<void> {
  await cloudRequest<void>('DELETE', path(wsId, `/${encodeURIComponent(id)}`))
}

let relayKnown: { at: number; on: boolean } | null = null

/** Does this server run the coding relay (GET api/config → coding_relay)? Asked at most once a minute. */
export async function relayAvailable(): Promise<boolean> {
  if (relayKnown && Date.now() - relayKnown.at < 60_000) return relayKnown.on
  try {
    const config = await cloudRequest<{ coding_relay?: unknown }>('GET', 'api/config')
    relayKnown = { at: Date.now(), on: config?.coding_relay === true }
  } catch {
    // unreachable right now: try the relay (it answers for itself)
    return relayKnown?.on ?? true
  }
  return relayKnown.on
}

/** The message key for a failed cloud-worker request (the server's own English text never reaches the screen). */
export function cloudErrorKey(e: unknown): string {
  const code = e instanceof CloudError ? e.code : ''
  if (code === 'coding_relay_off') return 'features.coding.via.unavailable'
  if (code === 'worker_not_found') return 'features.coding.cloud.notFound'
  if (code === 'rate_limited') return 'features.coding.cloud.rateLimited'
  if (code === 'forbidden') return 'features.coding.via.viewer'
  if (code === 'network' || code === 'unavailable') return 'features.coding.cloud.offline'
  return 'features.coding.cloud.failed'
}

/** "Chrome on macOS" from a user agent (the device a download came from) — null when unknown. */
export function deviceOf(ua: string | null): string | null {
  if (!ua) return null
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null
  if (browser && os) return `${browser} · ${os}`
  return browser ?? os
}
