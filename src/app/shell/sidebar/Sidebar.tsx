import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ArrowRight, Bell, Building2, CalendarDays, ChevronsDownUp, ChevronsLeft, ChevronDown, Compass, Home, LayoutTemplate, Lock, PenLine, Plus, Search, Settings, Table2, FilePlus2, Users, SquareKanban, Send, Rewind, CircleGauge } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useTrash, useTreeCount } from '../../store/selectors'
import { navigate, useRoute } from '../../lib/router'
import { openTodayJournal, OutboxNavBadge, useOutboxVisible, openRecorder, REWIND_SHORTCUT, openRegler } from '../../features'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { Tooltip } from '../../ui/Tooltip'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import { DraggableTree, PageTree, SECTION_DROP, useRootIds, useSectionDrop } from './PageTree'
import { FavoritesSection } from './Favorites'
import { ToolStrip } from './Tools'
import { NavRow } from './NavRow'
import { TrashPopover } from './TrashPopover'
import { useVisited, VisitedSection } from './Visited'
import { createPrivateDatabaseAndOpen, createPrivatePageAndOpen } from './private'
import { foldedBut, treeAncestors, treeKey, useTreeState } from '../lib/tree'
import { usePrivateMode } from '../../cloud'
import { closeMobileSidebar, createDatabaseAndOpen, createFreeBoardAndOpen, createPageAndOpen, goHome, toggleSidebar } from '../lib/actions'
import { useIsMobile, useKbdHint } from '../lib/hooks'
import { HeaderSub, useWorkspaceEntries } from '../cloud/Switcher'
import { useInCloud, useReadOnly, useWorkspaceTitle } from '../cloud/state'
import { openWorkspaceSettings } from '../workspace/open'
import { useRenameMode } from '../lib/workspaceName'
import { WorkspaceRename } from './WorkspaceRename'
import { useInboxUnread } from '../inbox/model'
import { INBOX_KEYS, useInboxShortcut } from '../inbox/keys'
import { useInstallMenuEntries } from '../capture/Install.tsx'
import './sidebar.css'
import { openHelp, HelpNewsLed, useChangelogUnseen } from '../../help'
import { startTour } from '../tour/state'

const MIN_W = 220
const MAX_W = 480

