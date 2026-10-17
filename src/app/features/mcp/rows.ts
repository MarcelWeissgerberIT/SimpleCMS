/**
 * One MCP — rows: one_create_row and one_update_row (one row, or `rows` — up to 50 in ONE call, all or none, one card),
 * one_upsert_rows (items mirrored by a key: only what differs is written), files values (`onefile:` refs of this
 * workspace only — spec § 2.3) and what a row batch may start (autofill, automations, row-triggered agents: named on
 * the card; ≥ 5 rows that start paid AI work or send something out of One are always asked).
 * Staged through the workspace agent's tools (stage.ts), applied as the call.
 */
import { t } from '../../i18n'
import type { Database, ID, Page } from '../../store/types'
import { autofillOf } from '../../database'
import { findProp } from '../ai/agent/props'
import { stageUpsert, ToolInputError, withToolScope } from '../ai/agent/tools'
import { pagePrivate } from '../ai/agent/workItems'
import type { PropChange } from '../ai/agent/types'
import { fileDrop } from '../ai/claudeFiles'
import { mcpError } from '../../../shared/mcp/errors'
import { MCP_LIMITS } from '../../../shared/mcp/tables'
import { applyStaged, assertStageWritable, callStage, itemPlan, mcpMessage, outsideTemplates, stageWith } from './stage'
import { assertNotSystem } from './system'
import { databaseOrThrow, kindOf, live, McpToolError, pageUrl, q, rowProperties, titleOf, ws } from './values'
import { atPath, chars, checkFileScope, eachEntry, pageOrThrow, preview, str, tasksOf, type PlanLine, type WritePlan } from './plan'
import { withFilesWritable } from '../ai/agent/props'
import { stripRefLabels } from '../../../shared/mcp/refs'

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** "Name" / "title" in a properties object → the row title. */
export function splitTitle(db: Database, raw: unknown, path = 'properties'): { title: string | null; props: Record<string, unknown> | undefined } {
  if (raw === undefined || raw === null) return { title: null, props: undefined }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new McpToolError(mcpError('bad_argument', path, 'an object is expected: property name → value'))
  const titleProp = db.properties.find((p) => p.type === 'title')
  let title: string | null = null
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase()
    if (key === 'title' || (titleProp && (key === titleProp.name.trim().toLowerCase() || k === titleProp.id))) {
      if (v !== null && typeof v !== 'string') throw new McpToolError(mcpError('bad_argument', `${path}.${k}`, `the title (${q(titleProp?.name ?? 'title')}) must be a string`))
      title = (v ?? '').trim()
      continue
    }
    props[k] = v
  }
  return { title, props }
}

export function propLines(props: PropChange[] | undefined, withBefore: boolean): PlanLine[] {
  return (props ?? []).map((p) => ({ k: 'prop', name: p.name, ...(withBefore ? { before: p.before } : {}), after: p.after, ...(p.newOptions?.length ? { fresh: p.newOptions } : {}) }))
}

const FILE_REF = /^onefile:[A-Za-z0-9_-]{1,64}$/

/**
 * Files values over MCP (spec § 2.3 / § 3.4): only this workspace's files that a live page the call may read uses
 * already, never a private one into a shared row, never a web address (it would load in every viewer's browser).
 */
export function checkFiles(db: Pick<Database, 'properties'>, raw: Record<string, unknown> | undefined, targetPrivate: boolean, path: string): void {
  for (const [k, v] of Object.entries(raw ?? {})) {
    const prop = findProp(db, k)
    if (prop?.type !== 'files' || v === null || v === undefined || v === '') continue
    const at = `${path}.${prop.name}`
    for (const x of Array.isArray(v) ? v : [v]) {
      const ref = typeof x === 'string' ? x.trim() : ''
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(ref) || /^data:/i.test(ref))
        throw new McpToolError(mcpError('refused_type', at, `over MCP a files property takes only this workspace's files (onefile:<id>, as one_get_page / one_query_database show them) — got ${q(ref.slice(0, 120))}`, 'A web address goes into a url property or the page text.'))
      if (!FILE_REF.test(ref)) throw new McpToolError(mcpError('refused_type', at, `expected "onefile:<id>" (or a list of them), got ${q(String(x).slice(0, 120))}`))
      const drop = fileDrop(ref, { private: targetPrivate })
      if (drop === 'private') throw new McpToolError(mcpError('private_scope', at, `${ref} is a private file and this row is seen by the whole workspace`))
      if (drop) throw new McpToolError(mcpError('not_found', at, `${ref} is no file of this workspace that a page uses`))
    }
  }
}

