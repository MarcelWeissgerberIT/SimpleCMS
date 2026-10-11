/**
 * Settings → Appearance → "Preflight" (this device): on Start · the panel first in the morning · the time a new day
 * begins · the lamp test once a day. Written only here (one.preflight.prefs).
 */
import { useEffect, useId, useState } from 'react'
import { useT } from '../../../i18n'
import { Switch } from '../../../ui/controls'
import { onPrefsChanged, readPrefs, writePrefs } from '../prefs'
import type { PreflightPrefs } from '../types'

function usePrefs(): PreflightPrefs {
  const [p, setP] = useState(readPrefs)
  useEffect(() => onPrefsChanged(() => setP(readPrefs())), [])
  return p
}

function Row({ label, hint, children }: { label: string; hint: string; children: (hintId: string) => React.ReactNode }) {
  const id = useId()
  return (
    <div className="st-field" data-inline="">
      <div className="st-field__text">
        <div className="st-field__label">{label}</div>
        <div className="st-field__hint" id={`${id}-hint`}>
          {hint}
        </div>
      </div>
      <div className="st-field__control">{children(`${id}-hint`)}</div>
    </div>
  )
}

export function PreflightSettings() {
  const t = useT()
  const p = usePrefs()
  const atId = useId()
  return (
    <section className="pf-settings" data-testid="pf-settings" aria-labelledby={`${atId}-title`}>
      <h4 className="st-h pf-settings__h" id={`${atId}-title`}>
        {t('features.preflight.settings.title')}
      </h4>
      <p className="st-p">{t('features.preflight.settings.body')}</p>
      <Row label={t('features.preflight.settings.on')} hint={t('features.preflight.settings.onHint')}>
        {(hint) => <Switch size="sm" seed="pf-on" checked={p.on} label={t('features.preflight.settings.on')} describedBy={hint} onChange={(on) => writePrefs({ on })} />}
      </Row>
      <Row label={t('features.preflight.settings.hold')} hint={t('features.preflight.settings.holdHint')}>
        {(hint) => <Switch size="sm" seed="pf-hold" checked={p.hold} disabled={!p.on} label={t('features.preflight.settings.hold')} describedBy={hint} onChange={(hold) => writePrefs({ hold })} />}
      </Row>
      <div className="st-field" data-inline="">
        <div className="st-field__text">
          <label className="st-field__label" htmlFor={atId}>
            {t('features.preflight.settings.at')}
          </label>
          <div className="st-field__hint" id={`${atId}-hint`}>
            {t('features.preflight.settings.atHint')}
          </div>
        </div>
        <div className="st-field__control">
          <input
            id={atId}
            className="input pf-settings__at"
            type="time"
            step={60}
            value={p.at}
            disabled={!p.on}
            aria-describedby={`${atId}-hint`}
            onChange={(e) => {
              if (/^\d{2}:\d{2}$/.test(e.target.value)) writePrefs({ at: e.target.value })
            }}
          />
        </div>
      </div>
      <Row label={t('features.preflight.settings.test')} hint={t('features.preflight.settings.testHint')}>
        {(hint) => <Switch size="sm" seed="pf-test" checked={p.test} disabled={!p.on} label={t('features.preflight.settings.test')} describedBy={hint} onChange={(test) => writePrefs({ test })} />}
      </Row>
    </section>
  )
}
