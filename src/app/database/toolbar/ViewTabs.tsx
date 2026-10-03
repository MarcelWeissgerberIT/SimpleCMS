/**
 * View tabs styled as index-card / file-folder tabs; add view, per-view menu, drag to reorder.
 */
import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, LayoutTemplate, ListTree, PanelRight, Paintbrush, Pencil, Plus, Trash, SquareSplitHorizontal, Maximize2, Waypoints } from 'lucide-react'
import type { ID, View, ViewType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { Menu } from '../parts'
import { useT } from '../../i18n'
import { VIEW_ICON, VIEW_TYPES } from '../model/schema'
import type { DbModel } from '../hooks'
import { LayoutPanel } from './LayoutPanel'
import { revealInStrip } from '../views/overflow'
import { isFormable } from '../form/fields'
import { structureEntries, type StructurePanel } from './structureEntries'
import { DependenciesPanel, SubItemsPanel } from './StructurePanels'
import { ColorRulesPanel } from './ColorRules'

export function ViewTypeIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const I = VIEW_ICON[type]
  return <I size={size} strokeWidth={1.7} aria-hidden />
}

/** Rename field: mounts fresh for every rename, so it always starts from the current name, selected. */
function TabRename({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      className="db-tab__input"
      autoFocus
      value={name}
      size={Math.max(4, name.length)}
      onChange={(e) => setName(e.target.value)}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(name)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}

function Tab({
  view,
  index,
  active,
  onSelect,
  onMenu,
  onRename,
  renaming,
  onRenamed,
  readOnly,
}: {
  view: View
  index: number
  active: boolean
  onSelect: () => void
  onMenu: (el: HTMLElement) => void
  onRename: () => void
  renaming: boolean
  onRenamed: (name: string | null) => void
  /** view only: a tab only switches views (no menu, rename or reordering) */
  readOnly: boolean
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id, disabled: renaming || readOnly })
  const menuTimer = useRef<number | null>(null)
  useEffect(() => () => void (menuTimer.current && window.clearTimeout(menuTimer.current)), [])
  return (
    <div
      ref={setNodeRef}
      className="db-tab"
      data-active={active}
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null), transition }}
    >
      {renaming ? (
        <span className="db-tab__btn">
          <span className="db-tab__idx">{String(index + 1).padStart(2, '0')}</span>
          <ViewTypeIcon type={view.type} />
          <TabRename initial={view.name} label={t('common.rename')} onDone={onRenamed} />
        </span>
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          className="db-tab__btn"
          onClick={(e) => {
            if (!active) return onSelect()
            if (readOnly) return
            // a second click on the active tab opens its menu — unless it becomes a double-click (rename)
            const el = e.currentTarget
            if (e.detail > 1) return
            if (e.detail === 0) return onMenu(el) // keyboard
            menuTimer.current = window.setTimeout(() => onMenu(el), 220)
          }}
          onDoubleClick={(e) => {
            e.preventDefault()
            if (menuTimer.current) window.clearTimeout(menuTimer.current)
            if (!active) onSelect()
            if (!readOnly) onRename()
          }}
          onKeyDown={(e) => {
            listeners?.onKeyDown?.(e)
            if (e.key === 'F2' && !readOnly) {
              e.preventDefault()
              onRename()
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect()
            if (!readOnly) onMenu(e.currentTarget)
          }}
        >
          <span className="db-tab__idx">{String(index + 1).padStart(2, '0')}</span>
          <ViewTypeIcon type={view.type} />
          <span className="db-tab__name">{view.name}</span>
        </button>
      )}
    </div>
  )
}

