/**
 * The MCP tools that reshape databases on the team server (docs/MCP.md): rename / re-icon a
 * database, change or delete a property (options, safe type changes), add / change / delete views.
 * The same rules, tables and messages as the local bridge (src/app/features/mcp/structure.ts and
 * MCP_TYPE_CHANGES / MCP_VIEW_TYPES in contract.ts — keep them in step). Views are written the way
 * the app stores them (docs/CLOUD.md § Meta document schema: `views` = Y.Map id → JSON View with
 * `order`); a locked database refuses all of it, and locking is the person's decision in the app.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { notFound } from '../errors.ts'
import { type PropertyDef, type Roots, type SelectOption, clone, liveDatabase, pageMap, propertiesMap, readOrdered, readPeople, roots } from '../api/meta.ts'
import { findProperty, metaDoc, type WorkspaceModel } from '../api/model.ts'
import { schemaOut } from '../api/values.ts'
import { newId } from '../tokens.ts'
import { iconOut } from './reads.ts'
import { COLORS, iconIn, propsMapOf, unprocessable, type OptionInput } from './writes.ts'

/** Layouts an agent can create or switch to (MCP_VIEW_TYPES). */
export const VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed'] as const
export type ViewType = (typeof VIEW_TYPES)[number]

/** Type changes whose values carry over (MCP_TYPE_CHANGES of the local bridge). */
export const TYPE_CHANGES: Record<string, readonly string[]> = {
  text: ['url', 'email', 'phone', 'select', 'multi_select'],
  url: ['text', 'email', 'phone'],
  email: ['text', 'url', 'phone'],
  phone: ['text', 'url', 'email'],
  select: ['multi_select', 'status', 'text'],
  status: ['select', 'multi_select', 'text'],
  multi_select: ['text'],
  number: ['text'],
}

interface Filter {
  id: string
  propertyId: string
  operator: string
  value?: unknown
}
interface FilterGroup {
  id: string
  op: 'and' | 'or'
  items: Array<Filter | FilterGroup>
}
/** A view as the app stores it (src/app/store/types.ts View) — only what these tools touch is typed. */
interface View {
  id: string
  name: string
  type: string
  filter: FilterGroup | null
  sorts: Array<{ propertyId: string; direction: 'asc' | 'desc' }>
  visibleProperties: string[]
  groupBy?: string | null
  dateProperty?: string | null
  cardPreview?: string
  cardSize?: string
  calculations?: Record<string, string>
  chart?: { xPropertyId?: string | null; yPropertyId?: string | null; aggregate?: string; [k: string]: unknown }
  feed?: { dateProperty?: string | null; [k: string]: unknown }
  colorRules?: Array<{ filter: FilterGroup; [k: string]: unknown }>
  [k: string]: unknown
}

export interface ViewInput {
  type?: string
  name?: string
  groupBy?: string | null
  dateProperty?: string | null
  filter?: Array<{ property: string; op: string; value?: unknown }> | null
  sort?: Array<{ property: string; desc: boolean }> | null
  properties?: string[]
}

export interface OptionChanges {
  add?: OptionInput[]
  update?: Array<{ name: string; newName?: string; color?: string; group?: string }>
  remove?: string[]
}

const q = (s: string) => JSON.stringify(s)
const titleOf = (p: { title: string } | null | undefined) => p?.title.trim() || 'Untitled'
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const BOARD_GROUP = ['status', 'select', 'multi_select', 'person', 'checkbox', 'created_by', 'last_edited_by']
const TABLE_GROUP = [...BOARD_GROUP, 'relation', 'text', 'url', 'email', 'phone', 'number', 'rating', 'date', 'created_time', 'last_edited_time', 'formula']
const DATE_TYPES = ['date', 'created_time', 'last_edited_time']
const DATE_TOKENS = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now']
const TEXTISH = new Set(['text', 'url', 'email', 'phone'])
const SELECTISH = new Set(['select', 'multi_select', 'status'])
const ALIAS: Record<string, string> = { eq: 'equals', is: 'equals', neq: 'not_equals', is_not: 'not_equals', before: 'lt', after: 'gt', on_or_before: 'lte', on_or_after: 'gte' }
const ME = '@me'
const VIEW_NAMES: Record<string, string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline', feed: 'Feed' }

/** The `views` Y.Map (an older entry's JSON list becomes keyed, like propsMapOf). */
function viewsMapOf(ydb: Y.Map<unknown>): Y.Map<unknown> {
  const cur = ydb.get('views')
  if (cur instanceof Y.Map) return cur as Y.Map<unknown>
  const fresh = new Y.Map<unknown>()
  readOrdered<View>(cur).forEach((v, i) => fresh.set(v.id, { ...v, order: i }))
  ydb.set('views', fresh)
  return fresh
}

const readViews = (ydb: Y.Map<unknown>): View[] => readOrdered<View>(ydb.get('views')).filter((v) => typeof v.id === 'string')
const viewOrder = (ydb: Y.Map<unknown>, id: string): number => {
  const v = (ydb.get('views') instanceof Y.Map ? ((ydb.get('views') as Y.Map<unknown>).get(id) as { order?: unknown } | undefined) : undefined)?.order
  return typeof v === 'number' ? v : 0
}

