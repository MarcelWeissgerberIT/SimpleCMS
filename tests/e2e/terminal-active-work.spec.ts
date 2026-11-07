import {test,expect,openApp,createPage,gotoPage,wsEval,doc,para,MOD} from './fixtures'
import {mockAgent,call,say,setKey,terminal,prompt} from './helpers/terminal'

const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release}}
test.beforeEach(async({page})=>{await page.route('**/api/config',r=>r.fulfill({json:{schema_min:6}}));await page.route('**/api/session',r=>r.fulfill({json:{}}))})

test('page switching retains task identity; background completion returns to its result without changing the open page',async({page,context},info)=>{
 await openApp(page);await setKey(page)
 const source=await createPage(page,{title:'Protocol requirements',content:doc(para('Inspect timeout handling.'))})
 const other=await createPage(page,{title:'Meeting notes',content:doc(para('Continue working here.'))})
 await gotoPage(page,source)
 const pending=gate()
 const mock=await mockAgent(context,[call('source','read_page',{id:source}),async()=>{await pending.promise;return say('Timeout analysis is ready for review.')()}])
 try{
  await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('Investigate protocol timeouts');await prompt(page).press('Enter')
  await expect.poll(()=>mock.bodies.length).toBe(2)
  const current=terminal(page).getByRole('region',{name:'Current task',exact:true})
  await expect(current).toContainText('Investigate protocol timeouts');await expect(current).toContainText('Protocol requirements')
  await page.keyboard.press(`${MOD}+j`);await gotoPage(page,other)
  const dock=page.getByRole('region',{name:'Background AI task'})
  await expect(dock).toContainText('AI working');await expect(dock).toContainText('Protocol requirements');await expect(dock).not.toContainText('Meeting notes')
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await page.setViewportSize({width,height:1000})
   expect(await dock.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
   await page.screenshot({path:info.outputPath(`background-${theme}-${width}.png`)})
  }
  pending.release();await expect(dock).toContainText('Result ready')
  await dock.getByRole('button',{name:'Return to task'}).click()
  await expect(terminal(page).locator('.term-answer')).toContainText('Timeout analysis is ready for review.')
  await expect(terminal(page).locator('.term-answer')).toBeFocused()
  await expect(page).toHaveURL(new RegExp('#/p/'+other+'$'))
  await expect(current).toContainText('Completed')
  await expect(current.getByRole('button',{name:'View result'})).toBeVisible()
  await terminal(page).screenshot({path:info.outputPath('current-result-mobile.png')})
  expect(mock.bodies).toHaveLength(2)
 }finally{pending.release()}
})

test('history reading stays put as new work arrives; explicit return follows the current task',async({page,context})=>{
 await openApp(page);await setKey(page)
 const id=await createPage(page,{title:'Scroll source',content:doc(para('Source details.'))});await gotoPage(page,id)
 const read=gate(),answer=gate()
 const mock=await mockAgent(context,[say(Array.from({length:55},(_,i)=>`Earlier result paragraph ${i}.`).join('\n\n')),async()=>{await read.promise;return call('read','read_page',{id})()},async()=>{await answer.promise;return say('Latest task result.')()}])
 try{
  await page.keyboard.press(`${MOD}+j`);await prompt(page).fill('First long task');await prompt(page).press('Enter')
  await expect(terminal(page).locator('.term-head__status')).toHaveText('Done')
  const scroll=terminal(page).locator('.term-scroll')
  await scroll.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))})
  await prompt(page).fill('Second active task');await prompt(page).press('Enter')
  await expect.poll(()=>mock.bodies.length).toBe(2)
  const current=terminal(page).getByRole('region',{name:'Current task',exact:true})
  await expect(current).toContainText('Second active task')
  await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(100)
  await scroll.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))})
  await expect(current.getByRole('button',{name:'Go to current work ↓'})).toBeVisible()
  read.release();await expect.poll(()=>mock.bodies.length).toBe(3)
  await expect(current.getByRole('button',{name:'New activity ↓'})).toBeVisible()
  expect(await scroll.evaluate(e=>e.scrollTop)).toBeLessThan(5)
  await current.getByRole('button',{name:'New activity ↓'}).click()
  await expect(current.getByRole('button',{name:'Following current work'})).toHaveAttribute('aria-pressed','true')
  await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(100)
  answer.release();await expect(current).toContainText('Completed')
  await current.getByRole('button',{name:'View result'}).click()
  await expect(terminal(page).locator('.term-turn[data-turn="2"] .term-answer')).toBeFocused()
  await expect(terminal(page).locator('.term-turn[data-turn="1"]')).toContainText('Earlier result paragraph 54')
 }finally{read.release();answer.release()}
})
