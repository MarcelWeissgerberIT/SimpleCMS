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
    if (update) out = { id: update, how: 'updated', undo: updateMemory(update, p) }
    else {
      const saved = saveMemory(p)
      out = { id: saved.id, how: 'new', undo: saved.undo }
    }
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

/** The near-identical active memory a proposal would repeat (its id), or null. */
export const duplicateOf = (p: MemoryProposal): ID | null => findDuplicate(p.text)?.id ?? null
