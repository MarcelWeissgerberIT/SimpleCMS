/**
 * One MCP — One Script for agents:
 *  - one_run_query (read): a read-only query → rows as JSON (capped), through the script area's tool
 *    helper (writes, effects and dialogs refused).
 *  - one_run_script: a saved script by id or name — over MCP a DRY RUN only (the owner's decision until T-b): dialogs
 *    answer their defaults, nothing is written or sent, no card; the answer is the dry run's report with `ran: false`
 *    and the next step (the person runs it in One → Scripts). A saved query answers read-only. Read only refuses it as
 *    every write tool.
 *  Both: a page's `.markdown` / `.text` give only what the person's context marks let through (limits.ts mcpPageText);
 *  the dry run stops where a run would write into One's own databases (system_database) or into the text of a page
 *  locked in One (locked), and before a replace of a page the person limited with context marks (rejected).
 */
import { t } from '../../i18n'
import { findScript, runQueryForTool, runReport, runScript, silentRunUI, type RunResult } from '../script'
import { MCP_QUERY_ROWS } from './contract'
import { str, type WritePlan } from './plan'
import { live, McpToolError, q, titleOf, ws } from './values'
import { mcpPageText } from './limits'
import { systemBelow, systemOf, systemRefusal, type SystemHit } from './system'
import { noTargets } from './gate'
import type { WriteTarget, WriteVerdict } from '../script'

/* ------------------------------------------------------------------ one_run_query */

export async function runQuery(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = str(args.code, 'code', { required: true, max: 20_000 })
  const limit = args.limit === undefined || args.limit === null ? MCP_QUERY_ROWS : Number(args.limit)
  if (!Number.isFinite(limit)) throw new McpToolError('"limit" must be a number.')
  // a page's .markdown / .text give only what the person's context marks let through (as one_get_page / one_search)
  const out = await runQueryForTool(code, { maxRows: Math.max(1, Math.min(MCP_QUERY_ROWS, Math.floor(limit))), textLimit: mcpPageText })
  if (!out.ok) throw new McpToolError(`${out.error} Nothing was changed.`)
  const { ok: _ok, ...answer } = out
  return answer
}

