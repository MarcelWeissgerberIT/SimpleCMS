/**
 * The cloud calls the team UI makes, gathered in one object. In production this is exactly the
 * cloud area's public API (src/app/cloud/index.ts). Dev builds and `?e2e` pages may swap single
 * calls for screenshots and UI tests without a server: window.__oneCloud.mock({ listMembers: … }).
 */
import {
  CloudError,
  cloudRequest,
  acceptInvite,
  createInvite,
  createSignupLink,
  createWorkspace,
  deleteWorkspace,
  listInvites,
  listMembers,
  listSignupLinks,
  previewInvite,
  previewSignupLink,
  removeDeviceCopy,
  removeMember,
  renameWorkspace,
  requestSignIn,
  revokeInvite,
  revokeSignupLink,
  sendInvites,
  setMemberRole,
  signOut,
  switchWorkspace,
  updateProfile,
  uploadLocalWorkspace,
  useCloud,
} from '../../cloud'

/* ------------------------------------------------------------------ API tokens & incoming webhooks (docs/API.md) */

export type ApiScope = 'read' | 'write'
/** Comments over MCP for the token's client (set at creation): off · read · read + write. */
export type ApiComments = 'off' | 'read' | 'write'
type Creator = { id: string; name: string | null; email: string | null } | null

export interface ApiToken {
  id: string
  name: string
  scope: ApiScope
  /** absent: a server from before comments over MCP (= off) */
  comments?: ApiComments
  created_at: number
  last_used_at: number | null
  created_by: Creator
  /** Only in the answer that created it: the secret, shown once. */
  token?: string
}

export interface IncomingHook {
  id: string
  /** title null: the database is gone (deleted or in the trash) */
  database: { id: string; title: string | null }
  created_at: number
  last_delivery_at: number | null
  deliveries: number
  created_by: Creator
  /** Only when created or regenerated: the URL with its secret, shown once. */
  url?: string
}

const ms = (v: unknown): number | null => (typeof v === 'string' ? Date.parse(v) || null : typeof v === 'number' ? v : null)
const wsPath = (wsId: string, rest: string) => `api/workspaces/${encodeURIComponent(wsId)}/${rest}`

type Raw<T> = Omit<T, 'created_at' | 'last_used_at' | 'last_delivery_at'> & { created_at: string; last_used_at?: string | null; last_delivery_at?: string | null }

const toToken = (t: Raw<ApiToken>): ApiToken => ({ ...t, created_at: ms(t.created_at) ?? Date.now(), last_used_at: ms(t.last_used_at) })
const toHook = (h: Raw<IncomingHook>): IncomingHook => ({ ...h, created_at: ms(h.created_at) ?? Date.now(), last_delivery_at: ms(h.last_delivery_at) })

export const listApiTokens = async (wsId: string) => (await cloudRequest<Raw<ApiToken>[]>('GET', wsPath(wsId, 'tokens'))).map(toToken)
export const createApiToken = async (wsId: string, name: string, scope: ApiScope, comments: ApiComments = 'off') =>
  toToken(await cloudRequest<Raw<ApiToken>>('POST', wsPath(wsId, 'tokens'), { name, scope, comments }))
export const revokeApiToken = (wsId: string, tokenId: string) => cloudRequest<void>('DELETE', wsPath(wsId, `tokens/${encodeURIComponent(tokenId)}`))
export const listHooks = async (wsId: string) => (await cloudRequest<Raw<IncomingHook>[]>('GET', wsPath(wsId, 'hooks'))).map(toHook)
export const createHook = async (wsId: string, databaseId: string) => toHook(await cloudRequest<Raw<IncomingHook>>('POST', wsPath(wsId, 'hooks'), { databaseId }))
export const regenerateHook = async (wsId: string, hookId: string) => toHook(await cloudRequest<Raw<IncomingHook>>('POST', wsPath(wsId, `hooks/${encodeURIComponent(hookId)}/regenerate`)))
export const deleteHook = (wsId: string, hookId: string) => cloudRequest<void>('DELETE', wsPath(wsId, `hooks/${encodeURIComponent(hookId)}`))

/* ------------------------------------------------------------------ recent MCP writes (team server pre-images, docs/MCP.md) */

