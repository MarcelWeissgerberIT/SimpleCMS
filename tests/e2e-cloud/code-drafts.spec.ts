import {test,expect,api,email,signIn,newPerson,openApp,waitOnline,cloudStatus,wsEval,gotoPage,createWorkspace,join} from './fixtures'
import {citation,analysisFixture} from '../e2e/helpers/codeAnalysisStory.mjs'
import type {Page} from '@playwright/test'

const reference={server:'aj-atlas',repoName:'protocol-service',citation,finding:'Bound the device wait.',highlight:[5,6]}
const fixture=()=>({format:'one-code-change',version:1,id:'team-change',origin:{analysis:'a',revision:'r',finding:'f',title:'Bound device wait'},references:[reference],files:[{id:'file-0',reference,before:['Validate(request);','InvokeDevice(request);'],checkedAt:1793966400000}],proposals:[],accepted:null,deliveries:[],remote:[]})
const region=(p:Page)=>p.getByRole('region',{name:'Code change',exact:true})
async function saved(p:Page,id:string){return wsEval(p,(s,id)=>JSON.parse(s.pages[id].content.content.find((n:any)=>n.attrs?.language==='code-change').content[0].text),id)}
async function team(a:Page,context:any){
  await signIn(a,email('draft-owner'))
  const ws=await createWorkspace(a,'Code review team')
  await openApp(a,ws);await waitOnline(a)
  const id=await wsEval(a,(s,raw)=>s.createPage({title:'Shared code review',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'shared-patch',language:'code-change'},content:[{type:'text',text:raw}]},{type:'paragraph'}]}}),JSON.stringify(fixture()))
  const b=await newPerson(context)
  await signIn(b,email('draft-member'));await join(a,b,ws)
  await openApp(b,ws);await waitOnline(b)
  await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
  for(const p of [a,b]){await gotoPage(p,id);await expect(region(p).getByLabel('Replacement range')).toBeVisible()}
  return {b,id,ws}
}

test('private working copy survives page navigation, appears in overview and only explicit save reaches colleagues',async({page:a,context})=>{
  const {b,id}=await team(a,context)
  await region(a).getByLabel('Requested change').fill('Keep my private instruction')
  await region(a).getByLabel('Replacement range').fill('Validate(request);\nInvokeWithTimeout(request);')
  await expect(region(b).getByLabel('Replacement range')).toHaveValue('Validate(request);\nInvokeDevice(request);')
  expect((await saved(a,id)).proposals).toHaveLength(0)
  await a.evaluate(()=>{location.hash='#/home'})
  await a.getByRole('button',{name:'Work overview',exact:true}).click()
  await expect(a.getByRole('dialog').getByText('Your unsaved working copy',{exact:true})).toBeVisible()
  await a.getByRole('button',{name:'Open working copy',exact:true}).click()
  await expect(region(a).getByLabel('Requested change')).toHaveValue('Keep my private instruction')
  await expect(region(a).getByLabel('Replacement range')).toHaveValue('Validate(request);\nInvokeWithTimeout(request);')
  await region(a).getByRole('button',{name:'Save edited proposal',exact:true}).click()
  await expect.poll(async()=>(await saved(b,id)).proposals.length).toBe(1)
  await expect(region(b).getByLabel('Replacement range')).toHaveValue('Validate(request);\nInvokeWithTimeout(request);')
  await expect(region(a).getByRole('complementary',{name:'Your unsaved working copy'})).toHaveCount(0)
})

