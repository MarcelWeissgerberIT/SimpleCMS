/** #/scripts and #/scripts/<id>: the scripts area, loaded on first visit. */
import { lazy, Suspense } from 'react'

const ScriptsView = lazy(() => import('./ScriptsView'))

export function ScriptsRoute({ scriptId }: { scriptId?: string }) {
  return (
    <Suspense fallback={null}>
      <ScriptsView scriptId={scriptId} />
    </Suspense>
  )
}
