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
 *
 * Results are model-facing English text, clipped. A call that cannot be done throws ToolInputError
 * with a message Claude can act on.
 */
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { fragmentMarkdown } from '../api/markdown.ts'
import { type PageInfo, type Roots, allPages, liveDatabase, livePage, outOfReach, pageMap, rowsOf } from '../api/meta.ts'
import { contentDoc, type WorkspaceModel } from '../api/model.ts'
import type { Services } from '../context.ts'
import { ApiError } from '../errors.ts'
import { FILTER_OPS, type Condition, type FilterOp, encodeCursor } from '../mcp/query.ts'
import type { McpReads } from '../mcp/reads.ts'
import type { McpWrites } from '../mcp/writes.ts'
import { newId } from '../tokens.ts'
import { inScope, redact, valueText } from './scope.ts'
import { ToolInputError, explain, mergeProps, settable, stageProps } from './stage.ts'
import type { ChangeKind, CustomAgent, StagedChange } from './types.ts'

/** Characters of one page part (read_page) and of any other tool result. */
export const PAGE_PART_CHARS = 12_000
export const RESULT_CHARS = 16_000

export type ToolName = 'search_pages' | 'read_page' | 'list_databases' | 'query_database' | 'create_page' | 'append_to_page' | 'create_row' | 'update_row' | 'set_page_title'

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
      const titles = new Map<string, string | null>()
      for (const [pid, yp] of r.pages.entries()) {
        const t = (yp as { get?: (k: string) => unknown }).get?.('title')
        titles.set(pid, inScope(r, ctx.agent.scope, pid) ? (typeof t === 'string' && t.trim() ? t.trim() : 'Untitled') : null)
      }
      return { lines, titles, isDatabase: p.kind === 'database' }
    })
    const md = head.isDatabase ? '' : (await ctx.s.collab.read(contentDoc(ctx.wsId, id), (doc) => fragmentMarkdown(doc, { title: (pid) => head.titles.get(pid) ?? null }))).markdown.trim()
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

function schemaLine(props: Array<{ name: string; type: string; options?: Array<{ name: string }> }>, locked: boolean): string {
  return props
    .map((p) => {
      const opts = p.options?.length ? `: ${p.options.map((o) => o.name).join(' | ')}` : ''
      const ro = p.type === 'title' || settable(p as Parameters<typeof settable>[0]) ? '' : ', read-only'
      return `${p.name} (${p.type}${ro}${opts})`
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
      const row = await api(() => ctx.writes.prepareRow(ctx.wsId, { databaseId: dbId }, { title, properties: (props as Record<string, unknown> | undefined) ?? {} }, ctx.actor))
      const created = await api(() => ctx.model.createRow(ctx.wsId, dbId, { title: row.title ?? title, properties: row.properties, content: markdown || undefined }, ctx.actor))
      ctx.applied++
      return `Created row ${q(row.title ?? title)} (id: ${created.id}) in ${q(dbTitle)}.`
    }
    const { changes, dbTitle } = await read(ctx, (r) => {
      const db = scopedDatabase(r, ctx, dbId)
      return { dbTitle: titleOf(db.page), changes: stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, null, props, ctx.model.context(ctx.wsId, r)) }
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
        return stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, null, props, ctx.model.context(ctx.wsId, r))
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
      const row = await api(() => ctx.writes.prepareRow(ctx.wsId, { rowId: id }, { properties: props as Record<string, unknown> }, ctx.actor))
      await api(() => ctx.model.updateRow(ctx.wsId, id, { title: row.title, properties: row.properties }, ctx.actor))
      ctx.applied++
      return `Updated ${q(title)}: ${Object.keys(props).map(q).join(', ')}.`
    }
    const { row, changed, dbId } = await read(ctx, (r) => {
      const row = scopedPage(r, ctx, id)
      if (!row.databaseId) throw new ToolInputError(`${q(titleOf(row))} is not a database row. Only rows have properties; use set_page_title or append_to_page for pages.`)
      const db = scopedDatabase(r, ctx, row.databaseId)
      const changes = stageProps(r, { properties: db.properties, locked: db.ydb.get('locked') === true }, row, props, ctx.model.context(ctx.wsId, r))
      return { row, dbId: db.page.id, changed: changes.filter((c) => c.before !== c.after || c.newOptions?.length) }
    })
    if (!changed.length) return `No change: ${q(titleOf(row))} already has these values.`
    const pending = pendingFor(ctx, 'update_row', row.id)
    if (pending) pending.props = mergeProps(pending.props, changed)
    const c = pending ?? stage(ctx, { kind: 'update_row', pageId: row.id, databaseId: dbId, title: titleOf(row), props: changed })
    return `${stagedNote(c)} ${q(titleOf(row))}: ${changed.map((x) => `${x.name} ${q(x.before)} → ${q(x.after)}`).join(', ')}.${newOptionsNote(changed)}`
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

/** Stable order: the tool list is part of the cached prompt prefix. */
export const AGENT_TOOLS: AgentTool[] = [searchPages, readPage, listDatabases, queryDatabase, createPage, appendToPage, createRow, updateRow, setPageTitle]

/** The tools of an agent's write mode ("none": reads only). */
export const toolsFor = (write: CustomAgent['write']) => AGENT_TOOLS.filter((t) => write !== 'none' || !t.write)