export function ViewTabs({ m, onSelect }: { m: DbModel; onSelect: (id: ID) => void }) {
  const t = useT()
  const s = useWorkspace.getState()
  const views = m.db.views
  const [menu, setMenu] = useState<{ view: View; el: HTMLElement } | null>(null)
  const [layout, setLayout] = useState<HTMLElement | null>(null)
  const [extra, setExtra] = useState<{ kind: StructurePanel; el: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<ID | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const check = () => {
      const over = el.scrollWidth > el.clientWidth + 1
      // fade the edge(s) that hide tabs, so a clipped strip reads as "more this way"
      el.dataset.overflow = !over ? 'none' : el.scrollLeft < 2 ? 'end' : el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 ? 'start' : 'both'
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    el.addEventListener('scroll', check)
    // a vertical wheel scrolls the strip sideways
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const next = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + e.deltaY))
      if (next === el.scrollLeft) return // at the end: let the page scroll
      e.preventDefault()
      el.scrollLeft = next
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', check)
      el.removeEventListener('wheel', onWheel)
    }
  }, [views.length])
  // keep the active tab in view (initial load, switching from elsewhere). Only the strip scrolls
  // sideways: scrollIntoView would also scroll the page around an inline database.
  const revealActive = () => revealInStrip(stripRef.current, stripRef.current?.querySelector('[data-active="true"]'))
  useEffect(() => revealActive(), [m.view.id])

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = views.map((v) => v.id)
    s.updateDatabase(m.db.id, { views: arrayMove(views, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))) })
  }

  const addView = (type: ViewType) => {
    const patch: Partial<View> & Pick<View, 'type'> = { type, name: t(`database.view.${type}`) }
    if (type === 'form') {
      // a form asks for every property a person can fill in (computed ones fill themselves)
      patch.visibleProperties = m.db.properties.filter((p) => p.type !== 'title' && isFormable(p)).map((p) => p.id)
      patch.form = {}
    } else if (type !== 'table') {
      // cards and lines stay readable: show a few meaningful properties, not all of them
      const rank: Record<string, number> = { status: 1, select: 2, date: 3, person: 4, multi_select: 5, number: 6, checkbox: 7 }
      patch.visibleProperties = m.db.properties
        .filter((p) => rank[p.type])
        .sort((a, b) => rank[a.type] - rank[b.type])
        .slice(0, 4)
        .map((p) => p.id)
    }
    const id = s.addView(m.db.id, patch)
    onSelect(id)
    requestAnimationFrame(revealActive)
  }

  const viewMenu = (v: View): MenuEntry[] => [
    { label: t('common.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(v.id) },
    { label: t('database.view.layout'), icon: <LayoutTemplate size={14} />, keepOpen: true, onSelect: () => setLayout(menu?.el ?? null) },
    {
      label: t('database.view.openIn'),
      icon: <PanelRight size={14} />,
      submenu: (
        [
          ['peek', <PanelRight size={14} />],
          ['center', <SquareSplitHorizontal size={14} />],
          ['full', <Maximize2 size={14} />],
        ] as const
      ).map(([mode, icon]) => ({ label: t(`database.view.open.${mode}`), icon, checked: (v.openIn ?? 'peek') === mode, onSelect: () => s.updateView(m.db.id, v.id, { openIn: mode }) })),
    },
    ...(v.id === m.view.id ? structureEntries(t, m, (kind) => menu && setExtra({ kind, el: menu.el }), { sub: <ListTree size={14} />, dep: <Waypoints size={14} />, rc: <Paintbrush size={14} /> }) : []),
    { kind: 'separator' },
    {
      label: t('common.duplicate'),
      icon: <Copy size={14} />,
      onSelect: () => {
        const id = s.duplicateView(m.db.id, v.id)
        if (id) onSelect(id)
      },
    },
    {
      label: t('common.delete'),
      icon: <Trash size={14} />,
      danger: true,
      disabled: views.length <= 1,
      onSelect: () => {
        const idx = views.findIndex((x) => x.id === v.id)
        const snapshot: View = JSON.parse(JSON.stringify(v))
        const dbId = m.db.id
        s.deleteView(dbId, v.id)
        const next = views[idx + 1] ?? views[idx - 1]
        if (next) onSelect(next.id)
        useUI.getState().toast({
          message: t('database.view.deleted', { name: v.name }),
          action: {
            label: t('common.undo'),
            run: () => {
              const cur = useWorkspace.getState().databases[dbId]
              if (!cur || cur.views.some((x) => x.id === snapshot.id)) return
              const list = [...cur.views]
              list.splice(Math.min(idx, list.length), 0, snapshot)
              useWorkspace.getState().updateDatabase(dbId, { views: list })
              onSelect(snapshot.id)
            },
          },
        })
      },
    },
  ]

  return (
    <div className="db-tabs" ref={stripRef} role="tablist" aria-label={t('database.view.views')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={views.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
          {views.map((v, i) => (
            <Tab
              key={v.id}
              view={v}
              index={i}
              active={v.id === m.view.id}
              onSelect={() => onSelect(v.id)}
              onMenu={(el) => setMenu({ view: v, el })}
              onRename={() => {
                setMenu(null)
                setRenaming(v.id)
              }}
              renaming={renaming === v.id}
              readOnly={m.readOnly}
              onRenamed={(name) => {
                if (name !== null && name.trim()) s.updateView(m.db.id, v.id, { name: name.trim() })
                setRenaming(null)
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      {!m.readOnly && (
        <button type="button" className="db-tabs__add" aria-label={t('database.view.add')} title={t('database.view.add')} onClick={(e) => setAddAnchor(e.currentTarget)}>
          <Plus size={14} />
        </button>
      )}
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        entries={[{ kind: 'section', label: t('database.view.addTitle') }, ...VIEW_TYPES.map((type) => ({ label: t(`database.view.${type}`), icon: <ViewTypeIcon type={type} />, hint: t(`database.view.hint.${type}`), onSelect: () => addView(type) }))]}
        width={280}
      />
      {menu && !layout && !extra && (
        <Popover open anchor={menu.el} onClose={() => setMenu(null)} className="db-viewmenu">
          <div className="db-viewmenu__head">
            <ViewTypeIcon type={menu.view.type} />
            <span className="db-viewmenu__name">{menu.view.name}</span>
            <span className="label">{t(`database.view.${menu.view.type}`)}</span>
          </div>
          <MenuList entries={viewMenu(menu.view)} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {extra?.kind === 'sub' && <SubItemsPanel m={m} anchor={extra.el} onClose={() => (setExtra(null), setMenu(null))} />}
      {extra?.kind === 'dep' && <DependenciesPanel m={m} anchor={extra.el} onClose={() => (setExtra(null), setMenu(null))} />}
      {extra?.kind === 'rc' && <ColorRulesPanel m={m} anchor={extra.el} onClose={() => (setExtra(null), setMenu(null))} />}
      {layout && menu && (
        <LayoutPanel
          m={m}
          anchor={layout}
          onClose={() => {
            setLayout(null)
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}
