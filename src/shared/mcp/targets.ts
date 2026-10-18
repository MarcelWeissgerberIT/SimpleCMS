/**
 * One MCP — the write gate (Weg 4 D4): every write names what it touches (`WriteTargets`), and ONE check
 * (`targetProblem`) refuses a call whose targets One does not let an agent write — on the local bridge at plan time and
 * again right before the call writes (a card may have waited), on the team server before each write. Pure: each side
 * hands in its own view of the workspace (`TargetWorld`); the words are the same on both.
 *
 * What is checked, per target:
 *  - every id: it exists and is no template's (templates read as unknown over MCP — spec § 3.3)
 *  - content / schema / rows / places: not in the trash (nor below a page in it)
 *  - every id: not part of One's own databases (system_database — read-only over MCP)
 *  - content: the page is not locked (its text cannot change; its title, icon and values can)
 *  - schema: the database is not locked (its properties, options and views cannot change; rows can)
 *  - marked: the person's context marks — a call that overwrites blocks there is refused
 *  - trees: a page going to the trash holds none of One's own databases below it
 *  - restores: a page coming back from the trash holds none of One's own databases below it
 *  - moves: a page moves only between two shared places or two private ones (team)
 * The per-tool checks stay as a backstop.
 */

export interface WriteTargets {
  /** pages whose text the call writes (append, replace, a link or a database block in it, a task's fields) */
  content: string[]
  /** databases whose schema (properties, options, views, a rollup) the call changes */
  schema: string[]
  /** rows the call writes values into, per database (`ids`: existing rows; `made`: how many new rows) */
  rows: Array<{ db: string; ids: string[]; made?: number }>
  /** pages the call places something under, moves, renames, re-icons or trashes */
  places: string[]
  /** pages whose blocks the call overwrites (a replace): refused under the person's context marks */
  marked?: string[]
  /** pages going to the trash with everything below them */
  trees?: string[]
  /** pages coming back from the trash (they are in it — that is the point) */
  restores?: string[]
  /** a page moving to a new parent (null = the top level): private ⇄ shared is done in One */
  moves?: Array<{ id: string; to: string | null }>
  /** the argument each id came from (`parentId`, `inline.pageId`, `rows[2].markdown` …): named after the code */
  paths?: Record<string, string>
  /** why the call touches an id it does not name (a rollup the delete clears there): said in its refusal */
  why?: Record<string, string>
}

export const noTargets = (): WriteTargets => ({ content: [], schema: [], rows: [], places: [] })

/** What the gate reads of the workspace (each side's own store / meta document). */
export interface TargetWorld {
  exists(id: string): boolean
  inTemplate(id: string): boolean
  /** in the trash itself or below a page in it */
  inTrash(id: string): boolean
  title(id: string): string
  /** the system_database refusal for a page in One's own databases (`path`: the argument it came from), else null */
  system(id: string, path: string, why: string): string | null
  /** the same for a tree holding one of One's own databases below it */
  systemBelow(id: string, path: string): string | null
  pageLocked(id: string): boolean
  databaseLocked(id: string): boolean
  /** a page of the member's Private section (team); always false locally and on the team server */
  isPrivate(id: string): boolean
  /** the person's context marks limit what may be read of this page (the bridge only) */
  marked(id: string): boolean
}

export type GatePhase = 'plan' | 'apply'

const q = (s: string) => JSON.stringify(s)