/** The activity log's label of a query: its first line. */
export function queryTarget(args: Record<string, unknown>): string {
  const code = typeof args.code === 'string' ? args.code.trim().split('\n').find((l) => l.trim() && !/^\s*(#|\/\/)/.test(l)) ?? '' : ''
  return code.length > 60 ? `${code.slice(0, 59)}…` : code
}

/* ------------------------------------------------------------------ one_run_script */

/**
 * One's own databases are read-only over MCP (spec § 3.1 / § 3.3): the dry run started over MCP asks this rule before
 * every write it plans (RunOptions.writeGuard), so it stops at a write into the Coding / spec / QA pipelines, the test
 * cases, the memory and its log, Mails or the mail directories (a row, a page below a row, a new row, the trash — of
 * such a page or of a page holding one below it —, a two-way partner's rows). A locked page refuses content changes over
 * MCP (spec § 3.3): the text of a page locked in One (append / prepend / replace) stops it the same way. `hit` / `locked`
 * keep the first refusal for the MCP error.
 */
function systemWrites(): { guard: (t: WriteTarget) => WriteVerdict; hit: () => SystemHit | null; locked: () => string | null } {
  let first: SystemHit | null = null
  let lockedFirst: string | null = null
  return {
    guard(t) {
      for (const id of [t.pageId, t.dbId, t.parentId]) {
        // the trash of a page takes its subtree along: a One database below it refuses it (as one_trash_page)
        const hit = t.tree && id === t.pageId && id ? systemBelow(id) : systemOf(id)
        if (hit) {
          first ??= hit
          return hit.title
        }
      }
      const page = t.content && t.pageId ? ws().pages[t.pageId] : undefined
      if (page?.settings.locked) {
        const name = titleOf(page)
        lockedFirst ??= name
        return { locked: name }
      }
      return null
    },
    hit: () => first,
    locked: () => lockedFirst,
  }
}

/** The system_database refusal of a run the rule stopped. */
const scriptRefusal = (hit: SystemHit, name: string) => systemRefusal(hit, 'script', `the script ${q(name)} writes there`)

/** The locked refusal of a run that would change the text of a page locked in One (spec § 3.3). */
const lockedRefusal = (page: string, name: string) =>
  `locked: script: the script ${q(name)} writes into ${q(page)}, which is locked in One: its content cannot change over MCP. Nothing was changed. Leave that page out, or ask the person to unlock it.`

/**
 * A replace of a page the person limited with context marks (the run reads only the marked blocks — limits.ts
 * mcpPageText): it would overwrite the blocks Claude may not read, as one_update_page's replace would. The host refuses
 * it in every mode (ScriptError 'limited_replace'); this is its MCP refusal — nothing about the hidden blocks.
 */
const limitedRefusal = (r: RunResult, name: string): string | null =>
  r.error?.code === 'limited_replace'
    ? `rejected: script: the script ${q(name)} replaces the text of ${q(String(r.error.params.name ?? ''))} — the person limited what you may read on this page (context marks); a replace would overwrite blocks you may not read. Nothing was changed. Append instead (append()), or ask the person.`
    : null

/** What every answer of one_run_script says: nothing ran, and how the script runs (model-facing English). */
export const DRY_ONLY_NOTE =
  'This was a dry run: nothing was changed. Over MCP a saved script only dry-runs — to run it, ask the person to run it in One → Scripts.'

/**
 * one_run_script: a saved query answers read-only; a script dry-runs (no card, nothing written or sent) and answers its
 * report with `ran: false` and DRY_ONLY_NOTE. Errors of the dry run (and a script that is gone) are the agent's to fix.
 */
export async function planRunScript(args: Record<string, unknown>): Promise<WritePlan> {
  const ref = str(args.script, 'script', { required: true, max: 200 })
  const found = findScript(ref)
  if ('error' in found) throw new McpToolError(found.error)
  const { script } = found
  const rawPage = str(args.pageId, 'pageId', { max: 80 }).trim()
  const page = rawPage ? live(rawPage) : null
  if (rawPage && !page) throw new McpToolError(`not_found: No page with id ${q(rawPage)}. Use one_search to find page ids.`)
  const contextPageId = page?.id ?? null
  const base = { tool: 'one_run_script' as const, verb: t('features.mcp.verb.dryRunScript'), target: script.name, summary: script.name, lines: [], targets: noTargets(), apply: async () => ({ result: null }) }
  const scriptInfo = { id: script.id, name: script.name, kind: script.kind }

  // a saved query only reads: its answer
  if (script.kind === 'query') {
    const out = await runQueryForTool(script.code, { contextPageId, maxRows: MCP_QUERY_ROWS, textLimit: mcpPageText })
    if (!out.ok) throw new McpToolError(`${out.error} Nothing was changed.`)
    const { ok: _ok, ...answer } = out
    return { ...base, noop: { script: scriptInfo, query: true, ...answer } }
  }

  const sys = systemWrites()
  const dry: RunResult = await runScript({ code: script.code, mode: 'dry', scriptId: script.id, name: script.name, contextPageId, ui: silentRunUI, record: false, writeGuard: sys.guard, textLimit: mcpPageText })
  // a write into One's own databases, into a page locked in One, a replace under context marks: refused (the dry run
  // stopped there)
  const refused = sys.hit()
  if (refused) throw new McpToolError(scriptRefusal(refused, script.name))
  const locked = sys.locked()
  if (locked !== null) throw new McpToolError(lockedRefusal(locked, script.name))
  const limited = limitedRefusal(dry, script.name)
  if (limited) throw new McpToolError(limited)
  if (dry.status !== 'ok') {
    const report = await runReport(dry, 'dry')
    throw new McpToolError(`The dry run of ${q(script.name)} failed: ${String(report.error ?? dry.status)}. Nothing was changed.`)
  }
  return { ...base, noop: { script: scriptInfo, ran: false, ...(await runReport(dry, 'dry')), note: DRY_ONLY_NOTE }, noopNote: t('features.mcp.log.dryOnly') }
}
