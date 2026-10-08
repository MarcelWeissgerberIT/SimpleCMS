/**
 * The tools a server agent's Claude calls — the app's workspace-agent tools (same names, arguments and
 * kind of answers, src/app/features/ai/agent/tools.ts) implemented over the server's workspace model
 * (api/model.ts, mcp/reads.ts, mcp/writes.ts):
 *
 * - reads see the agent's scope only (scope.ts): never the trash, templates or anyone's private pages;
 * - write mode "stage" turns every write into a StagedChange (stage.ts) kept on the run;
 * - write mode "apply" writes through the public API's own paths, attributed `agent:<agentId>`, so
 *   everyone who has the workspace open sees the change at once (and can undo it from history);
 * - write mode "none" offers no write tools at all.
 * - agent_state_get / agent_state_set: a small JSON state of its own between runs (≤ 4 KB), saved by the service only
 *   when the run ends ok / staged. There is no notify_me here: the inbox is per device (the app makes its items), so a
 *   server agent has no inbox to write to — it says what is new in its report.
 * - upsert_rows and the state tools are offered only while an integration profile of the workspace that matches one
 *   of the runtime's MCP servers unlocks them (integrations.ts: 'upsert', 'agentState'). Keys and "Only by hand" are
 *   enforced by every writer whatever is unlocked.
 *
 * Results are model-facing English text, clipped. A call that cannot be done throws ToolInputError
 * with a message Claude can act on.
 */
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { fragmentMarkdown } from '../api/markdown.ts'
import { type PageInfo, type PropertyDef, type Roots, allPages, liveDatabase, livePage, outOfReach, pageMap, rowsOf } from '../api/meta.ts'
import { contentDoc, findProperty, type WorkspaceModel } from '../api/model.ts'
import type { Services } from '../context.ts'
import { ApiError } from '../errors.ts'
import { FILTER_OPS, type Condition, type FilterOp, encodeCursor } from '../mcp/query.ts'
import type { McpReads } from '../mcp/reads.ts'
import type { McpWrites } from '../mcp/writes.ts'
import { newId } from '../tokens.ts'
import { inScope, redact, valueText } from './scope.ts'
import { ToolInputError, explain, holderText, intentValue, keyConflict, keyHolders, mergeProps, propsInput, settable, stageProps, type KeyHolder } from './stage.ts'
import type { AgentStateRow, ChangeKind, CustomAgent, PropChange, StagedChange } from './types.ts'
import { canBeKey, isHandOnly, keyPropOf, keyText } from '../api/keys.ts'

/** Characters of one page part (read_page) and of any other tool result. */
export const PAGE_PART_CHARS = 12_000
export const RESULT_CHARS = 16_000

export type ToolName =
  | 'search_pages'
  | 'read_page'
  | 'list_databases'
  | 'query_database'
  | 'create_page'
  | 'append_to_page'
  | 'create_row'
  | 'update_row'
  | 'upsert_rows'
  | 'set_page_title'
  | 'agent_state_get'
  | 'agent_state_set'

/** agent_state_set: the JSON text at most (UTF-8 bytes). */
export const STATE_BYTES = 4096

export interface ToolCtx {
  s: Services
  model: WorkspaceModel
  reads: McpReads
  writes: McpWrites
  wsId: string
  agent: CustomAgent
  /** `agent:<agentId>` — createdBy / updatedBy of what this agent writes */
  actor: string
  /** write mode "stage": the run's staged changes */
  staged: StagedChange[]
  /** write mode "apply": changes written */
  applied: number
  /** the agent's own state: as saved before the run, and what this run set (saved when it ends ok) */
  state?: { saved: AgentStateRow | null; pending?: string }
  /** upsert_rows is offered in this run (an integration profile unlocks it): refusals may point to it */
  upsert?: boolean
}

export interface AgentTool {
  name: ToolName
  write: boolean
  description(mode: 'stage' | 'apply' | 'none'): string
  input_schema: BetaTool['input_schema']
  /** the step log's label ("read_page · Kickoff") */
  label(input: Record<string, unknown>): string
  run(input: Record<string, unknown>, ctx: ToolCtx): Promise<string>
}

/* ------------------------------------------------------------------ helpers */

/** Cut a tool result and tell Claude so (and how to get the rest). */
export function clipResult(text: string, max = RESULT_CHARS, hint = 'Narrow the request (filters, a smaller limit) to see the rest.'): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('\n', max)
  const end = cut > max * 0.7 ? cut : max
  return `${text.slice(0, end)}\n[Truncated: showing ${end.toLocaleString('en')} of ${text.length.toLocaleString('en')} characters. ${hint}]`
}

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

const q = (s: string) => JSON.stringify(s)
const titleOf = (p: { title: string } | null | undefined) => p?.title.trim() || 'Untitled'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const kindOf = (p: PageInfo): 'page' | 'database' | 'row' => (p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page')
const read = <T>(ctx: ToolCtx, fn: (r: Roots) => T) => ctx.model.read(ctx.wsId, fn)
const outside = (id: string) => new ToolInputError(`${q(id)} is outside this agent's scope: it may only read and change the pages and databases its scope names (and what is inside them).`)
const noPage = (id: string) => new ToolInputError(`No page with id ${q(id)}. Use search_pages to find page ids.`)

/** "Team wiki / Onboarding" — the page's ancestors inside the scope. */
function scopedPath(r: Roots, ctx: ToolCtx, id: string): string {
  const parts: string[] = []
  const seen = new Set<string>([id])
  let cur = pageMap(r, id)?.get('parentId')
  while (typeof cur === 'string' && cur && !seen.has(cur) && parts.length < 16 && inScope(r, ctx.agent.scope, cur)) {
    seen.add(cur)
    const title = pageMap(r, cur)?.get('title')
    parts.unshift(typeof title === 'string' && title.trim() ? title.trim() : 'Untitled')
    cur = pageMap(r, cur)?.get('parentId')
  }
  return parts.join(' / ')
}

/** The pending staged change that creates a page or row with this id. */
const stagedCreate = (ctx: ToolCtx, id: string) => ctx.staged.find((c) => (c.kind === 'create_page' || c.kind === 'create_row') && c.pageId === id && c.status === 'pending')
const pendingFor = (ctx: ToolCtx, kind: ChangeKind, pageId: string) => ctx.staged.find((c) => c.kind === kind && c.pageId === pageId && c.status === 'pending')

function stage(ctx: ToolCtx, change: Omit<StagedChange, 'id' | 'n' | 'status'>): StagedChange {
  const c: StagedChange = { id: newId(), n: ctx.staged.length + 1, status: 'pending', ...change }
  ctx.staged.push(c)
  return c
}

const stagedNote = (c: StagedChange) => `Staged as change #${c.n}. Nothing is written until a person reviews and applies it.`

/** An existing page in reach and in scope (staged pages are handled by the callers). */
function scopedPage(r: Roots, ctx: ToolCtx, id: string): PageInfo {
  const p = livePage(r, id)
  if (!p) throw noPage(id)
  if (!inScope(r, ctx.agent.scope, id)) throw outside(id)
  return p
}

function scopedDatabase(r: Roots, ctx: ToolCtx, id: string) {
  const db = liveDatabase(r, id)
  if (!db) throw new ToolInputError(`No database with id ${q(id)}. Use list_databases to get database ids.`)
  if (!inScope(r, ctx.agent.scope, id)) throw outside(id)
  return db
}

/** Runs a write through the API's path; its validation errors become messages for Claude. */
async function api<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) throw new ToolInputError(explain(err))
    throw err
  }
}

