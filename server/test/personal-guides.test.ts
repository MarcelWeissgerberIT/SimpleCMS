import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signIn,startServer,mailbox } from './helpers.ts'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

test('personal guides are recipient-bound, encrypted and absent for admins, other members and impersonation',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const owner=await signIn(server,'owner@guides.test'),richard=await signIn(server,'richard@guides.test'),other=await signIn(server,'other@guides.test'),outsider=await signIn(server,'outsider@guides.test')
  const ws=(await owner.post('/api/workspaces',{name:'Workshop'})).body.id
  for(const [client,email,role] of [[richard,'richard@guides.test','member'],[other,'other@guides.test','admin']] as const){const invite=(await owner.post(`/api/workspaces/${ws}/invites`,{email,role})).body.link;assert.equal((await client.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')).status,200)}
  const path=`/api/workspaces/${ws}/personal-guides`,payload={email:'richard@guides.test',title:'Private PO preparation',sections:[{title:'Read first',body:'RECIPIENT-ONLY-CONTENT',prompt:'Check my actual Atlas identity; never assume PO rights.'}],expiresAt:Date.now()+86400000}
  const mails=(await mailbox(server)).length
  assert.equal((await owner.json('PUT',path+'/po',payload)).status,200)
  assert.equal((await richard.get(path)).body[0].sections[0].body,'RECIPIENT-ONLY-CONTENT')
  for(const client of [owner,other])assert.deepEqual((await client.get(path)).body,[])
  assert.equal((await outsider.get(path)).status,404)
  assert.equal((await richard.json('PUT',path+'/fake',payload)).status,403)
  assert.equal((await other.json('PUT',path+'/po',payload)).status,403)
  const db=new DatabaseSync(join(server.dataDir,'one.sqlite'))
  try{const raw=db.prepare('SELECT sealed FROM personal_guides').get() as {sealed:string};assert.ok(!raw.sealed.includes('RECIPIENT-ONLY-CONTENT'))}finally{db.close()}
  assert.equal((await mailbox(server)).length,mails,'Preparing a guide sends no email')
  // A real recipient login is required even for an owner testing their interface.
  const targets=await owner.get(`/api/workspaces/${ws}/test-access/targets`)
  assert.equal(targets.status,200)
  const target=targets.body.find((r:any)=>r.email==='richard@guides.test');assert.ok(target)
  assert.equal((await owner.post(`/api/workspaces/${ws}/test-access`,{target:target.id})).status,200)
  assert.equal((await owner.get(path)).status,403)
  assert.equal((await owner.json('PUT',path+'/fake',payload)).status,403)
  assert.equal((await owner.post('/api/auth/test-access/stop')).status,200)
 }finally{await server.stop()}
})
