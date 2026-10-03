import { useRoute, type Route } from '../lib/router'
import { useWorkspace } from '../store/store'
import { useUI } from '../store/ui'
import { usePage } from '../store/selectors'
import { useThemeAndLanguage } from '../lib/theme'
import { GraphView, SharedPageView, Presentation } from '../features'
import { SharedFormView } from '../database'
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
import { Agenda } from './agenda/Agenda'
import { NotFound, JournalPending, ClipPending } from './home/NotFound'
import { CommandPalette } from './palette/CommandPalette'
import { ModalHost } from './modals/ModalHost'
import { ErrorBoundary } from './ErrorBoundary'
import { useBootRedirect, useDrawerAutoClose, useGlobalShortcuts, useLinkInterceptor, usePruneGoneViews, useRouteEffects } from './lib/global'
import { useIsMobile } from './lib/hooks'
import { useCloud } from '../cloud'
import { installCloudDevHook } from './cloud/api'
import { SignInScreen } from './cloud/SignIn'
import { InviteScreen } from './cloud/InviteScreen'
import { CloudDialogs } from './cloud/Dialogs'
import { CloudBanner } from './cloud/Sync'
import './stage/stage.css'

installCloudDevHook()

export function App() {
  useThemeAndLanguage()
  const route = useRoute()
  const signedOut = useCloud((s) => s.status === 'signed-out')
  if (route.name === 'share')
    return (
      <ErrorBoundary>
        <SharedPageView payload={route.payload} />
        <Toasts />
      </ErrorBoundary>
    )
  if (route.name === 'form')
    return (
      <ErrorBoundary>
        <SharedFormView payload={route.payload} />
        <Toasts />
      </ErrorBoundary>
    )
  // team cloud: an invitation works signed in or out; a cloud workspace without a session asks to sign in
  if (route.name === 'invite')
    return (
      <ErrorBoundary>
        <InviteScreen token={route.token} />
        <Toasts />
      </ErrorBoundary>
    )
  if (signedOut)
    return (
      <ErrorBoundary>
        <SignInScreen />
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
  useDrawerAutoClose()
  usePruneGoneViews()
  const t = useT()
  const mobile = useIsMobile()
  const focus = useUI((s) => s.focusMode)
  const presentId = useUI((s) => s.presentPageId)

  return (
    <div className="app" data-focus={focus || undefined} data-mobile={mobile || undefined}>
      {/* hash routing: a real "#main" jump would be read as a route, so move focus by hand */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          // the main page, or — while panes fold it into a spine — the first column in view
          document.querySelector<HTMLElement>('#main:not([data-folded]), .stage-col:not([data-folded])')?.focus()
        }}
      >
        {t('shell.a11y.skip')}
      </a>
      <Sidebar />
      <div className="app-main">
        <CloudBanner />
        <Topbar route={route} />
        <ErrorBoundary inline>
          <Stage
            route={route}
            main={
              <ErrorBoundary key={route.name === 'page' ? route.id : route.name} inline>
                <RouteView route={route} />
              </ErrorBoundary>
            }
            mainTitle={<RouteTitle route={route} />}
          />
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
        <CloudDialogs />
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
    case 'agenda':
      return <Agenda />
    case 'journal':
      return <JournalPending />
    case 'clip':
      return <ClipPending />
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
  return <span>{route.name === 'graph' ? t('shell.nav.graph') : route.name === 'agenda' ? t('shell.nav.agenda') : t('shell.nav.home')}</span>
}
