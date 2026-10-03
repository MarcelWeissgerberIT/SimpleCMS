/**
 * Non-persistent UI state shared across areas. Cross-area entry points
 * (e.g. the database opening the automations modal, the editor opening the
 * history modal) go through openModal() so areas don't import each other's UI.
 */
import { create } from 'zustand'
import type { ID } from './types'
import { newId } from '../lib/ids'

export type ModalState =
  | { type: 'settings'; tab?: 'general' | 'appearance' | 'ai' | 'data' | 'shortcuts' | 'about' | 'team' }
  | { type: 'templates'; parentId?: ID | null }
  | { type: 'import' }
  | { type: 'export'; pageId?: ID | null }
  | { type: 'history'; pageId: ID }
  | { type: 'automations'; databaseId: ID }
  | { type: 'share'; pageId: ID }
  | { type: 'shortcuts' }
  | { type: 'move'; pageId: ID }
  | { type: 'confirm'; title: string; body?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void }

export interface Toast {
  id: ID
  message: string
  kind?: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
  timeout?: number
}

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
    set((s) => ({ toasts: [...s.toasts, toast].slice(-4) }))
    const timeout = toast.timeout ?? (toast.action ? 6000 : 3200)
    if (timeout > 0) window.setTimeout(() => get().dismissToast(toast.id), timeout)
    return toast.id
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Shorthand usable outside React. */
export const toast = (t: Omit<Toast, 'id'> | string) => useUI.getState().toast(t)
