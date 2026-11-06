import { useState } from 'react'
import { PROVIDER_ORDER, PROVIDERS } from '@/shared/ai/providers'
import type { ProviderId } from '@/shared/ai/types'
import { originOf } from '@/shared/ai/dataFlow'
import { useWorkspace } from '../../../store/store'
import { aiRulesAllowed, setWorkspaceAI, setDeviceAI } from '../../../store/aiRules'
import { useT } from '../../../i18n'
import './data-flow.css'

export function DataFlowSettings({ pageId, compact = false }: { pageId?: string; compact?: boolean }) {
  const t = useT(), ai = useWorkspace(s => s.ai), pages = useWorkspace(s => s.pages), device = useWorkspace(s => s.settings.ai)
  const [target,setTarget] = useState(pageId ?? ''), [origins,setOrigins] = useState((ai?.dataFlow?.mcpOrigins ?? []).join('\n')), [bad,setBad] = useState(false)
  const admin = aiRulesAllowed(), restriction = ai?.policy?.restricted?.find(r => r.root === target)
  const allowed = target ? restriction?.to : ai?.dataFlow?.providers
  const mode = allowed === undefined ? 'inherit' : allowed.length === 1 && allowed[0] === 'local' ? 'local' : 'custom'
  const setProviders = (providers?: ProviderId[]) => setWorkspaceAI(prev => {
    if (!target) { const flow = { ...prev?.dataFlow }; if(providers===undefined)delete flow.providers;else flow.providers=providers;return {...prev,dataFlow:flow} }
    const restricted = (prev?.policy?.restricted ?? []).filter(r=>r.root!==target)
    if(providers!==undefined)restricted.push({root:target,to:providers})
    return {...prev,policy:{providers:prev?.policy?.providers??{},restricted}}
  })
  return <section className="flow-settings" data-testid="data-flow-settings">
    {!compact && <><h4 className="st-h">{t('features.ai.flow.title')}</h4><p className="st-p">{t('features.ai.flow.lead')}</p></>}
    <label className="field"><span>{t('features.ai.flow.scope')}</span><select className="input" value={target} onChange={e=>setTarget(e.target.value)} data-testid="flow-scope"><option value="">{t('features.ai.flow.workspace')}</option>{Object.values(pages).filter(p=>!p.trashed).sort((a,b)=>a.title.localeCompare(b.title)).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    <label className="field"><span>{t('features.ai.flow.mode')}</span><select className="input" disabled={!admin} value={mode} onChange={e=>setProviders(e.target.value==='inherit'?undefined:e.target.value==='local'?['local']:[...PROVIDER_ORDER])} data-testid="flow-mode"><option value="inherit">{t('features.ai.flow.inherit')}</option><option value="local">{t('features.ai.flow.local')}</option><option value="custom">{t('features.ai.flow.custom')}</option></select></label>
    {mode==='custom'&&<div className="flow-providers">{PROVIDER_ORDER.filter(p=>PROVIDERS[p].shipped).map(p=><label key={p}><input type="checkbox" disabled={!admin} checked={allowed?.includes(p)??false} onChange={e=>setProviders(e.target.checked?[...(allowed??[]),p]:(allowed??[]).filter(x=>x!==p))}/>{PROVIDERS[p].name}</label>)}</div>}
    {allowed?.length===0&&<p className="st-p">{t('features.ai.flow.empty')}</p>}
    {target&&<p className="st-p">{t('features.ai.flow.inherits')}</p>}
    {!admin&&<p className="st-p">{t('features.ai.flow.locked')}</p>}
    {!target&&<details><summary>{t('features.ai.flow.mcp')}</summary><label><input type="checkbox" checked={ai?.dataFlow?.mcpOrigins!==undefined} disabled={!admin} onChange={e=>{const on=e.target.checked;setWorkspaceAI(prev=>{const dataFlow={...prev?.dataFlow};if(on)dataFlow.mcpOrigins=[];else delete dataFlow.mcpOrigins;return {...prev,dataFlow}})}}/>{t('features.ai.flow.mcp')}</label>
      {ai?.dataFlow?.mcpOrigins!==undefined&&<><label className="field"><span>{t('features.ai.flow.origins')}</span><textarea className="input" rows={3} value={origins} disabled={!admin} onChange={e=>{setOrigins(e.target.value);setBad(false)}} placeholder="https://aj-atlas.com" data-testid="flow-origins"/></label><button className="btn btn--sm" disabled={!admin} onClick={()=>{const lines=origins.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>64||lines.some(x=>{const o=originOf(x);return !o||x.replace(/\/$/,'')!==o})){setBad(true);return}setWorkspaceAI(prev=>({...prev,dataFlow:{...prev?.dataFlow,mcpOrigins:[...new Set(lines.map(x=>originOf(x)!))]}}))}}>{t('features.ai.flow.save')}</button>{bad&&<p role="status">{t('features.ai.flow.badOrigin')}</p>}</>}
      <p className="st-p">{t('features.ai.flow.originHint')}</p></details>}
    <label><input type="checkbox" checked={device?.dataFlowHints!==false} onChange={e=>setDeviceAI({dataFlowHints:e.target.checked})} data-testid="flow-hints"/>{t('features.ai.flow.hints')}</label>
    <p className="st-p">{t('features.ai.flow.scopeNote')}</p><details><summary>{t('features.ai.flow.more')}</summary><p className="st-p">{t('features.ai.flow.separate')}</p></details>
  </section>
}
