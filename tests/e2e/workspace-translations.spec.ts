import { ledger } from './helpers/aiFlows'
import type { Page as BrowserPage, BrowserContext } from '@playwright/test'
import type { Page, Database } from '../../src/app/store/types'
import { translationSignature, pageTexts, localizePage, localizeDatabase } from '../../src/app/store/localization'
import { test, expect, openApp, createPage, gotoPage, wsEval, doc, para, heading, editorOf, reloadApp, flush } from './fixtures'
const dictionary: Record<string,string> = {'Rollen und Modelle':'Roles and models','Verantwortung':'Responsibility','Die Freigabe bleibt beim Team.':'Approval remains with the team.','Ein Kind':'A child','Prüfen':'Check','Hinweis':'Note','Aufgaben':'Tasks','Übung':'Exercise','Ergebnis':'Result','Offen':'Open','Tabelle':'Table'}
async function setup(page:BrowserPage){await openApp(page);const id=await createPage(page,{title:'Rollen und Modelle',content:doc(heading(2,'Verantwortung'),para('Die Freigabe bleibt beim Team.'),{type:'codeBlock',attrs:{language:'typescript'},content:[{type:'text',text:'const pflicht = "unverändert";'}]})});await gotoPage(page,id);return id}
async function install(page:BrowserPage,id:string,dbId?:string){
 const {p,db}=await wsEval(page,(s,a)=>({p:s.pages[a.id],db:a.dbId?s.databases[a.dbId]:undefined}),{id,dbId}) as {p:Page;db?:Database}
 const localization={source:'de',variants:{en:{at:Date.now(),signature:translationSignature(p,db),texts:pageTexts(p,db).map(s=>[s,dictionary[s]??s])}}}
 await wsEval(page,(s,a)=>s.updatePage(a.id,{localization:a.localization}),{id,localization});return p
}
async function mockModel(context:BrowserContext,invalid=false){const bodies:any[]=[];await context.route('https://api.anthropic.com/**',async route=>{
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
 const b=route.request().postDataJSON();bodies.push(b);const content=b.messages[0].content;const prompt=typeof content==='string'?content:content.find((x:any)=>x.type==='text').text;const texts=JSON.parse(prompt).texts
 await route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({id:'msg_translation',type:'message',role:'assistant',model:b.model,content:[{type:'text',text:JSON.stringify({texts:invalid?[]:texts.map((s:string)=>dictionary[s]??s)})}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:30,output_tokens:30}})})});return bodies}
async function openTranslation(page:BrowserPage){await page.getByTestId('translation-manage').click();await expect(page.getByTestId('translation-panel')).toBeVisible();await page.getByLabel('Original language',{exact:true}).selectOption('de');await page.getByLabel('Translate to',{exact:true}).selectOption('en')}

