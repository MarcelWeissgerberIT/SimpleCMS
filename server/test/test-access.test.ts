import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Client, signIn, startServer, openDoc, flushed, sleep } from './helpers.ts'

async function fixture() {
  const s = await startServer({AUTH_IP_LIMIT:'1000'})
  const owner = await signIn(s, 'owner@access.test'), guest = await signIn(s, 'guest@access.test')
  await owner.patch('/api/me', {name:'Marcel Test'})
  const ws = (await owner.post('/api/workspaces', {name:'Workshop'})).body.id
  const other = (await owner.post('/api/workspaces', {name:'Unrelated'})).body.id
  const guestId = (await guest.get('/api/me')).body.user.id
  const db = new DatabaseSync(join(s.dataDir, 'one.sqlite'))
  db.prepare('INSERT INTO members(workspace_id,user_id,role,guest,created_at) VALUES(?,?,?,?,?)').run(ws,guestId,'viewer',1,Date.now())
  const draft={revision:0,title:'Test workshop',notBefore:Date.now()+86_400_000,lang:'de',recipients:[{id:'prepared',name:'Prepared Guest',email:'prepared@access.test',workspaceId:ws,role:'viewer',guest:true,note:'',atlasLink:'https://atlas.example/?token=SYNTHETIC-INVITE',atlasToken:'SYNTHETIC-MCP'}]}
  assert.equal((await owner.json('PUT',`/api/workspaces/${ws}/welcome`,draft)).status,200)
  return {s, owner, guest, ws, other, guestId, db, close:async()=>{db.close();await s.stop()}}
}
const entry = (ws:string) => `/api/workspaces/${ws}/test-access`

test('owner tests a prepared guest without creating accounts, exposing secrets, or allowing REST/WS writes, and returns', async()=>{
  const f=await fixture(); const {owner,guest,ws,other,db,s}=f
  const docs: ReturnType<typeof openDoc>[]=[]
  try {
    assert.equal((await guest.get(entry(ws)+'/targets')).status,403)
    const personal=(await owner.get('/api/me')).body.workspaces.find((w:any)=>w.personal).id
    assert.equal((await owner.get(entry(personal)+'/targets')).status,403)
    const targets=await owner.get(entry(ws)+'/targets')
    assert.equal(targets.status,200); assert.equal(targets.body.length,2)
    assert.ok(!JSON.stringify(targets.body).includes('SYNTHETIC'))
    const counts=db.prepare('SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM members) members,(SELECT count(*) FROM invites) invites').get()
    const mailBefore=(await owner.get('/api/dev/mailbox')).body.length
    for (const [id,privateTo] of [['public_file',false],['private_file',true]] as const) assert.equal((await owner.fetch(`/api/workspaces/${ws}/files/${id}`,{method:'PUT',body:'test attachment',headers:{'content-type':'text/plain',...(privateTo?{'x-file-scope':'private'}:{})}})).status,201)
    const originalCookie=owner.cookies.get('one_session')
    const actor=(await owner.get('/api/me')).body.user.id
    const doc=openDoc(s,owner,`ws:${ws}`);docs.push(doc);await doc.ready;await doc.synced
    doc.doc.getMap('test').set('note','Before');await flushed(doc)
    assert.equal((await owner.post(entry(ws),{target:'welcome:prepared',role:'owner'})).status,400)
    const started=await owner.post(entry(ws),{target:'welcome:prepared'})
    assert.equal(started.status,200)
    assert.ok(started.res.headers.getSetCookie().some(v=>v.startsWith('one_test_return=')&&/HttpOnly/.test(v)&&/SameSite=Strict/i.test(v)&&/Path=\/api\/auth\/test-access/.test(v)))
    assert.ok(!JSON.stringify(started.body).includes(originalCookie!))
    assert.notEqual(owner.cookies.get('one_session'),originalCookie)
    const me=(await owner.get('/api/me')).body
    assert.equal(me.server_admin,undefined);assert.match(me.user.id,/^test_/);assert.equal(me.user.name,'Prepared Guest (Test)')
    assert.equal(me.workspaces.length,1);assert.equal(me.workspaces[0].id,ws);assert.equal(me.workspaces[0].role,'viewer')
    assert.equal(me.test_access.guest,true);assert.ok(me.test_access.expiresAt <= Date.now()+20*60_000)
    assert.deepEqual((await owner.get(`/api/workspaces/${ws}/welcome-access`)).body,[])
    const publicFile=await owner.fetch(`/api/workspaces/${ws}/files/public_file`);assert.equal(publicFile.status,200);assert.equal(publicFile.headers.get('cache-control'),'no-store');assert.equal(publicFile.headers.get('vary'),'Cookie');await publicFile.text()
    assert.equal((await owner.fetch(`/api/workspaces/${ws}/files/private_file`)).status,404)
    for (const p of ['/api/me/secrets','/api/dev/mailbox','/api/server/signup-links',entry(ws)+'/targets',`/api/workspaces/${other}/members`,`/api/workspaces/${ws}/welcome`]) assert.equal((await owner.get(p)).status,403,p)
    for (const p of [entry(ws),'/api/auth/request','/api/auth/logout',`/api/workspaces/${ws}/readiness`,`/api/workspaces/${ws}/invites`, '/api/v1/agents']) assert.equal((await owner.post(p,{})).status,403,p)
    assert.equal((await owner.patch('/api/me',{name:'WRONG'})).status,403)
    const read=openDoc(s,owner,`ws:${ws}`);docs.push(read);assert.equal(await read.ready,'readonly');await read.synced
    assert.equal(read.doc.getMap('test').get('note'),'Before')
    read.doc.getMap('test').set('note','FORGED');await sleep(120)
    const privateDoc=openDoc(s,owner,`ws:${ws}:u:${actor}`);docs.push(privateDoc);await assert.rejects(privateDoc.ready,/forbidden/)
    const wrong=openDoc(s,owner,`ws:${other}`);docs.push(wrong);await assert.rejects(wrong.ready,/forbidden/)
    const stopped=await owner.post('/api/auth/test-access/stop')
    assert.equal(stopped.status,200);assert.equal(stopped.body.workspaceId,ws)
    assert.equal(owner.cookies.get('one_session'),originalCookie);assert.equal(owner.cookies.has('one_test_return'),false)
    assert.equal((await owner.get('/api/me')).body.user.id,actor)
    const check=openDoc(s,owner,`ws:${ws}`);docs.push(check);await check.ready;await check.synced
    assert.equal(check.doc.getMap('test').get('note'),'Before')
    assert.deepEqual(db.prepare('SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM members) members,(SELECT count(*) FROM invites) invites').get(),counts)
    assert.equal((await owner.get('/api/dev/mailbox')).body.length,mailBefore)
    assert.equal((await owner.get(`/api/workspaces/${ws}/welcome`)).body.recipients[0].status,'draft')
    assert.equal((await owner.get('/api/auth/test-access')).body.canReturn,false)
  } finally {for(const d of docs)d.destroy();await f.close()}
})

