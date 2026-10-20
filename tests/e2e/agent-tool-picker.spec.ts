import { test, expect, openApp, wsEval, flush, reloadApp } from './fixtures'

const servers = [
  { id: 'm-atlas', name: 'atlas', url: 'https://atlas.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['atlas_agent_list', 'atlas_agent_create', 'atlas_agent_update', 'atlas_agent_block', 'atlas_agent_revoke', 'atlas_agent_token', 'atlas_agent_token_revoke', 'atlas_project_get', 'atlas_record_search'], checkedAt: 1 },
  { id: 'm-off', name: 'off', url: 'https://off.example.com/mcp', token: '', enabled: false, prompt: '', tools: ['off_get_record'], checkedAt: 1 },
]

async function draft(page: import('@playwright/test').Page) {
  await openApp(page, '#/agents')
  await wsEval(page, (s, mcpServers) => s.updateSettings({ mcpServers }), servers)
  await page.locator('[data-recipe="blank"]').click()
  return page.locator('.agx-editor')
}

test('Insert tool searches One and allowed MCP names, replaces the selection and keeps native undo', async ({ page }) => {
  const d = await draft(page)
  const job = d.getByTestId('agx-job').locator('textarea')
  await job.fill('Use HERE for the report.')
  await job.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 8))
  await d.getByTestId('agx-insert-tool').click()
  await page.getByRole('menu').getByRole('textbox', { name: 'Search tools' }).fill('query_database')
  await page.getByRole('menuitem', { name: 'query_database', exact: true }).click()
  await expect(job).toHaveValue('Use query_database for the report.')
  await expect(job).toBeFocused()
  await job.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(job).toHaveValue('Use HERE for the report.')
  await d.getByRole('checkbox', { name: 'ATLAS', exact: true }).check()
  const tools = d.getByRole('group', { name: 'Tools of ATLAS', exact: true })
  await tools.getByRole('button', { name: 'Read-only tools' }).click()
  await d.getByTestId('agx-insert-tool').click()
  await page.getByRole('menu').getByRole('textbox', { name: 'Search tools' }).fill('atlas_agent')
  await expect(page.getByRole('menuitem', { name: 'atlas_agent_list', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'atlas_agent_create', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await d.getByRole('checkbox', { name: /^OFF switched off here$/ }).check()
  await d.getByTestId('agx-insert-tool').click()
  await page.getByRole('menu').getByRole('textbox', { name: 'Search tools' }).fill('off_get')
  await expect(page.getByRole('menuitem', { name: 'off_get_record', exact: true })).toHaveCount(0)
})

test('MCP tools can be selected without a profile, searched, saved, reopened and disabled completely', async ({ page }) => {
  const d = await draft(page)
  await d.getByLabel('Name', { exact: true }).fill('Atlas helper')
  await d.getByTestId('agx-job').locator('textarea').fill('Read and report project status.')
  await d.getByRole('checkbox', { name: 'ATLAS', exact: true }).check()
  const tools = d.getByRole('group', { name: 'Tools of ATLAS', exact: true })
  await expect(tools.getByRole('checkbox')).toHaveCount(9)
  await tools.getByRole('button', { name: 'None', exact: true }).click()
  await tools.getByRole('searchbox').fill('agent_list')
  await tools.getByRole('checkbox', { name: 'atlas_agent_list', exact: true }).check()
  await d.getByRole('button', { name: 'Create agent' }).click()
  await expect(d).toBeHidden()
  let saved = await wsEval(page, (s) => Object.values(s.agents ?? {})[0])
  expect(saved.mcpTools).toEqual({ atlas: ['atlas_agent_list'] })
  await flush(page)
  await reloadApp(page)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog')
  const again = edit.getByRole('group', { name: 'Tools of ATLAS', exact: true })
  await expect(again.getByRole('checkbox', { checked: true })).toHaveCount(1)
  await again.getByRole('button', { name: 'None', exact: true }).click()
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  saved = await wsEval(page, (s) => Object.values(s.agents ?? {})[0])
  expect(saved.mcpTools).toEqual({ atlas: [] })
})

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`German tool selection ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    const d = await draft(page)
    await wsEval(page, (s, theme) => s.updateSettings({ language: 'de', theme }), theme)
    await d.getByRole('checkbox', { name: 'ATLAS', exact: true }).check()
    const tools = d.getByRole('group', { name: 'Werkzeuge von ATLAS', exact: true })
    await tools.getByRole('button', { name: 'Nur lesende Werkzeuge' }).click()
    await tools.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ animations: 'disabled', path: `/tmp/one-agent-tools-${width}-${theme}.png` })
    await d.getByTestId('agx-insert-tool').click()
    await page.getByRole('menu').getByRole('textbox', { name: 'Werkzeuge suchen' }).fill('atlas_agent_list')
    await expect(page.getByRole('menuitem', { name: 'atlas_agent_list', exact: true })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: `/tmp/one-agent-tool-picker-${width}-${theme}.png` })
  })
}
