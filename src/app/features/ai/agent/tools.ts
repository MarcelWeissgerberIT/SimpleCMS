/**
 * Workspace agent — the tools Claude can call. Read-only tools answer from the store; writing
 * tools never touch it: each call stages (or extends) one StagedChange through the StageApi.
 * Tool results are model-facing text (English); `summary` is the localized step-log readout.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs } from '../../../store/selectors'
import type { Database, ID, Page, PropertyDef } from '../../../store/types'
import { propertyValueToText } from '../../../database'
import { docToMarkdown } from '../../../editor'
import { parseHash } from '../../../lib/router'
import { newId } from '../../../lib/ids'
import { t } from '../../../i18n'
import { retrieve, workspaceDocs } from '../workspace'
import { coerceProperties, isSettable, mergeProps } from './props'
import { planEdits, readWithRefs, stripRefs, type RawEdit } from './edit'
import type { ChangeKind, ColumnSpec, ColumnType, PropChange, StagedChange, ToolName } from './types'

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

export interface ToolOutcome {
  /** what Claude gets back */
  content: string
  /** localized readout for the step log */
  summary: string
  state: 'ok' | 'staged'
  changeId?: string
}

export type NewChange = Omit<StagedChange, 'id' | 'n' | 'status'>

/** Staging area of the current session (implemented by session.ts). */
export interface StageApi {
  list(): StagedChange[]
  add(change: NewChange): StagedChange
  update(id: string, patch: Partial<StagedChange>): StagedChange
  /** id of a row created from a staged create_row (rows get their id on apply), else the id itself */
  resolve(id: ID): ID
}

export interface AgentTool {
  name: ToolName
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  /** stages changes (shown with a different verb in the log) */
  write: boolean
  run(input: Record<string, unknown>, stage: StageApi): ToolOutcome
}

/** A call Claude has to fix: the message goes back to Claude as an error result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/** Tool calls per task (one run of the loop). */
export const MAX_TOOL_CALLS = 25
/** Characters of one page part (read_page) and of any other tool result. */
export const PAGE_PART_CHARS = 12_000
export const RESULT_CHARS = 16_000

/** Cut a tool result and tell Claude so (and how to get the rest). */
export function clipResult(text: string, max = RESULT_CHARS, hint = 'Narrow the request (filters, a smaller limit) to see the rest.'): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('\n', max)
  const end = cut > max * 0.7 ? cut : max
  return `${text.slice(0, end)}\n[Truncated: showing ${end.toLocaleString('en')} of ${text.length.toLocaleString('en')} characters. ${hint}]`
}

/* ------------------------------------------------------------------ */
/* Input helpers                                                       */
/* ------------------------------------------------------------------ */

function str(input: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = input[key]
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new ToolInputError(`Missing required parameter "${key}".`)
    return ''
  }
  if (typeof v !== 'string') throw new ToolInputError(`"${key}" must be a string.`)
  if (opts.max && v.length > opts.max) throw new ToolInputError(`"${key}" is too long (${v.length} characters, at most ${opts.max}).`)
  return v
}

function int(input: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
  const v = input[key]
  if (v === undefined || v === null) return def
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new ToolInputError(`"${key}" must be a number.`)
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/* ------------------------------------------------------------------ */
/* Workspace helpers                                                   */
/* ------------------------------------------------------------------ */

const ws = () => useWorkspace.getState()
const untitled = () => t('common.untitled')
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const titleOf = (p: Page | undefined) => p?.title.trim() || 'Untitled'
const q = (s: string) => JSON.stringify(s)

/**
 * Custom agents (features/agents): the pages a scoped run may see (null = everything). Set only for
 * the duration of one tool call (withToolScope) — tool runs are synchronous.
 */
let visible: ((id: ID) => boolean) | null = null

/**
 * The AI terminal: what the person lets Claude read of a page (its context marks, editor area) —
 * null = everything. Set only for the duration of one tool call (withReadLimit).
 */
export interface ReadLimit {
  mode: 'marked' | 'none'
  /** the marked blocks as Markdown / plain text ('' for 'none') */
  markdown: string
  plain: string
  blocks: number
  /** the marked top-level blocks (their ids) — read_page with refs and edit_page only see these */
  ids?: string[]
}

let readLimit: ((id: ID) => ReadLimit | null) | null = null

/** Run `fn` (a tool call) reading pages only as `limit` allows. */
export function withReadLimit<T>(limit: ((id: ID) => ReadLimit | null) | null, fn: () => T): T {
  const prev = readLimit
  readLimit = limit
  try {
    return fn()
  } finally {
    readLimit = prev
  }
}

const LIMITED_NOTE = 'The person limited what you may read on this page'

/** Run `fn` (a tool call) seeing only the pages `filter` lets through. */
export function withToolScope<T>(filter: ((id: ID) => boolean) | null, fn: () => T): T {
  const prev = visible
  visible = filter
  try {
    return fn()
  } finally {
    visible = prev
  }
}

function live(id: ID): Page | null {
  const { pages } = ws()
  const p = pages[id]
  if (visible && !visible(id)) return null
  return p && !p.trashed && !isEffectivelyTrashed(pages, id) ? p : null
}

/** "Team wiki / Onboarding" — where a page lives (its ancestors). */
function pathOf(id: ID): string {
  const crumbs = selectBreadcrumbs(ws().pages, id).slice(0, -1)
  return crumbs.map((p) => titleOf(p)).join(' / ')
}

function kindOf(p: Page): 'page' | 'database' | 'row' {
  return p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page'
}

function rowsOf(dbId: ID): Page[] {
  return Object.values(ws().pages)
    .filter((p) => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.order - b.order)
}

function databaseOf(id: ID): Database {
  const db = ws().databases[id]
  if (!db || !live(id)) throw new ToolInputError(`No database with id ${q(id)}. Use list_databases to get database ids.`)
  return db
}

function schemaLine(db: Database): string {
  return db.properties
    .map((p) => {
      const opts = p.options?.length ? `: ${p.options.map((o) => o.name).join(' | ')}` : ''
      const ro = isSettable(p) || p.type === 'title' ? '' : ', read-only'
      return `${p.name} (${p.type}${ro}${opts})`
    })
    .join('; ')
}

function rowFacts(db: Database, row: Page): Record<string, string> {
  const out: Record<string, string> = { id: row.id, title: row.title.trim() }
  for (const prop of db.properties) {
    if (prop.type === 'title') continue
    let v = ''
    try {
      v = propertyValueToText(db, prop, row)
    } catch {
      v = ''
    }
    if (v) out[prop.name] = v.length > 300 ? `${v.slice(0, 297)}…` : v
  }
  return out
}

function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const words = [query, ...query.split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length > 2)
  const lower = flat.toLowerCase()
  let at = -1
  for (const w of words) {
    at = lower.indexOf(w)
    if (at >= 0) break
  }
  const start = Math.max(0, at < 0 ? 0 : at - 80)
  const s = flat.slice(start, start + 220)
  return `${start > 0 ? '…' : ''}${s}${start + 220 < flat.length ? '…' : ''}`
}

