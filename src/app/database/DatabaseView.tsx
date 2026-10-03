/**
 * DatabaseView — view tabs, toolbar, filter chips and the active layout
 * (table / board / list / gallery / calendar / timeline / chart / form). inline=true: compact embed.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { Database, ID, Page, PropertyValue } from '../store/types'
import { useDatabase, usePage } from '../store/selectors'
import { useWorkspace } from '../store/store'
import { PageIcon } from '../ui/PageIcon'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../i18n'
import { openPage } from '../lib/router'
import { DbModelContext, useDbModel, useLocalState } from './hooks'
import { ViewTabs } from './toolbar/ViewTabs'
import { Toolbar } from './toolbar/Toolbar'
import { FilterChips, newFilterFor, emptyGroup } from './toolbar/Filters'
import type { Template } from './toolbar/Templates'
import { RowContextMenu, ViewActionsContext, type ViewActions } from './views/shared'
import { TableView } from './views/TableView'
import { BoardView } from './views/BoardView'
import { ListView } from './views/ListView'
import { GalleryView } from './views/GalleryView'
import { openRow } from './model/actions'
import { searchRows, testGroup } from './model/query'
import { useUI } from '../store/ui'
import type { PopoverAnchor } from '../ui/Popover'
import { AutofillHost } from './autofill'
import { TurnOffHost } from './toolbar/StructurePanels'
import { useDbReadOnly } from './readonly'
import { resetSessionQuery, setViewQuery, useSessionOverlay, withOverlay } from './model/lock'
import './database.css'

const CalendarView = lazy(() => import('./views/CalendarView'))
const TimelineView = lazy(() => import('./views/TimelineView'))
const ChartView = lazy(() => import('./views/ChartView'))
const FormView = lazy(() => import('./form/FormView'))

export interface DatabaseViewProps {
  databaseId: ID
  inline?: boolean
  viewId?: ID
}

export function DatabaseView({ databaseId, inline, viewId }: DatabaseViewProps) {
  const t = useT()
  const db = useDatabase(databaseId)
  const page = usePage(databaseId)
  if (!db || !page || page.trashed)
    return (
      <div className="db db--missing">
        <span className="label">{page?.trashed ? t('database.missing.trashed') : t('database.missing.gone')}</span>
      </div>
    )
  return <DatabaseRoot key={db.id} db={db} page={page} inline={!!inline} viewId={viewId} />
}

function DatabaseRoot({ db, page, inline, viewId }: { db: Database; page: Page; inline: boolean; viewId?: ID }) {
  const t = useT()
  const [activeId, setActiveId] = useLocalState<ID | null>(`one.db.view.${db.id}.${viewId ?? (inline ? 'inline' : 'page')}`, viewId ?? null)
  const saved = db.views.find((v) => v.id === activeId) ?? db.views.find((v) => v.id === viewId) ?? db.views[0]
  // a locked database: this tab's own filters / sorts over the saved view (model/lock)
  const overlay = useSessionOverlay(db.id, saved?.id)
  const view = useMemo(() => (saved ? withOverlay(saved, overlay) : saved), [saved, overlay])
  const wasLocked = useRef(db.locked)
  useEffect(() => {
    // locked or unlocked (here or by someone else): session filters start over from the saved view
    if (wasLocked.current !== db.locked) resetSessionQuery(db.id)
    wasLocked.current = db.locked
  }, [db.locked, db.id])
  const [search, setSearch] = useState('')
  const [editTitleOf, setEditTitleOf] = useState<ID | null>(null)
  const [ctx, setCtx] = useState<{ row: Page; anchor: PopoverAnchor } | null>(null)
  const [autoChip, setAutoChip] = useState<ID | null>(null)
  /** Rows created in this session of the view: shown even if filters/search would hide them. */
  const [keep, setKeep] = useState<ID[]>([])
  const filterKey = view ? JSON.stringify(view.filter) : ''
  useEffect(() => setKeep((c) => (c.length ? [] : c)), [view?.id, filterKey, search])

  // A database always needs at least one view (a viewer can't add it: the store guard shows a table).
  const readOnly = useDbReadOnly()
  useEffect(() => {
    if (!db.views.length && !readOnly) useWorkspace.getState().addView(db.id, { type: 'table', name: t('database.view.table') })
  }, [db.views.length, db.id, t, readOnly])

  if (!view) return null
  return (
    <DatabaseBody
      db={db}
      page={page}
      inline={inline}
      view={view}
      search={search}
      setSearch={setSearch}
      setActiveId={setActiveId}
      editTitleOf={editTitleOf}
      setEditTitleOf={setEditTitleOf}
      ctx={ctx}
      setCtx={setCtx}
      autoChip={autoChip}
      setAutoChip={setAutoChip}
      keep={keep}
      setKeep={setKeep}
    />
  )
}

