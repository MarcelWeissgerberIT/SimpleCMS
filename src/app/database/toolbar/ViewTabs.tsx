/**
 * View tabs styled as index-card / file-folder tabs; add view, per-view menu, drag to reorder.
 */
import { useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, LayoutTemplate, PanelRight, Pencil, Plus, Trash, SquareSplitHorizontal, Maximize2 } from 'lucide-react'
import type { ID, View, ViewType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { Menu, MenuList, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { VIEW_ICON, VIEW_TYPES } from '../model/schema'
import type { DbModel } from '../hooks'
import { LayoutPanel } from './LayoutPanel'

export function ViewTypeIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const I = VIEW_ICON[type]
  return <I size={size} strokeWidth={1.7} aria-hidden />
}

function Tab({ view, index, active, onSelect, onMenu, renaming, onRenamed }: { view: View; index: number; active: boolean; onSelect: () => void; onMenu: (el: HTMLElement) => void; renaming: boolean; onRenamed: (name: string | null) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id })
  const [name, setName] = useState(view.name)
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
          <input
            className="db-tab__input"
            autoFocus
            value={name}
            size={Math.max(4, name.length)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRenamed(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenamed(name)
              if (e.key === 'Escape') onRenamed(null)
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          className="db-tab__btn"
          onClick={(e) => (active ? onMenu(e.currentTarget) : onSelect())}
          onDoubleClick={(e) => {
            e.preventDefault()
            onMenu(e.currentTarget)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect()
            onMenu(e.currentTarget)
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
  const [renaming, setRenaming] = useState<ID | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = views.map((v) => v.id)
    s.updateDatabase(m.db.id, { views: arrayMove(views, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))) })
  }

  const addView = (type: ViewType) => {
    const id = s.addView(m.db.id, { type, name: t(`database.view.${type}`) })
    onSelect(id)
    requestAnimationFrame(() => stripRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
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
        s.deleteView(m.db.id, v.id)
        const next = views[idx + 1] ?? views[idx - 1]
        if (next) onSelect(next.id)
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
              renaming={renaming === v.id}
              onRenamed={(name) => {
                if (name !== null && name.trim()) s.updateView(m.db.id, v.id, { name: name.trim() })
                setRenaming(null)
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button type="button" className="db-tabs__add" aria-label={t('database.view.add')} title={t('database.view.add')} onClick={(e) => setAddAnchor(e.currentTarget)}>
        <Plus size={14} />
      </button>
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        entries={[{ kind: 'section', label: t('database.view.addTitle') }, ...VIEW_TYPES.map((type) => ({ label: t(`database.view.${type}`), icon: <ViewTypeIcon type={type} />, hint: t(`database.view.hint.${type}`), onSelect: () => addView(type) }))]}
        width={280}
      />
      {menu && !layout && (
        <Popover open anchor={menu.el} onClose={() => setMenu(null)} className="db-viewmenu">
          <div className="db-viewmenu__head">
            <ViewTypeIcon type={menu.view.type} />
            <span className="db-viewmenu__name">{menu.view.name}</span>
            <span className="label">{t(`database.view.${menu.view.type}`)}</span>
          </div>
          <MenuList entries={viewMenu(menu.view)} onClose={() => setMenu(null)} />
        </Popover>
      )}
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
