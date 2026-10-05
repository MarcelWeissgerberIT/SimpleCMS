import { useState } from 'react'
import { ArrowLeft, ChevronsRight, Clock3, Lock, Menu as MenuIcon, MessageSquare, MoreHorizontal, Presentation, Star, Waypoints, Home, CalendarDays, CalendarRange, CircleSlash, Inbox, Bell, Bot, SquareCode, type LucideIcon } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useBreadcrumbs, usePage } from '../../store/selectors'
import type { Route } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { Led, shortcutLabel } from '../../ui/controls'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { toggleMenu } from '../lib/menu'
import { useT } from '../../i18n'
import type { Page } from '../../store/types'
import { useIsMobile, useSaveStatus } from '../lib/hooks'
import { goToPage, toggleSidebar } from '../lib/actions'
import { revealMain, useStageView } from '../lib/stage'
import { PageMenu } from './PageMenu'
import { PresenceStack } from '../cloud/Presence'
import { useCloudReadout, ViewOnlyTag } from '../cloud/Sync'
import { useReadOnly } from '../cloud/state'
import './topbar.css'

export function Topbar({ route }: { route: Route }) {
  const t = useT()
  const mobile = useIsMobile()
  const collapsed = useWorkspace((s) => s.settings.sidebarCollapsed)
  // with stacked panes open, the bar acts on the column you are working in
  const paneId = useStageView((s) => s.activePaneId)
  const paneIndex = useStageView((s) => s.activePaneIndex)
  const mainFolded = useStageView((s) => s.mainFolded)
  const columns = useStageView((s) => s.columns)
  const pageId = paneId ?? (route.name === 'page' ? route.id : null)
  const page = usePage(pageId)

  return (
    <header className="tb">
      {mobile ? (
        <button type="button" className="icon-btn tb-burger" aria-label={t('shell.topbar.openSidebar')} onClick={() => useUI.getState().setMobileSidebar(true)}>
          <MenuIcon size={18} />
        </button>
      ) : (
        collapsed && (
          <Tooltip label={t('shell.topbar.openSidebar')} shortcut={shortcutLabel('Mod+\\')}>
            <button type="button" className="icon-btn tb-expand" onClick={toggleSidebar}>
              <ChevronsRight size={16} />
            </button>
          </Tooltip>
        )
      )}
      {paneId && mainFolded && (
        <Tooltip label={t('shell.topbar.backToMain')}>
          <button type="button" className="tb-back" onClick={revealMain}>
            <ArrowLeft size={14} />
            <span className="tb-back__n">01</span>
          </button>
        </Tooltip>
      )}
      <nav className="tb-crumbs" aria-label={t('shell.topbar.breadcrumbs')}>
        {columns > 1 && (
          <span className="tb-pane" data-main={!paneId || undefined} aria-label={t('shell.topbar.paneN', { n: paneId ? paneIndex + 2 : 1 })}>
            {String(paneId ? paneIndex + 2 : 1).padStart(2, '0')}
          </span>
        )}
        {page ? <Crumbs page={page} compact={mobile} /> : <RouteCrumb route={route} />}
      </nav>
      <div className="tb-right">
        <PresenceStack pageId={route.name === 'page' ? route.id : null} max={mobile ? 2 : 4} />
        <ViewOnlyTag />
        <SaveLed />
        {page && !page.trashed && <PageActions page={page} mobile={mobile} />}
      </div>
    </header>
  )
}

function RouteCrumb({ route }: { route: Route }) {
  const t = useT()
  // routes rendered outside the workspace (share, forms …) never reach this crumb
  const map: Partial<Record<Route['name'], readonly [LucideIcon, string]>> = {
    home: [Home, t('shell.nav.home')],
    graph: [Waypoints, t('shell.nav.graph')],
    journal: [CalendarDays, t('shell.nav.today')],
    agenda: [CalendarRange, t('shell.nav.agenda')],
    inbox: [Bell, t('shell.nav.inbox')],
    agents: [Bot, t('features.agents.title')],
    scripts: [SquareCode, t('features.script.title')],
    clip: [Inbox, t('shell.capture.crumb')],
    notfound: [CircleSlash, t('shell.notFound.title')],
    page: [CircleSlash, t('shell.notFound.title')],
    share: [CircleSlash, ''],
  }
  const [Icon, label] = map[route.name] ?? [CircleSlash, '']
  return (
    <span className="tb-crumb tb-crumb--static">
      <Icon size={15} strokeWidth={1.7} className="faint" />
      <span className="tb-crumb__title">{label}</span>
    </span>
  )
}

