/** Lazy entry for the public form page (keeps the form code out of the main bundle). */
import { lazy, Suspense } from 'react'

const LazySharedForm = lazy(() => import('./SharedFormView'))

export function SharedFormView({ payload }: { payload: string }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100%', background: 'var(--bg)' }} />}>
      <LazySharedForm payload={payload} />
    </Suspense>
  )
}
