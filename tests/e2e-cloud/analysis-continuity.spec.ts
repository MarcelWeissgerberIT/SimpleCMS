import {test,expect,api,email,signIn,newPerson,openApp,waitOnline,wsEval,gotoPage,createWorkspace,join} from './fixtures'
import {mockAgent,call,say,setKey} from '../e2e/helpers/terminal'
import {analysisFixture,analysisReport,citation} from '../e2e/helpers/codeAnalysisStory.mjs'
import type {Page,BrowserContext} from '@playwright/test'
const envelope=(data:unknown)=>({result:JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})})
const errors:string[]=[]
function watch(p:Page){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())})}
test.beforeEach(()=>{errors.length=0})
test.afterEach(()=>{expect(errors,'browser errors').toEqual([])})
const block=(p:Page)=>p.getByRole('region',{name:'Code analysis',exact:true})
const saved=(p:Page,id:string)=>wsEval(p,(s,id)=>JSON.parse(s.pages[id].content.content.find((n:any)=>n.attrs?.language==='code-analysis').content[0].text),id)
const stage=(i:number)=>[call('discover'+i,'one_mcp_search',{query:'atlas_code_read'}),call('read'+i,'one_mcp_call',{server:'aj-atlas',name:'atlas_code_read',arguments:{repo:citation.repo,snapshot:citation.snapshot,path:citation.path,startLine:5,endLine:6}}),say(JSON.stringify(analysisReport))]
async function setup(a:Page,context:BrowserContext){
 watch(a);await signIn(a,email('analysis-owner'));const ws=await createWorkspace(a,'Analysis review team');await openApp(a,ws);await waitOnline(a)
 const id=await wsEval(a,(s,raw)=>s.createPage({title:'Shared analysis',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'live-analysis',language:'code-analysis'},content:[{type:'text',text:raw}]},{type:'paragraph'}]}}),JSON.stringify(analysisFixture()))
 const b=await newPerson(context);watch(b);await signIn(b,email('analysis-member'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 for(const p of [a,b]) await wsEval(p,s=>{s.setWorkspaceAI({onboarding:{startPageId:'fixture',mcpName:'aj-atlas',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',project:'FeliX',tenant:'analytik-jena',skipIntro:true}});s.updateSettings({workspaceMcpServers:[{id:'code-fixture',name:'aj-atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'test-token',enabled:true,prompt:'',tools:['atlas_code_repos','atlas_code_read','atlas_code_verify']}]})})
 await setKey(a)
 const calls:any[]=[]
 await a.route('**/api/workspaces/*/atlas-mcp',r=>{const v=r.request().postDataJSON();calls.push(v)
  if(v.action==='search')return r.fulfill({json:{tools:[{server:'aj-atlas',name:'atlas_code_read',description:'Read a pinned code excerpt.',readOnly:true,inputSchema:{type:'object',properties:{repo:{type:'string'},snapshot:{type:'string'},path:{type:'string'},startLine:{type:'number'},endLine:{type:'number'}},required:['repo','snapshot','path','startLine','endLine'],additionalProperties:false}}]}})
  if(v.name==='atlas_code_repos')return r.fulfill({json:envelope({items:[{id:'repo-a',name:'protocol-service',modelProcessing:true}],next:null})})
  if(v.name==='atlas_code_verify')return r.fulfill({json:envelope({valid:true,citation:v.arguments.citation})})
  return r.fulfill({json:envelope({citation,text:'Validate(request);\nInvokeDevice(request);'})})
 })
 for(const p of [a,b]){await gotoPage(p,id);await expect(block(p)).toBeVisible()}
 return {b,id,ws,calls}
}

test('four asynchronous phases stay synchronized and only a human accepts the shared analysis',async({page:a,context})=>{
 const {b,id,calls}=await setup(a,context)
 const mock=await mockAgent(context,[...stage(1),...stage(2),...stage(3),...stage(4)])
 await block(a).getByRole('button',{name:'Start analysis',exact:true}).click()
 for(const p of [a,b])await expect.poll(async()=>{const r=(await saved(p,id)).revisions[0];if(r?.state==='failed')throw Error(JSON.stringify(r));return r?.state},{timeout:50000}).toBe('ready')
 expect(mock.bodies).toHaveLength(12);expect((await saved(b,id)).active).toBeNull();expect((await saved(b,id)).revisions[0].completed).toHaveLength(4)
 expect(calls.every(c=>c.action==='search'||['atlas_code_repos','atlas_code_read','atlas_code_verify'].includes(c.name))).toBe(true)
 await block(b).getByRole('button',{name:'Accept version',exact:true}).click()
 await expect.poll(async()=>(await saved(a,id)).active).toBe((await saved(b,id)).revisions[0].id)
})

test('a colleague changing the task during a phase prevents late results from replacing it',async({page:a,context})=>{
 const {b,id}=await setup(a,context);let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const mock=await mockAgent(context,[...stage(1).slice(0,2),async()=>{await waiting;return say(JSON.stringify(analysisReport))()}])
 try{
  await block(a).getByRole('button',{name:'Start analysis',exact:true}).click();await expect.poll(()=>mock.bodies.length).toBe(3)
  await wsEval(b,(s,id)=>s.updatePage(id,{title:'Task changed by reviewer'}),id)
  await expect.poll(()=>wsEval(a,(s,id)=>s.pages[id].title,id)).toBe('Task changed by reviewer');release()
  await expect(block(a).getByRole('button',{name:'Stop',exact:true})).toHaveCount(0)
  for(const p of [a,b]){const v=await saved(p,id);expect(v.active).toBeNull();expect(v.revisions[0].completed).toEqual([])}
  expect(mock.bodies).toHaveLength(3)
 }finally{release()}
})

test('revoking write permission during a model response blocks late shared writes',async({page:a,context})=>{
 const {b,id,ws}=await setup(a,context)
 // Run as the member; only that context receives the synthetic model and Atlas routes.
 await setKey(b)
 await b.route('**/api/workspaces/*/atlas-mcp',r=>r.fulfill({json:envelope({items:[{id:'repo-a',name:'protocol-service',modelProcessing:true}],next:null})}))
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const mock=await mockAgent(b.context(),[async()=>{await waiting;return say(JSON.stringify(analysisReport))()}])
 try{
  await block(b).getByRole('button',{name:'Start analysis',exact:true}).click();await expect.poll(()=>mock.bodies.length).toBe(1)
  const member=(await api<{user:{id:string}}>(b,'GET','/api/me')).json.user.id
  expect((await api(a,'PATCH',`/api/workspaces/${ws}/members/${member}`,{role:'viewer'})).status).toBe(200)
  await expect(block(b).getByRole('button',{name:'Continue open phase',exact:true})).toBeDisabled()
  release();await expect(block(b).getByRole('button',{name:'Stop',exact:true})).toHaveCount(0)
  const v=await saved(a,id);expect(v.active).toBeNull();expect(v.revisions[0].completed).toEqual([]);expect(mock.bodies).toHaveLength(1)
 }finally{release()}
})
