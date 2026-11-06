import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {ModelAudit,redactAudit} from './audit.mjs'
import {createGateway} from './gateway.mjs'
import {hostCosts} from './costs.mjs'
const token='synthetic-test-only-audit-credential-32-chars'
test('host cost endpoint is lead-credential-only, uses metadata and fails explicitly without a plan',async t=>{
 const audit=fixture(t),from=Date.now()-10000,to=Date.now(),plan={currency:'EUR',computePerHour:1,diskPerMonth:1,asOf:'2026-11-01',source:'Synthetic endpoint test'}
 audit.write({auditId:from+'-'+randomUUID(),receivedAt:from,processingAt:from+1000,finishedAt:to,state:'processed',trace:{workspace:'ws',user:'lead',run:'task'},request:{messages:[{content:'Do not include this private prompt'}]},response:'Do not include this private answer'})
 const {server}=createGateway({audit,costPlan:plan,costWindow:()=>({from,to}),keys:[]});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const url='http://127.0.0.1:'+server.address().port+'/admin/audit?costs=1'
 assert.equal((await fetch(url)).status,404)
 const r=await fetch(url,{headers:{authorization:'Bearer '+token}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json()
 assert.deepEqual(data,hostCosts(audit.index.values(),{plan,from,to}));assert.ok(!JSON.stringify(data).includes('private'))
 const missing=createGateway({audit,keys:[]}).server;missing.listen(0,'127.0.0.1');await once(missing,'listening');t.after(()=>{missing.closeAllConnections();missing.close()})
 assert.equal((await fetch('http://127.0.0.1:'+missing.address().port+'/admin/audit?costs=1',{headers:{authorization:'Bearer '+token}})).status,503)
})
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'one-audit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return new ModelAudit({dir,keyFile:join(dir,'key'),token})}
test('encrypted full records, authenticated reads, redaction and retention',t=>{
 const audit=fixture(t),id=Date.now()+'-'+randomUUID(),record={auditId:id,request:{messages:[{content:'private synthetic prompt Bearer test-secret'}],token:'hidden'},modelInput:{role:'user'},response:'full synthetic answer'}
 audit.write(record);const disk=readFileSync(audit.file(id),'utf8');assert.ok(!disk.includes('synthetic'));assert.ok(!disk.includes('hidden'));assert.ok(!disk.includes('test-secret'))
 assert.equal(audit.read(id).response,record.response);assert.equal(audit.read(id).request.token,'[REDACTED]');assert.equal(audit.authorized('Bearer '+token),true);assert.equal(audit.authorized('Bearer wrong'),false)
 assert.throws(()=>audit.read('../key'));assert.equal(redactAudit('https://x.test/?token=hidden&z=1'),'https://x.test/?token=[REDACTED]&z=1')
 const old=String(Date.now()-31*86400000)+'-'+randomUUID();audit.write({...record,auditId:old});audit.prune();assert.ok(!readdirSync(audit.dir).includes(old+'.json'))
})
test('gateway records actual payload, trace, response and lifecycle; API keys cannot read it',async t=>{
 const audit=fixture(t);let observed
 const {server}=createGateway({audit,keys:[],fetchImpl:async(url,init)=>{observed=JSON.parse(init.body);const running=audit.list()[0];assert.equal(running.state,'processing');assert.ok(running.processingAt);return Response.json({message:{content:'Auditable synthetic answer'},done:true})}})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()});const base='http://127.0.0.1:'+server.address().port
 assert.equal((await fetch(base+'/admin/audit')).status,404)
 const request={model:'atlas-flow:latest',messages:[{role:'user',content:'Audit synthetic arrival'}],options:{num_ctx:999999,num_predict:64}}
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json','x-one-job-id':'test-job','x-one-workspace':'test-ws','x-one-queued-at':String(Date.now()-100)},body:JSON.stringify(request)});assert.equal(response.status,200);await response.text()
 const list=await(await fetch(base+'/admin/audit',{headers:{authorization:'Bearer '+token}})).json();assert.equal(list.entries.length,1);const row=list.entries[0];assert.equal(row.state,'processed');assert.equal(row.trace.job,'test-job');assert.ok(row.finishedAt>=row.processingAt);assert.ok(row.processingAt>=row.receivedAt)
 const record=await(await fetch(base+'/admin/audit?id='+row.auditId,{headers:{authorization:'Bearer '+token}})).json();assert.deepEqual(record.request,request);assert.deepEqual(record.modelInput,observed);assert.equal(record.modelInput.options.num_ctx,32768);assert.match(record.response,/Auditable synthetic answer/);assert.equal(record.requestId,response.headers.get('x-request-id'))
 assert.equal(JSON.stringify(record).includes(token),false)
 const exported=await fetch(base+'/admin/audit?export=1',{headers:{authorization:'Bearer '+token}});assert.match(exported.headers.get('content-type'),/ndjson/);const records=(await exported.text()).trim().split('\n').map(JSON.parse);assert.equal(records.length,3);assert.deepEqual(records[1],record);assert.equal(records[2].exportComplete,true);assert.equal(records[2].records,1)
 assert.equal((await fetch(base+'/admin/audit?export=1')).status,404)
})
test('upstream error remains a failed log, never an empty successful answer',async t=>{
 const audit=fixture(t),{server}=createGateway({audit,keys:[],fetchImpl:async()=>new Response('do not expose credentials',{status:500})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'atlas-flow:latest',messages:[{role:'user',content:'failure test'}]})});assert.equal(r.status,502);await r.text();const row=audit.list()[0];assert.equal(row.state,'failed');assert.equal(row.error,'inference_failed');assert.equal(row.responseBytes,0)
})

