import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { atlasLinkToken, parseWelcomePaste } from '../../src/shared/welcome.ts'

test('URL credentials are extracted separately, without treating them as MCP credentials or accepting ambiguous links',()=>{
  assert.equal(atlasLinkToken('https://atlas.example/invite?token=SYNTHETIC%2BACCESS'),'SYNTHETIC+ACCESS')
  assert.equal(atlasLinkToken('https://atlas.example/#/join?invite_token=SYNTHETIC-ACCESS'),'SYNTHETIC-ACCESS')
  assert.equal(atlasLinkToken('https://atlas.example/#access_token=SYNTHETIC-ACCESS'),'SYNTHETIC-ACCESS')
  for(const url of ['https://atlas.example/?token=','https://atlas.example/?token=one&token=two','https://atlas.example/?token=one#token=two','http://atlas.example/?token=one','https://user:pass@atlas.example/?token=one','https://atlas.example/?token=has%20space','not-a-url'])assert.equal(atlasLinkToken(url),null)
})
import { Client, mailbox, signIn, smtpSink, startServer, type TestServer } from './helpers.ts'

test('local paste matches full identities, transliterations and labelled tokens; ambiguity never partially imports',()=>{
  const people=[{id:'a',name:'Mara Schön',email:'mara.schoen@example.test'},{id:'b',name:'Aylin Güney',email:'aylin.gueney@example.test'},{id:'c',name:'Jan Sommer',email:'jan.sommer@example.test'},{id:'d',name:'Jan Winter',email:'jan.winter@example.test'}]
  const good=parseWelcomePaste('Mara Schoen\nLink: https://atlas.example/invite?token=INVITE-ONLY\nToken: MCP-MAX\n\naylin.gueney@example.test | Link: https://atlas.example/naz | Token: MCP-NAZ',people)
  assert.deepEqual(good.issues,[]);assert.deepEqual(good.updates,[{id:'a',atlasLink:'https://atlas.example/invite?token=INVITE-ONLY',atlasToken:'MCP-MAX'},{id:'b',atlasLink:'https://atlas.example/naz',atlasToken:'MCP-NAZ'}])
  assert.equal(parseWelcomePaste('Mara Schön\nhttps://atlas.example/?token=NOT-MCP',people).updates[0]?.atlasToken,undefined)
  for(const bad of ['Jan\nLink: https://atlas.example/x','Mara Schön\nLink: https://atlas.example/one\nLink: https://atlas.example/two','Jan Sommer + Jan Winter\nToken: private','Unknown Person\nLink: https://atlas.example/x']){
    const r=parseWelcomePaste(bad,people);assert.ok(r.issues.length);assert.deepEqual(r.updates,[]);assert.ok(!JSON.stringify(r).includes('private'))
  }
})

