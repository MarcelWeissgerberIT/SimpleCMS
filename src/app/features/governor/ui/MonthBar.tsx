/**
 * The month under the dial (Regler § 10.1): MONAT · OKTOBER 33,40 $ / 120,00 $, the closed days filled, today's part,
 * amber hatching from 75 % of the month budget, the forecast marker (Ø per day so far × the month's days), the red line,
 * providers' soft monthly limits as ticks; "TAG 9/31 · Ø 3,71 $ · PROGNOSE ≈ 115 $". Without a month budget the scale is
 * the forecast and there is no red line.
 */
import type { CSSProperties } from 'react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { monthBar } from '../gauge'
import { fmtLimit } from '../format'
import './governor.css'

export interface MonthBarProps {
  /** the month's name ("Oktober") */
  month: string
  spent: number
  today: number
  limit: number | null
  day: number
  days: number
  /** providers' soft monthly limits (named ticks) */
  soft?: ReadonlyArray<{ name: string; usd: number }>
}

export function MonthBar({ month, spent, today, limit, day, days, soft = [] }: MonthBarProps) {
  const t = useT()
  const lang = useLang()
  const g = monthBar({ spent, today, limit, day, days, soft: soft.map((s) => s.usd) })
  const style = { '--gv-closed': `${g.closed}%`, '--gv-today': `${g.today}%`, '--gv-fc': `${g.forecast}%`, '--gv-amber': `${g.amber ?? 100}%` } as CSSProperties
  // the "≈" belongs to the visible amount; the spoken sentence has its own
  const projected = fmtLimit(Math.round(g.projection), lang)
  const forecast = `≈\u00a0${projected}`
  const aria = t('features.governor.month.aria', { spent: fmtUsd(spent, lang), limit: limit !== null ? t('features.governor.month.ariaLimit', { limit: fmtUsd(limit, lang) }) : '', forecast: projected })
  return (
    <div className="gv-month" data-over={g.over || undefined}>
      <div className="gv-month__row">
        <span className="label">{t('features.governor.month.title', { month })}</span>
        <span className="gv-spacer" />
        <span className="gv-month__val">
          {fmtUsd(spent, lang)} <span className="gv-dim">/ {limit !== null ? fmtUsd(limit, lang) : t('features.governor.month.none')}</span>
        </span>
      </div>
      <div className="gv-month__bar" style={style} role="img" aria-label={aria}>
        {g.amber !== null && <span className="gv-month__amber" />}
        <span className="gv-month__closed" />
        <span className="gv-month__today" />
        <span className="gv-month__ticks" />
        {g.soft.map((x) => (
          <span key={x.i} className="gv-month__soft" style={{ left: `${x.at}%` }} title={t('features.governor.month.soft', { name: soft[x.i]?.name ?? '' })} />
        ))}
        <span className="gv-month__fc" />
        {g.red !== null && <span className="gv-month__red" />}
      </div>
      <div className="gv-month__foot">
        <span className="label">{t('features.governor.month.day', { day, days, avg: fmtUsd(g.average, lang) })}</span>
        <span className="label">
          {t('features.governor.month.forecast')} <b>{forecast}</b>
        </span>
      </div>
    </div>
  )
}