/* ------------------------------------------------------------------ reads */

const searchPages: AgentTool = {
  name: 'search_pages',
  write: false,
  description: () =>
    'Search the pages, databases and database rows this agent may read, by keywords (titles, text and property values). Call this first to find the pages your job refers to. Returns for each hit: id, kind (page, database or row), title, where it lives, the last-edit date and a text snippet.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords, e.g. "weekly sync notes" or a page title.' },
      limit: { type: 'integer', description: 'Maximum number of results (1–20, default 8).' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  label: (i) => `search_pages · “${typeof i.query === 'string' ? i.query.slice(0, 60) : ''}”`,
  async run(input, ctx) {
    const query = str(input, 'query', { required: true, max: 300 }).trim()
    if (!query) throw new ToolInputError('"query" must not be empty.')
    const limit = int(input, 'limit', 8, 1, 20)
    const found = await ctx.reads.search(ctx.wsId, query, 50)
    const lines = await read(ctx, (r) =>
      found.results
        .filter((h) => inScope(r, ctx.agent.scope, h.id))
        .slice(0, limit)
        .map((h) => {
          const p = livePage(r, h.id)
          const where = p?.databaseId ? `row of database ${q(titleOf(livePage(r, p.databaseId)))}` : scopedPath(r, ctx, h.id) ? `in ${q(scopedPath(r, ctx, h.id))}` : 'top level'
          return `- id: ${h.id} · ${h.kind} · ${q(h.title)} · ${where} · edited ${(h.updatedAt ?? '').slice(0, 10)}${h.snippet ? `\n  ${h.snippet}` : ''}`
        }),
    )
    if (!lines.length) return `No pages match ${q(query)}. Try other keywords, or list_databases for databases.`
    return clipResult(`${lines.length} results for ${q(query)}:\n${lines.join('\n')}`)
  },
}

const readPage: AgentTool = {
  name: 'read_page',
  write: false,
  description: () =>
    'Read one page as Markdown, with its title, location, last-edit date, sub-pages and — for database rows — its property values. Call this before you summarise, quote or change a page. Long pages come in parts: pass the offset given at the end of a part to continue. For a database this returns its schema; use query_database for its rows.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page id (from search_pages, query_database or another tool).' },
      offset: { type: 'integer', description: 'Character offset into the page Markdown (default 0).' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  label: (i) => `read_page · ${typeof i.id === 'string' ? i.id.slice(0, 64) : ''}`,
  async run(input, ctx) {
    const id = str(input, 'id', { required: true, max: 80 }).trim()
    const offset = int(input, 'offset', 0, 0, 10_000_000)
    const staged = stagedCreate(ctx, id)
    if (staged) return `Staged page #${staged.n} (not applied yet) · id: ${id}\n# ${staged.title ?? ''}\n\n${clipResult(staged.markdown ?? '', PAGE_PART_CHARS, '')}`
    const head = await read(ctx, (r) => {
      const p = scopedPage(r, ctx, id)
      const lines = [`# ${titleOf(p)}`, `id: ${p.id} · ${kindOf(p)} · edited ${day(p.updatedAt)} · created ${day(p.createdAt)}`]
      const where = p.databaseId ? `row of database ${q(titleOf(livePage(r, p.databaseId)))} (id: ${p.databaseId})` : scopedPath(r, ctx, p.id) ? `in ${q(scopedPath(r, ctx, p.id))}` : 'top level'
      lines.push(`location: ${where}`)
      if (p.kind === 'database') {
        const db = liveDatabase(r, p.id)
        if (db) lines.push(`database with ${rowsOf(r, p.id).length} rows · properties: ${schemaLine(db.properties, db.ydb.get('locked') === true)}`, 'Use query_database to list its rows.')
      }
      const db = p.databaseId ? liveDatabase(r, p.databaseId) : null
      if (db) {
        const ctxV = ctx.model.context(ctx.wsId, r)
        const props = db.properties.filter((x) => x.type !== 'title').flatMap((x) => {
          const v = x.type === 'relation' ? redactedRelation(r, ctx, x.id, p) : valueText(x, p, ctxV)
          return v ? [`${x.name}: ${v.length > 300 ? `${v.slice(0, 297)}…` : v}`] : []
        })
        if (props.length) lines.push(`properties: ${props.join('; ')}`)
      }
      const kids = allPages(r)
        .filter((c) => c.parentId === p.id && !c.databaseId && !outOfReach(r, c.id))
        .sort((a, b) => a.order - b.order)
      if (kids.length) lines.push(`sub-pages: ${kids.slice(0, 40).map((c) => `${q(titleOf(c))} (id: ${c.id})`).join(', ')}${kids.length > 40 ? ` and ${kids.length - 40} more` : ''}`)
      // links and mentions in the content show titles of pages in scope only ("No access" otherwise)
      const titles = new Map<string, string | null>()
      for (const pid of r.pages.keys()) {
        const t = pageMap(r, pid)?.get('title')
        titles.set(pid, inScope(r, ctx.agent.scope, pid) ? (typeof t === 'string' && t.trim() ? t.trim() : 'Untitled') : null)
      }
      return { lines, titles, isDatabase: p.kind === 'database' }
    })
    if (head.isDatabase) return head.lines.join('\n')
    const md = (await ctx.s.collab.read(contentDoc(ctx.wsId, id), (doc) => fragmentMarkdown(doc, { title: (pid) => head.titles.get(pid) ?? null }))).markdown.trim()
    const part = md.slice(offset, offset + PAGE_PART_CHARS)
    let body = md ? part : '(empty page)'
    if (offset && !part) body = `(offset ${offset} is past the end: the page has ${md.length} characters)`
    if (offset + PAGE_PART_CHARS < md.length) body += `\n[Part ${offset}–${offset + part.length} of ${md.length} characters. Call read_page with offset ${offset + part.length} for the rest.]`
    return `${head.lines.join('\n')}\n\n${body}`
  },
}

