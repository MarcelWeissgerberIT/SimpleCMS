import { useEffect } from 'react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { openTodayJournal } from '../../features'
import { navigate, type Route } from '../../lib/router'
import { isMac } from '../../ui/controls'
import { t } from '../../i18n'
import { createPageAndOpen, currentPageId, pruneUndoToasts, toggleFocusMode, toggleSidebar, toggleTheme } from './actions'

const isEditable = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e || !e.closest) return false
  return !!e.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

/** Is any overlay (popover, modal, palette) on top that should get Escape first? */
const overlayOpen = () => !!document.querySelector('[data-popover], .modal-scrim, .pal-scrim')

/**
 * The character a shortcut means, layout-aware: `e.key` first (AZERTY's "," is not on the
 * Comma key), falling back to the physical key only for non-Latin layouts (Cyrillic, Greek …).
 */
function keyOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (/^[\x20-\x7e]$/.test(k)) return k
  if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase()
  if (e.code.startsWith('Digit')) return e.code.slice(5)
  return k
}

/**
 * AltGr arrives as Ctrl+Alt on Windows/Linux. Those keystrokes type characters
 * (German "\" "@" "{", Polish "ń" …) and must never trigger a shortcut.
 */
function isAltGraph(e: KeyboardEvent): boolean {
  if (e.getModifierState?.('AltGraph')) return true
  return !isMac && e.ctrlKey && e.altKey && !e.metaKey
}

