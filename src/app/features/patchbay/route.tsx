/**
 * #/patchbay — a lazy chunk (the pattern of #/regler, #/outbox, #/mcp): nothing of the page loads at boot. `m` focuses a
 * module, `f` selects a fuse, `setup` opens a profile's setup lamps (lib/router.ts checks their shapes).
 */
import { lazy, Suspense } from 'react'

export interface PatchbayRouteProps {
  /** a module key to focus (ref.ts) */
  m?: string
  /** a fuse's path key (64 hex) to select */
  f?: string
  /** an integration profile's id whose setup opens */
  setup?: string
}

const Page = lazy(() => import('./ui/Patchbay'))

export function PatchbayRoute(props: PatchbayRouteProps) {
  return (
    <Suspense fallback={null}>
      <Page {...props} />
    </Suspense>
  )
}