/** The targets merged (each id once). */
export function mergeTargets(...list: ReadonlyArray<Partial<WriteTargets> | null | undefined>): WriteTargets {
  const out = noTargets()
  const marked = new Set<string>()
  const trees = new Set<string>()
  const restores = new Set<string>()
  const moves: Array<{ id: string; to: string | null }> = []
  const rows = new Map<string, { ids: Set<string>; made: number }>()
  const paths: Record<string, string> = {}
  const why: Record<string, string> = {}
  const content = new Set<string>()
  const schema = new Set<string>()
  const places = new Set<string>()
  for (const t of list) {
    if (!t) continue
    for (const id of t.content ?? []) content.add(id)
    for (const id of t.schema ?? []) schema.add(id)
    for (const id of t.places ?? []) places.add(id)
    for (const id of t.marked ?? []) marked.add(id)
    for (const id of t.trees ?? []) trees.add(id)
    for (const id of t.restores ?? []) restores.add(id)
    for (const [id, path] of Object.entries(t.paths ?? {})) if (!(id in paths)) paths[id] = path
    for (const [id, text] of Object.entries(t.why ?? {})) if (!(id in why)) why[id] = text
    for (const m of t.moves ?? []) if (!moves.some((x) => x.id === m.id && x.to === m.to)) moves.push(m)
    for (const r of t.rows ?? []) {
      const e = rows.get(r.db) ?? { ids: new Set<string>(), made: 0 }
      for (const id of r.ids) e.ids.add(id)
      e.made += r.made ?? 0
      rows.set(r.db, e)
    }
  }
  out.content = [...content]
  out.schema = [...schema]
  out.places = [...places]
  out.rows = [...rows].map(([db, e]) => ({ db, ids: [...e.ids], ...(e.made ? { made: e.made } : {}) }))
  if (marked.size) out.marked = [...marked]
  if (trees.size) out.trees = [...trees]
  if (restores.size) out.restores = [...restores]
  if (moves.length) out.moves = moves
  if (Object.keys(paths).length) out.paths = paths
  if (Object.keys(why).length) out.why = why
  return out
}

/** Every id the targets name (for the per-id checks). */
function everyId(t: WriteTargets): string[] {
  return [
    ...new Set([
      ...t.content,
      ...t.schema,
      ...t.places,
      ...t.rows.flatMap((r) => [r.db, ...r.ids]),
      ...(t.marked ?? []),
      ...(t.trees ?? []),
      ...(t.restores ?? []),
      ...(t.moves ?? []).flatMap((m) => (m.to ? [m.id, m.to] : [m.id])),
    ]),
  ]
}

/** "a", "b" and "c" — at most 8 named, then "and n more". */
function named(items: string[]): string {
  const shown = items.slice(0, 8)
  const more = items.length - shown.length
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '')
  return more > 0 ? `${shown.join(', ')} and ${more} more` : head
}

/**
 * The first reason One refuses these targets (a refusal in the contract's shape, code first), or null — every target that
 * fails that check named in it (a batch is fixed in one round). `phase`: 'apply' words a refusal as "meanwhile" (the card
 * waited; nothing is written either way). `t.paths` puts the argument a target came from after the code.
 */