/** A row's relation cell with the titles of rows outside the scope left out. */
function redactedRelation(r: Roots, ctx: ToolCtx, propId: string, row: PageInfo): string {
  const ids = Array.isArray(row.properties[propId]) ? (row.properties[propId] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return ids
    .flatMap((rid) => {
      const yp = pageMap(r, rid)
      if (!yp) return []
      if (!inScope(r, ctx.agent.scope, rid)) return [`(outside this agent’s scope, id ${rid})`]
      const t = yp.get('title')
      return [typeof t === 'string' && t.trim() ? t.trim() : 'Untitled']
    })
    .join(', ')
}

function schemaLine(props: PropertyDef[], locked: boolean): string {
  const key = keyPropOf(props)
  return props
    .map((p) => {
      const opts = p.options?.length ? `: ${p.options.map((o) => o.name).join(' | ')}` : ''
      const ro = p.type === 'title' || settable(p) ? '' : ', read-only'
      // the database's key (unique per row) · "Only by hand" (api/keys.ts) — the app's list_databases says the same
      const marks = `${key?.id === p.id ? ', key: unique per row' : ''}${isHandOnly(p) ? ', read-only for agents (only by hand)' : ''}`
      return `${p.name} (${p.type}${ro}${marks}${opts})`
    })
    .join('; ')
    .concat(locked ? ' · locked (rows can be added and changed; no new options)' : '')
}

const listDatabases: AgentTool = {
  name: 'list_databases',
  write: false,
  description: () =>
    'List every database this agent may read, with its id, number of rows, location and property schema (property names, types and allowed options). Call this before query_database, create_row or update_row so you use exact property and option names.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  label: () => 'list_databases',
  async run(_input, ctx) {
    const lines = await read(ctx, (r) => {
      const out: string[] = []
      for (const id of r.databases.keys()) {
        const db = liveDatabase(r, id)
        if (!db || !inScope(r, ctx.agent.scope, id)) continue
        const where = scopedPath(r, ctx, id)
        out.push(`- ${q(titleOf(db.page))} (id: ${id}) · ${rowsOf(r, id).length} rows${where ? ` · in ${q(where)}` : ''}\n  properties: ${schemaLine(db.properties, db.ydb.get('locked') === true)}`)
      }
      return out
    })
    if (!lines.length) return 'This agent can see no databases.'
    return clipResult(`${lines.length} databases:\n${lines.join('\n')}`)
  },
}

const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte']

const queryDatabase: AgentTool = {
  name: 'query_database',
  write: false,
  description: () =>
    'List the rows of a database with their property values (option names, ISO dates, people, related rows) and their ids. Optional filters compare a property, case-insensitive; all filters must match. Operators: equals, not_equals, contains, not_contains, is_empty, is_not_empty, gt, gte, lt, lte (numbers and dates "YYYY-MM-DD"). Use this instead of reading rows one by one. Page through large databases with limit and offset.',
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
            property: { type: 'string', description: 'Exact property name ("title" for the title, "createdAt" / "updatedAt" for the timestamps).' },
            operator: { type: 'string', enum: OPERATORS },
            value: { type: 'string', description: 'Value to compare with (not needed for is_empty / is_not_empty).' },
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
  label: (i) => `query_database · ${typeof i.database_id === 'string' ? i.database_id.slice(0, 64) : ''}`,
  async run(input, ctx) {
    const id = str(input, 'database_id', { required: true, max: 80 }).trim()
    const title = await read(ctx, (r) => titleOf(scopedDatabase(r, ctx, id).page))
    const raw = input.filters
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new ToolInputError('"filters" must be a list.')
    const filter: Condition[] = ((raw as unknown[] | null | undefined) ?? []).slice(0, 20).map((f) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
      const op = (typeof o.operator === 'string' ? o.operator : o.op) as FilterOp
      if (typeof op !== 'string' || !(FILTER_OPS as readonly string[]).includes(op)) throw new ToolInputError(`Unknown operator ${q(String(o.operator ?? o.op))}. Use one of: ${OPERATORS.join(', ')}.`)
      if (typeof o.property !== 'string' || !o.property.trim()) throw new ToolInputError('Every filter needs a "property".')
      return { property: o.property, op, ...(o.value !== undefined ? { value: o.value } : {}) }
    })
    const limit = int(input, 'limit', 50, 1, 100)
    const offset = int(input, 'offset', 0, 0, 1_000_000)
    const fingerprint = JSON.stringify([id, filter, []])
    const res = await api(() => ctx.reads.queryDatabase(ctx.wsId, { databaseId: id, filter, sort: [], limit, cursor: offset ? encodeCursor(offset, fingerprint) : undefined }))
    const rows = await read(ctx, (r) => res.rows.map((row) => ({ id: row.id, title: row.title, ...Object.fromEntries(Object.entries(row.properties).map(([k, v]) => [k, redact(r, ctx.agent.scope, v)])) })))
    const head = `Database ${q(title)} (id: ${id}): ${res.total} rows match${filter.length ? ' the filters' : ''}. Showing ${rows.length ? `${offset + 1}–${offset + rows.length}` : 'none'}.`
    const more = res.next ? `\n[More rows: call again with offset ${offset + rows.length}.]` : ''
    return clipResult(`${head}\n${rows.map((r) => JSON.stringify(r)).join('\n')}${more}`)
  },
}

/* ------------------------------------------------------------------ writes */

