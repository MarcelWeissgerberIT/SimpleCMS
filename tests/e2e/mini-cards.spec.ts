import {createHash} from 'node:crypto'
import type {Page as BrowserPage} from '@playwright/test'
import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,flush,reloadApp,editorOf,mockClaude} from './fixtures'

const text='SSO ist noch nicht freigegeben. Das Team muss die Antwort abstimmen. Die Backup-Nachweise müssen vor dem Versand geprüft werden.'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const mini=(page:BrowserPage)=>page.getByRole('region',{name:'Mini Cards',exact:true})
const switcher=(page:BrowserPage)=>page.getByRole('group',{name:'Page view',exact:true})
async function seed(page:BrowserPage){
 await openApp(page)
 const id=await createPage(page,{title:'Antworten prüfen – Mini Cards',content:doc(para(text))})
 await gotoPage(page,id);await flush(page)
 const snapshot=await wsEval(page,(s,id)=>({title:s.pages[id].title,content:s.pages[id].content}),id)
 const sourceId=snapshot.content.content[0].attrs?.id??'block:0'
 const base={role:'',options:[],doneWhen:'',sourceId,quote:text}
 const items=[
  {...base,kind:'summary',title:'Antworten vor dem Versand klären',detail:'Die Analyse enthält offene Aussagen zu SSO und Backups.'},
  {...base,kind:'decision',title:'SSO-Antwort freigeben?',detail:'Das Team muss den Stand der Anmeldung bestätigen.',options:['Freigabe nach Prüfung','Zur Klärung zurückstellen']},
  {...base,kind:'action',title:'Backup-Nachweise prüfen',detail:'Die Belege zu Verschlüsselung und Zeitplan vor dem Versand prüfen.',role:'Fachseite',doneWhen:'Die Belege sind mit der Antwort verknüpft.'},
 ].map(item=>({...item,id:hash(JSON.stringify([item.kind,sourceId,text]))}))
 const overview={version:1,signature:hash(JSON.stringify([snapshot.title,snapshot.content])),at:Date.now(),language:'en',items}
 await wsEval(page,(s,a)=>s.updatePage(a.id,{overview:a.overview}),{id,overview})
 await switcher(page).getByRole('button',{name:'Mini Cards',exact:true}).click()
 await expect(mini(page).locator('.mini-card-trigger')).toHaveCount(3)
 return {id,overview,snapshot}
}

test('six card sizes reuse cached content and remember personal page preferences',async({page})=>{
 const {id,overview,snapshot}=await seed(page)
 await expect(mini(page).getByRole('combobox',{name:'Card size',exact:true})).toHaveValue('64')
 for(const size of [8,16,32,64,128,256]){
  await mini(page).getByRole('combobox',{name:'Card size',exact:true}).selectOption(String(size))
  const boxes=await mini(page).locator('.mini-card-face').evaluateAll(elements=>elements.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})))
  expect(boxes).toEqual(Array(3).fill({width:size,height:size}))
 }
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toEqual(overview)
 expect(await wsEval(page,(s,id)=>s.pages[id].content,id)).toEqual(snapshot.content)
 await reloadApp(page)
 await expect(switcher(page).getByRole('button',{name:'Mini Cards'})).toHaveAttribute('aria-pressed','true')
 await expect(mini(page).getByRole('combobox',{name:'Card size',exact:true})).toHaveValue('256')
 const other=await createPage(page,{title:'Andere Seite',content:doc(para(text))});await gotoPage(page,other)
 await expect(switcher(page).getByRole('button',{name:'Document',exact:true})).toHaveAttribute('aria-pressed','true')
 await gotoPage(page,id);await expect(mini(page).getByRole('combobox',{name:'Card size',exact:true})).toHaveValue('256')
})

test('tiny cards open complete details by keyboard and return focus on close',async({page})=>{
 await seed(page);await mini(page).getByRole('combobox',{name:'Card size',exact:true}).selectOption('8')
 const card=mini(page).getByRole('button',{name:/SSO-Antwort freigeben/})
 await card.focus();await page.keyboard.press('Enter')
 const details=mini(page).getByRole('region',{name:'Card details',exact:true})
 await expect(details).toBeFocused();await expect(details).toContainText('Das Team muss den Stand der Anmeldung bestätigen.')
 await details.getByText('Source passage',{exact:true}).click();await expect(details.locator('blockquote')).toHaveText(text)
 await details.getByRole('button',{name:'Close details'}).click();await expect(card).toBeFocused();await expect(details).toHaveCount(0)
 await card.click();await details.getByRole('button',{name:'Show passage in document'}).click()
 await expect(editorOf(page)).toBeVisible();await expect(editorOf(page)).toContainText(text)
})

test('mini cards share follow-up records and decisions with the overview',async({page})=>{
 const {id}=await seed(page)
 await mini(page).getByRole('button',{name:/SSO-Antwort freigeben/}).click()
 const details=mini(page).getByRole('region',{name:'Card details'})
 await details.getByRole('checkbox',{name:/Select for follow-up/}).check()
 await mini(page).getByRole('button',{name:'Track selected (1)',exact:true}).click()
 await expect(details.getByRole('link',{name:'Open tracked item',exact:true})).toBeVisible()
 await details.getByRole('button',{name:'Review and record'}).click()
 await details.getByLabel('Decision or feedback').fill('SSO bleibt bis zur Klärung offen.')
 await details.getByRole('button',{name:'Confirm',exact:true}).click()
 await switcher(page).getByRole('button',{name:'Overview',exact:true}).click()
 const full=page.getByRole('region',{name:'Page overview',exact:true})
 await expect(full).toContainText('SSO bleibt bis zur Klärung offen.')
 await expect(full.getByRole('link',{name:'Open tracked item',exact:true})).toHaveCount(1)
 expect(await wsEval(page,(s,id)=>Object.values(s.pages).filter((p:any)=>p.overviewFollowUp?.pageId===id&&p.overviewFollowUp.itemId).length,id)).toBe(1)
})