export function Sidebar() {
  const t = useT()
  const mobile = useIsMobile()
  const width = useWorkspace((s) => s.settings.sidebarWidth)
  const collapsed = useWorkspace((s) => s.settings.sidebarCollapsed)
  const mobileOpen = useUI((s) => s.mobileSidebarOpen)
  const focus = useUI((s) => s.focusMode)
  const [dragW, setDragW] = useState<number | null>(null)
  const [hoverReveal, setHoverReveal] = useState(false)
  const route = useRoute()
  const kbd = useKbdHint()
  // viewers read: no creating, importing or journal entries (they would be new pages)
  const readOnly = useReadOnly()

  // keep the active page visible in the tree
  const activeId = route.name === 'page' ? route.id : null
  useEffect(() => {
    if (!activeId) return
    // an entry opens its database (and a sub-item its parent entry) like any page its parent
    const chain = treeAncestors(useWorkspace.getState(), activeId)
    if (chain.length) useTreeState.getState().expand(chain.map((p) => treeKey(p.private ? 'private' : 'pages', p.id)))
  }, [activeId])

  const visited = useVisited()
  const no = useSectionNumbers(visited.shown)
  const scrollRef = useRef<HTMLDivElement>(null)
  useWholeRows(scrollRef)

  const w = Math.min(MAX_W, Math.max(MIN_W, dragW ?? width))
  const state = mobile ? (mobileOpen ? 'drawer-open' : 'drawer') : focus ? 'hidden' : collapsed ? (hoverReveal ? 'reveal' : 'collapsed') : 'docked'

  // toasts centre on the working area, clear of the sidebar (and its trash popover)
  const docked = state === 'docked' ? w : 0
  useEffect(() => {
    document.documentElement.style.setProperty('--sb-docked', `${docked}px`)
    return () => {
      document.documentElement.style.removeProperty('--sb-docked')
    }
  }, [docked])

  return (
    <>
      {mobile && <div className="sb-scrim" data-open={mobileOpen || undefined} onClick={closeMobileSidebar} aria-hidden />}
      {!mobile && collapsed && !focus && <div className="sb-hotzone" onMouseEnter={() => setHoverReveal(true)} aria-hidden />}
      <aside
        className="sb"
        data-state={state}
        style={{ '--sb-w': `${mobile ? 300 : w}px` } as CSSProperties}
        onMouseLeave={() => hoverReveal && setHoverReveal(false)}
        aria-label={t('shell.sidebar.label')}
        aria-hidden={state === 'collapsed' || state === 'hidden' || state === 'drawer' ? true : undefined}
        inert={state === 'collapsed' || state === 'hidden' || state === 'drawer' ? true : undefined}
      >
        <SidebarHeader />
        {/* the fixed block: the places of every day, the tools as one strip of keys, FAVORITES — a hairline below it */}
        <nav className="sb-nav" aria-label={t('shell.nav.label')}>
          <NavRow icon={<Search size={16} />} label={t('shell.nav.search')} kbd={kbd('Mod+K')} onClick={() => (closeMobileSidebar(), useUI.getState().openPalette())} />
          <NavRow icon={<Home size={16} />} label={t('shell.nav.home')} active={route.name === 'home'} onClick={goHome} />
          <InboxNavRow active={route.name === 'inbox'} />
          <OutboxNavRow active={route.name === 'outbox'} />
          {!readOnly && (
            <NavRow
              icon={<CalendarDays size={16} />}
              label={t('shell.nav.today')}
              active={route.name === 'journal'}
              onClick={() => {
                closeMobileSidebar()
                openTodayJournal()
              }}
            />
          )}
          <ToolStrip />
        </nav>
        {/* one drag & drop context: a page into FAVORITES, favourites among themselves, pages between the workspace's
            and my private ones */}
        <DraggableTree>
          <FavoritesSection n={no.fav} onKeyDown={onTreeKeyDown} />
          <div className="sb-scroll" ref={scrollRef} onKeyDown={onTreeKeyDown} onScroll={onScrollArea}>
            {visited.shown && <VisitedSection n={no.visited} recent={visited.recent} frequent={visited.frequent} />}
            <PagesSection n={no.pages} />
            <PrivateSection n={no.priv} />
            <div className="sb-scroll__end" aria-hidden />
          </div>
        </DraggableTree>
        <SidebarFooter n={no.trash} lift={state === 'drawer-open'} />
        {!mobile && (
          <ResizeHandle
            width={w}
            onDrag={setDragW}
            onCommit={(v) => {
              setDragW(null)
              useWorkspace.getState().updateSettings({ sidebarWidth: v })
            }}
          />
        )}
      </aside>
    </>
  )
}

/**
 * The scroll area under the fixed block: the section head that sticks at its top gets a hairline below it (data-stuck)
 * — no fade, no half row (rows snap whole, sidebar.css). ≤ 4 heads per frame.
 */
let scrollFrame = 0
function onScrollArea(e: React.UIEvent<HTMLDivElement>) {
  const box = e.currentTarget
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    const top = box.getBoundingClientRect().top
    for (const head of box.querySelectorAll<HTMLElement>(':scope > .sb-section > .sb-sect')) {
      const section = head.parentElement!.getBoundingClientRect()
      const h = head.getBoundingClientRect()
      head.toggleAttribute('data-stuck', section.top < top - 0.5 && h.top <= top + 0.5 && section.bottom > h.bottom + 1)
    }
  })
}

