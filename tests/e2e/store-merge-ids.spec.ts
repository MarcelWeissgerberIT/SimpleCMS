import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, gotoPage, editorOf } from './fixtures'
import { mergeContent } from '../../src/app/store/merge'

/**
 * Known and older than the editor-level ids fix (main 2c7c322): two tabs whose editors each gave an id-less page their
 * own block ids save copies whose every block differs from base in its key, so the cross-tab save merge
 * (store/merge.ts) keeps both copies — the lines both held are stored twice. A first fix (b6a78b8: id-less blocks
 * matched by value, ids aside) was reverted: with it the follow-up merge in persistence.ts adoptMerged
 * (mergePage(ours, stored, cur)) doubled the whole page or brought a deleted line back when the tab's copy changed
 * structurally while its IndexedDB write ran. These cases keep that attempt's expectations (the lines once; the ids
 * are its choice — the copy stored first) until the cross-tab merge redesign.
 */

type W = Window & { __one: { flushSave: () => Promise<void> } }

const newPage = (page: Page, title: string) =>
  wsEval(page, (s, title) => s.createPage({ title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht' }] }] } }) as string, title)
const stored = (page: Page, id: string) => wsEval(page, (s, id) => ({ plain: s.pages[id].plain as string, ids: (s.pages[id].content?.content ?? []).map((n: { attrs?: { id?: string } }) => n.attrs?.id ?? null) }), id)

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
  test.fixme(true, 'store merge: pending the cross-tab merge redesign')

  for (const first of ['A', 'B'] as const) {
    test(`two tabs that each gave the blocks their own ids, one added a line: the save merge keeps it once (${first} saves first)`, async ({ page, context, errors }) => {
      await openApp(page)
      const id = await newPage(page, `Tessera Zwei Kopien ${first}`)
      await page.evaluate(() => (window as unknown as W).__one.flushSave())
      const b = await context.newPage()
      errors.watch(b)
      await openApp(b)
      // what each tab's editor hands its store before either tab saved (both opened the id-less page at once): A its
      // own ids, B its own ids and the line typed after Enter
      const copy = (lines: string[]) => ({ type: 'doc', content: lines.map((text) => ({ type: 'paragraph', attrs: { id: crypto.randomUUID() }, content: [{ type: 'text', text }] })) })
      const own = (tab: Page, lines: string[]) => wsEval(tab, (s, a) => s.setContent(a.id, a.json, 'editor:tessera'), { id, json: copy(lines) })
      const lines = (tab: Page) => (tab === page ? ['Nordlicht'] : ['Nordlicht', 'Zweite'])
      const [one, two] = first === 'A' ? [page, b] : [b, page]
      await own(one, lines(one))
      await own(two, lines(two))
      const idsA = (await stored(page, id)).ids
      const idsB = (await stored(b, id)).ids
      await one.evaluate(() => (window as unknown as W).__one.flushSave())
      await two.evaluate(() => (window as unknown as W).__one.flushSave())
      const want = 'Nordlicht\nZweite'
      await expect.poll(async () => (await stored(page, id)).plain, { timeout: 10_000 }).toBe(want)
      await expect.poll(async () => (await stored(b, id)).plain, { timeout: 10_000 }).toBe(want)
      // one set of ids in both tabs: the line both copies held keeps one copy's id (the one stored first — which tab's
      // save timer ran out first is up to the machine), the new line its own
      const ids = (await stored(page, id)).ids
      expect([idsA[0], idsB[0]]).toContain(ids[0])
      expect(ids[1]).toBe(idsB[1])
      await expect.poll(async () => (await stored(b, id)).ids).toEqual(ids)
      for (const tab of [page, b]) {
        await gotoPage(tab, id)
        await expect(editorOf(tab).locator('p')).toHaveText(['Nordlicht', 'Zweite'])
      }
    })
  }

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
