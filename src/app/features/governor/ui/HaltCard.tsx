/**
 * The halt card (Regler § 5.6, mock 3) — the AI terminal's pause between two steps when the next one would cross the red
 * line. Visuals and props only; agent/session.ts renders it in the log (B6, lazily — with a fallback text while it
 * loads) and owns what the keys do. Nothing is reserved while it waits; nothing is lost, nothing sent.
 *  - the mini dial: needle = spent, dashed signal segment from the needle to where the step would end, red line = limit;
 *  - the sentence (today, rest, the next step's band with the model, "up to ≈ X — over the red line"), what is staged and
 *    what the task has cost;
 *  - keys: E "+1 $ once" (only when that makes the step fit, else "Needs ≈ +X $"), H "Finish with <cheaper model of the
 *    same provider>" with its band (the cold cache included — the line under the keys says so), the stop key (Mod+.,
 *    which works anywhere in the dock);
 *  - the foot: allowing counts for this task and today only, the pre-brake sentence, the hard limit per provider.
 * It takes focus when it appears; E and H act only with focus inside it (never in a field); Esc hands focus back to the
 * prompt (still paused). A polite live region says what happened and which keys there are.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Gauge, Snowflake } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { typing } from '../../../ui/keys'
import { useFocusWhenShown } from '../../../ui/focus'
import { isMac, shortcutLabel } from '../../../ui/controls'
import { fmtBand, fmtLimit, fmtScale, fmtTok } from '../format'
import type { Band } from '../estimate'
import type { Binding } from '../limits'
import { Dial } from './Dial'
import './cells.css'
import './governor.css'

export interface HaltCardProps {
  binding: Binding
  /** the binding line: spent and limit; the lowest rest */
  spent: number
  limit: number
  rest: number
  /** the next step's band (null: no price) and where the needle would end (spent + next.high) */
  next: Band | null
  to: number
  /** the current model's label */
  model: string
  /** what E allows (null: E would not make it fit) */
  allow: number | null
  /** H: a cheaper model of the same provider, its band with the cold cache, the cache write and the context it writes */
  cheaper: { label: string; band: Band; cold: number; tokens: number } | null
  /** changes staged so far and what the task cost */
  staged: number
  taskUsd: number
  /** when it paused */
  at: number
  /** waited over 5 minutes: every band is counted with a cold cache now */
  stale?: boolean
  /** the hard limit per provider in use, worded (PROVIDERS[p].hardLimit — B10) */
  hard: string
  /** take focus when shown (default true) */
  autoFocus?: boolean
  onAllow: () => void
  onCheaper: () => void
  onStop: () => void
  /** Esc: focus back to the prompt */
  onEscape?: () => void
}

const hm = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function HaltCard(p: HaltCardProps) {
  const t = useT()
  const lang = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const focus = useFocusWhenShown(ref)
  useEffect(() => {
    if (p.autoFocus !== false) focus()
  }, [focus, p.autoFocus])
  const usd = (n: number) => fmtUsd(Math.max(0, n), lang)
  const canAllow = p.allow !== null
  const need = p.next ? Math.max(0, p.next.high - p.rest) : 0
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (!p.onEscape) return
      e.preventDefault()
      e.stopPropagation()
      p.onEscape()
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target as Element)) return
    const k = e.key.toLowerCase()
    if (k === 'e' && canAllow) {
      e.preventDefault()
      p.onAllow()
    } else if (k === 'h' && p.cheaper) {
      e.preventDefault()
      p.onCheaper()
    }
  }
  const staged = p.staged > 0 ? t(p.staged === 1 ? 'features.governor.halt.staged.one' : 'features.governor.halt.staged.other', { count: p.staged }) : t('features.governor.halt.staged.none')
  const lead = p.next
    ? t('features.governor.halt.lead', { spent: usd(p.spent), limit: usd(p.limit), rest: usd(p.rest), model: p.model, band: fmtBand(p.next, lang), to: usd(p.to) })
    : t('features.governor.halt.leadNoPrice', { spent: usd(p.spent), limit: usd(p.limit), rest: usd(p.rest), model: p.model })
  const dialLabel = t('features.governor.dial.ariaNext', { spent: usd(p.spent), budget: usd(p.limit), next: usd(p.to) })
  return (
    <div ref={ref} className="gv-halt" role="group" aria-label={t('features.governor.halt.aria')} tabIndex={-1} onKeyDown={onKey} data-testid="gv-halt">
      <p className="visually-hidden" aria-live="polite">
        {t(isMac ? 'features.governor.halt.live.mac' : 'features.governor.halt.live.pc')}
      </p>
      <div className="gv-halt__head">
        <span className="gv-lamp">
          <Gauge size={12} strokeWidth={1.8} aria-hidden />
          {t('features.governor.halt.lamp')}
        </span>
        <span className="gv-halt__title">{t(`features.governor.halt.title.${p.binding}`)}</span>
        <span className="gv-spacer" />
        <span className="gv-halt__when">
          {hm(p.at)} · {t('features.governor.halt.safe')}
        </span>
      </div>
      <div className="gv-halt__body">
        <div className="gv-halt__dial">
          <Dial mini numeral={(v) => fmtScale(v, lang)} value={p.spent} budget={p.limit} next={p.to} big={usd(p.spent)} of={t('features.governor.dial.next', { usd: usd(p.to) })} lamp lampLabel={t('features.governor.dial.lamp')} label={dialLabel} />
        </div>
        <div className="gv-halt__right">
          <p className="gv-halt__msg">
            {lead}
            <span className="gv-halt__sub">{t('features.governor.halt.sub', { staged, usd: usd(p.taskUsd) })}</span>
          </p>
          <div className="gv-halt__keys">
            {canAllow ? (
              <button type="button" className="btn btn--primary gv-key" onClick={p.onAllow}>
                <span className="kbd">E</span>
                {t('features.governor.halt.allow', { usd: fmtLimit(p.allow ?? 0, lang) })}
              </button>
            ) : (
              <span className="gv-halt__need label">{t('features.governor.halt.need', { usd: usd(need) })}</span>
            )}
            {p.cheaper && (
              <button type="button" className="btn gv-key" onClick={p.onCheaper}>
                <span className="kbd">H</span>
                {t('features.governor.halt.cheaper', { model: p.cheaper.label })}
                <span className="gv-key__band">≈ {fmtBand(p.cheaper.band, lang)}</span>
              </button>
            )}
            <button type="button" className="btn gv-key" onClick={p.onStop}>
              <span className="kbd">{shortcutLabel('Mod+.')}</span>
              {t('features.governor.halt.stop')}
            </button>
          </div>
          {p.stale && <p className="gv-halt__stale label">{t('features.governor.halt.stale')}</p>}
          <p className="gv-halt__cold">
            <Snowflake size={14} strokeWidth={1.7} aria-hidden />
            {p.cheaper ? (
              <span>
                <b>{t('features.governor.halt.coldTitle', { model: p.cheaper.label })}</b> {t('features.governor.halt.cold', { tokens: fmtTok(p.cheaper.tokens, lang), usd: usd(p.cheaper.cold) })}
              </span>
            ) : (
              <span>{t('features.governor.halt.noCheaper')}</span>
            )}
          </p>
          <p className="gv-halt__foot">{t('features.governor.halt.foot', { soft: t('features.governor.soft'), hard: p.hard })}</p>
        </div>
      </div>
    </div>
  )
}
