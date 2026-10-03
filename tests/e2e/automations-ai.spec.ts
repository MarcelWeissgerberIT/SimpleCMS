import { test, expect, openApp, gotoPage, wsEval, flush, createPage, doc, para, editorOf, selectText, waitForPlain, mockClaude } from './fixtures'

test.describe('automations', () => {
  test('webhook automation fires with the row payload when a row is added', async ({ page, context }) => {
    const hits: Array<{ method: string; body: string; contentType: string }> = []
    await context.route('https://hooks.e2e.test/**', (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      hits.push({ method: req.method(), body: req.postData() ?? '', contentType: req.headers()['content-type'] ?? '' })
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
    })

    await openApp(page)
    const dbId = await wsEval(page, (s) => s.createDatabase({ title: 'Leads', parentId: null }))
    await flush(page)
    await gotoPage(page, dbId)

    await page.locator('#main').getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'Automations' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Automations · Leads')
    await dialog.getByRole('button', { name: /Send new rows to n8n/ }).click()
    await dialog.getByRole('textbox', { name: 'Webhook URL' }).fill('https://hooks.e2e.test/one')
    const arm = dialog.getByRole('switch', { name: 'Enabled' })
    await expect(arm).toBeEnabled()
    await arm.click()
    await expect(arm).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const automation = await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].automations?.[0] ?? null)), dbId)
    expect(automation).toMatchObject({ enabled: true, trigger: { type: 'row_created' }, actions: [{ type: 'webhook', url: 'https://hooks.e2e.test/one', method: 'POST' }] })

    // add a row through the UI
    await page.locator('#main section.db .db-newbtn__main').click()
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    await page.keyboard.type('ACME GmbH')
    await page.keyboard.press('Enter')

    await expect.poll(() => hits.length, { timeout: 20_000 }).toBeGreaterThan(0)
    // give a duplicate a chance to show up
    await page.waitForTimeout(2500)
    expect(hits, 'exactly one webhook call per created row').toHaveLength(1)
    const hit = hits[0]
    expect(hit.method).toBe('POST')
    const payload = JSON.parse(hit.body)
    expect(payload).toMatchObject({
      event: 'row_created',
      automation: { id: automation.id },
      database: { id: dbId, title: 'Leads' },
      row: { title: 'ACME GmbH', properties: { Name: 'ACME GmbH' } },
      source: 'simplecms-one',
    })
    expect(payload.row.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/SimpleCMS\/app\/.*#\/p\//)
    expect(Object.keys(payload.row.properties)).toEqual(expect.arrayContaining(['Name', 'Status', 'Tags', 'Date']))
    expect(new Date(payload.timestamp).getTime()).toBeGreaterThan(Date.now() - 60_000)
    // the run is reflected in the automation's status
    await expect.poll(() => wsEval(page, (s, id) => s.databases[id].automations[0].lastStatus, dbId)).toBe('ok')
  })
})

test.describe('AI (mocked Claude API)', () => {
  test('"Improve writing" on a selection streams a result and replaces the text', async ({ page, context }) => {
    const IMPROVED = 'This sentence reads clearly now.'
    const bodies = await mockClaude(context, () => IMPROVED)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'AI page', content: doc(para('this sentence is kinda bad honestly'), para('Second paragraph stays.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed).toContainText('kinda bad')
    await ed.locator('p', { hasText: 'kinda bad' }).click()
    await selectText(page, ed, 'this sentence is kinda bad honestly')

    const bubble = page.getByRole('toolbar', { name: 'Formatting' }).or(page.locator('[aria-label="Formatting"]')).first()
    await expect(bubble).toBeVisible()
    await bubble.getByRole('button', { name: 'Ask AI' }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(ai).toBeVisible()
    await ai.getByRole('option', { name: /Improve writing/ }).click()
    await expect(ai).toContainText(IMPROVED)
    await ai.getByRole('option', { name: /Replace selection/ }).click()
    await expect(ai).toBeHidden()

    await expect(ed).toContainText(IMPROVED)
    await expect(ed).not.toContainText('kinda bad')
    await expect(ed).toContainText('Second paragraph stays.')
    await waitForPlain(page, id, new RegExp(IMPROVED.replace('.', '\\.')))
    // exactly one streaming request, carrying the selected text and the model
    const streamed = bodies.filter((b) => /"stream"\s*:\s*true/.test(b))
    expect(streamed).toHaveLength(1)
    const req = JSON.parse(streamed[0])
    expect(req.model).toBe('claude-opus-5-5')
    expect(JSON.stringify(req.messages)).toContain('this sentence is kinda bad honestly')
  })
})