const verb = (mode: string, staged: string, direct: string) => (mode === 'apply' ? direct : staged)

const createPage: AgentTool = {
  name: 'create_page',
  write: true,
  description: (mode) =>
    verb(
      mode,
      'Stage a new page with a title and Markdown content under a parent page. Use this for new documents such as summaries, reports or notes — not for database rows (use create_row). The page is created only when a person applies the change, but the returned id works right away for later calls (append_to_page, or as parent_id).',
      'Create a new page with a title and Markdown content under a parent page, at once (attributed to this agent). Use this for new documents such as summaries, reports or notes — not for database rows (use create_row).',
    ),
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page title.' },
      markdown: { type: 'string', description: 'Page content as Markdown.' },
      parent_id: { type: 'string', description: 'Id of the parent page. Omit for a top-level page (only when the scope is the whole workspace).' },
    },
    required: ['title', 'markdown'],
    additionalProperties: false,
  },
  label: (i) => `create_page · ${typeof i.title === 'string' ? i.title.slice(0, 80) : ''}`,
  async run(input, ctx) {
    const title = str(input, 'title', { required: true, max: 500 }).trim()
    const markdown = str(input, 'markdown', { max: 200_000 })
    const parentRaw = str(input, 'parent_id', { max: 80 }).trim()
    const stagedParent = parentRaw ? stagedCreate(ctx, parentRaw) : undefined
    if (stagedParent && stagedParent.kind !== 'create_page') throw new ToolInputError(`Staged change #${stagedParent.n} is a database row: create pages under pages.`)
    const parent = stagedParent
      ? { id: stagedParent.pageId, title: stagedParent.title ?? '' }
      : await read(ctx, (r) => {
          if (!parentRaw) {
            if (!ctx.agent.scope.everything) throw new ToolInputError('This agent may not create top-level pages: give parent_id, a page inside its scope.')
            return null
          }
          const p = scopedPage(r, ctx, parentRaw)
          if (p.kind === 'database') throw new ToolInputError(`${q(titleOf(p))} is a database. Use create_row to add rows to it.`)
          return { id: p.id, title: titleOf(p) }
        })
    if (ctx.agent.write === 'apply') {
      const created = await api(() => ctx.model.createPage(ctx.wsId, { title, parentId: parent?.id ?? null, content: markdown }, ctx.actor))
      ctx.applied++
      return `Created page ${q(title)} (id: ${created.id})${parent ? ` under ${q(parent.title)}` : ' at the top level'}.`
    }
    const c = stage(ctx, { kind: 'create_page', pageId: newId(), parentId: parent?.id ?? null, title, markdown, ...(stagedParent ? { dependsOn: stagedParent.id } : {}) })
    return `${stagedNote(c)} New page id: ${c.pageId}${parent ? ` (under ${q(parent.title)})` : ' (top level)'}.`
  },
}

const appendToPage: AgentTool = {
  name: 'append_to_page',
  write: true,
  description: (mode) =>
    verb(
      mode,
      'Stage Markdown to add at the end of an existing page (or of a page staged earlier). Use this to add a section, a list or action items to a page without changing what is already there.',
      'Add Markdown at the end of an existing page, at once. Use this to add a section, a list or action items to a page without changing what is already there.',
    ),
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page id.' },
      markdown: { type: 'string', description: 'Markdown to add at the end of the page.' },
    },
    required: ['id', 'markdown'],
    additionalProperties: false,
  },
  label: (i) => `append_to_page · ${typeof i.id === 'string' ? i.id.slice(0, 64) : ''}`,
  async run(input, ctx) {
    const id = str(input, 'id', { required: true, max: 80 }).trim()
    const markdown = str(input, 'markdown', { required: true, max: 200_000 }).trim()
    if (!markdown) throw new ToolInputError('"markdown" must not be empty.')
    const staged = stagedCreate(ctx, id)
    if (staged) {
      staged.markdown = [staged.markdown?.trim(), markdown].filter(Boolean).join('\n\n')
      return `Added to staged change #${staged.n} (the new page ${q(staged.title ?? '')}).`
    }
    const p = await read(ctx, (r) => scopedPage(r, ctx, id))
    if (p.kind === 'database') throw new ToolInputError(`${q(titleOf(p))} is a database. Use create_row to add rows.`)
    if (ctx.agent.write === 'apply') {
      await api(() => ctx.writes.updatePage(ctx.wsId, { id, markdown, mode: 'append' }, ctx.actor))
      ctx.applied++
      return `Added ${markdown.length} characters at the end of ${q(titleOf(p))}.`
    }
    const pending = pendingFor(ctx, 'append', id)
    if (pending) pending.markdown = `${pending.markdown}\n\n${markdown}`
    const c = pending ?? stage(ctx, { kind: 'append', pageId: id, title: titleOf(p), markdown })
    return `${stagedNote(c)} It adds ${markdown.length} characters at the end of ${q(titleOf(p))}.`
  },
}

const VALUES =
  'Values are plain JSON — text, numbers, true/false, option names (a list for multi-select), dates as "YYYY-MM-DD" (or "YYYY-MM-DDTHH:mm", or {"start", "end"}), people by name or email, relations by row title or id.'

