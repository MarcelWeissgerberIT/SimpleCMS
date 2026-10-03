/**
 * Daily journal: one "Journal" database at the workspace root (calendar view first),
 * one row per day, created on demand with a small template.
 * The database is recognised by its id prefix — no settings needed, survives renames.
 */
import type { JSONContent } from '@tiptap/core'
import { format } from 'date-fns'
import { de as deLocale, enGB } from 'date-fns/locale'
import { defaultView, useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, selectRows } from '../../store/selectors'
import type { DateValue, ID, PropertyDef, View } from '../../store/types'
import { newId } from '../../lib/ids'
import { navigate, parseHash } from '../../lib/router'
import { toast } from '../../store/ui'
import { t } from '../../i18n'

export const JOURNAL_ID_PREFIX = 'jrnl'

/** The journal database id, or null if there is none (yet). */
export function findJournalDatabase(): ID | null {
  const st = useWorkspace.getState()
  const alive = Object.values(st.pages).filter((p) => p.kind === 'database' && st.databases[p.id] && !isEffectivelyTrashed(st.pages, p.id) && !inTemplate(st.pages, p.id))
  const marked = alive.filter((p) => p.id.startsWith(JOURNAL_ID_PREFIX)).sort((a, b) => a.createdAt - b.createdAt)
  if (marked[0]) return marked[0].id
  // Fallback (e.g. an imported workspace): a database called Journal with a date and a mood property.
  const sig = alive.find((p) => {
    const db = st.databases[p.id]
    return (
      /^(journal|tagebuch)$/i.test(p.title.trim()) &&
      db.properties.some((x) => x.type === 'date') &&
      db.properties.some((x) => x.type === 'select' && /^(mood|stimmung)$/i.test(x.name.trim()))
    )
  })
  return sig?.id ?? null
}

function createJournalDatabase(): ID {
  const st = useWorkspace.getState()
  const de = st.settings.language === 'de'
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
  return st.createDatabase({
    id: `${JOURNAL_ID_PREFIX}${newId().slice(JOURNAL_ID_PREFIX.length)}`,
    parentId: null,
    title: 'Journal',
    icon: { type: 'emoji', value: '📓' },
    properties,
    views: [calendar, table],
  })
}

function template(): JSONContent {
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

/** Localized long date, e.g. "Friday, 2 October 2026" / "Freitag, 2. Oktober 2026". */
export function journalTitle(date: Date, lang: string): string {
  return lang === 'de' ? format(date, 'EEEE, d. MMMM yyyy', { locale: deLocale }) : format(date, 'EEEE, d MMMM yyyy', { locale: enGB })
}

/**
 * Find or create the journal entry for `date` (creating the Journal database on first use).
 * Does not navigate. Returns the entry's page id and whether the database was just created.
 */
export function journalEntryFor(date: Date): { id: ID; createdDatabase: boolean } | null {
  let dbId = findJournalDatabase()
  const createdDatabase = !dbId
  if (!dbId) dbId = createJournalDatabase()
  const st = useWorkspace.getState()
  const db = st.databases[dbId]
  if (!db) return null
  const dateProp = db.properties.find((p) => p.type === 'date' && /^(date|datum)$/i.test(p.name.trim())) ?? db.properties.find((p) => p.type === 'date')
  const iso = format(date, 'yyyy-MM-dd')
  const rows = selectRows(st.pages, dbId)
  let entry = dateProp ? rows.find((r) => ((r.properties[dateProp.id] as DateValue | null)?.start ?? '').slice(0, 10) === iso) : undefined
  entry ??= rows.find((r) => r.title.trim() === journalTitle(date, st.settings.language))
  const id =
    entry?.id ??
    st.createRow(dbId, {
      title: journalTitle(date, st.settings.language),
      properties: dateProp ? { [dateProp.id]: { start: iso } satisfies DateValue } : {},
      content: template(),
    })
  return { id, createdDatabase }
}

/** Find or create today's journal entry and open it. Returns the entry's page id. */
export function openTodayJournal(): ID | null {
  try {
    const entry = journalEntryFor(new Date())
    if (!entry) return null
    if (entry.createdDatabase) toast({ message: t('features.journal.created'), kind: 'success' })
    // replace the #/journal route so "back" does not bounce into it again
    const replace = parseHash(window.location.hash).name === 'journal'
    navigate({ name: 'page', id: entry.id }, { replace })
    return entry.id
  } catch (e) {
    console.error('[one] journal failed', e)
    toast({ message: t('features.journal.failed'), kind: 'error' })
    return null
  }
}
