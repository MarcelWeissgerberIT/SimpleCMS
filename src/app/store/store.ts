/**
 * Central workspace store (zustand + immer). All persistent data lives here.
 * UI-only, non-persistent state lives in ./ui.ts.
 *
 * Rules for all areas:
 *  - Never mutate state outside these actions.
 *  - Content changes go through setContent(id, json, origin) so editors can tell
 *    their own writes from external ones (history restore, AI, sync, import).
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { JSONContent } from '@tiptap/core'
import { newId } from '../lib/ids'
import { detectLang } from '@/shared/i18n'
import { aiKeyValue, attachSecrets, checkAIKey, mcpServersValue, withSealedKey } from './secrets'
import { isSafeFunctionId } from './functions'
import { agentEditor, sanitizeAgent } from './agents'
import { sanitizeScript } from './scripts'
import { emptyKit, optionsOfList, sanitizeList, sanitizePropType, sanitizeRecordType, storedTypeOf, syncRecordTypeInto } from './kit'
import type {
  CustomAgent,
  CustomFunction,
  CustomPropType,
  Kit,
  OneScript,
  OptionList,
  RecordType,
  Database,
  ID,
  Page,
  PageComment,
  PageSettings,
  Person,
  PropertyDef,
  PropertyValue,
  SelectOption,
  Settings,
  View,
  Workspace,
} from './types'

export const WORKSPACE_VERSION = 1

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  fullWidth: false,
  smallText: false,
  font: 'sans',
  locked: false,
}

export function defaultSettings(): Settings {
  return {
    language: detectLang(),
    theme: 'system',
    workspaceName: 'One',
    userName: '',
    sidebarWidth: 264,
    sidebarCollapsed: false,
    startPageId: null,
    lastPageId: null,
    spellcheck: true,
    aiApiKey: '',
    aiModel: 'claude-opus-5-5',
    historyIntervalMin: 5,
  }
}

export function emptyWorkspace(): Workspace {
  return {
    version: WORKSPACE_VERSION,
    epoch: newId(),
    pages: {},
    databases: {},
    people: [],
    settings: defaultSettings(),
    recent: [],
  }
}

/** Extract plain text from TipTap JSON (for search, excerpts, graph). */
export function plainText(node: JSONContent | null | undefined, max = 20000): string {
  if (!node) return ''
  let out = ''
  const walk = (n: JSONContent) => {
    if (out.length > max) return
    if (n.type === 'text' && n.text) out += n.text
    else if (n.type === 'mention' && n.attrs?.label) out += `@${n.attrs.label}`
    if (n.content) {
      for (const c of n.content) walk(c)
      if (n.type !== 'text' && n.type !== 'doc') out += '\n'
    }
    // meeting notes: the transcript lives in an attribute (editor/schema/meetingNotes.ts)
    if (n.type === 'meetingNotes' && Array.isArray(n.attrs?.transcript)) {
      for (const seg of n.attrs.transcript) if (seg?.text) out += `${seg.text}\n`
    }
    // spreadsheets: title, sheet names and what was typed into cells (not formulas — values are computed)
    if (n.type === 'spreadsheet') {
      if (typeof n.attrs?.title === 'string' && n.attrs.title) out += `${n.attrs.title}\n`
      for (const sheet of Array.isArray(n.attrs?.sheets) ? n.attrs.sheets : []) {
        if (out.length > max) break
        if (typeof sheet?.name === 'string') out += `${sheet.name}\n`
        const cells = sheet?.cells && typeof sheet.cells === 'object' ? Object.values(sheet.cells as Record<string, { v?: unknown }>) : []
        const typed = cells.map((c) => c?.v).filter((v): v is string => typeof v === 'string' && v !== '' && !v.startsWith('='))
        if (typed.length) out += `${typed.join(' ')}\n`
      }
    }
    // charts: their title (editor/schema/chart.ts)
    if (n.type === 'chart' && typeof n.attrs?.spec?.title === 'string' && n.attrs.spec.title) out += `${n.attrs.spec.title}\n`
  }
  walk(node)
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

/** Collect all page ids referenced from a doc (pageLink nodes, page mentions, databaseBlock). */
export function linkedPageIds(node: JSONContent | null | undefined): ID[] {
  const ids = new Set<ID>()
  const walk = (n: JSONContent) => {
    const a = n.attrs
    if (a) {
      if (n.type === 'pageLink' && a.pageId) ids.add(a.pageId)
      if (n.type === 'mention' && a.kind === 'page' && a.id) ids.add(a.id)
      if (n.type === 'databaseBlock' && a.databaseId) ids.add(a.databaseId)
    }
    n.marks?.forEach((m) => {
      const href: string | undefined = m.type === 'link' ? m.attrs?.href : undefined
      const match = href?.match(/#\/p\/([\w-]+)/)
      if (match) ids.add(match[1])
    })
    n.content?.forEach(walk)
  }
  if (node) walk(node)
  return [...ids]
}

export interface NewPageInput {
  parentId?: ID | null
  title?: string
  icon?: Page['icon']
  cover?: Page['cover']
  content?: JSONContent | null
  kind?: Page['kind']
  databaseId?: ID | null
  properties?: Record<ID, PropertyValue>
  /** insert position among siblings (default: end) */
  index?: number
  settings?: Partial<PageSettings>
  hidden?: boolean
  id?: ID
}

export interface NewDatabaseInput {
  parentId?: ID | null
  title?: string
  icon?: Page['icon']
  cover?: Page['cover']
  properties?: PropertyDef[]
  views?: View[]
  inline?: boolean
  id?: ID
  index?: number
}

export interface WorkspaceState extends Workspace {
  /** True once loaded from IndexedDB (or seeded). */
  ready: boolean

  // lifecycle
  hydrate: (ws: Workspace) => void
  replaceAll: (ws: Workspace) => void

  // pages
  createPage: (input?: NewPageInput) => ID
  updatePage: (id: ID, patch: Partial<Omit<Page, 'id' | 'content' | 'contentRev'>>) => void
  updatePageSettings: (id: ID, patch: Partial<PageSettings>) => void
  setContent: (id: ID, content: JSONContent | null, origin: string) => void
  movePage: (id: ID, parentId: ID | null, index?: number) => void
  duplicatePage: (id: ID) => ID | null
  trashPage: (id: ID) => void
  restorePage: (id: ID) => void
  deletePagePermanently: (id: ID) => void
  emptyTrash: () => void
  toggleFavorite: (id: ID) => void
  touchRecent: (id: ID) => void
  /** Forget the recently visited pages (this device's list: the local meta record / the cloud overlay). */
  clearRecent: () => void

  // databases
  createDatabase: (input?: NewDatabaseInput) => ID
  updateDatabase: (id: ID, patch: Partial<Omit<Database, 'id'>>) => void
  addProperty: (dbId: ID, def: Partial<PropertyDef> & Pick<PropertyDef, 'type'>, index?: number) => ID
  updateProperty: (dbId: ID, propId: ID, patch: Partial<PropertyDef>) => void
  deleteProperty: (dbId: ID, propId: ID) => void
  moveProperty: (dbId: ID, propId: ID, toIndex: number) => void
  addView: (dbId: ID, view: Partial<View> & Pick<View, 'type'>) => ID
  updateView: (dbId: ID, viewId: ID, patch: Partial<View>) => void
  deleteView: (dbId: ID, viewId: ID) => void
  duplicateView: (dbId: ID, viewId: ID) => ID | null
  createRow: (dbId: ID, input?: { title?: string; properties?: Record<ID, PropertyValue>; content?: JSONContent | null; index?: number; icon?: Page['icon'] }) => ID
  setRowProperty: (rowId: ID, propId: ID, value: PropertyValue) => void

  // people & settings
  addPerson: (name: string) => ID
  /** rename / recolour a person (workspace people tools, shell/workspace) */
  updatePerson: (id: ID, patch: Partial<Pick<Person, 'name' | 'color'>>) => void
  /** take a person off the list → its index (-1: none). Values and mentions stay — merge them first (shell/workspace/people.ts) */
  removePerson: (id: ID) => number
  /** put a removed person back (same id) at `index` — the Undo of a merge / removal */
  restorePerson: (person: Person, index: number) => void
  updateSettings: (patch: Partial<Settings>) => void

  // custom functions (features/sheets/functions): insert or replace by id (updatedAt is set here) · remove
  upsertFunction: (fn: CustomFunction) => void
  deleteFunction: (id: ID) => void

  // custom agents (features/agents): insert or replace by id (sanitized; updatedAt is set here) · remove
  upsertAgent: (agent: CustomAgent) => void
  deleteAgent: (id: ID) => void

  // One Script (features/script): insert or replace by id (sanitized; updatedAt / updatedBy are set here) · remove
  upsertScript: (script: OneScript) => void
  deleteScript: (id: ID) => void

  // building blocks (features/kit): insert or replace by id (sanitized; updatedAt / updatedBy are set here) · remove.
  // upsertList copies the items into every property bound to the list (PropertyDef.listId); upsertPropType binds
  // the properties of that type to its list; upsertRecordType brings every database holding the type in step
  // (locked databases are left as they are). Removing never drops values: linked properties are only unlinked.
  upsertList: (list: OptionList) => void
  deleteList: (id: ID) => void
  upsertPropType: (type: CustomPropType) => void
  deletePropType: (id: ID) => void
  upsertRecordType: (type: RecordType) => void
  deleteRecordType: (id: ID) => void
  /** Add a record type's properties to a database. False when refused (locked, unknown). */
  attachRecordType: (dbId: ID, typeId: ID) => boolean
  /**
   * Take a record type out of a database: its properties stay as plain ones (fromType removed, values kept),
   * the database's rows of that type lose the type. False when refused (locked, not held).
   */
  detachRecordType: (dbId: ID, typeId: ID) => boolean
  /** A row's record type (null = none); the type is attached to the row's database first. False when refused. */
  setRecordType: (pageId: ID, typeId: ID | null) => boolean

  // comments (margin notes): threads live on the page, their anchors are `comment` marks in its content
  addComment: (pageId: ID, input: { id?: ID; quote: string; body: string }) => ID
  updateComment: (pageId: ID, commentId: ID, patch: Partial<Pick<PageComment, 'body' | 'resolved' | 'quote'>>) => void
  deleteComment: (pageId: ID, commentId: ID) => void
  addCommentReply: (pageId: ID, commentId: ID, body: string) => ID
  updateCommentReply: (pageId: ID, commentId: ID, replyId: ID, body: string) => void
  deleteCommentReply: (pageId: ID, commentId: ID, replyId: ID) => void

  /**
   * Cloud binding only (src/app/cloud): apply a batch of changes that came from the server.
   * `null` removes a page / database. Other areas never call this.
   */
  cloudPatch: (patch: CloudPatch) => void
}

export interface CloudPatch {
  pages?: Record<ID, Page | null>
  databases?: Record<ID, Database | null>
  people?: Person[]
  settings?: Partial<Settings>
  /** custom functions by id (`null` removes one) */
  functions?: Record<ID, CustomFunction | null>
  /** custom agents by id (`null` removes one) */
  agents?: Record<ID, CustomAgent | null>
  /** scripts by id (`null` removes one) */
  scripts?: Record<ID, OneScript | null>
  /** building blocks by part and id (`null` removes one) */
  kit?: { lists?: Record<ID, OptionList | null>; propTypes?: Record<ID, CustomPropType | null>; recordTypes?: Record<ID, RecordType | null> }
}

const now = () => Date.now()

/** A building block's copy with the times and authors a save sets (createdBy kept, updatedBy = the saver). */
function stamped<T extends { createdAt?: number; createdBy?: string | null }>(entry: T, cur: { createdAt: number; createdBy?: string | null } | undefined): T {
  const t = now()
  return { ...(JSON.parse(JSON.stringify(entry)) as T), createdAt: cur?.createdAt ?? entry.createdAt ?? t, createdBy: cur ? (cur.createdBy ?? null) : (entry.createdBy ?? agentEditor()), updatedBy: agentEditor(), updatedAt: t }
}

function nextOrder(pages: Record<ID, Page>, parentId: ID | null): number {
  let max = 0
  for (const p of Object.values(pages)) if (p.parentId === parentId && p.order > max) max = p.order
  return max + 1
}

function orderAt(pages: Record<ID, Page>, parentId: ID | null, index: number, excludeId?: ID): number {
  const sibs = Object.values(pages)
    .filter((p) => p.parentId === parentId && !p.trashed && p.id !== excludeId)
    .sort((a, b) => a.order - b.order)
  if (sibs.length === 0) return 1
  if (index <= 0) return sibs[0].order - 1
  if (index >= sibs.length) return sibs[sibs.length - 1].order + 1
  return (sibs[index - 1].order + sibs[index].order) / 2
}

/** Children ids by parent id. */
function childrenByParent(pages: Record<ID, Page>): Map<ID, ID[]> {
  const byParent = new Map<ID, ID[]>()
  for (const p of Object.values(pages)) {
    if (!p.parentId) continue
    const arr = byParent.get(p.parentId) ?? []
    arr.push(p.id)
    byParent.set(p.parentId, arr)
  }
  return byParent
}

/** All descendant ids (children, grandchildren, rows of databases …). Safe against parent cycles. */
export function descendantIds(pages: Record<ID, Page>, id: ID): ID[] {
  const byParent = childrenByParent(pages)
  const out: ID[] = []
  const seen = new Set<ID>([id])
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    stack.push(...(byParent.get(cur) ?? []))
  }
  return out
}

/** Is the page or any ancestor trashed? (cycle-safe; selectors.ts has the memoised variant for views) */
function trashedOrUnderTrash(pages: Record<ID, Page>, id: ID): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  while (cur && !seen.has(cur.id)) {
    if (cur.trashed) return true
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return false
}

/** UI language of the workspace, for default names the store creates (it cannot use t()). */
const isDe = () => useWorkspace.getState().settings.language === 'de'
const L = (en: string, de: string) => (isDe() ? de : en)

function defaultStatusOptions(): SelectOption[] {
  return [
    { id: newId(), name: L('Not started', 'Nicht begonnen'), color: 'gray', group: 'todo' },
    { id: newId(), name: L('In progress', 'In Arbeit'), color: 'blue', group: 'in_progress' },
    { id: newId(), name: L('Done', 'Erledigt'), color: 'green', group: 'done' },
  ]
}

const VIEW_NAMES: Record<View['type'], [string, string]> = {
  table: ['Table', 'Tabelle'],
  board: ['Board', 'Board'],
  list: ['List', 'Liste'],
  gallery: ['Gallery', 'Galerie'],
  calendar: ['Calendar', 'Kalender'],
  timeline: ['Timeline', 'Zeitleiste'],
  chart: ['Chart', 'Diagramm'],
  form: ['Form', 'Formular'],
  feed: ['Feed', 'Feed'],
}

/** "(copy)" suffix in the workspace language. */
const copySuffix = () => L('(copy)', '(Kopie)')

/**
 * Point references inside copied content at the copies: page links, page mentions, inline
 * databases (+ their view ids) and internal link hrefs (#/p/<id>, any ?b=… suffix is kept).
 */
function remapContent(node: JSONContent, idMap: Map<ID, ID>, viewMap: Map<ID, ID>): JSONContent {
  const a = node.attrs
  if (a) {
    if (node.type === 'pageLink' && idMap.has(a.pageId)) node.attrs = { ...a, pageId: idMap.get(a.pageId) }
    else if (node.type === 'mention' && a.kind === 'page' && idMap.has(a.id)) node.attrs = { ...a, id: idMap.get(a.id) }
    else if (node.type === 'databaseBlock' && idMap.has(a.databaseId)) {
      node.attrs = { ...a, databaseId: idMap.get(a.databaseId), ...(a.viewId && viewMap.has(a.viewId) ? { viewId: viewMap.get(a.viewId) } : {}) }
    }
  }
  if (node.marks) {
    for (const m of node.marks) {
      const href = m.type === 'link' ? m.attrs?.href : undefined
      if (typeof href === 'string' && href.includes('#/p/')) {
        m.attrs = { ...m.attrs, href: href.replace(/#\/p\/([\w-]+)/, (all, id: string) => (idMap.has(id) ? `#/p/${idMap.get(id)}` : all)) }
      }
    }
  }
  node.content?.forEach((c) => remapContent(c, idMap, viewMap))
  return node
}

function makePage(input: NewPageInput, pages: Record<ID, Page>): Page {
  const parentId = input.parentId ?? null
  const t = now()
  return {
    id: input.id ?? newId(),
    kind: input.kind ?? 'page',
    title: input.title ?? '',
    icon: input.icon ?? null,
    cover: input.cover ?? null,
    parentId,
    databaseId: input.databaseId ?? null,
    properties: input.properties ?? {},
    content: input.content ?? null,
    contentRev: 0,
    contentOrigin: null,
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: t,
    updatedAt: t,
    order: input.index === undefined ? nextOrder(pages, parentId) : orderAt(pages, parentId, input.index),
    settings: { ...DEFAULT_PAGE_SETTINGS, ...input.settings },
    hidden: input.hidden,
    plain: input.content ? plainText(input.content) : '',
  }
}

export function defaultView(type: View['type'], db: Pick<Database, 'properties'>, name?: string): View {
  const props = db.properties
  const firstOf = (...types: PropertyDef['type'][]) => props.find((p) => types.includes(p.type))?.id ?? null
  const view: View = {
    id: newId(),
    name: name ?? type.charAt(0).toUpperCase() + type.slice(1),
    type,
    filter: null,
    sorts: [],
    visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id),
    openIn: 'peek',
  }
  if (type === 'board') view.groupBy = firstOf('status', 'select', 'person', 'checkbox')
  if (type === 'calendar' || type === 'timeline') view.dateProperty = firstOf('date', 'created_time', 'last_edited_time')
  if (type === 'gallery') {
    view.cardPreview = 'cover'
    view.cardSize = 'medium'
  }
  if (type === 'chart') view.chart = { kind: 'bar', xPropertyId: firstOf('status', 'select', 'multi_select', 'person', 'checkbox'), aggregate: 'count' }
  return view
}

/**
 * Bulk loads (boot, another tab's save, an import or backup): freeze the page map and every page
 * shallowly before they enter the store. Immer deep-freezes whatever new data a write brings in
 * and stops at frozen objects — without this, loading a workspace froze every node of every page's
 * content (seconds for a big one) and the first write after it did the same. A page that changes
 * later is deep-frozen with that write, as before.
 */
function freezePages(pages: Record<ID, Page>): Record<ID, Page> {
  if (Object.isFrozen(pages)) return pages
  const ids = Object.keys(pages)
  for (let i = 0; i < ids.length; i++) Object.freeze(pages[ids[i]])
  return Object.freeze(pages)
}

/**
 * Deep-freeze data entering the store, down to the parts already frozen — what Immer's auto-freeze
 * does with a write (plain objects and arrays only, like Immer).
 */
function deepFreeze<T>(v: T): T {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  return v
}

/**
 * The page map with one page replaced — for the writes that run while someone types (the editor
 * hands its text over on every pause, a title on every key, a cell on every commit). An Immer draft
 * of the map copies it and then walks all N pages again to finalise and re-freeze it; this copies
 * it once (in order), and records the diff that every subscriber asks pageChanges() for, so nobody
 * walks the map to find the one page that changed.
 */
function withPage(prev: Record<ID, Page>, page: Page): Record<ID, Page> {
  const next: Record<ID, Page> = {}
  const ids = Object.keys(prev)
  for (let i = 0; i < ids.length; i++) next[ids[i]] = prev[ids[i]]
  next[page.id] = deepFreeze(page)
  Object.freeze(next)
  rememberChanges(next, prev, { changed: [page.id], added: [], removed: [] }, ids.length, ids.length)
  return next
}

export const useWorkspace = create<WorkspaceState>()(
  immer((set, get) => ({
    ...emptyWorkspace(),
    ready: false,

    hydrate: (ws) => {
      // the Claude API key: a vault marker, never the key (secrets.ts)
      const settings = withSealedKey(ws.settings, get().settings.aiApiKey, ws.epoch)
      set((s) => {
        Object.assign(s, ws, { pages: freezePages(ws.pages), settings, functions: ws.functions ?? {}, agents: ws.agents ?? {}, scripts: ws.scripts ?? {}, kit: ws.kit ?? emptyKit() })
        s.ready = true
      })
      void checkAIKey()
    },

    replaceAll: (ws) =>
      set((s) => {
        freezePages(ws.pages)
        s.version = ws.version
        s.pages = ws.pages
        s.databases = ws.databases
        s.people = ws.people
        s.settings = withSealedKey(ws.settings, s.settings.aiApiKey, s.epoch)
        s.recent = ws.recent
        s.functions = ws.functions ?? {}
        s.agents = ws.agents ?? {}
        s.scripts = ws.scripts ?? {}
        s.kit = ws.kit ?? emptyKit()
      }),

    createPage: (input = {}) => {
      const page = makePage(input, get().pages)
      set((s) => {
        s.pages[page.id] = page
      })
      return page.id
    },

    // updatePage, setContent, setRowProperty: one page, written without an Immer draft (withPage)
    updatePage: (id, patch) => {
      const pages = get().pages
      const p = pages[id]
      if (p) set({ pages: withPage(pages, { ...p, ...patch, updatedAt: now() }) })
    },

    updatePageSettings: (id, patch) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        Object.assign(p.settings, patch)
        p.updatedAt = now()
      }),

    setContent: (id, content, origin) => {
      const pages = get().pages
      const p = pages[id]
      if (p) set({ pages: withPage(pages, { ...p, content, contentRev: p.contentRev + 1, contentOrigin: origin, updatedAt: now(), plain: plainText(content) }) })
    },

    movePage: (id, parentId, index) =>
      set((s) => {
        const p = s.pages[id]
        if (!p || id === parentId) return
        // a database row lives in its database (reorder only)
        if (p.databaseId && parentId !== p.databaseId) return
        if (parentId) {
          const target = s.pages[parentId]
          // never into a page that is gone or in the trash, nor into own descendant
          if (!target || trashedOrUnderTrash(s.pages, parentId)) return
          if (descendantIds(s.pages, id).includes(parentId)) return
        }
        p.parentId = parentId
        p.order = index === undefined ? nextOrder(s.pages, parentId) : orderAt(s.pages, parentId, index, id)
        p.updatedAt = now()
      }),

    duplicatePage: (id) => {
      const state = get()
      const src = state.pages[id]
      if (!src) return null
      // the copy set: the page and everything below it, minus trashed subtrees
      const byParent = childrenByParent(state.pages)
      const all: ID[] = []
      const seen = new Set<ID>()
      const stack: ID[] = [id]
      while (stack.length) {
        const cur = stack.pop()!
        const page = state.pages[cur]
        if (seen.has(cur) || !page || (cur !== id && page.trashed)) continue
        seen.add(cur)
        all.push(cur)
        stack.push(...(byParent.get(cur) ?? []))
      }
      const idMap = new Map<ID, ID>()
      for (const oldId of all) idMap.set(oldId, newId())
      const viewMap = new Map<ID, ID>()
      for (const oldId of all) for (const v of state.databases[oldId]?.views ?? []) viewMap.set(v.id, newId())
      const remapIds = (v: PropertyValue): PropertyValue => (Array.isArray(v) ? v.map((x) => idMap.get(x) ?? x) : v)
      const suffix = copySuffix()
      set((s) => {
        for (const oldId of all) {
          const o = s.pages[oldId]
          if (!o) continue
          const copy: Page = JSON.parse(JSON.stringify(o))
          copy.id = idMap.get(oldId)!
          // the copy sits next to the original; everything below it hangs off the copies
          const isRoot = oldId === id
          copy.parentId = !isRoot && o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : o.parentId
          copy.databaseId = !isRoot && o.databaseId && idMap.has(o.databaseId) ? idMap.get(o.databaseId)! : o.databaseId
          copy.favorite = false
          copy.createdAt = copy.updatedAt = now()
          copy.contentRev = 0
          copy.contentOrigin = null
          if (copy.content) {
            copy.content = remapContent(copy.content, idMap, viewMap)
            copy.plain = plainText(copy.content)
          }
          // relations between copied rows point at the copies
          const rowDb = o.databaseId ? s.databases[o.databaseId] : undefined
          for (const prop of rowDb?.properties ?? []) {
            if (prop.type === 'relation' && copy.properties[prop.id] !== undefined) copy.properties[prop.id] = remapIds(copy.properties[prop.id])
          }
          if (isRoot) {
            copy.title = o.title ? `${o.title} ${suffix}` : ''
            copy.order = o.order + 0.5
            // a template's root (Page.template): another own template, never a second customised built-in
            if (copy.template) {
              const { from: _from, ...meta } = copy.template
              copy.template = { ...meta, name: `${meta.name} ${suffix}` }
              copy.title = o.title
            }
          }
          s.pages[copy.id] = copy
          const db = s.databases[oldId]
          if (db) {
            const dbCopy: Database = JSON.parse(JSON.stringify(db))
            dbCopy.id = copy.id
            for (const v of dbCopy.views) v.id = viewMap.get(v.id) ?? newId()
            for (const prop of dbCopy.properties) {
              if (prop.type === 'relation' && prop.relationDatabaseId && idMap.has(prop.relationDatabaseId)) prop.relationDatabaseId = idMap.get(prop.relationDatabaseId)
            }
            for (const a of dbCopy.automations ?? []) {
              a.id = newId()
              a.lastRunAt = null
              a.lastStatus = null
              a.lastMessage = null
            }
            for (const tpl of dbCopy.templates ?? []) {
              tpl.id = newId()
              if (tpl.content) tpl.content = remapContent(tpl.content, idMap, viewMap)
            }
            s.databases[copy.id] = dbCopy
          }
        }
      })
      return idMap.get(id)!
    },

    trashPage: (id) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        p.trashed = true
        p.trashedAt = now()
        p.favorite = false
        s.recent = s.recent.filter((r) => r !== id)
      }),

    restorePage: (id) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        p.trashed = false
        p.trashedAt = null
        // if parent is gone/trashed, restore to root
        const parent = p.parentId ? s.pages[p.parentId] : null
        if (p.parentId && (!parent || parent.trashed) && !p.databaseId) p.parentId = null
      }),

    deletePagePermanently: (id) =>
      set((s) => {
        const ids = [id, ...descendantIds(s.pages, id)]
        for (const d of ids) {
          delete s.pages[d]
          delete s.databases[d]
        }
        s.recent = s.recent.filter((r) => !ids.includes(r))
        if (s.settings.startPageId && ids.includes(s.settings.startPageId)) s.settings.startPageId = null
        if (s.settings.lastPageId && ids.includes(s.settings.lastPageId)) s.settings.lastPageId = null
      }),

    emptyTrash: () => {
      const trashed = Object.values(get().pages).filter((p) => p.trashed)
      for (const p of trashed) if (get().pages[p.id]) get().deletePagePermanently(p.id)
    },

    toggleFavorite: (id) =>
      set((s) => {
        const p = s.pages[id]
        if (p) p.favorite = !p.favorite
      }),

    touchRecent: (id) =>
      set((s) => {
        s.recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, 20)
        s.settings.lastPageId = id
      }),

    clearRecent: () =>
      set((s) => {
        if (s.recent.length) s.recent = []
      }),

    createDatabase: (input = {}) => {
      const pages = get().pages
      const id = input.id ?? newId()
      const properties: PropertyDef[] = input.properties ?? [
        { id: newId(), name: 'Name', type: 'title' },
        { id: newId(), name: 'Status', type: 'status', options: defaultStatusOptions() },
        { id: newId(), name: 'Tags', type: 'multi_select', options: [] },
        { id: newId(), name: L('Date', 'Datum'), type: 'date' },
      ]
      if (!properties.some((p) => p.type === 'title')) properties.unshift({ id: newId(), name: 'Name', type: 'title' })
      const db: Database = {
        id,
        properties,
        views: [],
        nextUniqueId: 1,
        inline: input.inline ?? false,
      }
      db.views = input.views ?? [defaultView('table', db, L(...VIEW_NAMES.table))]
      const page = makePage(
        { id, parentId: input.parentId ?? null, title: input.title ?? '', icon: input.icon, cover: input.cover, kind: 'database', index: input.index },
        pages,
      )
      set((s) => {
        s.pages[id] = page
        s.databases[id] = db
      })
      return id
    },

    updateDatabase: (id, patch) =>
      set((s) => {
        const db = s.databases[id]
        if (db) Object.assign(db, patch)
      }),

    addProperty: (dbId, def, index) => {
      const id = def.id ?? newId()
      set((s) => {
        const db = s.databases[dbId]
        if (!db) return
        const prop: PropertyDef = { name: def.name ?? L('Property', 'Eigenschaft'), ...def, id } as PropertyDef
        if ((prop.type === 'select' || prop.type === 'multi_select') && !prop.options) prop.options = []
        if (prop.type === 'status' && !prop.options) prop.options = defaultStatusOptions()
        if (index === undefined) db.properties.push(prop)
        else db.properties.splice(index, 0, prop)
        for (const v of db.views) if (!v.visibleProperties.includes(id)) v.visibleProperties.push(id)
        if (prop.type === 'unique_id') {
          // backfill existing rows
          const rows = Object.values(s.pages)
            .filter((p) => p.databaseId === dbId)
            .sort((a, b) => a.createdAt - b.createdAt)
          for (const r of rows) r.properties[id] = db.nextUniqueId++
        }
      })
      return id
    },

    updateProperty: (dbId, propId, patch) =>
      set((s) => {
        const prop = s.databases[dbId]?.properties.find((p) => p.id === propId)
        if (prop) Object.assign(prop, patch)
      }),

    deleteProperty: (dbId, propId) =>
      set((s) => {
        const db = s.databases[dbId]
        if (!db) return
        const prop = db.properties.find((p) => p.id === propId)
        if (!prop || prop.type === 'title') return
        db.properties = db.properties.filter((p) => p.id !== propId)
        for (const v of db.views) {
          v.visibleProperties = v.visibleProperties.filter((p) => p !== propId)
          v.sorts = v.sorts.filter((so) => so.propertyId !== propId)
          if (v.groupBy === propId) v.groupBy = null
          if (v.dateProperty === propId) v.dateProperty = null
        }
        for (const p of Object.values(s.pages)) if (p.databaseId === dbId) delete p.properties[propId]
      }),

    moveProperty: (dbId, propId, toIndex) =>
      set((s) => {
        const db = s.databases[dbId]
        if (!db) return
        const from = db.properties.findIndex((p) => p.id === propId)
        if (from < 0) return
        const [prop] = db.properties.splice(from, 1)
        db.properties.splice(Math.max(0, Math.min(toIndex, db.properties.length)), 0, prop)
      }),

    addView: (dbId, view) => {
      const db = get().databases[dbId]
      if (!db) return ''
      const v: View = { ...defaultView(view.type, db, L(...VIEW_NAMES[view.type])), ...view }
      set((s) => {
        s.databases[dbId]?.views.push(v)
      })
      return v.id
    },

    updateView: (dbId, viewId, patch) =>
      set((s) => {
        const v = s.databases[dbId]?.views.find((x) => x.id === viewId)
        if (v) Object.assign(v, patch)
      }),

    deleteView: (dbId, viewId) =>
      set((s) => {
        const db = s.databases[dbId]
        if (!db || db.views.length <= 1) return
        db.views = db.views.filter((v) => v.id !== viewId)
      }),

    duplicateView: (dbId, viewId) => {
      const db = get().databases[dbId]
      const v = db?.views.find((x) => x.id === viewId)
      if (!db || !v) return null
      const copy: View = { ...JSON.parse(JSON.stringify(v)), id: newId(), name: `${v.name} ${copySuffix()}` }
      set((s) => {
        const d = s.databases[dbId]
        if (!d) return
        const i = d.views.findIndex((x) => x.id === viewId)
        d.views.splice(i + 1, 0, copy)
      })
      return copy.id
    },

    createRow: (dbId, input = {}) => {
      const state = get()
      const db = state.databases[dbId]
      const properties: Record<ID, PropertyValue> = { ...(input.properties ?? {}) }
      if (db) {
        for (const p of db.properties) if (p.type === 'unique_id' && properties[p.id] === undefined) properties[p.id] = db.nextUniqueId
      }
      const page = makePage(
        { parentId: dbId, databaseId: dbId, title: input.title ?? '', properties, content: input.content ?? null, index: input.index, icon: input.icon },
        state.pages,
      )
      set((s) => {
        s.pages[page.id] = page
        const d = s.databases[dbId]
        if (d && d.properties.some((p) => p.type === 'unique_id')) d.nextUniqueId += 1
      })
      return page.id
    },

    setRowProperty: (rowId, propId, value) => {
      const pages = get().pages
      const p = pages[rowId]
      if (p) set({ pages: withPage(pages, { ...p, properties: { ...p.properties, [propId]: value }, updatedAt: now() }) })
    },

    addPerson: (name) => {
      const person: Person = { id: newId(), name, color: (['orange', 'blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'red'] as const)[get().people.length % 8] }
      set((s) => {
        s.people.push(person)
      })
      return person.id
    },

    updatePerson: (id, patch) =>
      set((s) => {
        const p = s.people.find((x) => x.id === id)
        if (!p) return
        if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim()
        if (patch.color) p.color = patch.color
      }),

    removePerson: (id) => {
      const index = get().people.findIndex((p) => p.id === id)
      if (index >= 0)
        set((s) => {
          s.people.splice(index, 1)
        })
      return index
    },

    restorePerson: (person, index) =>
      set((s) => {
        if (s.people.some((p) => p.id === person.id)) return
        s.people.splice(Math.max(0, Math.min(index, s.people.length)), 0, { ...person })
      }),

    updateSettings: (patch) => {
      // a key goes into the vault; the store keeps its marker ('' removes it, secrets.ts)
      let p = 'aiApiKey' in patch ? { ...patch, aiApiKey: aiKeyValue(patch.aiApiKey, get().settings.aiApiKey, get().epoch, true) } : patch
      // MCP server tokens likewise: markers only in the list (secrets.ts)
      if ('mcpServers' in p) p = { ...p, mcpServers: mcpServersValue(p.mcpServers, get().settings.mcpServers, get().epoch) }
      set((s) => {
        Object.assign(s.settings, p)
      })
    },

    upsertFunction: (fn) =>
      set((s) => {
        // ids become object keys (and Yjs map keys): plain tokens only
        if (!isSafeFunctionId(fn.id)) return
        s.functions ??= {}
        const cur = s.functions[fn.id]
        s.functions[fn.id] = { ...JSON.parse(JSON.stringify(fn)), createdAt: cur?.createdAt ?? fn.createdAt ?? now(), updatedAt: now() }
      }),

    deleteFunction: (id) =>
      set((s) => {
        if (s.functions?.[id]) delete s.functions[id]
      }),

    upsertAgent: (agent) => {
      const cur = get().agents?.[agent.id]
      const t = now()
      // the stored copy is always a sanitized one (bounded strings, known fields, checked ids); the
      // saver is stamped (team: a browser agent changed by someone else waits for its creator)
      const clean = sanitizeAgent(agent.id, { ...JSON.parse(JSON.stringify(agent)), createdAt: cur?.createdAt ?? agent.createdAt ?? t, createdBy: cur ? (cur.createdBy ?? null) : (agent.createdBy ?? null), updatedBy: agentEditor(), updatedAt: t })
      if (!clean) return
      set((s) => {
        s.agents ??= {}
        s.agents[clean.id] = clean
      })
    },

    deleteAgent: (id) =>
      set((s) => {
        if (s.agents?.[id]) delete s.agents[id]
      }),

    upsertScript: (script) => {
      const cur = get().scripts?.[script.id]
      const t = now()
      // a sanitized copy; the saver is stamped like agents' (team: a script changed by someone else asks before it runs)
      const clean = sanitizeScript(script.id, { ...JSON.parse(JSON.stringify(script)), createdAt: cur?.createdAt ?? script.createdAt ?? t, createdBy: cur ? (cur.createdBy ?? null) : (script.createdBy ?? agentEditor()), updatedBy: agentEditor(), updatedAt: t })
      if (!clean) return
      set((s) => {
        s.scripts ??= {}
        s.scripts[clean.id] = clean
      })
    },

    deleteScript: (id) =>
      set((s) => {
        if (s.scripts?.[id]) delete s.scripts[id]
      }),

    upsertList: (list) => {
      const clean = sanitizeList(list.id, stamped(list, get().kit?.lists[list.id]))
      if (!clean) return
      set((s) => {
        const kit = (s.kit ??= emptyKit())
        kit.lists[clean.id] = clean
        for (const db of Object.values(s.databases)) {
          for (const def of db.properties) if (def.listId === clean.id && (def.type === 'select' || def.type === 'multi_select')) def.options = optionsOfList(clean)
        }
      })
    },

    deleteList: (id) =>
      set((s) => {
        if (!s.kit?.lists[id]) return
        delete s.kit.lists[id]
        // bound properties keep their options and become ordinary ones
        for (const db of Object.values(s.databases)) for (const def of db.properties) if (def.listId === id) delete def.listId
      }),

    upsertPropType: (type) => {
      const cur = get().kit?.propTypes[type.id]
      // the base is fixed once created (it is the stored shape of every value)
      const clean = sanitizePropType(type.id, stamped({ ...type, base: cur?.base ?? type.base }, cur))
      if (!clean) return
      set((s) => {
        const kit = (s.kit ??= emptyKit())
        kit.propTypes[clean.id] = clean
        const list = clean.listId ? kit.lists[clean.listId] : undefined
        for (const db of Object.values(s.databases)) {
          for (const def of db.properties) {
            if (def.custom !== clean.id || def.type !== storedTypeOf(clean.base)) continue
            if (list && (def.type === 'select' || def.type === 'multi_select') && (!def.listId || def.listId === cur?.listId)) {
              def.listId = list.id
              def.options = optionsOfList(list)
            }
          }
        }
      })
    },

    deletePropType: (id) =>
      set((s) => {
        if (!s.kit?.propTypes[id]) return
        delete s.kit.propTypes[id]
        // its properties stay as plain properties of the base type
        for (const db of Object.values(s.databases)) for (const def of db.properties) if (def.custom === id) delete def.custom
      }),

    upsertRecordType: (type) => {
      const clean = sanitizeRecordType(type.id, stamped(type, get().kit?.recordTypes[type.id]))
      if (!clean) return
      set((s) => {
        const kit = (s.kit ??= emptyKit())
        kit.recordTypes[clean.id] = clean
        for (const db of Object.values(s.databases)) {
          if (!db.locked && (db.recordTypes ?? []).includes(clean.id)) syncRecordTypeInto(db, clean, kit as Kit, newId)
        }
      })
    },

    deleteRecordType: (id) =>
      set((s) => {
        if (!s.kit?.recordTypes[id]) return
        delete s.kit.recordTypes[id]
        const t = now()
        for (const db of Object.values(s.databases)) {
          if (db.recordTypes?.includes(id)) db.recordTypes = db.recordTypes.filter((x) => x !== id)
          for (const def of db.properties) if (def.fromType?.id === id) delete def.fromType
        }
        // rows keep their values; they only lose the type
        for (const p of Object.values(s.pages)) {
          if (p.recordType !== id) continue
          delete p.recordType
          p.updatedAt = t
        }
      }),

    attachRecordType: (dbId, typeId) => {
      const st = get()
      const db = st.databases[dbId]
      const rt = st.kit?.recordTypes[typeId]
      if (!db || !rt || db.locked) return false
      set((s) => {
        const d = s.databases[dbId]
        const kit = s.kit
        if (d && kit) syncRecordTypeInto(d, kit.recordTypes[typeId], kit as Kit, newId)
      })
      return true
    },

    detachRecordType: (dbId, typeId) => {
      const db = get().databases[dbId]
      if (!db || db.locked || !(db.recordTypes ?? []).includes(typeId)) return false
      set((s) => {
        const d = s.databases[dbId]
        if (!d) return
        d.recordTypes = (d.recordTypes ?? []).filter((x) => x !== typeId)
        for (const def of d.properties) if (def.fromType?.id === typeId) delete def.fromType
        const t = now()
        for (const p of Object.values(s.pages)) {
          if (p.databaseId !== dbId || p.recordType !== typeId) continue
          delete p.recordType
          p.updatedAt = t
        }
      })
      return true
    },

    setRecordType: (pageId, typeId) => {
      const st = get()
      const page = st.pages[pageId]
      if (!page?.databaseId || !st.databases[page.databaseId]) return false
      if ((page.recordType ?? null) === typeId) return true
      if (typeId !== null) {
        if (!st.kit?.recordTypes[typeId]) return false
        if (!(st.databases[page.databaseId].recordTypes ?? []).includes(typeId) && !get().attachRecordType(page.databaseId, typeId)) return false
      }
      set((s) => {
        const p = s.pages[pageId]
        if (!p) return
        if (typeId === null) delete p.recordType
        else p.recordType = typeId
        p.updatedAt = now()
      })
      return true
    },

    // comments bump the page's updatedAt: cross-tab sync compares pages by it (merge.ts samePage)
    addComment: (pageId, input) => {
      const id = input.id ?? newId()
      set((s) => {
        const p = s.pages[pageId]
        if (!p) return
        const t = now()
        const list = Array.isArray(p.comments) ? p.comments : (p.comments = [])
        if (list.some((c) => c.id === id)) return
        list.push({ id, quote: input.quote, body: input.body, author: s.settings.userName.trim(), createdAt: t, updatedAt: t, resolved: false, replies: [] })
        p.updatedAt = t
      })
      return id
    },

    updateComment: (pageId, commentId, patch) =>
      set((s) => {
        const p = s.pages[pageId]
        const c = Array.isArray(p?.comments) ? p.comments.find((x) => x.id === commentId) : undefined
        if (!p || !c) return
        Object.assign(c, patch)
        if (patch.body !== undefined) c.updatedAt = now()
        p.updatedAt = now()
      }),

    deleteComment: (pageId, commentId) =>
      set((s) => {
        const p = s.pages[pageId]
        if (!p || !Array.isArray(p.comments) || !p.comments.some((c) => c.id === commentId)) return
        p.comments = p.comments.filter((c) => c.id !== commentId)
        p.updatedAt = now()
      }),

    addCommentReply: (pageId, commentId, body) => {
      const id = newId()
      set((s) => {
        const p = s.pages[pageId]
        const c = Array.isArray(p?.comments) ? p.comments.find((x) => x.id === commentId) : undefined
        if (!p || !c) return
        const t = now()
        if (!Array.isArray(c.replies)) c.replies = []
        c.replies.push({ id, author: s.settings.userName.trim(), body, createdAt: t, updatedAt: t })
        p.updatedAt = t
      })
      return id
    },

    updateCommentReply: (pageId, commentId, replyId, body) =>
      set((s) => {
        const p = s.pages[pageId]
        const c = Array.isArray(p?.comments) ? p.comments.find((x) => x.id === commentId) : undefined
        const r = Array.isArray(c?.replies) ? c.replies.find((x) => x.id === replyId) : undefined
        if (!p || !r) return
        r.body = body
        r.updatedAt = now()
        p.updatedAt = r.updatedAt
      }),

    deleteCommentReply: (pageId, commentId, replyId) =>
      set((s) => {
        const p = s.pages[pageId]
        const c = Array.isArray(p?.comments) ? p.comments.find((x) => x.id === commentId) : undefined
        if (!p || !c || !Array.isArray(c.replies)) return
        c.replies = c.replies.filter((r) => r.id !== replyId)
        p.updatedAt = now()
      }),

    cloudPatch: (patch) =>
      set((s) => {
        let removed = false
        for (const [id, page] of Object.entries(patch.pages ?? {})) {
          if (page) s.pages[id] = page
          else if (s.pages[id]) {
            delete s.pages[id]
            removed = true
          }
        }
        for (const [id, db] of Object.entries(patch.databases ?? {})) {
          if (db) s.databases[id] = db
          else delete s.databases[id]
        }
        if (patch.people) s.people = patch.people
        for (const [id, fn] of Object.entries(patch.functions ?? {})) {
          s.functions ??= {}
          if (fn) s.functions[id] = fn
          else delete s.functions[id]
        }
        for (const [id, agent] of Object.entries(patch.agents ?? {})) {
          s.agents ??= {}
          if (agent) s.agents[id] = agent
          else delete s.agents[id]
        }
        for (const [id, script] of Object.entries(patch.scripts ?? {})) {
          s.scripts ??= {}
          if (script) s.scripts[id] = script
          else delete s.scripts[id]
        }
        if (patch.kit) {
          const kit = (s.kit ??= emptyKit())
          for (const part of ['lists', 'propTypes', 'recordTypes'] as const) {
            const target = kit[part] as Record<ID, unknown>
            for (const [id, entry] of Object.entries(patch.kit[part] ?? {})) {
              if (entry) target[id] = entry
              else delete target[id]
            }
          }
        }
        if (patch.settings) Object.assign(s.settings, withSealedKey({ ...s.settings, ...patch.settings }, s.settings.aiApiKey, s.epoch))
        if (removed && s.recent.some((r) => !s.pages[r])) s.recent = s.recent.filter((r) => !!s.pages[r])
      }),
  })),
)

