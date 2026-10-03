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
import { ChevronRight, Copy, FolderInput, Link2, Lock, MoreHorizontal, PanelRight, PencilLine, Plus, Star, StarOff, Trash2, PanelRightOpen, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
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
import { canNestUnder, closeMobileSidebar, copyPageLink, createPageAndOpen, duplicateAndOpen, goToPage, trashWithUndo } from '../lib/actions'
import { useIsTouch } from '../lib/hooks'
import { ALT } from '../../ui/controls'
import { useReadOnly } from '../cloud/state'
import { peerNamesOn, usePeerOnPage } from '../cloud/Presence'
import { usePrivateMode } from '../../cloud'
import { createPrivatePageAndOpen, requestPrivacyMove } from './private'

type DropPos = 'before' | 'after' | 'inside'
interface DropState {
  overId: ID
  pos: DropPos
}

const INDENT = 14

/** Droppable section heads ("drop on PRIVATE" = to the end of that section's top level). */
export const SECTION_DROP = { pages: 'section:pages', private: 'section:private' } as const
const sectionOf = (dropId: string): boolean | null => (dropId === SECTION_DROP.private ? true : dropId === SECTION_DROP.pages ? false : null)

/** The tree section a page shows in (its expanded state is keyed by it). */
const sectionFor = (id: ID) => (useWorkspace.getState().pages[id]?.private ? 'private' : 'pages')

/**
 * Top-level pages of one sidebar section: `priv` true = my Private section, false = the workspace's
 * pages (team workspaces), null = all (the local workspace has no Private section).
 */
export function useRootIds(priv: boolean | null): ID[] {
  return useWorkspace(useShallow((s) => (priv === null ? childIds(s.pages, null) : childIds(s.pages, null).filter((id) => !!s.pages[id]?.private === priv))))
}

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
    if (sectionOf(overId) !== null) return setDrop((d) => (d?.overId === overId ? d : { overId, pos: 'inside' }))
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
      if (pos === 'inside') hoverTimer.current = window.setTimeout(() => useTreeState.getState().expand([treeKey(sectionFor(overId), overId)]), 650)
    }
  }

  const onEnd = () => {
    delete document.body.dataset.dragging
    const dragId = activeId
    const d = drop
    reset()
    if (!dragId || !d) return
    const s = useWorkspace.getState()
    const dragged = s.pages[dragId]
    if (!dragged) return
    /** Same section: a plain move. Between Private and the workspace: the pages change documents. */
    const place = (parentId: ID | null, index: number | undefined, priv: boolean) => {
      if (!!dragged.private === priv) s.movePage(dragId, parentId, index)
      else void requestPrivacyMove(dragId, priv, { parentId, index })
    }
    const section = sectionOf(d.overId)
    if (section !== null) return place(null, undefined, section)
    const target = s.pages[d.overId]
    if (!target) return
    const key = treeKey(target.private ? 'private' : 'pages', target.id)
    const expanded = useTreeState.getState().expanded[key]
    const hasKids = childIds(s.pages, target.id).filter((c) => c !== dragId).length > 0
    if (d.pos === 'inside' || (d.pos === 'after' && expanded && hasKids)) {
      // after an expanded parent visually means "first child"
      place(target.id, d.pos === 'inside' ? undefined : 0, !!target.private)
      useTreeState.getState().expand([key])
      return
    }
    const parentId = target.parentId
    const sibs = Object.values(s.pages)
      .filter((p) => p.parentId === parentId && !p.trashed && p.id !== dragId && (parentId !== null || !!p.private === !!target.private))
      .sort((a, b) => a.order - b.order)
    const idx = sibs.findIndex((p) => p.id === target.id)
    place(parentId, d.pos === 'before' ? idx : idx + 1, !!target.private)
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

/** A section head as a drop target (inside DraggableTree): the ref to attach and whether a page hovers it. */
export function useSectionDrop(id: (typeof SECTION_DROP)[keyof typeof SECTION_DROP], enabled: boolean) {
  const { activeId, drop } = useContext(DropContext)
  const zone = useDroppable({ id, disabled: !enabled })
  return { ref: zone.setNodeRef, over: drop?.overId === id, dragging: !!activeId }
}

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

export function PageTree({ parentId, depth, section, draggable, roots }: { parentId: ID | null; depth: number; section: string; draggable: boolean; roots?: ID[] }) {
  const kids = useChildIds(parentId)
  const ids = roots ?? kids
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
  const isDb = useWorkspace((s) => s.pages[id]?.kind === 'database')
  const open = expanded && (!isDb || kids.length > 0)
  return (
    <div className="sb-node">
      <TreeRow id={id} depth={depth} section={section} draggable={draggable} expanded={open} hasKids={kids.length > 0} />
      {open && (
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
  // a database row is open → mark its database
  const activeWithin = useWorkspace((s) => route.name === 'page' && s.pages[route.id]?.databaseId === id)
  const { activeId, drop } = useContext(DropContext)
  const toggle = useTreeState((s) => s.toggle)
  const [renaming, setRenaming] = useState(false)
  const menu = useMenu()
  const drag = useDraggable({ id, disabled: !draggable || renaming })
  const dropZone = useDroppable({ id, disabled: !draggable })
  const rowRef = useRef<HTMLDivElement | null>(null)
  const touch = useIsTouch()
  // viewers: no renaming, duplicating, moving or deleting; others on this page show as a dot
  const readOnly = useReadOnly()
  const peer = usePeerOnPage(id)
  const privateMode = usePrivateMode()
  const wsName = useWorkspace((s) => s.settings.workspaceName.trim() || 'One')

  useEffect(() => {
    if (active && rowRef.current) revealInScroller(rowRef.current)
  }, [active])

  if (!page) return null
  const isDb = page.kind === 'database'
  const canExpand = !isDb || hasKids
  const title = page.title.trim() || t('common.untitled')
  const dropPos = drop?.overId === id ? drop.pos : undefined
  const isDragging = activeId === id

  const edit = !readOnly
  const entries: MenuEntry[] = [
    ...(edit
      ? ([
          { label: t('common.rename'), icon: <PencilLine size={15} />, onSelect: () => setRenaming(true) },
          { label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicateAndOpen(id) },
        ] as MenuEntry[])
      : []),
    page.favorite
      ? { label: t('shell.menu.unfavorite'), icon: <StarOff size={15} />, onSelect: () => useWorkspace.getState().toggleFavorite(id) }
      : { label: t('shell.menu.favorite'), icon: <Star size={15} />, onSelect: () => useWorkspace.getState().toggleFavorite(id) },
    { label: t('common.copyLink'), icon: <Link2 size={15} />, onSelect: () => void copyPageLink(id) },
    // database rows belong to their database: no "Move to"
    ...(page.databaseId || !edit ? [] : ([{ label: t('shell.menu.moveTo'), icon: <FolderInput size={15} />, onSelect: () => useUI.getState().openModal({ type: 'move', pageId: id }) }] as MenuEntry[])),
    // team workspaces: straight into Private (only me) or out into the workspace (everyone)
    ...(page.databaseId || !edit || privateMode !== 'write'
      ? []
      : ([
          page.private
            ? { label: t('shell.private.makeShared', { workspace: wsName }), icon: <Users size={15} />, onSelect: () => void requestPrivacyMove(id, false) }
            : { label: t('shell.private.makePrivate'), icon: <Lock size={15} />, onSelect: () => void requestPrivacyMove(id, true) },
        ] as MenuEntry[])),
    { kind: 'separator' },
    {
      label: t('shell.menu.openInPane'),
      icon: <PanelRight size={15} />,
      hint: touch ? undefined : t('shell.menu.altClick', { alt: ALT }),
      onSelect: () => useUI.getState().openPane(id),
    },
    { label: t('shell.menu.openInPeek'), icon: <PanelRightOpen size={15} />, onSelect: () => useUI.getState().openPeek(id) },
    ...(edit
      ? ([
          { kind: 'separator' },
          {
            label: t('common.delete'),
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => {
              closeMobileSidebar()
              trashWithUndo(id)
            },
          },
        ] as MenuEntry[])
      : []),
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
      data-active-within={activeWithin || undefined}
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
          onDone={(v, viaKeyboard) => {
            setRenaming(false)
            if (v !== null) useWorkspace.getState().updatePage(id, { title: v })
            // Enter / Esc hand focus back to the row, so arrow keys and Tab carry on from here
            if (viaKeyboard) requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>('.sb-row__link')?.focus())
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
          onDoubleClick={() => edit && setRenaming(true)}
          onKeyDown={(e) => {
            if (e.key === 'F2' && edit) {
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
          {isDb && (
            <span className="sb-row__db" title={t('shell.sidebar.database')}>
              DB
            </span>
          )}
          {page.private && section !== 'private' && (
            <span className="sb-row__lock" title={t('shell.private.lock')} aria-label={t('shell.private.lock')} role="img">
              <Lock size={11} strokeWidth={2} />
            </span>
          )}
          {peer && <span className="sb-row__peer" style={{ '--peer': peer } as CSSProperties} title={t('shell.cloud.presence.viewing', { names: peerNamesOn(id) })} data-testid="tree-peer" />}
        </a>
      )}
      {!renaming && (
        <span className="sb-row__actions">
          <button type="button" className="sb-row__btn" aria-label={t('common.more')} onClick={toggleMenu(menu)}>
            <MoreHorizontal size={15} />
          </button>
          {!isDb && edit && (
            <button
              type="button"
              className="sb-row__btn"
              aria-label={t('shell.sidebar.addInside')}
              onClick={(e) => {
                e.stopPropagation()
                useTreeState.getState().expand([treeKey(section, id)])
                if (page.private) createPrivatePageAndOpen(id)
                else createPageAndOpen(id)
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

/**
 * Scroll the tree so the row is visible. Done by hand: scrollIntoView() also moves the
 * browser's sequential-focus starting point, which would make the next Tab skip the
 * skip link and land in the sidebar.
 */
function revealInScroller(row: HTMLElement) {
  const box = row.closest('.sb-scroll') as HTMLElement | null
  if (!box) return
  const r = row.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 8
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null, viaKeyboard: boolean) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef(v)
  latest.current = v
  const finish = (val: string | null, viaKeyboard = false) => {
    if (done.current) return
    done.current = true
    onDone(val, viaKeyboard)
  }
  // Blur ends a rename — but an input that never got focus (or lost it without a blur) would
  // stay open forever. Navigating elsewhere ends it too, unless the user is typing in it.
  const route = useRoute()
  const routeKey = route.name === 'page' ? `page:${route.id}` : route.name
  const startRoute = useRef(routeKey)
  useEffect(() => {
    if (routeKey !== startRoute.current && document.activeElement !== ref.current) finish(latest.current)
  }, [routeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      ref={ref}
      className="sb-row__rename"
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v, true)
        if (e.key === 'Escape') finish(null, true)
      }}
      onBlur={() => finish(v)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
