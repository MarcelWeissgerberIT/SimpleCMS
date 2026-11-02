import { test, expect, openApp, wsEval, createPage, gotoPage, doc, para, MOD, editorOf, flush } from './fixtures'
import { mockClaudeScript, text } from './helpers/providers'
import { pdfBytes } from './helpers/files'

const file = (bytes:Uint8Array, id='invoice-file') => ({type:'fileBlock',attrs:{id,name:'Invoice.pdf',src:`data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`,size:bytes.length}})
async function start(page:any,id:string,task:string){
 await gotoPage(page,id);await page.keyboard.press(`${MOD}+j`)
 const terminal=page.getByRole('region',{name:'AI terminal'})
 const box=terminal.getByRole('textbox',{name:'Task for the agent'})
 await box.fill(task);await box.press('Enter')
 await expect(terminal.locator('.term-turn').last()).toHaveAttribute('data-status','done',{timeout:30000})
 return terminal
}
const call=(name:string,input:unknown,n:string)=>({blocks:[{type:'tool_use' as const,id:n,name,input}]})

test('PDF text reaches the model; real calculated spreadsheet is staged, applied and undone without touching attachments',async({page,context},info)=>{
 await openApp(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 const id=await createPage(page,{title:'Invoice calculation',content:doc(para('Keep this source note.'),file(pdfBytes(1,'Invoice INV-17 net 1250.50 VAT 19 percent tax 237.60 gross 1488.10')))})
 await gotoPage(page,id);await editorOf(page,id).getByText('Keep this source note.',{exact:true}).click();await flush(page)
 const before=await wsEval(page,(s,id)=>s.pages[id].content,id)
 const mock=await mockClaudeScript(context,[call('read_page_files',{id},'files'),call('read_page_files',{id,file_id:'invoice-file'},'read'),call('create_spreadsheet',{id,title:'Invoice calculation',rows:[['Source','Net','Rate','Tax','Gross'],['Invoice.pdf p. 1',1250.50,0.19,'=ROUND(B2*C2,2)','=B2+D2'],['Total','=SUM(B2:B2)',null,'=SUM(D2:D2)','=SUM(E2:E2)']],formats:['text','currency','percent','currency','currency']},'sheet'),text('A calculated spreadsheet is ready for review.')])
 const term=await start(page,id,'Read the attached invoice and propose a spreadsheet calculation block with formulas.')
 expect(JSON.stringify(mock.requests.map(r=>r.body.messages))).toContain('INV-17 net 1250.50')
 expect(await wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(before)
 const change=term.locator('.term-change[data-kind="append"]')
 await expect(change).toContainText('Spreadsheet block')
 await expect(change).toContainText('1,488.10')
 await change.getByRole('button',{name:'Apply #1',exact:true}).click()
 await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].content.content.some((n:any)=>n.type==='spreadsheet'),id)).toBe(true)
 const after=await wsEval(page,(s,id)=>s.pages[id].content,id)
 expect(after.content.slice(0,before.content.length)).toEqual(before.content)
 const block=after.content.find((n:any)=>n.type==='spreadsheet')
 expect(block.attrs.sheets[0].cells.D2.v).toBe('=ROUND(B2*C2,2)')
 expect(block.attrs.sheets[0].cells.B2.v).toBe('1250.5')
 await expect(editorOf(page,id).locator('.sh-grid')).toBeVisible()
 await page.screenshot({path:info.outputPath('invoice-spreadsheet.png')})
 await page.getByRole('region',{name:'Notifications'}).getByRole('button',{name:'Undo',exact:true}).click()
 await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(before)
})