/** A new view like the app's defaultView (store.ts). */
function defaultView(type: ViewType, props: PropertyDef[], name?: string): View {
  const firstOf = (...types: string[]) => props.find((p) => types.includes(p.type))?.id ?? null
  const view: View = { id: newId(), name: name ?? VIEW_NAMES[type] ?? type, type, filter: null, sorts: [], visibleProperties: props.filter((p) => p.type !== 'title').map((p) => p.id), openIn: 'peek' }
  if (type === 'board') view.groupBy = firstOf('status', 'select', 'person', 'checkbox')
  if (type === 'calendar' || type === 'timeline') view.dateProperty = firstOf('date', 'created_time', 'last_edited_time')
  if (type === 'gallery') Object.assign(view, { cardPreview: 'cover', cardSize: 'medium' })
  return view
}

/** The filter without rules on a property (groups left empty go too). */
function stripFilter(g: FilterGroup | null | undefined, propId: string): FilterGroup | null {
  if (!isObj(g) || !Array.isArray(g.items)) return null
  const items = g.items.flatMap((it): FilterGroup['items'] => {
    if ('items' in it) {
      const sub = stripFilter(it, propId)
      return sub ? [sub] : []
    }
    return it.propertyId === propId ? [] : [it]
  })
  return items.length ? { ...g, items } : null
}

/** A view without anything pointing at a deleted property — what the app's delete clears. */
function withoutProperty(v: View, propId: string): View {
  const out: View = { ...v }
  out.visibleProperties = (v.visibleProperties ?? []).filter((x) => x !== propId)
  out.sorts = (v.sorts ?? []).filter((s) => s.propertyId !== propId)
  if (v.groupBy === propId) out.groupBy = null
  if (v.dateProperty === propId) out.dateProperty = null
  out.filter = stripFilter(v.filter, propId)
  if (v.calculations && propId in v.calculations) {
    const rest = { ...v.calculations }
    delete rest[propId]
    out.calculations = rest
  }
  if (v.chart && (v.chart.xPropertyId === propId || v.chart.yPropertyId === propId)) {
    out.chart = { ...v.chart }
    if (v.chart.xPropertyId === propId) out.chart.xPropertyId = null
    if (v.chart.yPropertyId === propId) Object.assign(out.chart, { yPropertyId: null, aggregate: 'count' })
  }
  if (v.cardPreview === propId) out.cardPreview = v.type === 'gallery' ? 'cover' : 'none'
  if (v.feed?.dateProperty === propId) out.feed = { ...v.feed, dateProperty: null }
  if (Array.isArray(v.colorRules)) out.colorRules = v.colorRules.map((r) => ({ ...r, filter: stripFilter(r.filter, propId) ?? { ...r.filter, items: [] } }))
  return out
}

/** A database the tools may reshape: live, not locked. */
function schemaDb(r: Roots, id: string) {
  const db = liveDatabase(r, id)
  if (!db) throw notFound('database_not_found', `No database with id ${q(id)} in this workspace. Use one_list_databases to get database ids.`)
  const title = titleOf(db.page)
  if (db.ydb.get('locked') === true) throw unprocessable('database_locked', `${q(title)} is locked in the app: its properties and views cannot change (rows can). Ask the person to unlock it. Nothing was changed.`)
  return { ...db, title }
}

function propertyOrThrow(props: PropertyDef[], ref: string, title: string): PropertyDef {
  const prop = findProperty(props, ref)
  if (!prop) throw notFound('property_not_found', `${q(title)} has no property ${q(ref)}. Properties: ${props.map((p) => q(p.name)).join(', ')}.`)
  return prop
}

function viewOrThrow(views: View[], ref: string, title: string): View {
  const byId = views.find((v) => v.id === ref)
  if (byId) return byId
  const named = views.filter((v) => norm(v.name) === norm(ref))
  if (named.length === 1) return named[0]!
  const list = views.map((v) => `${q(v.name)} (${v.id}, ${v.type})`).join(', ')
  throw notFound('view_not_found', named.length ? `${q(title)} has several views named ${q(ref)}: pass the id — ${list}.` : `${q(title)} has no view ${q(ref)}. Views: ${list}.`)
}

/** All rows of a database, the trashed ones too (a deleted property leaves none of its values). */
function allRows(r: Roots, dbId: string): Array<{ id: string; yp: Y.Map<unknown> }> {
  const out: Array<{ id: string; yp: Y.Map<unknown> }> = []
  for (const [id, yp] of r.pages.entries()) if (yp instanceof Y.Map && yp.get('databaseId') === dbId) out.push({ id, yp: yp as Y.Map<unknown> })
  return out
}
const valueOf = (yp: Y.Map<unknown>, propId: string): unknown => {
  const props = yp.get('properties')
  return props instanceof Y.Map ? clone((props as Y.Map<unknown>).get(propId)) : undefined
}

export class McpStructure {
  private readonly s: Services
  private readonly model: WorkspaceModel

  constructor(s: Services, model: WorkspaceModel) {
    this.s = s
    this.model = model
  }

  /* ---------------------------------------------------------------- the database */

