/** Central Claude metadata is scoped to the authenticated cloud account. Never contains a provider key. */
import {useEffect,useSyncExternalStore} from 'react'
import {cloudRequest,useCloud} from '../../../cloud'
import {CENTRAL_CLAUDE_MODEL,type CentralAIStatus} from '@/shared/ai/central'
import {useWorkspace} from '../../../store/store'
import {AIError} from './errors'
export {CENTRAL_CLAUDE_MODEL}
let scope='',status:CentralAIStatus|null=null,revision=0
const pending=new Map<string,Promise<void>>(),listeners=new Set<()=>void>()
const publish=()=>{revision++;for(const fn of listeners)fn()}
export const centralScope=()=>{const c=useCloud.getState();return c.active.kind==='cloud'&&c.user&&c.available?`${c.active.id}:${c.user.id}`:''}
/** Unknown cloud state fails closed: it must not accidentally use the host's personal API key. */
export const centralAI=():CentralAIStatus|null=>!centralScope()?null:scope===centralScope()&&status?status:{assigned:true,ready:false}
export const centralKeyReady=(personal:boolean)=>centralAI()?.assigned?!!centralAI()?.ready:personal
export const centralModelAllowed=(model:string)=>!centralAI()?.assigned||centralAI()?.model===model
/** Earlier AJ onboarding copied the whole shared-host route table into the device overlay. Rebase
 * only that unmodified, homogeneous snapshot; retain custom route choices and all personal data rules.
 */
function rebaseOnboardingDefaults(next:CentralAIStatus){
 const s=useWorkspace.getState(),saved=s.settings.workspaceAI,pin=saved?.default?.[0]
 if(!next.assigned||!next.id||!s.ai?.onboarding||s.ai.routes?.['*']?.[0]?.p!=='anthropic'||s.ai.routes?.['*']?.[0]?.m!==next.model||!pin||pin.p!=='local'||!pin.m.startsWith('one-shared/')||saved?.default?.length!==1)return
 const routes=Object.entries(saved.routes??{}).filter(([k])=>k!=='gate')
 if(routes.length<16||routes.some(([,r])=>r?.length!==1||r[0].p!==pin.p||r[0].m!==pin.m))return
 s.updateSettings({workspaceAI:{...saved,default:undefined,routes:saved.routes?.gate?{gate:saved.routes.gate}:undefined}})
}
export async function refreshCentralAI(){
  const want=centralScope();if(!want)return
  if(scope!==want){scope=want;status=null;publish()}
  if(pending.has(want))return pending.get(want)
  const workspace=useCloud.getState().active.id
  const work=(async()=>{try{const next=await cloudRequest<CentralAIStatus>('GET',`api/workspaces/${workspace}/central-ai`);if(want===centralScope()){scope=want;status=next;rebaseOnboardingDefaults(next);publish()}}catch{if(want===centralScope()){status={assigned:true,ready:false};publish()}}})().finally(()=>pending.delete(want))
  pending.set(want,work);return work
}
let subscribers=0,timer:ReturnType<typeof setInterval>|undefined
export function useCentralAI(){
 const active=useCloud(s=>s.active),user=useCloud(s=>s.user),available=useCloud(s=>s.available)
 useEffect(()=>{void refreshCentralAI();subscribers++;timer??=setInterval(()=>void refreshCentralAI(),10000);return()=>{if(!--subscribers&&timer){clearInterval(timer);timer=undefined}}},[active.id,active.kind,user?.id,available])
 return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision)
}
/** SDK transport: same-origin cookie only. Personal Atlas attachments keep their normal current-user SDK path.
 * Disable SDK retries: a transport failure may have spent tokens or run an external action already.
 */
export async function centralTransport():Promise<{fetch:typeof fetch;model:string}|null>{
 await refreshCentralAI()
 const selected=centralScope(),config=centralAI()
 if(!config?.assigned)return null
 if(!config.ready||!config.id||!config.version||!config.model)throw new AIError('no_key','features.ai.central.inactive')
 const workspace=useCloud.getState().active.id,version=config.version,service=config.id
 return {model:config.model,fetch:async(input,init)=>{
   if(selected!==centralScope()||centralAI()?.id!==service||centralAI()?.version!==version||!centralAI()?.ready)throw new AIError('bad_request','features.ai.central.changed')
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
   if(new URL(url).pathname!=='/v1/messages'||init?.method!=='POST'||typeof init.body!=='string')throw new AIError('bad_request','features.ai.central.changed')
   const beta=new Headers(init.headers).get('anthropic-beta')
   const res=await fetch(`${import.meta.env.BASE_URL}api/workspaces/${workspace}/central-ai/messages`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-one-central-version':String(version),...(beta?{'anthropic-beta':beta}:{})},body:init.body,signal:init.signal})
   if(!res.ok){let code='';try{code=(await res.clone().json()).error?.code??''}catch{/* SDK maps upstream errors */}
     // Keep the existing no-replay behavior: UNKNOWN is not an automatic fallback.
     if(!code&&[502,503,504].includes(res.status))throw new AIError('unknown','features.ai.central.gateway')
     if(code.startsWith('central_')){
       void refreshCentralAI()
       const reason=code.startsWith('central_provider_')?code.slice('central_provider_'.length):''
       const known=['request','auth','credits','rate','unavailable','model'].includes(reason)
       throw new AIError(code==='central_budget'?'budget':code==='central_busy'||reason==='rate'?'rate_limit':code==='central_transport'||reason==='unavailable'?'unavailable':'bad_request',code==='central_budget'?'features.ai.central.budget':known?`features.ai.central.provider.${reason}`:'features.ai.central.failed')
     }
   }
   return res
 }}
}
