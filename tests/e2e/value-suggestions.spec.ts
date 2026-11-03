import {test,expect,openApp,gotoPage,wsEval,flush,MOD} from './fixtures'

async function source(page:any){
 await openApp(page)
 const ids=await wsEval(page,s=>{const db=s.createDatabase({title:'Project input values',properties:[{id:'name',name:'Name',type:'title'},{id:'area',name:'Area',type:'text'}]});const a=s.createRow(db,{title:'One',properties:{area:'Design'}}),b=s.createRow(db,{title:'Two',properties:{area:'Backend'}}),c=s.createRow(db,{title:'Three'});return{db,a,b,c}})
 await flush(page);await gotoPage(page,ids.db);return ids
}
const cell=(page:any,name:string)=>page.locator('.dbt-row[role="row"]').filter({has:page.locator('.dbt-cell--title',{hasText:new RegExp('^'+name)})}).locator('[role="gridcell"][data-type="text"]')

test('free text and existing choices mix; saving a custom value extends the column without a schema prompt',async({page})=>{
 const ids=await source(page)
 await cell(page,'Three').click();const input=page.getByRole('combobox',{name:'Area',exact:true})
 await expect(input).toBeFocused();await expect(page.getByRole('listbox',{name:'Suggested values: Area'})).toHaveCount(0)
 await input.press('Alt+ArrowDown');const list=page.getByRole('listbox',{name:'Suggested values: Area'})
 await expect(list.getByRole('option',{name:'Design',exact:true})).toBeVisible()
 await list.getByRole('option',{name:'Design',exact:true}).click();await expect(input).toHaveValue('Design');await input.press('Enter');await expect(cell(page,'Three')).toHaveText('Design')
 await cell(page,'Three').click();await input.fill('My new project area');await input.press('Enter');await expect(cell(page,'Three')).toHaveText('My new project area')
 await cell(page,'Two').click();await input.press('Alt+ArrowDown');await expect(list.getByRole('option',{name:'My new project area',exact:true})).toBeVisible()
 // The first Escape closes only suggestions; free edits are not replaced by a highlighted choice.
 await input.press('ArrowDown');await input.press('Escape');await expect(list).toHaveCount(0);await expect(input).toBeFocused();await expect(input).toHaveValue('Backend')
 await input.fill('Distinct free value');await input.press('Alt+ArrowDown');await expect(page.getByText('No matching suggestion. Keep typing your own value.')).toBeVisible();await input.press('Enter');await expect(cell(page,'Two')).toHaveText('Distinct free value')
 const property=await wsEval(page,(s,id)=>s.databases[id].properties.find((p:any)=>p.id==='area'),ids.db);expect(property.type).toBe('text');expect(property.options).toBeUndefined()
})

test('keyboard choices, multiline writing and row properties keep normal save behaviour',async({page})=>{
 const ids=await source(page);await gotoPage(page,ids.c)
 await page.locator('[data-prow="area"] .db-prow__value').click()
 const input=page.getByRole('combobox',{name:'Area',exact:true});await input.press('Alt+ArrowDown');await input.press('ArrowDown');await input.press('Enter')
 await expect(input).not.toHaveValue('');await input.fill('First line');await input.press('Shift+Enter');await input.press('B');await input.press('Enter')
 await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].properties.area,ids.c)).toBe('First line\nB')
})

test('typed fields offer configured values but preserve custom input and require the existing checks',async({page})=>{
 await openApp(page);await wsEval(page,s=>s.updateSettings({mcpServers:[{id:'test',name:'project-atlas',url:'https://atlas.example.org/mcp',token:'',enabled:true,prompt:''}]}))
 await page.keyboard.press(`${MOD}+j`);await page.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Edit cube profiles'}),typed=dialog.getByRole('region',{name:'Typed AI · task types and rules'})
 await typed.getByRole('button',{name:'BA analysis',exact:true}).click();await dialog.getByLabel('Profile name',{exact:true}).fill('Free guided fields')
 const domain=typed.getByLabel('Domain',{exact:true});await expect(typed.getByRole('button',{name:'Show suggested values: Domain',exact:true})).toHaveCount(0);await domain.fill('my');await domain.press('Alt+ArrowDown');await domain.press('Escape');await expect(dialog).toBeVisible()
 await domain.fill('my-domain');await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(typed.getByRole('status')).toContainText('Selection resolves exactly one')
 await typed.getByText('Read and bind an Atlas rule / shadow',{exact:true}).click();const server=typed.getByLabel('Personal Atlas connection',{exact:true});await server.press('Alt+ArrowDown');await server.fill('project');await page.getByRole('option',{name:'project-atlas',exact:true}).click();await expect(server).toHaveValue('project-atlas');await server.fill('my-other-connection');await expect(server).toHaveValue('my-other-connection')
 await typed.getByText('Read and bind an Atlas rule / shadow',{exact:true}).click();await dialog.getByRole('button',{name:'Save version only',exact:true}).click();await expect(dialog).toContainText('Version saved')
})

test('suggestions fit paper and carbon on desktop and mobile',async({page},info)=>{
 await source(page)
 for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[390,844]]){
  await page.setViewportSize({width,height});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme)
  await cell(page,'Three').click();const input=page.getByRole('combobox',{name:'Area',exact:true});await input.press('Alt+ArrowDown')
  const pop=page.locator('.value-help__popover');await expect(pop.getByRole('option',{name:'Design',exact:true})).toBeVisible()
  const box=await pop.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(height+1)
  await page.screenshot({path:info.outputPath(`values-${theme}-${width}.png`),animations:'disabled'});await input.press('Escape');await input.press('Escape')
 }
})


