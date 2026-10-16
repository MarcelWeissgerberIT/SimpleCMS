import { useEffect, useMemo } from 'react'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { pagesAt } from '../../lib/permalink'
import { useT } from '../../i18n'
import { useKbdHint } from '../lib/hooks'
import './home.css'

export function NotFound({ kind = 'route' }: { kind?: 'route' | 'page' }) {
  const t = useT()
  const kbd = useKbdHint()('Mod+K')
  return (
    <div className="nf">
      <div className="nf__plate">
        <div className="nf__bar" aria-hidden />
        <div className="label nf__code">{t('shell.notFound.err')} · {t('shell.notFound.code')}</div>
        <h1 className="display nf__title">{t('shell.notFound.title')}</h1>
        <p className="nf__body">{kind === 'page' ? t('shell.notFound.pageBody') : t('shell.notFound.body')}</p>
        <div className="nf__actions">
          <button type="button" className="btn btn--ink" onClick={() => navigate({ name: 'home' })}>
            {t('shell.notFound.home')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => useUI.getState().openPalette()}>
            {t('shell.notFound.search')} {kbd && <span className="kbd">{kbd}</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * #/p/<x> for a page this device does not have: an address typed in another form — the id in capitals, the spec plate's
 * "ABCD·1234" (lib/permalink.ts) — opens the one page it names (the address is replaced); anything else is "Nothing here".
 */
export function MissingPage({ id, block }: { id: string; block?: string }) {
  const pages = useWorkspace((s) => s.pages)
  const hit = useMemo(() => {
    const ids = pagesAt(id, pages)
    return ids.length === 1 && ids[0] !== id ? ids[0]! : null
  }, [id, pages])
  useEffect(() => {
    if (hit) navigate({ name: 'page', id: hit, ...(block ? { block } : {}) }, { replace: true })
  }, [hit, block])
  return hit ? null : <NotFound kind="page" />
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

/** #/clip: shown for the moment it takes to file the clip (the route is then replaced). */
export function ClipPending() {
  const t = useT()
  return (
    <div className="nf">
      <div className="label nf__code nf__pulse" role="status">
        <span className="led led--on" /> {t('shell.capture.clipping')}
      </div>
    </div>
  )
}
