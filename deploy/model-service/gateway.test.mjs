import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {randomBytes} from 'node:crypto'
import {createGateway,keyHash,Queue} from './gateway.mjs'

const secret='af_'+randomBytes(32).toString('base64url'),row={id:'cnsx-test',hash:keyHash(secret),enabled:true}
async function fixture(t,options={}){
 const calls=[],logs=[],keys=[{...row}],{server}=createGateway({keys,internal:false,log:r=>logs.push(r),fetchImpl:async(url,init)=>{calls.push({url:String(url),...init});return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}]}),{headers:{'content-type':'application/json'}})},...options})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()})
 const base='http://127.0.0.1:'+server.address().port
 const request=(path,body,auth=secret)=>fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},...(body?{body:JSON.stringify(body)}:{})})
 return {request,calls,logs,keys,base}
}
const body={model:'atlas-flow:latest',messages:[{role:'user',content:'Private test prompt'}],max_tokens:64}
test('unauthenticated, expired and revoked keys never reach inference',async t=>{
 const f=await fixture(t)
 assert.equal((await f.request('/v1/models',null,null)).status,401)
 assert.equal((await f.request('/v1/chat/completions',body,'af_'+'x'.repeat(43))).status,401)
 f.keys[0].expiresAt=1;assert.equal((await f.request('/v1/models')).status,401)
 delete f.keys[0].expiresAt;f.keys[0].enabled=false;assert.equal((await f.request('/v1/models')).status,401)
 assert.equal(f.calls.length,0)
})
test('catalogue is restricted and valid text reaches exactly the pinned upstream model',async t=>{
 const f=await fixture(t),catalogue=await(await f.request('/v1/models')).json()
 assert.deepEqual(catalogue.data.map(m=>m.id),['atlas-flow:latest'])
 const r=await f.request('/v1/chat/completions',body);assert.equal(r.status,200);assert.ok(r.headers.get('x-request-id'))
 assert.equal((await r.json()).choices[0].message.content,'OK')
 assert.equal(f.calls[0].url,'http://127.0.0.1:11434/v1/chat/completions')
 assert.equal(JSON.parse(f.calls[0].body).max_tokens,64)
 assert.equal(JSON.stringify(f.logs).includes('Private test prompt'),false)
 assert.equal(JSON.stringify(f.logs).includes(secret),false)
 assert.equal(f.calls[0].headers.authorization,undefined)
})
test('foreign models, image input, oversize context, output and raw management APIs are refused',async t=>{
 const f=await fixture(t)
 for(const invalid of [{...body,model:'qwen3:8b'},{...body,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://bad.invalid/a.png'}}]}]},{...body,messages:[{role:'user',content:'x'.repeat(22001)}]},{...body,max_tokens:4097},{...body,stream:'yes'}])assert.equal((await f.request('/v1/chat/completions',invalid)).status,400)
 assert.equal((await f.request('/api/pull',{model:'anything'})).status,404)
 assert.equal((await f.request('/api/show',{model:'atlas-flow:latest'})).status,404)
 assert.equal(f.calls.length,0)
 const huge=await f.request('/v1/chat/completions',{...body,messages:[{role:'user',content:'x'.repeat(300000)}]});assert.equal(huge.status,413)
})
test('one global FIFO releases cancelled waiters and enforces global and per-key bounds',async()=>{
 const q=new Queue(3,2),a=new AbortController(),b=new AbortController(),c=new AbortController()
 const releaseA=await q.enter('a',a.signal),waitB=q.enter('b',b.signal),waitC=q.enter('c',c.signal)
 assert.throws(()=>q.enter('d',new AbortController().signal),e=>e.status===429)
 b.abort(new Error('cancelled'));await assert.rejects(waitB,/cancelled/)
 releaseA();const releaseC=await waitC;assert.equal(q.active,true);releaseC();assert.equal(q.active,false);assert.equal(q.counts.size,0)
 const release=await q.enter('same',new AbortController().signal),secondAbort=new AbortController(),second=q.enter('same',secondAbort.signal)
 assert.throws(()=>q.enter('same',new AbortController().signal),e=>e.status===429)
 secondAbort.abort();await assert.rejects(second);release()
})
test('upstream errors are sanitized, never retried or redirected to another model',async t=>{
 let count=0
 const f=await fixture(t,{fetchImpl:async()=>{count++;return new Response('backend secrets',{status:500})}})
 const r=await f.request('/v1/chat/completions',body);assert.equal(r.status,502)
 assert.equal((await r.text()).includes('backend secrets'),false);assert.equal(count,1)
})
test('streaming passes SSE as it arrives',async t=>{
 const event='data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
 const f=await fixture(t,{fetchImpl:async()=>new Response(event)})
 const r=await f.request('/v1/chat/completions',{...body,stream:true});assert.match(r.headers.get('content-type'),/text\/event-stream/);assert.equal(await r.text(),event)
})
test('ONE hosts use loopback-only native routes with the same inference queue and hard limits',async t=>{
 const f=await fixture(t,{internal:true,fetchImpl:async(url,init)=>{
   if(String(url).endsWith('/api/tags'))return Response.json({models:[{name:'atlas-flow:latest'},{name:'other'}]})
   if(String(url).endsWith('/api/show'))return Response.json({capabilities:['completion','tools']})
   const r=JSON.parse(init.body);assert.deepEqual(r.options,{num_ctx:32768,num_predict:128,temperature:0.2});assert.equal(r.keep_alive,'30m');return Response.json({message:{content:'OK'}})
 }})
 const tags=await(await f.request('/api/tags',null,null)).json();assert.equal(tags.models.length,1)
 assert.equal((await f.request('/api/show',{model:'atlas-flow:latest'},null)).status,200)
 assert.equal((await f.request('/api/chat',{model:'atlas-flow:latest',messages:body.messages,options:{num_ctx:999999,num_predict:128}},null)).status,200)
})
test('client cancellation aborts upstream work and releases its queue slot',async t=>{
 let aborted=false,started
 const ready=new Promise(r=>started=r)
 const f=await fixture(t,{fetchImpl:async(_url,init)=>new Promise((_resolve,reject)=>{started();init.signal.addEventListener('abort',()=>{aborted=true;reject(init.signal.reason)},{once:true})})})
 const abort=new AbortController(),request=fetch(f.base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify(body),signal:abort.signal})
 await ready;abort.abort();await assert.rejects(request)
 for(let i=0;i<30&&!aborted;i++)await new Promise(r=>setTimeout(r,10))
 assert.equal(aborted,true)
})
