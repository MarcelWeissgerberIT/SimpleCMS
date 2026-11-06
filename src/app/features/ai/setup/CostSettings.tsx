import { useState } from 'react'
import { useWorkspace } from '../../../store/store'
import { useLang, useT } from '../../../i18n'
import { displayCurrency, fmtAmount, fmtCost, parseAmount } from '../../../lib/money'

const ECB = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata'
/** ECB quotes USD per EUR. Accounting uses USD, so display uses its reciprocal. */
export function readEcbRate(csv: string): { eurPerUsd: number; date: string } {
  const lines = csv.trim().split(/\r?\n/)
  const head = lines[0]?.split(',') ?? []
  const data = lines[lines.length - 1]?.split(',') ?? []
  const usdPerEur = Number(data[head.indexOf('OBS_VALUE')])
  const date = data[head.indexOf('TIME_PERIOD')]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(usdPerEur) || usdPerEur <= 0) throw new Error('rate')
  return { eurPerUsd: 1 / usdPerEur, date }
}

export function CostSettings() {
  const t = useT()
  const lang = useLang()
  const saved = useWorkspace(s => s.settings.costDisplay)
  const update = useWorkspace(s => s.updateSettings)
  const [rate, setRate] = useState(saved?.eurPerUsd ? String(saved.eurPerUsd) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const refresh = async () => {
    setBusy(true); setError(false)
    try {
      const res = await fetch(ECB, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error('rate')
      const data = readEcbRate(await res.text())
      update({ costDisplay: { currency: 'EUR', ...data, source: 'ecb' } })
      setRate(String(data.eurPerUsd))
    } catch { setError(true) } finally { setBusy(false) }
  }
  return <section className="aip__section cost-settings" data-testid="cost-settings">
    <h4 className="st-h">{t('features.ai.cost.title')}</h4>
    <p className="st-p">{t('features.ai.cost.detail')}</p>
    <div className="field">
      <label className="label" htmlFor="cost-currency">{t('features.ai.cost.currency')}</label>
      <select id="cost-currency" className="input" value={saved?.currency ?? 'USD'} disabled={busy} onChange={e => {
        const currency = e.target.value as 'EUR' | 'USD'
        if (currency === 'EUR' && !saved?.eurPerUsd) { void refresh(); return }
        update({ costDisplay: { ...saved, currency } })
      }}><option value="USD">USD · $</option><option value="EUR">EUR · €</option></select>
    </div>
    <div className="field">
      <label className="label" htmlFor="cost-rate">{t('features.ai.cost.rate')}</label>
      <input id="cost-rate" className="input" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
      <div className="cost-settings__actions">
        <button type="button" className="btn" disabled={busy || !(parseAmount(rate, lang)! > 0)} onClick={() => {
          const eurPerUsd = parseAmount(rate, lang)
          if (!eurPerUsd || eurPerUsd <= 0) return
          update({ costDisplay: { currency: 'EUR', eurPerUsd, date: new Date().toISOString().slice(0, 10), source: 'manual' } })
        }}>{t('features.ai.cost.manual')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>{t(busy ? 'features.ai.cost.loading' : 'features.ai.cost.refresh')}</button>
      </div>
    </div>
    {saved?.eurPerUsd && <p className="st-p" data-testid="cost-rate-note">{t('features.ai.cost.active', { source: saved.source === 'ecb' ? 'ECB' : t('features.ai.cost.manualSource'), date: saved.date ?? '—', rate: fmtAmount(saved.eurPerUsd, lang), example: fmtCost(1, lang), currency: displayCurrency() })}</p>}
    {error && <p role="alert">{t('features.ai.cost.error')}</p>}
    <p className="st-p">{t('features.ai.cost.coverage')} <a href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noreferrer">{t('features.ai.cost.source')}</a></p>
  </section>
}
