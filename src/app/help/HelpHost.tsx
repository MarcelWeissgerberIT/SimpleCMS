/**
 * Help host — mounted once by the shell. Renders nothing while the panel is closed; on first open it
 * loads the panel and the manual (lazy chunk) and portals the side sheet to <body>, so it stays usable
 * above a dialog (a HelpLink in Settings opens it on top of Settings).
 */
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../i18n'
import { closeHelp, useHelp } from './state'
import './help.css'

const HelpPanel = lazy(() => import('./HelpPanel'))

export interface HelpHostProps {
  /** The keyboard sheet (the shell's ShortcutList) — shown on the panel's "Keys" tab. */
  shortcuts?: ReactNode
}

export function HelpHost({ shortcuts }: HelpHostProps) {
  const open = useHelp((s) => s.open)
  if (!open) return null
  return createPortal(
    <LoadGuard>
      <Suspense fallback={<Placeholder />}>
        <HelpPanel shortcuts={shortcuts} />
      </Suspense>
    </LoadGuard>,
    document.body,
  )
}

/** Same frame as the panel while its chunk loads — or when it failed to load. */
function Placeholder({ failed }: { failed?: boolean }) {
  const t = useT()
  return (
    <aside className="help" role="dialog" aria-modal="false" aria-label={t('help.title')} data-state={failed ? 'failed' : 'loading'}>
      <header className="help-head">
        <div className="help-head__plate">
          <span className="label help-head__code">{t('help.code')}</span>
          <h2 className="help-head__title">{t('help.title')}</h2>
        </div>
        <div className="help-head__tools">
          <button type="button" className="icon-btn" onClick={closeHelp} aria-label={t('help.close')} title={`${t('help.close')} (Esc)`}>
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
      </header>
      <p className="help-placeholder" role={failed ? 'alert' : 'status'}>
        <span className={`led${failed ? '' : ' led--on'}`} aria-hidden /> {t(failed ? 'help.loadFailed' : 'help.loading')}
      </p>
    </aside>
  )
}

/** A chunk that cannot load (offline right after an update) shows a message instead of breaking the app. */
class LoadGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[one] help panel failed to load', error)
  }
  render() {
    return this.state.failed ? <Placeholder failed /> : this.props.children
  }
}
