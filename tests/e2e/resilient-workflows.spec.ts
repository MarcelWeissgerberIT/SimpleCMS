import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,MOD} from './fixtures'
import {mockAgent,call,say,setKey,terminal,prompt} from './helpers/terminal'

test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{schema_min:6}}));await page.route('**/api/session',r=>r.fulfill({json:{}}))})

test('an expired recovery keeps the work overview open and explains why nothing started',async({page,context})=>{
 await openApp(page);await setKey(page)
 const id=await createPage(page,{title:'Recovery source',content:doc(para('Saved source context'))});await gotoPage(page,id)
 const mock=await mockAgent(context,[say('A retained draft to inspect.')])
 await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('Analyse this source.');await prompt(page).press('Enter')
 await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 await page.reload()
 await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click()
 const d=page.getByRole('dialog',{name:'Work overview'}),shelf=d.locator('.term-saved-work')
 await expect(shelf.getByRole('button',{name:'Resume analysis',exact:true})).toBeVisible()
 // Another tab discards the checkpoint after this shelf has rendered.
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
  const request=indexedDB.open('one-mcp-work')
  request.onerror=()=>reject(request.error)
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put([],'rows');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}
 }))
 await shelf.getByRole('button',{name:'Resume analysis',exact:true}).click()
 await expect(d).toBeVisible()
 await expect(shelf.getByRole('alert')).toContainText('expired or was removed')
 expect(mock.bodies).toHaveLength(1)
})

test('resuming from the work overview opens the terminal; a trashed source blocks resumption without discarding the checkpoint',async({page,context})=>{
 await openApp(page);await setKey(page)
 const source=await createPage(page,{title:'Recoverable source',content:doc(para('Original source'))}),other=await createPage(page,{title:'Other page',content:doc(para('Unrelated work'))})
 await gotoPage(page,source)
 const mock=await mockAgent(context,[say('Saved source analysis.'),say('Resumed original analysis.')])
 await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('Analyse this source.');await prompt(page).press('Enter')
 await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 await page.reload();await gotoPage(page,other)
 await wsEval(page,(s,id)=>s.trashPage(id),source)
 await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click()
 const d=page.getByRole('dialog',{name:'Work overview'}),shelf=d.locator('.term-saved-work')
 await shelf.getByRole('button',{name:'Resume analysis',exact:true}).click()
 await expect(shelf.getByRole('alert')).toContainText('original source page is unavailable')
 await expect(shelf).toContainText('Analyse this source.')
 expect(mock.bodies).toHaveLength(1)
 await wsEval(page,(s,id)=>s.restorePage(id),source)
 await shelf.getByRole('button',{name:'Resume analysis',exact:true}).click()
 await expect(d).toHaveCount(0)
 await expect(terminal(page)).toBeVisible()
 await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 expect(mock.bodies).toHaveLength(2)
 expect(JSON.stringify(mock.bodies.at(-1))).toContain('Recoverable source')
})

test('work links select the proposed analysis revision and exact finding, also after reload',async({page,aiNet})=>{
 const {analysisFixture}=await import('./helpers/codeAnalysisStory.mjs')
 await openApp(page)
 const a=analysisFixture(true);a.active=a.revisions[0].id;a.revisions[0].state='accepted'
 const newer=structuredClone(a.revisions[0]);newer.id='new-revision';newer.state='ready';newer.report.findings[0].title='Finding in proposed revision';newer.report.findings[0].claim='Unique proposed claim';a.revisions.push(newer)
 const id=await createPage(page,{title:'Version target',content:doc({type:'codeBlock',attrs:{id:'version-target',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})});await gotoPage(page,id)
 const before=await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content.content.find((n:any)=>n.attrs?.id==='version-target')),id)
 const open=async()=>{await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click();const d=page.getByRole('dialog',{name:'Work overview'});await d.locator('article').filter({has:page.getByRole('heading',{name:'Finding in proposed revision',exact:true})}).getByRole('button',{name:'Open at source',exact:true}).click()}
 await open()
 const block=page.getByRole('region',{name:'Code analysis',exact:true})
 await expect(block.getByRole('tab',{name:'Findings',exact:true})).toHaveAttribute('aria-selected','true')
 await expect(block.locator('article').filter({hasText:'Unique proposed claim'})).toBeFocused()
 await expect(block.locator('.result-progress')).toHaveAttribute('data-phase','review')
 await block.getByRole('tab',{name:'Overview',exact:true}).click();await open()
 await expect(block.getByRole('tab',{name:'Findings',exact:true})).toHaveAttribute('aria-selected','true')
 await page.reload()
 await expect(block.locator('article').filter({hasText:'Unique proposed claim'})).toBeVisible()
 expect(await wsEval(page,(s,id)=>JSON.stringify(s.pages[id].content.content.find((n:any)=>n.attrs?.id==='version-target')),id)).toBe(before)
 expect(aiNet.count('anthropic')).toBe(0)
})


