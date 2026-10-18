/**
 * One's MCP tool set on the team server (docs/MCP.md): the same names, arguments and result shapes
 * as the local bridge. Reads for every token; write tools only for "write" tokens (a read token's
 * client never sees them). Results are JSON text; failures are tool errors (`isError`) with a message
 * an agent can act on (unknown option → the allowed names, unknown page → similar titles …).
 *
 * The workspace boundary: the token's workspace is the only one. Every tool takes the local bridge's
 * optional `workspace` argument and refuses (workspace_mismatch, nothing done) when it does not name
 * that workspace — by its id ('team:<id>' or the bare id) or its current name; one_list_workspaces
 * lists just that one; every result names it in `workspace: { id, name }`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Services } from '../context.ts'
import { ApiError } from '../errors.ts'
import { idSchema } from '../http/util.ts'
import type { ApiTokenRow } from '../repo.ts'
import { findProperty, type WorkspaceModel } from '../api/model.ts'
import { liveDatabase, livePage } from '../api/meta.ts'
import { FILTER_OPS, sortKeys } from './query.ts'
import { McpReads } from './reads.ts'
import { McpStructure, VIEW_TYPES, type ViewInput } from './structure.ts'
import { BULK_MAX, McpTidy } from './tidy.ts'
import { CREATABLE_TYPES, MAX_DB_PROPERTIES, McpWrites, cleanRowTitle, cleanTitle } from './writes.ts'
import { once } from './duplicates.ts'
import { dupHash, remembersResult } from '../../../src/shared/mcp/duplicates.ts'
import { McpBatch } from './batch.ts'
import { McpPreimages, fragmentSnapshot, textHash } from './preimages.ts'
import { fragmentText } from '../api/content.ts'
import { contentDoc } from '../api/model.ts'
import { MCP_CONTRACT_REV, MCP_LIMITS, MCP_LINE_BOARD, MCP_LINE_CLASS, MCP_LINE_CODEWORD, MCP_LINE_CONTENT, mcpDescription, type McpToolName } from '../../../src/shared/mcp/contract.ts'
import { codeOf, isMcpErrorCode, mcpError, withRemedy, type McpErrorCode } from '../../../src/shared/mcp/errors.ts'
import { stripRefLabels } from '../../../src/shared/mcp/refs.ts'
import { MCP_PAGE_KINDS } from '../../../src/shared/mcp/tables.ts'

/**
 * The answer to a fault of the server's own (not an ApiError): whether the call — or a part of a batch — was carried out
 * is not known, so it says neither "not made" nor "try again": the model reads what the call touches first (the bridge
 * words its own fault alike: "Nothing was confirmed — read what the call touches again").
 */
export const MCP_FAULT =
  'rejected: The tool failed on the team server. Whether the call was carried out is not known: read what it touches (one_get_page, one_query_database) before you call again, and tell the person if it fails again.'

/** Markdown a client wrote: ref labels it copied from a read (⟦#…~…⟧) never reach content. */
const md = (v: string | undefined) => (v === undefined ? undefined : stripRefLabels(v))
/** The same for every item of a batch (pages, rows) that carries its own Markdown. */
const mdEach = <T extends { markdown?: string }>(list: T[] | undefined) => list?.map((it) => (it.markdown === undefined ? it : { ...it, markdown: md(it.markdown) }))

const id = idSchema.describe('A page, row or database id')
const markdown = z.string().max(MCP_LIMITS.text)
const icon = z.string().max(80).describe('An emoji, "asset:<name>" or "lucide:<IconName>"')
const option = z.union([z.string().min(1).max(200), z.strictObject({ name: z.string().min(1).max(200), color: z.string().optional(), group: z.enum(['todo', 'in_progress', 'done']).optional() })])
const relation = z
  .strictObject({
    databaseId: idSchema.describe('The related database'),
    twoWay: z.boolean().optional().describe('Also add the reverse relation to the other database'),
    reverseName: z.string().min(1).max(MCP_LIMITS.propertyName).optional().describe('Name of the reverse property (two-way only)'),
  })
  .describe('relation properties only')
