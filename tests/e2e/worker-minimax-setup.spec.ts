import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { test, expect } from './fixtures'
import { cleanupAll, makeRepo, writeConfig, spawnWorker, presetBundle, WORKER_BUNDLE, WS_LOCAL } from '../../mcp/test/worker-helpers'

test.afterAll(() => cleanupAll())

test('worker company CA import is previewed, confirmed locally and removable without changing pairing', async ({page}, info) => {
  const repo = makeRepo(), config = writeConfig(repo, {workspace:WS_LOCAL.id,port:47397,name:'Certificate fixture',repos:[]})
  const pem = join(repo.dir, 'synthetic-root.pem'), key = join(repo.dir, 'synthetic-root.key')
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',pem,'-subj','/CN=ONE synthetic UI test CA','-days','2'], {stdio:'ignore'})
  const worker = await spawnWorker({bundle:WORKER_BUNDLE,args:['setup','--config',config],home:repo.dir,env:{ONE_WORKER_BROWSER:'none'}})
  try {
    await expect.poll(()=>/http:\/\/127\.0\.0\.1:47397\/setup#k=[A-Za-z0-9_-]{43}/.test(worker.stdout())).toBe(true)
    const url = worker.stdout().match(/http:\/\/127\.0\.0\.1:47397\/setup#k=[A-Za-z0-9_-]{43}/)![0]
    await page.goto(url)
    const section = page.getByTestId('worker-certificates')
    await section.locator('summary').click()
    expect((await page.request.post('http://127.0.0.1:47397/setup/api/certificates-save',{data:{pem:readFileSync(pem,'utf8'),fingerprints:[]}})).status()).toBe(401)
    const saved = join(dirname(config),'certificates','trusted-ca.pem')
    expect(existsSync(saved)).toBe(false)
    await section.getByLabel('Choose company CA (.crt / .pem)').setInputFiles(pem)
    await expect(section).toContainText('ONE synthetic UI test CA')
    expect(existsSync(saved)).toBe(false) // preview alone cannot change trust
    await section.getByRole('button',{name:'Trust this CA for this worker',exact:true}).click()
    await expect(section).toContainText('Saved locally. Finish running work')
    expect(readFileSync(saved,'utf8')).toContain('BEGIN CERTIFICATE')
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await section.scrollIntoViewIfNeeded();expect(await section.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('company-ca-'+width+'.png')})}
    await section.getByRole('button',{name:'Remove locally imported CAs',exact:true}).click()
    await expect(section.getByRole('button',{name:'Remove locally imported CAs',exact:true})).toHaveCount(0)
    expect(existsSync(saved)).toBe(false)
  } finally {await worker.stop()}
})

