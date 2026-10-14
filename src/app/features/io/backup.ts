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
import { INTEGRATION_LIMITS, integrationsAllowed, sanitizeIntegrations } from '../../store/integrations'
import { FILE_PREFIX, getFile, readAsDataUrl, saveFile } from '../../lib/files'
import { newId } from '../../lib/ids'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { withoutCommandSecrets } from '../commands'
import { endRun, noteRun, withWriter, type Writer } from '../../store/writer'
import { readWorkspaceAI, aiRulesAllowed } from '../../store/ai'
import { loosens, policyKnown, type LooseItem } from '@/shared/ai/policy'
import type { WorkspaceAI } from '@/shared/ai/types'
import { isGovernorMarker, isReadableGovernor, loosensGovernor, sameGovernor, sanitizeGovernor, type GovernorLoose, type WorkspaceGovernor } from '@/shared/ai/governor'
import { governorAllowed, STAMP_KNOWN } from '../../store/governor'

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
  // the workspace look and the integration profiles belong to the whole workspace: full backups carry them, a page
  // backup never does
  const { look, integrations, ai, governor, fuseSignoffs, ...rest } = snap
  // this device's AI rules and the other providers' key markers never go into a backup
  const { ai: _deviceAI, aiKeys: _keys, ...settings } = snap.settings
  const workspace: Workspace = {
    ...rest,
    ...(look && !rootId ? { look } : {}),
    ...(integrations?.length && !rootId ? { integrations } : {}),
    // the workspace's AI rules: full backups only (a restore keeps this workspace's — applyBackup)
    ...(ai && !rootId ? { ai } : {}),
    // the Regler: full backups only, never the marker for a newer value this build holds no copy of (a restore keeps
    // this workspace's — applyBackup)
    ...(governor && !rootId && !isGovernorMarker(governor) ? { governor } : {}),
    // the Patchbay's allowed paths: full backups only, for the record — a restore never takes them (applyBackup)
    ...(fuseSignoffs && Object.keys(fuseSignoffs).length && !rootId ? { fuseSignoffs } : {}),
    pages: topId && pages[topId] ? { ...pages, [topId]: { ...pages[topId], parentId: null } } : pages,
    databases,
    // never export the API key, nor the MCP servers' token markers
    settings: { ...settings, aiApiKey: '', aiKeys: {}, ...(snap.settings.mcpServers ? { mcpServers: snap.settings.mcpServers.map((s) => ({ ...s, token: '' })) } : {}) },
    // which pages this device opened last is this device's (help: sidebar, privacy) — never in a backup
    recent: [],
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
  /** integration profiles of the backup that found no room (a workspace holds INTEGRATION_LIMITS.profiles) */
  integrationsLeft?: number
  /** the backup's AI rules came from a newer build: this workspace kept its own */
  aiNewer?: true
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
    // keys never come from a file: this device's key (marker) stays, also when it has none
    if (key === 'aiApiKey') continue
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

/**
 * The backup's AI rules against this workspace's (D52): null when the backup carries none (a page backup never does)
 * or they are the same; else the rules and what taking them would loosen ([] = only tighter: taken without asking).
 */
export function backupAIRules(b: Backup): { theirs: WorkspaceAI; loosens: LooseItem[]; newer?: true } | null {
  if (b.scope === 'page') return null
  const raw = (b.workspace as unknown as { ai?: unknown } | null)?.ai
  const theirs = raw ? readWorkspaceAI(JSON.parse(JSON.stringify(raw))) : undefined
  if (!theirs) return null
  const mine = useWorkspace.getState().ai
  const bare = (x: WorkspaceAI | undefined) => JSON.stringify(x ? { ...x, gen: undefined, updatedAt: undefined, updatedBy: undefined } : null)
  // rules a newer build wrote (their generation above this build's): this build cannot read them whole — never taken,
  // never asked about (an older tab restamping them would stop every tab from refusing with 'reload'); mine stay
  if (!policyKnown(theirs, null, STAMP_KNOWN)) return { theirs, loosens: [], newer: true }
  if (bare(theirs) === bare(mine)) return null
  return { theirs, loosens: loosens(mine, theirs) }
}

/**
 * The backup's governor (the Regler) against this workspace's: null when the backup carries none (a page backup never
 * does) or the same one; else it and what taking it would loosen ([] = only stricter). A restore keeps this workspace's
 * unless the person takes the backup's — stricter or looser (design § 4.3). `newer`: one side is a newer build's value
 * (never taken, never asked about).
 */
export function backupGovernor(b: Backup): { theirs: WorkspaceGovernor | undefined; loosens: GovernorLoose[]; newer?: true } | null {
  if (b.scope === 'page') return null
  const raw = (b.workspace as unknown as { governor?: unknown } | null)?.governor
  if (raw === undefined || raw === null) return null
  const theirs = sanitizeGovernor(JSON.parse(JSON.stringify(raw)))
  const mine = useWorkspace.getState().governor
  if ((theirs && !isReadableGovernor(theirs)) || (mine && !isReadableGovernor(mine))) return { theirs: undefined, loosens: [], newer: true }
  if (sameGovernor(theirs, mine)) return null
  return { theirs: theirs as WorkspaceGovernor | undefined, loosens: loosensGovernor(mine, theirs) }
}

/** Restore files, remap their refs and apply the workspace. `ai`: the person's answer when the backup's AI rules would
 *  loosen this workspace's, or its governor differs ('theirs' — only where they may be written; anything else keeps
 *  them). */
export async function applyBackup(b: Backup, mode: 'merge' | 'replace', onProgress?: (done: number, total: number) => void, opts: { ai?: 'mine' | 'theirs' } = {}): Promise<RestoreResult> {
  // a team workspace: viewers can't write, and "replace" would swap it out for everyone in it
  const cloud = useCloud.getState()
  if (cloud.readOnly) throw new Error(t('features.io.err.viewOnly'))
  if (mode === 'replace' && cloud.active.kind === 'cloud') throw new Error(t('features.io.err.replaceTeam'))
  const snap = getWorkspaceSnapshot()
  const source = migrate(JSON.parse(JSON.stringify(b.workspace)))
  // profiles past the limit in the backup itself (migrate keeps the first ones)
  const raw = b.workspace as unknown as { integrations?: unknown } | null
  const overInBackup = b.scope === 'page' ? 0 : sanitizeIntegrations(raw?.integrations).over
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

  // the workspace's AI rules: the backup's when they are only tighter, or the person took them (never a page backup's)
  const rules = backupAIRules(b)
  const takeAI = !!rules && !rules.newer && (rules.loosens.length === 0 || (opts.ai === 'theirs' && aiRulesAllowed()))
  const aiNote = rules?.newer ? ({ aiNewer: true } as const) : {}
  // the governor: this workspace's stays unless the person took the backup's (never a newer build's value)
  const gov = backupGovernor(b)
  const takeGovernor = !!gov && !gov.newer && opts.ai === 'theirs' && governorAllowed()

  // a backup's restore is one import run (store/writer.ts)
  const writer: Writer = { kind: 'import', run: newId(), source: 'backup' }
  noteRun(writer, { source: 'backup' })
  try {
    return withWriter(writer, () => {
      const result = { ...commitBackup(), ...aiNote }
      // through the setter: its guards, the generation stamp, the team write path
      if (takeAI && rules) useWorkspace.getState().setWorkspaceAI(rules.theirs)
      // the governor likewise (its stamp lands in the same update)
      if (takeGovernor && gov) useWorkspace.getState().setGovernor(gov.theirs ?? null)
      return result
    })
  } finally {
    endRun(writer)
  }

  function commitBackup(): RestoreResult {
    if (mode === 'replace') {
      store.replaceAll({
        ...source,
        pages,
        databases,
        // the AI keys and this device's AI rules stay this device's — never the file's, also without a key here
        settings: { ...source.settings, aiApiKey: snap.settings.aiApiKey, ...(snap.settings.aiKeys ? { aiKeys: snap.settings.aiKeys } : {}), ...(snap.settings.ai ? { ai: snap.settings.ai } : {}) },
        // the workspace's AI rules stay this workspace's (a file never loosens them)
        ai: snap.ai,
        // the Regler likewise stays this workspace's (the person takes the backup's through setGovernor above)
        governor: snap.governor,
        // the Patchbay's allowed paths stay this workspace's: a file never brings wiring together with allowances for it
        fuseSignoffs: snap.fuseSignoffs,
        // this device's recent pages stay (where they still exist) — an older backup's list is never taken over
        recent: snap.recent.filter((id) => !!pages[id]),
        // a page backup carries no integration profiles: this workspace's stay
        integrations: b.scope === 'page' ? snap.integrations : source.integrations,
      })
      return { target: rootId ?? source.settings.startPageId ?? firstRoot(pages), mode, added, updated, unchanged, files, ...(overInBackup ? { integrationsLeft: overInBackup } : {}) }
    }

    const people = [...snap.people]
    for (const person of source.people) if (!people.some((x) => x.id === person.id)) people.push(person)
    // integration profiles: only someone who may edit them takes a backup's along (team: owners and admins)
    const ints = integrationsAllowed() ? mergeIntegrations(snap.integrations, source.integrations) : null
    const integrationsLeft = ints ? ints.left + overInBackup : 0
    store.replaceAll({
      ...snap,
      pages,
      databases,
      people,
      functions: mergeFunctions(snap.functions, source.functions),
      kit: mergeKit(snap.kit, source.kit),
      integrations: ints ? ints.integrations : snap.integrations,
    })
    const target = rootId && pages[rootId] ? rootId : firstRoot(incoming.pages) ?? firstRoot(source.pages)
    return { target, mode, added, updated, unchanged, files, ...(integrationsLeft ? { integrationsLeft } : {}) }
  }
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

/**
 * Integration profiles of a merge (already checked by migrate): new ones are added while the workspace has room
 * (INTEGRATION_LIMITS.profiles), a newer copy of one we have replaces it. `left`: new ones that found no room.
 */
function mergeIntegrations(local: Workspace['integrations'], incoming: Workspace['integrations']): { integrations: NonNullable<Workspace['integrations']>; left: number } {
  const out = [...(local ?? [])]
  let left = 0
  for (const p of incoming ?? []) {
    const at = out.findIndex((x) => x.id === p.id)
    if (at >= 0) {
      if ((out[at].updatedAt ?? 0) < (p.updatedAt ?? 0)) out[at] = p
    } else if (out.length < INTEGRATION_LIMITS.profiles) out.push(p)
    else left++
  }
  return { integrations: out, left }
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
