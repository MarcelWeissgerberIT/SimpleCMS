/**
 * Task block P2 — Claude writes: the `one:` links back, the file form of AI reads, Claude's task form, the safe
 * insert point, the settle gate, facts, holds, the list query and the pins.
 * The pure parts (editor/workitem/markdown.ts, features/workitems settle / facts / holds / query) run without a page,
 * imported like workitem-p1-index.spec does; the rest runs in the app (`?e2e` seams `window.__oneSettle`,
 * `window.__oneItems`). Test data is fictional.
 */
import type { JSONContent } from '@tiptap/core'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, flush } from './fixtures'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const p = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const linked = (text: string, href: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const person = (id: string, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'person' } })
const date = (id: string, label: string, reminder: string | null = null): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'date', ...(reminder ? { reminder } : {}) } })

/** Every inline node of a doc (document order). */
function inlineOf(d: JSONContent): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'text' || n.type === 'mention') out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(d)
  return out
}

const mentionsIn = (d: JSONContent) => inlineOf(d).filter((n) => n.type === 'mention').map((n) => n.attrs)
const textOf = (d: JSONContent) => inlineOf(d).map((n) => (n.type === 'text' ? n.text : `[${n.attrs?.kind}:${n.attrs?.id}]`)).join('')
const hrefsIn = (d: JSONContent) => inlineOf(d).flatMap((n) => (n.marks ?? []).filter((m) => m.type === 'link').map((m) => String(m.attrs?.href)))

type Seam = Record<string, (...a: any[]) => any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Call a `window.__oneSettle` function in the page. */
function settle<R>(page: Page, fn: string, ...args: unknown[]): Promise<R> {
  return page.evaluate(({ fn, args }) => ((window as unknown as { __oneSettle: Seam }).__oneSettle[fn] as (...a: unknown[]) => R)(...args), { fn, args }) as Promise<R>
}

/** The seeded people by name. */
async function people(page: Page): Promise<Record<string, string>> {
  return wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((x) => [x.name, x.id])))
}

/* ------------------------------------------------------------------ */
/* B1 — the file form and `one:` links back                            */
/* ------------------------------------------------------------------ */