test('expiry fails closed but still permits a safe return; source-session revocation never upgrades a test into owner access',async()=>{
  const f=await fixture();const{owner,db,ws,s}=f
  try {
    const source=new Client(s.url);for(const[k,v]of owner.cookies)source.cookies.set(k,v)
    const original=owner.cookies.get('one_session')
    await owner.post(entry(ws),{target:`member:${f.guestId}`})
    db.prepare('UPDATE test_access_sessions SET expires_at=?').run(Date.now()-1)
    assert.equal((await owner.get('/api/me')).status,401)
    assert.equal((await owner.get('/api/auth/test-access')).body.canReturn,true)
    assert.equal((await owner.post('/api/auth/test-access/stop')).status,200)
    assert.equal(owner.cookies.get('one_session'),original)
    await owner.post(entry(ws),{target:`member:${f.guestId}`})
    assert.equal((await source.post('/api/auth/logout')).status,204)
    assert.equal((await owner.get('/api/me')).status,401)
    assert.equal((await owner.post('/api/auth/test-access/stop')).status,403)
    // Foreign-key cascades removed the metadata, but the permanent test marker still forbids owner fallback.
    assert.equal(db.prepare('SELECT count(*) n FROM test_access_sessions').get()!.n,0)
  } finally {await f.close()}
})

test('removing a tested member or the actor’s admin right invalidates test access',async()=>{
  const f=await fixture();const{owner,db,ws}=f
  try {
    await owner.post(entry(ws),{target:`member:${f.guestId}`})
    db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(ws,f.guestId)
    assert.equal((await owner.get('/api/me')).status,401)
    assert.equal((await owner.post('/api/auth/test-access/stop')).status,200)
    await owner.post(entry(ws),{target:'welcome:prepared'})
    db.prepare("UPDATE members SET role='member' WHERE workspace_id=?").run(ws)
    assert.equal((await owner.get('/api/me')).status,401)
    assert.equal((await owner.post('/api/auth/test-access/stop')).status,200)
  } finally {await f.close()}
})
