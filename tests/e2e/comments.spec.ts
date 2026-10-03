/** Comments (margin notes): create, reply, resolve / re-open, focus both ways, privacy, detached threads, narrow sheet. */
import { inflateRawSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, flush, pageById, wsEval, selectText, MOD } from './fixtures'

/** Text nodes of a doc that carry a comment mark: [text, thread id]. */
function anchored(n: JSONContent, out: Array<[string, string]> = []): Array<[string, string]> {
  const m = n.marks?.find((x) => x.type === 'comment')
  if (n.type === 'text' && m) out.push([n.text ?? '', String(m.attrs?.id)])
  n.content?.forEach((c) => anchored(c, out))
  return out
}

async function threads(page: Page, id: string): Promise<Array<Record<string, any>>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (await pageById(page, id)).comments ?? []
}

/** A page with one thread "c1" on "secret launch date", written through the store. */
async function pageWithThread(page: Page, title: string): Promise<string> {
  const id = await createPage(page, {
    title,
    content: doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'We keep the ' }, { type: 'text', text: 'secret launch date', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }, { type: 'text', text: ' for the board.' }] },
      para('Second paragraph stays.'),
    ),
  })
  await wsEval(page, (s, id) => s.addComment(id, { id: 'c1', quote: 'secret launch date', body: 'Confidential remark xyz' }), id)
  await flush(page)
  return id
}

