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
import { systemBelow, systemOf, systemRefusal, type SystemHit } from './system'

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

/**
 * The most lines of each kind a card lists (a run beyond it is rare): what the card does not list is not approved by it —
 * One asks for those in its own dialog before the run.
 */
const CARD_MAX = 500

/**
 * The card's lines — EVERY change and effect of the dry run (each an entry of the card's scroll region: the person
 * approves only what they saw) — and the things the run would ask for (effects, the trash) that the card listed: only
 * those are not asked again (preApprovedUI).
 */
function dryPlan(r: RunResult): { lines: PlanLine[]; approved: ReturnType<typeof plannedItems> } {
  const lines: PlanLine[] = []
  const changes = r.changes.filter((c) => !c.skipped)
  const shown = new Set(changes.slice(0, CARD_MAX))
  for (const c of shown) {
    const where = c.dbId ? ` · ${dbName(c.dbId)}` : ''
    const props = c.props?.length ? ` — ${c.props.map((p) => `${p.name}: ${p.before || '—'} → ${p.after || '—'}`).join(', ')}` : ''
    lines.push({ k: 'fact', entry: true, label: t(`features.mcp.script.change.${c.kind}`), value: `${c.title.trim() || t('common.untitled')}${where}${props}` })
  }
  if (changes.length > CARD_MAX) lines.push({ k: 'note', value: `${t('features.mcp.plan.more', { n: chars(changes.length - CARD_MAX) })} ${t('features.mcp.script.askedInOne')}` })
  const effects = r.effects.slice(0, CARD_MAX)
  for (const e of effects) lines.push({ k: 'fact', entry: true, label: t(`features.mcp.script.effect.${e.kind}`), value: e.label })
  if (r.effects.length > CARD_MAX) lines.push({ k: 'note', value: `${t('features.mcp.plan.more', { n: chars(r.effects.length - CARD_MAX) })} ${t('features.mcp.script.askedInOne')}` })
  if (!changes.length && !r.effects.length) lines.push({ k: 'note', value: t('features.mcp.script.nothing') })
  lines.unshift({ k: 'note', value: t('features.mcp.script.dryShows') })
  if (r.effects.some((e) => e.kind === 'http')) lines.push({ k: 'note', value: t('features.mcp.script.httpNote') })
  lines.push({ k: 'note', value: t('features.mcp.script.undoNote') })
  // the keys of what the card listed (plannedItems' keys: each effect's own, `trash#n` = the n-th trash of the run)
  const listed = new Set(effects.map((e) => e.key))
  let n = 0
  for (const c of r.changes) if (c.kind === 'trash' && ++n && shown.has(c)) listed.add(`trash#${n}`)
  return { lines, approved: plannedItems(r).filter((i) => listed.has(i.key)) }
}

/**
 * One's own databases are read-only over MCP (spec § 3.1 / § 3.3): a run started over MCP — its dry run, check pass and
 * run — asks this rule before every write (RunOptions.writeGuard), so it stops before writing into the Coding / spec / QA
 * pipelines, the test cases, the memory and its log, Mails or the mail directories (a row, a page below a row, a new
 * row, the trash — of such a page or of a page holding one below it —, a two-way partner's rows). `hit` keeps the first refusal for the MCP error.
 */
function systemWrites(): { guard: (t: { pageId?: string | null; dbId?: string | null; parentId?: string | null; tree?: boolean }) => string | null; hit: () => SystemHit | null } {
  let first: SystemHit | null = null
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
      return null
    },
    hit: () => first,
  }
}

/** The system_database refusal of a run the rule stopped. */
const scriptRefusal = (hit: SystemHit, name: string) => systemRefusal(hit, 'script', `the script ${q(name)} writes there`)

/**
 * A replace of a page the person limited with context marks (the run reads only the marked blocks — limits.ts
 * mcpPageText): it would overwrite the blocks Claude may not read, as one_update_page's replace would. The host refuses
 * it in every mode (ScriptError 'limited_replace'); this is its MCP refusal — nothing about the hidden blocks.
 */
const limitedRefusal = (r: RunResult, name: string): string | null =>
  r.error?.code === 'limited_replace'
    ? `rejected: script: the script ${q(name)} replaces the text of ${q(String(r.error.params.name ?? ''))} — the person limited what you may read on this page (context marks); a replace would overwrite blocks you may not read. Nothing was changed. Append instead (append()), or ask the person.`
    : null

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
  const limited = limitedRefusal(dry, script.name)
  if (limited) throw new McpToolError(limited)
  if (dry.status !== 'ok') {
    const report = await runReport(dry, 'dry')
    throw new McpToolError(`The dry run of ${q(script.name)} failed: ${String(report.error ?? dry.status)}. Nothing was changed.`)
  }
  if (args.dryRun === true) return { ...base, summary: script.name, lines: [], noop: { script: scriptInfo, ...(await runReport(dry, 'dry')) }, apply: async () => ({ result: null }) }

  const { lines, approved } = dryPlan(dry)
  return {
    ...base,
    summary: t('features.mcp.sum.runScript', { name: script.name }),
    lines,
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
      // a run that stopped after it changed something: those changes stay — the answer says so and that calling again
      // would make them twice (partial: no "Nothing was changed … call again" is added to it)
      const stays = (n: number) => `The ${n} change(s) it made before stay — the person can undo the run in One (Scripts → run log). Do not call it again (that would make them twice); tell the person.`
      // a replace of a page under context marks the dry run did not reach (marks set while the card waited, another path)
      const limitedNow = stopped ? null : limitedRefusal(r, script.name)
      if (stopped || limitedNow) {
        const made = r.changes.filter((c) => !c.skipped).length
        const msg = stopped ? scriptRefusal(stopped, script.name) : limitedNow!
        if (!made) throw new McpToolError(msg)
        // what the refusal says up to its "Nothing was changed." — which is not so here
        const head = msg.slice(0, msg.indexOf(' Nothing was changed.'))
        throw new McpToolError(`${head} The run stopped there. ${stays(made)}`, { partial: true })
      }
      if (r.status === 'cancelled') throw new McpToolError(`The person cancelled the run of ${q(script.name)} in One. Nothing was changed. Do not retry it; ask them instead.`)
      const done = r.changes.filter((c) => !c.skipped).length
      const why = r.status === 'stopped' ? 'was stopped' : `stopped with an error: ${String(report.error ?? r.status)}`
      if (r.status !== 'ok') {
        if (done) throw new McpToolError(`rejected: The run of ${q(script.name)} ${why}. ${stays(done)}`, { partial: true })
        throw new McpToolError(`The run of ${q(script.name)} ${why}. Nothing was changed.`)
      }
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
