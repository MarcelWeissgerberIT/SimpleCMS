import { isTestAccess } from './testScope'
/** Same-session receipts only. Never reads tokens, probes Atlas or starts a model. */
import {useCoding} from '../features/coding/state'
import {useEffect} from 'react'
import {useCloud} from './state'
import {request} from './api'
import {useWorkspace} from '../store/store'
import {atlasReadProof,type ReadinessObservation} from '../../shared/readiness'
export interface ReadinessScope {workspace:string;user:string;projects:string[]}
export function captureReadiness():ReadinessScope|null {
  if(isTestAccess())return null
  const c=useCloud.getState()
  if(c.active.kind!=='cloud'||c.status!=='online'||!c.user||!c.supports?.includes('readiness:1'))return null
  const projects=Object.values(useWorkspace.getState().databases).flatMap(d=>d.readiness?.automation?.atlasProjects??[])
  return projects.length?{workspace:c.active.id,user:c.user.id,projects}:null
}
function current(s:ReadinessScope){const c=useCloud.getState();return c.active.kind==='cloud'&&c.active.id===s.workspace&&c.user?.id===s.user&&c.status==='online'}
const sent=new Map<string,number>()
const path=(s:ReadinessScope)=>`api/workspaces/${encodeURIComponent(s.workspace)}/readiness`
export function noteReadiness(s:ReadinessScope|null,observation:ReadinessObservation):void {
  if(!s||!current(s))return
  const key=`${s.workspace}:${s.user}:${observation.signal}`,now=Date.now();if(now-(sent.get(key)??0)<5000)return;sent.set(key,now);if(sent.size>30)sent.delete(sent.keys().next().value!)
  const v=useCoding.getState().worker?.worker;const version=v&&/^\d+\.\d+\.\d+$/.test(v)?v:undefined
  void request<{matched:boolean}>('POST',path(s),{...observation,...(version?{version}:{})}).then(()=>{if(current(s))window.dispatchEvent(new CustomEvent('one-readiness',{detail:{workspace:s.workspace,user:s.user}}))}).catch(()=>{})
}
export function noteAtlasRead(s:ReadinessScope|null,serverUrl:string|undefined,tool:string,result:unknown,error=false):void {
  if(!s||error||!serverUrl)return
  try{const u=new URL(serverUrl);if(u.protocol!=='https:'||!['aj-atlas.com','eh-atlas.com','eu-atlas.com'].includes(u.hostname))return}catch{return}
  const proof=atlasReadProof(tool,result)
  if(proof&&s.projects.includes(proof.project))noteReadiness(s,{signal:'atlas',...proof})
}
/** Mounted globally: authenticated ONE session and the server's live worker registry. */
export function useReadinessSync():void {
  const identity=useCloud(s=>`${s.active.kind}:${s.active.id}:${s.user?.id??''}:${s.status}:${s.supports?.includes('readiness:1')}`)
  const configured=useWorkspace(s=>Object.values(s.databases).some(d=>!!d.readiness?.automation))
  useEffect(()=>{
    if(!configured)return
    const scope=captureReadiness();if(!scope)return
    let stopped=false,busy=false,atlasSeen=false
    const sync=()=>{if(stopped||busy||!current(scope)||document.visibilityState==='hidden')return;busy=true;void request<{atlas:boolean}>('POST',path(scope),{signal:'sync',...(/^\d+\.\d+\.\d+$/.test(useCoding.getState().worker?.worker??'')?{version:useCoding.getState().worker!.worker}:{}),...(useCoding.getState().via?.[scope.workspace]!=='cloud'?{localWorker:{online:useCoding.getState().conn==='connected',...(/^\d+\.\d+\.\d+$/.test(useCoding.getState().worker?.worker??'')?{version:useCoding.getState().worker!.worker}:{})}}:{})}).then(r=>{if(!stopped&&current(scope)&&r.atlas&&!atlasSeen){atlasSeen=true;window.dispatchEvent(new CustomEvent('one-readiness',{detail:{workspace:scope.workspace,user:scope.user}}))}}).catch(()=>{}).finally(()=>{busy=false})}
    sync();const timer=window.setInterval(sync,30000);window.addEventListener('focus',sync)
    return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('focus',sync)}
  },[identity,configured])
}