/** What the scroll area is made of, line by line: a resting position must never cut one of them under a stuck head. */
const LINES = '.sb-row, .sb-newpage, .sb-newprivate, .sb-empty, .sb-hint'

/**
 * Whole rows in the scroll area (brief §3.2), wherever it rests:
 * - each section publishes its head's height as `--sb-head-h` — its rows snap (and come into view on focus) right under
 *   it (sidebar.css `scroll-margin-top`), whatever the head measures: 28 px, 36 on a coarse pointer, more at big text;
 * - the end of the range lands on a line's top: `.sb-scroll__end` takes the room that is missing (0 … one row), so the
 *   last screenful (the reveal of a page down there, a scroll to the end) never rests with half a row under the head.
 * Measured when the area, a section or a head changes size — never while scrolling.
 */
function useWholeRows(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const ro = new ResizeObserver(() => fitWholeRows(box))
    const watch = () => {
      ro.disconnect()
      ro.observe(box, { box: 'border-box' })
      for (const s of box.querySelectorAll<HTMLElement>(':scope > .sb-section')) {
        ro.observe(s)
        const head = s.querySelector(':scope > .sb-sect')
        if (head) ro.observe(head)
      }
    }
    watch()
    fitWholeRows(box)
    // a section comes or goes (RECENT | FREQUENT, PRIVATE)
    const mo = new MutationObserver(watch)
    mo.observe(box, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref])
}

function fitWholeRows(box: HTMLElement) {
  const sections = [...box.querySelectorAll<HTMLElement>(':scope > .sb-section')]
  for (const s of sections) {
    const h = s.querySelector<HTMLElement>(':scope > .sb-sect')?.offsetHeight
    const v = h ? `${h}px` : ''
    if (s.style.getPropertyValue('--sb-head-h') !== v) s.style.setProperty('--sb-head-h', v)
  }
  const end = box.querySelector<HTMLElement>(':scope > .sb-scroll__end')
  if (!end) return
  const was = end.getBoundingClientRect().height
  // the furthest the area scrolls without the end's room
  const max = box.scrollHeight - box.clientHeight - was
  let room = 0
  if (max > 0.5 && box.clientHeight > 0) {
    const b = box.getBoundingClientRect()
    const at = (y: number) => y - b.top + box.scrollTop
    // what covers the top there: the head of the section the end's view starts in (it sticks), else nothing
    let cover = 0
    for (const s of sections) {
      const r = s.getBoundingClientRect()
      if (at(r.top) <= max + 0.5 && at(r.bottom) > max) cover = s.querySelector<HTMLElement>(':scope > .sb-sect')?.offsetHeight ?? 0
    }
    const line = max + cover
    // the last line starting above it (lines are in the area's order, top to bottom)
    const lines = box.querySelectorAll<HTMLElement>(LINES)
    let lo = 0
    let hi = lines.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (at(lines[mid].getBoundingClientRect().top) < line - 0.5) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (found >= 0) {
      const r = lines[found].getBoundingClientRect()
      const bottom = at(r.top) + r.height
      // it straddles the head's foot: room for its next line's top to come up there
      if (bottom > line + 0.5) room = Math.round((bottom - line) * 100) / 100
    }
  }
  if (Math.abs(room - was) > 0.25) end.style.height = room ? `${room}px` : ''
}

/**
 * Arrow-key navigation across all visible rows — FAVORITES and the scroll area as ONE run (WAI-ARIA tree pattern):
 * the handler sits on both and walks the sidebar's `.sb-row__link`s in DOM order.
 */
