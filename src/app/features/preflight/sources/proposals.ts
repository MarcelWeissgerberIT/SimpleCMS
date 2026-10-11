/**
 * Lamp "Proposals": what waits for the person's review — open changes of agent runs (this member's browser agents on
 * this device, own server agents from agent-runs/open), the AI terminal's staged changes and memory proposals (this
 * tab), AI-menu results waiting (this device) and autofill reviews (this tab). Ids:
 *   run:<runId>#<changeId> · term:<tabNonce>:<changeId> · mem:<tabNonce>:<cardId>:<itemId> · airun:<runId> ·
 *   fill:<dbId>:<propId>:<rowId>
 * An agent's `send` proposal counts only while its Outbox slip is open (the Outbox's probe). `superseded` never counts.
 */
import { useWorkspace } from '../../../store/store'
import type { CustomAgent } from '../../../store/types'
import { navigate, openPage } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { useAutofill } from '../../../database'
import { t } from '../../../i18n'
import { onRunsChanged, useAgentRuns, useServerAgents } from '../../agents'
import type { AgentRun } from '../../agents/types'
import { openAgent, useAgent } from '../../ai/agent/state'
import { currentScope, useAIRuns } from '../../ai/runs'
import { onSlips, slipProbe, type LampReading, type LampSourceDef } from '../registry'
import { all, tn, watch } from './util'

/** this tab's load: terminal and memory ids never repeat across reloads (their change ids restart at c1) */
const TAB_NONCE = Math.random().toString(36).slice(2, 8)

type Part = 'mirror' | 'agent' | 'terminal' | 'memory' | 'aimenu' | 'autofill'

const waits = (status: string) => status === 'pending' || status === 'failed'

/** Agents whose proposals count here: own browser agents (this device's runs), own server agents (agent-runs/open). */
function countsHere(a: CustomAgent, me: string | null, team: boolean): 'browser' | 'server' | null {
  if (a.runner === 'server') return team && !!me && a.createdBy === me ? 'server' : null
  if (!team) return 'browser'
  return !!me && a.createdBy === me ? 'browser' : null
}

/** The open changes of one run (none while it is still running). */
function openChanges(run: AgentRun): string[] {
  if (run.status === 'running') return []
  const probe = slipProbe()
  const out: string[] = []
  for (const c of run.staged ?? []) {
    if (!waits(c.status)) continue
    if (c.kind === 'send' && c.send?.slipId && probe && probe.isOpen(c.send.slipId) === false) continue
    out.push(`run:${run.id}#${c.id}`)
  }
  return out
}

interface Tally {
  ids: string[]
  parts: Record<Part, number>
  /** the agent with most open proposals (the rule card's "Open") */
  top: { agentId: string; n: number } | null
}

function tally(): Tally {
  const ws = useWorkspace.getState()
  const cloud = useCloud.getState()
  const team = cloud.active.kind === 'cloud'
  const me = cloud.user?.id ?? null
  const ids: string[] = []
  const parts: Record<Part, number> = { mirror: 0, agent: 0, terminal: 0, memory: 0, aimenu: 0, autofill: 0 }
  let top: Tally['top'] = null
  const byAgent = useAgentRuns.getState().byAgent
  const server = useServerAgents.getState().open ?? []
  for (const a of Object.values(ws.agents ?? {})) {
    const where = countsHere(a, me, team)
    if (!where) continue
    const runs = where === 'browser' ? (byAgent[a.id] ?? []) : server.filter((r) => r.agentId === a.id)
    let n = 0
    for (const r of runs) {
      const open = openChanges(r)
      n += open.length
      ids.push(...open)
    }
    if (!n) continue
    parts[a.mirrorOf ? 'mirror' : 'agent'] += n
    if (!top || n > top.n) top = { agentId: a.id, n }
  }
  const term = useAgent.getState()
  for (const c of term.changes) {
    if (!waits(c.status)) continue
    ids.push(`term:${TAB_NONCE}:${c.id}`)
    parts.terminal++
  }
  for (const card of term.memCards) {
    if (card.state !== 'ready') continue
    for (const it of card.items) {
      if (it.status !== 'pending') continue
      ids.push(`mem:${TAB_NONCE}:${card.id}:${it.id}`)
      parts.memory++
    }
  }
  const scope = currentScope()
  for (const r of Object.values(useAIRuns.getState().runs)) {
    if (r.scope !== scope || r.status !== 'done') continue
    if (r.req.kind === 'memory') {
      if (!r.proposals?.length || r.memSaved) continue
      parts.memory++
    } else parts.aimenu++
    ids.push(`airun:${r.id}`)
  }
  for (const job of Object.values(useAutofill.getState().jobs)) {
    if (job.phase !== 'review' || job.cancelled) continue
    for (const [rowId, p] of Object.entries(job.results)) {
      if (p.status !== 'pending') continue
      ids.push(`fill:${job.dbId}:${job.propId}:${rowId}`)
      parts.autofill++
    }
  }
  return { ids, parts, top }
}

let lastTop: Tally['top'] = null
let lastParts: Record<Part, number> | null = null

export const proposalsLamp: LampSourceDef = {
  id: 'proposals',
  order: 10,
  legend: () => t('features.preflight.lamp.proposals.legend'),
  short: () => t('features.preflight.lamp.proposals.short'),
  rule: () => t('features.preflight.lamp.proposals.rule'),
  thresholds: { amber: 1, red: 15 },
  subscribe: (changed) =>
    all(
      watch(useAgentRuns, (s) => [s.byAgent], changed),
      onRunsChanged(() => changed()),
      watch(useServerAgents, (s) => [s.open], changed),
      watch(useWorkspace, (s) => [s.agents], changed),
      watch(useAgent, (s) => [s.changes, s.memCards], changed),
      watch(useAIRuns, (s) => [s.runs], changed),
      watch(useAutofill, (s) => [s.jobs], changed),
      watch(useCloud, (s) => [s.user, s.active], changed),
      onSlips(changed),
    ),
  read(): LampReading {
    const { ids, parts, top } = tally()
    lastTop = top
    lastParts = parts
    const sources = Object.values(parts).filter((n) => n > 0).length
    const kept: Record<string, number> = {}
    for (const [k, n] of Object.entries(parts)) if (n) kept[k] = n
    return { state: 'ok', count: ids.length, ids, parts: kept, second: tn('features.preflight.lamp.proposals.second', sources) }
  },
  open() {
    const parts = lastParts
    // the sub-source with most items: an agent's page · the terminal · an AI-menu result's page
    const agents = (parts?.mirror ?? 0) + (parts?.agent ?? 0)
    const term = (parts?.terminal ?? 0) + (parts?.memory ?? 0)
    if (lastTop && agents >= term && agents >= (parts?.aimenu ?? 0)) return navigate({ name: 'agents', id: lastTop.agentId })
    if (term && term >= (parts?.aimenu ?? 0)) return void openAgent()
    const scope = currentScope()
    const run = Object.values(useAIRuns.getState().runs).find((r) => r.scope === scope && r.status === 'done')
    if (run) {
      useAIRuns.setState({ openRequest: run.id })
      return openPage(run.pageId)
    }
    navigate({ name: 'agents' })
  },
}
