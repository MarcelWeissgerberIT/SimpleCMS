import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Client, mailbox, signIn, startServer, type TestServer } from './helpers.ts'
let server:TestServer, owner:Client, ws:string
before(async()=>{server=await startServer({AUTH_IP_LIMIT:'1000',ADMIN_EMAILS:'owner@direct.test'});owner=await signIn(server,'owner@direct.test');ws=(await owner.post('/api/workspaces',{name:'Direct invitation tests'})).body.id})
after(async()=>{await server.stop()})
async function link(extra:Record<string,unknown>={}) {const r=await owner.post(`/api/workspaces/${ws}/invites`,{role:'member',direct:true,...extra});assert.equal(r.status,201,JSON.stringify(r.body));return {id:r.body.id,token:r.body.link.split('#/invite/')[1],body:r.body}}
async function enter(token:string,email='new@direct.test') {const client=new Client(server.url);const r=await client.post(`/api/invites/${token}/join`,{email,name:'New participant'});return {client,r}}
test('direct join creates a separate unverified session, sends no mail and consumes exactly once',async()=>{
 const l=await link();assert.equal(l.body.direct,true);assert.ok(Date.parse(l.body.expires_at)-Date.now()<=86400000)
 const {client,r}=await enter(l.token);assert.equal(r.status,201,JSON.stringify(r.body))
 const me=(await client.get('/api/me')).body;assert.equal(me.user.email,'new@direct.test');assert.equal(me.user.email_verified,false);assert.equal(me.workspaces.length,1);assert.equal(me.workspaces[0].id,ws)
 assert.equal((await mailbox(server,'new@direct.test')).length,0)
 assert.equal((await enter(l.token)).r.status,404)
 assert.equal((await client.post('/api/workspaces',{name:'No administrator yet'})).status,403)
 assert.equal((await owner.patch(`/api/workspaces/${ws}/members/${me.user.id}`,{role:'admin'})).status,403)
 assert.equal((await client.post(`/api/workspaces/${ws}/coding/workers`,{})).status,403)
})
test('claimed email never logs into an existing account or grants server administration',async()=>{
 const old=(await owner.get('/api/me')).body.user
 const {client,r}=await enter((await link()).token,'owner@direct.test');assert.equal(r.status,201)
 const me=(await client.get('/api/me')).body;assert.notEqual(me.user.id,old.id);assert.equal(me.server_admin,undefined);assert.equal(me.workspaces[0].role,'member')
 assert.equal((await client.post('/api/me/verify-email',{})).status,409)
 assert.equal((await owner.get('/api/me')).body.user.id,old.id)
})
test('direct links cannot bind addresses/domains or grant admin access; old links require login',async()=>{
 for(const extra of [{role:'admin'},{email:'a@direct.test'},{domains:['direct.test']}])assert.equal((await owner.post(`/api/workspaces/${ws}/invites`,{direct:true,...extra})).status,400)
 const old=await owner.post(`/api/workspaces/${ws}/invites`,{role:'member'})
 assert.equal((await enter(old.body.link.split('#/invite/')[1])).r.status,403)
 const {client}=await enter((await link()).token)
 const restricted=await owner.post(`/api/workspaces/${ws}/invites`,{role:'member',domains:['direct.test']})
 assert.equal((await client.post(`/api/invites/${restricted.body.link.split('#/invite/')[1]}/accept`,{})).status,403)
})
test('revoked and expired links do not create accounts; concurrent last-place joins have one winner',async()=>{
 const revoked=await link();await owner.json('DELETE',`/api/workspaces/${ws}/invites/${revoked.id}`);assert.equal((await enter(revoked.token)).r.status,404)
 const expired=await link();const db=new DatabaseSync(join(server.dataDir,'one.sqlite'));db.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(Date.now()-1000,expired.id);db.close();assert.equal((await enter(expired.token)).r.status,404)
 const last=await link();const attempts=await Promise.all([enter(last.token),enter(last.token)]);assert.deepEqual(attempts.map(x=>x.r.status).sort(),[201,404])
})
test('later email proof preserves membership, revokes previous sessions and cannot be replayed',async()=>{
 const email='verify@direct.test';const {client}=await enter((await link()).token,email)
 const original=(await client.get('/api/me')).body.user.id
 assert.equal((await client.post('/api/me/verify-email',{lang:'en'})).status,204)
 const mail=(await mailbox(server,email))[0]!;assert.ok(mail)
 const token=new URL(mail.link).searchParams.get('token')!
 const verified=new Client(server.url)
 assert.equal((await verified.post('/api/auth/verify',{token})).status,303)
 const me=(await verified.get('/api/me')).body;assert.equal(me.user.id,original);assert.notEqual(me.user.email_verified,false);assert.equal(me.user.email,email);assert.ok(me.workspaces.some((w:{id:string})=>w.id===ws))
 assert.equal((await client.get('/api/me')).status,401)
 assert.equal((await new Client(server.url).fetch('/api/auth/verify',{method:'POST',json:{token}})).status,400)
})
test('signed-in people use their existing identity without a new email',async()=>{
 const person=await signIn(server,'existing@direct.test');const before=(await mailbox(server,'existing@direct.test')).length
 const l=await link();assert.equal((await person.post(`/api/invites/${l.token}/accept`,{})).status,200)
 assert.equal((await mailbox(server,'existing@direct.test')).length,before)
})
