/**
 * The lazy entry points: the #/coding route and the task panel on a coding task's page (both loaded on
 * first use — a page that is not a coding task costs one store read).
 */
import { lazy, Suspense, useState, type KeyboardEvent } from 'react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import type { ID } from '../../store/types'
import { useT } from '../../i18n'
import { typing } from '../../ui/keys'
import { openOrderCount, runningOrderCount } from './orders/db'
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

/**
 * "Alle Ketten anhalten" (spec §1.9): H for every request whose Status is Läuft — on every device (a Status write, sticky;
 * the worker device's engine reads it). Shown while a chain runs; never for a viewer. `head`: H with focus on that head.
 */
export function HaltAllKey({ className = 'btn btn--sm' }: { className?: string }) {
  const t = useT()
  const running = useWorkspace((s) => runningOrderCount(s))
  const viewer = useCloud((s) => s.readOnly)
  const [busy, setBusy] = useState(false)
  if (!running || viewer) return null
  const press = () => {
    if (busy) return
    setBusy(true)
    void import('./orders/chainKeys')
      .then((m) => m.haltAll())
      .then((n) => useUI.getState().toast({ message: t(n === 1 ? 'features.coding.order.haltAll.one' : n ? 'features.coding.order.haltAll.done' : 'features.coding.order.haltAll.none', { n }), kind: 'info' }))
      .finally(() => setBusy(false))
  }
  return (
    <button type="button" className={className} onClick={press} data-halt-all="" data-testid="order-halt-all">
      <span className="kbd" aria-hidden>
        H
      </span>
      {t('features.coding.order.key.haltAll')}
    </button>
  )
}

/** H with focus on a head holding the "Alle Ketten anhalten" key (never while typing, no modifier, no repeat). */
export function haltAllOnH(e: KeyboardEvent<HTMLElement>): void {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== 'h' || typing(e.target as HTMLElement)) return
  const key = e.currentTarget.querySelector<HTMLButtonElement>('[data-halt-all]')
  if (!key) return
  e.preventDefault()
  key.click()
}

/** On a work-orders database's page: its head — how many are open, the way back to #/coding, "Alle Ketten anhalten". */
export function OrderDbSlot({ dbId }: { dbId: ID }) {
  const t = useT()
  const isOrders = useWorkspace((s) => s.databases[dbId]?.system === 'workorders')
  const open = useWorkspace((s) => (s.databases[dbId]?.system === 'workorders' ? openOrderCount(s) : 0))
  if (!isOrders) return null
  return (
    <div className="ordb" data-testid="order-db-head" onKeyDown={haltAllOnH}>
      <span className="label">{t('features.coding.order.dbHead')}</span>
      <span className="label ordb__count">{t('features.coding.order.open', { n: open })}</span>
      <a className="ordb__back" href="#/coding" data-testid="order-db-back">
        ← {t('features.coding.order.back')}
      </a>
      <HaltAllKey className="btn btn--sm ordb__halt" />
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