test('paste extracts explicit MCP/agent credentials and Bearer headers, including a value below its label',()=>{
  const people=[{id:'a',name:'Mara Schön',email:'mara.schoen@example.test'},{id:'b',name:'Jan Sommer',email:'jan.sommer@example.test'}]
  for(const label of ['MCP-Token','mcp_token','Agent-Token','Agenten-Token','Atlas Token','API-Key','**MCP-Token:**']){
    const field=label.endsWith('**')?`${label} \`MCP-SYNTHETIC\``:`${label}: MCP-SYNTHETIC`
    const result=parseWelcomePaste(`Mara Schön\nLink: https://atlas.example/invite?token=INVITE-ONLY\n${field}`,people)
    assert.deepEqual(result,{updates:[{id:'a',atlasLink:'https://atlas.example/invite?token=INVITE-ONLY',atlasToken:'MCP-SYNTHETIC'}],issues:[]})
  }
  assert.deepEqual(parseWelcomePaste('Mara Schön | MCP-Token: MCP-FIRST | Link: https://atlas.example/invite?token=ONLY-INVITE',people),{updates:[{id:'a',atlasLink:'https://atlas.example/invite?token=ONLY-INVITE',atlasToken:'MCP-FIRST'}],issues:[]})
  const multiline=parseWelcomePaste('Mara Schön\nMCP-Token:\n"MCP-FIRST"\nJan Sommer | Link: https://atlas.example/invite?token=INVITE-SECOND | Authorization: Bearer MCP-SECOND',people)
  assert.deepEqual(multiline,{updates:[{id:'a',atlasToken:'MCP-FIRST'},{id:'b',atlasLink:'https://atlas.example/invite?token=INVITE-SECOND',atlasToken:'MCP-SECOND'}],issues:[]})
  assert.equal(parseWelcomePaste('Mara Schön\nAuthorization:\nBearer MCP-NEXT-LINE',people).updates[0]?.atlasToken,'MCP-NEXT-LINE')
  assert.equal(parseWelcomePaste('Mara Schön\nToken: Bearer MCP-STRIPPED',people).updates[0]?.atlasToken,'MCP-STRIPPED')
  for(const input of [
    'Mara Schön\nToken: MCP-ONE | MCP-Token: MCP-TWO',
    'Mara Schön\nMCP-Token:\nJan Sommer\nToken: MCP-TWO',
    'Mara Schön\nMCP-Token:\nhttps://atlas.example/invite?token=INVITE-ONLY',
    'Mara Schön\nAuthorization: Basic NOT-A-BEARER-TOKEN',
    'Mara Schön\nAuthorization:\nNOT-A-BEARER-TOKEN',
    'Mara Schön\nMCP-Token:',
    'Mara Schön\nToken: MCP-ONE\nAgent-Token: MCP-TWO',
    'Mara Schön\nMCP-Token: '+ 'A'.repeat(4097),
  ]){
    const r=parseWelcomePaste(input,people);assert.ok(r.issues.length);assert.deepEqual(r.updates,[])
    assert.ok(r.issues.every(x=>/^\d+$/.test(x)),'Errors contain only line numbers, never pasted secrets')
  }
  const urlOnly=parseWelcomePaste('Mara Schön\nhttps://atlas.example/invite?token=INVITE-ONLY&mcp_token=UNVERIFIED',people)
  assert.equal(urlOnly.updates[0]?.atlasToken,undefined)
})

