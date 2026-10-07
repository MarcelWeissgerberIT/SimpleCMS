/**
 * The lazy entry points: the #/coding route and the task panel on a coding task's page (both loaded on
 * first use — a page that is not a coding task costs one store read).
 */
import { lazy, Suspense } from 'react'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'

const CodingView = lazy(() => import('./CodingView'))
const TaskPanel = lazy(() => import('./TaskPanel'))

/** #/coding · #/coding/spec · #/coding/qa */
export function CodingRoute({ kind }: { kind?: 'spec' | 'qa' }) {
  return (
    <Suspense fallback={null}>
      <CodingView kind={kind ?? 'coding'} />
    </Suspense>
  )
}

const PIPELINE_SYSTEMS = new Set(['coding', 'spec', 'qa'])

/** On every row page: the task panel when the row is a task of a pipeline database (Coding · Business analysis · QA). */
export function CodingTaskSlot({ pageId }: { pageId: ID }) {
  const isTask = useWorkspace((s) => {
    const p = s.pages[pageId]
    return !!p?.databaseId && !p.trashed && PIPELINE_SYSTEMS.has(s.databases[p.databaseId]?.system ?? '')
  })
  if (!isTask) return null
  return (
    <Suspense fallback={null}>
      <TaskPanel pageId={pageId} />
    </Suspense>
  )
}