test('the E+H workshop offers the owner-provided CA with a download and explicit confirmation', async ({page},info) => {
  const repo=makeRepo(),workspace='team:0MrfqSJ7pecnanXM',config=writeConfig(repo,{workspace,port:47398,name:'Workshop certificate offer',repos:[]})
  const bundle=presetBundle({workspace,origin:'https://onecms.eh-atlas.com',name:'Workshop certificate offer',port:47398,pair:'A'.repeat(43)})
  const worker=await spawnWorker({bundle,args:['setup','--config',config],home:repo.dir,env:{ONE_WORKER_BROWSER:'none'}})
  try{
    await expect.poll(()=>/http:\/\/127\.0\.0\.1:47398\/setup#k=[A-Za-z0-9_-]{43}/.test(worker.stdout())).toBe(true)
    await page.goto(worker.stdout().match(/http:\/\/127\.0\.0\.1:47398\/setup#k=[A-Za-z0-9_-]{43}/)![0])
    const section=page.getByTestId('worker-certificates');await section.locator('summary').click()
    const download=page.waitForEvent('download');await section.getByRole('button',{name:'Download certificate',exact:true}).click()
    const file=await download;expect(file.suggestedFilename()).toBe('EH-RootCA03.crt')
    const cert=new X509Certificate(readFileSync((await file.path())!));expect(cert.fingerprint256).toBe('19:D6:ED:6E:08:6F:F5:D7:BD:3B:50:FA:17:08:4A:12:A0:6E:7A:65:F6:64:C4:E9:AF:3D:64:BF:3C:2B:CC:C4')
    const saved=join(dirname(config),'certificates','trusted-ca.pem');expect(existsSync(saved)).toBe(false)
    await expect(section).toContainText('EH-RootCA03')
    await section.getByRole('button',{name:'Trust this CA for this worker',exact:true}).click()
    await expect(section).toContainText('Saved locally. Finish running work')
    expect(new X509Certificate(readFileSync(saved)).fingerprint256).toBe(cert.fingerprint256)
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await section.scrollIntoViewIfNeeded();expect(await section.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await section.screenshot({path:info.outputPath('eh-company-certificate-'+width+'.png')})}
  }finally{await worker.stop()}
})

test('worker setup saves a private MiniMax key without calling the provider, and removes it explicitly', async ({ page }) => {
  const repo = makeRepo()
  const file = writeConfig(repo, { workspace: WS_LOCAL.id, port: 47396, name: 'MiniMax setup fixture', repos: [] })
  const copilotCapture = join(repo.dir, 'copilot-probe.json')
  const worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['setup', '--config', file], home:repo.dir, env: { ONE_WORKER_BROWSER: 'none', COPILOT_BIN: fileURLToPath(new URL('../../mcp/test/fixtures/fake-copilot.mjs', import.meta.url)), COPILOT_CAPTURE: copilotCapture } })
  let requests = 0
  await page.route('https://api.minimax.io/**', route => { requests++; return route.abort() })
  try {
    await expect.poll(() => /http:\/\/127\.0\.0\.1:47396\/setup#k=[A-Za-z0-9_-]{43}/.test(worker.stdout()), { timeout: 20000 }).toBe(true)
    const url = worker.stdout().match(/http:\/\/127\.0\.0\.1:47396\/setup#k=[A-Za-z0-9_-]{43}/)![0]
    await page.goto(url)
    const copilot = page.getByTestId('copilot-setup')
    await expect(copilot).toBeVisible()
    await expect(copilot).toContainText('copilot login')
    await expect(copilot.locator('input[type=password]')).toHaveCount(0)
    await copilot.getByLabel('Worker default model (auto lets Copilot select)', {exact:true}).fill('gpt-6.1-sol')
    await copilot.getByRole('button', {name:'Save Copilot model',exact:true}).click()
    await expect(copilot).toContainText('Model saved. No model request was sent.')
    const copilotFile = join(dirname(file),'copilot.json')
    expect(JSON.parse(readFileSync(copilotFile,'utf8'))).toEqual({model:'gpt-6.1-sol'})
    if(process.platform!=='win32')expect(statSync(copilotFile).mode&0o777).toBe(0o600)
    await copilot.getByRole('button',{name:'Check CLI and login (no model request)',exact:true}).click()
    await expect(copilot).toContainText('CLI signed in.')
    await expect(copilot).toContainText('claude-opus-5.5')
    expect(readFileSync(copilotCapture,'utf8')).not.toContain('session.send')
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await copilot.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`copilot-setup-${width}.png`)})}
    await page.setViewportSize({width:1440,height:900})
    const section = page.getByTestId('minimax-setup')
    await expect(section).toBeVisible()
    await section.getByLabel('MiniMax API key', { exact: true }).fill('mini_browser_fixture_private_key')
    await section.getByLabel('Context budget (tokens)').selectOption('1000000')
    await section.getByLabel('Thinking effort').selectOption('max')
    await section.getByRole('button', { name: 'Save MiniMax settings' }).click()
    await expect(section).toContainText('Key saved · not yet verified')
    await expect(section.getByLabel('MiniMax API key', { exact: true })).toHaveValue('')
    await expect(section.getByLabel('Context budget (tokens)')).toHaveValue('1000000')
    await expect(section.getByLabel('Thinking effort')).toHaveValue('max')
    expect(requests).toBe(0)
    const cloud = page.getByTestId('ollama-setup')
    await cloud.scrollIntoViewIfNeeded()
    await expect(cloud.getByLabel('Ollama API key', { exact: true })).toHaveAttribute('type', 'password')
    const key = 'ollama_fixture_key_never_real'
    await cloud.getByLabel('Ollama API key', { exact: true }).fill(key)
    await cloud.getByLabel('Cloud model name', { exact: true }).fill('minimax-m3.1-flash')
    await cloud.getByRole('button', { name: 'Save Ollama Cloud settings' }).click()
    await expect(cloud).toContainText('Key saved · not yet verified with Ollama')
    await expect(cloud.getByLabel('Ollama API key', { exact: true })).toHaveValue('')
    const secretFile = join(dirname(file), 'ollama-cloud.json')
    expect(JSON.parse(readFileSync(secretFile, 'utf8')).apiKey).toBe(key)
    if (process.platform !== 'win32') expect(statSync(secretFile).mode & 0o777).toBe(0o600)
    const setupUrl = new URL(url)
    const auth = setupUrl.hash.slice(3)
    const state = await page.request.get(setupUrl.origin + '/setup/api/state', { headers: { 'x-one-setup': auth } })
    expect(await state.text()).not.toContain(key)
    const refused = await page.request.post(setupUrl.origin + '/setup/api/ollama', { data: { remove: true }, headers: { origin: setupUrl.origin } })
    expect(refused.status()).toBe(401)
    const foreign = await page.request.post(setupUrl.origin + '/setup/api/ollama', { data: { remove: true }, headers: { 'x-one-setup': auth, origin: 'https://evil.invalid' } })
    expect(foreign.status()).toBe(403)
    await cloud.getByLabel('Cloud model name', { exact: true }).fill('gpt-oss:120b')
    await cloud.getByRole('button', { name: 'Save Ollama Cloud settings' }).click()
    await expect(cloud.getByLabel('Cloud model name', { exact: true })).toHaveValue('gpt-oss:120b')
    expect(JSON.parse(readFileSync(secretFile, 'utf8')).apiKey).toBe(key)
    await cloud.getByRole('button', { name: 'Remove saved Ollama key' }).click()
    await expect(cloud).toContainText('No API key configured')
    expect(existsSync(secretFile)).toBe(false)
    await section.getByRole('button', { name: 'Remove saved MiniMax key' }).click()
    await expect(section).toContainText('No API key configured')
    expect(requests).toBe(0)
  } finally { await worker.stop(); cleanupAll() }
})
