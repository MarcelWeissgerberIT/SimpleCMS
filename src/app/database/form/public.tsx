/** Lazy entry for the public form page (keeps the form code out of the main bundle). */
import { lazy, Suspense } from 'react'

const NativeForm = lazy(() => import('./NativeForm'))
const LazySharedForm = lazy(() => import('./SharedFormView'))

export function SharedFormView({ payload }: { payload: string }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100%', background: 'var(--bg)' }} />}>
      {payload.startsWith('cloud-')?<NativeForm token={payload.slice(6)}/>:<LazySharedForm payload={payload} />}
    </Suspense>
  )
}
