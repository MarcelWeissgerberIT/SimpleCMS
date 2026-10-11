/**
 * Targets are overlays (design §6.3): the object as it is NOW with only the parts the eject decided taken from the
 * state before the writer — a comment thread, a page lock, a favourite or a privacy marker made since stay. Pages and
 * rows part by part (title, icon, cover, content or the planner's working content, trash, parent, order, record type,
 * property values as planned); databases part by part (property definitions, options, their order, the lock, views),
 * a property the writer added taken out with the view clean-up of a delete (`withoutProperty`, handed in). Pure.
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page, PropertyDef, PropertyValue, SelectOption, View } from '../../../store/types'

/**
 * A page or row with the decided `parts` from `before`: `t` title · `i` icon · `cv` cover · `c` content (or `content`,
 * the working content of a page whose blocks went back hunk by hunk) · `tr` trash · `pa` parent (never the database: a
 * move between databases is never planned) · `o` order · `r` record type · `p:<id>` a value (`values`: as planned —
 * a property without a planned value keeps the one it has). `updatedBy` = `stamp` (null: the eject's own; a pipeline
 * row's `agent:` stamp, so a task whose agent text went back still asks for a Confirm). Everything else from `cur`.
 */
export function overlay(cur: Page, before: Page, parts: readonly string[], content?: JSONContent | null, values?: Record<ID, PropertyValue>, stamp?: string | null): Page {
  const out: Page = { ...cur, updatedBy: stamp ?? null }
  let props: Record<ID, PropertyValue> | null = null
  for (const k of parts) {
    if (k === 't') out.title = before.title
    else if (k === 'i') out.icon = before.icon
    else if (k === 'cv') out.cover = before.cover
    else if (k === 'c') out.content = before.content
    else if (k === 'tr') {
      out.trashed = before.trashed
      out.trashedAt = before.trashed ? (cur.trashed ? cur.trashedAt : before.trashedAt) : null
    } else if (k === 'pa') out.parentId = before.parentId
    else if (k === 'o') out.order = before.order
    else if (k === 'r') {
      if (before.recordType) out.recordType = before.recordType
      else delete out.recordType
    } else if (k.startsWith('p:')) {
      const id = k.slice(2)
      if (values && !(id in values)) continue
      props ??= { ...cur.properties }
      const v = values ? values[id] : before.properties[id]
      if (v === undefined) delete props[id]
      else props[id] = v
    }
  }
  if (content !== undefined) out.content = content
  if (props) out.properties = props
  return out
}

/** One decided part of a database: back to the pin's (a deleted thing re-added at its pin index), or taken out. */
export interface SchemaDecision {
  /** `p:<prop>` a definition · `o:<prop>/<opt>` an option · `oo:<prop>` option order · `po` property order · `l` the lock · `v:<view>` a view */
  part: string
  op: 'back' | 'remove'
}

/** Insert `item` where it sat among `pin` (after the nearest earlier neighbour that is in `list`). */
function insertAtPin<T extends { id: string }>(list: T[], pin: readonly T[], item: T): T[] {
  const at = pin.findIndex((x) => x.id === item.id)
  let after = -1
  for (let i = at - 1; i >= 0 && after < 0; i--) after = list.findIndex((x) => x.id === pin[i].id)
  const out = [...list]
  out.splice(after + 1, 0, item)
  return out
}

/** `list` in the pin's order where the pin knows the ids (stable; ids the pin does not know keep their place after). */
function pinOrder<T extends { id: string }>(list: readonly T[], pin: readonly T[]): T[] {
  const rank = new Map(pin.map((x, i) => [x.id, i]))
  return list
    .map((x, i) => ({ x, i, r: rank.get(x.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.x)
}

/**
 * A database with the decided parts of its schema and views from `pinDb` (the schema pin). Order: properties taken
 * out (with `withoutProperty`'s view clean-up), definitions back or re-added, options, the orders, the lock, views.
 */
export function overlayDb(cur: Database, pinDb: Database, decided: readonly SchemaDecision[], deps: { withoutProperty(db: Database, propId: ID): Database }): Database {
  let db: Database = { ...cur }
  const of = (prefix: string, op: SchemaDecision['op']) => decided.filter((d) => d.op === op && d.part.startsWith(prefix))
  for (const d of of('p:', 'remove')) db = deps.withoutProperty(db, d.part.slice(2))
  let props = db.properties
  for (const d of of('p:', 'back')) {
    const id = d.part.slice(2)
    const then = pinDb.properties.find((p) => p.id === id)
    if (!then) continue
    const now = props.find((p) => p.id === id)
    // the definition without its options (options are parts of their own); re-added whole
    props = now ? props.map((p) => (p.id === id ? withOptions(then, now.options) : p)) : insertAtPin(props, pinDb.properties, then)
  }
  const optsOf = (propId: ID, fn: (opts: SelectOption[], pinOpts: SelectOption[]) => SelectOption[]) => {
    const pinOpts = pinDb.properties.find((p) => p.id === propId)?.options ?? []
    props = props.map((p) => (p.id === propId ? { ...p, options: fn(p.options ?? [], pinOpts) } : p))
  }
  for (const d of of('o:', 'remove')) {
    const [propId, optId] = d.part.slice(2).split('/')
    optsOf(propId, (opts) => opts.filter((o) => o.id !== optId))
  }
  for (const d of of('o:', 'back')) {
    const [propId, optId] = d.part.slice(2).split('/')
    optsOf(propId, (opts, pinOpts) => {
      const then = pinOpts.find((o) => o.id === optId)
      if (!then) return opts
      return opts.some((o) => o.id === optId) ? opts.map((o) => (o.id === optId ? { ...then } : o)) : insertAtPin(opts, pinOpts, { ...then })
    })
  }
  for (const d of of('oo:', 'back')) optsOf(d.part.slice(3), (opts, pinOpts) => pinOrder(opts, pinOpts))
  if (decided.some((d) => d.part === 'po' && d.op === 'back')) props = pinOrder(props, pinDb.properties)
  db.properties = props
  if (decided.some((d) => d.part === 'l' && d.op === 'back')) {
    if (pinDb.locked) db.locked = true
    else delete db.locked
  }
  let views: View[] = db.views
  for (const d of of('v:', 'remove')) views = views.filter((v) => v.id !== d.part.slice(2))
  for (const d of of('v:', 'back')) {
    const id = d.part.slice(2)
    const then = pinDb.views.find((v) => v.id === id)
    if (!then) continue
    views = views.some((v) => v.id === id) ? views.map((v) => (v.id === id ? then : v)) : insertAtPin(views, pinDb.views, then)
  }
  db.views = views
  return db
}

/** A definition with these options (none: without the key). */
function withOptions(p: PropertyDef, options: SelectOption[] | undefined): PropertyDef {
  const { options: _o, ...rest } = p
  return (options ? { ...rest, options } : rest) as PropertyDef
}
