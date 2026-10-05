/**
 * One MCP — reshaping databases: rename / re-icon a database, change or delete a property (options,
 * safe type changes), add / change / delete views. A locked database refuses all of it (rows stay
 * editable — database/model/lock.ts); locking itself is the person's decision.
 *
 * Deleting a property clears what pointed at it the way the app's delete does
 * (database/model/actions.ts): view filters, calculations, chart axes, card previews, colour rules,
 * rollups. Every change has an undo for the agent log that leaves alone what was edited since.
 */
import { t } from '../../i18n'
import { newId } from '../../lib/ids'
import { defaultView } from '../../store/store'
import { inTemplate } from '../../store/selectors'
import type { Database, DateValue, Filter, FilterGroup, FilterOperator, ID, Page, PropertyDef, PropertyType, PropertyValue, SelectOption, Sort, View, ViewType } from '../../store/types'
import { MCP_FILTER_OPS, MCP_TYPE_CHANGES, MCP_VIEW_TYPES, type McpToolName } from './contract'
import { chars, cleanName, clone, colorOf, optionsOf, palette, parseIcon, same, str, type PlanLine, type WritePlan } from './plan'
import { databaseOrThrow, iconText, McpToolError, pageUrl, propertyJson, q, titleOf, TWO_WAY_SUFFIX, ws } from './values'

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** A database the tools may reshape: live, not a template's, not locked. */
function schemaDb(id: unknown): { db: Database; page: Page; title: string } {
  const { db, page } = databaseOrThrow(id)
  if (inTemplate(ws().pages, db.id)) throw new McpToolError(`No database with id ${q(String(id))}. Use one_list_databases to get database ids.`)
  const title = titleOf(page)
  if (db.locked) throw new McpToolError(`${q(title)} is locked in One: its properties and views cannot change (rows can). Ask the person to unlock it. Nothing was changed.`)
  return { db, page, title }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function propertyOrThrow(db: Database, raw: unknown, title: string, key = 'property'): PropertyDef {
  const ref = str(raw, key, { required: true, max: 200 }).trim()
  const prop = db.properties.find((p) => p.id === ref) ?? db.properties.find((p) => norm(p.name) === norm(ref))
  if (!prop) throw new McpToolError(`${q(title)} has no property ${q(ref)}. Properties: ${db.properties.map((p) => q(p.name)).join(', ')}.`)
  return prop
}

function viewOrThrow(db: Database, raw: unknown, title: string): View {
  const ref = str(raw, 'view', { required: true, max: 200 }).trim()
  const byId = db.views.find((v) => v.id === ref)
  if (byId) return byId
  const named = db.views.filter((v) => norm(v.name) === norm(ref))
  if (named.length === 1) return named[0]
  const list = db.views.map((v) => `${q(v.name)} (${v.id}, ${v.type})`).join(', ')
  throw new McpToolError(named.length ? `${q(title)} has several views named ${q(ref)}: pass the id — ${list}.` : `${q(title)} has no view ${q(ref)}. Views: ${list}.`)
}

/** Every row of the database, the trashed ones too (the store clears values on all of them). */
const allRows = (dbId: ID): Page[] => Object.values(ws().pages).filter((p) => p.databaseId === dbId)
const isEmpty = (v: PropertyValue | undefined) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)

/* ------------------------------------------------------------------ */
/* one_update_database                                                 */
/* ------------------------------------------------------------------ */

