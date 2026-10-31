/** A separate text-only queue. The private coding relay remains paired per person. */
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, forbidden, notFound, rateLimited } from '../errors.ts'
import { body } from '../http/util.ts'
import { access } from '../routes/access.ts'
import { atLeast, isWorkerTokenShape } from '../repo.ts'
import { safeEqual } from '../tokens.ts'
import { SHARED_QUEUE_MAX } from '../../../src/shared/ai/shared-model.ts'

type Share = {id:string;workspace_id:string;owner_id:string;model:string;label:string;enabled:number}
type Job = {id:string;share:string;workspace:string;user:string;session:string;box:unknown;state:'queued'|'running'|'done'|'failed'|'cancelled';created:number;started:number;ended:number;result?:unknown}
type Live = {tools:boolean;dataFlow:boolean;available:boolean;at:number;key:Record<string,unknown>;fingerprint:string}
const box=z.object({v:z.literal(1),iv:z.string().regex(/^[A-Za-z0-9+/]{16}$/),data:z.string().min(24).max(220000).regex(/^[A-Za-z0-9+/]+=*$/),key:z.string().max(400).optional()}).strict()
const publicKey=z.object({kty:z.literal('RSA'),n:z.string().min(342).max(344),e:z.literal('AQAB'),alg:z.literal('RSA-OAEP-256').optional(),ext:z.boolean().optional(),key_ops:z.array(z.literal('wrapKey')).max(1).optional()}).strict()
export function sharedModelRoutes(s:Services) {
  const app=new Hono<AppEnv>(),jobs=new Map<string,Job>(),live=new Map<string,Live>()
  const fail=(j:Job,state:Job['state']='failed')=>{j.state=state;j.box=null;j.result=undefined;j.ended=Date.now()}
  const member=(workspace:string,user:string)=>{const r=s.repo.memberRole(workspace,user);return !!r&&atLeast(r,'member')}
  const get=(id:string)=>s.db.get<Share>('SELECT * FROM shared_models WHERE id=?',id)
  const allowed=(r:Share)=>!!r.enabled&&s.repo.codingWorkerLive(r.id)&&member(r.workspace_id,r.owner_id)
  const hostOnline=(r:Share)=>allowed(r)&&Date.now()-(live.get(r.id)?.at??0)<15000
  const online=(r:Share)=>hostOnline(r)&&live.get(r.id)?.available===true
  const clean=()=>{
    const now=Date.now()
    for(const j of jobs.values()){
      const r=get(j.share)
      if((j.state==='queued'||j.state==='running')&&(!r||!allowed(r)||!member(j.workspace,j.user)||!s.sessions.isValid(j.session)))fail(j)
      if(j.state==='queued'&&(now-j.created>8*60000||!r||!online(r)))fail(j)
      if(j.state==='running'&&now-j.started>4*60000)fail(j)
      if(j.ended&&now-j.ended>120000)jobs.delete(j.id)
    }
    for(const [id,l]of live)if(now-l.at>10*60000)live.delete(id)
  }
  const sweep=setInterval(clean,30000);sweep.unref()
  const worker=(c:import('hono').Context<AppEnv>)=>{
    if(!s.config.codingRelay)throw notFound('coding_relay_off','The worker relay is disabled')
    if(c.req.header('origin')!==undefined)throw forbidden('forbidden','Worker tokens are not for web pages')
    const secret=/^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization')??'')?.[1]
    const r=isWorkerTokenShape(secret)?s.repo.codingWorkerBySecret(secret):undefined
    if(!r||!secret||!safeEqual(r.token_hash,s.repo.hash(secret)))throw new ApiError(401,'unauthenticated','Worker token unavailable')
    if(!member(r.workspace_id,r.user_id))throw forbidden('forbidden','Worker owner must be a workspace member')
    return r
  }
  // Infrastructure hosts have their own narrowly scoped token and do not replace a person's laptop worker.
  app.post('/workspaces/:id/model-hosts',async c=>{
    if(!s.config.codingRelay)throw notFound('coding_relay_off','The worker relay is disabled')
    const {workspace,auth}=access(s,c,'admin')
    const input=await body(c,z.object({label:z.string().trim().min(1).max(60)}).strict())
    const wait=s.limiter.hit(`model-host:create:${auth.user.id}`,20,86400000);if(wait)throw rateLimited(Math.min(wait,3600))
    const {row,token}=s.repo.createCodingWorker({workspaceId:workspace.id,userId:auth.user.id,label:input.label,userAgent:c.req.header('user-agent')??null,purpose:'model-host'})
    s.repo.activateCodingWorker(row.id)
    s.log.info('inference-only model host created',{workspace:workspace.id,host:row.id,user:auth.user.id})
    return c.json({id:row.id,token,purpose:row.purpose},201)
  })
  app.get('/coding/shared-model/info',c=>{const w=worker(c);return c.json({workerId:w.id})})
  app.get('/workspaces/:id/model-shares',c=>{
    const {workspace,auth}=access(s,c,'member');clean()
    return c.json(s.db.all<Share>('SELECT * FROM shared_models WHERE workspace_id=?',workspace.id).filter(r=>r.enabled||r.owner_id===auth.user.id).map(r=>({
      id:r.id,workspace:r.workspace_id,model:r.model,label:r.label,owner:s.repo.userById(r.owner_id)?.name??'Local model',mine:r.owner_id===auth.user.id,enabled:!!r.enabled,online:online(r),hostOnline:hostOnline(r),modelAvailable:hostOnline(r)?live.get(r.id)!.available:null,dataFlow:live.get(r.id)?.dataFlow===true,tools:live.get(r.id)?.tools===true,
      queued:[...jobs.values()].filter(j=>j.share===r.id&&j.state==='queued').length,running:[...jobs.values()].some(j=>j.share===r.id&&j.state==='running'),publicKey:online(r)?live.get(r.id)?.key:null,
    })))
  })
  app.delete('/workspaces/:id/model-shares/:share',c=>{
    const {workspace,auth,role}=access(s,c,'member'),r=get(c.req.param('share'))
    if(!r||r.workspace_id!==workspace.id||(r.owner_id!==auth.user.id&&!atLeast(role,'admin')))throw notFound('share_not_found','Model share unavailable')
    s.db.run('UPDATE shared_models SET enabled=0 WHERE id=?',r.id);live.delete(r.id)
    for(const j of jobs.values())if(j.share===r.id&&j.state!=='done')fail(j,'cancelled')
    return c.body(null,204)
  })
  app.put('/coding/shared-model/config',async c=>{
    const w=worker(c),input=await body(c,z.object({model:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),label:z.string().trim().min(1).max(80),enabled:z.boolean()}).strict())
    // Configure is sent only after the owner enabled it over their private encrypted paired link.
    for(const j of jobs.values())if(j.share===w.id&&(j.state==='running'||j.state==='queued'))fail(j,'cancelled')
    live.delete(w.id)
    s.db.run('INSERT INTO shared_models(id,workspace_id,owner_id,model,label,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model,label=excluded.label,enabled=excluded.enabled',w.id,w.workspace_id,w.user_id,input.model,input.label,input.enabled?1:0)
    return c.json({enabled:input.enabled,workspace:w.workspace_id,id:w.id})
  })
  app.post('/workspaces/:id/model-shares/:share/jobs',async c=>{
    const {workspace,auth}=access(s,c,'member');clean()
    const r=get(c.req.param('share'))
    if(!r||r.workspace_id!==workspace.id)throw notFound('share_not_found','Model share unavailable')
    if(!online(r))throw new ApiError(409,'model_offline','The shared model is offline or disabled')
    const input=await body(c,z.object({id:z.string().uuid(),box:box.extend({key:z.string().min(340).max(344)}),keyId:z.string().max(400)}).strict())
    if(live.get(r.id)?.fingerprint!==input.keyId)throw new ApiError(409,'model_changed','Worker restarted; refresh model list')
    const duplicate=jobs.get(input.id)
    if(duplicate){if(duplicate.user!==auth.user.id||duplicate.workspace!==workspace.id||duplicate.share!==r.id)throw new ApiError(409,'job_exists','Request already exists');return c.json({id:duplicate.id})}
    const active=[...jobs.values()].filter(j=>j.state==='queued'||j.state==='running')
    if(active.filter(j=>j.share===r.id).length>=SHARED_QUEUE_MAX||active.filter(j=>j.user===auth.user.id&&j.workspace===workspace.id).length>=2)throw rateLimited(10)
    if(jobs.size>=500)throw rateLimited(30)
    const wait=s.limiter.hit(`shared-model:${workspace.id}:${auth.user.id}`,30,60000);if(wait)throw rateLimited(Math.ceil(wait/1000))
    jobs.set(input.id,{id:input.id,share:r.id,workspace:workspace.id,user:auth.user.id,session:auth.session.id,box:input.box,state:'queued',created:Date.now(),started:0,ended:0})
    return c.json({id:input.id},201)
  })
  const ownedJob=(c:import('hono').Context<AppEnv>)=>{
    const {workspace,auth}=access(s,c,'member');clean();const j=jobs.get(c.req.param('job')??'')
    if(!j||j.workspace!==workspace.id||j.user!==auth.user.id)throw notFound('job_not_found','Request unavailable')
    return j
  }
  app.get('/workspaces/:id/model-jobs/:job',c=>{
    const j=ownedJob(c),waiting=[...jobs.values()].filter(x=>x.share===j.share&&x.state==='queued')
    return c.json({id:j.id,state:j.state,position:j.state==='queued'?waiting.indexOf(j)+1:0,created:j.created,started:j.started||null,ended:j.ended||null,...(j.state==='done'?{box:j.result}:{})})
  })
  app.delete('/workspaces/:id/model-jobs/:job',c=>{fail(ownedJob(c),'cancelled');return c.body(null,204)})
  app.post('/coding/shared-model/poll',async c=>{
    const w=worker(c),input=await body(c,z.object({publicKey,dataFlow:z.boolean().optional(),tools:z.boolean().optional(),busy:z.boolean(),available:z.boolean(),active:z.string().uuid().nullable(),outcome:z.object({id:z.string().uuid(),box:box.optional()}).strict().optional()}).strict())
    clean();const r=get(w.id)
    if(!r||!allowed(r))return c.json({enabled:false,cancel:!!input.active})
    const fingerprint=input.publicKey.n,previous=live.get(w.id)
    if(previous&&previous.fingerprint!==fingerprint)for(const j of jobs.values())if(j.share===w.id&&(j.state==='queued'||j.state==='running'))fail(j)
    live.set(w.id,{tools:input.tools===true,at:Date.now(),key:input.publicKey,fingerprint,available:input.available,dataFlow:input.dataFlow===true})
    if(input.outcome){const j=jobs.get(input.outcome.id);if(j?.share===w.id&&j.state==='running'){if(input.outcome.box){j.state='done';j.result=input.outcome.box;j.box=null;j.ended=Date.now()}else fail(j)}}
    const current=input.active?jobs.get(input.active):null
    if(input.active)return c.json({enabled:true,model:r.model,cancel:!current||current.share!==w.id||current.state!=='running'})
    if(input.busy||!input.available||[...jobs.values()].some(j=>j.share===w.id&&j.state==='running'))return c.json({enabled:true,model:r.model})
    const job=[...jobs.values()].find(j=>j.share===w.id&&j.state==='queued')
    if(job){job.state='running';job.started=Date.now()}
    return c.json({enabled:true,model:r.model,...(job?{job:{id:job.id,box:job.box}}:{})})
  })
  return app
}
