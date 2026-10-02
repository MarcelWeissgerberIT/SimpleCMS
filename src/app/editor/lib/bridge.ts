/**
 * Per-editor overlay state shared between ProseMirror plugins (suggestions, shortcuts)
 * and the React overlays rendered next to the editor (slash menu, AI, paste menu …).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Range } from '@tiptap/core'

export type SuggestKind = 'slash' | 'mention' | 'emoji'

export interface SuggestState {
  kind: SuggestKind
  query: string
  range: Range
  rect: () => DOMRect | null
  command: (item: unknown) => void
}

export interface OverlayState {
  suggest: SuggestState | null
  ai: { mode: 'selection' | 'block' } | null
  /** URL pasted on an empty line → offer Link / Bookmark / Embed */
  urlPaste: { url: string; from: number; to: number } | null
  /** Mod+K / link button: bubble toolbar in link-input mode */
  linkEdit: boolean
  /** Inline math / block math editor open at pos */
  mathEdit: { pos: number; kind: 'inline' | 'block' } | null
  /** Hint shown in the slash menu footer when the "+" button opened it */
  plusOpened: boolean
}

export interface Bridge extends StoreApi<OverlayState> {
  /** Key handler registered by the currently open suggestion menu. */
  keyHandler: ((e: KeyboardEvent) => boolean) | null
  pageId: string
}

export function createBridge(pageId: string): Bridge {
  const store = createStore<OverlayState>(() => ({
    suggest: null,
    ai: null,
    urlPaste: null,
    linkEdit: false,
    mathEdit: null,
    plusOpened: false,
  })) as Bridge
  store.keyHandler = null
  store.pageId = pageId
  return store
}