test('Escape discards only the current draft; first Escape on suggestions followed by outside still saves',async({page})=>{
 await source(page);await cell(page,'Two').click();let input=page.getByLabel('Area',{exact:true})
 await input.fill('Discard this');await input.press('Escape');await expect(cell(page,'Two')).toHaveText('Backend')
 await cell(page,'Two').click();input=page.getByLabel('Area',{exact:true});await input.fill('Save after closing choices');await input.press('Alt+ArrowDown');await input.press('Escape');await expect(input).toBeFocused()
 await page.getByRole('textbox',{name:'Page title',exact:true}).click();await expect(cell(page,'Two')).toHaveText('Save after closing choices')
})

test('save feedback can undo, but cannot overwrite a later change',async({page})=>{
 const ids=await source(page);await cell(page,'Two').click();await page.getByLabel('Area',{exact:true}).fill('New value');await page.getByLabel('Area',{exact:true}).press('Enter')
 const saved=page.locator('.toast').filter({hasText:'Saved · Area'});await expect(saved).toBeVisible();await saved.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,'Two')).toHaveText('Backend')
 await cell(page,'Two').click();await page.getByLabel('Area',{exact:true}).fill('Another value');await page.getByLabel('Area',{exact:true}).press('Enter')
 await expect(saved).toBeVisible();await wsEval(page,(s,id)=>s.setRowProperty(id,'area','Changed elsewhere'),ids.b)
 await saved.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,'Two')).toHaveText('Changed elsewhere');await expect(page.getByText('The value or its context has changed since saving. Undo left the current values untouched.')).toBeVisible()
})

test('similar spelling is suggested, while Enter preserves the exact custom value',async({page})=>{
 const ids=await source(page);await wsEval(page,(s,id)=>s.setRowProperty(id,'area','Frontend'),ids.a)
 await cell(page,'Three').click();const input=page.getByLabel('Area',{exact:true});await input.fill('frontend ')
 await expect(page.getByText('Similar value available · your spelling stays as entered')).toBeVisible();await input.press('Alt+ArrowDown')
 const list=page.getByRole('listbox',{name:'Suggested values: Area'});await expect(list.getByRole('option').first()).toHaveAttribute('aria-label','Frontend');await expect(list).toContainText('Similar spelling already exists');await expect(list).toContainText('Used in this column · 1×')
 await input.press('Enter');expect(await wsEval(page,(s,id)=>s.pages[id].properties.area,ids.c)).toBe('frontend ')
 await cell(page,'Three').click();await input.press('Alt+ArrowDown');await expect(list.getByRole('option').first()).toHaveAttribute('aria-label','Frontend');await input.press('ArrowUp');await expect(input).toHaveAttribute('aria-activedescendant',/-2$/)
 await input.press('Escape');await input.press('Escape')
})

test('typed preview follows the draft; recipe changes preserve applicable rules and offer Undo',async({page},info)=>{
 await openApp(page);await page.keyboard.press(`${MOD}+j`);await page.getByRole('button',{name:'Edit cube profiles',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Edit cube profiles'}),typed=dialog.getByRole('region',{name:'Typed AI · task types and rules'})
 await dialog.getByLabel('Profile name',{exact:true}).fill('Draft and recipe test');await typed.getByRole('button',{name:'BA analysis',exact:true}).click()
 await typed.getByLabel('Domain',{exact:true}).fill('laboratory');await expect(typed.locator('.typed-ai__draft')).toContainText('laboratory');await expect(typed.locator('.typed-ai__draft')).toContainText('Draft · unchecked');await expect(dialog.getByRole('button',{name:'Save version only',exact:true})).toBeDisabled()
 await typed.getByText('Edit tag chain',{exact:true}).click()
 const chain=typed.getByLabel('Typed tag chain',{exact:true});await chain.fill((await chain.inputValue())+'\nrule:lab-rules@5')
 await typed.getByText('Shadow definitions and source bindings',{exact:true}).click()
 const sources=typed.getByLabel('Pinned Atlas bindings · JSON',{exact:true});await sources.fill(JSON.stringify([{kind:'rule',server:'atlas',origin:'https://atlas.example.org',tenant:'aj',project:'lab',ref:42,hash:'a'.repeat(64),stateHash:'b'.repeat(64),quote:'Laboratory rule version five applies.',binding:'rule:lab-rules@5'}]))
 await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save version only',exact:true})).toBeEnabled()
 await typed.getByRole('button',{name:'PO specification',exact:true}).click();await expect(typed.locator('.typed-ai__draft')).toContainText('acceptance-criteria');await expect(typed.locator('.typed-ai__recipe-change')).toContainText('rule:lab-rules@5');expect(JSON.parse(await sources.inputValue())).toHaveLength(1)
 await expect(dialog.getByRole('button',{name:'Save version only',exact:true})).toBeDisabled()
 for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[390,844]]){await page.setViewportSize({width,height});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await typed.locator('.typed-ai__draft').scrollIntoViewIfNeeded();expect(await dialog.evaluate((el:any)=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`draft-${theme}-${width}.png`),animations:'disabled'})}
 await typed.getByRole('button',{name:'Undo',exact:true}).click();await expect(typed.getByLabel('Operation',{exact:true})).toHaveValue('ba');expect(JSON.parse(await sources.inputValue())).toHaveLength(1)
 await chain.fill('operation:');await expect(typed.locator('.typed-ai__draft')).toContainText('This draft cannot be resolved');await expect(typed.locator('.typed-ai__draft')).not.toContainText('one.ba');await typed.getByRole('button',{name:'PO specification',exact:true}).click();await expect(typed.getByRole('alert')).toContainText('Fix the draft before changing recipes')
})
