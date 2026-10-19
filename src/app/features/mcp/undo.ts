/**
 * One MCP — a call's Undo in Agent activity: all or nothing (the owner's decision, Weg 4 · D2; spec § 3.2 "an Undo leaves
 * anything changed since alone").
 *
 *  - While `plan.apply` runs, every page and database the call writes under its own writer is noted with what it was
 *    before (`tapeCall`). When it ends, they are kept as the call left them — with the live pages below every page the
 *    Undo would put into the trash (what the call made, what it brought back from the trash) and the row values and
 *    uses of every property it added to an existing database or changed the type of.
 *  - The Undo compares (`changedSince`): when anything of it differs now — whoever changed it, the call's own automations
 *    and autofill included —, a page sits below one it would trash, or someone else wrote one of them while the call
 *    ran, it writes NOTHING and names what changed; Versions, the trash and (in the local workspace) the flight
 *    recorder's Eject stay. Otherwise everything goes back in ONE store update (`putBack`, as the person's Undo): what
 *    the call made to the trash (never deleted for good), what it changed as it was.
 */
import { t } from '../../i18n'
import { databaseChanges, pageChanges, useWorkspace } from '../../store/store'
import type { Database, ID, Page, PropertyDef } from '../../store/types'
import { currentWriter, formatWriterKey, type Writer } from '../../store/writer'
import { rewindAllowed, type RewindPatch } from '../../store/rewind'
import { contentKey } from '../history/snapshots'
import { propertyRefs } from '../../database'

const ws = () => useWorkspace.getState()

/** The Undo ran (true) or was refused, with the words for the toast and the activity row (UI language). */
export type UndoOutcome = { ok: true } | { ok: false; message: string; detail: string }

/** What tells a page as the call left it from the page now (the toast names these). */
type Part = 'gone' | 'text' | 'title' | 'icon' | 'cover' | 'place' | 'trash' | 'comments' | 'type' | 'values' | 'settings' | 'properties' | 'views' | 'lock' | 'below' | 'meanwhile'

/** The parts of the workspace an MCP call never writes: one that does gets no Undo (it could not be put back). */
const OTHER = ['people', 'functions', 'agents', 'scripts', 'kit', 'integrations', 'look', 'ai', 'governor', 'fuseSignoffs'] as const

/* ------------------------------------------------------------------ */
/* Fingerprints                                                        */
/* ------------------------------------------------------------------ */

const json = (v: unknown) => JSON.stringify(v ?? null)

/** A row's values: the order of keys and an emptied value (null, '', []) are no change. */
function valuesKey(props: Record<string, unknown> | undefined): string {
  const out: Array<[string, unknown]> = []
  for (const k of Object.keys(props ?? {}).sort()) {
    const v = props![k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    out.push([k, v])
  }
  return JSON.stringify(out)
}

/** What differs between a page as the call left it and the page now (block ids aside; [] = nothing). */
function pageParts(a: Page, b: Page | undefined): Part[] {
  if (!b) return ['gone']
  if (a === b) return []
  const out: Part[] = []
  if (a.content !== b.content && contentKey(a.content) !== contentKey(b.content)) out.push('text')
  if (a.title !== b.title) out.push('title')
  if (json(a.icon) !== json(b.icon)) out.push('icon')
  if (json(a.cover) !== json(b.cover)) out.push('cover')
  if (a.parentId !== b.parentId || a.databaseId !== b.databaseId || a.order !== b.order || !!a.private !== !!b.private) out.push('place')
  if (!!a.trashed !== !!b.trashed) out.push('trash')
  if (json(a.comments?.length ? a.comments : null) !== json(b.comments?.length ? b.comments : null)) out.push('comments')
  if ((a.recordType ?? null) !== (b.recordType ?? null)) out.push('type')
  if (valuesKey(a.properties) !== valuesKey(b.properties)) out.push('values')
  if (json(a.settings) !== json(b.settings)) out.push('settings')
  return out
}

/** Bookkeeping, no change of a database: when its automations / repeating templates last ran, its unique-id counter. */
const DB_STAMPS = new Set(['lastRunAt', 'lastStatus', 'lastMessage', 'nextUniqueId'])

/** Canonical JSON (keys sorted, undefined dropped, the stamps aside). */
function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (!x || typeof x !== 'object') return x
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(x).sort()) {
      const y = (x as Record<string, unknown>)[k]
      if (y === undefined || DB_STAMPS.has(k)) continue
      out[k] = walk(y)
    }
    return out
  }
  return JSON.stringify(walk(v) ?? null)
}

