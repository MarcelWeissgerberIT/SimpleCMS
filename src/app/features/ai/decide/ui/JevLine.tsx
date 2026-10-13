/**
 * The Jev line of a proposal card (slice SJ, § 5.5) — Preflight and the run review draw it through AgentChangeBody:
 *   OR JEV  ▕█████▍    ▏ 0,41   „Stimmt mit der Zeile überein?"   unter 0,70   0,00004 $   [4 Prüfungen ▾]
 * Concerns only, never a positive stamp: clear = a dim line without a number in front · near the threshold = neutral ·
 * marked = the amber cap BEDENKEN · JEV + meter · held = the amber cap ZURÜCKGEHALTEN + why · not pre-checked = dim, why.
 * Sticky ("Nur markieren": an earlier change here still waits) is not a concern of Jev's: the line Jev's answer gives
 * (or "not pre-checked" and why) plus the reason — the BEDENKEN cap only when Jev marked it.
 * A run that read text from outside (mails, MCP results, new rows) adds a second dim line: high values are no guarantee.
 * "4 Prüfungen ▾" lists the four questions with their values — a plain button (no card key; Enter is its click).
 */
import { useId, useState } from 'react'
import { useLang, useT } from '../../../../i18n'
import { fmtCost } from '../../../../lib/money'
import { JEV_CHECK_KEYS, nearOf, sanitizeJevCheck, type JevCheck } from '@/shared/ai/decide'
import { JEV_DEFAULTS } from '@/shared/ai/jev'
import type { Lang } from '@/shared/i18n'
import { checkReason, questionLabel, whyText } from '../text'
import '../decide.css'

const fmts = new Map<Lang, Intl.NumberFormat>()
/** A probability or threshold in the UI's decimal sign, two decimals ("0,41" · "0.41"). */
export function fmtP(p: number, lang: Lang): string {
  let f = fmts.get(lang)
  if (!f) fmts.set(lang, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })))
  return f.format(p)
}

/** The meter: 64 × 6, a tick at the threshold, amber below it. */
function Meter({ p, at, text }: { p: number; at: number; text: string }) {
  const low = Math.round(p * 100) < Math.round(at * 100)
  return (
    <span className="jev-meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={p} aria-valuetext={text} data-low={low || undefined}>
      <span className="jev-meter__fill" style={{ width: `${Math.round(p * 100)}%` }} />
      <span className="jev-meter__tick" style={{ left: `${Math.round(at * 100)}%` }} />
    </span>
  )
}

export interface JevLineProps {
  /** the change's check (as stored — read again here) */
  check: unknown
  /** the threshold the run marked below (else the start value) */
  markBelow?: number
  /** the run read text from outside: mails, MCP results, rows it started on */
  foreign?: boolean
  /** the row's head carries the HELD BACK cap already: only the reason here */
  capped?: boolean
}

