/**
 * What happened to each media card in this tab (by item id): saving, saved (and where), failed (why) — and
 * which generated variants are picked. In memory only: a reload shows the cards as they came.
 */
import { create } from 'zustand'
import type { MediaIssue } from './types'

export interface CardState {
  state: 'idle' | 'saving' | 'saved' | 'failed'
  issue?: MediaIssue
  /** the saved file ("onefile:<id>") */
  src?: string
  /** how it was saved */
  via?: 'browser' | 'upload' | 'team'
}

interface MediaCardsState {
  cards: Record<string, CardState>
  picked: Record<string, boolean>
}

export const useMediaCards = create<MediaCardsState>()(() => ({ cards: {}, picked: {} }))

export function setCard(id: string, next: CardState): void {
  useMediaCards.setState((s) => ({ cards: { ...s.cards, [id]: next } }))
}

export function setPicked(id: string, on: boolean): void {
  useMediaCards.setState((s) => ({ picked: { ...s.picked, [id]: on } }))
}

export const cardOf = (id: string): CardState => useMediaCards.getState().cards[id] ?? { state: 'idle' }
