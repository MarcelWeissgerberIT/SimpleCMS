/**
 * One MCP — One's own databases are read-only over MCP (spec § 3.3): the memory and its log, Mails and the mail
 * directories, the Coding · Business analysis · QA pipelines and the test cases (`Database.system`). A Stage set over
 * MCP would start the coding worker on the person's computer; a row in the memory becomes `<one_memory>` in every
 * free-form request. So nothing in such a database — the database page, its schema and views, its rows, the pages below
 * its rows — is created, changed, moved or trashed over MCP, and nothing points a new block of one into a page.
 * Reading stays allowed. Memories come only through One's own confirmed flows.
 *
 * The seams (small and exported — other guards build on them, e.g. a branch that guards more agent tools):
 *  - systemOf(id): the One database a page belongs to (itself, a row, a page below a row) — null for ordinary pages.
 *  - systemRefusal(hit): the `system_database` error.
 *  - assertNotSystem(id) / assertTreeNotSystem(id): refuse a page in (or a tree holding) a system database.
 *  - systemGuard(tool): an agent tool for MCP staging that refuses ids in a system database before it runs and checks
 *    every change it staged after (stage.ts wraps every tool with it, around guardPipelineRows as a backstop).
 */
import { inTemplate } from '../../store/selectors'
import type { Database, ID, Page } from '../../store/types'
import { ToolInputError, type AgentTool, type StageApi } from '../ai/agent/tools'
import type { StagedChange } from '../ai/agent/types'
import { McpToolError, q, titleOf, ws } from './values'

export type SystemKind = NonNullable<Database['system']>

export interface SystemHit {
  kind: SystemKind
  /** the database page */
  dbId: ID
  title: string
}

/** What One calls each of its databases in an MCP error (English, model-facing). */
const KIND_TEXT: Record<SystemKind, string> = {
  memory: 'memory',
  'memory-log': 'memory log',
  mails: 'Mails',
  'mail-contacts': 'mail contacts',
  'mail-companies': 'mail companies',
  'mail-conversations': 'mail conversations',
  coding: 'Coding pipeline',
  spec: 'Business analysis pipeline',
  qa: 'QA pipeline',
  testcases: 'test cases',
}

/**
 * The One database `id` belongs to: the database page itself, one of its rows, or a page below a row (or below its
 * database page). Walks parents and databases (cycle-safe). null: an ordinary page, or unknown.
 */
export function systemOf(id: ID | null | undefined): SystemHit | null {
  if (!id) return null
  const { pages, databases } = ws()
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const db = cur.kind === 'database' ? databases[cur.id] : undefined
    if (db?.system) return { kind: db.system, dbId: cur.id, title: titleOf(cur) }
    const up: ID | null = cur.databaseId ?? cur.parentId ?? null
    cur = up ? pages[up] : undefined
  }
  return null
}

/** What one_get_database says about a One database (B and S word it alike). */
export const systemNote = (kind: SystemKind): string => `One's ${KIND_TEXT[kind] ?? kind} database: read-only over MCP (rows, properties, views).`

/** The `system_database` refusal (spec § 2.0 error shape). */
export function systemRefusal(hit: SystemHit): string {
  return `system_database: ${q(hit.title)} is One's ${KIND_TEXT[hit.kind] ?? hit.kind} database; over MCP it is read-only (its rows, the pages below them, its properties and views). Nothing was changed. Reading it stays allowed; changes there are made in One.`
}

/** Refuse a page that belongs to a One database. */
export function assertNotSystem(id: ID | null | undefined): void {
  const hit = systemOf(id)
  if (hit) throw new McpToolError(systemRefusal(hit))
}

/** A One database inside this page's tree (the page itself or anything below it) — trashing the page would take it along. */
export function systemBelow(id: ID): SystemHit | null {
  const { pages, databases } = ws()
  const own = systemOf(id)
  if (own) return own
  const kids = new Map<ID, ID[]>()
  for (const p of Object.values(pages)) {
    if (p.trashed || !p.parentId) continue
    const list = kids.get(p.parentId)
    if (list) list.push(p.id)
    else kids.set(p.parentId, [p.id])
  }
  const stack = [id]
  const seen = new Set<ID>(stack)
  while (stack.length) {
    for (const kid of kids.get(stack.pop()!) ?? []) {
      if (seen.has(kid)) continue
      seen.add(kid)
      const p = pages[kid]
      const db = p?.kind === 'database' ? databases[kid] : undefined
      if (db?.system && !inTemplate(pages, kid)) return { kind: db.system, dbId: kid, title: titleOf(p) }
      stack.push(kid)
    }
  }
  return null
}

/** Refuse a page whose tree holds a One database (trash / restore take it along). */
export function assertTreeNotSystem(id: ID): void {
  const hit = systemBelow(id)
  if (hit) throw new McpToolError(systemRefusal(hit))
}

/** The ids an agent tool's input names (the same keys features/agents/scope.ts checks). */
const ID_KEYS = ['id', 'database_id', 'parent_id', 'page_id'] as const

/** The pages a staged change writes: the page itself when it exists, its parent / database for a new one. */
function changedPlaces(c: StagedChange): ID[] {
  return [c.pageId, c.parentId ?? null, c.databaseId ?? null].filter((x): x is ID => !!x)
}

/** The first staged change of `changes` that writes into a One database (null: none). */
export function systemChange(changes: readonly StagedChange[]): SystemHit | null {
  for (const c of changes) {
    for (const id of changedPlaces(c)) {
      const hit = systemOf(id)
      if (hit) return hit
    }
  }
  return null
}

/**
 * An agent tool as MCP may run it: a write naming a page in a One database is refused before it runs, and every change
 * it staged is checked after (a task moved by id, a row resolved by its key …). Read tools run as they are.
 */
export function systemGuard(tool: AgentTool): AgentTool {
  if (!tool.write) return tool
  const before = (input: Record<string, unknown>, stage: StageApi) => {
    for (const key of ID_KEYS) {
      const raw = input[key]
      if (typeof raw !== 'string' || !raw.trim()) continue
      const hit = systemOf(stage.resolve(raw.trim()))
      if (hit) throw new ToolInputError(systemRefusal(hit))
    }
  }
  // every change of the call's stage (an earlier one may have been extended by this run)
  const after = (stage: StageApi) => {
    const hit = systemChange(stage.list())
    if (hit) throw new ToolInputError(systemRefusal(hit))
  }
  return {
    ...tool,
    run(input, stage) {
      before(input, stage)
      const out = tool.run(input, stage)
      if (out instanceof Promise)
        return out.then((o) => {
          after(stage)
          return o
        })
      after(stage)
      return out
    },
  }
}
