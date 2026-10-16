import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ClipboardCopy, Copy, FolderInput, Link2, Lock, MoreHorizontal, PanelRight, PencilLine, Plus, Star, StarOff, Trash2, PanelRightOpen, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { usePage } from '../../store/selectors'
import { useRoute } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { t, useLang, useT } from '../../i18n'
import type { ID } from '../../store/types'
import { ENTRY_LIMIT, PEEK_OVER, childIds, moreKey, treeKey, useChildIds, useEntryCount, useEntryIds, useTreeState } from '../lib/tree'
import { closeMobileSidebar, copyPageForAI, copyPageLink, createPageAndOpen, duplicateAndOpen, goToPage, trashWithUndo } from '../lib/actions'
import { moveFavorite, placeFavorite, shownFavorites, toggleStar, useFavFold, useFavOrder } from '../lib/favorites'
import { liveRect, visibleWithin } from './collision'
import { canLeaveFor, createEntryAndOpen, dropOptions, nodeKind, requestLeaveDatabase, requestMakeEntry } from './entries'
import { AIRunLed, DbCommandKey, DbCommandsMenu, OutboxTreeCount, type CommandHost } from '../../features'
import { useIsTouch } from '../lib/hooks'
import { ALT } from '../../ui/controls'
import { titleIfClipped } from '../../ui/clip'
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

/**
 * Drop targets that are not rows: the team section heads ("drop on PRIVATE" = to the end of that section's top level),
 * FAVORITES (its head and box — `fav` — and its empty slot — `favEnd`: the page becomes a favourite at the end).
 */
export const SECTION_DROP = { pages: 'section:pages', private: 'section:private', fav: 'section:fav', favEnd: 'section:fav-end' } as const
const sectionOf = (dropId: string): boolean | null => (dropId === SECTION_DROP.private ? true : dropId === SECTION_DROP.pages ? false : null)
const favZone = (dropId: string) => dropId === SECTION_DROP.fav || dropId === SECTION_DROP.favEnd

/** A favourite's own drag / drop id (the page is a tree row too): `fav:<id>`. */
const FAV = 'fav:'
/**
 * A row's id in the drag & drop context: the page id in the tree (pages / private); copies elsewhere carry their section
 * (`fav:<id>` / `recent:<id>` / `frequent:<id>`, deeper rows of a copy `<section>~<depth>:<id>`), so one page shown twice
 * never takes the other's place.
 */
const dndIdOf = (section: string, id: ID, depth: number) => (section === 'pages' || section === 'private' ? id : depth === 0 ? `${section}:${id}` : `${section}~${depth}:${id}`)
const pageOfDnd = (dndId: string) => {
  const i = dndId.indexOf(':')
  return dndId.startsWith('section:') || i < 0 ? dndId : dndId.slice(i + 1)
}
const inTree = (section: string) => section === 'pages' || section === 'private'

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
/* Drag & drop context: FAVORITES + the scroll area (Sidebar.tsx)       */
/* ------------------------------------------------------------------ */

/** Where the pointer is now (the drag's start point plus how far it went). */
function pointerY(e: DragMoveEvent | DragOverEvent): number {
  const ae = e.activatorEvent as MouseEvent | TouchEvent
  return ('touches' in ae ? (ae.touches[0]?.clientY ?? 0) : ae.clientY) + e.delta.y
}

