import { test, expect, openApp, uiEval, wsEval } from './fixtures'
import { fakeOpener, makeCodingRepo, startCodingWorker } from './helpers/coding'

test('global Ollama entry works without a task and directs an offline user to worker settings', async ({ page }) => {
  await openApp(page)
  await uiEval(page, s => s.openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /AI$/ }).click()
  const card = page.getByTestId('ollama-cloud-settings')
  await expect(card).toContainText('Connect your coding worker first.')
  await expect(card.locator('input')).toHaveCount(0)
  await card.getByRole('button', { name: 'Open coding worker settings', exact: true }).click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
  await expect(page.getByTestId('ollama-cloud-settings')).toContainText('Every coding task that uses Ollama Cloud shares these settings.')
})

test('AI and worker settings open the same protected setup; global card fits desktop and phone', async ({ page }, info) => {
  const repo = makeCodingRepo()
  let worker: Awaited<ReturnType<typeof startCodingWorker>> | undefined
  try {
    const opener = fakeOpener(repo)
    await openApp(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await uiEval(page, s => s.openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker$/ }).click()
    const line = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
    const id = /--workspace (\S+)/.exec(line!)![1]
    const port = Number(process.env.CODING_E2E_PORT) || 47886
    worker = await startCodingWorker(repo, id, port, {}, { ONE_WORKER_BROWSER: opener.program })
    await page.getByLabel('Port', { exact: true }).fill(String(port))
    await page.getByLabel('Port', { exact: true }).press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer', exact: true }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('Connected')
    const initial = opener.urls().length
    await page.getByRole('tab', { name: /AI$/ }).click()
    const card = page.getByTestId('ollama-cloud-settings')
    await expect(card).toContainText('Worker reachable · e2e-box')
    // Merely opening global settings never opens a browser or calls a model.
    expect(opener.urls()).toHaveLength(initial)
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`ollama-global-${width}-${theme}.png`), animations: 'disabled' })
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await card.getByRole('button', { name: 'Set up API key and model…', exact: true }).click()
    await expect.poll(() => opener.urls().length).toBe(initial + 1)
    const setup = opener.urls().at(-1)!
    expect(new URL(setup).hostname).toBe('127.0.0.1')
    await page.getByRole('tab', { name: /Coding worker$/ }).click()
    await page.getByTestId('ollama-cloud-settings-open').click()
    await expect.poll(() => opener.urls().length).toBe(initial + 2)
    expect(opener.urls().at(-1)).toBe(setup)
    // One's rendered text and workspace never receive the setup URL/token or an Ollama key.
    expect(await page.locator('body').innerText()).not.toContain(setup)
    expect(await wsEval(page, s => JSON.stringify(s.settings))).not.toContain(setup)
    await wsEval(page, s => s.updateSettings({ language: 'de' }))
    await expect(page.getByTestId('ollama-cloud-settings-open')).toHaveText('API-Key und Modell einrichten …')
  } finally {
    await worker?.stop()
    repo.cleanup()
  }
})
