/**
 * Task block P2 — Claude writes: the `one:` links back, the file form of AI reads, Claude's task form, the safe
 * insert point, the settle gate, facts, holds, the list query and the pins.
 * The pure parts (editor/workitem/markdown.ts, features/workitems settle / facts / holds / query) run without a page,
 * imported like workitem-p1-index.spec does; the rest runs in the app (`?e2e` seams `window.__oneSettle`,
 * `window.__oneItems`). Test data is fictional.
 */
import type { JSONContent } from '@tiptap/core'
import type { Page } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, openApp, wsEval, createPage, flush, gotoPage, editorOf } from './fixtures'
import { readClaudeQuote, WORK_ITEMS_FROM_MARKDOWN } from '../../src/app/editor/workitem/markdown'
import { itemAttrs } from '../../src/app/editor/workitem/attrs'
import { DOC_SCHEMA_VERSION } from '../../src/app/store/generations'
import { foldTitle, MAX_NEW_ITEMS, SettleRefusal, settleDoc, type SettleContext, type SettleWorld } from '../../src/app/features/workitems/settle'
import { factLine, factLineEn, type ItemFact } from '../../src/app/features/workitems/facts'
import { heldClosure, holdsOfEdit, holdsOfReport } from '../../src/app/features/workitems/holds'
import { queryItems } from '../../src/app/features/workitems/query'
import type { ItemEntry } from '../../src/app/features/workitems/itemIndex'
import { messages as itemMessages } from '../../src/app/features/workitems/messages'
import { workItemMessages } from '../../src/app/editor/workitem/messages'
import { markRec, expectLane, startRecorder } from './helpers/recorder'

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

/* ------------------------------------------------------------------ */
/* B2 — Claude's task form + the safe insert point                     */
/* ------------------------------------------------------------------ */

const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'