export function JevLine({ check, markBelow = JEV_DEFAULTS.markBelow, foreign = false, capped = false }: JevLineProps) {
  const t = useT()
  const lang = useLang()
  const id = useId()
  const [open, setOpen] = useState(false)
  const c: JevCheck | null = sanitizeJevCheck(check)
  if (!c) return null
  const ok = c.state === 'ok' && !!c.checks && c.low !== undefined && c.p !== undefined
  const marked = ok && !!c.mark
  const near = ok && !marked && nearOf(c, markBelow)
  const th = fmtP(markBelow, lang)
  const label = ok ? checkReason(t, c) : ''
  const valueText = (p: number, q: string, low: boolean) => (low ? t('features.ai.jev.meter.low', { p: fmtP(p, lang), t: th, q }) : t('features.ai.jev.meter.ok', { p: fmtP(p, lang), q }))
  const state = c.held ? 'held' : marked ? 'marked' : !ok ? 'skipped' : near ? 'near' : 'clear'
  // an earlier change of this agent here still waits (DJ20) — said beside whatever Jev's own answer was
  const sticky = !c.held && !marked && !!c.sticky
  const cost = typeof c.usd === 'number' && c.usd > 0 ? fmtCost(c.usd, lang) : ''
  const toggle = ok && (
    <button type="button" className="jev-line__more" aria-expanded={open} aria-controls={`${id}-checks`} onClick={() => setOpen((o) => !o)} data-testid="jev-more">
      {t('features.ai.jev.line.checks', { n: JEV_CHECK_KEYS.length })} <span aria-hidden>{open ? '▴' : '▾'}</span>
    </button>
  )
  // the weakest check, drawn (marked: amber below the threshold)
  const meter = ok && (marked || c.held === 'mark') && (
    <>
      <Meter p={c.p!} at={markBelow} text={valueText(c.p!, label, true)} />
      <span className="jev-line__p mono" aria-hidden>
        {fmtP(c.p!, lang)}
      </span>
      <span className="jev-line__q">{t('features.ai.jev.line.q', { q: label })}</span>
      <span className="jev-line__th mono">{t('features.ai.jev.line.low', { t: th })}</span>
    </>
  )
  const heldWhy = c.held === 'mark' ? t('features.ai.jev.held.mark') : c.held === 'sticky' ? t('features.ai.jev.held.sticky') : c.held === 'unchecked' ? t('features.ai.jev.held.unchecked') : ''
  return (
    <div className="jev-line" data-part="jev" data-state={state} data-sticky={sticky || undefined} data-testid="jev-line">
      <div className="jev-line__row">
        <span className="jev-line__plate mono" aria-hidden>
          OR
        </span>
        {state === 'held' ? (
          <>
            {!capped && (
              <span className="jev-cap" data-testid="jev-cap">
                {t('features.ai.jev.cap.held')}
              </span>
            )}
            <span className="jev-line__why">
              {heldWhy}
              {c.held === 'unchecked' && <span className="jev-line__dim"> · {whyText(t, c.why, c.cls)}</span>}
            </span>
            {meter}
          </>
        ) : state === 'marked' ? (
          <>
            <span className="jev-cap" data-testid="jev-cap">
              {t('features.ai.jev.cap.concern')}
            </span>
            {meter}
            {c.sticky && <span className="jev-line__why">{t('features.ai.jev.held.sticky')}</span>}
          </>
        ) : state === 'near' ? (
          <span className="jev-line__text">{t('features.ai.jev.line.near', { q: label, p: fmtP(c.p!, lang) })}</span>
        ) : state === 'clear' ? (
          <span className="jev-line__text jev-line__dim">{t('features.ai.jev.line.clear', { t: th })}</span>
        ) : (
          <span className="jev-line__text jev-line__dim">{t('features.ai.jev.line.skipped', { why: whyText(t, c.why, c.cls) })}</span>
        )}
        {sticky && (
          <span className="jev-line__why" data-testid="jev-sticky">
            {t('features.ai.jev.held.sticky')}
          </span>
        )}
        {cost && <span className="jev-line__usd mono">{cost}</span>}
        {toggle}
      </div>
      {open && ok && (
        <ul className="jev-checks" id={`${id}-checks`} aria-label={t('features.ai.jev.line.checksAria')}>
          {JEV_CHECK_KEYS.map((k) => {
            const p = c.checks![k]
            const q = questionLabel(t, k)
            const low = Math.round(p * 100) < Math.round(markBelow * 100)
            return (
              <li key={k} className="jev-checks__row" data-low={low || undefined}>
                <span className="jev-checks__q">{q}</span>
                <Meter p={p} at={markBelow} text={valueText(p, q, low)} />
                <span className="jev-checks__p mono" aria-hidden>
                  {fmtP(p, lang)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {foreign && (state === 'clear' || state === 'near' || state === 'marked' || (state === 'held' && ok)) && <p className="jev-line__foreign jev-line__dim">{t('features.ai.jev.foreign')}</p>}
    </div>
  )
}