function planUpdateDatabase(args: Record<string, unknown>): WritePlan {
  const { db, page } = databaseOrThrow(args.id)
  if (inTemplate(ws().pages, db.id)) throw new McpToolError(`No database with id ${q(String(args.id))}. Use one_list_databases to get database ids.`)
  const name = titleOf(page)
  if (args.locked !== undefined && args.locked !== null)
    throw new McpToolError(`Locking and unlocking ${q(name)} is the person's decision in One (the lock in the database's toolbar), so agents cannot change it. Nothing was changed.`)
  const title = args.title === undefined || args.title === null ? null : cleanName(args.title, 'title')
  if (title === '') throw new McpToolError('"title" must not be empty.')
  const icon = parseIcon(args.icon)
  if (title === null && icon === undefined) throw new McpToolError('Nothing to change: pass "title" and/or "icon".')
  const lines: PlanLine[] = []
  const changed: string[] = []
  if (title !== null && title !== page.title.trim()) {
    lines.push({ k: 'prop', name: t('features.mcp.plan.title'), before: page.title.trim() || t('common.untitled'), after: title })
    changed.push('title')
  }
  if (icon !== undefined && iconText(icon) !== iconText(page.icon)) {
    lines.push({ k: 'prop', name: t('features.mcp.plan.icon'), before: iconText(page.icon) ?? '—', after: iconText(icon) ?? '—' })
    changed.push('icon')
  }
  const result = () => {
    const p = ws().pages[db.id]
    return { id: db.id, title: p?.title ?? page.title, icon: iconText(p?.icon), url: pageUrl(db.id), changed }
  }
  return {
    tool: 'one_update_database',
    verb: t('features.mcp.verb.updateDatabase'),
    summary: t('features.mcp.sum.updateDatabase', { title: name }),
    target: name,
    lines,
    noop: changed.length ? undefined : { ...result(), note: 'No change: the database already looks like that.' },
    async apply() {
      const prev = ws().pages[db.id]
      if (!prev || prev.trashed) throw new McpToolError(`${q(name)} is gone. Nothing was changed.`)
      const patch: Partial<Page> = {}
      if (changed.includes('title')) patch.title = title!
      if (changed.includes('icon')) patch.icon = icon ?? null
      const before = { title: prev.title, icon: prev.icon }
      ws().updatePage(db.id, patch)
      return {
        result: result(),
        undo: () => {
          const now = ws().pages[db.id]
          if (!now) return false
          const back: Partial<Page> = {}
          if (patch.title !== undefined && now.title === patch.title) back.title = before.title
          if (patch.icon !== undefined && iconText(now.icon) === iconText(patch.icon)) back.icon = before.icon
          if (Object.keys(back).length) ws().updatePage(db.id, back)
          return Object.keys(back).length === Object.keys(patch).length
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_delete_property                                                 */
/* ------------------------------------------------------------------ */

/** The filter without rules on a property (groups left empty go too). */
function stripFilter(g: FilterGroup | null | undefined, propId: ID): FilterGroup | null {
  if (!g) return null
  const items = g.items.flatMap((it): FilterGroup['items'] => {
    if ('items' in it) {
      const sub = stripFilter(it, propId)
      return sub ? [sub] : []
    }
    return it.propertyId === propId ? [] : [it]
  })
  return items.length ? { ...g, items } : null
}

/** View settings that would point at a deleted property — what the app's delete clears on top of the store. */
function danglingPatch(v: View, propId: ID): Partial<View> | null {
  const patch: Partial<View> = {}
  const filter = stripFilter(v.filter, propId)
  if (!same(filter, v.filter)) patch.filter = filter
  if (v.calculations && propId in v.calculations) {
    const rest = { ...v.calculations }
    delete rest[propId]
    patch.calculations = rest
  }
  if (v.chart && (v.chart.xPropertyId === propId || v.chart.yPropertyId === propId)) {
    patch.chart = { ...v.chart }
    if (v.chart.xPropertyId === propId) patch.chart.xPropertyId = null
    if (v.chart.yPropertyId === propId) Object.assign(patch.chart, { yPropertyId: null, aggregate: 'count' })
  }
  if (v.cardPreview === propId) patch.cardPreview = v.type === 'gallery' ? 'cover' : 'none'
  if (v.feed?.dateProperty === propId) patch.feed = { ...v.feed, dateProperty: null }
  if (v.colorRules?.length) {
    const rules = v.colorRules.map((r) => ({ ...r, filter: stripFilter(r.filter, propId) ?? { ...r.filter, items: [] } }))
    if (!same(rules, v.colorRules)) patch.colorRules = rules
  }
  return Object.keys(patch).length ? patch : null
}

/** Delete a property and clear what pointed at it; returns the undo (definition, values, view settings, rollups). */
function removeProperty(dbId: ID, propId: ID): () => boolean {
  const st = ws()
  const fresh = st.databases[dbId]
  const index = fresh.properties.findIndex((p) => p.id === propId)
  const def = clone(fresh.properties[index])
  const viewsBefore = clone(fresh.views)
  const values = allRows(dbId)
    .filter((r) => r.properties[propId] !== undefined)
    .map((r) => [r.id, clone(r.properties[propId])] as const)
  const rollups: Array<{ dbId: ID; propId: ID; before: NonNullable<PropertyDef['rollup']>; after: NonNullable<PropertyDef['rollup']> }> = []
  for (const d of Object.values(st.databases)) {
    for (const p of d.properties) {
      if (p.type !== 'rollup' || !p.rollup) continue
      const rel = d.properties.find((x) => x.id === p.rollup!.relationPropertyId)
      if (d.id === dbId && p.rollup.relationPropertyId === propId) rollups.push({ dbId: d.id, propId: p.id, before: p.rollup, after: { ...p.rollup, relationPropertyId: '', targetPropertyId: '' } })
      else if (rel?.relationDatabaseId === dbId && p.rollup.targetPropertyId === propId) rollups.push({ dbId: d.id, propId: p.id, before: p.rollup, after: { ...p.rollup, targetPropertyId: '' } })
    }
  }
  st.deleteProperty(dbId, propId)
  for (const v of ws().databases[dbId].views) {
    const patch = danglingPatch(v, propId)
    if (patch) st.updateView(dbId, v.id, patch)
  }
  for (const r of rollups) st.updateProperty(r.dbId, r.propId, { rollup: r.after })
  const viewsAfter = clone(ws().databases[dbId].views)

  return () => {
    const w = ws()
    if (!w.databases[dbId] || w.databases[dbId].properties.some((p) => p.id === propId)) return false
    w.addProperty(dbId, def, index)
    let clean = true
    for (const vb of viewsBefore) {
      const va = viewsAfter.find((x) => x.id === vb.id)
      const cur = ws().databases[dbId]?.views.find((x) => x.id === vb.id)
      if (!va || !cur) continue
      const patch: Record<string, unknown> = {}
      // addProperty showed it in every view: back to where it was (or hidden), unless the list changed since
      const shown = cur.visibleProperties.filter((x) => x !== propId)
      if (same(shown, va.visibleProperties)) patch.visibleProperties = clone(vb.visibleProperties)
      else {
        const at = vb.visibleProperties.indexOf(propId)
        if (at >= 0) shown.splice(Math.min(at, shown.length), 0, propId)
        patch.visibleProperties = shown
        clean = false
      }
      for (const k of new Set([...Object.keys(vb), ...Object.keys(va)]) as Set<keyof View>) {
        if (k === 'visibleProperties' || same(vb[k], va[k])) continue
        if (same(cur[k], va[k])) patch[k] = vb[k] === undefined ? undefined : clone(vb[k])
        else clean = false
      }
      w.updateView(dbId, vb.id, patch as Partial<View>)
    }
    for (const r of rollups) {
      const cur = ws().databases[r.dbId]?.properties.find((p) => p.id === r.propId)
      if (cur && same(cur.rollup, r.after)) w.updateProperty(r.dbId, r.propId, { rollup: r.before })
    }
    for (const [rowId, v] of values) if (ws().pages[rowId]) w.setRowProperty(rowId, propId, v)
    return clean
  }
}

function planDeleteProperty(args: Record<string, unknown>): WritePlan {
  const { db, title } = schemaDb(args.databaseId)
  const prop = propertyOrThrow(db, args.property, title)
  if (prop.type === 'title') throw new McpToolError(`${q(prop.name)} is the title property of ${q(title)}: every database keeps one. Nothing was changed.`)
  const withValue = allRows(db.id).filter((r) => !r.trashed && !isEmpty(r.properties[prop.id])).length
  const partner =
    prop.type === 'relation' && prop.relationDatabaseId
      ? ws().databases[prop.relationDatabaseId]?.properties.find((p) => p.type === 'relation' && p.relationDatabaseId === db.id && (p.id === prop.id + TWO_WAY_SUFFIX || prop.id === p.id + TWO_WAY_SUFFIX))
      : undefined
  const lines: PlanLine[] = [
    { k: 'fact', label: t('features.mcp.plan.type'), value: prop.type },
    { k: 'fact', label: t('features.mcp.plan.values'), value: t(withValue === 1 ? 'features.mcp.plan.valuesGone.one' : 'features.mcp.plan.valuesGone.other', { n: chars(withValue) }) },
  ]
  if (partner) lines.push({ k: 'note', value: t('features.mcp.plan.partnerStays', { name: partner.name, db: titleOf(ws().pages[prop.relationDatabaseId!]) }) })
  lines.push({ k: 'note', value: t('features.mcp.plan.propGoneNote') })
  return {
    tool: 'one_delete_property',
    verb: t('features.mcp.verb.deleteProperty'),
    summary: t('features.mcp.sum.deleteProperty', { name: prop.name, db: title }),
    target: `${title} / ${prop.name}`,
    lines,
    async apply() {
      const now = ws().databases[db.id]
      if (!now?.properties.some((p) => p.id === prop.id)) throw new McpToolError(`${q(prop.name)} is gone already. Nothing was changed.`)
      if (now.locked) throw new McpToolError(`${q(title)} was locked meanwhile. Nothing was changed.`)
      const undo = removeProperty(db.id, prop.id)
      return { result: { databaseId: db.id, deleted: { id: prop.id, name: prop.name, type: prop.type }, rowsWithValue: withValue, note: 'Deleted with its values. The person can undo it in One (Agent activity).' }, undo }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_update_property                                                 */
/* ------------------------------------------------------------------ */

const TEXTISH = new Set<PropertyType>(['text', 'url', 'email', 'phone'])
const SELECTISH = new Set<PropertyType>(['select', 'multi_select', 'status'])

/** One stored value converted to the new type (the options of the new definition given). */
function convertValue(from: PropertyDef, to: PropertyType, v: PropertyValue | undefined, options: SelectOption[]): PropertyValue {
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
  // between select, status and multi_select: the option ids stay
  if (to === 'multi_select') return typeof v === 'string' && v ? [v] : Array.isArray(v) ? v : []
  return typeof v === 'string' ? v : null
}

interface OptionPlan {
  options: SelectOption[]
  lines: PlanLine[]
  removed: Set<ID>
}

function optionPlan(prop: PropertyDef, raw: unknown): OptionPlan {
  if (!SELECTISH.has(prop.type)) throw new McpToolError(`"options": ${q(prop.name)} is ${prop.type} — options belong to select, multi_select and status.`)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new McpToolError('"options" must be an object: {add?, update?, remove?}.')
  const o = raw as Record<string, unknown>
  const list = (k: string) => {
    const v = o[k]
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) throw new McpToolError(`"options.${k}" must be a list.`)
    return v as unknown[]
  }
  let options = clone(prop.options ?? [])
  const lines: PlanLine[] = []
  const removed = new Set<ID>()
  const find = (n: unknown, key: string) => {
    const s = typeof n === 'string' ? n : typeof n === 'object' && n && typeof (n as { name?: unknown }).name === 'string' ? (n as { name: string }).name : ''
    const hit = options.find((x) => norm(x.name) === norm(s))
    if (!hit) throw new McpToolError(`${key}: ${q(prop.name)} has no option ${q(s)}. Options: ${options.map((x) => q(x.name)).join(', ') || 'none'}.`)
    return hit
  }
  for (const r of list('remove')) {
    const hit = find(r, 'options.remove')
    removed.add(hit.id)
    options = options.filter((x) => x.id !== hit.id)
  }
  for (const u of list('update')) {
    if (!u || typeof u !== 'object' || Array.isArray(u)) throw new McpToolError('options.update: every entry is {name, newName?, color?, group?}.')
    const e = u as Record<string, unknown>
    const hit = find(e.name, 'options.update')
    if (removed.has(hit.id)) throw new McpToolError(`options.update: ${q(hit.name)} is also being removed.`)
    const next = { ...hit }
    if (e.newName !== undefined && e.newName !== null) {
      const nn = cleanName(e.newName, 'options.update.newName', 60)
      if (!nn) throw new McpToolError('options.update: "newName" must not be empty.')
      if (options.some((x) => x.id !== hit.id && norm(x.name) === norm(nn))) throw new McpToolError(`options.update: ${q(prop.name)} has an option ${q(nn)} already.`)
      if (nn !== hit.name) lines.push({ k: 'fact', label: t('features.mcp.plan.renameOption'), value: `${hit.name} → ${nn}` })
      next.name = nn
    }
    if (e.color !== undefined && e.color !== null) {
      const c = colorOf(e.color)
      if (!c) throw new McpToolError(`options.update: ${q(String(e.color))} is not a colour. Use one of: ${palette.join(', ')}.`)
      if (c !== hit.color) lines.push({ k: 'fact', label: t('features.mcp.plan.colorOption'), value: `${next.name} · ${hit.color} → ${c}` })
      next.color = c
    }
    if (e.group !== undefined && e.group !== null) {
      if (prop.type !== 'status') throw new McpToolError('options.update: "group" applies to status options only.')
      if (e.group !== 'todo' && e.group !== 'in_progress' && e.group !== 'done') throw new McpToolError('options.update: "group" is todo, in_progress or done.')
      if (e.group !== hit.group) lines.push({ k: 'fact', label: t('features.mcp.plan.groupOption'), value: `${next.name} · ${hit.group ?? '—'} → ${e.group}` })
      next.group = e.group
    }
    options = options.map((x) => (x.id === hit.id ? next : x))
  }
  const added = optionsOf(prop.type, list('add').length ? list('add') : undefined, 'options.add', options.length) ?? []
  // a status option added without a group starts as "to do"
  const grouped = new Set(list('add').flatMap((x) => (x && typeof x === 'object' && (x as { group?: unknown }).group ? [norm(String((x as { name?: unknown }).name ?? ''))] : [])))
  for (const a of added) {
    if (options.some((x) => norm(x.name) === norm(a.name))) throw new McpToolError(`options.add: ${q(prop.name)} has an option ${q(a.name)} already.`)
    if (prop.type === 'status' && !grouped.has(norm(a.name))) a.group = 'todo'
  }
  options = [...options, ...added]
  if (added.length) lines.unshift({ k: 'fact', label: t('features.mcp.plan.newOptions'), value: added.map((x) => x.name).join(', ') })
  if (prop.type === 'status' && !options.length) throw new McpToolError(`${q(prop.name)} is a status: it keeps at least one option.`)
  if (options.length > 200) throw new McpToolError(`${q(prop.name)} would have more than 200 options.`)
  return { options, lines, removed }
}

function planUpdateProperty(args: Record<string, unknown>): WritePlan {
  const { db, title } = schemaDb(args.databaseId)
  const prop = propertyOrThrow(db, args.property, title)
  const lines: PlanLine[] = []
  const patch: Partial<PropertyDef> = {}
  const changed: string[] = []
  if (args.name !== undefined && args.name !== null) {
    const name = cleanName(args.name, 'name', 100)
    if (!name) throw new McpToolError('"name" must not be empty.')
    if (db.properties.some((p) => p.id !== prop.id && norm(p.name) === norm(name))) throw new McpToolError(`${q(title)} already has a property named ${q(name)}.`)
    if (name !== prop.name) {
      patch.name = name
      changed.push('name')
      lines.push({ k: 'prop', name: t('features.mcp.plan.name'), before: prop.name, after: name })
    }
  }
  if (args.description !== undefined && args.description !== null) {
    const d = str(args.description, 'description', { max: 500 }).trim()
    if (d !== (prop.description ?? '')) {
      patch.description = d || undefined
      changed.push('description')
      lines.push({ k: 'prop', name: t('features.mcp.plan.description'), before: prop.description ?? '', after: d })
    }
  }
  let toType: PropertyType | null = null
  if (args.type !== undefined && args.type !== null && args.type !== prop.type) {
    const want = String(args.type) as PropertyType
    if (prop.type === 'title') throw new McpToolError(`${q(prop.name)} is the title property: its type stays.`)
    const allowed = MCP_TYPE_CHANGES[prop.type] ?? []
    if (!allowed.includes(want))
      throw new McpToolError(
        `Changing ${q(prop.name)} from ${prop.type} to ${want} is not done over MCP: its values would not carry over safely. ${allowed.length ? `From ${prop.type} an agent may change it to: ${allowed.join(', ')}.` : `A ${prop.type} property keeps its type here.`} Ask the person to change it in One. Nothing was changed.`,
      )
    toType = want
    changed.push('type')
    lines.push({ k: 'prop', name: t('features.mcp.plan.type'), before: prop.type, after: want })
  }
  let opts: OptionPlan | null = null
  if (args.options !== undefined && args.options !== null) {
    if (toType) throw new McpToolError('Change the type and the options in two calls (first the type).')
    opts = optionPlan(prop, args.options)
    if (!same(opts.options, prop.options ?? [])) {
      patch.options = opts.options
      changed.push('options')
      lines.push(...opts.lines)
    }
  }
  const rows = allRows(db.id)
  const removed = opts?.removed ?? new Set<ID>()
  const losing = rows.filter((r) => !r.trashed && [r.properties[prop.id]].flat().some((v) => typeof v === 'string' && removed.has(v)))
  for (const id of removed) {
    const n = losing.filter((r) => [r.properties[prop.id]].flat().includes(id)).length
    lines.push({ k: 'fact', label: t('features.mcp.plan.removeOption'), value: `${prop.options?.find((o) => o.id === id)?.name ?? id} · ${t(n === 1 ? 'features.mcp.plan.valuesGone.one' : 'features.mcp.plan.valuesGone.other', { n: chars(n) })}` })
  }
  const filled = toType ? rows.filter((r) => !r.trashed && !isEmpty(r.properties[prop.id])).length : 0
  if (toType) lines.push({ k: 'note', value: t(filled === 1 ? 'features.mcp.plan.converts.one' : 'features.mcp.plan.converts.other', { n: chars(filled) }) })
  if (args.name === undefined && args.description === undefined && args.type === undefined && args.options === undefined)
    throw new McpToolError('Nothing to change: pass "name", "description", "type" and/or "options".')
  const result = () => {
    const d = ws().databases[db.id]
    const p = d?.properties.find((x) => x.id === prop.id)
    return { databaseId: db.id, property: d && p ? propertyJson(d, p) : null, changed, ...(removed.size ? { cleared: losing.length } : {}), ...(toType ? { converted: filled } : {}) }
  }
  return {
    tool: 'one_update_property',
    verb: t('features.mcp.verb.updateProperty'),
    summary: t('features.mcp.sum.updateProperty', { name: prop.name, db: title }),
    target: `${title} / ${prop.name}`,
    lines,
    noop: changed.length ? undefined : { ...result(), note: 'No change: the property already looks like that.' },
    async apply() {
      const d = ws().databases[db.id]
      const cur = d?.properties.find((p) => p.id === prop.id)
      if (!d || !cur || !same(cur, prop)) throw new McpToolError(`${q(prop.name)} changed meanwhile. Nothing was changed — read it again (one_get_database).`)
      if (d.locked) throw new McpToolError(`${q(title)} was locked meanwhile. Nothing was changed.`)
      const before = { def: clone(cur), values: new Map(allRows(db.id).map((r) => [r.id, clone(r.properties[prop.id])] as const)) }
      const full: Partial<PropertyDef> = { ...patch }
      if (toType) {
        full.type = toType
        let options: SelectOption[] | undefined
        if (SELECTISH.has(toType)) {
          if (SELECTISH.has(prop.type)) options = (prop.options ?? []).map((o) => (toType === 'status' ? { ...o, group: o.group ?? 'todo' } : { id: o.id, name: o.name, color: o.color }))
          else {
            // text → options: one per distinct value (multi_select: comma-separated parts)
            options = []
            for (const r of allRows(db.id)) {
              const text = typeof r.properties[prop.id] === 'string' ? (r.properties[prop.id] as string) : ''
              for (const part of toType === 'multi_select' ? text.split(',') : [text]) {
                const n = part.replace(/\s+/g, ' ').trim().slice(0, 60)
                if (n && !options.some((o) => norm(o.name) === norm(n)) && options.length < 200) options.push({ id: newId(), name: n, color: palette[options.length % palette.length] })
              }
            }
          }
        }
        full.options = options
        if (prop.type === 'number') Object.assign(full, { numberFormat: undefined, numberDisplay: undefined })
        for (const r of allRows(db.id)) {
          const v = r.properties[prop.id]
          if (v === undefined) continue
          ws().setRowProperty(r.id, prop.id, convertValue(prop, toType, v, options ?? []))
        }
      }
      ws().updateProperty(db.id, prop.id, full)
      if (removed.size)
        for (const r of allRows(db.id)) {
          const v = r.properties[prop.id]
          if (typeof v === 'string' && removed.has(v)) ws().setRowProperty(r.id, prop.id, null)
          else if (Array.isArray(v) && v.some((x) => removed.has(x))) ws().setRowProperty(r.id, prop.id, v.filter((x) => !removed.has(x)))
        }
      const after = { def: clone(ws().databases[db.id].properties.find((p) => p.id === prop.id)!), values: new Map(allRows(db.id).map((r) => [r.id, clone(r.properties[prop.id])] as const)) }
      return {
        result: result(),
        undo: () => {
          const now = ws().databases[db.id]?.properties.find((p) => p.id === prop.id)
          if (!now || !same(now, after.def)) return false
          // the old definition exactly: fields the change added are cleared
          const back: Record<string, unknown> = { ...before.def }
          for (const k of Object.keys(now)) if (!(k in before.def)) back[k] = undefined
          ws().updateProperty(db.id, prop.id, back as Partial<PropertyDef>)
          let clean = true
          for (const [rowId, v] of before.values) {
            const row = ws().pages[rowId]
            if (!row) continue
            if (!same(row.properties[prop.id], after.values.get(rowId))) {
              clean = false
              continue
            }
            if (!same(v, row.properties[prop.id])) ws().setRowProperty(rowId, prop.id, v ?? null)
          }
          return clean
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** Grouping per layout (database/model/schema.ts BOARD_GROUP_TYPES / TABLE_GROUP_TYPES). */
const BOARD_GROUP = ['status', 'select', 'multi_select', 'person', 'checkbox', 'created_by', 'last_edited_by']
const TABLE_GROUP = [...BOARD_GROUP, 'relation', 'text', 'url', 'email', 'phone', 'number', 'rating', 'date', 'created_time', 'last_edited_time', 'formula']
const DATE_TYPES = ['date', 'created_time', 'last_edited_time']
const DATE_TOKENS = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now']
const ME = '@me'

type Op = (typeof MCP_FILTER_OPS)[number]
const ALIAS: Partial<Record<Op, Op>> = { eq: 'equals', is: 'equals', neq: 'not_equals', is_not: 'not_equals', before: 'lt', after: 'gt', on_or_before: 'lte', on_or_after: 'gte' }

/** A property by name for a view setting ("title" = the title property). */
function viewProp(db: Database, name: unknown, key: string, problems: string[]): PropertyDef | null {
  const ref = typeof name === 'string' ? name.trim() : ''
  const prop = db.properties.find((p) => p.id === ref) ?? db.properties.find((p) => norm(p.name) === norm(ref)) ?? (norm(ref) === 'title' ? db.properties.find((p) => p.type === 'title') : undefined)
  if (!prop) problems.push(`${key}: no property ${q(ref)} (properties: ${db.properties.map((p) => q(p.name)).join(', ')})`)
  return prop ?? null
}

/** One MCP filter condition → the app's Filter (see database/model/query.ts testFilter). */
function toFilter(db: Database, raw: unknown, i: number, problems: string[]): Filter | null {
  const key = `filter[${i}]`
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const prop = viewProp(db, o.property, key, problems)
  const given = String(o.op ?? '').trim().toLowerCase() as Op
  if (!MCP_FILTER_OPS.includes(given)) {
    problems.push(`${key}: unknown op ${q(String(o.op ?? ''))}`)
    return null
  }
  if (!prop) return null
  const op = ALIAS[given] ?? given
  const v = o.value
  const sv = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v)
  const make = (operator: FilterOperator, value?: PropertyValue): Filter => ({ id: newId(), propertyId: prop.id, operator, ...(value !== undefined ? { value } : {}) })
  const bad = (ops: string) => {
    problems.push(`${key}: ${q(prop.name)} (${prop.type}) takes ${ops} — not ${given}`)
    return null
  }
  if (op === 'is_empty' || op === 'is_not_empty') {
    if (prop.type === 'checkbox') return make(op === 'is_empty' ? 'is_not_checked' : 'is_checked')
    return make(op)
  }
  const need = () => {
    if (sv) return true
    problems.push(`${key}: ${given} needs a "value"`)
    return false
  }
  switch (prop.type) {
    case 'number':
    case 'rating':
    case 'unique_id': {
      const map: Partial<Record<Op, FilterOperator>> = { equals: 'eq', not_equals: 'neq', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte' }
      if (!map[op]) return bad('equals, not_equals, gt, gte, lt, lte, is_empty, is_not_empty')
      const n = typeof v === 'number' ? v : Number(sv.replace(/^[A-Za-z]+-/, ''))
      if (!Number.isFinite(n)) {
        problems.push(`${key}: ${q(prop.name)} compares numbers — ${q(sv)} is none`)
        return null
      }
      return make(map[op]!, n)
    }
    case 'checkbox': {
      const on = op === 'is_checked' || ((op === 'equals' || op === 'not_equals') && ['true', 'yes', 'ja', '1', 'checked', 'x'].includes(sv.toLowerCase()) !== (op === 'not_equals'))
      if (op !== 'is_checked' && op !== 'is_not_checked' && op !== 'equals' && op !== 'not_equals') return bad('is_checked, is_not_checked or equals true / false')
      return make(on ? 'is_checked' : 'is_not_checked')
    }
    case 'select':
    case 'status':
    case 'multi_select': {
      const multi = prop.type === 'multi_select'
      const map: Partial<Record<Op, FilterOperator>> = multi ? { equals: 'contains', contains: 'contains', not_equals: 'not_contains', not_contains: 'not_contains' } : { equals: 'is', not_equals: 'is_not' }
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
      const map: Partial<Record<Op, FilterOperator>> = actor ? { equals: 'is', not_equals: 'is_not' } : { equals: 'contains', contains: 'contains', not_equals: 'not_contains', not_contains: 'not_contains' }
      if (!map[op]) return bad(actor ? 'equals, not_equals' : 'contains, not_contains, is_empty, is_not_empty')
      if (!need()) return null
      if (['me', '@me', 'ich'].includes(sv.toLowerCase())) return make(map[op]!, ME)
      const people = ws().people.filter((p) => norm(p.name) === norm(sv) || p.id === sv)
      if (people.length !== 1) {
        problems.push(`${key}: ${people.length ? 'several people' : 'nobody'} called ${q(sv)} (people: ${ws().people.map((p) => q(p.name)).join(', ') || 'none'}, or "me")`)
        return null
      }
      return make(map[op]!, people[0].id)
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const map: Partial<Record<Op, FilterOperator>> = { equals: 'is', lt: 'before', gt: 'after', lte: 'on_or_before', gte: 'on_or_after' }
      if (!map[op]) return bad('equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty')
      if (!need()) return null
      const day = DATE_TOKENS.includes(sv.toLowerCase()) ? sv.toLowerCase() : /^\d{4}-\d{2}-\d{2}/.test(sv) ? sv.slice(0, 10) : null
      if (!day) {
        problems.push(`${key}: ${q(sv)} is not a date — use "YYYY-MM-DD" or ${DATE_TOKENS.map((x) => q(x)).join(', ')}`)
        return null
      }
      const value: DateValue = { start: day }
      return make(map[op]!, value as unknown as PropertyValue)
    }
    case 'formula':
    case 'rollup':
      problems.push(`${key}: filters on ${prop.type} properties are set up in One`)
      return null
    default: {
      // title, text, url, email, phone, relation (titles), files (names)
      const map: Partial<Record<Op, FilterOperator>> = { equals: 'is', not_equals: 'is_not', contains: 'contains', not_contains: 'not_contains', starts_with: 'starts_with', ends_with: 'ends_with' }
      if (!map[op]) return bad('equals, not_equals, contains, not_contains, starts_with, ends_with, is_empty, is_not_empty')
      if (!need()) return null
      return make(map[op]!, sv)
    }
  }
}

function toSorts(db: Database, raw: unknown, problems: string[]): Sort[] {
  if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) return []
  const list = Array.isArray(raw) ? raw.slice(0, 5) : [raw]
  const out: Sort[] = []
  for (const x of list) {
    let name = ''
    let desc = false
    if (typeof x === 'string') {
      name = x.trim().replace(/^-/, '')
      desc = x.trim().startsWith('-')
    } else if (x && typeof x === 'object' && typeof (x as { property?: unknown }).property === 'string') {
      name = (x as { property: string }).property
      desc = (x as { direction?: unknown }).direction === 'desc'
    } else {
      problems.push('sort: a property name ("-Due" descending), {property, direction} or a list of them')
      continue
    }
    const prop = viewProp(db, name, 'sort', problems)
    if (prop && !out.some((s) => s.propertyId === prop.id)) out.push({ propertyId: prop.id, direction: desc ? 'desc' : 'asc' })
  }
  return out
}

/** The view as agents see it: names instead of ids. */
function viewJson(db: Database, v: View) {
  const nameOf = (id: ID | null | undefined) => (id ? (db.properties.find((p) => p.id === id)?.name ?? null) : null)
  const valueOut = (f: Filter): unknown => {
    const prop = db.properties.find((p) => p.id === f.propertyId)
    const val = f.value
    if (val === undefined || val === null) return undefined
    if (prop?.options && typeof val === 'string') return prop.options.find((o) => o.id === val)?.name ?? val
    if (val === ME) return 'me'
    if (typeof val === 'string' && (prop?.type === 'person' || prop?.type === 'created_by' || prop?.type === 'last_edited_by')) return ws().people.find((p) => p.id === val)?.name ?? val
    if (typeof val === 'object' && !Array.isArray(val) && 'start' in val) return val.start
    return val
  }
  const flat = (g: FilterGroup | null): Array<Record<string, unknown>> =>
    (g?.items ?? []).flatMap((it) => ('items' in it ? flat(it) : [{ property: nameOf(it.propertyId) ?? it.propertyId, op: it.operator, ...(valueOut(it) !== undefined ? { value: valueOut(it) } : {}) }]))
  const feedDate = v.type === 'feed' ? nameOf(v.feed?.dateProperty) : null
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    ...(nameOf(v.groupBy) ? { groupBy: nameOf(v.groupBy) } : {}),
    ...(nameOf(v.dateProperty) && v.type !== 'feed' ? { dateProperty: nameOf(v.dateProperty) } : {}),
    ...(feedDate ? { dateProperty: feedDate } : {}),
    ...(v.filter?.items.length ? { filter: flat(v.filter), ...(v.filter.op === 'or' ? { filterMatch: 'any' } : {}) } : {}),
    ...(v.sorts.length ? { sorts: v.sorts.map((s) => ({ property: nameOf(s.propertyId) ?? s.propertyId, direction: s.direction })) } : {}),
    properties: v.visibleProperties.map(nameOf).filter((n): n is string => !!n),
  }
}

interface ViewChange {
  patch: Partial<View>
  lines: PlanLine[]
}

/** The view settings of a create / update call, validated against the database (base = the view now). */
function viewChange(db: Database, args: Record<string, unknown>, base: View): ViewChange {
  const problems: string[] = []
  const patch: Partial<View> = {}
  const lines: PlanLine[] = []
  const nameOf = (id: ID | null | undefined) => (id ? (db.properties.find((p) => p.id === id)?.name ?? '—') : '—')
  const none = t('features.mcp.plan.none')
  let type: ViewType = base.type
  if (args.type !== undefined && args.type !== null && args.type !== base.type) {
    if (!(MCP_VIEW_TYPES as readonly string[]).includes(String(args.type))) problems.push(`type: one of ${MCP_VIEW_TYPES.join(', ')} (chart and form views are set up in One)`)
    else {
      type = args.type as ViewType
      patch.type = type
      lines.push({ k: 'prop', name: t('features.mcp.plan.layout'), before: layoutName(base.type), after: layoutName(type) })
      // like switching the layout in the app: a board needs a group, a calendar a date
      const d = defaultView(type, db)
      if (type === 'board' && !(base.groupBy && BOARD_GROUP.includes(db.properties.find((p) => p.id === base.groupBy)?.type ?? ''))) patch.groupBy = d.groupBy
      if ((type === 'calendar' || type === 'timeline') && !base.dateProperty) patch.dateProperty = d.dateProperty
      if (type === 'gallery') Object.assign(patch, { cardPreview: base.cardPreview ?? 'cover', cardSize: base.cardSize ?? 'medium' })
    }
  }
  if (args.name !== undefined && args.name !== null) {
    const name = cleanName(args.name, 'name', 100)
    if (!name) problems.push('name: must not be empty')
    else if (name !== base.name) {
      patch.name = name
      lines.push({ k: 'prop', name: t('features.mcp.plan.name'), before: base.name, after: name })
    }
  }
  if (args.groupBy !== undefined) {
    if (args.groupBy === null || args.groupBy === '') {
      if (type === 'board') problems.push('groupBy: a board always groups — pass a property')
      else if (base.groupBy) patch.groupBy = null
    } else if (type !== 'board' && type !== 'table' && type !== 'list') problems.push(`groupBy: only table, list and board views group (this one is ${type})`)
    else {
      const prop = viewProp(db, args.groupBy, 'groupBy', problems)
      const allowed = type === 'board' ? BOARD_GROUP : TABLE_GROUP
      if (prop && !allowed.includes(prop.type)) problems.push(`groupBy: a ${type} cannot group by ${q(prop.name)} (${prop.type}); it groups by ${allowed.join(', ')}`)
      else if (prop) patch.groupBy = prop.id
    }
  }
  if (patch.groupBy !== undefined && patch.groupBy !== base.groupBy) lines.push({ k: 'prop', name: t('features.mcp.plan.groupBy'), before: nameOf(base.groupBy), after: patch.groupBy ? nameOf(patch.groupBy) : none })
  if (type === 'board' && !(patch.groupBy ?? base.groupBy)) problems.push(`groupBy: a board needs a ${BOARD_GROUP.join(' / ')} property to group by — this database has none (one_create_property adds one)`)
  if (args.dateProperty !== undefined) {
    if (type === 'feed') {
      const prop = args.dateProperty === null || args.dateProperty === '' ? null : viewProp(db, args.dateProperty, 'dateProperty', problems)
      if (prop && !DATE_TYPES.includes(prop.type)) problems.push(`dateProperty: ${q(prop.name)} is no date (${DATE_TYPES.join(', ')})`)
      else if (args.dateProperty === null || prop) {
        patch.feed = { ...base.feed, dateProperty: prop?.id ?? null }
        lines.push({ k: 'prop', name: t('features.mcp.plan.dateProperty'), before: nameOf(base.feed?.dateProperty), after: prop ? prop.name : none })
      }
    } else if (type !== 'calendar' && type !== 'timeline') problems.push(`dateProperty: only calendar, timeline and feed views have one (this one is ${type})`)
    else if (args.dateProperty === null || args.dateProperty === '') problems.push(`dateProperty: a ${type} always needs one`)
    else {
      const prop = viewProp(db, args.dateProperty, 'dateProperty', problems)
      if (prop && !DATE_TYPES.includes(prop.type)) problems.push(`dateProperty: ${q(prop.name)} is no date (${DATE_TYPES.join(', ')})`)
      else if (prop && prop.id !== base.dateProperty) {
        patch.dateProperty = prop.id
        lines.push({ k: 'prop', name: t('features.mcp.plan.dateProperty'), before: nameOf(base.dateProperty), after: prop.name })
      }
    }
  }
  if ((type === 'calendar' || type === 'timeline') && !(patch.dateProperty ?? base.dateProperty)) problems.push(`dateProperty: a ${type} needs a date property — this database has none (one_create_property adds one)`)
  if (args.filter !== undefined) {
    if (args.filter !== null && !Array.isArray(args.filter)) problems.push('filter: a list of {property, op, value} (or null)')
    else {
      const items = ((args.filter as unknown[] | null) ?? []).slice(0, 20).map((f, i) => toFilter(db, f, i, problems)).filter((f): f is Filter => !!f)
      const filter: FilterGroup | null = items.length ? { id: newId(), op: 'and', items } : null
      if (!same(filter ? flatKey(filter) : null, base.filter?.items.length ? flatKey(base.filter) : null)) {
        patch.filter = filter
        lines.push({ k: 'fact', label: t('features.mcp.plan.filter'), value: filter ? viewJson(db, { ...base, filter }).filter!.map((f) => `${f.property} ${opLabel(String(f.op))}${f.value !== undefined ? ` ${String(f.value)}` : ''}`).join(' · ') : none })
      }
    }
  }
  if (args.sort !== undefined) {
    const sorts = toSorts(db, args.sort, problems)
    if (!same(sorts, base.sorts)) {
      patch.sorts = sorts
      lines.push({ k: 'fact', label: t('features.mcp.plan.sort'), value: sorts.length ? sorts.map((s) => `${nameOf(s.propertyId)} ${s.direction === 'desc' ? '↓' : '↑'}`).join(', ') : none })
    }
  }
  if (args.properties !== undefined && args.properties !== null) {
    if (!Array.isArray(args.properties)) problems.push('properties: a list of property names')
    else {
      const ids: ID[] = []
      for (const n of args.properties.slice(0, 100)) {
        const prop = viewProp(db, n, 'properties', problems)
        if (prop && prop.type !== 'title' && !ids.includes(prop.id)) ids.push(prop.id)
      }
      if (!same(ids, base.visibleProperties)) {
        patch.visibleProperties = ids
        lines.push({ k: 'fact', label: t('features.mcp.plan.visible'), value: ids.length ? ids.map(nameOf).join(', ') : none })
      }
    }
  }
  if (problems.length) throw new McpToolError(`Nothing was changed: ${problems.join('; ')}.`)
  return { patch, lines }
}

/** A layout as the card names it. */
const layoutName = (type: string) => ((MCP_VIEW_TYPES as readonly string[]).includes(type) ? t(`features.mcp.viewName.${type}`) : type)

/** A filter operator on the card: comparisons as signs, the rest in words. */
const OP_SIGNS: Record<string, string> = { is: '=', eq: '=', is_not: '≠', neq: '≠', gt: '>', after: '>', gte: '≥', on_or_after: '≥', lt: '<', before: '<', lte: '≤', on_or_before: '≤' }
const opLabel = (op: string) => OP_SIGNS[op] ?? t(`features.mcp.op.${op}`)

/** A filter without its generated ids (to tell whether it changes). */
const flatKey = (g: FilterGroup): unknown => g.items.map((it) => ('items' in it ? flatKey(it) : [it.propertyId, it.operator, it.value ?? null]))

function planCreateView(args: Record<string, unknown>): WritePlan {
  const { db, title } = schemaDb(args.databaseId)
  const type = String(args.type ?? '')
  if (!(MCP_VIEW_TYPES as readonly string[]).includes(type)) throw new McpToolError(`"type" must be one of ${MCP_VIEW_TYPES.join(', ')} (chart and form views are set up in One).`)
  const base = defaultView(type as ViewType, db, t(`features.mcp.viewName.${type}`))
  const { patch, lines } = viewChange(db, { ...args, type: undefined }, base)
  const view: View = { ...base, ...patch, id: newId() }
  // a new view has no "before": its settings are plain facts
  const facts: PlanLine[] = lines.map((l) => (l.k === 'prop' ? { k: 'fact', label: l.name, value: l.after } : l))
  lines.splice(0, lines.length, { k: 'fact', label: t('features.mcp.plan.layout'), value: layoutName(type) }, ...facts)
  if (view.groupBy && patch.groupBy === undefined) lines.push({ k: 'fact', label: t('features.mcp.plan.groupBy'), value: db.properties.find((p) => p.id === view.groupBy)?.name ?? '—' })
  if (view.dateProperty && patch.dateProperty === undefined && type !== 'feed') lines.push({ k: 'fact', label: t('features.mcp.plan.dateProperty'), value: db.properties.find((p) => p.id === view.dateProperty)?.name ?? '—' })
  return {
    tool: 'one_create_view',
    verb: t('features.mcp.verb.createView'),
    summary: t('features.mcp.sum.createView', { name: view.name, db: title }),
    target: `${title} / ${view.name}`,
    lines,
    async apply() {
      const d = ws().databases[db.id]
      if (!d || d.locked) throw new McpToolError(`${q(title)} is gone or was locked meanwhile. Nothing was changed.`)
      ws().addView(db.id, view)
      const made = ws().databases[db.id].views.find((v) => v.id === view.id)!
      const after = clone(made)
      return {
        result: { databaseId: db.id, view: viewJson(ws().databases[db.id], made), url: `${pageUrl(db.id)}` },
        undo: () => {
          const now = ws().databases[db.id]?.views.find((v) => v.id === view.id)
          if (!now || !same(now, after)) return false
          ws().deleteView(db.id, view.id)
          return true
        },
      }
    },
  }
}

function planUpdateView(args: Record<string, unknown>): WritePlan {
  const { db, title } = schemaDb(args.databaseId)
  const view = viewOrThrow(db, args.view, title)
  const { patch, lines } = viewChange(db, args, view)
  const result = () => {
    const d = ws().databases[db.id]
    const v = d?.views.find((x) => x.id === view.id)
    return { databaseId: db.id, view: d && v ? viewJson(d, v) : null }
  }
  return {
    tool: 'one_update_view',
    verb: t('features.mcp.verb.updateView'),
    summary: t('features.mcp.sum.updateView', { name: view.name, db: title }),
    target: `${title} / ${view.name}`,
    lines,
    noop: Object.keys(patch).length ? undefined : { ...result(), note: 'No change: the view already looks like that.' },
    async apply() {
      const d = ws().databases[db.id]
      const cur = d?.views.find((v) => v.id === view.id)
      if (!d || !cur || d.locked) throw new McpToolError(`${q(view.name)} is gone or ${q(title)} was locked meanwhile. Nothing was changed.`)
      const keys = Object.keys(patch) as Array<keyof View>
      const before = Object.fromEntries(keys.map((k) => [k, clone(cur[k])])) as Partial<View>
      ws().updateView(db.id, view.id, patch)
      const after = clone(ws().databases[db.id].views.find((v) => v.id === view.id)!)
      return {
        result: result(),
        undo: () => {
          const now = ws().databases[db.id]?.views.find((v) => v.id === view.id)
          if (!now) return false
          const back: Record<string, unknown> = {}
          for (const k of keys) if (same(now[k], after[k])) back[k] = before[k]
          if (Object.keys(back).length) ws().updateView(db.id, view.id, back as Partial<View>)
          return Object.keys(back).length === keys.length
        },
      }
    },
  }
}

function planDeleteView(args: Record<string, unknown>): WritePlan {
  const { db, title } = schemaDb(args.databaseId)
  const view = viewOrThrow(db, args.view, title)
  if (db.views.length <= 1) throw new McpToolError(`${q(view.name)} is the only view of ${q(title)}: a database keeps at least one. Nothing was changed.`)
  return {
    tool: 'one_delete_view',
    verb: t('features.mcp.verb.deleteView'),
    summary: t('features.mcp.sum.deleteView', { name: view.name, db: title }),
    target: `${title} / ${view.name}`,
    lines: [
      { k: 'fact', label: t('features.mcp.plan.layout'), value: layoutName(view.type) },
      { k: 'note', value: t('features.mcp.plan.viewGoneNote') },
    ],
    async apply() {
      const d = ws().databases[db.id]
      const index = d?.views.findIndex((v) => v.id === view.id) ?? -1
      if (!d || index < 0 || d.locked || d.views.length <= 1) throw new McpToolError(`${q(view.name)} is gone, the last view or ${q(title)} was locked meanwhile. Nothing was changed.`)
      const copy = clone(d.views[index])
      ws().deleteView(db.id, view.id)
      return {
        result: { databaseId: db.id, deleted: { id: view.id, name: view.name, type: view.type }, views: ws().databases[db.id].views.map((v) => ({ id: v.id, name: v.name, type: v.type })) },
        undo: () => {
          const now = ws().databases[db.id]
          if (!now || now.views.some((v) => v.id === view.id)) return false
          const views = [...now.views]
          views.splice(Math.min(index, views.length), 0, copy)
          ws().updateDatabase(db.id, { views })
          return true
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */

export const STRUCTURE_PLANNERS: Partial<Record<McpToolName, (args: Record<string, unknown>) => WritePlan>> = {
  one_update_database: planUpdateDatabase,
  one_update_property: planUpdateProperty,
  one_delete_property: planDeleteProperty,
  one_create_view: planCreateView,
  one_update_view: planUpdateView,
  one_delete_view: planDeleteView,
}
