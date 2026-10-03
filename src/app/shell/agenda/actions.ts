/**
 * Agenda writes — all through the workspace store.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { DateValue, ID, PropertyDef } from '../../store/types'
import { t } from '../../i18n'
import { journalEntryFor } from '../../features'
import { dayToDate, dayToIso, isoToDay, type AgendaItem } from './model'
import { fmtDayStamp } from './format'

const ws = () => useWorkspace.getState()

export function openItem(it: Pick<AgendaItem, 'pageId'>) {
  useUI.getState().openPeek(it.pageId, 'side')
}

/** Shift an ISO date or datetime by whole days, keeping the time of day. */
function shiftIso(iso: string, days: number): string {
  const day = isoToDay(iso)
  if (day === null) return iso
  return dayToIso(day + days) + iso.slice(10)
}

/** Move a row's date property by `days` (start and end together: times and range length stay). */
export function moveItem(it: AgendaItem, days: number, opts: { undo?: boolean } = { undo: true }): boolean {
  if (!days || it.kind !== 'row' || !it.propId) return false
  const row = ws().pages[it.pageId]
  const old = row?.properties[it.propId] as DateValue | null | undefined
  if (!row || !old || typeof old !== 'object' || typeof old.start !== 'string') return false
  const next: DateValue = { ...old, start: shiftIso(old.start, days), end: old.end ? shiftIso(old.end, days) : (old.end ?? null) }
  if (old.end === undefined) delete next.end
  const propId = it.propId
  ws().setRowProperty(row.id, propId, next)
  if (opts.undo) {
    const lang = ws().settings.language
    useUI.getState().toast({
      message: t('shell.agenda.moved', { title: row.title.trim() || t('common.untitled'), date: fmtDayStamp(it.start + days, lang) }),
      action: {
        label: t('common.undo'),
        run: () => {
          if (ws().pages[row.id]) ws().setRowProperty(row.id, propId, old)
        },
      },
    })
  }
  return true
}

/** New row in `dbId` dated `day` (at `hour` if given), opened in the peek. */
export function createRowOn(dbId: ID, prop: PropertyDef, day: number, hour?: number): ID | null {
  if (!ws().databases[dbId]) return null
  const value: DateValue =
    hour === undefined ? { start: dayToIso(day) } : { start: `${dayToIso(day)}T${String(hour).padStart(2, '0')}:00`, includeTime: true }
  const id = ws().createRow(dbId, { properties: { [prop.id]: value } })
  openItem({ pageId: id })
  return id
}

/** Find or create the journal entry for `day` and open it in the peek. */
export function openJournalFor(day: number): ID | null {
  const entry = journalEntryFor(dayToDate(day))
  if (!entry) return null
  if (entry.createdDatabase) useUI.getState().toast({ message: t('features.journal.created'), kind: 'success' })
  openItem({ pageId: entry.id })
  return entry.id
}
