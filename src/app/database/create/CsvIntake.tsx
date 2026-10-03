/**
 * "Import CSV into this database…" (toolbar ⋯): pick a .csv / .tsv → columns named like a
 * property go into it; the others are listed in the mapping dialog — a new property with the
 * suggested type, an existing property, or skipped → one row per line (appended). One toast undoes
 * it all: the rows, the new properties and options. Parsing and conversion live in the features
 * area (planCsvIntake / csvIntakeRows); a locked database takes rows but no new properties.
 */
import { create } from 'zustand'
import type { ID, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { pageTitle } from '../../store/selectors'
import { t, useT } from '../../i18n'
import { csvIntakeRows, planCsvIntake, CSV_INTAKE_MAX_ROWS, type CsvIntakePlan } from '../../features'
import { isDbReadOnly } from '../readonly'
import { isDbLocked } from '../model/lock'
import { writeValue } from '../model/actions'
import { TypeIcon } from '../parts'
import { CreatePropertiesDialog, type SuggestionResult } from './CreatePropertiesDialog'
import { dropCreated } from './quick'

interface Pending {
  dbId: ID
  file: string
  plan: CsvIntakePlan
}

const usePending = create<{ cur: Pending | null }>(() => ({ cur: null }))
const ws = () => useWorkspace.getState()
const toast = (...args: Parameters<ReturnType<typeof useUI.getState>['toast']>) => useUI.getState().toast(...args)

/** Open the file picker; the chosen file goes into database `dbId`. */
export function importCsvInto(dbId: ID): void {
  if (isDbReadOnly()) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,.tsv,text/csv,text/tab-separated-values'
  input.hidden = true
  document.body.appendChild(input)
  const done = () => input.remove()
  input.addEventListener('cancel', done)
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    done()
    if (file) void file.text().then((text) => startCsvIntake(dbId, file.name, text))
  })
  input.click()
}

/** Plan the import of CSV text; asks about unknown columns, imports right away when every column matched. */
export function startCsvIntake(dbId: ID, file: string, text: string): void {
  const db = ws().databases[dbId]
  if (!db || isDbReadOnly()) return
  const plan = planCsvIntake(text, db)
  if (!plan) return void toast({ message: t('database.csv.unreadable'), kind: 'error' })
  if (!plan.rows.length) return void toast({ message: t('database.csv.empty'), kind: 'error' })
  if (plan.columns.every((c) => c.match)) return applyIntake(dbId, plan, [])
  usePending.setState({ cur: { dbId, file, plan } })
}

/** Write the rows: `results` = what the dialog made of the unmatched columns. */
function applyIntake(dbId: ID, plan: CsvIntakePlan, results: SuggestionResult[]): void {
  const s = ws()
  const db = s.databases[dbId]
  if (!db) return
  const propOf = (id: ID | null) => (id ? ws().databases[dbId]?.properties.find((p) => p.id === id) : undefined)
  const targets: Array<{ index: number; prop: PropertyDef }> = []
  for (const c of plan.columns) {
    const prop = c.match ? propOf(c.match) : results.find((r) => r.key === String(c.index))?.prop
    if (prop) targets.push({ index: c.index, prop })
  }
  const created = results.flatMap((r) => (r.created && r.prop ? [r.prop] : []))
  const { rows, options } = csvIntakeRows(plan, targets, { pages: s.pages, people: s.people, addOptions: !isDbLocked(dbId) })

  const before: Array<[ID, SelectOption[]]> = []
  for (const [propId, list] of Object.entries(options)) {
    before.push([propId, propOf(propId)?.options ?? []])
    s.updateProperty(dbId, propId, { options: list })
  }
  const ids: ID[] = []
  for (const r of rows) {
    const plain: Record<ID, PropertyValue> = {}
    const links: Array<[PropertyDef, ID[]]> = []
    for (const [propId, v] of Object.entries(r.values)) {
      const p = propOf(propId)
      if (p?.type === 'relation') {
        if (Array.isArray(v) && v.length) links.push([p, v as ID[]])
      } else plain[propId] = v
    }
    const id = ws().createRow(dbId, { title: r.title, properties: plain })
    // relations through writeValue: a two-way partner gets the link too
    for (const [p, v] of links) writeValue(dbId, p, id, v)
    ids.push(id)
  }

  const name = pageTitle(s.pages[dbId], t('common.untitled'))
  toast({
    message: `${t(`database.csv.done.${ids.length === 1 ? 'one' : 'other'}`, { count: ids.length, db: name })}${plan.dropped ? ` · ${t('database.csv.tooMany', { count: CSV_INTAKE_MAX_ROWS })}` : ''}`,
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        for (const id of ids) if (ws().pages[id]) ws().deletePagePermanently(id)
        for (const [propId, list] of before) if (propOf(propId)) ws().updateProperty(dbId, propId, { options: list })
        dropCreated(dbId, created)
      },
    },
  })
}

/** Mount point for the mapping dialog (database views mount one). */
export function CsvIntakeHost({ dbId }: { dbId: ID }) {
  const cur = usePending((s) => (s.cur?.dbId === dbId ? s.cur : null))
  if (!cur) return null
  return <CsvIntakeDialog pending={cur} />
}

function CsvIntakeDialog({ pending }: { pending: Pending }) {
  const t = useT()
  const { dbId, plan, file } = pending
  const db = useWorkspace((s) => s.databases[dbId])
  const name = useWorkspace((s) => pageTitle(s.pages[dbId], t('common.untitled')))
  const close = () => usePending.setState({ cur: null })
  const unknown = plan.columns.filter((c) => !c.match)
  const matched = plan.columns.filter((c) => c.match)
  const count = plan.rows.length
  return (
    <CreatePropertiesDialog
      dbId={dbId}
      mode="map"
      label={t('database.csv.label')}
      title={t('database.csv.title', { file })}
      intro={t('database.csv.intro', { rows: count, cols: plan.columns.length, db: name })}
      suggestions={unknown.map((c) => ({ key: String(c.index), name: c.name, type: c.type, options: c.options, numberFormat: c.numberFormat, detail: c.samples.join(' · ') || '—' }))}
      extra={
        matched.length > 0 && (
          <div className="dbc__matched">
            <span className="label">{t('database.csv.matched')}</span>
            {matched.map((c) => {
              const p = db?.properties.find((x) => x.id === c.match)
              return (
                <span key={c.index} className="dbc__matchedcol">
                  {c.name} → {p ? <TypeIcon type={p.type} size={12} /> : null} {p?.name}
                </span>
              )
            })}
          </div>
        )
      }
      confirmLabel={t(`database.csv.confirm.${count === 1 ? 'one' : 'other'}`, { count })}
      onClose={close}
      onConfirm={(results) => {
        close()
        applyIntake(dbId, plan, results)
      }}
    />
  )
}