/* ------------------------------------------------------------------ */
/* What a row batch starts (spec § 2.3)                                 */
/* ------------------------------------------------------------------ */

export interface SideEffects {
  lines: PlanLine[]
  /** rows of this part that start paid AI work or send something out of One (0: none) — summed over the call */
  heavy: number
}

/** A batch card's row number ("01"): the label of a row line, its title starts the value. */
export const rowNo = (i: number): string => String(i + 1).padStart(2, '0')

/**
 * The autofill properties that fill by themselves, the automations and the row-triggered agents a batch of `rows`
 * new (`created`) or changed rows (`changed`: the property ids it writes — a rename names the title property) of a
 * database sets off. Whether the call is always asked is decided over the whole call (sideHold).
 */
export function sideEffects(db: Database, rows: number, change: { created: boolean; props: ReadonlySet<ID> }): SideEffects {
  if (!rows) return { lines: [], heavy: 0 }
  const touches = (propId: ID | null | undefined) => !propId || change.created || change.props.has(propId)
  const parts: string[] = []
  let paid = false
  let out = false
  // autofill "update automatically": every new or changed row is filled again (a paid AI call per row and property)
  const fills = db.properties.filter((p) => autofillOf(p)?.auto)
  if (fills.length) {
    paid = true
    parts.push(t(rows === 1 ? 'features.mcp.plan.startsAutofill.one' : 'features.mcp.plan.startsAutofill.other', { n: chars(rows), props: fills.map((p) => p.name).join(', ') }))
  }
  for (const a of db.automations ?? []) {
    if (!a.enabled) continue
    const fires = a.trigger.type === 'row_created' ? change.created : a.trigger.type === 'property_changed' ? touches(a.trigger.propertyId) : false
    if (!fires) continue
    if (a.actions.some((x) => x.type === 'webhook' || x.type === 'run_script')) out = true
    parts.push(t('features.mcp.plan.startsAutomation', { name: a.name || t('common.untitled') }))
  }
  for (const agent of Object.values(ws().agents ?? {})) {
    if (!agent.enabled) continue
    const tr = agent.trigger
    const fires = tr.type === 'row_created' ? tr.databaseId === db.id && change.created : tr.type === 'row_changed' ? tr.databaseId === db.id && touches(tr.propertyId) : false
    if (!fires) continue
    paid = true
    parts.push(t('features.mcp.plan.startsAgent', { name: agent.name || t('common.untitled') }))
  }
  const lines: PlanLine[] = parts.length ? [{ k: 'fact', label: t('features.mcp.plan.starts'), value: parts.join(' · ') }] : []
  return { lines, heavy: paid || out ? rows : 0 }
}

/**
 * A call's side effects as a whole (spec § 2.3, C1.25): the rows that start paid AI work or send something out of One,
 * added up over everything the call does — new and changed rows, every database it touches. From MCP_LIMITS.rowsAsk
 * such rows the call is always asked, also in "Apply directly" (with a card line saying why).
 */
export function sideHold(parts: readonly SideEffects[]): { alwaysAsk: boolean; lines: PlanLine[] } {
  const n = parts.reduce((sum, p) => sum + p.heavy, 0)
  if (n < MCP_LIMITS.rowsAsk) return { alwaysAsk: false, lines: [] }
  return { alwaysAsk: true, lines: [{ k: 'note', value: t('features.mcp.plan.startsHold', { n: chars(n) }) }] }
}

/** The title property's id (a rename is a change of it for automations and agents watching it). */
export const titlePropId = (db: Database): ID | null => db.properties.find((p) => p.type === 'title')?.id ?? null