let server:TestServer,owner:Client,other:Client,alice:Client,bob:Client,ws:string
before(async()=>{
  server=await startServer({AUTH_IP_LIMIT:'1000'});owner=await signIn(server,'organizer@welcome.test');other=await signIn(server,'other@welcome.test');alice=await signIn(server,'alice@welcome.test');bob=await signIn(server,'bob@welcome.test')
  ws=(await owner.post('/api/workspaces',{name:'Workshop team'})).body.id
})
after(async()=>{await server?.stop()})
const path=()=>`/api/workspaces/${ws}/welcome`
const put=(c:Client,v:unknown)=>c.json('PUT',path(),v)
const draft=()=>({revision:0,title:'Synthetic workshop',notBefore:Date.now()+DAY,lang:'en',recipients:[
  {id:'alice',name:'Alice',email:'alice@welcome.test',workspaceId:ws,role:'member',guest:false,note:'Team',atlasLink:'https://atlas.example/invite?token=ALICE-INVITE',atlasToken:'ALICE-MCP-SECRET'},
  {id:'bob',name:'Bob',email:'bob@welcome.test',workspaceId:ws,role:'viewer',guest:true,note:'Guest only',atlasLink:'https://atlas.example/invite?token=BOB-INVITE',atlasToken:'BOB-MCP-SECRET'}
]})
const DAY=86400000
test('preparation is private, encrypted and side-effect free; time/revision/guest gates are server enforced',async()=>{
  const before=(await mailbox(server)).length
  let r=await put(owner,draft());assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.revision,1)
  assert.ok(r.body.recipients.every((x:any)=>x.hasAtlasLink&&x.hasAtlasToken));assert.ok(!JSON.stringify(r.body).includes('SECRET'));assert.ok(!JSON.stringify(r.body).includes('INVITE'))
  assert.ok(r.body.recipients.every((x:any)=>x.hasAtlasLinkToken===true))
  assert.equal((await mailbox(server)).length,before);assert.equal((await owner.get(`/api/workspaces/${ws}/invites`)).body.length,0)
  assert.equal((await alice.get(path())).status,404)
  const adminInvite=(await owner.post(`/api/workspaces/${ws}/invites`,{email:'other@welcome.test',role:'admin'})).body.link
  await other.post('/api/invites/'+adminInvite.split('#/invite/')[1]+'/accept')
  assert.equal((await other.get(path())).body,null,'Another admin has no access to the organizer’s private draft')
  const alien=(await other.post('/api/workspaces',{name:'Another team'})).body.id
  assert.equal((await put(owner,{...draft(),revision:1,recipients:[{...draft().recipients[0],workspaceId:alien}]})).status,403)
  assert.equal((await put(owner,{...draft(),revision:1,recipients:[{...draft().recipients[1],role:'member'}]})).status,400)
  assert.equal((await put(owner,draft())).status,409)
  assert.equal((await owner.post(path()+'/send',{revision:1})).status,409)
  const preview=(await owner.get(path()+'/preview/alice')).body
  assert.ok(preview.text.includes('My secrets'));assert.ok(preview.text.includes('Start step by step'));assert.ok(preview.text.includes('MCP servers'));assert.ok(!preview.text.includes('#/workspace/people'));assert.ok(!JSON.stringify(preview).includes('ALICE-'))
  const db=new DatabaseSync(join(server.dataDir,'one.sqlite'));try{const row=db.prepare('SELECT sealed FROM welcome_drafts').get() as {sealed:string};assert.ok(row.sealed.startsWith('v1.'));assert.ok(!row.sealed.includes('ALICE'));assert.ok(!row.sealed.includes('welcome.test'))}finally{db.close()}
  r=await put(owner,{...draft(),revision:1,notBefore:0});assert.equal(r.status,200);assert.equal(r.body.revision,2)
})
test('an SMTP failure remains uncertain and a second Send cannot resend that recipient',async()=>{
  const sink=await smtpSink({reject:email=>email==='bounce@welcome.test'}),srv=await startServer({SMTP_URL:`smtp://127.0.0.1:${sink.port}`})
  try{
    const c=await signIn(srv,'owner@failure.test'),w=(await c.post('/api/workspaces',{name:'Delivery test'})).body.id,p=`/api/workspaces/${w}/welcome`
    const input={...draft(),notBefore:0,recipients:[{...draft().recipients[0],email:'bounce@welcome.test',workspaceId:w}]}
    assert.equal((await c.json('PUT',p,input)).status,200)
    const r=await c.post(p+'/send',{revision:1});assert.equal(r.status,200);assert.equal(r.body.recipients[0].status,'uncertain')
    const count=(await c.get(`/api/workspaces/${w}/invites`)).body.length
    assert.equal((await c.post(p+'/send',{revision:r.body.revision})).status,409)
    assert.equal((await c.get(`/api/workspaces/${w}/invites`)).body.length,count)
  }finally{await srv.stop();await sink.close()}
})
test('one explicit send grants read-only guest access to the shared workspace, hides MCP tokens from mail, prevents replay and binds reveal/dismissal to the recipient',async()=>{
  const before=(await mailbox(server)).length,r=await owner.post(path()+'/send',{revision:2})
  assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.recipients.every((p:any)=>p.status==='sent'))
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));assert.equal((await mailbox(server)).length,before+2)
  const aMail=(await mailbox(server,'alice@welcome.test'))[0]!,bMail=(await mailbox(server,'bob@welcome.test'))[0]!
  assert.ok(aMail.text.includes('ALICE-INVITE'));assert.ok(!aMail.text.includes('ALICE-MCP'));assert.ok(!aMail.text.includes('BOB-'));assert.ok(bMail.text.includes('BOB-INVITE'))
  assert.equal((await owner.post(path()+'/send',{revision:r.body.revision})).status,409);assert.equal((await mailbox(server)).length,before+2)
  assert.equal((await alice.post('/api/invites/'+aMail.text.match(/\/app\/#\/invite\/([A-Za-z0-9_-]+)/)![1]+'/accept')).status,200)
  assert.equal((await bob.post('/api/invites/'+bMail.text.match(/\/app\/#\/invite\/([A-Za-z0-9_-]+)/)![1]+'/accept')).status,200)
  const members=(await owner.get(`/api/workspaces/${ws}/members`)).body
  assert.ok(members.some((m:any)=>m.user.email==='alice@welcome.test'&&m.role==='member'));assert.ok(members.some((m:any)=>m.user.email==='bob@welcome.test'&&m.role==='viewer'&&m.guest===true))
  assert.ok(aMail.text.includes('ONE team workspace'));assert.ok(bMail.text.includes('read-only access to the shared workshop workspace'))
  assert.equal((await bob.patch(`/api/workspaces/${ws}`,{name:'Guest write'})).status,403)
  assert.equal((await bob.post(`/api/workspaces/${ws}/invites`,{role:'member'})).status,403)
  const own=(await alice.get(path()+'-access')).body;assert.equal(own.length,1)
  assert.ok(!JSON.stringify(own).includes('SECRET'))
  assert.equal((await owner.post(path()+`-access/${own[0].id}/open`)).status,404)
  assert.equal((await bob.post(`/api/workspaces/${ws}/welcome-access/${own[0].id}/open`)).status,404)
  const revealed=await alice.post(path()+`-access/${own[0].id}/open`);assert.equal(revealed.body.atlasToken,'ALICE-MCP-SECRET');assert.equal(revealed.res.headers.get('cache-control'),'no-store')
  assert.equal((await alice.post(path()+`-access/${own[0].id}/complete`)).status,204);assert.deepEqual((await alice.get(path()+'-access')).body,[])
  assert.equal((await alice.get(path()+'-access?setup=1')).body[0].id,own[0].id)
  assert.equal((await owner.get(path()+'-access?setup=1')).body.length,0)
  assert.equal((await bob.get(`/api/workspaces/${ws}/welcome-access?setup=1`)).body.length,1)
  assert.equal((await bob.get(`/api/workspaces/${ws}/welcome-access`)).body.length,1)
  const db=new DatabaseSync(join(server.dataDir,'one.sqlite'));try{const rows=db.prepare('SELECT sealed FROM welcome_access').all();assert.ok(rows.every(x=>String(x.sealed).startsWith('v1.')&&!String(x.sealed).includes('SECRET')))}finally{db.close()}
})


test('welcome send refuses an existing editing membership for a guest before any mail is sent',async()=>{
  const w=(await owner.post('/api/workspaces',{name:'Existing guest membership'})).body.id
  const invite=(await owner.post(`/api/workspaces/${w}/invites`,{role:'member'})).body.link
  await bob.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')
  const p=`/api/workspaces/${w}/welcome`
  const input={...draft(),notBefore:0,recipients:[{...draft().recipients[1],workspaceId:w}]}
  assert.equal((await owner.json('PUT',p,input)).status,200)
  const before=(await mailbox(server)).length
  assert.equal((await owner.post(p+'/send',{revision:1})).status,409)
  assert.equal((await mailbox(server)).length,before)
  assert.equal((await owner.get(p)).body.recipients[0].status,'draft')
  assert.equal((await bob.get('/api/me')).body.workspaces.find((v:any)=>v.id===w).role,'member')
})


import {welcomeMail} from '../src/mail/templates.ts'
test('cloud Atlas welcome uses current-workspace/token-only steps in both languages, with no workshop setup instructions',()=>{
 for(const lang of ['de','en'] as const){
  const mail=welcomeMail(lang,{name:'Synthetic Member',title:'CNSx',workspace:'CNSx test',link:'https://one.example/app/#/invite/synthetic',atlasLink:'https://aj-atlas.com/',startLink:'https://one.example/app/?w=test#/p/start',guest:false,note:'Prepared BA work list',cloudAtlas:true})
  assert.doesNotMatch(mail.text,/Frankfurt/);assert.match(mail.html,/ONE · ATLAS/);assert.match(mail.text,/token/i)
  assert.ok(!mail.text.includes('MCP-Server'));assert.ok(!mail.text.includes('Start step by step'));assert.ok(!mail.text.includes('je einem echten Atlas-Leseversuch'))
  assert.ok(mail.text.includes('#/p/start'));assert.ok(!mail.text.includes('SYNTHETIC-SECRET'))
 }
})

test('resend is one explicit recipient handoff, revision-bound, private and recorded without replay',async()=>{
  const w=(await owner.post('/api/workspaces',{name:'Explicit resend'})).body.id,p=`/api/workspaces/${w}/welcome`
  const input={...draft(),notBefore:0,recipients:draft().recipients.map(r=>({...r,workspaceId:w}))}
  await owner.json('PUT',p,input)
  const original=await owner.post(p+'/send',{revision:1});assert.equal(original.status,200)
  const revision=original.body.revision,before=(await mailbox(server)).length
  assert.equal((await owner.get(p+'/preview/alice')).status,200);assert.equal((await mailbox(server)).length,before)
  assert.equal((await owner.post(p+'/resend/alice',{revision})).status,400)
  assert.equal((await owner.post(p+'/resend/alice',{revision,confirm:false})).status,400)
  assert.equal((await other.post(p+'/resend/alice',{revision,confirm:true})).status,404)
  assert.equal((await owner.post(p+'/resend/absent',{revision,confirm:true})).status,404)
  const pair=await Promise.all([owner.post(p+'/resend/alice',{revision,confirm:true}),owner.post(p+'/resend/alice',{revision,confirm:true})])
  assert.equal(pair.filter(r=>r.status===200).length,1);assert.equal(pair.filter(r=>r.status===409).length,1)
  const saved=pair.find(r=>r.status===200)!.body
  assert.equal((await mailbox(server)).length,before+1)
  const a=saved.recipients.find((r:any)=>r.id==='alice'),b=saved.recipients.find((r:any)=>r.id==='bob')
  assert.equal(a.deliveryAttempts.length,2);assert.equal(a.deliveryAttempts[1].resend,true);assert.equal(a.deliveryAttempts[1].status,'sent');assert.ok(a.deliveryAttempts[1].finishedAt)
  assert.deepEqual(b,original.body.recipients.find((r:any)=>r.id==='bob'))
  assert.ok(!JSON.stringify(saved).includes('ALICE-MCP'));assert.ok(!JSON.stringify(saved).includes('ALICE-INVITE'))
  assert.equal((await owner.post(p+'/resend/alice',{revision,confirm:true})).status,409)
  assert.equal((await owner.post(p+'/send',{revision:saved.revision})).status,409)
  assert.equal((await mailbox(server)).length,before+1)
  const update=await owner.json('PUT',p,{...input,title:'Updated title',revision:saved.revision})
  assert.equal(update.status,200);assert.deepEqual(update.body.recipients.find((r:any)=>r.id==='alice').deliveryAttempts,a.deliveryAttempts)
})

test('an uncertain handoff can be explicitly resent; normal batch sending never retries it',async()=>{
  let reject=true
  const sink=await smtpSink({reject:email=>email==='retry@welcome.test'&&reject}),srv=await startServer({SMTP_URL:`smtp://127.0.0.1:${sink.port}`})
  try{
    const c=await signIn(srv,'resend-owner@failure.test'),w=(await c.post('/api/workspaces',{name:'Retry one recipient'})).body.id,p=`/api/workspaces/${w}/welcome`
    const input={...draft(),notBefore:0,recipients:[{...draft().recipients[0],email:'retry@welcome.test',workspaceId:w}]}
    await c.json('PUT',p,input)
    assert.equal((await c.post(p+'/resend/alice',{revision:1,confirm:true})).status,409,'a draft uses the ordinary first-send path')
    let r=await c.post(p+'/send',{revision:1});assert.equal(r.body.recipients[0].status,'uncertain')
    assert.equal((await c.post(p+'/send',{revision:r.body.revision})).status,409)
    reject=false
    r=await c.post(p+'/resend/alice',{revision:r.body.revision,confirm:true});assert.equal(r.status,200);assert.equal(r.body.recipients[0].status,'sent')
    assert.deepEqual(r.body.recipients[0].deliveryAttempts.map((a:any)=>[a.status,a.resend]),[['uncertain',false],['sent',true]])
  }finally{await srv.stop();await sink.close()}
})

test('the emailed welcome link signs in only its recipient without a second email; scanners and replay cannot consume it',async()=>{
  const w=(await owner.post('/api/workspaces',{name:'Direct welcome sign-in'})).body.id,p=`/api/workspaces/${w}/welcome`,email='new-person@welcome.test'
  const input={...draft(),notBefore:0,recipients:[{...draft().recipients[0],email,workspaceId:w}]}
  await owner.json('PUT',p,input)
  const before=(await mailbox(server,email)).length,preview=await owner.get(p+'/preview/alice')
  assert.ok(!JSON.stringify(preview.body).includes('/api/auth/verify?token='));assert.ok(preview.body.text.includes('15 minutes'))
  assert.equal((await mailbox(server,email)).length,before)
  const sent=await owner.post(p+'/send',{revision:1});assert.equal(sent.status,200)
  const mail=(await mailbox(server,email))[0]!,url=new URL(mail.link),token=url.searchParams.get('token')!
  assert.equal(url.pathname,'/api/auth/verify');assert.ok(token)
  assert.ok(!JSON.stringify(sent.body).includes(token));assert.ok(mail.text.includes('No second verification email'))
  const device=new Client(server.url),scanner=new Client(server.url)
  assert.equal((await scanner.fetch(url.pathname+url.search)).status,200)
  assert.equal((await device.fetch(url.pathname+url.search)).status,200)
  assert.equal((await device.get('/api/me')).status,401)
  const confirm=await device.fetch('/api/auth/verify',{method:'POST',json:{token}})
  assert.equal(confirm.status,303)
  const location=confirm.headers.get('location')!;assert.match(location,/^\/app\/#\/invite\//)
  assert.equal((await device.get('/api/me')).body.user.email,email)
  assert.equal((await mailbox(server,email)).length,before+1,'no second email challenge')
  const invite=location.split('#/invite/')[1]
  assert.equal((await owner.post('/api/invites/'+invite+'/accept')).status,403,'wrong identity cannot accept')
  assert.equal((await device.post('/api/invites/'+invite+'/accept')).body.role,'member')
  assert.equal((await device.get('/api/me')).body.workspaces.find((x:any)=>x.id===w).role,'member')
  assert.equal((await new Client(server.url).fetch('/api/auth/verify',{method:'POST',json:{token}})).status,400)
  const db=new DatabaseSync(join(server.dataDir,'one.sqlite'));try{const row=db.prepare('SELECT created_at,expires_at,redirect FROM login_tokens WHERE email=?').get(email) as any;assert.equal(row.expires_at-row.created_at,15*60000);assert.ok(row.redirect.startsWith('v1.'));assert.ok(!row.redirect.includes(invite))}finally{db.close()}
})

test('an address-bound invitation can be prepared for copying without mailing or signing anyone in',async()=>{
 const w=(await owner.post('/api/workspaces',{name:'Copy only invite'})).body.id,email='copy-person@welcome.test',before=(await mailbox(server,email)).length
 const r=await owner.post(`/api/workspaces/${w}/invites`,{email,role:'member',guest:false,max_uses:1,send_email:false})
 assert.equal(r.status,201);assert.equal(r.body.email_sent,undefined);assert.match(r.body.link,/\/app\/#\/invite\//)
 assert.equal((await mailbox(server,email)).length,before)
 const token=r.body.link.split('#/invite/')[1],visitor=new Client(server.url)
 assert.equal((await visitor.get('/api/invites/'+token)).body.email,email)
 assert.equal((await visitor.get('/api/me')).status,401)
 assert.equal((await visitor.post('/api/invites/'+token+'/accept')).status,401)
 assert.equal((await owner.post('/api/invites/'+token+'/accept')).status,403)
})


test('owner activation replaces unavailable mail for a new prepared identity, once, without touching existing accounts',async()=>{
 const w=(await owner.post('/api/workspaces',{name:'Owner-approved first access'})).body.id,p=`/api/workspaces/${w}/welcome`,email='owner-approved-new@welcome.test'
 await owner.json('PUT',p,{...draft(),notBefore:0,recipients:[{...draft().recipients[0],email,name:'New Person',workspaceId:w}]})
 const before=(await mailbox(server)).length
 assert.equal((await owner.post(p+'/activate/alice',{revision:1})).status,400)
 assert.equal((await other.post(p+'/activate/alice',{revision:1,confirm:true})).status,404)
 const issued=await owner.post(p+'/activate/alice',{revision:1,confirm:true});assert.equal(issued.status,201,JSON.stringify(issued.body))
 const url=new URL(issued.body.link),token=url.searchParams.get('token')!,device=new Client(server.url)
 assert.equal(issued.body.email,email);assert.ok(issued.body.expiresAt>Date.now()+23*60*60000)
 assert.equal((await mailbox(server)).length,before,'owner distributes the link; no email is sent')
 assert.equal((await device.fetch(url.pathname+url.search)).status,200)
 assert.equal((await new Client(server.url).fetch(url.pathname+url.search)).status,200,'scanner GET does not activate')
 assert.equal((await device.get('/api/me')).status,401)
 const pair=await Promise.all([device.fetch('/api/auth/verify',{method:'POST',json:{token}}),new Client(server.url).fetch('/api/auth/verify',{method:'POST',json:{token}})])
 assert.deepEqual(pair.map(r=>r.status).sort(),[303,400])
 assert.equal(pair[0].headers.get('location'),`/app/?w=${w}`)
 const me=(await device.get('/api/me')).body
 assert.equal(me.user.email,email);assert.equal(me.user.name,'New Person');assert.deepEqual(me.workspaces.map((x:any)=>[x.id,x.role]),[[w,'member']])
 assert.equal((await device.get(`/api/workspaces/${ws}/members`)).status,404)
 assert.ok((await device.get(`/api/workspaces/${w}/welcome-access`)).body.length)
 assert.equal((await owner.post(p+'/activate/alice',{revision:1,confirm:true})).status,409,'cannot issue identity recovery for existing accounts')
 assert.equal((await mailbox(server)).length,before)
})

test('owner activation expires, is replaced explicitly and fails closed if approval metadata or ownership disappears',async()=>{
 const w=(await owner.post('/api/workspaces',{name:'Activation validity'})).body.id,p=`/api/workspaces/${w}/welcome`,email='activation-replaced@welcome.test'
 await owner.json('PUT',p,{...draft(),notBefore:0,recipients:[{...draft().recipients[0],email,workspaceId:w}]})
 const issue=async()=>{const r=await owner.post(p+'/activate/alice',{revision:1,confirm:true});assert.equal(r.status,201);return new URL(r.body.link).searchParams.get('token')!}
 const first=await issue(),second=await issue(),device=new Client(server.url)
 assert.equal((await device.fetch('/api/auth/verify',{method:'POST',json:{token:first}})).status,400)
 const db=new DatabaseSync(join(server.dataDir,'one.sqlite'))
 try{
  const row=db.prepare('SELECT token_hash,expires_at,created_at,owner_activation FROM login_tokens WHERE email=? AND used_at IS NULL').get(email) as any
  assert.equal(row.expires_at-row.created_at,DAY);assert.equal(row.owner_activation,1);assert.ok(!JSON.stringify(row).includes(second))
  db.prepare('UPDATE login_tokens SET expires_at=? WHERE token_hash=?').run(Date.now()-1,row.token_hash)
  assert.equal((await device.fetch('/api/auth/verify',{method:'POST',json:{token:second}})).status,400)
  const third=await issue()
  db.prepare('DELETE FROM owner_activations WHERE workspace_id=?').run(w)
  assert.equal((await device.fetch('/api/auth/verify?token='+third)).status,400)
  assert.equal((await device.fetch('/api/auth/verify',{method:'POST',json:{token:third}})).status,400,'missing metadata cannot turn into ordinary authentication')
  const fourth=await issue()
  db.prepare("UPDATE members SET role='admin' WHERE workspace_id=? AND user_id=(SELECT id FROM users WHERE email=?)").run(w,'organizer@welcome.test')
  assert.equal((await device.fetch('/api/auth/verify?token='+fourth)).status,400)
  assert.equal((await device.fetch('/api/auth/verify',{method:'POST',json:{token:fourth}})).status,403)
  assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(email),undefined)
 }finally{db.close()}
})

test('workspace owners cannot provision reserved server administrator identities or take over an account created after issuance',async()=>{
 const srv=await startServer({AUTH_IP_LIMIT:'1000',ADMIN_EMAILS:'reserved-root@welcome.test'})
 try{
  const own=await signIn(srv,'activation-security-owner@welcome.test'),w=(await own.post('/api/workspaces',{name:'Owner scope'})).body.id,p=`/api/workspaces/${w}/welcome`
  const prep=(email:string,revision=0)=>own.json('PUT',p,{...draft(),revision,notBefore:0,recipients:[{...draft().recipients[0],email,workspaceId:w}]})
  await prep('reserved-root@welcome.test')
  assert.equal((await own.post(p+'/activate/alice',{revision:1,confirm:true})).status,403)
  const email='signed-in-before-activation@welcome.test';await prep(email,1)
  const issued=await own.post(p+'/activate/alice',{revision:2,confirm:true});assert.equal(issued.status,201)
  const token=new URL(issued.body.link).searchParams.get('token')!
  const verified=await signIn(srv,email),before=(await verified.get('/api/me')).body
  assert.equal((await new Client(srv.url).fetch('/api/auth/verify',{method:'POST',json:{token}})).status,403)
  assert.deepEqual((await verified.get('/api/me')).body,before,'existing user and personal workspace remain untouched')
 }finally{await srv.stop()}
})
