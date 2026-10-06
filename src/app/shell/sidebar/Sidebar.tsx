import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, Bot, CalendarDays, CalendarRange, ChevronsLeft, ChevronDown, Home, LayoutTemplate, Lock, PenLine, Plus, Search, Trash2, Upload, Waypoints, Settings, Table2, FilePlus2, Users, SquareCode } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useFavorites, useTrash, useTreeCount, useHasFavorites } from '../../store/selectors'
import { navigate, useRoute } from '../../lib/router'
import { openTodayJournal, AgentsNavBadge } from '../../features'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { Tooltip } from '../../ui/Tooltip'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import { DraggableTree, PageList, PageTree, SECTION_DROP, useRootIds, useSectionDrop } from './PageTree'
import { TrashPopover } from './TrashPopover'
import { createPrivateDatabaseAndOpen, createPrivatePageAndOpen } from './private'
import { treeAncestors, treeKey, useTreeState } from '../lib/tree'
import { usePrivateMode } from '../../cloud'
import { closeMobileSidebar, createDatabaseAndOpen, createPageAndOpen, goHome, toggleSidebar } from '../lib/actions'
import { useIsMobile, useKbdHint } from '../lib/hooks'
import { HeaderSub, useWorkspaceEntries } from '../cloud/Switcher'
import { openSettingsTab, useInCloud, useReadOnly, useWorkspaceTitle } from '../cloud/state'
import { useRenameMode } from '../lib/workspaceName'
import { WorkspaceRename } from './WorkspaceRename'
import { useInboxUnread } from '../inbox/model'
import { INBOX_KEYS, useInboxShortcut } from '../inbox/keys'
import { useInstallMenuEntries } from '../capture/Install'
import './sidebar.css'
import { openHelp, HelpNewsLed, useChangelogUnseen } from '../../help'

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
        <nav className="sb-nav">
          <NavRow icon={<Search size={16} />} label={t('shell.nav.search')} kbd={kbd('Mod+K')} onClick={() => (closeMobileSidebar(), useUI.getState().openPalette())} />
          <NavRow icon={<Home size={16} />} label={t('shell.nav.home')} active={route.name === 'home'} onClick={goHome} />
          <InboxNavRow active={route.name === 'inbox'} />
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
          <NavRow icon={<CalendarRange size={16} />} label={t('shell.nav.agenda')} active={route.name === 'agenda'} onClick={() => (closeMobileSidebar(), navigate({ name: 'agenda' }))} />
          <NavRow icon={<Waypoints size={16} />} label={t('shell.nav.graph')} active={route.name === 'graph'} onClick={() => (closeMobileSidebar(), navigate({ name: 'graph' }))} />
          <NavRow icon={<Bot size={16} />} label={t('features.agents.title')} active={route.name === 'agents'} badge={<AgentsNavBadge />} onClick={() => (closeMobileSidebar(), navigate({ name: 'agents' }))} />
          <NavRow icon={<SquareCode size={16} />} label={t('features.script.title')} active={route.name === 'scripts'} onClick={() => (closeMobileSidebar(), navigate({ name: 'scripts' }))} />
          {!readOnly && (
            <>
              <NavRow icon={<LayoutTemplate size={16} />} label={t('shell.nav.templates')} onClick={() => (closeMobileSidebar(), useUI.getState().openModal({ type: 'templates', parentId: null }))} />
              <NavRow icon={<Upload size={16} />} label={t('shell.nav.import')} onClick={() => (closeMobileSidebar(), useUI.getState().openModal({ type: 'import' }))} />
            </>
          )}
        </nav>
        <div className="sb-scroll" onKeyDown={onTreeKeyDown}>
          <FavoritesSection />
          {/* one drag & drop context: pages move between the workspace's and my private ones too */}
          <DraggableTree>
            <PagesSection />
            <PrivateSection />
          </DraggableTree>
        </div>
        <SidebarFooter />
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

/** Arrow-key navigation across all visible tree rows (WAI-ARIA tree pattern). */
function onTreeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  const link = (e.target as HTMLElement).closest?.('.sb-row__link') as HTMLElement | null
  if (!link || e.altKey || e.metaKey || e.ctrlKey) return
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('.sb-row__link')]
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
    { label: t('common.settings'), icon: <Settings size={15} />, hint: kbd('Mod+,'), onSelect: () => useUI.getState().openModal({ type: 'settings' }) },
    ...(inCloud ? ([{ label: t('shell.cloud.cmd.team'), icon: <Users size={15} />, onSelect: () => openSettingsTab('team') }] as MenuEntry[]) : []),
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
    { label: t('help.title'), hint: kbd('?'), onSelect: () => openHelp(), ...(newsUnseen ? { icon: <HelpNewsLed quiet /> } : {}) },
    ...installEntries,
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

