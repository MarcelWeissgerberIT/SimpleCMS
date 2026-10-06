/**
 * AI-menu runs in the background (features/ai/runs.ts): a request outlives its panel — closing it, a click
 * in the sidebar, another page — and only Stop / Discard end it. The page shows its runs on a plate at the
 * foot of the content; a finished one is announced when its page is not open; results survive a reload on
 * this device. Claude is mocked with a held ("slow") answer — never api.anthropic.com.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, selectText, sidebarRow, reloadApp, flush, sse, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Slow {
  bodies: AnyState[]
  /** answer every request waiting so far */
  release: () => void
  /** answer at once from now on (false: hold again) */
  flow: (on: boolean) => void
  waiting: () => number
}

/** api.anthropic.com, held until release(): streamed requests get `text` as SSE, structured ones `json`. */
async function slowClaude(ctx: BrowserContext, answer: { text?: string; json?: () => object }): Promise<Slow> {
  const held: Array<() => void> = []
  const bodies: AnyState[] = []
  let flowing = false
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    if (!flowing) await new Promise<void>((resolve) => held.push(resolve))
    try {
      if (body.stream) await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(answer.text ?? 'ok') })
      else
        await route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: answer.json ? JSON.stringify(answer.json()) : (answer.text ?? 'ok') }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }),
        })
    } catch {
      /* the request was aborted (Stop / Discard) */
    }
  })
  return {
    bodies,
    release: () => held.splice(0).forEach((r) => r()),
    flow: (on) => {
      flowing = on
      if (on) held.splice(0).forEach((r) => r())
    },
    waiting: () => held.length,
  }
}

const IMPROVED = 'A tighter launch sentence.'
const setKey = (page: Page, lang?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), lang)
const panel = (page: Page) => page.getByRole('dialog', { name: /Ask Claude|Claude fragen/ })
const plate = (page: Page) => page.getByTestId('ai-runs').locator('button').first()
const toast = (page: Page, text: string | RegExp) => page.locator('.toast').filter({ hasText: text })
const runsInStore = (page: Page) => page.evaluate(async () => {
  // the run store is internal: read what the page shows instead (plate count) — and IndexedDB for what is saved
  const dbs = await indexedDB.databases()
  return dbs.some((d) => d.name === 'one-ai-runs')
})

/** Two pages: "Launch notes" (the text) and "Elsewhere" (to click to in the sidebar). */
async function setup(page: Page, content?: JSONContent): Promise<{ id: string; other: string }> {
  const other = await createPage(page, { title: 'Elsewhere', content: doc(para('Nothing to see here.')) })
  const id = await createPage(page, { title: 'Launch notes', content: content ?? doc(para('Intro line stays.'), para('our launch sentence is kinda loose'), para('Closing line.')) })
  await gotoPage(page, id)
  return { id, other }
}

/** Select `text` in the page and run "Improve writing" from the AI menu. */
async function improve(page: Page, id: string, text: string, opts: { menu?: RegExp; action?: RegExp } = {}): Promise<Locator> {
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: text }).click()
  await selectText(page, ed, text)
  await page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first().getByRole('button', { name: opts.menu ?? /^Ask AI$/ }).click()
  const ai = panel(page)
  await expect(ai).toBeVisible()
  await ai.getByRole('option', { name: opts.action ?? /Improve writing/ }).click()
  return ai
}

async function goSidebar(page: Page, title: string) {
  await sidebarRow(page, title).locator('.sb-row__title').click()
  await expect(page.locator('#main .pv-title')).toHaveValue(title)
}

