import {test,expect,email,signIn,openApp,waitOnline,waitForApp,createWorkspace,wsEval,api,newPerson,join} from './fixtures'
import {startFakeWorker} from '../e2e/helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'

test('file picker previews locally and sends a fresh bounded file only at terminal start',async({page},info)=>{
 test.setTimeout(120000)
 const fake=await startFakeWorker(47439,{worker:'1.35.0',name:'Repo-Test',repos:[{name:'Demo',baseBranch:'main',branches:['main']}],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true})
 fake.can=[...WORKER_CAN];fake.textModels=[{provider:'copilot',model:'auto',context:32768,chat:true,maxOutput:8192}]
 let content='int answer = 1;'
 fake.onRepoFiles=r=>r.action==='list'?{repo:r.repo,branch:'main',paths:['src/demo.cpp','README.md'],truncated:false}:{repo:r.repo,branch:r.branch??'main',file:{path:r.path,revision:content==='int answer = 1;'?'a'.repeat(64):'b'.repeat(64),content,complete:true,start_line:1,end_line:1,total_lines:1}}
 fake.onText=r=>({model:r.model,text:'Selected repository excerpt received.',inputTokens:200,outputTokens:20,usd:null})
 try{
  await openApp(page);await signIn(page,email('files'));await openApp(page)
  const ws=await createWorkspace(page,'Repo files');await openApp(page,ws);await waitOnline(page)
  await wsEval(page,s=>{s.updateSettings({language:'en',ai:{allow:{copilot:['files','mcp','memory']}}});s.setWorkspaceAI({policy:{restricted:[],providers:{copilot:{allow:['public','selection','page','structure','rows','workspace','files']}}}})})
  await page.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings',tab:'coding'}))
  await page.getByRole('radio',{name:'Local',exact:true}).click()
  await page.getByLabel('Port',{exact:true}).fill('47439');await page.getByLabel('Port',{exact:true}).press('Enter')
  await page.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click();await expect(page.getByTestId('coding-conn')).toContainText('Repo-Test');await page.keyboard.press('Escape')
  await page.evaluate(async()=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'copilot',m:'auto'}]))
  await page.keyboard.press('Control+j')
  const term=page.locator('.term'),input=term.locator('.term-prompt__input')
  await expect(input).toBeVisible();await input.fill('Explain this code /files')
  const picker=page.getByTestId('repo-files-picker');await expect(picker).toBeVisible()
  await picker.getByRole('button',{name:'src/demo.cpp',exact:true}).click();await expect(picker.locator('pre')).toContainText('int answer = 1;')
  expect(fake.textAsked.length).toBe(0)
  await picker.getByRole('checkbox',{name:'src/demo.cpp',exact:true}).check()
  await picker.screenshot({path:info.outputPath('repo-file-picker.png'),animations:'disabled'})
  await picker.getByRole('button',{name:'Add file references'}).click()
  await expect(input).toContainText('') // textarea value checked below
  await expect(input).toHaveValue(/one-repo:\/\/file/)
  content='int answer = 2;'
  await input.press('Enter')
  await expect.poll(()=>fake.textAsked.length).toBeGreaterThan(0)
  const sent=JSON.stringify(fake.textAsked[0]);expect(sent).toContain('int answer = 2;');expect(sent).not.toContain('int answer = 1;');expect(sent).toContain('b'.repeat(64))
  await expect(term).toContainText('Selected repository excerpt received.')
  await input.fill('@src/');await expect(picker).toBeVisible();await page.setViewportSize({width:390,height:844});await picker.screenshot({path:info.outputPath('repo-files-mobile.png'),animations:'disabled'})
  expect(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 }finally{await fake.close()}
})

test('only the intended participant sees the personal PO plates',async({page,context},info)=>{
 await openApp(page);await signIn(page,email('organizer'));await openApp(page)
 const ws=await createWorkspace(page,'Private PO preparation');await openApp(page,ws);await waitOnline(page)
 const recipient=await newPerson(context),recipientEmail=email('po');await signIn(recipient,recipientEmail);await join(page,recipient,ws,'member')
 await openApp(recipient,ws,'/my-start');await waitOnline(recipient)
 await expect(recipient.getByText('No personal guides have been assigned', {exact:false})).toBeVisible()
 const response=await api(page,'PUT',`/api/workspaces/${ws}/personal-guides/po-demo`,{email:recipientEmail,title:'My PO preparation',sections:[{title:'Identity first',body:'Confirm your own Atlas identity before using the PO templates.\nSource:\nhttps://eh-atlas.com/r/33538',prompt:'Use atlas_whoami and name the actual account. Do not infer a role.'},{title:'Requirements',body:'The team decides; the agent shows source-backed gaps.'}],expiresAt:Date.now()+86400000})
 expect(response.status).toBe(200)
 await openApp(page,ws);await expect(page.getByRole('button',{name:'Open personal guide'})).toHaveCount(0)
 await recipient.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(recipient.getByRole('button',{name:'Open personal guide'})).toBeVisible()
 await recipient.getByRole('button',{name:'Open personal guide'}).click();await expect(recipient.getByRole('dialog')).toContainText('My PO preparation');await expect(recipient.getByRole('dialog').getByRole('link',{name:/Atlas/})).toHaveAttribute('href','https://eh-atlas.com/r/33538')
 await expect(recipient).toHaveURL(/#\/my-start\/po-demo$/)
 await recipient.reload();await waitForApp(recipient);await expect(recipient.getByRole('dialog')).toContainText('My PO preparation')
 await recipient.getByRole('dialog').screenshot({path:info.outputPath('personal-po-plates.png'),animations:'disabled'})
 await recipient.getByRole('button',{name:'Prepare in AI terminal'}).click();await expect(recipient.locator('.term-prompt__input')).toHaveValue(/atlas_whoami/)
 await expect(recipient).toHaveURL(/#\/my-start$/)
 await recipient.keyboard.press('Control+j')
 await openApp(recipient,ws,'/discover');await recipient.getByRole('button',{name:'My start',exact:true}).click()
 await expect(recipient.getByRole('heading',{name:'My PO preparation'})).toBeVisible()
 await recipient.screenshot({path:info.outputPath('my-start-page.png'),animations:'disabled'})
 await openApp(page,ws,'/my-start/po-demo')
 await expect(page.getByText('This guide is unavailable', {exact:false})).toBeVisible()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'My PO preparation'})).toHaveCount(0)
 let fail=true
 await recipient.route('**/api/workspaces/*/personal-guides',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'Temporarily unavailable'}})}):route.continue())
 await openApp(recipient,ws,'/my-start')
 await recipient.getByRole('button',{name:'Check guides again'}).click()
 await expect(recipient.getByRole('alert')).toContainText('could not be loaded')
 fail=false;await recipient.getByRole('button',{name:'Try again',exact:true}).click()
 await expect(recipient.getByRole('heading',{name:'My PO preparation'})).toBeVisible()
})
