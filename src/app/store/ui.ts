/**
 * Non-persistent UI state shared across areas. Cross-area entry points
 * (e.g. the database opening the automations modal, the editor opening the
 * history modal) go through openModal() so areas don't import each other's UI.
 */
import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import type { ID } from './types'
import { newId } from '../lib/ids'

export type ModalState =
  | { type: 'settings'; tab?: 'general' | 'appearance' | 'ai' | 'data' | 'shortcuts' | 'about' | 'team' }
  /** tab / select: open on built-ins or own templates, with a template root (own / customised) selected */
  | { type: 'templates'; parentId?: ID | null; tab?: 'builtin' | 'mine'; select?: ID }
  /** "Save as template…" for a page (features/templates) */
  | { type: 'saveTemplate'; pageId: ID }
  | { type: 'import' }
  | { type: 'export'; pageId?: ID | null }
  | { type: 'history'; pageId: ID }
  | { type: 'automations'; databaseId: ID }
  /** "Edit commands…" of a database (features/commands) */
  | { type: 'dbCommands'; databaseId: ID }
  /** custom functions built by clicking (features/sheets/functions), optionally on one function */
  | { type: 'functions'; id?: ID }
  | { type: 'share'; pageId: ID }
  | { type: 'shortcuts' }
  | { type: 'move'; pageId: ID }
  | { type: 'confirm'; title: string; body?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void }
  /** "Save as example in memory" (features/ai/memory): a page — or `blocks` of it (a selection) — with an optional tag */
  | { type: 'memoryExample'; pageId: ID; tag?: string; blocks?: JSONContent[] | null }

export interface Toast {
  id: ID
  message: string
  kind?: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
  /** further keys after `action` (e.g. "Describe" · "Read out text") */
  more?: Array<{ label: string; run: () => void }>
  timeout?: number
  /**
   * Raised by work going on in the background (an agent run), not by what the person just did: it never sits over a
   * dialog. Raised (or still shown) while one is open, it waits and shows once the last one has closed — unless it was
   * dismissed meanwhile or is older than two minutes by then.
   */
  background?: boolean
}

/** A background toast held while a dialog is open, with the time it was raised. */
export interface WaitingToast extends Toast {
  raisedAt: number
}

/** A held background toast older than this is dropped instead of shown. */
const WAIT_MAX_MS = 2 * 60_000

export interface UIState {
  /** ⌘K palette */
  paletteOpen: boolean
  paletteQuery: string
  /** Database row (or any page) opened in the side peek */
  peekPageId: ID | null
  peekMode: 'side' | 'center'
  /** Extra stacked panes to the right of the main page (Alt/⌥-click a link) */
  panes: ID[]
  /** Focus / zen mode: hide chrome, center content */
  focusMode: boolean
  /** Presentation mode for a page */
  presentPageId: ID | null
  /** Mobile sidebar drawer */
  mobileSidebarOpen: boolean
  modal: ModalState | null
  toasts: Toast[]
  /** background toasts held while a dialog is open (shown when the last one closes) */
  waitingToasts: WaitingToast[]

  openPalette: (query?: string) => void
  closePalette: () => void
  openPeek: (id: ID, mode?: 'side' | 'center') => void
  closePeek: () => void
  openPane: (id: ID, afterIndex?: number) => void
  closePane: (index: number) => void
  setFocusMode: (on: boolean) => void
  present: (id: ID | null) => void
  setMobileSidebar: (open: boolean) => void
  openModal: (m: ModalState) => void
  closeModal: () => void
  toast: (t: Omit<Toast, 'id'> | string) => ID
  dismissToast: (id: ID) => void
}

