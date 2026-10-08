/**
 * The MCP tidy-up tools for pages on the team server (docs/MCP.md): the trash (one or many, a
 * database with its rows), restoring from it, moving pages and databases in the tree, moving a row
 * into another database. The same rules and messages as the local bridge (src/app/features/mcp/tidy.ts):
 * validated against the meta document first (nothing written when anything doesn't fit), then one
 * transaction. Never deletes for good. Private pages are not in the meta document; templates and the
 * trash are "not found" like everywhere in the API.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { notFound } from '../errors.ts'
import { type PageInfo, type PropertyDef, type Roots, type SelectOption, clone, inTemplate, inTrash, liveDatabase, livePage, nextOrder, pageMap, pairedRelation, propertiesMap, readPage, roots, rowsOf } from '../api/meta.ts'
import { isHandOnly, keyOwner, keyPropOf, keyText } from '../api/keys.ts'
import { metaDoc, type WorkspaceModel } from '../api/model.ts'
import { newId } from '../tokens.ts'
import { pathOf } from './reads.ts'
import { COLORS, propsMapOf, unprocessable } from './writes.ts'

/** Most ids one call trashes or restores (MCP_BULK_MAX of the local bridge). */
export const BULK_MAX = 50

const q = (s: string) => JSON.stringify(s)
const titleOf = (p: { title: string } | null | undefined) => p?.title.trim() || 'Untitled'
const kindOf = (p: PageInfo): 'page' | 'row' | 'database' => (p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page')
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
const parentOf = (r: Roots, id: string): string | null => {
  const v = pageMap(r, id)?.get('parentId')
  return typeof v === 'string' && v ? v : null
}

/** Is `id` the page `ancestor` or somewhere below it? (cycle-safe) */
function within(r: Roots, id: string, ancestor: string): boolean {
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true
    seen.add(cur)
    cur = parentOf(r, cur)
  }
  return false
}

/** Pages below `id` that are not in the trash themselves (sub-pages, rows …). */
function liveBelow(r: Roots, id: string): number {
  const byParent = new Map<string, string[]>()
  for (const [pid, yp] of r.pages.entries()) {
    if (!(yp instanceof Y.Map) || yp.get('trashed') === true) continue
    const parent = yp.get('parentId')
    if (typeof parent === 'string' && parent) byParent.set(parent, [...(byParent.get(parent) ?? []), pid])
  }
  const seen = new Set<string>([id])
  const stack = [id]
  let n = 0
  while (stack.length) {
    for (const kid of byParent.get(stack.pop()!) ?? []) {
      if (seen.has(kid)) continue
      seen.add(kid)
      n++
      stack.push(kid)
    }
  }
  return n
}

/** `id` or `ids` (deduplicated) — exactly one of them. */
export function idsOf(input: { id?: string; ids?: string[] }): { ids: string[]; single: boolean } {
  if (input.id !== undefined && input.ids !== undefined) throw unprocessable('invalid_request', 'Pass "id" or "ids", not both.')
  if (input.ids !== undefined) {
    if (!input.ids.length) throw unprocessable('invalid_request', '"ids" must be a list of page ids.')
    if (input.ids.length > BULK_MAX) throw unprocessable('invalid_request', `At most ${BULK_MAX} ids in one call (got ${input.ids.length}).`)
    return { ids: [...new Set(input.ids.map((x) => x.trim()))], single: false }
  }
  if (!input.id?.trim()) throw unprocessable('invalid_request', 'Missing required parameter "id".')
  return { ids: [input.id.trim()], single: true }
}

/** The most recently trashed items (not inside another trashed one), for "nothing in the trash has id …". */
function recentTrash(r: Roots): string {
  const items: PageInfo[] = []
  for (const [id, yp] of r.pages.entries()) {
    if (!(yp instanceof Y.Map) || yp.get('trashed') !== true || inTemplate(r, id)) continue
    const parent = parentOf(r, id)
    if (parent && pageMap(r, parent) && inTrash(r, parent)) continue
    items.push(readPage(id, yp as Y.Map<unknown>))
  }
  const at = (p: PageInfo) => Number(pageMap(r, p.id)?.get('trashedAt')) || 0
  items.sort((a, b) => at(b) - at(a))
  return items.length ? ` Recently trashed: ${items.slice(0, 8).map((p) => `${q(titleOf(p))} (${p.id}, ${kindOf(p)})`).join(', ')}.` : ' The trash is empty.'
}