/** A parsed quote as markdownToDoc gives it: the first paragraph's lines joined by soft breaks ("\n"). */
const quote = (first: JSONContent[], ...rest: JSONContent[]): JSONContent => ({ type: 'blockquote', content: [{ type: 'paragraph', content: first }, ...rest] })
const tx = (text: string): JSONContent => ({ type: 'text', text })
const titleText = (inline: JSONContent[]) => inline.map((n) => (n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\\n' : `[${n.type}]`)).join('')

test.describe("Claude's task form: readClaudeQuote (pure)", () => {
  test('the marker, a handle or an id after the title, a hard break in the title; anything else is no task', () => {
    const h = readClaudeQuote(quote([tx('[!TODO] Draft copy {#Copy}')]))!
    expect(h).toMatchObject({ itemId: null, handle: 'copy', doneAt: null, fieldLine: null })
    expect(titleText(h.title)).toBe('Draft copy')
    const id = readClaudeQuote(quote([tx(`[!todo] Ship pricing {#${A} done=2026-10-09T08:53:20.000Z}`)]))!
    expect(id).toMatchObject({ itemId: A, handle: null, doneAt: Date.parse('2026-10-09T08:53:20.000Z') })
    // a `wi_` handle is no handle (ids are One's); it stays in the title
    const fake = readClaudeQuote(quote([tx('[!TODO] Plan {#wi_short}')]))!
    expect(fake.handle).toBeNull()
    expect(titleText(fake.title)).toBe('Plan {#wi_short}')
    const broken = readClaudeQuote(quote([tx('[!TODO] First line'), { type: 'hardBreak' }, tx('second line {#two}\nOwner: Alex')]))!
    expect(titleText(broken.title)).toBe('First line\\nsecond line')
    expect(broken.handle).toBe('two')
    expect(broken.people).toEqual([{ raw: 'Alex' }])
    expect(readClaudeQuote(quote([tx('[!AUFGABE] Übersetzt')]))).toBeNull()
    expect(readClaudeQuote(quote([tx('[!TASK] Translated')]))).toBeNull()
    expect(readClaudeQuote(quote([tx('Just a quote')]))).toBeNull()
    expect(readClaudeQuote({ type: 'paragraph', content: [tx('[!TODO] Not a quote')] })).toBeNull()
  })

  test('EN keys incl. Reminder and Blocks; owners as names, "me" and emails; refs as handles, ids and titles', () => {
    const d = readClaudeQuote(quote([tx(`[!TODO] Ship pricing\nStatus: in progress · Due: 2026-10-17 · Reminder: -1D · Owner: Alex, me, Sam@Example.test · Blocked by: #Copy · Related: ${B} · Blocks: Launch review`)], p('A note.')))!
    expect(d).toMatchObject({
      status: 'in_progress',
      due: '2026-10-17',
      reminder: '-1d',
      people: [{ raw: 'Alex' }, { me: true }, { email: 'Sam@Example.test' }],
      blockedBy: [{ handle: 'copy' }],
      related: [{ id: B }],
      blocks: [{ title: 'Launch review' }],
    })
    expect(d.fieldLine).not.toBeNull()
    expect(d.fieldKey).toBeUndefined()
    expect(d.notes).toEqual([p('A note.')])
  })

  test('DE keys and values; a datetime due; a due link with its ?r= code; owners as links', () => {
    const de = readClaudeQuote(quote([tx('[!TODO] Preise prüfen\nStatus: erledigt · Fällig: 2026-10-17 09:30 · Erinnerung: at · Verantwortlich: ich · Blockiert durch: #entwurf · Verknüpft: #a · Hält auf: #b')]))!
    expect(de).toMatchObject({ status: 'done', due: '2026-10-17T09:30', reminder: 'at', people: [{ me: true }], blockedBy: [{ handle: 'entwurf' }], related: [{ handle: 'a' }], blocks: [{ handle: 'b' }] })
    expect(readClaudeQuote(quote([tx('[!TODO] x\nFaellig: 2026-10-17T08:00 · Haelt auf: #c · Verknuepft: #d')]))).toMatchObject({ due: '2026-10-17T08:00', blocks: [{ handle: 'c' }], related: [{ handle: 'd' }] })
    const links = readClaudeQuote(
      quote([
        tx('[!TODO] Ship pricing\nDue: '),
        linked('@Fri 17 Oct', 'one:date/2026-10-17?r=-1d'),
        tx(' · Owner: '),
        linked('@Alex', 'one:person/p_alex'),
        tx(', '),
        linked('@Sam', 'one:person/p_sam'),
        tx(' · Blocked by: '),
        linked('Draft copy', `one:item/${B}`),
      ]),
    )!
    expect(links).toMatchObject({ due: '2026-10-17', reminder: '-1d', people: [{ id: 'p_alex' }, { id: 'p_sam' }], blockedBy: [{ id: B }] })
  })

  test('values that are no valid ones are kept raw (for the warnings); a title ref with commas comes whole first, then its parts', () => {
    const d = readClaudeQuote(quote([tx('[!TODO] x\nStatus: someday · Due: next week · Reminder: soon · Blocked by: Plan, review the copy')]))!
    expect(d.status).toEqual({ raw: 'someday' })
    expect(d.due).toEqual({ raw: 'next week' })
    expect(d.reminder).toEqual({ raw: 'soon' })
    expect(d.blockedBy).toEqual([{ title: 'Plan, review the copy', whole: true }, { title: 'Plan' }, { title: 'review the copy' }])
    expect(readClaudeQuote(quote([tx('[!TODO] x\nDue: 2026-02-30')]))!.due).toEqual({ raw: '2026-02-30' })
    // an id among handles: no whole value (only title refs make one)
    expect(readClaudeQuote(quote([tx(`[!TODO] x\nRelated: #a, ${A}`)]))!.related).toEqual([{ handle: 'a' }, { id: A }])
  })

  test('an unknown key keeps the line as body text; next to a known key it leaves fieldKey (L6)', () => {
    const unknown = readClaudeQuote(quote([tx('[!TODO] x\nPriority: high')]))!
    expect(unknown.fieldLine).toBeNull()
    expect(unknown.fieldKey).toBeUndefined()
    expect(unknown.notes).toEqual([{ type: 'paragraph', content: [tx('Priority: high')] }])
    const mixed = readClaudeQuote(quote([tx('[!TODO] x\nOwner: Alex · Priority: high')]))!
    expect(mixed.fieldLine).toBeNull()
    expect(mixed.fieldKey).toBe('Priority')
    expect(mixed.people).toBeUndefined()
    expect(mixed.notes).toEqual([{ type: 'paragraph', content: [tx('Owner: Alex · Priority: high')] }])
    // the global reader stays off
    expect(WORK_ITEMS_FROM_MARKDOWN).toBe(false)
  })
})

test.describe("Claude's task form + the safe insert point (in the app)", () => {
  test('readClaudeQuote over the real Markdown parse: links stay link marks until settle', async ({ page }) => {
    await openApp(page)
    const d = await settle<Record<string, unknown>>(page, 'readQuoteMd', `Intro.\n\n> [!TODO] Draft copy {#copy}\n> Owner: [@Alex](one:person/p_alex), Mira · Due: [@Fri 17 Oct](one:date/2026-10-17?r=-1d) · Blocked by: [Brief](one:item/${B})\n>\n> - [ ] outline\n`)
    expect(d).toMatchObject({ handle: 'copy', itemId: null, due: '2026-10-17', reminder: '-1d', people: [{ id: 'p_alex' }, { raw: 'Mira' }], blockedBy: [{ id: B }] })
    expect((d.notes as JSONContent[]).map((n) => n.type)).toEqual(['taskList'])
    expect(await settle(page, 'readQuoteMd', '> [!NOTE] a callout')).toBeNull()
  })

  test('itemSafePoint: a paragraph keeps its place; inside a task, a nested task, a list in a task or a table cell → after the outermost', async ({ page }) => {
    await openApp(page)
    const task = (title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs: { itemId: null }, content: [p(title), ...notes] })
    const cell = (text: string): JSONContent => ({ type: 'tableCell', content: [p(text)] })
    const content = doc(
      p('Plain line'),
      task('Outer task', p('Outer note'), task('Inner task', p('Inner note')), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Listed step')] }] }),
      { type: 'table', content: [{ type: 'tableRow', content: [cell('Cell one'), cell('Cell two')] }] },
      p('After all'),
    )
    const plain = await settle<{ pos: number; safe: number; depth: number }>(page, 'safePointAt', content, 'Plain line')
    expect(plain.safe).toBe(plain.pos)
    for (const text of ['Outer task', 'Outer note', 'Inner task', 'Inner note', 'Listed step']) {
      const r = await settle<{ pos: number; safe: number; depth: number; before: { type: string; text: string } }>(page, 'safePointAt', content, text)
      expect(r.safe, text).toBeGreaterThan(r.pos)
      expect(r.depth, text).toBe(0)
      expect(r.before.type, text).toBe('workItem')
      expect(r.before.text, text).toContain('Outer task')
    }
    const inCell = await settle<{ pos: number; safe: number; depth: number; before: { type: string } }>(page, 'safePointAt', content, 'Cell two')
    expect(inCell.depth).toBe(0)
    expect(inCell.before.type).toBe('table')
  })
})

/* ------------------------------------------------------------------ */
/* B3 — the settle gate (pure, over a fake world)                      */
/* ------------------------------------------------------------------ */

const NOW = Date.parse('2026-10-14T10:00:00Z')
const PEOPLE = [
  { id: 'p_you', name: 'You' },
  { id: 'p_alex', name: 'Alex' },
  { id: 'p_sam', name: 'Sam' },
  { id: 'p_mira', name: 'Mira' },
]

interface FakeEntry {
  itemId: string
  pageId: string
  title: string
  private?: boolean
  people?: string[]
  blockedBy?: string[]
}

/** A SettleWorld over plain data (deterministic ids `wi_new0000001` …). */
function fakeWorld(o: { people?: Array<{ id: string; name: string }>; emails?: Record<string, string> | null; me?: string | null; entries?: FakeEntry[]; taken?: string[]; canCreate?: boolean; readable?: Record<string, string[]>; pages?: Record<string, string> } = {}): SettleWorld & { minted: string[] } {
  let n = 0
  const minted: string[] = []
  const entries = new Map((o.entries ?? []).map((e) => [e.itemId, { private: false, people: [] as string[], blockedBy: [] as string[], ...e }]))
  return {
    minted,
    now: () => NOW,
    canCreate: () => o.canCreate ?? true,
    newItemId: () => {
      const id = `wi_new${String(++n).padStart(7, '0')}`
      minted.push(id)
      return id
    },
    people: () => o.people ?? PEOPLE,
    memberEmails: () => (o.emails === null ? null : new Map(Object.entries(o.emails ?? {}))),
    me: () => (o.me === undefined ? 'p_you' : o.me),
    entry: (id) => entries.get(id) ?? null,
    taken: (id) => entries.has(id) || (o.taken ?? []).includes(id),
    titles: () => {
      const m = new Map<string, string[]>()
      for (const e of entries.values()) m.set(foldTitle(e.title), [...(m.get(foldTitle(e.title)) ?? []), e.itemId])
      return m
    },
    readableItems: (pageId) => new Set(o.readable?.[pageId] ?? []),
    sameBlock: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    pageTitle: (id) => o.pages?.[id] ?? 'Page',
  }
}

const ctxOf = (o: Partial<SettleContext> = {}): SettleContext => ({ source: 'terminal', creates: true, strict: false, pageId: 'pg_plan', private: false, me: true, ...o })
/** A `> [!TODO]` quote as markdownToDoc gives it: its lines joined by soft breaks. */
const tq = (lines: string, ...rest: JSONContent[]): JSONContent => quote([tx(lines)], ...rest)
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
/** The tasks of a doc (attrs through itemAttrs + title), document order. */
function tasks(d: JSONContent): Array<ReturnType<typeof itemAttrs> & { title: string }> {
  const out: Array<ReturnType<typeof itemAttrs> & { title: string }> = []
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ ...itemAttrs(n), title: titleText(n.content?.[0]?.content ?? []) })
    for (const c of n.content ?? []) walk(c)
  }
  walk(d)
  return out
}
const quotesIn = (d: JSONContent): number => {
  let k = 0
  const walk = (n: JSONContent) => {
    if (n.type === 'blockquote') k++
    for (const c of n.content ?? []) walk(c)
  }
  walk(d)
  return k
}
const codes = (r: { warnings: Array<{ code: string }> }) => r.warnings.map((w) => w.code)
function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(SettleRefusal)
    return (err as Error).message
  }
  throw new Error('no refusal')
}

