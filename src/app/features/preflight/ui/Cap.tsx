/**
 * One lamp cap: a key in the housing. Amber / red when lit (red always with the triangle), dark, or grey hatched when
 * the check cannot run here. A new lamp carries a chip ("+2" / "new") and blinks 3 cycles once per id set in this tab.
 * The plate moves focus between caps (2-D roving); ↵ / click acts (Plate decides what).
 */
import { memo, useMemo, type CSSProperties } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { fmtCount } from '../lamps'
import { blinkOf } from '../blink'
import { noteRender } from '../engine'
import type { Level, LampView } from '../types'

export const lampName = (legend: string) => legend.replace(/\s*\n\s*/g, ' ')

/** A legend the cap cuts (over 16 characters a line, or more than two lines): it gets a title. */
const legendCut = (legend: string) => {
  const lines = legend.split('\n')
  return lines.length > 2 || lines.some((l) => l.length > 16)
}

/** The cap's accessible name (mock.md §2.4). */
export function capLabel(t: Translate, v: Pick<LampView, 'legend' | 'level' | 'count' | 'isNew' | 'newCount' | 'why'>): string {
  const lamp = lampName(v.legend)
  const warn = v.level === 'red' ? t('features.preflight.cap.aria.warn') : ''
  if (v.level === 'grey') return t('features.preflight.cap.aria.grey', { lamp, why: t(v.why ?? 'features.preflight.grey.off') })
  if (v.level === 'dark') return v.count > 0 ? t('features.preflight.cap.aria.below', { lamp, n: v.count }) : t('features.preflight.cap.aria.dark', { lamp })
  if (!v.isNew) return warn + t('features.preflight.cap.aria.acked', { lamp, n: v.count })
  if (v.newCount >= v.count) {
    if (v.count === 1) return warn + t('features.preflight.cap.aria.oneNew', { lamp })
    if (v.count === 2) return warn + t('features.preflight.cap.aria.bothNew', { lamp, n: v.count })
    return warn + t('features.preflight.cap.aria.allNew', { lamp, n: v.count })
  }
  return warn + t('features.preflight.cap.aria.someNew', { lamp, n: v.count, k: v.newCount })
}

export interface CapProps {
  view: LampView
  /** the roving tab stop */
  tabStop: boolean
  /** the aside shows this lamp's rule (the ink double ring) */
  cursor?: boolean
  /** drawn from the last count before this tab counted (aria-busy, "…") */
  busy?: boolean
  /** when the blink may start (epoch ms; 0 = now): the lamp test's end when one is planned or running */
  flashAt: number
  /** this lamp's queue is open: "↵ 3/10" (the card's place) instead of the new chip */
  open?: string | null
  onActivate: (view: LampView, el: HTMLButtonElement) => void
  onFocus?: (view: LampView) => void
}

export const Cap = memo(function Cap({ view, tabStop, cursor, busy, flashAt, open, onActivate, onFocus }: CapProps) {
  noteRender('cap')
  const t = useT()
  const lit = view.level === 'amber' || view.level === 'red'
  const blinks = lit && view.isNew && view.flash && !busy
  const blink = useMemo(() => (blinks ? blinkOf(view.id, view.idsHash, flashAt ? Math.max(0, flashAt - Date.now()) : 0) : { on: false, delay: 0 }), [blinks, view.id, view.idsHash, flashAt])
  const count = busy ? '…' : view.level === 'grey' ? '?' : lit ? fmtCount(view.count) : '—'
  const second = view.level === 'grey' ? view.second || t('features.preflight.grey.off') : view.second
  const style = blink.on ? ({ ['--pf-flash-delay' as string]: `${Math.round(blink.delay)}ms` } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className="pf-cap"
      data-lamp={view.id}
      data-lit={lit ? view.level : undefined}
      data-grey={view.level === 'grey' || undefined}
      data-new={view.isNew || undefined}
      data-flash={blink.on || undefined}
      data-cursor={cursor || undefined}
      data-open={(open && !busy) || undefined}
      aria-busy={busy || undefined}
      aria-label={busy ? t('features.preflight.cap.aria.busy', { lamp: lampName(view.legend) }) : `${capLabel(t, view)}${open ? ` ${t('features.preflight.cap.aria.open', { pos: open })}` : ''}`}
      tabIndex={tabStop ? 0 : -1}
      title={legendCut(view.legend) ? lampName(view.legend) : undefined}
      style={style}
      onClick={(e) => onActivate(view, e.currentTarget)}
      onFocus={() => onFocus?.(view)}
    >
      <span className="pf-cap__legend">
        {view.level === 'red' && <TriangleAlert className="pf-cap__warn" size={13} strokeWidth={2.2} aria-hidden />}
        <span>{view.legend}</span>
      </span>
      {open && !busy ? (
        <span className="pf-cap__open" aria-hidden>
          ↵<span className="pf-cap__pos">{open}</span>
        </span>
      ) : null}
      {view.chip && !busy && !open && (
        <span className="pf-cap__new" aria-hidden>
          <i />
          {view.chip === 'plus' ? t('features.preflight.cap.plus', { n: view.newCount }) : t('features.preflight.cap.new')}
        </span>
      )}
      <span className="pf-cap__foot">
        <span className="pf-cap__src">{second}</span>
        <span className="pf-cap__n" aria-hidden>
          {count}
        </span>
      </span>
    </button>
  )
})

/** The swatch class of a level (tabs, the rule card, the strip). */
export const miniClass = (level: Level) => (level === 'amber' ? 'pf-mini pf-mini--amber' : level === 'red' ? 'pf-mini pf-mini--red' : level === 'grey' ? 'pf-mini pf-mini--grey' : 'pf-mini')
