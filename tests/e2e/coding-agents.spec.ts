import { test, expect, openApp, gotoPage, wsEval, reloadApp } from './fixtures'

for (const selectedAgent of ['codex', 'minimax', 'ollama'] as const) test(`coding Type selects ${selectedAgent}; persists and reaches only capable workers`, async ({ page }) => {
  await openApp(page)
  // Use the real task creation path and database schema.
  const id = await page.evaluate(() => (window as any).__oneCodingWrites.create('Agent selection test'))
  await gotoPage(page, id)
  const pick = page.getByTestId('coding-agent-select')
  await expect(pick).toHaveValue('claude')
  await expect(pick.locator('option')).toHaveText(['Claude Code', 'Codex', 'Local · Ollama', 'MiniMax · API', 'Ollama Cloud'])
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
  if (selectedAgent !== 'codex') {
    // Existing databases have only the historical three options. Selecting the new engine upgrades that property.
    await wsEval(page, (s, { id, selectedAgent }) => {
      const db = s.databases[s.pages[id].databaseId]
      const prop = db.properties.find((p: any) => p.id.startsWith('coding_agent_'))
      s.updateProperty(db.id, prop.id, { options: prop.options.filter((o: any) => o.id !== `coding_agent_${selectedAgent}`) })
    }, { id, selectedAgent })
  }
  if (selectedAgent !== 'codex') {
    await wsEval(page, (s, id) => s.updateDatabase(s.pages[id].databaseId, { locked: true }), id)
    await pick.selectOption(selectedAgent)
    await expect(page.getByRole('alert')).toContainText('Unlock the database')
    await expect(pick).toHaveValue('local')
    await wsEval(page, (s, id) => s.updateDatabase(s.pages[id].databaseId, { locked: false }), id)
  }
  await pick.selectOption(selectedAgent)
  if (selectedAgent !== 'codex') await expect(page.getByTestId('coding-agent-type')).toContainText('Cloud API')
  await expect(page.getByTestId('coding-model')).toHaveCount(0)
  if (selectedAgent === 'ollama') await expect(page.locator('.ctk-cost')).toHaveText('Ollama plan')
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
    payload = await page.evaluate(() => (window as any).__oneCodingWrites.next(['demo'], 'new-worker', true, ['doc', 'model', 'agent:codex', 'agent:local', 'agent:minimax', 'agent:ollama']))
    return payload?.agent
  }).toBe(selectedAgent)
  expect(payload?.stage.kind).toBe('plan')
  expect(payload?.stage.model).toBeNull()
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(400) // let the responsive sidebar close before capturing the mobile layout
    for (const theme of ['light', 'dark']) {
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await pick.scrollIntoViewIfNeeded()
      await page.screenshot({ path: test.info().outputPath(`coding-agent-${selectedAgent}-${width}-${theme}.png`), fullPage: false })
    }
  }
})
