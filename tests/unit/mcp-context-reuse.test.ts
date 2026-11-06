import {test} from 'node:test'
import assert from 'node:assert/strict'
import {McpReadReuse,reusableMcpRead} from '../../src/shared/mcp/readReuse.ts'
import {revalidatedSource,sourceRecord,sourceRevision} from '../../src/shared/mcp/sourceSnapshot.ts'
import {sha256Hex} from '../../src/shared/mcp/sha256.ts'
import {validTaskRecovery,recoveryTask,type TaskRecovery} from '../../src/shared/ai/taskRecovery.ts'

test('task reads canonicalize arguments, expire and clear before reuse after a write',()=>{
 let now=1000;const cache=new McpReadReuse(()=>now,100,30)
 const a=cache.key('atlas','atlas_get',{ref:12,parts:['body']}),b=cache.key('atlas','atlas_get',{parts:['body'],ref:12})
 assert.equal(a,b);assert.notEqual(a,cache.key('other','atlas_get',{ref:12,parts:['body']}))
 cache.put(a,'source');assert.equal(cache.get(b)?.value,'source');now+=30;assert.equal(cache.get(a),null)
 cache.put(a,'source');cache.clear();assert.equal(cache.get(a),null)
 cache.put('a','x'.repeat(60));cache.put('b','y'.repeat(60));assert.equal(cache.get('a'),null);assert.equal(cache.get('b')?.value.length,60)
 cache.put('too-large','z'.repeat(101));assert.equal(cache.get('too-large'),null)
 for(const name of ['atlas_whoami','identity','job_poll','get_permissions','auth_check','status'])assert.equal(reusableMcpRead(name,'read'),false)
 assert.equal(reusableMcpRead('atlas_get','write'),false);assert.equal(reusableMcpRead('atlas_get','read'),true)
})
const record={ref:12,title:'Button',body:'Documented button',updatedAt:'2026-11-05T00:00:00Z',project:'flux',tenant:'aj',kind:'doc',status:'active',tags:['ui-package:v5']}
const snapshot=()=>{const raw=JSON.stringify({item:record});return {raw,hash:sha256Hex(raw),at:1000}}
const meta=(changes:Record<string,unknown>={})=>JSON.stringify({item:{...record,body:undefined,...changes}})
test('durable source reuse requires exact revision, hash, scope and lifecycle after a fresh read',()=>{
 const saved=snapshot();assert.equal(sourceRecord(revalidatedSource(saved,meta())!)?.body,record.body)
 for(const change of [{updatedAt:'new'},{project:'other'},{tenant:'other'},{status:'archived'},{tags:[]},{ref:13},{title:'Changed'},{updatedAt:undefined}])assert.equal(revalidatedSource(saved,meta(change)),null)
 assert.equal(revalidatedSource({...saved,hash:'corrupted'},meta()),null)
 assert.equal(revalidatedSource({...saved,at:NaN},meta()),null)
 assert.equal(revalidatedSource(null as any,meta()),null)
 assert.equal(sourceRevision({ref:12}),null)
})
test('permission failures, truncated and error records never authorize a stale body',()=>{
 for(const raw of [JSON.stringify({isError:true,content:[{type:'text',text:'Forbidden'}]}),JSON.stringify({ok:false,item:record}),JSON.stringify({truncated:true,item:record}),JSON.stringify({item:{...record,truncated:true}}),'invalid'])assert.equal(revalidatedSource(snapshot(),raw),null)
})
test('recovery carries historical effects as data and grants only a fresh read-only continuation',()=>{
 const saved:TaskRecovery={v:1,task:'Create a record and attach the mock',checkpoint:JSON.stringify({kind:'historical_host_checkpoint',effects:[{kind:'write',state:'unknown',ref:123}]}),at:1000,status:'error',page:'p1'}
 assert.equal(validTaskRecovery(saved),true);assert.match(recoveryTask(saved),/Nur lesen/);assert.match(recoveryTask(saved),/unklare externe Aktionen nicht wiederholen/)
 assert.equal(validTaskRecovery({...saved,checkpoint:'{}'}),false);assert.equal(validTaskRecovery({...saved,checkpoint:'x'.repeat(500001)}),false);assert.equal(validTaskRecovery({...saved,status:'success'}),false)
 assert.throws(()=>recoveryTask({...saved,checkpoint:'invalid'}))
})

test('worker context reserves the advertised output capacity instead of an unsupported larger default',async()=>{
 const {workerOutputLimit}=await import('../../src/shared/ai/worker.ts')
 assert.equal(workerOutputLimit({provider:'local',context:32768,maxOutput:8192}),8192)
 assert.equal(workerOutputLimit({provider:'copilot',context:32768,maxOutput:4096}),4096)
 assert.equal(workerOutputLimit({provider:'local',context:4096}),2048)
 assert.equal(workerOutputLimit({provider:'local',context:32768,maxOutput:-1}),16384)
 assert.equal(workerOutputLimit({provider:'local',context:32768,maxOutput:999999}),16384)
})
