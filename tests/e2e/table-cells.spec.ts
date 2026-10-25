import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, doc, para, mockClaude, MOD, flush } from './fixtures'
import { mockClaudeScript, mockOpenRouter, seedEndpoints, text } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'

const ALL = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
const c = (id: string, value: string, header = false): JSONContent => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [220] }, content: [{ ...para(value), attrs: { id } }] })
const fixture = () => doc(para('Unselected page secret must stay here.'), { type: 'callout', attrs: { id: 'plate', color: 'orange' }, content: [para('Workshop plate — keep this wording.'), { type: 'table', attrs: { id: 'existing-table' }, content: [{ type: 'tableRow', content: [c('heading-a', 'Input', true), c('heading-b', 'Result', true)] }, { type: 'tableRow', content: [c('input-a', 'Requirement supplied by team'), c('result-b', 'Old result')] }, { type: 'tableRow', content: [c('input-c', 'No evidence supplied'), c('result-d', '')] }] }] })
const dialog = (page: Page) => page.getByRole('dialog', { name: /Fill existing cells|Review cell changes/ })
function payload(messages: any[]) {
  for (const m of [...messages].reverse()) {
    const value = typeof m.content === 'string' ? m.content : (m.content ?? []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('')
    try { const p = JSON.parse(value); if (p.allowedCellIds) return p } catch { /* not table data */ }
  }
  throw new Error('No cell prompt')
}
const reply = (messages: any[]) => JSON.stringify({ cells: payload(messages).allowedCellIds.map((cellId: string) => ({ cellId, value: 'Team source → verified proposal' })) })
async function setup(page: Page) {
  const id = await createPage(page, { title: 'Workshop existing cells', content: fixture() })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.getByText('Old result', { exact: true }).click()
  await page.getByRole('button', { name: 'Fill existing cells with AI', exact: true }).click()
  await expect(dialog(page).getByRole('checkbox', { name: 'B2', exact: true })).toBeChecked()
  await dialog(page).getByRole('textbox', { name: 'Task and source material' }).fill('Replace only the selected result cell with a proposal based on these team notes: evidence is verified.')
  return id
}
const content = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id].content, id)

test('page-table UI: review literal cell changes, preserve plate/layout/other inputs, no MCP, version and one undo', async ({ page, context }, info) => {
  const bodies = await mockClaude(context, raw => reply(JSON.parse(raw).messages))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await setup(page), before = await content(page, id)
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page)).toContainText('Team source → verified proposal')
  expect(await content(page, id)).toEqual(before)
  const request = JSON.parse(bodies.at(-1)!)
  expect(request.tools ?? []).toEqual([])
  expect(request.mcp_servers ?? []).toEqual([])
  expect(JSON.stringify(request)).not.toContain('Unselected page secret')
  expect(payload(request.messages).allowedCellIds).toEqual(['result-b'])
  await page.screenshot({ path: info.outputPath('cell-review.png'), animations: 'disabled' })
  await dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true }).click()
  await expect(dialog(page)).toContainText('Applied')
  const after = await content(page, id)
  const expected = structuredClone(before) as any
  const tb = expected.content[1].content[1]
  tb.content[1].content[1].content[0].content = [{ type: 'text', text: 'Team source → verified proposal' }]
  expect(after).toEqual(expected)
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  const ed = editorOf(page, id)
  await ed.getByText('Team source → verified proposal', { exact: true }).click()
  await page.keyboard.press(`${MOD}+z`)
  await expect(ed).toContainText('Old result')
})

test('invalid/out-of-scope model output never changes the document', async ({ page, context }) => {
  await mockClaude(context, () => JSON.stringify({ cells: [{ cellId: 'input-a', value: 'Must not overwrite' }] }))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await setup(page), before = await content(page, id)
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('Nothing was written')
  expect(await content(page, id)).toEqual(before)
  await expect(dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true })).toHaveCount(0)
})

test('concurrent target conflict blocks apply while an unrelated cell edit survives', async ({ page, context }) => {
  await mockClaude(context, raw => reply(JSON.parse(raw).messages))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await setup(page)
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page)).toContainText('Team source → verified proposal')
  await wsEval(page, (s, id) => { const d = structuredClone(s.pages[id].content); d.content[1].content[1].content[1].content[0].content[0].content = [{ type: 'text', text: 'Another person changed the input' }]; s.setContent(id, d, 'sync') }, id)
  await expect(dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true })).toBeEnabled()
  await dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true }).click()
  await expect(dialog(page)).toContainText('Applied')
  expect(JSON.stringify(await content(page, id))).toContain('Another person changed the input')
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  const ed = editorOf(page, id)
  await ed.getByText('Team source → verified proposal', { exact: true }).click()
  await page.getByRole('button', { name: 'Fill existing cells with AI', exact: true }).click()
  await dialog(page).getByRole('textbox', { name: 'Task and source material' }).fill('Use updated notes: a different proposed value.')
  await mockClaude(context, () => '{"cells":[{"cellId":"result-b","value":"New proposed value"}]}')
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page)).toContainText('New proposed value')
  await wsEval(page, (s, id) => { const d = structuredClone(s.pages[id].content); d.content[1].content[1].content[1].content[1].content[0].content = [{ type: 'text', text: 'Another person owns the result now' }]; s.setContent(id, d, 'sync') }, id)
  await expect(dialog(page).getByRole('alert')).toContainText('nothing was overwritten')
  await expect(dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true })).toBeDisabled()
})

