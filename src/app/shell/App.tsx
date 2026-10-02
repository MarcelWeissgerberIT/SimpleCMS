import { useRoute, type Route } from '../lib/router'
import { useWorkspace } from '../store/store'
import { useUI } from '../store/ui'
import { usePage } from '../store/selectors'
import { useThemeAndLanguage } from '../lib/theme'
import { GraphView, SharedPageView, Presentation } from '../features'
import { PageIcon } from '../ui/PageIcon'
import { useT } from '../i18n'
import { Sidebar } from './sidebar/Sidebar'
import { Topbar } from './topbar/Topbar'
import { Stage } from './stage/Stage'
import { Peek } from './stage/Peek'
import { StatusBar } from './stage/StatusBar'
import { Toasts } from './stage/Toasts'
import { PageView } from './page/PageView'
import { Home } from './home/Home'
import { NotFound, JournalPending } from './home/NotFound'
import { CommandPalette } from './palette/CommandPalette'
import { ModalHost } from './modals/ModalHost'
import { ErrorBoundary } from './ErrorBoundary'
import { useBootRedirect, useGlobalShortcuts, useLinkInterceptor, useRouteEffects } from './lib/global'
import { useIsMobile } from './lib/hooks'
import './stage/stage.css'

export function App() {
  useThemeAndLanguage()
  const route = useRoute()
  if (route.name === 'share')
    return (
      <ErrorBoundary>
        <SharedPageView payload={route.payload} />
        <Toasts />
      </ErrorBoundary>
    )
  return <Workspace route={route} />
}

function Workspace({ route }: { route: Route }) {
  useBootRedirect(route)
  useGlobalShortcuts()
  useLinkInterceptor()
  useRouteEffects(route)
  const t = useT()
  const mobile = useIsMobile()
  const focus = useUI((s) => s.focusMode)
  const presentId = useUI((s) => s.presentPageId)

  return (
    <div className="app" data-focus={focus || undefined} data-mobile={mobile || undefined}>
      <a className="visually-hidden" href="#main">
        {t('shell.a11y.skip')}
      </a>
      <Sidebar />
      <div className="app-main">
        <Topbar route={route} />
        <ErrorBoundary key={route.name === 'page' ? route.id : route.name} inline>
          <Stage route={route} main={<RouteView route={route} />} mainTitle={<RouteTitle route={route} />} />
        </ErrorBoundary>
      </div>
      {!mobile && <StatusBar route={route} />}
      {focus && (
        <button type="button" className="focus-exit" onClick={() => useUI.getState().setFocusMode(false)}>
          {t('shell.focus.exit')} <span className="kbd">Esc</span>
        </button>
      )}
      <ErrorBoundary inline>
        <Peek />
      </ErrorBoundary>
      <CommandPalette />
      <ErrorBoundary inline>
        <ModalHost />
      </ErrorBoundary>
      <Toasts />
      {presentId && <Presentation pageId={presentId} onClose={() => useUI.getState().present(null)} />}
    </div>
  )
}

function RouteView({ route }: { route: Route }) {
  const exists = useWorkspace((s) => (route.name === 'page' ? !!s.pages[route.id] : true))
  switch (route.name) {
    case 'page':
      return exists ? <PageView pageId={route.id} variant="main" /> : <NotFound kind="page" />
    case 'home':
      return <Home />
    case 'graph':
      return <GraphView />
    case 'journal':
      return <JournalPending />
    default:
      return <NotFound />
  }
}

function RouteTitle({ route }: { route: Route }) {
  const t = useT()
  const page = usePage(route.name === 'page' ? route.id : null)
  if (page)
    return (
      <>
        <PageIcon icon={page.icon} kind={page.kind} size={14} />
        <span>{page.title.trim() || t('common.untitled')}</span>
      </>
    )
  return <span>{route.name === 'graph' ? t('shell.nav.graph') : t('shell.nav.home')}</span>
}