const createRow: AgentTool = {
  name: 'create_row',
  write: true,
  description: (mode) =>
    verb(
      mode,
      `Stage a new row in a database: its title, property values by exact property name (see list_databases) and optional Markdown content for the row's page. ${VALUES} If a value does not fit, nothing is staged and the error says why.`,
      `Add a new row to a database at once: its title, property values by exact property name (see list_databases) and optional Markdown content for the row's page. ${VALUES} If a value does not fit, nothing is written and the error says why.`,
    ),
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'Database id from list_databases.' },
      title: { type: 'string', description: 'Row title.' },
      properties: { type: 'object', description: 'Property name → value.', additionalProperties: true },
      markdown: { type: 'string', description: "Optional content of the row's page, as Markdown." },
    },
    required: ['database_id', 'title'],
    additionalProperties: false,
  },
  label: (i) => `create_row · ${typeof i.title === 'string' ? i.title.slice(0, 80) : ''}`,
  async run(input, ctx) {
    const dbId = str(input, 'database_id', { required: true, max: 80 }).trim()
    const title = str(input, 'title', { required: true, max: 500 }).trim()
    const markdown = str(input, 'markdown', { max: 200_000 })
    const props = input.properties
    if (props !== undefined && props !== null && (typeof props !== 'object' || Array.isArray(props))) throw new ToolInputError('"properties" must be an object: property name → value.')
    if (ctx.agent.write === 'apply') {
      const dbTitle = await read(ctx, (r) => titleOf(scopedDatabase(r, ctx, dbId).page))
      const row = await api(() => ctx.writes.prepareRow(ctx.wsId, { databaseId: dbId }, { title, properties: (props as Record<string, unknown> | undefined) ?? {} }, ctx.actor, { agent: true }))
      const created = await api(() => ctx.model.createRow(ctx.wsId, dbId, { title: row.title ?? title, properties: row.properties, content: markdown || undefined }, ctx.actor, { agent: true }))
      ctx.applied++
      return `Created row ${q(row.title ?? title)} (id: ${created.id}) in ${q(dbTitle)}.`
    }
    const { changes, dbTitle } = await read(ctx, (r) => {
      const db = scopedDatabase(r, ctx, dbId)
      const changes = stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, null, props, ctx.model.context(ctx.wsId, r))
      const clash = keyConflict(r, ctx.staged, dbId, db.properties, changes, null, ctx.upsert === true)
      if (clash) throw new ToolInputError(clash)
      return { dbTitle: titleOf(db.page), changes }
    })
    const c = stage(ctx, { kind: 'create_row', pageId: newId(), databaseId: dbId, title, props: changes, ...(markdown.trim() ? { markdown } : {}) })
    return `${stagedNote(c)} New row id: ${c.pageId} in ${q(dbTitle)}${changes.length ? ` with ${changes.map((x) => `${x.name} = ${q(x.after)}`).join(', ')}` : ''}.${newOptionsNote(changes)}`
  },
}

function newOptionsNote(changes: Array<{ name: string; newOptions?: string[] }>): string {
  const fresh = changes.filter((c) => c.newOptions?.length)
  return fresh.length ? ` New options will be created: ${fresh.map((c) => `${c.name}: ${c.newOptions!.map(q).join(', ')}`).join('; ')}.` : ''
}

const updateRow: AgentTool = {
  name: 'update_row',
  write: true,
  description: (mode) =>
    verb(
      mode,
      `Stage new property values for an existing database row (or a row staged earlier). Pass only the properties to change, by exact property name. ${VALUES} To rename a row use set_page_title.`,
      `Set new property values on an existing database row at once. Pass only the properties to change, by exact property name. ${VALUES} To rename a row use set_page_title.`,
    ),
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Row id (from query_database).' },
      properties: { type: 'object', description: 'Property name → new value.', additionalProperties: true },
    },
    required: ['id', 'properties'],
    additionalProperties: false,
  },
  label: (i) => `update_row · ${typeof i.id === 'string' ? i.id.slice(0, 64) : ''}`,
  async run(input, ctx) {
    const id = str(input, 'id', { required: true, max: 80 }).trim()
    const props = input.properties
    if (!props || typeof props !== 'object' || Array.isArray(props) || !Object.keys(props).length) throw new ToolInputError('"properties" must name at least one property to change.')
    const staged = stagedCreate(ctx, id)
    if (staged?.kind === 'create_row' && staged.databaseId) {
      const changes = await read(ctx, (r) => {
        const db = scopedDatabase(r, ctx, staged.databaseId!)
        const changes = stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, null, props, ctx.model.context(ctx.wsId, r))
        const clash = keyConflict(r, ctx.staged, staged.databaseId!, db.properties, changes, staged.pageId, ctx.upsert === true)
        if (clash) throw new ToolInputError(clash)
        return changes
      })
      staged.props = mergeProps(staged.props, changes)
      return `Updated staged row #${staged.n} (${q(staged.title ?? '')}).${newOptionsNote(changes)}`
    }
    if (ctx.agent.write === 'apply') {
      const title = await read(ctx, (r) => {
        const row = scopedPage(r, ctx, id)
        if (!row.databaseId) throw new ToolInputError(`${q(titleOf(row))} is not a database row. Only rows have properties; use set_page_title or append_to_page for pages.`)
        return titleOf(row)
      })
      const row = await api(() => ctx.writes.prepareRow(ctx.wsId, { rowId: id }, { properties: props as Record<string, unknown> }, ctx.actor, { agent: true }))
      await api(() => ctx.model.updateRow(ctx.wsId, id, { title: row.title, properties: row.properties }, ctx.actor, { agent: true }))
      ctx.applied++
      return `Updated ${q(title)}: ${Object.keys(props).map(q).join(', ')}.`
    }
    const { row, changed, dbId } = await read(ctx, (r) => {
      const row = scopedPage(r, ctx, id)
      if (!row.databaseId) throw new ToolInputError(`${q(titleOf(row))} is not a database row. Only rows have properties; use set_page_title or append_to_page for pages.`)
      const db = scopedDatabase(r, ctx, row.databaseId)
      const changes = stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, row, props, ctx.model.context(ctx.wsId, r))
      const clash = keyConflict(r, ctx.staged, db.page.id, db.properties, changes, row.id, ctx.upsert === true)
      if (clash) throw new ToolInputError(clash)
      return { row, dbId: db.page.id, changed: changes.filter((c) => c.before !== c.after || c.newOptions?.length) }
    })
    if (!changed.length) return `No change: ${q(titleOf(row))} already has these values.`
    const pending = pendingFor(ctx, 'update_row', row.id)
    if (pending) pending.props = mergeProps(pending.props, changed)
    const c = pending ?? stage(ctx, { kind: 'update_row', pageId: row.id, databaseId: dbId, title: titleOf(row), props: changed })
    return `${stagedNote(c)} ${q(titleOf(row))}: ${changed.map((x) => `${x.name} ${q(x.before)} → ${q(x.after)}`).join(', ')}.${newOptionsNote(changed)}`
  },
}

/* ------------------------------------------------------------------ upsert_rows (the app's twin, agent/tools.ts) */

/** Rows one upsert_rows call may write or stage. */
export const MAX_UPSERT_ROWS = 50

type UpsertAction = 'created' | 'updated' | 'unchanged' | 'refused'

interface UpsertResult {
  key: string
  id?: string
  action: UpsertAction
  reason?: string
  /** write mode "stage": the staged change (#n) that creates or changes the row */
  change?: number
  /** a body for a row whose page has content already: left as it is */
  body?: 'kept'
}

