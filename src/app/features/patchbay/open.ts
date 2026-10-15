/**
 * The one way to open the Patchbay (⌘K, Workspace › Automation's links, Preflight's lamp, hint lines, the return chip):
 * a dialog, the palette and the phone drawer close first, then #/patchbay with what it should show. Tiny and eager.
 *
 * A link the open page already shows (the same hash — navigating would change nothing) is asked again instead: the page
 * hears it (onPatchbayAsk) and shows its module / fuse once more, so a second press of the status cell, the lamp or ⌘K
 * always acts. `next` (⌘K "Patchbay: next fuse") picks the open fuse after the one the page shows (counts.ts keys, in
 * F-order, wrapping; none shown: the first).
 */
import { navigate, routeHref, type Route } from '../../lib/router'
import { useUI } from '../../store/ui'
import { patchbayCounts } from './counts'

export interface OpenPatchbayOptions {
  /** focus this module (ref.ts moduleKey) */
  m?: string
  /** select this fuse (its path key) */
  f?: string
  /** select the open fuse after the one the page shows now (F-order, wrapping) — instead of `f` */
  next?: boolean
  /** open this integration profile's setup */
  setup?: string
}

/** The fuse the open page shows (its fuse list's selected row; null: the page is closed). */
let shown: string | null = null

/** The page notes the fuse it shows (null when it closes). */
export function noteShownFuse(key: string | null): void {
  shown = key
}

const asks = new Set<() => void>()

/** The open page hears a link it already shows being opened again. */
export function onPatchbayAsk(fn: () => void): () => void {
  asks.add(fn)
  return () => {
    asks.delete(fn)
  }
}

/** The open fuse after the one shown (F-order, wrapping); none shown or not open: the first. */
function nextFuse(): string | undefined {
  const keys = patchbayCounts().keys ?? []
  if (!keys.length) return patchbayCounts().first
  const i = shown ? keys.indexOf(shown) : -1
  return keys[(i + 1) % keys.length]
}

export function openPatchbay(opts: OpenPatchbayOptions = {}): void {
  const ui = useUI.getState()
  if (ui.modal) ui.closeModal()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  const f = opts.next ? nextFuse() : opts.f
  const route: Route = { name: 'patchbay', ...(opts.m ? { m: opts.m } : {}), ...(f ? { f } : {}), ...(opts.setup ? { setup: opts.setup } : {}) }
  if (window.location.hash === routeHref(route) && asks.size) {
    for (const fn of [...asks]) fn()
    return
  }
  navigate(route)
}
