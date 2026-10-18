/**
 * MCP B3 on the team server (MCP plan § 2.2 / § 2.3): the same tools as the local bridge, without a card or an Undo —
 * so every call is checked whole before anything is written, written as few documents as it takes, taken back when a
 * later step fails (compensating writes), and recorded as pre-images (preimages.ts) owners / admins can put back.
 *
 *  - one_create_page: one page or `pages` (≤ 50, "$<index>" parents: a tree), before / after / index for one page, a
 *    link to each page at the end of its parent's text (`linkInParent`). `private` → local_only (the server never writes
 *    private pages).
 *  - one_create_database: `views` (validated like one_create_view; a board with nothing to group by gets a Status, a
 *    table follows a first view that is not one), `rows`, `icon`, `inline` (a database block in a page's text: meta
 *    first, the block last — a failed block write trashes the new database again).
 *  - one_create_row / one_update_row `rows` (≤ 50, all or none), one_upsert_rows (the agents' upsert_rows, ported:
 *    keyed only, every row decided first, any refused row fails the call with the list).
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { appendBlocks, fragmentText, markdownToNodes, plainText, type Node } from '../api/content.ts'
import { type PageInfo, type PropertyDef, type Roots, liveDatabase, livePage, nextOrder, newPageMap, pageMap, readPage, roots } from '../api/meta.ts'
import { contentDoc, findProperty, metaDoc, type WorkspaceModel } from '../api/model.ts'
import { canBeKey, checkKey, handOnlyMessage, isHandOnly, keyPropOf, keyText } from '../api/keys.ts'
import { keyHolders } from '../agents/stage.ts'
import { ValueError, type ValueContext } from '../api/values.ts'
import { newId } from '../tokens.ts'
import { assertNotSystem } from './system.ts'
import { McpWrites, assertNoListOption, assertOneWay, checkFilesValue, cleanRowTitle, cleanTitle, cutOptionNames, friendlyIn, iconIn, optionNames, unprocessable, type PropertyInput } from './writes.ts'
import { defaultView, viewChange, type View, type ViewInput } from './structure.ts'
import { McpPreimages, fragmentSnapshot, putValues, textHash, type Recorder } from './preimages.ts'
import { docJson } from './pageRead.ts'
import { blockHash, parseRef } from '../../../src/shared/mcp/refs.ts'
import { nestedTopLevel, refIndex } from '../../../src/shared/mcp/pageRead.ts'
import { MCP_DEFAULT_STATUS, MCP_LIMITS, MCP_VIEW_TYPES } from '../../../src/shared/mcp/tables.ts'
import { batchRefusal, codeOf, mcpError } from '../../../src/shared/mcp/errors.ts'

const q = (s: string) => JSON.stringify(s)
const titleOf = (p: { title: string } | null | undefined) => p?.title.trim() || 'Untitled'

/** A refusal in the contract's words (code, path, what, next step) as the ApiError the tools explain. */
const refuse = (status: 400 | 404 | 409 | 413 | 422, code: Parameters<typeof mcpError>[0], path: string, what: string, next?: string) => new ApiError(status, code, mcpError(code, path, what, next))

/** An ApiError of one entry of a batch: the entry's path after its code (`not_found: rows[3]: …`). */
function atPath(err: unknown, path: string): never {
  if (!(err instanceof ApiError)) throw err
  const code = codeOf(err.message)
  const body = code ? err.message.slice(code.length + 1).trim() : err.message
  throw new ApiError(err.status, err.code, `${code ?? (err.status === 404 ? 'not_found' : 'bad_argument')}: ${path}: ${body}`, { details: err.details })
}

/**
 * Every entry of a batch checked — a later one too when an earlier one fails — and ONE refusal naming each that does not
 * fit (`rows[i] ("title"): …` per line, shared/mcp/errors.ts batchRefusal — the bridge's words, plan.ts eachEntry); a
 * single bad entry keeps its own refusal with its path. `check` throws an ApiError for an entry that does not fit.
 */
function eachRow<T, R>(items: readonly T[], label: (item: T, i: number) => string | null, check: (item: T, i: number) => R, root = 'rows'): R[] {
  const out: R[] = []
  const failed: Array<{ i: number; err: ApiError }> = []
  items.forEach((item, i) => {
    try {
      out.push(check(item, i))
    } catch (err) {
      try {
        atPath(err, `${root}[${i}]`)
      } catch (e) {
        if (!(e instanceof ApiError)) throw e
        failed.push({ i, err: e })
      }
    }
  })
  if (!failed.length) return out
  if (failed.length === 1) throw failed[0]!.err
  const statuses = new Set(failed.map((f) => f.err.status))
  const message = batchRefusal(failed.map((f) => ({ path: `${root}[${f.i}]`, name: label(items[f.i]!, f.i), message: f.err.message })), items.length, root)
  throw new ApiError(statuses.size === 1 ? failed[0]!.err.status : 422, codeOf(message) ?? 'bad_argument', message)
}

/**
 * A failed call whose compensating write failed too: its error says that part of it stays (never "Nothing was changed" —
 * the remedy is not added to a message that says what was, shared/mcp/errors.ts withRemedy).
 */
export function partly(err: unknown): unknown {
  // a fault of the server's own on the way, and the rollback failed too: what stays is not known
  if (!(err instanceof ApiError))
    return new ApiError(500, 'rejected', 'rejected: The tool failed on the team server, and part of what the call wrote could not be taken back; nothing was retried — read what it touched again (one_get_page, one_query_database) before calling again.')
  const what = err.message.replace(/\s*Nothing was changed\..*$/s, '').trim()
  return new ApiError(err.status, err.code, `${what}${/[.!?]$/.test(what) ? '' : '.'} Part of what the call wrote could not be taken back; nothing was retried — read what it touched again before calling again.`, { details: err.details })
}

/**
 * A new row's title as the bridge takes it (writes.ts cleanTitle): whitespace collapsed, at most MCP_LIMITS.title — given
 * as `title` or through its properties (an empty one falls back to the other, and none at all is refused later).
 */
function titledRow(props: ReadonlyArray<PropertyDef>, row: RowItem): RowItem {
  const out: RowItem = { ...row }
  if (typeof row.title === 'string' && row.title.trim()) out.title = cleanTitle(row.title, 'title', 'the title')
  if (row.properties) {
    const titleProp = props.find((p) => p.type === 'title')
    const filled = Object.fromEntries(Object.entries(row.properties).filter(([k, v]) => !(typeof v === 'string' && !v.trim() && (k.trim().toLowerCase() === 'title' || findProperty(props as PropertyDef[], k)?.id === titleProp?.id))))
    out.properties = cleanRowTitle(props, filled)
  }
  return out
}

