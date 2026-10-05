/**
 * "Turn into page": marked blocks become a new sub-page, ONE page link takes their place. Block menu
 * (Turn into → Page), Mod+Alt+9, bubble toolbar and AI menu; inline databases, sub-pages and comment
 * threads go along; the toast's Undo and ⌘Z / ⌘⇧Z keep the store in step; columns, callouts, lists;
 * synced blocks keep syncing; templates; German; 390 px. Claude is never called (mocked anyway).
 */
import type { Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, pageById, flush, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
const li = (s: string): JSONContent => ({ type: 'listItem', content: [para(s)] })
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)
const topTypes = (page: Page, id: string) => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => n.type), id)
/** The page a page link block on `id` points at (the first one, or the one inside `within`). */
const linkedFrom = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    let found: string | null = null
    const walk = (n: AnyState) => {
      if (found) return
      if (n.type === 'pageLink') found = n.attrs?.pageId ?? null
      ;(n.content ?? []).forEach(walk)
    }
    if (s.pages[id]?.content) walk(s.pages[id].content)
    return found
  }, id)
const texts = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(texts).join('')
const toast = (page: Page, re: RegExp) => page.locator('.toast').filter({ hasText: re })

/** Set the editor's selection from the start of the block holding `a` to the end of the block holding `b` (TipTap puts the editor on its DOM). */
async function selectBlocks(ed: Locator, a: string, b: string = a): Promise<void> {
  await ed.evaluate(
    (el, [a, b]) => {
      type N = { isTextblock: boolean; textContent: string; content: { size: number } }
      const editor = (el as HTMLElement & { editor: AnyState }).editor
      let from = -1
      let to = -1
      editor.state.doc.descendants((n: N, pos: number) => {
        if (!n.isTextblock) return true
        if (from < 0 && n.textContent.includes(a)) from = pos + 1
        if (n.textContent.includes(b)) to = pos + 1 + n.content.size
        return false
      })
      if (from < 0 || to < 0) throw new Error('blocks not found')
      editor.chain().focus().setTextSelection({ from, to }).run()
    },
    [a, b] as const,
  )
  // TipTap focuses in the next frame: keys pressed before that would go nowhere
  await expect(ed).toBeFocused()
}

/** Select from the start of `from` to the end of `to` with a DOM range (ProseMirror picks it up). */
async function selectRange(page: Page, ed: Locator, from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await ed.evaluate(
      (root, [a, b]) => {
        const find = (needle: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const i = (node as Text).data.indexOf(needle)
            if (i >= 0) return { node, i }
          }
          throw new Error(`text not found: ${needle}`)
        }
        const s = find(a)
        const e = find(b)
        const r = document.createRange()
        r.setStart(s.node, s.i)
        r.setEnd(e.node, e.i + b.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      },
      [from, to] as const,
    )
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}

/** Hover a block, click its grip, open Turn into (or not) and pick an entry. */
async function blockMenu(page: Page, line: Locator): Promise<Locator> {
  await line.hover()
  const grip = page.getByRole('button', { name: /^(Block menu|Blockmenü)$/ })
  await expect(grip).toBeVisible()
  await grip.click()
  const menu = page.locator('[data-popover][role="menu"]').first()
  await expect(menu).toBeVisible()
  return menu
}

/* ------------------------------------------------------------------ */

