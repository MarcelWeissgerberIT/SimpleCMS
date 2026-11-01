import {test,expect,openApp,wsEval} from './fixtures'
import {startFakeWorker,type FakeWorker} from './helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'
const PORT=47461
const envelope=(data:unknown)=>JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})
const createSchema={type:'object',properties:{kind:{type:'string'},project:{type:'string'},title:{type:'string'},body:{type:'string'},fields:{type:'object',propertyNames:{type:'string'},additionalProperties:{}}},required:['kind','project','title']}
const schemas:Record<string,unknown>={atlas_whoami:{type:'object',properties:{}},atlas_project_list:{type:'object',properties:{}},atlas_constraints:{type:'object',properties:{project:{type:'string'},kind:{type:'string'}}},atlas_create:createSchema,atlas_get:{type:'object',properties:{ref:{type:'integer'},parts:{type:'array',items:{type:'string'}},includeConstraints:{type:'string'}},required:['ref']}}

test.describe('Human-reviewed Atlas source handoff',()=>{
 test.describe.configure({mode:'default'})
 let fake:FakeWorker,pageId:string,saved:Record<string,unknown>,constraints:string
 test.beforeEach(async({page})=>{
  constraints='Imported references must retain their source link.';saved={}
  fake=await startFakeWorker(PORT,{worker:'1.35.3',name:'source-atlas-fixture',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true});fake.can=[...WORKER_CAN]
  fake.onModelMcp=r=>{
   if(r.action==='search')return {tools:[{server:'atlas',name:r.query,inputSchema:schemas[r.query]}]}
   const data=r.name==='atlas_whoami'?{person:'Test Source Member'}:r.name==='atlas_project_list'?{projects:[{slug:'demo-source',title:'Source test project',tenant:'fixture'}]}:r.name==='atlas_constraints'?{items:[{body:constraints}]}:r.name==='atlas_create'?(saved={...r.arguments}, {item:{ref:42,...saved}}):{item:{ref:42,...saved}}
   return {result:envelope(data)}
  }
  await openApp(page)
  pageId=await wsEval(page,s=>{s.updateSettings({mcpServers:[{id:'source-atlas',name:'atlas',url:'https://atlas.example.org/mcp',scope:'all',token:'source-fixture-token',enabled:true,prompt:'Use actual sources.',tools:['atlas_whoami','atlas_project_list','atlas_constraints','atlas_create','atlas_get'],checkedAt:Date.now()}]});const id=s.createPage({title:'Human selected source',parentId:null});s.setContent(id,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Reviewed original source text.'}]}]},'e2e');return id})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click()
  await page.getByLabel('Port',{exact:true}).fill(String(PORT));await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await expect(page.getByTestId('coding-conn')).toContainText('source-atlas-fixture')
  await page.keyboard.press('Escape')
  await page.evaluate(id=>(window as any).__one.ui.getState().openModal({type:'sourceAtlas',pageId:id}),pageId)
 })
 test.afterEach(async()=>{await fake?.close()})
 const access=async(page:any)=>{const dialog=page.getByTestId('source-atlas-handoff');await dialog.getByLabel('Your personal Atlas connection').selectOption('atlas');await dialog.getByRole('button',{name:'Check access and projects',exact:true}).click();await expect(dialog).toContainText('Test Source Member');return dialog}
 const review=async(page:any)=>{const dialog=await access(page);await dialog.getByLabel('Target project (read from Atlas)').selectOption('demo-source');await dialog.getByRole('button',{name:'Check constraints and handoff',exact:true}).click();await expect(dialog).toContainText('Exact outgoing data');return dialog}
 test('uses actual projects and constraints, writes the exact reviewed payload once and verifies the returned ref without inference',async({page})=>{
  const dialog=await review(page)
  const write=dialog.getByRole('button',{name:'Create in Atlas now',exact:true})
  await expect(write).toBeDisabled()
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(0)
  await page.screenshot({path:'.shots/source-atlas-review.png'})
  await dialog.getByRole('checkbox').check();await write.click()
  await expect(dialog).toContainText('Title and content read back and verified.')
  await expect(dialog.getByRole('link',{name:'Ref 42',exact:true})).toHaveAttribute('href','https://atlas.example.org/r/42')
  const calls=fake.mcpAsked.filter(r=>r.action==='call')
  const created=calls.filter(r=>r.name==='atlas_create')
  expect(created).toHaveLength(1)
  expect(created[0].arguments).toMatchObject({kind:'doc',project:'demo-source',title:'Human selected source'})
  expect(created[0].arguments.body).toContain('not a confirmed project requirement')
  expect(created[0].arguments.body).toContain('Reviewed original source text.')
  expect(created[0].arguments.body).toContain('SHA-256')
  expect(created[0].arguments.body).toContain(pageId)
  expect(calls.filter(r=>r.name==='atlas_constraints')).toHaveLength(2)
  expect(calls.at(-1)?.name).toBe('atlas_get')
  expect(fake.textAsked).toHaveLength(0)
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download handoff receipt'}).click()
  const path=await (await download).path();const fs=await import('node:fs/promises');const receipt=await fs.readFile(path!,'utf8')
  expect(receipt).toContain('read_back_matches');expect(receipt).not.toContain('source-fixture-token')
 })
 test('changed constraints block a previously reviewed write',async({page})=>{
  const dialog=await review(page);constraints='New constraint requires a different source classification.'
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Create in Atlas now',exact:true}).click()
  await expect(dialog.getByRole('alert').first()).toContainText('Atlas constraints changed')
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(0)
  await expect(dialog.getByText('The write attempt will not be retried automatically.',{exact:false})).toHaveCount(0)
 })
 test('source edited after preview blocks the write',async({page})=>{
  const dialog=await review(page)
  await wsEval(page,(s,id)=>s.setContent(id,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Source changed after review.'}]}]},'e2e'),pageId)
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Create in Atlas now',exact:true}).click()
  await expect(dialog.getByRole('alert').first()).toContainText('source changed')
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(0)
 })
 test('ambiguous write result shows no invented ref and cannot silently retry',async({page})=>{
  const original=fake.onModelMcp!
  fake.onModelMcp=r=>r.action==='call'&&r.name==='atlas_create'?{result:envelope({message:'accepted but no returned ref'})}:original(r)
  const dialog=await review(page);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Create in Atlas now',exact:true}).click()
  await expect(dialog.getByRole('alert').first()).toContainText('did not return an unambiguous saved record')
  await expect(dialog.getByRole('button',{name:'Create in Atlas now',exact:true})).toBeDisabled()
  await expect(dialog.getByRole('link',{name:/Ref/})).toHaveCount(0)
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(1)
 })
 test('large nested project and constraint results are reconstructed without losing source text',async({page})=>{
  const original=fake.onModelMcp!
  fake.onModelMcp=r=>r.action==='call'&&r.name==='atlas_project_list'?{result:envelope({projects:Array.from({length:80},(_,i)=>({slug:'large-'+i,title:'Source project '+i,tenant:'fixture',parentSlug:null}))})}:r.action==='call'&&r.name==='atlas_constraints'?{result:envelope({constraints:[{ref:123,body:'Source policy '.repeat(900)+' final requirement intact'}],count:1})}:original(r)
  const dialog=await access(page)
  await expect(dialog.getByLabel('Target project (read from Atlas)').locator('option')).toHaveCount(81)
  await dialog.getByLabel('Target project (read from Atlas)').selectOption('large-79')
  await dialog.getByRole('button',{name:'Check constraints and handoff',exact:true}).click()
  await expect(dialog).toContainText('Exact outgoing data')
  await dialog.getByText('Current Atlas constraints',{exact:true}).click()
  await expect(dialog.locator('pre').first()).toContainText('final requirement intact')
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(0)
 })
 test('refused project access cannot become a write or a false successful connection',async({page})=>{
  const original=fake.onModelMcp!
  fake.onModelMcp=r=>r.action==='call'&&r.name==='atlas_project_list'?{result:JSON.stringify({isError:true,content:[{type:'text',text:'Project access refused'}]})}:original(r)
  const dialog=page.getByTestId('source-atlas-handoff')
  await dialog.getByLabel('Your personal Atlas connection').selectOption('atlas')
  await dialog.getByRole('button',{name:'Check access and projects',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Atlas refused the operation')
  await expect(dialog.getByLabel('Target project (read from Atlas)')).toHaveCount(0)
  expect(fake.mcpAsked.filter(r=>r.name==='atlas_create')).toHaveLength(0)
 })

})