test.describe('one: links back + the file form (in the app)', () => {
  test('mentionsFromLinks: people only with rules and an existing id (the store name), dates validated, reminders only when known', async ({ page }) => {
    await openApp(page)
    const input = doc(
      line(linked('@Al', 'one:person/p_alex'), { type: 'text', text: ' and ' }, linked('@Bob', 'one:person/p_nobody')),
      line(linked('@Fri 17 Oct', 'one:date/2026-10-17?r=-1d'), { type: 'text', text: ' · ' }, linked('@Sat', 'one:date/2026-10-18?r=at')),
      line(linked('@Feb 30', 'one:date/2026-02-30'), { type: 'text', text: ' · ' }, linked('Draft copy', 'one:item/wi_1b2c3d4e5f'), { type: 'text', text: ' · ' }, linked('odd', 'one:foo/bar')),
      line({ type: 'text', text: 'web ', marks: [] }, linked('site', 'https://example.com/')),
    )
    // with rules: Alex exists, the Oct 17 reminder was on the page already
    const withRules = await settle<{ doc: JSONContent; mentionsAdded: number; datesDropped: number }>(page, 'mentionsFromLinks', input, { people: { p_alex: 'Alex Lind' }, dates: ['2026-10-17|-1d'] })
    expect(mentionsIn(withRules.doc)).toEqual([
      { id: 'p_alex', label: 'Alex Lind', kind: 'person' },
      { id: '2026-10-17', label: 'Fri 17 Oct', kind: 'date', reminder: '-1d' },
      { id: '2026-10-18', label: 'Sat', kind: 'date' },
    ])
    expect(withRules.mentionsAdded).toBe(1)
    expect(withRules.datesDropped).toBe(1)
    expect(textOf(withRules.doc)).toBe('[person:p_alex] and @Bob[date:2026-10-17] · [date:2026-10-18]@Feb 30 · Draft copy · oddweb site')
    // only the web link keeps a link mark
    expect(hrefsIn(withRules.doc)).toEqual(['https://example.com/'])
    // a person the replaced content mentioned already is not counted as added
    expect((await settle<{ mentionsAdded: number }>(page, 'mentionsFromLinks', input, { people: { p_alex: 'Alex Lind' }, known: ['p_alex'] })).mentionsAdded).toBe(0)
    // without rules (no settle context): no person mention, no reminder (D2)
    const none = await settle<{ doc: JSONContent; mentionsAdded: number; datesDropped: number }>(page, 'mentionsFromLinks', input, null)
    expect(mentionsIn(none.doc)).toEqual([
      { id: '2026-10-17', label: 'Fri 17 Oct', kind: 'date' },
      { id: '2026-10-18', label: 'Sat', kind: 'date' },
    ])
    expect(none.mentionsAdded).toBe(0)
    expect(none.datesDropped).toBe(2)
    expect(textOf(none.doc)).toContain('@Al and @Bob')
    // nothing to do: the same object back
    expect(await page.evaluate(() => {
      const d = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }] }
      return (window as unknown as { __oneSettle: Seam }).__oneSettle.mentionsFromLinks(d, null).doc === d
    })).toBe(true)
  })

  test('mentionFromLink (import / sync): a date through readDue, a code through readReminder (L12)', async ({ page }) => {
    await openApp(page)
    expect(await settle(page, 'mentionFromLink', '@x', 'one:date/2026-02-30')).toBeNull()
    expect(await settle(page, 'mentionFromLink', '@x', 'one:date/2026-13-01')).toBeNull()
    expect(await settle(page, 'mentionFromLink', '@Oct 17', 'one:date/2026-10-17?r=-1d')).toEqual({ type: 'mention', attrs: { id: '2026-10-17', label: 'Oct 17', kind: 'date', reminder: '-1d' } })
    expect(await settle(page, 'mentionFromLink', '@Oct 17', 'one:date/2026-10-17T09:30?r=soon')).toEqual({ type: 'mention', attrs: { id: '2026-10-17T09:30', label: 'Oct 17', kind: 'date' } })
    expect(await settle(page, 'mentionFromLink', '@Alex', 'one:person/p_alex')).toEqual({ type: 'mention', attrs: { id: 'p_alex', label: 'Alex', kind: 'person' } })
    expect(await settle(page, 'mentionFromLink', 'Draft copy', 'one:item/wi_1b2c3d4e5f')).toEqual({ type: 'text', text: 'Draft copy' })
  })

  test('docToFileMarkdown / toAIMarkdown write one: links; readableContent keeps "@label" by default, the file form on request', async ({ page }) => {
    await openApp(page)
    const ids = await people(page)
    const content = doc(line({ type: 'text', text: 'Call ' }, person(ids.Alex, 'Alex'), { type: 'text', text: ' by ' }, date('2026-10-17', 'Oct 17', '-1d'), { type: 'text', text: '.' }))
    const file = await settle<string>(page, 'docToFileMarkdown', content)
    expect(file.trim()).toBe(`Call [@Alex](one:person/${ids.Alex}) by [@Oct 17](one:date/2026-10-17?r=-1d).`)
    expect((await settle<string>(page, 'toAIMarkdown', content)).trim()).toBe(file.trim())
    const id = await createPage(page, { title: 'Call notes', content })
    // the default stays byte for byte what coding trust hashes and Outbox seals compare
    expect(await settle<string>(page, 'readable', id)).toBe('Call @Alex by @Oct 17.')
    expect(await settle<string>(page, 'readable', id, 'markdown')).toBe('Call @Alex by @Oct 17.')
    expect(await settle<string>(page, 'readable', id, 'file')).toBe(`Call [@Alex](one:person/${ids.Alex}) by [@Oct 17](one:date/2026-10-17?r=-1d).`)
  })

  test('claudeDoc without a context: a person link is "@Name" text, a date link a date mention without reminder', async ({ page }) => {
    await openApp(page)
    const ids = await people(page)
    const d = await settle<JSONContent>(page, 'claudeDoc', `Ask [@Alex](one:person/${ids.Alex}) by [@Fri 17 Oct](one:date/2026-10-17?r=at) about [Draft copy](one:item/wi_1b2c3d4e5f) and [@Feb 30](one:date/2026-02-30).`)
    expect(mentionsIn(d)).toEqual([{ id: '2026-10-17', label: 'Fri 17 Oct', kind: 'date' }])
    expect(textOf(d)).toBe('Ask @Alex by [date:2026-10-17] about Draft copy and @Feb 30.')
    expect(hrefsIn(d)).toEqual([])
    // the read form written back keeps its dates; the person stays text without a context
    const before = await createPage(page, { title: 'Round trip', content: doc(line(person(ids.Mira, 'Mira'), { type: 'text', text: ' on ' }, date('2026-11-02', 'Nov 2', '-1d'))) })
    const read = await settle<string>(page, 'readable', before, 'file')
    const back = await settle<JSONContent>(page, 'claudeDoc', read)
    expect(mentionsIn(back)).toEqual([{ id: '2026-11-02', label: 'Nov 2', kind: 'date' }])
    expect(textOf(back)).toBe('@Mira on [date:2026-11-02]')
    await flush(page)
  })
})
