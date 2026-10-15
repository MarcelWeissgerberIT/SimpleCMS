/**
 * The readout strip (plan §3.3, §6 U11 / U15): MODULES 17 · 3 idle — CABLES 15 · 3 chosen by the AI — RUNS TODAY 6 ·
 * $0.27 — the FUSE cell — and, right-aligned, LIVE · THIS DEVICE 07:30:04. Every number matches what is drawn or named
 * as folded. The FUSE cell is a button (selects the first open fuse and brings its plate into view) and has four states:
 * open (LED + count in signal ink) · none open (LED off, no signal ink) · all allowed ("0 open · 1 allowed") · unknown
 * parts ("· 2 unknown" + a grey "?" — unknown never reads as safe). The phone shows only RUNS TODAY and FUSE (§3.8);
 * a strip too short for one line (XL text, a narrow window) sheds LIVE, then CABLES, then MODULES — never wraps. The
 * phone's own tiers: the money leaves RUNS, then RUNS goes, then the FUSE cell wraps to a second line — the unknown
 * part and its "?" are never cut.
 *
 * B12 — a profile's setup: MODULES and CABLES name what the profile adds ("10 + 4 from profile · 3 idle", "7 + 5
 * planned") whenever its ghosts are drawn; the drop visit's strip (the band) reads SETUP 4/7 in place of RUNS TODAY and
 * the date and time in place of LIVE (mock-2); the phone shows SETUP and FUSE then.
 */
import { useRef } from 'react'
import { fmtUsd } from '../../../lib/money'
import type { Translate } from '@/shared/i18n'
import type { Model, ModuleCost } from '../types'
import { useFitTier } from './fit'
import { clockTime } from './liveWin'
import { useNow } from './now'

const P = 'features.patchbay'

export interface FuseCount {
  open: number
  allowed: number
  unknown: number
}

/** The live clock: hh:mm:ss, ticking every second only while the route shows and the tab is visible (ui/now.ts). */
function useClock(lang: string): string {
  const now = useNow(true)
  return clockTime(now, lang)
}

/** "Fri 09.10." — the drop visit's date beside the time (mock-2). */
const dayOf = (lang: string): string => {
  const d = new Date()
  const loc = lang === 'de' ? 'de-DE' : 'en-GB'
  const wd = new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d).replace(/\.$/, '')
  return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

export interface ReadoutSetup {
  done: number
  total: number
  /** the drop visit (the band): SETUP in place of RUNS TODAY, the date in place of LIVE */
  band: boolean
}

export function Readout({ t, lang, model, runs, money, costsRead, fuses, phone, onFuse, setup }: { t: Translate; lang: 'en' | 'de'; model: Model; runs: number; money: ModuleCost; costsRead: boolean; fuses: FuseCount; phone: boolean; onFuse: () => void; setup?: ReadoutSetup | null }) {
  const clock = useClock(lang)
  const c = model.counts
  const ghosts = c.ghosts ?? 0
  const planned = c.planned ?? 0
  const band = !!setup?.band
  const moneyText = !costsRead ? '—' : money.usd > 0 ? `${money.estimate ? '≈ ' : ''}${fmtUsd(money.usd, lang)}` : money.unpriced > 0 ? t(`${P}.ro.priceUnknown`) : fmtUsd(0, lang)
  const open = fuses.open
  const fuseText = open > 0 ? String(open) : fuses.allowed > 0 ? t(`${P}.ro.allowed`, { n: 0, m: fuses.allowed }) : t(`${P}.ro.noneOpen`)
  // one line: a short strip sheds LIVE, then CABLES, then MODULES (measured — the clock's width never changes)
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFitTier(ref, 3, `${lang}|${phone}|${c.modules}|${c.idle}|${c.cables}|${c.dashed}|${runs}|${moneyText}|${fuseText}|${fuses.unknown}|${ghosts}|${planned}|${setup?.done ?? ''}|${band}`)
  return (
    <div className="pb-ro" ref={ref} data-fit={fit || undefined} data-phone={phone || undefined} role="group" aria-label={t(`${P}.ro.aria`)} data-testid="pb-readout">
      {!phone && (
        <>
          <span className="pb-ro__cell" data-cell="modules">
            <span className="label">{t(`${P}.ro.modules`)}</span>
            <span className="pb-ro__val" data-testid="pb-ro-modules">
              {c.modules - ghosts}
              {ghosts > 0 && <span className="pb-ro__dim"> {t(`${P}.ro.fromProfile`, { n: ghosts })}</span>}
              {c.idle > 0 && <span className="pb-ro__dim"> · {t(`${P}.ro.idle`, { n: c.idle })}</span>}
            </span>
          </span>
          <span className="pb-ro__cell" data-cell="cables">
            <span className="label">{t(`${P}.ro.cables`)}</span>
            <span className="pb-ro__val" data-testid="pb-ro-cables">
              {c.cables - planned}
              {planned > 0 && <span className="pb-ro__dim"> {t(`${P}.ro.planned`, { n: planned })}</span>}
              {c.dashed > 0 && !band && <span className="pb-ro__dim"> · {t(`${P}.ro.byAI`, { n: c.dashed })}</span>}
            </span>
          </span>
        </>
      )}
      {band && setup ? (
        <span className="pb-ro__cell" data-cell="setup">
          <span className="led" aria-hidden="true" />
          <span className="label">{t(`${P}.ro.setup`)}</span>
          <span className="pb-ro__val" data-testid="pb-ro-setup">
            {setup.done}/{setup.total}
          </span>
        </span>
      ) : (
        <span className="pb-ro__cell" data-cell="runs" title={t(`${P}.ro.runsTitle`)}>
          <span className="label">{t(`${P}.ro.runs`)}</span>
          <span className="pb-ro__val" data-testid="pb-ro-runs">
            {runs}
            <span className="pb-ro__dim pb-ro__money"> · {moneyText}</span>
          </span>
        </span>
      )}
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
          {band ? (
            <span className="pb-ro__cell pb-ro__cell--end" data-cell="live">
              <span className="label">{dayOf(lang)}</span>
              <span className="pb-ro__val" aria-hidden="true">
                {clock.slice(0, 5)}
              </span>
            </span>
          ) : (
            <span className="pb-ro__cell pb-ro__cell--end" data-cell="live">
              <span className="led led--on" aria-hidden="true" />
              <span className="label">{t(`${P}.ro.live`)}</span>
              <span className="pb-ro__val" aria-hidden="true">
                {clock}
              </span>
            </span>
          )}
        </>
      )}
    </div>
  )
}
