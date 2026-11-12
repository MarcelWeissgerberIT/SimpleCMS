import {test,expect,email,signIn,createWorkspace,openApp,waitOnline,gotoPage,wsEval} from './fixtures'
import {pdfBytes} from '../e2e/helpers/files'
test('complete file pages remain nested beneath their private source in a team workspace',async({page,context})=>{
 test.setTimeout(120000)
 let modelCalls=0
 await context.route('https://api.anthropic.com/**',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, GET','content-type':'application/json'}
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers})
  modelCalls++
  await route.fulfill({status:200,headers,body:JSON.stringify({id:'msg_cloud_source',type:'message',role:'assistant',model:route.request().postDataJSON().model,content:[{type:'text',text:JSON.stringify({summary:'Checked section '+modelCalls,findings:[],limitations:['Mock analysis for cloud persistence verification.']})}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:100}})})
 })
 await signIn(page,email('file-source-private'))
 const workspace=await createWorkspace(page,'Private complete source')
 await openApp(page,workspace);await waitOnline(page)
 const id=await page.evaluate(async(data:number[])=>{
  const one=(window as any).__one
  const src=await one.files.saveFile(new Blob([new Uint8Array(data)],{type:'application/pdf'}),'private-source.pdf')
  const id=one.cloud.createPrivatePage({title:'Private source parent'})
  return {id,src}
 },Array.from(pdfBytes(137,Array(5).fill('Final private page text').join(') Tj 0 -20 Td ('),'all')))
 await wsEval(page,(s,{id,src})=>s.setContent(id,{type:'doc',content:[{type:'fileBlock',attrs:{name:'private-source.pdf',src,display:'file'}}]},'e2e'),id)
 await gotoPage(page,id.id)
 await page.getByTestId('file-ai-key').click()
 await page.getByRole('menuitem',{name:'Read and analyse complete file',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Read and analyse a complete file',exact:true})
 await dialog.getByRole('button',{name:'Read entire file',exact:true}).click()
 await expect(dialog.getByText('Read: 137/137',{exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Save source / checkpoint in ONE',exact:true}).click()
 const result=await wsEval(page,(s,parent)=>{
  const root=Object.values(s.pages).find(p=>p.parentId===parent&&p.title.includes('Complete source'))!
  return {root,children:Object.values(s.pages).filter(p=>p.parentId===root?.id)}
 },id.id)
 expect(result.root.private).toBe(true)
 expect(result.children).toHaveLength(14)
 expect(result.children.every(p=>p.private)).toBe(true)
 expect(result.children.find(p=>p.title==='Original pages 131–137')?.plain).toContain('Final private page text')
 const reader=await page.context().newPage()
 await openApp(reader,workspace);await waitOnline(reader);await gotoPage(reader,result.root.id)
 await expect(reader.getByRole('main')).toContainText('137/137 pages processed')
 await expect(reader.getByRole('main')).not.toContainText('Saving source…')
 await reader.close()
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 await dialog.getByRole('button',{name:'Analyse / Resume',exact:true}).click()
 await expect(dialog.getByRole('status')).toHaveText('All text sections analysed · human review pending',{timeout:60000})
 expect(modelCalls).toBeGreaterThan(1)
 const readback=await page.context().newPage()
 await openApp(readback,workspace);await waitOnline(readback);await gotoPage(readback,result.root.id)
 await expect(readback.getByRole('main')).toContainText(`Analysis: ${modelCalls}/${modelCalls}`)
 const persisted=await wsEval(readback,(s,parent)=>Object.values(s.pages).filter(p=>p.parentId===parent),id.id)
 expect(persisted.filter(p=>p.title.includes('Complete source'))).toHaveLength(1)
 const checkpoint=persisted.find(p=>p.title==='File analysis · checkpoint')!
 await gotoPage(readback,checkpoint.id)
 await expect.poll(async()=>await wsEval(readback,(s,id)=>s.pages[id].content?.content?.filter(n=>n.type==='codeBlock').length,checkpoint.id)).toBe(1)
 const checkpointText=await wsEval(readback,(s,id)=>s.pages[id].content!.content!.find(n=>n.type==='codeBlock')!.content![0].text!,checkpoint.id)
 expect(Object.keys(JSON.parse(checkpointText).analyses)).toHaveLength(modelCalls)
 await readback.close()
})