  async updateDatabase(wsId: string, input: { id: string; title?: string; icon?: string; locked?: boolean }, actor: string) {
    const check = (r: Roots) => {
      const db = liveDatabase(r, input.id)
      if (!db) throw notFound('database_not_found', `No database with id ${q(input.id)} in this workspace. Use one_list_databases to get database ids.`)
      if (input.locked !== undefined)
        throw unprocessable('lock_is_personal', `Locking and unlocking ${q(titleOf(db.page))} is the person's decision in the app (the lock in the database's toolbar), so agents cannot change it. Nothing was changed.`)
      return db
    }
    await this.model.read(wsId, check)
    const title = input.title === undefined ? undefined : input.title.replace(/\s+/g, ' ').trim()
    if (title === '') throw unprocessable('invalid_request', '"title" must not be empty.')
    const icon = iconIn(input.icon)
    if (title === undefined && icon === undefined) throw unprocessable('invalid_request', 'Nothing to change: pass "title" and/or "icon".')
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const db = check(r)
        const yp = pageMap(r, db.page.id)!
        const changed: string[] = []
        if (title !== undefined && title !== db.page.title.trim()) changed.push('title')
        if (icon !== undefined && iconOut(icon) !== iconOut(yp.get('icon'))) changed.push('icon')
        // —— changes from here on ——
        if (changed.includes('title')) yp.set('title', title)
        if (changed.includes('icon')) yp.set('icon', icon)
        if (changed.length) {
          yp.set('updatedAt', Date.now())
          yp.set('updatedBy', actor)
        }
        return { id: db.page.id, title: String(yp.get('title') ?? ''), icon: iconOut(yp.get('icon')), url: this.model.url(wsId, db.page.id), changed, ...(changed.length ? {} : { note: 'No change: the database already looks like that.' }) }
      },
      actor,
    )
    if (out.changed.length) this.s.log.info('mcp database updated', { workspace: wsId, database: input.id, by: actor })
    return out
  }

  /* ---------------------------------------------------------------- properties */

  async deleteProperty(wsId: string, input: { databaseId: string; property: string }, actor: string) {
    const check = (r: Roots) => {
      const db = schemaDb(r, input.databaseId)
      const prop = propertyOrThrow(db.properties, input.property, db.title)
      if (prop.type === 'title') throw unprocessable('title_property', `${q(prop.name)} is the title property of ${q(db.title)}: every database keeps one. Nothing was changed.`)
      const withValue = allRows(r, db.page.id).filter((x) => x.yp.get('trashed') !== true && !isEmpty(valueOf(x.yp, prop.id))).length
      return { db, prop, withValue }
    }
    await this.model.read(wsId, check)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, prop, withValue } = check(r)
        // —— changes from here on ——
        propsMapOf(db.ydb).delete(prop.id)
        const vm = viewsMapOf(db.ydb)
        for (const v of readViews(db.ydb)) {
          const next = withoutProperty(v, prop.id)
          if (!same(next, v)) vm.set(v.id, clone({ ...next, order: viewOrder(db.ydb, v.id) }))
        }
        for (const { yp } of allRows(r, db.page.id)) {
          const props = propertiesMap(yp)
          if (props.has(prop.id)) {
            props.delete(prop.id)
            yp.set('updatedBy', actor)
          }
        }
        // rollups through this relation, or of this property from another database
        for (const otherId of r.databases.keys()) {
          const other = liveDatabase(r, otherId)
          if (!other) continue
          const pm = propsMapOf(other.ydb)
          for (const p of other.properties) {
            const roll = (p as PropertyDef & { rollup?: { relationPropertyId?: string; targetPropertyId?: string } }).rollup
            if (p.type !== 'rollup' || !roll) continue
            const rel = other.properties.find((x) => x.id === roll.relationPropertyId)
            let next: typeof roll | null = null
            if (otherId === db.page.id && roll.relationPropertyId === prop.id) next = { ...roll, relationPropertyId: '', targetPropertyId: '' }
            else if (rel?.relationDatabaseId === db.page.id && roll.targetPropertyId === prop.id) next = { ...roll, targetPropertyId: '' }
            if (next) pm.set(p.id, clone({ ...(pm.get(p.id) as object), rollup: next }))
          }
        }
        return { databaseId: db.page.id, deleted: { id: prop.id, name: prop.name, type: prop.type }, rowsWithValue: withValue }
      },
      actor,
    )
    this.s.log.info('mcp property deleted', { workspace: wsId, database: input.databaseId, property: out.deleted.id, by: actor })
    return { ...out, note: 'Deleted with its values (the trash keeps pages, not properties).' }
  }

  async updateProperty(wsId: string, input: { databaseId: string; property: string; name?: string; description?: string; type?: string; options?: OptionChanges }, actor: string) {
    if (input.name === undefined && input.description === undefined && input.type === undefined && input.options === undefined)
      throw unprocessable('invalid_request', 'Nothing to change: pass "name", "description", "type" and/or "options".')
    const check = (r: Roots) => {
      const db = schemaDb(r, input.databaseId)
      const prop = propertyOrThrow(db.properties, input.property, db.title)
      const def: PropertyDef = clone(prop)
      const changed: string[] = []
      if (input.name !== undefined) {
        const name = input.name.replace(/\s+/g, ' ').trim()
        if (!name) throw unprocessable('invalid_request', '"name" must not be empty.')
        if (db.properties.some((p) => p.id !== prop.id && norm(p.name) === norm(name))) throw unprocessable('property_exists', `${q(db.title)} already has a property named ${q(name)}.`)
        if (name !== prop.name) {
          def.name = name
          changed.push('name')
        }
      }
      if (input.description !== undefined) {
        const d = input.description.trim()
        if (d !== (prop.description ?? '')) {
          if (d) def.description = d
          else delete def.description
          changed.push('description')
        }
      }
      let toType: string | null = null
      if (input.type !== undefined && input.type !== prop.type) {
        if (prop.type === 'title') throw unprocessable('title_property', `${q(prop.name)} is the title property: its type stays.`)
        const allowed = TYPE_CHANGES[prop.type] ?? []
        if (!allowed.includes(input.type))
          throw unprocessable(
            'unsafe_type_change',
            `Changing ${q(prop.name)} from ${prop.type} to ${input.type} is not done over MCP: its values would not carry over safely. ${allowed.length ? `From ${prop.type} an agent may change it to: ${allowed.join(', ')}.` : `A ${prop.type} property keeps its type here.`} Ask the person to change it in the app. Nothing was changed.`,
          )
        toType = input.type
        changed.push('type')
      }
      let removed = new Set<string>()
      if (input.options !== undefined) {
        if (toType) throw unprocessable('invalid_request', 'Change the type and the options in two calls (first the type).')
        const plan = optionPlan(prop, input.options)
        removed = plan.removed
        if (!same(plan.options, prop.options ?? [])) {
          def.options = plan.options
          changed.push('options')
        }
      }
      const rows = allRows(r, db.page.id)
      const cleared = rows.filter((x) => x.yp.get('trashed') !== true && [valueOf(x.yp, prop.id)].flat().some((v) => typeof v === 'string' && removed.has(v))).length
      const converted = toType ? rows.filter((x) => x.yp.get('trashed') !== true && !isEmpty(valueOf(x.yp, prop.id))).length : 0
      return { db, prop, def, changed, toType, removed, cleared, converted }
    }
    const first = await this.model.read(wsId, check)
    if (!first.changed.length) return { databaseId: first.db.page.id, property: schemaOut(first.prop), changed: [], note: 'No change: the property already looks like that.' }
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, prop, def, changed, toType, removed, cleared, converted } = check(r)
        const rows = allRows(r, db.page.id)
        // —— changes from here on ——
        if (toType) {
          def.type = toType
          if (SELECTISH.has(toType)) {
            if (SELECTISH.has(prop.type)) def.options = (prop.options ?? []).map((o) => (toType === 'status' ? { ...o, group: o.group ?? 'todo' } : { id: o.id, name: o.name, ...(o.color ? { color: o.color } : {}) }))
            else {
              // text → options: one per distinct value (multi_select: comma-separated parts)
              const opts: SelectOption[] = []
              for (const { yp } of rows) {
                const v = valueOf(yp, prop.id)
                for (const part of toType === 'multi_select' && typeof v === 'string' ? v.split(',') : [typeof v === 'string' ? v : '']) {
                  const n = part.replace(/\s+/g, ' ').trim().slice(0, 60)
                  if (n && !opts.some((o) => norm(o.name) === norm(n)) && opts.length < 200) opts.push({ id: newId(), name: n, color: COLORS[opts.length % COLORS.length]! })
                }
              }
              def.options = opts
            }
          } else delete def.options
          if (prop.type === 'number') {
            delete (def as { numberFormat?: unknown }).numberFormat
            delete (def as { numberDisplay?: unknown }).numberDisplay
          }
          for (const { yp } of rows) {
            const props = propertiesMap(yp)
            if (!props.has(prop.id)) continue
            props.set(prop.id, clone(convertValue(prop, toType, valueOf(yp, prop.id), def.options ?? [])))
            yp.set('updatedBy', actor)
          }
        }
        const pm = propsMapOf(db.ydb)
        const stored = pm.get(prop.id) as { order?: number } | undefined
        pm.set(prop.id, clone({ ...def, order: stored?.order ?? 0 }))
        if (removed.size)
          for (const { yp } of rows) {
            const v = valueOf(yp, prop.id)
            const props = propertiesMap(yp)
            if (typeof v === 'string' && removed.has(v)) props.set(prop.id, null)
            else if (Array.isArray(v) && v.some((x) => removed.has(x))) props.set(prop.id, v.filter((x) => !removed.has(x)))
            else continue
            yp.set('updatedBy', actor)
          }
        return { databaseId: db.page.id, property: schemaOut(def), changed, ...(removed.size ? { cleared } : {}), ...(toType ? { converted } : {}) }
      },
      actor,
    )
    this.s.log.info('mcp property updated', { workspace: wsId, database: input.databaseId, property: out.property.id, by: actor })
    return out
  }

  /* ---------------------------------------------------------------- views */

  async createView(wsId: string, input: { databaseId: string; type: string } & ViewInput, actor: string) {
    if (!(VIEW_TYPES as readonly string[]).includes(input.type)) throw unprocessable('invalid_view', `"type" must be one of ${VIEW_TYPES.join(', ')} (chart and form views are set up in the app).`)
    const check = (r: Roots) => {
      const db = schemaDb(r, input.databaseId)
      const base = defaultView(input.type as ViewType, db.properties)
      const patch = viewChange(r, db.properties, { ...input, type: undefined }, base, this.model.context(wsId, r).members)
      return { db, view: { ...base, ...patch } as View }
    }
    await this.model.read(wsId, check)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, view } = check(r)
        const order = Math.max(-1, ...readViews(db.ydb).map((v) => viewOrder(db.ydb, v.id))) + 1
        // —— changes from here on ——
        viewsMapOf(db.ydb).set(view.id, clone({ ...view, order }))
        return { databaseId: db.page.id, view: viewJson(r, db.properties, view) }
      },
      actor,
    )
    this.s.log.info('mcp view created', { workspace: wsId, database: input.databaseId, view: out.view.id, by: actor })
    return out
  }

  async updateView(wsId: string, input: { databaseId: string; view: string } & ViewInput, actor: string) {
    const check = (r: Roots) => {
      const db = schemaDb(r, input.databaseId)
      const view = viewOrThrow(readViews(db.ydb), input.view, db.title)
      const patch = viewChange(r, db.properties, input, view, this.model.context(wsId, r).members)
      return { db, view, patch }
    }
    const first = await this.model.read(wsId, check)
    if (!Object.keys(first.patch).length) return { databaseId: first.db.page.id, view: await this.model.read(wsId, (r) => viewJson(r, first.db.properties, first.view)), note: 'No change: the view already looks like that.' }
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, view, patch } = check(r)
        const next = { ...view, ...patch }
        // —— changes from here on ——
        viewsMapOf(db.ydb).set(view.id, clone({ ...next, order: viewOrder(db.ydb, view.id) }))
        return { databaseId: db.page.id, view: viewJson(r, db.properties, next) }
      },
      actor,
    )
    this.s.log.info('mcp view updated', { workspace: wsId, database: input.databaseId, view: out.view.id, by: actor })
    return out
  }

  async deleteView(wsId: string, input: { databaseId: string; view: string }, actor: string) {
    const check = (r: Roots) => {
      const db = schemaDb(r, input.databaseId)
      const views = readViews(db.ydb)
      const view = viewOrThrow(views, input.view, db.title)
      if (views.length <= 1) throw unprocessable('last_view', `${q(view.name)} is the only view of ${q(db.title)}: a database keeps at least one. Nothing was changed.`)
      return { db, view }
    }
    await this.model.read(wsId, check)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { db, view } = check(r)
        // —— changes from here on ——
        viewsMapOf(db.ydb).delete(view.id)
        return { databaseId: db.page.id, deleted: { id: view.id, name: view.name, type: view.type }, views: readViews(db.ydb).map((v) => ({ id: v.id, name: v.name, type: v.type })) }
      },
      actor,
    )
    this.s.log.info('mcp view deleted', { workspace: wsId, database: input.databaseId, view: out.deleted.id, by: actor })
    return out
  }
}