function onTreeKeyDown(e: KeyboardEvent<HTMLElement>) {
  const link = (e.target as HTMLElement).closest?.('.sb-row__link') as HTMLElement | null
  if (!link || e.altKey || e.metaKey || e.ctrlKey) return
  const root = e.currentTarget.closest('.sb') ?? e.currentTarget
  const all = [...root.querySelectorAll<HTMLElement>('.sb-favs .sb-row__link, .sb-scroll .sb-row__link')]
  const i = all.indexOf(link)
  const key = link.dataset.treeKey ?? ''
  const exp = link.getAttribute('aria-expanded')
  const tree = useTreeState.getState()
  const parentLink = () => link.closest('.sb-children')?.parentElement?.querySelector<HTMLElement>(':scope > .sb-row .sb-row__link')
  let handled = true
  if (e.key === 'ArrowDown') all[i + 1]?.focus()
  else if (e.key === 'ArrowUp') all[i - 1]?.focus()
  else if (e.key === 'Home') all[0]?.focus()
  else if (e.key === 'End') all[all.length - 1]?.focus()
  else if (e.key === 'ArrowRight') {
    if (exp === 'false') tree.toggle(key)
    else if (exp === 'true') all[i + 1]?.focus()
  } else if (e.key === 'ArrowLeft') {
    if (exp === 'true') tree.collapse(key)
    else parentLink()?.focus()
  } else handled = false
  if (handled) e.preventDefault()
}

