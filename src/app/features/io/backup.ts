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

/**
 * Pages of a subtree (incl. database rows), or the whole workspace. `topId` is the page that becomes
 * the backup's root: a single row travels with its database (schema, no sibling rows) so it restores
 * with its properties instead of as an orphan row.
 */
export function collectScope(rootId: ID | null): { pages: Record<ID, Page>; databases: Record<ID, Database>; topId: ID | null } {
  const s = useWorkspace.getState()
  if (!rootId) return { pages: s.pages, databases: s.databases, topId: null }
  const ids = [rootId, ...descendantIds(s.pages, rootId)]
  const pages: Record<ID, Page> = {}
  const databases: Record<ID, Database> = {}
  for (const id of ids) {
    const p = s.pages[id]
    if (!p || p.trashed) continue
    pages[id] = p
    if (s.databases[id]) databases[id] = s.databases[id]
  }
  let topId: ID | null = rootId
  const root = s.pages[rootId]
  const host = root?.databaseId ? s.pages[root.databaseId] : undefined
  if (pages[rootId] && host && !host.trashed && s.databases[host.id]) {
    pages[host.id] = host
    databases[host.id] = s.databases[host.id]
    topId = host.id
  }
  return { pages, databases, topId }
}

export async function buildBackup(rootId: ID | null, onProgress?: (done: number, total: number) => void): Promise<Backup> {
  const snap = getWorkspaceSnapshot()
  const { pages, databases, topId } = collectScope(rootId)
  const workspace: Workspace = {
    ...snap,
    pages: topId && pages[topId] ? { ...pages, [topId]: { ...pages[topId], parentId: null } } : pages,
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

export interface RestoreResult {
  /** page to open */
  target: ID | null
  mode: 'merge' | 'replace'
  /** pages (incl. databases and rows) that did not exist here */
  added: number
  /** pages that existed and were older here */
  updated: number
  /** pages skipped because the local copy is as new or newer */
  unchanged: number
  files: number
}

const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []): T[] => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))]

/**
 * Merge two versions of one database schema. The newer side leads; properties, options, views,
 * templates and automations that only the other side has are kept — rows of either side may use them.
 */
function mergeDatabase(local: Database, incoming: Database, incomingNewer: boolean): Database {
  const [lead, other] = incomingNewer ? [incoming, local] : [local, incoming]
  const properties = lead.properties.map((p) => {
    const o = other.properties.find((x) => x.id === p.id)
    return o?.options && p.options ? { ...p, options: byId(p.options, o.options) } : p
  })
  for (const p of other.properties) if (!properties.some((x) => x.id === p.id)) properties.push(p)
  return {
    ...lead,
    properties,
    views: byId(lead.views, other.views),
    nextUniqueId: Math.max(local.nextUniqueId ?? 1, incoming.nextUniqueId ?? 1),
    ...(lead.templates || other.templates ? { templates: byId(lead.templates, other.templates) } : {}),
    ...(lead.automations || other.automations ? { automations: byId(lead.automations, other.automations) } : {}),
  }
}

/** Restore files, remap their refs and apply the workspace. */
export async function applyBackup(b: Backup, mode: 'merge' | 'replace', onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const snap = getWorkspaceSnapshot()
  const source = migrate(JSON.parse(JSON.stringify(b.workspace)))

  // which pages survive? (merge: new ones + those newer than ours)
  const keep: Record<ID, Page> = {}
  let unchanged = 0
  for (const p of Object.values(source.pages)) {
    const cur = snap.pages[p.id]
    if (mode === 'merge' && cur && cur.updatedAt >= p.updatedAt) {
      unchanged++
      continue
    }
    keep[p.id] = p
  }
  const keptDbs: Record<ID, Database> = {}
  for (const [id, db] of Object.entries(source.databases)) {
    const local = snap.databases[id]
    if (mode === 'replace' || !local) keptDbs[id] = db
    else keptDbs[id] = mergeDatabase(local, db, !!keep[id])
  }

  // only files that the surviving pages / databases use
  let json = JSON.stringify({ pages: keep, databases: keptDbs })
  const refMap = await restoreFiles(b, json, onProgress)
  if (refMap.size) json = json.replace(REF_RE, (ref) => refMap.get(ref) ?? ref)
  const incoming = JSON.parse(json) as { pages: Record<ID, Page>; databases: Record<ID, Database> }

  // open editors must apply restored content: new rev, origin that is no editor's own id
  let added = 0
  let updated = 0
  for (const p of Object.values(incoming.pages)) {
    const cur = snap.pages[p.id]
    p.contentOrigin = 'import'
    if (cur) p.contentRev = Math.max(cur.contentRev, p.contentRev) + 1
    if (cur && mode === 'merge') updated++
    else added++
  }
  const store = useWorkspace.getState()
  const pages = mode === 'replace' ? incoming.pages : { ...snap.pages, ...incoming.pages }
  const databases = mode === 'replace' ? incoming.databases : { ...snap.databases, ...incoming.databases }
  // never leave invisible pages behind: a missing parent → top level; a row without its database → plain page
  for (const p of Object.values(incoming.pages)) {
    if (p.databaseId && !(databases[p.databaseId] && pages[p.databaseId])) {
      p.databaseId = null
      if (p.parentId && !pages[p.parentId]) p.parentId = null
    }
    if (p.parentId && !pages[p.parentId]) p.parentId = null
  }
  const files = new Set(refMap.values()).size

  if (mode === 'replace') {
    store.replaceAll({
      ...source,
      pages,
      databases,
      settings: { ...source.settings, aiApiKey: snap.settings.aiApiKey || source.settings.aiApiKey },
    })
    return { target: b.rootId ?? source.settings.startPageId ?? firstRoot(pages), mode, added, updated, unchanged, files }
  }

  const people = [...snap.people]
  for (const person of source.people) if (!people.some((x) => x.id === person.id)) people.push(person)
  store.replaceAll({ ...snap, pages, databases, people })
  const target = b.rootId && pages[b.rootId] ? b.rootId : firstRoot(incoming.pages) ?? firstRoot(source.pages)
  return { target, mode, added, updated, unchanged, files }
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
