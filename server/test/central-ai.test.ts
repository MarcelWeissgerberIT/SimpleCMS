import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import Anthropic from '@anthropic-ai/sdk'
import {startServer,signIn,type Client} from './helpers.ts'
import {reserveMicro,usageCost,scrubCentral,centralProviderFailure} from '../src/routes/central-ai.ts'

const secret='sk-ant-test-only-central-key-12345678',atlas='personal-atlas-token-test-12345678',model='claude-opus-5-5'
test('central tariff accounting includes both cache TTLs and refuses invalid usage',()=>{
 assert.equal(usageCost({input_tokens:100,output_tokens:50,cache_read_input_tokens:10,cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:20,ephemeral_1h_input_tokens:10}}),1582)
 assert.equal(usageCost({input_tokens:100,output_tokens:50,cache_creation_input_tokens:30}),1640)
 assert.equal(usageCost({input_tokens:-1,output_tokens:50}),null)
 assert.equal(usageCost({input_tokens:1000001,output_tokens:50}),null)
 assert.equal(usageCost({input_tokens:20}),null)
 assert.equal(reserveMicro(100),8002000)
 assert.deepEqual(scrubCentral({authorization_token:atlas,text:atlas+' '+secret},[atlas,secret]),{authorization_token:'[redacted]',text:'[redacted] [redacted]'})
})

