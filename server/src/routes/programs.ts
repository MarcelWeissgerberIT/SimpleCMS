/** Personal, immutable executable artifacts. Neither workspace admins nor model tools can read another member's library. */
import {Hono} from 'hono'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {access} from './access.ts'
import {body} from '../http/util.ts'
import {badRequest,conflict,notFound} from '../errors.ts'
import {openText,sealText} from '../crypto/aead.ts'
import {compileProgram,readProgram,programDigest,type SavedProgram} from '../../../src/shared/quandprofile/program.ts'
import {summarizeProgramRun} from '../../../src/shared/quandprofile/program-run-summary.ts'
import {readProgramInspection} from '../../../src/shared/quandprofile/program-inspection.ts'
import {looksLikeKey} from '../../../src/shared/ai/keys.ts'
const id=z.string().uuid()
const compiled=z.object({compiler:z.literal('one.program.compiler.v1'),hash:z.string().regex(/^[a-f0-9]{64}$/),canonical:z.string().max(180000)}).strict()
const create=z.object({id,name:z.string().trim().min(1).max(120),previous:z.number().int().min(0).max(99),compiled}).strict()
const run=z.object({id,programId:id,version:z.number().int().min(1).max(100),hash:z.string().regex(/^[a-f0-9]{64}$/),inputHash:z.string().regex(/^[a-f0-9]{64}$/),route:z.object({provider:z.string().max(40),model:z.string().max(150)}).strict(),startedAt:z.number().int(),finishedAt:z.number().int(),status:z.enum(['done','failed','stopped']),steps:z.array(z.object({id:z.string().max(64),inputHash:z.string().regex(/^[a-f0-9]{64}$/),outputHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),at:z.number().int(),status:z.enum(['done','failed']),contractHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).max(40),answer:z.string().max(100000).optional(),error:z.string().max(4000).optional(),inspection:z.unknown().optional(),terminal:z.object({task:z.string().min(1).max(16000),tools:z.array(z.object({id:z.string().max(64),name:z.string().max(200),server:z.string().max(200).optional(),status:z.enum(['run','ok','err','staged']),at:z.number().int(),argument:z.string().max(1000).optional(),error:z.string().max(2000).optional(),notExecuted:z.boolean().optional(),refs:z.array(z.number().int().positive()).max(100).optional(),verification:z.string().max(40).optional()}).strict()).max(40)}).strict().optional()}).strict()
export function programRoutes(s:Services){
 const app=new Hono<AppEnv>()
 const scope=(c:Parameters<typeof access>[1])=>{const {auth,workspace}=access(s,c,'member'),key=s.repo.keys.forWorkspace(workspace.id);if(!key)throw notFound();c.header('Cache-Control','no-store');return {ws:workspace.id,user:auth.user.id,key:key.aead}}
 app.get('/:id/programs',c=>{const {ws,user,key}=scope(c);return c.json({programs:s.db.all<{sealed:string;program_id:string;version:number}>('SELECT sealed,program_id,version FROM task_programs WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 200',ws,user).map(r=>JSON.parse(openText(key,r.sealed,`program\n${ws}\n${user}\n${r.program_id}\n${r.version}`)))})})
 app.post('/:id/programs',async c=>{
  const {ws,user,key}=scope(c),v=await body(c,create)
  try{readProgram(v.compiled);if(compileProgram(JSON.parse(v.compiled.canonical)).hash!==v.compiled.hash||looksLikeKey(v.name+' '+v.compiled.canonical))throw Error('Do not store credentials in an executable artifact.')}catch(e){throw badRequest('invalid_program',e instanceof Error?e.message:'Invalid artifact')}
  return s.db.tx(()=>{const latest=s.db.get<{version:number}>('SELECT MAX(version) AS version FROM task_programs WHERE workspace_id=? AND user_id=? AND program_id=?',ws,user,v.id)?.version??0
   if(latest!==v.previous)throw conflict('program_version','The saved version changed. Reload before creating a new version.')
   if((s.db.get<{n:number}>('SELECT COUNT(*) AS n FROM task_programs WHERE workspace_id=? AND user_id=?',ws,user)?.n??0)>=200)throw conflict('program_limit','Personal artifact library limit (200 versions).')
   const p:SavedProgram={id:v.id,name:v.name,version:latest+1,createdAt:Date.now(),compiled:v.compiled}
   s.db.run('INSERT INTO task_programs(workspace_id,user_id,program_id,version,hash,sealed,created_at) VALUES(?,?,?,?,?,?,?)',ws,user,p.id,p.version,p.compiled.hash,sealText(key,JSON.stringify(p),`program\n${ws}\n${user}\n${p.id}\n${p.version}`),p.createdAt)
   return c.json(p,201)
  })
 })
 app.get('/:id/programs/runs',c=>{const {ws,user,key}=scope(c);return c.json({runs:s.db.all<{id:string;sealed:string}>('SELECT id,sealed FROM task_program_runs WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100',ws,user).map(r=>{const run=JSON.parse(openText(key,r.sealed,`program-run\n${ws}\n${user}\n${r.id}`));return c.req.query('summary')==='1'?summarizeProgramRun(run):run})})})
 app.get('/:id/programs/runs/:runId',c=>{const {ws,user,key}=scope(c),runId=c.req.param('runId');const row=s.db.get<{sealed:string}>('SELECT sealed FROM task_program_runs WHERE workspace_id=? AND user_id=? AND id=?',ws,user,runId);if(!row)throw notFound();return c.json(JSON.parse(openText(key,row.sealed,`program-run\n${ws}\n${user}\n${runId}`)))})
 app.post('/:id/programs/runs',async c=>{const {ws,user,key}=scope(c),v=await body(c,run);if(v.inspection!==undefined)try{v.inspection=readProgramInspection(v.inspection)}catch{throw badRequest('run_inspection','Invalid inspection receipt')}const p=s.db.get<{hash:string}>('SELECT hash FROM task_programs WHERE workspace_id=? AND user_id=? AND program_id=? AND version=?',ws,user,v.programId,v.version);if(v.terminal?(v.programId!==v.id||v.version!==1||v.hash!==programDigest({task:v.terminal.task})):p?.hash!==v.hash)throw badRequest('program_binding','Run does not match your saved artifact');if(looksLikeKey(JSON.stringify(v)))throw badRequest('run_secret','Receipt may contain a credential; not saved');
  s.db.tx(()=>{s.db.run('INSERT INTO task_program_runs(workspace_id,user_id,id,sealed,created_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,user_id,id) DO NOTHING',ws,user,v.id,sealText(key,JSON.stringify(v),`program-run\n${ws}\n${user}\n${v.id}`),Date.now());s.db.run('DELETE FROM task_program_runs WHERE workspace_id=? AND user_id=? AND id NOT IN (SELECT id FROM task_program_runs WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100)',ws,user,ws,user)})
  return c.json({saved:true},201)
 })
 return app
}
