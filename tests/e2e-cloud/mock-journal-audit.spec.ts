import {createHash} from 'node:crypto'
import type {Page} from '@playwright/test'
import {test,expect,api,email,signIn,newPerson,openApp,waitForApp,waitOnline,wsEval,gotoPage,createWorkspace,join} from './fixtures'
const errors:string[]=[]
function watch(p:Page){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&m.text()!=='Failed to load resource: net::ERR_INTERNET_DISCONNECTED'&&!/^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/.test(m.text()))errors.push(m.text())})}
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
for(const reverse of [false,true])test(`simultaneous offline mock notes survive reconnect ${reverse?'reviewer first':'owner first'}`,async({page:a,context})=>{
 watch(a);await signIn(a,email('journal-owner'));const ws=await createWorkspace(a,'Journal audit');await openApp(a,ws);await waitOnline(a)
 const document='<html><body><button data-ds-component="Button">Submit</button><button data-ds-component="Button">Cancel</button></body></html>'
 const id=await wsEval(a,(s,spec)=>s.createPage({title:'Offline journal audit',content:{type:'doc',content:[{type:'designMock',attrs:{id:'journal-audit',spec},content:[{type:'paragraph'}]}]}}),{source:'https://aj-atlas.com/r/12',request:'Controls',preview:{title:'Controls',document,width:640,height:320,createdAt:'2026-11-08',htmlHash:createHash('sha256').update(document).digest('hex'),targetUrl:''}})
 const b=await newPerson(context);watch(b);await signIn(b,email('journal-reviewer'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 for(const p of [a,b])await gotoPage(p,id)
 await a.context().setOffline(true);await b.context().setOffline(true)
 await compose(a,'Submit','Owner offline note');await mock(a).getByRole('button',{name:'Save note',exact:true}).click()
 await compose(b,'Cancel','Reviewer offline note');await mock(b).getByRole('button',{name:'Save note',exact:true}).click()
 const before={a:await notes(a,id),b:await notes(b,id)}
 expect(before).toEqual({a:['Owner offline note'],b:['Reviewer offline note']})
 for(const p of reverse?[b,a]:[a,b]){await p.context().setOffline(false);await waitOnline(p)}
 await waitOnline(a);await waitOnline(b)
 await expect.poll(async()=>JSON.stringify(await notes(a,id))===JSON.stringify(await notes(b,id))).toBe(true)
 await a.waitForTimeout(1000)
 const after={a:await notes(a,id),b:await notes(b,id)}
 await test.info().attach('offline-journal-observation',{body:JSON.stringify({before,after},null,2),contentType:'application/json'})
 expect(after.a.slice().sort()).toEqual(['Owner offline note','Reviewer offline note'])
 expect(after.b.slice().sort()).toEqual(['Owner offline note','Reviewer offline note'])
 for(const p of [a,b]){await p.reload();await waitForApp(p);await waitOnline(p);await gotoPage(p,id)}
 await expect.poll(async()=>(await notes(b,id)).slice().sort()).toEqual(['Owner offline note','Reviewer offline note'])
 for(const p of [a,b])await mock(p).getByRole('tab',{name:'Notes',exact:true}).click()
 await a.context().setOffline(true);await b.context().setOffline(true)
 const owner=(p:Page)=>mock(p).locator('.mock-review__notes li').filter({hasText:'Owner offline note'})
 await owner(a).getByRole('button',{name:'Mark mock resolved',exact:true}).click()
 await owner(b).getByRole('button',{name:'Queue MD change',exact:true}).click()
 for(const p of reverse?[a,b]:[b,a]){await p.context().setOffline(false);await waitOnline(p)}
 for(const p of [a,b])await expect.poll(()=>wsEval(p,(s,id)=>{const n=s.pages[id].content.content.find((n:any)=>n.type==='designMock').attrs.spec.journal.notes.find((n:any)=>n.text==='Owner offline note');return {resolved:n.resolved,md:n.md}},id)).toEqual({resolved:true,md:'pending'})
 // Undo the owner's status edit without removing the other person's queued MD decision.
 await mock(a).locator('[data-node-view-content] p').first().click()
 await a.keyboard.press('ControlOrMeta+z')
 await expect.poll(()=>wsEval(a,(s,id)=>{const n=s.pages[id].content.content.find((n:any)=>n.type==='designMock').attrs.spec.journal.notes.find((n:any)=>n.text==='Owner offline note');return {resolved:n.resolved,md:n.md}},id)).toEqual({resolved:false,md:'pending'})
 if(!reverse){await mock(a).scrollIntoViewIfNeeded();await mock(a).locator('.mock-review__notes').screenshot({path:'/tmp/one-offline-mock-notes.png'})}

})