test('native language follows UI on the same page; labels, prose, links and reload preserve the source',async({page})=>{
 const id=await setup(page),child=await createPage(page,{title:'Ein Kind',parentId:id});await install(page,child)
 await wsEval(page,(s,a)=>s.setContent(a.id,{...s.pages[a.id].content,content:[...s.pages[a.id].content.content,{type:'pageLink',attrs:{pageId:a.child}}]},'e2e'),{id,child})
 await gotoPage(page,child)
 await gotoPage(page,id)
 await flush(page)
 const original=await install(page,id)
 await expect(page.locator('.pv-title')).toHaveValue('Roles and models');await expect(editorOf(page)).toContainText('Approval remains with the team.');await expect(editorOf(page)).toHaveAttribute('contenteditable','false')
 await expect(editorOf(page).locator('code')).toContainText('const pflicht = "unverändert";');await expect(editorOf(page).locator('.page-link__title')).toHaveText('A child')
 await expect(page.locator('.sb-row__title').filter({hasText:'Roles and models'})).toHaveCount(1)
 await wsEval(page,s=>s.updateSettings({language:'de'}));await expect(page.locator('.pv-title')).toHaveValue('Rollen und Modelle');await expect(editorOf(page)).toHaveAttribute('contenteditable','true')
 await wsEval(page,s=>s.updateSettings({language:'en'}));await reloadApp(page);await expect(page.locator('.pv-title')).toHaveValue('Roles and models')
 expect(await wsEval(page,(s,id)=>s.pages[id].title,id)).toBe(original.title);expect(await wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(original.content)
 expect(page.url()).toContain('#/p/'+id)
})

test('a changed original is marked outdated; original editing is explicit and no source data is replaced',async({page})=>{
 const id=await setup(page);await install(page,id)
 await wsEval(page,(s,id)=>s.setContent(id,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Das Original wurde fachlich geändert.'}]}]},'e2e'),id)
 await expect(page.locator('[data-translation-status="stale"]')).toBeVisible();await expect(editorOf(page)).toContainText('Das Original wurde fachlich geändert.')
 await page.getByRole('button',{name:'Edit original',exact:true}).click();await expect(editorOf(page)).toHaveAttribute('contenteditable','true');await expect(page.locator('.pv-title')).toHaveValue('Rollen und Modelle')
})

test('generation is explicit, preview editable, metered and only save creates a variant',async({page,context})=>{
 const bodies=await mockModel(context),id=await setup(page);await createPage(page,{title:'SECRET_OUTSIDE_SELECTION',content:doc(para('OUTSIDE_SENTINEL'))});await gotoPage(page,id)
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}));await openTranslation(page);expect(bodies).toHaveLength(0)
 await page.getByTestId('translation-generate').click();await expect(page.getByTestId('translation-save')).toBeEnabled();expect(bodies).toHaveLength(1)
 expect(JSON.stringify(bodies)).not.toContain('OUTSIDE_SENTINEL');expect(bodies[0].mcp_servers??[]).toHaveLength(0);expect(JSON.stringify(bodies)).not.toContain('const pflicht')
 expect(await wsEval(page,(s,id)=>s.pages[id].localization,id)).toBeUndefined()
 await page.getByTestId('translation-save').click();await expect(page.getByTestId('translation-panel')).toHaveCount(0);await expect(page.locator('.pv-title')).toHaveValue('Roles and models')
 expect(await wsEval(page,(s,id)=>s.pages[id].title,id)).toBe('Rollen und Modelle');expect((await ledger(page)).some(e=>e.purpose==='workspace.translate')).toBe(true)
})

test('invalid model data saves nothing and source changes invalidate a staged translation',async({page,context})=>{
 await mockModel(context,true);const id=await setup(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}));await openTranslation(page)
 await page.getByTestId('translation-generate').click();await expect(page.getByRole('alert')).toContainText('invalid translation');await expect(page.getByTestId('translation-save')).toBeDisabled();expect(await wsEval(page,(s,id)=>s.pages[id].localization,id)).toBeUndefined()
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await context.unroute('https://api.anthropic.com/**');await mockModel(context)
 await openTranslation(page);await page.getByTestId('translation-generate').click();await expect(page.getByTestId('translation-save')).toBeEnabled()
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Inzwischen geändert'}),id);await page.getByTestId('translation-save').click();await expect(page.getByRole('alert')).toContainText('source page changed');expect(await wsEval(page,(s,id)=>s.pages[id].localization,id)).toBeUndefined()
})

test('saved translations can be corrected manually without a model call',async({page,context})=>{
 const bodies=await mockModel(context),id=await setup(page);await install(page,id);await openTranslation(page);await page.getByTestId('translation-load').click();await expect(page.getByTestId('translation-save')).toBeEnabled()
 const field=page.locator('.translation-pair textarea');const index=await page.locator('.translation-pair span').allTextContents();const i=index.indexOf('Die Freigabe bleibt beim Team.');expect(i).toBeGreaterThanOrEqual(0)
 await field.nth(i).fill('The team retains approval authority.');await page.getByTestId('translation-save').click();await expect(editorOf(page)).toContainText('The team retains approval authority.');expect(bodies).toHaveLength(0)
 expect(await wsEval(page,(s,id)=>s.pages[id].plain,id)).toContain('Die Freigabe bleibt beim Team.')
 await openTranslation(page);await page.getByTestId('translation-load').click();await expect(page.getByTestId('translation-save')).toBeEnabled()
 await wsEval(page,(s,id)=>{const l=structuredClone(s.pages[id].localization);l.variants.en.at+=1;l.variants.en.texts=l.variants.en.texts.map(([a,b]:string[])=>[a,b==='The team retains approval authority.'?'A colleague reviewed this translation.':b]);s.updatePage(id,{localization:l})},id)
 await page.getByTestId('translation-save').click();await expect(page.getByRole('alert')).toContainText('source page changed');expect(JSON.stringify(await wsEval(page,(s,id)=>s.pages[id].localization,id))).toContain('A colleague reviewed this translation.')
})