test.describe('AI-menu runs in the background', () => {
  test('a click in the sidebar keeps the run → toast when ready → LED → back: the plate opens the result → Replace; ⌘Z restores', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    const ai = await improve(page, id, 'our launch sentence is kinda loose')
    await expect(ai.locator('.ai-wait')).toBeVisible()
    await expect.poll(() => claude.waiting()).toBe(1)

    // the sidebar: the panel closes, the request does not
    await goSidebar(page, 'Elsewhere')
    await expect(panel(page)).toHaveCount(0)
    claude.release()
    await expect(toast(page, 'AI result ready · Launch notes')).toBeVisible()
    await expect(sidebarRow(page, 'Launch notes').getByTestId('ai-run-led')).toBeVisible()

    // back: the plate says the result is ready
    await goSidebar(page, 'Launch notes')
    await expect(plate(page)).toBeVisible()
    await expect(plate(page)).toHaveText(/AI result ready.*Improve writing.*View/i)
    await expect(plate(page)).toHaveAttribute('data-state', 'ready')
    await plate(page).click()
    await expect(panel(page)).toContainText(IMPROVED)
    // seen: the sidebar LED goes out, the plate steps aside while the panel shows it
    await expect(sidebarRow(page, 'Launch notes').getByTestId('ai-run-led')).toHaveCount(0)
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)
    await panel(page).getByRole('option', { name: /Replace selection/ }).click()
    await expect(panel(page)).toHaveCount(0)
    const ed = editorOf(page, id)
    await expect(ed.locator('p').nth(1)).toHaveText(IMPROVED)
    await expect(ed.locator('p').first()).toHaveText('Intro line stays.')
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)

    // one undo step brings the text back
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed.locator('p').nth(1)).toHaveText('our launch sentence is kinda loose')
    expect(claude.bodies).toHaveLength(1)
  })

  test('the toast’s Open brings you to the page with the panel open on the result', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await goSidebar(page, 'Elsewhere')
    claude.release()
    await toast(page, 'AI result ready · Launch notes').getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Launch notes')
    await expect(panel(page)).toContainText(IMPROVED)
    await expect(panel(page).getByRole('option', { name: /Replace selection/ })).toBeVisible()
  })

  test('typing above the selection while it runs: Replace still hits the selected text', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    // a click into the page closes the panel; typing goes into the first line
    const ed = editorOf(page, id)
    await ed.locator('p').first().click()
    await expect(panel(page)).toHaveCount(0)
    await page.keyboard.press('Home')
    await page.keyboard.type('New words up here. ')
    await expect(plate(page)).toHaveText(/AI · Writing/i)
    await expect(plate(page)).toHaveAttribute('data-state', 'running')
    claude.release()
    await expect(plate(page)).toHaveAttribute('data-state', 'ready')
    await plate(page).click()
    await panel(page).getByRole('option', { name: /Replace selection/ }).click()
    await expect(ed.locator('p')).toHaveText(['New words up here. Intro line stays.', IMPROVED, 'Closing line.'])
  })

  test('the selected text deleted meanwhile: Replace is off with a hint, Insert below goes to the end of the page', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    // the sentence goes
    const ed = editorOf(page, id)
    await ed.locator('p').nth(1).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')
    await expect(ed.locator('p').nth(1)).toHaveText('')
    claude.release()
    await plate(page).click()
    const ai = panel(page)
    await expect(ai.getByTestId('ai-lost')).toContainText('Replace is off')
    await expect(ai.getByRole('option', { name: /Replace selection/ })).toHaveAttribute('aria-disabled', 'true')
    // Insert comes first now; Enter on Replace does nothing
    await expect(ai.getByRole('option').first()).toHaveText(/Insert below/)
    await ai.locator('.ai-cmd__input').press('ArrowDown')
    await ai.locator('.ai-cmd__input').press('Enter')
    await expect(ai).toBeVisible()
    await ai.getByRole('option', { name: /Insert below/ }).click()
    await expect(ai).toHaveCount(0)
    await expect(ed.locator('p').last()).toHaveText(IMPROVED)
    await expect(ed.locator('p').first()).toHaveText('Intro line stays.')
  })

  test('the page changed while you were away: the selected text is found again (Replace hits it) — or, when it is gone, Replace is off', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await goSidebar(page, 'Elsewhere')
    // meanwhile the page gets two new lines on top (another tab, a sync …): every position moves
    await wsEval(page, (s, id) => {
      const c = JSON.parse(JSON.stringify(s.pages[id].content))
      c.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: 'Added while away.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'And one more.' }] })
      s.setContent(id, c, 'sync')
    }, id)
    claude.release()
    await expect(toast(page, 'AI result ready · Launch notes')).toBeVisible()
    await goSidebar(page, 'Launch notes')
    await plate(page).click()
    await expect(panel(page).getByTestId('ai-lost')).toHaveCount(0)
    await panel(page).getByRole('option', { name: /Replace selection/ }).click()
    const ed = editorOf(page, id)
    await expect(ed.locator('p')).toHaveText(['Added while away.', 'And one more.', 'Intro line stays.', IMPROVED, 'Closing line.'])

    // a second run whose text is then deleted while away: lost
    claude.flow(false)
    await improve(page, id, 'Closing line.')
    await expect.poll(() => claude.waiting()).toBe(1)
    await goSidebar(page, 'Elsewhere')
    await wsEval(page, (s, id) => {
      const c = JSON.parse(JSON.stringify(s.pages[id].content))
      c.content = c.content.filter((n: AnyState) => !JSON.stringify(n).includes('Closing line.'))
      s.setContent(id, c, 'sync')
    }, id)
    claude.release()
    await expect(toast(page, 'AI result ready · Launch notes').last()).toBeVisible()
    await goSidebar(page, 'Launch notes')
    await plate(page).click()
    await expect(panel(page).getByTestId('ai-lost')).toBeVisible()
    await expect(panel(page).getByRole('option', { name: /Replace selection/ })).toHaveAttribute('aria-disabled', 'true')
  })

  test('a finished result survives a reload; Discard removes it for good', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    const ai = await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    claude.release()
    await expect(ai).toContainText(IMPROVED)
    // Esc on a finished result: the panel closes, the result stays
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(plate(page)).toHaveAttribute('data-state', 'ready')
    expect(await runsInStore(page)).toBe(true)

    await page.waitForTimeout(400)
    await reloadApp(page)
    await gotoPage(page, id)
    await expect(plate(page)).toHaveText(/AI result ready/i)
    await plate(page).click()
    await expect(panel(page)).toContainText(IMPROVED)
    await panel(page).getByRole('option', { name: /Discard/ }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)
    await expect(editorOf(page, id).locator('p').nth(1)).toHaveText('our launch sentence is kinda loose')

    await page.waitForTimeout(400)
    await reloadApp(page)
    await gotoPage(page, id)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)
  })

  test('Stop aborts the request: nothing is kept', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    const failed: string[] = []
    page.on('requestfailed', (r) => r.url().includes('api.anthropic.com') && failed.push(r.failure()?.errorText ?? ''))
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    const ai = await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await ai.getByRole('button', { name: 'Stop' }).click()
    await expect.poll(() => failed.length).toBe(1)
    // back to the actions, no run left
    await expect(ai.getByRole('option', { name: /Improve writing/ })).toBeVisible()
    await page.keyboard.press('Escape')
    claude.release()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('ai-runs')).toHaveCount(0)
    await expect(editorOf(page, id).locator('p').nth(1)).toHaveText('our launch sentence is kinda loose')
  })

  test('a reload while it runs: the run comes back as interrupted, Retry asks again', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await page.waitForTimeout(400)
    await reloadApp(page)
    claude.flow(true)
    await gotoPage(page, id)
    await expect(plate(page)).toHaveText(/AI · Interrupted/i)
    await plate(page).click()
    await expect(panel(page).getByRole('alert')).toContainText('A reload cut this request off')
    await panel(page).getByRole('option', { name: /Try again/ }).click()
    await expect(panel(page)).toContainText(IMPROVED)
    await panel(page).getByRole('option', { name: /Replace selection/ }).click()
    await expect(editorOf(page, id).locator('p').nth(1)).toHaveText(IMPROVED)
  })

  test('"Turn into database" goes on while you are on another page', async ({ page, context }) => {
    const answer = {
      title: 'Launch tasks',
      columns: [{ name: 'Owner', type: 'select', options: ['Lea', 'Tom'] }],
      entries: [
        { title: 'Write the press note', values: [{ column: 'Owner', value: 'Lea' }], body: null },
        { title: 'Book the venue', values: [{ column: 'Owner', value: 'Tom' }], body: null },
      ],
      groupBy: 'Owner',
      keep: [1],
    }
    const claude = await slowClaude(context, { json: () => answer })
    await openApp(page)
    await setKey(page)
    const list = { type: 'bulletList', content: ['Write the press note · Lea', 'Book the venue · Tom'].map((x) => ({ type: 'listItem', content: [para(x)] })) }
    const { id } = await setup(page, doc(para('Tasks for the launch:'), list as JSONContent, para('Closing line.')))
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Tasks for the launch' }).click()
    await ed.evaluate((root) => {
      const find = (s: string) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let n: Node | null
        while ((n = w.nextNode())) if ((n as Text).data.includes(s)) return n as Text
        throw new Error(s)
      }
      const a = find('Tasks for the launch')
      const b = find('Book the venue')
      const r = document.createRange()
      r.setStart(a, 0)
      r.setEnd(b, b.data.length)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
    })
    await page.waitForTimeout(200)
    await page.locator('[aria-label="Formatting"]').getByRole('button', { name: 'Ask AI' }).click()
    // under "More …" (the AI menu's top level is short)
    await panel(page).locator('#ai-row-more').click()
    await panel(page).getByRole('option', { name: /Turn into database/ }).click()
    await expect.poll(() => claude.waiting()).toBe(1)
    await goSidebar(page, 'Elsewhere')
    claude.release()
    await expect(toast(page, 'AI result ready · Launch notes')).toBeVisible()
    await goSidebar(page, 'Launch notes')
    await expect(plate(page)).toHaveText(/AI result ready.*Turn into database/i)
    await plate(page).click()
    await expect(page.getByTestId('todb-spec')).toHaveText('2 entries · 1 column · 1 block kept')
    await panel(page).getByRole('option', { name: /Convert/ }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(() => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => n.type), id)).toEqual(['paragraph', 'databaseBlock', 'paragraph'])
    await expect(page.locator('#main section.db .dbc')).toHaveCount(2)
  })

  test('German: plate, toast and LED', async ({ page, context }) => {
    const claude = await slowClaude(context, { text: 'Ein knapperer Satz.' })
    await openApp(page)
    await setKey(page, 'de')
    const { id } = await setup(page, doc(para('Erste Zeile.'), para('unser Satz ist zu lang geraten')))
    await improve(page, id, 'unser Satz ist zu lang geraten', { menu: /^KI fragen$/, action: /Text verbessern/ })
    await expect.poll(() => claude.waiting()).toBe(1)
    await page.keyboard.press('Escape')
    await expect(plate(page)).toHaveText(/KI · Schreibt/i)
    await page.locator('.sb section .sb-row', { hasText: 'Elsewhere' }).first().locator('.sb-row__title').click()
    claude.release()
    await expect(toast(page, 'KI-Ergebnis fertig · Launch notes').getByRole('button', { name: 'Öffnen' })).toBeVisible()
    await expect(page.locator('.sb-row', { hasText: 'Launch notes' }).getByTestId('ai-run-led')).toHaveAttribute('aria-label', 'KI-Ergebnis fertig')
    await page.locator('.sb section .sb-row', { hasText: 'Launch notes' }).first().locator('.sb-row__title').click()
    await expect(plate(page)).toHaveText(/KI-Ergebnis fertig.*Text verbessern.*Ansehen/i)
  })

  test('390 px: the plate fits the page, opens the result', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const claude = await slowClaude(context, { text: IMPROVED })
    await openApp(page)
    await setKey(page)
    const { id } = await setup(page)
    await improve(page, id, 'our launch sentence is kinda loose')
    await expect.poll(() => claude.waiting()).toBe(1)
    await page.keyboard.press('Escape')
    claude.release()
    await expect(plate(page)).toHaveAttribute('data-state', 'ready')
    const box = await plate(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // keyboard: focus the plate, Enter opens it
    await plate(page).focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toContainText(IMPROVED)
    await flush(page)
  })
})
