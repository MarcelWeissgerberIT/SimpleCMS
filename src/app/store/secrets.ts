/**
 * The Claude API key in the store: `settings.aiApiKey` holds a vault MARKER ("vault:<seal id>:<last 4>",
 * lib/vault.ts) — never the key. Every reader that only asks "is a key set?" keeps working with
 * `!!settings.aiApiKey`; the AI client asks getAIKey() for the key itself, per request.
 *
 *  - In: updateSettings({ aiApiKey: <key> }) (and hydrate / replaceAll / cloudPatch, which bring
 *    settings from storage, another tab, a backup or a team workspace overlay) put the marker into the
 *    store at once and seal the key in the background (vault scope = the workspace: "local:local" or
 *    "cloud:<id>"). '' through updateSettings removes the sealed key too.
 *  - Out: getAIKey() decrypts on demand and keeps the key in this module's memory for the session
 *    only (keyed by marker): not in the store, not in devtools-visible state, never persisted.
 *  - Migration: a plaintext key from an older version is sealed and replaced by its marker where it is
 *    stored — the local workspace by loadWorkspace() / sealStoredKey() (persistence.ts), a team
 *    workspace's device overlay when it is opened (hydrate → the overlay is written again).
 *  - A team workspace starts with the local workspace's settings on this device (cloud/workspace.ts):
 *    its marker then opens the local workspace's sealed key, which is sealed for the team workspace too.
 *  - A marker whose key is gone (another profile's copy, a vault erased by the browser) is cleared,
 *    so the UI asks for the key again instead of failing on every request.
 */
import { clearSecret, hintOf, isSecretMarker, markerHint, newSecretMarker, openSecret, sealSecret, vaultAvailable } from '../lib/vault'
import type { WorkspaceState } from './store'
import type { McpServerConfig, Settings } from './types'

/** Vault name of the Claude API key. */
export const AI_KEY_SECRET = 'claude-api-key'
/** Vault scope of the local workspace (the same "<kind>:<id>" form as the sync keys). */
export const LOCAL_SCOPE = 'local:local'

/** The vault scope of a workspace: team workspaces are hydrated with epoch "cloud:<id>" (cloud/workspace.ts). */
export function scopeOf(epoch: string | undefined): string {
  return epoch?.startsWith('cloud:') ? epoch : LOCAL_SCOPE
}

interface StoreHandle {
  getState: () => WorkspaceState
  /** a raw change (no settings interception) */
  setState: (recipe: (s: WorkspaceState) => void) => void
}

let store: StoreHandle | null = null

/** store.ts, once: the handle the key's background work (migration, cleanup) writes through. */
export function attachSecrets(handle: StoreHandle): void {
  store = handle
}

/** marker → key: this tab's memory only, for the session */
const keys = new Map<string, string>()
/** marker → its seal, still running */
const sealing = new Map<string, Promise<void>>()

const warn = (what: string) => (e: unknown) => console.warn(`[one] ${what}`, e instanceof Error ? e.message : e)

/** Put `marker` → `key` into memory and seal it as `name`; resolves true once it is stored encrypted. */
function seal(marker: string, key: string, scope: string, name = AI_KEY_SECRET): Promise<boolean> {
  keys.set(marker, key)
  if (!vaultAvailable()) return Promise.resolve(false)
  const job = sealSecret(name, key, scope)
  sealing.set(marker, job)
  return job.then(
    () => true,
    (e) => {
      warn(`${name === AI_KEY_SECRET ? 'the Claude API key' : 'an MCP server token'} could not be stored encrypted`)(e)
      return false
    },
  ).finally(() => sealing.delete(marker))
}

/**
 * What the store keeps for an incoming `settings.aiApiKey`. `user`: an explicit change
 * (updateSettings) — '' then removes the sealed key; otherwise the value comes from storage,
 * another tab, a backup or an overlay, and a plaintext key in it is migrated.
 */
export function aiKeyValue(value: unknown, current: string, epoch: string | undefined, user: boolean): string {
  const v = typeof value === 'string' ? value.trim() : ''
  const scope = scopeOf(epoch)
  if (!v) {
    if (user && current) {
      keys.delete(current)
      void clearSecret(AI_KEY_SECRET, scope).catch(warn('the Claude API key could not be removed from the vault'))
    }
    return ''
  }
  if (isSecretMarker(v)) return v
  // an older version's plaintext that can't be encrypted here (no WebCrypto: plain http): leave it be
  if (!user && !vaultAvailable()) return v
  const marker = newSecretMarker(v)
  void seal(marker, v, scope).then((ok) => {
    if (user) return
    const s = store?.getState()
    if (!s || s.settings.aiApiKey !== marker) return
    if (ok) {
      // migrated: a fresh settings object, so whoever stores settings (a team overlay) writes the marker
      store?.setState((st) => void (st.settings = { ...st.settings }))
    } else {
      // could not encrypt: keep the key as it was rather than lose it
      store?.setState((st) => void (st.settings.aiApiKey = v))
    }
  })
  return marker
}

/** `settings` with its aiApiKey as the store keeps it (the same object when nothing changes). */
export function withSealedKey(settings: Settings, current: string, epoch: string | undefined): Settings {
  const v = aiKeyValue(settings.aiApiKey, current, epoch, false)
  return v === settings.aiApiKey ? settings : { ...settings, aiApiKey: v }
}

