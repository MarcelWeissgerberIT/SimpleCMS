/**
 * The tape counter, a recessed window: STAND / JETZT over the day, ZEIT over the time (orange while the playhead is
 * not at now). At now it ticks every second on its own — nothing else on the deck re-renders for the clock.
 */
import { useLang, useT } from '../../../i18n'
import { useNow } from './clock'
import { fmtDayLong, fmtDayShort, hms } from './format'
import { useRecorderUI } from './state'

export function Counter() {
  const t = useT()
  const lang = useLang()
  const playhead = useRecorderUI((s) => s.playhead)
  const now = useNow(1000)
  const at = playhead ?? now
  const back = playhead !== null
  const date = fmtDayLong(t, lang, at)
  const aria = back ? t('features.recorder.deck.counter.aria', { date, time: hms(at) }) : t('features.recorder.deck.counter.ariaNow', { date, time: hms(at) })
  return (
    <span className="counter" role="img" aria-label={aria}>
      <span className="counter__cell counter__cell--day">
        <span className="counter__lbl">{t(back ? 'features.recorder.deck.counter.at' : 'features.recorder.deck.counter.now')}</span>
        <span className="counter__val">{fmtDayShort(t, lang, at)}</span>
      </span>
      <span className="counter__cell">
        <span className="counter__lbl">{t('features.recorder.deck.counter.time')}</span>
        <span className="counter__val" data-sig={back ? '' : undefined}>
          {hms(at)}
        </span>
      </span>
    </span>
  )
}
