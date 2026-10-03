import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CalendarDays, CalendarRange, ChevronsLeft, ChevronDown, Home, LayoutTemplate, Plus, Search, Trash2, Upload, Waypoints, Settings, Table2, FilePlus2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useFavorites, useTrash, selectBreadcrumbs } from '../../store/selectors'
import { navigate, useRoute } from '../../lib/router'
import { openTodayJournal } from '../../features'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { Tooltip } from '../../ui/Tooltip'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import { DraggableTree, PageList, PageTree } from './PageTree'
import { TrashPopover } from './TrashPopover'
import { useChildIds, treeKey, useTreeState } from '../lib/tree'
import { closeMobileSidebar, createDatabaseAndOpen, createPageAndOpen, goHome, toggleSidebar } from '../lib/actions'
import { useIsMobile, useKbdHint } from '../lib/hooks'
import './sidebar.css'

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

  // keep the active page visible in the tree
  const activeId = route.name === 'page' ? route.id : null
  useEffect(() => {
    if (!activeId) return
    const pages = useWorkspace.getState().pages
    // databases only expand for real sub-pages (rows never show in the tree)
    const chain = selectBreadcrumbs(pages, activeId)
      .slice(0, -1)
      .filter((p) => p.kind !== 'database' || !pages[activeId]?.databaseId || p.id !== pages[activeId].databaseId)
    if (chain.length) useTreeState.getState().expand(chain.map((p) => treeKey('pages', p.id)))
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
          <NavRow
            icon={<CalendarDays size={16} />}
            label={t('shell.nav.today')}
            active={route.name === 'journal'}
            onClick={() => {
              closeMobileSidebar()
              openTodayJournal()
            }}
          />
          <NavRow icon={<CalendarRange size={16} />} label={t('shell.nav.agenda')} active={route.name === 'agenda'} onClick={() => (closeMobileSidebar(), navigate({ name: 'agenda' }))} />
          <NavRow icon={<Waypoints size={16} />} label={t('shell.nav.graph')} active={route.name === 'graph'} onClick={() => (closeMobileSidebar(), navigate({ name: 'graph' }))} />
          <NavRow icon={<LayoutTemplate size={16} />} label={t('shell.nav.templates')} onClick={() => (closeMobileSidebar(), useUI.getState().openModal({ type: 'templates', parentId: null }))} />
          <NavRow icon={<Upload size={16} />} label={t('shell.nav.import')} onClick={() => (closeMobileSidebar(), useUI.getState().openModal({ type: 'import' }))} />
        </nav>
        <div className="sb-scroll" onKeyDown={onTreeKeyDown}>
          <FavoritesSection />
          <PagesSection />
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
  const name = useWorkspace((s) => s.settings.workspaceName)
  const theme = useWorkspace((s) => s.settings.theme)
  const lang = useWorkspace((s) => s.settings.language)
  const menu = useMenu()
  const mobile = useIsMobile()
  const kbd = useKbdHint()
  const set = useWorkspace.getState().updateSettings
  const entries: MenuEntry[] = [
    { kind: 'section', label: name || 'One' },
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
    { kind: 'separator' },
    { label: t('shell.menu.website'), onSelect: () => window.open(BRAND.homeHref, '_self') },
    { label: 'GitHub', onSelect: () => window.open(BRAND.repoUrl, '_blank', 'noopener') },
  ]
  return (
    <div className="sb-head">
      <button type="button" className="sb-head__ws" onClick={toggleMenu(menu)} aria-haspopup="menu" aria-expanded={menu.open}>
        <span className="sb-head__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(24) }} />
        <span className="sb-head__text">
          <span className="sb-head__name">{name || 'One'}</span>
          <span className="sb-head__sub">{t('shell.sidebar.sub')}</span>
        </span>
        <ChevronDown size={14} className="sb-head__chev" />
      </button>
      <Tooltip label={mobile ? t('common.close') : t('shell.sidebar.collapseSidebar')} shortcut={mobile ? undefined : shortcutLabel('Mod+\\')}>
        <button type="button" className="icon-btn sb-head__collapse" onClick={toggleSidebar}>
          <ChevronsLeft size={16} />
        </button>
      </Tooltip>
      <Menu {...menu.props} entries={entries} width={248} />
    </div>
  )
}

function NavRow({ icon, label, kbd, active, onClick }: { icon: ReactNode; label: string; kbd?: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sb-navrow" data-active={active || undefined} onClick={onClick}>
      <span className="sb-navrow__icon">{icon}</span>
      <span className="sb-navrow__label">{label}</span>
      {kbd && <span className="kbd sb-navrow__kbd">{kbd}</span>}
    </button>
  )
}

function SectionHead({ n, label, count, children }: { n: string; label: string; count?: number; children?: ReactNode }) {
  return (
    <div className="sb-sect">
      <span className="sb-sect__n">{n}</span>
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

function PagesSection() {
  const t = useT()
  const roots = useChildIds(null)
  const total = useWorkspace((s) => {
    let n = 0
    for (const p of Object.values(s.pages)) if (!p.trashed && !p.databaseId && !p.hidden) n++
    return n
  })
  const hasFavs = useWorkspace((s) => Object.values(s.pages).some((p) => p.favorite && !p.trashed))
  const menu = useMenu()
  const kbd = useKbdHint()
  return (
    <section className="sb-section" aria-label={t('shell.sidebar.pages')}>
      <SectionHead n={hasFavs ? '02' : '01'} label={t('shell.sidebar.pages')} count={total}>
        <button type="button" className="sb-sect__add" aria-label={t('common.newPage')} onClick={toggleMenu(menu)}>
          <Plus size={14} />
        </button>
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
        <DraggableTree>
          <PageTree parentId={null} depth={0} section="pages" draggable />
        </DraggableTree>
      </div>
      {roots.length === 0 && <p className="sb-hint">{t('shell.sidebar.empty')}</p>}
      <button type="button" className="sb-newpage" onClick={() => createPageAndOpen(null)}>
        <Plus size={15} />
        <span>{t('common.newPage')}</span>
      </button>
    </section>
  )
}

function SidebarFooter() {
  const t = useT()
  const trash = useTrash()
  const hasFavs = useWorkspace((s) => Object.values(s.pages).some((p) => p.favorite && !p.trashed))
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
        <span className="sb-sect__n">{hasFavs ? '03' : '02'}</span>
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