/** The pending staged change that creates a page, row or database with this id, if any. */
function stagedCreate(stage: StageApi, id: ID): StagedChange | undefined {
  return stage.list().find((c) => (c.kind === 'create_page' || c.kind === 'create_row' || c.kind === 'create_database') && c.pageId === id && c.status !== 'applied')
}

/** A staged database that is not applied yet (pending or failed; discarded ones throw). */
function stagedDatabase(stage: StageApi, id: ID): StagedChange | undefined {
  const c = stagedCreate(stage, id)
  if (c?.kind !== 'create_database') return undefined
  if (c.status === 'discarded') throw new ToolInputError(`The user discarded staged change #${c.n} (the database ${q(c.title ?? '')}); it will not exist.`)
  return c
}

/* ---------- schemas: live databases plus what is staged for them ---------- */

const TITLE_NAME = 'Name'

function propDef(col: ColumnSpec): PropertyDef {
  return { id: col.id, name: col.name, type: col.type, ...(col.options ? { options: col.options.map((name) => ({ id: `${col.id}:${name}`, name, color: 'default' as const })) } : {}) }
}

/** The database a staged create_database will make (rows can be staged against it). */
function virtualDatabase(c: StagedChange): Database {
  return { id: c.pageId, properties: [{ id: c.titlePropId ?? `${c.pageId}:title`, name: TITLE_NAME, type: 'title' }, ...(c.columns ?? []).map(propDef)], views: [], nextUniqueId: 1 }
}

/** Pending add_property changes of a database. */
function stagedProps(stage: StageApi, dbId: ID): StagedChange[] {
  return stage.list().filter((c) => c.kind === 'add_property' && c.databaseId === dbId && (c.status === 'pending' || c.status === 'failed'))
}

interface Schema {
  db: Database
  /** the staged create_database (rows depend on it) */
  staged?: StagedChange
  /** property id → the add_property change that creates it */
  propNeeds: Map<ID, string>
}

/** A database to stage rows against: a live one (with the properties staged for it) or a staged one. */
function schemaOf(stage: StageApi, rawId: ID): Schema {
  const staged = stagedDatabase(stage, rawId)
  if (staged) return { db: virtualDatabase(staged), staged, propNeeds: new Map() }
  const db = databaseOf(rawId)
  const extra = stagedProps(stage, db.id)
  if (!extra.length) return { db, propNeeds: new Map() }
  return { db: { ...db, properties: [...db.properties, ...extra.map((c) => propDef(c.prop!))] }, propNeeds: new Map(extra.map((c) => [c.prop!.id, c.id])) }
}

/** The add_property changes a set of property values needs. */
function needsOf(schema: Schema, props: PropChange[], prev: string[] = []): string[] {
  const out = new Set(prev)
  for (const p of props) {
    const id = schema.propNeeds.get(p.propId)
    if (id) out.add(id)
  }
  return [...out]
}

const dbTitle = (schema: Schema) => (schema.staged ? (schema.staged.title ?? '') : titleOf(ws().pages[schema.db.id]))

/** An existing page, or throws a message Claude can act on. Staged pages are handled by the callers. */
function pageOrThrow(stage: StageApi, rawId: ID): Page {
  const staged = stagedCreate(stage, rawId)
  if (staged?.status === 'discarded') throw new ToolInputError(`The user discarded staged change #${staged.n} (${q(staged.title ?? '')}); that page will not exist.`)
  const id = stage.resolve(rawId)
  const p = live(id)
  if (!p) throw new ToolInputError(`No page with id ${q(rawId)}. Use search_pages to find page ids.`)
  return p
}

/** One pending change of a kind for a page (to extend it instead of adding a second one). */
function pendingFor(stage: StageApi, kind: ChangeKind, pageId: ID): StagedChange | undefined {
  return stage.list().find((c) => c.kind === kind && c.pageId === pageId && c.status === 'pending')
}

function markdownOf(doc: JSONContent | null): string {
  return docToMarkdown(doc).trim()
}

const stagedNote = (c: StagedChange) => `Staged as change #${c.n}. Nothing is written until the user applies it.`

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const searchPages: AgentTool = {
  name: 'search_pages',
  write: false,
  description:
    'Search the workspace for pages, databases and database rows by keywords (fuzzy match on titles and text). Call this first to find the pages a task refers to. Returns for each hit: id, title, kind (page, database or row), where it lives, the last-edit date and a text snippet.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords, e.g. "weekly sync notes" or a page title.' },
      limit: { type: 'integer', description: 'Maximum number of results (1–20, default 8).' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  run(input) {
    const query = str(input, 'query', { required: true, max: 300 }).trim()
    const limit = int(input, 'limit', 8, 1, 20)
    const scope = visible
    const lim = readLimit
    let docs = scope ? workspaceDocs().filter((d) => scope(d.id)) : workspaceDocs()
    // a page whose reading is limited is searched (and quoted) only by what may be read of it
    if (lim) docs = docs.map((d) => {
      const l = lim(d.id)
      return l ? { ...d, text: l.plain } : d
    })
    const hits = retrieve(query, docs, limit)
    if (!hits.length) return { content: `No pages match ${q(query)}. Try other keywords, or list_databases for databases.`, summary: t('features.agent.res.results', { count: 0 }), state: 'ok' }
    const { pages } = ws()
    const lines = hits.map((h) => {
      const p = pages[h.id]
      const kind = p ? kindOf(p) : 'page'
      const where = p?.databaseId ? `row of database ${q(titleOf(pages[p.databaseId]))}` : pathOf(h.id) ? `in ${q(pathOf(h.id))}` : 'top level'
      const edited = p ? day(p.updatedAt) : ''
      const text = snippet(h.text, query)
      return `- id: ${h.id} · ${kind} · ${q(h.title)} · ${where} · edited ${edited}${text ? `\n  ${text}` : ''}`
    })
    return { content: clipResult(`${hits.length} results for ${q(query)}:\n${lines.join('\n')}`), summary: t('features.agent.res.results', { count: hits.length }), state: 'ok' }
  },
}

