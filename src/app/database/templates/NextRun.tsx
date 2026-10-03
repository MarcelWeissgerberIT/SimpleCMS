/**
 * "● NEXT · MON 12 OCT, 08:00" — the next-run readout of a recurring template (mono label + LED).
 */
import { useEffect, useState } from 'react'
import type { TemplateRepeat } from '../../store/types'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { formatDay, formatRun, nextRun, upcoming } from '../../features'
import './repeat.css'

/** Re-render once a minute so a readout left open never shows a run that already happened. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export function NextRun({ repeat, then = 0 }: { repeat: TemplateRepeat; /** also list the days of this many runs after the next one (same time) */ then?: number }) {
  const t = useT()
  const lang = useLang()
  const now = useMinute()
  const next = nextRun(repeat, now)
  const later = next && then > 0 ? upcoming(repeat, next.at, then) : []
  const when = next ? formatRun(next.at, lang, new Date(now)) : ''
  return (
    <span className="rpt-next" data-state={next ? 'on' : 'ended'} title={next ? t('database.repeat.nextAria', { when }) : undefined}>
      <Led state={next ? 'on' : 'off'} />
      <span className="rpt-next__text">
        {next ? `${t('database.repeat.next')} · ${when}` : t('database.repeat.ended')}
      </span>
      {later.length > 0 && (
        <span className="rpt-next__then">
          {t('database.repeat.then')} · {later.map((o) => formatDay(new Date(o.at), lang, new Date(now))).join(' · ')}
        </span>
      )}
    </span>
  )
}
