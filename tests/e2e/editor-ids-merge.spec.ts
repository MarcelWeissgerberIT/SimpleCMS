import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, uiEval, gotoPage, editorOf, waitForApp } from './fixtures'
import { mergeContent } from '../../src/app/store/merge'

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

test("a block the peek adds meanwhile keeps its own id; the blocks both hold take the main view's", async ({ page }) => {
  await openApp(page)
  const id = await wsEval(page, (s) => s.createPage({ title: 'Tessera Absatz', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Polarnacht' }] }] } }) as string)
  await gotoPage(page, id)
  const mainIds = await page.locator('#main .pv-content .ProseMirror p').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-id')))
  expect(mainIds).toHaveLength(2)
  await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
  const peek = page.locator('.peek .ProseMirror')
  await expect(peek).toBeVisible()
  await peek.locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Dazwischen')
  await page.evaluate(() => (window as unknown as W).__oneEditorUnload())
  await expect.poll(async () => (await stored(page, id)).plain).toBe('Nordlicht\nDazwischen\nPolarnacht')
  const s = await stored(page, id)
  expect([s.ids[0], s.ids[2]]).toEqual(mainIds)
  expect(s.ids[1]).toBeTruthy()
  expect(mainIds).not.toContain(s.ids[1])
  await expect(page.locator('#main .pv-content .ProseMirror p')).toHaveText(['Nordlicht', 'Dazwischen', 'Polarnacht'])
  expect(await page.locator('#main .pv-content .ProseMirror p').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-id')))).toEqual(s.ids)
})

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

test('an idle peek keeps its caret when the main editor writes the block ids — also a caret the browser moved a moment ago', async ({ page }) => {
  await openApp(page)
  const id = await newPage(page, 'Tessera Ruhe', false)
  await gotoPage(page, id)
  await uiEval(page, (u, id) => u.openPeek(id, 'side'), id)
  const peek = page.locator('.peek .ProseMirror')
  await expect(peek).toBeVisible()
  await peek.click()
  await page.keyboard.press('End')
  await page.waitForTimeout(100)
  // the caret moves after "Nord" (as an arrow key moves it: the browser first, the editor reads it with the next
  // selectionchange) and in the same moment the main view writes the ids it gave the blocks (it opened first)
  await page.evaluate(() => {
    const text = document.querySelector('.peek .ProseMirror p')!.firstChild!
    document.getSelection()!.collapse(text, 4)
    ;(window as unknown as W).__oneEditorUnload()
  })
  await expect.poll(async () => (await stored(page, id)).rev).toBeGreaterThan(0)
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

for (const first of ['A', 'B'] as const) {
  test(`two tabs that each wrote their own block ids, one added a block: the save merge keeps it once (${first} saved first)`, async ({ page, context, errors }) => {
    await openApp(page)
    const id = await newPage(page, `Tessera Zwei Kopien ${first}`, false)
    await page.evaluate(() => (window as unknown as W).__one.flushSave())
    const b = await context.newPage()
    errors.watch(b)
    await openApp(b)
    await gotoPage(b, id)
    await gotoPage(page, id)
    const edB = editorOf(b)
    await edB.click()
    await b.keyboard.press('End')
    await b.keyboard.press('Enter')
    await b.keyboard.type('Zweite')
    // each tab's editor hands its copy to its own store (B: its ids + the new line, A: its ids) before either tab saved
    await b.evaluate(() => (window as unknown as W).__oneEditorUnload())
    await page.evaluate(() => (window as unknown as W).__oneEditorUnload())
    const idsA = (await stored(page, id)).ids
    const idsB = (await stored(b, id)).ids
    expect(idsA).toHaveLength(1)
    expect(idsB).toHaveLength(2)
    expect(idsA[0]).not.toBe(idsB[0])
    const [one, two] = first === 'A' ? [page, b] : [b, page]
    await one.evaluate(() => (window as unknown as W).__one.flushSave())
    await two.evaluate(() => (window as unknown as W).__one.flushSave())
    const want = 'Nordlicht\nZweite'
    await expect.poll(async () => (await stored(page, id)).plain, { timeout: 10_000 }).toBe(want)
    await expect.poll(async () => (await stored(b, id)).plain, { timeout: 10_000 }).toBe(want)
    await expect(editorOf(page).locator('p')).toHaveText(['Nordlicht', 'Zweite'])
    await expect(edB.locator('p')).toHaveText(['Nordlicht', 'Zweite'])
    // the line both copies held keeps the ids stored first; the new line its own
    const ids = [first === 'A' ? idsA[0] : idsB[0], idsB[1]]
    await expect.poll(async () => (await stored(page, id)).ids).toEqual(ids)
    await expect.poll(async () => (await stored(b, id)).ids).toEqual(ids)
  })
}

/* ---------------------------------------------------------------- the store's save merge (pure) */

const txt = (s: string): JSONContent => ({ type: 'text', text: s })
const P = (s: string, id?: string, ...more: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [txt(s), ...more] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const list = (id: string | undefined, ...items: JSONContent[]): JSONContent => ({ type: 'bulletList', ...(id ? { attrs: { id } } : {}), content: items })
const li = (id: string | undefined, ...c: JSONContent[]): JSONContent => ({ type: 'listItem', ...(id ? { attrs: { id } } : {}), content: c })
const mention = (target: string): JSONContent => ({ type: 'mention', attrs: { id: target, label: target, kind: 'page' } })
const textOf = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')
const linesOf = (d: JSONContent | null) => {
  const out: string[] = []
  const walk = (n: JSONContent) => (n.type === 'paragraph' ? out.push(textOf(n)) : n.content?.forEach(walk))
  if (d) walk(d)
  return out
}
const idsOf = (d: JSONContent | null) => {
  const out: Array<string | null> = []
  const walk = (n: JSONContent) => {
    if (n.type !== 'doc') out.push((n.attrs?.id as string | undefined) ?? null)
    if (n.type !== 'paragraph') n.content?.forEach(walk)
  }
  if (d) walk(d)
  return out
}

test.describe('store merge: block ids each copy filled in are no change', () => {
  test('one copy added a block, the other only its ids — the line once, in either save order', () => {
    const base = doc(P('Nordlicht'))
    const a = doc(P('Nordlicht', 'a1'))
    const b = doc(P('Nordlicht', 'b1'), P('Zweite', 'b2'))
    // theirs = the copy stored first: the blocks both hold keep its ids
    const aFirst = mergeContent(base, a, b)
    expect(linesOf(aFirst)).toEqual(['Nordlicht', 'Zweite'])
    expect(idsOf(aFirst)).toEqual(['a1', 'b2'])
    const bFirst = mergeContent(base, b, a)
    expect(linesOf(bFirst)).toEqual(['Nordlicht', 'Zweite'])
    expect(idsOf(bFirst)).toEqual(['b1', 'b2'])
  })

  test('Enter inside a line, typing in another line, a list item added — nothing doubled, both sides kept', () => {
    const split = mergeContent(doc(P('Nordlicht')), doc(P('Nordlicht', 'a1')), doc(P('Nord', 'b1'), P('licht', 'b2')))
    expect(linesOf(split)).toEqual(['Nord', 'licht'])
    expect(linesOf(mergeContent(doc(P('Nordlicht')), doc(P('Nord', 'b1'), P('licht', 'b2')), doc(P('Nordlicht', 'a1'))))).toEqual(['Nord', 'licht'])
    const base = doc(P('Eins'), P('Zwei'))
    const both = mergeContent(base, doc(P('Eins getippt', 'a1'), P('Zwei', 'a2')), doc(P('Eins', 'b1'), P('Zwei', 'b2'), P('Drei', 'b3')))
    expect(linesOf(both)).toEqual(['Eins getippt', 'Zwei', 'Drei'])
    expect(idsOf(both)).toEqual(['a1', 'a2', 'b3'])
    const lb = doc(list(undefined, li(undefined, P('rot')), li(undefined, P('gelb'))))
    const la = doc(list('al', li('ar', P('rot', 'ap1')), li('ag', P('gelb!', 'ap2'))))
    const lo = doc(list('bl', li('br', P('rot', 'bp1')), li('bg', P('gelb', 'bp2')), li('bn', P('blau', 'bp3'))))
    const nested = mergeContent(lb, la, lo)
    expect(linesOf(nested)).toEqual(['rot', 'gelb!', 'blau'])
    expect(idsOf(nested)).toEqual(['al', 'ar', 'ap1', 'ag', 'ap2', 'bn', 'bp3'])
  })

  test('a mention id is content, never a block id; blocks with ids merge as before', () => {
    const base = doc(P('Siehe ', undefined, mention('page-1')), P('Ende'))
    const m = mergeContent(base, doc(P('Siehe ', 'a1', mention('page-2')), P('Ende', 'a2')), doc(P('Siehe ', 'b1', mention('page-1')), P('Ende', 'b2'), P('Neu', 'b3')))
    expect(JSON.stringify(m)).toContain('page-2')
    expect(JSON.stringify(m)).not.toContain('page-1')
    expect(linesOf(m)).toEqual(['Siehe ', 'Ende', 'Neu'])
    const k = doc(P('Eins', 'k1'), P('Zwei', 'k2'))
    const kept = mergeContent(k, doc(P('Eins A', 'k1'), P('Zwei', 'k2')), doc(P('Eins', 'k1'), P('Zwei B', 'k2'), P('Drei', 'k3')))
    expect(linesOf(kept)).toEqual(['Eins A', 'Zwei B', 'Drei'])
    expect(idsOf(kept)).toEqual(['k1', 'k2', 'k3'])
  })
})
