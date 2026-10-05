/**
 * The signal LED on the help entry ("? Help" in the status bar, Help in the workspace menu): lit while this
 * build has a "What's new" entry newer than the last one this device opened. Renders nothing otherwise.
 * `quiet`: the LED only, without its screen-reader text (where it would lead the entry's accessible name).
 */
import { useT } from '../../i18n'
import { useChangelogUnseen } from './seen'

export function HelpNewsLed({ className, quiet }: { className?: string; quiet?: boolean }) {
  const t = useT()
  const unseen = useChangelogUnseen()
  if (!unseen) return null
  return (
    <span className={`help-news-led${className ? ` ${className}` : ''}`} data-testid="help-news-led" title={t('help.news.led')} aria-hidden={quiet || undefined}>
      <span className="led led--on" aria-hidden />
      {!quiet && <span className="visually-hidden">{t('help.news.led')}</span>}
    </span>
  )
}
