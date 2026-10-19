import { createServer, type Server } from 'node:http'
import { coderServer } from '../../mcp/src/local-coder/server'
import { test, expect, openApp, uiEval, wsEval } from './fixtures'

test('local MCP: rejects a bad key, stores the valid key in the vault, runs a task and reconnects after reload', async ({ page, errors }) => {
  test.setTimeout(90000)
  errors.allow(/401|Unauthorized/)
  const key = 'one-coder-browser-test-key-with-more-than-32-chars'
  const requests: unknown[] = []
  const ollama = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/ps' || req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-coder' }] }))
    let body = ''
    for await (const c of req) body += c
    requests.push(JSON.parse(body))
    res.end(JSON.stringify({ message: { content: 'def add(a, b):\n    return a + b' } }))
  })
  const listen = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)))
  const port = await listen(ollama)
  const origin = new URL(test.info().project.use.baseURL!).origin
  const service = coderServer({ key: () => key, origins: [origin], model: 'test-coder', ollama: `http://127.0.0.1:${port}` })
  const url = `http://127.0.0.1:${await listen(service)}/mcp`
  try {
    await openApp(page)
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    const card = page.getByTestId('settings-plate-local')
    await expect(card).toHaveClass('pplate')
    await card.getByRole('button', { name: 'Set up local model' }).click()
    const panel = page.getByTestId('local-coder')
    await panel.getByLabel('Local MCP address').fill(url)
    await panel.getByLabel('Your local API key', { exact: true }).fill('wrong-key-with-more-than-32-characters')
    await panel.getByRole('button', { name: 'Check & save connection' }).click()
    await expect(panel.getByRole('alert')).toContainText('rejected')
    await panel.getByLabel('Your local API key', { exact: true }).fill(key)
    await panel.getByRole('button', { name: 'Check & save connection' }).click()
    await expect(panel.getByRole('status')).toContainText('Connected')
    await expect(panel.getByLabel('Your local API key', { exact: true })).toHaveValue('')
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key)
    const sealed = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('one-vault'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const values = await new Promise<any[]>(resolve => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result) })
      db.close()
      return values.some(v => v?.data instanceof ArrayBuffer && v?.iv instanceof Uint8Array)
    })
    expect(sealed).toBe(true)
    await panel.getByLabel('Coding task', { exact: true }).fill('Implement add(a,b) in Python')
    await panel.getByLabel('Source code and context (optional)').fill('Use Python 3')
    await panel.getByRole('button', { name: 'Run locally' }).click()
    await expect(panel.getByTestId('local-coder-result')).toContainText('return a + b')
    expect(requests).toHaveLength(1)
    await page.reload()
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    await expect(card.getByRole('status')).toContainText('Saved · not checked')
    await card.getByRole('button', { name: 'Check (free)' }).click()
    await expect(card.getByRole('status')).toContainText('Connected')
    await card.getByRole('button', { name: 'Test coding' }).click()
    await panel.getByRole('button', { name: 'Forget connection' }).click()
    await expect(panel.getByRole('button', { name: 'Run locally' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(card.getByRole('status')).toContainText('Not set up')
    await wsEval(page, s => s.updateSettings({ language: 'de' }))
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height })
      for (const theme of ['light', 'dark']) {
        await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`local-card-${width}-${theme}.png`) })
        await card.getByRole('button', { name: 'Lokales Modell einrichten' }).click()
        await expect(panel.getByLabel('Lokale MCP-Adresse')).toBeVisible()
        await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`local-dialog-${width}-${theme}.png`) })
        await page.keyboard.press('Escape')
        await expect(panel).not.toBeVisible()
      }
    }
  } finally {
    await Promise.all([service, ollama].map(s => new Promise<void>(r => s.close(() => r()))))
  }
})
