import {Hono} from 'hono'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {access,nameSchema} from './access.ts'
import {body} from '../http/util.ts'
import {conflict,forbidden,notFound,rateLimited} from '../errors.ts'
interface Area {workspace_id:string;parent_id:string;visibility:'open'|'closed'|'private'}
/** Each area uses a full existing workspace security boundary, including files and WebSockets. */
export function teamAreaRoutes(s:Services){
 const app=new Hono<AppEnv>()
 app.get('/:id/areas',c=>{
  const {workspace,auth}=access(s,c,'viewer')
  const areas=s.db.all<Area>('SELECT * FROM team_areas WHERE parent_id=? LIMIT 100',workspace.id)
  return c.json(areas.flatMap(a=>{const role=s.repo.memberRole(a.workspace_id,auth.user.id),w=s.repo.workspaceById(a.workspace_id);return w&&(a.visibility!=='private'||role)?[{id:w.id,name:w.name,visibility:a.visibility,role:role??null}]:[]}))
 })
 app.post('/:id/areas',async c=>{
  const {workspace,auth}=access(s,c,'admin'),v=await body(c,z.object({name:nameSchema,visibility:z.enum(['open','closed','private'])}).strict())
  if(auth.testAccess)throw forbidden()
  access(s,c,'admin')
  if(s.repo.countWorkspacesCreatedSince(auth.user.id,Date.now()-86400000)>=20)throw rateLimited(3600)
  if(s.db.get('SELECT 1 FROM team_areas WHERE workspace_id=?',workspace.id))throw conflict('area_nesting','Create areas in the parent workspace.')
  return s.db.tx(()=>{
   if(s.db.all('SELECT 1 FROM team_areas WHERE parent_id=?',workspace.id).length>=100)throw conflict('area_limit','This workspace has 100 areas.')
   const area=s.repo.createWorkspace(auth.user.id,v.name,null)
   s.db.run('INSERT INTO team_areas(workspace_id,parent_id,visibility,created_by,created_at) VALUES(?,?,?,?,?)',area.id,workspace.id,v.visibility,auth.user.id,Date.now())
   return c.json({id:area.id,name:area.name,visibility:v.visibility,role:'owner'},201)
  })
 })
 app.post('/:id/areas/:area/join',c=>{
  const {workspace,auth}=access(s,c,'viewer'),id=c.req.param('area')
  const a=s.db.get<Area>('SELECT * FROM team_areas WHERE parent_id=? AND workspace_id=?',workspace.id,id)
  if(!a||a.visibility==='private')throw notFound()
  if(a.visibility!=='open'||auth.testAccess||auth.user.pending_email)throw forbidden('area_invitation','This area requires a personal invitation.')
  // Joining never escalates a reader or temporary guest to an editor.
  s.db.tx(()=>{if(!s.repo.memberRole(id,auth.user.id))s.repo.addMember(id,auth.user.id,s.repo.memberRole(workspace.id,auth.user.id)==='viewer'?'viewer':'member',s.repo.members(workspace.id).find(m=>m.id===auth.user.id)?.guest===1)})
  return c.json({id})
 })
 return app
}
