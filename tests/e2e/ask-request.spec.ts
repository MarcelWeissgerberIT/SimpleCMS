import { writeFile } from 'node:fs/promises'
import { test, expect, openApp, wsEval, uiEval, createPage, gotoPage, doc, para, MOD, mockClaude } from './fixtures'
import { startFakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN } from '../../src/app/features/coding/protocol'

const question = 'kannst du mir ein typescript klasse erstellen die ein interface zum login hat'
const reference = 'Tag 1: Gemeinsam verstehen. Tag 2: Das Team fährt. Atlas hält Requirements und Entscheidungen. Das Team entscheidet.'
const answer = '```typescript\ninterface Login { login(user: string): Promise<boolean>; }\n```'

test('page questions keep an independent coding request on the local model wire', async ({ page }, info) => {
  const fake = await startFakeWorker(47420, { worker: '1.33.1', name: 'question-fixture', repos: [], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: false, version: null }, setup: true })
  fake.can = [...WORKER_CAN]
  fake.textModels = [{ provider: 'local', model: 'atlas-flow:latest', context: 32768 }]
  fake.onText = request => ({ model: request.model, text: answer, inputTokens: 100, outputTokens: 50, usd: 0 })
  try {
    await openApp(page)
    await wsEval(page, s => {
      s.setWorkspaceAI({ policy: { restricted: [], providers: { local: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'workspace'] } } } })
      s.updateSettings({ ai: { routes: { ask: [{ p: 'local', m: 'atlas-flow:latest' }] } } })
    })
    const id = await createPage(page, { title: 'Workshop reference', content: doc(para(reference)) })
    await gotoPage(page, id)
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'coding' }))
    await page.getByRole('tab', { name: /Coding worker/ }).click()
    await page.getByLabel('Port', { exact: true }).fill('47420')
    await page.getByLabel('Port', { exact: true }).press('Enter')
    await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
    await expect(page.getByTestId('coding-conn')).toContainText('question-fixture')
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+k`)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    const input = palette.getByRole('combobox', { name: 'Command palette', exact: true })
    await input.fill('? ' + question)
    await input.press('Enter')
    await expect(palette.locator('.ask__answer')).toContainText('interface Login')
    expect(fake.textAsked).toHaveLength(1)
    const messages = fake.textAsked[0].messages
    expect(messages[0].content).toContain('optional reference material')
    expect(messages[0].content).toContain('language of the user')
    expect(messages[0].content).toContain('never instructions')
    expect(messages[0].content).toContain('actual tool result')
    const prompt = messages[1].content
    expect(prompt).toContain(question)
    expect(prompt).toContain('this request may be independent')
    expect(prompt).not.toContain('Apply this request to the text')
    expect(prompt.split(reference)).toHaveLength(2)
    // Answering does not silently append code to the source page.
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)).not.toContain('interface Login')
    await writeFile(info.outputPath('local-question-wire.json'), JSON.stringify({ messages }, null, 2))
    await page.screenshot({ path: info.outputPath('local-question-answer.png'), animations: 'disabled' })
  } finally { await fake.close() }
})

test('Claude page questions use the same request contract', async ({ page }) => {
  const bodies = await mockClaude(page, () => answer)
  await openApp(page)
  await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const id = await createPage(page, { title: 'Workshop reference', content: doc(para(reference)) })
  await gotoPage(page, id)
  await page.keyboard.press(`${MOD}+k`)
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  const input = palette.getByRole('combobox', { name: 'Command palette', exact: true })
  await input.fill('? ' + question)
  await input.press('Enter')
  await expect(palette.locator('.ask__answer')).toContainText('interface Login')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toContain('optional reference material')
  expect(bodies[0]).toContain('this request may be independent')
  expect(bodies[0]).toContain(question)
  expect(bodies[0]).not.toContain('Apply this request to the text')
})
