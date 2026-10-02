import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { shortcutLabel } from '../../ui/controls'
import './home.css'

export function NotFound({ kind = 'route' }: { kind?: 'route' | 'page' }) {
  const t = useT()
  return (
    <div className="nf">
      <div className="nf__plate">
        <div className="nf__bar" aria-hidden />
        <div className="label nf__code">ERR 404 · {t('shell.notFound.code')}</div>
        <h1 className="display nf__title">{t('shell.notFound.title')}</h1>
        <p className="nf__body">{kind === 'page' ? t('shell.notFound.pageBody') : t('shell.notFound.body')}</p>
        <div className="nf__actions">
          <button type="button" className="btn btn--ink" onClick={() => navigate({ name: 'home' })}>
            {t('shell.notFound.home')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => useUI.getState().openPalette()}>
            {t('shell.notFound.search')} <span className="kbd">{shortcutLabel('Mod+K')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function JournalPending() {
  const t = useT()
  return (
    <div className="nf">
      <div className="label nf__code nf__pulse">
        <span className="led led--on" /> {t('shell.journal.opening')}
      </div>
    </div>
  )
}
