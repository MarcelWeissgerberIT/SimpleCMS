/**
 * Claude's result in a SHARED page is its own undo step. Shared pages undo with Y (Yjs), which merges
 * one's own changes by time (500 ms) — without closing the step, typing right after "Insert" joined
 * Claude's change and ⌘Z took both. api.anthropic.com is never called (routed to a canned stream).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, wsEval, waitOnline, gotoPage, editorOf, createWorkspace } from './fixtures'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** One streamed text answer in the shape of the Messages API. */
function sse(text: string): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  return (
    ev('message_start', { message: { id: 'msg_cloud', type: 'message', role: 'assistant', model: 'e2e-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }) +
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { index: 0 }) +
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
    ev('message_stop', {})
  )
}

async function mockClaude(page: Page, answer: string) {
  await page.route('https://api.anthropic.com/**', (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(answer) })
  })
}

const errors: string[] = []
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

test.describe('team cloud — Claude and undo', () => {
  test("a shared page: Claude's inserted answer is its own undo step — typing right after it is undone on its own", async ({ page: a }) => {
    a.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    a.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`))
    await mockClaude(a, 'Inserted by Claude.')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Undo team')
    await openApp(a, wsId)
    await waitOnline(a)
    await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await wsEval(a, (s) => {
      const id = s.createPage({ title: 'Shared undo' })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First line.' }] }, { type: 'paragraph' }] }, 'import')
      return id as string
    })
    await gotoPage(a, id)
    const ed = editorOf(a, id)
    await expect(ed).toContainText('First line.')

    const ask = a.getByPlaceholder('Ask Claude to write anything…')
    await expect(async () => {
      await ed.locator('p').last().click()
      await a.keyboard.press('End')
      await a.keyboard.press('Space')
      try {
        await expect(ask).toBeFocused({ timeout: 2000 })
      } catch (e) {
        if (!(await ask.count())) await a.keyboard.press('Backspace')
        throw e
      }
    }).toPass({ timeout: 15_000 })
    await ask.fill('Write one line')
    await ask.press('Enter')
    const panel = a.getByRole('dialog', { name: 'Ask Claude' })
    await expect(panel.locator('.ai-out__body')).toContainText('Inserted by Claude.')
    await panel.getByRole('option', { name: /^Insert/ }).first().click()
    await expect(ed).toContainText('Inserted by Claude.')
    // at once, in the same place
    await a.keyboard.type(' More')
    await expect(ed).toContainText('Inserted by Claude. More')
    await a.keyboard.press(`${mod}+z`)
    await expect(ed).toContainText('Inserted by Claude.')
    await expect(ed).not.toContainText('More')
    await a.keyboard.press(`${mod}+z`)
    await expect(ed).not.toContainText('Inserted by Claude.')
    await expect(ed).toContainText('First line.')
  })
})
