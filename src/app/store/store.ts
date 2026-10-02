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
import type {
  Database,
  ID,
  Page,
  PageSettings,
  Person,
  PropertyDef,
  PropertyValue,
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
  updateSettings: (patch: Partial<Settings>) => void
}

const now = () => Date.now()

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

/** All descendant ids (children, grandchildren, rows of databases …). */
export function descendantIds(pages: Record<ID, Page>, id: ID): ID[] {
  const byParent = new Map<ID, ID[]>()
  for (const p of Object.values(pages)) {
    if (!p.parentId) continue
    const arr = byParent.get(p.parentId) ?? []
    arr.push(p.id)
    byParent.set(p.parentId, arr)
  }
  const out: ID[] = []
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    out.push(cur)
    stack.push(...(byParent.get(cur) ?? []))
  }
  return out
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

export const useWorkspace = create<WorkspaceState>()(
  immer((set, get) => ({
    ...emptyWorkspace(),
    ready: false,

    hydrate: (ws) =>
      set((s) => {
        Object.assign(s, ws)
        s.ready = true
      }),

    replaceAll: (ws) =>
      set((s) => {
        s.version = ws.version
        s.pages = ws.pages
        s.databases = ws.databases
        s.people = ws.people
        s.settings = ws.settings
        s.recent = ws.recent
      }),

    createPage: (input = {}) => {
      const page = makePage(input, get().pages)
      set((s) => {
        s.pages[page.id] = page
      })
      return page.id
    },

    updatePage: (id, patch) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        Object.assign(p, patch)
        p.updatedAt = now()
      }),

    updatePageSettings: (id, patch) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        Object.assign(p.settings, patch)
        p.updatedAt = now()
      }),

    setContent: (id, content, origin) =>
      set((s) => {
        const p = s.pages[id]
        if (!p) return
        p.content = content
        p.contentRev += 1
        p.contentOrigin = origin
        p.updatedAt = now()
        p.plain = plainText(content)
      }),

    movePage: (id, parentId, index) =>
      set((s) => {
        const p = s.pages[id]
        if (!p || id === parentId) return
        // prevent moving into own descendant
        if (parentId && descendantIds(s.pages, id).includes(parentId)) return
        p.parentId = parentId
        p.order = index === undefined ? nextOrder(s.pages, parentId) : orderAt(s.pages, parentId, index, id)
        p.updatedAt = now()
      }),

    duplicatePage: (id) => {
      const state = get()
      const src = state.pages[id]
      if (!src) return null
      const idMap = new Map<ID, ID>()
      const all = [id, ...descendantIds(state.pages, id)]
      for (const oldId of all) idMap.set(oldId, newId())
      set((s) => {
        for (const oldId of all) {
          const o = s.pages[oldId]
          if (!o || o.trashed) continue
          const copy: Page = JSON.parse(JSON.stringify(o))
          copy.id = idMap.get(oldId)!
          copy.parentId = o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : o.parentId
          copy.databaseId = o.databaseId && idMap.has(o.databaseId) ? idMap.get(o.databaseId)! : o.databaseId
          copy.favorite = false
          copy.createdAt = copy.updatedAt = now()
          copy.contentRev = 0
          copy.contentOrigin = null
          if (oldId === id) {
            copy.title = o.title ? `${o.title} (copy)` : ''
            copy.order = o.order + 0.5
          }
          s.pages[copy.id] = copy
          const db = s.databases[oldId]
          if (db) {
            const dbCopy: Database = JSON.parse(JSON.stringify(db))
            dbCopy.id = copy.id
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

    createDatabase: (input = {}) => {
      const pages = get().pages
      const id = input.id ?? newId()
      const properties: PropertyDef[] = input.properties ?? [
        { id: newId(), name: 'Name', type: 'title' },
        {
          id: newId(),
          name: 'Status',
          type: 'status',
          options: [
            { id: newId(), name: 'Not started', color: 'gray', group: 'todo' },
            { id: newId(), name: 'In progress', color: 'blue', group: 'in_progress' },
            { id: newId(), name: 'Done', color: 'green', group: 'done' },
          ],
        },
        { id: newId(), name: 'Tags', type: 'multi_select', options: [] },
        { id: newId(), name: 'Date', type: 'date' },
      ]
      if (!properties.some((p) => p.type === 'title')) properties.unshift({ id: newId(), name: 'Name', type: 'title' })
      const db: Database = {
        id,
        properties,
        views: [],
        nextUniqueId: 1,
        inline: input.inline ?? false,
      }
      db.views = input.views ?? [defaultView('table', db, 'Table')]
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
        const prop: PropertyDef = { name: def.name ?? 'Property', ...def, id } as PropertyDef
        if ((prop.type === 'select' || prop.type === 'multi_select') && !prop.options) prop.options = []
        if (prop.type === 'status' && !prop.options)
          prop.options = [
            { id: newId(), name: 'Not started', color: 'gray', group: 'todo' },
            { id: newId(), name: 'In progress', color: 'blue', group: 'in_progress' },
            { id: newId(), name: 'Done', color: 'green', group: 'done' },
          ]
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
      const v: View = { ...defaultView(view.type, db), ...view }
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
      const copy: View = { ...JSON.parse(JSON.stringify(v)), id: newId(), name: `${v.name} (copy)` }
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

    setRowProperty: (rowId, propId, value) =>
      set((s) => {
        const p = s.pages[rowId]
        if (!p) return
        p.properties[propId] = value
        p.updatedAt = now()
      }),

    addPerson: (name) => {
      const person: Person = { id: newId(), name, color: (['orange', 'blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'red'] as const)[get().people.length % 8] }
      set((s) => {
        s.people.push(person)
      })
      return person.id
    },

    updateSettings: (patch) =>
      set((s) => {
        Object.assign(s.settings, patch)
      }),
  })),
)

/** Snapshot of persistent data (without actions / flags). */
export function getWorkspaceSnapshot(): Workspace {
  const s = useWorkspace.getState()
  return {
    version: s.version,
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    settings: s.settings,
    recent: s.recent,
  }
}