test('scanned PDF reports missing text and does not stage invented amounts',async({page,context})=>{
 await openApp(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 const id=await createPage(page,{title:'Scan',content:doc(file(pdfBytes(1,'',2)))})
 const mock=await mockClaudeScript(context,[call('read_page_files',{id,file_id:'invoice-file'},'read'),text('This scan requires OCR; no amounts were extracted.')])
 const term=await start(page,id,'Read the PDF invoice.')
 expect(JSON.stringify(mock.requests.at(-1)!.body.messages)).toContain('No extractable text')
 await expect(term.locator('.term-change')).toHaveCount(0)
})

test('invalid and circular spreadsheet formulas are rejected before a proposal exists',async({page,context})=>{
 await openApp(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 const id=await createPage(page,{title:'Calculation check',content:doc(para('Preserve me'))})
 const mock=await mockClaudeScript(context,[call('create_spreadsheet',{id,title:'Bad formula',rows:[['Amount'],['=BLAH(1)']]},'bad'),call('create_spreadsheet',{id,title:'Cycle',rows:[['Amount'],['=A2+1']]},'cycle'),text('The invalid formulas were rejected; nothing was changed.')])
 const term=await start(page,id,'Propose a calculation block.')
 expect(JSON.stringify(mock.requests.at(-1)!.body.messages)).toContain('Spreadsheet calculation failed')
 await expect(term.locator('.term-change')).toHaveCount(0)
})

import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
const ALLOW=['public','structure','selection','page','rows','files','workspace','people','transcript']
test.describe('text providers use the same local PDF reader and calculation tools',()=>{
 test.describe.configure({mode:'serial'})
 let fake:FakeWorker
 test.beforeEach(async({page})=>{
  fake=await startFakeWorker(8299,{worker:'1.35.5',name:'document-test-box',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true})
  fake.can=[...WORKER_CAN];fake.textModels=[{provider:'local',model:'atlas-flow:latest',context:32768,chat:true,maxOutput:8192},{provider:'copilot',model:'claude-opus-5.5',context:32768,chat:true,maxOutput:8192}]
  await openApp(page)
  await wsEval(page,(s,allow)=>s.setWorkspaceAI({policy:{providers:{local:{allow},copilot:{allow}},restricted:[]}}),ALLOW)
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await page.getByRole('tab',{name:/Coding worker/}).click()
  await page.getByLabel('Port',{exact:true}).fill('8299');await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await expect(page.getByTestId('coding-conn')).toContainText('document-test-box');await page.keyboard.press('Escape')
 })
 test.afterEach(async()=>{await fake?.close()})
 for(const provider of ['copilot','local'])test(`${provider}: extracted PDF text, schema discovery and reviewed calculation block`,async({page})=>{
  const model=provider==='local'?'atlas-flow:latest':'claude-opus-5.5'
  await wsEval(page,(s,r)=>s.updateSettings({ai:{routes:{terminal:[r]}}}),{p:provider,m:model})
  const id=await createPage(page,{title:'Text-only invoice',content:doc(file(pdfBytes(1,'Invoice DOC-27 net 100 tax 19 gross 119')))})
  let turn=0
  fake.onText=request=>{
   const calls=[{id:'r1',name:'read_page_files',arguments:{id,file_id:'invoice-file'}},{id:'r2',name:'one_workspace_search',arguments:{query:'create_spreadsheet'}},{id:'r3',name:'one_workspace_call',arguments:{name:'create_spreadsheet',arguments:{id,title:'Calculated invoice',rows:[['Source','Net','VAT','Gross'],['Invoice.pdf p.1',100,'=B2*0.19','=B2+C2']],formats:['text','currency','currency','currency']}}}]
   const c=calls[turn++]
   return {model:request.model,text:c?'':'The invoice calculation block is ready for review.',calls:c?[c]:[],inputTokens:200,outputTokens:60,usd:null}
  }
  const term=await start(page,id,'Read my attached PDF invoice and propose a spreadsheet block with formulas.')
  expect(JSON.stringify(fake.textAsked)).toContain('DOC-27 net 100 tax 19 gross 119')
  expect(JSON.stringify(fake.textAsked)).not.toContain('JVBERi0')
  await expect(term.locator('.term-change[data-kind="append"]')).toHaveCount(1)
  await term.getByRole('button',{name:'Apply #1',exact:true}).click()
  await expect.poll(()=>wsEval(page,(s,id)=>s.pages[id].content.content.some((n:any)=>n.type==='spreadsheet'),id)).toBe(true)
 const after=await wsEval(page,(s,id)=>s.pages[id].content,id)
  expect(after.content.find((n:any)=>n.type==='spreadsheet').attrs.sheets[0].cells.D2.v).toBe('=B2+C2')
 })
 test('file data rule refuses extraction before any invoice text reaches the model',async({page})=>{
  await wsEval(page,(s,allow)=>{s.setWorkspaceAI({policy:{providers:{local:{allow}},restricted:[]}});s.updateSettings({ai:{routes:{terminal:[{p:'local',m:'atlas-flow:latest'}]}}})},ALLOW.filter(v=>v!=='files'))
  const id=await createPage(page,{title:'Blocked document',content:doc(file(pdfBytes(1,'PRIVATE-INVOICE-DO-NOT-SEND')))})
  let turn=0
  fake.onText=request=>({model:request.model,text:turn>0?'File content is excluded by your data rule.':'',calls:turn++===0?[{id:'read',name:'read_page_files',arguments:{id,file_id:'invoice-file'}}]:[],inputTokens:100,outputTokens:20,usd:null})
  const term=await start(page,id,'Read my invoice file.')
  expect(JSON.stringify(fake.textAsked)).not.toContain('PRIVATE-INVOICE-DO-NOT-SEND')
  expect(JSON.stringify(fake.textAsked)).toContain('excluded for the selected model')
  await expect(term.locator('.term-change')).toHaveCount(0)
 })
})
