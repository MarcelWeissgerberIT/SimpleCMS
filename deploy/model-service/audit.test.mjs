import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {ModelAudit,redactAudit} from './audit.mjs'
import {createGateway} from './gateway.mjs'
const token='synthetic-test-only-audit-credential-32-chars'
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
})
test('upstream error remains a failed log, never an empty successful answer',async t=>{
 const audit=fixture(t),{server}=createGateway({audit,keys:[],fetchImpl:async()=>new Response('do not expose credentials',{status:500})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'atlas-flow:latest',messages:[{role:'user',content:'failure test'}]})});assert.equal(r.status,502);await r.text();const row=audit.list()[0];assert.equal(row.state,'failed');assert.equal(row.error,'inference_failed');assert.equal(row.responseBytes,0)
})