interface UpsertItem {
  key: string | number
  title: string | null
  props: Record<string, unknown>
  body: string
}

function upsertItem(item: unknown, where: string): UpsertItem {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ToolInputError(`${where} must be an object with "key".`)
  const o = item as Record<string, unknown>
  try {
    const key = o.key
    if ((typeof key !== 'string' && typeof key !== 'number') || (typeof key === 'string' && !key.trim()) || (typeof key === 'number' && !Number.isFinite(key))) throw new ToolInputError('"key" must be a non-empty string or a number.')
    const title = str(o, 'title', { max: 500 }).replace(/\s+/g, ' ').trim() || null
    const props = o.properties
    if (props !== undefined && props !== null && (typeof props !== 'object' || Array.isArray(props))) throw new ToolInputError('"properties" must be an object: property name → value.')
    return { key, title, props: (props as Record<string, unknown> | null | undefined) ?? {}, body: str(o, 'body', { max: 100_000 }).trim() }
  } catch (e) {
    throw new ToolInputError(`${where}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const reasonOf = (error: string) => error.replace(/ Nothing was staged\./, '')

/** What one row of an upsert_rows call does, decided on the workspace as it is now. */
type UpsertPlan =
  | { kind: 'refused'; reason: string; id?: string }
  | { kind: 'create'; changes: PropChange[]; title: string }
  | { kind: 'merge'; prev: StagedChange; fresh: PropChange[]; title: string | null; body: string | null }
  | { kind: 'update'; row: PageInfo; changed: PropChange[]; pending?: StagedChange; title: string | null; body: string | null; kept: boolean }

const upsertRows: AgentTool = {
  name: 'upsert_rows',
  write: true,
  description: (mode) =>
    `${verb(mode, 'Mirror items (of another system, a list, a feed …) into a database in ONE call', 'Mirror items (of another system, a list, a feed …) into a database at once, in ONE call')} — at most ${MAX_UPSERT_ROWS} rows — by their key: the value of key_property that identifies an item (its number, code or address). Per row: when a row with that key exists${mode === 'apply' ? '' : ' (also one staged earlier in this run)'}, only the values that differ are ${verb(mode, 'staged as its update', 'written')} (title included); otherwise a new row is ${verb(mode, 'staged', 'added')}. key_property: the database's key (list_databases marks it "key: unique per row"), else another text, number or url property. Properties marked "read-only for agents" are filled in only by hand: leave them out (a row that sets one is refused). body: Markdown for the page of a new row (an existing row's page gets it only while empty). Answers per row: key, id, action (created, updated, unchanged or refused) and the reason of a refusal.`,
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'Database id from list_databases.' },
      key_property: { type: 'string', description: "Exact name of the property that identifies a row (text, number or url) — the database's key when it has one." },
      rows: {
        type: 'array',
        description: `The items, in order (1–${MAX_UPSERT_ROWS}).`,
        items: {
          type: 'object',
          properties: {
            key: { type: ['string', 'number'], description: 'The value of key_property for this item, e.g. "8215".' },
            title: { type: 'string', description: 'Row title.' },
            properties: { type: 'object', description: 'Property name → value, as for create_row (not the key property: that is "key").', additionalProperties: true },
            body: { type: 'string', description: "Markdown for a new row's page." },
          },
          required: ['key'],
          additionalProperties: false,
        },
      },
    },
    required: ['database_id', 'key_property', 'rows'],
    additionalProperties: false,
  },
  label: (i) => `upsert_rows · ${Array.isArray(i.rows) ? i.rows.length : 0} rows`,
  async run(input, ctx) {
    const dbId = str(input, 'database_id', { required: true, max: 80 }).trim()
    const keyName = str(input, 'key_property', { required: true, max: 120 }).trim()
    const raw = input.rows
    if (!Array.isArray(raw) || !raw.length) throw new ToolInputError('"rows" must list at least one row ({"key", "title", "properties"}).')
    if (raw.length > MAX_UPSERT_ROWS) throw new ToolInputError(`Too many rows (${raw.length}, at most ${MAX_UPSERT_ROWS} per call). Send the first ${MAX_UPSERT_ROWS}, then the rest with a second upsert_rows call.`)
    const items = raw.map((item, i) => upsertItem(item, `rows[${i}]`))
    const apply = ctx.agent.write === 'apply'
    const { keyProp, dbTitle, holders } = await read(ctx, (r) => {
      const db = scopedDatabase(r, ctx, dbId)
      const dbKey = keyPropOf(db.properties)
      const keyProp = findProperty(db.properties, keyName)
      if (!keyProp) throw new ToolInputError(`Unknown property ${q(keyName)}. ${dbKey ? `This database's key is ${q(dbKey.name)}.` : `Text, number and url properties: ${db.properties.filter(canBeKey).map((p) => q(p.name)).join(', ') || '(none)'}.`}`)
      if (!canBeKey(keyProp)) throw new ToolInputError(`${q(keyProp.name)} is a ${keyProp.type} property: a key is a text, number or url property.${dbKey ? ` This database's key is ${q(dbKey.name)}.` : ''}`)
      return { keyProp, dbTitle: titleOf(db.page), holders: keyHolders(r, ctx.staged, dbId, keyProp) }
    })

    const plan = (r: Roots, item: UpsertItem): UpsertPlan & { key: string } => {
      const db = scopedDatabase(r, ctx, dbId)
      const shape = { properties: db.properties, locked: db.ydb.get('locked') === true }
      const vctx = ctx.model.context(ctx.wsId, r)
      let keyChange: PropChange | null = null
      let keyError = ''
      try {
        keyChange = stageProps(r, shape, null, { [keyProp.id]: item.key }, vctx)[0] ?? null
      } catch (e) {
        if (!(e instanceof ToolInputError)) throw e
        keyError = e.message
      }
      const kRaw = keyText(keyProp.type, item.key)
      const key = (keyChange ? keyText(keyProp.type, intentValue(keyChange)) : '') || kRaw
      const refuse = (reason: string, id?: string) => ({ key, kind: 'refused' as const, reason: reasonOf(reason), ...(id ? { id } : {}) })
      // the key goes in "key"; in "properties" only with the same value
      const props: Record<string, unknown> = {}
      for (const [name, v] of Object.entries(item.props)) {
        if (findProperty(db.properties, name)?.id !== keyProp.id) props[name] = v
        else if (keyText(keyProp.type, v) !== key && keyText(keyProp.type, v) !== kRaw) return refuse(`"properties" sets ${q(keyProp.name)} to another value than "key": give the key once, as "key".`)
      }
      const found = holders.get(key) ?? (kRaw !== key ? holders.get(kRaw) : undefined) ?? []
      if (found.length > 1) return refuse(`${found.length} rows have this key (${found.map(holderText).join('; ')}): it does not identify one row. Make it unique first, or update the row you mean with update_row.`)
      const h: KeyHolder | undefined = found[0]
      try {
        if (!h) {
          if (!keyChange) return refuse(keyError || `"key" does not fit ${q(keyProp.name)}.`)
          const changes = [keyChange, ...stageProps(r, shape, null, props, vctx)]
          const clash = keyConflict(r, ctx.staged, dbId, db.properties, changes, null)
          if (clash) return refuse(clash)
          return { key, kind: 'create', changes, title: item.title ?? key }
        }
        if (h.change?.kind === 'create_row') {
          const prev = h.change
          const fresh = stageProps(r, shape, null, props, vctx).filter((pc) => {
            const old = prev.props?.find((x) => x.propId === pc.propId)
            return !old || old.after !== pc.after || !!pc.newOptions?.length
          })
          const clash = keyConflict(r, ctx.staged, dbId, db.properties, fresh, prev.pageId)
          if (clash) return refuse(clash, prev.pageId)
          return { key, kind: 'merge', prev, fresh, title: item.title && item.title !== (prev.title ?? '').trim() ? item.title : null, body: item.body && item.body !== (prev.markdown ?? '').trim() ? item.body : null }
        }
        const row = livePage(r, h.id)
        if (!row || !inScope(r, ctx.agent.scope, h.id)) return refuse("The row with this key is outside this agent's scope.", h.id)
        const pending = apply ? undefined : pendingFor(ctx, 'update_row', row.id)
        const changed = stageProps(r, shape, row, props, vctx).filter((pc) => {
          const staged = pending?.props?.find((x) => x.propId === pc.propId)
          return staged ? staged.after !== pc.after || !!pc.newOptions?.length : pc.before !== pc.after || !!pc.newOptions?.length
        })
        const clash = keyConflict(r, ctx.staged, dbId, db.properties, changed, row.id)
        if (clash) return refuse(clash, row.id)
        // the person's page is never written over: a body goes only into an empty page
        const empty = !String(pageMap(r, row.id)?.get('plain') ?? '').trim()
        return { key, kind: 'update', row, changed, pending, title: item.title && item.title !== row.title.trim() ? item.title : null, body: item.body && empty ? item.body : null, kept: !!item.body && !empty }
      } catch (e) {
        if (e instanceof ToolInputError) return refuse(e.message, h?.id)
        throw e
      }
    }

    const one = async (item: UpsertItem): Promise<UpsertResult> => {
      const p = await read(ctx, (r) => plan(r, item))
      const key = p.key
      if (p.kind === 'refused') return { key, ...(p.id ? { id: p.id } : {}), action: 'refused', reason: p.reason }
      try {
        if (p.kind === 'create') {
          if (apply) {
            const row = await ctx.writes.prepareRow(ctx.wsId, { databaseId: dbId }, { title: p.title, properties: propsInput(p.changes) }, ctx.actor, { agent: true })
            const created = await ctx.model.createRow(ctx.wsId, dbId, { title: row.title ?? p.title, properties: row.properties, content: item.body || undefined }, ctx.actor, { agent: true })
            ctx.applied++
            holders.set(key, [{ id: created.id, title: p.title }])
            return { key, id: created.id, action: 'created' }
          }
          const c = stage(ctx, { kind: 'create_row', pageId: newId(), databaseId: dbId, title: p.title, props: p.changes, ...(item.body ? { markdown: item.body } : {}) })
          holders.set(key, [{ id: c.pageId, title: p.title, change: c }])
          return { key, id: c.pageId, action: 'created', change: c.n }
        }
        if (p.kind === 'merge') {
          if (!p.fresh.length && !p.title && !p.body) return { key, id: p.prev.pageId, action: 'unchanged', change: p.prev.n }
          p.prev.props = mergeProps(p.prev.props, p.fresh)
          if (p.title) p.prev.title = p.title
          if (p.body) p.prev.markdown = p.body
          return { key, id: p.prev.pageId, action: 'updated', change: p.prev.n }
        }
        const { row } = p
        const kept = p.kept ? { body: 'kept' as const } : {}
        if (!p.changed.length && !p.title && !p.body) return { key, id: row.id, action: 'unchanged', ...kept }
        if (apply) {
          if (p.changed.length || p.title) {
            const prepared = await ctx.writes.prepareRow(ctx.wsId, { rowId: row.id }, { properties: propsInput(p.changed) }, ctx.actor, { agent: true })
            await ctx.model.updateRow(ctx.wsId, row.id, { ...(p.title ? { title: p.title } : {}), properties: prepared.properties }, ctx.actor, { agent: true })
          }
          if (p.body) await ctx.writes.updatePage(ctx.wsId, { id: row.id, markdown: p.body, mode: 'append' }, ctx.actor)
          ctx.applied++
          return { key, id: row.id, action: 'updated', ...kept }
        }
        let first: StagedChange | null = null
        if (p.changed.length) {
          if (p.pending) p.pending.props = mergeProps(p.pending.props, p.changed)
          first = p.pending ?? stage(ctx, { kind: 'update_row', pageId: row.id, databaseId: dbId, title: titleOf(row), props: p.changed })
        }
        if (p.title) {
          const rename = pendingFor(ctx, 'rename', row.id)
          if (rename) rename.title = p.title
          const r = rename ?? stage(ctx, { kind: 'rename', pageId: row.id, beforeTitle: titleOf(row), title: p.title })
          first ??= r
        }
        if (p.body && !pendingFor(ctx, 'append', row.id)) first ??= stage(ctx, { kind: 'append', pageId: row.id, title: titleOf(row), markdown: p.body })
        return first ? { key, id: row.id, action: 'updated', change: first.n, ...kept } : { key, id: row.id, action: 'unchanged', ...kept }
      } catch (e) {
        if (e instanceof ApiError) return { key, action: 'refused', reason: explain(e) }
        throw e
      }
    }

    const results: UpsertResult[] = []
    for (const item of items) results.push(await one(item))
    const count = (a: UpsertAction) => results.filter((r) => r.action === a).length
    const n = { created: count('created'), updated: count('updated'), same: count('unchanged'), refused: count('refused') }
    const note = apply ? '' : n.created + n.updated ? ' Nothing is written until a person reviews and applies the staged changes (every row is its own proposed change).' : ''
    const head = `upsert_rows into ${q(dbTitle)} by ${q(keyProp.name)}: ${n.created} created, ${n.updated} updated, ${n.same} unchanged, ${n.refused} refused.${note}${n.refused ? ' Fix the refused rows and send them again.' : ''}`
    return clipResult(`${head}\n${results.map((r) => JSON.stringify(r)).join('\n')}`)
  },
}

const setPageTitle: AgentTool = {
  name: 'set_page_title',
  write: true,
  description: (mode) => verb(mode, 'Stage a new title for a page or database row (or for a page or row staged earlier).', 'Rename a page or database row at once.'),
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Page or row id.' },
      title: { type: 'string', description: 'The new title.' },
    },
    required: ['id', 'title'],
    additionalProperties: false,
  },
  label: (i) => `set_page_title · ${typeof i.title === 'string' ? i.title.slice(0, 80) : ''}`,
  async run(input, ctx) {
    const id = str(input, 'id', { required: true, max: 80 }).trim()
    const title = str(input, 'title', { required: true, max: 500 }).replace(/\s+/g, ' ').trim()
    if (!title) throw new ToolInputError('"title" must not be empty.')
    const staged = stagedCreate(ctx, id)
    if (staged) {
      staged.title = title
      return `Renamed staged change #${staged.n} to ${q(title)}.`
    }
    const p = await read(ctx, (r) => scopedPage(r, ctx, id))
    if (p.title.trim() === title) return `No change: the title already is ${q(title)}.`
    if (ctx.agent.write === 'apply') {
      await api(() => ctx.writes.updatePage(ctx.wsId, { id, title, mode: 'append' }, ctx.actor))
      ctx.applied++
      return `Renamed ${q(titleOf(p))} → ${q(title)}.`
    }
    const pending = pendingFor(ctx, 'rename', p.id)
    if (pending) pending.title = title
    const c = pending ?? stage(ctx, { kind: 'rename', pageId: p.id, beforeTitle: titleOf(p), title })
    return `${stagedNote(c)} ${q(titleOf(p))} → ${q(title)}.`
  },
}

