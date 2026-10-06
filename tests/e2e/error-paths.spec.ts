/** What the user sees when something outside the app fails. */
import { readFileSync } from 'node:fs'
import { test, expect, openApp, gotoPage, createPage, doc, para, wsEval, editorOf, selectText, flush, openExportDialog } from './fixtures'

test.describe('AI failures', () => {
  test('a rejected API key shows a clear message and a way to change the key', async ({ page, context, errors }) => {
    // the browser logs failed requests (401) as console errors — that is the network, not the app
    errors.allow(/Failed to load resource|401/)
    await context.route('https://api.anthropic.com/**', (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } })
      return route.fulfill({
        status: 401,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
      })
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-revoked-key' }))
    const id = await createPage(page, { title: 'AI fail', content: doc(para('please improve me')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await selectText(page, ed, 'please improve me')
    await page.locator('[aria-label="Formatting"]').getByRole('button', { name: 'Ask AI' }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await ai.getByRole('option', { name: /Improve writing/ }).click()
    await expect(ai.getByRole('alert')).toContainText('Anthropic rejected this API key')
    await expect(ai.getByRole('option', { name: /Change API key/ })).toBeVisible()
    // the text is untouched
    await expect(ed).toHaveText('please improve me')
  })

  test('no network to Anthropic: an offline message, not a crash', async ({ page, context, errors }) => {
    errors.allow(/Failed to load resource|ERR_|net::/)
    await context.route('https://api.anthropic.com/**', (route) => route.abort('internetdisconnected'))
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'AI offline', content: doc(para('offline text')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await selectText(page, ed, 'offline text')
    await page.locator('[aria-label="Formatting"]').getByRole('button', { name: 'Ask AI' }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await ai.getByRole('option', { name: /Improve writing/ }).click()
    await expect(ai.getByRole('alert')).toContainText('Cannot reach api.anthropic.com', { timeout: 20_000 })
    await expect(ed).toHaveText('offline text')
  })
})

test.describe('webhook failures', () => {
  test('a failing webhook marks the automation and shows the error in the run log', async ({ page, context, errors }) => {
    errors.allow(/Failed to load resource|500/)
    await context.route('https://hooks.e2e.test/**', (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      return route.fulfill({ status: 500, headers: cors, body: 'boom' })
    })
    await openApp(page)
    const dbId = await wsEval(page, (s) => {
      const id = s.createDatabase({ title: 'Failing hooks', parentId: null })
      s.updateDatabase(id, {
        automations: [{ id: 'auto1', name: 'Hook', enabled: true, trigger: { type: 'row_created' }, actions: [{ type: 'webhook', url: 'https://hooks.e2e.test/fail', method: 'POST' }], lastRunAt: null, lastStatus: null, lastMessage: null }],
      })
      return id
    })
    await flush(page)
    await gotoPage(page, dbId)
    await page.locator('#main section.db .db-newbtn__main').click()
    await page.keyboard.type('Row that fails')
    await page.keyboard.press('Enter')
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].automations[0].lastStatus, dbId), { timeout: 20_000 }).toBe('error')
    await page.locator('#main').getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Automations' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.auto-log__row[data-status]').first()).toContainText('500')
  })
})

test.describe('backup merge', () => {
  test('merging a backup adds missing pages and keeps local ones', async ({ page }, testInfo) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Only in backup', content: doc(para('from the backup')) })
    // export just the workspace JSON through the UI
    let dialog = await openExportDialog(page)
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('merge.json')
    await (await download).saveAs(file)
    await page.keyboard.press('Escape')

    // locally: delete the page for good, add a new one
    await wsEval(page, (s, id) => s.deletePagePermanently(id), a)
    const b = await createPage(page, { title: 'Only local', content: doc(para('made after the backup')) })

    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'merge.json', mimeType: 'application/json', buffer: readFileSync(file) }])
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('radio', { name: /Merge into this workspace/ })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('button', { name: 'Merge backup' }).click()
    await expect(dialog.getByText(/Backup merged/)).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await wsEval(page, (s, id) => s.pages[id]?.title ?? null, a)).toBe('Only in backup')
    expect(await wsEval(page, (s, id) => s.pages[id]?.title ?? null, b)).toBe('Only local')
    // nothing duplicated
    const welcomeCount = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string; trashed: boolean }>).filter((p) => p.title === 'Welcome to One' && !p.trashed).length)
    expect(welcomeCount).toBe(1)
  })
})
