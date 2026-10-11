/**
 * The deck's host, mounted once by the shell (ModalHost, like the AI terminal): renders nothing while the deck is
 * closed and loads it lazily. The chunk is fetched early when the person reaches for the status key (pointer over
 * it, focus on it) — opening then reads only data. No React.lazy / Suspense: a lazy component suspends on its first
 * render even when its chunk is already here, and React holds a revealed Suspense boundary back for up to 300 ms —
 * the deck renders straight away once its module is loaded.
 */
import { useEffect, useState, type ComponentType } from 'react'
import { useRecorderOpen, useRecorderUI } from './state'

let DeckView: ComponentType | null = null
let preloading: Promise<unknown> | null = null
/** Fetch the deck's chunk now (the status key's hover / focus; the test seam). */
export function preloadDeck(): Promise<unknown> {
  preloading ??= import('./Deck').then(
    (m) => (DeckView = m.default),
    (e) => {
      preloading = null
      throw e
    },
  )
  return preloading
}

/* the deck's test seam (DEV or ?e2e): fetch its chunk, read and set its store */
if (typeof window !== 'undefined') {
  let on = false
  try {
    on = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    on = false
  }
  if (on) (window as unknown as { __oneDeck?: unknown }).__oneDeck = { preload: preloadDeck, state: () => useRecorderUI.getState(), set: (patch: Record<string, unknown>) => useRecorderUI.setState(patch) }
}

export function RecorderHost() {
  const open = useRecorderOpen()
  const [, loaded] = useState(0)
  useEffect(() => {
    if (!open || DeckView) return
    let live = true
    preloadDeck().then(
      () => live && loaded((n) => n + 1),
      (e) => console.warn('[recorder] the deck could not be loaded', e),
    )
    return () => {
      live = false
    }
  }, [open])
  if (!open || !DeckView) return null
  return <DeckView />
}
