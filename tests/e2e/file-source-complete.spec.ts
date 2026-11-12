import {readFileSync,writeFileSync} from 'node:fs'
import {test,expect,openApp,gotoPage,wsEval,flush} from './fixtures'
import {pdfBytes} from './helpers/files'
const realPath=process.env.ONE_SOURCE_TEST_PDF
async function setup(page:any,bytes:Uint8Array){
 await openApp(page)
 const id=await page.evaluate(async(data:number[])=>{
  const one=(window as any).__one,s=one.workspace.getState()
  s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'})
  const src=await one.files.saveFile(new Blob([new Uint8Array(data)],{type:'application/pdf'}),'register.pdf')
  const id=s.createPage({title:'Complete source test',parentId:null})
  s.setContent(id,{type:'doc',content:[{type:'fileBlock',attrs:{name:'register.pdf',src,size:data.length,display:'file'}}]},'e2e')
  return id
 },Array.from(bytes))
 await flush(page);await gotoPage(page,id)
 await page.getByTestId('file-ai-key').click()
 await page.getByRole('menuitem',{name:'Read and analyse complete file',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Read and analyse a complete file',exact:true})
 await dialog.getByRole('button',{name:'Read entire file',exact:true}).click()
 await expect(dialog.getByText('Read: 137/137',{exact:true})).toBeVisible({timeout:30000})
 return {id,dialog}
}
test('complete 137-page source survives host extraction, bounded model slices, and ONE readback',async({page,context})=>{
 test.setTimeout(180000)
 const prompts:string[]=[]
 await context.route('https://api.anthropic.com/**',async route=>{
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const b=route.request().postDataJSON(),content=b.messages[0].content
  const prompt=typeof content==='string'?content:content.map((p:any)=>p.text??'').join('\n');prompts.push(prompt)
  const entries=[...prompt.matchAll(/\[Page (\d+)\]\n([\s\S]*?)(?=\n\n\[Page |$)/g)]
  const answer={summary:'Reviewed source slice',findings:entries.filter(x=>!x[2].startsWith('[No extractable')).map(x=>({page:+x[1],quote:x[2].trim().slice(0,Math.min(80,x[2].trim().length)),finding:'Source passage recorded for review.'})),limitations:['Mock model response: tests transport, coverage and quotation validation, not subject-matter quality.']}
  await route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({id:'msg_source',type:'message',role:'assistant',model:b.model,content:[{type:'text',text:JSON.stringify(answer)}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:100}})})
 })
 const {id,dialog}=await setup(page,realPath?readFileSync(realPath):pdfBytes(137,'Final page requirement: preserve every source page.',137))
 await dialog.getByRole('button',{name:'Analyse / Resume',exact:true}).click()
 await expect(dialog.getByRole('status')).toHaveText('All text sections analysed · human review pending',{timeout:120000})
 const pages=await wsEval(page,s=>Object.values(s.pages))
 const root=pages.find(p=>p.parentId===id&&p.title.includes('Complete source'))!
 expect(root).toBeTruthy();expect(root.plain).toContain('137/137');expect(root.plain).toContain('No Atlas writes')
 const originals=pages.filter(p=>p.parentId===root.id&&p.title.startsWith('Original pages'))
 expect(originals).toHaveLength(14)
 expect(originals.find(p=>p.title==='Original pages 131–137')!.plain).toContain('PDF page 137')
 expect(prompts.join('\n')).toContain('[Page 137]')
 if(realPath){expect(root.plain).toContain('b04cb4287c23006cf610260319a8db6730a8a377ed0f4994b81efdd2df054d56');expect(prompts.length).toBeGreaterThan(15);expect(originals.at(-1)!.plain).toContain('9 Others')}
 const before=pages.length
 await dialog.getByRole('button',{name:'Save source / checkpoint in ONE',exact:true}).click()
 expect(await wsEval(page,s=>Object.keys(s.pages).length)).toBe(before)
 if(realPath)writeFileSync('/tmp/one-file-source-real-pdf-test.json',JSON.stringify({file:realPath,source:root.plain,originalPages:originals.length,modelSlices:prompts.length,pages137:true,model:'mock - subject matter not verified'},null,2))
 await page.screenshot({path:'.shots/file-source-complete.png'})
 // A fresh dialog resumes verified analysis chunks from the same source hash.
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await page.getByTestId('file-ai-key').click()
 await page.getByRole('menuitem',{name:'Read and analyse complete file',exact:true}).click()
 await dialog.getByRole('button',{name:'Read entire file',exact:true}).click()
 await expect(dialog.getByText(`Analysed: ${prompts.length}/${prompts.length}`,{exact:true})).toBeVisible()
 const sent=prompts.length
 await dialog.getByRole('button',{name:'Analyse / Resume',exact:true}).click()
 await expect(dialog.getByRole('status')).toHaveText('All text sections analysed · human review pending')
 expect(prompts).toHaveLength(sent)
})
test('137-page PDF with blank pages stays explicitly incomplete for OCR and can be saved without model use',async({page})=>{
 const {id,dialog}=await setup(page,pdfBytes(137,'Last page survives the old 100-page cap.',137))
 await expect(dialog.getByRole('alert')).toContainText('No text on pages: 1, 2, 3')
 await dialog.getByRole('button',{name:'Save source / checkpoint in ONE',exact:true}).click()
 const root=await wsEval(page,(s,id)=>Object.values(s.pages).find(p=>p.parentId===id&&p.title.includes('Complete source')),id)
 expect(root!.plain).toContain('OCR needed');expect(root!.plain).toContain('Analysis: 0/')
})

test('invalid quotations stop completion; resume succeeds; an unevidenced Atlas answer is not counted',async({page,context})=>{
 const {sse}=await import('./fixtures')
 let attempts=0
 await context.route('https://api.anthropic.com/**',async route=>{
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const b=route.request().postDataJSON()
  if(b.stream)return route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:sse('Everything matches Atlas. No tools needed.')})
  attempts++
  const result={summary:'Analysis',findings:[{page:137,quote:attempts===1?'Invented quotation that does not occur.':'Last page survives the old 100-page cap.',finding:'Preserve all pages.'}],limitations:[]}
  return route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({id:'msg',type:'message',role:'assistant',model:b.model,content:[{type:'text',text:JSON.stringify(result)}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:100}})})
 })
 const {dialog}=await setup(page,pdfBytes(137,'Last page survives the old 100-page cap.',137))
 await dialog.getByLabel('Use result').selectOption('both')
 await dialog.getByRole('button',{name:'Analyse / Resume',exact:true}).click()
 await expect(dialog.getByText(/unverified page quotation/)).toBeVisible()
 await expect(dialog.getByText('Analysed: 0/1',{exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Analyse / Resume',exact:true}).click()
 await expect(dialog.getByText(/Atlas comparison is not evidenced/)).toBeVisible()
 await expect(dialog.getByText('Analysed: 1/1',{exact:true})).toBeVisible()
 await expect(dialog.getByText('Atlas: 0/1',{exact:true})).toBeVisible()
 expect(attempts).toBe(2)
})