/* ------------------------------------------------------------------ the agent's own state */

const stateGet: AgentTool = {
  name: 'agent_state_get',
  write: false,
  description: () =>
    'Read your own saved state: the small JSON value an earlier run of yours saved with agent_state_set (cursors, the last ids or times you saw, counts). Use it at the start of a recurring job to find what is new since then. "Nothing saved" means a first run, or that no run saved anything yet.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  label: () => 'agent_state_get',
  async run(_input, ctx) {
    const st = ctx.state
    if (st?.pending !== undefined) return `State set in this run (saved when the run ends without an error):\n${st.pending}`
    if (!st?.saved) return 'Nothing saved yet: this is the first run that keeps a state.'
    return `Saved state (from the run of ${new Date(st.saved.at).toISOString()}):\n${st.saved.json}`
  },
}

/** The JSON text agent_state_set was given (a JSON string, or a JSON value as is), compact. */
export function stateJson(raw: unknown): string {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new ToolInputError('"json" must be valid JSON (an object, an array, a string, a number …).')
    }
  }
  if (value === undefined) throw new ToolInputError('Missing required parameter "json".')
  const text = JSON.stringify(value)
  if (typeof text !== 'string') throw new ToolInputError('"json" must be a JSON value.')
  const n = Buffer.byteLength(text, 'utf8')
  if (n > STATE_BYTES) throw new ToolInputError(`The state is too large (${n} bytes, at most ${STATE_BYTES}): keep only cursors and ids, not content.`)
  return text
}

