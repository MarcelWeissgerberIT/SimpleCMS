import { createContext, memo, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { ChevronRight, Copy, FolderInput, Link2, MoreHorizontal, PanelRight, PencilLine, Plus, Star, StarOff, Trash2, PanelRightOpen } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { usePage } from '../../store/selectors'
import { useRoute } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { childIds, treeKey, useChildIds, useTreeState } from '../lib/tree'
import { canNestUnder, copyPageLink, createPageAndOpen, duplicateAndOpen, goToPage, trashWithUndo } from '../lib/actions'

type DropPos = 'before' | 'after' | 'inside'
interface DropState {
  overId: ID
  pos: DropPos
}

const INDENT = 14

/** Keep the drag chip just below-right of the pointer so the drop target stays visible. */
const besideCursor: Modifier = ({ transform, activatorEvent, draggingNodeRect }) => {
  if (!activatorEvent || !draggingNodeRect) return transform
  const ev = activatorEvent as MouseEvent | TouchEvent
  const point = 'touches' in ev ? ev.touches[0] : ev
  if (!point) return transform
  return {
    ...transform,
    x: transform.x + (point.clientX - draggingNodeRect.left) + 14,
    y: transform.y + (point.clientY - draggingNodeRect.top) + 10,
  }
}

/* ------------------------------------------------------------------ */
/* Drag & drop context for the PAGES section                           */
/* ------------------------------------------------------------------ */

export function DraggableTree({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<ID | null>(null)
  const [drop, setDrop] = useState<DropState | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const hoverKey = useRef<string>('')
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 6 } }),
  )

  const reset = () => {
    setActiveId(null)
    setDrop(null)
    window.clearTimeout(hoverTimer.current)
    hoverKey.current = ''
  }

  const onStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    document.body.dataset.dragging = 'tree'
  }

  const onMove = (e: DragMoveEvent) => {
    const over = e.over
    if (!over) return setDrop(null)
    const overId = String(over.id)
    const dragId = String(e.active.id)
    const ae = e.activatorEvent as MouseEvent | TouchEvent
    const startY = 'touches' in ae ? (ae.touches[0]?.clientY ?? 0) : ae.clientY
    const y = startY + e.delta.y
    const rect = over.rect
    const rel = (y - rect.top) / rect.height
    const pages = useWorkspace.getState().pages
    const target = pages[overId]
    if (!target || overId === dragId) return setDrop(null)
    const canInside = canNestUnder(dragId, overId)
    let pos: DropPos = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : canInside ? 'inside' : rel < 0.5 ? 'before' : 'after'
    // before/after need a valid parent too
    if (pos !== 'inside' && !canNestUnder(dragId, target.parentId)) pos = canInside ? 'inside' : pos
    if (pos !== 'inside' && !canNestUnder(dragId, target.parentId)) return setDrop(null)
    setDrop((d) => (d?.overId === overId && d.pos === pos ? d : { overId, pos }))
    // hover "inside" a collapsed page for a moment → expand it
    const k = `${overId}:${pos}`
    if (k !== hoverKey.current) {
      hoverKey.current = k
      window.clearTimeout(hoverTimer.current)
      if (pos === 'inside') hoverTimer.current = window.setTimeout(() => useTreeState.getState().expand([treeKey('pages', overId)]), 650)
    }
  }

  const onEnd = () => {
    delete document.body.dataset.dragging
    const dragId = activeId
    const d = drop
    reset()
    if (!dragId || !d) return
    const s = useWorkspace.getState()
    const target = s.pages[d.overId]
    if (!target) return
    const expanded = useTreeState.getState().expanded[treeKey('pages', target.id)]
    const hasKids = childIds(s.pages, target.id).filter((c) => c !== dragId).length > 0
    if (d.pos === 'inside' || (d.pos === 'after' && expanded && hasKids)) {
      // after an expanded parent visually means "first child"
      s.movePage(dragId, target.id, d.pos === 'inside' ? undefined : 0)
      useTreeState.getState().expand([treeKey('pages', target.id)])
      return
    }
    const parentId = target.parentId
    const sibs = Object.values(s.pages)
      .filter((p) => p.parentId === parentId && !p.trashed && p.id !== dragId)
      .sort((a, b) => a.order - b.order)
    const idx = sibs.findIndex((p) => p.id === target.id)
    s.movePage(dragId, parentId, d.pos === 'before' ? idx : idx + 1)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onStart}
      onDragMove={onMove}
      onDragEnd={onEnd}
      onDragCancel={() => {
        delete document.body.dataset.dragging
        reset()
      }}
    >
      <DropContext.Provider value={{ activeId, drop }}>{children}</DropContext.Provider>
      <DragOverlay dropAnimation={null} modifiers={[besideCursor]}>{activeId ? <DragChip id={activeId} /> : null}</DragOverlay>
    </DndContext>
  )
}

