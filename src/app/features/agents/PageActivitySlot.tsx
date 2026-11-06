import { lazy, Suspense } from 'react'
const PageActivity = lazy(() => import('./PageActivity'))
export function PageAgentActivity({pageId}:{pageId:string}) {
  return <Suspense fallback={null}><PageActivity pageId={pageId} /></Suspense>
}
