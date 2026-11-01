import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {startServer,signIn} from './helpers.ts'

test('full model audit is exclusive to the configured lead, not other workspace admins',async()=>{
 const token='synthetic-audit-credential-with-at-least-32-characters';let calls=0
 const upstream=createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({entries:[],retentionDays:30}))});upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
 const server=await startServer({MODEL_AUDIT_URL:'http://127.0.0.1:'+(upstream.address() as any).port+'/admin/audit',MODEL_AUDIT_TOKEN:token,MODEL_AUDIT_OWNER:'lead@audit.test'})
 try{
  const lead=await signIn(server,'lead@audit.test'),other=await signIn(server,'admin@audit.test');const ws=(await lead.post('/api/workspaces',{name:'Audit test'})).body.id
  const link=(await lead.post(`/api/workspaces/${ws}/invites`,{email:'admin@audit.test',role:'admin'})).body.link;await other.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')
  const path=`/api/workspaces/${ws}/model-audit`
  assert.equal((await other.get(path+'?status=1')).status,404);assert.equal((await other.get(path)).status,404);assert.equal(calls,0)
  const status=await lead.get(path+'?status=1');assert.equal(status.status,200);assert.equal(status.res.headers.get('cache-control'),'no-store');assert.equal(calls,0)
  const log=await lead.get(path);assert.equal(log.status,200);assert.deepEqual(log.body.entries,[]);assert.equal(calls,1);assert.ok(!JSON.stringify(log.body).includes(token))
  assert.equal((await lead.get(path+'?entry=..%2Fsecret')).status,400);assert.equal(calls,1)
  assert.equal((await other.get(path+'?export=1')).status,404);assert.equal(calls,1)
  const exported=await lead.fetch(path+'?export=1');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition')??'',/attachment/);assert.equal(exported.headers.get('cache-control'),'no-store');assert.match(exported.headers.get('content-security-policy')??'',/sandbox allow-downloads/);await exported.text();assert.equal(calls,2)
  assert.equal((await lead.get('/api/workspaces/not-a-member/model-audit')).status,404)
 }finally{await server.stop();upstream.closeAllConnections();upstream.close()}
})
