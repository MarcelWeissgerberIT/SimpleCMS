/**
 * One MCP — One Script for agents:
 *  - one_run_query (read): a read-only query → rows as JSON (capped), through the script area's tool
 *    helper (writes, effects and dialogs refused).
 *  - one_run_script (write): a saved script by id or name. Planned as a dry run (dialogs answer their
 *    defaults, nothing happens); the approval card lists what it would change and send, and it is ALWAYS
 *    asked — also in "Apply directly" (`alwaysAsk`). Approved, it runs with the app's dialogs; the list the
 *    card showed is not asked again (a web request or anything the dry run did not show still is).
 *    dryRun: true answers the dry run without asking. A saved query runs read-only, without asking.
 *  Both: a page's `.markdown` / `.text` give only what the person's context marks let through (limits.ts mcpPageText);
 *  a run never writes into One's own databases (system_database — its dry run stops there, so nothing runs).
 */
import { t } from '../../i18n'
import { appRunUI, findScript, preApprovedUI, plannedItems, runQueryForTool, runReport, runScript, runScriptById, silentRunUI, undoRun, type RunResult } from '../script'
import { MCP_QUERY_ROWS } from './contract'
import { chars, str, type PlanLine, type WritePlan } from './plan'
import { live, McpToolError, q, titleOf, ws } from './values'
import { formatWriterKey } from '../../store/writer'
import { mcpPageText } from './limits'
import { systemOf, systemRefusal, type SystemHit } from './system'

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

const dbName = (id: string | null) => (id ? titleOf(ws().pages[id]) : '')

/** The card's lines: each change and effect of the dry run (the first ones, then "+ n more"). */
function dryLines(r: RunResult): PlanLine[] {
  const lines: PlanLine[] = []
  const MAX = 8
  const changes = r.changes.filter((c) => !c.skipped)
  for (const c of changes.slice(0, MAX)) {
    const where = c.dbId ? ` · ${dbName(c.dbId)}` : ''
    const props = c.props?.length ? ` — ${c.props.map((p) => `${p.name}: ${p.before || '—'} → ${p.after || '—'}`).join(', ')}` : ''
    lines.push({ k: 'fact', label: t(`features.mcp.script.change.${c.kind}`), value: `${c.title.trim() || t('common.untitled')}${where}${props}` })
  }
  if (changes.length > MAX) lines.push({ k: 'note', value: t('features.mcp.plan.more', { n: chars(changes.length - MAX) }) })
  for (const e of r.effects.slice(0, MAX)) lines.push({ k: 'fact', label: t(`features.mcp.script.effect.${e.kind}`), value: e.label })
  if (r.effects.length > MAX) lines.push({ k: 'note', value: t('features.mcp.plan.more', { n: chars(r.effects.length - MAX) }) })
  if (!changes.length && !r.effects.length) lines.push({ k: 'note', value: t('features.mcp.script.nothing') })
  lines.unshift({ k: 'note', value: t('features.mcp.script.dryShows') })
  if (r.effects.some((e) => e.kind === 'http')) lines.push({ k: 'note', value: t('features.mcp.script.httpNote') })
  lines.push({ k: 'note', value: t('features.mcp.script.undoNote') })
  return lines
}

/**
 * One's own databases are read-only over MCP (spec § 3.1 / § 3.3): a run started over MCP — its dry run, check pass and
 * run — asks this rule before every write (RunOptions.writeGuard), so it stops before writing into the Coding / spec / QA
 * pipelines, the test cases, the memory and its log, Mails or the mail directories (a row, a page below a row, a new
 * row, the trash, a two-way partner's rows). `hit` keeps the first refusal for the MCP error.
 */
function systemWrites(): { guard: (t: { pageId?: string | null; dbId?: string | null; parentId?: string | null }) => string | null; hit: () => SystemHit | null } {
  let first: SystemHit | null = null
  return {
    guard(t) {
      for (const id of [t.pageId, t.dbId, t.parentId]) {
        const hit = systemOf(id)
        if (hit) {
          first ??= hit
          return hit.title
        }
      }
      return null
    },
    hit: () => first,
  }
}

/** The system_database refusal of a run the rule stopped. */
const scriptRefusal = (hit: SystemHit, name: string) => systemRefusal(hit, 'script', `the script ${q(name)} writes there`)

/**
 * Plan a run of a saved script: a dry run first. Errors of the dry run (and a script that is gone) are
 * the agent's to fix; a saved query or dryRun: true answer at once (noop — nothing to approve).
 */
