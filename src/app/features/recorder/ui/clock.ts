/**
 * Time on the deck: the visible span (following now, it moves on only when the right edge steps — a 75 MIN tape
 * re-renders every 5 minutes, not every second) and a ticking "now" for the few parts that show seconds (the
 * counter, the playhead at now).
 */
import { useEffect, useState } from 'react'
import { followSpan, ZOOM, type Span } from '../model/axis'
import { useRecorderUI, type RecorderUI } from './state'

/** The span the deck shows for a state (outside React too). */
export function spanOfState(s: Pick<RecorderUI, 'span'>, now = Date.now()): Span & { follow: boolean } {
  if (s.span.t1 === 'now') return { ...followSpan(now, s.span.zoom), follow: true }
  return { t0: s.span.t1 - ZOOM[s.span.zoom].span, t1: s.span.t1, follow: false }
}

/** The visible span; following now, it changes only when the edge steps on. */
export function useSpan(): Span & { follow: boolean } {
  const zoom = useRecorderUI((s) => s.span.zoom)
  const t1 = useRecorderUI((s) => s.span.t1)
  const [, bump] = useState(0)
  const span = spanOfState({ span: { zoom, t1 } })
  useEffect(() => {
    if (t1 !== 'now') return
    // the edge steps when now comes within 2 % of it
    const wait = Math.max(500, span.t1 - ZOOM[zoom].span * 0.02 - Date.now() + 50)
    const id = setTimeout(() => bump((n) => n + 1), wait)
    return () => clearTimeout(id)
  }, [zoom, t1, span.t1])
  return span
}

/** Re-render every `ms` (the counter's seconds). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // tick on the second, so the counter never shows a stale one for most of a second
    let id: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      id = setTimeout(tick, ms - (Date.now() % ms) + 5)
    }
    id = setTimeout(tick, ms - (Date.now() % ms) + 5)
    return () => clearTimeout(id)
  }, [ms])
  return now
}