export const useUI = create<UIState>()((set, get) => ({
  paletteOpen: false,
  paletteQuery: '',
  peekPageId: null,
  peekMode: 'side',
  panes: [],
  focusMode: false,
  presentPageId: null,
  mobileSidebarOpen: false,
  modal: null,
  toasts: [],
  waitingToasts: [],

  openPalette: (query = '') => set({ paletteOpen: true, paletteQuery: query }),
  closePalette: () => set({ paletteOpen: false, paletteQuery: '' }),
  openPeek: (id, mode = 'side') => set({ peekPageId: id, peekMode: mode }),
  closePeek: () => set({ peekPageId: null }),
  openPane: (id, afterIndex) =>
    set((s) => {
      const panes = afterIndex === undefined ? [...s.panes] : s.panes.slice(0, afterIndex + 1)
      if (panes[panes.length - 1] === id) return { panes }
      return { panes: [...panes, id].slice(-3) }
    }),
  closePane: (index) => set((s) => ({ panes: s.panes.filter((_, i) => i !== index) })),
  setFocusMode: (on) => set({ focusMode: on }),
  present: (id) => set({ presentPageId: id }),
  setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
  toast: (t) => {
    const toast: Toast = typeof t === 'string' ? { id: newId(), message: t } : { ...t, id: newId() }
    if (toast.background) raisedAt.set(toast.id, Date.now())
    // background work never puts a toast over an open dialog: it waits for the last one to close
    if (toast.background && held) set((s) => ({ waitingToasts: [...s.waitingToasts, { ...toast, raisedAt: Date.now() }].slice(-MAX_TOASTS) }))
    else showToast(toast)
    return toast.id
  },
  dismissToast: (id) => {
    stopTimer(id)
    raisedAt.delete(id)
    const s = get()
    if (!s.toasts.some((t) => t.id === id) && !s.waitingToasts.some((t) => t.id === id)) return
    set({ toasts: s.toasts.filter((t) => t.id !== id), waitingToasts: s.waitingToasts.filter((t) => t.id !== id) })
  },
}))

/** Toasts shown at once (the oldest goes). */
const MAX_TOASTS = 4
/** Each shown toast's dismiss timer. */
const timers = new Map<ID, number>()
/** When each background toast was raised (it may wait, and wait again). */
const raisedAt = new Map<ID, number>()
/** A dialog is open: background toasts wait. */
let held = false

function stopTimer(id: ID) {
  const h = timers.get(id)
  if (h === undefined) return
  window.clearTimeout(h)
  timers.delete(id)
}

function showToast(toast: Toast) {
  useUI.setState((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }))
  const timeout = toast.timeout ?? (toast.action ? 6000 : 3200)
  if (timeout > 0)
    timers.set(
      toast.id,
      window.setTimeout(() => {
        timers.delete(toast.id)
        useUI.getState().dismissToast(toast.id)
      }, timeout),
    )
}

/**
 * ui/Modal.tsx: a dialog is open (true) — background toasts wait, and those on screen step back until it closes — or
 * the last one has closed (false): the waiting ones show, each with its full time; any raised over two minutes ago is
 * dropped.
 */
export function holdBackgroundToasts(on: boolean): void {
  if (on === held) return
  held = on
  const s = useUI.getState()
  if (on) {
    const shown = s.toasts.filter((t) => t.background)
    if (!shown.length) return
    shown.forEach((t) => stopTimer(t.id))
    useUI.setState({
      toasts: s.toasts.filter((t) => !t.background),
      waitingToasts: [...s.waitingToasts, ...shown.map((t) => ({ ...t, raisedAt: raisedAt.get(t.id) ?? Date.now() }))].slice(-MAX_TOASTS),
    })
    return
  }
  if (!s.waitingToasts.length) return
  const now = Date.now()
  const due = s.waitingToasts.filter((w) => now - w.raisedAt <= WAIT_MAX_MS)
  useUI.setState({ waitingToasts: [] })
  for (const w of s.waitingToasts) if (!due.includes(w)) raisedAt.delete(w.id)
  for (const { raisedAt: _at, ...toast } of due) showToast(toast)
}

/** Shorthand usable outside React. */
export const toast = (t: Omit<Toast, 'id'> | string) => useUI.getState().toast(t)