test('a colleague saving during a private edit preserves both versions and blocks stale replacement',async({page:a,context},info)=>{
  const {b,id}=await team(a,context)
  await region(a).getByLabel('Replacement range').fill('Validate(request);\nMyPrivateEdit(request);')
  await region(b).getByLabel('Replacement range').fill('Validate(request);\nColleagueEdit(request);')
  await region(b).getByRole('button',{name:'Save edited proposal',exact:true}).click()
  await expect(region(a).getByText('The shared proposal has changed',{exact:true})).toBeVisible()
  await expect(region(a).getByRole('button',{name:'Save edited proposal',exact:true})).toHaveCount(0)
  await region(a).getByText('Inspect previous working copy',{exact:true}).click()
  await expect(region(a).locator('pre')).toContainText('MyPrivateEdit')
  await expect.poll(async()=>(await saved(a,id)).proposals.length).toBe(1)
  expect((await saved(a,id)).proposals[0].edits[0].after[1]).toBe('ColleagueEdit(request);')
  for(const theme of ['light','dark'])for(const width of [1440,390]){
    await a.setViewportSize({width,height:width===390?844:900})
    await wsEval(a,(s,theme)=>s.updateSettings({theme}),theme)
    await expect(a.locator('html')).toHaveAttribute('data-theme',theme)
    if(width===390)await expect(a.locator('.app')).toHaveAttribute('data-mobile','true')
    await region(a).scrollIntoViewIfNeeded()
    expect(await region(a).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
    await region(a).screenshot({path:info.outputPath(`draft-conflict-${theme}-${width}.png`),animations:'disabled'})
  }
  await a.setViewportSize({width:1440,height:900})
  await a.evaluate(()=>{location.hash='#/home'});await gotoPage(a,id)
  await expect(region(a).getByText('The shared proposal has changed',{exact:true})).toBeVisible()
  const download=a.waitForEvent('download')
  await region(a).getByRole('button',{name:'Download unsaved working copy'}).click()
  expect((await download).suggestedFilename()).toBe('one-unapplied-code-draft.json')
  await region(a).getByRole('button',{name:'Discard working copy',exact:true}).click()
  await expect(region(a).getByLabel('Replacement range')).toHaveValue('Validate(request);\nColleagueEdit(request);')
  await expect.poll(async()=>(await saved(a,id)).proposals.length).toBe(1)
})

test('revoking write permission clears private drafts and prevents saving after promotion without fresh edits',async({page:a,context})=>{
  const {b,id,ws}=await team(a,context)
  await region(b).getByLabel('Replacement range').fill('Validate(request);\nPrivateBeforeRevocation(request);')
  const user=(await api<{user:{id:string}}>(b,'GET','/api/me')).json.user.id
  expect((await api(a,'PATCH',`/api/workspaces/${ws}/members/${user}`,{role:'viewer'})).status).toBe(200)
  await expect(region(b).getByLabel('Replacement range')).toBeDisabled()
  await expect(region(b).getByRole('complementary',{name:'Your unsaved working copy'})).toHaveCount(0)
  await expect(region(b).getByLabel('Replacement range')).toHaveValue('Validate(request);\nInvokeDevice(request);')
  expect((await saved(a,id)).proposals).toHaveLength(0)
  expect((await api(a,'PATCH',`/api/workspaces/${ws}/members/${user}`,{role:'member'})).status).toBe(200)
  await expect(region(b).getByLabel('Replacement range')).toBeEnabled()
  await expect(region(b).getByRole('button',{name:'Save edited proposal',exact:true})).toBeDisabled()
})

test('two disconnected reviewers saving at the same time retain both proposals after reconnect',async({page:a,context})=>{
  const {b,id}=await team(a,context)
  await region(a).getByLabel('Replacement range').fill('Validate(request);\nReviewByAda(request);')
  await region(b).getByLabel('Replacement range').fill('Validate(request);\nReviewByBob(request);')
  await Promise.all([a.context().setOffline(true),b.context().setOffline(true)])
  await Promise.all([a,b].map(p=>expect.poll(()=>cloudStatus(p),{timeout:20000}).not.toBe('online')))
  await Promise.all([region(a).getByRole('button',{name:'Save edited proposal',exact:true}).click(),region(b).getByRole('button',{name:'Save edited proposal',exact:true}).click()])
  await Promise.all([a.context().setOffline(false),b.context().setOffline(false)])
  await Promise.all([waitOnline(a),waitOnline(b)])
  const proposals=(p:Page)=>wsEval(p,(s,id)=>s.pages[id].content.content.filter((n:any)=>n.attrs?.language==='code-change').flatMap((n:any)=>JSON.parse(n.content[0].text).proposals.map((p:any)=>p.edits[0].after[1])).sort(),id)
  for(const p of [a,b])await expect.poll(()=>proposals(p)).toEqual(['ReviewByAda(request);','ReviewByBob(request);'])
  for(const p of [a,b]){
    await expect(region(p)).toHaveCount(2)
    await expect(region(p).first().getByRole('alert')).toContainText('Several saved copies')
    await expect(region(p).first().getByRole('button',{name:'Verify sources and accept proposal',exact:true})).toBeDisabled()
    await expect(region(p).first().getByRole('button',{name:'Save code proposal in Atlas',exact:true})).toBeDisabled()
  }
})

test('undoing a complete code proposal leaves a colleagues paragraph untouched and redo restores valid JSON',async({page:a,context})=>{
  const {b,id}=await team(a,context)
  await region(a).getByLabel('Replacement range').fill('Validate(request);\nUndoableChange(request);')
  await region(a).getByRole('button',{name:'Save edited proposal',exact:true}).click()
  await expect.poll(async()=>(await saved(b,id)).proposals.length).toBe(1)
  const paragraph=b.locator(`.ProseMirror[data-page-id="${id}"] > p`).last()
  await paragraph.click();await b.keyboard.type('A colleague keeps this note.')
  await expect.poll(()=>wsEval(a,(s,id)=>s.pages[id].plain,id)).toContain('A colleague keeps this note.')
  await a.locator(`.ProseMirror[data-page-id="${id}"] > p`).last().click()
  await a.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z')
  await expect.poll(async()=>(await saved(a,id)).proposals.length).toBe(0)
  await expect.poll(()=>wsEval(a,(s,id)=>s.pages[id].plain,id)).toContain('A colleague keeps this note.')
  await a.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z')
  for(const p of [a,b])await expect.poll(async()=>(await saved(p,id)).proposals[0]?.edits[0].after[1]).toBe('UndoableChange(request);')
})

test('concurrent review statuses keep two readable analysis reports instead of interleaving JSON',async({page:a,context})=>{
  const {b}=await team(a,context)
  const id=await wsEval(a,(s,raw)=>s.createPage({title:'Concurrent findings',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'review-report',language:'code-analysis'},content:[{type:'text',text:raw}]}]}}),JSON.stringify(analysisFixture(true)))
  await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
  for(const p of [a,b]){await gotoPage(p,id);await p.getByRole('tab',{name:'Findings',exact:true}).click()}
  await Promise.all([a.context().setOffline(true),b.context().setOffline(true)])
  await Promise.all([a,b].map(p=>expect.poll(()=>cloudStatus(p),{timeout:20000}).not.toBe('online')))
  await Promise.all([a.getByLabel('Review status').selectOption('reviewed'),b.getByLabel('Review status').selectOption('resolved')])
  for(const [p,status] of [[a,'reviewed'],[b,'resolved']] as const)await expect.poll(()=>wsEval(p,(s,id)=>JSON.parse(s.pages[id].content.content.find((n:any)=>n.attrs?.language==='code-analysis').content[0].text).revisions[0].report.findings[0].status,id)).toBe(status)
  await Promise.all([a.context().setOffline(false),b.context().setOffline(false)])
  await Promise.all([waitOnline(a),waitOnline(b)])
  for(const p of [a,b])await expect.poll(()=>wsEval(p,(s,id)=>s.pages[id].content.content.filter((n:any)=>n.attrs?.language==='code-analysis').map((n:any)=>JSON.parse(n.content[0].text).revisions[0].report.findings[0].status).sort(),id)).toEqual(['resolved','reviewed'])
})