const readPage: AgentTool = {
  name: 'read_page',
  write: false,
  description:
    'Read one page as Markdown, with its title, location, last-edit date, sub-pages and — for database rows — its property values. Call this before you summarise, quote or change a page. Long pages come in parts: pass the offset given at the end of a part to continue. For a database this returns its schema; use query_database for its rows. Pass refs: true before you change existing text with edit_page: every block (and list item) then carries a ref like ⟦b3⟧ to cite.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page id (from search_pages, query_database or another tool).' },
      offset: { type: 'integer', description: 'Character offset into the page Markdown (default 0).' },
      refs: { type: 'boolean', description: 'true: label every block and list item with a ref (⟦b3⟧) for edit_page. The labels are not part of the text — never write them into content.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  run(input, stage) {
    const rawId = str(input, 'id', { required: true, max: 80 }).trim()
    const offset = int(input, 'offset', 0, 0, 10_000_000)
    const staged = stagedCreate(stage, rawId)
    if (staged?.kind === 'create_database' && staged.status !== 'discarded')
      return {
        content: `Staged database #${staged.n} (not applied yet, no rows) · id: ${rawId}\n# ${staged.title ?? ''}\nproperties: ${schemaLine(virtualDatabase(staged))}`,
        summary: t('features.agent.res.stagedPage', { n: staged.n }),
        state: 'ok',
      }
    if (staged?.status === 'pending' || staged?.status === 'failed')
      return {
        content: `Staged page #${staged.n} (not applied yet) · id: ${rawId}\n# ${staged.title ?? ''}\n\n${clipResult(staged.markdown ?? '', PAGE_PART_CHARS, '')}`,
        summary: t('features.agent.res.stagedPage', { n: staged.n }),
        state: 'ok',
      }
    const p = pageOrThrow(stage, rawId)
    const { pages, databases } = ws()
    const head: string[] = [`# ${titleOf(p)}`, `id: ${p.id} · ${kindOf(p)} · edited ${day(p.updatedAt)} · created ${day(p.createdAt)}`]
    const where = p.databaseId ? `row of database ${q(titleOf(pages[p.databaseId]))} (id: ${p.databaseId})` : pathOf(p.id) ? `in ${q(pathOf(p.id))}` : 'top level'
    head.push(`location: ${where}`)
    if (p.kind === 'database' && databases[p.id]) {
      const db = databases[p.id]
      head.push(`database with ${rowsOf(p.id).length} rows · properties: ${schemaLine(db)}`, 'Use query_database to list its rows.')
    }
    if (p.databaseId && databases[p.databaseId]) {
      const facts = rowFacts(databases[p.databaseId], p)
      const props = Object.entries(facts).filter(([k]) => k !== 'id' && k !== 'title')
      if (props.length) head.push(`properties: ${props.map(([k, v]) => `${k}: ${v}`).join('; ')}`)
    }
    const children = Object.values(pages)
      .filter((c) => c.parentId === p.id && !c.databaseId && !c.trashed)
      .sort((a, b) => a.order - b.order)
    if (children.length) head.push(`sub-pages: ${children.slice(0, 40).map((c) => `${q(titleOf(c))} (id: ${c.id})`).join(', ')}${children.length > 40 ? ` and ${children.length - 40} more` : ''}`)
    const lim = readLimit?.(p.id) ?? null
    if (lim?.mode === 'none')
      return {
        content: `${head.join('\n')}\n\n[Content withheld. ${LIMITED_NOTE}: you may not read its content (context: nothing from this page). Don't try to get it another way. You can still stage changes to it; if you need its text, say so — the person can change the context in the terminal.]`,
        summary: t('features.agent.res.withheld'),
        state: 'ok',
      }
    if (lim) head.push(`[${LIMITED_NOTE}: only the ${lim.blocks} block${lim.blocks === 1 ? '' : 's'} they marked are shown below — the rest of the page is not available to you.]`)
    const withRefs = input.refs === true || input.refs === 'true'
    if (withRefs && p.kind !== 'database') head.push('[Blocks are labelled with refs (⟦b1⟧ …) for edit_page: cite them as "b1". The labels are not part of the text: never write them into content.]')
    const md = withRefs && p.kind !== 'database' ? readWithRefs(p.id, lim ? new Set(lim.ids ?? []) : null).markdown : lim ? lim.markdown.trim() : markdownOf(p.content)
    // a part ends at a block boundary when it can (refs stay with their block)
    let end = Math.min(md.length, offset + PAGE_PART_CHARS)
    if (end < md.length) {
      const cut = md.lastIndexOf('\n\n', end)
      if (cut > offset + PAGE_PART_CHARS * 0.6) end = cut
    }
    const part = md.slice(offset, end)
    const more = end < md.length
    let body = md ? part : '(empty page)'
    if (offset && !part) body = `(offset ${offset} is past the end: the page has ${md.length} characters)`
    if (more) body += `\n[Part ${offset}–${offset + part.length} of ${md.length} characters. Call read_page with offset ${offset + part.length}${withRefs ? ' and refs: true' : ''} for the rest.]`
    return { content: `${head.join('\n')}\n\n${body}`, summary: t(lim ? 'features.agent.res.limited' : 'features.agent.res.chars', { count: md.length.toLocaleString() }), state: 'ok' }
  },
}

