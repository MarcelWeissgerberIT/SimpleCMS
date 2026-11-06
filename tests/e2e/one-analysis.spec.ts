import { test, expect, openApp, wsEval } from './fixtures'
import { mockAgent, call, say, setKey } from './helpers/terminal'
import type { Page } from '@playwright/test'

async function setup(page: Page) {
  await openApp(page)
  await setKey(page)
  await page.evaluate(() => { location.hash = '#/coding/spec' })
  await expect.poll(() => page.evaluate(() => !!(window as any).__oneCodingWrites)).toBe(true)
  const id = await page.evaluate(() => (window as any).__oneCodingWrites.create('Document analysis without worker', 'spec')) as string
  await page.evaluate(id => { location.hash = `#/p/${id}` }, id)
  await expect(page.getByTestId('one-analysis-controls')).toBeVisible()
  return id
}

test('One executes document stages, waits for approval and saves the final document without a worker', async ({ page, context }) => {
  const id = await setup(page)
  const mock = await mockAgent(context, [call('read1', 'read_page', { id }), say('## Analysis\nObserved requirements from the task.'), call('read2', 'read_page', { id }), say('## Specification\nThe application shall display the approved document.'), call('read3', 'read_page', { id }), say('## Recorded\nThe reviewed specification is recorded.')])
  await expect(page.getByTestId('coding-offline')).toHaveCount(0)
  await page.getByTestId('coding-run').click()
  await expect(page.getByTestId('coding-approve')).toBeVisible({ timeout: 40_000 })
  expect(mock.bodies).toHaveLength(4)
  await page.screenshot({ path: '.shots/one-model-analysis-gate.png', fullPage: false })
  expect(mock.bodies.flatMap(b => b.tools ?? []).some((t: any) => ['edit_page','create_page','run_query'].includes(t.name))).toBe(false)
  const before = await wsEval(page, (s, id) => s.pages[id].plain, id)
  expect(before).toContain('Observed requirements')
  expect(before).toContain('application shall')
  await page.getByTestId('coding-approve').click()
  await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('reviewed specification is recorded')
  expect(mock.bodies).toHaveLength(6)
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
})

test('a task edited during an answer is not advanced or overwritten', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), async () => { await waiting; return say('STALE GENERATED DOCUMENT')() }])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(2)
  await wsEval(page, (s, id) => s.updatePage(id, { title: 'Edited while running' }), id)
  release()
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('STALE GENERATED DOCUMENT')
  await expect(page.locator('.ctk')).toContainText('Task or sources changed')
})

test('stop aborts the model and keeps the stage open', async ({ page, context }) => {
  const id = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), async () => { await waiting; return say('LATE RESULT')() }])
  await page.getByTestId('coding-run').click()
  await expect.poll(() => mock.bodies.length).toBe(2)
  await page.getByTestId('coding-stop').click()
  release()
  await expect(page.getByTestId('coding-stop')).toHaveCount(0)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('LATE RESULT')
})

test('an answer without reading the task remains a failed draft', async ({ page, context }) => {
  const id = await setup(page)
  await mockAgent(context, [say('UNSOURCED DOCUMENT')])
  await page.getByTestId('coding-run').click()
  await expect(page.locator('.ctk')).toContainText('Analysis incomplete')
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
  expect(await wsEval(page, (s, id) => s.pages[id].plain, id)).not.toContain('UNSOURCED DOCUMENT')
})

test('worker mode remains available and never sends a model request', async ({ page, aiNet }) => {
  await setup(page)
  await page.getByLabel('Execution', { exact: true }).selectOption('worker')
  await expect(page.getByTestId('coding-offline')).toBeVisible()
  await page.getByTestId('coding-run').click()
  expect(aiNet.count('anthropic')).toBe(0)
})

test('the pipeline step limit stops the model without completing a stage', async ({ page, context }) => {
  const id = await setup(page)
  await wsEval(page, (s, id) => {
    const db = s.databases[s.pages[id].databaseId]
    s.updateDatabase(db.id, { pipeline: db.pipeline.map((p: any) => ({ ...p, maxTurns: 1 })) })
  }, id)
  const mock = await mockAgent(context, [call('read', 'read_page', { id }), say('SHOULD NOT RUN')])
  await page.getByTestId('coding-run').click()
  await expect(page.locator('.ctk')).toContainText('Analysis incomplete')
  expect(mock.bodies).toHaveLength(1)
  await expect(page.getByTestId('coding-approve')).toHaveCount(0)
})
