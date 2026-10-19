/**
 * A property taken out of a database and of its views — pure: what `deleteProperty` clears in the store (placement,
 * sorts, grouping, date property) and what database/model/actions.ts clears on top (filter rules, calculations, chart
 * axes, card previews, colour rules). The flight recorder's eject removes a property its writer added with it.
 */
import type { Database, FilterGroup, ID, View } from '../../store/types'

/** The same JSON (absent = null). */
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const same = sameJson

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

/** View settings that would point at a deleted property (the store only clears placement, sorts, group, date). */
export function danglingViewPatch(v: View, propId: ID): Partial<View> | null {
  const patch: Partial<View> = {}
  const filter = stripFilter(v.filter, propId)
  if (JSON.stringify(filter) !== JSON.stringify(v.filter ?? null)) patch.filter = filter
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
  if (v.colorRules?.length) {
    // a condition on a missing property would match every row: drop it (the rule stays, inert)
    const rules = v.colorRules.map((r) => ({ ...r, filter: stripFilter(r.filter, propId) ?? { ...r.filter, items: [] } }))
    if (!same(rules, v.colorRules)) patch.colorRules = rules
  }
  return Object.keys(patch).length ? patch : null
}

/** The database without the property: its definition, and every view setting that pointed at it. */
export function withoutProperty(db: Database, propId: ID): Database {
  if (!db.properties.some((p) => p.id === propId)) return db
  const views = db.views.map((v) => {
    const base: View = {
      ...v,
      visibleProperties: v.visibleProperties.filter((x) => x !== propId),
      sorts: v.sorts.filter((x) => x.propertyId !== propId),
      ...(v.groupBy === propId ? { groupBy: null } : {}),
      ...(v.dateProperty === propId ? { dateProperty: null } : {}),
    }
    const patch = danglingViewPatch(base, propId)
    return patch ? { ...base, ...patch } : base
  })
  return { ...db, properties: db.properties.filter((p) => p.id !== propId), views }
}

const inFilter = (g: FilterGroup | null | undefined, propId: ID): boolean => !!g && g.items.some((it) => ('items' in it ? inFilter(it, propId) : it.propertyId === propId))

/**
 * What still points at a property besides row values — view settings a delete would not clean up (filter, sort,
 * grouping, date, chart, feed, a free board's fields, a form's questions / page breaks / conditions / response marker),
 * a formula naming it, a rollup through it or of it, an automation, an autofill source, a command, the sub-items or
 * dependencies pair it is part of. Empty: it can go without a trace. Pure.
 */
export function propertyRefs(db: Database, databases: Record<ID, Database>, propId: ID): string[] {
  const out = new Set<string>()
  const prop = db.properties.find((p) => p.id === propId)
  for (const v of db.views) {
    if (inFilter(v.filter, propId)) out.add('filter')
    if (v.sorts.some((x) => x.propertyId === propId)) out.add('sort')
    if (v.groupBy === propId) out.add('groupBy')
    if (v.dateProperty === propId) out.add('dateProperty')
    if (v.chart && (v.chart.xPropertyId === propId || v.chart.yPropertyId === propId || v.chart.seriesPropertyId === propId)) out.add('chart')
    if (v.feed?.dateProperty === propId) out.add('feed')
    if (v.typeFields && Object.values(v.typeFields).some((ids) => ids.includes(propId))) out.add('typeFields')
    // a form's question settings, a page break before it, a condition on it, its response marker
    if (v.form && JSON.stringify(v.form).includes(JSON.stringify(propId))) out.add('form')
  }
  // sub-items and dependencies are built on a two-way self-relation pair
  if (db.subItems && (db.subItems.parentPropertyId === propId || db.subItems.childPropertyId === propId)) out.add('subItems')
  if (db.dependencies && (db.dependencies.blockedByPropertyId === propId || db.dependencies.blockingPropertyId === propId)) out.add('dependencies')
  for (const p of db.properties) {
    if (p.id === propId) continue
    const f = p.formula ?? ''
    if (f && (f.includes(propId) || (prop && (f.includes(`"${prop.name}"`) || f.includes(`'${prop.name}'`))))) out.add('formula')
    if (p.autofill?.source === propId) out.add('autofill')
    if (p.rollup?.relationPropertyId === propId) out.add('rollup')
  }
  for (const d of Object.values(databases)) {
    for (const p of d.properties) {
      if (p.type !== 'rollup' || !p.rollup || p.rollup.targetPropertyId !== propId) continue
      const rel = d.properties.find((x) => x.id === p.rollup!.relationPropertyId)
      if (rel?.relationDatabaseId === db.id) out.add('rollup')
    }
  }
  if (JSON.stringify(db.automations ?? null).includes(propId)) out.add('automation')
  if (JSON.stringify(db.commands ?? null).includes(propId)) out.add('command')
  return [...out]
}

/** What still points at an option of a database besides row values: a view's filter or colour rule, an automation, a command. */
export function optionRefs(db: Database, optId: ID): string[] {
  const out: string[] = []
  if (db.views.some((v) => JSON.stringify([v.filter ?? null, v.colorRules ?? null]).includes(optId))) out.push('view')
  if (JSON.stringify(db.automations ?? null).includes(optId)) out.push('automation')
  if (JSON.stringify(db.commands ?? null).includes(optId)) out.push('command')
  return out
}
