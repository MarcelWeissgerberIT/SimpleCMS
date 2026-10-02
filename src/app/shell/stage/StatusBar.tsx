import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { Route } from '../../lib/router'
import { Led, shortcutLabel } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { fmtNumber, readingMinutes, wordCount } from '../lib/format'
import { useSaveStatus } from '../lib/hooks'

/** 24px instrument read-out along the bottom edge. */
export function StatusBar({ route }: { route: Route }) {
  const t = useT()
  const lang = useLang()
  const status = useSaveStatus()
  const pageId = route.name === 'page' ? route.id : null
  const plain = useWorkspace((s) => (pageId ? s.pages[pageId]?.plain : undefined))
  const kind = useWorkspace((s) => (pageId ? s.pages[pageId]?.kind : undefined))
  const rows = useWorkspace((s) => {
    if (!pageId || s.pages[pageId]?.kind !== 'database') return 0
    let n = 0
    for (const p of Object.values(s.pages)) if (p.databaseId === pageId && !p.trashed) n++
    return n
  })
  const views = useWorkspace((s) => (pageId ? (s.databases[pageId]?.views.length ?? 0) : 0))
  const panes = useUI((s) => s.panes.length)
  const words = wordCount(plain)

  const saveText =
    status === 'saving' ? t('shell.status.writing') : status === 'error' ? t('shell.status.error') : t('shell.status.saved')

  return (
    <footer className="status" aria-label={t('shell.status.label')}>
      <span className="status__cell status__save" data-status={status} role="status">
        <Led state={status === 'saving' ? 'on' : status === 'error' ? 'off' : 'ok'} />
        {saveText}
      </span>
      {pageId && kind === 'page' && (
        <span className="status__cell">
          {t('shell.stats.words', { n: fmtNumber(words, lang) })} · {t('shell.stats.read', { n: readingMinutes(words) })}
        </span>
      )}
      {pageId && kind === 'database' && (
        <span className="status__cell">
          {t('shell.stats.rows', { n: fmtNumber(rows, lang) })} · {t('shell.stats.views', { n: views })}
        </span>
      )}
      {panes > 0 && <span className="status__cell">{t('shell.stats.panes', { n: panes })}</span>}
      <span className="status__spacer" />
      <button type="button" className="status__cell status__btn" onClick={() => useUI.getState().openPalette()}>
        {shortcutLabel('Mod+K')} {t('shell.status.commands')}
      </button>
      <button type="button" className="status__cell status__btn" onClick={() => useUI.getState().openModal({ type: 'shortcuts' })}>
        ? {t('shell.status.help')}
      </button>
    </footer>
  )
}