function SidebarHeader() {
  const t = useT()
  const name = useWorkspaceTitle()
  const inCloud = useInCloud()
  const workspaces = useWorkspaceEntries()
  const theme = useWorkspace((s) => s.settings.theme)
  const lang = useWorkspace((s) => s.settings.language)
  const menu = useMenu()
  const mobile = useIsMobile()
  const kbd = useKbdHint()
  const newsUnseen = useChangelogUnseen()
  const installEntries = useInstallMenuEntries()
  const readOnly = useReadOnly()
  const set = useWorkspace.getState().updateSettings
  // the name: renamed in place (local workspace; team workspaces: admins), read-only for everyone else
  const renameMode = useRenameMode()
  const [renaming, setRenaming] = useState(false)
  const headRef = useRef<HTMLButtonElement>(null)
  // the right to rename went away (another role, signed out): the field goes too
  useEffect(() => {
    if (!renameMode) setRenaming(false)
  }, [renameMode])
  const startRename = () => {
    if (!renameMode) return
    // a double click opened (or toggled) the menu on its way: it must not take the focus back
    menu.close()
    setRenaming(true)
  }
  const endRename = () => {
    setRenaming(false)
    requestAnimationFrame(() => headRef.current?.focus())
  }
  const entries: MenuEntry[] = [
    ...workspaces,
    { kind: 'separator' },
    {
      id: 'ws-rename',
      label: t('shell.wsname.rename'),
      icon: <PenLine size={15} />,
      hint: renameMode ? (mobile ? undefined : 'F2') : t('shell.wsname.adminsOnly').toUpperCase(),
      disabled: !renameMode,
      onSelect: startRename,
    },
    // the workspace's own settings (#/workspace: name, people, members, automation, data) · this device's
    { id: 'ws-settings', label: t('shell.ws.cmd.open'), icon: <Building2 size={15} />, keywords: 'workspace settings people members team overview arbeitsbereich einstellungen personen mitglieder', onSelect: () => openWorkspaceSettings() },
    ...(inCloud ? ([{ id: 'ws-people', label: t('shell.ws.cmd.members'), icon: <Users size={15} />, keywords: 'people members team invite personen mitglieder einladen', onSelect: () => openWorkspaceSettings('people') }] as MenuEntry[]) : []),
    { label: t('common.settings'), icon: <Settings size={15} />, hint: kbd('Mod+,'), onSelect: () => useUI.getState().openModal({ type: 'settings' }) },
    {
      label: t('shell.menu.theme'),
      submenu: [
        { label: t('shell.theme.light'), checked: theme === 'light', onSelect: () => set({ theme: 'light' }) },
        { label: t('shell.theme.dark'), checked: theme === 'dark', onSelect: () => set({ theme: 'dark' }) },
        { label: t('shell.theme.system'), checked: theme === 'system', onSelect: () => set({ theme: 'system' }) },
      ],
    },
    {
      label: t('shell.menu.language'),
      submenu: [
        { label: 'English', checked: lang === 'en', onSelect: () => set({ language: 'en' }) },
        { label: 'Deutsch', checked: lang === 'de', onSelect: () => set({ language: 'de' }) },
      ],
    },
    { label: t('shell.cmd.shortcuts'), hint: kbd('Mod+/'), onSelect: () => useUI.getState().openModal({ type: 'shortcuts' }) },
    // the flight recorder: every writer on one tape (this device)
    { id: 'ws-recorder', label: t('features.recorder.menu'), icon: <Rewind size={15} />, hint: kbd(REWIND_SHORTCUT), onSelect: () => (closeMobileSidebar(), openRecorder()) },
    // the Regler: on a phone there is no status bar (its cell opens it elsewhere) — the workspace menu does
    ...(mobile ? ([{ id: 'ws-regler', label: t('features.governor.cmd'), icon: <CircleGauge size={15} />, onSelect: () => openRegler() }] as MenuEntry[]) : []),
    { label: t('help.title'), hint: kbd('?'), onSelect: () => openHelp(), ...(newsUnseen ? { icon: <HelpNewsLed quiet /> } : {}) },
    ...installEntries,
    // getting started: "What can One do?" (#/discover) and the guided tour (shell/tour)
    { id: 'ws-discover', label: t('shell.discover.nav'), icon: <Compass size={15} />, onSelect: () => (closeMobileSidebar(), navigate('#/discover')) },
    ...(readOnly ? [] : ([{ id: 'ws-tour', label: t('shell.tour.cmd'), onSelect: () => (closeMobileSidebar(), startTour()) }] as MenuEntry[])),
    { kind: 'separator' },
    { label: t('shell.menu.website'), onSelect: () => window.open(BRAND.homeHref, '_self') },
    { label: 'GitHub', onSelect: () => window.open(BRAND.repoUrl, '_blank', 'noopener') },
  ]
  return (
    <div className="sb-head">
      {renaming && renameMode ? (
        <WorkspaceRename current={name} onDone={endRename} />
      ) : (
        <button
          ref={headRef}
          type="button"
          className="sb-head__ws"
          onClick={toggleMenu(menu)}
          onDoubleClick={startRename}
          onKeyDown={(e) => {
            if (e.key === 'F2' && renameMode) {
              e.preventDefault()
              startRename()
            }
          }}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          title={t('shell.cloud.switcher.label')}
        >
          <span className="sb-head__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(24) }} />
          <span className="sb-head__text">
            <span className="sb-head__name">{name}</span>
            <span className="sb-head__sub">
              <HeaderSub />
            </span>
          </span>
          <ChevronDown size={14} className="sb-head__chev" />
        </button>
      )}
      <Tooltip label={mobile ? t('common.close') : t('shell.sidebar.collapseSidebar')} shortcut={mobile ? undefined : shortcutLabel('Mod+\\')}>
        <button type="button" className="icon-btn sb-head__collapse" onClick={toggleSidebar}>
          <ChevronsLeft size={16} />
        </button>
      </Tooltip>
      <Menu {...menu.props} entries={entries} width={288} />
    </div>
  )
}

/** The Outbox (features/outbox): shown once a send route is active here or a slip exists; "5 OPEN" (red "UNCLEAR 1"). */
function OutboxNavRow({ active }: { active: boolean }) {
  const t = useT()
  const visible = useOutboxVisible()
  if (!visible) return null
  return <NavRow icon={<Send size={16} />} label={t('features.outbox.title')} active={active} badge={<OutboxNavBadge />} onClick={() => (closeMobileSidebar(), navigate({ name: 'outbox' }))} />
}

