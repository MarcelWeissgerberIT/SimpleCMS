/**
 * Building blocks — the dialogs KitHost shows from anywhere: reviewing an own type's scripts someone else
 * changed (team workspaces: Confirm = this exact code may run on this device) and "Turn into list" (items
 * from selected text → a shared list, previewed first).
 */
import { create } from 'zustand'
import type { ID } from '../../store/types'

interface KitDialogs {
  /** the own type whose scripts are under review */
  review: ID | null
  /** "Turn into list": the items found and a name to start from */
  toList: { items: string[]; name: string } | null
}

export const useKitDialogs = create<KitDialogs>()(() => ({ review: null, toList: null }))

export const openReview = (typeId: ID) => useKitDialogs.setState({ review: typeId })
export const closeReview = () => useKitDialogs.setState({ review: null })

/** Open the "Turn into list" preview for these items (one per line / list item of a selection). */
export const openTurnIntoList = (items: string[], name = '') => useKitDialogs.setState({ toList: { items, name } })
export const closeTurnIntoList = () => useKitDialogs.setState({ toList: null })
