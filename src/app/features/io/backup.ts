/**
 * JSON backup: the workspace (or a page subtree) plus every referenced IndexedDB file as base64.
 * Import modes: "merge" (upsert, newer updatedAt wins) or "replace" (swap the whole workspace).
 */
import { useWorkspace, getWorkspaceSnapshot, descendantIds } from '../../store/store'
import { migrate } from '../../store/persistence'
import type { Database, ID, Page, Workspace } from '../../store/types'
import { FILE_PREFIX, getFile, listFileRefs, readAsDataUrl, saveFile } from '../../lib/files'

export const BACKUP_FORMAT = 'simplecms-one-backup'

export interface BackupFileEntry {
  ref: string
  name: string
  type: string
  data: string
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt: string
  scope: 'workspace' | 'page'
  rootId: ID | null
  workspace: Workspace
  files: BackupFileEntry[]
}

const REF_RE = /onefile:[0-9a-z]+/g

/** Pages of a subtree (incl. database rows), or the whole workspace. */
export function collectScope(rootId: ID | null): { pages: Record<ID, Page>; databases: Record<ID, Database> } {
  const s = useWorkspace.getState()
  if (!rootId) return { pages: s.pages, databases: s.databases }
  const ids = [rootId, ...descendantIds(s.pages, rootId)]
  const pages: Record<ID, Page> = {}
  const databases: Record<ID, Database> = {}
  for (const id of ids) {
    const p = s.pages[id]
    if (!p || p.trashed) continue
    pages[id] = p
    if (s.databases[id]) databases[id] = s.databases[id]
  }
  return { pages, databases }
}

export async function buildBackup(rootId: ID | null, onProgress?: (done: number, total: number) => void): Promise<Backup> {
  const snap = getWorkspaceSnapshot()
  const { pages, databases } = collectScope(rootId)
  const workspace: Workspace = {
    ...snap,
    pages: rootId ? { ...pages, [rootId]: { ...pages[rootId], parentId: null } } : pages,
    databases,
    // never export the API key
    settings: { ...snap.settings, aiApiKey: '' },
    recent: rootId ? [] : snap.recent,
  }
  const json = JSON.stringify(workspace)
  const refs = rootId ? [...new Set(json.match(REF_RE) ?? [])] : await listFileRefs()
  const files: BackupFileEntry[] = []
  let done = 0
  for (const ref of refs) {
    const f = await getFile(ref)
    done++
    onProgress?.(done, refs.length)
    if (!f) continue
    const url = await readAsDataUrl(f.blob)
    files.push({ ref, name: f.name, type: f.type || 'application/octet-stream', data: url.slice(url.indexOf(',') + 1) })
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), scope: rootId ? 'page' : 'workspace', rootId, workspace, files }
}

/** Accepts a One backup or a bare workspace JSON. */
export function parseBackup(text: string): Backup | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Backup> & Partial<Workspace>
  if (o.format === BACKUP_FORMAT && o.workspace && typeof o.workspace.pages === 'object') {
    return { ...(o as Backup), files: Array.isArray(o.files) ? o.files : [] }
  }
  if (o.pages && typeof o.pages === 'object' && o.databases && typeof o.databases === 'object') {
    return { format: BACKUP_FORMAT, version: 1, exportedAt: '', scope: 'workspace', rootId: null, workspace: o as Workspace, files: [] }
  }
  return null
}

export function backupStats(b: Backup) {
  const pages = Object.values(b.workspace.pages ?? {})
  return {
    pages: pages.filter((p) => !p.databaseId && p.kind !== 'database').length,
    databases: pages.filter((p) => p.kind === 'database').length,
    rows: pages.filter((p) => !!p.databaseId).length,
    files: b.files.length,
  }
}

async function restoreFiles(b: Backup, onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let done = 0
  for (const f of b.files) {
    done++
    if (!f?.ref?.startsWith(FILE_PREFIX) || typeof f.data !== 'string') continue
    try {
      const blob = await (await fetch(`data:${f.type || 'application/octet-stream'};base64,${f.data}`)).blob()
      map.set(f.ref, await saveFile(blob, f.name || 'file'))
    } catch (e) {
      console.warn('[import] file restore failed', f.name, e)
    }
    onProgress?.(done, b.files.length)
  }
  return map
}

/** Restore files, remap their refs and apply the workspace. Returns the page to open. */
export async function applyBackup(b: Backup, mode: 'merge' | 'replace', onProgress?: (done: number, total: number) => void): Promise<ID | null> {
  const refMap = await restoreFiles(b, onProgress)
  let json = JSON.stringify(b.workspace)
  if (refMap.size) json = json.replace(REF_RE, (ref) => refMap.get(ref) ?? ref)
  const incoming = migrate(JSON.parse(json))
  const store = useWorkspace.getState()

  if (mode === 'replace') {
    const current = getWorkspaceSnapshot()
    store.replaceAll({
      ...incoming,
      settings: { ...incoming.settings, aiApiKey: current.settings.aiApiKey || incoming.settings.aiApiKey },
    })
    return b.rootId ?? incoming.settings.startPageId ?? firstRoot(incoming.pages)
  }

  const snap = getWorkspaceSnapshot()
  const pages = { ...snap.pages }
  const databases = { ...snap.databases }
  for (const p of Object.values(incoming.pages)) {
    const cur = pages[p.id]
    if (cur && cur.updatedAt >= p.updatedAt) continue
    // keep editors in sync: content written by the import
    pages[p.id] = cur ? { ...p, contentRev: Math.max(cur.contentRev, p.contentRev) + 1, contentOrigin: 'import' } : p
    if (incoming.databases[p.id]) databases[p.id] = incoming.databases[p.id]
  }
  for (const [id, db] of Object.entries(incoming.databases)) if (!databases[id]) databases[id] = db
  const people = [...snap.people]
  for (const person of incoming.people) if (!people.some((x) => x.id === person.id)) people.push(person)
  store.replaceAll({ ...snap, pages, databases, people })
  return b.rootId ?? firstRoot(incoming.pages)
}

function firstRoot(pages: Record<ID, Page>): ID | null {
  const roots = Object.values(pages)
    .filter((p) => !p.parentId && !p.trashed)
    .sort((a, b) => a.order - b.order)
  return roots[0]?.id ?? null
}