/** Inbox: unread count as an LED + mono read-out; "G I" jumps here. */
function InboxNavRow({ active }: { active: boolean }) {
  const t = useT()
  const unread = useInboxUnread()
  useInboxShortcut()
  const kbd = useKbdHint()
  return (
    <NavRow
      icon={<Bell size={16} />}
      label={t('shell.nav.inbox')}
      ariaLabel={unread ? t('shell.nav.inboxUnread', { n: unread }) : undefined}
      active={active}
      kbd={unread ? undefined : kbd(INBOX_KEYS)}
      badge={
        unread > 0 && (
          <span className="sb-navrow__badge" data-testid="inbox-unread">
            <span className="led led--on" aria-hidden />
            {unread > 99 ? '99+' : String(unread).padStart(2, '0')}
          </span>
        )
      }
      onClick={() => (closeMobileSidebar(), navigate({ name: 'inbox' }))}
    />
  )
}

function SectionHead({ n, label, count, icon, drop, children }: { n: string; label: string; count?: number; icon?: ReactNode; drop?: ReturnType<typeof useSectionDrop>; children?: ReactNode }) {
  return (
    <div className="sb-sect" ref={drop?.ref} data-drop={drop?.over || undefined}>
      <span className="sb-sect__n">{n}</span>
      {icon && <span className="sb-sect__icon">{icon}</span>}
      <span className="sb-sect__label">{label}</span>
      <span className="sb-sect__leader" aria-hidden />
      {count !== undefined && <span className="sb-sect__count">{String(count).padStart(2, '0')}</span>}
      {children}
    </div>
  )
}

/**
 * The sections' numbers, counting only those shown: FAVORITES (always: empty, it says how) · RECENT | FREQUENT? ·
 * PAGES · PRIVATE? · TRASH.
 */
function useSectionNumbers(visitedShown: boolean): { fav: number; visited: number; pages: number; priv: number; trash: number } {
  const mode = usePrivateMode()
  const privateShown = useTreeCount(true) > 0
  let n = 0
  const fav = ++n
  const visited = visitedShown ? ++n : 0
  const pages = ++n
  const priv = mode === 'write' || (mode === 'read' && privateShown) ? ++n : 0
  return { fav, visited, pages, priv, trash: ++n }
}

const sectionNo = (n: number) => String(n).padStart(2, '0')

function PagesSection({ n }: { n: number }) {
  const t = useT()
  // a team workspace splits the top level: the workspace's pages here, mine under PRIVATE
  const split = usePrivateMode() !== 'none'
  const roots = useRootIds(split ? false : null)
  const total = useTreeCount(split ? false : null)
  const menu = useMenu()
  const kbd = useKbdHint()
  const readOnly = useReadOnly()
  const drop = useSectionDrop(SECTION_DROP.pages, split && !readOnly)
  return (
    <section className="sb-section" aria-label={t('shell.sidebar.pages')}>
      <SectionHead n={sectionNo(n)} label={t('shell.sidebar.pages')} count={total} drop={drop}>
        <CollapseAllKey />
        {!readOnly && (
          <button type="button" className="sb-sect__add" aria-label={t('common.newPage')} onClick={toggleMenu(menu)}>
            <Plus size={14} />
          </button>
        )}
      </SectionHead>
      <Menu
        {...menu.props}
        width={220}
        entries={[
          { label: t('common.newPage'), icon: <FilePlus2 size={15} />, hint: kbd('Mod+Alt+N'), onSelect: () => createPageAndOpen(null) },
          { label: t('shell.cmd.newDatabase'), icon: <Table2 size={15} />, onSelect: () => createDatabaseAndOpen(null) },
          { label: t('shell.cmd.newFreeBoard'), icon: <SquareKanban size={15} />, onSelect: () => createFreeBoardAndOpen(null) },
          { label: t('shell.nav.templates'), icon: <LayoutTemplate size={15} />, onSelect: () => useUI.getState().openModal({ type: 'templates', parentId: null }) },
        ]}
      />
      <div role="tree">
        <PageTree parentId={null} depth={0} section="pages" draggable={!readOnly} roots={roots} />
      </div>
      {roots.length === 0 && !readOnly && <p className="sb-hint">{t('shell.sidebar.empty')}</p>}
      {!readOnly && (
        <button type="button" className="sb-newpage" onClick={() => createPageAndOpen(null)}>
          <Plus size={15} />
          <span>{t('common.newPage')}</span>
        </button>
      )}
    </section>
  )
}

