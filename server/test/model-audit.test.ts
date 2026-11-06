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
  const exported=await lead.fetch(path+'?export=1');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition')??'',/attachment/);assert.equal(exported.headers.get('cache-control'),'no-store');assert.match(exported.headers.get('content-security-policy')??'',/sandbox/);await exported.text();assert.equal(calls,2)
  assert.equal((await lead.get('/api/workspaces/not-a-member/model-audit')).status,404)
 }finally{await server.stop();upstream.closeAllConnections();upstream.close()}
})

test('live audit writes derive scope from the signed-in lead, validate input and do not expose the audit credential',async()=>{
 const token='synthetic-audit-write-credential-at-least-32-chars',received:any[]=[],queries:string[]=[]
 const runId='1793533177421-11111111-1111-4111-8111-111111111111'
 const upstream=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);queries.push(req.url!);const chunks:Buffer[]=[];for await(const b of req)chunks.push(b);if(chunks.length)received.push(JSON.parse(Buffer.concat(chunks).toString()));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.method==='POST'?{runId,saved:true}:{entries:[]}))});upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
 const server=await startServer({MODEL_AUDIT_URL:'http://127.0.0.1:'+(upstream.address() as any).port+'/admin/audit',MODEL_AUDIT_TOKEN:token,MODEL_AUDIT_OWNER:'lead@audit.test'})
 try{
  const lead=await signIn(server,'lead@audit.test'),other=await signIn(server,'admin@audit.test'),ws=(await lead.post('/api/workspaces',{name:'Private trace'})).body.id
  const link=(await lead.post(`/api/workspaces/${ws}/invites`,{email:'admin@audit.test',role:'admin'})).body.link;await other.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')
  const path=`/api/workspaces/${ws}/model-audit`,input={action:'start',model:'one-shared/fixture',prompt:'Read identity',purpose:'agent'}
  assert.equal((await other.post(path,input)).status,404);assert.equal(received.length,0)
  assert.equal((await lead.post(path,{...input,workspace:'spoofed'})).status,400);assert.equal(received.length,0)
  const start=await lead.post(path,input);assert.equal(start.status,200);assert.equal(start.body.runId,runId);assert.equal(received[0].workspace,ws);assert.ok(received[0].user);assert.ok(!JSON.stringify(start.body).includes(token))
  const event={id:crypto.randomUUID(),type:'tool-call',callId:crypto.randomUUID(),server:'atlas',name:'atlas_whoami',arguments:{},clientAt:Date.now()}
  assert.equal((await lead.post(path,{action:'event',runId,event})).status,200);assert.equal(received[1].user,received[0].user);assert.deepEqual(received[1].event,event)
  assert.equal((await lead.post(path,{action:'event',runId:'../x',event})).status,400)
  assert.equal((await lead.post(path,{action:'event',runId,event:{...event,type:'invented'}})).status,400)
  assert.equal((await lead.get(path+'?runs=1')).status,200);assert.ok(queries.at(-1)!.includes('runs=1'))
  assert.equal((await lead.get(path+'?costs=1')).status,200);assert.ok(queries.at(-1)!.includes('costs=1'))
  const prior=queries.length;assert.equal((await other.get(path+'?costs=1')).status,404);assert.equal(queries.length,prior)
  assert.equal((await lead.get(path+'?run='+runId)).status,200);assert.ok(queries.at(-1)!.includes('run='+runId))
  assert.equal((await lead.get(path+'?run=..%2Fx')).status,400)
 }finally{await server.stop();upstream.closeAllConnections();upstream.close()}
})

test('large design source passes ONE and the real gateway into encrypted audit storage; ordinary requests stay bounded',async()=>{
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 // @ts-expect-error The separately deployed gateway is plain JavaScript; integration exercises its real implementation.
 const {ModelAudit}=await import('../../deploy/model-service/audit.mjs'),{createGateway}=await import('../../deploy/model-service/gateway.mjs')
 const dir=mkdtempSync(join(tmpdir(),'one-large-audit-')),token='synthetic-large-audit-credential-at-least-32-chars'
 const audit=new ModelAudit({dir,keyFile:join(dir,'key'),token}),upstream=createGateway({audit,keys:[]}).server
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
 const server=await startServer({MODEL_AUDIT_URL:'http://127.0.0.1:'+(upstream.address() as any).port+'/admin/audit',MODEL_AUDIT_TOKEN:token,MODEL_AUDIT_OWNER:'lead@audit.test'})
 try{
  const lead=await signIn(server,'lead@audit.test'),other=await signIn(server,'other@audit.test'),ws=(await lead.post('/api/workspaces',{name:'Large source trace'})).body.id,path=`/api/workspaces/${ws}/model-audit`
  const link=(await lead.post(`/api/workspaces/${ws}/invites`,{email:'other@audit.test',role:'admin'})).body.link;await other.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')
  const started=await lead.post(path,{action:'start',model:'one-shared/test',prompt:'Free mock from design without requirements',purpose:'mock'});assert.equal(started.status,200)
  const runId=started.body.runId,callId=crypto.randomUUID(),base={callId,server:'atlas',name:'atlas_get',clientAt:Date.now()}
  assert.equal((await lead.post(path,{action:'event',runId,event:{...base,id:crypto.randomUUID(),type:'tool-call',arguments:{ref:5116,parts:['body']}}})).status,200)
  const source=process.env.MOCK_REFERENCE_MD?readFileSync(process.env.MOCK_REFERENCE_MD,'utf8'):'# Design\n'+('Farbe und Dialog äöü\n'.repeat(180000))
  assert.ok(Buffer.byteLength(source)>1024*1024)
  const result={result:JSON.stringify({content:[{type:'text',text:JSON.stringify({ok:true,item:{ref:5116,body:source}})}]})}
  const input={action:'event',runId,event:{...base,id:crypto.randomUUID(),type:'tool-result',result}}
  assert.equal((await other.post(path,input)).status,404)
  assert.equal((await lead.post(path,input)).status,200)
  assert.equal((await lead.post(path,{action:'event',runId,event:{id:crypto.randomUUID(),type:'run-end',state:'done',clientAt:Date.now(),answer:'Mock created'}})).status,200)
  const detail=await lead.get(path+'?run='+runId);assert.equal(detail.status,200);assert.equal(detail.body.run.state,'done');assert.deepEqual(detail.body.run.events[1].result,result)
  const file=readFileSync(audit.file(runId),'utf8');assert.ok(!file.includes(source.slice(0,100)))
  assert.equal((await lead.post('/api/workspaces',{name:'x'.repeat(300000)})).status,413)
  // A Content-Length refusal must not require transmitting the oversized body first.
  const {request}=await import('node:http')
  const oversized=await new Promise<number|undefined>((resolve,reject)=>{const req=request(server.url+path,{method:'POST',headers:{'content-type':'application/json','content-length':String(17*1024*1024)}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end('{}')})
  assert.equal(oversized,413)
  assert.equal((await lead.get('/api/health')).status,200)
 }finally{await server.stop();upstream.closeAllConnections();upstream.close();rmSync(dir,{recursive:true,force:true})}
})