/** What a board groups by when the call names nothing (the bridge's rule): the first of these types. */
const GROUPABLE = ['status', 'select', 'multi_select', 'person', 'checkbox']

export interface PageItemInput {
  title: string
  parentId?: string
  markdown?: string
  icon?: string
}

export interface CreatePagesInput {
  title?: string
  parentId?: string | null
  markdown?: string
  icon?: string
  before?: string
  after?: string
  index?: number
  private?: boolean
  linkInParent?: 'none' | 'block' | 'mention'
  pages?: PageItemInput[]
}

export interface RowItem {
  title?: string
  properties?: Record<string, unknown>
  markdown?: string
}

type ViewSpec = { type: string } & ViewInput

export interface CreateDatabaseInput {
  title: string
  parentId?: string | null
  inline?: { pageId: string; afterBlock?: string }
  icon?: string
  properties?: PropertyInput[]
  views?: ViewSpec[]
  rows?: RowItem[]
}

export interface UpsertInput {
  databaseId: string
  keyProperty: string
  rows: Array<{ key: string | number; title?: string; properties?: Record<string, unknown>; markdown?: string }>
}

const MCP_WRITE = { agent: true, mcp: true, files: 'onefile' } as const

export class McpBatch {
  private readonly s: Services
  private readonly model: WorkspaceModel
  private readonly writes: McpWrites
  private readonly preimages: McpPreimages

  constructor(s: Services, model: WorkspaceModel, writes: McpWrites) {
    this.s = s
    this.model = model
    this.writes = writes
    this.preimages = new McpPreimages(s, model)
  }

  /* ---------------------------------------------------------------- rows: checked before anything is written */

  /**
   * A row as prepareRow + createRow / updateRow will take it — friendly values, new select options (unless locked),
   * the key, files values, "Only by hand" — checked on `r` without writing. `self`: the row changed (null: a new one).
   */
  private checkRow(r: Roots, db: NonNullable<ReturnType<typeof liveDatabase>>, input: RowItem, self: string | null, ctx: ValueContext) {
    const properties: Record<string, unknown> = {}
    let title = input.title
    const added = new Map<string, string[]>()
    for (const [key, raw] of Object.entries(input.properties ?? {})) {
      const prop = findProperty(db.properties, key)
      if (!prop && key.trim().toLowerCase() === 'title') {
        title = raw === null || raw === undefined ? '' : String(raw)
        continue
      }
      if (!prop) {
        properties[key] = raw
        continue
      }
      if (isHandOnly(prop)) throw unprocessable('invalid_value', handOnlyMessage(prop))
      if (prop.type === 'files') checkFilesValue(prop.name, raw, ctx.files)
      // two-way relations stay out of MCP (writes.ts assertOneWay — the bridge refuses the same)
      assertOneWay(r, db, prop, `properties.${prop.name}`)
      const value = cutOptionNames(prop, raw)
      properties[key] = friendlyIn(r, prop, value, ctx)
      if (prop.type === 'select' || prop.type === 'multi_select') {
        const fresh = optionNames(prop, value).filter((n) => !(prop.options ?? []).some((o) => o.id === n || o.name.trim().toLowerCase() === n.toLowerCase()))
        // a select bound to a shared list takes no option of its own (writes.ts assertNoListOption)
        if (db.ydb.get('locked') !== true) assertNoListOption(r, prop, fresh)
        if (fresh.length) added.set(prop.id, [...new Set(fresh)])
      }
    }
    if (added.size && db.ydb.get('locked') === true) added.clear()
    const augmented = db.properties.map((p) => (added.has(p.id) ? { ...p, options: [...(p.options ?? []), ...added.get(p.id)!.map((name) => ({ id: name, name }))] } : p))
    const { values, title: t } = this.model.resolveStrict(augmented, { title, properties }, ctx, MCP_WRITE)
    checkKey(r, db.page.id, db.properties, values, self, self ? livePage(r, self)?.properties : undefined)
    return { title: t, values, properties }
  }

  /** New rows, written one by one after every row was checked; a failure on the way trashes the rows made so far. */
  private async insertRows(wsId: string, dbId: string, rows: RowItem[], actor: string): Promise<Array<{ id: string; title: string }>> {
    const made: Array<{ id: string; title: string }> = []
    try {
      for (const row of rows) {
        const prepared = await this.writes.prepareRow(wsId, { databaseId: dbId }, { title: row.title, properties: row.properties }, actor, MCP_WRITE)
        const created = await this.model.createRow(wsId, dbId, { title: prepared.title, properties: prepared.properties, content: row.markdown?.trim() ? row.markdown : undefined }, actor, MCP_WRITE)
        const title = await this.model.read(wsId, (r) => String(pageMap(r, created.id)?.get('title') ?? ''))
        made.push({ id: created.id, title })
      }
    } catch (err) {
      await this.trash(wsId, made.map((m) => m.id), actor)
      throw err
    }
    return made
  }