test('central Claude: owner-only encrypted key, native SDK/MCP, durable atomic budget and private audit',async t=>{
 let mode='normal',delay=0
 const upstream:any[]=[]
 const fake=createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/v1/models/'+model){res.writeHead(req.headers['x-api-key']===secret?200:401,{'content-type':'application/json'}).end(JSON.stringify({id:model}));return}
  let raw='';for await(const b of req)raw+=b
  const p=JSON.parse(raw);upstream.push({p,headers:req.headers})
  if(delay)await new Promise(r=>setTimeout(r,delay))
  if(p.service_tier!=='standard_only'){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:'service_tier: expected auto or standard_only'}}));return}
  if(mode==='reject'||mode==='bad-request'){res.writeHead(mode==='reject'?401:400,{'content-type':'application/json','request-id':'req_provider_fixture'}).end(JSON.stringify({error:{type:mode==='reject'?'authentication_error':'invalid_request_error',message:'Provider detail '+secret+' '+atlas}}));return}
  const usage={input_tokens:100,output_tokens:50,cache_read_input_tokens:10,cache_creation_input_tokens:0}
  const content=[{type:'text',text:'Verified Atlas answer '+atlas+' '+secret},{type:'tool_use',id:'toolu_test',name:'read_page',input:{id:'source-page'}}]
  if(p.stream){res.writeHead(200,{'content-type':'text/event-stream'})
   const events=[{type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model,content:[],usage:{...usage,output_tokens:0},stop_reason:null}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:content[0]!.text}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:content[1]},{type:'content_block_stop',index:1},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:50}},{type:'message_stop'}]
   if(mode==='partial')events.splice(6)
   // Split records and UTF-8 bytes to exercise incremental SSE framing.
   const data=events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('')
   res.write(data.slice(0,29));await new Promise(r=>setTimeout(r,20));res.end(data.slice(29));return
  }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'msg_test',type:'message',role:'assistant',model,content,usage,stop_reason:'tool_use'}))
 })
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(fake.address()as any).port
 let app=await startServer({ANTHROPIC_BASE_URL:url})
 try{
 const owner=await signIn(app,'central-owner@test.invalid'),member=await signIn(app,'central-member@test.invalid'),other=await signIn(app,'central-alien@test.invalid')
 const w1=(await owner.post('/api/workspaces',{name:'AJ CNSx'})).body.id,w2=(await owner.post('/api/workspaces',{name:'AJ FeliX'})).body.id
 const w3=(await other.post('/api/workspaces',{name:'Other company'})).body.id
 const path=`/api/workspaces/${w1}/central-ai`,path2=`/api/workspaces/${w2}/central-ai`
 for(const w of [w1,w2]){const inv=await owner.post(`/api/workspaces/${w}/invites`,{role:'member',email:'central-member@test.invalid'});const token=new URL(inv.body.link).hash.split('/').pop();assert.equal((await member.post('/api/invites/'+token+'/accept')).status,200)}
 const save=async(p:any)=>owner.json('PUT',path,p)
 let config={version:0,label:'AJ · Claude',budgetUsd:100,enabled:false,workspaces:[w1,w2]}
 await t.test('ACL and explicit workspace binding',async()=>{
  assert.equal((await other.get(path)).status,404)
  assert.equal((await member.json('PUT',path,config)).status,403)
  assert.equal((await save({...config,workspaces:[w1,w3]})).status,403)
  const created=await save(config);assert.equal(created.status,200);config.version=created.body.version
  assert.equal(created.body.configured,false);assert.equal(created.body.ready,false)
  const m=(await member.get(path)).body;assert.equal(m.manage,false);assert.equal(m.budgetUsd,undefined);assert.equal(m.workspaces,undefined)
  assert.equal((await member.get(path+'/requests')).status,403)
  assert.equal((await member.post(path+'/key',{version:config.version,key:secret})).status,403)
  assert.equal((await owner.post(path+'/messages',{model,max_tokens:100,messages:[{role:'user',content:'test'}]})).status,403)
  assert.equal(upstream.length,0)
 })
 await t.test('free model-access verification, encrypted key and versioned activation',async()=>{
  const wrong=await owner.post(path+'/key',{version:config.version,key:'sk-ant-wrong-test-key-123456'});assert.equal(wrong.status,400)
  const checked=await owner.post(path+'/key',{version:config.version,key:secret});assert.equal(checked.status,200);config.version=checked.body.version
  assert.equal(checked.body.enabled,false);assert.equal(JSON.stringify(checked.body).includes(secret),false)
  const db=new DatabaseSync(join(app.dataDir,'one.sqlite'));const sealed=(db.prepare('SELECT sealed_key FROM central_ai').get()as any).sealed_key;db.close();assert.match(sealed,/^v1\./);assert.equal(sealed.includes(secret),false)
  assert.equal((await save({...config,version:1,enabled:true})).status,409)
  const enabled=await save({...config,enabled:true});assert.equal(enabled.status,200);config.version=enabled.body.version;config.enabled=true
  assert.equal((await member.get(path2)).body.ready,true)
  const defaults=await owner.post(path+'/defaults',{version:config.version});assert.equal(defaults.status,200)
 })
 const packet={model,max_tokens:100,messages:[{role:'user',content:'Read the personal Atlas source'}],mcp_servers:[{type:'url',name:'atlas',url:'https://aj-atlas.com/api/atlas/mcp',authorization_token:atlas}],tools:[{type:'mcp_toolset',mcp_server_name:'atlas'}],fallbacks:'default'}
 const send=(client:Client,p:any=packet,version=config.version)=>client.fetch(path+'/messages',{method:'POST',headers:{'x-one-central-version':String(version),'anthropic-beta':'server-side-fallback-2026-07-01,mcp-client-2025-11-20'},json:p})
 await t.test('native streaming SDK and personal MCP tokens remain usable without returning the central key',async()=>{
  const sdk=new Anthropic({apiKey:'not-a-real-browser-key',dangerouslyAllowBrowser:true,maxRetries:0,fetch:async(_url,init)=>send(member,JSON.parse(init!.body as string))})
  // SDK transport is tested against the real central HTTP endpoint; the provider is a local fake.
  const stream=await sdk.messages.create({...packet,stream:true}as any)
  const events:any[]=[];for await(const event of stream as any)events.push(event)
  assert.ok(events.some(e=>e.type==='content_block_start'&&e.content_block.type==='tool_use'))
  assert.equal(JSON.stringify(events).includes(secret),false);assert.ok(JSON.stringify(events).includes('[redacted]'))
  assert.equal(upstream.at(-1).headers['x-api-key'],secret)
  assert.equal(upstream.at(-1).p.mcp_servers[0].authorization_token,atlas)
  assert.equal(upstream.at(-1).p.fallbacks,undefined)
  assert.equal(upstream.at(-1).p.service_tier,'standard_only')
  assert.ok(!upstream.at(-1).headers['anthropic-beta'].includes('server-side-fallback'))
  const list=(await owner.get(path+'/requests')).body;assert.equal(list[0].state,'done');assert.equal(list[0].usd,.001402);assert.equal(list[0].reservedUsd,0)
  const audit=await owner.get(path+'/requests/'+list[0].id);assert.equal(audit.status,200);assert.ok(audit.body.response.events.some((e:any)=>e.type==='message_start'))
  assert.equal(JSON.stringify(audit.body).includes(secret),false);assert.equal(JSON.stringify(audit.body).includes(atlas),false)
  assert.equal((await member.get(path+'/requests/'+list[0].id)).status,403)
  assert.equal((await other.get(path+'/requests/'+list[0].id)).status,404)
  const db=new DatabaseSync(join(app.dataDir,'one.sqlite'));const auditCipher=(db.prepare('SELECT sealed_audit FROM central_ai_requests LIMIT 1').get()as any).sealed_audit;db.close();assert.match(auditCipher,/^v1\./);assert.equal(auditCipher.includes('Verified Atlas'),false)
 })
 await t.test('wrong models, extra paid tools, stale configuration and external origins fail before provider access',async()=>{
  const n=upstream.length
  assert.equal((await send(member,{...packet,model:'claude-other'})).status,400)
  assert.equal((await send(member,{...packet,speed:'fast'})).status,400)
  assert.equal((await send(member,{...packet,tools:[{type:'web_search_20250305'}]})).status,400)
  assert.equal((await send(member,packet,1)).status,409)
  assert.equal((await member.fetch(path+'/messages',{method:'POST',headers:{origin:'https://evil.invalid','x-one-central-version':String(config.version)},json:packet})).status,403)
  assert.equal(upstream.length,n)
 })
 await t.test('the shared budget reservation is atomic across workspaces and users',async()=>{
  const saved=await save({...config,budgetUsd:9});assert.equal(saved.status,200);config.version=saved.body.version;config.budgetUsd=9
  delay=200
  const [a,b]=await Promise.all([send(owner),send(member)])
  assert.deepEqual([a.status,b.status].sort(),[200,402]);await a.text();await b.text();delay=0
  const state=(await owner.get(path2)).body;assert.equal(state.heldUsd,0);assert.equal(state.spentUsd,.002804)
 })
 await t.test('provider rejection is sanitized and releases its unused reservation',async()=>{
  mode='reject';const response=await send(member);const raw=await response.text();assert.equal(response.status,403);assert.equal(raw.includes(secret),false);mode='normal'
  const list=(await owner.get(path+'/requests')).body;assert.equal(list[0].state,'rejected');assert.equal(list[0].reservedUsd,0)
 })
 await t.test('invalid request preserves a safe actionable code and private redacted provider diagnostic',async()=>{
  mode='bad-request';const response=await send(member);const result:any=await response.json();mode='normal'
  assert.equal(response.status,400);assert.equal(result.error.code,'central_provider_request')
  assert.equal(JSON.stringify(result).includes('Provider detail'),false)
  assert.equal(response.headers.get('x-one-central-request'),result.error.requestId)
  const audit=(await owner.get(path+'/requests/'+result.error.requestId)).body
  assert.equal(audit.state,'rejected');assert.equal(audit.response.status,400);assert.equal(audit.response.type,'invalid_request_error');assert.equal(audit.response.requestId,'req_provider_fixture')
  assert.equal(audit.response.message,'Provider detail [redacted] [redacted]')
  const list=(await owner.get(path+'/requests')).body;assert.equal(list[0].reservedUsd,0)
 })
 await t.test('incomplete streaming keeps a durable safety reservation and cannot masquerade as success',async()=>{
  mode='partial';const response=await send(member,{...packet,stream:true});await response.text();mode='normal'
  const list=(await owner.get(path+'/requests')).body;assert.equal(list[0].state,'uncertain');assert.equal(list[0].reservedUsd,8.002)
  assert.equal((await send(member)).status,402)
  const dataDir=app.dataDir;await app.stop();app=await startServer({ANTHROPIC_BASE_URL:url},dataDir)
  const again=await signIn(app,'central-owner@test.invalid');const state=(await again.get(path)).body;assert.equal(state.heldUsd,8.002)
  const result=await again.json('DELETE',path+'/key',{version:state.version});assert.equal(result.status,200);assert.equal(result.body.configured,false);assert.equal(result.body.ready,false);assert.equal(result.body.heldUsd,8.002)
  assert.equal((await again.post(path+'/messages',packet)).status,403)
 })
 assert.equal(app.logs().includes(secret),false);assert.equal(app.logs().includes(atlas),false)
 }finally{await app.stop();await new Promise<void>(r=>fake.close(()=>r()))}
})

test('central provider diagnostics classify billing, limits and availability without leaking credentials',async()=>{
 for(const [status,message,code]of [[400,'Your credit balance is too low','credits'],[401,'invalid key','auth'],[403,'denied','auth'],[404,'model missing','model'],[429,'rate limited','rate'],[500,'upstream failed','unavailable'],[400,'bad parameter','request']]as const){
  const result=await centralProviderFailure(new Response(JSON.stringify({error:{type:'fixture',message:message+' '+secret+' '+atlas}}),{status,headers:{'request-id':'req_fixture'}}),[secret,atlas])
  assert.equal(result.code,'central_provider_'+code)
  assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(result).includes(atlas),false)
 }
 const oversized=await centralProviderFailure(new Response('x'.repeat(65537),{status:400}),[])
 assert.equal((oversized.audit as any).truncated,true);assert.equal((oversized.audit as any).message,'')
 const html=await centralProviderFailure(new Response('<html>Proxy failed</html>',{status:502}),[])
 assert.equal((html.audit as any).message,'')
})