/** The secret `name` behind `marker` in `scope` (memory, then the vault; a team workspace may inherit the local one). */
async function resolve(marker: string, scope: string, name = AI_KEY_SECRET): Promise<string | null> {
  const known = keys.get(marker)
  if (known) return known
  await sealing.get(marker)
  let key = await openSecret(name, scope)
  if (key === null && scope !== LOCAL_SCOPE) {
    // this team workspace started with the local workspace's settings: the same secret, sealed for "local"
    const local = await openSecret(name, LOCAL_SCOPE)
    if (local !== null && hintOf(local) === markerHint(marker)) {
      key = local
      await sealSecret(name, local, scope).catch(warn('a secret could not be stored encrypted'))
    }
  }
  if (key !== null) keys.set(marker, key)
  return key
}

/** The marker points at nothing (and still is the store's): clear it, so the UI asks for the key again. */
function dropMarker(marker: string): void {
  if (!vaultAvailable()) return // can't tell: another tab may hold it for its session
  const s = store?.getState()
  if (s?.settings.aiApiKey !== marker) return
  console.warn('[one] the stored Claude API key is not available in this browser any more — enter it again in Settings → Claude AI')
  s.updateSettings({ aiApiKey: '' })
}

/**
 * The Claude API key for a request ('' = none). Decrypted on demand; kept in this module's memory
 * for the session only. Only the AI client (features/ai/client.ts) calls this.
 */
export async function getAIKey(): Promise<string> {
  const s = store?.getState()
  const v = s?.settings.aiApiKey.trim() ?? ''
  if (!s || !v) return ''
  if (!isSecretMarker(v)) return v // an older version's plaintext this browser can't encrypt
  const key = await resolve(v, scopeOf(s.epoch))
  if (key === null) dropMarker(v)
  return key ?? ''
}

/** The stored local workspace's key (persistence.ts registers it): for tabs that did not load it. */
let storedKeyMigration: (() => Promise<unknown>) | null = null
export function setStoredKeyMigration(fn: () => Promise<unknown>): void {
  storedKeyMigration = fn
}

/**
 * After a workspace was loaded into the store (hydrate): migrate the stored local key (a tab that
 * opened a team workspace never runs loadWorkspace()), then check that the marker still opens.
 */
export async function checkAIKey(): Promise<void> {
  await storedKeyMigration?.().catch(warn('could not migrate the stored Claude API key'))
  const s = store?.getState()
  const v = s?.settings.aiApiKey ?? ''
  if (!s || !isSecretMarker(v)) return
  const key = await resolve(v, scopeOf(s.epoch)).catch(() => undefined)
  if (key === null) dropMarker(v)
}

/**
 * Seal a plaintext key that was stored before the vault (persistence.ts). Resolves the marker that
 * replaces it, or null when it could not be encrypted (then the plaintext stays where it is).
 */
export async function sealStoredAIKey(key: string, scope: string): Promise<string | null> {
  const marker = newSecretMarker(key)
  return (await seal(marker, key, scope)) ? marker : null
}

/* ------------------------------------------------------------------ */
/* MCP server tokens                                                   */
/* ------------------------------------------------------------------ */

/*
 * `settings.mcpServers[].token` holds a vault marker like the Claude key, sealed per server as
 * "mcp-token:<server id>" in the workspace's scope. Only updateSettings({ mcpServers }) writes the
 * list: a plaintext token in it is sealed there and replaced by its marker; a token that was removed
 * (and every token of a removed server) leaves the vault. Only the AI client opens a token, per
 * request (getMcpToken) — it goes to api.anthropic.com inside `mcp_servers` and nowhere else.
 */

/** Vault name of an MCP server's bearer token. */
export const mcpTokenSecret = (serverId: string) => `mcp-token:${serverId}`

/** What the store keeps for an incoming `settings.mcpServers` (updateSettings): tokens as markers only. */
export function mcpServersValue(value: unknown, current: McpServerConfig[] | undefined, epoch: string | undefined): McpServerConfig[] | undefined {
  const scope = scopeOf(epoch)
  const before = new Map((current ?? []).map((s) => [s.id, s]))
  const drop = (id: string, marker: string) => {
    keys.delete(marker)
    void clearSecret(mcpTokenSecret(id), scope).catch(warn('an MCP server token could not be removed from the vault'))
  }
  const list = Array.isArray(value) ? value.filter((s): s is McpServerConfig => !!s && typeof s === 'object' && typeof s.id === 'string' && !!s.id) : undefined
  const kept = new Set(list?.map((s) => s.id))
  for (const old of before.values()) if (!kept.has(old.id) && isSecretMarker(old.token)) drop(old.id, old.token)
  if (!list) return undefined
  return list.map((s) => {
    const v = typeof s.token === 'string' ? s.token.trim() : ''
    const old = before.get(s.id)?.token ?? ''
    if (!v) {
      if (isSecretMarker(old)) drop(s.id, old)
      return { ...s, token: '' }
    }
    if (isSecretMarker(v)) return v === s.token ? s : { ...s, token: v }
    // a new token: sealed now (memory at once, the vault in the background); the list keeps its marker
    const marker = newSecretMarker(v)
    void seal(marker, v, scope, mcpTokenSecret(s.id))
    return { ...s, token: marker }
  })
}

/**
 * The bearer token of an MCP server for one request: '' = the server has none, null = it has one,
 * but this browser cannot open it (another device's settings, a cleared vault) — ask for it again.
 */
export async function getMcpToken(server: Pick<McpServerConfig, 'id' | 'token'>): Promise<string | null> {
  const v = typeof server.token === 'string' ? server.token.trim() : ''
  if (!v) return ''
  // the list never holds a plaintext (mcpServersValue): anything else is unusable
  if (!isSecretMarker(v)) return null
  return resolve(v, scopeOf(store?.getState().epoch), mcpTokenSecret(server.id)).catch(() => null)
}
