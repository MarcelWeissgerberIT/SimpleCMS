import { useLayoutEffect, useMemo, useRef } from 'react'
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
import { SyncStatusCell, McpStatusCell, AgentStatusCell, CodingStatusCell, OutboxStatusCell, RecorderStatusCell, RewindKey } from '../../features'
import { toggleHelp, useHelp, HelpNewsLed } from '../../help'

/**
 * How many levels of low-priority parts the status bar sheds when its cells do not fit (measured: its width, its
 * cells' text, the text size): level n sets `data-shed-1` … `data-shed-n` on the bar. 1 the REC cell's days and
 * Vorgänge · 2 the Rewind key's shortcut · 3 its word (the icon stays, the name stays for screen readers) · 4 the
 * theme's name · 5 the commands key's word · 6 the page's word count.
 */
const SHED_LEVELS = 6

function useShed(): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      for (let i = 1; i <= SHED_LEVELS; i++) el.removeAttribute(`data-shed-${i}`)
      for (let i = 1; i <= SHED_LEVELS && el.scrollWidth > el.clientWidth + 1; i++) el.setAttribute(`data-shed-${i}`, '')
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // a cell's text changed (a count, the language) or the text size: fit again (the bar's own attributes are not watched)
    const mo = new MutationObserver(fit)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    const size = new MutationObserver(fit)
    size.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-size'] })
    return () => {
      ro.disconnect()
      mo.disconnect()
      size.disconnect()
    }
  }, [])
  return ref
}

/** 24px instrument read-out along the bottom edge (it sheds low-priority parts when they do not fit). */
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
  // re-renders with every save status change: count the page's words only when its text changed
  const words = useMemo(() => wordCount(plain), [plain])
  const dark = useResolvedTheme() === 'dark'
  // a team workspace reports sync with the server instead of the local save
  const cloud = useCloudReadout()
  const helpOpen = useHelp((s) => s.open)
  const shed = useShed()

  const saveText =
    status === 'saving' ? t('shell.status.writing') : status === 'error' ? t('shell.status.error') : t('shell.status.saved')

  return (
    <footer className="status" ref={shed} aria-label={t('shell.status.label')}>
      {cloud ? (
        <CloudStatusCells readout={cloud} />
      ) : (
        <span className="status__cell status__save" data-status={status} role="status">
          <Led state={status === 'saving' ? 'on' : status === 'error' ? 'off' : 'ok'} />
          {saveText}
        </span>
      )}
      <SyncStatusCell />
      <RecorderStatusCell />
      <McpStatusCell />
      <AgentStatusCell />
      <CodingStatusCell />
      <OutboxStatusCell />
      {pageId && kind === 'page' && (
        <span className="status__cell status__words">
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
      <RewindKey />
      <button type="button" className="status__cell status__btn" onClick={toggleTheme} title={t('shell.status.theme')}>
        <span className="status__half" aria-hidden />
        <span className="status__shed4">{dark ? 'Carbon' : 'Paper'}</span>
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
        {shortcutLabel('Mod+K')} <span className="status__shed5">{t('shell.status.commands')}</span>
      </button>
      <button type="button" className="status__cell status__btn" onClick={toggleHelp} aria-expanded={helpOpen}>
        ? {t('shell.status.help')}
        <HelpNewsLed />
      </button>
    </footer>
  )
}
