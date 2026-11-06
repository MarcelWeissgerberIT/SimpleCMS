import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para} from './fixtures'
import {mockAgent,call,say,setKey} from './helpers/terminal'
import {analysisFixture,analysisReport,citation} from './helpers/codeAnalysisStory.mjs'
import type {Page} from '@playwright/test'
const envelope=(data:any)=>({result:JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})})
async function setup(page:Page,ready=false){
 await page.route('**/api/config',r=>r.fulfill({json:{version:'fixture',signup:{mode:'open',domains:[]},max_upload_mb:20,dev_mode:false,source_url:'',schema_min:6,supports:['ai','providers']}}))
 await page.route('**/api/session',r=>r.fulfill({json:{user:null,workspaces:[]}}))
 await page.route('**/api/workspaces/*/model-shares',r=>r.fulfill({json:[]}))
 await page.route('**/api/workspaces/*/central-ai',r=>r.fulfill({json:{assigned:false,ready:false}}))
 await openApp(page);await setKey(page)
 const id=await createPage(page,{title:'Protocol analysis',content:doc(para('Investigation with pinned evidence.'),{type:'codeBlock',attrs:{language:'code-analysis'},content:[{type:'text',text:JSON.stringify(analysisFixture(ready))}]},para(''))})
 await wsEval(page,s=>{s.setWorkspaceAI({onboarding:{startPageId:'fixture',mcpName:'aj-atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'FeliX',tenant:'analytik-jena',skipIntro:true}});s.updateSettings({workspaceMcpServers:[{id:'code-fixture',name:'aj-atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'test-token',enabled:true,prompt:'',tools:['atlas_code_repos','atlas_code_read','atlas_code_verify']}]})})
 await gotoPage(page,id)
 await page.evaluate(()=>(window as any).__oneCloud.set({active:{kind:'cloud',id:'analysis-fixture'},user:{id:'member-fixture',email:'test@example.test',name:'Test'},role:'owner',readOnly:false,supports:['atlas-mcp:1']}))
 await setKey(page)
 const calls:any[]=[]
 await page.route('**/api/workspaces/*/atlas-mcp',r=>{const b=r.request().postDataJSON();calls.push(b)
  if(b.action==='search')return r.fulfill({json:{tools:[{server:'aj-atlas',name:'atlas_code_read',description:'Read a pinned code excerpt.',readOnly:true,inputSchema:{type:'object',properties:{repo:{type:'string'},snapshot:{type:'string'},path:{type:'string'},startLine:{type:'number'},endLine:{type:'number'}},required:['repo','snapshot','path','startLine','endLine'],additionalProperties:false}}]}})
  if(b.name==='atlas_code_repos')return r.fulfill({json:envelope({items:[{id:'repo-a',name:'protocol-service',modelProcessing:true}],next:null})})
  if(b.name==='atlas_code_verify')return r.fulfill({json:envelope({valid:true,citation:b.arguments.citation})})
  return r.fulfill({json:envelope({citation,text:'Validate(request);\nInvokeDevice(request);'})})
 })
 return {id,calls,block:page.getByRole('region',{name:'Code analysis',exact:true})}
}
const stage=(i:number)=>[call('discover'+i,'one_mcp_search',{query:'atlas_code_read'}),call('read'+i,'one_mcp_call',{server:'aj-atlas',name:'atlas_code_read',arguments:{repo:citation.repo,snapshot:citation.snapshot,path:citation.path,startLine:5,endLine:6}}),say(JSON.stringify(analysisReport))]
const saved=(page:Page,id:string)=>wsEval(page,(s,id)=>JSON.parse(s.pages[id].content.content.find((n:any)=>n.attrs?.language==='code-analysis').content[0].text),id)
test('four phases save checkpoints and only acceptance activates the proposal',async({page,context})=>{
 const {id,block,calls}=await setup(page)
 const mock=await mockAgent(context,[...stage(1),...stage(2),...stage(3),...stage(4)])
 await block.getByRole('button',{name:'Start analysis',exact:true}).click()
 await expect.poll(async()=>{const a=await saved(page,id);const r=a.revisions[0];if(r?.state==='failed')throw Error(JSON.stringify(r));return r?.state},{timeout:50000}).toBe('ready')
 let a=await saved(page,id);expect(a.active).toBeNull();expect(a.revisions[0].completed).toHaveLength(4);expect(mock.bodies).toHaveLength(12)
 expect(calls.every(c=>c.action==='search'||['atlas_code_repos','atlas_code_read','atlas_code_verify'].includes(c.name))).toBe(true)
 await block.getByRole('button',{name:'Accept version',exact:true}).click();a=await saved(page,id);expect(a.active).toBe(a.revisions[0].id)
 await block.getByRole('tab',{name:'Findings',exact:true}).click();await expect(block).toContainText('Countercheck');await block.getByLabel('Review status').selectOption('reviewed');expect((await saved(page,id)).revisions[0].report.findings[0].status).toBe('reviewed')
})
test('malformed second phase preserves first checkpoint and resumes at investigation',async({page,context})=>{
 const {id,block}=await setup(page)
 await mockAgent(context,[...stage(1),...stage(2).slice(0,2),say('invalid JSON'),...stage(3),...stage(4),...stage(5)])
 await block.getByRole('button',{name:'Start analysis',exact:true}).click();await expect(block.getByRole('alert')).toContainText('result format',{timeout:40000})
 expect((await saved(page,id)).revisions[0].completed).toEqual(['scope'])
 await block.getByRole('button',{name:'Continue open phase',exact:true}).click();await expect(block.getByRole('button',{name:'Accept version'})).toBeVisible({timeout:40000});expect((await saved(page,id)).revisions).toHaveLength(1)
})
test('open and browse saved findings makes no model requests; flow links jump to evidence',async({page,aiNet})=>{
 const {block,calls}=await setup(page,true)
 await block.getByRole('tab',{name:'Flows',exact:true}).click();await block.getByRole('button',{name:'ProtocolHandler.cs:5–6'}).first().click();await expect(block.getByRole('tab',{name:'Evidence',exact:true})).toHaveAttribute('aria-selected','true')
 expect(calls).toHaveLength(0);expect(aiNet.count('anthropic')).toBe(0)
 await block.getByRole('button',{name:'Open code',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Validate(request)');await expect(page.locator('.ca__row[data-cur]')).toHaveCount(2)
})
test('new version preserves accepted result until explicitly accepted',async({page,context})=>{
 const {id,block}=await setup(page,true);await block.getByRole('button',{name:'Accept version'}).click()
 const old=(await saved(page,id)).active
 await mockAgent(context,[...stage(1),...stage(2),...stage(3),...stage(4)])
 await block.getByRole('button',{name:'Investigate new version'}).click();await expect(block.getByRole('button',{name:'Accept version'})).toBeVisible({timeout:40000})
 expect((await saved(page,id)).active).toBe(old);await block.getByRole('tab',{name:'Versions',exact:true}).click();await expect(block).toContainText('Unchanged');await block.getByRole('button',{name:'Accept version'}).click();expect((await saved(page,id)).active).not.toBe(old)
})
test('stopping preserves an incomplete version and blocks late output',async({page,context})=>{
 const {id,block}=await setup(page);let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const mock=await mockAgent(context,[...stage(1),async()=>{await waiting;return say(JSON.stringify(analysisReport))()}])
 await block.getByRole('button',{name:'Start analysis'}).click();await expect.poll(()=>mock.bodies.length).toBe(4)
 await block.getByRole('button',{name:'Stop',exact:true}).click();release();await expect(block.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0)
 const a=await saved(page,id);expect(a.revisions[0].state).toBe('paused');expect(a.revisions[0].completed).toEqual(['scope']);expect(a.active).toBeNull()
})
test('responsive findings use One light and dark themes',async({page},info)=>{
 const {block}=await setup(page,true);await block.getByRole('tab',{name:'Findings',exact:true}).click()
 for(const theme of ['light','dark'])for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await wsEval(page,(s,t)=>s.updateSettings({theme:t}),theme);await block.scrollIntoViewIfNeeded();expect(await block.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`analysis-${theme}-${width}.png`),animations:'disabled'})}
})
test('budget exhaustion preserves history without sending another paid request',async({page,context})=>{
 const {id,block}=await setup(page,true)
 await wsEval(page,(s,id)=>{const d=structuredClone(s.pages[id].content),n=d.content.find((n:any)=>n.attrs?.language==='code-analysis'),a=JSON.parse(n.content[0].text);a.revisions[0].completed=['scope'];a.revisions[0].state='paused';a.revisions[0].cost=5;n.content[0].text=JSON.stringify(a);s.setContent(id,d,'e2e')},id)
 const mock=await mockAgent(context,[])
 await block.getByRole('button',{name:'Continue open phase',exact:true}).click();await expect(block.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0)
 expect(mock.bodies).toHaveLength(0);expect((await saved(page,id)).revisions[0].completed).toEqual(['scope'])
})
test('revoked evidence cannot enter a resumed model request',async({page,context})=>{
 const {id,block}=await setup(page,true)
 await wsEval(page,(s,id)=>{const d=structuredClone(s.pages[id].content),n=d.content.find((n:any)=>n.attrs?.language==='code-analysis'),a=JSON.parse(n.content[0].text);a.revisions[0].completed=['scope'];a.revisions[0].state='paused';n.content[0].text=JSON.stringify(a);s.setContent(id,d,'e2e')},id)
 await page.route('**/api/workspaces/*/atlas-mcp',r=>r.fulfill({json:envelope({valid:false,error:'access revoked'})}))
 const mock=await mockAgent(context,[])
 await block.getByRole('button',{name:'Continue open phase',exact:true}).click();await expect(block.getByRole('alert')).toBeVisible()
 expect(mock.bodies).toHaveLength(0);expect((await saved(page,id)).revisions[0].state).toBe('failed')
})
test('source edits during a phase prevent stale result persistence',async({page,context})=>{
 const {id,block}=await setup(page);let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const mock=await mockAgent(context,[...stage(1).slice(0,2),async()=>{await waiting;return say(JSON.stringify(analysisReport))()}])
 await block.getByRole('button',{name:'Start analysis'}).click();await expect.poll(()=>mock.bodies.length).toBe(3)
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Changed investigation'}),id);release()
 await expect(block.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0)
 expect((await saved(page,id)).revisions[0].completed).toEqual([]);expect((await saved(page,id)).active).toBeNull()
})
test('revision budget stops the next model round without a workspace budget',async({page,context})=>{
 const {id,block}=await setup(page)
 // The first completed request alone exhausts this synthetic revision's allowance.
 const expensive=()=>call('discover','one_mcp_search',{query:'atlas_code_read'})().replace('"output_tokens":90','"output_tokens":1000000')
 const mock=await mockAgent(context,[expensive,say('must not be sent')])
 await block.getByRole('button',{name:'Start analysis',exact:true}).click()
 await expect(block.getByRole('alert')).toBeVisible({timeout:20000})
 expect(mock.bodies).toHaveLength(1);const a=await saved(page,id);expect(a.revisions[0].cost).toBeGreaterThan(5);expect(a.revisions[0].completed).toEqual([])
})
test('switching snapshots within a revision preserves the previous checkpoint',async({page,context})=>{
 const {id,block}=await setup(page)
 const changed=structuredClone(analysisReport);changed.evidence[0].reference.citation.snapshot='another-snapshot'
 await mockAgent(context,[...stage(1),...stage(2).slice(0,2),say(JSON.stringify(changed))])
 await block.getByRole('button',{name:'Start analysis',exact:true}).click()
 await expect(block.getByRole('alert')).toContainText('changed snapshots',{timeout:20000})
 const a=await saved(page,id);expect(a.revisions[0].completed).toEqual(['scope']);expect(a.revisions[0].report.evidence[0].reference.citation.snapshot).toBe('snapshot-a')
})
