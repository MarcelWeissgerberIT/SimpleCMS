import { useEffect } from 'react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { openTodayJournal } from '../../features'
import { navigate, type Route } from '../../lib/router'
import { t } from '../../i18n'
import { createPageAndOpen, currentPageId, toggleFocusMode, toggleSidebar, toggleTheme } from './actions'

const isEditable = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e || !e.closest) return false
  return !!e.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

/** Is any overlay (popover, modal, palette) on top that should get Escape first? */
const overlayOpen = () => !!document.querySelector('[data-popover], .modal-scrim, .pal-scrim')

/** Global keyboard shortcuts. Mount once. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const ui = useUI.getState()
      const code = e.code
      if (mod && !e.altKey && !e.shiftKey && (code === 'KeyK' || code === 'KeyP')) {
        e.preventDefault()
        e.stopPropagation()
        if (ui.paletteOpen) ui.closePalette()
        else ui.openPalette()
        return
      }
      if (mod && (code === 'KeyN') && (e.altKey || !e.shiftKey)) {
        e.preventDefault()
        createPageAndOpen(null)
        return
      }
      if (mod && !e.shiftKey && (code === 'Backslash' || e.key === '\\')) {
        e.preventDefault()
        toggleSidebar()
        return
      }
      if (mod && e.shiftKey && code === 'KeyL') {
        e.preventDefault()
        toggleTheme()
        return
      }
      if (mod && e.shiftKey && code === 'KeyF') {
        e.preventDefault()
        toggleFocusMode()
        return
      }
      if (mod && !e.shiftKey && (code === 'Slash' || e.key === '/')) {
        e.preventDefault()
        ui.openModal({ type: 'shortcuts' })
        return
      }
      if (mod && !e.shiftKey && code === 'Comma') {
        e.preventDefault()
        ui.openModal({ type: 'settings' })
        return
      }
      if (e.key === '?' && !mod && !isEditable(e.target) && !overlayOpen()) {
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
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/**
 * Internal link clicks:
 *  - ⌥/Alt-click on a page link anywhere → open it as a stacked pane
 *  - plain click on a page link inside a pane → open next to that pane (Matuschak stacking)
 */
export function useLinkInterceptor() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      const a = target?.closest?.('a[href*="#/p/"]') as HTMLAnchorElement | null
      if (!a) return
      const m = a.getAttribute('href')?.match(/#\/p\/([\w-]+)/)
      if (!m) return
      const id = m[1]
      const paneEl = a.closest('[data-pane-index]') as HTMLElement | null
      const paneIndex = paneEl ? Number(paneEl.dataset.paneIndex) : -1
      if (e.altKey || paneIndex >= 0) {
        if (a.closest('[data-no-pane]')) return
        e.preventDefault()
        e.stopPropagation()
        if (!useWorkspace.getState().pages[id]) return
        useUI.getState().openPane(id, paneIndex)
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

  // leaving a page closes panes that belonged to the previous context? keep panes; close mobile drawer
  useEffect(() => {
    useUI.getState().setMobileSidebar(false)
    const cur = currentPageId()
    const ui = useUI.getState()
    if (cur && ui.peekPageId === cur) ui.closePeek()
  }, [route])
}

let bootRedirected = false
/** On first load at "#/": jump to the start page (or the last visited page). */
export function useBootRedirect(route: Route) {
  useEffect(() => {
    if (bootRedirected) return
    bootRedirected = true
    if (route.name !== 'home') return
    const { settings, pages } = useWorkspace.getState()
    const ok = (id: string | null) => !!id && !!pages[id] && !pages[id].trashed
    const target = ok(settings.startPageId) ? settings.startPageId : ok(settings.lastPageId) ? settings.lastPageId : null
    if (target) navigate({ name: 'page', id: target }, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