test('stale and read-only mini cards keep sources readable but prevent adoption',async({page})=>{
 const {id}=await seed(page)
 await mini(page).getByRole('button',{name:/Backup-Nachweise prüfen/}).click()
 await wsEval(page,(s,id)=>s.updatePage(id,{title:'Geänderter Seitenstand'}),id)
 await expect(mini(page).getByRole('status')).toContainText('older version')
 await expect(mini(page).getByRole('checkbox',{name:/Select for follow-up/})).toHaveCount(0)
 await expect(mini(page).getByRole('button',{name:'Adopt as task'})).toHaveCount(0)
 await expect(mini(page).getByRole('button',{name:'Show passage in document'})).toBeVisible()
 await wsEval(page,(s,id)=>s.updatePageSettings(id,{locked:true}),id)
 await expect(mini(page).getByRole('button',{name:'Update overview',exact:true})).toHaveCount(0)
})

test('empty pages explain the shared overview and do not start generation on opening',async({page})=>{
 await openApp(page);const id=await createPage(page,{title:'Noch ohne Überblick',content:doc(para(text))});await gotoPage(page,id)
 await switcher(page).getByRole('button',{name:'Mini Cards',exact:true}).click()
 await expect(mini(page)).toContainText('Create the overview once')
 await expect(mini(page).getByRole('button',{name:'Create overview',exact:true})).toBeEnabled()
 expect(await wsEval(page,(s,id)=>s.pages[id].overview,id)).toBeUndefined()
 await expect(mini(page).locator('.mini-card-trigger')).toHaveCount(0)
})

test('creation from Mini Cards produces one shared overview',async({page,context},testInfo)=>{
 const calls=await mockClaude(context,raw=>{
  const body=JSON.parse(raw),content=body.messages[0].content
  const prompt=typeof content==='string'?content:content.find((part:any)=>part.type==='text').text
  const source=JSON.parse(prompt).sources.find((item:any)=>item.text.includes('SSO'))
  return JSON.stringify({items:[{kind:'summary',title:'Antworten vor Versand prüfen',detail:'Die Seite nennt offene Fragen zu Anmeldung und Backups.',role:'',doneWhen:'',options:[],sourceId:source.id,quote:source.text},{kind:'decision',title:'SSO-Antwort abstimmen',detail:'Das Team muss die Antwort vor dem Versand abstimmen.',role:'Fachseite',doneWhen:'',options:['Prüfen','Zurückstellen'],sourceId:source.id,quote:source.text}]})
 })
 await openApp(page)
 const id=await createPage(page,{title:'Antworten prüfen',content:doc(para(text))});await gotoPage(page,id);await flush(page)
 await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}))
 await switcher(page).getByRole('button',{name:'Mini Cards',exact:true}).click()
 await mini(page).getByRole('button',{name:'Create overview',exact:true}).click()
 await expect(mini(page).locator('.mini-card-trigger')).toHaveCount(2)
 await switcher(page).getByRole('button',{name:'Overview',exact:true}).click()
 await expect(page.getByRole('region',{name:'Page overview'})).toContainText('SSO-Antwort abstimmen')
 await switcher(page).getByRole('button',{name:'Mini Cards',exact:true}).click()
 await mini(page).getByRole('combobox',{name:'Card size',exact:true}).selectOption('256')
 await expect(mini(page).locator('.mini-card-context').last()).toContainText('vor dem Versand')
 expect(calls).toHaveLength(1)
 await wsEval(page,s=>s.updateSettings({language:'de'}))
 await page.locator('.pv-title').scrollIntoViewIfNeeded()
 await page.screenshot({path:testInfo.outputPath('mini-cards-desktop-256.png'),animations:'disabled'})
})

test.describe('touch screens',()=>{
 test.use({hasTouch:true})
 test('mobile cards fit all sizes, keep touch targets usable, and use One themes',async({page},testInfo)=>{
 await seed(page);await page.setViewportSize({width:390,height:844})
 await page.evaluate(()=>window.__one.ui.setState({mobileSidebarOpen:false}))
 for(const size of [8,16,32,64,128,256]){
  await mini(page).getByRole('combobox',{name:'Card size',exact:true}).selectOption(String(size))
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const overflow=await mini(page).locator('.mini-card-face').evaluateAll(els=>els.some(el=>el.scrollHeight>el.clientHeight+1))
  expect(overflow).toBe(false)
  const target=await mini(page).locator('.mini-card-trigger').first().boundingBox();expect(target!.width).toBeGreaterThanOrEqual(44);expect(target!.height).toBeGreaterThanOrEqual(44)
 }
 await mini(page).getByRole('combobox',{name:'Card size',exact:true}).selectOption('64')
 await page.locator('.pv-title').scrollIntoViewIfNeeded()
 await page.screenshot({path:testInfo.outputPath('mini-cards-mobile.png'),animations:'disabled'})
 await wsEval(page,s=>s.updateSettings({theme:'dark'}))
 await mini(page).getByRole('button',{name:/Backup-Nachweise prüfen/}).click()
 await expect(mini(page).getByRole('region',{name:'Card details'})).toBeVisible()
 await page.screenshot({path:testInfo.outputPath('mini-cards-mobile-dark-detail.png'),animations:'disabled'})
})

})