/* ------------------------------------------------------------------ helpers */

function optionPlan(prop: PropertyDef, input: OptionChanges): { options: SelectOption[]; removed: Set<string> } {
  if (!SELECTISH.has(prop.type)) throw unprocessable('invalid_request', `"options": ${q(prop.name)} is ${prop.type} — options belong to select, multi_select and status.`)
  let options: SelectOption[] = clone(prop.options ?? [])
  const removed = new Set<string>()
  const find = (name: string, key: string) => {
    const hit = options.find((x) => norm(x.name) === norm(name))
    if (!hit) throw unprocessable('invalid_option', `${key}: ${q(prop.name)} has no option ${q(name)}. Options: ${options.map((x) => q(x.name)).join(', ') || 'none'}.`)
    return hit
  }
  for (const name of input.remove ?? []) {
    const hit = find(name, 'options.remove')
    removed.add(hit.id)
    options = options.filter((x) => x.id !== hit.id)
  }
  for (const u of input.update ?? []) {
    const hit = find(u.name, 'options.update')
    const next = { ...hit }
    if (u.newName !== undefined) {
      const nn = u.newName.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (!nn) throw unprocessable('invalid_option', 'options.update: "newName" must not be empty.')
      if (options.some((x) => x.id !== hit.id && norm(x.name) === norm(nn))) throw unprocessable('invalid_option', `options.update: ${q(prop.name)} has an option ${q(nn)} already.`)
      next.name = nn
    }
    if (u.color !== undefined) {
      const c = u.color.trim().toLowerCase()
      if (!(COLORS as readonly string[]).includes(c)) throw unprocessable('invalid_option', `options.update: ${q(u.color)} is not a colour. Use one of: ${COLORS.join(', ')}.`)
      next.color = c
    }
    if (u.group !== undefined) {
      if (prop.type !== 'status') throw unprocessable('invalid_option', 'options.update: "group" applies to status options only.')
      next.group = u.group
    }
    options = options.map((x) => (x.id === hit.id ? next : x))
  }
  const addedNames = new Set<string>()
  for (const [i, o] of (input.add ?? []).entries()) {
    const spec = typeof o === 'string' ? { name: o } : o
    const name = spec.name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name || addedNames.has(norm(name))) continue
    if (options.some((x) => norm(x.name) === norm(name))) throw unprocessable('invalid_option', `options.add: ${q(prop.name)} has an option ${q(name)} already.`)
    addedNames.add(norm(name))
    const color = spec.color && (COLORS as readonly string[]).includes(spec.color.toLowerCase()) ? spec.color.toLowerCase() : COLORS[(options.length + i) % COLORS.length]!
    options.push({ id: newId(), name, color, ...(prop.type === 'status' ? { group: spec.group ?? 'todo' } : {}) })
  }
  if (prop.type === 'status' && !options.length) throw unprocessable('invalid_option', `${q(prop.name)} is a status: it keeps at least one option.`)
  if (options.length > 200) throw unprocessable('invalid_option', `${q(prop.name)} would have more than 200 options.`)
  return { options, removed }
}

