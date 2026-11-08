import {createHash} from 'node:crypto'
import {Hono} from 'hono'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {access} from './access.ts'
import {body} from '../http/util.ts'
import {badRequest,conflict,forbidden,notFound} from '../errors.ts'
import {WorkspaceModel,contentDoc} from '../api/model.ts'
import {livePage} from '../api/meta.ts'
import {atLeast} from '../repo.ts'

interface Review {page_id:string;owner_id:string;due_at:number|null;verified_at:number|null;verified_by:string|null;source_hash:string|null;source_updated:string|null;version:number}
/** Reviews attest to a server-observed document, never a client-supplied claim of verification. */
export function knowledgeRoutes(s:Services,model:WorkspaceModel){
 const app=new Hono<AppEnv>()
 const row=(ws:string,page:string)=>s.db.get<Review>('SELECT * FROM knowledge_reviews WHERE workspace_id=? AND page_id=?',ws,page)
 const source=async(ws:string,page:string)=>{
  const p=await model.getPage(ws,page)
  const xml=await s.collab.read(contentDoc(ws,page),d=>d.getXmlFragment('default').toString())
  const after=await model.getPage(ws,page)
  if(p.updatedAt!==after.updatedAt)throw conflict('source_changed','The page changed. Reload before verifying.')
  return {title:p.title,updated:p.updatedAt,hash:createHash('sha256').update(JSON.stringify([p.title,p.text,xml,p.properties])).digest('hex')}
 }
 app.get('/:id/knowledge',async c=>{
  const {workspace}=access(s,c,'viewer')
  const rows=s.db.all<Review>('SELECT * FROM knowledge_reviews WHERE workspace_id=? ORDER BY due_at LIMIT 500',workspace.id)
  const visible=await model.read(workspace.id,r=>rows.filter(v=>!!livePage(r,v.page_id)))
  const result:unknown[]=[]
  for(let i=0;i<visible.length;i+=10)result.push(...await Promise.all(visible.slice(i,i+10).map(async v=>{const current=await source(workspace.id,v.page_id);return {...v,title:current.title,stale:!!v.verified_at&&v.source_hash!==current.hash,expired:!!v.due_at&&v.due_at<=Date.now()}})))
  access(s,c,'viewer')
  return c.json(result)
 })
 app.get('/:id/knowledge/:page',async c=>{
  const {workspace}=access(s,c,'viewer'),page=c.req.param('page'),current=await source(workspace.id,page)
  const review=row(workspace.id,page)
  access(s,c,'viewer')
  return c.json({review:review??null,source:current,stale:!!review?.verified_at&&review.source_hash!==current.hash,expired:!!review?.due_at&&review.due_at<=Date.now()})
 })
 app.put('/:id/knowledge/:page',async c=>{
  const {workspace,auth,role}=access(s,c,'member'),page=c.req.param('page')
  const v=await body(c,z.object({version:z.number().int().nonnegative(),owner:z.string().min(1).max(100),due:z.number().int().nullable(),hash:z.string().regex(/^[a-f0-9]{64}$/),verify:z.boolean()}).strict())
  if(auth.testAccess)throw forbidden()
  const before=row(workspace.id,page)
  if(before&&before.owner_id!==auth.user.id&&!atLeast(role,'admin'))throw forbidden('review_owner','Only the responsible person or an administrator can change this review.')
  if(!atLeast(s.repo.memberRole(workspace.id,v.owner)??'viewer','member'))throw badRequest('review_owner','Choose a current workspace member.')
  if(v.verify&&v.owner!==auth.user.id&&!atLeast(role,'admin'))throw forbidden('review_owner','Only the responsible person can verify this page.')
  if(v.due!==null&&(v.due<=Date.now()||v.due>Date.now()+366*86400000))throw badRequest('review_due','Choose a review date within the next year.')
  const current=await source(workspace.id,page)
  if(current.hash!==v.hash)throw conflict('source_changed','The page changed. Read the current version before verifying.')
  // Recheck permissions after asynchronous document reads.
  const fresh=access(s,c,'member')
  if(before&&before.owner_id!==fresh.auth.user.id&&!atLeast(fresh.role,'admin'))throw forbidden()
  if(v.verify&&v.owner!==fresh.auth.user.id&&!atLeast(fresh.role,'admin'))throw forbidden()
  if(!atLeast(s.repo.memberRole(workspace.id,v.owner)??'viewer','member'))throw forbidden()
  return s.db.tx(()=>{
   if((row(workspace.id,page)?.version??0)!==v.version)throw conflict('review_version','The review changed. Reload before saving.')
   s.db.run(`INSERT INTO knowledge_reviews(workspace_id,page_id,owner_id,due_at,verified_at,verified_by,source_hash,source_updated,version)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,page_id) DO UPDATE SET owner_id=excluded.owner_id,due_at=excluded.due_at,verified_at=excluded.verified_at,verified_by=excluded.verified_by,source_hash=excluded.source_hash,source_updated=excluded.source_updated,version=excluded.version`,
    workspace.id,page,v.owner,v.due,v.verify?Date.now():null,v.verify?auth.user.id:null,v.verify?current.hash:null,v.verify?current.updated:null,v.version+1)
   return c.json({saved:true})
  })
 })
 app.delete('/:id/knowledge/:page',c=>{
  const {workspace,auth,role}=access(s,c,'member'),page=c.req.param('page'),r=row(workspace.id,page)
  if(auth.testAccess)throw forbidden()
  if(!r)throw notFound()
  if(r.owner_id!==auth.user.id&&!atLeast(role,'admin'))throw forbidden()
  s.db.run('DELETE FROM knowledge_reviews WHERE workspace_id=? AND page_id=?',workspace.id,page)
  return c.json({removed:true})
 })
 return app
}
