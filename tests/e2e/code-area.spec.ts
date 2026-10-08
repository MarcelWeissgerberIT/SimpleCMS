/**
 * The shared code area (ui/code) where people meet it: an agent's job ("Instructions": tool names, placeholders
 * counted and jumped to, the run asking first while any is open, line numbers, Tab / Esc then Tab), code blocks on
 * pages (line numbers by default from 4 lines, per block and device; wrap; copy with a spoken confirmation; the JSON
 * check; Mod+A takes the code first; the stored node stays { language }) and the One Script editor (the error and
 * the unclosed bracket that caused it: gutter marks, a list that jumps, the textarea described by it).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, gotoPage, doc, para, mockClaude, reloadApp, MOD } from './fixtures'

const cb = (language: string | null, text: string, id?: string) => ({ type: 'codeBlock', attrs: { language, ...(id ? { id } : {}) }, content: [{ type: 'text', text }] })

const JOB = [
  '## Mirror the knowledge base',
  '1. Call atlas_search for [LAST RUN DATE]; then [HOW TO LIST THE ITEMS].',
  '2. Find the row (use query_database); if none, create_row.',
  '3. Map Status ← [STATUS MAPPING].',
].join('\n')

async function newAgent(page: Page) {
  await openApp(page, '#/agents')
  await page.getByRole('button', { name: /Blank/ }).first().click()
  const dialog = page.getByRole('dialog', { name: /New agent/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('agent job field', () => {
  test('tool names and placeholders highlighted, counted, jumped to; line numbers; Tab indents, Esc then Tab leaves', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: [{ id: 'm1', name: 'atlas', url: 'https://atlas.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['atlas_search', 'atlas_get'] }] }))
    const dialog = await newAgent(page)
    await dialog.getByLabel('Name').fill('Mirror')
    await dialog.getByRole('checkbox', { name: /ATLAS/ }).check()
    const job = dialog.getByTestId('agx-job')
    const ta = job.locator('textarea')
    await expect(ta).toHaveAccessibleName('Instructions')
    await ta.fill(JOB)
    // counted in the bar, explained below
    await expect(job.getByTestId('ca-placeholders')).toHaveText('3 placeholders open')
    await expect(dialog.getByTestId('agx-phnote')).toContainText('3 placeholders are still open')
    // highlighted: One's tools of this agent and the ticked MCP server's tools
    await expect(job.locator('.syn-ph')).toHaveText(['[LAST RUN DATE]', '[HOW TO LIST THE ITEMS]', '[STATUS MAPPING]'])
    await expect(job.locator('.syn-tool')).toHaveText(['atlas_search', 'query_database', 'create_row'])
    await expect(dialog.getByText('4 tools of its MCP servers')).toHaveCount(0)
    await expect(dialog.getByText(/2 tools of its MCP servers/)).toBeVisible()
    // one line number per line
    await expect(job.locator('.ca__ln')).toHaveCount(4)
    await expect(job.locator('.ca__ln').nth(3)).toHaveAttribute('data-n', '4')
    // "Next placeholder" selects the first one; typing replaces it
    await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0))
    await job.getByRole('button', { name: 'Next placeholder' }).click()
    expect(await ta.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('[LAST RUN DATE]')
    await page.keyboard.type('the last run')
    await expect(job.getByTestId('ca-placeholders')).toHaveText('2 placeholders open')
    // Tab indents the line, Shift+Tab takes it back
    await ta.evaluate((el: HTMLTextAreaElement) => {
      const at = el.value.indexOf('2. Find')
      el.setSelectionRange(at, at)
    })
    await page.keyboard.press('Tab')
    await expect(ta).toHaveValue(/\n {2}2\. Find/)
    await page.keyboard.press('Shift+Tab')
    await expect(ta).toHaveValue(/\n2\. Find/)
    // Enter continues the numbered list
    await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue(/\n4\. $/)
    // Esc, then Tab leaves the field — and the dialog stays open
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(ta).not.toBeFocused()
    await expect(dialog).toBeVisible()
    await expect(ta).toHaveAttribute('aria-describedby', /keys/)
  })

  test('saved with open placeholders: Run now asks first; Cancel runs nothing, "Run anyway" runs', async ({ page, context }) => {
    const bodies = await mockClaude(context, () => 'Checked everything. Nothing to change.')
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const dialog = await newAgent(page)
    await dialog.getByLabel('Name').fill('Mirror')
    await dialog.getByTestId('agx-job').locator('textarea').fill(JOB)
    await dialog.getByRole('button', { name: 'Create agent' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.agx-dhead')).toContainText('Mirror')
    await page.getByRole('button', { name: 'Run now' }).click()
    const confirm = page.getByRole('dialog', { name: 'Placeholders are still open' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('3 placeholders ([LAST RUN DATE] …)')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    await page.waitForTimeout(400)
    expect(bodies.length).toBe(0)
    await page.getByRole('button', { name: 'Run now' }).click()
    await page.getByRole('button', { name: 'Run anyway' }).click()
    await expect.poll(() => bodies.length, { timeout: 20_000 }).toBeGreaterThan(0)
  })
})

test.describe('code blocks on pages', () => {
  const JSON_TEXT = ['{', '  "id": "mirror",', '  "tools": ["a", "b"],', '  "on": true,', '}'].join('\n')
  const LONG = ['function go(rows) {', `  return rows.map((r) => ({ ${'title: r.title, '.repeat(12)}done: true }))`, '}', '// end', 'go([])'].join('\n')

  test('line numbers from 4 lines on (per block, remembered), JSON check, wrap, copy, Mod+A; the stored node keeps only its language', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await createPage(page, { title: 'Code', content: doc(para('Before'), cb('json', JSON_TEXT, 'cbjson'), cb('javascript', 'let a = 1\nlet b = 2', 'cbtwo'), cb('javascript', LONG, 'cblong')) })
    await gotoPage(page, id)
    const blocks = page.locator('#main .code-block')
    await expect(blocks).toHaveCount(3)
    const [json, two, long] = [blocks.nth(0), blocks.nth(1), blocks.nth(2)]
    await expect(json.getByRole('button', { name: 'Language: JSON' })).toBeVisible()
    // numbers: on for 5 lines, off for 2 — one per line, never part of the text
    await expect(json).toHaveAttribute('data-ln', 'on')
    await expect(json.locator('.code-ln')).toHaveCount(5)
    await expect(json.locator('.code-ln').nth(4)).toHaveAttribute('data-n', '5')
    await expect(json.locator('.code-ln').first()).toBeVisible()
    await expect(two).toHaveAttribute('data-ln', 'off')
    await expect(two.locator('.code-ln').first()).toBeHidden()
    // the JSON check: the trailing comma, clickable to its place
    await expect(json.getByTestId('code-json-check')).toContainText('Ln 4, Col 13: A comma right before the closing bracket')
    await json.getByTestId('code-json-check').click()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(',')
    // per block, remembered on this device
    await two.getByRole('button', { name: 'Line numbers' }).click()
    await expect(two).toHaveAttribute('data-ln', 'on')
    await expect(two.getByRole('button', { name: 'Line numbers' })).toHaveAttribute('aria-pressed', 'true')
    await reloadApp(page)
    await gotoPage(page, id)
    await expect(page.locator('#main .code-block').nth(1)).toHaveAttribute('data-ln', 'on')
    // without wrap a long line scrolls (one row per line); with wrap it wraps
    const pre = page.locator('#main .code-block').nth(2).locator('pre')
    expect(await pre.evaluate((el) => [getComputedStyle(el).whiteSpace, getComputedStyle(el.querySelector('code')!).whiteSpace])).toEqual(['pre', 'pre'])
    expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await page.locator('#main .code-block').nth(2).getByRole('button', { name: 'Wrap lines' }).click()
    await expect(page.locator('#main .code-block').nth(2)).toHaveAttribute('data-wrap', 'on')
    expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
    // copy: the code on the clipboard, said out loud
    await long.getByRole('button', { name: 'Copy' }).click()
    await expect(long.getByRole('status')).toHaveText('Code copied to the clipboard')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG)
    // Mod+A takes the code first, the page on the second press
    await long.locator('code').click({ position: { x: 30, y: 8 } })
    await page.keyboard.press(`${MOD}+a`)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(LONG)
    await page.keyboard.press(`${MOD}+a`)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Before')
    // none of this went into the document
    const attrs = await wsEval(page, (s, pid) => (s.pages[pid].content.content as Array<{ type: string; attrs?: Record<string, unknown> }>).filter((n) => n.type === 'codeBlock').map((n) => Object.keys(n.attrs ?? {}).sort()), id)
    for (const keys of attrs) expect(keys.filter((k) => k !== 'id' && k !== 'language')).toEqual([])
  })

  test('One Script is a language of code blocks', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Script', content: doc(cb('onescript', 'let due = db("Tasks").where(Done = false)\nfor t in due {\n  notify(t.title)\n}')) })
    await gotoPage(page, id)
    const block = page.locator('#main .code-block')
    await expect(block.getByRole('button', { name: 'Language: One Script' })).toBeVisible()
    await expect(block.locator('.hljs-keyword').first()).toHaveText('let')
    await expect(block.locator('.hljs-string').first()).toHaveText('"Tasks"')
  })
})

test.describe('One Script editor', () => {
  test('the error and its cause: gutter marks, a list that jumps, the textarea described by it, the message never over the code', async ({ page }) => {
    await openApp(page)
    const code = 'let n = 1\nfor t in [1, 2] {\n  t.set(Priority: "High"\n  notify("x")\n}\n'
    await wsEval(page, (s, c) => {
      const now = Date.now()
      s.upsertScript({ id: 'scErr', name: 'Broken', code: c, kind: 'script', createdAt: now, updatedAt: now })
    }, code)
    await page.evaluate(() => (window.location.hash = '#/scripts/scErr'))
    const ta = page.locator('.sc-code__input')
    await expect(ta).toBeVisible()
    const problems = page.getByTestId('ca-problems')
    await expect(problems.getByRole('listitem')).toHaveCount(2)
    await expect(problems.getByRole('listitem').first()).toContainText('3:8')
    await expect(problems.getByRole('listitem').first()).toContainText('“(” opened here is never closed')
    await expect(problems.getByRole('listitem').nth(1)).toContainText('4:')
    await expect(page.locator('.sc-code .ca__row[data-mark="warning"] .ca__ln')).toHaveAttribute('data-n', '3')
    await expect(page.locator('.sc-code .ca__row[data-mark="error"] .ca__ln')).toHaveAttribute('data-n', '4')
    await expect(page.locator('.sc-code .ca-bad')).toHaveText('(')
    // the list describes the field (a screen reader hears the message, not just "invalid")
    const listId = await problems.getAttribute('id')
    await expect(ta).toHaveAttribute('aria-describedby', new RegExp(listId!))
    await expect(ta).toHaveAttribute('aria-invalid', 'true')
    // the message sits after the end of its line
    const clear = await page.evaluate(() => {
      const row = document.querySelector('.sc-code .ca__row[data-mark="warning"]')!
      const lens = row.querySelector('.ca__lens')!.getBoundingClientRect()
      const text = row.querySelector('.ca__text')!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEndBefore(row.querySelector('.ca__lens-at')!)
      return lens.left - range.getBoundingClientRect().right
    })
    expect(clear).toBeGreaterThan(4)
    // the entry jumps to its place
    await problems.getByRole('button').first().click()
    await expect(ta).toBeFocused()
    expect(await ta.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(code.indexOf('t.set(') + 5)
  })
})
