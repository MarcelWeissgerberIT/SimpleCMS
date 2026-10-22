import { useWorkerModels, workerModelRows } from '../ai/core/workerModels'
import { readAgentRoute } from '@/shared/ai/route'
import { labelFor } from '../ai/core/registry'
import { useState } from 'react'
import { useWorkspace } from '../../store/store'
import { setDeviceRule } from '../../store/aiRules'
import { withWriter } from '../../store/writer'
import { useT } from '../../i18n'
import { AI_MODELS } from '../ai/client'
import { routeFor } from '../ai/core/gate'
import type { CustomAgent } from '../../store/types'
import './invocation.css'

/** Only models supported by the browser agent engine. This control sends no request. */
export function AgentModelDefault() {
  const t = useT()
  useWorkerModels()
  const ai = useWorkspace(s => s.settings.ai)
  useWorkspace(s => s.ai)
  useWorkspace(s => s.settings.aiModel)
  const [error, setError] = useState(false)
  const rule = ai?.routes?.agents
  const value = !rule?.length ? '' : rule.length === 1 ? (rule[0].p === 'anthropic' ? rule[0].m : `${rule[0].p}:${rule[0].m}`) : '__rule'
  return <section className="agx-model-default" data-testid="agent-model-default">
    <label className="label" htmlFor="agent-default-model">{t('features.agents.model.default')}</label>
    <select id="agent-default-model" className="input" value={value} onChange={e => {
      const model = e.target.value
      const worker = workerModelRows().find(m => `${m.route.p}:${m.route.m}` === model && m.route.p === 'copilot')
      setError(!withWriter({kind:'you',via:'patchbay'}, () => setDeviceRule('agents', model ? [worker?.route ?? {p:'anthropic',m:model}] : null)))
    }}>
      <option value="">{t('features.agents.model.inherit')}</option>
      {value && !AI_MODELS.some(m => m.id === value) && <option value={value} disabled>{t('features.agents.model.existing')}</option>}
      {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      <optgroup label="GitHub Copilot">{workerModelRows().filter(m => m.route.p === 'copilot' && m.caps.tools).map(m => <option key={m.route.m} value={`copilot:${m.route.m}`}>{m.label}</option>)}</optgroup>
    </select>
    <p>{t('features.agents.model.defaultHint')}</p>
    <p className="label">{t('features.agents.model.resolved', {model:routeFor('agents.run').label})}</p>
    {error && <p role="alert">{t('features.agents.model.unreadable')}</p>}
  </section>
}

export function AgentModelHint({agent}:{agent:CustomAgent}) {
  const t = useT()
  useWorkerModels()
  useWorkspace(s => s.settings.ai)
  useWorkspace(s => s.settings.aiModel)
  useWorkspace(s => s.ai)
  const own = readAgentRoute(agent.route)
  const pin = Array.isArray(own) ? own[0] : null
  const model = pin ? labelFor(pin) : agent.model ? AI_MODELS.find(m => m.id === agent.model)?.name ?? agent.model : agent.runner === 'server' ? t('features.agents.model.server') : routeFor('agents.run').label
  const subscription = pin?.p === 'copilot' || !pin && !agent.model && agent.runner === 'browser' && routeFor('agents.run').route.p === 'copilot'
  return <p className="agx-field__hint" data-testid="agent-model-effective">{t(agent.model || pin ? 'features.agents.model.own' : 'features.agents.model.resolved', {model})}{subscription && <> · {t('features.coding.panel.copilotCostHint')}</>}</p>
}


export function usesCopilot(agent:CustomAgent):boolean {
  if(agent.runner!=='browser')return false
  const pins=readAgentRoute(agent.route)
  return Array.isArray(pins)&&pins.length ? pins[0].p==='copilot' : !agent.model && routeFor('agents.run').route.p==='copilot'
}