test('failed successor retains accepted findings and opens the accepted report from saved results',async({page})=>{
 const {analysisFixture}=await import('./helpers/codeAnalysisStory.mjs')
 const {newRevision}=await import('../../src/shared/codeAnalysis/model')
 const {inventory}=await import('../../src/app/features/ai/workflow/inventory')
 await openApp(page)
 const a=analysisFixture(true);a.active=a.revisions[0].id;a.revisions[0].state='accepted'
 const failed=newRevision(a,'failed-version');failed.state='failed';failed.error='Connection interrupted';a.revisions.push(failed)
 const content=doc({type:'codeBlock',attrs:{id:'accepted-target',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})
 const rows=inventory([{id:'test',title:'Source',content}],false)
 expect(rows.work.some(w=>w.kind==='finding'&&w.location?.revision===a.active)).toBe(true)
 expect(rows.completed[0].location?.revision).toBe(a.active)
 expect(rows.recipes).toHaveLength(1)
 const id=await createPage(page,{title:'Accepted source with failed successor',content});await gotoPage(page,id)
 const block=page.getByRole('region',{name:'Code analysis',exact:true})
 await block.getByRole('tab',{name:'Versions',exact:true}).click();await block.getByRole('button',{name:/V2/}).click()
 await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click()
 const d=page.getByRole('dialog',{name:'Work overview'})
 await d.getByText('Saved results · 1',{exact:true}).click();await d.getByRole('button',{name:'Open saved result',exact:true}).click()
 await expect(block.locator('.result-progress')).toHaveAttribute('data-phase','adopted')
 await expect(block.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true')
})

test('work links open the exact mock note, including notes outside the current filter',async({page,aiNet,errors},info)=>{
 errors.allow(/Blocked script execution.*sandboxed/)
 const {checkpointMock,mockVersionKey}=await import('../../src/shared/ai/mockReview')
 const {mockBlockData}=await import('../../src/shared/ai/mockBlock')
 const {packageFixture}=await import('./helpers/packageFreshness.mjs')
 await openApp(page)
 const m=checkpointMock(mockBlockData(packageFixture().spec),'Original')
 m.journal!.notes=['First note','Second note'].map((text,i)=>({id:'note-'+i,at:'2026-11-08',version:mockVersionKey(m.preview!),element:{path:'body',tag:'body',text:'Preview',component:'Preview',requirement:'',snippet:''},text,intent:'fix' as const,scope:'mock' as const,resolved:false,md:'none' as const}))
 const id=await createPage(page,{title:'Mock note destination',content:doc({type:'designMock',attrs:{id:'notes-target',spec:m},content:[para('Review notes')]})});await gotoPage(page,id)
 const block=page.locator('.mock-block')
 await block.getByRole('tab',{name:'Notes',exact:true}).click();await block.getByLabel('Filter notes').selectOption('review')
 await block.getByRole('tab',{name:'Mock',exact:true}).click()
 await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click()
 const d=page.getByRole('dialog',{name:'Work overview'})
 await d.locator('article').filter({has:page.getByRole('heading',{name:'Second note',exact:true})}).getByRole('button',{name:'Open at source',exact:true}).click()
 await expect(block.getByRole('tab',{name:'Notes',exact:true})).toHaveAttribute('aria-selected','true')
 await expect(block.locator('[data-work-item="note-1"]')).toBeFocused()
 await expect(block.getByLabel('Filter notes')).toHaveValue('all')
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height:width===390?844:900})
  if(width===390){
   await expect(page.locator('.app')).toHaveAttribute('data-mobile','true')
   await expect.poll(()=>page.locator('.sb').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(1)
  }else await expect(page.locator('.app')).not.toHaveAttribute('data-mobile')
  await block.locator('[data-work-item="note-1"]').scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath(`linked-note-${theme}-${width}.png`),animations:'disabled'})
 }
 expect(aiNet.count('anthropic')).toBe(0)
})