export async function planRunScript(args: Record<string, unknown>): Promise<WritePlan & { alwaysAsk: true }> {
  const ref = str(args.script, 'script', { required: true, max: 200 })
  const found = findScript(ref)
  if ('error' in found) throw new McpToolError(found.error)
  const { script } = found
  const rawPage = str(args.pageId, 'pageId', { max: 80 }).trim()
  const page = rawPage ? live(rawPage) : null
  if (rawPage && !page) throw new McpToolError(`not_found: No page with id ${q(rawPage)}. Use one_search to find page ids.`)
  const contextPageId = page?.id ?? null
  const base = { tool: 'one_run_script' as const, alwaysAsk: true as const, verb: t('features.mcp.verb.runScript'), target: script.name }
  const scriptInfo = { id: script.id, name: script.name, kind: script.kind }

  // a saved query only reads: its answer, nothing to approve
  if (script.kind === 'query') {
    const out = await runQueryForTool(script.code, { contextPageId, maxRows: MCP_QUERY_ROWS, textLimit: mcpPageText })
    if (!out.ok) throw new McpToolError(`${out.error} Nothing was changed.`)
    const { ok: _ok, ...answer } = out
    return { ...base, summary: script.name, lines: [], noop: { script: scriptInfo, query: true, ...answer }, apply: async () => ({ result: null }) }
  }

  const sys = systemWrites()
  const dry = await runScript({ code: script.code, mode: 'dry', scriptId: script.id, name: script.name, contextPageId, ui: silentRunUI, record: false, writeGuard: sys.guard, textLimit: mcpPageText })
  // a write into One's own databases: refused before anything ran (the dry run stopped at it)
  const refused = sys.hit()
  if (refused) throw new McpToolError(scriptRefusal(refused, script.name))
  if (dry.status !== 'ok') {
    const report = await runReport(dry, 'dry')
    throw new McpToolError(`The dry run of ${q(script.name)} failed: ${String(report.error ?? dry.status)}. Nothing was changed.`)
  }
  if (args.dryRun === true) return { ...base, summary: script.name, lines: [], noop: { script: scriptInfo, ...(await runReport(dry, 'dry')) }, apply: async () => ({ result: null }) }

  const approved = plannedItems(dry)
  return {
    ...base,
    summary: t('features.mcp.sum.runScript', { name: script.name }),
    lines: dryLines(dry),
    async apply(writer) {
      if (!scriptExists(script.id)) throw new McpToolError(`The script ${q(script.name)} was deleted meanwhile. Nothing was changed.`)
      // the person approved what the dry run of THIS code showed: a script edited while the card was open
      // (another tab, the AI terminal, a team member) is not what they approved
      if (ws().scripts?.[script.id]?.code !== script.code)
        throw new McpToolError(`The script ${q(script.name)} was changed after its dry run. Nothing was changed — call one_run_script again to show the person the new plan.`)
      // the approval toast ("Done: …" with Undo) tells the person; the script's own toast would repeat it
      // a script run started by this MCP call (store/writer.ts: script:<id>:<run> with the call as its cause)
      // the same rule on the run: a run that takes another path than its dry run stops before writing there
      const guard = systemWrites()
      const r = await runScriptById(script.id, { mode: 'run', contextPageId, ui: preApprovedUI(appRunUI, approved), notify: false, writer: { via: formatWriterKey(writer) }, writeGuard: guard.guard, textLimit: mcpPageText })
      if (!r) throw new McpToolError(`${q(script.name)} is already running in One. Nothing was changed — try again when it is done.`)
      const report = await runReport(r, 'run')
      const stopped = guard.hit()
      if (stopped) {
        const made = r.changes.filter((c) => !c.skipped).length
        const msg = scriptRefusal(stopped, script.name)
        throw new McpToolError(made ? msg.replace('Nothing was changed.', `The run stopped there; the ${made} change(s) it made before stay — the person can undo the run in One (Scripts → run log).`) : msg)
      }
      if (r.status === 'cancelled') throw new McpToolError(`The person cancelled the run of ${q(script.name)} in One. Nothing was changed. Do not retry it; ask them instead.`)
      const done = r.changes.filter((c) => !c.skipped).length
      if (r.status !== 'ok')
        throw new McpToolError(`The run of ${q(script.name)} ${r.status === 'stopped' ? 'was stopped' : `stopped with an error: ${String(report.error ?? r.status)}`}. ${done ? `The ${done} change(s) it made before stay — the person can undo the run in One (Scripts → run log).` : 'Nothing was changed.'}`)
      const run = r.run
      return {
        result: { script: scriptInfo, ...report },
        undo: run && r.changes.some((c) => !c.skipped)
          ? () => {
              void undoRun(run)
              return true
            }
          : undefined,
      }
    },
  }
}

const scriptExists = (id: string) => !!ws().scripts?.[id]
