import {useEffect,useRef,useState} from 'react'
import {useT} from '../../../i18n'
import {SHARED_PREFIX,type SharedModel} from '@/shared/ai/shared-model'
import {refreshSharedModels,sharedModels,sharedScope,sendSharedText} from '../core/sharedModels'

type Phase='checking'|'queued'|'running'|'ready'|'offline'|'missing'|'failed'|'cancelled'
type Proof={phase:Phase;position?:number;at?:number;ms?:number;key?:string}
async function refreshForTest(signal:AbortSignal){
  signal.throwIfAborted()
  let stop:()=>void=()=>{}
  try{await Promise.race([refreshSharedModels(),new Promise<never>((_,reject)=>{stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true})})])}
  finally{signal.removeEventListener('abort',stop)}
}
/** Explicit, bounded inference through the ordinary encrypted FIFO. Never attaches page or Atlas context. */
export function SharedModelProbe({share}:{share:SharedModel}){
  const t=useT(),scope=sharedScope(),fingerprint=share.publicKey?.n
  const [proof,setProof]=useState<Proof|null>(null)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>{setProof(null);return()=>{active.current?.abort();active.current=null}},[scope,share.id,share.model,share.enabled])
  const busy=proof&&['checking','queued','running'].includes(proof.phase)
  const test=async()=>{
    if(active.current)return
    const controller=new AbortController();active.current=controller
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]),started=performance.now()
    const update=(p:Proof)=>{if(active.current===controller&&sharedScope()===scope)setProof(p)}
    update({phase:'checking'})
    try{
      await refreshForTest(signal);signal.throwIfAborted()
      if(sharedScope()!==scope)return
      const current=sharedModels().find(s=>s.id===share.id&&s.model===share.model&&s.enabled)
      if(!current?.online){update({phase:current?.hostOnline&&current.modelAvailable===false?'missing':'offline'});return}
      const answer=await sendSharedText(SHARED_PREFIX+current.id,[{role:'user',content:'Connection test only. Reply with ATLAS_FLOW_READY. Do not call tools.'}],32,signal,p=>update({phase:p.state==='queued'?'queued':'running',position:p.position}))
      signal.throwIfAborted()
      if(!answer.text.includes('ATLAS_FLOW_READY'))throw new Error('Probe marker missing')
      update({phase:'ready',at:Date.now(),ms:performance.now()-started,key:current.publicKey?.n})
    }catch{update({phase:controller.signal.aborted?'cancelled':'failed'})}
    finally{if(active.current===controller)active.current=null}
  }
  // A response is evidence at its timestamp, not a permanent promise that the host is still online.
  const recent=proof?.phase==='ready'&&share.online&&proof.key===fingerprint&&Date.now()-(proof.at??0)<60000
  const message=proof?.phase==='ready'
    ?t(recent?'features.ai.prov.share.probe.ok':'features.ai.prov.share.probe.stale',{time:new Date(proof.at!).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),seconds:((proof.ms??0)/1000).toFixed(1)})
    :proof?t('features.ai.prov.share.probe.'+proof.phase,{n:proof.position??0}):''
  return <div className="model-share__probe" data-testid={'shared-model-probe-'+share.id}>
    <div className="model-share__checks" aria-label={t('features.ai.prov.share.probe.checks')}>
      <span data-pass={share.hostOnline??share.online}>{t('features.ai.prov.share.probe.host')}</span>
      <span data-pass={share.modelAvailable??share.online}>{t('features.ai.prov.share.probe.model')}</span>
      <span data-pass={!!recent}>{t('features.ai.prov.share.probe.response')}</span>
    </div>
    <div className="model-share__probe-actions">
      <button className="btn btn--sm" disabled={!!busy||!share.enabled} onClick={()=>void test()}>{t('features.ai.prov.share.probe.button')}</button>
      {busy&&<button className="btn btn--sm" onClick={()=>active.current?.abort()}>{t('features.ai.prov.share.probe.cancel')}</button>}
    </div>
    <p className="model-share__probe-hint">{t('features.ai.prov.share.probe.hint')}</p>
    {proof&&<p role="status" data-state={recent?'ready':proof.phase==='ready'?'stale':proof.phase}>{message}</p>}
  </div>
}
