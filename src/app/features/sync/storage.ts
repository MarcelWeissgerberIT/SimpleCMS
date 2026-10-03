/**
 * This device's sync data, per workspace (IndexedDB `one-sync` / `kv`):
 *   folder:<ws>          → the picked FileSystemDirectoryHandle
 *   manifest:<target>:<ws> → Manifest (what was written where)
 *   github:<ws>          → GitHubConfig (incl. the token — never leaves this browser)
 *   status:<target>:<ws> → TargetStatus (last run, counts, error)
 *   log:<ws>             → LogEntry[] (newest first)
 * Nothing here is part of the workspace: no export, backup, share link or team sync carries it.
 */
import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'
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

export async function loadGitHubConfig(): Promise<GitHubConfig> {
  return { ...defaultGitHubConfig(), ...((await get<Partial<GitHubConfig>>(k('github'), db())) ?? {}) }
}

export async function saveGitHubConfig(c: GitHubConfig): Promise<void> {
  await set(k('github'), c, db())
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
