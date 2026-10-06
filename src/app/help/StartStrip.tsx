/**
 * "Getting started" on top of the manual's index: the guided tour and "What can One do?" — two keys that
 * hand over to the shell through the "Try it" allow-list (help never imports the shell).
 */
import { ArrowRight, Compass, LayoutGrid } from 'lucide-react'
import { useT } from '../i18n'
import { runTry } from './changelog/try'
import './start.css'

export function StartStrip() {
  const t = useT()
  return (
    <section className="help-start" aria-label={t('help.start.title')} data-testid="help-start">
      <button type="button" className="help-start__key" data-try="tour" onClick={() => runTry('tour')}>
        <span className="help-start__icon" aria-hidden>
          <Compass size={16} strokeWidth={1.75} />
        </span>
        <span className="help-start__main">
          <span className="help-start__title">{t('help.start.tour')}</span>
          <span className="help-start__sub">{t('help.start.tourSub')}</span>
        </span>
        <ArrowRight size={13} strokeWidth={1.75} className="help-row__go" aria-hidden />
      </button>
      <button type="button" className="help-start__key" data-try="discover" onClick={() => runTry('discover')}>
        <span className="help-start__icon" aria-hidden>
          <LayoutGrid size={16} strokeWidth={1.75} />
        </span>
        <span className="help-start__main">
          <span className="help-start__title">{t('help.start.discover')}</span>
          <span className="help-start__sub">{t('help.start.discoverSub')}</span>
        </span>
        <ArrowRight size={13} strokeWidth={1.75} className="help-row__go" aria-hidden />
      </button>
    </section>
  )
}
