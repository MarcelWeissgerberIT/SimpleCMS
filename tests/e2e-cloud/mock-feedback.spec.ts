import {createHash} from 'node:crypto'
import type {Page} from '@playwright/test'
import {test,expect,api,email,signIn,newPerson,openApp,waitOnline,wsEval,gotoPage,createWorkspace,join} from './fixtures'
const errors:string[]=[]
function watch(p:Page){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/.test(m.text()))errors.push(m.text())})}
test.beforeEach(()=>{errors.length=0})
test.afterEach(()=>{expect(errors,'browser errors').toEqual([])})
const mock=(p:Page)=>p.locator('.mock-block')
const notes=(p:Page,id:string)=>wsEval(p,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='designMock').attrs.spec.journal?.notes.map((n:any)=>n.text)??[],id)
async function compose(p:Page,target:string,text:string){
 await mock(p).getByRole('tab',{name:'Mock',exact:true}).click()
 await mock(p).getByRole('button',{name:'Mark element',exact:true}).click()
 await p.frameLocator('.mock-block__preview iframe').getByRole('button',{name:target,exact:true}).click()
 await mock(p).getByRole('button',{name:'Write note for selection',exact:true}).click()
 await mock(p).getByRole('textbox',{name:'Note on selected element',exact:true}).fill(text)
}
test('online feedback coexists with a colleague’s draft and permission changes preserve pending input',async({page:a,context})=>{
 watch(a);await signIn(a,email('mock-owner'));const ws=await createWorkspace(a,'Mock review team');await openApp(a,ws);await waitOnline(a)
 const document='<html><body><button data-ds-component="Button">Submit</button><button data-ds-component="Button">Cancel</button></body></html>'
 const id=await wsEval(a,(s,spec)=>s.createPage({title:'Team mock feedback',content:{type:'doc',content:[{type:'designMock',attrs:{id:'team-mock',spec},content:[{type:'paragraph',content:[{type:'text',text:'Protocol controls'}]}]}]}}),{source:'https://aj-atlas.com/r/12',request:'Protocol controls',preview:{title:'Protocol review',document,width:640,height:320,createdAt:'2026-11-08',htmlHash:createHash('sha256').update(document).digest('hex'),targetUrl:''}})
 const b=await newPerson(context);watch(b);await signIn(b,email('mock-reviewer'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 for(const p of [a,b])await gotoPage(p,id)
 await compose(a,'Submit','Confirm the action before submitting.')
 await compose(b,'Cancel','Keep cancelling available.')
 await mock(b).getByRole('button',{name:'Save note',exact:true}).click()
 await expect.poll(()=>notes(a,id)).toEqual(['Keep cancelling available.'])
 await expect(mock(a).getByRole('textbox',{name:'Note on selected element',exact:true})).toHaveValue('Confirm the action before submitting.')
 await mock(a).getByRole('button',{name:'Save note',exact:true}).click()
 await expect.poll(()=>notes(b,id)).toEqual(['Keep cancelling available.','Confirm the action before submitting.'])
 await compose(b,'Cancel','Use a secondary button style.')
 const field=mock(b).getByRole('textbox',{name:'Note on selected element',exact:true})
 const member=(await api<{user:{id:string}}>(b,'GET','/api/me')).json.user.id
 expect((await api(a,'PATCH',`/api/workspaces/${ws}/members/${member}`,{role:'viewer'})).status).toBe(200)
 await expect(field).toBeDisabled();await expect(field).toHaveValue('Use a secondary button style.')
 await expect(mock(b).getByRole('button',{name:'Save note',exact:true})).toBeDisabled()
 expect(await notes(a,id)).toHaveLength(2)
 expect((await api(a,'PATCH',`/api/workspaces/${ws}/members/${member}`,{role:'member'})).status).toBe(200)
 await expect(field).toBeEnabled();await mock(b).getByRole('button',{name:'Save note',exact:true}).click()
 await expect.poll(()=>notes(a,id)).toEqual(['Keep cancelling available.','Confirm the action before submitting.','Use a secondary button style.'])
})


test('a colleague changing the preview keeps pending feedback visible until targets are selected again',async({page:a,context})=>{
 watch(a);await signIn(a,email('preview-owner'));const ws=await createWorkspace(a,'Preview changes');await openApp(a,ws);await waitOnline(a)
 const document='<html><body><button data-ds-component="Button">Submit</button></body></html>'
 const id=await wsEval(a,(s,spec)=>s.createPage({title:'Preview change',content:{type:'doc',content:[{type:'designMock',attrs:{id:'preview-change',spec},content:[{type:'paragraph'}]}]}}),{source:'https://aj-atlas.com/r/12',request:'Controls',preview:{title:'Controls',document,width:640,height:320,createdAt:'2026-11-08',htmlHash:createHash('sha256').update(document).digest('hex'),targetUrl:''}})
 const b=await newPerson(context);watch(b);await signIn(b,email('preview-editor'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 for(const p of [a,b])await gotoPage(p,id)
 await compose(a,'Submit','Confirm before submitting.')
 await expect(a.locator('.mock-block__preview iframe')).toHaveAttribute('sandbox','allow-same-origin')
 const nextDocument=document.replace('Submit','Send')
 await wsEval(b,(s,{id,document,hash})=>{const content=structuredClone(s.pages[id].content);const spec=content.content[0].attrs.spec;spec.preview={...spec.preview,document,htmlHash:hash};s.setContent(id,content,'test')},{id,document:nextDocument,hash:createHash('sha256').update(nextDocument).digest('hex')})
 const field=mock(a).getByRole('textbox',{name:'Note on selected element',exact:true})
 await expect(mock(a).getByText('The previous selection is no longer active.',{exact:false})).toBeVisible()
 await expect(field).toHaveValue('Confirm before submitting.')
 await expect(mock(a).getByRole('button',{name:'Save note',exact:true})).toBeDisabled()
 expect(await notes(a,id)).toEqual([])
 await mock(a).getByRole('tab',{name:'Mock',exact:true}).click()
 // Marking remains enabled; explicitly select a target in the new preview.
 await a.frameLocator('.mock-block__preview iframe').getByRole('button',{name:'Send',exact:true}).click()
 await mock(a).getByRole('button',{name:'Write note for selection',exact:true}).click()
 await expect(field).toHaveValue('Confirm before submitting.')
 await mock(a).getByRole('button',{name:'Save note',exact:true}).click()
 await expect.poll(()=>notes(b,id)).toEqual(['Confirm before submitting.'])
 await compose(a,'Send','Discard this pending draft.')
 await mock(a).locator('.mock-review__compose').getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(field).toHaveCount(0)
 expect(await notes(b,id)).toEqual(['Confirm before submitting.'])
})
