/**
 * The Outbox's mount points (light; the heavy parts load on first use): the dock beside a database page, the routes
 * plate + logbook under its table, #/outbox, and the host of the draft popover.
 */
import { lazy, Suspense } from 'react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { useDockOpen, useWideDock } from '../hooks'
import { useOutbox } from '../store'
import { useDraftUI } from './draftState'
import { useDbOutbox } from './shell'

const Dock = lazy(() => import('./Dock'))
const RoutesPlate = lazy(() => import('./RoutesPlate'))
const RouteView = lazy(() => import('./OutboxRoute'))
const Draft = lazy(() => import('./DraftPopover').then((m) => ({ default: m.DraftHost })))

/** On a database page (the main column): the dock, while the database has routes or slips and it is open here. */
export function OutboxDockSlot({ pageId }: { pageId: ID }) {
  const isDb = useWorkspace((s) => s.pages[pageId]?.kind === 'database' && !!s.databases[pageId])
  if (!isDb) return null
  return <DockGate dbId={pageId} />
}

function DockGate({ dbId }: { dbId: ID }) {
  const has = useDbOutbox(dbId)
  const wide = useWideDock()
  const open = useDockOpen()
  const sheet = useOutbox((s) => s.sheet === dbId)
  if (!has.routes && !has.slips) return null
  if (wide ? !open : !sheet) return null
  return (
    <Suspense fallback={null}>
      <Dock dbId={dbId} />
    </Suspense>
  )
}

/** Under a database's table: SEND ROUTES and the LOGBOOK of the focused slip. */
export function OutboxDbFoot({ dbId }: { dbId: ID }) {
  const has = useDbOutbox(dbId)
  if (!has.routes && !has.slips) return null
  return (
    <Suspense fallback={null}>
      <RoutesPlate dbId={dbId} />
    </Suspense>
  )
}

/** #/outbox and #/outbox/<slip>. */
export function OutboxRoute({ slip }: { slip?: string }) {
  return (
    <Suspense fallback={null}>
      <RouteView slip={slip} />
    </Suspense>
  )
}

/** Mount once (App): the draft popover while one is open. */
export function OutboxHost() {
  const open = useDraftUI((s) => !!s.open)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Draft />
    </Suspense>
  )
}
