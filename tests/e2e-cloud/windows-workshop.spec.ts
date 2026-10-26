import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, createWorkspace, join as joinWorkspace, wsEval } from './fixtures'
import { makeCodingRepo, startCloudWorker } from '../e2e/helpers/coding'

test('a fresh Windows member downloads their own cloud worker and uses Copilot without Claude or a model API key',async({page:owner,context},info)=>{
  test.setTimeout(90000)
  await signIn(owner,email('windows-coach'))
  const ws=await createWorkspace(owner,'Windows workshop rehearsal')
  await openApp(owner,ws);await waitOnline(owner)
  await wsEval(owner,s=>s.setWorkspaceAI({policy:{restricted:[],providers:{copilot:{allow:['public','structure','selection','page','rows','workspace']}}}}))
  const member=await newPerson(context)
  await member.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{get:()=> 'Win32'})
    Object.defineProperty(navigator,'userAgentData',{get:()=>({platform:'Windows'})})
  })
  const repo=makeCodingRepo()
  let worker:Awaited<ReturnType<typeof startCloudWorker>>|undefined
  try {
    await signIn(member,email('windows-member'));await joinWorkspace(owner,member,ws,'member')
    await openApp(member,ws);await waitOnline(member)
    await member.evaluate(()=>(window as any).__one.ui.getState().openModal({type:'settings'}))
    await member.getByRole('tab',{name:/Coding worker/}).click()
    await member.getByTestId('coding-via-cloud').click()
    const card=member.getByTestId('coding-cloud-card')
    await expect(card.locator('.cs-needs')).not.toContainText('signed in once (claude)')
    await expect(card.locator('.cs-needs')).toContainText('chosen coding provider')
    const [download]=await Promise.all([member.waitForEvent('download'),member.getByTestId('coding-cloud-download').click()])
    const file=join(repo.root,download.suggestedFilename());await download.saveAs(file)
    const source=readFileSync(file,'utf8')
    expect(source).toContain('"workspace":"team:'+ws+'"')
    await expect(member.getByTestId('coding-first-install-powershell')).toContainText('node "$env:USERPROFILE\\Downloads\\one-worker-cloud.mjs" install')
    const fake=fileURLToPath(new URL('../../mcp/test/fixtures/fake-copilot.mjs',import.meta.url));chmodSync(fake,0o755)
    worker=await startCloudWorker(file,repo,47449,{CLAUDE_BIN:join(repo.root,'no-claude-installed'),COPILOT_BIN:fake,ONE_CODER_OLLAMA:'http://127.0.0.1:9',COPILOT_ANSWERS:JSON.stringify([{content:'WINDOWS-ONE-OK',tool_calls:[]}])})
    await expect(member.getByTestId('coding-conn')).toContainText('via cloud',{timeout:25000})
    await expect(member.getByTestId('coding-conn')).toContainText('1 repo')
    await member.getByRole('tab',{name:/AI$/}).click()
    await expect(member.getByTestId('worker-model-settings')).toContainText('GitHub Copilot')
    await member.getByTestId('device-default').selectOption('copilot:auto')
    expect(await wsEval(member,s=>!!s.settings.aiApiKey)).toBe(false)
    await member.keyboard.press('Escape');await member.keyboard.press('Control+j')
    const term=member.getByRole('region',{name:'AI terminal'})
    await term.getByRole('textbox',{name:'Task for the agent'}).fill('Synthetic connection test. Reply WINDOWS-ONE-OK. Change nothing.')
    await term.getByRole('textbox',{name:'Task for the agent'}).press('Enter')
    await expect(term.locator('.term-answer')).toContainText('WINDOWS-ONE-OK',{timeout:30000})
    await member.screenshot({path:info.outputPath('windows-member-copilot.png')})
    expect(await wsEval(owner,s=>s.settings.ai?.default?.[0]?.p??null)).toBe(null)
    await info.attach('rehearsal-scope',{body:JSON.stringify({windowsBrowserUI:true,actualWindowsHost:false,realTeamServer:true,realDownloadedWorker:true,memberRole:true,localGit:true,copilotProtocolFixture:true,claudeInstalled:false,modelApiKey:false,customerNetwork:'NOT_TESTED'}),contentType:'application/json'})
  } finally {await worker?.stop();repo.cleanup();await member.context().close()}
})