/** One stored value converted to the new type (TYPE_CHANGES only). */
function convertValue(from: PropertyDef, to: string, v: unknown, options: SelectOption[]): unknown {
  const name = (id: unknown) => from.options?.find((o) => o.id === id)?.name ?? ''
  const byName = (n: string) => options.find((o) => norm(o.name) === norm(n))?.id
  if (TEXTISH.has(to)) {
    if (TEXTISH.has(from.type)) return typeof v === 'string' ? v : ''
    if (from.type === 'select' || from.type === 'status') return name(v)
    if (from.type === 'multi_select') return (Array.isArray(v) ? v : []).map(name).filter(Boolean).join(', ')
    if (from.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
    return ''
  }
  if (TEXTISH.has(from.type)) {
    const text = typeof v === 'string' ? v.trim() : ''
    if (to === 'select') return (text && byName(text)) || null
    return text.split(',').map((x) => byName(x.trim())).filter((x): x is string => !!x)
  }
  if (to === 'multi_select') return typeof v === 'string' && v ? [v] : Array.isArray(v) ? v : []
  return typeof v === 'string' ? v : null
}

type Member = { id: string; email: string; name: string | null }

/** A property by name for a view setting ("title" = the title property). */
function viewProp(props: PropertyDef[], ref: string, key: string, problems: string[]): PropertyDef | null {
  const prop = findProperty(props, ref) ?? (norm(ref) === 'title' ? props.find((p) => p.type === 'title') : undefined)
  if (!prop) problems.push(`${key}: no property ${q(ref)} (properties: ${props.map((p) => q(p.name)).join(', ')})`)
  return prop ?? null
}

/** One MCP filter condition → the app's Filter (src/app/database/model/query.ts testFilter). */
function toFilter(r: Roots, props: PropertyDef[], members: Member[], raw: { property: string; op: string; value?: unknown }, i: number, problems: string[]): Filter | null {
  const key = `filter[${i}]`
  const prop = viewProp(props, raw.property, key, problems)
  if (!prop) return null
  const given = raw.op.trim().toLowerCase()
  const op = ALIAS[given] ?? given
  const v = raw.value
  const sv = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v)
  const make = (operator: string, value?: unknown): Filter => ({ id: newId(), propertyId: prop.id, operator, ...(value !== undefined ? { value } : {}) })
  const bad = (ops: string) => {
    problems.push(`${key}: ${q(prop.name)} (${prop.type}) takes ${ops} — not ${given}`)
    return null
  }
  if (op === 'is_empty' || op === 'is_not_empty') return prop.type === 'checkbox' ? make(op === 'is_empty' ? 'is_not_checked' : 'is_checked') : make(op)
  const need = () => {
    if (sv) return true
    problems.push(`${key}: ${given} needs a "value"`)
    return false
  }
  switch (prop.type) {
    case 'number':
    case 'rating':
    case 'unique_id': {
      const map: Record<string, string> = { equals: 'eq', not_equals: 'neq', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte' }
      if (!map[op]) return bad('equals, not_equals, gt, gte, lt, lte, is_empty, is_not_empty')
      const n = typeof v === 'number' ? v : Number(sv.replace(/^[A-Za-z]+-/, ''))
      if (!Number.isFinite(n)) {
        problems.push(`${key}: ${q(prop.name)} compares numbers — ${q(sv)} is none`)
        return null
      }
      return make(map[op]!, n)
    }
    case 'checkbox': {
      if (op !== 'is_checked' && op !== 'is_not_checked' && op !== 'equals' && op !== 'not_equals') return bad('is_checked, is_not_checked or equals true / false')
      const on = op === 'is_checked' || ((op === 'equals' || op === 'not_equals') && ['true', 'yes', 'ja', '1', 'checked', 'x'].includes(sv.toLowerCase()) !== (op === 'not_equals'))
      return make(on ? 'is_checked' : 'is_not_checked')
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const multi = prop.type === 'multi_select'
      const map: Record<string, string> = multi ? { equals: 'contains', contains: 'contains', not_equals: 'not_contains', not_contains: 'not_contains' } : { equals: 'is', not_equals: 'is_not' }
      if (!map[op]) return bad(multi ? 'contains, not_contains, is_empty, is_not_empty' : 'equals, not_equals, is_empty, is_not_empty')
      if (!need()) return null
      const opt = prop.options?.find((x) => norm(x.name) === norm(sv) || x.id === sv)
      if (!opt) {
        problems.push(`${key}: ${q(prop.name)} has no option ${q(sv)} (options: ${(prop.options ?? []).map((x) => q(x.name)).join(', ')})`)
        return null
      }
      return make(map[op]!, opt.id)
    }
    case 'person':
    case 'created_by':
    case 'last_edited_by': {
      const actor = prop.type !== 'person'
      const map: Record<string, string> = actor ? { equals: 'is', not_equals: 'is_not' } : { equals: 'contains', contains: 'contains', not_equals: 'not_contains', not_contains: 'not_contains' }
      if (!map[op]) return bad(actor ? 'equals, not_equals' : 'contains, not_contains, is_empty, is_not_empty')
      if (!need()) return null
      if (['me', '@me', 'ich'].includes(sv.toLowerCase())) return make(map[op]!, ME)
      const people = readPeople(r)
      const ids = new Set<string>()
      for (const m of members) if (m.email === sv.toLowerCase() || m.id === sv || norm(people.get(m.id)?.name ?? m.name ?? '') === norm(sv)) ids.add(m.id)
      for (const p of people.values()) if (p.id === sv || norm(p.name) === norm(sv)) ids.add(p.id)
      if (ids.size !== 1) {
        problems.push(`${key}: ${ids.size ? 'several people' : 'nobody'} called ${q(sv)} (people: ${[...people.values()].map((p) => q(p.name)).join(', ') || 'none'}, or "me")`)
        return null
      }
      return make(map[op]!, [...ids][0])
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const map: Record<string, string> = { equals: 'is', lt: 'before', gt: 'after', lte: 'on_or_before', gte: 'on_or_after' }
      if (!map[op]) return bad('equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty')
      if (!need()) return null
      const day = DATE_TOKENS.includes(sv.toLowerCase()) ? sv.toLowerCase() : /^\d{4}-\d{2}-\d{2}/.test(sv) ? sv.slice(0, 10) : null
      if (!day) {
        problems.push(`${key}: ${q(sv)} is not a date — use "YYYY-MM-DD" or ${DATE_TOKENS.map((x) => q(x)).join(', ')}`)
        return null
      }
      return make(map[op]!, { start: day })
    }
    case 'formula':
    case 'rollup':
      problems.push(`${key}: filters on ${prop.type} properties are set up in the app`)
      return null
    default: {
      const map: Record<string, string> = { equals: 'is', not_equals: 'is_not', contains: 'contains', not_contains: 'not_contains', starts_with: 'starts_with', ends_with: 'ends_with' }
      if (!map[op]) return bad('equals, not_equals, contains, not_contains, starts_with, ends_with, is_empty, is_not_empty')
      if (!need()) return null
      return make(map[op]!, sv)
    }
  }
}

/** A filter without its generated ids (to tell whether it changes). */
const flatKey = (g: FilterGroup | null | undefined): unknown => (g?.items.length ? g.items.map((it) => ('items' in it ? flatKey(it) : [it.propertyId, it.operator, it.value ?? null])) : null)

/** The view settings of a create / update call, validated against the schema; the patch for `base`. */
function viewChange(r: Roots, props: PropertyDef[], input: ViewInput, base: View, members: Member[]): Partial<View> {
  const problems: string[] = []
  const patch: Partial<View> = {}
  const typeOf = (id: string | null | undefined) => props.find((p) => p.id === id)?.type ?? ''
  let type = base.type
  if (input.type !== undefined && input.type !== base.type) {
    if (!(VIEW_TYPES as readonly string[]).includes(input.type)) problems.push(`type: one of ${VIEW_TYPES.join(', ')} (chart and form views are set up in the app)`)
    else {
      type = input.type
      patch.type = type
      // like switching the layout in the app: a board needs a group, a calendar a date
      const d = defaultView(type as ViewType, props)
      if (type === 'board' && !(base.groupBy && BOARD_GROUP.includes(typeOf(base.groupBy)))) patch.groupBy = d.groupBy ?? null
      if ((type === 'calendar' || type === 'timeline') && !base.dateProperty) patch.dateProperty = d.dateProperty ?? null
      if (type === 'gallery') Object.assign(patch, { cardPreview: base.cardPreview ?? 'cover', cardSize: base.cardSize ?? 'medium' })
    }
  }
  if (input.name !== undefined) {
    const name = input.name.replace(/\s+/g, ' ').trim()
    if (!name) problems.push('name: must not be empty')
    else if (name !== base.name) patch.name = name
  }
  if (input.groupBy !== undefined) {
    if (input.groupBy === null || input.groupBy === '') {
      if (type === 'board') problems.push('groupBy: a board always groups — pass a property')
      else if (base.groupBy) patch.groupBy = null
    } else if (type !== 'board' && type !== 'table' && type !== 'list') problems.push(`groupBy: only table, list and board views group (this one is ${type})`)
    else {
      const prop = viewProp(props, input.groupBy, 'groupBy', problems)
      const allowed = type === 'board' ? BOARD_GROUP : TABLE_GROUP
      if (prop && !allowed.includes(prop.type)) problems.push(`groupBy: a ${type} cannot group by ${q(prop.name)} (${prop.type}); it groups by ${allowed.join(', ')}`)
      else if (prop && prop.id !== base.groupBy) patch.groupBy = prop.id
    }
  }
  if (type === 'board' && !(patch.groupBy ?? base.groupBy)) problems.push(`groupBy: a board needs a ${BOARD_GROUP.join(' / ')} property to group by — this database has none (one_create_property adds one)`)
  if (input.dateProperty !== undefined) {
    const none = input.dateProperty === null || input.dateProperty === ''
    if (type === 'feed') {
      const prop = none ? null : viewProp(props, input.dateProperty!, 'dateProperty', problems)
      if (prop && !DATE_TYPES.includes(prop.type)) problems.push(`dateProperty: ${q(prop.name)} is no date (${DATE_TYPES.join(', ')})`)
      else if (none || prop) patch.feed = { ...base.feed, dateProperty: prop?.id ?? null }
    } else if (type !== 'calendar' && type !== 'timeline') problems.push(`dateProperty: only calendar, timeline and feed views have one (this one is ${type})`)
    else if (none) problems.push(`dateProperty: a ${type} always needs one`)
    else {
      const prop = viewProp(props, input.dateProperty!, 'dateProperty', problems)
      if (prop && !DATE_TYPES.includes(prop.type)) problems.push(`dateProperty: ${q(prop.name)} is no date (${DATE_TYPES.join(', ')})`)
      else if (prop && prop.id !== base.dateProperty) patch.dateProperty = prop.id
    }
  }
  if ((type === 'calendar' || type === 'timeline') && !(patch.dateProperty ?? base.dateProperty)) problems.push(`dateProperty: a ${type} needs a date property — this database has none (one_create_property adds one)`)
  if (input.filter !== undefined) {
    const items = (input.filter ?? []).slice(0, 20).map((f, i) => toFilter(r, props, members, f, i, problems)).filter((f): f is Filter => !!f)
    const filter: FilterGroup | null = items.length ? { id: newId(), op: 'and', items } : null
    if (!same(flatKey(filter), flatKey(base.filter))) patch.filter = filter
  }
  if (input.sort !== undefined) {
    const sorts: View['sorts'] = []
    for (const s of input.sort ?? []) {
      const prop = viewProp(props, s.property, 'sort', problems)
      if (prop && !sorts.some((x) => x.propertyId === prop.id)) sorts.push({ propertyId: prop.id, direction: s.desc ? 'desc' : 'asc' })
    }
    if (!same(sorts, base.sorts ?? [])) patch.sorts = sorts
  }
  if (input.properties !== undefined) {
    const ids: string[] = []
    for (const n of input.properties.slice(0, 100)) {
      const prop = viewProp(props, n, 'properties', problems)
      if (prop && prop.type !== 'title' && !ids.includes(prop.id)) ids.push(prop.id)
    }
    if (!same(ids, base.visibleProperties)) patch.visibleProperties = ids
  }
  if (problems.length) throw unprocessable('invalid_view', `Nothing was changed: ${problems.join('; ')}.`)
  return patch
}

/** The view as agents see it: names instead of ids (the local bridge's viewJson). */
function viewJson(r: Roots, props: PropertyDef[], v: View) {
  const nameOf = (id: unknown) => (typeof id === 'string' ? (props.find((p) => p.id === id)?.name ?? null) : null)
  const people = readPeople(r)
  const valueOut = (f: Filter): unknown => {
    const prop = props.find((p) => p.id === f.propertyId)
    const val = f.value
    if (val === undefined || val === null) return undefined
    if (prop?.options && typeof val === 'string') return prop.options.find((o) => o.id === val)?.name ?? val
    if (val === ME) return 'me'
    if (typeof val === 'string' && (prop?.type === 'person' || prop?.type === 'created_by' || prop?.type === 'last_edited_by')) return people.get(val)?.name ?? val
    if (isObj(val) && typeof val.start === 'string') return val.start
    return val
  }
  const flat = (g: FilterGroup | null | undefined): Array<Record<string, unknown>> =>
    (g?.items ?? []).flatMap((it) => ('items' in it ? flat(it) : [{ property: nameOf(it.propertyId) ?? it.propertyId, op: it.operator, ...(valueOut(it) !== undefined ? { value: valueOut(it) } : {}) }]))
  const feedDate = v.type === 'feed' ? nameOf(v.feed?.dateProperty) : null
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    ...(nameOf(v.groupBy) ? { groupBy: nameOf(v.groupBy) } : {}),
    ...(nameOf(v.dateProperty) && v.type !== 'feed' ? { dateProperty: nameOf(v.dateProperty) } : {}),
    ...(feedDate ? { dateProperty: feedDate } : {}),
    ...(v.filter?.items?.length ? { filter: flat(v.filter), ...(v.filter.op === 'or' ? { filterMatch: 'any' } : {}) } : {}),
    ...(v.sorts?.length ? { sorts: v.sorts.map((s) => ({ property: nameOf(s.propertyId) ?? s.propertyId, direction: s.direction })) } : {}),
    properties: (v.visibleProperties ?? []).map(nameOf).filter((n): n is string => !!n),
  }
}