attachSecrets({ getState: useWorkspace.getState, setState: (recipe) => useWorkspace.setState(recipe) })

/* ------------------------------------------------------------------ */
/* What a store change touched (shared by every subscriber)            */
/* ------------------------------------------------------------------ */

export interface PageChanges {
  /** pages that are new or a different object than before (added ones included) */
  changed: ID[]
  /** pages that are new */
  added: ID[]
  /** pages that are gone */
  removed: ID[]
}

const NO_CHANGES: PageChanges = { changed: [], added: [], removed: [] }
const keyCounts = new WeakMap<Record<ID, Page>, number>()
const recentDiffs: Array<{ next: Record<ID, Page>; prev: Record<ID, Page>; out: PageChanges }> = []

/**
 * Which pages differ between two page maps. Every store subscriber asks this for the same
 * (state, prev) pair, so it is computed once per change and shared — one Object.keys() pass
 * (for…in over a map of thousands of pages costs several times more). Removed pages are looked
 * for only when the key counts say there are some.
 */
export function pageChanges(next: Record<ID, Page>, prev: Record<ID, Page>): PageChanges {
  if (next === prev) return NO_CHANGES
  for (const d of recentDiffs) if (d.next === next && d.prev === prev) return d.out
  const out: PageChanges = { changed: [], added: [], removed: [] }
  const keys = Object.keys(next)
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i]
    const o = prev[id]
    if (next[id] === o) continue
    out.changed.push(id)
    if (o === undefined) out.added.push(id)
  }
  const before = keyCounts.get(prev) ?? Object.keys(prev).length
  if (before + out.added.length > keys.length) for (const id of Object.keys(prev)) if (!(id in next)) out.removed.push(id)
  rememberChanges(next, prev, out, keys.length, before)
  return out
}

/** Keep a diff for pageChanges() (computed there, or handed in by a write that knows it). */
function rememberChanges(next: Record<ID, Page>, prev: Record<ID, Page>, out: PageChanges, nextCount: number, prevCount: number) {
  keyCounts.set(next, nextCount)
  keyCounts.set(prev, prevCount)
  recentDiffs.unshift({ next, prev, out })
  recentDiffs.length = Math.min(recentDiffs.length, 3)
}

/** Snapshot of persistent data (without actions / flags). */
export function getWorkspaceSnapshot(): Workspace {
  const s = useWorkspace.getState()
  return {
    version: s.version,
    epoch: s.epoch,
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    settings: s.settings,
    recent: s.recent,
    functions: s.functions ?? {},
    agents: s.agents ?? {},
    scripts: s.scripts ?? {},
    kit: s.kit ?? emptyKit(),
  }
}
