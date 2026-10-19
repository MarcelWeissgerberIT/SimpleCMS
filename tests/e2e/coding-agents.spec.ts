import { test, expect, openApp, gotoPage, wsEval, reloadApp } from './fixtures'

test('coding Type selects Claude, Codex or local; persists and reaches only capable workers', async ({ page }) => {
  await openApp(page)
  // Use the real task creation path and database schema.
  const id = await page.evaluate(() => (window as any).__oneCodingWrites.create('Agent selection test'))
  await gotoPage(page, id)
  const pick = page.getByTestId('coding-agent-select')
  await expect(pick).toHaveValue('claude')
  await expect(pick.locator('option')).toHaveText(['Claude Code', 'Codex', 'Local · Ollama'])
  await pick.selectOption('local')
  const selected = await wsEval(page, (s, id) => {
    const row = s.pages[id]
    const db = s.databases[row.databaseId]
    const prop = db.properties.find((p: any) => p.id.startsWith('coding_agent_'))
    return row.properties[prop.id]
  }, id)
  expect(selected).toBe('coding_agent_local')
  await reloadApp(page)
  await gotoPage(page, id)
  await expect(pick).toHaveValue('local')
  await pick.selectOption('codex')
  await expect(page.getByTestId('coding-model')).toHaveCount(0)
  await wsEval(page, (s, id) => {
    const row = s.pages[id]
    const db = s.databases[row.databaseId]
    const repo = db.properties.find((p: any) => p.name === 'Repo')
    const stage = db.properties.find((p: any) => p.name === 'Stage')
    const plan = db.pipeline.find((p: any) => p.kind === 'plan')
    s.updateProperty(db.id, repo.id, { options: [{ id: 'agent-repo', name: 'demo', color: 'gray' }] })
    s.setRowProperty(id, repo.id, 'agent-repo')
    s.setRowProperty(id, stage.id, plan.optionId ?? plan.id)
  }, id)
  // A worker that lacks the new capability must not silently run this task with Claude.
  const old = await page.evaluate(() => (window as any).__oneCodingWrites.next(['demo'], 'old-worker', true, ['doc', 'model']))
  expect(old).toBeNull()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  let payload: any
  await expect.poll(async () => {
    payload = await page.evaluate(() => (window as any).__oneCodingWrites.next(['demo'], 'new-worker', true, ['doc', 'model', 'agent:codex', 'agent:local']))
    return payload?.agent
  }).toBe('codex')
  expect(payload?.stage.kind).toBe('plan')
  expect(payload?.stage.model).toBeNull()
  await page.screenshot({ path: test.info().outputPath('coding-agent-selection.png'), fullPage: false })
})