test('saved patch links open the accepted proposal and cannot replace unsaved edits',async({page})=>{
 const {setup}=await import('./helpers/codeChangeSetup')
 const {block}=await setup(page,true)
 await block.getByRole('tab',{name:'Findings',exact:true}).click();await block.getByRole('button',{name:'Create change',exact:true}).click()
 const change=page.getByRole('region',{name:'Code change',exact:true})
 await change.getByRole('checkbox').check();await change.getByRole('button',{name:'Load and save selected source ranges'}).click()
 await change.getByLabel('Replacement range').fill('Validate(request);\nAcceptedUI(request);')
 await change.getByRole('button',{name:'Save edited proposal'}).click();await change.getByRole('button',{name:'Verify sources and accept proposal'}).click()
 await expect(change.locator('.result-progress')).toHaveAttribute('data-phase','adopted')
 await change.getByLabel('Replacement range').fill('Validate(request);\nProposedUI(request);')
 await change.getByRole('button',{name:'Save edited proposal'}).click()
 const overview=async()=>{await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click();return page.getByRole('dialog',{name:'Work overview'})}
 const d=await overview();await d.getByText('Saved results · 1',{exact:true}).click();await d.getByRole('button',{name:'Open saved result',exact:true}).click()
 await expect(change.getByLabel('Replacement range')).toHaveValue('Validate(request);\nAcceptedUI(request);')
 await change.getByLabel('Replacement range').fill('Validate(request);\nMyUnsavedEdit(request);')
 const again=await overview();await again.locator('article').filter({hasText:'Review code changes'}).getByRole('button',{name:'Open at source',exact:true}).click()
 await expect(change).toContainText('This block has unsaved edits')
 await expect(change.getByLabel('Replacement range')).toHaveValue('Validate(request);\nMyUnsavedEdit(request);')
})