const listDatabases: AgentTool = {
  name: 'list_databases',
  write: false,
  description:
    'List every database with its id, number of rows, location and property schema (property names, types and allowed options). Call this before query_database, create_row or update_row so you use exact property and option names.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  run(_input, stage) {
    const { databases, pages } = ws()
    // template databases (features/templates) are not the workspace's data
    const dbs = Object.values(databases).filter((d) => live(d.id) && !inTemplate(pages, d.id))
    // what this conversation staged and the user has not applied yet (only the terminal's tools stage these)
    const staged = stage.list().filter((c) => c.kind === 'create_database' && (c.status === 'pending' || c.status === 'failed'))
    const extra = staged.length ? `\nStaged, not applied yet:\n${staged.map((c) => `- ${q(c.title ?? '')} (id: ${c.pageId}) · change #${c.n}\n  properties: ${schemaLine(virtualDatabase(c))}`).join('\n')}` : ''
    if (!dbs.length) return { content: `This workspace has no databases.${extra}`, summary: t('features.agent.res.dbs', { count: 0 }), state: 'ok' }
    const lines = dbs.map((d) => {
      const page = ws().pages[d.id]
      const where = pathOf(d.id)
      const locked = d.locked ? ' · locked (rows can be added and changed; no new options or properties)' : ''
      const props = stagedProps(stage, d.id)
      const more = props.length ? `\n  staged properties (not applied yet): ${props.map((c) => `${c.prop!.name} (${c.prop!.type})`).join('; ')}` : ''
      return `- ${q(titleOf(page))} (id: ${d.id}) · ${rowsOf(d.id).length} rows${where ? ` · in ${q(where)}` : ''}${locked}\n  properties: ${schemaLine(d)}${more}`
    })
    return { content: clipResult(`${dbs.length} databases:\n${lines.join('\n')}${extra}`), summary: t('features.agent.res.dbs', { count: dbs.length }), state: 'ok' }
  },
}

type Operator = 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty'
const OPERATORS: Operator[] = ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty']

const queryDatabase: AgentTool = {
  name: 'query_database',
  write: false,
  description:
    'List the rows of a database with their property values as display text (and their ids). Optional filters compare a property\'s display text, case-insensitive (equals, not_equals, contains, is_empty, is_not_empty); all filters must match. Use this instead of reading rows one by one. Page through large databases with limit and offset.',
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'Database id from list_databases.' },
      filters: {
        type: 'array',
        description: 'Optional filters, all must match.',
        items: {
          type: 'object',
          properties: {
            property: { type: 'string', description: 'Exact property name ("title" for the title).' },
            operator: { type: 'string', enum: OPERATORS },
            value: { type: 'string', description: 'Text to compare with (not needed for is_empty / is_not_empty).' },
          },
          required: ['property', 'operator'],
          additionalProperties: false,
        },
      },
      limit: { type: 'integer', description: 'Rows to return (1–100, default 50).' },
      offset: { type: 'integer', description: 'Rows to skip (default 0).' },
    },
    required: ['database_id'],
    additionalProperties: false,
  },
  run(input, stage) {
    const id = str(input, 'database_id', { required: true, max: 80 }).trim()
    const staged = stagedDatabase(stage, id)
    if (staged) {
      const rows = stage.list().filter((c) => c.kind === 'create_row' && c.databaseId === id && c.status !== 'discarded')
      return {
        content: `Database ${q(staged.title ?? '')} (id: ${id}) is staged as change #${staged.n} and not applied yet, so it has no rows. Rows staged for it so far: ${rows.length}${rows.length ? ` (${rows.map((r) => q(r.title ?? '')).join(', ')})` : ''}.\nproperties: ${schemaLine(virtualDatabase(staged))}`,
        summary: t('features.agent.res.rows', { count: 0 }),
        state: 'ok',
      }
    }
    const db = databaseOf(id)
    const limit = int(input, 'limit', 50, 1, 100)
    const offset = int(input, 'offset', 0, 0, 1_000_000)
    const raw = input.filters
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new ToolInputError('"filters" must be a list.')
    const titleProp = db.properties.find((p) => p.type === 'title')
    const filters = ((raw as unknown[] | undefined) ?? []).map((f) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
      const name = typeof o.property === 'string' ? o.property.trim() : ''
      const op = o.operator as Operator
      if (!OPERATORS.includes(op)) throw new ToolInputError(`Unknown operator ${q(String(o.operator))}. Use one of: ${OPERATORS.join(', ')}.`)
      const isTitle = name.toLowerCase() === 'title' || name.toLowerCase() === titleProp?.name.toLowerCase()
      const prop = isTitle ? titleProp : db.properties.find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (!prop) throw new ToolInputError(`Unknown property ${q(name)}. Properties: ${db.properties.map((p) => q(p.name)).join(', ')}.`)
      return { prop, op, value: String(o.value ?? '').trim().toLowerCase() }
    })
    const all = rowsOf(id)
    const matches = all.filter((row) =>
      filters.every(({ prop, op, value }) => {
        let text = ''
        try {
          text = (prop.type === 'title' ? row.title : propertyValueToText(db, prop, row)).trim().toLowerCase()
        } catch {
          text = ''
        }
        switch (op) {
          case 'equals':
            return text === value || text.split(', ').includes(value)
          case 'not_equals':
            return text !== value && !text.split(', ').includes(value)
          case 'contains':
            return text.includes(value)
          case 'is_empty':
            return !text
          case 'is_not_empty':
            return !!text
        }
        return true
      }),
    )
    const page = matches.slice(offset, offset + limit)
    const name = titleOf(ws().pages[id])
    const head = `Database ${q(name)} (id: ${id}): ${matches.length} of ${all.length} rows match${filters.length ? ' the filters' : ''}. Showing ${page.length ? `${offset + 1}–${offset + page.length}` : 'none'}.`
    const more = offset + page.length < matches.length ? `\n[More rows: call again with offset ${offset + page.length}.]` : ''
    const lines = page.map((r) => JSON.stringify(rowFacts(db, r)))
    return { content: clipResult(`${head}\n${lines.join('\n')}${more}`), summary: t('features.agent.res.rows', { count: matches.length }), state: 'ok' }
  },
}

const currentPage: AgentTool = {
  name: 'get_current_page',
  write: false,
  description:
    'Return the page the user has open in the app (and the page open in the side peek, if any): id, title and kind. Call this when the task refers to "this page", "here" or the open document.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  run() {
    const route = parseHash(window.location.hash)
    const main = route.name === 'page' ? live(route.id) : null
    const peekId = useUI.getState().peekPageId
    const peek = peekId ? live(peekId) : null
    if (!main && !peek) return { content: `No page is open (the user is on the ${route.name} screen).`, summary: t('features.agent.res.noPage'), state: 'ok' }
    const note = (p: Page) => {
      const l = readLimit?.(p.id)
      return !l ? '' : l.mode === 'none' ? ` · ${LIMITED_NOTE}: nothing of its content may be read` : ` · ${LIMITED_NOTE}: only ${l.blocks} marked block${l.blocks === 1 ? '' : 's'}`
    }
    const line = (p: Page) => `id: ${p.id} · ${kindOf(p)} · ${q(titleOf(p))}${pathOf(p.id) ? ` · in ${q(pathOf(p.id))}` : ''}${note(p)}`
    const parts = [main ? `Open page: ${line(main)}` : '', peek ? `In the side peek: ${line(peek)}` : ''].filter(Boolean)
    return { content: `${parts.join('\n')}\nUse read_page to read it.`, summary: titleOf(main ?? peek ?? undefined).slice(0, 40), state: 'ok' }
  },
}

