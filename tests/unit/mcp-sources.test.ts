import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverMcpTools,taskMcpDiscoveryQuery} from '../../src/shared/mcp/discovery.ts'
import {McpResults,McpResultSession,McpCacheCapacityError,packObservedMcpResult,unwrapMcpText} from '../../src/shared/mcp/results.ts'
const tools=['atlas_get','atlas_get_details','atlas_search','atlas_query','atlas_project_list','atlas_delete','atlas_whoami'].map(name=>({name,description:name==='atlas_search'?'Search records by q':'Generic tool'}))
test('Atlas topic/date discovery finds general read tools without requiring topic words in schemas',()=>{
 assert.equal(discoverMcpTools(tools,'atlas document lab notebook')[0]?.name,'atlas_search')
 assert.equal(discoverMcpTools(tools,'atlas work items last week')[0]?.name,'atlas_query')
 assert.equal(discoverMcpTools(tools,'Testdokument 35854')[0]?.name,'atlas_get')
 assert.equal(discoverMcpTools(tools,'record /r/31259')[0]?.name,'atlas_get')
 assert.deepEqual(discoverMcpTools(tools,'atlas_get_details').map(t=>t.name),['atlas_get_details'])
 assert.deepEqual(discoverMcpTools(tools,'atlas whoami').map(t=>t.name),['atlas_whoami'])
 assert.ok(!discoverMcpTools(tools.filter(t=>t.name!=='atlas_search'),'atlas document notebook').some(t=>t.name==='atlas_search'))
 assert.equal(discoverMcpTools([{name:'calendar_list',description:'list calendars'}],'atlas document notebook').length,0)
})
const envelope=(v:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(v)}]})
test('generic discovery finds a named connection and keeps identical functions on their requested server',()=>{
 const catalog=[{server:'crm',name:'find',description:'Find contacts'},{server:'calendar',name:'find',description:'Find events'},{server:'calendar',name:'create',description:'Create event'},{server:'work-calendar',name:'find',description:'Find work events'}]
 assert.deepEqual(discoverMcpTools(catalog,'calendar').map(t=>t.server),['calendar','calendar'])
 assert.deepEqual(discoverMcpTools(catalog,'calendar find'),[catalog[1]])
 assert.deepEqual(discoverMcpTools(catalog,'work-calendar find'),[catalog[3]])
 assert.deepEqual(discoverMcpTools(catalog,'crm contacts'),[catalog[0]])
 assert.deepEqual(discoverMcpTools(catalog,'mcp tools'),catalog)
 assert.deepEqual(discoverMcpTools([], 'calendar'),[])
 assert.deepEqual(discoverMcpTools(catalog,'unavailable_service'),[])
 assert.deepEqual(discoverMcpTools(catalog,'atlas_get'),[])
 const bounded=Array.from({length:10},(_,i)=>({server:'crm',name:'tool_'+i}))
 assert.equal(discoverMcpTools(bounded,'crm').length,6)
})
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
test('duplicate sources retain their handle; source errors and JSON-pointer escaping are explicit',()=>{
 const cache=new McpResults(),raw=JSON.stringify({isError:true,content:[{type:'text',text:JSON.stringify({'a/b~c':'z'.repeat(5000)})}]})
 const first=JSON.parse(cache.pack(raw));assert.equal(first.isError,true)
 assert.equal(JSON.parse(cache.read({result_id:first.result_id,path:'/a~1b~0c'})).content,'z'.repeat(2800))
 for(let i=0;i<64;i++)cache.pack(raw)
 assert.equal(JSON.parse(cache.pack(raw)).result_id,first.result_id)
 assert.equal(JSON.parse(cache.catalogue()).total,1)
 assert.equal(JSON.parse(cache.read({result_id:first.result_id})).isError,true)
 assert.throws(()=>cache.pack('x'.repeat(8*1024*1024+1)),/exceeds/)
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

test('empty inferred-kind searches require one broader read without altering original arguments',async()=>{
 const {McpEvidence}=await import('../../src/shared/mcp/evidence.ts')
 const evidence=new McpEvidence(),args={q:'Laborbuch',kind:'document',project:'flux-client',tenant:'analytik-jena'}
 evidence.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:args})
 assert.deepEqual(evidence.emptySearch(),{server:'aj-atlas',tool:'atlas_search',filter:'document'})
 assert.equal(args.kind,'document')
 evidence.observe(envelope({items:[{ref:31259}]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:{q:args.q,project:args.project,tenant:args.tenant}})
 assert.equal(evidence.emptySearch(),null)
 evidence.observe(envelope({rows:[],count:0}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_query',arguments:{aql:'kind = work AND updated >= -7d'}})
 assert.equal(evidence.emptySearch()?.filter,'AQL kind filter')
 evidence.observe(envelope({rows:[],count:0}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_query',arguments:{aql:'updated >= -7d'}})
 assert.equal(evidence.emptySearch(),null)
})

test('an empty composite topic triggers one bounded keyword check while single terms and successful searches do not',async()=>{
 const {McpEvidence}=await import('../../src/shared/mcp/evidence.ts')
 const evidence=new McpEvidence(),args={q:'FeliX Laborbuch',project:'flux-part-felix',tenant:'analytik-jena'}
 evidence.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:args})
 assert.deepEqual(evidence.emptySearch(),{server:'aj-atlas',tool:'atlas_search',filter:'topic phrase',query:'FeliX Laborbuch'})
 assert.equal(args.project,'flux-part-felix');assert.equal(args.q,'FeliX Laborbuch')
 evidence.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:{...args,q:'Laborbuch'}})
 assert.equal(evidence.emptySearch(),null)
 evidence.observe(envelope({items:[{ref:31259}]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:args})
 assert.equal(evidence.emptySearch(),null)
})


test('a product subproject fallback names only a verified same-server parent and preserves the original project',async()=>{
 const {McpEvidence}=await import('../../src/shared/mcp/evidence.ts')
 const e=new McpEvidence(),args={q:'Laborbuch',project:'flux-part-felix',tenant:'analytik-jena'}
 e.directory('aj-atlas',[{slug:'flux-part-felix',parentSlug:'flux-client'}])
 e.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:args})
 assert.deepEqual(e.emptySearch(),{server:'aj-atlas',tool:'atlas_search',filter:'project with verified parent',project:'flux-part-felix',parent:'flux-client'})
 assert.equal(args.project,'flux-part-felix')
 e.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'other',name:'atlas_search',arguments:args});assert.equal(e.emptySearch(),null)
 e.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:{...args,project:'flux-client'}});assert.equal(e.emptySearch(),null)
})


