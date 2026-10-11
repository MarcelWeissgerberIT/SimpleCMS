/**
 * Proposals queue — agent runs (§6.1): every open change of a run of an agent that counts here (browser runs of this
 * device, own server agents' staged runs). A = applyRun under the agent's run lock (it reads the stored run again and
 * applies only what is still open: decided elsewhere → a tombstone); its Undo (browser runs) = undoChange; D =
 * discardRun with its cascade and Undo; O = the agent's page. Server runs have no Undo (said on the card). A `send`
 * proposal is the Outbox's: A opens its slip (VON HAND), the card ends when the slip leaves the reading.
 * ⇧A / X: one applyRun / discardRun per run (children never before their parents: applyChanges ranks inside one call).
 */
import { navigate } from '../../../../lib/router'
import { t } from '../../../../i18n'
import { AGENT_BODY_KINDS } from '../../../agents'
import type { AgentRun } from '../../../agents/types'
import { depsOf, type StagedChange } from '../../../ai/agent/types'
import type { CustomAgent } from '../../../../store/types'
import { slipProbe, type CardAction, type Done, type QueueItem } from '../../registry'
import { applyAgent, discardAgent, undoAgent } from '../../queue/calls'
import { agentRunsHere, openChangesOf, rowKey, titleOf } from './common'

export const AGENT_PREFIX = 'run:'

const idOf = (run: AgentRun, c: StagedChange) => `${AGENT_PREFIX}${run.id}#${c.id}`

/** The run and change a card stands for, as this device holds them now (null: gone). */
export function agentChangeOf(item: Pick<QueueItem, 'refs'>): { agent: CustomAgent; run: AgentRun; change: StagedChange } | null {
  const { agentId, runId, changeId } = item.refs
  if (!agentId || !runId || !changeId) return null
  for (const { agent, runs } of agentRunsHere()) {
    if (agent.id !== agentId) continue
    const run = runs.find((r) => r.id === runId)
    const change = run?.staged?.find((c) => c.id === changeId)
    return run && change ? { agent, run, change } : null
  }
  return null
}

/** The verb of a change for its compact row ("New row", "Append" …). */
const verbOf = (c: StagedChange) => t(`features.preflight.verb.${c.kind}`)

export function agentItems(): QueueItem[] {
  const out: QueueItem[] = []
  for (const { agent, runs } of agentRunsHere()) {
    for (const run of runs) {
      for (const c of openChangesOf(run)) {
        const row = run.rowIds?.[c.pageId] ?? c.pageId
        const send = c.kind === 'send'
        const shown = AGENT_BODY_KINDS.includes(c.kind)
        const fields = c.props?.length ? c.props.map((p) => p.name).join(', ') : ''
        out.push({
          id: idOf(run, c),
          lamp: 'proposals',
          kind: 'proposal',
          tag: agent.name,
          refs: { agentId: agent.id, runId: run.id, changeId: c.id, pageId: row, ...(c.databaseId ? { dbId: c.databaseId } : {}) },
          at: run.startedAt,
          hand: send ? ['sends'] : shown ? [] : ['editor'],
          bulk: !send && shown,
          ...(send || !shown ? { resolveBy: 'reading' as const } : {}),
          ...(c.supersedes?.length ? { supersedes: c.supersedes.map((s) => ({ at: s.at })) } : {}),
          // a rename: the body shows the old title struck → the new one
          title: c.kind === 'rename' ? '' : (c.kind === 'update_row' || c.kind === 'append' || c.kind === 'edit' ? titleOf(row) : '') || c.title || titleOf(row) || t('common.untitled'),
          keyText: rowKey(row),
          detail: fields ? `${verbOf(c)} · ${fields}` : verbOf(c),
          sub: agent.mirrorOf ? 0 : 1,
          n: c.n,
        })
      }
    }
  }
  return out
}

/** "needs #n": the changes this one builds on that are not applied yet. */
function needsOf(run: AgentRun, c: StagedChange): number[] {
  return depsOf(c)
    .map((id) => run.staged?.find((x) => x.id === id))
    .filter((x): x is StagedChange => !!x && x.status !== 'applied')
    .map((x) => x.n)
}

const undoOf = (run: AgentRun, changeId: string) => async (): Promise<'undone' | 'kept' | 'final'> => {
  const kept = await undoAgent(run, changeId)
  return kept === null ? 'final' : kept > 0 ? 'kept' : 'undone'
}

async function applyOne(run: AgentRun, c: StagedChange): Promise<Done> {
  const res = await applyAgent(run, [c.id])
  if (!res) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
  const failed = res.failed.find((f) => f.id === c.id)
  if (failed) return { ok: false, error: failed.error }
  if (!res.applied.includes(c.id)) return { ok: false, error: 'features.preflight.err.notApplied' }
  return run.runner === 'browser' ? { ok: true, undo: undoOf(run, c.id) } : { ok: true, final: 'features.preflight.card.final.server' }
}

