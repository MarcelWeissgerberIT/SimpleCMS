/**
 * § 00 of #/regler, the VERBRAUCH part (Regler § 10.1, mock 1 — G1 without the lever's column, so it takes the width):
 * the screwed plate "§ 00 — REGLER · FR 09.10. · 14:06 … AUF DIESEM GERÄT GEMESSEN" with the dial (needle = spent today,
 * amber from 75 %, red line = day budget, dashed = yesterday's peak) and its legend, the month bar, the browser line when
 * a device limit is set ("This browser today 5,32 $ of 8,00 $ — here 4,12 $ · 2 other workspaces 1,20 $", the line that
 * binds marked), the dashed hard-limit plate (pre-brake sentence + one line per provider in use) and, in a team, the
 * server agents' line. No day budget: no red line and "Set a budget". Visuals and props only (B10 wires it).
 */
import { ShieldCheck } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { fmtScale } from '../format'
import { Screws } from '../../../ui/controls'
import { Dial } from './Dial'
import { MonthBar, type MonthBarProps } from './MonthBar'
import './governor.css'

export interface HardLine {
  /** the provider's code plate (CL · OA · OR) and its name for screen readers */
  code: string
  name: string
  text: string
  href?: string
}

export interface ConsumptionPlateProps {
  /** "Fr 09.10. · 14:06" */
  when: string
  /** spent today on this workspace and device (null: not read yet — "—") */
  spent: number | null
  /** the day's total is a lower bound until the first full read ("≈") */
  known: boolean
  budget: number | null
  /** yesterday's total */
  peak?: number | null
  month?: MonthBarProps | null
  /** the person's line for this browser (a device limit is set) */
  browser?: { total: number; limit: number; here: number; others: number; n: number; binds: boolean } | null
  hard: readonly HardLine[]
  /** a team workspace: server agents run on the workspace's key */
  server?: boolean
  onSetBudget?: () => void
}

export function ConsumptionPlate(p: ConsumptionPlateProps) {
  const t = useT()
  const lang = useLang()
  const usd = (n: number) => fmtUsd(n, lang)
  const spent = p.spent ?? 0
  const big = p.spent === null ? '—' : usd(spent)
  const of = p.budget !== null ? (spent > p.budget ? t('features.governor.dial.over', { budget: usd(p.budget), over: usd(spent - p.budget) }) : t('features.governor.dial.of', { budget: usd(p.budget), rest: usd(p.budget - spent) })) : t('features.governor.dial.ofNone')
  const label =
    p.budget !== null ? t('features.governor.dial.aria', { spent: usd(spent), budget: usd(p.budget), rest: usd(Math.max(0, p.budget - spent)) }) : t('features.governor.dial.ariaNone', { spent: usd(spent) })
  const atLine = p.budget !== null && p.spent !== null && spent >= p.budget
  return (
    <section className="screw-plate gv-plate" aria-labelledby="gv-plate-title" data-budget={p.budget !== null || undefined}>
      <Screws seed="gv-plate" />
      <header className="gv-plate__head">
        <h2 id="gv-plate-title" className="gv-plate__title label">
          <span className="gv-plate__sec">§ 00</span> — {t('features.governor.plate.title', { when: p.when })}
        </h2>
        <span className="gv-plate__rule" aria-hidden />
        <span className="label gv-plate__measured">{t('features.governor.plate.measured')}</span>
      </header>
      <div className="gv-plate__body">
        <div className="gv-plate__dial">
          <Dial value={spent} budget={p.budget} peak={p.peak ?? null} big={big} of={of} approx={!p.known && p.spent !== null} numeral={(v) => fmtScale(v, lang)} unit={t('features.governor.dial.label')} lamp={atLine} lampLabel={t('features.governor.dial.lamp')} label={p.known ? label : `${label}. ${t('features.governor.dial.approx')}`} />
          <div className="gv-legend">
            {p.budget !== null ? (
              <>
                <span className="label">
                  <span className="gv-sw gv-sw--amber" aria-hidden />
                  {t('features.governor.dial.amber')}
                </span>
                <span className="label">
                  <span className="gv-sw gv-sw--red" aria-hidden />
                  {t('features.governor.dial.red')}
                </span>
              </>
            ) : (
              <span className="label">{t('features.governor.dial.none')}</span>
            )}
            {p.peak != null && p.peak > 0 && (
              <span className="label">
                <span className="gv-sw gv-sw--tell" aria-hidden />
                {t('features.governor.dial.peak', { usd: usd(p.peak) })}
              </span>
            )}
          </div>
        </div>
        <div className="gv-plate__side">
          {p.budget === null && p.onSetBudget && (
            <button type="button" className="btn btn--primary gv-plate__set" onClick={p.onSetBudget}>
              {t('features.governor.plate.setBudget')}
            </button>
          )}
          {p.month && <MonthBar {...p.month} />}
          {p.browser && (
            <p className="gv-browser" data-binds={p.browser.binds || undefined}>
              <span className="led gv-browser__led" aria-hidden />
              <span>
                {t(p.browser.n === 1 ? 'features.governor.browser.line.one' : 'features.governor.browser.line.other', {
                  total: usd(p.browser.total),
                  limit: usd(p.browser.limit),
                  here: usd(p.browser.here),
                  n: p.browser.n,
                  others: usd(p.browser.others),
                })}
                {p.browser.binds && <b className="gv-browser__binds label"> · {t('features.governor.browser.binds')}</b>}
              </span>
            </p>
          )}
          <div className="gv-hard">
            <ShieldCheck size={14} strokeWidth={1.7} aria-hidden />
            <div>
              <p className="gv-hard__soft">{t('features.governor.soft')}</p>
              <ul className="gv-hard__list">
                {p.hard.map((h) => (
                  <li key={h.code} className="gv-hard__line">
                    <span className="gv-code" title={h.name} aria-label={h.name}>
                      {h.code}
                    </span>
                    {h.href ? (
                      <a href={h.href} target="_blank" rel="noopener noreferrer">
                        {h.text} ↗
                      </a>
                    ) : (
                      <span>{h.text}</span>
                    )}
                  </li>
                ))}
                {p.server && <li className="gv-hard__line gv-hard__line--server">{t('features.governor.server.counted')}</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
