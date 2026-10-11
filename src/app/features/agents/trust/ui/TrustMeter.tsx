/**
 * Per-field trust — the meter: the last 20 segments of a key, oldest left. Every detail is a cut-out in one of two
 * fills (trust.css, trust/meter.ts), never a second colour: green = applied unchanged · green with a cut foot = spot
 * check right · hollow = edited · raised with a slit = wrong · hatched = undone · a low tick = no verdict yet (the
 * label says so). `mark` rings the newest 3 or the last segment.
 */
import type { Seg } from '../rules'

export function TrustMeter({ segs, label, size = 'md', mark }: { segs: Seg[]; label: string; size?: 'sm' | 'md' | 'pop'; mark?: 'new3' | 'last' }) {
  return (
    <span className="agt-meter" data-size={size} data-mark={mark} role="img" aria-label={label}>
      {segs.map((s, i) => (
        <i key={i} className={`m-${s}`} />
      ))}
    </span>
  )
}

/** One segment as a legend swatch (decorative). */
export function TrustSwatch({ seg }: { seg: Seg }) {
  return (
    <span className="agt-meter" data-size="sm" aria-hidden="true">
      <i className={`m-${seg}`} />
    </span>
  )
}