/** Global keyboard shortcuts. Mount once. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const ui = useUI.getState()

      // Esc on a selected block inside the peek: the editor would only blur — close the peek instead
      if (e.key === 'Escape' && ui.peekPageId && !overlayOpen()) {
        const target = e.target as HTMLElement | null
        const pm = target?.closest?.('.peek .ProseMirror')
        if (pm && pm.querySelector('.ProseMirror-selectednode')) {
          e.preventDefault()
          e.stopPropagation()
          ui.closePeek()
          return
        }
      }

      const key = keyOf(e)
      // New page: ⌘⌥N on macOS, Ctrl+Alt+N elsewhere (Ctrl+N belongs to the browser) — but never AltGr+N (Polish "ń")
      if (key === 'n' && !e.shiftKey) {
        const macCombo = isMac && e.metaKey && !e.ctrlKey
        const pcCombo = !isMac && e.ctrlKey && !e.metaKey && !e.getModifierState?.('AltGraph') && e.key.toLowerCase() === 'n'
        if (macCombo || pcCombo) {
          e.preventDefault()
          createPageAndOpen(null)
          return
        }
      }

      if (isAltGraph(e) || e.altKey) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (!e.shiftKey && (key === 'k' || key === 'p')) {
        e.preventDefault()
        e.stopPropagation()
        if (ui.paletteOpen) ui.closePalette()
        else ui.openPalette()
        return
      }
      if (!e.shiftKey && key === '\\') {
        e.preventDefault()
        toggleSidebar()
        return
      }
      if (e.shiftKey && key === 'l') {
        e.preventDefault()
        toggleTheme()
        return
      }
      if (e.shiftKey && key === 'f') {
        e.preventDefault()
        toggleFocusMode()
        return
      }
      // "/" needs Shift on many layouts (German: Shift+7), so Shift is allowed here
      if (key === '/') {
        e.preventDefault()
        ui.openModal({ type: 'shortcuts' })
        return
      }
      if (!e.shiftKey && key === ',') {
        e.preventDefault()
        ui.openModal({ type: 'settings' })
        return
      }
    }
    // Escape / '?' run in the bubble phase so editors and menus can claim them first
    const onKeyBubble = (e: KeyboardEvent) => {
      const ui = useUI.getState()
      const mod = e.metaKey || e.ctrlKey
      if (e.key === '?' && !mod && !e.altKey && !isEditable(e.target) && !overlayOpen()) {
        e.preventDefault()
        ui.openModal({ type: 'shortcuts' })
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented && !overlayOpen()) {
        if (ui.peekPageId) {
          ui.closePeek()
          return
        }
        if (ui.focusMode) {
          ui.setFocusMode(false)
          return
        }
        if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
      }
    }
    // capture so ⌘K wins over editor bindings
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onKeyBubble)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onKeyBubble)
    }
  }, [])
}

/** Page id of an in-app link (`#/p/<id>` on this document), or null for anything else. */
function internalPageId(a: HTMLAnchorElement): string | null {
  const raw = a.getAttribute('href') ?? ''
  if (!raw.includes('#/p/')) return null
  if (!raw.startsWith('#')) {
    // absolute/relative URL: only ours if it points at this very document
    try {
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return null
    } catch {
      return null
    }
  }
  const m = raw.match(/#\/p\/([\w-]+)/)
  return m ? m[1] : null
}

/**
 * Internal link clicks:
 *  - ⌥/Alt-click on a page link anywhere → open it as a stacked pane
 *  - plain click on a page link inside a pane → open next to that pane (Matuschak stacking)
 *  - plain click on a page link inside the peek → navigate the peek itself (like Notion)
 */
export function useLinkInterceptor() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      const a = target?.closest?.('a[href*="#/p/"]') as HTMLAnchorElement | null
      if (!a || a.closest('[data-no-pane]')) return
      const id = internalPageId(a)
      if (!id) return
      const exists = !!useWorkspace.getState().pages[id]
      const ui = useUI.getState()
      const inPeek = !!a.closest('.peek')
      const paneEl = a.closest('[data-pane-index]') as HTMLElement | null
      const paneIndex = paneEl ? Number(paneEl.dataset.paneIndex) : -1

      if (e.altKey) {
        if (!exists) return
        e.preventDefault()
        e.stopPropagation()
        if (inPeek) ui.closePeek()
        // from a pane: next to it; from anywhere else: append to the stack
        if (paneIndex >= 0) ui.openPane(id, paneIndex)
        else ui.openPane(id)
        return
      }
      if (inPeek) {
        e.preventDefault()
        e.stopPropagation()
        if (exists) ui.openPeek(id, ui.peekMode)
        return
      }
      if (paneIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        if (exists) ui.openPane(id, paneIndex)
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
}

/** document.title, recents and journal route side effects. */
export function useRouteEffects(route: Route) {
  const pageId = route.name === 'page' ? route.id : null
  const title = useWorkspace((s) => (pageId ? s.pages[pageId]?.title : undefined))
  const exists = useWorkspace((s) => (pageId ? !!s.pages[pageId] && !s.pages[pageId].trashed : false))
  const lang = useWorkspace((s) => s.settings.language)

  useEffect(() => {
    let name: string
    if (route.name === 'page') name = exists || title !== undefined ? title?.trim() || t('common.untitled') : t('shell.notFound.title')
    else if (route.name === 'graph') name = t('shell.nav.graph')
    else if (route.name === 'journal') name = t('shell.nav.today')
    else if (route.name === 'notfound') name = t('shell.notFound.title')
    else name = t('shell.nav.home')
    document.title = `${name} — One`
  }, [route, title, exists, lang])

  useEffect(() => {
    if (pageId && exists) useWorkspace.getState().touchRecent(pageId)
  }, [pageId, exists])

  useEffect(() => {
    if (route.name === 'journal') openTodayJournal()
  }, [route])

  // navigating the main column closes the drawer and the peek (the peek belongs to the page you left)
  useEffect(() => {
    const ui = useUI.getState()
    ui.setMobileSidebar(false)
    if (ui.peekPageId) ui.closePeek()
  }, [route])
}

/**
 * The mobile drawer gets out of the way as soon as something else takes over
 * (a modal, the palette, a pane, the peek, a presentation).
 */
export function useDrawerAutoClose() {
  useEffect(
    () =>
      useUI.subscribe((s, prev) => {
        if (!s.mobileSidebarOpen) return
        const took =
          (s.modal && s.modal !== prev.modal) ||
          (s.paletteOpen && !prev.paletteOpen) ||
          s.panes !== prev.panes ||
          (s.peekPageId && s.peekPageId !== prev.peekPageId) ||
          (s.presentPageId && !prev.presentPageId)
        if (took) s.setMobileSidebar(false)
      }),
    [],
  )
}

/**
 * Nothing keeps pointing at a page that was deleted for good (trash popover, banner, emptied
 * trash, another area): the main column goes home, panes and the peek close, and stale
 * "Undo" toasts disappear.
 */
export function usePruneGoneViews() {
  useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        if (s.pages === prev.pages) return
        const ui = useUI.getState()
        if (ui.peekPageId && !s.pages[ui.peekPageId]) ui.closePeek()
        for (let i = ui.panes.length - 1; i >= 0; i--) if (!s.pages[ui.panes[i]]) useUI.getState().closePane(i)
        // only pages that existed a moment ago: a link to an unknown id still shows "not found"
        const cur = currentPageId()
        if (cur && prev.pages[cur] && !s.pages[cur]) navigate({ name: 'home' }, { replace: true })
        pruneUndoToasts(s.pages)
      }),
    [],
  )
}

let bootRedirected = false
/** On first load at "#/": jump to the start page (or the last visited page). */
export function useBootRedirect(route: Route) {
  useEffect(() => {
    if (bootRedirected) return
    bootRedirected = true
    if (route.name !== 'home') return
    const { settings, pages } = useWorkspace.getState()
    const ok = (id: string | null) => !!id && !!pages[id] && !isEffectivelyTrashed(pages, id)
    const target = ok(settings.startPageId) ? settings.startPageId : ok(settings.lastPageId) ? settings.lastPageId : null
    if (target) navigate({ name: 'page', id: target }, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

export { currentPageId }
