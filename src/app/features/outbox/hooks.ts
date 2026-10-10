/** Reading the Outbox in components (live) and moving to it: hooks, the dock's per-device switch, openOutbox / openSlip. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { outboxCounts } from './counts'
import { getSlip, matches, useOutbox } from './store'
import type { GroupState, OutboxCounts, Slip, SlipId, SlipQuery } from './types'

/** Slips that match (newest first), live. */
export function useSlips(q: SlipQuery = {}): Slip[] {
  const slips = useOutbox((s) => s.slips)
  const key = JSON.stringify(q)
  return useMemo(
    () =>
      Object.values(slips)
        .filter((s) => matches(s, q))
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)),
    [slips, key], // eslint-disable-line react-hooks/exhaustive-deps
  )
}

export function useSlip(id: SlipId | null | undefined): Slip | null {
  return useOutbox((s) => (id ? (s.slips[id] ?? null) : null))
}

/** The one count, for a database or all (re-read at midnight: "sent today"). */
export function useOutboxCounts(dbId?: ID | null): OutboxCounts {
  const slips = useOutbox((s) => s.slips)
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
    const timer = window.setTimeout(() => setDay(new Date().toDateString()), Math.min(next + 500, 2_000_000_000))
    return () => window.clearTimeout(timer)
  }, [day])
  return useMemo(() => outboxCounts(Object.values(slips), dbId), [slips, dbId, day])
}

export function groupState(groupId: string): GroupState {
  const g: GroupState = { items: 0, missing: 0, ready: 0, held: 0, sending: 0, sent: 0, confirmed: 0, unclear: 0, failed: 0, included: 0 }
  for (const s of Object.values(useOutbox.getState().slips)) {
    if (s.group?.id !== groupId || s.state === 'withdrawn') continue
    g.items++
    if (s.group.include) g.included++
    if (s.state === 'missing') g.missing++
    else if (s.state === 'ready') g.ready++
    else if (s.state === 'held') g.held++
    else if (s.state === 'sending') g.sending++
    else if (s.state === 'sent' || s.state === 'unconfirmed') g.sent++
    else if (s.state === 'confirmed') g.confirmed++
    else if (s.state === 'unclear') g.unclear++
    else if (s.state === 'failed') g.failed++
  }
  return g
}

export function useGroupState(groupId: string): GroupState {
  const slips = useOutbox((s) => s.slips)
  return useMemo(() => groupState(groupId), [slips, groupId]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------------------------------------------ the dock's switch (this device) */

const DOCK_KEY = 'one.outbox.dock'
const dockListeners = new Set<() => void>()

function readDock(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== 'closed'
  } catch {
    return true
  }
}

export function setDockOpen(open: boolean): void {
  try {
    localStorage.setItem(DOCK_KEY, open ? 'open' : 'closed')
  } catch {
    /* storage blocked: this tab only */
    memoryDock = open
  }
  for (const fn of dockListeners) fn()
}

let memoryDock: boolean | null = null
const dockNow = () => memoryDock ?? readDock()

/** Is the dock open as a column (wide screens; per device, localStorage `one.outbox.dock`)? */
export function useDockOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      dockListeners.add(fn)
      return () => dockListeners.delete(fn)
    },
    dockNow,
    () => true,
  )
}

/** Wide enough for the dock as a column (≥ 1200 px); below that it is a sheet, opened on demand. */
export function useWideDock(): boolean {
  const query = '(min-width: 1200px)'
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', fn)
      return () => m.removeEventListener('change', fn)
    },
    () => window.matchMedia(query).matches,
    () => true,
  )
}

/** Open the dock for a database (a column on wide screens, else the sheet). */
export function showDock(dbId: ID): void {
  if (window.matchMedia('(min-width: 1200px)').matches) setDockOpen(true)
  else useOutbox.setState({ sheet: dbId })
}

/** #/outbox (`q.dbId`: that database's slips first). */
export function openOutbox(q: SlipQuery = {}): void {
  const ui = useUI.getState()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'outbox' })
  if (q.dbId) useOutbox.setState({ focus: getSlips0(q.dbId) })
}
const getSlips0 = (dbId: ID): SlipId | null =>
  Object.values(useOutbox.getState().slips)
    .filter((s) => s.target.dbId === dbId)
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null

/** A slip in its database's dock, focused. */
export function openSlip(id: SlipId): void {
  const s = getSlip(id)
  if (!s) return
  const ui = useUI.getState()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  if (ui.peekPageId) ui.closePeek()
  useOutbox.setState({ focus: id })
  navigate({ name: 'page', id: s.target.dbId })
  showDock(s.target.dbId)
}
