/**
 * Agenda writes — all through the workspace store.
 */
import type { JSONContent } from '@tiptap/core'
import { format } from 'date-fns'
import { de as deLocale, enGB } from 'date-fns/locale'
import { defaultView, useWorkspace } from '../../store/store'
import { selectRows } from '../../store/selectors'
import { useUI } from '../../store/ui'
import type { DateValue, ID, PropertyDef, View } from '../../store/types'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { dayToDate, dayToIso, findJournalDb, isoToDay, type AgendaItem } from './model'
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

/* ------------------------------------------------------------------ */
/* Journal entry for any day                                           */
/* (mirrors features/journal, which only exposes today's entry)        */
/* ------------------------------------------------------------------ */

function journalTitle(date: Date, lang: string): string {
  return lang === 'de' ? format(date, 'EEEE, d. MMMM yyyy', { locale: deLocale }) : format(date, 'EEEE, d MMMM yyyy', { locale: enGB })
}

function journalTemplate(): JSONContent {
  const h = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] })
  return {
    type: 'doc',
    content: [
      h(t('features.journal.focus')),
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] },
      h(t('features.journal.notes')),
      { type: 'paragraph' },
      h(t('features.journal.gratitude')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
    ],
  }
}

function createJournalDb(): ID {
  const de = ws().settings.language === 'de'
  const dateId = newId()
  const properties: PropertyDef[] = [
    { id: newId(), name: 'Name', type: 'title' },
    { id: dateId, name: de ? 'Datum' : 'Date', type: 'date' },
    {
      id: newId(),
      name: de ? 'Stimmung' : 'Mood',
      type: 'select',
      options: [
        { id: newId(), name: de ? 'Großartig' : 'Great', color: 'green' },
        { id: newId(), name: de ? 'Gut' : 'Good', color: 'blue' },
        { id: newId(), name: 'Okay', color: 'yellow' },
        { id: newId(), name: de ? 'Mau' : 'Low', color: 'orange' },
        { id: newId(), name: de ? 'Schwer' : 'Rough', color: 'red' },
      ],
    },
    { id: newId(), name: 'Tags', type: 'multi_select', options: [] },
  ]
  const calendar: View = { ...defaultView('calendar', { properties }, de ? 'Kalender' : 'Calendar'), dateProperty: dateId, openIn: 'full' }
  const table: View = { ...defaultView('table', { properties }, de ? 'Alle Einträge' : 'All entries'), sorts: [{ propertyId: dateId, direction: 'desc' }], openIn: 'full' }
  return ws().createDatabase({
    id: `jrnl${newId().slice(4)}`,
    parentId: null,
    title: 'Journal',
    icon: { type: 'emoji', value: '📓' },
    properties,
    views: [calendar, table],
  })
}

/** Find or create the journal entry for `day` and open it in the peek. */
export function openJournalFor(day: number): ID | null {
  const s = ws()
  let dbId = findJournalDb(s.pages, s.databases)
  if (!dbId) dbId = createJournalDb()
  const db = ws().databases[dbId]
  if (!db) return null
  const dateProp = db.properties.find((p) => p.type === 'date' && /^(date|datum)$/i.test(p.name.trim())) ?? db.properties.find((p) => p.type === 'date')
  const iso = dayToIso(day)
  const date = dayToDate(day)
  const lang = ws().settings.language
  const rows = selectRows(ws().pages, dbId)
  let entry = dateProp ? rows.find((r) => ((r.properties[dateProp.id] as DateValue | null)?.start ?? '').slice(0, 10) === iso) : undefined
  entry ??= rows.find((r) => r.title.trim() === journalTitle(date, lang))
  const id =
    entry?.id ??
    ws().createRow(dbId, {
      title: journalTitle(date, lang),
      properties: dateProp ? { [dateProp.id]: { start: iso } satisfies DateValue } : {},
      content: journalTemplate(),
    })
  openItem({ pageId: id })
  return id
}
