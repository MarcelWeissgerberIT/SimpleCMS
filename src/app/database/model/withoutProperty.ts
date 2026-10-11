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
