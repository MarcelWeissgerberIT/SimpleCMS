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
import type { WorkspaceModel } from '../api/model.ts'
import { FILTER_OPS, sortKeys } from './query.ts'
import { McpReads } from './reads.ts'
import { CREATABLE_TYPES, McpWrites, iconIn } from './writes.ts'

const id = idSchema.describe('A page, row or database id')
const markdown = z.string().max(200_000)
const icon = z.string().max(80).describe('An emoji, "asset:<name>" or "lucide:<IconName>"')
const option = z.union([z.string().min(1).max(200), z.object({ name: z.string().min(1).max(200), color: z.string().optional(), group: z.enum(['todo', 'in_progress', 'done']).optional() })])
const relation = z
  .object({
    databaseId: idSchema.describe('The related database'),
    twoWay: z.boolean().optional().describe('Also add the reverse relation to the other database'),
    reverseName: z.string().min(1).max(200).optional().describe('Name of the reverse property (two-way only)'),
  })
  .describe('relation properties only')
const propertySpec = {
  name: z.string().min(1).max(200),
  options: z.array(option).max(200).optional().describe('select / multi_select / status: option names (or { name, color, group })'),
  relation: relation.optional(),
}
const sortItem = z.object({ property: z.string().min(1), direction: z.enum(['asc', 'desc']).optional() })

const VALUES =
  'Values are plain JSON by property name: text, numbers, true/false, an option name for select and status (a list of names for multi_select), dates as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" or {"start", "end"}, people by email or name, relations by row id or title, null to clear. Formula, rollup, created/edited and unique-id properties are computed and cannot be set.'

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

/** An ApiError as a message for the agent: what went wrong and what is allowed. */
function explain(err: ApiError): string {
  if (err.code === 'parent_is_database') return 'The parent is a database: add a row with one_create_row instead'
  const details = err.details as { errors?: Array<{ allowed?: string[]; property?: string }> } | undefined
  const allowed = (details?.errors ?? []).filter((e) => e.allowed?.length).map((e) => `${e.property}: ${e.allowed!.join(', ')}`)
  return `${err.message}${allowed.length ? ` (allowed — ${allowed.join(' · ')})` : ''}`
}

function instructions(name: string, id: string, write: boolean): string {
  return [
    `SimpleCMS One team workspace "${name}": pages (Markdown content), databases with typed properties, rows (pages inside a database).`,
    `This connection reaches only this workspace (id ${id}); the optional "workspace" argument of every tool is refused when it names another one (workspace_mismatch: nothing was done — ask the person).`,
    'Start with one_overview (page tree, databases, today\'s date); find things with one_search; read a page with one_get_page.',
    'Values are friendly: option names, dates "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (wall-clock, no time zone), member emails for people, row ids for relations.',
    write
      ? 'Changes reach everyone who has the workspace open at once. one_trash_page moves a page to the trash (restorable in the app).'
      : 'This token can only read: the write tools are not available.',
    // keep in step with MCP_INSTRUCTIONS / MCP_PROMPT of the local bridge (src/app/features/mcp/contract.ts)
    'Codeword: a message that starts with "one:" is meant for this One workspace — use these tools for it, not web search or other connectors, even when those could answer too.',
  ].join(' ')
}

