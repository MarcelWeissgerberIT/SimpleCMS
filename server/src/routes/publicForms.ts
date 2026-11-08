import {Hono} from 'hono'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {AppEnv,Services} from '../context.ts'
import {access} from './access.ts'
import {body} from '../http/util.ts'
import {badRequest,conflict,forbidden,notFound,rateLimited} from '../errors.ts'
import {openText,sealText} from '../crypto/aead.ts'
import {newId,randomToken} from '../tokens.ts'
import {liveDatabase} from '../api/meta.ts'
import {coerce} from '../api/values.ts'
import type {WorkspaceModel} from '../api/model.ts'
import {idempotent} from '../api/auth.ts'
const condition=z.object({q:z.string(),op:z.enum(['is','is_not','contains','not_contains','empty','not_empty','checked','unchecked','eq','gt','lt','before','after']),value:z.union([z.string(),z.number(),z.null()]).optional()})
const field=z.object({key:z.string().min(1).max(100),name:z.string().min(1).max(300),kind:z.enum(['short','long','number','select','multi','checkbox','email','phone','url','rating','date']),required:z.boolean(),help:z.string().max(2000),options:z.array(z.object({id:z.string().max(100),name:z.string().max(300),color:z.string().max(30)})).max(120).optional(),includeTime:z.boolean().optional(),max:z.number().int().min(1).max(10).optional(),percent:z.boolean().optional(),placeholder:z.string().max(300).optional(),display:z.enum(['chips','list','dropdown','scale']).optional(),scale:z.number().int().min(1).max(10).optional(),showIf:z.object({op:z.enum(['and','or']),conditions:z.array(condition).max(30)}).optional(),page:z.object({title:z.string().max(300),description:z.string().max(2000)}).optional()}).strict()
const publish=z.object({database:z.string().max(100),view:z.string().max(100),title:z.string().min(1).max(300),description:z.string().max(8000),fields:z.array(field).min(1).max(80),marker:z.object({propertyId:z.string().max(100),optionId:z.string().max(100)}).optional(),days:z.number().int().min(1).max(365)}).strict()
type Form=z.infer<typeof publish>&{schema:string}
type Row={id:string;workspace_id:string;database_id:string;view_id:string;sealed:string;created_by:string;expires_at:number;revoked_at:number|null;submissions:number}
const kinds:Record<string,string[]>={title:['short'],text:['short','long'],number:['number'],rating:['rating'],select:['select'],status:['select'],multi_select:['multi'],checkbox:['checkbox'],email:['email'],phone:['phone'],url:['url'],date:['date']}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
export function publicFormRoutes(s:Services,model:WorkspaceModel){
 const app=new Hono<AppEnv>(),key=(ws:string)=>s.repo.keys.forWorkspace(ws)!.aead
 const read=(r:Row):Form=>JSON.parse(openText(key(r.workspace_id),r.sealed,`public-form\n${r.workspace_id}\n${r.id}`))
 app.get('/workspaces/:id/public-forms',c=>{const {workspace}=access(s,c,'admin');return c.json(s.db.all('SELECT id,database_id,view_id,expires_at,revoked_at,submissions FROM public_forms WHERE workspace_id=?',workspace.id))})
 app.post('/workspaces/:id/public-forms',async c=>{
  const {workspace,auth}=access(s,c,'admin');if(auth.testAccess)throw forbidden()
  const v=await body(c,publish)
  for(const [i,f] of v.fields.entries())if(f.showIf?.conditions.some(c=>!v.fields.slice(0,i).some(f=>f.key===c.q)))throw badRequest('form_conditions','Conditions must reference an earlier question.')
  const props=await model.read(workspace.id,r=>{const db=liveDatabase(r,v.database);if(!db)throw notFound();return db.properties})
  if(new Set(v.fields.map(f=>f.key)).size!==v.fields.length)throw badRequest('form_value','Invalid answer')
  for(const f of v.fields){const p=props.find(p=>p.id===f.key);if(!p||!kinds[p.type]?.includes(f.kind)||p.agentReadOnly||p.key||p.custom)throw badRequest('form_field','A field cannot be published directly. Use text, number, choice, checkbox or date fields.');if(f.options?.some(o=>!p.options?.some(p=>p.id===o.id)))throw badRequest('form_option','An option is not part of this database.')}
  if(v.marker){const marker=props.find(p=>p.id===v.marker!.propertyId);if(!marker||marker.type!=='select'||marker.key||marker.agentReadOnly||!marker.options?.some(o=>o.id===v.marker!.optionId))throw badRequest('form_marker','The response marker changed.')}
  const form:Form={...v,schema:digest(props.filter(p=>(v.fields.some(f=>f.key===p.id)||v.marker?.propertyId===p.id)))},id=newId(),token=randomToken()
  access(s,c,'admin')
  s.db.tx(()=>{s.db.run('DELETE FROM public_forms WHERE workspace_id=? AND database_id=? AND view_id=?',workspace.id,v.database,v.view);s.db.run('INSERT INTO public_forms(id,workspace_id,database_id,view_id,token_hash,sealed,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',id,workspace.id,v.database,v.view,s.repo.hash(token),sealText(key(workspace.id),JSON.stringify(form),`public-form\n${workspace.id}\n${id}`),auth.user.id,Date.now(),Date.now()+v.days*86400000)})
  return c.json({id,token,expiresAt:Date.now()+v.days*86400000},201)
 })
 app.delete('/workspaces/:id/public-forms/:form',c=>{const {workspace,auth}=access(s,c,'admin');if(auth.testAccess)throw forbidden();s.db.run('UPDATE public_forms SET revoked_at=? WHERE workspace_id=? AND id=?',Date.now(),workspace.id,c.req.param('form'));return c.json({revoked:true})})
 const load=(token:string)=>{const r=s.db.get<Row>('SELECT * FROM public_forms WHERE token_hash=?',s.repo.hash(token));if(!r||r.revoked_at||r.expires_at<=Date.now()||!['owner','admin'].includes(s.repo.memberRole(r.workspace_id,r.created_by)??''))throw notFound();const wait=s.limiter.hit('form:'+r.id,30,60000);if(wait)throw rateLimited(wait);return r}
 app.get('/public-forms/:token',c=>{const r=load(c.req.param('token')),f=read(r);return c.json({title:f.title,description:f.description,fields:f.fields,expiresAt:r.expires_at})})
 app.post('/public-forms/:token',async c=>{
  const r=load(c.req.param('token')),f=read(r),v=await body(c,z.object({delivery:z.string().uuid(),answers:z.record(z.string(),z.unknown())}).strict())
  if(Object.keys(v.answers).some(k=>!f.fields.some(f=>f.key===k)))throw badRequest('form_field','Unknown question.')
  return idempotent(s,c,'form:'+r.id,v.delivery,r.workspace_id,async()=>{
   const row=await model.read(r.workspace_id,root=>{
    const db=liveDatabase(root,r.database_id);if(!db)throw notFound()
    if(digest(db.properties.filter(p=>(f.fields.some(f=>f.key===p.id)||f.marker?.propertyId===p.id)))!==f.schema)throw conflict('form_changed','This form changed. Ask its owner for a new link.')
    let title='';const values:Record<string,unknown>={},visible=new Set<string>()
    for(const q of f.fields){if(q.showIf?.conditions.length){const checks=q.showIf.conditions.map(c=>conditionHolds(c,visible.has(c.q)?v.answers[c.q]:undefined));if(!(q.showIf.op==='and'?checks.every(Boolean):checks.some(Boolean)))continue}visible.add(q.key);const p=db.properties.find(p=>p.id===q.key)!,a=v.answers[q.key];const empty=a==null||a===''||(Array.isArray(a)&&!a.length)||(q.kind==='checkbox'&&a!==true)||(q.kind==='date'&&(!(a&&typeof a==='object')||!('date'in a)||!a.date));if(q.required&&empty)throw badRequest('form_required',q.name);if(empty)continue
     let value=a
     if(q.kind==='date'){const d=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string().regex(/^(?:\d{2}:\d{2})?$/)}).safeParse(a);if(!d.success)throw badRequest('form_date',q.name);value=d.data.date+(d.data.time?'T'+d.data.time:'')}
     if(q.kind==='number'&&typeof a==='string'){value=Number(a.replace(',','.'));if(!Number.isFinite(value))throw badRequest('form_value','Invalid answer');if(q.percent)value=(value as number)/100}
     if(q.kind==='select'&&!q.options?.some(o=>o.id===a))throw badRequest('form_option',q.name)
     if(q.kind==='multi'&&(!Array.isArray(a)||a.some(x=>!q.options?.some(o=>o.id===x))))throw badRequest('form_option',q.name)
     if(p.type==='title'){if(typeof a!=='string'||a.length>2000)throw badRequest('form_value','Invalid answer');title=a}else try{values[p.id]=coerce(p,value,model.context(r.workspace_id,root))}catch{throw badRequest('form_value',q.name)}
    }
    if(f.marker)values[f.marker.propertyId]=f.marker.optionId
    return {title:title||f.title,values,nodes:null}
   })
   load(c.req.param('token'))
   await model.insertRow(r.workspace_id,r.database_id,row,'form:'+r.id,undefined,props=>{const current=s.db.get<Row>('SELECT * FROM public_forms WHERE id=?',r.id);if(!current||current.revoked_at||current.expires_at<=Date.now()||!['owner','admin'].includes(s.repo.memberRole(r.workspace_id,r.created_by)??''))throw notFound();if(digest(props.filter(p=>(f.fields.some(f=>f.key===p.id)||f.marker?.propertyId===p.id)))!==f.schema)throw conflict('form_changed','This form changed. Ask its owner for a new link.')})
   s.db.run('UPDATE public_forms SET submissions=submissions+1 WHERE id=?',r.id)
   return {status:201 as const,body:{received:true}}
  })
 })
 return app
}

function conditionHolds(c:z.infer<typeof condition>,a:unknown){
 const empty=a==null||a===''||a===false||(Array.isArray(a)&&!a.length)||(typeof a==='object'&&!Array.isArray(a)&&!('date' in a!&&a.date)),value=c.value
 if(c.op==='empty'||c.op==='not_empty')return c.op==='empty'?empty:!empty
 if(c.op==='checked'||c.op==='unchecked')return c.op==='checked'?a===true:a!==true
 if(c.op==='is'||c.op==='is_not')return c.op==='is'?a===value:a!==value
 if(c.op==='contains'||c.op==='not_contains'){const hit=Array.isArray(a)?a.includes(value):typeof a==='string'&&a.toLocaleLowerCase().includes(String(value??'').toLocaleLowerCase());return c.op==='contains'?hit:!hit}
 if(c.op==='before'||c.op==='after'){const d=a&&typeof a==='object'&&'date'in a?String(a.date):'';return !!d&&(c.op==='before'?d<String(value):d>String(value))}
 if(empty)return false;const n=Number(typeof a==='string'?a.replace(',','.'):a),v=Number(value);return Number.isFinite(n)&&(c.op==='eq'?n===v:c.op==='gt'?n>v:n<v)
}
