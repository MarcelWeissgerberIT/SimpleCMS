import { useCloud } from '../../../cloud'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Shield, X } from 'lucide-react'
import type { ProviderId, SourceRef } from '@/shared/ai/types'
import { inferencePlace, sensitiveHints } from '@/shared/ai/dataFlow'
import { PROVIDERS } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { setDeviceAI } from '../../../store/aiRules'
import { useT } from '../../../i18n'
import { Popover } from '../../../ui/Popover'
import { DataFlowSettings } from './DataFlowSettings'
const dismissed = new Set<string>(), listeners = new Set<()=>void>();let rev=0
const dismiss = (key:string) => {if(dismissed.size>=500)dismissed.clear();dismissed.add(key);rev++;listeners.forEach(f=>f())}
function hash(s:string) {let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)}
function textOf(n:any):string {let budget=100000;const walk=(x:any,depth:number):string=>{if(!x||budget<=0||depth>64)return '';const v=typeof x.text==='string'?x.text.slice(0,budget):'';budget-=v.length;return [v,...(Array.isArray(x.content)?x.content.map((c:any)=>walk(c,depth+1)):[])].join(' ')};return walk(n,0)}
/** Compact notice only; no modal confirmation, toast, automatic rule change or external classifier. */
export function DataFlowNotice({ provider, model='', sources=[], text='' }: { provider:ProviderId;model?:string;sources?:readonly SourceRef[];text?:string }) {
  const t=useT(),ai=useWorkspace(s=>s.ai),device=useWorkspace(s=>s.settings.ai),pages=useWorkspace(s=>s.pages),workspace=useCloud(s=>`${s.active.kind}:${s.active.id??''}`),[open,setOpen]=useState(false),anchor=useRef<HTMLButtonElement|null>(null)
  useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},()=>rev)
  const ids=sources.flatMap(s=>'page'in s?[s.page]:'row'in s?[s.row]:'db'in s?[s.db]:[])
  const candidate=useMemo(()=>[text.slice(0,100000),...ids.slice(0,12).map(id=>{const p=pages[id];return p?`${p.title}\n${textOf(p.content)}`:''})].join('\n').slice(0,100000),[text,pages,ids.join('|')])
  const hints=sensitiveHints(candidate),place=inferencePlace(provider,model),key=hash(`${workspace}|${provider}|${ids.join('|')}|${hints.join()}`)
  const hint=place==='cloud'&&ai?.dataFlow?.hints!=='off'&&device?.dataFlowHints!==false&&hints.length>0&&!dismissed.has(key)
  return <span className="flow-control" data-hint={hint||undefined} data-testid="data-flow-notice">
    <button type="button" className="flow-chip" ref={anchor} aria-label={t('features.ai.flow.open')} title={t(`features.ai.flow.place.${place}`)} aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(v=>!v)}><Shield size={13}/>{hint?t('features.ai.flow.hint'):t('features.ai.flow.title')}</button>
    {hint&&<button className="flow-dismiss" type="button" aria-label={t('features.ai.flow.dismiss')} onClick={()=>dismiss(key)}><X size={12}/></button>}
    {open&&<Popover open anchor={anchor.current} onClose={()=>setOpen(false)} className="flow-pop" role="dialog" aria-label={t('features.ai.flow.title')}><h4>{PROVIDERS[provider].name}</h4>{place==='cloud'&&<p className="flow-host">{PROVIDERS[provider].host}</p>}<p>{t(`features.ai.flow.place.${place}`)}</p>{hint&&<><p>{t('features.ai.flow.hintDetail')}</p><ul>{hints.map(h=><li key={h}>{t(`features.ai.flow.sensitive.${h}`)}</li>)}</ul><button className="btn btn--sm" onClick={()=>dismiss(key)}>{t('features.ai.flow.dismiss')}</button><button className="btn btn--sm" onClick={()=>setDeviceAI({dataFlowHints:false})}>{t('features.ai.flow.off')}</button></>}<DataFlowSettings pageId={ids[0]} compact/></Popover>}
  </span>
}
