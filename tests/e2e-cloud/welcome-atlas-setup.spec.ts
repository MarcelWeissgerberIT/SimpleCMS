import {test,expect,email,signIn,openApp,waitForApp,waitOnline,createWorkspace,wsEval,newPerson,join} from './fixtures'
import {startFakeWorker} from '../e2e/helpers/fakeWorker'
import {WORKER_CAN} from '../../src/app/features/coding/protocol'

test('a recipient activates personal Atlas from their link for Copilot without copying secrets or calling a model',async({page:owner,context},info)=>{
 const fake=await startFakeWorker(47429,{worker:'1.34.1',name:'Personal Windows worker',repos:[],parallel:1,busy:[],spentToday:0,dayLimit:null,claude:{found:false,version:null},setup:true,personalSecrets:true})
 fake.can=[...WORKER_CAN];fake.textModels=[{provider:'copilot',model:'auto',context:32768,chat:true}]
 let missing=false
 fake.onModelMcp=r=>r.action==='list'?{tools:[{name:'remote_mcp_0',server:r.servers[0].name,tool:'atlas_whoami',description:'Personal identity',parameters:{type:'object',properties:{}}}]}:{result:JSON.stringify({content:[{type:'text',text:JSON.stringify({person:'Participant',effectiveTenantScope:missing?[]:['one'],memberships:missing?[]:[{tenantSlug:'one'}]})}]})}
 const member=await newPerson(context)
 try{
  await openApp(owner);await signIn(owner,email('host'));await openApp(owner)
  const ws=await createWorkspace(owner,'Workshop setup');await openApp(owner,ws);await waitOnline(owner)
  await wsEval(owner,s=>s.setWorkspaceAI({policy:{restricted:[],providers:{copilot:{allow:['public','page','selection','structure','workspace']},local:{allow:['public','page','selection','structure','workspace']}}}}))
  await openApp(member);await signIn(member,email('participant'));await join(owner,member,ws,'member');await openApp(member,ws);await waitOnline(member)
  await wsEval(member,s=>s.updateSettings({ai:{narrow:{copilot:['mcp','files'],local:['mcp']}},mcpServers:[{id:'keep',name:'atlas-workshop',url:'https://other.example.test/mcp',token:'unrelated-test-token',enabled:false,prompt:'Keep this configuration.'},{id:'manual-wrong-instance',name:'old-atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'personal-link-test-token',enabled:true,prompt:'Old manual setup.'},{id:'welcome-atlas-migrate',name:'past-setup',url:'https://aj-atlas.com/api/atlas/mcp',linkBase:'https://eh-atlas.com/',token:'other-personal-fixture',enabled:false,prompt:'Keep disabled.',checkedAt:123}]}))
  await member.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
  await member.getByRole('tab',{name:/Coding worker/}).click()
  await member.getByLabel('Port',{exact:true}).fill('47429');await member.getByLabel('Port',{exact:true}).press('Enter')
  await member.getByRole('switch',{name:'Connect to a coding worker on this computer'}).click()
  await expect(member.getByTestId('coding-conn')).toContainText('Personal Windows worker');await member.keyboard.press('Escape')
  await member.route(`**/api/workspaces/${ws}/welcome-access`,r=>r.fulfill({json:[{id:'personal-grant'}]}))
  await member.route(`**/api/workspaces/${ws}/welcome-access/personal-grant/open`,r=>r.fulfill({json:{name:'Participant',atlasLink:'https://eh-atlas.com/?token=personal-link-test-token',atlasToken:''}}))
  await member.reload();await waitForApp(member);await waitOnline(member)
  await member.getByTestId('atlas-welcome').getByRole('button',{name:'Set up Atlas access'}).click()
  const modal=member.getByRole('dialog'),connect=modal.getByTestId('welcome-atlas-connect')
  await connect.getByRole('button',{name:'Connect Atlas with Copilot',exact:true}).click()
  await expect(connect.getByRole('status')).toContainText('Atlas connected')
  expect(fake.textAsked).toHaveLength(0)
  expect(fake.mcpAsked.map(r=>r.action)).toEqual(['list','call'])
  expect(fake.mcpAsked[0].servers).toEqual([{name:'atlas-workshop-2',url:'https://eh-atlas.com/api/atlas/mcp',token:'personal-link-test-token',allow:['atlas_whoami'],deny:[]}])
  const settings=await wsEval(member,s=>({servers:s.settings.mcpServers,ai:s.settings.ai,key:s.settings.aiApiKey}))
  expect(settings.servers).toHaveLength(4)
  expect(settings.servers[0]).toMatchObject({id:'keep',enabled:false,prompt:'Keep this configuration.'})
  expect(settings.servers[1]).toMatchObject({id:'manual-wrong-instance',enabled:false})
  expect(settings.servers[2]).toMatchObject({id:'welcome-atlas-migrate',url:'https://eh-atlas.com/api/atlas/mcp',enabled:false,prompt:'Keep disabled.'})
  expect(settings.servers[2].checkedAt).toBeUndefined()
  expect(settings.servers[3]).toMatchObject({id:'welcome-atlas-personal-grant',url:'https://eh-atlas.com/api/atlas/mcp',enabled:true,scope:'all',token:expect.stringMatching(/^vault:/)})
  expect(settings.ai.narrow.copilot).toEqual(['files']);expect(settings.ai.narrow.local).toEqual(['mcp']);expect(settings.ai.allow.copilot).toContain('mcp');expect(settings.ai.allow.local??[]).not.toContain('mcp')
  expect(settings.key).toBeFalsy();expect(JSON.stringify(settings)).not.toContain('personal-link-test-token')
  expect(await wsEval(owner,s=>s.settings.mcpServers??[])).toEqual([])
  await modal.screenshot({path:info.outputPath('personal-atlas-connected.png')})
  // Repeating the operation reuses the personal connection and reports missing Atlas
  // membership honestly; configuring ONE never grants roles or marks a record as read.
  missing=true
  await connect.getByRole('button',{name:'Connect Atlas with Copilot',exact:true}).click()
  await expect(connect.getByRole('status')).toContainText('no tenant membership')
  expect(await wsEval(member,s=>s.settings.mcpServers.length)).toBe(4)
  expect(fake.mcpAsked.every(r=>r.action!=='call'||r.name==='atlas_whoami')).toBe(true)
  await member.setViewportSize({width:390,height:900})
  expect(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  await modal.screenshot({path:info.outputPath('personal-atlas-mobile.png')})
 }finally{await fake.close();await member.context().close()}
})
