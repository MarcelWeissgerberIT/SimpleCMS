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
test('known gap: simultaneous offline mock notes must both survive reconnect',async({page:a,context})=>{
 await signIn(a,email('journal-owner'));const ws=await createWorkspace(a,'Journal audit');await openApp(a,ws);await waitOnline(a)
 const document='<html><body><button data-ds-component="Button">Submit</button><button data-ds-component="Button">Cancel</button></body></html>'
 const id=await wsEval(a,(s,spec)=>s.createPage({title:'Offline journal audit',content:{type:'doc',content:[{type:'designMock',attrs:{id:'journal-audit',spec},content:[{type:'paragraph'}]}]}}),{source:'https://aj-atlas.com/r/12',request:'Controls',preview:{title:'Controls',document,width:640,height:320,createdAt:'2026-11-08',htmlHash:createHash('sha256').update(document).digest('hex'),targetUrl:''}})
 const b=await newPerson(context);await signIn(b,email('journal-reviewer'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 for(const p of [a,b])await gotoPage(p,id)
 await a.context().setOffline(true);await b.context().setOffline(true)
 await compose(a,'Submit','Owner offline note');await mock(a).getByRole('button',{name:'Save note',exact:true}).click()
 await compose(b,'Cancel','Reviewer offline note');await mock(b).getByRole('button',{name:'Save note',exact:true}).click()
 const before={a:await notes(a,id),b:await notes(b,id)}
 expect(before).toEqual({a:['Owner offline note'],b:['Reviewer offline note']})
 await a.context().setOffline(false);await b.context().setOffline(false)
 await waitOnline(a);await waitOnline(b)
 await expect.poll(async()=>JSON.stringify(await notes(a,id))===JSON.stringify(await notes(b,id))).toBe(true)
 await a.waitForTimeout(1000)
 const after={a:await notes(a,id),b:await notes(b,id)}
 await test.info().attach('offline-journal-observation',{body:JSON.stringify({before,after},null,2),contentType:'application/json'})
 test.fail(true,'Mock journal is one last-writer-wins attribute; track the gap until entries have independent merge semantics.')
 expect(after.a.slice().sort()).toEqual(['Owner offline note','Reviewer offline note'])
 expect(after.b.slice().sort()).toEqual(['Owner offline note','Reviewer offline note'])
})
