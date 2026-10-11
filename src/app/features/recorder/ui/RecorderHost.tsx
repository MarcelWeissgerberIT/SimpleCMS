/**
 * The deck's host, mounted once by the shell (ModalHost, like the AI terminal): renders nothing while the deck is
 * closed and loads it lazily. The chunk is fetched early when the person reaches for the status key (pointer over
 * it, focus on it) — opening then reads only data.
 */
import { lazy, Suspense } from 'react'
import { useRecorderOpen } from './state'

const load = () => import('./Deck')
const Deck = lazy(load)

let preloading: Promise<unknown> | null = null
/** Fetch the deck's chunk now (the status key's hover / focus; the test seam). */
export function preloadDeck(): Promise<unknown> {
  preloading ??= load().catch((e) => {
    preloading = null
    throw e
  })
  return preloading
}

export function RecorderHost() {
  const open = useRecorderOpen()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Deck />
    </Suspense>
  )
}