test('concurrent source-reference notes remain separate valid citations',async({page:a,context})=>{
  const {b}=await team(a,context)
  const id=await wsEval(a,(s,raw)=>s.createPage({title:'Reference review',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'citation-note',language:'atlas-code'},content:[{type:'text',text:raw}]}]}}),JSON.stringify(reference))
  await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
  for(const [p,name] of [[a,'Ada annotation'],[b,'Bob annotation']] as const){await gotoPage(p,id);await p.getByRole('button',{name:'Edit reference',exact:true}).click();await p.getByLabel('Finding / note').fill(name)}
  await Promise.all([a.context().setOffline(true),b.context().setOffline(true)])
  await Promise.all([a,b].map(p=>expect.poll(()=>cloudStatus(p),{timeout:20000}).not.toBe('online')))
  await Promise.all([a.getByRole('button',{name:'Save reference',exact:true}).click(),b.getByRole('button',{name:'Save reference',exact:true}).click()])
  await Promise.all([a.context().setOffline(false),b.context().setOffline(false)])
  await Promise.all([waitOnline(a),waitOnline(b)])
  for(const p of [a,b])await expect.poll(()=>wsEval(p,(s,id)=>s.pages[id].content.content.filter((n:any)=>n.attrs?.language==='atlas-code').map((n:any)=>JSON.parse(n.content[0].text).finding).sort(),id)).toEqual(['Ada annotation','Bob annotation'])
})

test('concurrent UI contracts remain complete and editable after reconnect',async({page:a,context})=>{
  const {b}=await team(a,context)
  const markdown='# Team UI\n\n<!-- ui-component:C001:start -->\n# Button\nKomponenten-ID: C001\n\nUse One styling.\n<!-- ui-component:C001:end -->\n\n<!-- ui-manifest:start -->\n```json\n'+JSON.stringify({version:1,definitions:[{id:'C001',name:'Button',kind:'Button',evidence:'dom'}],trees:[{id:'T1',name:'Main',width:1440,nodes:[{id:'N1',componentId:'C001',parentId:null,label:'Save'}]}]})+'\n```\n<!-- ui-manifest:end -->'
  const raw=JSON.stringify({format:'component-studio-project',version:1,settings:{project:'Team UI'},markdown})
  const id=await wsEval(a,(s,raw)=>s.createPage({title:'Contract review',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'ui-contract',language:'ui-instructions'},content:[{type:'text',text:raw}]}]}}),raw)
  await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
  for(const [p,name] of [[a,'Ada rule'],[b,'Bob rule']] as const){await gotoPage(p,id);await p.getByLabel('Component contract').fill('# Button\nKomponenten-ID: C001\n\n'+name)}
  await Promise.all([a.context().setOffline(true),b.context().setOffline(true)])
  await Promise.all([a,b].map(p=>expect.poll(()=>cloudStatus(p),{timeout:20000}).not.toBe('online')))
  await Promise.all([a.getByRole('button',{name:'Save contract',exact:true}).click(),b.getByRole('button',{name:'Save contract',exact:true}).click()])
  await Promise.all([a.context().setOffline(false),b.context().setOffline(false)])
  await Promise.all([waitOnline(a),waitOnline(b)])
  for(const p of [a,b]){
    await expect.poll(()=>wsEval(p,(s,id)=>s.pages[id].content.content.filter((n:any)=>n.attrs?.language==='ui-instructions').map((n:any)=>JSON.parse(n.content[0].text).markdown.includes('Ada rule')?'Ada rule':'Bob rule').sort(),id)).toEqual(['Ada rule','Bob rule'])
    await expect(p.getByRole('region',{name:'UI Studio'})).toHaveCount(2)
  }
})
