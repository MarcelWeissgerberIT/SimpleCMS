/** Local workspace catalogue. Existing data stays in its original database; every additional workspace gets its own. */
import { createStore, get, set, update } from 'idb-keyval'
import { newId } from '../lib/ids'
import { localDatabase, localStorageId, LOCAL_ID } from '../lib/localWorkspace'
import type { Workspace } from './types'

export interface LocalWorkspace { id: string; name: string; createdAt: number }
const catalog = createStore('one-workspaces', 'kv')
const db = () => catalog
const listeners = new Set<() => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-workspaces') : null
channel?.addEventListener('message', () => listeners.forEach(fn => fn()))
export function onLocalWorkspacesChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
export async function localWorkspaces(): Promise<LocalWorkspace[]> {
  const all = await get<Record<string, LocalWorkspace>>('catalog', db()) ?? {}
  return [{ id: 'local', name: all.local?.name || 'One', createdAt: 0 }, ...Object.values(all).filter(w => w.id !== 'local' && LOCAL_ID.test(w.id))].sort((a, b) => a.createdAt - b.createdAt)
}
export async function rememberLocalWorkspace(name: string, id = localStorageId): Promise<void> {
  await update<Record<string, LocalWorkspace>>('catalog', cur => ({ ...cur, [id]: { id, name, createdAt: cur?.[id]?.createdAt ?? (id === 'local' ? 0 : Date.now()) } }), db())
  listeners.forEach(fn => fn())
  channel?.postMessage('changed')
}
export async function createLocalWorkspace(name: string, workspace: Workspace, pending?: unknown): Promise<string> {
  const id = newId()
  // Commit content before publishing the catalogue entry. Failures never select an empty or half-created workspace.
  await set('one.workspace.v1', workspace, createStore(localDatabase(id), 'keyval'))
  if (pending) await set(`pending:${id}`, pending, db())
  await rememberLocalWorkspace(name, id)
  return id
}
export async function pendingWorkspace(): Promise<unknown> { return get(`pending:${localStorageId}`, db()) }
export async function finishWorkspaceImport(): Promise<void> {
  const { del } = await import('idb-keyval')
  await del(`pending:${localStorageId}`, db())
}
