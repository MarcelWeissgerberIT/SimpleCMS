/**
 * The Vorprüfer on this device (slice SJ, § 5.1 / 5.2): which Jev version a pre-check asks when an agent names none —
 * the device rule `routes.gate`. It starts OFF: choosing Jev is the consent (DJ22). Two faces:
 *  - GateRole: setup step 03's dashed row ("PRE-CHECKER · decision", Off + "Choose Jev 1.13", once chosen its price,
 *    "≈ per check", Change / Off and the ALPHA API tag) — a draft the step's Next writes, only when chosen;
 *  - GateSetting: Settings › AI › This device — the row with its chip (Jev versions only) and Off, written at once, and
 *    under it the "Belegt?" switch (answers checked against their sources — off by default, absent = off).
 * Other decision models are listed dimmed in the picker, never chosen (owner decision 2). The decisions catalogue is
 * read only while OpenRouter is set up (a public GET, never at boot).
 */
import { useRef } from 'react'
import { useLang, useT } from '../../../../i18n'
import { Menu, useMenu } from '../../../../ui/Menu'
import { Switch } from '../../../../ui/controls'
import { jevLabel, newestJev } from '@/shared/ai/jev'
import { perCheck, pickerEntries, priceText, rowOf, useDecisionRows } from './picker'
import '../decide.css'

export interface GateChoice {
  /** the chosen Jev version (null: off) */
  value: string | null
  onChange: (id: string | null) => void
  /** OpenRouter is set up on this device */
  ready: boolean
}

/** Setup step 03: the dashed Vorprüfer row. */
export function GateRole({ value, onChange, ready }: GateChoice) {
  const t = useT()
  const lang = useLang()
  const { rows, state } = useDecisionRows(ready)
  const menu = useMenu()
  const btn = useRef<HTMLButtonElement>(null)
  const newest = newestJev(rows.filter((r) => !r.refused))
  const row = rowOf(rows, value)
  const per = perCheck(lang, row)
  return (
    <div className="aim-role aim-role--exp jev-gaterole" data-testid="role-checker" data-on={value ? '' : undefined}>
      <span className="aim-role__k">
        <span className="label">{t('features.ai.prov.role.checker')}</span>
        <small>{t('features.ai.prov.role.checkerSub')}</small>
      </span>
      <span className="aim-role__pick">
        {!ready ? (
          <b className="aim-role__none">{t('features.ai.prov.role.checkerNeeds')}</b>
        ) : value ? (
          <b>{jevLabel(value)}</b>
        ) : (
          <b className="aim-role__none" data-testid="checker-off">
            {t('features.ai.prov.role.checkerOff')}
          </b>
        )}
        {ready && (
          <span className="jev-tag" title={t('features.ai.jev.alpha')}>
            {t('features.ai.prov.role.checkerAlpha')}
          </span>
        )}
      </span>
      <span className="aim-role__meta">
        {value && row?.price && <span>{priceText(t, lang, row)}</span>}
        {ready && !value && !newest && state !== 'loading' && <span>{t('features.ai.prov.role.checkerNone')}</span>}
        {ready && <span className="jev-gaterole__hint">{t('features.ai.jev.alpha')}</span>}
      </span>
      {value && per && <span className="aim-role__eg">{t('features.ai.prov.role.checkerPer', { usd: per })}</span>}
      {ready && (
        <span className="jev-gaterole__keys">
          {value ? (
            <>
              <button ref={btn} type="button" className="btn btn--sm" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} data-testid="checker-change">
                {t('features.ai.prov.role.change')}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(null)} data-testid="checker-off-key">
                {t('features.ai.prov.role.checkerOff')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--sm" disabled={!newest} onClick={() => newest && onChange(newest.id)} data-testid="checker-pick">
              {newest ? t('features.ai.prov.role.checkerPick', { model: jevLabel(newest.id) }) : state === 'loading' ? t('features.ai.jev.pick.loading') : t('features.ai.prov.role.checkerPick', { model: 'Jev' })}
            </button>
          )}
        </span>
      )}
      <Menu {...menu.props} width={320} entries={pickerEntries(t, lang, { rows, state, current: value, onPick: (id) => id && onChange(id) })} />
    </div>
  )
}

/** Settings › AI › This device: the Vorprüfer row and the "Belegt?" switch. */
export function GateSetting({ value, onChange, ready, verify, onVerify }: GateChoice & { verify: boolean; onVerify: (on: boolean) => void }) {
  const t = useT()
  const lang = useLang()
  const { rows, state } = useDecisionRows(ready)
  const menu = useMenu()
  return (
    <div className="aip__row aip__row--default jev-gatesetting" data-row="gate" data-testid="device-row-gate">
      <span className="aip__work">
        {t('features.ai.prov.role.checker')}
        <span className="label aip__later">{t('features.ai.jev.settings.uses')}</span>
      </span>
      <span className="jev-gatesetting__keys">
        {!ready ? (
          <span className="aip__muted">{t('features.ai.prov.role.checkerNeeds')}</span>
        ) : (
          <>
            <button type="button" className="jev-chip jev-chip--row" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} data-testid="gate-chip">
              <span className="jev-chip__plate" aria-hidden>
                OR
              </span>
              <span className="jev-chip__model">{value ? jevLabel(value) : t('features.ai.prov.role.checkerOff')}</span>
              <span aria-hidden>▾</span>
            </button>
            {value && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(null)} data-testid="gate-off">
                {t('features.ai.prov.role.checkerOff')}
              </button>
            )}
          </>
        )}
      </span>
      <Menu {...menu.props} width={320} entries={pickerEntries(t, lang, { rows, state, current: value, onPick: (id) => id && onChange(id) })} />
      <label className="jev-gatesetting__verify" data-testid="jev-verify-row">
        <Switch size="sm" seed="jev-verify" checked={verify} onChange={onVerify} label={t('features.ai.jev.settings.verify')} disabled={!ready || !value} />
        <span>
          {t('features.ai.jev.settings.verify')}
          <small className="aip__muted">{t('features.ai.jev.settings.verifyHint')}</small>
        </span>
      </label>
    </div>
  )
}