/** A fresh MCP server for one request (stateless transport), bound to the token's workspace and scope. */
export function buildMcpServer(s: Services, model: WorkspaceModel, token: ApiTokenRow): McpServer {
  const ws = token.workspace_id
  const actor = `api:${token.id}`
  const write = token.scope === 'write'
  const reads = new McpReads(s, model)
  const writes = new McpWrites(s, model)
  const name = s.repo.workspaceById(ws)?.name ?? ''
  /** The workspace as MCP names it — the same id the local bridge uses for a team workspace. */
  const self = { id: `team:${ws}`, name }
  const server = new McpServer({ name: 'one', title: 'SimpleCMS One', version: s.config.version }, { instructions: instructions(name, self.id, write) })

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
    return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] }
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
      throw new Error('Internal error — the change was not made. Try again in a moment.')
    }
  }

  // the codeword as a prompt (Claude Desktop's "+" menu, Claude Code's /mcp__one__one): "one: <task>"
  server.registerPrompt(
    'one',
    {
      title: 'One',
      description: 'Work in your One workspace: what to look up, write or change there.',
      argsSchema: { task: z.string().describe('What to do in One, e.g. "summarise my meeting notes from this week"') },
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
      description: 'The workspace at a glance: its name, the page tree (ids, titles, icons), every database with its row count, today\'s date and whether this connection may write. Call this first.',
      inputSchema: WS,
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.overview(ws, token.scope))(),
  )

  server.registerTool(
    'one_list_workspaces',
    {
      title: 'Connected workspaces',
      description: 'The workspaces this connection reaches: here exactly one — the API token\'s (id, name, access). No content.',
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
      description: 'Full-text search over page titles and content (pages, database rows, databases). Returns ids, paths and a snippet around the match, best matches first.',
      inputSchema: { query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).optional().describe('default 10'), ...WS },
      annotations: READ,
    },
    async (a) => run(a.workspace, () => reads.search(ws, a.query, a.limit ?? 10))(),
  )

  server.registerTool(
    'one_get_page',
    {
      title: 'Read a page',
      description: 'One page, row or database page by id (or by exact title): title, icon, path, the row\'s properties, the content as Markdown, child pages and backlinks (pages that link here).',
      inputSchema: { id: id.optional(), title: z.string().min(1).max(2000).optional().describe('Exact title (case-insensitive) when the id is not known'), ...WS },
      annotations: READ,
    },
    async (a) =>
      run(a.workspace, async () => {
        if (!a.id && !a.title) throw new ApiError(400, 'invalid_request', 'Give the page id (or its exact title)')
        return reads.getPage(ws, { id: a.id, title: a.title })
      })(),
  )

  server.registerTool(
    'one_list_databases',
    { title: 'List databases', description: 'Every database: id, title, path, row count and property names with types.', inputSchema: WS, annotations: READ },
    async (a) => run(a.workspace, () => reads.listDatabases(ws))(),
  )

  server.registerTool(
    'one_get_database',
    {
      title: 'Database schema',
      description: 'A database\'s schema: properties with type, options (select, multi_select, status), related database (relation), read-only flag; and its views.',
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
        'Rows of a database with their property values by name (option names, ISO dates, people, related rows as { id, title }). Filters are ANDed and compare case-insensitively; property "title" is the row title, "createdAt" / "updatedAt" the timestamps. Ops: equals, not_equals, contains, not_contains, is_empty, is_not_empty, gt, gte, lt, lte (numbers and dates "YYYY-MM-DD"), also starts_with, ends_with, is_checked, is_not_checked. Page through with cursor = the "next" of the previous answer.',
      inputSchema: {
        databaseId: id,
        filter: z.array(z.object({ property: z.string().min(1), op: z.enum(FILTER_OPS), value: z.unknown().optional() })).max(20).optional(),
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
      title: 'Create a page',
      description: 'A new page at the top level or inside another page (not a database — use one_create_row there). Content in Markdown: headings, lists, to-dos (- [ ]), quotes, code blocks, dividers, bold/italic/strike/code, links (#/p/<id> links to a page).',
      inputSchema: { title: z.string().max(2000), parentId: id.nullable().optional(), markdown: markdown.optional(), icon: icon.optional(), ...WS },
      annotations: CREATE,
    },
    async (a) =>
      run(a.workspace, async () => {
        const created = await model.createPage(ws, { title: a.title, parentId: a.parentId ?? null, content: a.markdown, icon: iconIn(a.icon) }, actor)
        return { ...created, title: a.title }
      })(),
  )

  server.registerTool(
    'one_update_page',
    {
      title: 'Update a page',
      description: 'Change a page\'s (or row\'s) title or icon, and append Markdown to its content (mode "append", the default) or replace the content (mode "replace").',
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
    async (a) => run(a.workspace, () => writes.updatePage(ws, { id: a.id, title: a.title, icon: a.icon, markdown: a.markdown, mode: a.mode ?? 'append' }, actor))(),
  )

  server.registerTool(
    'one_create_row',
    {
      title: 'Create a row',
      description: `Add a row to a database: its title, property values and optional Markdown content for the row's page. ${VALUES} An unknown select or multi_select option is created; anything else that does not fit fails the whole call with every problem listed.`,
      inputSchema: { databaseId: id, title: z.string().max(2000), properties: z.record(z.string(), z.unknown()).optional().describe('Property name → value'), markdown: markdown.optional(), ...WS },
      annotations: CREATE,
    },
    async (a) =>
      run(a.workspace, async () => {
        const row = await writes.prepareRow(ws, { databaseId: a.databaseId }, { title: a.title, properties: a.properties }, actor)
        const created = await model.createRow(ws, a.databaseId, { title: row.title ?? a.title, properties: row.properties, content: a.markdown }, actor)
        return { ...created, title: row.title ?? a.title }
      })(),
  )

  server.registerTool(
    'one_update_row',
    {
      title: 'Update a row',
      description: `Set property values of an existing row; only the properties you pass change. ${VALUES} Pass the title property's name (or "title") to rename the row. Answers the row as it is now.`,
      inputSchema: { id, properties: z.record(z.string(), z.unknown()).describe('Property name → new value'), ...WS },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) =>
      run(a.workspace, async () => {
        const row = await writes.prepareRow(ws, { rowId: a.id }, { properties: a.properties }, actor)
        return model.updateRow(ws, a.id, { title: row.title, properties: row.properties }, actor)
      })(),
  )

  server.registerTool(
    'one_create_property',
    {
      title: 'Add a property',
      description: 'Add a property (column) to a database. Types: text, number, select, multi_select, status, date, person, checkbox, url, email, phone, files, relation, rating, created_time, last_edited_time, created_by, last_edited_by, unique_id.',
      inputSchema: { databaseId: id, ...propertySpec, type: z.enum(CREATABLE_TYPES), ...WS },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, () => writes.createProperty(ws, { databaseId: a.databaseId, name: a.name, type: a.type, options: a.options, relation: a.relation }, actor))(),
  )

  server.registerTool(
    'one_create_database',
    {
      title: 'Create a database',
      description: 'A new database (with a table view) at the top level or inside a page. properties: [{ name, type, options?, relation? }] — a title property "Name" is added when none is given; without properties you get Name, Status, Tags, Date.',
      inputSchema: {
        title: z.string().max(2000),
        parentId: id.nullable().optional(),
        properties: z
          .array(z.object({ ...propertySpec, type: z.enum(['title', ...CREATABLE_TYPES]) }))
          .max(50)
          .optional(),
        ...WS,
      },
      annotations: CREATE,
    },
    async (a) => run(a.workspace, () => writes.createDatabase(ws, { title: a.title, parentId: a.parentId ?? null, properties: a.properties }, actor))(),
  )

  server.registerTool(
    'one_trash_page',
    {
      title: 'Move to trash',
      description: 'Move a page, row or database to the trash (pages inside it go along). It can be restored from the trash in the app.',
      inputSchema: { id, ...WS },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (a) => run(a.workspace, () => writes.trashPage(ws, a.id, actor))(),
  )

  return server
}
