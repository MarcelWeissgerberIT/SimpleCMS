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
 const domain=typed.getByRole('combobox',{name:'Domain',exact:true});await domain.press('Alt+ArrowDown');await expect(page.getByRole('option',{name:'product',exact:true})).toBeVisible();await domain.press('Escape');await expect(dialog).toBeVisible()
 await domain.fill('my-domain');await typed.getByRole('button',{name:'Check selection and missing prerequisites',exact:true}).click();await expect(typed.getByRole('status')).toContainText('Selection resolves exactly one')
 await typed.getByText('Read and bind an Atlas rule / shadow',{exact:true}).click();const server=typed.getByRole('combobox',{name:'Personal Atlas connection',exact:true});await server.press('Alt+ArrowDown');await server.fill('project');await page.getByRole('option',{name:'project-atlas',exact:true}).click();await expect(server).toHaveValue('project-atlas');await server.fill('my-other-connection');await expect(server).toHaveValue('my-other-connection')
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
