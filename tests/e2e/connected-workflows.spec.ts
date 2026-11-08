import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,MOD} from './fixtures'
import {mockAgent,call,say,setKey,terminal,prompt} from './helpers/terminal'
import {analysisFixture} from './helpers/codeAnalysisStory.mjs'
import {qualityRecipe,QUALITY_CHECKS} from '../../src/app/features/ai/workflow/recipe'
import {compileProgram} from '../../src/shared/quandprofile/program'
import {readAnalysis} from '../../src/shared/codeAnalysis/model'
import {checkpointMock,mockVersionKey,readMockJournal} from '../../src/shared/ai/mockReview'
import {mockBlockData} from '../../src/shared/ai/mockBlock'
const schema={type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}
test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{schema_min:6}}));await page.route('**/api/session',r=>r.fulfill({json:{}}))})
test('all quality workflows compile; dangling finding links are rejected',()=>{
 for(const check of QUALITY_CHECKS){const p=qualityRecipe(check.id,['rules','mock'],schema);expect(()=>compileProgram(p)).not.toThrow();expect(p.steps.filter(s=>s.kind==='tool')).toHaveLength(2);expect(p.steps.at(-2)?.kind).toBe('decision')}
 const a:any=analysisFixture(true);a.revisions[0].reviews=[{finding:'missing',requirements:[],note:''}];expect(()=>readAnalysis(JSON.stringify(a))).toThrow('reference')
 a.revisions[0].reviews=[{finding:'f1',requirements:['missing'],note:''}];expect(()=>readAnalysis(JSON.stringify(a))).toThrow('reference')
})
test('starting source selection changes the actual next request without running a model while editing',async({page,context})=>{
 await openApp(page);await setKey(page)
 const original=await createPage(page,{title:'Exclude this source',content:doc(para('Original source'))})
 const chosen=await createPage(page,{title:'Selected design rules',content:doc(para('Require labelled inputs'))})
 await gotoPage(page,original);await page.keyboard.press(`${MOD}+j`)
 const mock=await mockAgent(context,[say('Prepared a scope review.')])
 await prompt(page).fill('Review the selected design context.')
 const pre=terminal(page).locator('.term-preflight');await pre.locator('summary').click()
 await pre.getByRole('button',{name:'Remove source: Exclude this source'}).click()
 await pre.getByLabel('Search sources').fill('Selected design')
 await pre.getByRole('button',{name:'Selected design rules',exact:true}).click()
 await expect(pre).toContainText('1 selected sources');expect(mock.bodies).toHaveLength(0)
 await prompt(page).press('Enter');await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 const sent=JSON.stringify(mock.bodies[0]);expect(sent).toContain(chosen);expect(sent).not.toContain('Open page: \"Exclude this source')
})
test('saved recovery shows retained draft and resumes with original page after navigation',async({page,context})=>{
 await openApp(page);await setKey(page)
 const original=await createPage(page,{title:'Original investigation',content:doc(para('Protocol requirements'))}),other=await createPage(page,{title:'Unrelated working page',content:doc(para('Unrelated notes'))})
 await gotoPage(page,original)
 const mock=await mockAgent(context,[call('read','read_page',{id:original}),say('RETAINED FINDING: validate the caller before changing the UI.'),say('Continued the original read-only investigation.')])
 await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('Analyse this protocol source.');await prompt(page).press('Enter');await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 await page.reload();await gotoPage(page,other);await page.keyboard.press(`${MOD}+j`)
 const shelf=terminal(page).locator('.term-saved-work');await shelf.locator(':scope > summary').click()
 await shelf.getByText('Review checkpoint and continuation',{exact:true}).click();await shelf.getByText('Saved draft · requires rechecking',{exact:true}).click()
 await expect(shelf).toContainText('RETAINED FINDING')
 await shelf.getByRole('button',{name:/Resume|Continue/}).click();await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
 const sent=JSON.stringify(mock.bodies.at(-1));expect(sent).toContain('Original investigation');expect(sent).not.toContain('Open page: \"Unrelated working page')
 expect(mock.bodies).toHaveLength(3)
})
test('quality check source picker prepares a reviewable workflow without execution',async({page,aiNet})=>{
 await openApp(page)
 const source=await createPage(page,{title:'Design source for quality check',content:doc(para('Use badges for status.'))});await gotoPage(page,source)
 await page.keyboard.press(`${MOD}+j`);await terminal(page).getByRole('button',{name:'Settings and tools',exact:true}).click();await terminal(page).getByRole('button',{name:'Work overview',exact:true}).click()
 const d=page.getByRole('dialog',{name:'Work overview'});await d.getByRole('button',{name:'Reuse',exact:true}).click();await d.getByLabel('Quality check',{exact:true}).selectOption('design');await d.getByRole('checkbox',{name:'Design source for quality check',exact:true}).check();await d.getByRole('button',{name:'Prepare quality check',exact:true}).click()
 const p=page.getByRole('dialog',{name:'Saved compiled programs'});await expect(p.locator('textarea')).toContainText('Compare the supplied mock documentation');await expect(p.locator('textarea')).toContainText(source);expect(aiNet.count('anthropic')).toBe(0)
})
test('finding links open the exact saved mock marking; partial review remains actionable',async({page,aiNet})=>{
 await openApp(page)
 const m=checkpointMock(mockBlockData({source:'https://aj-atlas.com/r/12',request:'Status mock',preview:{title:'Status mock',document:'<html><body><span data-ds-component="Badge">Ready</span></body></html>',width:960,height:640,createdAt:'2026-11-08',htmlHash:'0'.repeat(64),targetUrl:''}}),'Original')
 m.journal!.notes=[{id:'note-one',at:'2026-11-08',version:mockVersionKey(m.preview!),element:{path:'body > span',tag:'span',text:'Ready',component:'Badge',requirement:'',snippet:''},text:'Use a badge for this status',intent:'fix',scope:'mock',resolved:false,md:'none',appliedIn:mockVersionKey(m.preview!)}]
 const mockPage=await createPage(page,{title:'Linked status mock',content:doc({type:'designMock',attrs:{id:'mock-anchor',spec:m},content:[para('Status')]})})
 const id=await createPage(page,{title:'Linked analysis',content:doc({type:'codeBlock',attrs:{language:'code-analysis'},content:[{type:'text',text:JSON.stringify(analysisFixture(true))}]})});await gotoPage(page,id)
 const block=page.getByRole('region',{name:'Code analysis',exact:true});await block.getByRole('tab',{name:'Findings',exact:true}).click();await block.getByLabel('Link mock note').selectOption({label:'Linked status mock · Use a badge for this status'})
 await block.getByRole('button',{name:'Open mock marking',exact:true}).click();await expect(page.getByRole('dialog',{name:'Badge',exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp(mockPage))
 await page.keyboard.press('Escape');await page.getByLabel('Note fulfilment').selectOption('partial')
 await expect(page.getByLabel('Note fulfilment')).toHaveValue('partial')
 let saved=await wsEval(page,(s,id)=>s.pages[id].content.content.find((n:any)=>n.type==='designMock').attrs.spec,mockPage)
 expect(saved.journal.notes[0].resolved).toBe(false);expect(saved.journal.notes[0].appliedIn).toBeUndefined()
 expect(saved.journal.notes[0].reviewed.result).toBe('partial');expect(aiNet.count('anthropic')).toBe(0)
 await page.reload();await expect(page.getByRole('dialog',{name:'Badge',exact:true})).toBeVisible();await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Notes',exact:true}).click();await expect(page.getByLabel('Note fulfilment')).toHaveValue('partial')
})