test.describe('settle: people, values, ids (pure)', () => {
  test('people resolve to existing ones only — by id, folded name, member email, "me"; nobody is ever created', () => {
    const w = fakeWorld({ emails: { 'sam@example.test': 'p_sam' } })
    const before = JSON.stringify(w.people())
    const r = settleDoc(doc(quote([tx('[!TODO] Ship pricing\nOwner: '), linked('@M', 'one:person/p_mira'), tx(', alex, me, SAM@example.test')])), ctxOf(), w)
    expect(tasks(r.doc)[0].people).toEqual(['p_mira', 'p_alex', 'p_you', 'p_sam'])
    expect(r.report.warnings).toEqual([])
    // unknown: strict refuses with the names (never an email), non-strict leaves the person out
    const named = fakeWorld({ people: [...PEOPLE, { id: 'p_carol', name: 'carol@example.test' }] })
    const msg = refusal(() => settleDoc(doc(tq('[!TODO] Ship pricing\nOwner: Bob')), ctxOf({ strict: true }), named))
    expect(msg).toContain('Unknown person "Bob" in task "Ship pricing"')
    for (const name of ['"Alex"', '"Mira"', '"Sam"', '"You"']) expect(msg).toContain(name)
    expect(msg).not.toContain('@example.test')
    const soft = settleDoc(doc(tq('[!TODO] Ship pricing\nOwner: Bob, Alex')), ctxOf(), named)
    expect(tasks(soft.doc)[0].people).toEqual(['p_alex'])
    expect(soft.report.warnings).toEqual([{ code: 'person', task: 'Ship pricing', value: 'Bob' }])
    expect(JSON.stringify(w.people())).toBe(before)
    // an email nobody has is never echoed back
    expect(refusal(() => settleDoc(doc(tq('[!TODO] x\nOwner: eve@example.test')), ctxOf({ strict: true }), w))).not.toContain('@example.test')
  })

  test('the member list not loaded, an ambiguous name, "me" for an agent', () => {
    const loading = fakeWorld({ emails: null })
    expect(refusal(() => settleDoc(doc(tq('[!TODO] x\nOwner: sam@example.test')), ctxOf({ strict: true }), loading))).toContain('The member list is still loading — name the person instead.')
    expect(codes(settleDoc(doc(tq('[!TODO] x\nOwner: sam@example.test')), ctxOf(), loading).report)).toEqual(['members'])
    const twins = fakeWorld({ people: [...PEOPLE, { id: 'p_alex2', name: 'ALEX' }] })
    expect(refusal(() => settleDoc(doc(tq('[!TODO] x\nOwner: Alex')), ctxOf({ strict: true }), twins))).toContain('"Alex" fits more than one person')
    expect(codes(settleDoc(doc(tq('[!TODO] x\nOwner: Alex')), ctxOf(), twins).report)).toEqual(['personAmbiguous'])
    expect(refusal(() => settleDoc(doc(tq('[!TODO] x\nOwner: me')), ctxOf({ strict: true, me: false, source: 'agent' }), fakeWorld()))).toContain('"me" means nobody for an agent')
    const agent = settleDoc(doc(tq('[!TODO] x\nOwner: me, Sam')), ctxOf({ me: false, source: 'agent' }), fakeWorld())
    expect(codes(agent.report)).toEqual(['meAgent'])
    expect(tasks(agent.doc)[0].people).toEqual(['p_sam'])
  })

  test('dates, statuses and reminders: bad values refused / warned; a valid reminder is kept and holds the change', () => {
    const bad = '[!TODO] Plan\nStatus: someday · Due: next week · Reminder: soon'
    const msg = refusal(() => settleDoc(doc(tq(bad)), ctxOf({ strict: true }), fakeWorld()))
    expect(msg).toContain('"someday" is no status')
    expect(msg).toContain('"next week" is no date')
    expect(msg).toContain('"soon" is no reminder')
    const soft = settleDoc(doc(tq(bad)), ctxOf(), fakeWorld())
    expect(codes(soft.report).sort()).toEqual(['date', 'reminder', 'status'])
    expect(tasks(soft.doc)[0]).toMatchObject({ status: 'todo', due: null, reminder: null })
    const ok = settleDoc(doc(tq('[!TODO] Plan\nStatus: done · Due: 2026-10-17T09:30 · Reminder: -1d')), ctxOf(), fakeWorld())
    expect(tasks(ok.doc)[0]).toMatchObject({ status: 'done', doneAt: NOW, due: '2026-10-17T09:30', reminder: '-1d' })
    expect(ok.report.created[0].reminder).toBe('-1d')
    expect(holdsOfReport(ok.report)).toEqual(['reminder'])
    // a reminder without a due date
    expect(codes(settleDoc(doc(tq('[!TODO] Plan\nReminder: at')), ctxOf(), fakeWorld()).report)).toEqual(['reminder'])
  })

  test('ids: minted at staging, reused 1:1 at apply, a taken one fails (never re-minted), more quotes than ids stay quotes', () => {
    const two = doc(tq('[!TODO] One'), p('between'), tq('[!TODO] Two'))
    const w = fakeWorld()
    const staged = settleDoc(two, ctxOf(), w)
    expect(staged.report.ids).toEqual(w.minted)
    expect(tasks(staged.doc).map((t) => t.itemId)).toEqual(w.minted)
    const ids = ['wi_staged0001', 'wi_staged0002']
    const apply = fakeWorld()
    const applied = settleDoc(two, ctxOf({ ids }), apply)
    expect(tasks(applied.doc).map((t) => t.itemId)).toEqual(ids)
    expect(apply.minted).toEqual([])
    const taken = settleDoc(two, ctxOf({ ids }), fakeWorld({ taken: ['wi_staged0001'] }))
    expect(taken.report.idTaken).toEqual(['wi_staged0001'])
    expect(tasks(taken.doc).map((t) => t.itemId)).toEqual(['wi_staged0002'])
    expect(quotesIn(taken.doc)).toBe(1)
    const three = settleDoc(doc(tq('[!TODO] One'), tq('[!TODO] Two'), tq('[!TODO] Three')), ctxOf({ ids }), fakeWorld())
    expect(tasks(three.doc).map((t) => t.title)).toEqual(['One', 'Two'])
    expect(quotesIn(three.doc)).toBe(1)
    expect(codes(three.report)).toEqual(['tooMany'])
  })

  test('{#wi_X}: kept only when the replaced content holds X (fields as One has them); a live X elsewhere → a new task (copy) or left out (exists)', () => {
    const X = A
    const known = doc(item({ itemId: X, status: 'in_progress', people: ['p_alex'], due: '2026-10-20' }, 'Old title', p('old note')))
    const r = settleDoc(doc(tq(`[!TODO] New title {#${X}}\nStatus: done`, p('old note'))), ctxOf({ known }), fakeWorld())
    expect(tasks(r.doc)).toEqual([expect.objectContaining({ itemId: X, status: 'in_progress', people: ['p_alex'], due: '2026-10-20', title: 'New title' })])
    expect(r.report.created).toEqual([])
    expect(r.report.kept.map((f) => f.itemId)).toEqual([X])
    expect(r.report.fieldsIgnored).toEqual(['New title'])
    expect(r.report.keptChanged).toEqual([X])
    expect(holdsOfReport(r.report)).toEqual(['assigned'])
    // the same quote where the task lives elsewhere
    const w = fakeWorld({ entries: [{ itemId: X, pageId: 'pg_other', title: 'Old title' }] })
    const copy = settleDoc(doc(tq(`[!TODO] Old title {#${X}}`)), ctxOf(), w)
    expect(tasks(copy.doc).map((t) => t.itemId)).toEqual(w.minted)
    expect(codes(copy.report)).toEqual(['copy'])
    const skip = settleDoc(doc(tq(`[!TODO] Old title {#${X}}`), p('after')), ctxOf({ existing: 'skip', source: 'menu' }), w)
    expect(tasks(skip.doc)).toEqual([])
    expect(quotesIn(skip.doc)).toBe(0)
    expect(codes(skip.report)).toEqual(['exists'])
    // an id nobody has (gone, invented): just a new task
    const dead = settleDoc(doc(tq('[!TODO] Ghost {#wi_ghost00001}')), ctxOf(), fakeWorld())
    expect(tasks(dead.doc)[0].itemId).toMatch(/^wi_new/)
    expect(dead.report.warnings).toEqual([])
  })

  test('the gate: creates false, the creation gate shut, an empty title, more than MAX_NEW_ITEMS', () => {
    expect(quotesIn(settleDoc(doc(tq('[!TODO] Stay')), ctxOf({ creates: false }), fakeWorld()).doc)).toBe(1)
    const shut = settleDoc(doc(tq('[!TODO] One'), tq('[!TODO] Two')), ctxOf(), fakeWorld({ canCreate: false }))
    expect(tasks(shut.doc)).toEqual([])
    expect(codes(shut.report)).toEqual(['gate'])
    expect(codes(settleDoc(doc(tq('[!TODO]')), ctxOf(), fakeWorld()).report)).toEqual(['title'])
    const many = doc(...Array.from({ length: MAX_NEW_ITEMS + 1 }, (_, i) => tq(`[!TODO] Task ${i}`)))
    expect(refusal(() => settleDoc(many, ctxOf({ strict: true }), fakeWorld()))).toContain(`More than ${MAX_NEW_ITEMS} new tasks`)
    const soft = settleDoc(many, ctxOf(), fakeWorld())
    expect(tasks(soft.doc)).toHaveLength(MAX_NEW_ITEMS)
    expect(codes(soft.report)).toEqual(['tooMany'])
  })

  test('keepSingle, removed, a nested task, fieldKey', () => {
    const known = doc(item({ itemId: A, people: ['p_alex'] }, 'Old'))
    const single = settleDoc(doc(tq('[!TODO] Renamed')), ctxOf({ known, keepSingle: true }), fakeWorld())
    expect(tasks(single.doc)).toEqual([expect.objectContaining({ itemId: A, people: ['p_alex'], title: 'Renamed' })])
    expect(single.report.created).toEqual([])
    expect(single.report.removed).toEqual([])
    const replaced = settleDoc(doc(tq('[!TODO] Renamed')), ctxOf({ known }), fakeWorld())
    expect(replaced.report.removed.map((f) => f.itemId)).toEqual([A])
    expect(replaced.report.created).toHaveLength(1)
    expect(holdsOfReport(replaced.report)).toEqual(['removes'])
    const nested = settleDoc(doc(tq('[!TODO] Outer', tq('[!TODO] Inner'))), ctxOf(), fakeWorld())
    expect(tasks(nested.doc).map((t) => t.title)).toEqual(['Outer', 'Inner'])
    expect(codes(nested.report)).toEqual(['nested'])
    const key = settleDoc(doc(tq('[!TODO] Plan\nOwner: Alex · Priority: high')), ctxOf(), fakeWorld())
    expect(tasks(key.doc)[0].people).toEqual([])
    expect(key.report.warnings).toEqual([{ code: 'fieldKey', task: 'Plan', value: 'Priority' }])
  })
})