test('authenticated parseable input rejected by validation remains visible as an unprocessed failure',async t=>{
 const audit=fixture(t);let called=false;const {server}=createGateway({audit,keys:[],fetchImpl:async()=>{called=true;return Response.json({})}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'not-served',messages:[{role:'user',content:'validation failure'}]})});assert.equal(r.status,400);await r.text();const row=audit.list()[0];assert.equal(row.state,'failed');assert.equal(row.error,'model_not_allowed');assert.equal(row.processingAt,null);assert.equal(called,false);assert.equal(audit.read(row.auditId).modelInput,null)
})

test('live run joins gateway rounds with actual harness results; scope, duplicates and failed tools stay explicit',t=>{
 const audit=fixture(t),scope={workspace:'one-ws',user:'lead'},start=audit.startRun({...scope,model:'one-shared/test',prompt:'Read actual identity',purpose:'agent'}),id=start.runId
 const callId=randomUUID(),call={id:randomUUID(),type:'tool-call',callId,server:'atlas',name:'atlas_whoami',arguments:{},clientAt:Date.now()}
 audit.appendRun({...scope,runId:id,event:call});audit.appendRun({...scope,runId:id,event:call})
 assert.equal(audit.run(id).run.events.length,1)
 assert.throws(()=>audit.appendRun({...scope,user:'other',runId:id,event:{...call,id:randomUUID()}}),/scope/)
 assert.throws(()=>audit.appendRun({...scope,runId:id,event:{...call,type:'tool-result',callId:randomUUID()}}),/Unknown/)
 for(let i=0;i<3;i++)audit.write({auditId:Date.now()+'-'+randomUUID(),trace:{...scope,run:id},receivedAt:Date.now(),state:'processed',request:{model:'atlas-flow:latest'},response:'Synthetic model round '+i})
 audit.write({auditId:Date.now()+'-'+randomUUID(),trace:{workspace:'other-ws',user:'lead',run:id},state:'processed',request:{model:'atlas-flow:latest'},response:'Not this workspace'})
 audit.appendRun({...scope,runId:id,event:{id:randomUUID(),type:'tool-error',callId,server:'atlas',name:'atlas_whoami',error:'Actual TLS failure',clientAt:Date.now()}})
 audit.appendRun({...scope,runId:id,event:{id:randomUUID(),type:'run-end',state:'failed',error:'Tool failed',answer:'No identity verified.',clientAt:Date.now()}})
 const result=audit.run(id);assert.equal(result.rounds.length,3);assert.equal(result.run.events.length,3);assert.equal(result.run.state,'failed');assert.equal(result.run.events[1].error,'Actual TLS failure');assert.equal(result.run.events[1].source,'one-browser-harness');assert.ok(result.run.finishedAt)
 assert.equal(audit.list(50,null,true).length,1);assert.equal(audit.list().length,4)
 assert.throws(()=>audit.appendRun({...scope,runId:id,event:{...call,id:randomUUID()}}),/closed/)
 const restored=new ModelAudit({dir:audit.dir,keyFile:join(audit.dir,'key'),token});assert.equal(restored.list(50,null,true).length,1);assert.equal(restored.run(id).rounds.length,3)
})

test('gateway live trace keeps full real results and run metadata out of model text',async t=>{
 const audit=fixture(t),{server}=createGateway({audit,keys:[],fetchImpl:async()=>Response.json({message:{content:'Real synthetic response'},done:true})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const base='http://127.0.0.1:'+server.address().port,scope={workspace:'ws',user:'lead'},headers={authorization:'Bearer '+token,'content-type':'application/json'}
 const start=await fetch(base+'/admin/audit',{method:'POST',headers,body:JSON.stringify({action:'start',...scope,model:'one-shared/fixture',prompt:'Trace fixture',purpose:'test'})});assert.equal(start.status,200);const {runId}=await start.json()
 const request={model:'atlas-flow:latest',messages:[{role:'user',content:'Trace fixture'}]}
 const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json','x-one-run-id':runId,'x-one-workspace':'ws','x-one-user-id':'lead'},body:JSON.stringify(request)});await response.text();assert.equal(response.status,200)
 const callId=randomUUID();for(const event of [{id:randomUUID(),type:'tool-call',callId,server:'atlas',name:'atlas_get',arguments:{ref:42},clientAt:Date.now()},{id:randomUUID(),type:'tool-result',callId,server:'atlas',name:'atlas_get',result:{result:JSON.stringify({content:[{type:'text',text:'Observed body'}],token:'should-be-redacted'})},clientAt:Date.now()},{id:randomUUID(),type:'run-end',state:'done',answer:'Observed body',clientAt:Date.now()}]){assert.equal((await fetch(base+'/admin/audit',{method:'POST',headers,body:JSON.stringify({action:'event',...scope,runId,event})})).status,200)}
 const detail=await(await fetch(base+'/admin/audit?run='+runId,{headers})).json();assert.equal(detail.rounds.length,1);assert.equal(detail.run.events.length,3);assert.equal(detail.run.answer,'Observed body');assert.deepEqual(detail.rounds[0].request,request);assert.equal(JSON.stringify(detail).includes('should-be-redacted'),false)
 assert.equal((await(await fetch(base+'/admin/audit?runs=1',{headers})).json()).entries.length,1)
 assert.equal((await fetch(base+'/admin/audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',...scope,model:'x',prompt:'x',purpose:'x'})})).status,404)
})
