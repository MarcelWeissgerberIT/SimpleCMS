/** Test-lead audit. Encrypted files, bounded retention, no authorization headers. */
import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync,renameSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto'
const secretKey=/^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|private[_-]?key)$/i
export function redactAudit(value){
 if(Array.isArray(value))return value.map(redactAudit)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,secretKey.test(k)?'[REDACTED]':redactAudit(v)]))
 if(typeof value!=='string')return value
 let s=value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [REDACTED]').replace(/([?&](?:token|api_key|access_token)=)[^&\s"']+/gi,'$1[REDACTED]').replace(/("(?:token|password|api_key|access_token|refresh_token)"\s*:\s*")[^"\\]*(?:\\.[^"\\]*)*"/gi,'$1[REDACTED]"')
 try{const parsed=JSON.parse(s);if(parsed&&typeof parsed==='object')s=JSON.stringify(redactAudit(parsed))}catch{}
 return s
}
export class ModelAudit {
 constructor({dir,keyFile,token,days=30,now=Date.now}){
  if(!token||token.length<32)throw Error('Explicit audit credential required')
  this.dir=dir;this.token=token;this.days=days;this.now=now;this.index=new Map()
  mkdirSync(dir,{recursive:true,mode:0o700})
  if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'})
  this.key=readFileSync(keyFile);if(this.key.length!==32)throw Error('Invalid audit encryption key')
  this.prune()
  for(const r of this.records())this.index.set(r.auditId,this.metadata(r))
 }
 authorized(header){const a=Buffer.from(header??''),b=Buffer.from('Bearer '+this.token);return a.length===b.length&&timingSafeEqual(a,b)}
 file(id){if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))throw Error('Invalid audit ID');return join(this.dir,id+'.json')}
 write(record){
  const id=record.auditId,safe=redactAudit(record),data=Buffer.from(JSON.stringify(safe));if(data.length>16*1024*1024)throw Error('Audit limit')
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id))
  const bytes=Buffer.concat([cipher.update(data),cipher.final()]),out={v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')}
  const file=this.file(id);writeFileSync(file+'.tmp',JSON.stringify(out),{mode:0o600});renameSync(file+'.tmp',file);this.index.set(id,this.metadata(safe))
 }
 read(id){const d=JSON.parse(readFileSync(this.file(id),'utf8')),cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(d.iv,'base64'));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(Buffer.from(d.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(d.data,'base64')),cipher.final()]).toString('utf8'))}
 *records(){this.prune();for(const n of readdirSync(this.dir).filter(n=>/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)).sort())yield this.read(n.slice(0,-5))}
 metadata(r){return {auditId:r.auditId,kind:r.kind??'inference',requestId:r.requestId,trace:r.trace,receivedAt:r.receivedAt,queuedAt:r.queuedAt,processingAt:r.processingAt,finishedAt:r.finishedAt,state:r.state,status:r.status,model:r.request?.model,prompt:r.kind==='run'?r.request.prompt.slice(0,280):undefined,error:r.error,responseBytes:r.responseBytes,events:r.events?.length??0}}
 list(limit=50,before=null,runs=false){this.prune();return [...this.index.values()].filter(r=>(runs?r.kind==='run':r.kind!=='run')&&(!before||r.auditId<before)).sort((a,b)=>b.auditId.localeCompare(a.auditId)).slice(0,Math.min(100,limit))}
 startRun({workspace,user,model,prompt,purpose}){
  if(typeof workspace!=='string'||!workspace||workspace.length>200||typeof user!=='string'||!user||user.length>200||typeof model!=='string'||model.length>200||typeof purpose!=='string'||purpose.length>100||typeof prompt!=='string'||prompt.length>50000)throw Error('Invalid test scope')
  const id=String(this.now())+'-'+randomUUID();this.write({auditId:id,kind:'run',receivedAt:this.now(),finishedAt:null,state:'running',trace:{workspace,user,run:id},request:{model,prompt,purpose},events:[]});return {runId:id}
 }
 appendRun({runId,event,workspace,user}){
  const r=this.read(runId)
  if(r.kind!=='run'||r.trace.workspace!==workspace||r.trace.user!==user)throw Error('Test scope mismatch')
  if(!event||!/^[-a-f0-9]{36}$/.test(event.id??'')||!Number.isFinite(event.clientAt)||!['tool-call','tool-result','tool-error','tool-blocked','run-end'].includes(event.type))throw Error('Invalid test event')
  if(event.type==='run-end'){if(!['done','failed','cancelled','held','limit'].includes(event.state))throw Error('Invalid completion state')}
  else if(!/^[-a-f0-9]{36}$/.test(event.callId??'')||typeof event.server!=='string'||typeof event.name!=='string')throw Error('Invalid tool event')
  if(['tool-result','tool-error'].includes(event.type)&&!r.events.some(e=>e.type==='tool-call'&&e.callId===event.callId&&e.server===event.server&&e.name===event.name))throw Error('Unknown tool call')
  if(r.events.some(e=>e.id===event.id))return {saved:true}
  if(r.state!=='running'||r.events.length>=500)throw Error('Test closed or event limit reached')
  r.events.push({...event,receivedAt:this.now(),source:'one-browser-harness'})
  if(event.type==='run-end'){r.state=event.state;r.finishedAt=this.now();if(event.error)r.error=event.error;if(event.answer!==undefined)r.answer=event.answer}
  this.write(r);return {saved:true}
 }
 run(id){
  const run=this.read(id);if(run.kind!=='run')throw Error('Not a test run')
  const rounds=[...this.index.values()].filter(r=>r.kind!=='run'&&r.trace?.run===id&&r.trace.workspace===run.trace.workspace&&r.trace.user===run.trace.user).sort((a,b)=>a.auditId.localeCompare(b.auditId)).map(r=>this.read(r.auditId))
  return {run,rounds}
 }
 prune(){const cutoff=this.now()-this.days*86400000;for(const n of readdirSync(this.dir))if(/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)&&Number(n.slice(0,13))<cutoff){unlinkSync(join(this.dir,n));this.index.delete(n.slice(0,-5))}}
}
