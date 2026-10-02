/**
 * JSON backup: the workspace (or a page subtree) plus every referenced IndexedDB file as base64.
 * Import modes: "merge" (upsert, newer updatedAt wins) or "replace" (swap the whole workspace).
 * Only files referenced by the restored pages are written; files already on this device are reused.
 */
import { useWorkspace, getWorkspaceSnapshot, descendantIds } from '../../store/store'
import { migrate } from '../../store/persistence'
import type { Database, ID, Page, Workspace } from '../../store/types'
import { FILE_PREFIX, getFile, readAsDataUrl, saveFile } from '../../lib/files'

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
  // only files that are referenced (no orphans from deleted pages or earlier merges)
  const refs = [...new Set(JSON.stringify({ pages: workspace.pages, databases }).match(REF_RE) ?? [])]
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

/**
 * Restore the backup files that `json` references. A file that already exists here under the same
 * ref (backup made on this device) is reused instead of being stored a second time.
 */
async function restoreFiles(b: Backup, json: string, onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> {
  const used = new Set(json.match(REF_RE) ?? [])
  const list = b.files.filter((f) => f?.ref?.startsWith(FILE_PREFIX) && typeof f.data === 'string' && used.has(f.ref))
  const map = new Map<string, string>()
  let done = 0
  for (const f of list) {
    done++
    try {
      const existing = await getFile(f.ref)
      if (existing && existing.size === Math.floor((f.data.replace(/=+$/, '').length * 3) / 4)) map.set(f.ref, f.ref)
      else {
        const blob = await (await fetch(`data:${f.type || 'application/octet-stream'};base64,${f.data}`)).blob()
        map.set(f.ref, await saveFile(blob, f.name || 'file'))
      }
    } catch (e) {
      console.warn('[import] file restore failed', f.name, e)
    }
    onProgress?.(done, list.length)
  }
  return map
}

/** Restore files, remap their refs and apply the workspace. Returns the page to open. */
export async function applyBackup(b: Backup, mode: 'merge' | 'replace', onProgress?: (done: number, total: number) => void): Promise<ID | null> {
  const snap = getWorkspaceSnapshot()
  const source = migrate(JSON.parse(JSON.stringify(b.workspace)))

  // which pages survive? (merge: new ones + those newer than ours)
  const keep: Record<ID, Page> = {}
  for (const p of Object.values(source.pages)) {
    const cur = snap.pages[p.id]
    if (mode === 'merge' && cur && cur.updatedAt >= p.updatedAt) continue
    keep[p.id] = p
  }
  const keptDbs: Record<ID, Database> = {}
  for (const [id, db] of Object.entries(source.databases)) if (keep[id] || mode === 'replace' || !snap.databases[id]) keptDbs[id] = db

  // only files that the surviving pages / databases use
  let json = JSON.stringify({ pages: keep, databases: keptDbs })
  const refMap = await restoreFiles(b, json, onProgress)
  if (refMap.size) json = json.replace(REF_RE, (ref) => refMap.get(ref) ?? ref)
  const incoming = JSON.parse(json) as { pages: Record<ID, Page>; databases: Record<ID, Database> }

  // open editors must apply restored content: new rev, origin that is no editor's own id
  for (const p of Object.values(incoming.pages)) {
    const cur = snap.pages[p.id]
    p.contentOrigin = 'import'
    if (cur) p.contentRev = Math.max(cur.contentRev, p.contentRev) + 1
  }
  const store = useWorkspace.getState()

  if (mode === 'replace') {
    store.replaceAll({
      ...source,
      pages: incoming.pages,
      databases: incoming.databases,
      settings: { ...source.settings, aiApiKey: snap.settings.aiApiKey || source.settings.aiApiKey },
    })
    return b.rootId ?? source.settings.startPageId ?? firstRoot(incoming.pages)
  }

  const people = [...snap.people]
  for (const person of source.people) if (!people.some((x) => x.id === person.id)) people.push(person)
  store.replaceAll({ ...snap, pages: { ...snap.pages, ...incoming.pages }, databases: { ...snap.databases, ...incoming.databases }, people })
  return b.rootId ?? firstRoot(source.pages)
}

/** Files a backup of this scope will contain (only ones the exported pages reference). */
export function backupFileRefs(rootId: ID | null): string[] {
  const { pages, databases } = collectScope(rootId)
  return [...new Set(JSON.stringify({ pages, databases }).match(REF_RE) ?? [])]
}

function firstRoot(pages: Record<ID, Page>): ID | null {
  const roots = Object.values(pages)
    .filter((p) => !p.parentId && !p.trashed)
    .sort((a, b) => a.order - b.order)
  return roots[0]?.id ?? null
}
