/**
 * One MCP — which workspace this tab serves, by a stable id (names are for people, ids route):
 *  - a team workspace: 'team:<cloud workspace id>'
 *  - the local workspace: 'local:<11 chars>' — a hash of this browser's device id (localStorage
 *    'one.mcp.device', per browser profile and site, like the workspace's IndexedDB) and the
 *    workspace's epoch: the same for every tab and reload of this browser, new after an erase, never a
 *    secret and nothing of the content.
 *
 * `workspaceInfo()` is what hello / status report. `currentWorkspace()` is what a call is checked
 * against right before it runs: null while the tab is between workspaces (a team workspace that is
 * still being chosen, signed out, removed, or whose data is not the store's) — nothing runs then.
 */
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { newId } from '../../lib/ids'

export interface McpIdentity {
  id: string
  name: string
  kind: 'local' | 'team'
  readOnly: boolean
}

const DEVICE_KEY = 'one.mcp.device'
const DEVICE_RE = /^[0-9a-z]{12}$/
let memoryDevice: string | null = null

/** This browser's device id for the local workspace id (created once). */
function deviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_KEY)
    if (stored && DEVICE_RE.test(stored)) return stored
    const fresh = newId()
    window.localStorage.setItem(DEVICE_KEY, fresh)
    return fresh
  } catch {
    // no storage (private mode): an id for this tab only — never one shared with another workspace
    return (memoryDevice ??= newId())
  }
}

/** cyrb53: a short, well-mixed, stable hash (not a secret, not a security boundary). */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0')
}

/** The id of this browser's local workspace. */
export function localWorkspaceId(): string {
  return `local:${hash53(`${deviceId()}/${useWorkspace.getState().epoch ?? 'legacy'}`)}`
}

/** A name as agents see it: no control characters, trimmed, at most 120 characters. */
export const cleanName = (s: string | null | undefined, fallback: string) =>
  (s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || fallback

/** The workspace this tab shows (hello / status). Role: the team role, null locally. */
export function workspaceInfo(): McpIdentity & { role: string | null } {
  const c = useCloud.getState()
  const ws = useWorkspace.getState()
  if (c.active.kind === 'cloud') {
    const id = c.active.id
    const name = cleanName(c.workspaces.find((w) => w.id === id)?.name ?? ws.settings.workspaceName, 'Team workspace')
    return { id: `team:${id}`, name, kind: 'team', readOnly: c.readOnly, role: c.role }
  }
  return { id: localWorkspaceId(), name: cleanName(ws.settings.workspaceName, 'One'), kind: 'local', readOnly: false, role: null }
}

/**
 * The workspace a call may run in right now — null while the tab is between workspaces. The store
 * must hold that very workspace: a team workspace's data carries the epoch 'cloud:<id>'.
 */
export function currentWorkspace(): McpIdentity | null {
  const c = useCloud.getState()
  const ws = useWorkspace.getState()
  if (!ws.ready) return null
  const epoch = ws.epoch ?? ''
  if (c.active.kind === 'cloud') {
    if (c.status === 'checking' || c.status === 'signed-out' || c.status === 'error') return null
    if (epoch !== `cloud:${c.active.id}`) return null
  } else if (epoch.startsWith('cloud:')) return null
  const { role: _role, ...info } = workspaceInfo()
  return info
}

/** "team:7f3c2a…" — the short form the settings show. */
export const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 14)}…` : id)