/* ---------- writing (staged) ---------- */

/** A parent page for create_page / create_database: a live page or a page staged earlier. */
function parentOf(stage: StageApi, raw: ID): { id: ID; title: string; dependsOn?: string } {
  const staged = stagedCreate(stage, raw)
  if (staged && staged.kind === 'create_page' && staged.status !== 'discarded') return { id: staged.pageId, title: staged.title ?? '', dependsOn: staged.id }
  if (staged?.kind === 'create_database' && staged.status !== 'discarded') throw new ToolInputError(`${q(staged.title ?? '')} is a staged database. Use create_row to add rows to it.`)
  const parent = pageOrThrow(stage, raw)
  if (parent.kind === 'database') throw new ToolInputError(`${q(titleOf(parent))} is a database. Use create_row to add rows to it.`)
  return { id: parent.id, title: titleOf(parent) }
}

const createPage: AgentTool = {
  name: 'create_page',
  write: true,
  description:
    'Stage a new page with a title and Markdown content, at the top level or under a parent page. Use this for new documents such as summaries, reports or notes — not for database rows (use create_row). The page is created only when the user applies the change, but the returned id works right away for later calls (append_to_page, or as parent_id).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page title.' },
      markdown: { type: 'string', description: 'Page content as Markdown.' },
      parent_id: { type: 'string', description: 'Id of the parent page. Omit for a top-level page.' },
    },
    required: ['title', 'markdown'],
    additionalProperties: false,
  },
  run(input, stage) {
    const title = str(input, 'title', { required: true, max: 300 }).trim()
    const markdown = stripRefs(str(input, 'markdown', { max: 200_000 }))
    const parentRaw = str(input, 'parent_id', { max: 80 }).trim()
    let parentId: ID | null = null
    let dependsOn: string | undefined
    let parentTitle = ''
    if (parentRaw) {
      const parent = parentOf(stage, parentRaw)
      parentId = parent.id
      dependsOn = parent.dependsOn
      parentTitle = parent.title
    }
    const change = stage.add({ kind: 'create_page', pageId: newId(), parentId, title, markdown, ...(dependsOn ? { dependsOn } : {}) })
    return {
      content: `${stagedNote(change)} New page id: ${change.pageId}${parentId ? ` (under ${q(parentTitle)})` : ' (top level)'}.`,
      summary: t('features.agent.res.staged', { n: change.n }),
      state: 'staged',
      changeId: change.id,
    }
  },
}

const appendToPage: AgentTool = {
  name: 'append_to_page',
  write: true,
  description:
    'Stage Markdown to add at the end of an existing page (or of a page staged earlier). Use this to add a section, a list or action items to a page without changing what is already there.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page id.' },
      markdown: { type: 'string', description: 'Markdown to add at the end of the page.' },
    },
    required: ['id', 'markdown'],
    additionalProperties: false,
  },
  run(input, stage) {
    const rawId = str(input, 'id', { required: true, max: 80 }).trim()
    const markdown = stripRefs(str(input, 'markdown', { required: true, max: 200_000 })).trim()
    if (!markdown) throw new ToolInputError('"markdown" holds only refs. Write the content itself.')
    const staged = stagedCreate(stage, rawId)
    if (staged?.kind === 'create_database') throw new ToolInputError(`${q(staged.title ?? '')} is a staged database. Use create_row to add rows to it.`)
    if (staged && staged.status === 'pending') {
      const c = stage.update(staged.id, { markdown: [staged.markdown?.trim(), markdown].filter(Boolean).join('\n\n') })
      return { content: `Added to staged change #${c.n} (the new page ${q(c.title ?? '')}).`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
    }
    const p = pageOrThrow(stage, rawId)
    if (p.kind === 'database') throw new ToolInputError(`${q(titleOf(p))} is a database. Use create_row to add rows.`)
    const pending = pendingFor(stage, 'append', p.id)
    const c = pending
      ? stage.update(pending.id, { markdown: `${pending.markdown}\n\n${markdown}` })
      : stage.add({ kind: 'append', pageId: p.id, title: titleOf(p), markdown })
    return { content: `${stagedNote(c)} It adds ${markdown.length} characters at the end of ${q(titleOf(p))}.`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
  },
}

const editPage: AgentTool = {
  name: 'edit_page',
  write: true,
  description:
    'Stage changes to the existing content of a page — only when the task asks to fix, rewrite, update or remove what is there (to add something, use append_to_page). First call read_page with refs: true and cite its refs ("b3"). Each edit becomes its own proposed change that the user reviews as a diff and applies or discards; a version of the page is kept first. Change only the blocks the task is about and copy the rest of their text exactly. Ops: replace (from, optional to: a range of blocks side by side → markdown), delete (from, optional to), insert_after (ref → markdown), replace_all (markdown: the whole page — only for a full rewrite the task asks for).',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page id.' },
      edits: {
        type: 'array',
        description: 'The changes, each on other blocks.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['replace', 'delete', 'insert_after', 'replace_all'] },
            from: { type: 'string', description: 'replace / delete: the first block (a ref like "b3").' },
            to: { type: 'string', description: 'replace / delete: the last block of the range (omit for one block).' },
            ref: { type: 'string', description: 'insert_after: the block the new content follows.' },
            markdown: { type: 'string', description: 'replace / insert_after / replace_all: the new content as Markdown (no refs). Replacing a list item: the item text, or list items.' },
          },
          required: ['op'],
          additionalProperties: false,
        },
      },
    },
    required: ['id', 'edits'],
    additionalProperties: false,
  },
  run(input, stage) {
    const rawId = str(input, 'id', { required: true, max: 80 }).trim()
    const raw = input.edits
    if (!Array.isArray(raw) || !raw.length) throw new ToolInputError('"edits" must list at least one edit.')
    if (raw.length > 30) throw new ToolInputError(`Too many edits (${raw.length}, at most 30). Use replace_all for a full rewrite.`)
    const staged = stagedCreate(stage, rawId)
    if (staged && staged.status !== 'applied') throw new ToolInputError(`${q(staged.title ?? '')} is staged (change #${staged.n}) and not applied yet: there is nothing to edit. Use append_to_page to add to it.`)
    const p = pageOrThrow(stage, rawId)
    if (p.kind === 'database') throw new ToolInputError(`${q(titleOf(p))} is a database. Use update_row for its rows' properties, edit_page for a row's page content.`)
    const lim = readLimit?.(p.id) ?? null
    if (lim?.mode === 'none') throw new ToolInputError(`${q(titleOf(p))}: ${LIMITED_NOTE} — nothing of its content is readable, so you may not change it: refused. Use append_to_page to add to it.`)
    const pending = stage.list().filter((c) => c.kind === 'edit' && c.pageId === p.id && c.status === 'pending')
    const res = planEdits(p.id, raw as RawEdit[], lim ? new Set(lim.ids ?? []) : null, pending, 200_000)
    if ('error' in res) throw new ToolInputError(res.error)
    const title = titleOf(p)
    const out = res.plans.map((plan) => {
      if (plan.revises) {
        const prev = plan.revises
        // insert_after the same block again: both go in, in order
        const markdown = plan.edit.op === 'insert_after' && prev.markdown ? `${prev.markdown}\n\n${plan.markdown ?? ''}` : plan.markdown
        return { c: stage.update(prev.id, { edit: plan.edit, title, ...(markdown !== undefined ? { markdown } : {}) }), revised: true }
      }
      return { c: stage.add({ kind: 'edit', pageId: p.id, title, edit: plan.edit, ...(plan.markdown !== undefined ? { markdown: plan.markdown } : {}) }), revised: false }
    })
    const lines = out.map(({ c, revised }) => `#${c.n} ${c.edit!.op} ${c.edit!.refs}${revised ? ' (revised)' : ''}`)
    const ns = out.map(({ c }) => c.n)
    return {
      content: `Staged ${out.length === 1 ? 'as change' : 'as changes'} ${lines.join('; ')} on ${q(title)}. Each is reviewed and applied on its own; nothing is written until the user applies it.`,
      summary: t('features.agent.res.staged', { n: ns.length > 1 && ns[ns.length - 1] - ns[0] === ns.length - 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns.join(' #') }),
      state: 'staged',
      changeId: out[0].c.id,
    }
  },
}

