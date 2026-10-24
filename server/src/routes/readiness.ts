/** Own-account onboarding observations; never arbitrary row/property writes or external requests. */
import {Hono} from 'hono'
import {z} from 'zod'
import * as Y from 'yjs'
import type {AppEnv,Services} from '../context.ts'
import {body} from '../http/util.ts'
import {access} from './access.ts'
import {atLeast,normalizeEmail} from '../repo.ts'
import {forbidden,rateLimited} from '../errors.ts'
import {WelcomeStore} from '../welcome/store.ts'
import {readReadiness,type ReadinessDatabase} from '../../../src/shared/readiness.ts'
import type {ReadinessEvidence} from '../../../src/shared/readiness.ts'
const version=z.string().regex(/^\d+\.\d+\.\d+$/).optional()
const observation=z.discriminatedUnion('signal',[
 z.object({signal:z.literal('sync'),version,localWorker:z.object({online:z.boolean(),version}).strict().optional()}).strict(),
 z.object({signal:z.literal('atlas'),project:z.string().regex(/^[a-z0-9_-]{1,100}$/),record:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),version}).strict(),
 z.object({signal:z.enum(['copilot','repo','worker']),version}).strict(),
])
export function readinessRoutes(s:Services){
 const app=new Hono<AppEnv>(),store=new WelcomeStore(s)
 app.post('/:id/readiness',async c=>{
  const {workspace,auth,role}=access(s,c,'viewer'),input=await body(c,observation)
  const wait=s.limiter.hit(`readiness:${workspace.id}:${auth.user.id}`,60,60000);if(wait)throw rateLimited(60)
  if(role==='viewer'&&['copilot','repo','worker'].includes(input.signal))throw forbidden('viewer','Guests cannot report coding checks')
  // Match verified account email privately to opaque welcome recipient ids. Display names never identify people.
  const ids=new Set<string>()
  for(const d of s.db.all<{workspace_id:string;user_id:string}>('SELECT workspace_id,user_id FROM welcome_drafts WHERE workspace_id=?',workspace.id)){
   if(!atLeast(s.repo.memberRole(d.workspace_id,d.user_id)??'viewer','admin'))continue
   for(const r of store.read(d.workspace_id,d.user_id)?.recipients??[])if(r.workspaceId===workspace.id&&normalizeEmail(r.email)===normalizeEmail(auth.user.email))ids.add(r.id)
  }
  if(!ids.size)return c.json({matched:false,atlas:false})
  const online=s.repo.codingWorkers(workspace.id,auth.user.id).some(w=>s.coding.online(workspace.id).has(w.id))
  const result=await s.collab.write(`ws:${workspace.id}`,doc=>{
   const pages=doc.getMap<Y.Map<unknown>>('pages'),dbs=doc.getMap<Y.Map<unknown>>('databases')
   const matches:Array<{row:Y.Map<unknown>;db:ReadinessDatabase;config:NonNullable<ReturnType<typeof readReadiness>>}>=[]
   for(const [id,d]of dbs){if(!(d instanceof Y.Map))continue;const raw=d.toJSON();const db={...raw,id,properties:Object.values(raw.properties??{})} as ReadinessDatabase;const config=readReadiness(db),a=config?.automation;if(!config||!a||!(pages.get(id) instanceof Y.Map)||pages.get(id)!.get('trashed')||!db.properties.some(p=>p.id===a.recipient&&p.type==='text')||!db.properties.some(p=>p.id===a.evidence&&p.type==='text'))continue
    for(const row of pages.values()){if(!(row instanceof Y.Map)||row.get('databaseId')!==id||row.get('trashed'))continue;const p=row.get('properties');if(p instanceof Y.Map&&ids.has(String(p.get(a.recipient))))matches.push({row,db,config})}
   }
   // Refuse ambiguity; no partial writes.
   if(matches.length!==1)return {matched:false,atlas:false}
   const {row,config}=matches[0]!,a=config.automation!,props=row.get('properties') as Y.Map<unknown>
   if(props.get(config.participation)==='later')return {matched:false,atlas:false}
   if(input.signal==='atlas'&&!a.atlasProjects.includes(input.project))throw forbidden('readiness_project','Unexpected Atlas project')
   const raw=props.get(a.evidence);let evidence:Record<string,ReadinessEvidence>={};try{const parsed=typeof raw==='string'?JSON.parse(raw):null;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))evidence=parsed}catch{}
   const now=Date.now();let changed=false
   const put=(key:keyof typeof config.checks,proof:ReadinessEvidence)=>{
    // A human-entered blocker remains an explicit hold, even after a later successful device observation.
    const status=props.get(config.checks[key]);if(status==='blocked')return
    if(status==='ready'&&evidence[key]&&now-evidence[key].at<25000&&(!proof.version||proof.version===evidence[key].version))return
    props.set(config.checks[key],'ready');evidence[key]={...evidence[key],...proof};changed=true
   }
   put('one',{at:now,source:'session'})
   if(online&&role!=='viewer')put('worker',{at:now,source:'relay',...(input.version?{version:input.version}:{})})
   if(input.signal==='atlas')put('atlas',{at:now,source:'device-mcp',project:input.project,record:input.record})
   if(input.signal==='worker')put('worker',{at:now,source:'device-worker',...(input.version?{version:input.version}:{})})
   if(input.signal==='copilot')put('copilot',{at:now,source:'device-worker',...(input.version?{version:input.version}:{})})
   if(input.signal==='repo')put('repo',{at:now,source:'device-worker',...(input.version?{version:input.version}:{})})
   if(input.signal==='sync'&&role!=='viewer'){
    const local=input.localWorker
    const prev=evidence.workerConnection
    const connected:ReadinessEvidence={at:now,source:local?'device-worker':'relay',online:online||!!local?.online,...(input.version?{version:input.version}:local?.version?{version:local.version}:prev?.version?{version:prev.version}:{})}
    if(!prev||now-prev.at>=25000||prev.online!==connected.online||prev.version!==connected.version){evidence.workerConnection=connected;changed=true}
   }
   if(changed){props.set(a.evidence,JSON.stringify(evidence));props.set(config.changedAt,new Date(now).toISOString());props.set(config.changedBy,'ONE · automatisch / automatic');row.set('updatedAt',now)}
   return {matched:true,atlas:props.get(config.checks.atlas)==='ready'&&!!evidence.atlas}
  },auth.user.id)
  if(result.atlas)s.db.run('UPDATE welcome_access SET completed_at=? WHERE target_workspace_id=? AND email_hash=? AND completed_at IS NULL',Date.now(),workspace.id,s.repo.hash(normalizeEmail(auth.user.email)))
  return c.json(result)
 })
 return app
}