/** Never carried over by a row move: the title (moves as the title) and computed values. */
const COMPUTED = new Set(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)

export class McpTidy {
  private readonly s: Services
  private readonly model: WorkspaceModel

  constructor(s: Services, model: WorkspaceModel) {
    this.s = s
    this.model = model
  }

  /* ---------------------------------------------------------------- trash */

  async trash(wsId: string, input: { id?: string; ids?: string[] }, actor: string) {
    const { ids, single } = idsOf(input)
    const plan = (r: Roots) => {
      const problems: string[] = []
      const found: PageInfo[] = []
      for (const id of ids) {
        const p = livePage(r, id)
        if (p) found.push(p)
        else problems.push(pageMap(r, id) && !inTemplate(r, id) ? `${q(titleOf(readPage(id, pageMap(r, id)!)))} (${id}) is already in the trash` : `no page with id ${q(id)}`)
      }
      if (problems.length) throw notFound('page_not_found', `Nothing was moved to the trash: ${problems.join('; ')}. Use one_search to find page ids.`)
      // a listed page below another listed one goes along with it
      return found
        .filter((p) => !found.some((o) => o.id !== p.id && within(r, p.id, o.id)))
        .map((page) => ({ page, below: liveBelow(r, page.id), ...(page.kind === 'database' ? { rows: rowsOf(r, page.id).length } : {}) }))
    }
    await this.model.read(wsId, plan)
    const items = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const items = plan(r)
        const at = Date.now()
        // —— changes from here on ——
        for (const { page } of items) {
          const yp = pageMap(r, page.id)!
          yp.set('trashed', true)
          yp.set('trashedAt', at)
          yp.set('updatedBy', actor)
        }
        return items
      },
      actor,
    )
    this.s.log.info('mcp pages trashed', { workspace: wsId, pages: items.map((x) => x.page.id), by: actor })
    const out = (x: (typeof items)[number]) => ({ id: x.page.id, title: x.page.title, kind: kindOf(x.page), ...(x.rows !== undefined ? { rows: x.rows } : {}), alsoTrashed: x.below })
    const note = 'Moved to the trash (nothing is deleted for good): one_restore_page or the trash in the app brings it back.'
    return single ? { ...out(items[0]!), trashed: true, note } : { trashed: items.map(out), count: items.length, alsoTrashed: items.reduce((n, x) => n + x.below, 0), note }
  }

  async restore(wsId: string, input: { id?: string; ids?: string[] }, actor: string) {
    const { ids, single } = idsOf(input)
    const plan = (r: Roots) => {
      const problems: string[] = []
      const items: Array<{ page: PageInfo; top: boolean; rows?: number }> = []
      for (const id of ids) {
        const yp = pageMap(r, id)
        if (!yp || inTemplate(r, id)) {
          problems.push(`nothing in the trash has id ${q(id)}`)
          continue
        }
        const p = readPage(id, yp)
        if (!p.trashed) {
          if (livePage(r, id)) {
            problems.push(`${q(titleOf(p))} (${id}) is not in the trash`)
            continue
          }
          let cur = parentOf(r, id)
          while (cur && pageMap(r, cur)?.get('trashed') !== true) cur = parentOf(r, cur)
          const anc = cur ? readPage(cur, pageMap(r, cur)!) : null
          problems.push(`${q(titleOf(p))} is inside ${anc ? `${q(titleOf(anc))} (${anc.id}), which is in the trash — restore that instead` : 'something in the trash'}`)
          continue
        }
        if (p.databaseId && !liveDatabase(r, p.databaseId)) {
          const db = pageMap(r, p.databaseId)
          problems.push(`${q(titleOf(p))} is a row of ${q(titleOf(db ? readPage(p.databaseId, db) : null))} (${p.databaseId}), which is in the trash — restore the database first`)
          continue
        }
        const top = !!p.parentId && !p.databaseId && (!pageMap(r, p.parentId) || inTrash(r, p.parentId))
        items.push({ page: p, top, ...(p.kind === 'database' ? { rows: rowsOf(r, p.id).length } : {}) })
      }
      if (problems.length) throw notFound('page_not_found', `Nothing was restored: ${problems.join('; ')}.${recentTrash(r)}`)
      return items
    }
    await this.model.read(wsId, plan)
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const items = plan(r)
        // —— changes from here on ——
        for (const { page, top } of items) {
          const yp = pageMap(r, page.id)!
          yp.set('trashed', false)
          yp.set('trashedAt', null)
          // its parent is gone or in the trash: back at the top level (the app's restorePage)
          if (top) yp.set('parentId', null)
          yp.set('updatedAt', Date.now())
          yp.set('updatedBy', actor)
        }
        return items.map(({ page, top, rows }) => ({
          id: page.id,
          title: page.title,
          kind: kindOf(page),
          restored: true,
          parentId: top ? null : page.parentId,
          path: top || !page.parentId ? '' : pathOf(r, page.parentId),
          url: this.model.url(wsId, page.id),
          ...(rows !== undefined ? { rows } : {}),
        }))
      },
      actor,
    )
    this.s.log.info('mcp pages restored', { workspace: wsId, pages: out.map((x) => x.id), by: actor })
    return single ? out[0]! : { restored: out, count: out.length }
  }

  /* ---------------------------------------------------------------- move a page */

  async movePage(wsId: string, input: { id: string; parentId?: string | null; before?: string; after?: string; index?: number }, actor: string) {
    const anchors = (['before', 'after', 'index'] as const).filter((k) => input[k] !== undefined && input[k] !== null)
    if (anchors.length > 1) throw unprocessable('invalid_request', 'Pass at most one of "before", "after" and "index".')
    const plan = (r: Roots) => {
      const page = livePage(r, input.id)
      if (!page) throw notFound('page_not_found', `No page with id ${q(input.id)} in this workspace (or it is in the trash). Use one_search to find page ids.`)
      const name = titleOf(page)
      if (page.databaseId) throw unprocessable('page_is_row', `${q(name)} is a row of ${q(titleOf(liveDatabase(r, page.databaseId)?.page))}: rows stay in their database. one_move_row moves it into another database.`)
      let parentId = page.parentId
      if (input.parentId === null || input.parentId === '') parentId = null
      else if (input.parentId !== undefined) {
        const target = livePage(r, input.parentId)
        if (!target) throw notFound('parent_not_found', `No page with id ${q(input.parentId)} in this workspace (or it is in the trash). Use one_search to find page ids.`)
        if (target.id === page.id || within(r, target.id, page.id))
          throw unprocessable('move_cycle', `${q(titleOf(target))} is ${target.id === page.id ? q(name) : `inside ${q(name)}`}: a page cannot move into itself or its own sub-pages.`)
        if (target.kind === 'database')
          throw unprocessable('move_into_database', `${q(titleOf(target))} is a database: a page moved there would become one of its rows, which is not done over MCP. Use one_create_row for new rows, or ask the person to drop the page on the database in the app.`)
        parentId = target.id
      }
      // siblings as people see them (no hidden pages, nothing in the trash or a template)
      const siblings = (all: boolean) => {
        const out: PageInfo[] = []
        for (const [id, yp] of r.pages.entries()) {
          if (!(yp instanceof Y.Map) || id === page.id || parentOf(r, id) !== parentId) continue
          if (all ? yp.get('trashed') === true : !livePage(r, id) || yp.get('hidden') === true) continue
          out.push(readPage(id, yp as Y.Map<unknown>))
        }
        return out.sort((a, b) => a.order - b.order)
      }
      const sibs = siblings(false)
      let at: number | undefined
      const anchor = anchors[0]
      if (anchor === 'before' || anchor === 'after') {
        const sibId = String(input[anchor]).trim()
        const i = sibs.findIndex((p) => p.id === sibId)
        if (i < 0)
          throw unprocessable(
            'invalid_request',
            `"${anchor}": ${q(sibId)} is not a page next to it under ${parentId ? q(titleOf(livePage(r, parentId))) : 'the top level'}. Siblings: ${sibs.slice(0, 12).map((p) => `${q(titleOf(p))} (${p.id})`).join(', ') || 'none'}.`,
          )
        at = anchor === 'before' ? i : i + 1
      } else if (anchor === 'index') at = Math.min(input.index!, sibs.length)
      if (parentId === page.parentId && at === undefined) return { page, parentId, noop: true as const, order: page.order }
      // the order value the app's movePage would give (orderAt over every sibling not in the trash)
      const all = siblings(true)
      let order: number
      if (at === undefined) order = nextOrder(r, parentId)
      else {
        const idx = at >= sibs.length ? all.length : all.findIndex((p) => p.id === sibs[at!]!.id)
        order = !all.length ? 1 : idx <= 0 ? all[0]!.order - 1 : idx >= all.length ? all[all.length - 1]!.order + 1 : (all[idx - 1]!.order + all[idx]!.order) / 2
      }
      return { page, parentId, noop: false as const, order }
    }
    const checked = await this.model.read(wsId, plan)
    if (checked.noop)
      return { id: checked.page.id, title: checked.page.title, parentId: checked.parentId, note: 'No change: it is there already. Pass "before", "after" or "index" to reorder it.' }
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const { page, parentId, order } = plan(r)
        // —— changes from here on ——
        const yp = pageMap(r, page.id)!
        yp.set('parentId', parentId)
        yp.set('order', order)
        yp.set('updatedAt', Date.now())
        yp.set('updatedBy', actor)
        const index: string[] = []
        for (const [id, y] of r.pages.entries()) if (y instanceof Y.Map && parentOf(r, id) === parentId && livePage(r, id) && y.get('hidden') !== true) index.push(id)
        index.sort((a, b) => Number(pageMap(r, a)!.get('order')) - Number(pageMap(r, b)!.get('order')))
        return { id: page.id, title: page.title, kind: kindOf(page), parentId, path: parentId ? pathOf(r, parentId) : '', index: index.indexOf(page.id), url: this.model.url(wsId, page.id) }
      },
      actor,
    )
    this.s.log.info('mcp page moved', { workspace: wsId, page: input.id, parent: out.parentId, by: actor })
    return out
  }

  /* ---------------------------------------------------------------- move a row */

  async moveRow(wsId: string, input: { id: string; databaseId: string }, actor: string) {
    const plan = (r: Roots) => {
      const row = livePage(r, input.id)
      if (!row) throw notFound('page_not_found', `No page with id ${q(input.id)} in this workspace (or it is in the trash). Use one_search to find page ids.`)
      const name = titleOf(row)
      if (!row.databaseId) throw unprocessable('not_a_row', `${q(name)} is a ${kindOf(row)}, not a database row. one_move_page moves pages and databases.`)
      const from = liveDatabase(r, row.databaseId)
      const to = liveDatabase(r, input.databaseId)
      if (!from || !to) throw notFound('database_not_found', `No database with id ${q(from ? input.databaseId : row.databaseId)} in this workspace. Use one_list_databases to get database ids.`)
      const fromTitle = titleOf(from.page)
      const toTitle = titleOf(to.page)
      if (to.page.id === from.page.id) return { row, from, to, noop: true as const }
      const problems: string[] = []
      const values: Record<string, unknown> = {}
      const fresh = new Map<string, SelectOption[]>()
      const carried: string[] = []
      for (const sp of from.properties) {
        const v = row.properties[sp.id]
        if (COMPUTED.has(sp.type) || isEmpty(v)) continue
        const tp = to.properties.find((p) => norm(p.name) === norm(sp.name))
        if (!tp) {
          problems.push(`${q(sp.name)} (${sp.type}): ${q(toTitle)} has no property of that name`)
          continue
        }
        if (tp.type !== sp.type) {
          problems.push(`${q(sp.name)} is ${sp.type} here but ${tp.type} in ${q(toTitle)}`)
          continue
        }
        if (sp.type === 'select' || sp.type === 'status' || sp.type === 'multi_select') {
          const mapped: string[] = []
          for (const oid of Array.isArray(v) ? v : [v]) {
            const opt = sp.options?.find((o) => o.id === oid)
            if (!opt) continue
            const known = [...(tp.options ?? []), ...(fresh.get(tp.id) ?? [])].find((o) => norm(o.name) === norm(opt.name))
            if (known) mapped.push(known.id)
            else if (sp.type === 'status') problems.push(`${q(sp.name)}: ${q(toTitle)} has no status ${q(opt.name)} (it has ${(tp.options ?? []).map((o) => q(o.name)).join(', ')})`)
            else if (to.ydb.get('locked') === true) problems.push(`${q(sp.name)}: ${q(toTitle)} is locked, so the option ${q(opt.name)} cannot be added there`)
            else {
              const made: SelectOption = { id: newId(), name: opt.name, color: opt.color ?? COLORS[(tp.options?.length ?? 0) % COLORS.length]! }
              fresh.set(tp.id, [...(fresh.get(tp.id) ?? []), made])
              mapped.push(made.id)
            }
          }
          if (mapped.length) values[tp.id] = sp.type === 'multi_select' ? mapped : mapped[0]
        } else if (sp.type === 'relation') {
          if (tp.relationDatabaseId !== sp.relationDatabaseId) problems.push(`${q(sp.name)}: the relations point to different databases`)
          else if (pairedRelation(r, from.page.id, sp) || pairedRelation(r, to.page.id, tp)) problems.push(`${q(sp.name)} is a two-way relation: its links would not follow the row`)
          else values[tp.id] = clone(v)
        } else values[tp.id] = clone(v)
        // "Only by hand" there: an MCP client never writes it (api/keys.ts)
        if (tp.id in values && isHandOnly(tp)) {
          problems.push(`${q(sp.name)} is filled in only by hand in ${q(toTitle)}: an MCP client does not write it`)
          delete values[tp.id]
        }
        if (tp.id in values) carried.push(sp.name)
      }
      // the target's key stays unique per row
      const key = keyPropOf(to.properties)
      const owner = key && key.id in values ? keyOwner(r, to.page.id, key, values[key.id], row.id) : null
      if (key && owner) problems.push(`${q(key.name)} is the key of ${q(toTitle)} — unique per row — and ${q(titleOf(owner))} has ${q(keyText(key.type, values[key.id]))} there already`)
      // rows that link to it would lose it
      const links: string[] = []
      for (const dbId of r.databases.keys()) {
        const db = liveDatabase(r, dbId)
        const rels = db?.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId === from.page.id) ?? []
        if (!db || !rels.length) continue
        for (const other of rowsOf(r, dbId)) {
          if (other.id === row.id) continue
          const prop = rels.find((p) => Array.isArray(other.properties[p.id]) && (other.properties[p.id] as unknown[]).includes(row.id))
          if (prop) links.push(`${q(titleOf(other))} in ${q(titleOf(db.page))} (${q(prop.name)})`)
        }
      }
      if (links.length) problems.push(`other rows link to it: ${links.slice(0, 5).join(', ')}${links.length > 5 ? ` and ${links.length - 5} more` : ''}`)
      if (problems.length)
        throw unprocessable(
          'row_does_not_fit',
          `${q(name)} cannot move from ${q(fromTitle)} to ${q(toTitle)} without losing something, so nothing was changed: ${problems.join('; ')}. A row moves only when every value it has fits a property of the same name and type there. Add or rename properties first (one_create_property, one_update_property), or ask the person.`,
        )
      return { row, from, to, noop: false as const, values, fresh, carried }
    }
    const checked = await this.model.read(wsId, plan)
    if (checked.noop) return { id: checked.row.id, title: checked.row.title, databaseId: checked.to.page.id, note: `No change: the row is in ${q(titleOf(checked.to.page))} already.` }
    const out = await this.s.collab.write(
      metaDoc(wsId),
      (doc) => {
        const r = roots(doc)
        const p = plan(r)
        if (p.noop) return null
        const { row, from, to, fresh } = p
        const values = { ...p.values }
        // —— changes from here on ——
        const pm = propsMapOf(to.ydb)
        for (const [propId, opts] of fresh) {
          const def = pm.get(propId) as (PropertyDef & { order?: number }) | undefined
          if (def) pm.set(propId, clone({ ...def, options: [...(def.options ?? []), ...opts] }))
        }
        // unique ids: numbered in the new database, like a new row
        const uid = to.properties.filter((x) => x.type === 'unique_id')
        if (uid.length) {
          const counter = to.ydb.get('nextUniqueId')
          const next = typeof counter === 'number' && Number.isFinite(counter) ? counter : 1
          for (const x of uid) values[x.id] = next
          to.ydb.set('nextUniqueId', next + 1)
        }
        const yp = pageMap(r, row.id)!
        const props = propertiesMap(yp)
        for (const k of [...props.keys()]) props.delete(k)
        for (const [k, v] of Object.entries(values)) props.set(k, clone(v))
        yp.set('order', nextOrder(r, to.page.id))
        yp.set('databaseId', to.page.id)
        yp.set('parentId', to.page.id)
        yp.set('updatedAt', Date.now())
        yp.set('updatedBy', actor)
        const ctx = this.model.context(wsId, r)
        const moved = readPage(row.id, yp)
        const added = [...fresh.values()].flat().map((o) => o.name)
        return {
          ...this.model.rowOut(wsId, liveDatabase(r, to.page.id)!.properties, moved, ctx),
          from: { id: from.page.id, title: titleOf(from.page) },
          database: titleOf(to.page),
          ...(added.length ? { addedOptions: added } : {}),
        }
      },
      actor,
    )
    if (!out) return { id: input.id, databaseId: input.databaseId, note: 'No change: the row is there already.' }
    this.s.log.info('mcp row moved', { workspace: wsId, row: input.id, database: input.databaseId, by: actor })
    return out
  }
}