const stateSet: AgentTool = {
  name: 'agent_state_set',
  write: false,
  description: () =>
    `Save your state for the next run: one JSON value (at most ${STATE_BYTES} bytes) that replaces the saved one — e.g. {"cursor": "2026-10-08T06:00:00Z", "seen": ["#8215"]}. It is kept only if this run ends without an error or a budget stop (then the old state stays), so save it once the work it stands for is done; the last call of a run wins. Cursors and ids only — never secrets or page content.`,
  input_schema: {
    type: 'object',
    properties: { json: { type: 'string', description: 'The state as JSON text, e.g. {"cursor":"2026-10-08T06:00:00Z"}.' } },
    required: ['json'],
    additionalProperties: false,
  },
  label: () => 'agent_state_set',
  async run(input, ctx) {
    const text = stateJson(input.json)
    ctx.state = { saved: ctx.state?.saved ?? null, pending: text }
    return `State set (${Buffer.byteLength(text, 'utf8')} bytes). It is saved when this run ends without an error; the next run reads it with agent_state_get.`
  },
}

/** Stable order: the tool list is part of the cached prompt prefix. */
export const AGENT_TOOLS: AgentTool[] = [searchPages, readPage, listDatabases, queryDatabase, createPage, appendToPage, createRow, updateRow, upsertRows, setPageTitle]

/** Every agent's own tools (after the workspace tools; no notify_me on the server — see above). */
export const STATE_TOOLS: AgentTool[] = [stateGet, stateSet]

/** What the workspace's integration profiles unlock for its server agents (integrations.ts). */
export interface ToolUnlocks {
  upsert: boolean
  state: boolean
}

/**
 * The tools of an agent's write mode ("none": reads only) — upsert_rows and the state tools only while unlocked
 * (absent `unlocks` = nothing unlocked).
 */
export const toolsFor = (write: CustomAgent['write'], unlocks: ToolUnlocks = { upsert: false, state: false }) => [
  ...AGENT_TOOLS.filter((t) => (write !== 'none' || !t.write) && (unlocks.upsert || t.name !== 'upsert_rows')),
  ...(unlocks.state ? STATE_TOOLS : []),
]
