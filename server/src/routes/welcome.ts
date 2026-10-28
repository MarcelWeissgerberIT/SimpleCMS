import { openText, sealText } from '../crypto/aead.ts'
import type { PersonalGuide } from '../../../src/shared/personal-guides.ts'
/** Explicit, private welcome preparation. No scheduler, model, shared document or automatic retry. */
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { body, idSchema, requireAuth } from '../http/util.ts'
import { badRequest, conflict, forbidden, notFound, rateLimited } from '../errors.ts'
import { access } from './access.ts'
import { atLeast, normalizeEmail } from '../repo.ts'
import { DAY, newId } from '../tokens.ts'
import { welcomeMail } from '../mail/templates.ts'
import { WelcomeStore, type Draft, type Recipient } from '../welcome/store.ts'

const https = z.string().max(4096).refine(s=>{if(!s)return true;try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}})
const recipient = z.object({id:idSchema,name:z.string().trim().min(1).max(100),email:z.email().max(254),workspaceId:idSchema,role:z.enum(['member','viewer']),guest:z.boolean(),note:z.string().max(300),atlasLink:https.optional(),atlasToken:z.string().trim().max(4096).refine(s=>!/[\r\n\s]/.test(s)).optional()})
const schema=z.object({revision:z.number().int().min(0),title:z.string().trim().min(1).max(100),notBefore:z.number().int().min(0).max(8640000000000000),lang:z.enum(['en','de']),recipients:z.array(recipient).max(50)})
const locks=new Set<string>()
export function welcomeRoutes(s:Services) {
  const app=new Hono<AppEnv>(), store=new WelcomeStore(s)
  app.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
  function target(user:string,id:string) { const role=s.repo.memberRole(id,user);const w=s.repo.workspaceById(id);if(!role||!atLeast(role,'admin')||!w||w.personal_of)throw forbidden('welcome_target','Every destination must be a team workspace you administer');return w }
  function read(ws:string,user:string) { const d=store.read(ws,user);if(!d)throw notFound('welcome_missing','No private welcome draft');return d }
  const key=(ws:string,u:string)=>`${ws}:${u}`
  // No shared Yjs metadata, model context, welcome credentials or impersonation session.
  app.put('/:id/personal-guides/:guide',async c=>{
    const {workspace,auth}=access(s,c,'admin')
    if(auth.testAccess)throw forbidden('personal_guide_test','Use your own account.')
    const id=c.req.param('guide')
    if(!idSchema.safeParse(id).success)throw badRequest('personal_guide_id','Invalid guide ID')
    const v=await body(c,z.object({email:z.email().max(254),title:z.string().trim().min(1).max(150),sections:z.array(z.object({title:z.string().min(1).max(150),body:z.string().max(12000),prompt:z.string().max(6000).optional()})).min(1).max(20),expiresAt:z.number().int().min(Date.now()+60000).max(Date.now()+90*DAY)}))
    const old=s.db.get<{created_by:string;workspace_id:string}>('SELECT created_by,workspace_id FROM personal_guides WHERE id=?',id)
    if(old&&(old.created_by!==auth.user.id||old.workspace_id!==workspace.id))throw forbidden('personal_guide_owner','Only the preparing owner may replace this guide.')
    const key=s.repo.keys.forWorkspace(workspace.id)!.aead
    const guide:PersonalGuide={id,title:v.title,sections:v.sections}
    const sealed=sealText(key,JSON.stringify(guide),`personal-guide\n${workspace.id}\n${id}`)
    s.db.run('INSERT INTO personal_guides(id,workspace_id,created_by,email_hash,sealed,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email_hash=excluded.email_hash,sealed=excluded.sealed,expires_at=excluded.expires_at',id,workspace.id,auth.user.id,s.repo.hash(normalizeEmail(v.email)),sealed,v.expiresAt)
    return c.json({id})
  })
  app.get('/:id/personal-guides',c=>{
    const {workspace,auth}=access(s,c,'viewer')
    if(auth.testAccess)return c.json([])
    const rows=s.db.all<{id:string;created_by:string;sealed:string}>('SELECT id,created_by,sealed FROM personal_guides WHERE workspace_id=? AND email_hash=? AND expires_at>?',workspace.id,s.repo.hash(normalizeEmail(auth.user.email)),Date.now())
    const key=s.repo.keys.forWorkspace(workspace.id)!.aead
    return c.json(rows.filter(r=>atLeast(s.repo.memberRole(workspace.id,r.created_by)??'viewer','admin')).map(r=>JSON.parse(openText(key,r.sealed,`personal-guide\n${workspace.id}\n${r.id}`)) as PersonalGuide))
  })
  app.get('/:id/welcome',c=>{const {workspace,auth}=access(s,c,'admin');return c.json(store.read(workspace.id,auth.user.id)?store.safe(read(workspace.id,auth.user.id)):null)})
  app.put('/:id/welcome',async c=>{
    const {workspace,auth}=access(s,c,'admin'), v=await body(c,schema), k=key(workspace.id,auth.user.id)
    if(locks.has(k))throw conflict('welcome_busy','Sending is in progress')
    const old=store.read(workspace.id,auth.user.id)
    if(v.revision!==(old?.revision??0))throw conflict('welcome_changed','Reload the draft before saving')
    if(new Set(v.recipients.map(r=>r.id)).size!==v.recipients.length||new Set(v.recipients.map(r=>normalizeEmail(r.email))).size!==v.recipients.length)throw badRequest('welcome_duplicate','Duplicate recipient identity or email')
    for(const r of old?.recipients??[])if(r.status!=='draft'&&!v.recipients.some(n=>n.id===r.id))throw conflict('welcome_locked','Sent or uncertain recipients cannot be removed')
    const recipients:Recipient[]=v.recipients.map(r=>{
      target(auth.user.id,r.workspaceId)
      if(r.guest&&r.role!=='viewer')throw badRequest('welcome_guest','Guests must have viewer access in their destination workspace')
      const previous=old?.recipients.find(p=>p.id===r.id)
      const next={...r,email:normalizeEmail(r.email),status:previous?.status??'draft',hasAtlasLink:false,hasAtlasToken:false,atlasHost:null,atlasLink:r.atlasLink??previous?.atlasLink??'',atlasToken:r.atlasToken??previous?.atlasToken??'',...(previous?.sentAt?{sentAt:previous.sentAt}:{})} satisfies Recipient
      if(previous&&previous.status!=='draft'&&(['name','email','workspaceId','role','guest','note','atlasLink','atlasToken'] as const).some(k=>next[k]!==previous[k]))throw conflict('welcome_locked','Sent or uncertain recipients cannot be changed')
      return next
    })
    const d:Draft={...v,revision:v.revision+1,recipients};store.save(workspace.id,auth.user.id,d);return c.json(store.safe(d))
  })
  app.get('/:id/welcome/preview/:recipient',c=>{
    const {workspace,auth}=access(s,c,'admin'),d=read(workspace.id,auth.user.id),r=d.recipients.find(r=>r.id===c.req.param('recipient'))
    if(!r)throw notFound('welcome_recipient','Recipient not found')
    const w=target(auth.user.id,r.workspaceId)
    return c.json(welcomeMail(d.lang,{name:r.name,title:d.title,workspace:w.name,link:'[Personal ONE invitation is created only when you press Send]',atlasLink:r.atlasLink?'https://'+new URL(r.atlasLink).host+'/[personal-link-hidden]':'[Atlas link missing]',startLink:s.config.publicUrl+`/app/?w=${encodeURIComponent(w.id)}#/`,guest:r.guest,note:r.note}))
  })
  app.post('/:id/welcome/send',async c=>{
    const {workspace,auth}=access(s,c,'admin'),{revision}=await body(c,z.object({revision:z.number().int()})),k=key(workspace.id,auth.user.id)
    if(locks.has(k))throw conflict('welcome_busy','Sending is already in progress')
    const d=read(workspace.id,auth.user.id)
    if(d.revision!==revision)throw conflict('welcome_changed','Reload and review the current draft')
    if(Date.now()<d.notBefore)throw conflict('welcome_early','Manual sending is not enabled yet')
    if(s.mailer.mode!=='smtp'&&!s.config.devMode)throw conflict('welcome_mail','SMTP is not configured')
    const pending=d.recipients.filter(r=>r.status==='draft')
    if(!pending.length)throw conflict('welcome_done','No unsent recipients')
    for(const r of pending){target(auth.user.id,r.workspaceId);const existing=s.repo.userByEmail(r.email),role=existing&&s.repo.memberRole(r.workspaceId,existing.id);if(r.guest&&(r.role!=='viewer'||(role&&role!=='viewer')))throw conflict('welcome_guest','Guest recipients must have viewer access; review existing membership first');if(!r.atlasLink)throw badRequest('welcome_atlas','Every recipient needs their Atlas link')}
    for(const id of new Set(pending.map(r=>r.workspaceId)))if(s.repo.countInvitesSince(id,Date.now()-DAY)+pending.filter(r=>r.workspaceId===id).length>50)throw rateLimited(3600)
    locks.add(k)
    // Persist before any mail: process death or ambiguous SMTP failure must never trigger a silent duplicate.
    for(const r of pending)r.status='sending'
    d.revision++;store.save(workspace.id,auth.user.id,d)
    try {
      for(const r of pending){
        try{
          // Recheck both author and destination rights for each individual send.
          if(!atLeast(s.repo.memberRole(workspace.id,auth.user.id)??'viewer','admin'))throw new Error('Access changed')
          const w=target(auth.user.id,r.workspaceId),existing=s.repo.userByEmail(r.email),member=existing&&s.repo.memberRole(w.id,existing.id)
          if(r.guest&&member&&member!=='viewer')throw new Error('Guest membership changed')
          const link=member?s.config.publicUrl+`/app/?w=${encodeURIComponent(w.id)}`:s.config.publicUrl+'/app/#/invite/'+s.repo.createInvite({workspaceId:w.id,role:r.role,guest:r.guest,email:r.email,createdBy:auth.user.id,ttl:7*DAY,maxUses:1}).token
          if(r.guest&&member==='viewer'&&existing)s.repo.setRole(w.id,existing.id,'viewer',true)
          store.grant(workspace.id,auth.user.id,newId(),r,Date.now()+7*DAY)
          const mail=welcomeMail(d.lang,{name:r.name,title:d.title,workspace:w.name,link,atlasLink:r.atlasLink,startLink:s.config.publicUrl+`/app/?w=${encodeURIComponent(w.id)}#/`,guest:r.guest,note:r.note})
          await s.mailer.send({to:r.email,link,...mail});r.status='sent';r.sentAt=Date.now()
        }catch{r.status='uncertain'}
        d.revision++;store.save(workspace.id,auth.user.id,d)
      }
      s.log.info('welcome batch completed',{workspace:workspace.id,user:auth.user.id,sent:pending.filter(r=>r.status==='sent').length,uncertain:pending.filter(r=>r.status==='uncertain').length})
      return c.json(store.safe(d))
    }finally{locks.delete(k)}
  })
  app.get('/:id/welcome-access',c=>{
    const {workspace,auth}=access(s,c,'viewer')
    // The first-start guide can reopen the same person's setup after its welcome
    // reminder was completed. No other recipient or expired grant is exposed.
    const all=c.req.query('setup')==='1'
    const rows=s.db.all<{id:string}>('SELECT id FROM welcome_access WHERE target_workspace_id=? AND email_hash=? AND expires_at>?'+(all?'':' AND completed_at IS NULL'),workspace.id,s.repo.hash(normalizeEmail(auth.user.email)),Date.now())
    return c.json(rows)
  })
  app.post('/:id/welcome-access/:entry/open',c=>{
    const {workspace,auth}=access(s,c,'viewer'), id=c.req.param('entry')
    if(!idSchema.safeParse(id).success)throw notFound('welcome_access','Access not found')
    const r=s.db.get<{workspace_id:string;user_id:string;sealed:string}>('SELECT workspace_id,user_id,sealed FROM welcome_access WHERE id=? AND target_workspace_id=? AND email_hash=? AND expires_at>?',id,workspace.id,s.repo.hash(normalizeEmail(auth.user.email)),Date.now())
    if(!r||!atLeast(s.repo.memberRole(r.workspace_id,r.user_id)??'viewer','admin'))throw notFound('welcome_access','Access not found')
    requireAuth(c)
    return c.json(store.open(r.workspace_id,id,r.sealed))
  })
  app.post('/:id/welcome-access/:entry/complete',c=>{
    const {workspace,auth}=access(s,c,'viewer')
    if(!s.db.run('UPDATE welcome_access SET completed_at=? WHERE id=? AND target_workspace_id=? AND email_hash=? AND expires_at>?',Date.now(),c.req.param('entry'),workspace.id,s.repo.hash(normalizeEmail(auth.user.email)),Date.now()))throw notFound('welcome_access','Access not found')
    return c.body(null,204)
  })
  return app
}