test.describe('settle: links, scope, loops (pure)', () => {
  const LIVE = 'wi_live000001'
  const CHAIN = 'wi_live000002'

  test('handles in the write and from earlier calls, ids, unique titles (whole value first); duplicates refused', () => {
    const w = fakeWorld({ entries: [{ itemId: LIVE, pageId: 'pg_plan', title: 'Legal review' }, { itemId: CHAIN, pageId: 'pg_plan', title: 'Plan, review' }] })
    const r = settleDoc(
      doc(tq('[!TODO] Draft copy {#copy}'), tq(`[!TODO] Ship pricing\nBlocked by: #copy, #legal · Related: ${LIVE} · Blocks: Plan, review`)),
      ctxOf({ handles: new Map([['legal', LIVE]]) }),
      w,
    )
    const [copy, ship] = tasks(r.doc)
    expect(ship.blockedBy).toEqual([copy.itemId, LIVE])
    expect(ship.related).toEqual([LIVE])
    expect(r.report.blocks).toEqual([{ itemId: CHAIN, add: [ship.itemId] }])
    expect(r.report.handles).toEqual({ copy: copy.itemId, legal: LIVE })
    expect(r.report.created[1].blockedBy[0]).toMatchObject({ itemId: copy.itemId, title: 'Draft copy', isNew: true, handle: 'copy' })
    expect(holdsOfReport(r.report)).toEqual(['blocker'])
    // a title in this write wins over a live task of the same title; comma parts when the whole value is no task
    const parts = settleDoc(doc(tq('[!TODO] Legal review'), tq('[!TODO] Sign off\nBlocked by: Legal review, Ship it')), ctxOf(), fakeWorld({ entries: [{ itemId: LIVE, pageId: 'pg_plan', title: 'Legal review' }, { itemId: CHAIN, pageId: 'pg_plan', title: 'Ship it' }] }))
    const [legal, sign] = tasks(parts.doc)
    expect(sign.blockedBy).toEqual([legal.itemId, CHAIN])
    expect(refusal(() => settleDoc(doc(tq('[!TODO] A {#a}'), tq('[!TODO] B {#a}')), ctxOf({ strict: true }), fakeWorld()))).toContain('#a is declared twice')
    expect(codes(settleDoc(doc(tq('[!TODO] A {#a}'), tq('[!TODO] B {#a}')), ctxOf(), fakeWorld()).report)).toEqual(['link'])
    expect(refusal(() => settleDoc(doc(tq('[!TODO] A\nBlocked by: #nobody')), ctxOf({ strict: true }), fakeWorld()))).toContain('No task "#nobody"')
  })

  test('scope: agent scope, read limits (none / marked), gone tasks, private ← shared both ways, staged refs', () => {
    const w = fakeWorld({
      entries: [
        { itemId: 'wi_hidden0001', pageId: 'pg_hidden', title: 'Hidden work' },
        { itemId: 'wi_marked0001', pageId: 'pg_marks', title: 'Marked one' },
        { itemId: 'wi_marked0002', pageId: 'pg_marks', title: 'Unmarked one' },
        { itemId: 'wi_private001', pageId: 'pg_private', title: 'Private work', private: true },
        { itemId: 'wi_shared0001', pageId: 'pg_shared', title: 'Shared work' },
      ],
      readable: { pg_marks: ['wi_marked0001'] },
    })
    const visible = (id: string) => id !== 'pg_hidden'
    const hidden = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_hidden0001')), ctxOf({ visible }), w)
    expect(tasks(hidden.doc)[0].blockedBy).toEqual([])
    expect(hidden.report.warnings).toEqual([{ code: 'link', task: 'x', value: 'wi_hidden0001' }])
    const none = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_marked0001')), ctxOf({ readLimit: () => ({ mode: 'none' }) }), w)
    expect(codes(none.report)).toEqual(['link'])
    const marked = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_marked0001, wi_marked0002')), ctxOf({ readLimit: (id) => (id === 'pg_marks' ? { mode: 'marked' } : null) }), w)
    expect(tasks(marked.doc)[0].blockedBy).toEqual(['wi_marked0001'])
    expect(codes(marked.report)).toEqual(['link'])
    // in the trash / a template: not an index winner → no task to point at
    expect(codes(settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_trashed001')), ctxOf(), w).report)).toEqual(['link'])
    // a shared task never waits for a private one — a warning in every mode (never a refusal that confirms it exists)
    const shared = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_private001')), ctxOf({ strict: true }), w)
    expect(tasks(shared.doc)[0].blockedBy).toEqual([])
    expect(codes(shared.report)).toEqual(['scope'])
    const fromPrivate = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_private001')), ctxOf({ private: true }), w)
    expect(tasks(fromPrivate.doc)[0].blockedBy).toEqual(['wi_private001'])
    const staged = new Map([['wi_stage00001', { change: 'c1', private: true }]])
    expect(codes(settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_stage00001')), ctxOf({ staged }), w).report)).toEqual(['scope'])
    // Blocks: from a private page onto a shared task → a shared task would wait for a private one
    const blocks = settleDoc(doc(tq('[!TODO] x\nBlocks: wi_shared0001')), ctxOf({ private: true }), w)
    expect(blocks.report.blocks).toEqual([])
    expect(codes(blocks.report)).toEqual(['scope'])
  })

  test('the same title out of scope and in scope: the in-scope one, no ambiguity; candidates never name an out-of-scope page', () => {
    const w = fakeWorld({
      entries: [
        { itemId: 'wi_secret0001', pageId: 'pg_secret', title: 'Launch review' },
        { itemId: 'wi_open000001', pageId: 'pg_open', title: 'Launch review' },
        { itemId: 'wi_open000002', pageId: 'pg_open2', title: 'Budget check' },
        { itemId: 'wi_open000003', pageId: 'pg_open3', title: 'Budget check' },
        { itemId: 'wi_secret0002', pageId: 'pg_secret', title: 'Budget check' },
      ],
      pages: { pg_secret: 'Secret plans', pg_open: 'Launch plan', pg_open2: 'Finance', pg_open3: 'Ops' },
    })
    const visible = (id: string) => id !== 'pg_secret'
    const r = settleDoc(doc(tq('[!TODO] x\nBlocked by: Launch review')), ctxOf({ visible }), w)
    expect(tasks(r.doc)[0].blockedBy).toEqual(['wi_open000001'])
    expect(r.report.warnings).toEqual([])
    const msg = refusal(() => settleDoc(doc(tq('[!TODO] x\nBlocked by: Budget check')), ctxOf({ visible, strict: true }), w))
    expect(msg).toContain('wi_open000002 "Budget check" on "Finance"')
    expect(msg).toContain('wi_open000003 "Budget check" on "Ops"')
    expect(msg).not.toContain('Secret')
    expect(msg).not.toContain('wi_secret')
    expect(codes(settleDoc(doc(tq('[!TODO] x\nBlocked by: Budget check')), ctxOf({ visible }), w).report)).toEqual(['linkAmbiguous'])
  })

  test('a staged task of another change is a need; self links, caps, loops (new ↔ new, new → existing chain back)', () => {
    const staged = new Map([['wi_stage00001', { change: 'c1', private: false }], ['wi_stage00002', { change: 'c2', private: false }]])
    const r = settleDoc(doc(tq('[!TODO] x\nBlocked by: wi_stage00001, wi_stage00002')), ctxOf({ staged, change: 'c2' }), fakeWorld())
    expect(tasks(r.doc)[0].blockedBy).toEqual(['wi_stage00001', 'wi_stage00002'])
    expect(r.report.needs).toEqual(['c1'])
    expect(codes(settleDoc(doc(tq('[!TODO] Self {#me1}\nBlocked by: #me1')), ctxOf(), fakeWorld()).report)).toEqual(['self'])
    const crowd = Array.from({ length: 13 }, (_, i) => ({ id: `p_${i}`, name: `Person ${i}` }))
    const capped = settleDoc(doc(tq(`[!TODO] x\nOwner: ${crowd.map((c) => c.name).join(', ')}`)), ctxOf(), fakeWorld({ people: crowd }))
    expect(tasks(capped.doc)[0].people).toHaveLength(12)
    expect(codes(capped.report)).toEqual(['cap'])
    const many = Array.from({ length: 21 }, (_, i) => ({ itemId: `wi_rel${String(i).padStart(7, '0')}`, pageId: 'pg_plan', title: `Rel ${i}` }))
    const links = settleDoc(doc(tq(`[!TODO] x\nRelated: ${many.map((m) => m.itemId).join(', ')}`)), ctxOf(), fakeWorld({ entries: many }))
    expect(tasks(links.doc)[0].related).toHaveLength(20)
    expect(codes(links.report)).toEqual(['cap'])
    // new ↔ new: the second edge would close the loop
    const pair = settleDoc(doc(tq('[!TODO] A {#a}\nBlocked by: #b'), tq('[!TODO] B {#b}\nBlocked by: #a')), ctxOf(), fakeWorld())
    const [ta, tb] = tasks(pair.doc)
    expect(ta.blockedBy).toEqual([tb.itemId])
    expect(tb.blockedBy).toEqual([])
    expect(pair.report.warnings).toEqual([{ code: 'loop', task: 'B' }])
    // new → existing E (E waits for F), and "Blocks: F" (F would wait for the new one): a loop through the index
    const chain = fakeWorld({ entries: [{ itemId: 'wi_e000000001', pageId: 'pg_plan', title: 'E', blockedBy: ['wi_f000000001'] }, { itemId: 'wi_f000000001', pageId: 'pg_plan', title: 'F' }] })
    const back = settleDoc(doc(tq('[!TODO] N\nBlocked by: wi_e000000001 · Blocks: wi_f000000001')), ctxOf(), chain)
    expect(tasks(back.doc)[0].blockedBy).toEqual(['wi_e000000001'])
    expect(back.report.blocks).toEqual([])
    expect(codes(back.report)).toEqual(['loop'])
  })

  test('Blocks: onto a new task → its blockedBy; onto an existing one → report.blocks', () => {
    const w = fakeWorld({ entries: [{ itemId: 'wi_exist00001', pageId: 'pg_plan', title: 'Existing' }] })
    const r = settleDoc(doc(tq('[!TODO] First {#first}\nBlocks: #second, wi_exist00001'), tq('[!TODO] Second {#second}')), ctxOf(), w)
    const [first, second] = tasks(r.doc)
    expect(second.blockedBy).toEqual([first.itemId])
    expect(r.report.blocks).toEqual([{ itemId: 'wi_exist00001', add: [first.itemId] }])
  })
})

test.describe('holds, facts, the list query (pure)', () => {
  test('holdsOfEdit and heldClosure (held, edits, sends — closed over dependsOn and needs)', () => {
    expect(holdsOfEdit({ people: { add: ['p_alex'] } }, null)).toEqual(['names'])
    expect(holdsOfEdit({ due: '2026-10-17', reminder: '-1d' }, { people: [] })).toEqual(['reminder'])
    expect(holdsOfEdit({ due: '2026-10-18' }, { people: ['p_alex'] })).toEqual(['assigned'])
    expect(holdsOfEdit({ blockedBy: { add: [B] } }, { people: [] })).toEqual(['blocker'])
    expect(holdsOfEdit({ blockedBy: { add: [B] }, status: 'done' }, null)).toEqual([])
    const changes = [
      { id: 'c1', kind: 'create_page' as const },
      { id: 'c2', kind: 'create_row' as const, dependsOn: 'c1' },
      { id: 'c3', kind: 'edit' as const },
      { id: 'c4', kind: 'append' as const, needs: ['c3'] },
      { id: 'c5', kind: 'send' as const },
      { id: 'c6', kind: 'create_page' as const },
      { id: 'c7', kind: 'append' as const, needs: ['c6'] },
      { id: 'c8', kind: 'create_row' as const, dependsOn: 'c2' },
    ]
    const held = heldClosure(changes, (c) => (c.id === 'c1' ? ['names'] : []))
    expect([...held].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c8'])
  })

  const fact: ItemFact = {
    itemId: 'wi_ship000001',
    handle: null,
    tag: 'new',
    title: 'Ship pricing',
    status: 'in_progress',
    due: '2026-10-16',
    reminder: '-1d',
    people: [{ id: 'p_alex', name: 'Alex' }],
    blockedBy: [
      { itemId: 'wi_copy000001', title: 'Draft copy', isNew: true, handle: 'copy', inScope: true },
      { itemId: 'wi_secret0001', title: 'Secret plan', isNew: false, inScope: false },
    ],
    related: [],
  }
  const translator = (lang: 'en' | 'de') => (key: string, vars?: Record<string, string | number>) => {
    let out = itemMessages[lang][key] ?? workItemMessages[lang][key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) out = out.split(`{${k}}`).join(String(v))
    return out
  }

  test('factLine (EN + DE) and factLineEn: an out-of-scope link is named by id only', () => {
    expect(factLine(fact, 'en', translator('en'))).toBe('Ship pricing · Status In progress · Owner Alex · Due Fri 16 Oct · −1 d · Blocked by Draft copy · new, Secret plan')
    expect(factLine(fact, 'de', translator('de'))).toBe('Ship pricing · Status In Arbeit · Verantwortlich Alex · Fällig Fr 16 Okt · −1 T · Blockiert durch Draft copy · neu, Secret plan')
    const en = factLineEn(fact)
    expect(en).toBe('wi_ship000001 "Ship pricing" — status in progress · due 2026-10-16 (reminder -1d) · owner: Alex · blocked by wi_copy000001 "Draft copy" #copy (new), wi_secret0001 (outside your scope)')
    expect(en).not.toContain('Secret plan')
    const changed: ItemFact = { ...fact, tag: 'changed', status: 'done', before: { status: 'in_progress', due: fact.due, reminder: fact.reminder, people: [], blockedBy: fact.blockedBy, related: [] } }
    expect(factLineEn(changed)).toBe('wi_ship000001 "Ship pricing" — status in progress → done · owner nobody → Alex')
    expect(factLine(changed, 'en', translator('en'))).toBe('Ship pricing · Status In progress → Done · Owner — → Alex')
  })

  test('queryItems: status, person, pages, blocked, overdue, due before, query, scope; overdue first, then due, then page order', () => {
    const entry = (itemId: string, title: string, attrs: Record<string, unknown>, pageId = 'pg_a', order = 0, pageCreatedAt = 1): ItemEntry =>
      ({ itemId, title, pageId, order, pageCreatedAt, private: false, template: null, attrs: itemAttrs({ itemId, ...attrs }), blockId: null, progress: null, synced: null, inList: false }) as ItemEntry
    const all = [
      entry('wi_q000000001', 'Ship pricing page', { status: 'in_progress', due: '2026-10-20', people: ['p_alex'], blockedBy: ['wi_q000000002'] }, 'pg_a', 0),
      entry('wi_q000000002', 'Draft copy', { status: 'todo', due: '2026-10-10' }, 'pg_a', 1),
      entry('wi_q000000003', 'Legal review', { status: 'todo' }, 'pg_b', 0, 2),
      entry('wi_q000000004', 'Old launch', { status: 'done', due: '2026-10-01' }, 'pg_b', 1, 2),
      entry('wi_q000000005', 'Book the venue', { status: 'todo', due: '2026-10-15', people: ['p_sam'] }, 'pg_c', 0, 3),
    ]
    const index = { byId: new Map(all.map((e) => [e.itemId, e])), loopEdges: new Set<string>(), unloaded: 0 }
    const ids = (r: { items: ItemEntry[] }) => r.items.map((e) => e.itemId.slice(-1))
    const any = () => true
    expect(ids(queryItems(index, { now: NOW }, any))).toEqual(['2', '5', '1', '3'])
    expect(ids(queryItems(index, { now: NOW, status: 'done' }, any))).toEqual(['4'])
    expect(queryItems(index, { now: NOW, status: 'any' }, any).total).toBe(5)
    expect(ids(queryItems(index, { now: NOW, person: { id: 'p_alex' } }, any))).toEqual(['1'])
    expect(ids(queryItems(index, { now: NOW, person: 'none' }, any))).toEqual(['2', '3'])
    expect(ids(queryItems(index, { now: NOW, pages: new Set(['pg_b', 'pg_c']) }, any))).toEqual(['5', '3'])
    expect(ids(queryItems(index, { now: NOW, blocked: true }, any))).toEqual(['1'])
    expect(ids(queryItems(index, { now: NOW, overdue: true }, any))).toEqual(['2'])
    expect(ids(queryItems(index, { now: NOW, dueBefore: '2026-10-16' }, any))).toEqual(['2', '5'])
    expect(ids(queryItems(index, { now: NOW, query: '  PRICING ' }, any))).toEqual(['1'])
    expect(ids(queryItems(index, { now: NOW }, (e) => e.pageId !== 'pg_a'))).toEqual(['5', '3'])
    const limited = queryItems({ ...index, unloaded: 2 }, { now: NOW, limit: 2 }, any)
    expect(limited).toMatchObject({ total: 4, loading: true })
    expect(ids(limited)).toEqual(['2', '5'])
    // a loop edge never blocks
    expect(ids(queryItems({ ...index, loopEdges: new Set(['wi_q000000001>wi_q000000002']) }, { now: NOW, blocked: true }, any))).toEqual([])
  })

  test('pins: the global reader stays off, the schema generation stays 1, the server never learns the syntax', () => {
    expect(WORK_ITEMS_FROM_MARKDOWN).toBe(false)
    expect(DOC_SCHEMA_VERSION).toBe(1)
    expect(Object.keys(itemAttrs({})).sort()).toEqual(['blockedBy', 'doneAt', 'due', 'frozen', 'id', 'itemId', 'people', 'related', 'reminder', 'status'])
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|js|mjs|json|md)$/.test(name)) files.push(path)
      }
    }
    const root = fileURLToPath(new URL('../..', import.meta.url))
    walk(join(root, 'server/src'))
    expect(files.length).toBeGreaterThan(10)
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('[!TODO]'))).toEqual([])
    const tools = readFileSync(join(root, 'server/src/mcp/tools.ts'), 'utf8')
    const instructions = tools.slice(tools.indexOf('function instructions('), tools.indexOf('export function buildMcpServer'))
    expect(instructions).not.toMatch(/\[!TODO\]|task block|work_item/i)
  })
})

