import {test,expect,api,email,signIn,newPerson,openApp,waitOnline,wsEval,gotoPage,createWorkspace,join} from './fixtures'
import {analysisFixture} from '../e2e/helpers/codeAnalysisStory.mjs'

test('shared review task is visible to a colleague and opens its pinned finding; budget stays owner-only',async({page:a,context})=>{
 await signIn(a,email('continuity-owner'));const ws=await createWorkspace(a,'Review team');await openApp(a,ws);await waitOnline(a)
 const setup=await api(a,'PUT',`/api/workspaces/${ws}/central-ai`,{version:0,label:'Team Claude',workspaces:[ws],budgetUsd:400,enabled:false});expect(setup.status).toBe(200)
 const id=await wsEval(a,(s,raw)=>s.createPage({title:'Shared review source',content:{type:'doc',content:[{type:'codeBlock',attrs:{id:'shared-source',language:'code-analysis'},content:[{type:'text',text:raw}]}]}}),JSON.stringify(analysisFixture(true)))
 const b=await newPerson(context);await signIn(b,email('continuity-reviewer'));await join(a,b,ws);await openApp(b,ws);await waitOnline(b)
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],id)).toBe(true)
 await gotoPage(a,id);const report=a.getByRole('region',{name:'Code analysis',exact:true});await report.getByRole('tab',{name:'Findings',exact:true}).click();await report.getByRole('button',{name:'Create linked review task'}).click()
 const child=await wsEval(a,(s,id)=>Object.values(s.pages).find((p:any)=>p.parentId===id)?.id,id);expect(child).toBeTruthy()
 await expect.poll(()=>wsEval(b,(s,id)=>!!s.pages[id],child)).toBe(true)
 await gotoPage(b,child);await expect(b.locator('.workitem')).toBeVisible();await expect(b.getByRole('heading',{name:'Decision and rationale'})).toBeVisible()
 await b.getByRole('link',{name:'Open original finding and revision'}).click();await expect(b).toHaveURL(/work-revision=revision-one/);await expect(b.getByRole('region',{name:'Code analysis',exact:true}).getByRole('tab',{name:'Findings',exact:true})).toHaveAttribute('aria-selected','true')
 const central=(await api<any>(a,'GET',`/api/workspaces/${ws}/central-ai`)).json
 await a.route(`**/api/workspaces/${ws}/central-ai`,r=>r.fulfill({json:{...central,spentUsd:50.6,heldUsd:25.68}}))
 for(const p of [a,b]){await p.locator('.sb-nav').getByRole('button',{name:'Work overview',exact:true}).click();await p.getByRole('dialog',{name:'Work overview'}).getByRole('button',{name:'Runs & cost',exact:true}).click()}
 const owner=a.getByRole('region',{name:'Budget before starting'}),member=b.getByRole('region',{name:'Budget before starting'})
 await expect(owner).toContainText('$400.00');await expect(owner).toContainText('Reserved');await expect(owner).toContainText('Available');await expect(owner).toContainText('$323.72');await expect(owner).toContainText('$25.68')
 await expect(member).toContainText('Budget details are available to its owner');await expect(member).not.toContainText('$400.00')
})
