/** #/kit, #/kit/<tab>, #/kit/<tab>/<id>: Building blocks, loaded on first visit. */
import { lazy, Suspense } from 'react'
import type { KitTab } from './open'

const KitView = lazy(() => import('./KitView'))

export function KitRoute({ tab, id }: { tab?: KitTab; id?: string }) {
  return (
    <Suspense fallback={null}>
      <KitView tab={tab} id={id} />
    </Suspense>
  )
}