/* ------------------------------------------------------------------ */
/* B3 — claudeSettled and writeItems in the app                        */
/* ------------------------------------------------------------------ */

type Settled = { doc: JSONContent; report: Record<string, any> } | { refused: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const baseCtx = { source: 'terminal', creates: true, strict: false, pageId: null, private: false, me: true }

test.describe('claudeSettled: the order of the steps (in the app)', () => {
  test('raw HTML makes no task and no mention; a web image becomes a link; a person link with a context is a mention of the store name', async ({ page }) => {
    await openApp(page)
    const ids = await people(page)
    const md = [
      '<div data-type="workItem" data-item-id="wi_injected01"><p>Smuggled task</p></div>',
      '',
      'Ask <span data-type="mention" data-kind="date" data-id="2031-10-17" data-label="Oct 17" data-reminder="at">Oct 17</span> and [@Al](one:person/' + ids.Alex + ').',
      '',
      '![chart](https://attacker.example/c.png)',
    ].join('\n')
    const r = (await settle<Settled>(page, 'settled', md, baseCtx)) as { doc: JSONContent; report: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(tasks(r.doc)).toEqual([])
    expect(r.report.created).toEqual([])
    expect(mentionsIn(r.doc)).toEqual([{ id: ids.Alex, label: 'Alex', kind: 'person' }])
    expect(textOf(r.doc)).toContain('Ask @Oct 17 and [person:' + ids.Alex + '].')
    expect(hrefsIn(r.doc)).toContain('https://attacker.example/c.png')
    expect(r.report.mentionsAdded).toBe(1)
    // without a context: text
    expect(mentionsIn(await settle<JSONContent>(page, 'claudeDoc', md))).toEqual([])
  })

  test('a terminal write: owners by name, a due date, a handle link; a nested task lifted after its task; strict refusals list names, never emails', async ({ page }) => {
    await openApp(page)
    const ids = await people(page)
    const md = ['> [!TODO] Draft copy {#copy}', '> Owner: Alex, Mira · Due: 2026-10-17', '>', '> > [!TODO] Inner step', '', '> [!TODO] Ship pricing', '> Blocked by: #copy · Owner: [@Sam](one:person/' + ids.Sam + ')'].join('\n')
    const r = (await settle<Settled>(page, 'settled', md, baseCtx)) as { doc: JSONContent; report: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    const top = (r.doc.content ?? []).map((n) => (n.type === 'workItem' ? `task:${titleText(n.content?.[0]?.content ?? [])}` : n.type))
    expect(top).toEqual(['task:Draft copy', 'task:Inner step', 'task:Ship pricing'])
    const [copy, , ship] = tasks(r.doc)
    expect(copy).toMatchObject({ people: [ids.Alex, ids.Mira], due: '2026-10-17' })
    expect(ship).toMatchObject({ blockedBy: [copy.itemId], people: [ids.Sam] })
    expect(r.report.warnings.map((w: { code: string }) => w.code)).toEqual(['nested'])
    expect(r.report.created.map((f: ItemFact) => f.title)).toEqual(['Draft copy', 'Inner step', 'Ship pricing'])
    const people0 = await wsEval(page, (s) => s.people.length)
    const refused = await settle<Settled>(page, 'settled', '> [!TODO] x\n> Owner: Bob', { ...baseCtx, strict: true })
    expect('refused' in refused && refused.refused).toContain('People in this workspace: "Alex", "Mira", "Sam"')
    expect(JSON.stringify(refused)).not.toContain('@example.test')
    expect(await wsEval(page, (s) => s.people.length)).toBe(people0)
  })

  test('date reminders survive only when the replaced content had them; a known task comes back with its fields', async ({ page }) => {
    await openApp(page)
    const ids = await people(page)
    const known = doc(
      line({ type: 'text', text: 'Call by ' }, date('2026-10-17', 'Oct 17', '-1d')),
      item({ itemId: A, status: 'in_progress', people: [ids.Alex], due: '2026-10-20', reminder: '-1d' }, 'Ship pricing'),
    )
    const md = `Call by [@Oct 17](one:date/2026-10-17?r=-1d) and [@Oct 18](one:date/2026-10-18?r=at).\n\n> [!TODO] Ship the pricing page {#${A}}\n> Status: done · Owner: [@Sam](one:person/${ids.Sam})`
    const r = (await settle<Settled>(page, 'settled', md, { ...baseCtx, known })) as { doc: JSONContent; report: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(mentionsIn(r.doc)).toEqual([
      { id: '2026-10-17', label: 'Oct 17', kind: 'date', reminder: '-1d' },
      { id: '2026-10-18', label: 'Oct 18', kind: 'date' },
    ])
    expect(r.report.warnings.map((w: { code: string }) => w.code).sort()).toEqual(['dateReminder', 'fields'])
    expect(tasks(r.doc)).toEqual([expect.objectContaining({ itemId: A, status: 'in_progress', people: [ids.Alex], due: '2026-10-20', reminder: '-1d', title: 'Ship the pricing page' })])
    expect(r.report.keptChanged).toEqual([A])
    expect(r.report.fieldsIgnored).toEqual(['Ship the pricing page'])
  })

  test('pins in the app: a pasted `> [!TODO]` and Markdown without a context stay quotes', async ({ page }) => {
    await openApp(page)
    expect(tasks(await settle<JSONContent>(page, 'claudeDoc', '> [!TODO] Not a task here'))).toEqual([])
    const id = await createPage(page, { title: 'Paste here', content: doc(p('Start')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.click()
    await page.keyboard.press('End')
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', '> [!TODO] Pasted task\n> Owner: Alex')
      document.querySelector('#main .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(ed).toContainText('Pasted task')
    await flush(page)
    const content = await wsEval(page, (s, id) => s.pages[id].content, id)
    expect(tasks(content)).toEqual([])
  })
})

test.describe("writeItems with Claude's origin (in the app)", () => {
  test("origin 'ai' writes the content as Claude's; undo under an open Undo frame keeps its ref and names what changed by hand since", async ({ page }) => {
    await openApp(page)
    await startRecorder(page)
    const content = doc(p('Intro'), item({ id: 'blk-a', itemId: A }, 'Draft copy'), item({ id: 'blk-b', itemId: B }, 'Ship pricing'))
    const id = await createPage(page, { title: 'Nordlicht plan', content })
    const write = (edits: unknown[], opts: unknown) => page.evaluate(({ edits, opts }) => (window as unknown as { __oneItems: Seam }).__oneItems.write(edits, opts), { edits, opts })
    // no editor open: the store write carries origin 'ai'
    const r = await write([{ itemId: A, patch: { status: 'done' } }, { itemId: B, patch: { status: 'in_progress' } }], { origin: 'ai', by: 'system', toasts: false, writer: { kind: 'terminal', run: 'run7' } })
    expect(r.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, true])
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, id)).toBe('ai')
    // B changed by hand since; the undo (as the terminal batch's Undo) leaves B alone and says so
    await wsEval(
      page,
      (s, { id, B }) => {
        const c = JSON.parse(JSON.stringify(s.pages[id].content))
        for (const n of c.content) if (n.type === 'workItem' && n.attrs.itemId === B) n.attrs.status = 'todo'
        s.setContent(id, c, 'e2e')
      },
      { id, B },
    )
    const mark = await markRec(page)
    const undone = await page.evaluate(() => (window as unknown as { __oneItems: Seam }).__oneItems.undoLast('batch7'))
    expect(undone).toEqual({ kept: [B] })
    const after = tasks(await wsEval(page, (s, id) => s.pages[id].content, id))
    expect(after.map((t) => t.status)).toEqual(['todo', 'todo'])
    await expectLane(page, mark, /./, undefined, 'you~undo:batch7')
    // through the live editor (local): the content is written with origin 'ai' after the editor's commit
    await gotoPage(page, id)
    await expect(editorOf(page, id)).toContainText('Ship pricing')
    await write([{ itemId: B, patch: { status: 'done' } }], { origin: 'ai', by: 'system', toasts: false, writer: { kind: 'terminal', run: 'run8' } })
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, id)).toBe('ai')
    expect(tasks(await wsEval(page, (s, id) => s.pages[id].content, id))[1].status).toBe('done')
  })
})
