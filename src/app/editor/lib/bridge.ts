/**
 * Per-editor overlay state shared between ProseMirror plugins (suggestions, shortcuts)
 * and the React overlays rendered next to the editor (slash menu, AI, paste menu …).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Range } from '@tiptap/core'
import type { TransformPick } from '../../features'

export type SuggestKind = 'slash' | 'mention' | 'emoji'

export interface SuggestState {
  kind: SuggestKind
  query: string
  range: Range
  rect: () => DOMRect | null
  command: (item: unknown) => void
}

/** Comments UI of one editor (threads themselves live on the page in the store). */
export interface CommentsUI {
  /** Thread in focus: its card and its highlighted text are emphasised together. */
  active: string | null
  /** Where the focus came from ('text' = a click on highlighted text). */
  via: 'text' | 'rail' | null
  /** A new thread being written (its range lives in the comments plugin). */
  draft: { id: string; quote: string } | null
  /** The comments sheet on narrow layouts. */
  panel: boolean
  showResolved: boolean
}

export interface OverlayState {
  suggest: SuggestState | null
  /**
   * the AI panel; `redo`: opened on passages marked to redo (block ids — "Redo with instructions"); `transform`:
   * transform the selection into this form at once; `open`: on a submenu ('todb': "More …" with "Turn into database"
   * highlighted — the grip menu's "Turn into database…"; 'transform': the forms of "Transform into …")
   */
  ai: { mode: 'selection' | 'block'; redo?: string[]; transform?: TransformPick; open?: 'todb' | 'transform' } | null
  /** URL pasted on an empty line → offer Link / Bookmark / Embed */
  urlPaste: { url: string; from: number; to: number } | null
  /** Mod+K / link button: bubble toolbar in link-input mode */
  linkEdit: boolean
  /** Hint shown in the slash menu footer when the "+" button opened it */
  plusOpened: boolean
  /** The "+" button created the line the slash menu lives in (Esc removes it again) */
  plusCreated: boolean
  /** Block menu requested from the keyboard / touch (position of the block) */
  blockMenu: { pos: number } | null
  comments: CommentsUI
  /** Emoji / icon picker at the caret (`pos`), or the change popover of the inline icon at `pos` (`edit`) */
  inlinePicker: InlinePicker | null
}

export interface InlinePicker {
  kind: 'emoji' | 'icon'
  pos: number
  edit?: boolean
}

export interface Bridge extends StoreApi<OverlayState> {
  /** Key handlers registered by the suggestion menus (one per kind) and the URL paste menu. */
  keyHandlers: Partial<Record<SuggestKind | 'urlPaste', (e: KeyboardEvent) => boolean>>
}

export function createBridge(): Bridge {
  const store = createStore<OverlayState>(() => ({
    suggest: null,
    ai: null,
    urlPaste: null,
    linkEdit: false,
    plusOpened: false,
    plusCreated: false,
    blockMenu: null,
    comments: { active: null, via: null, draft: null, panel: false, showResolved: false },
    inlinePicker: null,
  })) as Bridge
  store.keyHandlers = {}
  return store
}
