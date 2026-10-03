/**
 * Synced blocks: slash insert, Copy and sync → paste a reference on another page, edits flowing
 * both ways (store + open editors, caret kept), unsync / unsync all, original deleted / trashed
 * (content kept, read-only, link back on restore), no nesting, duplicate page, Markdown + share,
 * reload, German labels.
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, flush, pageById, plainOf, reloadApp, wsEval, uiEval, MOD } from './fixtures'

const synced = (syncId: string, sourcePageId: string | null, ...content: JSONContent[]): JSONContent => ({ type: 'syncedBlock', attrs: { syncId, sourcePageId }, content })

/** Synced blocks anywhere in a page's stored content. */
async function storedSynced(page: Page, id: string): Promise<JSONContent[]> {
  const p = await pageById(page, id)
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'syncedBlock') out.push(n)
    ;(n.content ?? []).forEach(walk)
  }
  if (p.content) walk(p.content)
  return out
}

const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join(n.type === 'syncedBlock' || n.type === 'doc' ? '\n' : '')

/** ProseMirror selection head of an editor (TipTap puts the editor on its DOM node). */
const caretOf = (ed: Locator) => ed.evaluate((el) => (el as HTMLElement & { editor?: { state: { selection: { from: number } } } }).editor?.state.selection.from ?? -1)

/** Run the service's pending writes now (it batches them for a few ms). */
const settle = (page: Page) => page.evaluate(() => (window as unknown as { __oneSynced: { flush: () => void } }).__oneSynced.flush())