const createRow: AgentTool = {
  name: 'create_row',
  write: true,
  description:
    'Stage a new row in a database: its title, property values by exact property name (see list_databases) and optional Markdown content for the row\'s page. Values are plain JSON — text, numbers, true/false, option names (a list for multi-select), dates as "YYYY-MM-DD", people by name, relations by row title or id. If a value does not fit, nothing is staged and the error says why.',
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'Database id from list_databases.' },
      title: { type: 'string', description: 'Row title.' },
      properties: { type: 'object', description: 'Property name → value.', additionalProperties: true },
      markdown: { type: 'string', description: 'Optional content of the row\'s page, as Markdown.' },
    },
    required: ['database_id', 'title'],
    additionalProperties: false,
  },
  run(input, stage) {
    const dbId = str(input, 'database_id', { required: true, max: 80 }).trim()
    const schema = schemaOf(stage, dbId)
    const title = str(input, 'title', { required: true, max: 300 }).trim()
    const markdown = stripRefs(str(input, 'markdown', { max: 200_000 }))
    const res = coerceProperties(schema.db, input.properties, null)
    if (!res.ok) throw new ToolInputError(res.error)
    const needs = needsOf(schema, res.changes)
    const change = stage.add({
      kind: 'create_row',
      pageId: newId(),
      databaseId: schema.db.id,
      title,
      props: res.changes,
      ...(markdown.trim() ? { markdown } : {}),
      ...(schema.staged ? { dependsOn: schema.staged.id } : {}),
      ...(needs.length ? { needs } : {}),
    })
    return {
      content: `${stagedNote(change)} New row id: ${change.pageId} in ${q(dbTitle(schema))}${res.changes.length ? ` with ${res.changes.map((c) => `${c.name} = ${q(c.after)}`).join(', ')}` : ''}.${newOptionsNote(res.changes)}`,
      summary: t('features.agent.res.staged', { n: change.n }),
      state: 'staged',
      changeId: change.id,
    }
  },
}

function newOptionsNote(changes: PropChange[]): string {
  const fresh = changes.filter((c) => c.newOptions?.length)
  return fresh.length ? ` New options will be created: ${fresh.map((c) => `${c.name}: ${c.newOptions!.map(q).join(', ')}`).join('; ')}.` : ''
}

const updateRow: AgentTool = {
  name: 'update_row',
  write: true,
  description:
    'Stage new property values for an existing database row (or a row staged earlier). Pass only the properties to change, by exact property name, as plain JSON values (see create_row). To rename a row use set_page_title.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Row id (from query_database).' },
      properties: { type: 'object', description: 'Property name → new value.', additionalProperties: true },
    },
    required: ['id', 'properties'],
    additionalProperties: false,
  },
  run(input, stage) {
    const rawId = str(input, 'id', { required: true, max: 80 }).trim()
    if (!input.properties || typeof input.properties !== 'object' || !Object.keys(input.properties).length) throw new ToolInputError('"properties" must name at least one property to change.')
    const staged = stagedCreate(stage, rawId)
    if (staged && staged.kind === 'create_row' && staged.status === 'pending') {
      const schema = schemaOf(stage, staged.databaseId!)
      const res = coerceProperties(schema.db, input.properties, null)
      if (!res.ok) throw new ToolInputError(res.error)
      const needs = needsOf(schema, res.changes, staged.needs)
      const c = stage.update(staged.id, { props: mergeProps(staged.props, res.changes), ...(needs.length ? { needs } : {}) })
      return { content: `Updated staged row #${c.n} (${q(c.title ?? '')}).${newOptionsNote(res.changes)}`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
    }
    const row = pageOrThrow(stage, rawId)
    if (!row.databaseId) throw new ToolInputError(`${q(titleOf(row))} is not a database row. Only rows have properties; use set_page_title or append_to_page for pages.`)
    const schema = schemaOf(stage, row.databaseId)
    const db = schema.db
    const res = coerceProperties(db, input.properties, row)
    if (!res.ok) throw new ToolInputError(res.error)
    const changed = res.changes.filter((c) => c.before !== c.after || c.newOptions?.length)
    if (!changed.length) return { content: `No change: ${q(titleOf(row))} already has these values.`, summary: t('features.agent.res.same'), state: 'ok' }
    const pending = pendingFor(stage, 'update_row', row.id)
    const needs = needsOf(schema, changed, pending?.needs)
    const c = pending
      ? stage.update(pending.id, { props: mergeProps(pending.props, changed), ...(needs.length ? { needs } : {}) })
      : stage.add({ kind: 'update_row', pageId: row.id, databaseId: db.id, title: titleOf(row), props: changed, ...(needs.length ? { needs } : {}) })
    return {
      content: `${stagedNote(c)} ${q(titleOf(row))}: ${changed.map((x) => `${x.name} ${q(x.before)} → ${q(x.after)}`).join(', ')}.${newOptionsNote(changed)}`,
      summary: t('features.agent.res.staged', { n: c.n }),
      state: 'staged',
      changeId: c.id,
    }
  },
}