test('background work shows the active source read and returns to the original page without interrupting it',async({page,context},info)=>{
 const {setup}=await import('./helpers/codeChangeSetup')
 const {id:source}=await setup(page,true)
 await page.route('**/api/workspaces/*/programs/runs',r=>r.fulfill({json:{ok:true}}))
 const other=await createPage(page,{title:'Meeting page',content:doc(para('Independent work.'))})
 let release!:()=>void
 const held=new Promise<void>(r=>release=r)
 let reading=false
 await page.route('**/api/workspaces/*/atlas-mcp',async route=>{
  const body=route.request().postDataJSON()
  if(body.name==='atlas_code_read'){reading=true;await held}
  await route.fallback()
 })
 const mock=await mockAgent(context,[
  call('discover','one_mcp_search',{query:'atlas_code_read'}),
  call('read','one_mcp_call',{server:'aj-atlas',name:'atlas_code_read',arguments:{repo:'repo-a',snapshot:'snapshot-a',path:'src/ProtocolHandler.cs',startLine:5,endLine:6}}),
  say('The source read has completed.'),
 ])
 try{
  await gotoPage(page,source);await page.keyboard.press(`${MOD}+j`)
  await prompt(page).fill('Read this Atlas source only; make no changes.');await prompt(page).press('Enter')
  await expect.poll(()=>reading).toBe(true)
  await page.keyboard.press(`${MOD}+j`);await gotoPage(page,other)
  const dock=page.getByRole('region',{name:'Background AI task'})
  await expect(dock).toContainText('Read code');await expect(dock).toContainText('ProtocolHandler.cs')
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height:width===390?844:900})
   if(width===390)await expect(page.locator('.app')).toHaveAttribute('data-mobile','true')
   else await expect(page.locator('.app')).not.toHaveAttribute('data-mobile')
   if(width===390){
    await expect.poll(()=>page.locator('.sb').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(1)
    await expect.poll(async()=>{const fab=await page.getByTestId('capture-fab').boundingBox(),bar=await dock.boundingBox();return !!fab&&!!bar&&fab.y+fab.height<=bar.y}).toBe(true)
   }
   expect(await dock.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
   await page.screenshot({path:info.outputPath(`active-source-${theme}-${width}.png`),animations:'disabled'})
  }
  await dock.getByRole('button',{name:'Open task source',exact:true}).click()
  await expect(page).toHaveURL(new RegExp('#/p/'+source+'$'))
  await expect(dock).toContainText('AI working')
  release();await expect(dock).toContainText('Result ready')
  expect(mock.bodies).toHaveLength(3)
 }finally{release()}
})

test('a copied finding link follows a moved block and preserves the selected revision and visible finding',async({page,aiNet})=>{
 const {analysisFixture}=await import('./helpers/codeAnalysisStory.mjs')
 await openApp(page)
 const a=analysisFixture(true),r=a.revisions[0],finding=r.report.findings[0]
 const block={type:'codeBlock',attrs:{id:'moved-analysis',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]}
 const source=await createPage(page,{title:'Original location',content:doc(block)})
 const destination=await createPage(page,{title:'Moved analysis',content:doc(para('The analysis was moved here.'))})
 await wsEval(page,(s,{source,destination,block})=>{s.setContent(source,{type:'doc',content:[{type:'paragraph'}]});s.setContent(destination,{type:'doc',content:[block]})},{source,destination,block})
 await gotoPage(page,source)
 await page.evaluate(({source,revision,item})=>{location.hash=`#/p/${source}?b=moved-analysis&work-view=findings&work-revision=${revision}&work-item=${item}`},{source,revision:r.id,item:finding.id})
 await expect(page).toHaveURL(new RegExp('#/p/'+destination+'\\?'))
 const region=page.getByRole('region',{name:'Code analysis',exact:true}),target=region.locator('[data-work-item="'+finding.id+'"]')
 await expect(region.getByRole('tab',{name:'Findings',exact:true})).toHaveAttribute('aria-selected','true')
 await expect(target).toBeFocused()
 await expect.poll(()=>target.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=40&&r.top<innerHeight-100})).toBe(true)
 expect(page.url()).toContain('work-revision='+r.id)
 await page.evaluate(()=>{location.hash=location.hash.replace(/work-revision=[^&]+/,'work-revision=missing-version')})
 await expect(region.getByRole('alert')).toContainText('linked version or item is no longer available')
 expect(aiNet.count('anthropic')).toBe(0)
})