test.describe('comments', () => {
  test('select → Comment → write; reply, resolve, show resolved, re-open; highlight ⇄ thread focus', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ userName: 'Ada' }))
    const id = await createPage(page, { title: 'Review notes', content: doc(para('The launch moves to Monday next week.'), para('The budget stays the same.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    await selectText(page, ed, 'moves to Monday')
    await page.getByRole('toolbar').getByRole('button', { name: 'Comment' }).click()
    const composer = page.getByRole('textbox', { name: 'New comment' })
    await expect(composer).toBeFocused()
    // the range is highlighted while writing
    await expect(ed.locator('.cmark-hl.is-draft')).toHaveText('moves to Monday')
    await page.keyboard.type('Is Monday confirmed?')
    await page.keyboard.press('Enter')

    // the thread lives on the page, the anchor is a mark in the content
    await expect.poll(async () => (await threads(page, id)).length).toBe(1)
    const [thread] = await threads(page, id)
    expect(thread).toMatchObject({ quote: 'moves to Monday', body: 'Is Monday confirmed?', author: 'Ada', resolved: false, replies: [] })
    await flush(page)
    expect(anchored((await pageById(page, id)).content)).toEqual([['moves to Monday', thread.id]])

    // wide layout: a card in the right margin, next to its text
    await expect(page.locator(`.one-editor[data-rail="margin"]`)).toHaveCount(1)
    const card = page.locator(`[data-thread-card="${thread.id}"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('Is Monday confirmed?')
    const mark = ed.locator('.cmark-hl', { hasText: 'moves to Monday' })
    const [cardBox, markBox] = [await card.boundingBox(), await mark.boundingBox()]
    expect(cardBox!.x).toBeGreaterThan(markBox!.x + 200)
    expect(Math.abs(cardBox!.y - markBox!.y)).toBeLessThan(60)

    // reply
    await card.click()
    const reply = card.getByRole('textbox', { name: 'Reply' })
    await reply.fill('Yes — confirmed by ops.')
    await reply.press('Enter')
    await expect(card).toContainText('Yes — confirmed by ops.')
    await expect.poll(async () => (await threads(page, id))[0].replies.length).toBe(1)

    // resolve: the card and the highlight go away, the thread stays
    await card.getByRole('button', { name: 'Resolve' }).click()
    await expect.poll(async () => (await threads(page, id))[0].resolved).toBe(true)
    await expect(card).toBeHidden()
    await expect(ed.locator('.cmark-hl')).toHaveCount(0)
    await expect(page.locator('.one-editor[data-rail]')).toHaveCount(0)

    // show resolved → re-open
    await page.getByRole('button', { name: 'Show resolved' }).click()
    await expect(card).toBeVisible()
    await expect(card).toContainText('Resolved')
    await card.getByRole('button', { name: 'Re-open' }).click()
    await expect.poll(async () => (await threads(page, id))[0].resolved).toBe(false)
    await expect(card).not.toContainText('Resolved')

    // clicking elsewhere drops the focus; clicking the highlighted text focuses the thread
    await ed.locator('p', { hasText: 'budget' }).click()
    await expect(card).not.toHaveAttribute('aria-current', 'true')
    await expect(ed.locator('.cmark-hl.is-active')).toHaveCount(0)
    await mark.click()
    await expect(card).toHaveAttribute('aria-current', 'true')
    await expect(ed.locator('.cmark-hl.is-active')).toHaveText('moves to Monday')

    // …and vice versa: Escape clears, clicking the card lights its text up again
    await card.getByRole('textbox', { name: 'Reply' }).focus()
    await page.keyboard.press('Escape')
    await expect(ed.locator('.cmark-hl.is-active')).toHaveCount(0)
    await card.locator('.centry__body').first().click()
    await expect(ed.locator('.cmark-hl.is-active')).toHaveText('moves to Monday')

    // Mod+Alt+M comments the selection from the keyboard
    await selectText(page, ed, 'budget')
    await page.keyboard.press(`${MOD}+Alt+m`)
    await expect(composer).toBeFocused()
    await page.keyboard.type('Check the numbers')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await threads(page, id)).length).toBe(2)
  })

  test('comments never leave the device: share link and Markdown copy strip mark and text', async ({ page, browser, context, errors }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const id = await pageWithThread(page, 'Private notes')
    await gotoPage(page, id)
    await expect(page.locator('[data-thread-card="c1"]')).toContainText('Confidential remark xyz')

    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()

    // the link's payload (deflated JSON): the text is there, no comment mark, no comment data
    const payload = inflateRawSync(Buffer.from(decodeURIComponent(link.split('#/s/')[1]), 'base64url')).toString('utf8')
    expect(payload).toContain('secret launch date')
    expect(payload).not.toContain('Confidential remark xyz')
    expect(payload).not.toContain('"comment"')

    // Markdown copy: the text, not the comment
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('We keep the secret launch date for the board.')
    expect(md).not.toContain('Confidential')

    // the shared view renders the text without any highlight or anchor
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.locator('.shv__doc')).toContainText('We keep the secret launch date for the board.')
    await expect(p2.locator('.shv__doc [data-comment], .shv__doc .cmark-hl')).toHaveCount(0)
    await expect(p2.getByText('Confidential remark xyz')).toHaveCount(0)
    await other.close()

    // the JSON backup keeps them: the data is still on the page
    expect((await threads(page, id))[0].body).toBe('Confidential remark xyz')
  })

  test('deleting the anchored text keeps the thread as detached; deleting the thread removes the mark', async ({ page }) => {
    await openApp(page)
    const id = await pageWithThread(page, 'Detach me')
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const card = page.locator('[data-thread-card="c1"]')
    await expect(card).toBeVisible()

    await selectText(page, ed, 'secret launch date')
    await page.keyboard.press('Backspace')
    await expect(ed).toContainText('We keep the  for the board.')
    await expect(card).toContainText('Detached')
    await expect(card.locator('.ccard__quote')).toHaveText('secret launch date')
    await flush(page)
    expect(anchored((await pageById(page, id)).content)).toEqual([])
    expect((await threads(page, id)).map((t) => t.id)).toEqual(['c1'])

    // undo brings the anchor back: attached again
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed.locator('.cmark-hl')).toHaveText('secret launch date')
    await expect(card).not.toContainText('Detached')

    // delete the thread from its menu: data and anchor are gone
    await card.click()
    await card.getByRole('button', { name: 'Thread options' }).click()
    await page.getByRole('menuitem', { name: 'Delete thread' }).click()
    await expect(card).toHaveCount(0)
    await flush(page)
    expect(await threads(page, id)).toEqual([])
    expect(anchored((await pageById(page, id)).content)).toEqual([])
  })

  test('narrow layout: a summary line opens the comments sheet; clicking a highlight opens its thread', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await openApp(page)
    const id = await pageWithThread(page, 'Narrow')
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(page.locator('.one-editor[data-rail]')).toHaveCount(0)
    const summary = page.locator('.csummary')
    await expect(summary).toContainText('1 open')
    await summary.getByRole('button', { name: 'View' }).click()
    const sheet = page.getByRole('dialog', { name: 'Comments' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-thread-card="c1"]')).toContainText('Confidential remark xyz')
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()

    await ed.locator('.cmark-hl').click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-thread-card="c1"]')).toHaveAttribute('aria-current', 'true')
  })
})
