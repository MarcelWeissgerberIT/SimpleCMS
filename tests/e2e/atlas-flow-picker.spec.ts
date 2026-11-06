import { test, expect, openApp, wsEval, uiEval, MOD } from './fixtures'
import { startFakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'

test('one Atlas Flow option in the UI; existing legacy routes still execute unchanged', async ({ page }, info) => {
  const fake = await startFakeWorker(47419, { worker: '1.33.1', name: 'profile-fixture', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: false, version: null }, setup: true })
  fake.can = [...WORKER_CAN]
  fake.textModels = ['atlas-flow:latest', 'marcel-flow:latest', 'marcel-coder:latest', 'qwen3-coder:30b', 'another-local-model'].map(model => ({ provider: 'local', model, context: 32768 }))
  try {
    await openApp(page)
    await wsEval(page, s => {
      s.setWorkspaceAI({ policy: { restricted: [], providers: { local: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'workspace'] } } } })
      s.updateSettings({ ai: { routes: { ask: [{ p: 'local', m: 'atlas-flow:latest' }] } } })
    })
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'coding' }))
    // Use the visible tab rather than relying on the settings modal's internal tab id.
    await page.getByRole('tab', { name: /Coding worker/ }).click()
    await page.getByLabel('Port', { exact: true }).fill('47419')
    await page.getByLabel('Port', { exact: true }).press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('profile-fixture')
    await page.getByRole('tab', { name: /AI$/ }).click()
    await expect(page.getByTestId('worker-model-settings')).toContainText('atlas-flow:latest')
    await expect(page.getByTestId('worker-model-settings').locator(':scope > ul > li')).toHaveCount(2)
    await expect(page.getByTestId('device-row-ask')).toHaveValue('local:atlas-flow:latest')
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+k`)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await palette.getByRole('combobox', { name: 'Command palette', exact: true }).fill('? Explain a branch.')
    await page.getByTestId('ask-route-chip').click()
    const picker = page.getByRole('dialog', { name: 'Model for this request only', exact: true })
    await expect(picker.locator('[data-route="local:atlas-flow:latest"]')).toHaveCount(1)
    await expect(picker.locator('[data-route="local:marcel-flow:latest"], [data-route="local:marcel-coder:latest"], [data-route="local:qwen3-coder:30b"]')).toHaveCount(0)
    await expect(picker.locator('[data-route="local:another-local-model"]')).toHaveCount(1)
    await page.screenshot({ path: info.outputPath('one-atlas-flow-choice.png'), animations: 'disabled' })
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    // An older saved default is a valid route, even though it is no longer advertised.
    await wsEval(page, s => s.updateSettings({ ai: { routes: { ask: [{ p: 'local', m: 'marcel-flow:latest' }] } } }))
    await page.keyboard.press(`${MOD}+k`)
    await palette.getByRole('combobox', { name: 'Command palette', exact: true }).fill('? Explain a branch.')
    await palette.getByRole('combobox', { name: 'Command palette', exact: true }).press('Enter')
    await expect(palette.locator('.ask__answer')).toContainText('Worker text answer.')
    expect(fake.textAsked).toHaveLength(1)
    expect(fake.textAsked[0].model).toBe('marcel-flow:latest')
    await page.keyboard.press('Escape')
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    await expect(page.getByTestId('device-row-ask')).toHaveValue('local:marcel-flow:latest')
  } finally { await fake.close() }
})