const DropContext = createContext<{ activeId: ID | null; drop: DropState | null }>({ activeId: null, drop: null })

function DragChip({ id }: { id: ID }) {
  const page = usePage(id)
  const t = useT()
  if (!page) return null
  return (
    <div className="sb-dragchip">
      <PageIcon icon={page.icon} kind={page.kind} size={16} />
      <span>{page.title.trim() || t('common.untitled')}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

export function PageTree({ parentId, depth, section, draggable }: { parentId: ID | null; depth: number; section: string; draggable: boolean }) {
  const ids = useChildIds(parentId)
  return (
    <>
      {ids.map((id) => (
        <TreeNode key={id} id={id} depth={depth} section={section} draggable={draggable} />
      ))}
    </>
  )
}

/** Explicit list of ids (favorites) rendered as tree roots. */
export function PageList({ ids, section }: { ids: ID[]; section: string }) {
  return (
    <>
      {ids.map((id) => (
        <TreeNode key={id} id={id} depth={0} section={section} draggable={false} />
      ))}
    </>
  )
}

const TreeNode = memo(function TreeNode({ id, depth, section, draggable }: { id: ID; depth: number; section: string; draggable: boolean }) {
  const t = useT()
  const key = treeKey(section, id)
  const expanded = useTreeState((s) => !!s.expanded[key])
  const kids = useChildIds(id)
  return (
    <div className="sb-node">
      <TreeRow id={id} depth={depth} section={section} draggable={draggable} expanded={expanded} hasKids={kids.length > 0} />
      {expanded && (
        <div className="sb-children" role="group" style={{ '--depth': depth } as CSSProperties}>
          {kids.length > 0 ? (
            <PageTree parentId={id} depth={depth + 1} section={section} draggable={draggable} />
          ) : (
            <div className="sb-empty" style={{ paddingLeft: 10 + (depth + 1) * INDENT + 22 }}>
              {t('shell.sidebar.noPagesInside')}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function TreeRow({ id, depth, section, draggable, expanded, hasKids }: { id: ID; depth: number; section: string; draggable: boolean; expanded: boolean; hasKids: boolean }) {
  const t = useT()
  const page = usePage(id)
  const route = useRoute()
  const active = route.name === 'page' && route.id === id
  const { activeId, drop } = useContext(DropContext)
  const toggle = useTreeState((s) => s.toggle)
  const [renaming, setRenaming] = useState(false)
  const menu = useMenu()
  const drag = useDraggable({ id, disabled: !draggable || renaming })
  const dropZone = useDroppable({ id, disabled: !draggable })
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!page) return null
  const isDb = page.kind === 'database'
  const canExpand = !isDb || hasKids
  const title = page.title.trim() || t('common.untitled')
  const dropPos = drop?.overId === id ? drop.pos : undefined
  const isDragging = activeId === id

  const entries: MenuEntry[] = [
    { label: t('common.rename'), icon: <PencilLine size={15} />, onSelect: () => setRenaming(true) },
    { label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicateAndOpen(id) },
    page.favorite
      ? { label: t('shell.menu.unfavorite'), icon: <StarOff size={15} />, onSelect: () => useWorkspace.getState().toggleFavorite(id) }
      : { label: t('shell.menu.favorite'), icon: <Star size={15} />, onSelect: () => useWorkspace.getState().toggleFavorite(id) },
    { label: t('common.copyLink'), icon: <Link2 size={15} />, onSelect: () => void copyPageLink(id) },
    { label: t('shell.menu.moveTo'), icon: <FolderInput size={15} />, onSelect: () => useUI.getState().openModal({ type: 'move', pageId: id }) },
    { kind: 'separator' },
    { label: t('shell.menu.openInPane'), icon: <PanelRight size={15} />, hint: t('shell.menu.altClick'), onSelect: () => useUI.getState().openPane(id) },
    { label: t('shell.menu.openInPeek'), icon: <PanelRightOpen size={15} />, onSelect: () => useUI.getState().openPeek(id) },
    { kind: 'separator' },
    { label: t('common.delete'), icon: <Trash2 size={15} />, danger: true, onSelect: () => trashWithUndo(id) },
  ]

  return (
    <div
      ref={(el) => {
        rowRef.current = el
        drag.setNodeRef(el)
        dropZone.setNodeRef(el)
      }}
      className="sb-row"
      data-active={active || undefined}
      data-drop={dropPos}
      data-dragging={isDragging || undefined}
      data-menu-open={menu.open || undefined}
      style={{ '--depth': depth } as CSSProperties}
      {...(draggable ? drag.listeners : {})}
      onContextMenu={(e) => {
        e.preventDefault()
        menu.openAt(e.currentTarget)
      }}
    >
      <span className="sb-row__lead">
        <span className="sb-row__icon">
          <PageIcon icon={page.icon} kind={page.kind} size={16} />
        </span>
        {canExpand && (
          <button
            type="button"
            className="sb-row__toggle"
            aria-label={expanded ? t('shell.sidebar.collapse') : t('shell.sidebar.expand')}
            data-open={expanded || undefined}
            onClick={(e) => {
              e.stopPropagation()
              toggle(treeKey(section, id))
            }}
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        )}
      </span>
      {renaming ? (
        <RenameInput
          initial={page.title}
          onDone={(v) => {
            setRenaming(false)
            if (v !== null) useWorkspace.getState().updatePage(id, { title: v })
          }}
        />
      ) : (
        <a
          className="sb-row__link"
          href={`#/p/${id}`}
          draggable={false}
          data-no-pane=""
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return
            e.preventDefault()
            if (e.altKey) useUI.getState().openPane(id)
            else goToPage(id)
          }}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault()
              setRenaming(true)
            }
          }}
          aria-current={active ? 'page' : undefined}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={canExpand ? expanded : undefined}
          data-tree-key={treeKey(section, id)}
        >
          <span className="sb-row__title" data-untitled={!page.title.trim() || undefined}>
            {title}
          </span>
        </a>
      )}
      {!renaming && (
        <span className="sb-row__actions">
          <button type="button" className="sb-row__btn" aria-label={t('common.more')} onClick={toggleMenu(menu)}>
            <MoreHorizontal size={15} />
          </button>
          {!isDb && (
            <button
              type="button"
              className="sb-row__btn"
              aria-label={t('shell.sidebar.addInside')}
              onClick={(e) => {
                e.stopPropagation()
                useTreeState.getState().expand([treeKey(section, id)])
                createPageAndOpen(id)
              }}
            >
              <Plus size={15} />
            </button>
          )}
        </span>
      )}
      <Menu {...menu.props} entries={entries} width={240} />
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (val: string | null) => {
    if (done.current) return
    done.current = true
    onDone(val)
  }
  return (
    <input
      className="sb-row__rename"
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(v)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