const setPageTitle: AgentTool = {
  name: 'set_page_title',
  write: true,
  description: 'Stage a new title for a page or database row (or for a page or row staged earlier).',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page or row id.' },
      title: { type: 'string', description: 'The new title.' },
    },
    required: ['id', 'title'],
    additionalProperties: false,
  },
  run(input, stage) {
    const rawId = str(input, 'id', { required: true, max: 80 }).trim()
    const title = str(input, 'title', { required: true, max: 300 }).replace(/\s+/g, ' ').trim()
    if (!title) throw new ToolInputError('"title" must not be empty.')
    const staged = stagedCreate(stage, rawId)
    if (staged && staged.status === 'pending') {
      const c = stage.update(staged.id, { title })
      return { content: `Renamed staged change #${c.n} to ${q(title)}.`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
    }
    const p = pageOrThrow(stage, rawId)
    if (p.title.trim() === title) return { content: `No change: the title already is ${q(title)}.`, summary: t('features.agent.res.same'), state: 'ok' }
    const pending = pendingFor(stage, 'rename', p.id)
    const c = pending ? stage.update(pending.id, { title }) : stage.add({ kind: 'rename', pageId: p.id, beforeTitle: p.title.trim() || untitled(), title })
    return { content: `${stagedNote(c)} ${q(titleOf(p))} → ${q(title)}.`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
  },
}

/* ---------- databases (the terminal's agent only: not part of AGENT_TOOLS) ---------- */

const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'select', 'multi_select', 'date', 'url', 'checkbox']
/** Column types a board can group by. */
const GROUPABLE: ColumnType[] = ['select', 'multi_select', 'checkbox']
export const MAX_COLUMNS = 20
const MAX_OPTIONS = 50

const TYPE_ALIASES: Record<string, ColumnType> = { string: 'text', multiselect: 'multi_select', boolean: 'checkbox', bool: 'checkbox', link: 'url' }

/** One column Claude asked for, validated. `taken`: names in use (lower case). */
function columnOf(raw: unknown, taken: string[], where: string): ColumnSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolInputError(`${where} must be an object with "name" and "type".`)
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new ToolInputError(`${where}: "name" is missing.`)
  if (name.length > 60) throw new ToolInputError(`${where}: the name ${q(name)} is too long (at most 60 characters).`)
  if (taken.includes(name.toLowerCase())) throw new ToolInputError(`${where}: there is already a property named ${q(name)}${name.toLowerCase() === TITLE_NAME.toLowerCase() ? ' (the title column: set it with the row title)' : ''}.`)
  const rawType = typeof o.type === 'string' ? o.type.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
  const type = (COLUMN_TYPES as string[]).includes(rawType) ? (rawType as ColumnType) : TYPE_ALIASES[rawType.replace(/_/g, '')]
  if (!type) throw new ToolInputError(`${where}: unknown type ${q(String(o.type ?? ''))}. Use one of: ${COLUMN_TYPES.join(', ')}.`)
  const col: ColumnSpec = { id: newId(), name, type }
  if (type === 'select' || type === 'multi_select') {
    const list = Array.isArray(o.options) ? o.options : typeof o.options === 'string' ? o.options.split(',') : []
    const names: string[] = []
    for (const x of list) {
      const n = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
      if (n && !names.some((m) => m.toLowerCase() === n.toLowerCase())) names.push(n)
    }
    if (names.length > MAX_OPTIONS) throw new ToolInputError(`${where}: too many options (${names.length}, at most ${MAX_OPTIONS}).`)
    col.options = names
  }
  return col
}

const colLine = (c: ColumnSpec) => `${c.name} (${c.type}${c.options?.length ? `: ${c.options.join(' | ')}` : ''})`

