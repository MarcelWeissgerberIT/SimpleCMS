/** Explicit owner-assisted enrollment when mail is unavailable. Never a recovery link for an existing account. */
import type {Services} from '../context.ts'
import type {UserRow} from '../repo.ts'
import {DAY} from '../tokens.ts'
import {issueLoginLink} from './login-link.ts'

export interface OwnerActivation {
 token_hash:string;actor_id:string;source_workspace_id:string;workspace_id:string;name:string;role:'member'|'viewer';guest:number
}
export function validActivation(s:Services,a:OwnerActivation,email:string):boolean{
 return !s.config.adminEmails.includes(email)&&!s.repo.userByEmail(email)&&[a.source_workspace_id,a.workspace_id].every(id=>s.repo.memberRole(id,a.actor_id)==='owner'&&!s.repo.workspaceById(id)?.personal_of)
}
export function issueOwnerActivation(s:Services,p:{email:string;name:string;actorId:string;sourceId:string;workspaceId:string;role:'member'|'viewer';guest:boolean;lang:'en'|'de'}){
 return s.db.tx(()=>{
  // Replacing a not-yet-used link invalidates the earlier link for this owner, address and destination.
  s.db.run('UPDATE login_tokens SET used_at=? WHERE email=? AND used_at IS NULL AND token_hash IN (SELECT token_hash FROM owner_activations WHERE actor_id=? AND workspace_id=?)',Date.now(),p.email,p.actorId,p.workspaceId)
  const result=issueLoginLink(s,{email:p.email,lang:p.lang,redirect:`/app/?w=${encodeURIComponent(p.workspaceId)}`,ttl:DAY})
  const hash=s.repo.hash(new URL(result.link).searchParams.get('token')!)
  s.db.run('UPDATE login_tokens SET owner_activation=1 WHERE token_hash=?',hash)
  s.db.run('INSERT INTO owner_activations(token_hash,actor_id,source_workspace_id,workspace_id,name,role,guest) VALUES(?,?,?,?,?,?,?)',hash,p.actorId,p.sourceId,p.workspaceId,p.name,p.role,Number(p.guest))
  return result
 })
}
/** The token and new account are consumed/created atomically; a concurrent ordinary sign-in wins safely. */
export function consumeOwnerActivation(s:Services,a:OwnerActivation,email:string):UserRow|null{
 const user=s.db.tx(()=>{
  if(!validActivation(s,a,email))return null
  const now=Date.now()
  if(!s.db.run('UPDATE login_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?',now,a.token_hash,now))return null
  const user=s.repo.createUser(email,a.name)
  s.repo.addMember(a.workspace_id,user.id,a.role,!!a.guest)
  return user
 })
 if(user)s.log.info('owner-assisted account activated',{actor:a.actor_id,workspace:a.workspace_id,user:user.id,via:'owner-activation'})
 return user
}
