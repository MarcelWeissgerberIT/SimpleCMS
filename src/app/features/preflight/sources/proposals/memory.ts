/**
 * Proposals queue — memory (§6.1): the terminal's memory proposals of THIS tab (A = saveProposal, "2" = as a new memory
 * when it would update a near-identical one, D = dismiss, Undo = undoProposal) and the AI menu's memory runs of this
 * device (A = saveRunMemory — its Undo takes the memory back and the run too; D = the run removed, Undo puts it back).
 * A proposal that would UPDATE an existing memory is never part of ⇧A (VON HAND "never in a bulk apply").
 */
import { t } from '../../../../i18n'
import { useAgent, type MemCard, type MemItem } from '../../../ai/agent/state'
import { currentScope, useAIRuns, type AIRun } from '../../../ai/runs'
import type { ID } from '../../../../store/types'
import type { CardAction, Done, QueueItem } from '../../registry'
import { bringBackMenuRun, dismissTerminalMemory, dropMenuRun, menuMemoryDuplicate, saveMenuMemory, saveTerminalMemory, undoTerminalMemory } from '../../queue/calls'
import { TAB_NONCE } from './common'

export const MEM_PREFIX = `mem:${TAB_NONCE}:`
export const AIRUN_PREFIX = 'airun:'

const firstSeen = new Map<string, number>()

/** The near-identical memory an AI-menu memory run would update (read when its card is prepared). */
const runDup = new Map<string, ID | null>()

export function termMemoryOf(item: Pick<QueueItem, 'id'>): { card: MemCard; item: MemItem } | null {
  if (!item.id.startsWith(MEM_PREFIX)) return null
  const [cardId, itemId] = item.id.slice(MEM_PREFIX.length).split(':')
  const card = useAgent.getState().memCards.find((c) => c.id === cardId)
  const it = card?.items.find((x) => x.id === itemId)
  return card && it ? { card, item: it } : null
}

export const menuRunOf = (item: Pick<QueueItem, 'id'>): AIRun | null => (item.id.startsWith(AIRUN_PREFIX) ? (useAIRuns.getState().runs[item.id.slice(AIRUN_PREFIX.length)] ?? null) : null)

export const menuRunDuplicate = (runId: string): ID | null | undefined => runDup.get(runId)

/** An AI-menu run that waits as a memory proposal (else it is an open-only AI-menu result). */
export const isMemoryRun = (r: AIRun) => r.req.kind === 'memory' && !!r.proposals?.length && !r.memSaved

export function memoryItems(now = Date.now()): QueueItem[] {
  const out: QueueItem[] = []
  for (const card of useAgent.getState().memCards) {
    if (card.state !== 'ready') continue
    for (const it of card.items) {
      if (it.status !== 'pending') continue
      const id = `${MEM_PREFIX}${card.id}:${it.id}`
      if (!firstSeen.has(id)) firstSeen.set(id, now)
      out.push({
        id,
        lamp: 'proposals',
        kind: 'memory',
        tag: t('features.preflight.src.memory'),
        refs: {},
        at: firstSeen.get(id) ?? now,
        hand: it.dup ? ['noBulk'] : [],
        bulk: !it.dup,
        title: it.p.text,
        detail: t('features.preflight.verb.remember'),
        sub: 3,
      })
    }
  }
  const scope = currentScope()
  for (const r of Object.values(useAIRuns.getState().runs)) {
    if (r.scope !== scope || r.status !== 'done' || !isMemoryRun(r)) continue
    const dup = runDup.get(r.id)
    out.push({
      id: `${AIRUN_PREFIX}${r.id}`,
      lamp: 'proposals',
      kind: 'memory',
      tag: t('features.preflight.src.aimenu'),
      refs: { pageId: r.pageId, runId: r.id },
      at: r.finishedAt ?? r.startedAt,
      hand: dup ? ['noBulk'] : [],
      bulk: !dup,
      title: r.proposals?.[0]?.text ?? '',
      detail: t('features.preflight.verb.remember'),
      sub: 4,
    })
  }
  return out
}

/** Read the near-identical memory of an AI-menu memory run (its card's "updates …" and VON HAND). */
export async function prepareMemory(item: QueueItem): Promise<void> {
  const run = menuRunOf(item)
  if (run) runDup.set(run.id, await menuMemoryDuplicate(run))
}

function termActions(item: QueueItem): CardAction[] {
  const m = termMemoryOf(item)
  if (!m || m.item.status !== 'pending') return []
  const { card, item: it } = m
  const save = (asNew: boolean) => async (): Promise<Done> => {
    if (!(await saveTerminalMemory(card.id, it.id, asNew))) return { ok: false, error: 'features.preflight.err.notApplied' }
    return { ok: true, undo: async () => (await undoTerminalMemory(card.id, it.id), 'undone') }
  }
  const out: CardAction[] = [{ key: 'a', label: t(it.dup ? 'features.preflight.card.memUpdate' : 'features.preflight.card.memSave'), outcome: 'applied', writes: true, undoable: true, hand: it.dup ? ['noBulk'] : [], run: save(false) }]
  if (it.dup) out.push({ key: '2', label: t('features.preflight.card.memNew'), outcome: 'applied', writes: true, undoable: true, run: save(true) })
  out.push({
    key: 'd',
    label: t('features.preflight.card.discard'),
    outcome: 'discarded',
    undoable: true,
    run: async () => {
      await dismissTerminalMemory(card.id, it.id)
      return { ok: true, undo: async () => (await undoTerminalMemory(card.id, it.id), 'undone') }
    },
  })
  return out
}

function runActions(item: QueueItem): CardAction[] {
  const run = menuRunOf(item)
  if (!run) return []
  const dup = runDup.get(run.id)
  const save = (asNew: boolean) => async (): Promise<Done> => {
    const saved = await saveMenuMemory(run.id, asNew)
    if (!saved) return { ok: false, error: 'features.preflight.err.notApplied' }
    return { ok: true, undo: async () => (saved.undo(), 'undone') }
  }
  const out: CardAction[] = [
    {
      key: 'a',
      label: t(dup ? 'features.preflight.card.memUpdate' : 'features.preflight.card.memSave'),
      outcome: 'applied',
      writes: true,
      undoable: true,
      hand: dup ? ['noBulk'] : [],
      blocked: dup === undefined ? { key: 'features.preflight.why.loading' } : null,
      run: save(false),
    },
  ]
  if (dup) out.push({ key: '2', label: t('features.preflight.card.memNew'), outcome: 'applied', writes: true, undoable: true, run: save(true) })
  out.push({
    key: 'd',
    label: t('features.preflight.card.discard'),
    outcome: 'discarded',
    undoable: true,
    run: async () => {
      await dropMenuRun(run.id)
      return { ok: true, undo: async () => ((await bringBackMenuRun(run)) ? 'undone' : 'final') }
    },
  })
  return out
}

export const memoryActions = (item: QueueItem): CardAction[] => (item.id.startsWith(MEM_PREFIX) ? termActions(item) : runActions(item))
