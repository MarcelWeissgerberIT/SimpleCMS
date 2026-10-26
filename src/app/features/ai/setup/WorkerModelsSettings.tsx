import { SharedModelSettings } from './SharedModelSettings'
import { HelpLink } from '../../../help'
import { useState } from 'react'
import { WORKER_PROVIDERS, PROVIDERS, type WorkerProvider } from '@/shared/ai/providers'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { aiRulesAllowed, setDeviceAI, setWorkspaceAI } from '../../../store/aiRules'
import { useCoding, openCodingSettings } from '../../coding'
import { useWorkerModels, listedWorkerModelRows, refreshWorkerModels } from '../core/workerModels'
import { MemberData } from './MemberData'
import { DataRules } from '../routing/DataRules'

export function WorkerModelsSettings() {
  const t = useT()
  useWorkerModels()
  const [provider, setProvider] = useState<WorkerProvider>('local')
  const [busy, setBusy] = useState(false)
  const ws = useWorkspace(s => s.ai)
  const device = useWorkspace(s => s.settings.ai)
  const connected = useCoding(s => s.conn === 'connected' && !!s.can?.includes('text-models'))
  const models = listedWorkerModelRows(device?.routes?.ask?.[0] ?? device?.default?.[0] ?? ws?.routes?.ask?.[0] ?? ws?.routes?.['*']?.[0])
  return <section className="aip__section" data-testid="worker-model-settings">
    <h4 className="st-h">{t('features.ai.prov.chip.workerTitle')}</h4>
    <p className="st-p">{t('features.ai.prov.chip.workerDetail')}</p>
    <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await refreshWorkerModels() } finally { setBusy(false) } }}>{t('features.ai.prov.chip.refreshModels')}</button>
    {!connected && <p className="st-p">{t('features.ai.prov.chip.workerOld')} <button type="button" className="btn btn--sm" onClick={openCodingSettings}>{t('features.ai.prov.chip.configure')}</button></p>}
    {models.length > 0 && <ul>{models.map(m => <li key={`${m.route.p}:${m.route.m}`}>{PROVIDERS[m.route.p].name} · {m.label}</li>)}</ul>}
    <p className="st-p">{t('features.ai.prov.chip.workerText')} <HelpLink id="copilot-coding" /></p>
    <button type="button" className="btn btn--sm" onClick={openCodingSettings}>{t('features.coding.agent.copilotSetup')}</button>
    <div className="worker-models__privacy">
      <label className="field"><span className="label">{t('features.ai.prov.chip.workerPrivacy')}</span><select className="input" value={provider} onChange={e => setProvider(e.target.value as WorkerProvider)}>{WORKER_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDERS[p].name}</option>)}</select></label>
      <DataRules providers={[provider]} allow={{ [provider]: ws?.policy?.providers?.[provider]?.allow ?? [] }} narrow={device?.narrow ?? {}}
        lockOf={() => aiRulesAllowed() ? null : t('features.ai.prov.rules.teamLock')}
        onAllow={(p, allow) => { setWorkspaceAI(prev => ({ ...prev, policy: { restricted: prev?.policy?.restricted ?? [], ...prev?.policy, providers: { ...prev?.policy?.providers, [p]: { ...prev?.policy?.providers?.[p], allow } } } })) }}
        onNarrow={(p, cls, off) => { setDeviceAI({ narrow: { ...device?.narrow, [p]: off ? [...new Set([...(device?.narrow?.[p] ?? []), cls])] : (device?.narrow?.[p] ?? []).filter(c => c !== cls) } }) }} />
    </div>
    <SharedModelSettings />
    <MemberData providers={[provider]} allow={device?.allow ?? {}} onChange={(p, allow) => { setDeviceAI({ allow: { ...device?.allow, [p]: allow } }) }} />
  </section>
}
