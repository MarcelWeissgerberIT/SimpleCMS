/**
 * The lazy entry points: the #/coding route and the task panel on a coding task's page (both loaded on
 * first use — a page that is not a coding task costs one store read).
 */
import { lazy, Suspense } from 'react'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { useT } from '../../i18n'
import { openOrderCount } from './orders/db'
import './orders/orders.css'

const CodingView = lazy(() => import('./CodingView'))
const TaskPanel = lazy(() => import('./TaskPanel'))
const OrderPlate = lazy(() => import('./orders/OrderPlate'))
const OrderNoteDialog = lazy(() => import('./orders/NoteDialog'))

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

/** On every row page: the work order's plate when the row is a request (a row of a 'workorders' database). */
export function OrderSlot({ pageId }: { pageId: ID }) {
  const isOrder = useWorkspace((s) => {
    const p = s.pages[pageId]
    return !!p?.databaseId && !p.trashed && s.databases[p.databaseId]?.system === 'workorders'
  })
  if (!isOrder) return null
  return (
    <Suspense fallback={null}>
      <OrderPlate rowId={pageId} />
    </Suspense>
  )
}

/** On a work-orders database's page: its head — how many are open, and the way back to #/coding. */
export function OrderDbSlot({ dbId }: { dbId: ID }) {
  const t = useT()
  const isOrders = useWorkspace((s) => s.databases[dbId]?.system === 'workorders')
  const open = useWorkspace((s) => (s.databases[dbId]?.system === 'workorders' ? openOrderCount(s) : 0))
  if (!isOrders) return null
  return (
    <div className="ordb" data-testid="order-db-head">
      <span className="label">{t('features.coding.order.dbHead')}</span>
      <span className="label ordb__count">{t('features.coding.order.open', { n: open })}</span>
      <a className="ordb__back" href="#/coding" data-testid="order-db-back">
        ← {t('features.coding.order.back')}
      </a>
    </div>
  )
}

/** "Prüfen lassen …": the one-line note (ModalHost, modal type 'orderNote'). */
export function OrderNoteModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <OrderNoteDialog pageId={pageId} onClose={onClose} />
    </Suspense>
  )
}
