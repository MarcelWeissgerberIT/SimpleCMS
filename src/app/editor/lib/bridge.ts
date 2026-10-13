/**
 * Per-editor overlay state shared between ProseMirror plugins (suggestions, shortcuts)
 * and the React overlays rendered next to the editor (slash menu, AI, paste menu …).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Range } from '@tiptap/core'
import type { TransformPick } from '../../features'
import type { TypedAt } from './typedAt'

export type SuggestKind = 'slash' | 'mention' | 'emoji' | 'ref'

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
   * highlighted — the grip menu's "Turn into database…"; 'transform': the forms of "Transform into …"); `generate`: the
   * generate card (`/generate image` · `/generate video` · an empty image block's "Generate…", features/ai/media);
   * `typed`: opened by a Space typed on an empty line — that Space's place, followed through every change until the menu
   * shows (lib/typedAt.ts; without AI set up, more typing goes back into the page)
   */
  ai: { mode: 'selection' | 'block'; redo?: string[]; transform?: TransformPick; open?: 'todb' | 'transform'; generate?: 'image' | 'video'; typed?: TypedAt } | null
  /** URL pasted on an empty line → offer Link / Bookmark / Embed */
  urlPaste: { url: string; from: number; to: number } | null
  /** Mod+K / link button: bubble toolbar in link-input mode */
  linkEdit: boolean
  /** Hint shown in the slash menu footer when the "+" button opened it */
  plusOpened: boolean
  /** The "+" button created the line the slash menu lives in (Esc removes it again) */
  plusCreated: boolean
  /** Block menu requested from the keyboard / touch (position of the block) */
  /** the block menu of the block at `pos` (Alt+Enter, a touch grip) — at `anchor` when a key opened it (a task's ⋯) */
  blockMenu: { pos: number; anchor?: Element | null } | null
  comments: CommentsUI
  /** Emoji / icon picker at the caret (`pos`), or the change popover of the inline icon at `pos` (`edit`) */
  inlinePicker: InlinePicker | null
  /** a task's picker / card (editor/workitem/ItemPickers.tsx) */
  itemPicker: ItemPickerState | null
}

/**
 * A task's picker (editor/workitem/ItemPickers.tsx — one host per editable editor). `pos` is the task's position when
 * the person acted (getPos()); the host maps it through every transaction while the picker is open (the task gone →
 * the picker closes, nothing written). Writes go to that very block (`commitItem`: pos → block id → nothing).
 *  - status: the status radiogroup (the key's ⌄) · confirm: "still waiting for … — mark done anyway?" (`status` = asked)
 *  - due · people · blockedBy · related · blocks: the field pickers (drafts: Esc discards, Done commits)
 *  - dependents · relatedList: the BLOCKS / FREED and RELATED lists · ref: the card of one linked task (`ref`)
 */
export type ItemPickerKind = 'status' | 'confirm' | 'due' | 'people' | 'blockedBy' | 'related' | 'blocks' | 'dependents' | 'relatedList' | 'ref'

export interface ItemPickerState {
  pos: number
  itemId: string | null
  blockId: string | null
  kind: ItemPickerKind
  from: 'chip' | 'key' | 'menu' | 'ghost'
  /** confirm: the status the person asked for */
  status?: 'todo' | 'in_progress' | 'done'
  /** ref: the linked task the card is about */
  ref?: string
  /** ref: opened by the pointer resting on a chip (takes no focus, closes when the pointer leaves) */
  hover?: boolean
  /** the editor had the keyboard when the person asked for it (touch: the caret comes back only then) */
  hadFocus?: boolean
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
    itemPicker: null,
  })) as Bridge
  store.keyHandlers = {}
  return store
}