test('work overview retains filters and reading position after visiting a finding and clears them for another access scope',async({page})=>{
 const {analysisFixture}=await import('./helpers/codeAnalysisStory.mjs')
 await openApp(page)
 const a=analysisFixture(true),r=a.revisions[0],base=r.report.findings[0]
 r.report.findings=Array.from({length:30},(_,i)=>({...base,id:'finding-'+i,title:'Retained finding '+String(i).padStart(2,'0')}))
 const id=await createPage(page,{title:'Continuity source',content:doc({type:'codeBlock',attrs:{id:'continuity',language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})})
 await gotoPage(page,id)
 const open=async()=>{await page.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click();return page.getByRole('dialog',{name:'Work overview'})}
 const d=await open()
 await d.getByRole('searchbox',{name:'Search work'}).fill('Retained finding')
 await d.getByRole('combobox',{name:'Work type'}).selectOption('finding')
 const row=d.locator('article').filter({has:page.getByRole('heading',{name:'Retained finding 18',exact:true})})
 await row.scrollIntoViewIfNeeded()
 const scroll=await d.locator('.modal__body').evaluate(el=>el.scrollTop)
 expect(scroll).toBeGreaterThan(500)
 await row.getByRole('button',{name:'Open at source',exact:true}).click()
 await expect(page.getByRole('region',{name:'Code analysis',exact:true}).locator('[data-work-item="finding-18"]')).toBeFocused()
 const again=await open()
 await expect(again.getByRole('searchbox',{name:'Search work'})).toHaveValue('Retained finding')
 await expect(again.getByRole('combobox',{name:'Work type'})).toHaveValue('finding')
 await expect.poll(()=>again.locator('.modal__body').evaluate(el=>el.scrollTop)).toBeGreaterThan(scroll-50)
 await again.getByRole('button',{name:'Close',exact:true}).click()
 await wsEval(page,s=>s.updateSettings({aiShareExternal:false}))
 // The source access signature changes when the workspace epoch changes (workspace switch/import).
 await page.evaluate(()=>{const w=(window as any).__one.workspace;w.setState({epoch:'other-workspace'})})
 const fresh=await open()
 await expect(fresh.getByRole('searchbox',{name:'Search work'})).toHaveValue('')
 await expect(fresh.getByRole('combobox',{name:'Work type'})).toHaveValue('all')
})


test('a partially scanned workspace is explicitly marked incomplete at the node boundary',async()=>{
 const {inventory}=await import('../../src/app/features/ai/workflow/inventory')
 const content={type:'doc',content:Array.from({length:50000},()=>({type:'paragraph'}))}
 expect(inventory([{id:'large',title:'Large page',content}],false).limited).toBe(true)
 expect(inventory([{id:'small',title:'Small page',content:{type:'doc',content:[{type:'paragraph'}]}}],false).limited).toBe(false)
})

test('work links reveal a hidden parent tab and keep evidence focus inside the selected analysis block',async({page})=>{
 const {analysisFixture}=await import('./helpers/codeAnalysisStory.mjs')
 await openApp(page)
 const a=analysisFixture(true),finding=a.revisions[0].report.findings[0]
 const code=(id:string)=>({type:'codeBlock',attrs:{id,language:'code-analysis'},content:[{type:'text',text:JSON.stringify(a)}]})
 // Imported copies can retain report/evidence IDs; the block ID disambiguates their UI location.
 const id=await createPage(page,{title:'Nested reports',content:doc(code('outside-copy'),{type:'tabs',attrs:{id:'report-tabs'},content:[{type:'tab',attrs:{title:'Summary'},content:[para('Visible summary')]},{type:'tab',attrs:{title:'Investigation'},content:[code('nested-analysis')]}]})})
 await gotoPage(page,id)
 const tabs=page.locator('.tabs-block'),inside=tabs.getByRole('region',{name:'Code analysis',exact:true})
 await tabs.getByRole('tab',{name:'Summary',exact:true}).click()
 await page.evaluate(({id,finding,revision})=>{location.hash=`#/p/${id}?b=nested-analysis&work-view=findings&work-revision=${revision}&work-item=${finding}`},{id,finding:finding.id,revision:a.revisions[0].id})
 await expect(tabs.getByRole('tab',{name:'Investigation',exact:true})).toHaveAttribute('aria-selected','true')
 const row=inside.locator(`[data-work-item="${finding.id}"]`)
 await expect(row).toBeFocused();await expect(row).toBeInViewport()
 const evidence=row.locator('.code-analysis__links button').first()
 await evidence.click()
 await expect(inside.getByRole('tab',{name:'Evidence',exact:true})).toHaveAttribute('aria-selected','true')
 await expect(inside.locator('[data-work-item]').first()).toBeFocused()
 await expect(page.locator('.code-analysis').first().getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true')
})
