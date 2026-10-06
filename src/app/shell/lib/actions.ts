/**
 * Page-level actions shared by sidebar, topbar, palette and shortcuts.
 * Everything goes through the workspace store + UI store.
 */
import { useWorkspace, descendantIds } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate, openPage, parseHash } from '../../lib/router'
import { t } from '../../i18n'
import type { ID, Page } from '../../store/types'
import { revealMain, useStageView } from './stage'
import { freeBoardSpec } from '../../database'

const ws = () => useWorkspace.getState()
const ui = () => useUI.getState()

/** Page currently shown in the main column (route #/p/<id>), if any. */
export function currentPageId(): ID | null {
  const r = parseHash(window.location.hash)
  return r.name === 'page' ? r.id : null
}

/** Page the page-level commands act on: the active stacked pane's, else the main column's. */
export function contextPageId(): ID | null {
  return useStageView.getState().activePaneId ?? currentPageId()
}

/** Ask the page view to focus its title once mounted (new pages). */
let pendingTitleFocus: ID | null = null
export function requestTitleFocus(id: ID) {
  pendingTitleFocus = id
}
export function consumeTitleFocus(id: ID): boolean {
  if (pendingTitleFocus !== id) return false
  pendingTitleFocus = null
  return true
}

export function closeMobileSidebar() {
  if (ui().mobileSidebarOpen) ui().setMobileSidebar(false)
}

export function goToPage(id: ID, block?: string) {
  closeMobileSidebar()
  if (ui().peekPageId === id) ui().closePeek()
  // picking the page that is already open unfolds it if panes folded it into a spine
  if (!block && currentPageId() === id) revealMain()
  openPage(id, block)
}

export function goHome() {
  closeMobileSidebar()
  if (parseHash(window.location.hash).name === 'home') revealMain()
  navigate({ name: 'home' })
}

export function createPageAndOpen(parentId: ID | null = null, title = '') {
  const id = ws().createPage({ parentId, title })
  requestTitleFocus(id)
  goToPage(id)
  return id
}

export function createDatabaseAndOpen(parentId: ID | null = null) {
  const id = ws().createDatabase({ parentId, title: '' })
  requestTitleFocus(id)
  goToPage(id)
  return id
}

/** "New free board": a full-page database whose first view is a free board (lanes + cards of any record type). */
export function createFreeBoardAndOpen(parentId: ID | null = null) {
  const id = ws().createDatabase({ parentId, title: '', ...freeBoardSpec() })
  requestTitleFocus(id)
  goToPage(id)
  return id
}

export function pageLink(id: ID): string {
  return `${window.location.origin}${window.location.pathname}#/p/${id}`
}

export async function copyPageLink(id: ID) {
  try {
    await navigator.clipboard.writeText(pageLink(id))
    ui().toast({ message: t('common.copied'), kind: 'success' })
  } catch {
    ui().toast({ message: pageLink(id) })
  }
}

export function duplicateAndOpen(id: ID) {
  const copy = ws().duplicatePage(id)
  if (copy) {
    goToPage(copy)
    ui().toast({ message: t('shell.toast.duplicated'), kind: 'success' })
  }
}

/** Open "moved to trash · Undo" toasts, by page — they go away once the page is deleted for good. */
const undoToasts = new Map<ID, ID>()

/** Dismiss Undo toasts whose page no longer exists (deleted forever, trash emptied). */
export function pruneUndoToasts(pages: Record<ID, unknown>) {
  const live = new Set(ui().toasts.map((x) => x.id))
  for (const [pageId, toastId] of undoToasts) {
    if (!live.has(toastId)) undoToasts.delete(pageId)
    else if (!pages[pageId]) {
      undoToasts.delete(pageId)
      ui().dismissToast(toastId)
    }
  }
}

/** Move to trash with an Undo toast. Leaves the page if it was open. */
export function trashWithUndo(id: ID) {
  const page = ws().pages[id]
  if (!page) return
  const affected = [id, ...descendantIds(ws().pages, id)]
  const cur = currentPageId()
  const wasFavorite = page.favorite
  ws().trashPage(id)
  const s = ui()
  if (s.peekPageId && affected.includes(s.peekPageId)) s.closePeek()
  // close from the right so indices stay valid
  for (let i = s.panes.length - 1; i >= 0; i--) if (affected.includes(s.panes[i])) useUI.getState().closePane(i)
  if (cur && affected.includes(cur)) {
    const parent = page.parentId ? ws().pages[page.parentId] : null
    if (parent && !parent.trashed) openPage(parent.id)
    else navigate({ name: 'home' })
  }
  const toastId = s.toast({
    message: t('shell.toast.trashed', { title: page.title.trim() || t('common.untitled') }),
    action: {
      label: t('common.undo'),
      run: () => {
        undoToasts.delete(id)
        if (!ws().pages[id]) {
          ui().toast({ message: t('shell.toast.goneForGood'), kind: 'error' })
          return
        }
        ws().restorePage(id)
        // trashing clears the star; Undo puts it back
        if (wasFavorite && !ws().pages[id]?.favorite) ws().toggleFavorite(id)
        if (cur && affected.includes(cur)) openPage(cur)
      },
    },
  })
  undoToasts.set(id, toastId)
}

export function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark'
  ws().updateSettings({ theme: isDark ? 'light' : 'dark' })
}

export function toggleSidebar() {
  if (window.matchMedia('(max-width: 767px)').matches) {
    ui().setMobileSidebar(!ui().mobileSidebarOpen)
    return
  }
  ws().updateSettings({ sidebarCollapsed: !ws().settings.sidebarCollapsed })
}

export function toggleFocusMode() {
  ui().setFocusMode(!ui().focusMode)
}

/** Is `ancestor` the page `id` itself or one of its ancestors? Walks up: O(depth), cycle-safe. */
export function isWithin(pages: Record<ID, Page>, id: ID, ancestor: ID): boolean {
  const seen = new Set<ID>()
  let cur: ID | null = id
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true
    seen.add(cur)
    cur = pages[cur]?.parentId ?? null
  }
  return false
}

/**
 * Can the page `id` be placed under `parentId` with a plain move? Not into itself or its own sub-pages,
 * not into a database (a page becomes an entry there: sidebar/entries.ts) — and a database's rows never
 * move this way. Pages inside an entry (a database row) are fine.
 */
export function canNestUnder(id: ID, parentId: ID | null): boolean {
  const pages = ws().pages
  if (pages[id]?.databaseId) return false
  if (parentId === null) return true
  if (parentId === id) return false
  const target = pages[parentId]
  if (!target || target.trashed || target.kind === 'database') return false
  return !isWithin(pages, parentId, id)
}
