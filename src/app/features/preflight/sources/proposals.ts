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
import { onSlips, type CardAction, type Done, type LampReading, type LampSourceDef, type QueueItem, type UndoOutcome } from '../registry'
import type { StagedChange } from '../../ai/agent/types'
import { all, revHash, tn, watch } from './util'
import { AGENT_PREFIX, agentActions, agentBulkApply, agentBulkDiscard, agentChangeOf, agentItems, merged } from './proposals/agents'
import { TERM_PREFIX, terminalActions, terminalBulkApply, terminalChangeOf, terminalItems } from './proposals/terminal'
import { AIRUN_PREFIX, MEM_PREFIX, memoryActions, memoryItems, menuRunDuplicate, menuRunOf, prepareMemory, termMemoryOf } from './proposals/memory'
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

/**
 * A staged change's content (what its body shows), without what only its review changes — its status (held ↔ pending
 * too), its error, and its Vorprüfer's numbers (`jev`, slice SJ).
 */
const changeRev = (c: StagedChange) => revHash({ ...c, status: undefined, error: undefined, supersededBy: undefined, jev: undefined })

/**
 * A card's content revision now: the staged change as it is (the terminal merges a second update_row into the pending
 * one, an append grows in place), a memory proposal's text and the memory it would update. 'gone': nothing to show.
 */
export function proposalRev(item: QueueItem): string {
  if (item.id.startsWith(AGENT_PREFIX)) {
    const ctx = agentChangeOf(item)
    return ctx ? changeRev(ctx.change) : 'gone'
  }
  if (item.id.startsWith(TERM_PREFIX)) {
    const c = terminalChangeOf(item)
    return c ? changeRev(c) : 'gone'
  }
  if (item.id.startsWith(MEM_PREFIX)) {
    const m = termMemoryOf(item)
    return m ? revHash({ p: m.item.p, dup: m.item.dup ?? null }) : 'gone'
  }
  const run = item.kind === 'memory' ? menuRunOf(item) : null
  if (run) return revHash({ p: run.proposals?.[0] ?? null, dup: menuRunDuplicate(run.id) ?? null })
  return ''
}

/** The proposals' keys, by the card's source. */
function actionsOf(item: QueueItem): CardAction[] {
  if (item.id.startsWith(AGENT_PREFIX)) return agentActions(item)
  if (item.id.startsWith(TERM_PREFIX)) return terminalActions(item)
  if (item.id.startsWith(MEM_PREFIX) || (item.id.startsWith(AIRUN_PREFIX) && item.kind === 'memory')) return memoryActions(item)
  return openActions(item)
}

/**
 * One batch over several sub-sources: agents one call per run, the terminal one call, the rest one by one. Its Undo
 * answers per card (each sub-source's own), and a card without one is named in `finals` — never covered by another's.
 */
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
  const finals: Record<string, string> = {}
  const undos: Array<() => Promise<Record<string, UndoOutcome>>> = []
  for (const r of ok) {
    const ids = (r.items ?? []).filter((id) => !r.finals?.[id])
    Object.assign(finals, r.finals ?? {})
    const undo = r.undo
    if (!undo) {
      for (const id of ids) finals[id] = r.final ?? 'features.preflight.card.final.none'
      continue
    }
    // one card's answer for the whole call → that answer for each of its cards
    undos.push(async () => {
      const out = await undo()
      return typeof out === 'string' ? Object.fromEntries(ids.map((id) => [id, out])) : out
    })
  }
  return { ok: true, items: ok.flatMap((r) => r.items ?? []), finals, ...(undos.length ? { undo: merged(undos) } : {}) }
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
    rev: proposalRev,
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
