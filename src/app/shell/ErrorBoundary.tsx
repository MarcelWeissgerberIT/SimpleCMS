import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
  /** Render a compact panel instead of a full-screen fault page. */
  inline?: boolean
}

/** Keeps one broken area from taking down the whole instrument. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[one] UI fault', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={this.props.inline ? 'fault fault--inline' : 'fault'} role="alert">
        <div className="fault__plate">
          <div className="fault__bar" aria-hidden />
          <div className="label fault__code">{t('shell.fault.code')} · {error.name || 'Error'}</div>
          <h2 className="fault__title">{t('shell.fault.title')}</h2>
          <p className="fault__msg">{error.message}</p>
          <div className="fault__actions">
            <button type="button" className="btn btn--ink" onClick={() => this.setState({ error: null })}>
              {t('shell.fault.retry')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
              {t('shell.fault.reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
