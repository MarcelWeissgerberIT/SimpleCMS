/**
 * Settings › AI — "My limit in this browser" (Regler § 10.7, owner decision 1): the person's own day / month line for
 * this browser (localStorage one.governor.device — never synced, never in a backup), counted against every workspace
 * and account signed in here. Says what it counts today ("today $5.32 (here $4.12)") once the day is read, and, when
 * the workspace has a day budget too, which red line applies (the lower). Amounts in the UI's language (parseAmount);
 * out of range refused. Written with writeDeviceLimit() — the line and this workspace's device stamp in one press.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactElement } from 'react'
import { GOVERNOR_RANGES, isReadableDeviceGovernor, isReadableGovernor } from '@/shared/ai/governor'
import { useWorkspace } from '../../../store/store'
import { useLang, useT } from '../../../i18n'
import { fmtAmount, fmtUsd, parseAmount, usdSignAfter } from '../../../lib/money'
import { readDeviceLimit } from '../device'
import { writeDeviceLimit } from '../line'
import { deviceSnapshot, subscribeDevice } from '../statusGate'
import { useGovernorTotals } from '../totals'
import { openRegler } from '../lampSource'
import './governor.css'
import './page.css'

type Field = 'day' | 'month'

const text = (v: number | undefined, lang: string) => (v === undefined ? '' : fmtAmount(v, lang).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, ''))

export function DeviceBrake() {
  const t = useT()
  const lang = useLang()
  const id = useId()
  // this tab's own writes stamp settings.ai (re-render); another tab's arrive as a storage event
  useWorkspace((s) => s.settings.ai)
  useSyncExternalStore(subscribeDevice, deviceSnapshot, () => '')
  const stored = readDeviceLimit()
  const dev = isReadableDeviceGovernor(stored) ? stored : undefined
  const newer = stored !== undefined && !dev
  const ws = useWorkspace((s) => (isReadableGovernor(s.governor) ? s.governor : undefined))
  const totals = useGovernorTotals()
  const [vals, setVals] = useState<Record<Field, string>>(() => ({ day: text(dev?.day, lang), month: text(dev?.month, lang) }))
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({})
  const [said, setSaid] = useState('')
  const [dirty, setDirty] = useState(false)
  // Remove goes with its own press: the keyboard to the day field (never the body)
  const dayRef = useRef<HTMLInputElement>(null)
  const [handOn, setHandOn] = useState(false)
  useEffect(() => {
    if (!handOn) return
    dayRef.current?.focus()
    setHandOn(false)
  }, [handOn])

  useEffect(() => {
    if (!dirty) setVals({ day: text(dev?.day, lang), month: text(dev?.month, lang) })
  }, [dev?.day, dev?.month, lang, dirty])

  const read = (f: Field): { ok: true; v: number | null } | { ok: false; err: string } => {
    const s = vals[f].trim()
    if (!s) return { ok: true, v: null }
    const n = parseAmount(s, lang)
    if (n === null) return { ok: false, err: t('features.governor.budget.err.number', { example: fmtAmount(1.5, lang).replace(/0$/, '') }) }
    const [lo, hi] = GOVERNOR_RANGES[f]
    if (n < lo || n > hi) return { ok: false, err: t('features.governor.budget.err.range', { low: fmtUsd(lo, lang), high: fmtUsd(hi, lang) }) }
    return { ok: true, v: n }
  }

  const write = (next: { day: number | null; month: number | null } | null, ok: string) => {
    const r = writeDeviceLimit(next)
    if (!r.ok) return setSaid(t(r.why === 'newer' ? 'features.governor.set.newer' : 'features.governor.device.storage'))
    setDirty(false)
    setSaid(ok)
  }

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    const d = read('day')
    const m = read('month')
    setErrs({ ...(d.ok ? {} : { day: d.err }), ...(m.ok ? {} : { month: m.err }) })
    if (!d.ok || !m.ok) return
    write(d.v === null && m.v === null ? null : { day: d.v, month: m.v }, d.v === null && m.v === null ? t('features.governor.device.removed') : t('features.governor.budget.saved'))
  }

  const set = dev?.day !== undefined || dev?.month !== undefined
  const known = totals.known && totals.at > 0
  const sign = (input: ReactElement) => (usdSignAfter(lang) ? [input, <span key="s" className="gv-budget__sign">$</span>] : [<span key="s" className="gv-budget__sign">$</span>, input])

  return (
    <section className="aip__section gv-device" aria-labelledby={`${id}-t`} data-testid="gv-device">
      <h4 className="aip__h" id={`${id}-t`}>
        {t('features.governor.device.title')} <span className="label">{t('features.governor.device.head')}</span>
      </h4>
      <p className="aip__muted" data-testid="gv-device-scope">
        {set && known ? t('features.governor.device.scope', { total: fmtUsd(totals.deviceToday, lang), here: fmtUsd(totals.spentToday, lang) }) : t('features.governor.device.scopeNone')}
      </p>
      {newer ? (
        <p className="aip__muted" role="status">
          {t('features.governor.set.newer')}
        </p>
      ) : (
        <form className="gv-budget__form" onSubmit={save} noValidate>
          {(['day', 'month'] as const).map((f) => (
            <label key={f} className="gv-budget__field">
              <span className="label">{t(`features.governor.device.${f}`)}</span>
              <span className="gv-budget__box" data-invalid={errs[f] ? true : undefined}>
                {sign(
                  <input
                    key="i"
                    ref={f === 'day' ? dayRef : undefined}
                    className="input gv-budget__input"
                    inputMode="decimal"
                    autoComplete="off"
                    value={vals[f]}
                    placeholder={t('features.governor.budget.none')}
                    aria-invalid={errs[f] ? true : undefined}
                    aria-describedby={errs[f] ? `${id}-${f}-e` : undefined}
                    data-testid={`gv-device-${f}`}
                    onChange={(e) => {
                      setDirty(true)
                      setVals((v) => ({ ...v, [f]: e.target.value }))
                    }}
                  />,
                )}
              </span>
              {errs[f] && (
                <span id={`${id}-${f}-e`} className="gv-budget__err" role="alert">
                  {errs[f]}
                </span>
              )}
            </label>
          ))}
          <div className="gv-budget__keys">
            <button type="submit" className="btn btn--ink" data-testid="gv-device-save">
              {t('features.governor.budget.save')}
            </button>
            {set && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  write(null, t('features.governor.device.removed'))
                  setHandOn(true)
                }}
                data-testid="gv-device-remove"
              >
                {t('features.governor.device.remove')}
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={openRegler} data-testid="gv-device-regler">
              {t('features.governor.budget.open')} ↗
            </button>
          </div>
          <p className="gv-budget__said" role="status" aria-live="polite">
            {said}
          </p>
        </form>
      )}
      {ws?.day !== undefined && dev?.day !== undefined && (
        <p className="aip__muted" data-testid="gv-device-lower">
          {t('features.governor.device.lower', { budget: fmtUsd(ws.day, lang) })}
        </p>
      )}
      <p className="aip__muted">{t('features.governor.device.note')}</p>
    </section>
  )
}