test.describe('Turn into page', () => {
  test('heading + 2 paragraphs → grip → Turn into → Page: one link in their place, a sub-page titled by the heading with the 2 paragraphs and the comment thread; toast Undo restores and trashes', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Project notes',
      content: doc(
        para('Intro stays here.'),
        heading(2, 'Launch plan'),
        { type: 'paragraph', content: [text('We ship on '), text('Friday the 9th', [{ type: 'comment', attrs: { id: 'c1' } }]), text(' after review.')] },
        para('Marketing gets the copy by Wednesday.'),
        para('Outro stays too.'),
      ),
    })
    await wsEval(page, (s, id) => s.addComment(id, { id: 'c1', quote: 'Friday the 9th', body: 'Check with legal' }), id)
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // the blocks as the editor holds them (with their block ids)
    const editorJSON = () => ed.evaluate((el) => JSON.parse(JSON.stringify((el as HTMLElement & { editor: AnyState }).editor.getJSON())))
    const before = await editorJSON()

    // a mouse-made selection over the three blocks; the grip of one of them acts on all three
    await ed.locator('h3, h2', { hasText: 'Launch plan' }).click()
    await selectRange(page, ed, 'Launch plan', 'by Wednesday.')
    const menu = await blockMenu(page, ed.locator('p', { hasText: 'We ship on' }))
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    const pageItem = page.getByRole('menuitem', { name: /^Page · 3 blocks/ })
    await expect(pageItem).toBeVisible()
    await expect(pageItem).toContainText('Ctrl+Alt+9')
    await pageItem.click()

    // here: intro, ONE link, outro — the link selected, the toast says where they went
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'pageLink', 'paragraph'])
    const newId = (await linkedFrom(page, id))!
    expect(newId).toBeTruthy()
    await expect(toast(page, /Moved to a new page · Launch plan/)).toBeVisible()
    await expect(ed.locator('[data-type="page-link"], .page-link').first()).toBeVisible()
    await expect(ed.locator('.ProseMirror-selectednode')).toHaveCount(1)
    const selectedType = await ed.evaluate((el) => (el as HTMLElement & { editor: AnyState }).editor.state.selection.node?.type.name ?? null)
    expect(selectedType).toBe('pageLink')

    // there: a sub-page titled by the heading, holding the two paragraphs (block ids kept) and the thread
    const created = await pageById(page, newId)
    expect(created).toMatchObject({ kind: 'page', parentId: id, title: 'Launch plan', contentOrigin: 'split', trashed: false })
    expect(created.content.content.map((n: AnyState) => n.type)).toEqual(['paragraph', 'paragraph'])
    expect(created.content.content.map(texts)).toEqual(['We ship on Friday the 9th after review.', 'Marketing gets the copy by Wednesday.'])
    expect(created.content.content[0].attrs.id).toBe(before.content[2].attrs.id)
    expect(created.comments.map((c: AnyState) => [c.id, c.body])).toEqual([['c1', 'Check with legal']])
    expect((await pageById(page, id)).comments ?? []).toEqual([])

    // the sidebar shows it below this page
    const parentRow = page.locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: /^Project notes$/ }) }).first()
    await expect(parentRow).toBeVisible()
    const child = page.locator('.sb-row', { has: page.locator('.sb-row__title', { hasText: /^Launch plan$/ }) })
    const toggle = parentRow.locator('.sb-row__toggle')
    if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
    await expect(child.first()).toBeVisible()

    // the toast's Undo: the blocks back as they were, the page in the trash, the thread home again
    await toast(page, /Moved to a new page/).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'paragraph'])
    expect(JSON.stringify((await editorJSON()).content)).toBe(JSON.stringify(before.content))
    await expect.poll(async () => (await pageById(page, newId)).trashed).toBe(true)
    expect(((await pageById(page, id)).comments ?? []).map((c: AnyState) => c.id)).toEqual(['c1'])
    expect((await pageById(page, newId)).comments ?? []).toEqual([])
  })

  test('Mod+Alt+9: an inline database and a sub-page link go along; ⌘Z puts all back and trashes the untouched page, ⌘⇧Z redoes; a changed page stays', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Research hub' })
    const { db, sub } = await wsEval(
      page,
      (s, id) => {
        const db = s.createDatabase({ parentId: id, inline: true, title: 'Reading list' })
        const sub = s.createPage({ parentId: id, title: 'Budget' })
        return { db, sub }
      },
      id,
    )
    await wsEval(
      page,
      (s, a) =>
        s.setContent(
          a.id,
          {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Keep me.' }] },
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sources' }] },
              { type: 'databaseBlock', attrs: { databaseId: a.db, viewId: null } },
              { type: 'pageLink', attrs: { pageId: a.sub } },
              { type: 'paragraph', content: [{ type: 'text', text: 'Last word on sources.' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Keep me too.' }] },
            ],
          },
          'e2e',
        ),
      { id, db, sub },
    )
    await flush(page)
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await expect(ed.locator('section.db')).toBeVisible()

    await selectBlocks(ed, 'Sources', 'Last word on sources.')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'pageLink', 'paragraph'])
    const newId = (await linkedFrom(page, id))!
    const parents = () => wsEval(page, (s, a) => ({ db: s.pages[a.db].parentId, sub: s.pages[a.sub].parentId, trashed: !!s.pages[a.newId]?.trashed }), { db, sub, newId })
    expect(await parents()).toEqual({ db: newId, sub: newId, trashed: false })
    expect(await topTypes(page, newId)).toEqual(['databaseBlock', 'pageLink', 'paragraph'])
    expect((await pageById(page, newId)).title).toBe('Sources')

    // ⌘Z here: the blocks are back, so are the database and the sub-page — the untouched page goes to the trash
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'databaseBlock', 'pageLink', 'paragraph', 'paragraph'])
    await expect.poll(parents).toEqual({ db: id, sub: id, trashed: true })
    await expect(ed.locator('section.db')).toBeVisible()

    // ⌘⇧Z: split again
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'pageLink', 'paragraph'])
    await expect.poll(parents).toEqual({ db: newId, sub: newId, trashed: false })

    // the new page renamed meanwhile: ⌘Z brings the blocks back, the page stays as it is
    await wsEval(page, (s, newId) => s.updatePage(newId, { title: 'Sources (edited)' }), newId)
    await ed.evaluate((el) => (el as HTMLElement & { editor: AnyState }).editor.commands.focus())
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'databaseBlock', 'pageLink', 'paragraph', 'paragraph'])
    await expect(toast(page, /“Sources \(edited\)” was changed meanwhile/)).toBeVisible()
    expect(await parents()).toEqual({ db: newId, sub: newId, trashed: false })
  })

  test('inside a column and a callout, list items split their list, a selection across two columns takes the columns block', async ({ page }) => {
    await openApp(page)
    const column = (...content: JSONContent[]): JSONContent => ({ type: 'column', content })
    const id = await createPage(page, {
      title: 'Layouts',
      content: doc(
        { type: 'columns', content: [column(para('Left one'), para('Left two')), column(para('Right one'))] },
        { type: 'callout', attrs: { icon: '💡', color: 'gray' }, content: [para('Call one'), para('Call two'), para('Call three')] },
        { type: 'bulletList', content: [li('Item A'), li('Item B'), li('Item C'), li('Item D')] },
        para('The end.'),
      ),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // one short line in a column: the line becomes the page's title, the link stays in the column
    await selectBlocks(ed, 'Left two')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(async () => (await contentOf(page, id)).content[0].content[0].content.map((n: AnyState) => n.type)).toEqual(['paragraph', 'pageLink'])
    let doc1 = await contentOf(page, id)
    const leftId = doc1.content[0].content[0].content[1].attrs.pageId
    expect(await pageById(page, leftId)).toMatchObject({ title: 'Left two', parentId: id })

    // two lines of a callout: the first line names the page, both lines move, the link stays in the callout
    await selectBlocks(ed, 'Call one', 'Call two')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(async () => (await contentOf(page, id)).content[1].content.map((n: AnyState) => n.type)).toEqual(['pageLink', 'paragraph'])
    doc1 = await contentOf(page, id)
    const calloutId = doc1.content[1].content[0].attrs.pageId
    const callPage = await pageById(page, calloutId)
    expect(callPage.title).toBe('Call one')
    expect(callPage.content.content.map(texts)).toEqual(['Call one', 'Call two'])

    // two items of a list: the list is split around the link, the items move as a list
    await selectBlocks(ed, 'Item B', 'Item C')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(() => topTypes(page, id)).toEqual(['columns', 'callout', 'bulletList', 'pageLink', 'bulletList', 'paragraph'])
    doc1 = await contentOf(page, id)
    expect(doc1.content[2].content.map(texts)).toEqual(['Item A'])
    expect(doc1.content[4].content.map(texts)).toEqual(['Item D'])
    const listPage = await pageById(page, doc1.content[3].attrs.pageId)
    expect(listPage.title).toBe('Item B')
    expect(listPage.content.content.map((n: AnyState) => n.type)).toEqual(['bulletList'])
    expect(listPage.content.content[0].content.map(texts)).toEqual(['Item B', 'Item C'])

    // across two columns: the whole columns block goes
    await selectBlocks(ed, 'Left one', 'Right one')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'callout', 'bulletList', 'pageLink', 'bulletList', 'paragraph'])
    doc1 = await contentOf(page, id)
    const colsPage = await pageById(page, doc1.content[0].attrs.pageId)
    expect(colsPage.title).toBe('Left one')
    expect(colsPage.content.content.map((n: AnyState) => n.type)).toEqual(['columns'])
    // the earlier page link inside the column went along — its page moved below the new page
    expect((await pageById(page, leftId)).parentId).toBe(colsPage.id)
  })

  test('a synced original moves along and keeps syncing with its copy on another page', async ({ page }) => {
    await openApp(page)
    const synced = (sourcePageId: string | null, ...content: JSONContent[]): JSONContent => ({ type: 'syncedBlock', attrs: { syncId: 'sync-e2e-1', sourcePageId }, content })
    const a = await createPage(page, { title: 'Sync home', content: doc(para('Before.'), heading(2, 'Shared part'), synced(null, para('Shared line alpha'))) })
    const b = await createPage(page, { title: 'Sync elsewhere', content: doc(para('Copy below.'), synced(a, para('Shared line alpha'))) })
    await gotoPage(page, a)
    const ed = editorOf(page, a)
    await selectBlocks(ed, 'Shared part', 'Shared line alpha')
    await page.keyboard.press(`${MOD}+Alt+9`)
    // (an empty line follows a page link at the end of a page)
    await expect.poll(() => topTypes(page, a)).toEqual(['paragraph', 'pageLink', 'paragraph'])
    const n = (await linkedFrom(page, a))!
    expect(await topTypes(page, n)).toEqual(['syncedBlock'])
    await flush(page)

    // edit the original on its new page: the copy on page B follows
    await gotoPage(page, n)
    const edN = editorOf(page, n)
    await edN.locator('p', { hasText: 'Shared line alpha' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' and beta')
    await expect.poll(async () => texts((await contentOf(page, b)).content[1]), { timeout: 10_000 }).toBe('Shared line alpha and beta')
  })

  test('templates: inside a template the new page belongs to the template (not in the sidebar)', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Weekly template', content: doc(heading(2, 'Agenda'), para('Point one.'), para('Rest.')) })
    await wsEval(page, (s, id) => s.updatePage(id, { hidden: true, template: { name: 'Weekly' } }), id)
    await flush(page)
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await selectBlocks(ed, 'Agenda', 'Point one.')
    await page.keyboard.press(`${MOD}+Alt+9`)
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'paragraph'])
    const n = (await linkedFrom(page, id))!
    expect(await pageById(page, n)).toMatchObject({ parentId: id, title: 'Agenda' })
    await expect(page.locator('.sb-row__title', { hasText: /^Agenda$/ })).toHaveCount(0)
  })

  test('German: bubble toolbar Umwandeln in → Seite, AI menu Strukturieren → In Seite umwandeln', async ({ page, context }) => {
    await context.route('https://api.anthropic.com/**', (route) => route.fulfill({ status: 500, body: '{}' }))
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de', aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Notizen', content: doc(para('Erster Gedanke.'), para('Zweiter Gedanke.'), para('Dritter Gedanke.'), para('Schluss.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // bubble toolbar
    await ed.locator('p', { hasText: 'Erster' }).click()
    await selectRange(page, ed, 'Erster', 'Zweiter Gedanke.')
    const bubble = page.locator('[aria-label="Formatierung"]').first()
    await expect(bubble).toBeVisible()
    await bubble.getByRole('button', { name: /^Umwandeln in/ }).click()
    await page.getByRole('menuitem', { name: /^Seite · 2 Blöcke/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'paragraph', 'paragraph'])
    await expect(toast(page, /In eine neue Seite verschoben · Erster Gedanke\./)).toBeVisible()

    // AI menu: the Structure group offers it without asking Claude
    await ed.locator('p', { hasText: 'Dritter' }).click()
    await selectRange(page, ed, 'Dritter', 'Dritter Gedanke.')
    await bubble.getByRole('button', { name: 'KI fragen' }).click()
    const ai = page.locator('.ai-panel')
    await expect(ai).toBeVisible()
    await expect(ai.locator('.ai-list__group', { hasText: 'Strukturieren' })).toBeVisible()
    await ai.getByRole('option', { name: /In Seite umwandeln/ }).click()
    await expect(ai).toHaveCount(0)
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'pageLink', 'paragraph'])
    const doc2 = await contentOf(page, id)
    expect((await pageById(page, doc2.content[1].attrs.pageId)).title).toBe('Dritter Gedanke.')
  })

  test('390 px: Alt+Enter block menu fits, Turn into → Page works there', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    const id = await createPage(page, { title: 'Phone notes', content: doc(heading(2, 'Groceries'), para('Milk and bread.'), para('Stays.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await selectBlocks(ed, 'Groceries', 'Milk and bread.')
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await page.keyboard.type('turn')
    await page.keyboard.press('Enter')
    const item = page.getByRole('menuitem', { name: /Page · 2 blocks/ })
    await expect(item).toBeVisible()
    const itemBox = await item.boundingBox()
    expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(390)
    await item.click()
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'paragraph'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect((await pageById(page, (await linkedFrom(page, id))!)).title).toBe('Groceries')
  })
})
