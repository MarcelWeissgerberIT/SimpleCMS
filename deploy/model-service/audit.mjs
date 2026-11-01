/** Test-lead audit. Encrypted files, bounded retention, no authorization headers. */
import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync,renameSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto'
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
  this.dir=dir;this.token=token;this.days=days;this.now=now
  mkdirSync(dir,{recursive:true,mode:0o700})
  if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'})
  this.key=readFileSync(keyFile);if(this.key.length!==32)throw Error('Invalid audit encryption key')
  this.prune()
 }
 authorized(header){const a=Buffer.from(header??''),b=Buffer.from('Bearer '+this.token);return a.length===b.length&&timingSafeEqual(a,b)}
 file(id){if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))throw Error('Invalid audit ID');return join(this.dir,id+'.json')}
 write(record){
  const id=record.auditId,data=Buffer.from(JSON.stringify(redactAudit(record)));if(data.length>16*1024*1024)throw Error('Audit limit')
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id))
  const bytes=Buffer.concat([cipher.update(data),cipher.final()]),out={v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')}
  const file=this.file(id);writeFileSync(file+'.tmp',JSON.stringify(out),{mode:0o600});renameSync(file+'.tmp',file)
 }
 read(id){const d=JSON.parse(readFileSync(this.file(id),'utf8')),cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(d.iv,'base64'));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(Buffer.from(d.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(d.data,'base64')),cipher.final()]).toString('utf8'))}
 *records(){this.prune();for(const n of readdirSync(this.dir).filter(n=>/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)).sort())yield this.read(n.slice(0,-5))}
 list(limit=50,before=null){return readdirSync(this.dir).filter(n=>/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)&&(!before||n<before+'.json')).sort().reverse().slice(0,Math.min(100,limit)).map(n=>{const r=this.read(n.slice(0,-5));return {auditId:r.auditId,requestId:r.requestId,trace:r.trace,receivedAt:r.receivedAt,queuedAt:r.queuedAt,processingAt:r.processingAt,finishedAt:r.finishedAt,state:r.state,status:r.status,model:r.request?.model,error:r.error,responseBytes:r.responseBytes}})}
 prune(){const cutoff=this.now()-this.days*86400000;for(const n of readdirSync(this.dir))if(/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)&&Number(n.slice(0,13))<cutoff)unlinkSync(join(this.dir,n))}
}