/** What differs between a database as the call left it and now. */
function dbParts(a: Database, b: Database | undefined): Part[] {
  if (!b) return ['gone']
  if (a === b) return []
  const out: Part[] = []
  if (!!a.locked !== !!b.locked) out.push('lock')
  if (canon(a.properties) !== canon(b.properties)) out.push('properties')
  if (canon(a.views) !== canon(b.views)) out.push('views')
  const rest = (d: Database) => canon({ ...d, properties: undefined, views: undefined, locked: undefined })
  if (rest(a) !== rest(b)) out.push('settings')
  return out
}

/** The live pages below these pages (rows below their database), the pages themselves aside. */
function liveBelow(pages: Record<ID, Page>, roots: readonly ID[]): Set<ID> {
  const kids = new Map<ID, ID[]>()
  for (const p of Object.values(pages)) {
    if (p.trashed || !p.parentId) continue
    const list = kids.get(p.parentId)
    if (list) list.push(p.id)
    else kids.set(p.parentId, [p.id])
  }
  const out = new Set<ID>()
  const stack = [...roots]
  const seen = new Set<ID>(roots)
  while (stack.length)
    for (const k of kids.get(stack.pop()!) ?? []) {
      if (seen.has(k)) continue
      seen.add(k)
      out.add(k)
      stack.push(k)
    }
  return out
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)

/** A property the call added to (or changed the type of in) a database that was there before: its row values (the trash too) and what is built on it. */
function propUse(dbId: ID, propId: ID): { values: string; refs: string } {
  const s = ws()
  const db = s.databases[dbId]
  const values: Array<[ID, string]> = []
  for (const p of Object.values(s.pages)) if (p.databaseId === dbId && !isEmpty(p.properties?.[propId])) values.push([p.id, json(p.properties[propId])])
  values.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return { values: JSON.stringify(values), refs: JSON.stringify(db ? propertyRefs(db, s.databases, propId).sort() : null) }
}

/* ------------------------------------------------------------------ */
/* The tape: what the call wrote                                       */
/* ------------------------------------------------------------------ */

/** Was this write set off by the call — an automation, autofill, the kit, a synced copy its write woke (their cause)? */
function setOffBy(w: Writer | null, key: string): boolean {
  if (!w) return false
  if (formatWriterKey(w).split('<').slice(1).includes(key)) return true
  const raw = w.kind === 'script' ? w.via : 'cause' in w ? w.cause : undefined
  return typeof raw === 'string' && raw.split('<').includes(key)
}

interface Taken<T> {
  id: ID
  /** before the call (undefined: the call made it) */
  was: T | undefined
  /** as the call left it */
  after: T
}

export interface CallUndo {
  pages: Array<Taken<Page>>
  dbs: Array<Taken<Database>>
  /** the pages the Undo puts into the trash: the call's made ones (the top of each made tree), the ones it brought back */
  trash: ID[]
  /** the live pages below them as the call left them (null: one of the call's own pages, compared as such) */
  below: Map<ID, Page | null>
  /** the databases of those pages (a restored database, a database below a page) as the call left them — their schema is theirs */
  inside: Map<ID, Database>
  /** a property the call added to an existing database or changed the type of → its values and what is built on it, as the call left them */
  added: Array<{ db: ID; prop: ID; use: { values: string; refs: string } }>
  /** page / database ids someone else wrote while the call ran ("db:<id>" for a database) */
  meanwhile: Set<string>
}

/**
 * Note what the call (its writer) writes into pages and databases from now on. `finish()` when `plan.apply` ended: the
 * call's Undo (null: it changed nothing — or something no Undo can put back); `stop()` when it failed.
 */
