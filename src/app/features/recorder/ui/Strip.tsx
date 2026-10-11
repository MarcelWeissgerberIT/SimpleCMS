/**
 * The last 24 hours (ending at the tape's right edge): 96 quarter-hour bars, hot where they overlap the window, the
 * visible span as a box, a mark every 3 hours (the first and each midnight with the weekday). A click moves the tape
 * there.
 */
import { memo, useMemo } from 'react'
import { useLang, useT } from '../../../i18n'
import { barHeights, DAY, quarterHot, stripRange, stripTicks, type Span } from '../model/axis'
import { spanTo } from './actions'
import { fmtStripDay } from './format'
import type { Bracket } from './state'

export const Strip = memo(function Strip({ span, counts, q0, bracket }: { span: Span; counts: Record<number, number> | null; q0: number | null; bracket: Bracket | null }) {
  const t = useT()
  const lang = useLang()
  const r = stripRange(span.t1)
  const bars = useMemo(() => {
    const out = new Array<number>(96)
    for (let i = 0; i < 96; i++) out[i] = counts && q0 !== null ? (counts[r.q0 + i] ?? 0) : 0
    return barHeights(out)
  }, [counts, q0, r.q0])
  const ticks = useMemo(() => stripTicks(r.from, r.to), [r.from, r.to])
  const pos = (time: number) => ((time - r.from) / DAY) * 100
  const winL = Math.max(0, pos(span.t0))
  const winR = Math.min(100, pos(span.t1))
  return (
    <div
      className="ov"
      role="button"
      tabIndex={-1}
      aria-label={t('features.recorder.deck.stripAria')}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        spanTo(r.from + ((e.clientX - box.left) / box.width) * DAY)
      }}
    >
      <div className="ov__bars" aria-hidden="true">
        {bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} data-hot={quarterHot(r.q0 + i, bracket) && h > 0 ? '' : undefined} />
        ))}
      </div>
      {ticks.map((k) => (
        <span key={k.t} className="ov__tick" style={{ left: `${pos(k.t)}%` }} aria-hidden="true">
          {k.day ? fmtStripDay(t, lang, k.t) : String(new Date(k.t).getHours()).padStart(2, '0')}
        </span>
      ))}
      <span className="ov__win" style={{ left: `${winL}%`, width: `${Math.max(0, winR - winL)}%` }} aria-hidden="true" />
    </div>
  )
})