  /** A compensating write: these pages to the trash (what a failed call made). */
  private async trash(wsId: string, ids: string[], actor: string) {
    if (!ids.length) return
    await this.s.collab
      .write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          const at = Date.now()
          for (const id of ids) {
            const yp = pageMap(r, id)
            if (!yp) continue
            yp.set('trashed', true)
            yp.set('trashedAt', at)
            yp.set('updatedAt', at)
            yp.set('updatedBy', actor)
          }
        },
        actor,
      )
      .catch((e: unknown) => this.s.log.error('mcp compensating trash failed', { workspace: wsId, pages: ids.length, error: e as Error }))
    this.s.log.info('mcp call taken back (compensating trash)', { workspace: wsId, pages: ids.length, by: actor })
  }

  /** Rows' titles and stored values right now (pre-images): every value, or per row only the properties `props[i]` names. */
  private rowStates(wsId: string, ids: string[], props?: Array<readonly string[]>) {
    return this.model.read(wsId, (r) => ids.map((id, i) => ({ id, ...(McpPreimages.rowState(r, id, props?.[i]) ?? { title: '', values: {} }) })))
  }

  /** The state of each page's (or row's) own text right now: a Restore leaves one whose text moved since (preimages.ts). */
  private hashes(wsId: string, ids: string[]): Promise<string[]> {
    return Promise.all(ids.map((id) => this.s.collab.read(contentDoc(wsId, id), (doc) => textHash(doc))))
  }

  /** What else people change on made pages / rows / databases, right now (preimages.ts markOf), and where each sits (placeOf). */
  private marks(wsId: string, ids: string[]): Promise<Array<{ mark: string; place: string }>> {
    return this.model.read(wsId, (r) => ids.map((id) => ({ mark: McpPreimages.markOf(r, id), place: McpPreimages.placeOf(r, id) })))
  }

  /** Made rows as a pre-image keeps them: title, every stored value, the state of their text, their mark and place. */
  async madeRows(wsId: string, ids: string[]) {
    const [states, hashes, marks] = await Promise.all([this.rowStates(wsId, ids), this.hashes(wsId, ids), this.marks(wsId, ids)])
    return states.map((st, i) => ({ id: st.id, title: st.title, values: st.values, hash: hashes[i]!, ...marks[i]! }))
  }

  /** Made pages (or a database) as a pre-image keeps them: title, the state of their text, their mark and place. */
  private async madePages(wsId: string, items: Array<{ id: string; title: string }>) {
    const ids = items.map((it) => it.id)
    const [hashes, marks] = await Promise.all([this.hashes(wsId, ids), this.marks(wsId, ids)])
    return items.map((it, i) => ({ id: it.id, title: it.title, hash: hashes[i]!, ...marks[i]! }))
  }

  /** Rows put back to `values` (rollback of a failed call): stored values and two-way partners as a write puts them. */
  private async putBack(wsId: string, rows: Array<{ id: string; values: Record<string, unknown>; title?: string }>, actor: string) {
    if (!rows.length) return
    await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const at = Date.now()
        for (const row of rows) {
          const yp = pageMap(r, row.id)
          if (!yp) continue
          putValues(this.model, r, row.id, row.values, actor, at)
          if (row.title !== undefined) yp.set('title', row.title)
          yp.set('updatedAt', at)
          yp.set('updatedBy', actor)
        }
      },
      actor,
    )
  }

  /* ---------------------------------------------------------------- one_create_row */

  async createRows(wsId: string, input: { databaseId: string; rows: RowItem[] }, actor: string, rec: Recorder) {
    if (input.rows.length > MCP_LIMITS.rows) throw refuse(413, 'too_large', 'rows', `${input.rows.length} rows (at most ${MCP_LIMITS.rows} per call)`)
    await this.model.read(wsId, (r) => {
      const db = liveDatabase(r, input.databaseId)
      if (!db) throw notFound('database_not_found', `No database with id "${input.databaseId}" in this workspace`)
      assertNotSystem(r, input.databaseId)
      const ctx = this.model.context(wsId, r)
      const key = keyPropOf(db.properties)
      const keys = new Map<string, number>()
      // every row checked: one refusal names each row that does not fit (as the bridge)
      eachRow(input.rows, (row) => row.title?.trim() || null, (raw, i) => {
        const row = (input.rows[i] = titledRow(db.properties, raw))
        const { values, title } = this.checkRow(r, db, row, null, ctx)
        if (!title?.trim()) throw refuse(422, 'bad_argument', 'title', 'a row needs a title')
        // the key stays unique among the rows of the call too
        const k = key ? keyText(key.type, values[key.id]) : ''
        if (k && keys.has(k)) throw unprocessable('invalid_value', `"${key!.name}" is this database's key and rows[${keys.get(k)}] has ${q(k)} too`)
        if (k) keys.set(k, i)
      })
    })
    const made = await this.insertRows(wsId, input.databaseId, input.rows, actor)
    rec.rows({ db: input.databaseId, created: await this.madeRows(wsId, made.map((m) => m.id)), updated: [] })
    this.s.log.info('mcp rows created', { workspace: wsId, database: input.databaseId, rows: made.length, by: actor })
    return { databaseId: input.databaseId, urlBase: this.model.url(wsId, ''), rows: made.map((m, index) => ({ index, id: m.id, title: m.title })) }
  }

  /* ---------------------------------------------------------------- one_update_row */

  /** `single`: the old one-row form (`id` + `properties`) — its errors carry no `rows[i]` path, as before B3. */
  async updateRows(wsId: string, rows: Array<{ id: string; properties: Record<string, unknown> }>, actor: string, rec: Recorder, single = false) {
    if (rows.length > MCP_LIMITS.rows) throw refuse(413, 'too_large', 'rows', `${rows.length} rows (at most ${MCP_LIMITS.rows} per call)`)
    const plan = await this.model.read(wsId, (r) => {
      const seen = new Set<string>()
      const one = (row: (typeof rows)[number]) => {
        if (seen.has(row.id)) throw refuse(422, 'bad_argument', '', 'this row is listed twice — one entry per row')
        seen.add(row.id)
        const page = livePage(r, row.id)
        if (!page) throw notFound('row_not_found', `No such row in this workspace: no row with id "${row.id}" (or it is in the trash)`)
        assertNotSystem(r, row.id)
        if (!page.databaseId) throw notFound('row_not_found', `No such row: ${q(titleOf(page))} is a page, not a database row — use one_update_page`)
        const db = liveDatabase(r, page.databaseId)
        if (!db) throw notFound('database_not_found', 'The row\'s database is gone')
        if (!Object.keys(row.properties ?? {}).length) throw refuse(422, 'bad_argument', 'properties', 'name at least one property to change')
        // a title given through its properties: as the bridge takes it (never empty, whitespace collapsed, ≤ 300)
        row.properties = cleanRowTitle(db.properties, row.properties)
        const checked = this.checkRow(r, db, { properties: row.properties }, row.id, this.model.context(wsId, r))
        return { id: row.id, dbId: db.page.id, ids: Object.keys(checked.values), title: checked.title }
      }
      if (single) return rows.map((row) => one(row))
      // every row checked: one refusal names each row that does not fit (as the bridge), by its title now
      return eachRow(rows, (row) => { const p = livePage(r, row.id); return p ? titleOf(p) : null }, (row) => one(row))
    })
    const before = await this.model.read(wsId, (r) => plan.map((p) => McpPreimages.rowState(r, p.id, p.ids)!))
    const done: number[] = []
    try {
      for (const [i, row] of rows.entries()) {
        const prepared = await this.writes.prepareRow(wsId, { rowId: row.id }, { properties: row.properties }, actor, MCP_WRITE)
        await this.model.updateRow(wsId, row.id, { title: prepared.title, properties: prepared.properties }, actor, MCP_WRITE)
        done.push(i)
      }
    } catch (err) {
      // the rows already written go back to their values before the call (a relation's partner rows with them)
      const ok = await this.putBack(wsId, done.map((i) => ({ id: plan[i]!.id, values: before[i]!.values, ...(plan[i]!.title !== undefined ? { title: before[i]!.title } : {}) })), actor).then(
        () => true,
        (e: unknown) => (this.s.log.error('mcp row rollback failed', { workspace: wsId, error: e as Error }), false),
      )
      throw ok ? err : partly(err)
    }
    const after = await this.model.read(wsId, (r) => plan.map((p) => McpPreimages.rowState(r, p.id, p.ids)!))
    const titled = (p: (typeof plan)[number]) => p.title !== undefined
    rec.rows({
      db: plan[0]?.dbId ?? '',
      created: [],
      updated: plan.map((p, i) => ({
        id: p.id,
        before: { values: before[i]!.values, ...(titled(p) ? { title: before[i]!.title } : {}) },
        after: { values: after[i]!.values, ...(titled(p) ? { title: after[i]!.title } : {}) },
      })),
    })
    const names = await this.model.read(wsId, (r) =>
      plan.map((p, i) => {
        const props = liveDatabase(r, p.dbId)?.properties ?? []
        const changed = p.ids.filter((k) => JSON.stringify(before[i]!.values[k] ?? null) !== JSON.stringify(after[i]!.values[k] ?? null)).map((k) => props.find((x) => x.id === k)?.name ?? k)
        if (titled(p) && before[i]!.title !== after[i]!.title) changed.unshift('title')
        return changed
      }),
    )
    this.s.log.info('mcp rows updated', { workspace: wsId, rows: plan.length, by: actor })
    return { rows: plan.map((p, i) => ({ id: p.id, changed: names[i]! })) }
  }

  /* ---------------------------------------------------------------- one_upsert_rows (the agents' upsert_rows, ported) */

  async upsertRows(wsId: string, input: UpsertInput, actor: string, rec: Recorder) {
    if (input.rows.length > MCP_LIMITS.rows) throw refuse(413, 'too_large', 'rows', `${input.rows.length} rows (at most ${MCP_LIMITS.rows} per call)`)
    /** `pids`: the properties an update writes (only what differs) — its pre-image and rollback hold just those */
    type Plan = { key: string; action: 'created' | 'updated' | 'unchanged'; id?: string; row: RowItem; changed?: Record<string, unknown>; pids?: string[]; title?: string; body?: string; kept?: boolean; md?: string; locked?: boolean; name?: string }
    const decided = await this.model.read(wsId, (r) => {
      const db = liveDatabase(r, input.databaseId)
      if (!db) throw notFound('database_not_found', `No database with id "${input.databaseId}" in this workspace`)
      assertNotSystem(r, input.databaseId)
      const keyProp = findProperty(db.properties, input.keyProperty)
      const dbKey = keyPropOf(db.properties)
      if (!keyProp) throw refuse(422, 'bad_argument', 'keyProperty', `unknown property ${q(input.keyProperty)}${dbKey ? ` — this database's key is ${q(dbKey.name)}` : ''}`)
      if (!canBeKey(keyProp)) throw refuse(422, 'bad_argument', 'keyProperty', `${q(keyProp.name)} is a ${keyProp.type} property: a key is a text, number or url property`)
      const ctx = this.model.context(wsId, r)
      const holders = keyHolders(r, [], input.databaseId, keyProp)
      const inCall = new Map<string, number>()
      const refused: string[] = []
      const plans: Plan[] = input.rows.map((item, i) => {
        const k = keyText(keyProp.type, item.key)
        const fail = (reason: string): Plan => (refused.push(`rows[${i}] (key ${q(k)}): ${reason}`), { key: k, action: 'unchanged', row: {} })
        if (!k) return fail(`"key" does not fit ${q(keyProp.name)}`)
        if (inCall.has(k)) return fail(`listed twice (rows[${inCall.get(k)}] has it too)`)
        inCall.set(k, i)
        // the key goes in "key"; in "properties" only with the same value
        const props: Record<string, unknown> = {}
        for (const [name, v] of Object.entries(item.properties ?? {})) {
          if (findProperty(db.properties, name)?.id !== keyProp.id) props[name] = v
          else if (keyText(keyProp.type, v) !== k) return fail(`"properties" sets ${q(keyProp.name)} to another value than "key"`)
        }
        const found = holders.get(k) ?? []
        if (found.length > 1) return fail(`${found.length} rows have this key — it does not identify one row`)
        try {
          if (!found.length) {
            const row: RowItem = titledRow(db.properties, { title: item.title?.trim() || k, properties: { ...props, [keyProp.name]: item.key }, markdown: item.markdown })
            this.checkRow(r, db, row, null, ctx)
            return { key: k, action: 'created', row }
          }
          const id = found[0]!.id
          const page = livePage(r, id)!
          const checked = this.checkRow(r, db, { properties: props }, id, ctx)
          // only what differs (stored values compared)
          const changed: Record<string, unknown> = {}
          const pids: string[] = []
          for (const [pid, v] of Object.entries(checked.values)) {
            if (JSON.stringify(page.properties[pid] ?? null) !== JSON.stringify(v ?? null)) {
              const name = db.properties.find((p) => p.id === pid)?.name ?? pid
              changed[name] = props[Object.keys(props).find((n) => findProperty(db.properties, n)?.id === pid) ?? name]
              pids.push(pid)
            }
          }
          const clean = item.title?.trim() ? cleanTitle(item.title, 'title', 'the title') : undefined
          const title = clean && clean !== page.title.trim() ? clean : undefined
          // its text: whether the page is empty is read from its content below (a picture or a divider is no empty page)
          const md = item.markdown?.trim() ? item.markdown : undefined
          const locked = (pageMap(r, id)?.get('settings') as { locked?: unknown } | undefined)?.locked === true
          const extra = { md, locked, name: page.title }
          if (!Object.keys(changed).length && !title) return { key: k, action: 'unchanged', id, row: {}, ...extra }
          return { key: k, action: 'updated', id, row: {}, changed, pids, title, ...extra }
        } catch (err) {
          if (err instanceof ApiError || err instanceof ValueError) return fail(err.message)
          throw err
        }
      })
      if (refused.length) throw refuse(422, 'bad_argument', 'rows', `${refused.length} of ${input.rows.length} rows do not fit: ${refused.join('; ')}`, 'Fix those rows (or leave them out) and send the call again.')
      return { plans, keyName: keyProp.name }
    })
    const { plans, keyName } = decided
    // a found row's markdown is written only while its page is empty — read from its content (every top-level block an
    // empty paragraph, as the bridge reads it), never from `plain` (a picture, a divider or a database has no text, and
    // `plain` lags typing); a locked page takes no text: refused before anything is written (spec § 3.6, as the bridge)
    for (const [i, p] of plans.entries()) {
      if (!p.md || !p.id) continue
      const empty = await this.s.collab.read(contentDoc(wsId, p.id), (doc) => (docJson(doc).content ?? []).every((b) => b.type === 'paragraph' && !(b.content ?? []).length))
      if (!empty) {
        p.kept = true
        continue
      }
      if (p.locked) throw refuse(422, 'locked', `rows[${i}].markdown`, `${q(p.name || 'Untitled')} is locked in One: its content cannot change (its title and values can)`, 'Leave its markdown out, or ask the person to unlock it.')
      p.body = p.md
      if (p.action === 'unchanged') Object.assign(p, { action: 'updated', changed: {}, pids: [] })
    }
    // the rows this call changes: only the fields it writes (and the title when it renames), before — the pre-image and
    // the rollback of a failure on the way; a field the call never wrote is never put back, never named as kept
    const updates = plans.filter((p) => p.action === 'updated')
    const before = await this.rowStates(wsId, updates.map((p) => p.id!), updates.map((p) => p.pids ?? []))
    const made: string[] = []
    /** updates whose values were written (their index in `updates`) and the bodies appended (their snapshot before) */
    const written: number[] = []
    const bodies: Array<{ id: string; snapshot: string; plain: string; hash: string }> = []
    try {
      // 1. the new rows first: the step that can fail on a key someone took meanwhile, before anything else is written
      for (const p of plans) {
        if (p.action !== 'created') continue
        const [row] = await this.insertRows(wsId, input.databaseId, [p.row], actor)
        p.id = row!.id
        made.push(row!.id)
      }
      // 2. the changed values
      for (const [i, p] of updates.entries()) {
        if (!Object.keys(p.changed ?? {}).length && !p.title) continue
        const prepared = await this.writes.prepareRow(wsId, { rowId: p.id! }, { properties: p.changed ?? {} }, actor, MCP_WRITE)
        await this.model.updateRow(wsId, p.id!, { ...(p.title ? { title: p.title } : {}), properties: prepared.properties }, actor, MCP_WRITE)
        written.push(i)
      }
      // 3. the bodies (into empty rows only): each with its pre-image — a restore takes the text back out (spec § 3.6)
      for (const p of updates) {
        if (!p.body) continue
        let pre: { snapshot: string; plain: string } | null = null
        await this.writes.updatePage(wsId, { id: p.id!, markdown: p.body, mode: 'append' }, actor, {
          mcp: true,
          preimageAppend: true,
          preimage: (doc) => (pre = { snapshot: fragmentSnapshot(doc), plain: fragmentText(doc, 20_000) }),
        })
        const got = pre as { snapshot: string; plain: string } | null
        // recorded once the whole call stands (a call taken back keeps no pre-image)
        if (got) bodies.push({ id: p.id!, ...got, hash: await this.s.collab.read(contentDoc(wsId, p.id!), (doc) => textHash(doc)) })
      }
    } catch (err) {
      // all or nothing: the new rows to the trash, the values and the bodies back as they were
      let ok = true
      await this.trash(wsId, made, actor)
      await this.putBack(wsId, written.map((i) => ({ id: updates[i]!.id!, values: before[i]!.values, ...(updates[i]!.title ? { title: before[i]!.title } : {}) })), actor).catch((e: unknown) => {
        ok = false
        this.s.log.error('mcp upsert rollback failed', { workspace: wsId, error: e as Error })
      })
      for (const b of bodies)
        await this.preimages.writeBack(wsId, contentDoc(wsId, b.id), b.id, b.snapshot, actor).catch((e: unknown) => {
          ok = false
          this.s.log.error('mcp upsert body rollback failed', { workspace: wsId, error: e as Error })
        })
      throw ok ? err : partly(err)
    }
    for (const b of bodies) rec.content(b.id, b.snapshot, b.plain, b.hash)
    const createdRows = await this.madeRows(wsId, made)
    const after = await this.rowStates(wsId, updates.map((p) => p.id!), updates.map((p) => p.pids ?? []))
    rec.rows({
      db: input.databaseId,
      created: createdRows,
      updated: updates
        .map((p, i) => ({ id: p.id!, before: { values: before[i]!.values, ...(p.title ? { title: before[i]!.title } : {}) }, after: { values: after[i]!.values, ...(p.title ? { title: after[i]!.title } : {}) } }))
        // a row the call only gave a body to has no field to put back (its text is a content pre-image)
        .filter((u) => Object.keys(u.after.values).length || u.after.title !== undefined),
    })
    this.s.log.info('mcp rows upserted', { workspace: wsId, database: input.databaseId, created: made.length, updated: updates.length, by: actor })
    return {
      databaseId: input.databaseId,
      keyProperty: keyName,
      rows: plans.map((p, index) => ({ index, key: p.key, id: p.id ?? null, action: p.action, ...(p.kept ? { body: 'kept' } : {}) })),
    }
  }

  /* ---------------------------------------------------------------- one_create_page */

  async createPages(wsId: string, input: CreatePagesInput, actor: string, rec: Recorder) {
    if (input.private === true) throw refuse(400, 'local_only', 'private', 'the team server never makes private pages', 'A private page is made by the local bridge (One open in the browser); leave "private" out for a page everyone sees.')
    const batch = input.pages !== undefined
    if (batch) {
      const mixed = (['title', 'markdown', 'icon', 'before', 'after', 'index'] as const).find((k) => input[k] !== undefined && input[k] !== null)
      if (mixed) throw refuse(422, 'bad_argument', mixed, 'with "pages" each page carries its own title, markdown and icon; a batch comes in list order')
      if (input.pages!.length > MCP_LIMITS.pages) throw refuse(413, 'too_large', 'pages', `${input.pages!.length} pages (at most ${MCP_LIMITS.pages} per call)`)
    } else if (!input.title?.trim()) throw refuse(422, 'bad_argument', 'title', 'a page needs a title (or pass "pages")')
    // titles as the bridge takes them (writes.ts cleanTitle): whitespace collapsed, at most MCP_LIMITS.title
    const titleAt = (raw: string, path: string) => (raw.trim() ? cleanTitle(raw, path) : '')
    const items = batch
      ? input.pages!.map((p, i) => ({ title: titleAt(p.title, `pages[${i}].title`), parent: p.parentId?.trim() || input.parentId || null, own: !!p.parentId?.trim(), markdown: p.markdown ?? '', icon: p.icon }))
      : [{ title: titleAt(input.title!, 'title'), parent: input.parentId || null, own: false, markdown: input.markdown ?? '', icon: input.icon }]
    const total = items.reduce((n, p) => n + p.markdown.length, 0)
    if (total > MCP_LIMITS.pagesChars) throw refuse(413, 'too_large', 'pages', `the pages hold ${total.toLocaleString('en')} characters in all (at most ${MCP_LIMITS.pagesChars.toLocaleString('en')})`)
    const link = input.linkInParent ?? 'none'
    const icons = items.map((it, i) => {
      try {
        return iconIn(it.icon)
      } catch (err) {
        atPath(err, batch ? `pages[${i}].icon` : 'icon')
      }
    })
    const ids = items.map(() => newId())
    /** where each page goes: an existing page, or `$n` of the call */
    const parents = items.map((it, i): { kind: 'none' } | { kind: 'page'; id: string } | { kind: 'batch'; index: number } => {
      const path = batch ? (it.own ? `pages[${i}].parentId` : 'parentId') : 'parentId'
      if (!it.title) throw refuse(422, 'bad_argument', batch ? `pages[${i}].title` : 'title', 'a page needs a title')
      if (!it.parent) return { kind: 'none' }
      if (it.parent.startsWith('$')) {
        const n = Number(it.parent.slice(1))
        if (!batch || !/^\$\d{1,2}$/.test(it.parent) || n >= i) throw refuse(422, 'bad_argument', path, `${q(it.parent)} is no earlier page of this list`)
        return { kind: 'batch', index: n }
      }
      return { kind: 'page', id: it.parent }
    })
    const parentIdOf = (i: number): string | null => {
      const p = parents[i]!
      return p.kind === 'page' ? p.id : p.kind === 'batch' ? ids[p.index]! : null
    }
    const check = (r: Roots) => {
      parents.forEach((p, i) => {
        if (p.kind !== 'page') return
        const path = batch ? (items[i]!.own ? `pages[${i}].parentId` : 'parentId') : 'parentId'
        const parent = livePage(r, p.id)
        if (!parent) throw refuse(404, 'not_found', path, `No such parent page in this workspace: no page with id ${q(p.id)} (or it is in the trash)`)
        if (parent.kind === 'database') throw refuse(422, 'bad_argument', path, `${q(titleOf(parent))} is a database: its entries are rows`, 'Add a row with one_create_row.')
        try {
          assertNotSystem(r, p.id)
        } catch (err) {
          atPath(err, path)
        }
        if (link !== 'none' && (pageMap(r, p.id)?.get('settings') as { locked?: unknown } | undefined)?.locked === true)
          throw refuse(422, 'locked', 'linkInParent', `${q(titleOf(parent))} is locked in One: no link can be added to its text`, 'Leave linkInParent out, or ask the person to unlock it.')
      })
      if (link !== 'none' && parents.every((p) => p.kind === 'none')) throw refuse(422, 'bad_argument', 'linkInParent', 'the new pages have no parent to link them in')
    }
    await this.model.read(wsId, check)
    const place = batch ? null : await this.model.read(wsId, (r) => this.placeOf(r, input, parentIdOf(0)))

    // the links: into a page of the call they are part of its text; into an existing page they are appended afterwards
    const linkNode = (i: number): Node => (link === 'block' ? { type: 'pageLink', attrs: { pageId: ids[i]! } } : { type: 'paragraph', content: [{ type: 'mention', attrs: { id: ids[i]!, label: items[i]!.title, kind: 'page' } }] })
    const nodes = items.map((it, i) => {
      const own = it.markdown.trim() ? markdownToNodes(it.markdown) : []
      const kids = link === 'none' ? [] : items.map((_, j) => j).filter((j) => parents[j]!.kind === 'batch' && (parents[j] as { index: number }).index === i)
      return [...own, ...kids.map(linkNode)]
    })
    for (const [i, n] of nodes.entries()) if (n.length) await this.s.collab.write(contentDoc(wsId, ids[i]!), (doc) => appendBlocks(doc, n), actor)
    await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        check(r)
        const at = Date.now()
        // —— changes from here on ——
        items.forEach((it, i) => {
          const parentId = parentIdOf(i)
          const order = place && i === 0 ? place.order(r) : nextOrder(r, parentId)
          r.pages.set(ids[i]!, newPageMap({ id: ids[i]!, title: it.title, icon: icons[i] ?? null, parentId, databaseId: null, order, properties: {}, plain: nodes[i]!.length ? plainText(nodes[i]!) : '', at }, actor))
        })
      },
      actor,
    )
    // each made page with the state of its text now: a Restore leaves one that people wrote into since
    rec.pages(await this.madePages(wsId, items.map((it, i) => ({ id: ids[i]!, title: it.title }))))
    // links into existing parents: one write per parent (its pre-image kept)
    if (link !== 'none') {
      const byParent = new Map<string, number[]>()
      parents.forEach((p, i) => p.kind === 'page' && byParent.set(p.id, [...(byParent.get(p.id) ?? []), i]))
      for (const [parentId, kids] of byParent) {
        let snapshot = ''
        let plainBefore = ''
        const plain = await this.s.collab.write(
          contentDoc(wsId, parentId),
          (doc) => {
            snapshot = fragmentSnapshot(doc)
            plainBefore = fragmentText(doc, 20_000)
            appendBlocks(doc, kids.map(linkNode))
            return fragmentText(doc, 20_000)
          },
          actor,
        )
        const hash = await this.s.collab.read(contentDoc(wsId, parentId), (doc) => textHash(doc))
        // the call put only its own links there: a forced Restore leaves them with the pages it made (they stay)
        rec.content(parentId, snapshot, plainBefore, hash, kids.map((i) => ids[i]!))
        await this.s.collab.write(
          metaDoc(wsId),
          (doc) => {
            const yp = pageMap(roots(doc), parentId)
            if (!yp) return
            yp.set('plain', plain)
            yp.set('updatedAt', Date.now())
            yp.set('updatedBy', actor)
          },
          actor,
        )
      }
    }
    this.s.log.info('mcp pages created', { workspace: wsId, pages: items.length, by: actor })
    if (!batch) return { id: ids[0]!, title: items[0]!.title, url: this.model.url(wsId, ids[0]!), parentId: parentIdOf(0) }
    return { pages: items.map((it, i) => ({ index: i, id: ids[i]!, title: it.title, url: this.model.url(wsId, ids[i]!), parentId: parentIdOf(i) })) }
  }

  /** before / after / index of one new page: the order value the app's movePage gives (tidy.ts movePage). */
  private placeOf(r: Roots, input: CreatePagesInput, parentId: string | null): { order: (r: Roots) => number } | null {
    const anchors = (['before', 'after', 'index'] as const).filter((k) => input[k] !== undefined && input[k] !== null)
    if (!anchors.length) return null
    if (anchors.length > 1) throw refuse(422, 'bad_argument', anchors[1]!, 'pass at most one of "before", "after" and "index"')
    const siblings = (rr: Roots, all: boolean) => {
      const out: PageInfo[] = []
      for (const [id, yp] of rr.pages.entries()) {
        if (!(yp instanceof Y.Map) || ((yp.get('parentId') as string | null) ?? null) !== parentId) continue
        if (all ? yp.get('trashed') === true : !livePage(rr, id) || yp.get('hidden') === true) continue
        out.push(readPage(id, yp as Y.Map<unknown>))
      }
      return out.sort((a, b) => a.order - b.order)
    }
    const anchor = anchors[0]!
    const sibs = siblings(r, false)
    let sibId: string | null = null
    if (anchor === 'before' || anchor === 'after') {
      sibId = String(input[anchor]).trim()
      if (!sibs.some((p) => p.id === sibId)) throw refuse(404, 'not_found', anchor, `${q(sibId)} is no page next to it`, `Siblings: ${sibs.slice(0, 12).map((p) => `${q(titleOf(p))} (${p.id})`).join(', ') || 'none'}.`)
    }
    // computed again in the write (the siblings as they are then)
    return {
      order: (rr) => {
        const now = siblings(rr, false)
        const all = siblings(rr, true)
        const i = sibId ? now.findIndex((p) => p.id === sibId) : -1
        const at = anchor === 'index' ? Math.min(input.index!, now.length) : i < 0 ? now.length : anchor === 'before' ? i : i + 1
        const idx = at >= now.length ? all.length : all.findIndex((p) => p.id === now[at]!.id)
        return !all.length ? 1 : idx <= 0 ? all[0]!.order - 1 : idx >= all.length ? all[all.length - 1]!.order + 1 : (all[idx - 1]!.order + all[idx]!.order) / 2
      },
    }
  }

  /* ---------------------------------------------------------------- one_create_database */

  async createDatabase(wsId: string, input: CreateDatabaseInput, actor: string, rec: Recorder) {
    if (input.parentId && input.inline) throw refuse(422, 'bad_argument', 'inline', "pass parentId (a full-page database) or inline (inside a page's text), not both")
    const hostId = input.inline?.pageId ?? input.parentId ?? null
    const icon = iconIn(input.icon)
    if ((input.rows?.length ?? 0) > MCP_LIMITS.rows) throw refuse(413, 'too_large', 'rows', `${input.rows!.length} rows (at most ${MCP_LIMITS.rows} per call)`)
    // where it goes
    if (input.inline) {
      await this.model.read(wsId, (r) => {
        const page = livePage(r, input.inline!.pageId)
        if (!page) throw refuse(404, 'not_found', 'inline.pageId', `no page with id ${q(input.inline!.pageId)} in this workspace (or it is in the trash)`)
        try {
          assertNotSystem(r, page.id)
        } catch (err) {
          atPath(err, 'inline.pageId')
        }
        if (page.kind === 'database') throw refuse(422, 'bad_argument', 'inline.pageId', `${q(titleOf(page))} is a database: it has no text to hold another one`)
        if ((pageMap(r, page.id)?.get('settings') as { locked?: unknown } | undefined)?.locked === true) throw refuse(422, 'locked', 'inline.pageId', `${q(titleOf(page))} is locked in One: nothing can go into its text`)
      })
    }
    const at = input.inline?.afterBlock ? await this.s.collab.read(contentDoc(wsId, input.inline.pageId), (doc) => blockIndex(doc, input.inline!.afterBlock!)) : null
    // the views a call asks for, shaped on the schema it makes (the same rules in the dry run and the write)
    const notes: string[] = []
    const shape = (r: Roots, defs: PropertyDef[]) => {
      notes.length = 0
      let all = defs
      // the rows' new select options become part of the schema (no option is added to the database afterwards)
      for (const [name, fresh] of freshOptions) {
        all = all.map((p) => (p.name.trim().toLowerCase() === name ? { ...p, options: [...(p.options ?? []), ...fresh.filter((n) => !(p.options ?? []).some((o) => o.name.toLowerCase() === n.toLowerCase())).map((n, i) => ({ id: newId(), name: n, color: COLORS[((p.options ?? []).length + i) % COLORS.length]! }))] } : p))
      }
      if (!input.views?.length) return { defs: all, views: null }
      if (input.views.some((v) => v.type === 'board' && !v.groupBy) && !all.some((p) => GROUPABLE.includes(p.type))) {
        const name = all.some((p) => p.name.toLowerCase() === 'status') ? 'Board status' : 'Status'
        all = [...all, { id: newId(), name, type: 'status', options: MCP_DEFAULT_STATUS.map((o) => ({ id: newId(), ...o })) }]
        notes.push(`A board needs a property to group by: a "${name}" property (status: ${MCP_DEFAULT_STATUS.map((o) => o.name).join(', ')}) was added.`)
      }
      const members = this.model.context(wsId, r).members
      const views: View[] = input.views.map((spec, i) => {
        if (!(MCP_VIEW_TYPES as readonly string[]).includes(spec.type)) throw refuse(422, 'bad_argument', `views[${i}].type`, `one of ${MCP_VIEW_TYPES.join(', ')} is expected`)
        const base = defaultView(spec.type as (typeof MCP_VIEW_TYPES)[number], all)
        if (spec.type === 'board' && !base.groupBy) base.groupBy = all.find((p) => GROUPABLE.includes(p.type))?.id ?? null
        try {
          return { ...base, ...viewChange(r, all, { ...spec, type: undefined }, base, members) }
        } catch (err) {
          atPath(err, `views[${i}]`)
        }
      })
      if (views[0]!.type !== 'table' && !views.some((v) => v.type === 'table')) {
        views.push(defaultView('table', all))
        notes.push(`A table view was added after the ${views[0]!.type} view, so the rows stay editable in a grid.`)
      }
      return { defs: all, views: views as Array<Record<string, unknown>> }
    }
    const dbInput = { title: input.title, parentId: hostId, properties: input.properties, icon, inline: !!input.inline, shape }
    // the rows, checked against the schema the call makes — before anything is written
    const freshOptions = new Map<string, string[]>()
    const draft = await this.writes.draftDatabase(wsId, dbInput)
    if (input.rows?.length) {
      await this.model.read(wsId, (r) => {
        const ctx = this.model.context(wsId, r)
        const db = { page: { id: 'draft' } as PageInfo, ydb: new Y.Map<unknown>(), properties: draft.defs }
        // every row checked: one refusal names each row that does not fit (as the bridge)
        eachRow(input.rows!, (row) => row.title?.trim() || null, (given, i) => {
          const row = (input.rows![i] = titledRow(draft.defs, given))
          for (const [key, raw] of Object.entries(row.properties ?? {})) {
            const prop = findProperty(draft.defs, key)
            if (prop && (prop.type === 'select' || prop.type === 'multi_select')) {
              const known = new Set((prop.options ?? []).map((o) => o.name.toLowerCase()))
              const fresh = optionNames(prop, raw).filter((n) => !known.has(n.toLowerCase()))
              if (fresh.length) freshOptions.set(prop.name.trim().toLowerCase(), [...new Set([...(freshOptions.get(prop.name.trim().toLowerCase()) ?? []), ...fresh])])
            }
          }
          if (!this.checkRow(r, db, row, null, ctx).title?.trim()) throw refuse(422, 'bad_argument', 'title', 'a row needs a title')
        })
      })
    }
    const created = await this.writes.createDatabase(wsId, dbInput, actor)
    // the rows (a failure on the way trashes the database again — and the rows with it)
    let rows: Array<{ id: string; title: string }> = []
    try {
      if (input.rows?.length) rows = await this.insertRows(wsId, created.id, input.rows, actor)
    } catch (err) {
      await this.trash(wsId, [created.id], actor)
      throw err
    }
    // the database as the call left it — after its rows (they may have added select options): a Restore is refused whole
    // once the team changed its properties or views since
    rec.pages(await this.madePages(wsId, [{ id: created.id, title: input.title }]))
    if (rows.length) rec.rows({ db: created.id, created: await this.madeRows(wsId, rows.map((r) => r.id)), updated: [] })
    // the database block in the page's text, last; a failed write trashes the new database again (compensating write)
    let block: string | undefined
    let blockRef: string | null = null
    if (input.inline) {
      const pageId = input.inline.pageId
      try {
        let snapshot = ''
        let plain = ''
        await this.s.collab.write(
          contentDoc(wsId, pageId),
          (doc) => {
            snapshot = fragmentSnapshot(doc)
            plain = fragmentText(doc, 20_000)
            const frag = doc.getXmlFragment('default')
            const el = new Y.XmlElement('databaseBlock')
            block = newId()
            el.setAttribute('id', block)
            el.setAttribute('databaseId', created.id)
            const anchor = at !== null ? findAnchor(frag, at) : -1
            frag.insert(anchor >= 0 ? anchor + 1 : frag.length, [el])
          },
          actor,
        )
        const hash = await this.s.collab.read(contentDoc(wsId, pageId), (doc) => {
          blockRef = refOfId(doc, block!)
          return textHash(doc)
        })
        // the call put only its database block there: a forced Restore leaves it with the database (it stays)
        rec.content(pageId, snapshot, plain, hash, [created.id])
      } catch (err) {
        await this.trash(wsId, [created.id], actor)
        throw err
      }
    }
    this.s.log.info('mcp database created', { workspace: wsId, database: created.id, views: created.views.length, rows: rows.length, inline: !!input.inline, by: actor })
    return {
      ...created,
      parentId: hostId,
      ...(input.inline ? { pageId: input.inline.pageId, block: blockRef ?? `#${block}` } : {}),
      ...(rows.length ? { rows: rows.map((r, index) => ({ index, id: r.id, title: r.title })) } : {}),
      ...(notes.length ? { note: notes.join(' ') } : {}),
    }
  }
}