export function tapeCall(writer: Writer): { finish: () => CallUndo | null; stop: () => void } {
  const key = formatWriterKey(writer)
  const pagesWas = new Map<ID, Page | undefined>()
  const dbsWas = new Map<ID, Database | undefined>()
  const meanwhile = new Set<string>()
  let outside = false
  const unsub = useWorkspace.subscribe((s, prev) => {
    const w = currentWriter()
    const own = !!w && formatWriterKey(w) === key
    // the call's own follow-ups land in what it left (the Undo takes them back with it); anyone else's write on a page the
    // call wrote already is theirs — the Undo would overwrite it
    const theirs = !own && !setOffBy(w, key)
    if (s.pages !== prev.pages) {
      const ch = pageChanges(s.pages, prev.pages)
      for (const id of [...ch.changed, ...ch.removed]) {
        if (own) {
          if (!pagesWas.has(id)) pagesWas.set(id, prev.pages[id])
        } else if (theirs && pagesWas.has(id) && prev.pages[id] && pageParts(prev.pages[id]!, s.pages[id]).length) meanwhile.add(id)
      }
    }
    if (s.databases !== prev.databases) {
      const ch = databaseChanges(s.databases, prev.databases)
      for (const id of [...ch.changed, ...ch.removed]) {
        if (own) {
          if (!dbsWas.has(id)) dbsWas.set(id, prev.databases[id])
        } else if (theirs && dbsWas.has(id) && prev.databases[id] && dbParts(prev.databases[id]!, s.databases[id]).length) meanwhile.add(`db:${id}`)
      }
    }
    if (own && OTHER.some((k) => s[k] !== prev[k])) outside = true
  })
  const finish = (): CallUndo | null => {
    unsub()
    if (outside) return null
    const { pages, databases } = ws()
    const out: CallUndo = { pages: [], dbs: [], trash: [], below: new Map(), inside: new Map(), added: [], meanwhile }
    for (const [id, was] of pagesWas) {
      const after = pages[id]
      // deleted for good by the call (its own rollback runs only when it fails): nothing an Undo could bring back
      if (!after) {
        if (was) return null
        continue
      }
      if (after !== was) out.pages.push({ id, was, after })
    }
    for (const [id, was] of dbsWas) {
      const after = databases[id]
      if (!after) {
        if (was) return null
        continue
      }
      if (after === was) continue
      out.dbs.push({ id, was, after })
      // a property it added, or one whose type it changed (its values now fit the new type: a value written since would
      // no longer fit the old one the Undo puts back)
      if (was)
        for (const p of after.properties) {
          const old = was.properties.find((x) => x.id === p.id)
          if (!old || old.type !== p.type) out.added.push({ db: id, prop: p.id, use: propUse(id, p.id) })
        }
    }
    if (!out.pages.length && !out.dbs.length) return null
    const made = new Set(out.pages.filter((e) => !e.was).map((e) => e.id))
    for (const e of out.pages) {
      if (e.after.trashed) continue
      // made: only the top of a made tree (the pages below go along with it); brought back from the trash: it goes back
      const up = e.after.parentId ?? e.after.databaseId
      if ((!e.was && !(up && made.has(up))) || e.was?.trashed) out.trash.push(e.id)
    }
    for (const id of liveBelow(pages, out.trash)) out.below.set(id, pagesWas.has(id) ? null : pages[id]!)
    for (const id of [...out.trash, ...out.below.keys()]) if (databases[id] && !dbsWas.has(id)) out.inside.set(id, databases[id]!)
    return out
  }
  return { finish, stop: unsub }
}

/* ------------------------------------------------------------------ */
/* The Undo                                                            */
/* ------------------------------------------------------------------ */

const titleOf = (p: Page | undefined) => p?.title?.trim() || t('common.untitled')

