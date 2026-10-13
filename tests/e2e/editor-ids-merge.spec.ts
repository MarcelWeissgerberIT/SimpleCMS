import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, uiEval, gotoPage, editorOf, waitForApp } from './fixtures'

/**
 * Two editors of one page whose content has no block ids (written by the store, an import, Claude, a template …):
 * each editor gives the blocks ids and the first one to open writes them once (~1.5 s after it opened). That write
 * differs from what the other editor started from only in block ids — it must never replace the other editor's
 * unsaved typing, and the ids it wrote stay (the other editor takes them over).
 */

type W = Window & { __oneEditorUnload: () => void; __one: { flushSave: () => Promise<void> } }

const para = (ids: boolean) => (ids ? { type: 'paragraph', attrs: { id: 'b-tessera-1' }, content: [{ type: 'text', text: 'Nordlicht' }] } : { type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht' }] })

async function newPage(page: Page, title: string, ids: boolean): Promise<string> {
  return wsEval(page, (s, a) => s.createPage({ title: a.title, content: { type: 'doc', content: [a.para] } }) as string, { title, para: para(ids) })
}

const stored = (page: Page, id: string) => wsEval(page, (s, id) => ({ plain: s.pages[id].plain as string, rev: s.pages[id].contentRev as number, ids: (s.pages[id].content?.content ?? []).map((n: { attrs?: { id?: string } }) => n.attrs?.id ?? null) }), id)
const domId = (page: Page, sel: string) => page.locator(`${sel} .ProseMirror p`).first().getAttribute('data-id')

for (const ids of [false, true]) {
  test(`peek typing survives the main editor's first write of block ids (content ${ids ? 'with' : 'without'} block ids)`, async ({ page }) => {
    await openApp(page)
    const id = await newPage(page, 'Tessera Protokoll', ids)
    await gotoPage(page, id)
    await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
    const peek = page.locator('.peek .ProseMirror')
    await expect(peek).toBeVisible()
    await peek.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' im Seitenblick')
    // every open editor hands its typing over now, in the order they opened: the main view first (its pending ids),
    // then the peek, whose typing is still unsaved when the main view's write arrives (also what closing the tab does)
    await page.evaluate(() => (window as unknown as W).__oneEditorUnload())
    await expect.poll(async () => (await stored(page, id)).plain).toBe('Nordlicht im Seitenblick')
    await expect(peek).toHaveText('Nordlicht im Seitenblick')
    await expect(editorOf(page)).toHaveText('Nordlicht im Seitenblick')
    // one set of ids: the main view's, kept by the peek's write — the page's blocks keep the ids first written
    const s = await stored(page, id)
    const main = await domId(page, '#main .pv-content')
    expect(s.ids).toEqual([main])
    expect(await domId(page, '.peek')).toBe(main)
    if (ids) expect(main).toBe('b-tessera-1')
  })
}

test('closing the tab right after typing in the peek keeps the typing (the main view still had its ids to write)', async ({ page }) => {
  await openApp(page)
  const id = await newPage(page, 'Tessera Abschluss', false)
  await gotoPage(page, id)
  await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
  const peek = page.locator('.peek .ProseMirror')
  await expect(peek).toBeVisible()
  await peek.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' vor dem Schliessen')
  await page.reload()
  await waitForApp(page)
  await expect.poll(async () => (await stored(page, id)).plain).toBe('Nordlicht vor dem Schliessen')
})

test('an idle peek keeps its caret when the main editor writes the block ids', async ({ page }) => {
  await openApp(page)
  const id = await newPage(page, 'Tessera Ruhe', false)
  await gotoPage(page, id)
  await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
  const peek = page.locator('.peek .ProseMirror')
  await expect(peek).toBeVisible()
  await peek.click()
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  // the main view's own timer writes its ids (it opened first); the peek takes them over, its caret stays after "Nord"
  await expect.poll(async () => (await stored(page, id)).rev, { timeout: 5000 }).toBeGreaterThan(0)
  await page.waitForTimeout(100)
  await page.keyboard.type('-')
  await expect.poll(async () => (await stored(page, id)).plain).toBe('Nord-licht')
  const s = await stored(page, id)
  expect(s.ids).toEqual([await domId(page, '#main .pv-content')])
})

test("main-view typing survives the peek's first write of block ids", async ({ page }) => {
  await openApp(page)
  const id = await newPage(page, 'Tessera Vorne', false)
  await gotoPage(page, id)
  await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
  await expect(page.locator('.peek .ProseMirror')).toBeVisible()
  // keys into the main view without a pointer press (that would close the side peek); typing never pauses for the
  // editor's 300 ms, so the main view's own ids wait — the peek's timer writes the ids it gave the blocks meanwhile
  const main = editorOf(page)
  await main.focus()
  await page.keyboard.press('End')
  const text = ' und vorne weiter ohne Pause getippt'
  await page.keyboard.type(text, { delay: 70 })
  await expect.poll(async () => (await stored(page, id)).plain).toBe(`Nordlicht${text}`)
  await expect(main).toHaveText(`Nordlicht${text}`)
  const s = await stored(page, id)
  expect(s.ids).toEqual([await domId(page, '.peek')])
  expect(await domId(page, '#main .pv-content')).toBe(s.ids[0])
})

test("two tabs: typing in one tab survives the other tab's first write of block ids", async ({ page, context, errors }) => {
  await openApp(page)
  const id = await newPage(page, 'Tessera Zwei Tabs', false)
  await page.evaluate(() => (window as unknown as W).__one.flushSave())
  const b = await context.newPage()
  errors.watch(b)
  await openApp(b)
  await gotoPage(b, id)
  await gotoPage(page, id)
  const edB = editorOf(b)
  await edB.click()
  await b.keyboard.press('End')
  await b.keyboard.type(' im')
  // tab A writes the ids its editor gave the blocks and saves; tab B keeps typing (never pausing for its editor's
  // 300 ms) until that save reached it
  const written = page.evaluate(() => {
    const w = window as unknown as W
    w.__oneEditorUnload()
    return w.__one.flushSave()
  })
  let typed = ' im'
  for (const ch of ' Nebentab weiter') {
    await b.keyboard.type(ch)
    typed += ch
    if (await wsEval(b, (s, id) => s.pages[id].contentOrigin === 'sync', id)) break
  }
  await written
  await b.keyboard.type('!')
  typed += '!'
  const want = `Nordlicht${typed}`
  await expect.poll(async () => (await stored(b, id)).plain).toBe(want)
  await expect(edB).toHaveText(want)
  await b.evaluate(() => (window as unknown as W).__one.flushSave())
  // and back in tab A, with the ids tab A wrote first
  await expect.poll(async () => (await stored(page, id)).plain, { timeout: 10_000 }).toBe(want)
  await expect(editorOf(page)).toHaveText(want)
  const a = await stored(page, id)
  expect(a.ids).toEqual([await domId(page, '#main .pv-content')])
  expect((await stored(b, id)).ids).toEqual(a.ids)
})
