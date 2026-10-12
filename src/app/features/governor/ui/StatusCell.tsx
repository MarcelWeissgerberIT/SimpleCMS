/**
 * The REGLER cell of the status bar (Regler § 10.2) — visuals and props only; StatusBar.tsx wires it (B9) to the totals
 * (useGovernorTotals), the limits and the open halt cards. It owns the amount:
 *   REGLER 4,12 $ / 6 $ [mini bar] VORSCHLAGEN   (the autonomy word comes with the lever, G2)
 * no budget → REGLER 1,56 $ · ≥ 75 % → the bar amber · at the line or a halt open → REGLER 5,71 $ / 6 $ ROTLINIE · PAUSE
 * on the lamp-red plate · AUS → KI AUS (G2) · before the first read of the day "—" (never a ledger read at first paint).
 * Shedding: the bar is level 7, the autonomy word level 8 (`status__shed7` / `status__shed8`); the amount and the LED never
 * shed. At phone width the amount alone ("5,71/6 $"), the LED keeps the state. Click → #/regler.
 */
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { fmtLimit, fmtOf } from '../format'
import { MiniBar } from './MiniBar'
import { AMBER } from '../gauge'
import './cells.css'

export type StatusCellState = 'ok' | 'pause' | 'off'

export interface StatusCellProps {
  /** spent today on the line that binds (null: not read yet — "—") */
  spent: number | null
  /** that line's limit (null: no budget) */
  limit: number | null
  /** 'pause': at the line or a halt card open · 'off': AI off (G2) */
  state?: StatusCellState
  /** the lever's word while it holds (G2) */
  autonomy?: string | null
  onOpen?: () => void
}

export function StatusCell({ spent, limit, state = 'ok', autonomy = null, onOpen }: StatusCellProps) {
  const t = useT()
  const lang = useLang()
  const known = spent !== null
  const lim = limit !== null && limit > 0 ? limit : null
  const pause = state === 'pause' || (known && lim !== null && spent >= lim)
  const amber = !pause && known && lim !== null && spent >= lim * AMBER
  const level = state === 'off' ? 'off' : pause ? 'red' : amber ? 'amber' : 'ok'
  const amount = !known ? t('features.governor.status.unknown') : lim !== null ? `${fmtUsd(spent, lang)} / ${fmtLimit(lim, lang)}` : fmtUsd(spent, lang)
  const short = !known ? t('features.governor.status.unknown') : lim !== null ? fmtOf(spent, lim, lang) : fmtUsd(spent, lang)
  const aria =
    state === 'off'
      ? t('features.governor.status.off')
      : !known
        ? t('features.governor.status.ariaUnknown')
        : pause
          ? t('features.governor.status.ariaPause')
          : lim !== null
            ? t('features.governor.status.aria', { spent: fmtUsd(spent, lang), budget: fmtUsd(lim, lang) })
            : t('features.governor.status.ariaNone', { spent: fmtUsd(spent, lang) })
  if (state === 'off')
    return (
      <button type="button" className="status__cell status__btn gv-cell" data-level="off" onClick={onOpen} title={t('features.governor.status.title')} aria-label={`${aria} — ${t('features.governor.status.title')}`}>
        <span className="led gv-cell__led" aria-hidden />
        {t('features.governor.status.off')}
      </button>
    )
  return (
    <button type="button" className="status__cell status__btn gv-cell" data-level={level} data-known={known || undefined} onClick={onOpen} title={t('features.governor.status.title')} aria-label={`${aria} — ${t('features.governor.status.title')}`}>
      <span className="led gv-cell__led" aria-hidden />
      <span className="gv-cell__name">{t('features.governor.status.cell')}</span>
      <span className="gv-cell__val gv-cell__val--wide">{amount}</span>
      <span className="gv-cell__val gv-cell__val--short">{short}</span>
      {known && lim !== null && !pause && (
        <span className="status__shed7 gv-cell__bar">
          <MiniBar spent={spent} limit={lim} size="cell" />
        </span>
      )}
      {pause ? <b className="gv-cell__word">{t('features.governor.status.pause')}</b> : autonomy ? <b className="status__shed8 gv-cell__word">{autonomy}</b> : null}
    </button>
  )
}