/** Is everything as the call left it? null: yes; else the first thing changed, how many more, and what. */
function changedSince(u: CallUndo): { title: string; more: number; parts: Part[] } | null {
  const { pages, databases } = ws()
  const hits = new Map<string, { title: string; parts: Part[] }>()
  const hit = (key: string, title: string, parts: Part[]) => {
    if (!parts.length) return
    const h = hits.get(key)
    if (h) h.parts.push(...parts)
    else hits.set(key, { title, parts: [...parts] })
  }
  for (const e of u.pages) hit(e.id, titleOf(pages[e.id] ?? e.after), [...pageParts(e.after, pages[e.id]), ...(u.meanwhile.has(e.id) ? (['meanwhile'] as const) : [])])
  for (const e of u.dbs) hit(e.id, titleOf(pages[e.id]), [...dbParts(e.after, databases[e.id]), ...(u.meanwhile.has(`db:${e.id}`) ? (['meanwhile'] as const) : [])])
  for (const a of u.added) {
    const now = propUse(a.db, a.prop)
    // filled in (a row in the trash too), or something built on it since (a view, a form, a formula, a rollup elsewhere)
    hit(a.db, titleOf(pages[a.db]), [...(now.values !== a.use.values ? (['values'] as const) : []), ...(now.refs !== a.use.refs ? (['properties'] as const) : [])])
  }
  for (const [id, d] of u.inside) hit(id, titleOf(pages[id]), dbParts(d, databases[id]))
  if (u.trash.length) {
    // below a page the Undo puts into the trash: a page put there since, or one of those that were changed or moved away
    // — named by that page (the one the Undo would trash)
    const roots = new Set(u.trash)
    const rootOf = (id: ID): ID => {
      const seen = new Set<ID>()
      let cur: ID | null | undefined = id
      while (cur && !roots.has(cur) && !seen.has(cur)) {
        seen.add(cur)
        cur = pages[cur]?.parentId ?? u.below.get(cur)?.parentId
      }
      return cur && roots.has(cur) ? cur : id
    }
    const under = (id: ID) => {
      const root = rootOf(id)
      hit(root, titleOf(pages[root]), ['below'])
    }
    const below = liveBelow(pages, u.trash)
    for (const id of below) if (!u.below.has(id)) under(id)
    for (const [id, p] of u.below) if (p && (!below.has(id) || pageParts(p, pages[id]).length)) under(id)
  }
  if (!hits.size) return null
  const all = [...hits.values()]
  return { title: all[0]!.title, more: all.length - 1, parts: [...new Set(all.flatMap((h) => h.parts))] }
}

/** Every option of the database now that a row still holds after the Undo stays (no value left pointing at nothing). */
function withHeldOptions(was: Database, now: Database, pages: Record<ID, Page>, patch: Record<ID, Page>): PropertyDef[] {
  const held = new Map<ID, Set<string>>()
  for (const p of Object.values(pages)) {
    if (p.databaseId !== now.id) continue
    for (const [k, v] of Object.entries((patch[p.id] ?? p).properties ?? {})) {
      const ids = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
      if (!ids.length) continue
      const set = held.get(k) ?? new Set<string>()
      ids.forEach((x) => set.add(x))
      held.set(k, set)
    }
  }
  return was.properties.map((def) => {
    const cur = now.properties.find((p) => p.id === def.id)
    const use = held.get(def.id)
    if (!def.options || !cur?.options || !use) return def
    const keep = cur.options.filter((o) => use.has(o.id) && !def.options!.some((x) => x.id === o.id))
    return keep.length ? { ...def, options: [...def.options, ...keep] } : def
  })
}

/** A database put back with the bookkeeping it has now (DB_STAMPS: counters and last runs are no part of the call's work). */
function withStamps(back: Database, now: Database): Database {
  const automations = back.automations?.map((a) => {
    const n = now.automations?.find((x) => x.id === a.id)
    return n ? { ...a, lastRunAt: n.lastRunAt, lastStatus: n.lastStatus, lastMessage: n.lastMessage } : a
  })
  const templates = back.templates?.map((tpl) => {
    const n = now.templates?.find((x) => x.id === tpl.id)
    return tpl.repeat && n?.repeat ? { ...tpl, repeat: { ...tpl.repeat, lastRunAt: n.repeat.lastRunAt } } : tpl
  })
  return { ...back, nextUniqueId: Math.max(back.nextUniqueId, now.nextUniqueId), ...(automations ? { automations } : {}), ...(templates ? { templates } : {}) }
}

