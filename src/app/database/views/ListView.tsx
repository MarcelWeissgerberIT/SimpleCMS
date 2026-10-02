/**
 * List view: compact lines (icon + title + visible values right-aligned), optional groups,
 * inline title for new rows, keyboard ↑↓ / Enter.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import type { ID, Page } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { pointAnchor } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useModel, type DbModel } from '../hooks'
import { useViewActions, useCollapsed, GroupLabel, EmptyState } from './shared'
import { ValueView } from '../cells/display'
import { TitleInput } from './cards'
import { isEmptyValue } from '../model/resolve'
import { NONE_KEY, valueForGroupMove, type RowGroup } from '../model/query'
import './views.css'

export function ListView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const [collapsed, toggleCollapsed] = useCollapsed(m.view.id)
  const [editing, setEditing] = useState<ID | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hidden = new Set(m.view.hiddenGroups ?? [])

  useEffect(() => {
    if (actions.editTitleOf && m.rows.some((r) => r.id === actions.editTitleOf)) {
      setEditing(actions.editTitleOf)
      actions.clearEditTitle()
    }
  }, [actions, m.rows])

  const presets = (g: RowGroup | null) => {
    if (!g || !m.groupProp || g.key === NONE_KEY) return {}
    const v = valueForGroupMove(m.groupProp, undefined, null, g.key)
    return v === undefined ? {} : { [m.groupProp.id]: v }
  }
  const add = (g: RowGroup | null) => setEditing(actions.newRow({ properties: presets(g) }))

  const onKeyDown = (e: React.KeyboardEvent) => {
    const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.dbl-row') ?? [])
    const i = rows.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    }
  }

  const renderRows = (rows: Page[]) =>
    rows.map((row) => (
      <ListRow
        key={row.id}
        m={m}
        row={row}
        editing={editing === row.id}
        onEditDone={(cancel) => {
          setEditing(null)
          if (cancel && !useWorkspace.getState().pages[row.id]?.title) useWorkspace.getState().trashPage(row.id)
        }}
        onOpen={() => actions.open(row)}
        onContext={(e) => {
          e.preventDefault()
          actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
        }}
      />
    ))

  const addRow = (g: RowGroup | null) => (
    <button type="button" className="dbl-add" onClick={() => add(g)}>
      <Plus size={14} /> {t('common.new')}
    </button>
  )

  if (!m.rows.length && !m.groups) return <EmptyState onAdd={() => add(null)} />

  return (
    <div className="dbl" ref={rootRef} onKeyDown={onKeyDown}>
      {m.groups
        ? m.groups
            .filter((g) => !hidden.has(g.key) && !(g.key === NONE_KEY && !g.rows.length))
            .map((g) => (
              <section key={g.key} className="dbl-group">
                <header className="dbl-group__head">
                  <button type="button" className="icon-btn icon-btn--sm dbt-grouphead__chev" data-open={!collapsed.has(g.key)} aria-expanded={!collapsed.has(g.key)} onClick={() => toggleCollapsed(g.key)}>
                    <ChevronRight size={14} />
                  </button>
                  <GroupLabel group={g} />
                  <span className="dbb-count">{g.rows.length}</span>
                </header>
                {!collapsed.has(g.key) && (
                  <>
                    {renderRows(g.rows)}
                    {addRow(g)}
                  </>
                )}
              </section>
            ))
        : (
          <>
            {renderRows(m.rows)}
            {addRow(null)}
          </>
        )}
    </div>
  )
}

function ListRow({ m, row, editing, onEditDone, onOpen, onContext }: { m: DbModel; row: Page; editing: boolean; onEditDone: (cancel: boolean) => void; onOpen: () => void; onContext: (e: React.MouseEvent) => void }) {
  const t = useT()
  const values = m.visibleProps.map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v))
  return (
    <div
      className="dbl-row"
      tabIndex={0}
      role="button"
      onClick={() => !editing && onOpen()}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen()
      }}
      onContextMenu={onContext}
    >
      <span className="dbl-row__icon">
        <PageIcon icon={row.icon} size={16} />
      </span>
      <span className="dbl-row__title">
        {editing ? <TitleInput row={row} onDone={onEditDone} /> : <span className={row.title ? '' : 'is-empty'}>{row.title || t('common.untitled')}</span>}
      </span>
      <span className="dbl-row__props">
        {values.map(({ p, v }) => (
          <span key={p.id} className="dbl-row__prop" data-type={p.type} title={p.name}>
            <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={v} variant="card" />
          </span>
        ))}
      </span>
    </div>
  )
}