test('non-empty Atlas source facts survive paging and contradict false global absence without inventing content',async()=>{
 const {McpEvidence}=await import('../../src/shared/mcp/evidence.ts')
 const e=new McpEvidence(),rows=Array.from({length:39},(_,i)=>({ref:574+i,title:'Verified source '+i,project:'flux-client',summary:'Actual source summary '+i}))
 e.observe(envelope({items:rows}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:{q:'Laborbuch',project:'flux-client'}})
 assert.equal(e.searchResult()?.count,39);assert.equal(e.searchResult()?.records.length,3)
 assert.equal(e.contradictsSearch('Es wurden keine FeliX-Dokumente zum Laborbuch gefunden.')?.records[0].ref,574)
 assert.equal(e.contradictsSearch('No matching documents were found.')?.count,39)
 assert.equal(e.contradictsSearch('Drei verwandte Quellen im Elternprojekt wurden gefunden.'),null)
 assert.equal(e.contradictsSearch('Keine Dokumente im Teilprojekt. Verwandte Quelle: https://aj-atlas.com/r/574'),null)
 assert.equal(e.contradictsSearch('Keine weiteren Dokumente gefunden.'),null)
 e.observe(envelope({items:[]}),'https://aj-atlas.com',{server:'aj-atlas',name:'atlas_search',arguments:{q:'narrow'}})
 assert.equal(e.searchResult()?.count,0);assert.equal(e.contradictsSearch('Keine Ergebnisse gefunden.')?.count,39)
 assert.equal(new McpEvidence().contradictsSearch('Keine Ergebnisse gefunden.'),null)
})


