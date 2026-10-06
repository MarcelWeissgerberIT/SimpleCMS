/**
 * JSON backup: the workspace (or a page subtree) plus every referenced IndexedDB file as base64.
 * Import modes: "merge" (upsert, newer updatedAt wins) or "replace" (swap the whole workspace).
 * Only files referenced by the restored pages are written; files already on this device are reused.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace, getWorkspaceSnapshot, descendantIds, defaultSettings } from '../../store/store'
import { migrate } from '../../store/persistence'
import { COLOR_NAMES, type Database, type ID, type Kit, type KitEntry, type Page, type Settings, type Workspace } from '../../store/types'
import { emptyKit } from '../../store/kit'
import { FILE_PREFIX, getFile, readAsDataUrl, saveFile } from '../../lib/files'
import { newId } from '../../lib/ids'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { withoutCommandSecrets } from '../commands'

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

/**
 * Webhook URLs and headers are bearer secrets (Slack, Zapier, n8n …). A page backup is what people
 * pass around as a template, so it carries the automations without them — switched off until the
 * new owner adds their own endpoint. Full backups keep everything: they are the user's own restore.
 */
export function withoutWebhookSecrets(db: Database): Database {
  if (!db.automations?.some((a) => a.actions.some((x) => x.type === 'webhook'))) return db
  return {
    ...db,
    automations: db.automations.map((a) =>
      a.actions.some((x) => x.type === 'webhook')
        ? {
            ...a,
            enabled: false,
            lastRunAt: null,
            lastStatus: null,
            lastMessage: null,
            actions: a.actions.map((x) => (x.type === 'webhook' ? { type: 'webhook' as const, method: x.method, url: '' } : x)),
          }
        : a,
    ),
  }
}

