/**
 * What a store update did to a database: schema deltas (properties, options, order, lock, commands,
 * the rest as "dbmeta") and view deltas. Bookkeeping is no change: nextUniqueId, an automation's run
 * status, autofill's fill log, a recurring template's last run. Pure.
 */
import type { Database, PropertyDef, View } from '../../../store/types'
import { K, type SchemaDelta } from './types'

export interface ViewChange {
  id: string
  delta: SchemaDelta
  /** only widths / hidden groups / calculations changed */
  layout: boolean
}

export interface DatabaseDetail {
  /** deltas of the schema place (null: the schema place did not change) */
  schema: SchemaDelta[] | null
  views: ViewChange[]
  /** kinds of the schema place */
  kinds: number
}

/** Stable JSON (keys sorted, undefined left out). */
export function stable(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

/** A property without its options and without autofill's fill log (what `prop~` compares). */
export function defCore(p: PropertyDef): Record<string, unknown> {
  const { options: _o, ...rest } = p
  const out: Record<string, unknown> = { ...rest }
  if (p.autofill) {
    const { fills: _f, ...af } = p.autofill as unknown as Record<string, unknown>
    out.autofill = af
  }
  return out
}

/** Automations without their run status. */
export const automationsCore = (db: Pick<Database, 'automations'>): unknown =>
  (db.automations ?? []).map((a) => {
    const { lastRunAt: _a, lastStatus: _b, lastMessage: _c, ...rest } = a as unknown as Record<string, unknown>
    return rest
  })

/** Row templates without a repeat's last run. */
export const templatesCore = (db: Pick<Database, 'templates'>): unknown =>
  (db.templates ?? []).map((t) => (t.repeat ? { ...t, repeat: { ...t.repeat, lastRunAt: undefined } } : t))

/** The database fields recorded as "dbmeta" (never ejected). */
export const dbMetaCore = (db: Database): string =>
  stable({
    tpl: templatesCore(db),
    auto: automationsCore(db),
    pipe: db.pipeline ?? null,
    rt: db.recordTypes ?? null,
    sub: db.subItems ?? null,
    dep: db.dependencies ?? null,
    inline: !!db.inline,
    system: db.system ?? null,
    viewOrder: db.views.map((v) => v.id),
  })

const LAYOUT_FIELDS = ['propertyWidths', 'hiddenGroups', 'calculations'] as const

const viewRef = (v: View) => ({ id: v.id, name: v.name, type: v.type })
const propRef = (p: PropertyDef) => ({ id: p.id, name: p.name, type: p.type })

function viewChange(a: View, b: View): ViewChange | null {
  if (a === b || stable(a) === stable(b)) return null
  const strip = (v: View) => {
    const o = { ...v } as Record<string, unknown>
    for (const f of LAYOUT_FIELDS) delete o[f]
    return stable(o)
  }
  const layout = strip(a) === strip(b)
  return { id: b.id, delta: { part: 'view~', view: viewRef(b), ...(layout ? { layout: true as const } : {}) }, layout }
}

/** The changes from one version of a database to the next (either may be absent: created / deleted). */
export function databaseChangesDetail(prev: Database | undefined, next: Database | undefined): DatabaseDetail {
  if (!prev && !next) return { schema: null, views: [], kinds: 0 }
  if (!prev) return { schema: [], views: [], kinds: K.CREATE }
  if (!next) return { schema: [], views: [], kinds: K.DELETE }
  if (prev === next) return { schema: null, views: [], kinds: 0 }
  const deltas: SchemaDelta[] = []
  let kinds = 0

  // properties: added, removed, changed (without options), options per id, option order, property order
  if (prev.properties !== next.properties) {
    const before = new Map(prev.properties.map((p) => [p.id, p]))
    const after = new Map(next.properties.map((p) => [p.id, p]))
    for (const p of next.properties) if (!before.has(p.id)) deltas.push({ part: 'prop+', prop: propRef(p) })
    for (const p of prev.properties) if (!after.has(p.id)) deltas.push({ part: 'prop-', prop: propRef(p) })
    for (const p of next.properties) {
      const o = before.get(p.id)
      if (!o || o === p) continue
      if (stable(defCore(o)) !== stable(defCore(p))) deltas.push({ part: 'prop~', prop: propRef(p) })
      const oo = new Map((o.options ?? []).map((x) => [x.id, x]))
      const no = new Map((p.options ?? []).map((x) => [x.id, x]))
      for (const x of p.options ?? []) {
        const was = oo.get(x.id)
        if (!was) deltas.push({ part: 'opt+', prop: propRef(p), opt: { id: x.id, name: x.name } })
        else if (was.name !== x.name || was.color !== x.color || (was.group ?? null) !== (x.group ?? null))
          deltas.push({ part: 'opt~', prop: propRef(p), opt: { id: x.id, name: x.name, ...(was.name !== x.name ? { prev: was.name } : {}) } })
      }
      for (const x of o.options ?? []) if (!no.has(x.id)) deltas.push({ part: 'opt-', prop: propRef(p), opt: { id: x.id, name: x.name } })
      const kept = (o.options ?? []).filter((x) => no.has(x.id)).map((x) => x.id)
      const keptNow = (p.options ?? []).filter((x) => oo.has(x.id)).map((x) => x.id)
      if (kept.join('\u0000') !== keptNow.join('\u0000')) deltas.push({ part: 'order', prop: propRef(p) })
    }
    const order = prev.properties.filter((p) => after.has(p.id)).map((p) => p.id)
    const orderNow = next.properties.filter((p) => before.has(p.id)).map((p) => p.id)
    if (order.join('\u0000') !== orderNow.join('\u0000')) deltas.push({ part: 'order' })
    if (deltas.length) kinds |= K.SCHEMA
  }
  if (!!prev.locked !== !!next.locked) {
    deltas.push({ part: 'lock' })
    kinds |= K.LOCK
  }
  if (prev.commands !== next.commands && stable(prev.commands ?? null) !== stable(next.commands ?? null)) {
    deltas.push({ part: 'commands' })
    kinds |= K.COMMANDS
  }
  if (dbMetaCore(prev) !== dbMetaCore(next)) {
    deltas.push({ part: 'dbmeta' })
    kinds |= K.DBMETA
  }

  // views: added / removed are schema-level parts of their view places; changed ones carry a layout flag
  const views: ViewChange[] = []
  if (prev.views !== next.views) {
    const before = new Map(prev.views.map((v) => [v.id, v]))
    const after = new Map(next.views.map((v) => [v.id, v]))
    for (const v of next.views) {
      const o = before.get(v.id)
      if (!o) views.push({ id: v.id, delta: { part: 'view+', view: viewRef(v) }, layout: false })
      else {
        const c = viewChange(o, v)
        if (c) views.push(c)
      }
    }
    for (const v of prev.views) if (!after.has(v.id)) views.push({ id: v.id, delta: { part: 'view-', view: viewRef(v) }, layout: false })
  }
  return { schema: deltas.length ? deltas : null, views, kinds }
}
