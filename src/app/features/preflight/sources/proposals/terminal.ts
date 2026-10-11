/**
 * Proposals queue — the AI terminal's staged changes of THIS tab (§6.1): A = applyStaged([id], { quiet }) (Undo: its
 * batch, undoStagedBatch — a task action has none), D = discardStaged with its cascade (Undo: exactly that set,
 * undiscardStaged), O = the terminal. VON HAND as the terminal's own review decides it: a send, a change that starts the
 * worker, text that goes to Claude Code, a task that waits for Confirm. ⇧A = ONE applyStaged(ids, { bulk }) — the
 * session leaves out what must be applied alone, checked at apply time. The body is the terminal's own
 * (TerminalChangeBody): the same parts as in the review list.
 */
import { t } from '../../../../i18n'
import { mayNeedConfirm } from '../../../coding'
import { openAgent, useAgent } from '../../../ai/agent/state'
import { goesToWorker, resolveStaged, startsWorker } from '../../../ai/agent/staged'
import { depsOf, type StagedChange } from '../../../ai/agent/types'
import type { CardAction, Done, HandWhy, QueueItem, UndoOutcome } from '../../registry'
import { applyTerminal, discardTerminal, undiscardTerminal, undoTerminal } from '../../queue/calls'
import { TAB_NONCE, titleOf, waits } from './common'

export const TERM_PREFIX = `term:${TAB_NONCE}:`

/** when each change was first listed in this tab (terminal changes carry no time) */
const firstSeen = new Map<string, number>()

export const terminalChangeOf = (item: Pick<QueueItem, 'refs'>): StagedChange | null => useAgent.getState().changes.find((c) => c.id === item.refs.changeId) ?? null

/**
 * VON HAND, as the terminal's review decides it — its own predicates (ai/agent/staged.ts: a staged task id resolved,
 * as the session resolves it): send · starts the worker · goes to Claude Code · Confirm.
 */
export function terminalHand(c: StagedChange, all: readonly StagedChange[]): HandWhy[] {
  const out: HandWhy[] = []
  if (c.kind === 'send') out.push('sends')
  if (startsWorker(c)) out.push('startsNow')
  const toWorker = goesToWorker(c) || (c.kind === 'create_page' && all.some((x) => x.status !== 'discarded' && x.refs?.some((r) => r.id === c.pageId)))
  if (toWorker) out.push('claudeCode')
  const task = c.kind === 'coding' ? c.coding?.action?.taskId : undefined
  if (task && mayNeedConfirm(resolveStaged(task))) out.push('confirm')
  return out
}

export function terminalItems(now = Date.now()): QueueItem[] {
  const all = useAgent.getState().changes
  const out: QueueItem[] = []
  for (const c of all) {
    if (!waits(c.status)) continue
    if (!firstSeen.has(c.id)) firstSeen.set(c.id, now)
    const hand = terminalHand(c, all)
    out.push({
      id: `${TERM_PREFIX}${c.id}`,
      lamp: 'proposals',
      kind: 'terminal',
      tag: t(`features.preflight.verb.${c.kind}`),
      refs: { changeId: c.id, pageId: c.pageId },
      at: firstSeen.get(c.id) ?? now,
      hand,
      bulk: c.kind !== 'send',
      title: c.title || titleOf(c.pageId) || t('common.untitled'),
      detail: t(`features.preflight.verb.${c.kind}`),
      sub: 2,
      n: c.n,
    })
  }
  return out
}

const undoOf = (res: NonNullable<Awaited<ReturnType<typeof applyTerminal>>['res']>, id: string) => async (): Promise<UndoOutcome> => {
  const out = await undoTerminal(res)
  return out.final.includes(id) ? 'final' : out.kept.includes(id) ? 'kept' : 'undone'
}

async function applyOne(c: StagedChange): Promise<Done> {
  const { res, busy } = await applyTerminal([c.id])
  if (busy) return { ok: false, error: 'features.preflight.err.busy' }
  if (!res) {
    const now = useAgent.getState().changes.find((x) => x.id === c.id)
    if (!now || !waits(now.status)) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
    return { ok: false, error: now.error || 'features.preflight.err.notApplied' }
  }
  const failed = res.failed.find((f) => f.id === c.id)
  if (failed) return { ok: false, error: failed.error }
  if (!res.applied.includes(c.id)) return { ok: false, error: 'features.preflight.err.notApplied' }
  if (res.final.includes(c.id)) return { ok: true, final: 'features.preflight.card.final.coding' }
  return { ok: true, undo: undoOf(res, c.id) }
}

async function discardOne(c: StagedChange): Promise<Done> {
  const dropped = await discardTerminal(c.id)
  if (!dropped.length) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
  return {
    ok: true,
    ...(dropped.length > 1 ? { note: t('features.preflight.card.dependants', { n: dropped.length - 1 }) } : {}),
    undo: async () => ((await undiscardTerminal(dropped)).length ? 'undone' : 'final'),
  }
}

export function terminalActions(item: QueueItem): CardAction[] {
  const open: CardAction = { key: 'o', label: t('features.preflight.card.openTerminal'), outcome: 'hand', run: () => (openAgent(), { ok: true, stay: true }) }
  const c = terminalChangeOf(item)
  if (!c || !waits(c.status)) return [open]
  const all = useAgent.getState().changes
  const needs = depsOf(c)
    .map((id) => all.find((x) => x.id === id))
    .filter((x): x is StagedChange => !!x && x.status !== 'applied')
  const hand = terminalHand(c, all)
  const blocked = useAgent.getState().applying ? { key: 'features.preflight.why.running' } : needs.length ? { key: 'features.preflight.why.needs', vars: { n: needs.map((x) => `#${x.n}`).join(', ') } } : null
  return [
    { key: 'a', label: t('features.preflight.card.apply'), outcome: hand.length ? 'hand' : 'applied', hand, writes: true, undoable: c.kind !== 'coding', blocked, run: () => applyOne(c) },
    { key: 'd', label: t('features.preflight.card.discard'), outcome: 'discarded', undoable: true, run: () => discardOne(c) },
    open,
  ]
}

/**
 * ⇧A over terminal cards: ONE applyStaged(ids, { bulk }) — what must be applied alone is left out at apply time. Its
 * Undo answers per card; a task action (the worker may have started) has none (`finals`).
 */
export async function terminalBulkApply(items: QueueItem[]): Promise<Done> {
  const ids = items.map((i) => i.refs.changeId).filter((x): x is string => !!x)
  const { res, busy } = await applyTerminal(ids, true)
  if (busy) return { ok: false, error: 'features.preflight.err.busy' }
  if (!res || !res.applied.length) return { ok: false, error: 'features.preflight.err.notApplied' }
  const applied = items.filter((i) => res.applied.includes(i.refs.changeId ?? ''))
  const finals: Record<string, string> = {}
  for (const it of applied) if (res.final.includes(it.refs.changeId ?? '')) finals[it.id] = 'features.preflight.card.final.coding'
  const undoable = applied.some((it) => !finals[it.id])
  return {
    ok: true,
    items: applied.map((i) => i.id),
    finals,
    ...(undoable
      ? {
          undo: async () => {
            const out = await undoTerminal(res)
            return Object.fromEntries(applied.map((it) => {
              const c = it.refs.changeId ?? ''
              return [it.id, out.final.includes(c) || res.final.includes(c) ? 'final' : out.kept.includes(c) ? 'kept' : 'undone'] as const
            }))
          },
        }
      : {}),
  }
}