const propertySpec = {
  name: z.string().min(1).max(MCP_LIMITS.propertyName),
  options: z.array(option).max(200).optional().describe('select / multi_select / status: option names (or { name, color, group })'),
  relation: relation.optional(),
}
const sortItem = z.strictObject({ property: z.string().min(1), direction: z.enum(['asc', 'desc']).optional() })
const sortArg = z.union([z.string().max(200), sortItem, z.array(sortItem).max(5)])
const filterItem = z.strictObject({ property: z.string().min(1).max(200), op: z.enum(FILTER_OPS), value: z.unknown().optional() })
const ids = z.array(idSchema).min(1).max(BULK_MAX).describe(`Several ids at once (at most ${BULK_MAX}). All or nothing: one id that does not fit fails the call and nothing changes.`)
const propertyRef = z.string().min(1).max(200).describe('The property: its exact name (any case) or id')
const viewRef = z.string().min(1).max(200).describe('The view: its id or exact name (one_get_database lists the views)')
/** What a view shows: one_create_view and one_update_view (the local bridge's viewSettings). */
const viewSettings = {
  name: z.string().max(100).optional(),
  groupBy: z.string().max(200).nullable().optional().describe('Property to group by — board: status, select, multi_select, person, checkbox (required); table and list: most types. null removes it'),
  dateProperty: z.string().max(200).nullable().optional().describe('calendar and timeline (required): a date, created_time or last_edited_time property; feed: the date it orders by (null = created time)'),
  filter: z.array(filterItem).max(20).nullable().optional().describe('Conditions, all must match (replaces the view\'s filter; [] or null removes it)'),
  sort: sortArg.nullable().optional().describe('A property name ("-Due" descending), { property, direction } or a list (replaces the sorts; [] or null removes them)'),
  properties: z.array(z.string().max(200)).max(100).optional().describe('The visible properties, in order (by name; the title always shows)'),
}
/** The tools' view input: sorts as property + direction. */
const viewIn = (a: { name?: string; groupBy?: string | null; dateProperty?: string | null; filter?: Array<{ property: string; op: string; value?: unknown }> | null; sort?: z.infer<typeof sortArg> | null; properties?: string[] }): ViewInput => ({
  name: a.name,
  groupBy: a.groupBy,
  dateProperty: a.dateProperty,
  filter: a.filter,
  sort: a.sort === undefined ? undefined : a.sort === null ? null : sortKeys(a.sort).map((k) => ({ property: k.property, desc: k.direction === 'desc' })),
  properties: a.properties,
})
/** A new row of a batch (one_create_row / one_create_database `rows`). */
const rowItem = z.strictObject({ title: z.string().max(2000), properties: z.record(z.string(), z.unknown()).optional(), markdown: markdown.optional() })
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const
const CHANGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

/**
 * A tool's description: the shared text (src/shared/mcp/contract.ts — the local bridge's, without what only it does)
 * plus at most one side-note line about this server (server/test/mcp-parity.test.ts).
 */
const desc = (name: McpToolName, note?: string) => (note ? `${mcpDescription(name)}\n${note}` : mcpDescription(name))

/** The side note of the batch tools: this server's per-request limit (the shared description counts characters; index.ts). */
const BODY_NOTE = ` One request carries at most ${MCP_LIMITS.bodyWrite / 1024} KB on this server: split a larger batch into several calls.`

const workspaceArg = z
  .string()
  .max(200)
  .optional()
  .describe('The workspace to work in: its id ("team:…", from one_list_workspaces) or its name. This connection reaches one workspace; naming another one is refused.')
/** Every tool's `workspace` argument (the local bridge's; here it can only confirm the token's workspace). */
const WS = { workspace: workspaceArg }

const READ = { readOnlyHint: true, openWorldHint: false } as const
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

type Json = Record<string, unknown> | unknown[]

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

/** The contract's code of an API error (src/shared/mcp/errors.ts). */
function codeFor(err: ApiError): McpErrorCode {
  if (isMcpErrorCode(err.code)) return err.code
  if (err.status === 404) return 'not_found'
  if (err.code === 'database_locked' || err.code === 'page_locked') return 'locked'
  if (err.status === 413) return 'too_large'
  if (err.status === 403) return 'rejected'
  return 'bad_argument'
}

/** An ApiError as a message for the agent: its code first, what went wrong, what is allowed and the next step. */
function explain(err: ApiError): string {
  // the REST model's refusal of a page under a database (its own words name the REST route): the MCP next step — a refusal
  // already in the contract's words (one_create_database: "a database goes under a page") keeps them
  if (err.code === 'parent_is_database' && !codeOf(err.message)) return withRemedy('bad_argument: parentId: The parent is a database: add a row with one_create_row instead')
  const details = err.details as { errors?: Array<{ allowed?: string[]; property?: string }> } | undefined
  const allowed = (details?.errors ?? []).filter((e) => e.allowed?.length).map((e) => `${e.property}: ${e.allowed!.join(', ')}`)
  const message = `${err.message}${allowed.length ? ` (allowed — ${allowed.join(' · ')})` : ''}`
  return withRemedy(codeOf(message) ? message : `${codeFor(err)}: ${message}`)
}

/** An argument path as the contract writes it: `rows[3].properties.Status`. */
const pathText = (path: ReadonlyArray<PropertyKey>): string =>
  path.reduce<string>((out, seg) => (typeof seg === 'number' ? `${out}[${seg}]` : out ? `${out}.${String(seg)}` : String(seg)), '')