/* ------------------------------------------------------------------ */
/* Batches                                                              */
/* ------------------------------------------------------------------ */

interface RowInput {
  path: string
  title: unknown
  properties: unknown
  markdown: unknown
}

/** `rows` of a call (1–50 objects), or the single row of its top-level arguments. */
function rowInputs(args: Record<string, unknown>, single: string[]): { batch: boolean; items: RowInput[] } {
  if (args.rows === undefined || args.rows === null) return { batch: false, items: [{ path: '', title: args.title, properties: args.properties, markdown: args.markdown }] }
  const mixed = single.find((k) => args[k] !== undefined && args[k] !== null)
  if (mixed) throw new McpToolError(mcpError('bad_argument', mixed, `pass "rows" or ${single.map((k) => `"${k}"`).join(' / ')}, not both`))
  if (!Array.isArray(args.rows) || !args.rows.length) throw new McpToolError(mcpError('bad_argument', 'rows', 'a list of 1–50 rows is expected'))
  if (args.rows.length > MCP_LIMITS.rows) throw new McpToolError(mcpError('too_large', 'rows', `${args.rows.length} rows (at most ${MCP_LIMITS.rows} per call)`, `Send the first ${MCP_LIMITS.rows}, then the rest in a second call.`))
  const items = (args.rows as unknown[]).map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new McpToolError(mcpError('bad_argument', `rows[${i}]`, 'an object is expected'))
    const o = r as Record<string, unknown>
    return { path: `rows[${i}].`, title: o.title, properties: o.properties, markdown: o.markdown }
  })
  return { batch: true, items }
}

/** The Markdown of a whole batch stays within the batch limit. */
function checkBatchText(texts: string[]): void {
  const total = texts.reduce((n, s) => n + s.length, 0)
  if (total > MCP_LIMITS.pagesChars) throw new McpToolError(mcpError('too_large', 'rows', `the rows hold ${total.toLocaleString('en')} characters of Markdown in all (at most ${MCP_LIMITS.pagesChars.toLocaleString('en')})`))
}

/** A row's facts on the card of a batch: its first values. */
const rowFacts = (props: PropChange[] | undefined) =>
  (props ?? [])
    .slice(0, 3)
    .map((p) => `${p.name}: ${p.after || '—'}`)
    .join(' · ')

/* ------------------------------------------------------------------ */
/* one_create_row                                                      */
/* ------------------------------------------------------------------ */

