/**
 * One MCP — tidying up pages: the trash (one or many, a database with its rows), restoring from
 * it, moving pages and databases in the tree, moving a row into another database. Planned first
 * (nothing written; a card line per fact), applied after approval, undone from the agent log.
 *
 * Page ⇄ database entry conversions (the sidebar's drops, shell/sidebar/entries.ts) are not offered:
 * they ask the person on the way. Moving between Private and the workspace (team) is refused too.
 */
import { t } from '../../i18n'
import { inTemplate } from '../../store/selectors'
import type { Database, ID, Page, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { newId } from '../../lib/ids'
import { MCP_BULK_MAX, type McpToolName } from './contract'
import { chars, clone, idList, itemLines, palette, same, str, tidyPageOrThrow, type PlanLine, type WritePlan } from './plan'
import { databaseOrThrow, kindOf, live, McpToolError, pageUrl, pathOf, q, rowProperties, rowsOf, titleOf, TWO_WAY_SUFFIX, ws } from './values'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Is `id` the page `ancestor` or somewhere below it? (cycle-safe) */
function within(pages: Record<ID, Page>, id: ID, ancestor: ID): boolean {
  const seen = new Set<ID>()
  let cur: ID | null = id
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true
    seen.add(cur)
    cur = pages[cur]?.parentId ?? null
  }
  return false
}

/** Pages below `id` that are not in the trash themselves (sub-pages, rows of databases …). */
function liveBelow(id: ID): number {
  const pages = Object.values(ws().pages)
  const seen = new Set<ID>([id])
  const stack = [id]
  let n = 0
  while (stack.length) {
    const cur = stack.pop()!
    for (const p of pages)
      if (p.parentId === cur && !p.trashed && !seen.has(p.id)) {
        seen.add(p.id)
        n++
        stack.push(p.id)
      }
  }
  return n
}

const kindLabel = (p: Page) => t(`features.mcp.kind.${kindOf(p)}`)
const rowsLabel = (n: number) => t(n === 1 ? 'features.mcp.plan.rowsN.one' : 'features.mcp.plan.rowsN.other', { n: chars(n) })
const where = (parentId: ID | null) => (parentId ? [pathOf(parentId), titleOf(ws().pages[parentId])].filter(Boolean).join(' / ') : t('features.mcp.plan.topLevel'))

/** The most recently trashed items (not below another trashed one), for "nothing in the trash has id …". */
function recentTrash(): string {
  const { pages } = ws()
  const items = Object.values(pages)
    .filter((p) => p.trashed && !inTemplate(pages, p.id) && !(p.parentId && pages[p.parentId] && !live(p.parentId)))
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    .slice(0, 8)
  return items.length ? ` Recently trashed: ${items.map((p) => `${q(titleOf(p))} (${p.id}, ${kindOf(p)})`).join(', ')}.` : ' The trash is empty.'
}

/* ------------------------------------------------------------------ */
/* one_trash_page                                                      */
/* ------------------------------------------------------------------ */

interface TrashItem {
  page: Page
  /** live rows of a database */
  rows?: number
  /** pages below it that go along */
  below: number
}

