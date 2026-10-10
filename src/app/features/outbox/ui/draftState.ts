/** The draft popover's open state (one at a time; OutboxHost renders it). */
import { create } from 'zustand'
import type { ID } from '../../../store/types'
import type { RouteRef } from '../types'

export interface DraftRequest {
  dbId: ID
  route: RouteRef
  /** the rows to draft for (≤ 10; empty: the popover asks for one) */
  rowIds: ID[]
  /** where it opens (the ⌘ key, a route key); absent: the top of the window */
  anchor?: Element | null
}

export const useDraftUI = create<{ open: DraftRequest | null }>(() => ({ open: null }))

export function openDraft(r: DraftRequest): void {
  useDraftUI.setState({ open: { ...r, rowIds: r.rowIds.slice(0, 10) } })
}

export const closeDraft = () => useDraftUI.setState({ open: null })