test.describe('synced blocks', () => {
  test('slash → synced block; Copy and sync → paste on page B; edits flow both ways and the caret stays', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const a = await createPage(page, { title: 'Sync source', content: doc(para('Intro A')) })
    const b = await createPage(page, { title: 'Sync target', content: doc(para('Intro B')) })

    // A: "/synced" makes an empty original, the caret inside it
    await gotoPage(page, a)
    const edA = editorOf(page, a)
    await edA.locator('p', { hasText: 'Intro A' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/synced')
    await expect(page.locator('.slash .slash__item[aria-selected="true"] .slash__name')).toHaveText('Synced block')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Shared alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Shared beta')
    const original = edA.locator('[data-type="synced-block"]')
    await expect(original).toHaveAttribute('data-role', 'original')
    await expect(original.locator('.synced__body p')).toHaveText(['Shared alpha', 'Shared beta'])
    await expect(original.locator('.synced__tag')).toHaveText(/Synced · 1 page/)

    // block menu of a line inside it → Copy and sync
    await original.locator('p', { hasText: 'Shared alpha' }).hover()
    await page.locator('.block-handle__grip').click()
    await page.getByRole('menuitem', { name: 'Copy and sync' }).click()
    await expect(page.getByText('Synced copy on the clipboard')).toBeVisible()

    // B: paste → a reference, labelled with the original's page
    await gotoPage(page, b)
    const edB = editorOf(page, b)
    await edB.locator('p', { hasText: 'Intro B' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+v`)
    const reference = edB.locator('[data-type="synced-block"]')
    await expect(reference).toHaveAttribute('data-role', 'reference')
    await expect(reference.locator('.synced__body p')).toHaveText(['Shared alpha', 'Shared beta'])
    await expect(reference.locator('.synced__tag')).toHaveText(/Synced from Sync source/)
    await flush(page)
    const [stored] = await storedSynced(page, b)
    expect(stored.attrs?.sourcePageId).toBe(a)
    expect((await storedSynced(page, a))[0].attrs?.syncId).toBe(stored.attrs?.syncId)
    // the original now counts two pages
    await edB.locator('p', { hasText: 'Intro B' }).click()

    // A open beside B; its caret sits in "Sha|red alpha"
    await uiEval(page, (s, id) => s.openPane(id), a)
    const paneA = editorOf(page, a)
    await expect(paneA.locator('[data-type="synced-block"] .synced__tag')).toHaveText(/Synced · 2 pages/)
    await paneA.locator('p', { hasText: 'Shared alpha' }).click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    const caretA = await caretOf(paneA)

    // typing in the reference (B) reaches the original (store + open editor), A's caret stays
    await reference.locator('p', { hasText: 'Shared beta' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' plus B')
    await expect.poll(() => plainOf(page, a)).toContain('Shared beta plus B')
    await expect(paneA.locator('[data-type="synced-block"] p').nth(1)).toHaveText('Shared beta plus B')
    expect(await caretOf(paneA)).toBe(caretA)

    // B's caret is in its reference; typing in A (other paragraph) updates B and keeps B's caret
    const caretB = await caretOf(edB)
    await paneA.locator('p', { hasText: 'Shared alpha' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' plus A')
    await expect(reference.locator('.synced__body p').first()).toHaveText('Shared alpha plus A')
    await expect.poll(() => plainOf(page, b)).toContain('Shared alpha plus A')
    expect(await caretOf(edB)).toBe(caretB + ' plus A'.length)
    // the paragraph after it is untouched
    await expect(edB.locator('p', { hasText: 'Intro B' })).toHaveCount(1)

    // reload: both pages keep the block and its link
    await reloadApp(page)
    await gotoPage(page, b)
    await expect(editorOf(page, b).locator('[data-type="synced-block"]')).toHaveAttribute('data-role', 'reference')
    await expect(editorOf(page, b).locator('[data-type="synced-block"] .synced__body p')).toHaveText(['Shared alpha plus A', 'Shared beta plus B'])
  })

  test('original deleted or trashed: references keep their content, read-only, with Unsync; restoring links them again', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Policy', content: doc(para('Head'), synced('grp-policy', null, para('Rule one'), para('Rule two')), para('Tail')) })
    const b = await createPage(page, { title: 'Onboarding', content: doc(para('Welcome'), synced('grp-policy', a, para('Rule one'), para('Rule two'))) })
    const c = await createPage(page, { title: 'Handbook', content: doc(synced('grp-policy', a, para('Rule one'), para('Rule two')), para('More')) })
    await gotoPage(page, b)
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await expect(ref).toHaveAttribute('data-role', 'reference')

    // the original's page goes to the trash
    await wsEval(page, (s, id) => s.trashPage(id), a)
    await expect(ref).toHaveAttribute('data-role', 'orphan')
    await expect(ref.locator('.synced__tag')).toHaveText(/Original deleted — content kept/)
    await expect(ref.getByRole('button', { name: 'Unsync' })).toBeVisible()
    // its content can't be edited (the original is gone): typing changes nothing in it
    await ref.locator('p', { hasText: 'Rule one' }).click()
    await page.keyboard.type('XYZ')
    await flush(page)
    await expect(ref.locator('.synced__body p')).toHaveText(['Rule one', 'Rule two'])
    expect(textOf((await storedSynced(page, b))[0])).not.toContain('XYZ')

    // restore → linked again
    await wsEval(page, (s, id) => s.restorePage(id), a)
    await expect(ref).toHaveAttribute('data-role', 'reference')
    await expect(ref.locator('.synced__tag')).toHaveText(/Synced from Policy/)

    // the block itself deleted from the original page → orphan; the original back → linked
    const withBlock = (await pageById(page, a)).content
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Head' }] }] }, 'e2e'), a)
    await expect(ref).toHaveAttribute('data-role', 'orphan')
    await wsEval(page, (s, arg) => s.setContent(arg.id, arg.content, 'e2e'), { id: a, content: withBlock })
    await expect(ref).toHaveAttribute('data-role', 'reference')

    // Unsync on a reference: plain blocks, content kept; the other pages stay synced
    await ref.locator('.synced__tag').click()
    await page.getByRole('menuitem', { name: 'Unsync' }).click()
    await expect(editorOf(page, b).locator('[data-type="synced-block"]')).toHaveCount(0)
    await expect(editorOf(page, b).locator('p')).toContainText(['Welcome', 'Rule one', 'Rule two'])
    await flush(page)
    expect(await storedSynced(page, b)).toHaveLength(0)
    expect(await storedSynced(page, c)).toHaveLength(1)

    // Unsync all on the original (after a confirmation): every copy becomes plain blocks
    await gotoPage(page, a)
    const orig = editorOf(page, a).locator('[data-type="synced-block"]')
    await expect(orig.locator('.synced__tag')).toHaveText(/Synced · 2 pages/)
    await orig.locator('.synced__tag').click()
    await page.getByRole('menuitem', { name: 'Unsync all' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Unsync all' }).click()
    await expect(orig).toHaveCount(0)
    await flush(page)
    expect(await storedSynced(page, a)).toHaveLength(0)
    expect(await storedSynced(page, c)).toHaveLength(0)
    expect(await plainOf(page, c)).toContain('Rule two')
  })

  test('menu: pages using it, Go to original; a duplicated page holds a reference; no synced block inside another', async ({ page }) => {
    await openApp(page)
    const a = await createPage(page, { title: 'Pricing', content: doc(para('Top'), synced('grp-price', null, para('Pro is 12 EUR')), para('Bottom')) })
    const b = await createPage(page, { title: 'Sales deck', content: doc(synced('grp-price', a, para('Pro is 12 EUR'))) })
    await gotoPage(page, b)
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await ref.locator('.synced__tag').click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Pricing/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Sales deck/ })).toBeDisabled()
    await menu.getByRole('menuitem', { name: 'Go to original' }).click()
    await page.waitForFunction((id) => window.location.hash.startsWith(`#/p/${id}`), a)
    await expect(editorOf(page, a).locator('[data-type="synced-block"]')).toHaveAttribute('data-role', 'original')

    // duplicating the original's page: the copy holds a REFERENCE to the original (Notion's rule)
    const copy = await wsEval(page, (s, id) => s.duplicatePage(id), a)
    await expect
      .poll(async () => (await storedSynced(page, copy))[0]?.attrs?.sourcePageId, { timeout: 5000 })
      .toBe(a)
    expect((await storedSynced(page, a))[0].attrs?.sourcePageId).toBeNull()

    // "/synced" inside a synced block: added below it instead
    const edA = editorOf(page, a)
    await edA.locator('p', { hasText: 'Pro is 12 EUR' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/synced')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Synced blocks can’t go inside synced blocks — added below instead')).toBeVisible()
    await page.keyboard.type('Second group')
    await flush(page)
    const top = ((await pageById(page, a)).content?.content ?? []) as JSONContent[]
    expect(top.filter((n) => n.type === 'syncedBlock')).toHaveLength(2)
    expect((await storedSynced(page, a)).every((n) => !(n.content ?? []).some((k) => k.type === 'syncedBlock'))).toBe(true)

    // pasting a synced block inside one: pasted as normal blocks
    await edA.locator('p', { hasText: 'Second group' }).click()
    await page.keyboard.press('End')
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/html', '<div data-pm-slice="0 0 []" data-type="synced-block" data-sync-id="grp-price" data-source-page-id="x"><p>Pasted inside</p></div>')
      dt.setData('text/plain', 'Pasted inside')
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(page.getByText('Synced blocks can’t go inside synced blocks — pasted as normal blocks')).toBeVisible()
    await flush(page)
    const all = await storedSynced(page, a)
    expect(all).toHaveLength(2)
    expect(textOf(all[1])).toContain('Pasted inside')
    expect(all.every((n) => !(n.content ?? []).some((k) => k.type === 'syncedBlock'))).toBe(true)
  })

  test('share link and Markdown carry the content as plain blocks; German labels', async ({ page, browser, context, errors }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    const a = await createPage(page, { title: 'Glossary', content: doc(para('Terms'), synced('grp-terms', null, para('Synced means shared')), para('End')) })
    const b = await createPage(page, { title: 'Guide', content: doc(para('Intro'), synced('grp-terms', a, para('Synced means shared'))) })
    await settle(page)
    await gotoPage(page, b)

    // Markdown (share dialog): the content only
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\//)
    const link = await url.inputValue()
    await dialog.getByRole('button', { name: /Copy as Markdown/ }).click()
    await expect(dialog.getByText('Copied')).toBeVisible()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    expect(md).toContain('Intro')
    expect(md).toContain('Synced means shared')
    expect(md).not.toMatch(/data-sync-id|syncedBlock/)
    await page.keyboard.press('Escape')

    // the shared page shows the content, no synced chrome, no workspace links
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.locator('.shv__doc')).toContainText('Synced means shared')
    await expect(p2.locator('.shv__doc [data-sync-id]')).toHaveCount(0)
    await expect(p2.locator('.synced__tag')).toHaveCount(0)
    await other.close()

    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await expect(ref.locator('.synced__tag')).toHaveText(/Synchron aus Glossary/)
    await gotoPage(page, a)
    await expect(editorOf(page, a).locator('[data-type="synced-block"] .synced__tag')).toHaveText(/Synchron · 2 Seiten/)
  })
})