/** One MCP call the team server kept pre-images of (14 days): what it made / changed, put back or not. */
export interface McpCallEntry {
  callId: string
  tool: string
  token: { id: string; name: string | null }
  at: number
  /** pages, databases and rows it made */
  made: number
  /** rows it changed, page texts it replaced */
  changed: number
  /** the first titles of what it made or changed (≤ 3) */
  titles: string[]
  restoredAt: number | null
}

/** A restore's answer: how many things went back; `left` = what the call made that stays (a forced restore never trashes). */
export interface McpRestore {
  restored: number
  left: Array<{ id: string; title: string }>
  note?: string
}

/** What moved since a call, per thing (a refused restore: 409 changed_since, docs/API.md). */
export type McpMovedWhat = 'text' | 'title' | 'values' | 'mark' | 'place' | 'below' | 'trash' | 'gone' | 'locked'
export interface McpChanged {
  changed: Array<{ id: string; title: string; what: McpMovedWhat[]; fields: string[] }>
  /** "Restore anyway" would put back the texts and fields the call changed (never for a call that only made things) */
  canForce: boolean
}

const WHATS: readonly McpMovedWhat[] = ['text', 'title', 'values', 'mark', 'place', 'below', 'trash', 'gone', 'locked']

/** The details of a refused restore (the error's `details`), checked; null when it is no such refusal. */
export function mcpChangedOf(e: unknown): McpChanged | null {
  if (!(e instanceof CloudError) || e.code !== 'changed_since') return null
  const d = (e.details ?? {}) as { changed?: unknown; canForce?: unknown }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const changed = (Array.isArray(d.changed) ? d.changed : []).flatMap((c) => {
    const x = (c ?? {}) as { id?: unknown; title?: unknown; what?: unknown; fields?: unknown }
    return typeof x.id === 'string' ? [{ id: x.id, title: typeof x.title === 'string' ? x.title : '', what: strings(x.what).filter((w): w is McpMovedWhat => (WHATS as readonly string[]).includes(w)), fields: strings(x.fields) }] : []
  })
  return { changed, canForce: d.canForce === true }
}

type RawCall = Omit<McpCallEntry, 'at' | 'restoredAt'> & { at: string; restoredAt: string | null }

export const listMcpCalls = async (wsId: string) =>
  (await cloudRequest<RawCall[]>('GET', wsPath(wsId, 'mcp-calls'))).map((c): McpCallEntry => ({
    ...c,
    titles: Array.isArray(c.titles) ? c.titles.filter((x) => typeof x === 'string') : [],
    made: Number(c.made) || 0,
    changed: Number(c.changed) || 0,
    at: ms(c.at) ?? Date.now(),
    restoredAt: ms(c.restoredAt),
  }))
export const restoreMcpCall = (wsId: string, callId: string, force = false) => cloudRequest<McpRestore>('POST', wsPath(wsId, `mcp-calls/${encodeURIComponent(callId)}/restore`), { force })

export const cloudApi = {
  requestSignIn,
  signOut,
  updateProfile,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  listMembers,
  setMemberRole,
  removeMember,
  createInvite,
  sendInvites,
  listInvites,
  revokeInvite,
  previewInvite,
  acceptInvite,
  listSignupLinks,
  createSignupLink,
  revokeSignupLink,
  previewSignupLink,
  uploadLocalWorkspace,
  switchWorkspace,
  removeDeviceCopy,
  listApiTokens,
  createApiToken,
  revokeApiToken,
  listHooks,
  createHook,
  regenerateHook,
  deleteHook,
  listMcpCalls,
  restoreMcpCall,
}

export type CloudApi = typeof cloudApi

/** Dev / ?e2e only: render any cloud state by hand (see the file header). */
export function installCloudDevHook(): void {
  if (typeof window === 'undefined') return
  const on = import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  if (!on) return
  ;(window as unknown as { __oneCloud?: unknown }).__oneCloud = {
    state: useCloud,
    CloudError,
    set: (patch: Partial<ReturnType<typeof useCloud.getState>>) => useCloud.setState(patch),
    mock: (over: Partial<CloudApi>) => Object.assign(cloudApi, over),
  }
}