/** The tree's own sections: what "Collapse all" folds. */
const TREE_SECTIONS = ['pages', 'private']

/**
 * "Collapse all" in the PAGES head: folds the tree (PAGES and PRIVATE) back to its top level — the open page's
 * ancestors and its own expansion stay. Always there (the head never shifts): aria-disabled while nothing would fold.
 */
function CollapseAllKey() {
  const t = useT()
  const route = useRoute()
  const openId = route.name === 'page' ? route.id : null
  const keep = useWorkspace(
    useShallow((s) => (openId && s.pages[openId] ? [...treeAncestors(s, openId), s.pages[openId]].map((p) => treeKey(p.private ? 'private' : 'pages', p.id)) : [])),
  )
  const can = useTreeState((s) => Object.keys(foldedBut(s.expanded, TREE_SECTIONS, keep)).length < Object.keys(s.expanded).length)
  return (
    <Tooltip label={t('shell.sidebar.collapseAll')}>
      <button
        type="button"
        className="sb-sect__add sb-sect__collapse"
        aria-label={t('shell.sidebar.collapseAll')}
        aria-disabled={!can || undefined}
        onClick={() => can && useTreeState.getState().collapseAll(TREE_SECTIONS, keep)}
      >
        <ChevronsDownUp size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * PRIVATE (team workspaces): pages only I can see — the server keeps them in my own documents.
 * Viewers see the section only when they have private pages from before (read-only).
 */
function PrivateSection({ n }: { n: number }) {
  const t = useT()
  const mode = usePrivateMode()
  const roots = useRootIds(true)
  const total = useTreeCount(true)
  const menu = useMenu()
  const write = mode === 'write'
  const drop = useSectionDrop(SECTION_DROP.private, write)
  if (mode === 'none' || (!write && roots.length === 0)) return null
  return (
    <section className="sb-section sb-section--private" aria-label={t('shell.private.title')} data-testid="private-section">
      <SectionHead n={sectionNo(n)} label={t('shell.private.title')} count={total} icon={<Lock size={11} strokeWidth={2} aria-label={t('shell.private.lock')} />} drop={drop}>
        {write && (
          <button type="button" className="sb-sect__add" aria-label={t('shell.private.add')} onClick={toggleMenu(menu)}>
            <Plus size={14} />
          </button>
        )}
      </SectionHead>
      <Menu
        {...menu.props}
        width={220}
        entries={[
          { label: t('common.newPage'), icon: <FilePlus2 size={15} />, onSelect: () => createPrivatePageAndOpen(null) },
          { label: t('shell.cmd.newDatabase'), icon: <Table2 size={15} />, onSelect: () => createPrivateDatabaseAndOpen() },
        ]}
      />
      <div role="tree">
        <PageTree parentId={null} depth={0} section="private" draggable={write} roots={roots} />
      </div>
      {roots.length === 0 && <p className="sb-hint sb-hint--private" data-drop={drop.over || undefined}>{drop.dragging ? t('shell.private.dropHere') : t('shell.private.hint')}</p>}
      {write && (
        <button type="button" className="sb-newprivate" onClick={() => createPrivatePageAndOpen(null)} data-testid="private-new-page">
          <Plus size={15} />
          <span>{t('common.newPage')}</span>
        </button>
      )}
    </section>
  )
}

/**
 * The foot, one row: "04 TRASH 03 ······ WHAT CAN ONE DO? →". Where both do not fit (a narrow sidebar, big text, a long
 * word) "What can One do?" sheds, measured: first its arrow (`data-shed="1"`), then its words for the compass
 * (`data-shed="2"`; its name and tooltip stay).
 *
 * `lift` (the phone drawer is open): its height above the screen's bottom goes on <html> as `--sb-foot`, so toasts (a
 * reminder) sit above it and never cover the trash — as the flight recorder's deck does with `--deck-dock`.
 */
function SidebarFooter({ n, lift }: { n: number; lift: boolean }) {
  const t = useT()
  const trash = useTrash()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const mobile = useIsMobile()
  const btn = useRef<HTMLButtonElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const discover = useRoute().name === 'discover'
  const label = t('shell.discover.nav')
  const trashLabel = t('shell.sidebar.trash')
  useLayoutEffect(() => {
    const el = foot.current
    if (!el) return
    const over = () => el.scrollWidth > el.clientWidth + 1
    const fit = () => {
      delete el.dataset.shed
      if (!over()) return
      el.dataset.shed = '1'
      if (over()) el.dataset.shed = '2'
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    if (btn.current) ro.observe(btn.current)
    return () => ro.disconnect()
  }, [label, trashLabel, trash.length > 99])
  useLayoutEffect(() => {
    const el = foot.current
    const sb = el?.closest<HTMLElement>('.sb')
    if (!lift || !el || !sb) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--sb-foot', `${Math.max(0, Math.round(sb.getBoundingClientRect().bottom - el.getBoundingClientRect().top))}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    ro.observe(sb)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--sb-foot')
    }
  }, [lift])
  return (
    <div className="sb-foot" ref={foot}>
      <button
        ref={btn}
        type="button"
        className="sb-trash"
        data-open={anchor ? true : undefined}
        onClick={() => setAnchor((a) => (a ? null : btn.current))}
        aria-haspopup="dialog"
      >
        <span className="sb-sect__n">{sectionNo(n)}</span>
        <span className="sb-trash__label">{trashLabel}</span>
        <span className="sb-sect__count">{String(trash.length).padStart(2, '0')}</span>
      </button>
      <TrashPopover anchor={anchor} onClose={() => setAnchor(null)} placement={mobile ? 'top' : 'right-end'} />
      <span className="sb-sect__leader sb-foot__leader" aria-hidden />
      {/* getting started: every feature on one page (shell/discover) */}
      <button type="button" className="sb-discover" data-active={discover || undefined} aria-current={discover ? 'page' : undefined} title={label} onClick={() => (closeMobileSidebar(), navigate('#/discover'))}>
        <Compass size={15} className="sb-discover__icon" aria-hidden />
        <span className="sb-discover__label">{label}</span>
        <ArrowRight size={13} className="sb-discover__arrow" aria-hidden />
      </button>
    </div>
  )
}

function ResizeHandle({ width, onDrag, onCommit }: { width: number; onDrag: (w: number) => void; onCommit: (w: number) => void }) {
  const t = useT()
  const [active, setActive] = useState(false)
  return (
    <div
      className="sb-resize"
      data-active={active || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('shell.sidebar.resize')}
      aria-valuenow={width}
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      tabIndex={0}
      onDoubleClick={() => onCommit(264)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onCommit(Math.max(MIN_W, width - 16))
        if (e.key === 'ArrowRight') onCommit(Math.min(MAX_W, width + 16))
      }}
      onPointerDown={(e) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = width
        let cur = startW
        let raw = startW
        setActive(true)
        document.body.dataset.resizing = 'col'
        const move = (ev: PointerEvent) => {
          raw = startW + ev.clientX - startX
          cur = Math.min(MAX_W, Math.max(MIN_W, raw))
          onDrag(cur)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          delete document.body.dataset.resizing
          setActive(false)
          // dragging well past the minimum folds the sidebar away
          if (raw < MIN_W - 80) {
            onCommit(startW)
            toggleSidebar()
          } else onCommit(cur)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