const createDatabase: AgentTool = {
  name: 'create_database',
  write: true,
  description:
    'Stage a new database (a table of rows with typed columns), at the top level or under a page. Use this when the task asks for a new table, board or tracker. The title column "Name" always exists; list the other columns. view "board" shows cards grouped by group_by (a select, multi_select or checkbox column). The returned database id works right away: stage rows with create_row and more columns with add_property. Nothing is created until the user applies it.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Database title, e.g. "Open items".' },
      parent_id: { type: 'string', description: 'Id of the page to put the database under. Omit for a top-level database.' },
      columns: {
        type: 'array',
        description: `Columns besides the title column "Name" (at most ${MAX_COLUMNS}).`,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: COLUMN_TYPES },
            options: { type: 'array', items: { type: 'string' }, description: 'select / multi_select: the option names.' },
          },
          required: ['name', 'type'],
          additionalProperties: false,
        },
      },
      view: { type: 'string', enum: ['table', 'board'], description: 'The first view (default table).' },
      group_by: { type: 'string', description: 'Column name to group by: required for a board (a select, multi_select or checkbox column), optional for a table.' },
    },
    required: ['title', 'columns'],
    additionalProperties: false,
  },
  run(input, stage) {
    const title = str(input, 'title', { required: true, max: 200 }).replace(/\s+/g, ' ').trim()
    if (!title) throw new ToolInputError('"title" must not be empty.')
    const parentRaw = str(input, 'parent_id', { max: 80 }).trim()
    const parent = parentRaw ? parentOf(stage, parentRaw) : null
    const raw = input.columns ?? []
    if (!Array.isArray(raw)) throw new ToolInputError('"columns" must be a list of {"name", "type"} objects.')
    if (raw.length > MAX_COLUMNS) throw new ToolInputError(`Too many columns (${raw.length}, at most ${MAX_COLUMNS}).`)
    const taken = [TITLE_NAME.toLowerCase()]
    const columns = raw.map((c, i) => {
      const col = columnOf(c, taken, `columns[${i}]`)
      taken.push(col.name.toLowerCase())
      return col
    })
    const viewRaw = str(input, 'view', { max: 20 }).trim().toLowerCase() || 'table'
    if (viewRaw !== 'table' && viewRaw !== 'board') throw new ToolInputError(`Unknown view ${q(viewRaw)}. Use "table" or "board".`)
    const view = viewRaw as 'table' | 'board'
    const groupRaw = str(input, 'group_by', { max: 60 }).trim()
    let group: ColumnSpec | undefined
    if (groupRaw) {
      group = columns.find((c) => c.name.toLowerCase() === groupRaw.toLowerCase())
      if (!group) throw new ToolInputError(`group_by: no column named ${q(groupRaw)}. Columns: ${columns.map((c) => q(c.name)).join(', ') || '(none)'}.`)
      if (!GROUPABLE.includes(group.type)) throw new ToolInputError(`group_by: ${q(group.name)} is a ${group.type} column. Group by a select, multi_select or checkbox column.`)
    } else if (view === 'board') {
      group = columns.find((c) => GROUPABLE.includes(c.type))
      if (!group) throw new ToolInputError('A board groups its cards by a select, multi_select or checkbox column: add one (e.g. "Status" as select with its options) or use view "table".')
    }
    const change = stage.add({
      kind: 'create_database',
      pageId: newId(),
      parentId: parent?.id ?? null,
      title,
      columns,
      titlePropId: newId(),
      view,
      groupBy: group?.id ?? null,
      ...(parent?.dependsOn ? { dependsOn: parent.dependsOn } : {}),
    })
    const shown = group ? `${view} grouped by ${q(group.name)}` : view
    return {
      content: `${stagedNote(change)} New database id: ${change.pageId} (${q(title)}, ${parent ? `under ${q(parent.title)}` : 'top level'}). Properties: ${TITLE_NAME} (title)${columns.length ? `; ${columns.map(colLine).join('; ')}` : ''}. View: ${shown}. Stage its rows with create_row (database_id ${change.pageId}).`,
      summary: t('features.agent.res.staged', { n: change.n }),
      state: 'staged',
      changeId: change.id,
    }
  },
}

const addProperty: AgentTool = {
  name: 'add_property',
  write: true,
  description:
    'Stage a new property (column) for a database — an existing one or one staged with create_database. Types: text, number, select, multi_select, date, url, checkbox; select and multi_select take option names. Locked databases refuse new properties. Staged rows can use the property right away.',
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'Database id (from list_databases or create_database).' },
      name: { type: 'string', description: 'Property name.' },
      type: { type: 'string', enum: COLUMN_TYPES },
      options: { type: 'array', items: { type: 'string' }, description: 'select / multi_select: the option names.' },
    },
    required: ['database_id', 'name', 'type'],
    additionalProperties: false,
  },
  run(input, stage) {
    const dbRaw = str(input, 'database_id', { required: true, max: 80 }).trim()
    const spec = { name: input.name, type: input.type, options: input.options }
    const staged = stagedDatabase(stage, dbRaw)
    if (staged) {
      const col = columnOf(spec, [TITLE_NAME.toLowerCase(), ...(staged.columns ?? []).map((c) => c.name.toLowerCase())], 'add_property')
      const c = stage.update(staged.id, { columns: [...(staged.columns ?? []), col] })
      return { content: `Added the property ${colLine(col)} to staged database #${c.n} (${q(c.title ?? '')}).`, summary: t('features.agent.res.staged', { n: c.n }), state: 'staged', changeId: c.id }
    }
    const db = databaseOf(dbRaw)
    const title = titleOf(ws().pages[db.id])
    if (db.locked) throw new ToolInputError(`${q(title)} is locked: its properties cannot be changed (rows stay editable). Use its existing properties: ${db.properties.filter(isSettable).map((p) => q(p.name)).join(', ')}.`)
    const taken = [...db.properties.map((p) => p.name.toLowerCase()), ...stagedProps(stage, db.id).map((c) => c.prop!.name.toLowerCase())]
    const col = columnOf(spec, taken, 'add_property')
    const c = stage.add({ kind: 'add_property', pageId: db.id, databaseId: db.id, title, prop: col })
    return {
      content: `${stagedNote(c)} New property ${colLine(col)} for ${q(title)}; rows you stage can set it already.`,
      summary: t('features.agent.res.staged', { n: c.n }),
      state: 'staged',
      changeId: c.id,
    }
  },
}

/** Stable order: the tool list is part of the cached prompt prefix. */
export const AGENT_TOOLS: AgentTool[] = [searchPages, readPage, listDatabases, queryDatabase, currentPage, createPage, appendToPage, editPage, createRow, updateRow, setPageTitle]

/**
 * The workspace agent's (the AI terminal's) tools: AGENT_TOOLS plus the database tools. Custom
 * agents and the MCP bridge build on AGENT_TOOLS (their scope rules do not cover new databases).
 */
export const TERMINAL_TOOLS: AgentTool[] = [...AGENT_TOOLS, createDatabase, addProperty]

/** Short argument readout for the step log (titles instead of ids). */
export function argLabel(name: ToolName, input: Record<string, unknown>, stage: StageApi): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
  const title = (id: string) => {
    if (!id) return ''
    const staged = stagedCreate(stage, id)
    if (staged) return staged.title ?? ''
    const p = ws().pages[stage.resolve(id)]
    return p ? titleOf(p) : id
  }
  switch (name) {
    case 'search_pages':
      return `“${s('query')}”`
    case 'read_page':
    case 'append_to_page':
    case 'update_row':
      return title(s('id'))
    case 'edit_page': {
      const n = Array.isArray(input.edits) ? input.edits.length : 0
      return `${title(s('id'))}${n ? ` · ${t('features.agent.edits', { count: n })}` : ''}`
    }
    case 'query_database': {
      const n = Array.isArray(input.filters) ? input.filters.length : 0
      return `${title(s('database_id'))}${n ? ` · ${t('features.agent.filters', { count: n })}` : ''}`
    }
    case 'create_page':
    case 'create_row':
    case 'create_database':
      return s('title')
    case 'add_property':
      return `${title(s('database_id'))} · ${s('name')}`
    case 'set_page_title':
      return `${title(s('id'))} → ${s('title')}`
    case 'recall':
      return `“${s('query')}”`
    case 'remember':
      return s('text')
    default:
      return ''
  }
}