function DatabaseBody({
  db,
  page,
  inline,
  view,
  search,
  setSearch,
  setActiveId,
  editTitleOf,
  setEditTitleOf,
  ctx,
  setCtx,
  autoChip,
  setAutoChip,
  keep,
  setKeep,
}: {
  db: Database
  page: Page
  inline: boolean
  view: Database['views'][number]
  search: string
  setSearch: (s: string) => void
  setActiveId: (id: ID) => void
  editTitleOf: ID | null
  setEditTitleOf: (id: ID | null) => void
  ctx: { row: Page; anchor: PopoverAnchor } | null
  setCtx: (c: { row: Page; anchor: PopoverAnchor } | null) => void
  autoChip: ID | null
  setAutoChip: (id: ID | null) => void
  keep: ID[]
  setKeep: (fn: (cur: ID[]) => ID[]) => void
}) {
  const t = useT()
  const m = useDbModel(db, page, view, search, inline, keep)

  /** A new row that the view's filters / search would hide: keep it on screen and say so. */
  const keepVisible = (id: ID) => {
    setKeep((cur) => [...cur, id])
    const row = useWorkspace.getState().pages[id]
    if (!row) return
    const hidden =
      (!!view.filter?.items.length && !testGroup(m.resolver, db, view.filter, row, m.propMap)) || (!!search.trim() && !searchRows(m.resolver, db, [row], search).length)
    if (hidden) useUI.getState().toast({ message: t('database.new.outsideFilter') })
  }

  const newRow = useCallback<ViewActions['newRow']>(
    (opts = {}) => {
      if (m.readOnly) return ''
      const s = useWorkspace.getState()
      let index = opts.index
      if (opts.after) {
        const sibs = Object.values(s.pages)
          .filter((p) => p.parentId === db.id && !p.trashed)
          .sort((a, b) => a.order - b.order)
        index = sibs.findIndex((p) => p.id === opts.after!.id) + 1
      }
      const id = s.createRow(db.id, { properties: { ...m.newRowDefaults(), ...(opts.properties ?? {}) }, index })
      keepVisible(id)
      if (opts.editTitle) setEditTitleOf(id)
      if (opts.open) openRow(id, view)
      return id
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.id, m, view, setEditTitleOf],
  )

  const onNew = (tpl?: Template) => {
    if (m.readOnly) return
    const s = useWorkspace.getState()
    const props: Record<ID, PropertyValue> = { ...m.newRowDefaults(), ...(tpl ? JSON.parse(JSON.stringify(tpl.properties)) : {}) }
    const id = s.createRow(db.id, { title: '', properties: props, content: tpl?.content ? JSON.parse(JSON.stringify(tpl.content)) : null, icon: tpl?.icon ?? null })
    keepVisible(id)
    if (view.type === 'table' || view.type === 'list') {
      if (tpl) openRow(id, view)
      else setEditTitleOf(id)
    } else openRow(id, view)
  }

  const actions = useMemo<ViewActions>(
    () => ({
      newRow,
      editTitleOf,
      clearEditTitle: () => setEditTitleOf(null),
      open: (row) => openRow(row.id, view),
      contextMenu: (row, anchor) => setCtx({ row, anchor }),
      clearSearch: () => setSearch(''),
    }),
    [newRow, editTitleOf, view, setEditTitleOf, setCtx, setSearch],
  )

  const onFilterProp = (propId: ID) => {
    const prop = m.propMap.get(propId)
    if (!prop || m.readOnly) return
    const f = newFilterFor(m, prop)
    const base = view.filter ?? emptyGroup()
    setViewQuery(db.id, view.id, { filter: { ...base, items: [...base.items, f] } })
    setAutoChip(f.id)
  }

  let body: React.ReactNode
  switch (view.type) {
    case 'board':
      body = <BoardView />
      break
    case 'list':
      body = <ListView />
      break
    case 'gallery':
      body = <GalleryView />
      break
    case 'calendar':
      body = <CalendarView />
      break
    case 'timeline':
      body = <TimelineView />
      break
    case 'chart':
      body = <ChartView />
      break
    case 'form':
      body = <FormView />
      break
    default:
      body = <TableView onFilterProp={onFilterProp} />
  }

  return (
    <DbModelContext.Provider value={m}>
      <ViewActionsContext.Provider value={actions}>
        <section
          className={`db${inline ? ' db--inline' : ''}`}
          data-view={view.type}
          data-readonly={m.readOnly || undefined}
          data-locked={m.locked || undefined}
          aria-label={page.title || t('common.untitled')}
        >
          {inline && <InlineHeader page={page} readOnly={m.readOnly} />}
          <div className="db-bar">
            <ViewTabs m={m} onSelect={setActiveId} />
            <Toolbar m={m} onNew={onNew} setSearch={setSearch} compact={inline} />
          </div>
          {view.type !== 'form' && <FilterChips m={m} autoOpen={autoChip} onAutoOpened={() => setAutoChip(null)} />}
          <div className="db-body">
            <Suspense fallback={<div className="db-loading label">{t('common.loading')}</div>}>
              <div key={view.id} className="db-viewbody">
                {body}
              </div>
            </Suspense>
          </div>
          {ctx && <RowContextMenu row={ctx.row} anchor={ctx.anchor} onClose={() => setCtx(null)} />}
          <AutofillHost />
          <TurnOffHost />
        </section>
      </ViewActionsContext.Provider>
    </DbModelContext.Provider>
  )
}

function InlineHeader({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const t = useT()
  const [title, setTitle] = useState(page.title)
  useEffect(() => setTitle(page.title), [page.title])
  const commit = () => {
    if (title !== page.title && !readOnly) useWorkspace.getState().updatePage(page.id, { title })
  }
  return (
    <div className="db-inlinehead">
      <PageIcon icon={page.icon} kind="database" size={20} />
      <input
        className="db-inlinehead__title"
        value={title}
        readOnly={readOnly}
        placeholder={t('common.untitled')}
        aria-label={t('database.title')}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      <Tooltip label={t('database.openFull')}>
        <button type="button" className="icon-btn" onClick={() => openPage(page.id)}>
          <Maximize2 size={14} />
        </button>
      </Tooltip>
    </div>
  )
}
