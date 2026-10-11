/**
 * Lamp "Proposals": what waits for the person's review — open changes of agent runs (this member's browser agents on
 * this device, own server agents from agent-runs/open), the AI terminal's staged changes and memory proposals (this
 * tab), AI-menu results waiting (this device) and autofill reviews (this tab). Ids:
 *   run:<runId>#<changeId> · term:<tabNonce>:<changeId> · mem:<tabNonce>:<cardId>:<itemId> · airun:<runId> ·
 *   fill:<dbId>:<propId>:<rowId>
 * An agent's `send` proposal counts only while its Outbox slip is open (the Outbox's probe). `superseded` never counts.
 */
import { useWorkspace } from '../../../store/store'
import { navigate, openPage } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { useAutofill } from '../../../database'
import { t } from '../../../i18n'
import { onRunsChanged, useAgentRuns, useServerAgents } from '../../agents'
import { openAgent, useAgent } from '../../ai/agent/state'
import { currentScope, useAIRuns } from '../../ai/runs'
import { onSlips, type CardAction, type Done, type LampReading, type LampSourceDef, type QueueItem } from '../registry'
import { all, tn, watch } from './util'
import { AGENT_PREFIX, agentActions, agentBulkApply, agentBulkDiscard, agentItems, combine } from './proposals/agents'
import { TERM_PREFIX, terminalActions, terminalBulkApply, terminalItems } from './proposals/terminal'
import { AIRUN_PREFIX, MEM_PREFIX, memoryActions, memoryItems, prepareMemory } from './proposals/memory'
import { openActions, openItems } from './proposals/open'

type Part = 'mirror' | 'agent' | 'terminal' | 'memory' | 'aimenu' | 'autofill'

/** sub-source order (QueueItem.sub) → its part of the rule card */
const PART_OF: Part[] = ['mirror', 'agent', 'terminal', 'memory', 'memory', 'aimenu', 'autofill']

/** Every proposal that counts here, as cards — the reading's ids are exactly these (one builder for both). */
export function proposalItems(): QueueItem[] {
  return [...agentItems(), ...terminalItems(), ...memoryItems(), ...openItems()]
}

interface Tally {
  ids: string[]
  parts: Record<Part, number>
  /** the agent with most open proposals (the rule card's "Open") */
  top: { agentId: string; n: number } | null
}

function tally(): Tally {
  const items = proposalItems()
  const parts: Record<Part, number> = { mirror: 0, agent: 0, terminal: 0, memory: 0, aimenu: 0, autofill: 0 }
  const byAgent = new Map<string, number>()
  for (const it of items) {
    parts[PART_OF[it.sub ?? 0] ?? 'agent']++
    if (it.refs.agentId) byAgent.set(it.refs.agentId, (byAgent.get(it.refs.agentId) ?? 0) + 1)
  }
  let top: Tally['top'] = null
  for (const [agentId, n] of byAgent) if (!top || n > top.n) top = { agentId, n }
  return { ids: items.map((i) => i.id), parts, top }
}

/** The proposals' keys, by the card's source. */
function actionsOf(item: QueueItem): CardAction[] {
  if (item.id.startsWith(AGENT_PREFIX)) return agentActions(item)
  if (item.id.startsWith(TERM_PREFIX)) return terminalActions(item)
  if (item.id.startsWith(MEM_PREFIX) || (item.id.startsWith(AIRUN_PREFIX) && item.kind === 'memory')) return memoryActions(item)
  return openActions(item)
}

/** One batch over several sub-sources: agents one call per run, the terminal one call, the rest one by one. */
async function bulk(items: QueueItem[], key: 'a' | 'd'): Promise<Done> {
  const agents = items.filter((i) => i.id.startsWith(AGENT_PREFIX))
  const term = items.filter((i) => i.id.startsWith(TERM_PREFIX))
  const rest = items.filter((i) => !agents.includes(i) && !term.includes(i))
  const results: Done[] = []
  if (agents.length) results.push(await (key === 'a' ? agentBulkApply(agents) : agentBulkDiscard(agents)))
  if (term.length && key === 'a') results.push(await terminalBulkApply(term))
  const singles = key === 'd' ? [...term, ...rest] : rest
  for (const it of singles) {
    const a = actionsOf(it).find((x) => x.key === key)
    if (!a || a.blocked || a.hand?.length) continue
    const r = await a.run(it)
    results.push(r.ok ? { ...r, items: r.items ?? [it.id] } : r)
  }
  const ok = results.filter((r): r is Extract<Done, { ok: true }> => r.ok)
  if (!ok.length) return results.find((r) => !r.ok) ?? { ok: false, error: 'features.preflight.err.notApplied' }
  const undos = ok.map((r) => r.undo).filter((u): u is NonNullable<typeof u> => !!u)
  return { ok: true, items: ok.flatMap((r) => r.items ?? []), ...(undos.length ? { undo: combine(undos) } : { final: ok[0].final }) }
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
    const notCards = supersededToday()
    lastTop = top
    lastParts = parts
    const sources = Object.values(parts).filter((n) => n > 0).length
    const kept: Record<string, number> = {}
    for (const [k, n] of Object.entries(parts)) if (n) kept[k] = n
    return { state: 'ok', count: ids.length, ids, parts: kept, second: tn('features.preflight.lamp.proposals.second', sources), ...(notCards ? { notCards } : {}) }
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
  queue: {
    items: () => proposalItems(),
    prepare: async (item) => {
      if (item.id.startsWith(AIRUN_PREFIX) && item.kind === 'memory') await prepareMemory(item)
    },
    actions: actionsOf,
    bulk: { apply: (items) => bulk(items, 'a'), discard: (items) => bulk(items, 'd') },
  },
}

/** Proposals superseded since the start of today (a note on the rule card: replaced, never cards, never counted). */
function supersededToday(): number {
  const since = new Date().setHours(0, 0, 0, 0)
  let n = 0
  for (const runs of Object.values(useAgentRuns.getState().byAgent)) for (const r of runs ?? []) for (const c of r.staged ?? []) if (c.status === 'superseded' && (c.supersededBy?.at ?? 0) >= since) n++
  return n
}
