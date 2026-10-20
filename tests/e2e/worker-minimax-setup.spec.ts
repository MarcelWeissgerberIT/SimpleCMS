import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, expect } from './fixtures'
import { cleanupAll, makeRepo, writeConfig, spawnWorker, WORKER_BUNDLE, WS_LOCAL } from '../../mcp/test/worker-helpers'

test('worker setup saves a private MiniMax key without calling the provider, and removes it explicitly', async ({ page }) => {
  const repo = makeRepo()
  const file = writeConfig(repo, { workspace: WS_LOCAL.id, port: 47396, name: 'MiniMax setup fixture', repos: [] })
  const worker = await spawnWorker({ bundle: WORKER_BUNDLE, args: ['setup', '--config', file], env: { ONE_WORKER_BROWSER: 'none' } })
  let requests = 0
  await page.route('https://api.minimax.io/**', route => { requests++; return route.abort() })
  try {
    await expect.poll(() => /http:\/\/127\.0\.0\.1:47396\/setup#k=[A-Za-z0-9_-]{43}/.test(worker.stdout()), { timeout: 20000 }).toBe(true)
    const url = worker.stdout().match(/http:\/\/127\.0\.0\.1:47396\/setup#k=[A-Za-z0-9_-]{43}/)![0]
    await page.goto(url)
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
