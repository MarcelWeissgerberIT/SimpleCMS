import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, selectText, doc, para } from './fixtures'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'
import { aiPanel } from './helpers/aiFlows'

const PORT = 47388
const ALL = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
const models = [
  { provider: 'local', model: 'marcel-flow:latest', context: 32768 },
  { provider: 'local', model: 'other-local:latest', context: 32768 },
  { provider: 'ollama', model: 'cloud-choice', context: 65536 },
  { provider: 'minimax', model: 'MiniMax-M3.1-Flash', context: 131072 },
  { provider: 'codex', model: 'gpt-6.1-sol', context: 64000 },
  { provider: 'copilot', model: 'claude-opus-5.5', context: 32768, chat: true, maxOutput: 8192 },
]
async function connect(page: Page) {
  await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker/ }).click()
  await page.getByLabel('Port', { exact: true }).fill(String(PORT))
  await page.getByLabel('Port', { exact: true }).press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('text-box')
  await page.keyboard.press('Escape')
}
async function openMenu(page: Page) {
  const line = 'Selected source sentence to improve.'
  const id = await createPage(page, { title: 'Text task', content: doc(para('Unselected secret stays outside the request.'), para(line)) })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: line }).click()
  await selectText(page, ed, line)
  await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
  await expect(aiPanel(page).getByTestId('route-chip-provider')).toBeVisible()
}
test.describe('worker models for a single text request', () => {
  test.describe.configure({ mode: 'serial' })
  let fake: FakeWorker
  test.beforeEach(async ({ page }) => {
    fake = await startFakeWorker(PORT, { worker: '1.21.0', name: 'text-box', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: false, version: null }, setup: true })
    fake.can = [...WORKER_CAN]
    fake.textModels = models
    fake.onText = request => ({ model: request.model, text: 'Improved by ' + request.provider, inputTokens: 220, outputTokens: 40, usd: request.provider === 'local' ? 0 : null })
    await openApp(page)
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: Object.fromEntries(['local', 'ollama', 'minimax', 'codex', 'copilot'].map(p => [p, { allow }])), restricted: [] } }), ALL)
    await connect(page)
  })
  test.afterEach(async () => { await fake?.close() })
  for (const provider of ['local', 'ollama', 'minimax', 'codex', 'copilot']) test(`${provider}: choose and execute without a Claude key or default change`, async ({ page }, info) => {
    await wsEval(page, s => s.updateSettings({ costDisplay: { currency: 'EUR', eurPerUsd: 0.8, date: '2026-10-20', source: 'manual' } }))
    await openMenu(page)
    await page.getByTestId('route-chip-provider').click()
    const list = page.getByRole('dialog', { name: 'Provider for this request', exact: true })
    await expect(list.locator(`button[data-provider="${provider}"]`)).toHaveAttribute('data-available', 'true')
    if (provider === 'local') for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await page.screenshot({ path: info.outputPath(`providers-${width}-${theme}.png`), animations: 'disabled' })
      expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await list.locator(`button[data-provider="${provider}"]`).click()
    const model = provider === 'local' ? 'other-local:latest' : models.find(m => m.provider === provider)!.model
    const picker = page.getByRole('dialog', { name: 'Model for this request only', exact: true })
    await picker.locator(`[data-route="${provider}:${model}"]`).click()
    expect(fake.textAsked).toHaveLength(0)
    await aiPanel(page).getByTestId('ai-reads').click()
    await aiPanel(page).getByRole('option', { name: /Nothing from this page/ }).click()
    await aiPanel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(aiPanel(page)).toContainText('Improved by ' + provider)
    expect(fake.textAsked).toHaveLength(1)
    expect(fake.textAsked[0]).toMatchObject({ provider, model })
    expect(JSON.stringify(fake.textAsked[0])).toContain('Selected source sentence')
    expect(JSON.stringify(fake.textAsked[0])).not.toContain('Unselected secret')
    expect(JSON.stringify(fake.textAsked[0])).not.toContain('apiKey')
    expect(await wsEval(page, s => s.settings.ai?.default ?? null)).toBeNull()
    expect(await wsEval(page, s => s.settings.ai?.routes ?? null)).toBeNull()
    if (provider === 'local' || provider === 'minimax') await expect(aiPanel(page).getByTestId('ai-receipt')).toContainText('€')
    if (provider === 'ollama' || provider === 'codex' || provider === 'copilot') await expect(aiPanel(page).getByTestId('ai-receipt')).toContainText('Price unknown')
  })
})

test('currency settings fetch the reciprocal ECB rate, persist display only, and keep a valid rate on invalid rate response', async ({ page }, info) => {
  let fail = false
  await page.route('https://data-api.ecb.europa.eu/**', route => fail ? route.fulfill({ contentType: 'text/csv', body: 'temporarily unavailable' }) : route.fulfill({ contentType: 'text/csv', body: 'KEY,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,2026-10-20,1.25\n' }))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ language: 'de' }))
  await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /KI$/ }).click()
  const settings = page.getByTestId('cost-settings')
  await settings.getByLabel('Anzeigewährung').selectOption('EUR')
  await expect(settings.getByTestId('cost-rate-note')).toContainText('0,80 EUR')
  await expect(settings.getByTestId('cost-rate-note')).toContainText('0,8000 €')
  expect(await wsEval(page, s => s.settings.costDisplay)).toMatchObject({ currency: 'EUR', eurPerUsd: 0.8, date: '2026-10-20', source: 'ecb' })
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
    await settings.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`costs-${width}-${theme}.png`), animations: 'disabled' })
    expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  fail = true
  await settings.getByRole('button', { name: 'EZB-Referenzkurs laden' }).click()
  await expect(settings.getByRole('alert')).toContainText('bisherige Anzeige bleibt aktiv')
  expect(await wsEval(page, s => s.settings.costDisplay.eurPerUsd)).toBe(0.8)
  await settings.getByLabel('Anzeigewährung').selectOption('USD')
  await expect(settings.getByTestId('cost-rate-note')).toContainText('Anzeige USD: 1,00')
  await settings.getByLabel('EUR pro 1 USD').fill('0,5')
  await settings.getByRole('button', { name: 'Diesen Kurs verwenden' }).click()
  expect(await wsEval(page, s => s.settings.costDisplay)).toMatchObject({ currency: 'EUR', eurPerUsd: 0.5, source: 'manual' })
})