test('native agent: read stable cells, stage only cell edits, explicit review', async ({ page, context }) => {
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await createPage(page, { title: 'Native cell tool', content: fixture() })
  await gotoPage(page, id)
  await editorOf(page, id).getByText('Old result', { exact: true }).click()
  await flush(page)
  const before = await content(page, id)
  const mock = await mockClaudeScript(context, [
    { blocks: [{ type: 'tool_use', id: 'read-cells', name: 'read_tables', input: { id, table_id: 'existing-table' } }] },
    { blocks: [{ type: 'tool_use', id: 'write-cells', name: 'update_table_cells', input: { id, table_id: 'existing-table', cells: [{ cellId: 'result-b', value: 'Native tool proposal' }] } }] },
    text('One result-cell edit is ready for review.'),
  ])
  await page.keyboard.press(`${MOD}+j`)
  const terminal = page.getByRole('region', { name: 'AI terminal' })
  await terminal.getByRole('textbox', { name: 'Task for the agent' }).fill('Update only the result cell from my supplied notes.')
  await terminal.getByRole('textbox', { name: 'Task for the agent' }).press('Enter')
  await expect(terminal.locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20000 })
  expect(mock.requests[0].body.tools.some((t: any) => t.name === 'read_tables')).toBe(true)
  await expect(terminal.locator('.term-change[data-kind="edit"]')).toHaveCount(1)
  expect(await content(page, id)).toEqual(before)
  await expect(terminal.getByTestId('edit-diff')).toContainText('Native tool proposal')
  await terminal.locator('.term-change[data-kind="edit"]').getByRole('button', { name: 'Apply #1' }).click()
  await expect(editorOf(page, id)).toContainText('Native tool proposal')
  expect(JSON.stringify(await content(page, id))).toContain('Workshop plate — keep this wording.')
})

test('three chosen cells: each is reviewable, only the accepted subset changes', async ({ page, context }) => {
  await mockClaude(context, raw => reply(JSON.parse(raw).messages))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await setup(page), before = await content(page, id)
  await dialog(page).getByRole('checkbox', { name: 'A3', exact: true }).check()
  await dialog(page).getByRole('checkbox', { name: 'B3', exact: true }).check()
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page).locator('.table-cells__plate')).toHaveCount(3)
  await dialog(page).locator('.table-cells__plate').filter({ has: page.locator('b', { hasText: /^A3$/ }) }).getByRole('checkbox').uncheck()
  await dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true }).click()
  await expect(dialog(page).locator('.table-cells__plate').filter({ hasText: 'Applied' })).toHaveCount(2)
  const expected = structuredClone(before) as any
  for (const row of [1, 2]) expected.content[1].content[1].content[row].content[1].content[0].content = [{ type: 'text', text: 'Team source → verified proposal' }]
  expect(await content(page, id)).toEqual(expected)
})

test('locking a page after the proposal prevents applying it', async ({ page, context }) => {
  await mockClaude(context, raw => reply(JSON.parse(raw).messages))
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await setup(page), before = await content(page, id)
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page)).toContainText('Team source → verified proposal')
  await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), id)
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Apply selected changes', exact: true })).toHaveCount(0)
  expect(await content(page, id)).toEqual(before)
})

test('OpenRouter uses the same text-only cell proposal and explicit apply', async ({ page, context }) => {
  const model = 'openai/gpt-6-luna'
  const catalogue = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8'))
  const row = readCatalogRow(catalogue.data.find((r: any) => r.id === model), '2026-10-12')!
  const endpoints = { [model]: [{ tag: 'nordwind', name: 'Nordwind' }] }
  const or = await mockOpenRouter(context, { chat: [req => ({ text: reply(req.body!.messages), cost: 0.0002 })], endpoints })
  await openApp(page)
  await wsEval(page, (s, row) => s.updateSettings({ aiKeys: { openrouter: 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000' }, ai: { models: [row] } }), { m: row.id, label: row.label, price: row.price, caps: capsOfRow(row), at: '2026-10-12' })
  await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), ALL)
  await seedEndpoints(page, endpoints)
  const id = await setup(page)
  await dialog(page).getByTestId('route-chip-provider').click()
  await page.getByRole('dialog', { name: 'Provider for this request', exact: true }).locator('button[data-provider="openrouter"]').click()
  await page.getByRole('dialog', { name: 'Model for this request only', exact: true }).locator(`[data-route="openrouter:${model}"]`).click()
  await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
  await expect(dialog(page)).toContainText('Team source → verified proposal')
  expect(or.posts()).toHaveLength(1)
  expect(or.posts()[0].body?.tools ?? []).toEqual([])
  await dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true }).click()
  await expect(dialog(page)).toContainText('Applied')
  expect(JSON.stringify(await content(page, id))).toContain('Team source → verified proposal')
})

