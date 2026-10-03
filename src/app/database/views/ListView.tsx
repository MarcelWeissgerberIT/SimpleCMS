/**
 * List view: compact lines (icon + title + visible values right-aligned), optional groups,
 * inline title for new rows, keyboard ↑↓ / Enter.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import type { ColorRule, ID, Page } from '../../store/types'
import { useT } from '../../i18n'
import { pointAnchor } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useModel, type DbModel } from '../hooks'
import { useViewActions, useCollapsed, GroupLabel, EmptyState } from './shared'
import { ValueView } from '../cells/display'
import { TitleInput } from './cards'
import { isEmptyValue } from '../model/resolve'
import { NONE_KEY, valueForGroupMove, type RowGroup } from '../model/query'
import { uniformOffsets, useWindow } from './virtual'
import { useRowColor, useTree, type TreeNode } from './tree'
import { AddSubButton, TreeCount, TreeLead } from './treeParts'
import { ruleStyle } from '../model/colors'
import { writeValue } from '../model/actions'
import './views.css'

const LIST_ROW_H = 41

export function ListView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const [collapsed, toggleCollapsed] = useCollapsed(m.view.id)
  const [editing, setEditing] = useState<ID | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hidden = new Set(m.view.hiddenGroups ?? [])
  const flatRef = useRef<HTMLDivElement>(null)
  const tree = useTree(m)
  const colorOf = useRowColor(m)
  // flat list: the matching rows, or the nested display order with sub-items on
  const flat = useMemo<Array<{ row: Page; node?: TreeNode }>>(() => (tree.nodes ? tree.nodes.map((node) => ({ row: node.row, node })) : m.rows.map((row) => ({ row }))), [tree.nodes, m.rows])
  const offsets = useMemo(() => uniformOffsets(flat.length, LIST_ROW_H), [flat.length])
  const [start, end] = useWindow(flatRef, offsets, !m.groups && flat.length > 80)

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

  const addSub = (parent: Page) => {
    if (!tree.pair) return
    tree.expand(parent.id)
    const id = actions.newRow()
    writeValue(m.db.id, tree.pair.parent, id, [parent.id])
    setEditing(id)
  }

  const renderRows = (rows: Array<{ row: Page; node?: TreeNode }>) =>
    rows.map(({ row, node }) => (
      <ListRow
        key={row.id}
        m={m}
        row={row}
        node={node}
        rc={colorOf(row)}
        onToggle={() => tree.toggle(row.id)}
        onAddSub={() => addSub(row)}
        editing={editing === row.id}
        onEditDone={() => setEditing(null)}
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
                    {renderRows(g.rows.map((row) => ({ row })))}
                    {addRow(g)}
                  </>
                )}
              </section>
            ))
        : (
          <>
            <div ref={flatRef}>
              {offsets[start] > 0 && <div style={{ height: offsets[start] }} aria-hidden />}
              {renderRows(flat.slice(start, end))}
              {offsets[flat.length] - offsets[end] > 0 && <div style={{ height: offsets[flat.length] - offsets[end] }} aria-hidden />}
            </div>
            {addRow(null)}
          </>
        )}
    </div>
  )
}

function ListRow({
  m,
  row,
  node,
  rc,
  editing,
  onEditDone,
  onOpen,
  onContext,
  onToggle,
  onAddSub,
}: {
  m: DbModel
  row: Page
  node?: TreeNode
  rc: ColorRule | null
  editing: boolean
  onEditDone: (cancel: boolean) => void
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
  onToggle: () => void
  onAddSub: () => void
}) {
  const t = useT()
  const values = m.visibleProps.map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v))
  return (
    <div
      className={`dbl-row${rc ? ' db-rc' : ''}`}
      tabIndex={0}
      role="button"
      data-dimmed={node?.dimmed || undefined}
      data-rc={rc?.target}
      data-rc-color={rc?.color}
      aria-expanded={node && node.childCount > 0 ? node.expanded : undefined}
      style={rc ? ruleStyle(rc.color) : undefined}
      title={node?.dimmed ? t('database.sub.context') : undefined}
      onClick={() => !editing && onOpen()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') onOpen()
        else if (node?.childCount && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && node.expanded !== (e.key === 'ArrowRight')) {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }
      }}
      onContextMenu={onContext}
    >
      {node && <TreeLead depth={node.depth} kids={node.childCount} open={node.expanded} last={node.last} rails={node.rails} title={row.title || t('common.untitled')} onToggle={onToggle} tabbable />}
      <span className="dbl-row__icon">
        <PageIcon icon={row.icon} size={16} />
      </span>
      <span className="dbl-row__title">
        {editing ? <TitleInput row={row} onDone={onEditDone} /> : <span className={row.title ? '' : 'is-empty'}>{row.title || t('common.untitled')}</span>}
      </span>
      {node && <TreeCount kids={node.childCount} open={node.expanded} />}
      {node && !editing && <AddSubButton onAdd={onAddSub} />}
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