function planTrash(args: Record<string, unknown>): WritePlan {
  const ids = idList(args, MCP_BULK_MAX)
  const { pages } = ws()
  const problems: string[] = []
  const found: Page[] = []
  for (const id of ids) {
    const p = live(id)
    if (p && !inTemplate(pages, id)) found.push(p)
    else problems.push(pages[id] && !inTemplate(pages, id) ? `${q(titleOf(pages[id]))} (${id}) is already in the trash` : `no page with id ${q(id)}`)
  }
  if (problems.length) throw new McpToolError(`Nothing was moved to the trash: ${problems.join('; ')}. Use one_search to find page ids.`)
  // a listed page below another listed one goes along with it
  const items: TrashItem[] = found
    .filter((p) => !found.some((o) => o.id !== p.id && within(pages, p.id, o.id)))
    .map((page) => ({ page, below: liveBelow(page.id), ...(page.kind === 'database' ? { rows: rowsOf(page.id).length } : {}) }))
  const single = !Array.isArray(args.ids)
  const total = items.reduce((n, x) => n + x.below, 0)
  const lines: PlanLine[] = []
  let summary: string
  if (single) {
    const { page, rows, below } = items[0]
    summary =
      rows !== undefined
        ? t(rows === 1 ? 'features.mcp.sum.trashDb.one' : 'features.mcp.sum.trashDb.other', { title: titleOf(page), n: chars(rows) })
        : t('features.mcp.sum.trash', { title: titleOf(page) })
    lines.push({ k: 'fact', label: t('features.mcp.plan.kind'), value: kindLabel(page) })
    if (pathOf(page.id)) lines.push({ k: 'fact', label: t('features.mcp.plan.in'), value: pathOf(page.id) })
    if (rows !== undefined) lines.push({ k: 'fact', label: t('features.mcp.plan.rows'), value: rowsLabel(rows) })
    const others = below - (rows ?? 0)
    if (others > 0) lines.push({ k: 'fact', label: t('features.mcp.plan.below'), value: t('features.mcp.plan.belowN', { n: chars(others) }) })
  } else {
    summary = t('features.mcp.sum.trashMany', { n: chars(items.length) })
    lines.push(...itemLines(items.map((x) => ({ label: kindLabel(x.page), value: `${titleOf(x.page)}${x.rows !== undefined ? ` · ${rowsLabel(x.rows)}` : ''}` }))))
    if (total) lines.push({ k: 'fact', label: t('features.mcp.plan.below'), value: t('features.mcp.plan.belowN', { n: chars(total) }) })
  }
  lines.push({ k: 'note', value: t('features.mcp.plan.trashNote') })
  const out = (x: TrashItem) => ({ id: x.page.id, title: x.page.title, kind: kindOf(x.page), ...(x.rows !== undefined ? { rows: x.rows } : {}), alsoTrashed: x.below })
  return {
    tool: 'one_trash_page',
    verb: t('features.mcp.verb.trash'),
    summary,
    target: single ? titleOf(items[0].page) : summary,
    lines,
    async apply() {
      const gone = items.filter((x) => !live(x.page.id))
      if (gone.length) throw new McpToolError(`${gone.map((x) => q(titleOf(x.page))).join(', ')} is gone by now. Nothing was changed.`)
      for (const x of items) ws().trashPage(x.page.id)
      const note = 'Moved to the trash (nothing is deleted for good): one_restore_page or the trash in One brings it back.'
      return {
        result: single ? { ...out(items[0]), trashed: true, note } : { trashed: items.map(out), count: items.length, alsoTrashed: total, note },
        undo: () => {
          let clean = true
          for (const x of items) {
            if (ws().pages[x.page.id]?.trashed) ws().restorePage(x.page.id)
            else clean = false
          }
          return clean
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_restore_page                                                    */
/* ------------------------------------------------------------------ */

function planRestore(args: Record<string, unknown>): WritePlan {
  const ids = idList(args, MCP_BULK_MAX)
  const { pages } = ws()
  const problems: string[] = []
  const items: Array<{ page: Page; top: boolean; rows?: number }> = []
  for (const id of ids) {
    const p = pages[id]
    if (!p || inTemplate(pages, id)) {
      problems.push(`nothing in the trash has id ${q(id)}`)
      continue
    }
    if (!p.trashed) {
      if (live(id)) {
        problems.push(`${q(titleOf(p))} (${id}) is not in the trash`)
        continue
      }
      // inside a trashed page: that one comes back (with everything in it)
      let cur = p.parentId ? pages[p.parentId] : undefined
      while (cur && !cur.trashed) cur = cur.parentId ? pages[cur.parentId] : undefined
      problems.push(`${q(titleOf(p))} is inside ${cur ? `${q(titleOf(cur))} (${cur.id}), which is in the trash — restore that instead` : 'something in the trash'}`)
      continue
    }
    if (p.databaseId && !live(p.databaseId)) {
      problems.push(`${q(titleOf(p))} is a row of ${q(titleOf(pages[p.databaseId]))} (${p.databaseId}), which is in the trash — restore the database first`)
      continue
    }
    const top = !!p.parentId && !p.databaseId && !live(p.parentId)
    items.push({ page: p, top, ...(p.kind === 'database' ? { rows: Object.values(pages).filter((r) => r.databaseId === p.id && !r.trashed).length } : {}) })
  }
  if (problems.length) throw new McpToolError(`Nothing was restored: ${problems.join('; ')}.${recentTrash()}`)
  const single = !Array.isArray(args.ids)
  const lines: PlanLine[] = []
  let summary: string
  if (single) {
    const { page, top, rows } = items[0]
    summary =
      rows !== undefined
        ? t(rows === 1 ? 'features.mcp.sum.restoreDb.one' : 'features.mcp.sum.restoreDb.other', { title: titleOf(page), n: chars(rows) })
        : t('features.mcp.sum.restore', { title: titleOf(page) })
    lines.push({ k: 'fact', label: t('features.mcp.plan.kind'), value: kindLabel(page) })
    lines.push({ k: 'fact', label: t('features.mcp.plan.backIn'), value: where(top ? null : page.parentId) })
    if (top) lines.push({ k: 'note', value: t('features.mcp.plan.restoreTop') })
  } else {
    summary = t('features.mcp.sum.restoreMany', { n: chars(items.length) })
    lines.push(...itemLines(items.map((x) => ({ label: kindLabel(x.page), value: `${titleOf(x.page)}${x.rows !== undefined ? ` · ${rowsLabel(x.rows)}` : ''}` }))))
  }
  const out = (id: ID) => {
    const p = ws().pages[id]
    const it = items.find((x) => x.page.id === id)!
    return { id, title: p?.title ?? it.page.title, kind: kindOf(it.page), restored: true, parentId: p?.parentId ?? null, path: pathOf(id), url: pageUrl(id), ...(it.rows !== undefined ? { rows: it.rows } : {}) }
  }
  return {
    tool: 'one_restore_page',
    verb: t('features.mcp.verb.restore'),
    summary,
    target: single ? titleOf(items[0].page) : summary,
    lines,
    async apply() {
      const before = items.map((x) => ({ id: x.page.id, parentId: ws().pages[x.page.id]?.parentId ?? null }))
      const moved = items.filter((x) => !ws().pages[x.page.id]?.trashed)
      if (moved.length) throw new McpToolError(`${moved.map((x) => q(titleOf(x.page))).join(', ')} is no longer in the trash. Nothing was changed.`)
      for (const x of items) ws().restorePage(x.page.id)
      return {
        result: single ? out(items[0].page.id) : { restored: items.map((x) => out(x.page.id)), count: items.length },
        undo: () => {
          let clean = true
          for (const b of before) {
            const now = ws().pages[b.id]
            if (!now || now.trashed) {
              clean = false
              continue
            }
            if (now.parentId !== b.parentId) ws().updatePage(b.id, { parentId: b.parentId })
            ws().trashPage(b.id)
          }
          return clean
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_move_page                                                       */
/* ------------------------------------------------------------------ */

function planMovePage(args: Record<string, unknown>): WritePlan {
  const page = tidyPageOrThrow(args.id)
  const { pages } = ws()
  const name = titleOf(page)
  if (page.databaseId)
    throw new McpToolError(`${q(name)} is a row of ${q(titleOf(pages[page.databaseId]))}: rows stay in their database. one_move_row moves it into another database.`)
  let parentId: ID | null = page.parentId
  if (args.parentId === null || args.parentId === '') parentId = null
  else if (args.parentId !== undefined) {
    const target = tidyPageOrThrow(args.parentId, 'parentId')
    if (target.id === page.id || within(pages, target.id, page.id)) throw new McpToolError(`${q(titleOf(target))} is ${target.id === page.id ? q(name) : `inside ${q(name)}`}: a page cannot move into itself or its own sub-pages.`)
    if (target.kind === 'database')
      throw new McpToolError(`${q(titleOf(target))} is a database: a page moved there would become one of its rows, which is not done over MCP. Use one_create_row for new rows, or ask the person to drop the page on the database in One.`)
    parentId = target.id
  }
  // team workspaces: Private ⇄ the workspace only through the app (the page changes documents)
  const priv = parentId ? !!pages[parentId]?.private : !!page.private
  if (priv !== !!page.private) throw new McpToolError(`${q(name)} and the new place are not both ${page.private ? 'private' : 'shared'}: moving between Private and the workspace is done in One (sidebar).`)

  const anchors = ['before', 'after', 'index'].filter((k) => args[k] !== undefined && args[k] !== null)
  if (anchors.length > 1) throw new McpToolError('Pass at most one of "before", "after" and "index".')
  // siblings as people see them (no hidden pages, nothing in the trash)
  const sibs = Object.values(pages)
    .filter((p) => p.parentId === parentId && p.id !== page.id && live(p.id) && !p.hidden)
    .sort((a, b) => a.order - b.order)
  let at: number | undefined
  let position = t('features.mcp.plan.last')
  if (anchors[0] === 'before' || anchors[0] === 'after') {
    const key = anchors[0]
    const sibId = str(args[key], key, { max: 80 }).trim()
    const i = sibs.findIndex((p) => p.id === sibId)
    if (i < 0) throw new McpToolError(`"${key}": ${q(sibId)} is not a page next to it under ${parentId ? q(titleOf(pages[parentId])) : 'the top level'}. Siblings: ${sibs.slice(0, 12).map((p) => `${q(titleOf(p))} (${p.id})`).join(', ') || 'none'}.`)
    at = key === 'before' ? i : i + 1
    position = t(`features.mcp.plan.${key}`, { title: titleOf(sibs[i]) })
  } else if (anchors[0] === 'index') {
    const n = typeof args.index === 'number' ? args.index : Number(args.index)
    if (!Number.isInteger(n) || n < 0) throw new McpToolError('"index" must be a whole number ≥ 0 (0 = first).')
    at = Math.min(n, sibs.length)
    position = at === 0 ? t('features.mcp.plan.first') : at >= sibs.length ? t('features.mcp.plan.last') : t('features.mcp.plan.at', { n: at + 1 })
  }
  const sameParent = parentId === page.parentId
  if (sameParent && at === undefined) {
    return {
      tool: 'one_move_page',
      verb: t('features.mcp.verb.move'),
      summary: '',
      target: name,
      lines: [],
      noop: { id: page.id, title: page.title, parentId, path: pathOf(page.id), note: 'No change: it is there already. Pass "before", "after" or "index" to reorder it.' },
      apply: async () => ({ result: null }),
    }
  }
  // the index among ALL non-trashed siblings (hidden ones too) that the store's movePage expects
  const all = Object.values(pages)
    .filter((p) => p.parentId === parentId && !p.trashed && p.id !== page.id)
    .sort((a, b) => a.order - b.order)
  const storeIndex = at === undefined ? undefined : at >= sibs.length ? all.length : all.findIndex((p) => p.id === sibs[at!].id)
  const lines: PlanLine[] = [
    { k: 'fact', label: t('features.mcp.plan.kind'), value: kindLabel(page) },
    { k: 'fact', label: t('features.mcp.plan.from'), value: where(page.parentId) },
    { k: 'fact', label: t('features.mcp.plan.to'), value: where(parentId) },
    { k: 'fact', label: t('features.mcp.plan.position'), value: position },
  ]
  const whereTo = parentId ? titleOf(pages[parentId]) : t('features.mcp.plan.topLevel')
  return {
    tool: 'one_move_page',
    verb: t('features.mcp.verb.move'),
    summary: sameParent ? t('features.mcp.sum.reorder', { title: name, where: whereTo }) : t('features.mcp.sum.move', { title: name, where: whereTo }),
    target: name,
    lines,
    async apply() {
      const now = live(page.id)
      if (!now) throw new McpToolError(`${q(name)} is gone. Nothing was changed.`)
      if (parentId && !live(parentId)) throw new McpToolError(`${q(titleOf(ws().pages[parentId]))} is gone. Nothing was changed.`)
      const prev = { parentId: now.parentId, order: now.order }
      ws().movePage(page.id, parentId, storeIndex)
      const moved = ws().pages[page.id]
      if (!moved || moved.parentId !== parentId) throw new McpToolError(`One did not move ${q(name)} there. Nothing was changed.`)
      const placed = { parentId: moved.parentId, order: moved.order }
      const index = Object.values(ws().pages)
        .filter((p) => p.parentId === parentId && live(p.id) && !p.hidden)
        .sort((a, b) => a.order - b.order)
        .findIndex((p) => p.id === page.id)
      return {
        result: { id: page.id, title: moved.title, kind: kindOf(moved), parentId, path: pathOf(page.id), index, url: pageUrl(page.id) },
        undo: () => {
          const cur = ws().pages[page.id]
          if (!cur || cur.parentId !== placed.parentId || cur.order !== placed.order) return false
          if (prev.parentId && !live(prev.parentId)) return false
          ws().updatePage(page.id, { parentId: prev.parentId, order: prev.order })
          return true
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_move_row                                                        */
/* ------------------------------------------------------------------ */

/** Never carried over: the title (moves as the title), computed values. */
const COMPUTED = new Set(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const isEmptyValue = (v: PropertyValue | undefined) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)

/** The two-way partner of a relation (database/model/actions.ts pairs by id: `<id>.2way`). */
function paired(dbId: ID, prop: PropertyDef): boolean {
  if (prop.type !== 'relation' || !prop.relationDatabaseId) return false
  const target = ws().databases[prop.relationDatabaseId]
  return !!target?.properties.some((p) => p.type === 'relation' && p.relationDatabaseId === dbId && (p.id === prop.id + TWO_WAY_SUFFIX || prop.id === p.id + TWO_WAY_SUFFIX))
}

interface RowMapping {
  values: Record<ID, PropertyValue>
  /** options the target gets: property id → new options */
  fresh: Map<ID, SelectOption[]>
  /** source property names that carry a value over */
  carried: string[]
  problems: string[]
}

function mapRow(row: Page, from: Database, to: Database, toTitle: string): RowMapping {
  const out: RowMapping = { values: {}, fresh: new Map(), carried: [], problems: [] }
  for (const sp of from.properties) {
    const v = row.properties[sp.id]
    if (COMPUTED.has(sp.type) || isEmptyValue(v)) continue
    const tp = to.properties.find((p) => norm(p.name) === norm(sp.name))
    if (!tp) {
      out.problems.push(`${q(sp.name)} (${sp.type}): ${q(toTitle)} has no property of that name`)
      continue
    }
    if (tp.type !== sp.type) {
      out.problems.push(`${q(sp.name)} is ${sp.type} here but ${tp.type} in ${q(toTitle)}`)
      continue
    }
    if (sp.type === 'select' || sp.type === 'status' || sp.type === 'multi_select') {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string]
      const mapped: string[] = []
      for (const oid of ids) {
        const opt = sp.options?.find((o) => o.id === oid)
        if (!opt) continue
        const known = [...(tp.options ?? []), ...(out.fresh.get(tp.id) ?? [])].find((o) => norm(o.name) === norm(opt.name))
        if (known) mapped.push(known.id)
        else if (sp.type === 'status') out.problems.push(`${q(sp.name)}: ${q(toTitle)} has no status ${q(opt.name)} (it has ${(tp.options ?? []).map((o) => q(o.name)).join(', ')})`)
        else if (to.locked) out.problems.push(`${q(sp.name)}: ${q(toTitle)} is locked, so the option ${q(opt.name)} cannot be added there`)
        else {
          const made: SelectOption = { id: newId(), name: opt.name, color: opt.color ?? palette[(tp.options?.length ?? 0) % palette.length] }
          out.fresh.set(tp.id, [...(out.fresh.get(tp.id) ?? []), made])
          mapped.push(made.id)
        }
      }
      if (mapped.length) out.values[tp.id] = sp.type === 'multi_select' ? mapped : mapped[0]
    } else if (sp.type === 'relation') {
      if (tp.relationDatabaseId !== sp.relationDatabaseId) out.problems.push(`${q(sp.name)}: the relations point to different databases`)
      else if (paired(from.id, sp) || paired(to.id, tp)) out.problems.push(`${q(sp.name)} is a two-way relation: its links would not follow the row`)
      else out.values[tp.id] = clone(v as string[])
    } else out.values[tp.id] = clone(v as PropertyValue)
    if (tp.id in out.values) out.carried.push(sp.name)
  }
  return out
}

/** Rows (of any database) whose relation values point at this row: they would lose it. */
function incomingLinks(row: Page): string[] {
  const { pages, databases } = ws()
  const hits: string[] = []
  for (const db of Object.values(databases)) {
    const rels = db.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId === row.databaseId)
    if (!rels.length) continue
    for (const r of Object.values(pages)) {
      if (r.databaseId !== db.id || r.trashed || r.id === row.id) continue
      const prop = rels.find((p) => Array.isArray(r.properties[p.id]) && (r.properties[p.id] as string[]).includes(row.id))
      if (prop) hits.push(`${q(titleOf(r))} in ${q(titleOf(pages[db.id]))} (${q(prop.name)})`)
    }
  }
  return hits
}

function planMoveRow(args: Record<string, unknown>): WritePlan {
  const row = tidyPageOrThrow(args.id)
  const name = titleOf(row)
  if (!row.databaseId) throw new McpToolError(`${q(name)} is a ${kindOf(row)}, not a database row. one_move_page moves pages and databases.`)
  const { db: from, page: fromPage } = databaseOrThrow(row.databaseId)
  const { db: to, page: toPage } = databaseOrThrow(args.databaseId)
  const { pages } = ws()
  if (inTemplate(pages, to.id)) throw new McpToolError(`No database with id ${q(String(args.databaseId))}. Use one_list_databases to get database ids.`)
  const fromTitle = titleOf(fromPage)
  const toTitle = titleOf(toPage)
  if (to.id === from.id) {
    return {
      tool: 'one_move_row',
      verb: t('features.mcp.verb.moveRow'),
      summary: '',
      target: name,
      lines: [],
      noop: { id: row.id, title: row.title, databaseId: to.id, note: `No change: the row is in ${q(toTitle)} already.` },
      apply: async () => ({ result: null }),
    }
  }
  if (!!row.private !== !!toPage.private) throw new McpToolError(`${q(name)} and ${q(toTitle)} are not both ${row.private ? 'private' : 'shared'}: moving between Private and the workspace is done in One.`)
  const map = mapRow(row, from, to, toTitle)
  const links = incomingLinks(row)
  if (links.length) map.problems.push(`other rows link to it: ${links.slice(0, 5).join(', ')}${links.length > 5 ? ` and ${links.length - 5} more` : ''}`)
  if (map.problems.length)
    throw new McpToolError(
      `${q(name)} cannot move from ${q(fromTitle)} to ${q(toTitle)} without losing something, so nothing was changed: ${map.problems.join('; ')}. A row moves only when every value it has fits a property of the same name and type there. Add or rename properties first (one_create_property, one_update_property), or ask the person.`,
    )
  const lines: PlanLine[] = [
    { k: 'fact', label: t('features.mcp.plan.from'), value: fromTitle },
    { k: 'fact', label: t('features.mcp.plan.to'), value: toTitle },
  ]
  if (map.carried.length) lines.push({ k: 'fact', label: t('features.mcp.plan.properties'), value: map.carried.join(', ') })
  const freshNames = [...map.fresh.values()].flat().map((o) => o.name)
  if (freshNames.length) lines.push({ k: 'fact', label: t('features.mcp.plan.newOptions'), value: freshNames.join(', ') })
  return {
    tool: 'one_move_row',
    verb: t('features.mcp.verb.moveRow'),
    summary: t('features.mcp.sum.moveRow', { title: name, from: fromTitle, to: toTitle }),
    target: `${fromTitle} → ${toTitle}`,
    lines,
    async apply() {
      const cur = live(row.id)
      const target = ws().databases[to.id]
      if (!cur || cur.databaseId !== from.id || !target || !live(to.id)) throw new McpToolError(`${q(name)} or ${q(toTitle)} changed meanwhile. Nothing was changed.`)
      const before = { properties: clone(cur.properties), order: cur.order }
      for (const [propId, opts] of map.fresh) {
        const def = target.properties.find((p) => p.id === propId)
        if (def) ws().updateProperty(to.id, propId, { options: [...(def.options ?? []), ...opts] })
      }
      const values: Record<ID, PropertyValue> = { ...map.values }
      // unique ids: numbered in the new database, like a new row
      const uid = target.properties.filter((p) => p.type === 'unique_id')
      if (uid.length) {
        for (const p of uid) values[p.id] = target.nextUniqueId
        ws().updateDatabase(to.id, { nextUniqueId: target.nextUniqueId + 1 })
      }
      const order = Math.max(0, ...Object.values(ws().pages).filter((p) => p.parentId === to.id).map((p) => p.order)) + 1
      ws().updatePage(row.id, { databaseId: to.id, parentId: to.id, properties: values, order })
      const moved = ws().pages[row.id]
      const d = ws().databases[to.id]
      return {
        result: { id: row.id, title: moved.title, from: { id: from.id, title: fromTitle }, databaseId: to.id, database: toTitle, url: pageUrl(row.id), properties: rowProperties(d, moved), ...(freshNames.length ? { addedOptions: freshNames } : {}) },
        undo: () => {
          const now = ws().pages[row.id]
          if (!now || now.databaseId !== to.id || !same(now.properties, values) || !live(from.id)) return false
          ws().updatePage(row.id, { databaseId: from.id, parentId: from.id, properties: before.properties, order: before.order })
          // options added for it go again when nothing else took them up
          for (const [propId, opts] of map.fresh) {
            const def = ws().databases[to.id]?.properties.find((p) => p.id === propId)
            if (!def) continue
            const used = new Set(Object.values(ws().pages).flatMap((p) => (p.databaseId === to.id ? [p.properties[propId]].flat() : [])))
            const drop = new Set(opts.filter((o) => !used.has(o.id)).map((o) => o.id))
            if (drop.size) ws().updateProperty(to.id, propId, { options: (def.options ?? []).filter((o) => !drop.has(o.id)) })
          }
          return true
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */

export const TIDY_PLANNERS: Partial<Record<McpToolName, (args: Record<string, unknown>) => WritePlan>> = {
  one_trash_page: planTrash,
  one_restore_page: planRestore,
  one_move_page: planMovePage,
  one_move_row: planMoveRow,
}
