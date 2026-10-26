import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useT } from '../../i18n'

/** Visible immediately, including providers that only return a complete answer.
 * Elapsed time shows activity without inventing a completion percentage or model thoughts. */
export function AskActivity({ local, receiving }: { local: boolean; receiving: boolean }) {
  const t = useT()
  const [started] = useState(() => Date.now())
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const tick = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(tick)
  }, [started])
  return <div className="ask-activity" data-testid="ask-activity">
    <LoaderCircle className="ask-activity__spin" size={18} aria-hidden />
    <div className="ask-activity__text">
      <p role="status">{t(receiving ? 'shell.ask.activity.receiving' : local ? 'shell.ask.activity.local' : 'shell.ask.activity.working')}</p>
      {local && !receiving && seconds >= 15 && <small>{t('shell.ask.activity.localHint')}</small>}
    </div>
    {/* Avoid announcing a ticking timer to screen readers every second. */}
    <span className="ask-activity__time label" aria-hidden="true" data-testid="ask-elapsed">{seconds} s</span>
  </div>
}