async function discardOne(run: AgentRun, c: StagedChange): Promise<Done> {
  const out = await discardAgent(run, [c.id])
  if (!out.dropped.length) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
  const more = out.dropped.length - 1
  const undo = out.undo
  return {
    ok: true,
    ...(more > 0 ? { note: t('features.preflight.card.dependants', { n: more }) } : {}),
    ...(undo ? { undo: async () => ((await undo()) ? 'undone' : 'final') } : { final: 'features.preflight.card.final.server' }),
  }
}

export function agentActions(item: QueueItem): CardAction[] {
  const ctx = agentChangeOf(item)
  const open: CardAction = {
    key: 'o',
    label: t('features.preflight.card.openAgent'),
    outcome: 'hand',
    run: () => {
      if (item.refs.agentId) navigate({ name: 'agents', id: item.refs.agentId })
      return { ok: true, stay: true }
    },
  }
  if (!ctx) return [open]
  const { run, change: c } = ctx
  const running = run.status === 'running'
  if (c.kind === 'send') {
    const slip = c.send?.slipId
    return [
      {
        key: 'a',
        label: t('features.preflight.card.openSlip'),
        outcome: 'hand',
        hand: ['sends'],
        blocked: !slip || !slipProbe()?.open ? { key: 'features.preflight.why.noOutbox' } : null,
        run: () => {
          slipProbe()?.open?.(slip!)
          return { ok: true, resolve: 'reading' }
        },
      },
      open,
    ]
  }
  if (!AGENT_BODY_KINDS.includes(c.kind)) return [open]
  const needs = needsOf(run, c)
  const blocked = running ? { key: 'features.preflight.why.running' } : needs.length ? { key: 'features.preflight.why.needs', vars: { n: needs.map((n) => `#${n}`).join(', ') } } : null
  return [
    { key: 'a', label: t('features.preflight.card.apply'), outcome: 'applied', writes: true, undoable: run.runner === 'browser', blocked, run: () => applyOne(run, c) },
    { key: 'd', label: t('features.preflight.card.discard'), outcome: 'discarded', undoable: run.runner === 'browser', blocked: running ? { key: 'features.preflight.why.running' } : null, run: () => discardOne(run, c) },
    open,
  ]
}

/** Group cards by their run (⇧A / X: one call per run). */
function byRun(items: QueueItem[]): Array<{ run: AgentRun; ids: string[]; items: QueueItem[] }> {
  const out = new Map<string, { run: AgentRun; ids: string[]; items: QueueItem[] }>()
  for (const it of items) {
    const ctx = agentChangeOf(it)
    if (!ctx) continue
    const g = out.get(ctx.run.id) ?? { run: ctx.run, ids: [], items: [] }
    g.ids.push(ctx.change.id)
    g.items.push(it)
    out.set(ctx.run.id, g)
  }
  return [...out.values()]
}

/** ⇧A over agent cards: ONE applyRun per run, in turn. The Undo takes every run's batch back. */
export async function agentBulkApply(items: QueueItem[]): Promise<Done> {
  const did: string[] = []
  const undos: Array<() => Promise<'undone' | 'kept' | 'final'>> = []
  for (const g of byRun(items)) {
    const res = await applyAgent(g.run, g.ids)
    if (!res) continue
    const applied = g.items.filter((it) => res.applied.includes(it.refs.changeId ?? ''))
    did.push(...applied.map((it) => it.id))
    if (applied.length && g.run.runner === 'browser') undos.push(undoOf(g.run, res.applied[0]))
  }
  if (!did.length) return { ok: false, error: 'features.preflight.err.notApplied' }
  return { ok: true, items: did, ...(undos.length ? { undo: combine(undos) } : { final: 'features.preflight.card.final.server' }) }
}

/** X over agent cards: ONE discardRun per run (with its cascade); the Undo puts them all back. */
export async function agentBulkDiscard(items: QueueItem[]): Promise<Done> {
  const did: string[] = []
  const undos: Array<() => Promise<'undone' | 'kept' | 'final'>> = []
  for (const g of byRun(items)) {
    const out = await discardAgent(g.run, g.ids)
    did.push(...g.items.filter((it) => out.dropped.includes(it.refs.changeId ?? '')).map((it) => it.id))
    const undo = out.undo
    if (undo) undos.push(async () => ((await undo()) ? 'undone' : 'final'))
  }
  if (!did.length) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
  return { ok: true, items: did, ...(undos.length ? { undo: combine(undos) } : {}) }
}

/** Several Undos as one: 'kept' wins over 'undone', 'final' only when none came back. */
export function combine(fns: Array<() => Promise<'undone' | 'kept' | 'final'>>): () => Promise<'undone' | 'kept' | 'final'> {
  return async () => {
    const out: Array<'undone' | 'kept' | 'final'> = []
    for (const fn of fns) out.push(await fn())
    return out.includes('kept') ? 'kept' : out.includes('undone') ? 'undone' : 'final'
  }
}