const PORT = 47394
const models = [
  { provider: 'local', model: 'marcel-flow:latest', context: 32768 },
  { provider: 'ollama', model: 'cloud-choice', context: 65536 },
  { provider: 'minimax', model: 'MiniMax-M3.1-Flash', context: 131072 },
  { provider: 'codex', model: 'gpt-6.1-sol', context: 64000 },
  { provider: 'copilot', model: 'claude-opus-5.5', context: 32768, chat: true, maxOutput: 8192 },
]
test.describe('the same existing-cell action for worker text providers', () => {
  test.describe.configure({ mode: 'serial' })
  let fake: FakeWorker
  test.beforeEach(async ({ page }) => {
    fake = await startFakeWorker(PORT, { worker: '1.21.0', name: 'table-test-box', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: false, version: null }, setup: true })
    fake.can = [...WORKER_CAN]; fake.textModels = models
    fake.onText = request => ({ model: request.model, text: reply(request.messages), inputTokens: 200, outputTokens: 40, usd: request.provider === 'local' ? 0 : null })
    await openApp(page)
    await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: Object.fromEntries(['local', 'ollama', 'minimax', 'codex', 'copilot'].map(p => [p, { allow }])), restricted: [] } }), ALL)
    await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Coding worker/ }).click()
    await page.getByLabel('Port', { exact: true }).fill(String(PORT)); await page.getByLabel('Port', { exact: true }).press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('table-test-box')
    await page.keyboard.press('Escape')
  })
  test.afterEach(async () => { await fake?.close() })
  test('Copilot native agent can use the same cell tools and stages for review', async ({ page }) => {
    await wsEval(page, s => s.updateSettings({ ai: { routes: { terminal: [{ p: 'copilot', m: 'claude-opus-5.5' }] } } }))
    const id = await createPage(page, { title: 'Copilot table tools', content: fixture() })
    await gotoPage(page, id)
    await editorOf(page, id).getByText('Old result', { exact: true }).click()
    await flush(page)
    const before = await content(page, id)
    let turn = 0
    fake.onText = request => ({ model: request.model, inputTokens: 200, outputTokens: 40, usd: null, text: turn > 1 ? 'One cell proposal is ready.' : '', calls: turn++ === 0 ? [{ id: 'r1', name: 'read_tables', arguments: { id, table_id: 'existing-table' } }] : turn === 2 ? [{ id: 'r2', name: 'update_table_cells', arguments: { id, table_id: 'existing-table', cells: [{ cellId: 'result-b', value: 'Copilot cell proposal' }] } }] : [] })
    await page.keyboard.press(`${MOD}+j`)
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.getByRole('textbox', { name: 'Task for the agent' }).fill('Update only the result cell from these notes.')
    await term.getByRole('textbox', { name: 'Task for the agent' }).press('Enter')
    await expect(term.locator('.term-turn').last()).toHaveAttribute('data-status', 'done', { timeout: 20000 })
    await expect(term.locator('.term-change[data-kind="edit"]')).toHaveCount(1)
    expect(await content(page, id)).toEqual(before)
    expect(fake.textAsked[0].tools.some((t: any) => t.name === 'update_table_cells')).toBe(true)
    await term.locator('.term-change[data-kind="edit"]').getByRole('button', { name: 'Apply #1' }).click()
    await expect(editorOf(page, id)).toContainText('Copilot cell proposal')
  })
  for (const provider of ['local', 'ollama', 'minimax', 'codex', 'copilot']) test(`${provider}: uses text only, reviews and applies selected existing cells`, async ({ page }) => {
    const id = await setup(page)
    await dialog(page).getByTestId('route-chip-provider').click()
    await page.getByRole('dialog', { name: 'Provider for this request', exact: true }).locator(`button[data-provider="${provider}"]`).click()
    const model = models.find(m => m.provider === provider)!.model
    await page.getByRole('dialog', { name: 'Model for this request only', exact: true }).locator(`[data-route="${provider}:${model}"]`).click()
    await dialog(page).getByRole('button', { name: 'Propose values', exact: true }).click()
    await expect(dialog(page)).toContainText('Team source → verified proposal')
    expect(fake.textAsked).toHaveLength(1)
    expect(fake.textAsked[0].tools ?? []).toEqual([])
    expect(fake.textAsked[0].schema).toBeUndefined()
    expect(fake.textAsked[0]).toMatchObject({provider, model})
    expect(JSON.stringify(fake.textAsked[0])).not.toContain('Unselected page secret')
    await dialog(page).getByRole('button', { name: 'Apply selected changes', exact: true }).click()
    await expect(dialog(page)).toContainText('Applied')
    expect(JSON.stringify(await content(page, id))).toContain('Team source → verified proposal')
    expect(await wsEval(page, s => s.settings.ai?.default ?? null)).toBeNull()
  })
})