/** The colours new options take (the app's palette order). */
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const

/**
 * A top-level block by the ref a client passes (`#<id prefix>~<h>` or `@<index>~<h>` from one_get_page) → its index and
 * id. With the content hash `~h` (as reads hand refs out) the block must still hold what was read — a block changed since
 * is `stale_ref` with the ref it has now; without one the block found is the block, whatever it holds.
 */
function blockIndex(doc: Y.Doc, raw: string): { index: number; id: string | null } {
  const ref = parseRef(raw)
  if (!ref) throw refuse(422, 'bad_argument', 'inline.afterBlock', `${q(raw.slice(0, 60))} is no block ref ("#<id>~<hash>" or "@<index>" from one_get_page)`)
  const kids = doc.getXmlFragment('default').toArray()
  // the blocks as a read sees them (its paths count elements; their hashes are the read's)
  const json = docJson(doc)
  const els = kids.flatMap((k, i) => (k instanceof Y.XmlElement ? [{ i, el: k }] : []))
  const found = (e: number): { index: number; id: string | null } => {
    const node = json.content?.[e]
    if (ref.hash && node && blockHash(node) !== ref.hash)
      throw refuse(409, 'stale_ref', 'inline.afterBlock', `${q(raw)} changed since the read (it is ${refIndex(json).refOf(node, [e])} now)`, 'Read the page again (one_get_page { format: "blocks" }) and pass the block\'s ref from there.')
    return { index: els[e]!.i, id: (els[e]!.el.getAttribute('id') as string | undefined) ?? null }
  }
  // a block inside another one (a column, a toggle, a list): the database goes after its top-level block — say which
  const nested = (): void => {
    const top = nestedTopLevel(json, ref)
    if (top === null) return
    const outer = refIndex(json).refOf(json.content![top]!, [top])
    throw refuse(422, 'bad_argument', 'inline.afterBlock', `${q(raw)} is a block inside another one (${outer}): a database goes between top-level blocks`, `Pass the ref of its top-level block, ${outer}, to place it after that whole block.`)
  }
  if (ref.kind === 'path') {
    if (ref.path.length !== 1 || ref.path[0]! >= els.length) {
      nested()
      throw refuse(409, 'stale_ref', 'inline.afterBlock', `${q(raw)} is no top-level block of the page now`)
    }
    return found(ref.path[0]!)
  }
  const hits = els.flatMap((x, e) => (String(x.el.getAttribute('id') ?? '').startsWith(ref.prefix) && x.el.getAttribute('id') ? [e] : []))
  if (!hits.length) nested()
  if (hits.length !== 1) throw refuse(409, 'stale_ref', 'inline.afterBlock', hits.length ? `${q(raw)} fits ${hits.length} blocks` : `no top-level block has the id ${q(ref.prefix)} now`)
  return found(hits[0]!)
}

/** The ref of the block with this id in a content document now (a full ref, as a read hands it out). */
function refOfId(doc: Y.Doc, id: string): string | null {
  const json = docJson(doc)
  const e = (json.content ?? []).findIndex((n) => n.attrs?.id === id)
  return e >= 0 ? refIndex(json).refOf(json.content![e]!, [e]) : null
}

/** The block a database goes after, found again in the write (by its id; else the index read before). */
function findAnchor(frag: Y.XmlFragment, at: { index: number; id: string | null }): number {
  const kids = frag.toArray()
  if (at.id) {
    const i = kids.findIndex((k) => k instanceof Y.XmlElement && k.getAttribute('id') === at.id)
    if (i >= 0) return i
  }
  return Math.min(at.index, kids.length - 1)
}