export async function buildBackup(rootId: ID | null, onProgress?: (done: number, total: number) => void): Promise<Backup> {
  const snap = getWorkspaceSnapshot()
  const scoped = collectScope(rootId)
  const { pages, topId } = scoped
  // (database commands' webhooks too: features/commands)
  const databases = rootId ? Object.fromEntries(Object.entries(scoped.databases).map(([id, db]) => [id, withoutCommandSecrets(withoutWebhookSecrets(db))])) : scoped.databases
  const workspace: Workspace = {
    ...snap,
    pages: topId && pages[topId] ? { ...pages, [topId]: { ...pages[topId], parentId: null } } : pages,
    databases,
    // never export the API key, nor the MCP servers' token markers
    settings: { ...snap.settings, aiApiKey: '', ...(snap.settings.mcpServers ? { mcpServers: snap.settings.mcpServers.map((s) => ({ ...s, token: '' })) } : {}) },
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

/* ---------------- untrusted input: ids and settings ---------------- */

/** Ids end up in element ids, links and selectors — only plain tokens are accepted. */
const SAFE_ID = /^[\w-]{1,64}$/

function walkDoc(node: JSONContent | null | undefined, fix: (v: unknown, key: string) => unknown) {
  if (!node || typeof node !== 'object') return
  for (const holder of [node, ...(Array.isArray(node.marks) ? node.marks : [])]) {
    const attrs = holder?.attrs
    if (attrs && typeof attrs === 'object') for (const k of Object.keys(attrs)) attrs[k] = fix(attrs[k], k)
  }
  if (Array.isArray(node.content)) for (const child of node.content) walkDoc(child, fix)
}

/**
 * A backup (or a bare workspace JSON) may come from anywhere: page and database ids that are not
 * plain tokens get fresh ids, and every reference to them — parents, rows, relations, page links,
 * mentions, database blocks, link hrefs, start page, recents — is remapped. Returns the root id.
 */
function sanitizeIds(ws: Workspace, rootId: ID | null): ID | null {
  const map = new Map<ID, ID>()
  for (const id of [...Object.keys(ws.pages), ...Object.keys(ws.databases)]) if (!SAFE_ID.test(id) && !map.has(id)) map.set(id, newId())
  if (!map.size) return rootId
  const re = <T>(v: T): T => (typeof v === 'string' && map.has(v) ? (map.get(v) as T) : v)
  const reList = (v: unknown) => (Array.isArray(v) ? v.map(re) : re(v))
  const fixAttr = (v: unknown, key: string) => {
    if (key === 'href' && typeof v === 'string' && v.startsWith('#/p/')) {
      const [id, rest] = [v.slice(4).split('?')[0], v.slice(4).includes('?') ? v.slice(v.indexOf('?')) : '']
      return map.has(id) ? `#/p/${map.get(id)}${rest}` : v
    }
    return reList(v)
  }
  const fixValues = (props: Record<ID, unknown> | undefined) => {
    if (props) for (const k of Object.keys(props)) props[k] = reList(props[k])
  }
  const pages: Record<ID, Page> = {}
  for (const p of Object.values(ws.pages)) {
    p.id = re(p.id)
    p.parentId = re(p.parentId)
    p.databaseId = re(p.databaseId)
    fixValues(p.properties)
    walkDoc(p.content, fixAttr)
    pages[p.id] = p
  }
  const databases: Record<ID, Database> = {}
  for (const db of Object.values(ws.databases)) {
    db.id = re(db.id)
    for (const prop of db.properties) prop.relationDatabaseId = re(prop.relationDatabaseId)
    for (const tpl of db.templates ?? []) {
      walkDoc(tpl.content, fixAttr)
      fixValues(tpl.properties)
    }
    databases[db.id] = db
  }
  ws.pages = pages
  ws.databases = databases
  ws.settings.startPageId = re(ws.settings.startPageId)
  ws.settings.lastPageId = re(ws.settings.lastPageId)
  ws.recent = ws.recent.map(re)
  return re(rootId)
}

/** Settings of a backup, reduced to known keys of the right type; language and theme whitelisted. */
function sanitizeSettings(incoming: Settings, current: Settings): Settings {
  const out = { ...current }
  const base = defaultSettings() as unknown as Record<string, unknown>
  const src = incoming as unknown as Record<string, unknown>
  const dst = out as unknown as Record<string, unknown>
  for (const key of Object.keys(base)) {
    const v = src[key]
    const nullable = key === 'startPageId' || key === 'lastPageId'
    if (typeof v === typeof base[key] && (typeof v !== 'number' || Number.isFinite(v))) dst[key] = v
    else if (nullable && (v === null || typeof v === 'string')) dst[key] = v
  }
  if (out.language !== 'en' && out.language !== 'de') out.language = current.language
  if (out.theme !== 'light' && out.theme !== 'dark' && out.theme !== 'system') out.theme = current.theme
  if (typeof out.startPageId === 'string' && !SAFE_ID.test(out.startPageId)) out.startPageId = null
  if (typeof out.lastPageId === 'string' && !SAFE_ID.test(out.lastPageId)) out.lastPageId = null
  return out
}

/** Restore files, remap their refs and apply the workspace. */
export async function applyBackup(b: Backup, mode: 'merge' | 'replace', onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  // a team workspace: viewers can't write, and "replace" would swap it out for everyone in it
  const cloud = useCloud.getState()
  if (cloud.readOnly) throw new Error(t('features.io.err.viewOnly'))
  if (mode === 'replace' && cloud.active.kind === 'cloud') throw new Error(t('features.io.err.replaceTeam'))
  const snap = getWorkspaceSnapshot()
  const source = migrate(JSON.parse(JSON.stringify(b.workspace)))
  const rootId = sanitizeIds(source, typeof b.rootId === 'string' ? b.rootId : null)
  source.settings = sanitizeSettings(source.settings, snap.settings)
  source.people = source.people
    .filter((x) => typeof x.id === 'string' && SAFE_ID.test(x.id))
    .map((x) => ({ ...x, name: String(x.name ?? ''), color: COLOR_NAMES.includes(x.color) ? x.color : 'gray' }))

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
    return { target: rootId ?? source.settings.startPageId ?? firstRoot(pages), mode, added, updated, unchanged, files }
  }

  const people = [...snap.people]
  for (const person of source.people) if (!people.some((x) => x.id === person.id)) people.push(person)
  store.replaceAll({ ...snap, pages, databases, people, functions: mergeFunctions(snap.functions, source.functions), kit: mergeKit(snap.kit, source.kit) })
  const target = rootId && pages[rootId] ? rootId : firstRoot(incoming.pages) ?? firstRoot(source.pages)
  return { target, mode, added, updated, unchanged, files }
}

/**
 * Custom functions of a merge (already checked by migrate): new ones are added, a newer copy of one
 * we have replaces it; one whose name another function here already has is left out.
 */
function mergeFunctions(local: Workspace['functions'], incoming: Workspace['functions']): NonNullable<Workspace['functions']> {
  const out = { ...(local ?? {}) }
  for (const fn of Object.values(incoming ?? {})) {
    const cur = out[fn.id]
    if (cur && cur.updatedAt >= fn.updatedAt) continue
    if (Object.values(out).some((f) => f.id !== fn.id && f.name === fn.name)) continue
    out[fn.id] = fn
  }
  return out
}

/** Building blocks of a merge (already checked by migrate): new ones are added, a newer copy of one we have replaces it. */
function mergeKit(local: Workspace['kit'], incoming: Workspace['kit']): Kit {
  const out = emptyKit()
  for (const part of ['lists', 'propTypes', 'recordTypes'] as const) {
    const merged: Record<ID, KitEntry> = { ...(local?.[part] ?? {}) }
    for (const entry of Object.values(incoming?.[part] ?? {}) as KitEntry[]) {
      const cur = merged[entry.id]
      if (!cur || cur.updatedAt < entry.updatedAt) merged[entry.id] = entry
    }
    ;(out as unknown as Record<string, Record<ID, KitEntry>>)[part] = merged
  }
  return out
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