function Crumbs({ page, compact }: { page: Page; compact: boolean }) {
  const t = useT()
  const chain = useBreadcrumbs(page.id)
  const menu = useMenu()
  const readOnly = useReadOnly()
  const items = compact ? chain.slice(-1) : chain
  let shown: Array<Page | 'more'> = items
  let hidden: Page[] = []
  if (!compact && chain.length > 3) {
    hidden = chain.slice(1, -2)
    shown = [chain[0], 'more', ...chain.slice(-2)]
  }
  const entries: MenuEntry[] = hidden.map((p) => ({
    label: p.title.trim() || t('common.untitled'),
    icon: <PageIcon icon={p.icon} kind={p.kind} size={15} />,
    onSelect: () => goToPage(p.id),
  }))
  return (
    <ol className="tb-crumbs__list">
      {shown.map((p, i) => (
        <li key={p === 'more' ? 'more' : p.id} className="tb-crumbs__item">
          {i > 0 && <span className="tb-sep" aria-hidden>/</span>}
          {p === 'more' ? (
            <>
              <button type="button" className="tb-crumb" onClick={toggleMenu(menu)} aria-label={t('shell.topbar.morePath')}>
                <span className="tb-crumb__title">…</span>
              </button>
              <Menu {...menu.props} entries={entries} />
            </>
          ) : (
            <a
              href={`#/p/${p.id}`}
              className="tb-crumb"
              aria-current={p.id === page.id ? 'page' : undefined}
              data-no-pane=""
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return
                e.preventDefault()
                goToPage(p.id)
              }}
            >
              <PageIcon icon={p.icon} kind={p.kind} size={15} />
              <span className="tb-crumb__title" data-untitled={!p.title.trim() || undefined}>
                {p.title.trim() || t('common.untitled')}
              </span>
            </a>
          )}
        </li>
      ))}
      {page.settings.locked && (
        <li className="tb-crumbs__item">
          <button type="button" className="tb-tag" disabled={readOnly} onClick={() => useWorkspace.getState().updatePageSettings(page.id, { locked: false })} title={readOnly ? undefined : t('shell.topbar.unlock')}>
            <Lock size={11} strokeWidth={2} />
            {t('shell.topbar.locked')}
          </button>
        </li>
      )}
    </ol>
  )
}

export function SaveLed() {
  const t = useT()
  const status = useSaveStatus()
  const cloud = useCloudReadout()
  if (cloud)
    return (
      <Tooltip label={cloud.tip}>
        <span className="tb-led" data-cloud={cloud.state} tabIndex={0} role="status" aria-label={cloud.tip}>
          <Led state={cloud.led} />
        </span>
      </Tooltip>
    )
  const label = status === 'saving' ? t('shell.save.saving') : status === 'error' ? t('shell.save.error') : status === 'saved' ? t('shell.save.saved') : t('shell.save.idle')
  return (
    <Tooltip label={label}>
      <span className="tb-led" data-status={status} tabIndex={0} role="status" aria-label={label}>
        <Led state={status === 'saving' ? 'on' : status === 'saved' || status === 'idle' ? 'ok' : 'off'} />
      </span>
    </Tooltip>
  )
}

/** Open-thread count; toggles the editor's comments sheet (or "show resolved" in the margin layout). */
function CommentsButton({ page }: { page: Page }) {
  const t = useT()
  const threads = Array.isArray(page.comments) ? page.comments : []
  if (!threads.length) return null
  const open = threads.filter((c) => !c.resolved).length
  const label = t('shell.topbar.comments', { n: open })
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-btn tb-comments"
        aria-label={label}
        onClick={() => window.dispatchEvent(new CustomEvent('one:comments', { detail: { pageId: page.id } }))}
      >
        <MessageSquare size={16} />
        {open > 0 && <span className="tb-comments__n">{open > 99 ? '99+' : open}</span>}
      </button>
    </Tooltip>
  )
}

function PageActions({ page, mobile }: { page: Page; mobile: boolean }) {
  const t = useT()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const ui = useUI.getState()
  return (
    <>
      {!mobile && (
        <button type="button" className="btn btn--sm btn--ghost tb-share" onClick={() => ui.openModal({ type: 'share', pageId: page.id })}>
          {t('shell.topbar.share')}
        </button>
      )}
      <CommentsButton page={page} />
      {!mobile && (
        <Tooltip label={t('shell.topbar.history')}>
          <button type="button" className="icon-btn" onClick={() => ui.openModal({ type: 'history', pageId: page.id })}>
            <Clock3 size={16} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={page.favorite ? t('shell.menu.unfavorite') : t('shell.menu.favorite')}>
        <button type="button" className="icon-btn tb-star" aria-pressed={page.favorite} onClick={() => useWorkspace.getState().toggleFavorite(page.id)}>
          <Star size={16} fill={page.favorite ? 'currentColor' : 'none'} />
        </button>
      </Tooltip>
      {!mobile && (
        <Tooltip label={t('shell.topbar.present')}>
          <button type="button" className="icon-btn" onClick={() => ui.present(page.id)}>
            <Presentation size={16} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={t('shell.topbar.pageMenu')}>
        <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={!!menuAnchor} onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}>
          <MoreHorizontal size={17} />
        </button>
      </Tooltip>
      <PageMenu page={page} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} mobile={mobile} />
    </>
  )
}
