/** Central BYOK: cookie membership, owner-only write-only credential, encrypted audit and atomic spend reservations.
 * No bearer relay, browser key, participant impersonation, provider fallback or arbitrary upstream URLs.
 */
import {randomUUID} from 'node:crypto'
import {Hono} from 'hono'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {access} from './access.ts'
import {body} from '../http/util.ts'
import {ApiError,badRequest,conflict,forbidden,notFound} from '../errors.ts'
import {FEATURE_CLASSES,sanitizeWorkspaceAI} from '../../../src/shared/ai/policy.ts'
import {atLeast} from '../repo.ts'
import {openText,sealText} from '../crypto/aead.ts'
import {CENTRAL_CLAUDE_MODEL,type CentralAIStatus} from '../../../src/shared/ai/central.ts'

type Service={id:string;anchor:string;owner:string;label:string;model:string;sealed_key:string|null;verified_at:number|null;enabled:number;budget_micro:number|null;version:number}
const mutation=z.object({version:z.number().int().nonnegative(),label:z.string().trim().min(1).max(80),workspaces:z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).min(1).max(20),budgetUsd:z.number().min(1).max(10000).nullable(),enabled:z.boolean()}).strict()
const credential=z.object({version:z.number().int().positive(),key:z.string().trim().min(20).max(512).regex(/^sk-ant-[A-Za-z0-9_-]+$/)}).strict()
const month=()=>new Date().toISOString().slice(0,7)
const micro=(usd:number)=>Math.ceil(usd*1e6)
const aad=(r:Service)=>`central-ai\n${r.id}\n${r.anchor}`
const auditAad=(r:Service,id:string)=>`${aad(r)}\nrequest\n${id}`
const row=(s:Services,workspace:string)=>s.db.get<Service>('SELECT c.* FROM central_ai c JOIN central_ai_bindings b ON b.service_id=c.id WHERE b.workspace_id=?',workspace)
const bindings=(s:Services,r:Service)=>s.db.all<{id:string;name:string}>('SELECT w.id,w.name FROM central_ai_bindings b JOIN workspaces w ON w.id=b.workspace_id WHERE b.service_id=? ORDER BY w.created_at',r.id)
const canManage=(s:Services,r:Service,user:string)=>r.owner===user&&bindings(s,r).every(w=>atLeast(s.repo.memberRole(w.id,user)??'viewer','admin'))
function assertOwner(s:Services,r:Service,user:string){if(!canManage(s,r,user))throw forbidden('central_owner','Only the service owner with admin access to every bound workspace can manage this service')}
const totals=(s:Services,r:Service)=>s.db.get<{spent:number;held:number}>(`SELECT COALESCE(SUM(cost_micro),0) AS spent,COALESCE(SUM(reserved_micro),0) AS held FROM central_ai_requests WHERE service_id=? AND month=?`,r.id,month())!
function present(s:Services,r:Service,user:string):CentralAIStatus{
  const manage=canManage(s,r,user),sum=totals(s,r)
  return {assigned:true,id:r.id,version:r.version,label:r.label,model:r.model,enabled:!!r.enabled,configured:!!r.sealed_key,verifiedAt:r.verified_at,ready:canManage(s,r,r.owner)&&!!r.enabled&&!!r.sealed_key&&!!r.verified_at&&r.budget_micro!==null&&sum.spent+sum.held<r.budget_micro,manage,month:month(),...(manage?{budgetUsd:r.budget_micro===null?null:r.budget_micro/1e6,spentUsd:sum.spent/1e6,heldUsd:sum.held/1e6,workspaces:bindings(s,r)}:{})}
}
const upstream=(s:Services,path:string)=>(s.config.devMode?s.config.agents.apiUrl:'https://api.anthropic.com').replace(/\/$/,'')+path
const redactKey=(v:unknown,key:string)=>JSON.parse(JSON.stringify(v).split(key).join('[redacted]'))
const keyOf=(s:Services,r:Service)=>openText(s.repo.keys.forWorkspace(r.anchor)!.aead,r.sealed_key!,aad(r))
function version(r:Service,expected:number){if(r.version!==expected)throw conflict('central_changed','The central configuration changed. Refresh before saving or starting again.')}
function upstreamHeaders(key:string,beta?:string){return {'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01',...(beta?{'anthropic-beta':beta}:{})}}
// Refusal fallback can incur additional model calls. Central billing permits exactly the configured model.
function payload(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw badRequest('central_request','Expected a Messages request')
  const p=raw as Record<string,unknown>
  const allowed=new Set(['model','max_tokens','messages','system','stream','thinking','output_config','tools','tool_choice','mcp_servers','stop_sequences','temperature','top_p','top_k','metadata','cache_control','fallbacks'])
  if(Object.keys(p).some(k=>!allowed.has(k))||p.model!==CENTRAL_CLAUDE_MODEL||!Number.isSafeInteger(p.max_tokens)||Number(p.max_tokens)<1||Number(p.max_tokens)>128000||!Array.isArray(p.messages)||p.messages.length<1||p.messages.length>10000||(p.stream!==undefined&&typeof p.stream!=='boolean'))throw badRequest('central_request','This central service accepts only the configured Opus model and standard Messages requests')
  if(p.tools!==undefined&&(!Array.isArray(p.tools)||p.tools.some(t=>!t||typeof t!=='object'||!['custom','mcp_toolset'].includes(t.type??'custom'))))throw badRequest('central_tools','Only ONE client tools and personal MCP toolsets are enabled; additional paid server tools are not enabled')
  const {fallbacks:_fallbacks,...exact}=p
  return {...exact,service_tier:'standard'}
}
// Cost rates in USD / million tokens: Opus 5.5, official pricing 2026-11-02. Reserve the entire 1M context
// at the most expensive cache rate + maximum output, including unseen native MCP results. No optimistic token estimates.
export const reserveMicro=(maxOutput:number)=>8000000+maxOutput*20
const num=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null
export function usageCost(u:Record<string,unknown>):number|null{
  const input=num(u.input_tokens),output=num(u.output_tokens),read=num(u.cache_read_input_tokens??0),write=num(u.cache_creation_input_tokens??0)
  if(input===null||output===null||read===null||write===null||input+read+write>1000000||output>128000)return null
  const cc=u.cache_creation as Record<string,unknown>|undefined
  const hour=num(cc?.ephemeral_1h_input_tokens??0),five=num(cc?.ephemeral_5m_input_tokens??0)
  if(hour===null||five===null||hour+five>write)return null
  // Unspecified cache TTL is reserved/accounted at the highest rate, never undercounted.
  return Math.ceil(input*4+output*20+read*.2+five*5+(write-five)*8)
}
export function scrubCentral(value:unknown,secrets:string[]=[]):unknown{
  if(typeof value==='string')return secrets.reduce((out,key)=>key.length>=4?out.split(key).join('[redacted]'):out,value).replace(/sk-ant-[A-Za-z0-9_-]{12,}/g,'[redacted]')
  if(Array.isArray(value))return value.map(x=>scrubCentral(x,secrets))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(authorization_token|authorization|api_key|x-api-key|token|password|secret)$/i.test(k)?'[redacted]':scrubCentral(v,secrets)]))
  return value
}
function secretsIn(p:Record<string,unknown>,key:string){const out=[key];for(const m of Array.isArray(p.mcp_servers)?p.mcp_servers:[])if(m&&typeof m==='object'&&typeof m.authorization_token==='string')out.push(m.authorization_token);return out}
export function centralAIRoutes(s:Services){
  const app=new Hono<AppEnv>()
  app.get('/:id/central-ai',c=>{const {auth,workspace}=access(s,c,'viewer');const r=row(s,workspace.id);return c.json(r?present(s,r,auth.user.id):{assigned:false})})
  app.put('/:id/central-ai',async c=>{
    const {auth,workspace}=access(s,c,'admin'),p=await body(c,mutation)
    if(auth.testAccess)throw forbidden('test_access_read_only','Read only')
    if(!p.workspaces.includes(workspace.id))throw badRequest('central_binding','The current workspace must stay selected')
    for(const id of p.workspaces)if(!atLeast(s.repo.memberRole(id,auth.user.id)??'viewer','admin'))throw forbidden('central_binding','Admin access is required for every selected workspace')
    const r=s.db.tx(()=>{
      const old=row(s,workspace.id)
      if(old){assertOwner(s,old,auth.user.id);version(old,p.version);if(!p.workspaces.includes(old.anchor))throw badRequest('central_binding','The original workspace must remain bound to its encrypted service key')}else if(p.version!==0)throw conflict('central_changed','Refresh the configuration')
      const id=old?.id??randomUUID()
      for(const w of p.workspaces){const other=row(s,w);if(other&&other.id!==id)throw conflict('central_binding','A selected workspace already has another central service')}
      if(p.enabled&&(!old?.sealed_key||!old.verified_at||p.budgetUsd===null))throw badRequest('central_not_ready','Verify a key and set a budget before activation')
      if(old){s.db.run('UPDATE central_ai SET label=?,budget_micro=?,enabled=?,version=version+1 WHERE id=?',p.label,p.budgetUsd===null?null:micro(p.budgetUsd),p.enabled?1:0,id);s.db.run('DELETE FROM central_ai_bindings WHERE service_id=?',id)}
      else s.db.run('INSERT INTO central_ai(id,anchor,owner,label,model,enabled,budget_micro,version) VALUES(?,?,?,?,?,0,?,1)',id,workspace.id,auth.user.id,p.label,CENTRAL_CLAUDE_MODEL,p.budgetUsd===null?null:micro(p.budgetUsd))
      for(const w of new Set(p.workspaces))s.db.run('INSERT INTO central_ai_bindings(workspace_id,service_id) VALUES(?,?)',w,id)
      return row(s,workspace.id)!
    })
    return c.json(present(s,r,auth.user.id))
  })
  app.post('/:id/central-ai/defaults',async c=>{
    const {auth,workspace}=access(s,c,'admin'),r=row(s,workspace.id)
    if(!r)throw notFound('central_missing','Create the service first')
    assertOwner(s,r,auth.user.id)
    const p=await body(c,z.object({version:z.number().int().positive()}).strict());version(r,p.version)
    const names=bindings(s,r).map(w=>`ws:${w.id}`)
    await s.collab.withDocuments(names,(docs,transact)=>{
      const current=row(s,workspace.id)!;assertOwner(s,current,auth.user.id);version(current,p.version)
      for(const name of names){const doc=docs.get(name)!,map=doc.getMap('workspace'),previous=sanitizeWorkspaceAI(map.get('ai'))??{}
        const routes={...previous.routes,'*':[{p:'anthropic' as const,m:CENTRAL_CLAUDE_MODEL}]}
        for(const cls of FEATURE_CLASSES)if(cls!=='gate')routes[cls]=[{p:'anthropic',m:CENTRAL_CLAUDE_MODEL}]
        transact(name,()=>map.set('ai',{...previous,routes}))
      }
    },auth.user.id)
    return c.json({ok:true})
  })
  app.post('/:id/central-ai/key',async c=>{
    const {auth,workspace}=access(s,c,'admin'),r=row(s,workspace.id)
    if(!r)throw notFound('central_missing','Create the service first')
    assertOwner(s,r,auth.user.id)
    const p=await body(c,credential);version(r,p.version)
    let response:Response
    try{response=await fetch(upstream(s,'/v1/models/'+CENTRAL_CLAUDE_MODEL),{headers:upstreamHeaders(p.key),redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw new ApiError(502,'central_verify','The provider could not be reached. The existing key was not changed.')}
    await response.body?.cancel()
    if(!response.ok)throw new ApiError(400,'central_verify',response.status===401||response.status===403?'The provider rejected this key or model access. The existing key was not changed.':'Model access could not be verified. The existing key was not changed.')
    s.db.tx(()=>{const current=row(s,workspace.id)!;assertOwner(s,current,auth.user.id);version(current,p.version);s.db.run('UPDATE central_ai SET sealed_key=?,verified_at=?,enabled=0,version=version+1 WHERE id=?',sealText(s.repo.keys.forWorkspace(r.anchor)!.aead,p.key,aad(r)),Date.now(),r.id)})
    return c.json(present(s,row(s,workspace.id)!,auth.user.id))
  })
  app.delete('/:id/central-ai/key',async c=>{
    const {auth,workspace}=access(s,c,'admin'),r=row(s,workspace.id);if(!r)throw notFound('central_missing','No service');assertOwner(s,r,auth.user.id)
    const p=await body(c,z.object({version:z.number().int().positive()}).strict())
    s.db.tx(()=>{const current=row(s,workspace.id);if(!current)throw notFound('central_missing','No service');assertOwner(s,current,auth.user.id);version(current,p.version);s.db.run('UPDATE central_ai SET sealed_key=NULL,verified_at=NULL,enabled=0,version=version+1 WHERE id=?',current.id)})
    return c.json(present(s,row(s,workspace.id)!,auth.user.id))
  })
  app.get('/:id/central-ai/requests',c=>{
    const {auth,workspace}=access(s,c,'admin'),r=row(s,workspace.id);if(!r)throw notFound('central_missing','No service');assertOwner(s,r,auth.user.id)
    return c.json(s.db.all<{id:string;workspace:string;createdAt:number;finishedAt:number|null;state:string;cost_micro:number;reserved_micro:number;inputTokens:number|null;outputTokens:number|null}>('SELECT id,workspace_id AS workspace,created_at AS createdAt,finished_at AS finishedAt,state,cost_micro,reserved_micro,input_tokens AS inputTokens,output_tokens AS outputTokens FROM central_ai_requests WHERE service_id=? ORDER BY created_at DESC LIMIT 100',r.id).map(({cost_micro,reserved_micro,...x})=>({...x,usd:cost_micro/1e6,reservedUsd:reserved_micro/1e6})))
  })
  app.get('/:id/central-ai/requests/:request',c=>{
    const {auth,workspace}=access(s,c,'admin'),r=row(s,workspace.id);if(!r)throw notFound('central_missing','No service');assertOwner(s,r,auth.user.id)
    const x=s.db.get<{sealed_audit:string|null}>('SELECT sealed_audit FROM central_ai_requests WHERE service_id=? AND id=? AND created_at>?',r.id,c.req.param('request'),Date.now()-30*86400000)
    if(!x?.sealed_audit)throw notFound('central_audit','No retained audit for this request')
    return c.json(JSON.parse(openText(s.repo.keys.forWorkspace(r.anchor)!.aead,x.sealed_audit,auditAad(r,c.req.param('request')))))
  })
  app.post('/:id/central-ai/messages',async c=>{
    const {auth,workspace}=access(s,c,'member'),r=row(s,workspace.id)
    if(!r||!r.enabled||!r.sealed_key||!r.verified_at||r.budget_micro===null)throw forbidden('central_disabled','Central Claude is not activated. Ask the service owner to finish the secure setup.')
    if(auth.testAccess)throw forbidden('central_test','Paid requests are disabled during access tests')
    version(r,Number(c.req.header('x-one-central-version')))
    if(!canManage(s,r,r.owner))throw forbidden('central_owner','The service owner must still administer every bound workspace')
    const p=payload(await c.req.json().catch(()=>null)),id=randomUUID(),reserve=reserveMicro(Number(p.max_tokens)),started=Date.now(),m=month()
    const key=keyOf(s,r),secrets=secretsIn(p,key),auditInput=scrubCentral(p,secrets)
    const initialAudit=sealText(s.repo.keys.forWorkspace(r.anchor)!.aead,JSON.stringify({request:auditInput,response:null,state:'running',requestId:id}),auditAad(r,id))
    s.db.tx(()=>{
      const current=row(s,workspace.id)
      if(!current||!current.enabled||!canManage(s,current,current.owner)||!atLeast(s.repo.memberRole(workspace.id,auth.user.id)??'viewer','member'))throw forbidden('central_disabled','Central access or workspace membership was revoked')
      version(current,r.version)
      const sum=totals(s,r)
      if(sum.spent+sum.held+reserve>r.budget_micro!)throw new ApiError(402,'central_budget','The shared monthly budget cannot cover the safety reservation for this request. Check central usage and held reservations.')
      if((s.db.get<{n:number}>("SELECT COUNT(*) AS n FROM central_ai_requests WHERE service_id=? AND state='running'",r.id)?.n??0)>=4)throw new ApiError(429,'central_busy','Four central requests are already running. Retry after one finishes.')
      s.db.run("INSERT INTO central_ai_requests(id,service_id,workspace_id,user_id,month,state,reserved_micro,created_at,sealed_audit) VALUES(?,?,?,?,?,'running',?,?,?)",id,r.id,workspace.id,auth.user.id,m,reserve,started,initialAudit)
    })
    let settled=false
    const finish=(state:string,usage:Record<string,unknown>|null,result:unknown)=>{
      if(settled)return;settled=true
      const cost=usage?usageCost(usage):null,complete=state==='done'&&cost!==null&&cost<=reserve
      const sealed=sealText(s.repo.keys.forWorkspace(r.anchor)!.aead,JSON.stringify({request:auditInput,response:scrubCentral(result,secrets),usage,state:complete?'done':state==='rejected'?'rejected':'uncertain',pricing:'opus-5.5-standard-2026-11-02',requestId:id}),auditAad(r,id))
      s.db.run('UPDATE central_ai_requests SET state=?,cost_micro=?,reserved_micro=?,input_tokens=?,output_tokens=?,sealed_audit=?,finished_at=? WHERE id=?',complete?'done':state==='rejected'?'rejected':'uncertain',complete?cost!:0,complete||state==='rejected'?0:reserve,usage?num(usage.input_tokens):null,usage?num(usage.output_tokens):null,sealed,Date.now(),id)
      s.db.run('UPDATE central_ai_requests SET sealed_audit=NULL WHERE sealed_audit IS NOT NULL AND created_at<?',Date.now()-30*86400000)
    }
    const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),10*60000)
    const abort=()=>ctrl.abort();c.req.raw.signal.addEventListener('abort',abort,{once:true})
    const beta=(c.req.header('anthropic-beta')??'').split(',').map(x=>x.trim()).filter(x=>/^[a-z0-9-]{1,100}$/.test(x)&&!x.startsWith('server-side-fallback-')).join(',')
    let response:Response
    try{response=await fetch(upstream(s,'/v1/messages'),{method:'POST',headers:upstreamHeaders(key,beta),body:JSON.stringify(p),redirect:'error',signal:ctrl.signal})}
    catch{clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort);finish('uncertain',null,{error:'Transport interrupted; reservation retained'});throw new ApiError(502,'central_transport','Claude could not complete the connection. Check the central request log before retrying; the safety reservation is retained.')}
    if(!response.ok){await response.body?.cancel();clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort);finish(response.status<500?'rejected':'uncertain',null,{status:response.status});return c.json({type:'error',error:{type:response.status===429?'rate_limit_error':response.status===401?'authentication_error':'api_error',message:'Central Claude provider rejected the request. Check key access, credits and provider limits in central settings.'}},response.status===429?429:response.status===401||response.status===403?403:502)}
    c.header('x-one-central-request',id)
    if(!p.stream){try{const answer=await response.json() as {model?:string;usage?:Record<string,unknown>};finish(answer.model===r.model?'done':'uncertain',answer.usage??null,answer);return c.json(redactKey(answer,key))}catch{finish('uncertain',null,{error:'Incomplete provider response'});throw new ApiError(502,'central_response','Incomplete Claude response; reservation retained')}finally{clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort)}}
    const reader=response.body?.getReader();if(!reader){finish('uncertain',null,{error:'Missing stream'});clearTimeout(timeout);throw new ApiError(502,'central_response','Missing Claude stream')}
    const decoder=new TextDecoder(),usage:Record<string,unknown>={},events:unknown[]=[]
    let pending='',stopped=false,validModel=false,auditBytes=0,auditComplete=true
    const parse=(chunk:Uint8Array,final=false)=>{
      pending+=decoder.decode(chunk,{stream:!final});if(pending.length>8*1024*1024)throw new Error('Oversized SSE event')
      const frames=pending.split(/\r?\n\r?\n/);pending=frames.pop()??''
      let wire=''
      for(const frame of frames){const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue
        const e=JSON.parse(data)
        if(typeof e.type!=='string'||!/^[a-z_]+$/.test(e.type))throw new Error('Invalid SSE event')
        wire+=`event: ${e.type}\ndata: ${JSON.stringify(redactKey(e,key))}\n\n`
        if(e.type==='message_start'){validModel=e.message?.model===r.model;Object.assign(usage,e.message?.usage??{})}
        if(e.type==='message_delta')Object.assign(usage,e.usage??{})
        if(e.type==='message_stop')stopped=true
        if(e.type==='error')stopped=false
        auditBytes+=Buffer.byteLength(data);if(auditBytes<=64*1024*1024)events.push(e);else auditComplete=false
      }
      return new TextEncoder().encode(wire)
    }
    const stream=new ReadableStream<Uint8Array>({
      async pull(out){try{for(;;){const next=await reader.read();if(next.done){parse(new Uint8Array(),true);finish(stopped&&validModel?'done':'uncertain',usage,{events,auditComplete});clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort);out.close();return}const wire=parse(next.value);if(wire.length){out.enqueue(wire);return}}}catch{finish('uncertain',usage,{events,auditComplete,error:'Stream interrupted; reservation retained'});clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort);ctrl.abort();out.error(new Error('Central Claude stream interrupted'))}},
      async cancel(){ctrl.abort();clearTimeout(timeout);c.req.raw.signal.removeEventListener('abort',abort);finish('uncertain',usage,{events,auditComplete,error:'Cancelled; reservation retained'});await reader.cancel().catch(()=>{})}
    })
    return new Response(stream,{status:200,headers:{'content-type':'text/event-stream','cache-control':'no-store','x-one-central-request':id}})
  })
  return app
}