/** A tool's arguments that do not fit its schema, in the contract's shape (`bad_argument: <path>: …` — spec § 2.0). */
export function argumentError(tool: string, error: z.ZodError, declared: readonly string[]): string {
  const [first, ...rest] = error.issues
  if (!first) return mcpError('bad_argument', '', `the arguments of ${tool} do not fit`)
  if (first.code === 'unrecognized_keys') {
    const key = first.keys[0] ?? ''
    const top = !first.path.length
    return mcpError('bad_argument', pathText([...first.path, key]), `${tool} takes no argument ${JSON.stringify(key)}${top ? ` (it takes: ${declared.join(', ') || 'none'})` : ''}`)
  }
  const also = rest.slice(0, 3).map((i) => `${pathText(i.path) || 'the call'}: ${i.message}`)
  return mcpError('bad_argument', pathText(first.path), `${first.message}${also.length ? ` (also ${also.join('; ')})` : ''}`)
}

/**
 * Strict arguments on this server too (spec § 2.0, docs/MCP.md): every tool's schema is a strict object — tools/list says
 * `additionalProperties: false` and an argument the tool does not declare is refused instead of dropped (a mistyped
 * `parentID` would otherwise make a page at the top level) — and an argument that does not fit is answered in the
 * contract's shape (`bad_argument: <path>: … Nothing was changed. …`), before the tool runs, as the local bridge answers.
 * The SDK checks arguments in its private validateToolInput; this server's instance answers that check itself
 * (server/test/mcp-parity.test.ts guards it: an SDK that stops calling it fails the undeclared-argument case there).
 */
function strictArguments(server: McpServer): void {
  const register = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: unknown) => unknown
  ;(server as unknown as { registerTool: typeof register }).registerTool = (name, config, cb) => {
    const shape = (config.inputSchema ?? {}) as z.ZodRawShape
    return register(name, { ...config, inputSchema: z.object(shape).strict() }, cb)
  }
  type Checked = { inputSchema?: z.ZodType }
  ;(server as unknown as { validateToolInput: (tool: Checked, args: unknown, name: string) => Promise<unknown> }).validateToolInput = async (tool, args, name) => {
    if (!tool.inputSchema) return undefined
    const res = await tool.inputSchema.safeParseAsync(args ?? {})
    if (res.success) return res.data
    const declared = tool.inputSchema instanceof z.ZodObject ? Object.keys(tool.inputSchema.shape) : []
    throw new Error(argumentError(name, res.error, declared))
  }
}

function instructions(name: string, id: string, write: boolean): string {
  return [
    `SimpleCMS One team workspace "${name}": pages (Markdown content), databases with typed properties, rows (pages inside a database).`,
    `This connection reaches only this workspace (id ${id}); the optional "workspace" argument of every tool is refused when it names another one (workspace_mismatch: nothing was done — ask the person).`,
    'Start with one_overview (page tree, databases, today\'s date); find things with one_search; read a page with one_get_page (format "blocks" shows every block with its data; long pages come in parts — pass "next" as cursor); list pages with one_list_pages.',
    'Values are friendly: option names, dates "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (wall-clock, no time zone), member emails for people, row ids for relations.',
    'Errors start with a code ("not_found: …") and say what to do next.',
    write
      ? `Changes reach everyone who has the workspace open at once; repeating a call that made something within 2 minutes does not make a second one (the answer says duplicateOf). ${MCP_LINE_BOARD} Tidying up: one_move_page, one_move_row, one_update_database / _property / _view, one_trash_page (nothing is deleted for good: one_restore_page brings things back). Before removing or reorganising several things, say what you plan to do.`
      : 'This token can only read: the write tools are not available.',
    MCP_LINE_CONTENT,
    MCP_LINE_CLASS,
    // the shared codeword line (src/shared/mcp/contract.ts): the same words as the local bridge's
    MCP_LINE_CODEWORD,
  ].join(' ')
}

