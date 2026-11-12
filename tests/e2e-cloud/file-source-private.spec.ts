import {test,expect,email,signIn,createWorkspace,openApp,waitOnline,gotoPage,wsEval} from './fixtures'
import {pdfBytes} from '../e2e/helpers/files'
test('complete file pages remain nested beneath their private source in a team workspace',async({page})=>{
 await signIn(page,email('file-source-private'))
 const workspace=await createWorkspace(page,'Private complete source')
 await openApp(page,workspace);await waitOnline(page)
 const id=await page.evaluate(async(data:number[])=>{
  const one=(window as any).__one
  const src=await one.files.saveFile(new Blob([new Uint8Array(data)],{type:'application/pdf'}),'private-source.pdf')
  const id=one.cloud.createPrivatePage({title:'Private source parent'})
  return {id,src}
 },Array.from(pdfBytes(137,'Final private page text',137)))
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
})
