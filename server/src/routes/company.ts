import {Hono} from 'hono'
import {getCookie,setCookie,deleteCookie} from 'hono/cookie'
import * as oidc from 'openid-client'
import {z} from 'zod'
import type {AppEnv,Services} from '../context.ts'
import {access} from './access.ts'
import {body,clientIp} from '../http/util.ts'
import {badRequest,conflict,forbidden,notFound,rateLimited} from '../errors.ts'
import {randomToken} from '../tokens.ts'
import {openText,sealText} from '../crypto/aead.ts'
const providerSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,40}$/),label:z.string().min(1).max(100),issuer:z.string().url(),clientId:z.string().min(1),clientSecret:z.string().min(1),workspaceId:z.string().min(1),calendar:z.enum(['google','microsoft']).optional()}).strict()
export type CompanyProvider=z.infer<typeof providerSchema>
export function companyProviders():CompanyProvider[]{
 const raw=process.env.ONE_COMPANY_PROVIDERS;if(!raw)return []
 const providers=z.array(providerSchema).max(20).parse(JSON.parse(raw))
 if(new Set(providers.map(p=>p.id)).size!==providers.length)throw Error('Duplicate company provider ID')
 for(const p of providers){if(p.issuer!=='https://accounts.google.com'&&!/^https:\/\/login\.microsoftonline\.com\/[a-f0-9-]{36}\/v2\.0$/.test(p.issuer))throw Error('Company provider must use Google or a specific Microsoft tenant');if(p.calendar==='google'&&p.issuer!=='https://accounts.google.com'||p.calendar==='microsoft'&&!p.issuer.includes('microsoftonline.com'))throw Error('Calendar provider mismatch')}
 return providers
}
export function companyRoutes(s:Services){
 const app=new Hono<AppEnv>(),providers=companyProviders(),configs=new Map<string,Promise<oidc.Configuration>>()
 const config=(p:CompanyProvider)=>{let c=configs.get(p.id);if(!c){c=oidc.discovery(new URL(p.issuer),p.clientId,p.clientSecret).catch(e=>{configs.delete(p.id);throw e});configs.set(p.id,c)}return c}
 type Pending={provider:string;verifier:string;nonce:string;expires:number;user:string|null;intent:string;browser:string}
 const pending=new Map<string,Pending>()
 const cleanup=()=>{for(const [k,p] of pending)if(p.expires<Date.now())pending.delete(k)}
 const publicProvider=(p:CompanyProvider)=>({id:p.id,label:p.label,calendar:p.calendar??null})
 app.get('/company/providers',c=>c.json(providers.map(publicProvider)))
 app.get('/workspaces/:id/company',c=>{const {workspace,auth}=access(s,c,'viewer');return c.json({providers:providers.filter(p=>p.workspaceId===workspace.id).map(p=>({...publicProvider(p),linked:!!s.db.get('SELECT 1 FROM company_identities WHERE provider=? AND user_id=?',p.id,auth.user.id),calendarConnected:!!s.db.get('SELECT 1 FROM calendar_grants WHERE workspace_id=? AND user_id=? AND provider=?',workspace.id,auth.user.id,p.id)})),scim:!!s.db.get('SELECT 1 FROM scim_tokens WHERE workspace_id=?',workspace.id)})})
 app.post('/workspaces/:id/company/scim-token',async c=>{const {workspace,auth}=access(s,c,'owner');if(auth.testAccess)throw forbidden();const v=await body(c,z.object({provider:z.string()}).strict());if(!providers.some(p=>p.id===v.provider&&p.workspaceId===workspace.id))throw badRequest('provider','Configure a company provider first.');access(s,c,'owner');const token=randomToken();s.db.run('INSERT INTO scim_tokens(workspace_id,token_hash,provider,created_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET token_hash=excluded.token_hash,provider=excluded.provider,created_at=excluded.created_at',workspace.id,s.repo.hash(token),v.provider,Date.now());return c.json({token,url:s.config.publicUrl+'/api/v1/scim/'+workspace.id})})
 app.delete('/workspaces/:id/company/scim-token',c=>{const {workspace,auth}=access(s,c,'owner');if(auth.testAccess)throw forbidden();s.db.run('DELETE FROM scim_tokens WHERE workspace_id=?',workspace.id);return c.json({revoked:true})})
 app.get('/company/:provider/start',async c=>{
  const p=providers.find(p=>p.id===c.req.param('provider'));if(!p)throw notFound()
  const wait=s.limiter.hit('company:'+clientIp(c,s.config),15,60000);if(wait)throw rateLimited(wait)
  const intent=c.req.query('intent')??'signin';if(!['signin','link','calendar'].includes(intent))throw badRequest('intent','Invalid sign-in intent')
  const auth=c.get('auth');if(auth?.testAccess)throw forbidden()
  if(intent!=='signin'&&(!auth||auth.user.pending_email||!s.repo.memberRole(p.workspaceId,auth.user.id)))throw forbidden()
  if(intent==='calendar'&&!p.calendar)throw badRequest('calendar','Calendar not configured')
  cleanup();if(pending.size>=1000)throw rateLimited(60)
  const state=oidc.randomState(),verifier=oidc.randomPKCECodeVerifier(),nonce=oidc.randomNonce(),browser=randomToken(),cfg=await config(p)
  pending.set(s.repo.hash(state),{provider:p.id,verifier,nonce,expires:Date.now()+600000,user:intent==='signin'?null:auth!.user.id,intent,browser:s.repo.hash(browser)})
  setCookie(c,'one_company_state',browser,{httpOnly:true,secure:s.config.publicUrl.startsWith('https:'),sameSite:'Lax',path:'/api/company',maxAge:600})
  const scope='openid profile email'+(intent==='calendar'?' '+(p.calendar==='google'?'https://www.googleapis.com/auth/calendar.readonly':'https://graph.microsoft.com/Calendars.Read'):'')
  return c.redirect(oidc.buildAuthorizationUrl(cfg,{redirect_uri:s.config.publicUrl+'/api/company/callback',scope,state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',prompt:'select_account'}).href)
 })
 app.get('/company/callback',async c=>{
  const state=c.req.query('state')??'',saved=pending.get(s.repo.hash(state));pending.delete(s.repo.hash(state))
  const browser=getCookie(c,'one_company_state')??'';deleteCookie(c,'one_company_state',{path:'/api/company'})
  if(!saved||saved.expires<Date.now()||saved.browser!==s.repo.hash(browser))throw badRequest('company_state','Sign-in expired. Start again.')
  const p=providers.find(p=>p.id===saved.provider)!,auth=c.get('auth')
  if(saved.user&&(!auth||auth.testAccess||auth.user.id!==saved.user||!s.repo.memberRole(p.workspaceId,saved.user)))throw forbidden()
  const callback=new URL('/api/company/callback',s.config.publicUrl);callback.search=new URL(c.req.url).search
  const tokens=await oidc.authorizationCodeGrant(await config(p),callback,{pkceCodeVerifier:saved.verifier,expectedState:state,expectedNonce:saved.nonce,idTokenExpected:true}).catch(()=>{throw badRequest('company_signin','The company sign-in could not be verified. Start again.')})
  if(saved.user&&(!auth||!s.sessions.isValid(auth.session.id)||!s.repo.memberRole(p.workspaceId,saved.user)))throw forbidden()
  const claims=tokens.claims()!;const subject=claims.sub
  const bound=s.db.get<{user_id:string}>('SELECT user_id FROM company_identities WHERE provider=? AND subject=?',p.id,subject)
  if(saved.intent==='calendar'){
   const key=s.repo.keys.forWorkspace(p.workspaceId)!.aead,user=saved.user!
   const value={accessToken:tokens.access_token,expires:Date.now()+(tokens.expires_in??300)*1000}
   s.db.run('INSERT INTO calendar_grants(workspace_id,user_id,provider,sealed) VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET sealed=excluded.sealed',p.workspaceId,user,p.id,sealText(key,JSON.stringify(value),`calendar\n${p.workspaceId}\n${user}\n${p.id}`))
  }else if(saved.intent==='link'){
   if(bound&&bound.user_id!==saved.user)throw conflict('identity_linked','This company identity belongs to another One account.')
   const other=s.db.get<{subject:string}>('SELECT subject FROM company_identities WHERE provider=? AND user_id=?',p.id,saved.user!)
   if(other&&other.subject!==subject)throw conflict('identity_linked','This account already has a different company identity.')
   s.db.run('INSERT INTO company_identities(provider,subject,user_id) VALUES(?,?,?) ON CONFLICT(provider,subject) DO NOTHING',p.id,subject,saved.user!)
  }else{
   if(!bound||!s.repo.memberRole(p.workspaceId,bound.user_id))throw forbidden('identity_unlinked','Sign in by email once and link your company account in Team hub.')
   if(s.db.get<{active:number}>('SELECT active FROM scim_users WHERE workspace_id=? AND user_id=?',p.workspaceId,bound.user_id)?.active===0)throw forbidden()
   const session=s.sessions.create(bound.user_id,c.req.header('user-agent')??null);s.sessions.setCookie(c,session.token)
  }
  return c.redirect(s.config.publicUrl+'/app/?w='+encodeURIComponent(p.workspaceId)+'#/workspace')
 })
 app.delete('/workspaces/:id/company/:provider/calendar',c=>{const {workspace,auth}=access(s,c,'viewer');if(auth.testAccess)throw forbidden();s.db.run('DELETE FROM calendar_grants WHERE workspace_id=? AND user_id=? AND provider=?',workspace.id,auth.user.id,c.req.param('provider'));return c.json({disconnected:true})})
 app.get('/workspaces/:id/company/:provider/calendar',async c=>{
  const {workspace,auth}=access(s,c,'viewer');if(auth.testAccess)throw forbidden()
  const p=providers.find(p=>p.id===c.req.param('provider')&&p.workspaceId===workspace.id&&p.calendar);if(!p)throw notFound()
  const grant=s.db.get<{sealed:string}>('SELECT sealed FROM calendar_grants WHERE workspace_id=? AND user_id=? AND provider=?',workspace.id,auth.user.id,p.id);if(!grant)throw notFound('calendar_connect','Connect your calendar first.')
  const value=JSON.parse(openText(s.repo.keys.forWorkspace(workspace.id)!.aead,grant.sealed,`calendar\n${workspace.id}\n${auth.user.id}\n${p.id}`)) as {accessToken:string;expires:number}
  if(value.expires<=Date.now()+30000)throw conflict('calendar_expired','Reconnect your calendar to renew consent.')
  const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+30*86400000).toISOString()
  const url=p.calendar==='google'?new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events'):new URL('https://graph.microsoft.com/v1.0/me/calendarView')
  for(const [k,v] of Object.entries(p.calendar==='google'?{timeMin:from,timeMax:to,singleEvents:'true',orderBy:'startTime',maxResults:'250',fields:'items(id,summary,start,end,status,htmlLink,hangoutLink),nextPageToken'}:{startDateTime:from,endDateTime:to,$top:'250',$orderby:'start/dateTime',$select:'id,subject,start,end,isAllDay,isCancelled,webLink,onlineMeeting'}))url.searchParams.set(k,v)
  const res=await fetch(url,{headers:{Authorization:'Bearer '+value.accessToken,Prefer:'outlook.timezone="UTC"'},signal:AbortSignal.timeout(15000),redirect:'error'})
  if(!res.ok)throw badRequest('calendar_provider','Calendar provider refused the request. Reconnect or check permissions.')
  const data=await res.json() as Record<string,any>;access(s,c,'viewer')
  const safe=(v:unknown)=>typeof v==='string'&&v.startsWith('https://')?v:null
  const utc=(v:unknown)=>typeof v==='string'?v+(/(?:Z|[+-]\d\d:\d\d)$/.test(v)?'':'Z'):''
  const events=(p.calendar==='google'?data.items??[]:data.value??[]).slice(0,250).filter((e:any)=>e.status!=='cancelled'&&!e.isCancelled).map((e:any)=>({id:e.id,title:p.calendar==='google'?e.summary:e.subject,start:p.calendar==='google'?e.start?.dateTime??e.start?.date:utc(e.start?.dateTime),end:p.calendar==='google'?e.end?.dateTime??e.end?.date:utc(e.end?.dateTime),allDay:p.calendar==='google'?!!e.start?.date:e.isAllDay,url:safe(p.calendar==='google'?e.htmlLink:e.webLink),meeting:safe(p.calendar==='google'?e.hangoutLink:e.onlineMeeting?.joinUrl)}))
  return c.json({events,from,to,truncated:!!(data.nextPageToken||data['@odata.nextLink']),readAt:Date.now()})
 })
 return app
}
