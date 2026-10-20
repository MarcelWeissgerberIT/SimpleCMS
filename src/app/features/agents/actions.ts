/** Custom agents — what the UI does: run now, switch on / off, delete. */
import type { AgentInvocation } from '@/shared/agents/invocation'
import { checkedInvocation } from './invocation'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { CustomAgent, ID } from '../../store/types'
import { navigate } from '../../lib/router'
import { t } from '../../i18n'
import { executeRun, startFor } from './exec'
import { newId } from '../../lib/ids'
import { currentLang } from '../../i18n'
import { fmtUsd } from '../../lib/money'
import { startCheck } from '../ai/core/gate'
import { allowTask, fmtBand, fmtLimit } from '../governor'
import { dropRuns } from './runs'
import { loadServerRuns, runOnServer, serverErrorText } from './server'
import { placeholdersIn } from './mirror'
import { AGENT_PLACEHOLDERS } from './instructions'
import { findPlaceholders } from '../../ui/code/placeholders'

/**
 * A recipe's placeholders still in the job (mirror.ts): such an agent neither runs nor is switched on — it says so.
 * (The editor refuses to save it switched on; this covers the card's switch and "Run now" of a saved draft.)
 */
function unfinished(agent: CustomAgent): boolean {
  const left = placeholdersIn(agent.instructions).length
  if (!left) return false
  useUI.getState().toast({ message: t('features.agents.mirror.err.unfinished', { name: agent.name, count: left }), kind: 'error' })
  return true
}

/**
 * Start a run now: in this tab (browser runner) or on the team server. A recipe's placeholders refuse it (above);
 * any other open placeholder ("[HOW TO LIST THE ITEMS]", instructions.ts) asks first — Claude would read it literally.
 * At the Regler's red line a browser run asks before it starts, wherever "Run now" was pressed (the agent page,
 * Preflight, a database command, ⌘K): the rest and the first step's band, "+1 $ once and start" only when that makes
 * it fit (an allowance for this run, today — keyed to the run id minted here) · cancel. It never waits mid-run.
 */
export async function runNow(agent: CustomAgent, opts: { confirmed?: boolean; invocation?: AgentInvocation } = {}): Promise<void> {
  agent = useWorkspace.getState().agents?.[agent.id] ?? agent
  try { checkedInvocation(agent, opts.invocation) } catch (e) { useUI.getState().toast({ message: e instanceof Error ? e.message : t('features.agents.invoke.outside'), kind: 'error' }); return }
  if (unfinished(agent)) return
  const hits = opts.confirmed ? [] : findPlaceholders(agent.instructions, AGENT_PLACEHOLDERS)
  if (hits.length) {
    useUI.getState().openModal({
      type: 'confirm',
      title: t('features.agents.ph.title'),
      body: t(hits.length === 1 ? 'features.agents.ph.body.one' : 'features.agents.ph.body.other', { name: agent.name, count: hits.length, first: hits[0].text }),
      confirmLabel: t('features.agents.ph.run'),
      onConfirm: () => void runNow(agent, { ...opts, confirmed: true }),
    })
    return
  }
  if (agent.runner === 'server') {
    try {
      await runOnServer(agent.id, opts.invocation)
      useUI.getState().toast({ message: t('features.agents.toast.serverStarted', { name: agent.name }), kind: 'success' })
      window.setTimeout(() => void loadServerRuns(agent.id), 1200)
    } catch (e) {
      useUI.getState().toast({ message: t('features.agents.toast.serverFailed', { msg: serverErrorText(e) }), kind: 'error' })
    }
    return
  }
  const runId = newId()
  const req = { trigger: { type: 'manual' as const }, manual: true, runId, ...(opts.invocation ? { invocation: opts.invocation } : {}) }
  // the first step and, with a Vorprüfer, the band its checks reserve right after the start
  const execute = async () => {
    try { await executeRun(agent, req) }
    catch (e) { useUI.getState().toast({ message: e instanceof Error ? e.message : t('features.agents.invoke.outside'), kind: 'error' }) }
  }
  try {
    const input = await startFor(agent, req, runId)
    const v = await startCheck(input)
    if (!v.start) return void startAsk(agent, v, () => {
      allowTask(input.run!.source!, 1)
      void execute()
    })
    await execute()
  } catch (e) { useUI.getState().toast({ message: e instanceof Error ? e.message : t('features.agents.invoke.outside'), kind: 'error' }) }
}

/** The start dialog at the red line (a manual run): the rest, the first step; E only when +1 $ makes it fit. */
function startAsk(agent: CustomAgent, v: Awaited<ReturnType<typeof startCheck>>, allowAndStart: () => void): void {
  const lang = currentLang()
  const ui = useUI.getState()
  if ('refuse' in v) {
    // the route the check priced, as people read it (never a raw id, never the agent's own name)
    ui.toast({ message: t(v.refuse === 'scope' ? 'features.governor.note.scope' : 'features.governor.note.noprice', { model: v.label || t('features.governor.note.thisModel') }), kind: 'error' })
    return
  }
  if (!('ask' in v)) return
  const a = v.ask
  const lead = t(v.checks ? 'features.governor.start.leadChecks' : 'features.governor.start.lead', { rest: fmtUsd(Math.max(0, Math.min(a.rest.day, a.rest.month, a.rest.run)), lang), band: fmtBand(a.first, lang) })
  ui.openModal({
    type: 'confirm',
    title: t('features.governor.start.titleNamed', { name: agent.name }),
    body: a.allow !== null ? lead : `${lead} ${t('features.governor.start.need', { usd: fmtUsd(a.need, lang) })}`,
    confirmLabel: t('features.governor.start.allow', { usd: fmtLimit(a.allow ?? 1, lang) }),
    ...(a.allow === null ? { noConfirm: true } : {}),
    onConfirm: allowAndStart,
  })
}

export function setEnabled(agent: CustomAgent, enabled: boolean): void {
  if (enabled && unfinished(agent)) return
  useWorkspace.getState().upsertAgent({ ...agent, enabled })
}

/** Delete an agent (asks first); its runs on this device go too. */
export function deleteAgent(id: ID): void {
  const agent = useWorkspace.getState().agents?.[id]
  if (!agent) return
  useUI.getState().openModal({
    type: 'confirm',
    title: t('features.agents.del.title', { name: agent.name }),
    body: t('features.agents.del.body'),
    danger: true,
    confirmLabel: t('features.agents.del.confirm'),
    onConfirm: () => {
      useWorkspace.getState().deleteAgent(id)
      void dropRuns(id)
      navigate('#/agents')
    },
  })
}