export function targetProblem(t: WriteTargets, w: TargetWorld, phase: GatePhase): string | null {
  const later = phase === 'apply'
  const restores = new Set(t.restores ?? [])
  const dbs = new Set([...t.schema, ...t.rows.map((r) => r.db)])
  const ids = everyId(t)
  /** "<code>: <path>: " — the path when exactly one target fails and the call named it */
  const head = (code: string, failed: string[]) => `${code}: ${failed.length === 1 && t.paths?.[failed[0]!] ? `${t.paths[failed[0]!]}: ` : ''}`
  const titled = (failed: string[]) => named(failed.map((id) => q(w.title(id))))
  // gone, or a template's: unknown over MCP (a template's page is never named)
  // (an id a restore names that does not exist writes nothing: the tool's own answer lists what is in the trash)
  const others = new Set(everyId({ ...t, restores: [] }))
  const unknown = ids.filter((id) => (!w.exists(id) && (others.has(id) || !restores.has(id))) || (w.exists(id) && w.inTemplate(id)))
  if (unknown.length) {
    const list = named(unknown.map(q))
    if (later) return `${head('not_found', unknown)}${list} ${unknown.length === 1 ? 'is' : 'are'} gone (deleted, or no longer reachable) since the call was made. Nothing was changed. Read again (one_search, one_get_page) and call again.`
    return unknown.every((id) => dbs.has(id))
      ? `${head('not_found', unknown)}No database with id ${list}. Nothing was changed. Use one_list_databases to get database ids.`
      : `${head('not_found', unknown)}No page with id ${list}. Nothing was changed. Use one_search to find page ids.`
  }
  // in the trash (a page the call brings back is meant to be there)
  const trashed = ids.filter((id) => !restores.has(id) && w.inTrash(id))
  if (trashed.length) {
    const are = trashed.length === 1 ? 'is' : 'are'
    return later
      ? `${head('not_found', trashed)}${titled(trashed)} went to the trash since the call was made. Nothing was changed. Ask the person whether to restore ${trashed.length === 1 ? 'it' : 'them'} (one_restore_page), or leave ${trashed.length === 1 ? 'it' : 'them'}.`
      : `${head('not_found', trashed)}${titled(trashed)} ${are} already in the trash (${trashed.join(', ')}). Nothing was changed. Restore ${trashed.length === 1 ? 'it' : 'them'} first (one_restore_page), or ask the person.`
  }
  // One's own databases: read-only over MCP (the page, its rows, the pages below them, its schema)
  for (const id of ids) {
    const sys = w.system(id, t.paths?.[id] ?? '', t.why?.[id] ?? '')
    if (sys) return sys
  }
  for (const id of [...(t.trees ?? []), ...(t.restores ?? [])]) {
    const sys = w.systemBelow(id, t.paths?.[id] ?? '')
    if (sys) return sys
  }
  // locked: a page's text, a database's schema (rows and titles stay writable)
  const lockedText = t.content.filter((id) => w.pageLocked(id))
  if (lockedText.length) {
    const what = lockedText.length === 1 ? 'its content cannot change (its title and icon can)' : 'their content cannot change (their titles and icons can)'
    return `${head('locked', lockedText)}${titled(lockedText)} ${later ? `${lockedText.length === 1 ? 'was' : 'were'} locked meanwhile` : `${lockedText.length === 1 ? 'is' : 'are'} locked in One`}: ${what}. Nothing was changed. Ask the person to unlock ${lockedText.length === 1 ? 'it' : 'them'}.`
  }
  const lockedSchema = t.schema.filter((id) => w.databaseLocked(id))
  // a database the call reaches through another (a rollup it clears there): why it is touched at all
  const because = lockedSchema.find((id) => t.why?.[id])
  if (because)
    return `${head('locked', [because])}${q(w.title(because))} ${later ? 'was locked meanwhile' : 'is locked in One'}: ${t.why![because]} (its properties cannot change). Nothing was changed. Ask the person to unlock it, or to change that first.`
  if (lockedSchema.length) {
    const what = lockedSchema.length === 1 ? 'its properties and views cannot change (rows can)' : 'their properties and views cannot change (rows can)'
    return `${head('locked', lockedSchema)}${titled(lockedSchema)} ${later ? `${lockedSchema.length === 1 ? 'was' : 'were'} locked meanwhile` : `${lockedSchema.length === 1 ? 'is' : 'are'} locked in One`}: ${what}. Nothing was changed. Ask the person to unlock ${lockedSchema.length === 1 ? 'it' : 'them'}.`
  }
  // the person's context marks: blocks Claude may not read are never overwritten
  const marked = (t.marked ?? []).filter((id) => w.marked(id))
  if (marked.length)
    return `${head('rejected', marked)}The person limited what you may read on ${titled(marked)} (context marks)${later ? ' while the call waited' : ''}; this call would overwrite blocks you may not read. Nothing was changed. Append instead (mode "append"), or ask the person.`
  // Private ⇄ the workspace (team): done in One, never over MCP
  for (const m of t.moves ?? []) {
    const own = w.isPrivate(m.id)
    const there = m.to ? w.isPrivate(m.to) : own
    if (own === there) continue
    return `${head('private_scope', [m.id])}${q(w.title(m.id))} and the new place are not both ${own ? 'private' : 'shared'}: moving between Private and the workspace is done in One (sidebar). Nothing was changed. Ask the person.`
  }
  return null
}

/** How many rows of the targets are in databases that start paid AI work or send something out of One. */
export function heavyRows(t: WriteTargets, starts: (db: string) => boolean): number {
  return t.rows.reduce((n, r) => n + (starts(r.db) ? r.ids.length + (r.made ?? 0) : 0), 0)
}
