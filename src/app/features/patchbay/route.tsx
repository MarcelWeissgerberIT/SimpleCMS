/**
 * #/patchbay — a lazy chunk (the pattern of #/regler, #/outbox, #/mcp): nothing of the page loads at boot. `m` focuses a
 * module, `f` selects a fuse, `setup` opens a profile's setup lamps (lib/router.ts checks their shapes).
 *
 * B17: loaded without a Suspense boundary. React holds back the reveal of a boundary that showed its fallback for up
 * to 300 ms (its fallback throttle) — on a big rack that wait was most of the first paint. Here the route renders
 * nothing until the chunk is there, then the page in an ordinary update; a second visit renders it at once. A chunk that
 * fails to load is thrown to the app's error boundary, as a lazy component's would be.
 */
import { useEffect, useState, type ComponentType } from 'react'

export interface PatchbayRouteProps {
  /** a module key to focus (ref.ts) */
  m?: string
  /** a fuse's path key (64 hex) to select */
  f?: string
  /** an integration profile's id whose setup opens */
  setup?: string
  /** Orders B10: show the work orders' band (opened from Settings › Coding worker) */
  orders?: true
}

type PageComponent = ComponentType<PatchbayRouteProps>

let loaded: PageComponent | null = null
let loading: Promise<PageComponent> | null = null
const load = (): Promise<PageComponent> =>
  (loading ??= import('./ui/Patchbay').then(
    (m) => (loaded = m.default),
    (err: unknown) => {
      loading = null
      throw err
    },
  ))

export function PatchbayRoute(props: PatchbayRouteProps) {
  const [Page, setPage] = useState<PageComponent | null>(() => loaded)
  const [failed, setFailed] = useState<unknown>(null)
  useEffect(() => {
    if (Page) return
    let alive = true
    load().then(
      (c) => alive && setPage(() => c),
      (err: unknown) => alive && setFailed(err ?? new Error('the Patchbay did not load')),
    )
    return () => {
      alive = false
    }
  }, [Page])
  if (failed) throw failed
  return Page ? <Page {...props} /> : null
}