/** A fresh MCP server for one request (stateless transport), bound to the token's workspace and scope. */
export function buildMcpServer(s: Services, model: WorkspaceModel, token: ApiTokenRow): McpServer {
  const ws = token.workspace_id
  const actor = `api:${token.id}`
  const write = token.scope === 'write'
  const reads = new McpReads(s, model)
  const writes = new McpWrites(s, model)
  const tidy = new McpTidy(s, model)
  const structure = new McpStructure(s, model)
  const batch = new McpBatch(s, model, writes)
  const preimages = new McpPreimages(s, model)
  /** one recorder per tool call: its pre-images (owners / admins put a call back in Workspace → API) */
  const recorder = (tool: McpToolName, a?: Record<string, unknown>) => preimages.recorder(ws, token.id, tool, a && remembersResult(tool) ? dupHash(tool, a) : null)
  const name = s.repo.workspaceById(ws)?.name ?? ''
  /** The workspace as MCP names it — the same id the local bridge uses for a team workspace. */
  const self = { id: `team:${ws}`, name }
  // serverInfo names the tool contract too (semver build metadata): 0.1.0+mcp.2 = this server with contract 2
  const server = new McpServer({ name: 'one', title: 'SimpleCMS One', version: `${s.config.version}+mcp.${MCP_CONTRACT_REV}` }, { instructions: instructions(name, self.id, write) })
  strictArguments(server)

  /** null when `workspace` is absent or names the token's workspace; else the refusal. */
  const outside = (arg: string | undefined): string | null => {
    if (arg === undefined || !arg.trim()) return null
    const want = arg.trim()
    if (want === self.id || want === ws) return null
    // something shaped like an id only ever matches ids
    if (!/^(local|team):/.test(want) && name && norm(want) === norm(name)) return null
    return `workspace_mismatch: this connection (its API token) reaches only the workspace ${JSON.stringify(name)} (${self.id}); ${JSON.stringify(want)} is not it, so nothing was done. Ask the person which workspace they mean — another workspace needs its own token.`
  }

  /** The JSON answer, naming the workspace it came from. */
  const json = (value: Json) => {
    const out = isObj(value) ? { ...value, workspace: { ...(isObj(value.workspace) ? value.workspace : {}), ...self } } : value
    // compact: a client counts results by their serialized size (spec § 2.0)
    return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] }
  }

  /** Runs a tool inside the boundary: JSON result, or a tool error the agent can read. */
  const run = (arg: string | undefined, fn: () => Promise<Json>) => async () => {
    const refused = outside(arg)
    if (refused) throw new Error(refused)
    try {
      return json(await fn())
    } catch (err) {
      if (err instanceof ApiError) throw new Error(explain(err))
      s.log.error('mcp tool failed', { workspace: ws, token: token.id, error: err as Error })
      // a fault of the server's own: whether (a part of) the call was carried out is not known — a batch may have written
      // some of it — so the model reads before it calls again (the bridge words its own fault alike)
      throw new Error(MCP_FAULT)
    }
  }

  /** A creating call runs once per token and arguments within 2 minutes: a repeat gets its answer (duplicates.ts). */
  const made = (tool: McpToolName, a: Record<string, unknown>, fn: () => Promise<Json>) => () => once(s, token.id, ws, tool, a, fn)

  // the codeword as a prompt (Claude Desktop's "+" menu, Claude Code's /mcp__one__one): "one: <task>"
  server.registerPrompt(
    'one',
    {
      title: 'One',
      description: 'Work in your One workspace: what to look up, write or change there.',
      argsSchema: { task: z.string().trim().min(1, 'Say what to do in One (argument "task").').max(20_000).describe('What to do in One, e.g. "summarise my meeting notes from this week"') },
    },
    ({ task }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `one: ${task.trim()}\n\nUse the One tools for this (start with one_overview or one_search).` } }],
    }),
  )

  /* ---------------------------------------------------------------- read */

  server.registerTool(
    'one_overview',
    {
      title: 'Workspace overview',
      description: desc('one_overview', "Here: a write token's changes apply at once (no approval step); a read token only reads."),
      inputSchema: WS,
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.overview(ws, token.scope))(),
  )

  server.registerTool(
    'one_list_workspaces',
    {
      title: 'Connected workspaces',
      description: desc('one_list_workspaces', "Here exactly one: the API token's workspace."),
      annotations: READ,
    },
    async () =>
      run(undefined, async () => ({
        workspaces: [
          {
            ...self,
            kind: 'team',
            access: write ? 'read-write' : 'read-only',
            readOnly: !write,
            mode: write ? 'apply' : 'read',
            changes: write ? 'Changes are applied directly.' : 'Refused: this token can only read.',
            site: s.config.publicUrl,
            newest: true,
          },
        ],
        hint: 'This connection reaches only this workspace; "workspace" may be left out. Another workspace needs its own token (or the local bridge).',
      }))(),
  )

  server.registerTool(
    'one_search',
    {
      title: 'Search',
      description: desc('one_search'),
      inputSchema: { query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).optional().describe('default 10'), ...WS },
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.search(ws, a.query, a.limit ?? 10))(),
  )

  server.registerTool(
    'one_get_page',
    {
      title: 'Read a page',
      description: desc('one_get_page'),
      inputSchema: {
        id: id.optional(),
        title: z.string().min(1).max(2000).optional().describe('Exact title (case-insensitive) when the id is not known'),
        format: z.enum(['markdown', 'blocks']).optional(),
        refs: z.boolean().optional().describe('Label each block with its ref (labels are not text).'),
        cursor: z.string().max(200).optional().describe('"next" of the previous part.'),
        comments: z.boolean().optional().describe('Comment threads too — only when this token may read comments.'),
        transcript: z.boolean().optional().describe('blocks: meeting notes with their transcript lines.'),
        ...WS,
      },
      annotations: READ,
    },
    async (a) =>
      run(a.workspace, async () => {
        if (!a.id && !a.title) throw new ApiError(400, 'invalid_request', 'Give the page id (or its exact title)')
        return reads.getPage(ws, { id: a.id, title: a.title, format: a.format, refs: a.refs, cursor: a.cursor, comments: a.comments, transcript: a.transcript }, { comments: token.mcp_comments ?? 'off' })
      })(),
  )

  server.registerTool(
    'one_list_pages',
    {
      title: 'List pages',
      description: desc('one_list_pages'),
      inputSchema: {
        parentId: id.nullable().optional().describe('A page, row or database; omit or null for the top level.'),
        depth: z.number().int().min(1).max(3).optional().describe('Default 1.'),
        kinds: z.array(z.enum(MCP_PAGE_KINDS)).min(1).max(3).optional().describe('Default page + database.'),
        cursor: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(MCP_LIMITS.listMax).optional().describe(`Default ${MCP_LIMITS.listDefault}.`),
        ...WS,
      },
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.listPages(ws, { parentId: a.parentId ?? null, depth: a.depth, kinds: a.kinds, cursor: a.cursor, limit: a.limit }))(),
  )

  server.registerTool(
    'one_list_databases',
    { title: 'List databases', description: desc('one_list_databases'), inputSchema: WS, annotations: READ },
    async (a) => run(a.workspace, () => reads.listDatabases(ws))(),
  )

  server.registerTool(
    'one_get_database',
    {
      title: 'Database schema',
      description: desc('one_get_database'),
      inputSchema: { id, ...WS },
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.getDatabase(ws, a.id))(),
  )

  server.registerTool(
    'one_query_database',
    {
      title: 'Query rows',
      description:
        desc('one_query_database'),
      inputSchema: {
        databaseId: id,
        filter: z.array(z.strictObject({ property: z.string().min(1), op: z.enum(FILTER_OPS), value: z.unknown().optional() })).max(20).optional(),
        sort: z.union([z.string().max(200), sortItem, z.array(sortItem).max(5)]).optional().describe('A property name, "createdAt", "updatedAt" or "order" (default, the table order); prefix "-" for descending, e.g. "-Due"'),
        limit: z.number().int().min(1).max(100).optional().describe('Rows per answer (default 50)'),
        cursor: z.string().max(2000).optional(),
        ...WS,
      },
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.queryDatabase(ws, { databaseId: a.databaseId, filter: a.filter, sort: sortKeys(a.sort), limit: a.limit ?? 50, cursor: a.cursor }))(),
  )

  if (!write) return server

  /* ---------------------------------------------------------------- write */

  server.registerTool(
    'one_create_page',
    {
      title: 'Create pages',
      description: desc('one_create_page', `Markdown here: headings, lists, to-dos (- [ ]), quotes, code blocks, dividers, bold / italic / strike / code, links.${BODY_NOTE}`),
      inputSchema: {
        title: z.string().max(2000).optional(),
        parentId: id.nullable().optional(),
        markdown: markdown.optional(),
        icon: icon.optional(),
        before: id.optional().describe('A sibling id: place it right before'),
        after: id.optional().describe('A sibling id: place it right after'),
        index: z.number().int().min(0).optional().describe('0 = first (default last)'),
        private: z.boolean().optional().describe('Local bridge only: refused here (local_only)'),
        linkInParent: z.enum(['none', 'block', 'mention']).optional(),
        pages: z
          .array(z.strictObject({ title: z.string().min(1).max(2000), parentId: z.string().max(80).optional().describe('A page / row id or "$<index>"'), markdown: markdown.optional(), icon: icon.optional() }))
          .min(1)
          .max(MCP_LIMITS.pages)
          .optional(),
        ...WS,
      },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, made('one_create_page', a, () => batch.createPages(ws, { ...a, markdown: md(a.markdown), pages: mdEach(a.pages) }, actor, recorder('one_create_page', a))))(),
  )

  server.registerTool(
    'one_update_page',
    {
      title: 'Update a page',
      description: desc('one_update_page', "Here a replace is refused when the page holds content this server's Markdown cannot write back (the answer names it)."),
      inputSchema: {
        id,
        title: z.string().max(2000).optional(),
        icon: icon.optional().describe('An emoji, "asset:<name>" or "lucide:<IconName>"; "" removes the icon'),
        markdown: markdown.optional(),
        mode: z.enum(['append', 'replace']).optional().describe('default append'),
        ...WS,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (a) =>
      run(a.workspace, async () => {
        // a replace keeps its pre-image (the content before, taken in the write's own transaction)
        const rec = recorder('one_update_page')
        let before: { snapshot: string; plain: string } | null = null
        // the title as the bridge takes it: whitespace collapsed, never empty, at most 300 characters
        const title = a.title === undefined ? undefined : cleanTitle(a.title, 'title')
        const out = await writes.updatePage(ws, { id: a.id, title, icon: a.icon, markdown: md(a.markdown), mode: a.mode ?? 'append' }, actor, {
          mcp: true,
          preimage: (doc) => (before = { snapshot: fragmentSnapshot(doc), plain: fragmentText(doc, 20_000) }),
        })
        const pre = before as { snapshot: string; plain: string } | null
        if (pre) rec.content(a.id, pre.snapshot, pre.plain, await s.collab.read(contentDoc(ws, a.id), (doc) => textHash(doc)))
        return out
      })(),
  )

  server.registerTool(
    'one_create_row',
    {
      title: 'Create rows',
      description: desc('one_create_row', `People: a member's email works too.${BODY_NOTE}`),
      inputSchema: {
        databaseId: id,
        title: z.string().max(2000).optional(),
        properties: z.record(z.string(), z.unknown()).optional().describe('Property name → value'),
        markdown: markdown.optional(),
        rows: z.array(rowItem).min(1).max(MCP_LIMITS.rows).optional(),
        ...WS,
      },
      annotations: CREATE,
    },
    async (a) =>
      run(
        a.workspace,
        made('one_create_row', a, async () => {
          const rec = recorder('one_create_row', a)
          if (a.rows) {
            const mixed = (['title', 'properties', 'markdown'] as const).find((k) => a[k] !== undefined)
            if (mixed) throw new ApiError(422, 'bad_argument', `bad_argument: ${mixed}: pass "rows" or title / properties / markdown, not both`)
            return batch.createRows(ws, { databaseId: a.databaseId, rows: mdEach(a.rows)! }, actor, rec)
          }
          // the title as the bridge takes it: given as "title" or through the properties, whitespace collapsed, never empty,
          // at most MCP_LIMITS.title (as the batch form and the bridge refuse a row without one)
          const given = typeof a.title === 'string' && a.title.trim() ? cleanTitle(a.title, 'title') : undefined
          const props = a.properties
            ? await model.read(ws, (r) => {
                const defs = liveDatabase(r, a.databaseId)?.properties ?? []
                const titleId = defs.find((p) => p.type === 'title')?.id
                const isTitle = (k: string) => (k.trim().toLowerCase() === 'title' && !findProperty(defs, k)) || (!!titleId && findProperty(defs, k)?.id === titleId)
                // an empty title among the properties gives way to "title" (as the bridge's splitTitle)
                return cleanRowTitle(defs, Object.fromEntries(Object.entries(a.properties!).filter(([k, v]) => !(given && isTitle(k) && typeof v === 'string' && !v.trim()))))
              })
            : undefined
          // an MCP client is an agent: properties "Only by hand" are refused (api/keys.ts)
          const row = await writes.prepareRow(ws, { databaseId: a.databaseId }, { title: given, properties: props }, actor, { agent: true, mcp: true, files: 'onefile' })
          const titled = await model.read(ws, (r) => {
            const db = liveDatabase(r, a.databaseId)
            const named = db ? Object.entries(row.properties ?? {}).find(([k]) => k.trim().toLowerCase() === 'title' || findProperty(db.properties, k)?.type === 'title') : undefined
            return (row.title ?? (typeof named?.[1] === 'string' ? named[1] : '') ?? '').replace(/\s+/g, ' ').trim()
          })
          if (!titled) throw new ApiError(422, 'bad_argument', 'bad_argument: title: a row needs a title (or pass "rows")')
          const created = await model.createRow(ws, a.databaseId, { title: row.title ?? given, properties: row.properties, content: md(a.markdown) }, actor, { agent: true, files: 'onefile' })
          // the pre-image: the row as made, with its text's state (a Restore leaves it when someone changed it since)
          const [state] = await batch.madeRows(ws, [created.id])
          if (state?.title !== undefined) rec.rows({ db: a.databaseId, created: [state], updated: [] })
          return { ...created, title: state?.title ?? row.title ?? a.title ?? '' }
        }),
      )(),
  )

  server.registerTool(
    'one_update_row',
    {
      title: 'Update rows',
      description: desc('one_update_row', "People: a member's email works too. Answers the row as it is now (\"rows\": what changed per row)."),
      inputSchema: {
        id: id.optional(),
        properties: z.record(z.string(), z.unknown()).optional().describe('Property name → new value'),
        rows: z.array(z.strictObject({ id, properties: z.record(z.string(), z.unknown()) })).min(1).max(MCP_LIMITS.rows).optional(),
        ...WS,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) =>
      run(a.workspace, async () => {
        const rec = recorder('one_update_row')
        if (a.rows) {
          const mixed = (['id', 'properties'] as const).find((k) => a[k] !== undefined)
          if (mixed) throw new ApiError(422, 'bad_argument', `bad_argument: ${mixed}: pass "rows" or id / properties, not both`)
          return batch.updateRows(ws, a.rows, actor, rec)
        }
        if (!a.id || !a.properties) throw new ApiError(422, 'bad_argument', 'bad_argument: id: pass "id" and "properties" (or "rows")')
        // one row: the answer is the row as it is now (as before); the pre-image as for a batch
        await batch.updateRows(ws, [{ id: a.id, properties: a.properties }], actor, rec, true)
        return model.read(ws, (r) => {
          const page = livePage(r, a.id!)
          const db = page?.databaseId ? liveDatabase(r, page.databaseId) : null
          if (!page || !db) throw new ApiError(404, 'page_not_found', `No row with id "${a.id}"`)
          return model.rowOut(ws, db.properties, page, model.context(ws, r))
        })
      })(),
  )

  server.registerTool(
    'one_upsert_rows',
    {
      title: 'Mirror rows by key',
      description: desc('one_upsert_rows', `People: a member's email works too.${BODY_NOTE}`),
      inputSchema: {
        databaseId: id,
        keyProperty: z.string().min(1).max(200),
        rows: z
          .array(z.strictObject({ key: z.union([z.string().min(1).max(500), z.number()]), title: z.string().max(2000).optional(), properties: z.record(z.string(), z.unknown()).optional(), markdown: z.string().max(MCP_LIMITS.upsertText).optional() }))
          .min(1)
          .max(MCP_LIMITS.rows),
        ...WS,
      },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, made('one_upsert_rows', a, () => batch.upsertRows(ws, { databaseId: a.databaseId, keyProperty: a.keyProperty, rows: mdEach(a.rows)! }, actor, recorder('one_upsert_rows'))))(),
  )

  server.registerTool(
    'one_create_property',
    {
      title: 'Add a property',
      description: desc('one_create_property'),
      inputSchema: { databaseId: id, ...propertySpec, type: z.enum(CREATABLE_TYPES), ...WS },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, () => writes.createProperty(ws, { databaseId: a.databaseId, name: a.name, type: a.type, options: a.options, relation: a.relation }, actor))(),
  )

  server.registerTool(
    'one_create_database',
    {
      title: 'Create a database',
      description: desc('one_create_database'),
      inputSchema: {
        title: z.string().max(2000),
        parentId: id.nullable().optional(),
        inline: z.strictObject({ pageId: id, afterBlock: z.string().max(200).optional() }).optional(),
        icon: icon.optional(),
        properties: z
          .array(z.strictObject({ ...propertySpec, type: z.enum(['title', ...CREATABLE_TYPES]) }))
          .max(MAX_DB_PROPERTIES)
          .optional(),
        views: z.array(z.strictObject({ type: z.enum(VIEW_TYPES), ...viewSettings })).min(1).max(5).optional(),
        rows: z.array(rowItem).max(MCP_LIMITS.rows).optional(),
        ...WS,
      },
      annotations: CREATE,
    },
    async (a) =>
      run(
        a.workspace,
        made('one_create_database', a, () =>
          batch.createDatabase(
            ws,
            { title: cleanTitle(a.title, 'title'), parentId: a.parentId ?? null, inline: a.inline, icon: a.icon, properties: a.properties, views: a.views?.map((v) => ({ type: v.type, ...viewIn(v) })), rows: mdEach(a.rows) },
            actor,
            recorder('one_create_database', a),
          ),
        ),
      )(),
  )

  server.registerTool(
    'one_update_property',
    {
      title: 'Change a property',
      description: desc('one_update_property'),
      inputSchema: {
        databaseId: id,
        property: propertyRef,
        name: z.string().max(MCP_LIMITS.propertyName).optional().describe('New name'),
        description: z.string().max(2000).optional().describe('Tooltip text ("" removes it)'),
        type: z.enum(CREATABLE_TYPES).optional().describe('New type (see the allowed changes above)'),
        options: z
          .strictObject({
            add: z.array(option).max(100).optional().describe('New options: names, or { name, color, group }'),
            update: z
              .array(z.strictObject({ name: z.string().min(1).max(200), newName: z.string().max(200).optional(), color: z.string().max(20).optional(), group: z.enum(['todo', 'in_progress', 'done']).optional() }))
              .max(100)
              .optional()
              .describe('Rename or recolour options (rows keep them)'),
            remove: z.array(z.string().min(1).max(200)).max(100).optional().describe('Option names to remove — rows that have one lose it'),
          })
          .optional()
          .describe('select, multi_select and status only'),
        ...WS,
      },
      annotations: DESTRUCTIVE,
    },
    async (a) => run(a.workspace, () => structure.updateProperty(ws, { databaseId: a.databaseId, property: a.property, name: a.name, description: a.description, type: a.type, options: a.options }, actor))(),
  )

  server.registerTool(
    'one_delete_property',
    {
      title: 'Delete a property',
      description: desc('one_delete_property'),
      inputSchema: { databaseId: id, property: propertyRef, ...WS },
      annotations: DESTRUCTIVE,
    },
    async (a) => run(a.workspace, () => structure.deleteProperty(ws, { databaseId: a.databaseId, property: a.property }, actor))(),
  )

  server.registerTool(
    'one_update_database',
    {
      title: 'Change a database',
      description: desc('one_update_database'),
      inputSchema: { id, title: z.string().max(2000).optional(), icon: icon.optional().describe('An emoji, "asset:<name>" or "lucide:<IconName>"; "" removes the icon'), locked: z.boolean().optional().describe('Not supported: refused'), ...WS },
      annotations: CHANGE,
    },
    async (a) => run(a.workspace, () => structure.updateDatabase(ws, { id: a.id, title: a.title, icon: a.icon, locked: a.locked }, actor))(),
  )

  server.registerTool(
    'one_create_view',
    {
      title: 'Add a view',
      description: desc('one_create_view'),
      inputSchema: { databaseId: id, type: z.enum(VIEW_TYPES), ...viewSettings, ...WS },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, () => structure.createView(ws, { databaseId: a.databaseId, type: a.type, ...viewIn(a) }, actor))(),
  )

  server.registerTool(
    'one_update_view',
    {
      title: 'Change a view',
      description: desc('one_update_view'),
      inputSchema: { databaseId: id, view: viewRef, type: z.enum(VIEW_TYPES).optional(), ...viewSettings, ...WS },
      annotations: CHANGE,
    },
    async (a) => run(a.workspace, () => structure.updateView(ws, { databaseId: a.databaseId, view: a.view, ...viewIn(a), type: a.type }, actor))(),
  )

  server.registerTool(
    'one_delete_view',
    {
      title: 'Delete a view',
      description: desc('one_delete_view'),
      inputSchema: { databaseId: id, view: viewRef, ...WS },
      annotations: DESTRUCTIVE,
    },
    async (a) => run(a.workspace, () => structure.deleteView(ws, { databaseId: a.databaseId, view: a.view }, actor))(),
  )

  server.registerTool(
    'one_move_page',
    {
      title: 'Move a page',
      description:
        desc('one_move_page'),
      inputSchema: {
        id: id.describe('Page or database id'),
        parentId: id.nullable().optional().describe('The new parent page; null = the top level. Omit to stay under the current parent (reorder only)'),
        before: id.optional().describe('Place it right before this sibling'),
        after: id.optional().describe('Place it right after this sibling'),
        index: z.number().int().min(0).optional().describe('Position among the siblings, 0 = first (default: last)'),
        ...WS,
      },
      annotations: CHANGE,
    },
    async (a) => run(a.workspace, () => tidy.movePage(ws, { id: a.id, parentId: a.parentId, before: a.before, after: a.after, index: a.index }, actor))(),
  )

  server.registerTool(
    'one_move_row',
    {
      title: 'Move a row to another database',
      description:
        desc('one_move_row'),
      inputSchema: { id: id.describe('Row id'), databaseId: id.describe('The database to move it to'), ...WS },
      annotations: CHANGE,
    },
    async (a) => run(a.workspace, () => tidy.moveRow(ws, { id: a.id, databaseId: a.databaseId }, actor))(),
  )

  server.registerTool(
    'one_trash_page',
    {
      title: 'Move to trash',
      description: desc('one_trash_page'),
      inputSchema: { id: id.optional(), ids: ids.optional(), ...WS },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (a) => run(a.workspace, () => tidy.trash(ws, { id: a.id, ids: a.ids }, actor))(),
  )

  server.registerTool(
    'one_restore_page',
    {
      title: 'Restore from the trash',
      description: desc('one_restore_page'),
      inputSchema: { id: id.optional().describe('Id of the trashed page, row or database'), ids: ids.optional(), ...WS },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => run(a.workspace, () => tidy.restore(ws, { id: a.id, ids: a.ids }, actor))(),
  )

  return server
}
