/** Owner-controlled local model sharing. Polls outbound; never opens Ollama to the LAN. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { cloudOf, type WorkerConfig } from './config.ts'
import { textModels, textRequest, checkTextRequest } from './text-models.ts'
import { modelShareKey, sharedWorkerKey, openShared, sealShared, SHARED_INPUT_MAX, type SharedBox, type SharedText } from '../../../src/shared/ai/shared-model.ts'

type Choice={model:string;label:string;enabled:boolean}
export class SharedModelHost {
  private choice:Choice|null=null
  private timer:ReturnType<typeof setTimeout>|null=null
  private stopped=false
  private polling=false
  private active:{id:string;abort:AbortController}|null=null
  private outcome:{id:string;box?:SharedBox}|undefined
  private keys= modelShareKey()
  private available=false
  private checked=0
  private changing=false
  constructor(privateConfig:WorkerConfig,privateBusy:()=>boolean,privateLog:(line:string)=>void){
    this.config=privateConfig;this.occupied=privateBusy;this.log=privateLog
    try{const raw=JSON.parse(readFileSync(this.file,'utf8'));if(typeof raw.model==='string'&&typeof raw.label==='string'&&typeof raw.enabled==='boolean')this.choice=raw}catch{/* opt in only */}
  }
  private config:WorkerConfig
  private occupied:()=>boolean
  private log:(line:string)=>void
  private get file(){return this.config.file+'.model-share.json'}
  get busy(){return !!this.active}
  status(){return {cloud:!!cloudOf(this.config),workspace:this.config.workspace,choice:this.choice,busy:this.busy}}
  private save(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file,JSON.stringify(this.choice,null,2)+'\n',{mode:0o600})}
  private async api(path:string,value:unknown){
    const cloud=cloudOf(this.config)
    if(!cloud)throw new Error('Sharing requires a cloud worker paired with the selected workspace.')
    const response=await fetch(new URL('/api/coding/shared-model/'+path,cloud.origin),{method:path==='config'?'PUT':'POST',redirect:'error',headers:{'Content-Type':'application/json',authorization:'Bearer '+cloud.token},body:JSON.stringify(value),signal:AbortSignal.timeout(12000)})
    if(!response.ok){
      if(response.status===401||response.status===403){this.active?.abort.abort();if(this.choice){this.choice.enabled=false;this.save()}}
      throw new Error(`Model share server HTTP ${response.status}`)
    }
    return response.json() as Promise<any>
  }
  async configure(raw:unknown){
    const c=raw as Choice
    if(!c||Object.keys(c).some(k=>!['model','label','enabled'].includes(k))||typeof c.enabled!=='boolean'||typeof c.label!=='string'||!c.label.trim()||c.label.length>80||typeof c.model!=='string')throw new Error('Invalid model share')
    if(this.changing)throw new Error('Model share is updating. Try again shortly.')
    this.changing=true
    try{
      while(this.polling)await new Promise(r=>setTimeout(r,20))
      if(c.enabled&&!(await textModels(this.config.file)).some(m=>m.provider==='local'&&m.model===c.model))throw new Error('Choose an installed local model; cloud aliases cannot be shared.')
      await this.api('config',{...c,label:c.label.trim()})
      this.active?.abort.abort();this.choice={...c,label:c.label.trim()};this.save();this.checked=0
      return this.status()
    }finally{this.changing=false;if(!this.stopped){if(this.timer)clearTimeout(this.timer);void this.poll()}}
  }
  start(){this.stopped=false;void this.poll()}
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.active?.abort.abort()}
  private async poll(){
    if(this.stopped||this.polling||this.changing)return
    this.polling=true
    try{
      if(!this.choice?.enabled||!cloudOf(this.config))return
      if(Date.now()-this.checked>30000){this.available=(await textModels(this.config.file)).some(m=>m.provider==='local'&&m.model===this.choice!.model);this.checked=Date.now()}
      const keys=await this.keys,publicKey=await globalThis.crypto.subtle.exportKey('jwk',keys.publicKey)
      const sent=this.outcome
      const reply=await this.api('poll',{publicKey,busy:this.occupied()||!!this.active,available:this.available,active:this.active?.id??null,...(sent?{outcome:sent}:{})})
      if(this.outcome===sent)this.outcome=undefined
      if(!reply.enabled){this.choice.enabled=false;this.save();this.active?.abort.abort();return}
      if(reply.model!==this.choice.model){this.active?.abort.abort();return}
      if(reply.cancel)this.active?.abort.abort()
      if(reply.job&&!this.active){
        const id=reply.job.id as string,abort=new AbortController()
        this.active={id,abort};void this.run(id,reply.job.box,abort)
      }
    }catch{/* Offline is visible through the short server heartbeat lease; no prompt/error logging. */}
    finally{this.polling=false;if(!this.stopped)this.timer=setTimeout(()=>void this.poll(),2000)}
  }
  private async run(id:string,box:SharedBox,abort:AbortController){
    const timer=setTimeout(()=>abort.abort(),180000)
    try{
      const key=await sharedWorkerKey(box,(await this.keys).privateKey)
      const share=(await this.apiInfo())
      const request=await openShared<SharedText>(box,key,share,id)
      if(!this.choice?.enabled||request.model!==this.choice.model||Buffer.byteLength(JSON.stringify(request))>SHARED_INPUT_MAX||Object.keys(request).some(k=>!['model','messages','maxTokens'].includes(k))||request.maxTokens>4096)throw new Error('Shared request outside the allowed model or size')
      const r=checkTextRequest({...request,provider:'local'})
      // No tool definitions, project paths, personal secrets or remote model URLs enter this path.
      const result=await textRequest(this.config.file,r,abort.signal)
      if(Buffer.byteLength(JSON.stringify(result))>120000)throw new Error('Answer too large')
      const sealed=await sealShared({ok:true,result},key,share,id)
      if(!abort.signal.aborted)this.outcome={id,box:sealed};else this.outcome={id}
      this.log('Shared local model: one text request completed (no project tools).')
    }catch{this.outcome={id}}
    finally{clearTimeout(timer);this.active=null}
  }
  private async apiInfo():Promise<string>{
    // The authenticated server derives the share id from THIS token, never from the model prompt.
    const cloud=cloudOf(this.config)!
    const res=await fetch(new URL('/api/coding/shared-model/info',cloud.origin),{redirect:'error',headers:{authorization:'Bearer '+cloud.token},signal:AbortSignal.timeout(10000)})
    if(!res.ok)throw new Error('Worker unavailable')
    const info=await res.json() as any
    if(typeof info.workerId!=='string')throw new Error('Update the team server')
    return info.workerId
  }
}
