import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { textRequest, textModels, checkTextRequest } from '../src/worker/text-models.ts'
import { modelMcp, checkModelMcp } from '../src/worker/model-mcp.ts'
import { checkAttachments, visionOf } from '../src/worker/copilot-media.ts'
import { readFile } from 'node:fs/promises'
import { looksLikeKey } from '../../src/shared/ai/keys.ts'
import { sanitizeRoute, isRouteKey } from '../../src/shared/ai/route.ts'
import { requiredGen, AI_POLICY_GEN } from '../../src/shared/ai/policy.ts'

test('Copilot is a preserved policy destination; older builds must reload; typed GitHub secrets are refused', () => {
  assert.deepEqual(sanitizeRoute({p:'copilot',m:'claude-opus-5.5'}),{p:'copilot',m:'claude-opus-5.5'})
  assert.equal(isRouteKey('copilot:claude-opus-5.5'),true)
  assert.equal(requiredGen({routes:{terminal:[{p:'copilot',m:'claude-opus-5.5'}]}}),AI_POLICY_GEN)
  assert.ok(looksLikeKey('github_pat_abc1234567890123456789'));assert.ok(looksLikeKey('ghp_abc1234567890123456789'))
})
test('Copilot catalogue checks login without inference; browser JSON and function arguments are validated', async()=>{
  const previous={...process.env},dir=await mkdtemp(join(tmpdir(),'copilot-browser-')),file=join(dir,'worker.json'),fetch=globalThis.fetch
  process.env.COPILOT_BIN=fileURLToPath(new URL('./fixtures/fake-copilot.mjs',import.meta.url))
  process.env.ONE_CODER_OLLAMA='http://127.0.0.1:1'
  globalThis.fetch=async()=>{throw new Error('no model/network traffic in fixture')}
  const req={provider:'copilot',model:'claude-opus-5.5',messages:[{role:'user',content:'Classify this'}],maxTokens:512}
  try{
    const rows=await textModels(file);assert.ok(rows.some(r=>r.provider==='copilot'&&r.chat===true));assert.equal(rows.find(r=>r.provider==='copilot'&&r.model==='claude-opus-5.5')?.context,200000);assert.equal(rows.find(r=>r.provider==='copilot'&&r.model==='gpt-6.1-sol')?.context,32768)
    process.env.COPILOT_ANSWERS=JSON.stringify([{content:'{"label":"ready"}',tool_calls:[]}])
    const schema={type:'object',properties:{label:{type:'string'}},required:['label'],additionalProperties:false}
    const result=await textRequest(file,{...req,schema},new AbortController().signal)
    assert.equal(result.text,'{"label":"ready"}');assert.equal(result.usd,null);assert.deepEqual(result.copilotReceipt?.models,['claude-opus-5.5']);assert.equal(result.copilotReceipt?.inputTokens,50)
    await assert.rejects(textRequest(file,{...req,schema:{...schema,properties:{label:{type:'integer'}}}},new AbortController().signal),/schema/)
    const tools=[{name:'read_page',description:'Read one page',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}]
    process.env.COPILOT_ANSWERS=JSON.stringify([{content:'',tool_calls:[{function:{name:'read_page',arguments:{id:'p1'}}}]}])
    assert.equal((await textRequest(file,{...req,tools},new AbortController().signal)).calls?.[0]?.name,'read_page')
    process.env.COPILOT_ANSWERS=JSON.stringify([{content:'',tool_calls:[{function:{name:'read_page',arguments:{id:42}}}]}])
    await assert.rejects(textRequest(file,{...req,tools},new AbortController().signal),/arguments/)
    assert.throws(()=>checkTextRequest({...req,url:'https://example.org'}));assert.throws(()=>checkTextRequest({...req,provider:'local',tools:[]}))
  }finally{process.env=previous;globalThis.fetch=fetch;await rm(dir,{recursive:true,force:true})}
})
test('Browser MCP uses selected HTTPS credentials only; denied tools and malformed arguments never execute',async()=>{
  const original=globalThis.fetch,called:string[]=[],auth:string[]=[],secret='private-atlas-test-token-value'
  const servers=[{name:'atlas',url:'https://atlas.example.org/mcp',token:secret,allow:['atlas_get','atlas_send'],deny:['atlas_send']}]
  globalThis.fetch=(async(input:any,init:any={})=>{
    assert.equal(String(input instanceof Request?input.url:input),'https://atlas.example.org/mcp')
    auth.push(new Headers(init.headers).get('Authorization')??'')
    const r=JSON.parse(init.body)
    let result:any
    if(r.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'atlas-fixture',version:'1'}}
    else if(r.method==='tools/list')result={tools:['atlas_get','atlas_send','not_allowed'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref'],additionalProperties:false}}))}
    else if(r.method==='tools/call'){called.push(r.params.name);result={content:[{type:'text',text:'Record 43 '+secret}]}}
    else return new Response(null,{status:202})
    return Response.json({jsonrpc:'2.0',id:r.id,result})
  }) as typeof fetch
  try{
    const listed=await modelMcp({servers,action:'list'},new AbortController().signal)
    assert.deepEqual(listed.tools?.map((t:any)=>t.tool),['atlas_get'])
    const result=await modelMcp({servers,action:'call',server:'atlas',name:'atlas_get',arguments:{ref:43}},new AbortController().signal)
    assert.ok(result.result?.includes('Record 43'));assert.ok(!result.result?.includes(secret))
    for(const name of ['atlas_send','not_allowed'])await assert.rejects(modelMcp({servers,action:'call',server:'atlas',name,arguments:{ref:43}},new AbortController().signal),/unavailable/)
    await assert.rejects(modelMcp({servers,action:'call',server:'atlas',name:'atlas_get',arguments:{ref:'bad'}},new AbortController().signal),/arguments/)
    assert.deepEqual(called,['atlas_get']);assert.ok(auth.every(a=>a==='Bearer '+secret))
    for(const url of ['http://127.0.0.1/mcp','https://169.254.169.254/mcp','https://atlas.example.org/mcp?token=secret'])assert.throws(()=>checkModelMcp({servers:[{...servers[0],url}],action:'list'}))
    assert.throws(()=>checkModelMcp({servers:[{...servers[0],command:'sh'}],action:'list'}))
  }finally{globalThis.fetch=original}
})

test('Copilot vision is account-advertised; blobs stay out of prompts/argv; text models and unsafe attachment fields are rejected', async()=>{
  const previous={...process.env},dir=await mkdtemp(join(tmpdir(),'copilot-media-')),capture=join(dir,'wire.json')
  process.env.COPILOT_BIN=fileURLToPath(new URL('./fixtures/fake-copilot.mjs',import.meta.url))
  process.env.COPILOT_CAPTURE=capture
  process.env.COPILOT_ANSWERS=JSON.stringify([{content:'Image seen.',tool_calls:[]}])
  const image={mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2SAAAAABJRU5ErkJggg=='}
  const req={provider:'copilot',model:'claude-opus-5.5',messages:[{role:'user',content:'Describe image attachment 1.'}],maxTokens:512,attachments:[image]}
  try{
    const rows=await textModels(join(dir,'worker.json'))
    assert.ok(rows.some(r=>r.provider==='copilot'&&r.model==='auto'))
    assert.ok(rows.find(r=>r.provider==='copilot'&&r.model==='claude-opus-5.5')?.vision)
    assert.equal((await textRequest(join(dir,'worker.json'),req,new AbortController().signal)).text,'Image seen.')
    const events=JSON.parse(await readFile(capture,'utf8')),sent=events.find((e:any)=>e.method==='session.send')
    assert.equal(sent.params.attachments[0].type,'blob');assert.equal(sent.params.attachments[0].data,image.data)
    assert.ok(!sent.params.prompt.includes(image.data));assert.ok(!sent.args.join(' ').includes(image.data))
    await assert.rejects(textRequest(join(dir,'worker.json'),{...req,model:'gpt-6.1-sol'},new AbortController().signal),/vision/)
    assert.throws(()=>checkTextRequest({...req,attachments:[{...image,path:'/private/file'}]}),/attachment/)
    assert.throws(()=>checkTextRequest({...req,attachments:[{mediaType:'image/png',data:Buffer.from('not an image').toString('base64')}]}),/Image/)
    assert.equal(visionOf({id:'name-does-not-prove-vision'}),undefined)
    assert.throws(()=>checkAttachments([image],{mediaTypes:['image/jpeg'],maxImages:1,maxBytes:1000}),/limits/)
    const auto=await textRequest(join(dir,'worker.json'),{...req,model:'auto',attachments:[]},new AbortController().signal)
    assert.equal(auto.model,'auto')
  }finally{process.env=previous;await rm(dir,{recursive:true,force:true})}
})