test('fixed programs restore the fresh bounded MCP response instead of generating from a paging overview',()=>{
 const cache=new McpResults(),body='SOURCE START '+('a'.repeat(7000))+' SOURCE END',raw=envelope({item:{ref:42,body}})
 const packed=JSON.parse(cache.pack(raw));assert.equal(typeof packed.result_id,'string');assert(!JSON.stringify(packed).includes('SOURCE END'))
 const decorated=JSON.stringify({...packed,oneObservedFacts:{refs:[42],outcome:'ok'},oneSourceLinks:'https://atlas.example/r/42'})
 const full=JSON.parse(cache.materialize(decorated));assert.equal(JSON.parse(full.content[0].text).item.body,body);assert.deepEqual(full.oneObservedFacts,{refs:[42],outcome:'ok'});assert.equal(full.oneSourceLinks,'https://atlas.example/r/42')
 assert.equal(cache.materialize(envelope({item:{ref:7}})),envelope({item:{ref:7}}))
 assert.throws(()=>new McpResults().materialize(decorated),/expired/);assert.throws(()=>cache.pack('x'.repeat(8*1024*1024+1)),/bounded source cache/)
})


test('only a bare catalogue request resolves from an explicit trusted Atlas record reference',()=>{
 assert.equal(taskMcpDiscoveryQuery('Read AJ-Atlas Record Ref 36029. Only read.','atlas'),'atlas_get')
 assert.equal(taskMcpDiscoveryQuery('Lies Atlas Datensatz #42 und zeige den Widerspruch.','AJ-Atlas'),'atlas_get')
 for(const query of ['atlas_whoami','atlas_agent_list','atlas_search','atlas requirement'])assert.equal(taskMcpDiscoveryQuery('Read Atlas Ref 42.',query),query)
 for(const goal of ['Search Atlas for documents.','Analyse Ref 42 in ONE.','Atlas: explain the example "Record Ref 42".'])assert.equal(taskMcpDiscoveryQuery(goal,'atlas'),'atlas')
})

test('retained section lookup reads actual target windows, preserves gaps and blocks whole-body replacements',()=>{
 const cache=new McpResults(),body='# Source\n'+('Introduction\n'.repeat(800))+'\n## AC-17 Transport\nThe Type field shall carry the number.\n\n## AC-20 Other\nOther criteria.\n'
 const id=JSON.parse(cache.pack(envelope({item:{ref:42,body}}))).result_id
 assert(cache.unreadBody(42));assert.equal(cache.missingSections('Replace AC-17 in /r/42.').length,1)
 const first=JSON.parse(cache.read({result_id:id,path:'/item/body'}));assert.equal(first.offset,0)
 assert.equal(cache.missingSections('Replace AC-17 in /r/42.').length,1)
 const found=JSON.parse(cache.find({result_id:id,path:'/item/body',query:'AC-17'}))
 assert.equal(found.matchesReturned,1);assert.match(found.matches[0].content,/The Type field shall carry/)
 assert.deepEqual(cache.missingSections('Replace AC-17 in /r/42.'),[])
 assert(cache.unreadBody(42),'A target excerpt must not count as a whole-body read')
 assert.throws(()=>cache.find({result_id:id,path:'/item',query:'AC-17'}),/text field/)
 assert.throws(()=>cache.find({result_id:id,path:'/__proto__',query:'AC-17'}),/not found/)
 assert.throws(()=>new McpResults().find({result_id:id,path:'/item/body',query:'AC-17'}),/expired/)
 let offset=0;do{const p=JSON.parse(cache.read({result_id:id,path:'/item/body',offset}));offset=p.next_offset}while(offset!==null)
 assert(!cache.unreadBody(42))
})