function NavRow({ icon, label, kbd, active, badge, ariaLabel, onClick }: { icon: ReactNode; label: string; kbd?: string; active?: boolean; badge?: ReactNode; ariaLabel?: string; onClick: () => void }) {
  return (
    <button type="button" className="sb-navrow" data-active={active || undefined} aria-label={ariaLabel} onClick={onClick}>
      <span className="sb-navrow__icon">{icon}</span>
      <span className="sb-navrow__label">{label}</span>
      {badge}
      {kbd && <span className="kbd sb-navrow__kbd">{kbd}</span>}
    </button>
  )
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

function FavoritesSection() {
  const t = useT()
  const favs = useFavorites()
  if (favs.length === 0) return null
  return (
    <section className="sb-section" aria-label={t('shell.sidebar.favorites')}>
      <SectionHead n="01" label={t('shell.sidebar.favorites')} count={favs.length} />
      <div role="tree">
        <PageList ids={favs.map((p) => p.id)} section="fav" />
      </div>
    </section>
  )
}

const useHasFavs = useHasFavorites
const sectionNo = (n: number) => String(n).padStart(2, '0')

function PagesSection() {
  const t = useT()
  // a team workspace splits the top level: the workspace's pages here, mine under PRIVATE
  const split = usePrivateMode() !== 'none'
  const roots = useRootIds(split ? false : null)
  const total = useTreeCount(split ? false : null)
  const hasFavs = useHasFavs()
  const menu = useMenu()
  const kbd = useKbdHint()
  const readOnly = useReadOnly()
  const drop = useSectionDrop(SECTION_DROP.pages, split && !readOnly)
  return (
    <section className="sb-section" aria-label={t('shell.sidebar.pages')}>
      <SectionHead n={sectionNo(hasFavs ? 2 : 1)} label={t('shell.sidebar.pages')} count={total} drop={drop}>
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

/**
 * PRIVATE (team workspaces): pages only I can see — the server keeps them in my own documents.
 * Viewers see the section only when they have private pages from before (read-only).
 */
function PrivateSection() {
  const t = useT()
  const mode = usePrivateMode()
  const roots = useRootIds(true)
  const total = useTreeCount(true)
  const hasFavs = useHasFavs()
  const menu = useMenu()
  const write = mode === 'write'
  const drop = useSectionDrop(SECTION_DROP.private, write)
  if (mode === 'none' || (!write && roots.length === 0)) return null
  return (
    <section className="sb-section sb-section--private" aria-label={t('shell.private.title')} data-testid="private-section">
      <SectionHead n={sectionNo(hasFavs ? 3 : 2)} label={t('shell.private.title')} count={total} icon={<Lock size={11} strokeWidth={2} aria-label={t('shell.private.lock')} />} drop={drop}>
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

function SidebarFooter() {
  const t = useT()
  const trash = useTrash()
  const hasFavs = useHasFavs()
  const privateShown = useTreeCount(true) > 0
  const mode = usePrivateMode()
  // FAVORITES? · PAGES · PRIVATE? · TRASH
  const n = 2 + (hasFavs ? 1 : 0) + (mode === 'write' || (mode === 'read' && privateShown) ? 1 : 0)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const mobile = useIsMobile()
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <div className="sb-foot">
      <button
        ref={btn}
        type="button"
        className="sb-trash"
        data-open={anchor ? true : undefined}
        onClick={() => setAnchor((a) => (a ? null : btn.current))}
        aria-haspopup="dialog"
      >
        <span className="sb-sect__n">{sectionNo(n)}</span>
        <Trash2 size={14} />
        <span className="sb-trash__label">{t('shell.sidebar.trash')}</span>
        <span className="sb-sect__leader" aria-hidden />
        <span className="sb-sect__count">{String(trash.length).padStart(2, '0')}</span>
      </button>
      <TrashPopover anchor={anchor} onClose={() => setAnchor(null)} placement={mobile ? 'top' : 'right-end'} />
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