/** The pointer's last height during a drag: over the fixed block (FAVORITES) the tree below never scrolls by itself. */
let dragY = Number.POSITIVE_INFINITY
const autoScroll = { canScroll: (el: Element) => !(el.classList.contains('sb-scroll') && dragY < el.getBoundingClientRect().top) }

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
    dragY = Number.POSITIVE_INFINITY
    setActiveId(String(e.active.id))
    document.body.dataset.dragging = 'tree'
  }

  const onMove = (e: DragMoveEvent | DragOverEvent) => {
    dragY = pointerY(e)
    const over = e.over
    if (!over) return setDrop(null)
    const overId = String(over.id)
    const raw = String(e.active.id)
    const dragId = pageOfDnd(raw)
    const pages = useWorkspace.getState().pages
    const rect = liveRect(e.collisions) ?? over.rect
    // FAVORITES: its head, box and empty slot = at the end; a favourite's row = before / after it (never inside)
    if (favZone(overId)) return setDrop((d) => (d?.overId === overId ? d : { overId, pos: 'inside' }))
    if (overId.startsWith(FAV)) {
      if (pageOfDnd(overId) === dragId) return setDrop(null)
      const half: DropPos = (pointerY(e) - rect.top) / rect.height < 0.5 ? 'before' : 'after'
      return setDrop((d) => (d?.overId === overId && d.pos === half ? d : { overId, pos: half }))
    }
    // a favourite only reorders among the favourites: its page never moves in the tree
    if (raw.startsWith(FAV)) return setDrop(null)
    const section = sectionOf(overId)
    if (section !== null) {
      // an entry dropped on a section head leaves its database for that section's top level
      if (pages[dragId]?.databaseId && !canLeaveFor(pages, dragId, null, section)) return setDrop(null)
      return setDrop((d) => (d?.overId === overId ? d : { overId, pos: 'inside' }))
    }
    const rel = (pointerY(e) - rect.top) / rect.height
    const target = pages[overId]
    if (!target || overId === dragId) return setDrop(null)
    const { inside, beside } = dropOptions(pages, dragId, overId)
    const kind = nodeKind(target)
    let pos: DropPos | null
    // entries never reorder in the tree (their order is the database's): only "inside" an entry
    if (kind === 'entry') pos = inside ? 'inside' : null
    else {
      pos = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : inside ? 'inside' : rel < 0.5 ? 'before' : 'after'
      // before/after need a valid parent too
      if (pos !== 'inside' && !beside) pos = inside ? 'inside' : null
      // right below an open database come its entries: "after" it means into it
      if (pos === 'after' && kind === 'database' && useTreeState.getState().expanded[treeKey(sectionFor(overId), overId)]) pos = inside ? 'inside' : null
    }
    if (!pos) return setDrop(null)
    const p: DropPos = pos
    setDrop((d) => (d?.overId === overId && d.pos === p ? d : { overId, pos: p }))
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
    const raw = activeId
    const d = drop
    reset()
    if (!raw || !d) return
    const dragId = pageOfDnd(raw)
    // into FAVORITES: a favourite where it was dropped (this device's order) — the page stays where it is in the tree;
    // an entry stays in its database
    if (favZone(d.overId)) return placeFavorite(dragId, null)
    if (d.overId.startsWith(FAV)) {
      const target = pageOfDnd(d.overId)
      if (d.pos === 'before') return placeFavorite(dragId, target)
      const rest = shownFavorites().filter((x) => x !== dragId)
      return placeFavorite(dragId, rest[rest.indexOf(target) + 1] ?? null)
    }
    if (raw.startsWith(FAV)) return
    const s = useWorkspace.getState()
    const dragged = s.pages[dragId]
    if (!dragged) return
    const entry = !!dragged.databaseId
    /**
     * Same section: a plain move. Between Private and the workspace: the pages change documents.
     * An entry leaves its database (asks first: it loses its properties).
     */
    const place = (parentId: ID | null, index: number | undefined, priv: boolean) => {
      if (entry) requestLeaveDatabase(dragId, parentId, index)
      else if (!!dragged.private === priv) s.movePage(dragId, parentId, index)
      else void requestPrivacyMove(dragId, priv, { parentId, index })
    }
    const section = sectionOf(d.overId)
    if (section !== null) return place(null, undefined, section)
    const target = s.pages[d.overId]
    if (!target) return
    // a page dropped on a database becomes one of its entries
    if (nodeKind(target) === 'database' && d.pos === 'inside') return requestMakeEntry(dragId, target.id)
    const key = treeKey(target.private ? 'private' : 'pages', target.id)
    const expanded = useTreeState.getState().expanded[key]
    const hasKids = childIds(s.pages, target.id).filter((c) => c !== dragId).length > 0
    if (d.pos === 'inside' || (d.pos === 'after' && expanded && hasKids && dropOptions(s.pages, dragId, target.id).inside)) {
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
      collisionDetection={visibleWithin}
      autoScroll={autoScroll}
      onDragStart={onStart}
      onDragMove={onMove}
      // `over` settles a render after the move that reached a new row: look again then
      onDragOver={onMove}
      onDragEnd={onEnd}
      onDragCancel={() => {
        delete document.body.dataset.dragging
        reset()
      }}
    >
      <DropContext.Provider value={{ activeId, drop }}>{children}</DropContext.Provider>
      <DragOverlay dropAnimation={null} modifiers={[besideCursor]}>{activeId ? <DragChip id={pageOfDnd(activeId)} /> : null}</DragOverlay>
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

/** The row being dragged (its drag id: `fav:<id>` for a favourite), else null. */
export function useDragActive(): string | null {
  return useContext(DropContext).activeId
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

/** Explicit list of ids (favorites, recent, frequent) rendered as tree roots; `draggable`: the roots reorder (favorites). */
export function PageList({ ids, section, draggable = false }: { ids: ID[]; section: string; draggable?: boolean }) {
  return (
    <>
      {ids.map((id) => (
        <TreeNode key={id} id={id} depth={0} section={section} draggable={draggable} />
      ))}
    </>
  )
}

/**
 * One tree node: a page, a database or an entry (a database row). Open, a database lists its entries
 * (ordered like its first view, see lib/tree) and an entry its sub-items (sub-items on) — then, for
 * all three, the pages inside.
 */
const TreeNode = memo(function TreeNode({ id, depth, section, draggable }: { id: ID; depth: number; section: string; draggable: boolean }) {
  const t = useT()
  const key = treeKey(section, id)
  const expanded = useTreeState((s) => !!s.expanded[key])
  const kids = useChildIds(id)
  const kind = useWorkspace((s) => (s.pages[id] ? nodeKind(s.pages[id]) : 'page'))
  const dbId = useWorkspace((s) => s.pages[id]?.databaseId ?? null)
  // entries are counted (and ordered) only while the database is open
  const rows = useEntryCount(expanded && kind === 'database' ? id : null, null)
  const subs = useEntryCount(expanded && kind === 'entry' ? dbId : null, id)
  const empty = kids.length === 0 && rows === 0 && subs === 0
  // inside a copy (a favourite's subtree, recent, frequent) nothing drags: only a favourite's own row reorders
  const inner = inTree(section) ? draggable : false
  return (
    <div className="sb-node">
      <TreeRow id={id} depth={depth} section={section} draggable={draggable} expanded={expanded} />
      {expanded && (
        <div className="sb-children" role="group" data-kind={kind} style={{ '--depth': depth } as CSSProperties}>
          {rows > 0 && <EntryList dbId={id} parentRow={null} depth={depth + 1} section={section} draggable={inner} />}
          {subs > 0 && dbId && <EntryList dbId={dbId} parentRow={id} depth={depth + 1} section={section} draggable={inner} />}
          {kids.length > 0 && <PageTree parentId={id} depth={depth + 1} section={section} draggable={inner} />}
          {empty && (
            <div className="sb-empty" style={{ paddingLeft: 10 + (depth + 1) * INDENT + 22 }}>
              {kind === 'database' ? t('shell.sidebar.noEntries') : t('shell.sidebar.noPagesInside')}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/**
 * A database's entries (parentRow null) or a row's sub-items. Up to PEEK_OVER show whole; a longer list peeks: its first
 * ENTRY_PEEK (in the list's order — a journal's newest days first), then "+N MORE", which unfolds it in place to the
 * first ENTRY_LIMIT and "SHOW ALL · N" (remembered per section and list: `more:` keys of the expanded state; Collapse
 * all folds it again). The open page's own entry always shows.
 */
function EntryList({ dbId, parentRow, depth, section, draggable }: { dbId: ID; parentRow: ID | null; depth: number; section: string; draggable: boolean }) {
  const route = useRoute()
  const more = moreKey(section, dbId, parentRow)
  const unfolded = useTreeState((s) => !!s.expanded[more])
  const ids = useEntryIds(dbId, parentRow, route.name === 'page' ? route.id : null, unfolded)
  const total = useEntryCount(dbId, parentRow)
  return (
    <>
      {ids.map((id) => (
        <TreeNode key={id} id={id} depth={depth} section={section} draggable={draggable} />
      ))}
      {unfolded && total > ENTRY_LIMIT && <ShowAllKey dbId={dbId} depth={depth} total={total} />}
      {total > PEEK_OVER && <PeekKey dbId={dbId} depth={depth} rest={total - ids.length} unfolded={unfolded} moreKey={more} />}
    </>
  )
}

/**
 * The end of a long entry list: "+N MORE" (a treeitem key, aria-expanded; Enter / → unfold it in place) — unfolded
 * (after today's "SHOW ALL · N" past ENTRY_LIMIT) "SHOW FEWER": Enter / ← fold it; the key stays where it was, the rows
 * above it go.
 */
function PeekKey({ dbId, depth, rest, unfolded, moreKey: key }: { dbId: ID; depth: number; rest: number; unfolded: boolean; moreKey: string }) {
  const t = useT()
  const lang = useLang()
  const db = useWorkspace((s) => s.pages[dbId]?.title.trim() || '') || t('common.untitled')
  const ref = useRef<HTMLButtonElement>(null)
  const anchor = useRef<{ top: number; box: HTMLElement } | null>(null)
  const n = Math.max(0, rest).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  // folding back: the rows above the key go — its scroller follows, so the key stays under the pointer / the focus
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    if (!a || !ref.current) return
    a.box.scrollTop += ref.current.getBoundingClientRect().top - a.top
    requestAnimationFrame(() => a.box.style.removeProperty('overflow-anchor'))
  }, [unfolded])
  const toggle = () => {
    const box = ref.current?.closest<HTMLElement>('.sb-scroll, .sb-favs__list')
    if (unfolded && ref.current && box) {
      // the browser's own scroll anchoring stays out of it: one adjustment, ours
      box.style.setProperty('overflow-anchor', 'none')
      anchor.current = { top: ref.current.getBoundingClientRect().top, box }
    }
    useTreeState.getState().toggle(key)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    if ((e.key === 'ArrowRight' && !unfolded) || (e.key === 'ArrowLeft' && unfolded)) {
      e.preventDefault()
      e.stopPropagation()
      toggle()
    }
  }
  return (
    <div className="sb-row sb-more" style={{ '--depth': depth } as CSSProperties}>
      <button
        ref={ref}
        type="button"
        className="sb-row__link sb-more__link sb-more__peek"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={unfolded}
        aria-label={unfolded ? t('shell.sidebar.entriesLessLabel', { db }) : t('shell.sidebar.entriesMoreLabel', { n, db })}
        data-tree-key={key}
        data-testid="tree-peek"
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="sb-more__label">
          {unfolded ? t('shell.sidebar.entriesLess') : t('shell.sidebar.entriesMore', { n })}
          <ChevronDown size={12} strokeWidth={2} className="sb-more__chev" aria-hidden />
        </span>
      </button>
    </div>
  )
}

/** "SHOW ALL · 143": the rest of a long database lives in the database itself — this opens it. */
function ShowAllKey({ dbId, depth, total }: { dbId: ID; depth: number; total: number }) {
  const t = useT()
  const lang = useLang()
  const db = useWorkspace((s) => s.pages[dbId]?.title.trim() || '')
  const n = total.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  return (
    <div className="sb-row sb-more" style={{ '--depth': depth } as CSSProperties}>
      <a
        className="sb-row__link sb-more__link"
        href={`#/p/${dbId}`}
        draggable={false}
        data-no-pane=""
        role="treeitem"
        aria-level={depth + 1}
        aria-label={t('shell.sidebar.showAllLabel', { n, db: db || t('common.untitled') })}
        data-testid="tree-show-all"
        onMouseEnter={(e) => titleIfClipped(e, '.sb-more__text')}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          goToPage(dbId)
        }}
      >
        <span className="sb-more__label">
          <span className="sb-more__text">{t('shell.sidebar.showAll', { n })}</span>
        </span>
      </a>
    </div>
  )
}

function TreeRow({ id, depth, section, draggable, expanded }: { id: ID; depth: number; section: string; draggable: boolean; expanded: boolean }) {
  const t = useT()
  const page = usePage(id)
  const route = useRoute()
  const active = route.name === 'page' && route.id === id
  // an entry of this (closed) database is open → mark the database
  const activeWithin = useWorkspace((s) => !expanded && route.name === 'page' && s.pages[route.id]?.databaseId === id)
  const { activeId, drop } = useContext(DropContext)
  const toggle = useTreeState((s) => s.toggle)
  const [renaming, setRenaming] = useState(false)
  const menu = useMenu()
  // the database's command key holds the row open (like its ⋯ menu)
  const [cmdOpen, setCmdOpen] = useState(false)
  const dndId = dndIdOf(section, id, depth)
  const drag = useDraggable({ id: dndId, disabled: !draggable || renaming })
  const dropZone = useDroppable({ id: dndId, disabled: !draggable })
  const rowRef = useRef<HTMLDivElement | null>(null)
  // a favourite's own row (the top of FAVORITES): it reorders (drag, Alt + ↑ / ↓, its menu) and says where it lives
  const favRoot = section === 'fav' && depth === 0
  // every other copy (a favourite's subtree, recent, frequent): the active fill, never the orange bar (sidebar.css)
  const copy = !inTree(section) && !favRoot
  const flash = useFavOrder((s) => favRoot && s.flash === id)
  // the open page is a favourite and FAVORITES shows it: its row there carries the orange bar, the tree's keeps the fill
  const favsOpen = useFavFold((s) => s.open)
  // where a favourite lives: its parent's title (not for a top-level page)
  const where = useWorkspace((s) => {
    if (!favRoot) return null
    const up = s.pages[id]?.parentId
    return up && s.pages[up] ? s.pages[up].title.trim() || t('common.untitled') : null
  })
  const touch = useIsTouch()
  // viewers: no renaming, duplicating, moving or deleting; others on this page show as a dot
  const readOnly = useReadOnly()
  const peer = usePeerOnPage(id)
  const privateMode = usePrivateMode()
  const wsName = useWorkspace((s) => s.settings.workspaceName.trim() || 'One')

  // the open page comes into view: the tree's own copy (where FAVORITES does not show it), or a favourite in its list
  useEffect(() => {
    if (!active || !rowRef.current) return
    if (inTree(section)) revealInScroller(rowRef.current, id)
    else if (favRoot) revealInList(rowRef.current)
  }, [active, section, favRoot, id])

  if (!page) return null
  const kind = nodeKind(page)
  const isDb = kind === 'database'
  const title = page.title.trim() || t('common.untitled')
  const dropPos = drop?.overId === dndId ? drop.pos : undefined
  const isDragging = activeId === dndId

  const edit = !readOnly
  const favShown = favRoot ? shownFavorites() : []
  const favAt = favShown.indexOf(id)
  const favCount = favShown.length
  const addInside = () => {
    useTreeState.getState().expand([treeKey(section, id)])
    if (isDb) createEntryAndOpen(id)
    else if (page.private) createPrivatePageAndOpen(id)
    else createPageAndOpen(id)
  }
  // a database's commands (New entry first, by default) open its menu: features/commands
  const cmdHost: CommandHost = {
    newEntry: (templateId) => {
      useTreeState.getState().expand([treeKey(section, id)])
      createEntryAndOpen(id, templateId)
    },
  }
  const editEntries: MenuEntry[] = edit
    ? [
        { label: t('common.rename'), icon: <PencilLine size={15} />, onSelect: () => setRenaming(true) },
        { label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicateAndOpen(id) },
      ]
    : []
  const starEntries: MenuEntry[] = [
    page.favorite
      ? { label: t('shell.menu.unfavorite'), icon: <StarOff size={15} />, onSelect: () => toggleStar(id) }
      : { label: t('shell.menu.favorite'), icon: <Star size={15} />, onSelect: () => toggleStar(id) },
    // a favourite's own row: one place up or down (the keys: Alt + ↑ / ↓ on the row)
    ...(favRoot
      ? ([
          { label: t('shell.fav.moveUp'), icon: <ArrowUp size={15} />, hint: touch ? undefined : 'Alt+↑', disabled: favAt <= 0, onSelect: () => moveAndSay(id, -1) },
          { label: t('shell.fav.moveDown'), icon: <ArrowDown size={15} />, hint: touch ? undefined : 'Alt+↓', disabled: favAt < 0 || favAt >= favCount - 1, onSelect: () => moveAndSay(id, 1) },
        ] as MenuEntry[])
      : []),
  ]
  const entries: MenuEntry[] = [
    // touch: the row carries only its ⋯ key — the menu starts with what its "+" and ☆ do (a database's starts with its
    // commands: New entry first)
    ...(touch
      ? [...(edit && !isDb ? ([{ label: t('shell.sidebar.addInside'), icon: <Plus size={15} />, onSelect: addInside }] as MenuEntry[]) : []), ...starEntries, ...editEntries]
      : [...editEntries, ...starEntries]),
    { label: t('common.copyLink'), icon: <Link2 size={15} />, onSelect: () => void copyPageLink(id) },
    { label: t('shell.ai.copy'), icon: <ClipboardCopy size={15} />, onSelect: () => void copyPageForAI(id) },
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
      data-kind={kind}
      data-section={section}
      data-page={id}
      data-copy={copy || undefined}
      data-bar-in-favs={(active && inTree(section) && favsOpen && page.favorite) || undefined}
      data-flash={flash || undefined}
      data-active={active || undefined}
      data-active-within={activeWithin || undefined}
      data-drop={dropPos}
      data-dragging={isDragging || undefined}
      data-menu-open={menu.open || cmdOpen || undefined}
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
            // the row's menu from the keyboard, anchored to the row
            if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
              e.preventDefault()
              if (rowRef.current) menu.openAt(rowRef.current)
            }
            if (favRoot && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault()
              e.stopPropagation()
              moveAndSay(id, e.key === 'ArrowUp' ? -1 : 1)
            }
          }}
          aria-current={active ? 'page' : undefined}
          aria-describedby={favRoot ? [where ? `sb-where-${id}` : '', FAV_KEYS_HINT].filter(Boolean).join(' ') : undefined}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={expanded}
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
          <AIRunLed pageId={id} />
          {isDb && <OutboxTreeCount dbId={id} />}
          {/* where a favourite lives (hidden while the row shows its keys); read as the link's description */}
          {where && (
            <span className="sb-row__where" id={`sb-where-${id}`} aria-hidden>
              {where}
            </span>
          )}
        </a>
      )}
      {!renaming && (
        <span className="sb-row__actions">
          {/* the star on every row (pointer only: touch has it in ⋯); one name, its state is aria-pressed, the tooltip
              says what a click does; no Tab stop (the keyboard has the row's menu, the page menu, ⌘K) */}
          <button
            type="button"
            className="sb-row__btn sb-row__star"
            tabIndex={-1}
            aria-label={t('shell.fav.star')}
            aria-pressed={!!page.favorite}
            title={page.favorite ? t('shell.menu.unfavorite') : t('shell.menu.favorite')}
            data-on={page.favorite || undefined}
            onClick={(e) => {
              e.stopPropagation()
              toggleStar(id)
            }}
          >
            <Star size={14} strokeWidth={1.75} fill={page.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="sb-row__btn" aria-label={t('common.more')} onClick={toggleMenu(menu)}>
            <MoreHorizontal size={15} />
          </button>
          {isDb && <DbCommandKey dbId={id} variant="sidebar" host={cmdHost} onOpenChange={setCmdOpen} />}
          {/* touch: no "+" (titles keep their room) — the ⋯ menu starts with it */}
          {edit && !touch && (
            <button
              type="button"
              className="sb-row__btn"
              aria-label={isDb ? t('shell.sidebar.newEntry') : t('shell.sidebar.addInside')}
              onClick={(e) => {
                e.stopPropagation()
                addInside()
              }}
            >
              <Plus size={15} />
            </button>
          )}
        </span>
      )}
      {isDb && menu.open ? <DbCommandsMenu {...menu.props} dbId={id} entries={entries} width={260} host={cmdHost} exclude={['copy-link']} /> : <Menu {...menu.props} entries={entries} width={240} />}
    </div>
  )
}

/** The id of the hidden "Alt + ↑ / ↓ moves it" line every favourite's row is described by (Favorites.tsx). */
export const FAV_KEYS_HINT = 'sb-fav-keys'
/** The polite live region that says a favourite's new place (Favorites.tsx). */
export const FAV_LIVE = 'sb-fav-live'

/** One place up / down; the key stays on the favourite and its new place is said ("Favorite 2 of 3"). */
function moveAndSay(id: ID, delta: -1 | 1) {
  const moved = moveFavorite(id, delta)
  if (!moved) return
  const focused = document.activeElement?.closest?.('.sb-favs') != null
  requestAnimationFrame(() => {
    if (focused) document.querySelector<HTMLElement>(`.sb-favs .sb-row__link[data-tree-key="${CSS.escape(`fav:${id}`)}"]`)?.focus({ preventScroll: false })
    const live = document.getElementById(FAV_LIVE)
    if (live) live.textContent = t('shell.fav.pos', { n: moved.at + 1, m: moved.of })
  })
}

/**
 * The tree's own copy of the open page comes into view. Nothing moves when it shows already — whole, below the
 * section's stuck head — or when FAVORITES holds it (always in view). Else in whole rows: its top-level ancestor becomes
 * the first row under the stuck head when the open row then still fits, else its parent, else the row itself. By hand:
 * scrollIntoView() also moves the browser's sequential-focus starting point (the next Tab would skip the skip link).
 */
function revealInScroller(row: HTMLElement, id: ID) {
  const box = row.closest<HTMLElement>('.sb-scroll')
  if (!box) return
  if (document.querySelector(`.sb-favs .sb-row[data-page="${CSS.escape(id)}"]:not([data-copy])`)) return
  const b = box.getBoundingClientRect()
  if (!b.height) return
  const head = row.closest('.sb-section')?.querySelector<HTMLElement>(':scope > .sb-sect')
  const top = b.top + (head?.offsetHeight ?? 0)
  const r = row.getBoundingClientRect()
  if (r.top >= top - 1 && r.bottom <= b.bottom + 1) return
  // the rows above it on its line: its parent's first, the top-level one's last
  const ups: HTMLElement[] = []
  for (let n = row.parentElement?.parentElement?.closest<HTMLElement>('.sb-node'); n && box.contains(n); n = n.parentElement?.closest<HTMLElement>('.sb-node')) {
    const up = n.querySelector<HTMLElement>(':scope > .sb-row')
    if (up) ups.push(up)
  }
  for (const target of [ups[ups.length - 1], ups[0], row]) {
    if (!target) continue
    const delta = target.getBoundingClientRect().top - top
    if (target === row || r.bottom - delta <= b.bottom + 1) {
      box.scrollTop += delta
      return
    }
  }
}

/** A favourite that is open: its row in view inside FAVORITES' own list (past the cap it scrolls). */
function revealInList(row: HTMLElement) {
  const list = row.closest<HTMLElement>('.sb-favs__list')
  if (!list) return
  const l = list.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  if (r.top < l.top) list.scrollTop -= l.top - r.top
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom
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
