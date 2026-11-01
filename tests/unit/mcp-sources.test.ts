import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverMcpTools} from '../../src/shared/mcp/discovery.ts'
import {McpResults,unwrapMcpText} from '../../src/shared/mcp/results.ts'
const tools=['atlas_get','atlas_get_details','atlas_search','atlas_query','atlas_project_list','atlas_delete','atlas_whoami'].map(name=>({name,description:name==='atlas_search'?'Search records by q':'Generic tool'}))
test('Atlas topic/date discovery finds general read tools without requiring topic words in schemas',()=>{
 assert.equal(discoverMcpTools(tools,'atlas document lab notebook')[0]?.name,'atlas_search')
 assert.equal(discoverMcpTools(tools,'atlas work items last week')[0]?.name,'atlas_query')
 assert.deepEqual(discoverMcpTools(tools,'atlas_get_details').map(t=>t.name),['atlas_get_details'])
 assert.deepEqual(discoverMcpTools(tools,'atlas whoami').map(t=>t.name),['atlas_whoami'])
 assert.ok(!discoverMcpTools(tools.filter(t=>t.name!=='atlas_search'),'atlas document notebook').some(t=>t.name==='atlas_search'))
 assert.equal(discoverMcpTools([{name:'calendar_list',description:'list calendars'}],'atlas document notebook').length,0)
})
const envelope=(v:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(v)}]})
test('large Atlas context keeps exact source fields available instead of truncating JSON',()=>{
 const cache=new McpResults(),body='a 🦆 " \\ \n'.repeat(5000)
 const root=JSON.parse(cache.pack(envelope({items:[{ref:23166,body}],nextCursor:'cursor',count:1})))
 assert.equal(root.isError,false);assert.equal(root.partial,true)
 assert.ok(JSON.stringify(root).length<4500)
 const rows=JSON.parse(cache.read({result_id:root.result_id,path:'/items'}))
 assert.equal(rows.content[0].overview.metadata.ref,23166)
 const item=JSON.parse(cache.read({result_id:root.result_id,path:'/items/0'}))
 assert.ok(item.content.some((v:any)=>v.key==='ref'&&v.value===23166))
 let offset=0,restored=''
 do{const page=JSON.parse(cache.read({result_id:root.result_id,path:'/items/0/body',offset}));assert.ok(JSON.stringify(page).length<4500);restored+=page.content;offset=page.next_offset}while(offset!==null)
 assert.equal(restored,body)
 assert.throws(()=>cache.read({result_id:root.result_id,path:'/items/0/__proto__'}),/not found/)
 assert.throws(()=>cache.read({result_id:root.result_id,path:'/items/0/body',offset:-1}),/nonnegative/)
 assert.throws(()=>new McpResults().read({result_id:root.result_id}),/another run/)
})
test('array and object pagination retain every source entry with bounded valid JSON',()=>{
 const cache=new McpResults(),values=Array.from({length:150},(_,ref)=>({ref,title:'Source '+ref}))
 const id=JSON.parse(cache.pack(envelope({items:values}))).result_id
 let offset=0,seen:any[]=[]
 do{const page=JSON.parse(cache.read({result_id:id,path:'/items',offset}));seen.push(...page.content.map((r:any)=>r.value));offset=page.next_offset}while(offset!==null)
 assert.deepEqual(seen,values)
 const data=Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,'x'.repeat(100)]))
 const objectId=JSON.parse(cache.pack(envelope(data))).result_id
 offset=0;let keys:string[]=[]
 do{const page=JSON.parse(cache.read({result_id:objectId,offset}));assert.ok(JSON.stringify(page).length<4500);keys.push(...page.content.map((r:any)=>r.key));offset=page.next_offset}while(offset!==null)
 assert.deepEqual(keys,Object.keys(data))
})
test('bounded cache eviction, source errors and JSON-pointer escaping are explicit',()=>{
 const cache=new McpResults(),raw=JSON.stringify({isError:true,content:[{type:'text',text:JSON.stringify({'a/b~c':'z'.repeat(5000)})}]})
 const first=JSON.parse(cache.pack(raw));assert.equal(first.isError,true)
 assert.equal(JSON.parse(cache.read({result_id:first.result_id,path:'/a~1b~0c'})).content,'z'.repeat(2800))
 for(let i=0;i<8;i++)cache.pack(raw)
 assert.throws(()=>cache.read({result_id:first.result_id}),/expired/)
 assert.throws(()=>cache.pack('x'.repeat(180001)),/exceeds/)
})
test('only complete text envelopes unwrap; arbitrary structured output is preserved',()=>{
 assert.equal(unwrapMcpText('[{"type":"text","text":"Hallo"}]'),'Hallo')
 assert.equal(unwrapMcpText('{"content":[{"type":"text","text":"Hallo"}]}'),'Hallo')
 for(const raw of ['{"task":"hello"}','[{"type":"text","text":"x","ref":1}]','[{"type":"image","data":"x"}]','Normal prose'])assert.equal(unwrapMcpText(raw),raw)
})

test('Atlas link checks use only real response refs and URLs, never a guessed docs slug',async()=>{
 const {McpEvidence}=await import('../../src/shared/mcp/evidence.ts')
 const evidence=new McpEvidence()
 evidence.observe(envelope({items:[{ref:31259,title:'SOP',url:'https://aj-atlas.com/docs/real-source'}]}),'https://aj-atlas.com')
 assert.deepEqual(evidence.check('[SOP](https://aj-atlas.com/r/31259) https://aj-atlas.com/docs/real-source'),[])
 assert.deepEqual(evidence.check('https://aj-atlas.com/docs/invented https://aj-atlas.com/r/999'),['https://aj-atlas.com/docs/invented','https://aj-atlas.com/r/999'])
 assert.deepEqual(evidence.check('https://unrelated.example/anything'),[])
 assert.match(evidence.hint(),/\/r\/<actual numeric ref/)
 assert.deepEqual(new McpEvidence().check('https://aj-atlas.com/r/31259'),[])
})