export function planCreateRow(args: Record<string, unknown>): WritePlan {
  const { db, page: dbPage } = databaseOrThrow(args.databaseId)
  assertNotSystem(db.id)
  const { batch, items } = rowInputs(args, ['title', 'properties', 'markdown'])
  const priv = pagePrivate(db.id)
  const stage = callStage()
  const made: Array<{ title: string; change: string }> = []
  const texts: string[] = []
  // every row checked (a later one too when an earlier one fails): one refusal names each row that does not fit
  eachEntry(items, (i) => `rows[${i}]`, (item) => (typeof item.title === 'string' ? item.title : null), (item, i) => {
    const split = splitTitle(db, item.properties, `${item.path}properties`)
    const title = (str(item.title, `${item.path}title`, { max: 300 }) || split.title || '').replace(/\s+/g, ' ').trim()
    if (!title) throw new McpToolError(mcpError('bad_argument', `${item.path}title`, 'a row needs a title'))
    const markdown = stripRefLabels(str(item.markdown, `${item.path}markdown`, { max: 200_000 }))
    texts.push(markdown)
    checkFileScope(markdown, priv, q(title))
    checkFiles(db, split.props, priv, `${item.path}properties`)
    try {
      stageWith(stage, 'create_row', { database_id: db.id, title, ...(split.props ? { properties: split.props } : {}), ...(markdown.trim() ? { markdown } : {}) })
    } catch (e) {
      atPath(e, batch ? `rows[${i}]` : '')
    }
    made.push({ title, change: stage.changes.filter((c) => c.kind === 'create_row').at(-1)!.id })
  })
  if (batch) checkBatchText(texts)
  assertStageWritable(stage.changes)
  const dbName = titleOf(dbPage)
  const rows = stage.changes.filter((c) => c.kind === 'create_row')
  const lines: PlanLine[] = []
  if (!batch) {
    const c = rows[0]
    lines.push(...propLines(c.props, false))
    if (c.markdown?.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(c.markdown.trim().length) }), value: preview(c.markdown) })
  } else {
    lines.push({ k: 'fact', label: t('features.mcp.plan.in'), value: dbName })
    // the number is the label, the title starts the value: a long title wraps there instead of being cut
    rows.forEach((c, i) => lines.push({ k: 'fact', label: rowNo(i), value: [c.title ?? '', rowFacts(c.props)].filter(Boolean).join(' — ') || '—' }))
    const fresh = [...new Set(rows.flatMap((c) => (c.props ?? []).flatMap((p) => (p.newOptions ?? []).map((o) => `${p.name}: ${o}`))))]
    if (fresh.length) lines.push({ k: 'fact', label: t('features.mcp.plan.newOptions'), value: fresh.join(', ') })
  }
  const side = sideEffects(db, rows.length, { created: true, props: new Set() })
  const hold = sideHold([side])
  lines.push(...side.lines, ...hold.lines)
  const items_ = itemPlan(stage.changes)
  lines.push(...items_.lines)
  const first = rows[0]?.props?.[0]
  return {
    tool: 'one_create_row',
    verb: t(batch ? 'features.mcp.verb.createRows' : 'features.mcp.verb.createRow'),
    summary: batch
      ? t(rows.length === 1 ? 'features.mcp.sum.createRows.one' : 'features.mcp.sum.createRows.other', { n: chars(rows.length), db: dbName })
      : `${t('features.mcp.sum.createRow', { title: made[0].title, db: dbName })}${first ? ` · ${first.name}: ${first.after}` : ''}`,
    target: dbName,
    lines,
    ...(items_.holds.length || hold.alwaysAsk ? { alwaysAsk: true } : {}),
    async apply(writer) {
      const { rowIds, undo } = await applyStaged(stage.changes, writer)
      const live = ws().databases[db.id]
      if (!batch) {
        const c = rows[0]
        const id = rowIds[c.pageId] ?? c.pageId
        const row = ws().pages[id]
        return { result: { id, databaseId: db.id, title: made[0].title, url: pageUrl(id), properties: row && live ? rowProperties(live, row) : {}, ...tasksOf(items_.created) }, undo }
      }
      const out = rows.map((c, index) => {
        const id = rowIds[c.pageId] ?? c.pageId
        return { index, id, title: c.title ?? '' }
      })
      return { result: { databaseId: db.id, urlBase: pageUrl(''), rows: out, ...tasksOf(items_.created) }, undo }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_update_row                                                      */
/* ------------------------------------------------------------------ */

export function planUpdateRow(args: Record<string, unknown>): WritePlan {
  const batch = args.rows !== undefined && args.rows !== null
  let list: Array<{ path: string; id: unknown; properties: unknown }>
  if (batch) {
    const mixed = ['id', 'properties'].find((k) => args[k] !== undefined && args[k] !== null)
    if (mixed) throw new McpToolError(mcpError('bad_argument', mixed, 'pass "rows" or "id" / "properties", not both'))
    if (!Array.isArray(args.rows) || !args.rows.length) throw new McpToolError(mcpError('bad_argument', 'rows', 'a list of 1–50 {id, properties} is expected'))
    if (args.rows.length > MCP_LIMITS.rows) throw new McpToolError(mcpError('too_large', 'rows', `${args.rows.length} rows (at most ${MCP_LIMITS.rows} per call)`, `Send the first ${MCP_LIMITS.rows}, then the rest in a second call.`))
    list = (args.rows as unknown[]).map((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new McpToolError(mcpError('bad_argument', `rows[${i}]`, 'an object {id, properties} is expected'))
      const o = r as Record<string, unknown>
      return { path: `rows[${i}].`, id: o.id, properties: o.properties }
    })
  } else list = [{ path: '', id: args.id, properties: args.properties }]

  const stage = callStage()
  const lines: PlanLine[] = []
  const seen = new Set<ID>()
  /** per row: its id, title, the database, the names it changes */
  const plans: Array<{ row: Page; db: Database; dbName: string; names: string[] }> = []
  const byDb = new Map<ID, { db: Database; rows: number; props: Set<ID> }>()
  // every row checked (a later one too when an earlier one fails): one refusal names each row that does not fit
  eachEntry(list, (i) => `rows[${i}]`, (item) => (typeof item.id === 'string' ? (live(item.id) ? titleOf(live(item.id)!) : null) : null), (item, i) => {
    let row: Page
    try {
      row = pageOrThrow(item.id, `${item.path}id`)
    } catch (e) {
      atPath(e, batch ? `rows[${i}].id` : '')
    }
    if (seen.has(row.id)) throw new McpToolError(mcpError('bad_argument', `rows[${i}].id`, `${q(titleOf(row))} is listed twice — one entry per row`))
    seen.add(row.id)
    if (!row.databaseId) throw new McpToolError(mcpError('bad_argument', `${item.path}id`, `${q(titleOf(row))} is a ${kindOf(row)}, not a database row`, 'Use one_update_page for pages.'))
    const { db, page: dbPage } = databaseOrThrow(row.databaseId)
    assertNotSystem(row.id)
    if (!item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties) || !Object.keys(item.properties).length)
      throw new McpToolError(mcpError('bad_argument', `${item.path}properties`, 'name at least one property to change'))
    const split = splitTitle(db, item.properties, `${item.path}properties`)
    if (split.title === '') throw new McpToolError(mcpError('bad_argument', `${item.path}properties`, 'the title must not be empty'))
    const priv = pagePrivate(row.id)
    checkFiles(db, split.props, priv, `${item.path}properties`)
    const names: string[] = []
    const before = stage.changes.length
    try {
      if (split.title && split.title !== row.title.trim()) {
        stageWith(stage, 'set_page_title', { id: row.id, title: split.title })
        names.push('title')
        if (!batch) lines.push({ k: 'prop', name: db.properties.find((p) => p.type === 'title')?.name ?? t('features.mcp.plan.title'), before: row.title.trim() || t('common.untitled'), after: split.title })
      }
      if (split.props && Object.keys(split.props).length) {
        stageWith(stage, 'update_row', { id: row.id, properties: split.props })
        const c = stage.changes.slice(before).find((x) => x.kind === 'update_row')
        for (const p of c?.props ?? []) names.push(p.name)
        if (!batch) lines.push(...propLines(c?.props, true))
      }
    } catch (e) {
      atPath(e, batch ? `rows[${i}]` : '')
    }
    const dbName = titleOf(dbPage)
    plans.push({ row, db, dbName, names })
    if (names.length) {
      const entry = byDb.get(db.id) ?? { db, rows: 0, props: new Set<ID>() }
      entry.rows += 1
      for (const c of stage.changes.slice(before)) {
        for (const p of c.props ?? []) entry.props.add(p.propId)
        // a new title is a change of the title property (an automation or agent may watch it)
        const titleId = c.kind === 'rename' ? titlePropId(db) : null
        if (titleId) entry.props.add(titleId)
      }
      byDb.set(db.id, entry)
    }
  })
  assertStageWritable(stage.changes)
  if (batch) {
    plans.forEach((p, i) => {
      const c = stage.changes.find((x) => x.kind === 'update_row' && x.pageId === p.row.id)
      const renamed = stage.changes.find((x) => x.kind === 'rename' && x.pageId === p.row.id)
      const what = [renamed ? `→ ${renamed.title ?? ''}` : '', (c?.props ?? []).map((x) => `${x.name}: ${x.before || '—'} → ${x.after || '—'}`).join(' · ')].filter(Boolean).join(' · ')
      lines.push({ k: 'fact', label: rowNo(i), value: `${titleOf(p.row)} — ${what || t('features.mcp.plan.unchanged')}` })
    })
  }
  // what each database's rows start; asked always when the whole call starts paid or outward work on enough rows
  const sides = [...byDb.values()].map((e) => sideEffects(e.db, e.rows, { created: false, props: e.props }))
  for (const side of sides) lines.push(...side.lines)
  const hold = sideHold(sides)
  lines.push(...hold.lines)
  const alwaysAsk = hold.alwaysAsk
  const items = itemPlan(stage.changes)
  lines.push(...items.lines)
  const changedRows = plans.filter((p) => p.names.length)
  const result = () => {
    if (!batch) {
      const { row, db } = plans[0]
      const now = ws().pages[row.id]
      const d = ws().databases[db.id]
      return { id: row.id, databaseId: db.id, title: now?.title ?? row.title, url: pageUrl(row.id), properties: now && d ? rowProperties(d, now) : {} }
    }
    return { rows: plans.map((p) => ({ id: p.row.id, changed: p.names })) }
  }
  const first = plans[0]
  const dbs = [...new Set(plans.map((p) => p.dbName))]
  return {
    tool: 'one_update_row',
    verb: t(batch ? 'features.mcp.verb.updateRows' : 'features.mcp.verb.updateRow'),
    summary: batch ? t(changedRows.length === 1 ? 'features.mcp.sum.updateRows.one' : 'features.mcp.sum.updateRows.other', { n: chars(changedRows.length), db: dbs.join(', ') }) : t('features.mcp.sum.updateRow', { title: titleOf(first.row), db: first.dbName }),
    target: batch ? dbs.join(', ') : `${first.dbName} / ${titleOf(first.row)}`,
    lines,
    ...(items.holds.length || alwaysAsk ? { alwaysAsk: true } : {}),
    noop: stage.changes.length ? undefined : { ...result(), note: batch ? 'No change: every row already has these values.' : 'No change: the row already has these values.' },
    async apply(writer) {
      const { undo } = await applyStaged(stage.changes, writer)
      return { result: result(), undo }
    },
  }
}

/* ------------------------------------------------------------------ */
/* one_upsert_rows                                                     */
/* ------------------------------------------------------------------ */

export function planUpsertRows(args: Record<string, unknown>): WritePlan {
  const { db, page: dbPage } = databaseOrThrow(args.databaseId)
  assertNotSystem(db.id)
  const keyProperty = str(args.keyProperty, 'keyProperty', { required: true, max: 120 }).trim()
  const raw = args.rows
  if (!Array.isArray(raw) || !raw.length) throw new McpToolError(mcpError('bad_argument', 'rows', 'a list of 1–50 rows {key, title?, properties?, markdown?} is expected'))
  if (raw.length > MCP_LIMITS.rows) throw new McpToolError(mcpError('too_large', 'rows', `${raw.length} rows (at most ${MCP_LIMITS.rows} per call)`, `Send the first ${MCP_LIMITS.rows}, then the rest in a second call.`))
  const priv = pagePrivate(db.id)
  const texts: string[] = []
  // the agent's rows: `body` for `markdown`; files values and private files checked first (MCP's own rules)
  const rows = (raw as unknown[]).map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new McpToolError(mcpError('bad_argument', `rows[${i}]`, 'an object {key, …} is expected'))
    const o = r as Record<string, unknown>
    const extra = Object.keys(o).find((k) => !['key', 'title', 'properties', 'markdown'].includes(k))
    if (extra) throw new McpToolError(mcpError('bad_argument', `rows[${i}].${extra}`, `a row takes key, title, properties and markdown`))
    const markdown = stripRefLabels(str(o.markdown, `rows[${i}].markdown`, { max: 100_000 }))
    texts.push(markdown)
    checkFileScope(markdown, priv, q(titleOf(dbPage)))
    if (o.properties && typeof o.properties === 'object' && !Array.isArray(o.properties)) checkFiles(db, o.properties as Record<string, unknown>, priv, `rows[${i}].properties`)
    return { key: o.key, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.properties !== undefined ? { properties: o.properties } : {}), ...(markdown ? { body: markdown } : {}) }
  })
  checkBatchText(texts)
  const stage = callStage()
  let staged: ReturnType<typeof stageUpsert>
  try {
    staged = withFilesWritable(() => withToolScope(outsideTemplates, () => stageUpsert({ database_id: db.id, key_property: keyProperty, rows }, stage)))
  } catch (e) {
    if (e instanceof ToolInputError) throw new McpToolError(mcpError('bad_argument', /key_property|property/i.test(e.message) ? 'keyProperty' : '', mcpMessage(e.message)))
    throw e
  }
  // any refused row fails the whole call, with every row's reason (no partial upsert — spec § 2.3)
  const refused = staged.results.map((r, index) => ({ ...r, index })).filter((r) => r.action === 'refused')
  if (refused.length)
    throw new McpToolError(
      mcpError(
        'bad_argument',
        'rows',
        `${refused.length} of ${staged.results.length} rows do not fit: ${refused.map((r) => `rows[${r.index}] (key ${q(r.key)}): ${mcpMessage(r.reason ?? '')}`).join('; ')}`,
        'Fix those rows (or leave them out) and send the call again.',
      ),
    )
  assertStageWritable(stage.changes)
  const dbName = titleOf(dbPage)
  const count = (a: string) => staged.results.filter((r) => r.action === a).length
  const n = { created: count('created'), updated: count('updated'), same: count('unchanged') }
  const lines: PlanLine[] = [
    { k: 'fact', label: t('features.mcp.plan.in'), value: dbName },
    { k: 'fact', label: t('features.mcp.plan.key'), value: staged.keyName },
    { k: 'fact', label: t('features.mcp.plan.upsertCounts'), value: t('features.mcp.plan.upsertN', { created: chars(n.created), updated: chars(n.updated), same: chars(n.same) }) },
  ]
  const shown = staged.results.filter((r) => r.action !== 'unchanged')
  for (const r of shown) {
    const c = stage.changes.find((x) => x.pageId === r.id && (x.kind === 'create_row' || x.kind === 'update_row'))
    lines.push({ k: 'fact', label: `${t(`features.mcp.plan.upsert.${r.action}`)} · ${r.key}`, value: rowFacts(c?.props) || (r.action === 'updated' ? t('features.mcp.plan.renamed') : '—') })
  }
  const created = stage.changes.filter((c) => c.kind === 'create_row').length
  const updatedProps = new Set(stage.changes.filter((c) => c.kind === 'update_row').flatMap((c) => (c.props ?? []).map((p) => p.propId)))
  // a renamed row changes the title property (an automation or agent may watch it)
  const titleId = titlePropId(db)
  if (titleId && stage.changes.some((c) => c.kind === 'rename')) updatedProps.add(titleId)
  const sideNew = sideEffects(db, created, { created: true, props: new Set() })
  const sideOld = sideEffects(db, n.updated, { created: false, props: updatedProps })
  // what the new rows start, then what the changed ones start (a line both name is shown once); asked always when new
  // and changed rows together start paid or outward work on enough rows
  const same = (a: PlanLine, b: PlanLine) => JSON.stringify(a) === JSON.stringify(b)
  const hold = sideHold([sideNew, sideOld])
  lines.push(...sideNew.lines, ...sideOld.lines.filter((l) => !sideNew.lines.some((x) => same(x, l))), ...hold.lines)
  const items = itemPlan(stage.changes)
  lines.push(...items.lines)
  const answer = (ids: Record<string, ID>) => ({
    databaseId: db.id,
    keyProperty: staged.keyName,
    rows: staged.results.map((r, index) => ({ index, key: r.key, id: r.id ? (ids[r.id] ?? r.id) : null, action: r.action, ...(r.body ? { body: r.body } : {}) })),
    ...tasksOf(items.created),
  })
  return {
    tool: 'one_upsert_rows',
    verb: t('features.mcp.verb.upsertRows'),
    summary: t('features.mcp.sum.upsertRows', { db: dbName, created: chars(n.created), updated: chars(n.updated) }),
    target: dbName,
    lines,
    ...(items.holds.length || hold.alwaysAsk ? { alwaysAsk: true } : {}),
    noop: stage.changes.length ? undefined : { ...answer({}), note: 'No change: every row already has these values.' },
    async apply(writer) {
      const { rowIds, undo } = await applyStaged(stage.changes, writer)
      return { result: answer(rowIds), undo }
    },
  }
}
