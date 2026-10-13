/**
 * Workspace › AI § 06 "Budget & governor" (Regler § 10.6, lazy — BudgetSlot): the workspace's day and month budget,
 * measured on each device ("laptop and phone $6 each"), the pre-brake sentence with the hard limit per provider in use,
 * where the person's own line for this browser lives (Settings › AI) and a key to the Regler. Fields take amounts in
 * the UI's language (lib/money.ts parseAmount: "1,5" and "1.5" in German, "1.5" in English, grouped thousands read as
 * thousands — out of range refused, never saved as 1). Writes go through setGovernor() as the person's press; the
 * section's Undo key puts the last change back (as an Undo). Team: owners and admins write; members read it with the
 * lock (their own line is in Settings › AI). G1 holds § 06 only (S5 brings §§ 01–05 around it).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { ArrowUpRight, Lock, ShieldCheck, Undo2 } from 'lucide-react'
import { GOVERNOR_RANGES, isReadableGovernor, type WorkspaceGovernor } from '@/shared/ai/governor'
import { useWorkspace } from '../../../store/store'
import { governorAllowed, governorRefusal } from '../../../store/governor'
import { withWriter } from '../../../store/writer'
import { useLang, useT } from '../../../i18n'
import { fmtAmount, fmtUsd, parseAmount, usdSignAfter } from '../../../lib/money'
import { openAISettings } from '../../ai/setup/openAISetup'
import { openRegler } from '../lampSource'
import { useHardLines } from './hard'
import './governor.css'
import './page.css'

type Field = 'day' | 'month'

const text = (v: number | undefined, lang: string) => (v === undefined ? '' : fmtAmount(v, lang).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, ''))

export default function BudgetSection() {
  const t = useT()
  const lang = useLang()
  const raw = useWorkspace((s) => s.governor)
  const gov = isReadableGovernor(raw) ? raw : undefined
  const unreadable = raw !== undefined && !gov
  // team: owners / admins on a server that keeps it; everyone else reads it (their own line is in Settings › AI)
  useWorkspace((s) => s.settings)
  const allowed = governorAllowed()
  const why = governorRefusal()
  const [vals, setVals] = useState<Record<Field, string>>(() => ({ day: text(gov?.day, lang), month: text(gov?.month, lang) }))
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({})
  const [last, setLast] = useState<{ before: WorkspaceGovernor | null } | null>(null)
  const [said, setSaid] = useState<string>('')
  const hard = useHardLines()
  const id = useId()
  const dirty = useRef(false)

  // the stored value moved (another tab, a colleague, Undo): the fields follow unless the person is typing
  useEffect(() => {
    if (dirty.current) return
    setVals({ day: text(gov?.day, lang), month: text(gov?.month, lang) })
  }, [gov?.day, gov?.month, lang])

  const read = (f: Field): { ok: true; v: number | undefined } | { ok: false; err: string } => {
    const s = vals[f].trim()
    if (!s) return { ok: true, v: undefined }
    const n = parseAmount(s, lang)
    if (n === null) return { ok: false, err: t('features.governor.budget.err.number', { example: fmtAmount(1.5, lang).replace(/0$/, '') }) }
    const [lo, hi] = GOVERNOR_RANGES[f]
    if (n < lo || n > hi) return { ok: false, err: t('features.governor.budget.err.range', { low: fmtUsd(lo, lang), high: fmtUsd(hi, lang) }) }
    return { ok: true, v: n }
  }

  const write = (next: WorkspaceGovernor | null, undo: boolean): boolean => {
    const r = withWriter({ kind: 'you', via: undo ? 'undo' : 'ui' }, () => useWorkspace.getState().setGovernor(next))
    if (!r.ok) setSaid(t(`features.governor.set.${r.why ?? 'rights'}`))
    return r.ok
  }

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    const d = read('day')
    const m = read('month')
    const next: Partial<Record<Field, string>> = {}
    if (!d.ok) next.day = d.err
    if (!m.ok) next.month = m.err
    setErrs(next)
    if (!d.ok || !m.ok) return
    const before = gov ? (JSON.parse(JSON.stringify(gov)) as WorkspaceGovernor) : null
    const value: WorkspaceGovernor = { ...(gov ?? { v: 1 }), v: 1, day: d.v, month: m.v }
    if (before?.day === value.day && before?.month === value.month) return
    if (write(value, false)) {
      dirty.current = false
      setLast({ before })
      setSaid(d.v === undefined && m.v === undefined ? t('features.governor.budget.removed') : t('features.governor.budget.saved'))
    }
  }

  const remove = () => {
    if (!gov) return
    const before = JSON.parse(JSON.stringify(gov)) as WorkspaceGovernor
    if (write({ ...gov, day: undefined, month: undefined }, false)) {
      dirty.current = false
      setLast({ before })
      setErrs({})
      setSaid(t('features.governor.budget.removed'))
    }
  }

  const undo = () => {
    if (!last) return
    if (write(last.before, true)) {
      dirty.current = false
      setLast(null)
      setSaid(t('features.governor.budget.undone'))
    }
  }

  const sign = (input: ReactElement) => (usdSignAfter(lang) ? [input, <span key="s" className="gv-budget__sign">$</span>] : [<span key="s" className="gv-budget__sign">$</span>, input])
  const set = gov?.day !== undefined || gov?.month !== undefined
  const example = gov?.day ?? 6

  return (
    <section className="gv-budget" aria-labelledby={`${id}-t`} data-testid="gv-budget" data-locked={!allowed || undefined}>
      <div className="gv-sec__head">
        <span className="label gv-sec__n">06</span>
        <h3 id={`${id}-t`} className="label gv-sec__t">
          {t('features.governor.budget.title')}
        </h3>
        <span className="gv-sec__rule" aria-hidden />
        {!allowed && (
          <span className="label gv-budget__lock" data-testid="gv-budget-lock">
            <Lock size={11} strokeWidth={1.8} aria-hidden /> {why === 'server' ? t('features.governor.set.server') : t('features.governor.lever.locked')}
          </span>
        )}
      </div>
      <p className="gv-budget__lead">{t('features.governor.ws.measured', { budget: fmtUsd(example, lang) })}</p>
      {unreadable ? (
        <p className="gv-budget__note" role="status">
          {t('features.governor.set.newer')}
        </p>
      ) : (
        <form className="gv-budget__form" onSubmit={save} noValidate>
          {(['day', 'month'] as const).map((f) => (
            <label key={f} className="gv-budget__field">
              <span className="label">{t(`features.governor.budget.${f}`)}</span>
              <span className="gv-budget__box" data-invalid={errs[f] ? true : undefined}>
                {sign(
                  <input
                    key="i"
                    className="input gv-budget__input"
                    inputMode="decimal"
                    autoComplete="off"
                    value={vals[f]}
                    placeholder={t('features.governor.budget.none')}
                    readOnly={!allowed}
                    aria-invalid={errs[f] ? true : undefined}
                    aria-describedby={errs[f] ? `${id}-${f}-e` : undefined}
                    data-testid={`gv-budget-${f}`}
                    onChange={(e) => {
                      dirty.current = true
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
          {allowed && (
            <div className="gv-budget__keys">
              <button type="submit" className="btn btn--primary" data-testid="gv-budget-save">
                {t('features.governor.budget.save')}
              </button>
              {set && (
                <button type="button" className="btn btn--ghost" onClick={remove} data-testid="gv-budget-remove">
                  {t('features.governor.budget.remove')}
                </button>
              )}
              {last && (
                <button type="button" className="btn btn--ghost" onClick={undo} data-testid="gv-budget-undo">
                  <Undo2 size={14} strokeWidth={1.7} aria-hidden />
                  {t('features.governor.budget.undo')}
                </button>
              )}
            </div>
          )}
          <p className="gv-budget__said" role="status" aria-live="polite">
            {said}
          </p>
        </form>
      )}
      <div className="gv-hard gv-budget__hard">
        <ShieldCheck size={14} strokeWidth={1.7} aria-hidden />
        <div>
          <p className="gv-hard__soft">{t('features.governor.soft')}</p>
          <ul className="gv-hard__list">
            {hard.map((h) => (
              <li key={h.code} className="gv-hard__line">
                <span className="gv-code" title={h.name} aria-hidden>
                  {h.code}
                </span>
                <span className="visually-hidden">{h.name}: </span>
                <a href={h.href} target="_blank" rel="noopener noreferrer">
                  {h.text} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="gv-budget__more">
        <p>{t('features.governor.budget.device')}</p>
        <button type="button" className="btn btn--sm btn--ghost gv-budget__go" onClick={() => openAISettings()} data-testid="gv-budget-device">
          {t('features.governor.budget.deviceKey')}
          <ArrowUpRight size={13} strokeWidth={1.7} aria-hidden />
        </button>
        <button type="button" className="btn btn--sm btn--ghost gv-budget__go" onClick={openRegler} data-testid="gv-budget-regler">
          {t('features.governor.budget.open')}
          <ArrowUpRight size={13} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
    </section>
  )
}
