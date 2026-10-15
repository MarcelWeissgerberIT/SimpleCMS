/**
 * The readout strip (plan §3.3, §6 U11 / U15): MODULES 17 · 3 idle — CABLES 15 · 3 chosen by the AI — RUNS TODAY 6 ·
 * $0.27 — the FUSE cell — and, right-aligned, LIVE · THIS DEVICE 07:30:04. Every number matches what is drawn or named
 * as folded. The FUSE cell is a button (selects the first open fuse and brings its plate into view) and has four states:
 * open (LED + count in signal ink) · none open (LED off, no signal ink) · all allowed ("0 open · 1 allowed") · unknown
 * parts ("· 2 unknown" + a grey "?" — unknown never reads as safe). The phone shows only RUNS TODAY and FUSE (§3.8);
 * a strip too short for one line (XL text, a narrow window) sheds LIVE, then CABLES, then MODULES — never wraps. The
 * phone's own tiers: the money leaves RUNS, then RUNS goes, then the FUSE cell wraps to a second line — the unknown
 * part and its "?" are never cut.
 */
import { useEffect, useRef, useState } from 'react'
import { fmtUsd } from '../../../lib/money'
import type { Translate } from '@/shared/i18n'
import type { Model, ModuleCost } from '../types'
import { useFitTier } from './fit'

const P = 'features.patchbay'

export interface FuseCount {
  open: number
  allowed: number
  unknown: number
}

/** The live clock: hh:mm:ss, ticking every second while the tab is visible. */
const clockOf = (lang: string): string => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())

function useClock(lang: string): string {
  const [now, setNow] = useState(() => clockOf(lang))
  useEffect(() => {
    let id = 0
    const tick = () => {
      if (document.visibilityState === 'visible') setNow(clockOf(lang))
    }
    const start = () => {
      window.clearInterval(id)
      tick()
      id = window.setInterval(tick, 1000)
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', start)
    }
  }, [lang])
  return now
}

export function Readout({ t, lang, model, runs, money, costsRead, fuses, phone, onFuse }: { t: Translate; lang: 'en' | 'de'; model: Model; runs: number; money: ModuleCost; costsRead: boolean; fuses: FuseCount; phone: boolean; onFuse: () => void }) {
  const clock = useClock(lang)
  const c = model.counts
  const moneyText = !costsRead ? '—' : money.usd > 0 ? `${money.estimate ? '≈ ' : ''}${fmtUsd(money.usd, lang)}` : money.unpriced > 0 ? t(`${P}.ro.priceUnknown`) : fmtUsd(0, lang)
  const open = fuses.open
  const fuseText = open > 0 ? String(open) : fuses.allowed > 0 ? t(`${P}.ro.allowed`, { n: 0, m: fuses.allowed }) : t(`${P}.ro.noneOpen`)
  // one line: a short strip sheds LIVE, then CABLES, then MODULES (measured — the clock's width never changes)
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFitTier(ref, 3, `${lang}|${phone}|${c.modules}|${c.idle}|${c.cables}|${c.dashed}|${runs}|${moneyText}|${fuseText}|${fuses.unknown}`)
  return (
    <div className="pb-ro" ref={ref} data-fit={fit || undefined} data-phone={phone || undefined} role="group" aria-label={t(`${P}.ro.aria`)} data-testid="pb-readout">
      {!phone && (
        <>
          <span className="pb-ro__cell" data-cell="modules">
            <span className="label">{t(`${P}.ro.modules`)}</span>
            <span className="pb-ro__val" data-testid="pb-ro-modules">
              {c.modules}
              {c.idle > 0 && <span className="pb-ro__dim"> · {t(`${P}.ro.idle`, { n: c.idle })}</span>}
            </span>
          </span>
          <span className="pb-ro__cell" data-cell="cables">
            <span className="label">{t(`${P}.ro.cables`)}</span>
            <span className="pb-ro__val" data-testid="pb-ro-cables">
              {c.cables}
              {c.dashed > 0 && <span className="pb-ro__dim"> · {t(`${P}.ro.byAI`, { n: c.dashed })}</span>}
            </span>
          </span>
        </>
      )}
      <span className="pb-ro__cell" data-cell="runs" title={t(`${P}.ro.runsTitle`)}>
        <span className="label">{t(`${P}.ro.runs`)}</span>
        <span className="pb-ro__val" data-testid="pb-ro-runs">
          {runs}
          <span className="pb-ro__dim pb-ro__money"> · {moneyText}</span>
        </span>
      </span>
      <button type="button" className="pb-ro__cell pb-ro__fuse" data-cell="fuse" data-open={open > 0 || undefined} title={open > 0 ? t(`${P}.ro.fuseTitle`) : undefined} onClick={onFuse} aria-disabled={open > 0 ? undefined : 'true'} data-testid="pb-ro-fuse">
        <span className={open > 0 ? 'led led--on pb-ro__led' : 'led pb-ro__led'} aria-hidden="true" />
        <span className="label">{t(`${P}.ro.fuse`)}</span>
        <span className={open > 0 ? 'pb-ro__val pb-ro__val--sig' : 'pb-ro__val pb-ro__val--quiet'} data-testid="pb-ro-fuse-val">
          {fuseText}
        </span>
        {fuses.unknown > 0 && (
          <span className="pb-ro__unknown" data-testid="pb-ro-unknown">
            <span className="pb-ro__dim">· {t(`${P}.ro.unknown`, { n: fuses.unknown })}</span>
            <span className="pb-tag pb-tag--q" aria-hidden="true">
              ?
            </span>
          </span>
        )}
      </button>
      {!phone && (
        <>
          <span className="pb-ro__sp" />
          <span className="pb-ro__cell pb-ro__cell--end" data-cell="live">
            <span className="led led--on" aria-hidden="true" />
            <span className="label">{t(`${P}.ro.live`)}</span>
            <span className="pb-ro__val" aria-hidden="true">
              {clock}
            </span>
          </span>
        </>
      )}
    </div>
  )
}
