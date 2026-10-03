/**
 * This device's sync data, per workspace (IndexedDB `one-sync` / `kv`):
 *   folder:<ws>          → the picked FileSystemDirectoryHandle
 *   manifest:<target>:<ws> → Manifest (what was written where)
 *   github:<ws>          → GitHubConfig — its `token` is a vault marker: the token itself is
 *                          sealed in this browser's vault (lib/vault.ts, name "github-token",
 *                          scope <ws>) and only github.ts opens it, per request
 *   status:<target>:<ws> → TargetStatus (last run, counts, error)
 *   log:<ws>             → LogEntry[] (newest first)
 * Nothing here is part of the workspace: no export, backup, share link or team sync carries it.
 */
import { createStore, del, get, set, update, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'
import { clearSecret, isSecretMarker, newSecretMarker, openSecret, sealSecret, vaultAvailable } from '../../lib/vault'
import { defaultGitHubConfig, emptyManifest, emptyStatus, type GitHubConfig, type LogEntry, type Manifest, type TargetKind, type TargetStatus } from './types'

let store: UseStore | undefined
function db(): UseStore | undefined {
  if (!store && typeof indexedDB !== 'undefined') store = createStore('one-sync', 'kv')
  return store
}

/** "local:local" / "cloud:<id>" */
export function wsKey(): string {
  const ws = activeWorkspace()
  return `${ws.kind}:${ws.id}`
}

const k = (name: string) => `${name}:${wsKey()}`

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(k('folder'), db())
}

export async function saveFolderHandle(h: FileSystemDirectoryHandle | null): Promise<void> {
  if (h) await set(k('folder'), h, db())
  else await del(k('folder'), db())
}

export async function loadManifest(target: TargetKind): Promise<Manifest> {
  return (await get<Manifest>(k(`manifest:${target}`), db())) ?? emptyManifest()
}

export async function saveManifest(target: TargetKind, m: Manifest | null): Promise<void> {
  if (m) await set(k(`manifest:${target}`), m, db())
  else await del(k(`manifest:${target}`), db())
}

/* ------------------------------------------------------------------ GitHub token (sealed) */

const TOKEN_SECRET = 'github-token'
/** marker → token: this tab's memory only, for the session */
const tokens = new Map<string, string>()

/**
 * Seal a GitHub token into the vault (this workspace) and resolve the marker the config keeps
 * instead. Without WebCrypto (plain http) the token is kept for this session only.
 */
export async function sealGitHubToken(token: string): Promise<string> {
  const t = token.trim()
  const marker = newSecretMarker(t)
  tokens.set(marker, t)
  if (vaultAvailable()) await sealSecret(TOKEN_SECRET, t, wsKey()).catch((e) => console.warn('[one] the GitHub token could not be stored encrypted', e instanceof Error ? e.message : e))
  return marker
}

/** The token behind a config's `token` (a marker → decrypted; '' when it is gone). github.ts only. */
export async function openGitHubToken(value: string): Promise<string> {
  const v = value.trim()
  if (!isSecretMarker(v)) return v
  const known = tokens.get(v)
  if (known) return known
  const t = await openSecret(TOKEN_SECRET, wsKey())
  if (t !== null) tokens.set(v, t)
  return t ?? ''
}

export async function loadGitHubConfig(): Promise<GitHubConfig> {
  const c = { ...defaultGitHubConfig(), ...((await get<Partial<GitHubConfig>>(k('github'), db())) ?? {}) }
  const plain = c.token.trim()
  // stored in plaintext by an older version: sealed now, the plaintext replaced by its marker
  if (plain && !isSecretMarker(plain) && vaultAvailable()) {
    const marker = newSecretMarker(plain)
    try {
      await sealSecret(TOKEN_SECRET, plain, wsKey())
      tokens.set(marker, plain)
      // compare-and-swap: a config another tab saved meanwhile stays as it is
      await update<Partial<GitHubConfig>>(k('github'), (old) => (old?.token === c.token ? { ...old, token: marker } : old) as Partial<GitHubConfig>, db())
      c.token = marker
    } catch (e) {
      console.warn('[one] could not migrate the stored GitHub token', e instanceof Error ? e.message : e)
    }
  }
  return c
}

/** Store the config; a plaintext `token` is sealed first ('' removes the sealed token). */
export async function saveGitHubConfig(c: GitHubConfig): Promise<void> {
  const token = c.token.trim()
  if (!token) {
    tokens.clear()
    await clearSecret(TOKEN_SECRET, wsKey()).catch(() => {})
  }
  const stored = token && !isSecretMarker(token) ? { ...c, token: await sealGitHubToken(token) } : c
  await set(k('github'), stored, db())
}

export async function loadStatus(target: TargetKind): Promise<TargetStatus> {
  return { ...emptyStatus(), ...((await get<TargetStatus>(k(`status:${target}`), db())) ?? {}) }
}

export async function saveStatus(target: TargetKind, s: TargetStatus | null): Promise<void> {
  if (s) await set(k(`status:${target}`), s, db())
  else await del(k(`status:${target}`), db())
}

const LOG_MAX = 30

export async function loadLog(): Promise<LogEntry[]> {
  return (await get<LogEntry[]>(k('log'), db())) ?? []
}

export async function appendLog(entry: LogEntry): Promise<LogEntry[]> {
  const next = [entry, ...(await loadLog())].slice(0, LOG_MAX)
  await set(k('log'), next, db())
  return next
}

export async function clearTarget(target: TargetKind): Promise<void> {
  await saveManifest(target, null)
  await saveStatus(target, null)
  if (target === 'folder') await saveFolderHandle(null)
}
