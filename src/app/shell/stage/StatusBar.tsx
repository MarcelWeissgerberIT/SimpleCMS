import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useRowCount } from '../../store/selectors'
import type { Route } from '../../lib/router'
import { Led, shortcutLabel } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { fmtNumber, readingTime, wordCount } from '../lib/format'
import { useResolvedTheme, useSaveStatus } from '../lib/hooks'
import { toggleTheme } from '../lib/actions'
import { useStageView } from '../lib/stage'
import { plural } from '../lib/format'
import { CloudStatusCells, useCloudReadout } from '../cloud/Sync'
import { SyncStatusCell, McpStatusCell } from '../../features'

/** 24px instrument read-out along the bottom edge. */
export function StatusBar({ route }: { route: Route }) {
  const t = useT()
  const lang = useLang()
  const status = useSaveStatus()
  const paneId = useStageView((s) => s.activePaneId)
  const pageId = paneId ?? (route.name === 'page' ? route.id : null)
  const plain = useWorkspace((s) => (pageId ? s.pages[pageId]?.plain : undefined))
  const kind = useWorkspace((s) => (pageId ? s.pages[pageId]?.kind : undefined))
  const rows = useRowCount(kind === 'database' ? pageId : null)
  const views = useWorkspace((s) => (pageId ? (s.databases[pageId]?.views.length ?? 0) : 0))
  const panes = useUI((s) => s.panes.length)
  const words = wordCount(plain)
  const dark = useResolvedTheme() === 'dark'
  // a team workspace reports sync with the server instead of the local save
  const cloud = useCloudReadout()

  const saveText =
    status === 'saving' ? t('shell.status.writing') : status === 'error' ? t('shell.status.error') : t('shell.status.saved')

  return (
    <footer className="status" aria-label={t('shell.status.label')}>
      {cloud ? (
        <CloudStatusCells readout={cloud} />
      ) : (
        <span className="status__cell status__save" data-status={status} role="status">
          <Led state={status === 'saving' ? 'on' : status === 'error' ? 'off' : 'ok'} />
          {saveText}
        </span>
      )}
      <SyncStatusCell />
      <McpStatusCell />
      {pageId && kind === 'page' && (
        <span className="status__cell">
          {t(plural('shell.stats.words', words), { n: fmtNumber(words, lang) })} · {t('shell.stats.read', { n: readingTime(words) })}
        </span>
      )}
      {pageId && kind === 'database' && (
        <span className="status__cell">
          {t(plural('shell.stats.rows', rows), { n: fmtNumber(rows, lang) })} · {t(plural('shell.stats.views', views), { n: views })}
        </span>
      )}
      {panes > 0 && <span className="status__cell">{t('shell.stats.panes', { n: panes })}</span>}
      <span className="status__spacer" />
      <button type="button" className="status__cell status__btn" onClick={toggleTheme} title={t('shell.status.theme')}>
        <span className="status__half" aria-hidden />
        {dark ? 'Carbon' : 'Paper'}
      </button>
      <button
        type="button"
        className="status__cell status__btn"
        title={t('shell.status.lang')}
        onClick={() => useWorkspace.getState().updateSettings({ language: lang === 'de' ? 'en' : 'de' })}
      >
        <span data-on={lang === 'en' || undefined} className="status__opt">EN</span>
        <span data-on={lang === 'de' || undefined} className="status__opt">DE</span>
      </button>
      <button type="button" className="status__cell status__btn" onClick={() => useUI.getState().openPalette()}>
        {shortcutLabel('Mod+K')} {t('shell.status.commands')}
      </button>
      <button type="button" className="status__cell status__btn" onClick={() => useUI.getState().openModal({ type: 'shortcuts' })}>
        ? {t('shell.status.help')}
      </button>
    </footer>
  )
}