/** The highest unique id a row of the database holds after the Undo (the trash too; 0: none). */
function heldNumber(db: Database, pages: Record<ID, Page>, patch: Record<ID, Page>): number {
  const ids = db.properties.filter((p) => p.type === 'unique_id').map((p) => p.id)
  let max = 0
  if (!ids.length) return max
  for (const p of Object.values(pages)) {
    if (p.databaseId !== db.id) continue
    const props = (patch[p.id] ?? p).properties ?? {}
    for (const k of ids) if (typeof props[k] === 'number') max = Math.max(max, props[k] as number)
  }
  return max
}

/**
 * The person's Undo of a call (service.ts runs it under `you~undo`): refused whole when anything changed since, else
 * everything back in ONE store update.
 */
export function runUndo(u: CallUndo): UndoOutcome {
  const changed = changedSince(u)
  if (changed) return { ok: false, ...refusal(changed) }
  const { pages, databases } = ws()
  const patch: RewindPatch = { pages: {}, databases: {} }
  const trash = new Set(u.trash)
  for (const e of u.pages) {
    const now = pages[e.id]!
    if (!e.was) {
      // made: the top of each made tree to the trash, the pages below go along
      if (trash.has(e.id)) patch.pages![e.id] = { ...now, trashed: true }
      continue
    }
    // changed: as it was (its text written only when it differs — an editor's ids alone are no difference). The text
    // as a COPY: the object it was may be the one a team document wrote into the store (cloud/binding.ts `fromY`), and
    // the binding never writes such an object back — the page document would keep the call's text
    const sameText = e.was.content === now.content || contentKey(e.was.content) === contentKey(now.content)
    patch.pages![e.id] = { ...e.was, content: sameText ? now.content : e.was.content && structuredClone(e.was.content) }
  }
  for (const e of u.dbs) {
    const now = databases[e.id]!
    // a database the call made goes with its page; one it changed as it was — its bookkeeping as it is now (a counter
    // never lower: a row in the trash keeps its number; when an automation or a repeating template last ran), an option a
    // row still holds stays; one that differs only in its bookkeeping (the call took a number) is not written at all
    if (!e.was || canon(e.was) === canon(now)) continue
    const back = withStamps({ ...e.was, properties: withHeldOptions(e.was, now, pages, patch.pages!) }, now)
    // the numbers the call itself gave out (a unique_id column it made): its counter goes back while nobody took one since
    // — never below a number a row keeps
    if (now.nextUniqueId === e.after.nextUniqueId) back.nextUniqueId = Math.max(e.was.nextUniqueId, heldNumber(back, pages, patch.pages!) + 1)
    patch.databases![e.id] = back
  }
  // refused by the store after all (a database locked now whose schema would change, a parent chain that would loop)
  if (!ws().putBack(patch)) {
    const locked = Object.keys(patch.databases!).some((id) => databases[id]?.locked)
    return { ok: false, ...refusal({ title: titleOf(pages[u.pages[0]?.id ?? u.dbs[0]?.id ?? '']), more: 0, parts: [locked ? 'lock' : 'place'] }) }
  }
  return { ok: true }
}

/** The refusal in the UI language: what changed, then where the person can take it back by hand. */
function refusal(c: { title: string; more: number; parts: Part[] }): { message: string; detail: string } {
  const what = c.parts.map((p) => t(`features.mcp.undo.part.${p}`)).join(', ')
  const message = c.more ? t('features.mcp.undo.refusedMore', { title: c.title, n: c.more, what }) : t('features.mcp.undo.refused', { title: c.title, what })
  // the flight recorder's Eject takes a writer's work back in the local workspace only
  const detail = t(rewindAllowed() ? 'features.mcp.undo.remedyLocal' : 'features.mcp.undo.remedy')
  return { message, detail }
}