test('more than 64 responses and 24 MiB preserve the first source and the complete registry',()=>{
 const cache=new McpResults();let first=''
 for(let ref=1;ref<=100;ref++){
  const page=JSON.parse(cache.pack(envelope({item:{ref,title:'Source '+ref,body:'é'.repeat(150000)}})))
  if(ref===1)first=page.result_id
 }
 assert.equal(JSON.parse(cache.read({result_id:first,path:'/item/body'})).content,'é'.repeat(2800))
 const refs:number[]=[];let offset:number|null=0
 do{const page=JSON.parse(cache.catalogue({offset}));refs.push(...page.items.map((x:any)=>x.source.metadata.ref));offset=page.next_offset;assert(page.retainedBytes>24*1024*1024)}while(offset!==null)
 assert.deepEqual(refs,Array.from({length:100},(_,i)=>i+1))
 assert.equal(JSON.parse(cache.catalogue({query:'Source 100'})).items.length,1)
})
test('a full cache refuses only the new source and keeps every existing handle',()=>{
 const cache=new McpResults({bytes:16000,entries:2,pageChars:3000})
 const first=JSON.parse(cache.pack(envelope({item:{ref:1,body:'a'.repeat(5000)}}))).result_id
 cache.pack(envelope({item:{ref:2,body:'b'.repeat(5000)}}))
 assert.throws(()=>cache.pack(envelope({item:{ref:3,body:'c'.repeat(5000)}})),McpCacheCapacityError)
 assert.equal(JSON.parse(cache.catalogue()).total,2)
 assert.equal(JSON.parse(cache.read({result_id:first,path:'/item/body'})).content,'a'.repeat(2800))
})
test('conversation source handles survive continuation, but not scope changes or new conversations',()=>{
 const session=new McpResultSession(),cache=session.get('workspace:user:access-a')
 const id=JSON.parse(cache.pack(envelope({item:{ref:42,title:'Design',body:'🦆"\\'.repeat(10000)}}))).result_id
 assert.equal(session.get('workspace:user:access-a'),cache)
 let offset:number|null=0,restored=''
 do{const page=JSON.parse(cache.read({result_id:id,path:'/item/body',offset}));assert(JSON.stringify(page).length<=12000);restored+=page.content;offset=page.next_offset}while(offset!==null)
 assert.equal(restored,'🦆"\\'.repeat(10000));assert(!cache.unreadBody(42))
 cache.resetCoverage();cache.pack(envelope({item:{ref:42,title:'Design',body:'🦆"\\'.repeat(10000)}}));assert(cache.unreadBody(42))
 assert.throws(()=>session.get('workspace:user:access-b').read({result_id:id}),/expired/)
 session.clear();assert.equal(JSON.parse(session.get('workspace:user:access-a').catalogue()).total,0)
})

test('source storage exhaustion never reclassifies an accepted write as failed',()=>{
 const cache=new McpResults({bytes:10000,entries:1,pageChars:3000})
 const first=JSON.parse(cache.pack(envelope({item:{ref:1,body:'a'.repeat(5000)}}))).result_id
 const written=envelope({item:{ref:2,body:'saved'.repeat(1000)}})
 const write=packObservedMcpResult(cache,written,false,false)
 assert(write.sourceError);assert.equal(JSON.parse(write.packed).isError,false)
 assert.equal(JSON.parse(write.packed).oneSourceUnavailable,true)
 assert.match(JSON.parse(write.packed).note,/do not repeat writes/)
 assert.equal(JSON.parse(packObservedMcpResult(cache,written,true,false).packed).isError,true)
 assert(JSON.parse(cache.read({result_id:first,path:'/item/body'})).content)
})