test('database labels and text localise while status IDs, filters and formula semantics stay canonical',async({page})=>{
 await openApp(page)
 const ids=await wsEval(page,s=>{const db=s.createDatabase({title:'Aufgaben',properties:[{id:'name',name:'Name',type:'title'},{id:'note',name:'Hinweis',type:'text'},{id:'status',name:'Status',type:'select',options:[{id:'open',name:'Offen',color:'yellow'}]},{id:'result',name:'Ergebnis',type:'formula',formula:'if(prop("Hinweis") == "Prüfen", 17, 99)'}]});const row=s.createRow(db,{title:'Übung',properties:{note:'Prüfen',status:'open'}});return {db,row}})
 await install(page,ids.db,ids.db);await install(page,ids.row,ids.db);await gotoPage(page,ids.db)
 await expect(page.locator('.pv-title')).toHaveValue('Tasks');await expect(page.locator('section.db')).toHaveAttribute('data-readonly','true')
 await expect(page.locator('.dbt-body')).toContainText('Exercise');await expect(page.locator('.dbt-body')).toContainText('Check');await expect(page.locator('.dbt-body')).toContainText('Open');await expect(page.locator('.dbt-body')).toContainText('17')
 expect(await wsEval(page,(s,id)=>s.pages[id].properties,ids.row)).toEqual({note:'Prüfen',status:'open'});expect(await wsEval(page,(s,id)=>s.databases[id].properties.find((p:any)=>p.id==='note').name,ids.db)).toBe('Hinweis')
 await page.getByTestId('content-language').selectOption('original');await expect(page.locator('section.db')).not.toHaveAttribute('data-readonly','true')
})

test('projection never changes executable fields or technical identifiers',()=>{
 const page={title:'Aufgaben',kind:'database',properties:{},content:doc(para('Prüfen'),{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'Prüfen'}]},{type:'paragraph',content:[{type:'text',text:'Prüfen',marks:[{type:'code'}]},{type:'text',text:'Prüfen',marks:[{type:'link',attrs:{href:'https://example.test/Prüfen'}}]}]})} as Page
 const db={properties:[{id:'p',type:'select',name:'Hinweis',options:[{id:'open',name:'Offen'}]},{id:'f',type:'formula',name:'Ergebnis',formula:'prop("Hinweis")'}],views:[{id:'v',name:'Tabelle',filter:{field:'Offen'}}]} as unknown as Database
 page.localization={source:'de',variants:{en:{at:1,signature:translationSignature(page,db),texts:pageTexts(page,db).map(s=>[s,dictionary[s]??s])}}}
 const before=JSON.stringify({page,db}),shown=localizePage(page,'en',db),table=localizeDatabase(db,page,'en')
 expect(shown.content!.content![1].content![0].text).toBe('Prüfen');expect(shown.content!.content![2].content![0].text).toBe('Prüfen');expect(shown.content!.content![2].content![1].marks![0].attrs!.href).toBe('https://example.test/Prüfen')
 expect(table.properties[0].options![0].id).toBe('open');expect(table.properties[1].formula).toBe('prop("Hinweis")');expect(table.views[0].filter).toEqual(db.views[0].filter);expect(JSON.stringify({page,db})).toBe(before)
})

