/**
 * One memory — opening things and confirming a proposal from any surface (toast with Open + Undo).
 */
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { openPage } from '../../../lib/router'
import { t } from '../../../i18n'
import { logDbId, memoryDbId } from './schema'
import { findDuplicate, saveMemory, updateMemory } from './save'
import type { MemoryProposal } from './types'
import { removeRun, restoreRun, useAIRuns } from '../runs'
import { withWriter } from '../../../store/writer'

/** A memory entry or a log row: in the side peek. */
export const openEntry = (id: ID) => useUI.getState().openPeek(id)

export function openMemoryDb() {
  const id = memoryDbId()
  if (id) openPage(id)
}

export function openMemoryLog() {
  const id = logDbId()
  if (id) openPage(id)
}

export interface Confirmed {
  id: ID
  how: 'new' | 'updated'
  undo: () => void
}

/**
 * Save a confirmed proposal: as a new memory, or over `update` (a near-identical one). Shows a toast
 * with Open and Undo. Returns null when it could not be written (a toast says so).
 */
export function confirmProposal(p: MemoryProposal, update: ID | null, opts: { toast?: boolean } = {}): Confirmed | null {
  let out: Confirmed
  try {
    // the person confirmed it (store/writer.ts)
    out = withWriter({ kind: 'you', via: 'memory' }, (): Confirmed => {
      if (update) return { id: update, how: 'updated', undo: updateMemory(update, p) }
      const saved = saveMemory(p)
      return { id: saved.id, how: 'new', undo: saved.undo }
    })
  } catch (e) {
    console.warn('[one] memory: not saved', e)
    useUI.getState().toast({ message: t('features.memory.toast.failed'), kind: 'error' })
    return null
  }
  if (opts.toast !== false)
    useUI.getState().toast({
      message: t(out.how === 'updated' ? 'features.memory.toast.updated' : 'features.memory.toast.saved'),
      kind: 'success',
      timeout: 8000,
      action: { label: t('features.memory.card.open'), run: () => openEntry(out.id) },
    })
  return out
}

/**
 * Save the proposal of an AI-menu memory run ("Remember this" / "remember …") and take the run away — what the panel's
 * Save does, and Preflight's A on such a card. `asNew`: a new memory even when a near-identical one exists (else it
 * updates that one); `proposal`: the proposal as edited in the panel (default: the run's own); `toast`: the saved toast
 * (Preflight passes false — its queue says so). Returns what was saved and an Undo that takes the memory back and puts
 * the run back (null: nothing saved — no such run, no proposal, or it could not be written).
 */
export function saveRunMemory(runId: string, opts: { asNew?: boolean; proposal?: MemoryProposal; toast?: boolean } = {}): (Confirmed & { undo: () => void }) | null {
  const run = useAIRuns.getState().runs[runId]
  const p = opts.proposal ?? run?.proposals?.[0]
  if (!run || run.req.kind !== 'memory' || !p) return null
  const saved = confirmProposal(p, opts.asNew ? null : duplicateOf(p), { toast: opts.toast })
  if (!saved) return null
  removeRun(runId)
  return {
    ...saved,
    undo: () => {
      saved.undo()
      restoreRun(run)
    },
  }
}

/** The near-identical active memory a proposal would repeat (its id), or null. */
export const duplicateOf = (p: MemoryProposal): ID | null => findDuplicate(p.text)?.id ?? null

// e2e seam (dev, or ?e2e): saving an AI-menu memory run as the panel and Preflight do, and its Undo
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneMemory?: unknown }).__oneMemory = { saveRunMemory, restoreRun, removeRun }
}
