/**
 * #/regler (Regler § 10.1): the page is a lazy chunk — it loads, and reads this device's ledger, only when it is opened.
 */
import { lazy, Suspense } from 'react'

const Page = lazy(() => import('./ui/ReglerPage'))

export function ReglerRoute() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  )
}
