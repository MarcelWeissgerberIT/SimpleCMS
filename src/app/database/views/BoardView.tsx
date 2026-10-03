/**
 * Board view: columns from groupBy (status/select/multi/person/checkbox + "No value"),
 * drag & drop cards between/within columns (@dnd-kit), add card per column, collapse/hide groups.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronLeft, ChevronRight, ChevronsLeftRight, Ellipsis, Eye, EyeOff, Plus } from 'lucide-react'
import { scrollByPage, useEdgeOverflow } from './overflow'
import type { ID, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { pointAnchor } from '../../ui/Popover'
import { useModel, type DbModel } from '../hooks'
import { useViewActions, useCollapsed, GroupLabel } from './shared'
import { CardBody, CardPreview } from './cards'
import { NONE_KEY, valueForGroupMove, type RowGroup } from '../model/query'
import { orderBetween, writeValue } from '../model/actions'
import { BOARD_GROUP_TYPES } from '../model/schema'
import { Menu, Select, TypeIcon } from '../parts'
import { useRowColor } from './tree'
import { ruleStyle } from '../model/colors'
import type { ColorRule } from '../../store/types'
import './views.css'

const SEP = '::'
const PAGE = 40
const itemId = (g: string, r: ID) => `${g}${SEP}${r}`
const parseItem = (id: string) => {
  const i = id.lastIndexOf(SEP)
  return { group: id.slice(0, i), row: id.slice(i + SEP.length) }
}

export function BoardView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const { view, db } = m
  const [collapsed, toggleCollapsed] = useCollapsed(view.id)
  const [setScrollEl, overflow, scrollEl] = useEdgeOverflow<HTMLDivElement>()
  const hiddenKey = (view.hiddenGroups ?? []).join('|')
  const keepEmptyNone = m.groupProp?.type === 'select' || m.groupProp?.type === 'multi_select' || m.groupProp?.type === 'person'
  const { visibleGroups, hiddenGroups } = useMemo(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split('|') : [])
    const groups = m.groups ?? []
    return {
      // an empty "No value" column stays as a drop target for select / multi-select / person
      visibleGroups: groups.filter((g) => !hidden.has(g.key) && !(g.key === NONE_KEY && g.rows.length === 0 && !keepEmptyNone)),
      hiddenGroups: groups.filter((g) => hidden.has(g.key)),
    }
  }, [m.groups, hiddenKey, keepEmptyNone])
  const rowsById = useMemo(() => new Map(m.rows.map((r) => [r.id, r])), [m.rows])
  const size = view.cardSize ?? 'medium'
  // the column already shows the group value — don't repeat it on every card
  const cardProps = useMemo(() => m.visibleProps.filter((p) => p.id !== view.groupBy), [m.visibleProps, view.groupBy])
  const colorOf = useRowColor(m)

  const fromGroups = useMemo(() => Object.fromEntries(visibleGroups.map((g) => [g.key, g.rows.map((r) => itemId(g.key, r.id))])), [visibleGroups])
  const [items, setItems] = useState<Record<string, string[]>>(fromGroups)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ID | null>(null)
  const [menu, setMenu] = useState<{ group: RowGroup; el: HTMLElement } | null>(null)
  useEffect(() => {
    if (!activeId) setItems(fromGroups)
  }, [fromGroups, activeId])

  // new card from the toolbar "New" lands in the first column in edit mode
  useEffect(() => {
    if (actions.editTitleOf && rowsById.has(actions.editTitleOf)) {
      setEditing(actions.editTitleOf)
      actions.clearEditTitle()
    }
  }, [actions, rowsById])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    // Space lifts a card (Enter opens it); Space / Enter drop, Esc cancels
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  )

  const containerOf = (id: string): string | undefined => (id in items ? id : Object.keys(items).find((k) => items[k].includes(id)))

  const onDragStart = (e: DragStartEvent) => {
    if (!m.readOnly) setActiveId(String(e.active.id))
  }
  const onDragOver = (e: DragOverEvent) => {
    const over = e.over?.id
    if (!over) return
    const a = String(e.active.id)
    const from = containerOf(a)
    const to = containerOf(String(over))
    if (!from || !to || from === to) return
    setItems((cur) => {
      const src = cur[from].filter((x) => x !== a)
      const dst = [...cur[to]]
      const overIdx = dst.indexOf(String(over))
      dst.splice(overIdx < 0 ? dst.length : overIdx, 0, a)
      return { ...cur, [from]: src, [to]: dst }
    })
  }
  const onDragEnd = (e: DragEndEvent) => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setActiveId(null)
    if (!over || m.readOnly) return setItems(fromGroups)
    const to = containerOf(over)
    const from = parseItem(a).group
    if (!to) return
    let list = items[to]
    const oldIdx = list.indexOf(a)
    const overIdx = list.indexOf(over)
    if (oldIdx >= 0 && overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx)
    const rowId = parseItem(a).row
    const row = rowsById.get(rowId)
    if (!row) return
    const gp = m.groupProp
    if (gp && to !== from) {
      const v = valueForGroupMove(gp, useWorkspace.getState().pages[rowId]?.properties[gp.id], from, to)
      // created by / last edited by: a card can't change who made it — it goes back
      if (v === undefined) return setItems(fromGroups)
      writeValue(db.id, gp, rowId, v)
    }
    if (!view.sorts.length) {
      const idx = list.indexOf(a)
      const before = idx > 0 ? rowsById.get(parseItem(list[idx - 1]).row) : undefined
      const after = idx < list.length - 1 ? rowsById.get(parseItem(list[idx + 1]).row) : undefined
      if (before?.id !== rowId && after?.id !== rowId) {
        const moved = (before && row.order <= before.order) || (after && row.order >= after.order) || to !== from
        if (moved) useWorkspace.getState().updatePage(rowId, { order: orderBetween(before, after) })
      }
    }
    setItems((cur) => ({ ...cur, [to]: list }))
  }

  const addCard = (g: RowGroup) => {
    if (m.readOnly) return
    const gp = m.groupProp
    const v = gp ? valueForGroupMove(gp, undefined, null, g.key) : undefined
    const id = actions.newRow({ properties: gp && v !== undefined && g.key !== NONE_KEY ? { [gp.id]: v } : {} })
    setEditing(id)
  }

  if (!m.groupProp) return <ChooseGroup m={m} />

  const activeRow = activeId ? rowsById.get(parseItem(activeId).row) : undefined
  const setHidden = (key: string, on: boolean) => {
    if (m.fixed) return
    const next = new Set(view.hiddenGroups ?? [])
    if (on) next.add(key)
    else next.delete(key)
    useWorkspace.getState().updateView(db.id, view.id, { hiddenGroups: [...next] })
  }

  return (
    <div className="dbb-wrap" data-overflow={overflow}>
      <div className="dbb" data-size={size} ref={setScrollEl}>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="dbb-cols">
            {visibleGroups.map((g, gi) => {
              if (collapsed.has(g.key))
                return (
                  <button key={g.key} type="button" className="dbb-collapsed" onClick={() => toggleCollapsed(g.key)} aria-label={`${g.label} — ${t('database.group.expand')}`} title={t('database.group.expand')}>
                    <span className="dbb-count">{g.rows.length}</span>
                    {g.option?.group ? (
                      <span className="db-status__led" data-group={g.option.group} />
                    ) : (
                      <span className="db-swatch" style={g.color ? { background: `var(--c-${g.color}-text)` } : undefined} />
                    )}
                    <span className="dbb-collapsed__label">{g.label}</span>
                  </button>
                )
              return (
                <Column
                  key={g.key}
                  m={m}
                  group={g}
                  index={gi}
                  ids={items[g.key] ?? []}
                  rowsById={rowsById}
                  cardProps={cardProps}
                  colorOf={colorOf}
                  editing={editing}
                  // like the table (and Notion): Esc on a fresh card keeps it, untitled
                  onEditDone={() => setEditing(null)}
                  onAdd={() => addCard(g)}
                  onMenu={(el) => setMenu({ group: g, el })}
                  onOpen={(row) => actions.open(row)}
                  onContext={(row, e) => {
                    e.preventDefault()
                    actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
                  }}
                />
              )
            })}
            {hiddenGroups.length > 0 && (
              <div className="dbb-hidden">
                <div className="label dbb-hidden__head">{t('database.group.hidden')}</div>
                {hiddenGroups.map((g) => (
                  <button key={g.key} type="button" className="dbb-hidden__row" disabled={m.fixed} onClick={() => setHidden(g.key, false)}>
                    <GroupLabel group={g} />
                    <span className="dbb-count">{g.rows.length}</span>
                    <EyeOff size={13} className="faint" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
            {activeRow ? (
              <div className="dbc dbc--overlay">
                <CardPreview m={m} row={activeRow} preview={view.cardPreview} />
                <CardBody m={m} row={activeRow} props={cardProps} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        {menu && (
          <Menu
            open
            anchor={menu.el}
            onClose={() => setMenu(null)}
            entries={[
              { label: t('database.group.collapse'), icon: <ChevronsLeftRight size={14} />, onSelect: () => toggleCollapsed(menu.group.key) },
              ...(m.fixed ? [] : [{ label: t('database.group.hide'), icon: <Eye size={14} />, onSelect: () => setHidden(menu.group.key, true) }]),
            ]}
          />
        )}
      </div>
      {(overflow === 'start' || overflow === 'both') && (
        <button type="button" className="dbb-edge dbb-edge--start" aria-label={t('database.board.scrollLeft')} onClick={() => scrollByPage(scrollEl, -1, '.dbb-col, .dbb-collapsed', 56)}>
          <ChevronLeft size={16} />
        </button>
      )}
      {(overflow === 'end' || overflow === 'both') && (
        <button type="button" className="dbb-edge dbb-edge--end" aria-label={t('database.board.scrollRight')} onClick={() => scrollByPage(scrollEl, 1, '.dbb-col, .dbb-collapsed', 56)}>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}

function Column({
  m,
  group,
  index,
  ids,
  rowsById,
  cardProps,
  colorOf,
  editing,
  onEditDone,
  onAdd,
  onMenu,
  onOpen,
  onContext,
}: {
  m: DbModel
  group: RowGroup
  index: number
  ids: string[]
  rowsById: Map<ID, Page>
  cardProps: PropertyDef[]
  colorOf: (row: Page) => ColorRule | null
  editing: ID | null
  onEditDone: (id: ID, cancelled: boolean) => void
  onAdd: () => void
  onMenu: (el: HTMLElement) => void
  onOpen: (row: Page) => void
  onContext: (row: Page, e: React.MouseEvent) => void
}) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: group.key })
  const [limit, setLimit] = useState(PAGE)
  const shown = ids.length > limit ? ids.slice(0, limit) : ids
  return (
    <section className="dbb-col" data-over={isOver} aria-label={group.label}>
      <header className="dbb-col__head">
        <span className="dbb-col__idx">{String.fromCharCode(65 + (index % 26))}</span>
        <GroupLabel group={group} />
        <span className="dbb-count">{ids.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.more')} onClick={(e) => onMenu(e.currentTarget)}>
          <Ellipsis size={14} />
        </button>
        {!m.readOnly && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.new.inGroup')} onClick={onAdd}>
            <Plus size={14} />
          </button>
        )}
      </header>
      <div ref={setNodeRef} className="dbb-col__body">
        <SortableContext id={group.key} items={shown} strategy={verticalListSortingStrategy}>
          {shown.map((id) => {
            const row = rowsById.get(id.slice(id.lastIndexOf(SEP) + SEP.length))
            if (!row) return null
            return <Card key={id} id={id} m={m} row={row} rc={colorOf(row)} props={cardProps} editing={editing === row.id} onEditDone={(c) => onEditDone(row.id, c)} onOpen={() => onOpen(row)} onContext={(e) => onContext(row, e)} />
          })}
        </SortableContext>
        {ids.length > shown.length && (
          <button type="button" className="dbb-more" onClick={() => setLimit((l) => l + PAGE * 2)}>
            {t('database.board.more', { count: ids.length - shown.length })}
          </button>
        )}
        {!m.readOnly && (
          <button type="button" className="dbb-add" onClick={onAdd}>
            <Plus size={13} /> {t('common.new')}
          </button>
        )}
      </div>
    </section>
  )
}

function Card({ id, m, row, rc, props, editing, onEditDone, onOpen, onContext }: { id: string; m: DbModel; row: Page; rc: ColorRule | null; props: PropertyDef[]; editing: boolean; onEditDone: (cancelled: boolean) => void; onOpen: () => void; onContext: (e: React.MouseEvent) => void }) {
  // view only: cards open, they don't move
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: editing || m.readOnly })
  return (
    <article
      ref={setNodeRef}
      className={`dbc${rc ? ' db-rc' : ''}`}
      data-dragging={isDragging}
      data-rc={rc?.target}
      data-rc-color={rc?.color}
      style={{ transform: CSS.Translate.toString(transform), transition, ...(rc ? ruleStyle(rc.color) : null) }}
      {...attributes}
      {...listeners}
      // view only: the card still opens (Enter / click) — not "disabled", not "sortable"
      {...(m.readOnly ? { 'aria-disabled': undefined, 'aria-roledescription': undefined, 'aria-describedby': undefined } : null)}
      onClick={() => !editing && onOpen()}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter' && !editing && !isDragging && e.target === e.currentTarget) onOpen()
      }}
      onContextMenu={onContext}
    >
      <CardPreview m={m} row={row} preview={m.view.cardPreview} />
      <CardBody m={m} row={row} props={props} editing={editing} onEditDone={onEditDone} />
    </article>
  )
}

function ChooseGroup({ m }: { m: DbModel }) {
  const t = useT()
  const candidates = m.db.properties.filter((p) => BOARD_GROUP_TYPES.includes(p.type))
  if (m.fixed)
    return (
      <div className="db-empty">
        <span className="db-empty__line" aria-hidden />
        <span className="label">{t('database.board.noGroup')}</span>
        <span className="db-empty__line" aria-hidden />
      </div>
    )
  return (
    <div className="db-empty">
      <span className="db-empty__line" aria-hidden />
      <span className="label">{t('database.group.by')}</span>
      <Select
        value={null}
        placeholder={t('database.layout.pickDate')}
        items={candidates.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
        onChange={(v) => useWorkspace.getState().updateView(m.db.id, m.view.id, { groupBy: v })}
      />
      <span className="db-empty__line" aria-hidden />
    </div>
  )
}
