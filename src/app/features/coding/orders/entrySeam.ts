/**
 * Work orders — the entry points' e2e seam `window.__oneOrderEntries` (DEV / `?e2e` only; trigger.ts installs it,
 * lazily). Its own name: the planner's seam (`__oneOrders`, B5) lives beside it. What a spec needs to watch the entry
 * points whatever the planner does: every call into the planner (`planned()` — press.ts pressLog), the records, a Status
 * written under a given writer (the allow-list's negative cases: an Undo, a template, an automation, the terminal …), a
 * kept press aged.
 */
import type { ID, OrderStatusKey, PropertyValue } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { useWorkspace } from '../../../store/store'
import { loadRowOutside } from './rowWriters'
import { ensureOrderDb, orderDbId, orderStatusKey, writeOrderStatus } from './db'
import { orderPreNow, pressLog } from './press'
import { loadOrderRecord, patchOrderRecord } from './records'
import { sendToOrders } from './send'

export function installOrderEntriesSeam(x: { fireWants: () => Promise<void>; writerKey: (w: Writer) => string }): void {
  ;(window as unknown as { __oneOrderEntries?: unknown }).__oneOrderEntries = {
    planned: () => pressLog.map((c) => ({ ...c })),
    clearPlanned: () => void pressLog.splice(0),
    dbId: () => orderDbId(),
    ensure: () => ensureOrderDb().id,
    status: (rowId: ID) => orderStatusKey(rowId),
    /** the Status written under `writer` (a frame of its own — the subscriber reads it) */
    setStatusAs: (rowId: ID, key: OrderStatusKey, writer: Writer) => writeOrderStatus(rowId, key, writer),
    record: async (rowId: ID) => {
      const r = await loadOrderRecord(rowId, { fresh: true })
      return r === 'unreadable' ? null : r
    },
    /** a kept press made `ms` older (the 24 h expiry) */
    ageWant: (rowId: ID, ms: number) => patchOrderRecord(rowId, (r) => (r?.want ? { ...r, want: { ...r.want, at: r.want.at - ms } } : r)).then(() => true),
    fireWants: () => x.fireWants(),
    send: (pageId: ID, note?: string) => sendToOrders(pageId, { note }),
    pre: (rowId: ID) => orderPreNow(rowId),
    writerKey: x.writerKey,
    /** Fix 2: a request row made / renamed / a field written under `writer` (the bridge, a script, an automation …) */
    createRowAs: (writer: Writer, dbId: ID, input: { title?: string; properties?: Record<ID, PropertyValue> }) => withWriter(writer, () => useWorkspace.getState().createRow(dbId, input)),
    renameAs: (writer: Writer, rowId: ID, title: string) => withWriter(writer, () => useWorkspace.getState().updatePage(rowId, { title })),
    setPropAs: (writer: Writer, rowId: ID, prop: ID, value: PropertyValue) => withWriter(writer, () => useWorkspace.getState().setRowProperty(rowId, prop, value)),
    /** Fix 2: who last wrote the row's title / fields here (rowWriters.ts), as stored */
    rowOutside: (rowId: ID) => loadRowOutside(rowId),
  }
}