test('a subtree preview excludes locked pages, trashed descendants and unrelated private content',async({page,context})=>{
 const bodies=await mockModel(context),id=await setup(page)
 await createPage(page,{title:'Ein Kind',parentId:id,content:doc(para('Die Freigabe bleibt beim Team.'))})
 const blocked=await createPage(page,{title:'LOCKED_SENTINEL',parentId:id});await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),blocked)
 const trashed=await createPage(page,{title:'TRASHED_SENTINEL',parentId:id});await wsEval(page,(s,id)=>s.trashPage(id),trashed)
 const secret=await createPage(page,{title:'PRIVATE_SENTINEL'});await wsEval(page,(s,id)=>s.updatePage(id,{private:true}),secret)
 await gotoPage(page,id);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}));await openTranslation(page);await page.getByLabel('Pages to translate',{exact:true}).selectOption('subtree')
 await page.getByTestId('translation-generate').click();await expect(page.getByTestId('translation-save')).toBeEnabled();expect(bodies).toHaveLength(2)
 for(const marker of ['LOCKED_SENTINEL','TRASHED_SENTINEL','PRIVATE_SENTINEL'])expect(JSON.stringify(bodies)).not.toContain(marker)
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await wsEval(page,(s,id)=>s.pages[id].localization,id)).toBeUndefined()
})

test('stopping generation cannot store a partial variant; viewers cannot start a translation',async({page,context})=>{
 const id=await setup(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 await context.route('https://api.anthropic.com/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});await new Promise(r=>setTimeout(r,800));await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:'{}'}).catch(()=>{})})
 await openTranslation(page);await page.getByTestId('translation-generate').click();await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Stopped');expect(await wsEval(page,(s,id)=>s.pages[id].localization,id)).toBeUndefined()
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>{(window as any).__one.cloud.useCloud.setState({readOnly:true,role:'viewer'})});await expect(page.getByTestId('translation-manage')).toHaveCount(0)
})

test('workspace packages retain native variants and translated artwork with new attachment ownership',async({page})=>{
 await openApp(page)
 const data=await page.evaluate(async()=>{const one=(window as any).__one,s=one.workspace.getState(),source=await one.files.saveFile(new Blob(['original-picture'],{type:'image/png'}),'source.png'),target=await one.files.saveFile(new Blob(['translated-picture'],{type:'image/png'}),'target.png');const id=s.createPage({title:'Bild',content:{type:'doc',content:[{type:'image',attrs:{src:source,alt:'Bild'}}]}});return {id,source,target}})
 const p=await wsEval(page,(s,id)=>s.pages[id],data.id) as Page
 const localization={source:'de',variants:{en:{at:Date.now(),signature:translationSignature(p),texts:pageTexts(p).map(s=>[s,s==='Bild'?'Picture':s]),images:[[data.source,data.target]]}}}
 await wsEval(page,(s,a)=>s.updatePage(a.id,{localization:a.localization}),{id:data.id,localization})
 await page.evaluate(()=>{location.hash='#/workspace/data'})
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export workspace package',exact:true}).click();const path=await(await download).path();const {readFile}=await import('node:fs/promises');const packet=JSON.parse(await readFile(path!,'utf8'))
 expect(packet.backup.workspace.pages[data.id].localization).toEqual(localization);expect(packet.backup.files.map((f:any)=>f.ref)).toEqual(expect.arrayContaining([data.source,data.target]))
 await page.locator('aside.sb .sb-head__ws').click();await page.getByRole('menuitem',{name:'New local workspace…'}).click();await page.getByLabel('Optional: workspace package').setInputFiles({name:'translations.one-workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await page.getByRole('textbox',{name:'Workspace name',exact:true}).fill('Translated import');await page.getByRole('button',{name:'Create and open',exact:true}).click();await page.waitForURL(/w=local%3A/);await page.waitForFunction(()=>!!(window as any).__one.workspace.getState().pages[Object.keys((window as any).__one.workspace.getState().pages).find(id=>(window as any).__one.workspace.getState().pages[id].title==='Bild')!])
 const imported=await wsEval(page,(s,id)=>s.pages[id],data.id) as Page;const pair=imported.localization!.variants.en!.images![0];expect(pair[0]).not.toBe(data.source);expect(pair[1]).not.toBe(data.target);expect(imported.content!.content![0].attrs!.src).toBe(pair[0]);expect(translationSignature(imported)).toBe(imported.localization!.variants.en!.signature)
 const file=await page.evaluate(async ref=>{const f=await (window as any).__one.files.getFile(ref);return {ws:f?.ws,name:f?.name}},pair[1]);expect(file.name).toBe('target.png');expect(file.ws).toMatch(/^local:/)
 await gotoPage(page,data.id);await expect(page.locator('.pv-title')).toHaveValue('Picture')
})
