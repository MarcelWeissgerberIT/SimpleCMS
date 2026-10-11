/**
 * Task block P1 — the core: ids, scanning, patches, the workspace index, write.ts, reminders, the agenda,
 * people, the AI guards and the schema pins.
 * The pure parts (lib/itemIds.ts, editor/workitem/{scan,text,patch,turn}.ts, features/workitems graph / index)
 * run without a page, imported like workitem-p0.spec does; the rest runs in the app (`?e2e` seam
 * `window.__oneItems`). Test data is fictional.
 */
import type { JSONContent } from '@tiptap/core'
import { test, expect } from './fixtures'
import { collectItemIds, ITEM_ID, newItemId, outermostItems, remapItemLinks, remintItems, resetItems } from '../../src/app/lib/itemIds'
import { itemsOfContent, compareOccurrence } from '../../src/app/editor/workitem/scan'
import { itemTitleText, todoProgress } from '../../src/app/editor/workitem/text'
import { patchItemAttrs, patchItemInDoc } from '../../src/app/editor/workitem/patch'
import { itemBlocks, unwrapItemsIn } from '../../src/app/editor/workitem/turn'
import { itemLookup, setItemLookup } from '../../src/app/editor/workitem/lookup'
import { MAX_LINKS, MAX_PEOPLE } from '../../src/app/editor/workitem/attrs'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const A = 'wi_7f3a9c2d01'
const B = 'wi_1b2c3d4e5f'
const C = 'wi_9d8e7f6a5b'
const OUT = 'wi_0utside000'
const NOW = 1_790_000_000_000

const p = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs, content: [p(title), ...notes] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

function deepFreeze<T>(o: T): T {
  const stack: unknown[] = [o]
  while (stack.length) {
    const x = stack.pop()
    if (!x || typeof x !== 'object' || Object.isFrozen(x)) continue
    Object.freeze(x)
    for (const v of Object.values(x as Record<string, unknown>)) stack.push(v)
  }
  return o
}

/** The tasks of a JSON doc (attrs), document order, synced references included. */
function tasksOf(d: JSONContent): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push(n.attrs ?? {})
    for (const c of n.content ?? []) walk(c)
  }
  walk(d)
  return out
}

/** `depth` nested quotes with `inner` at the bottom. */
function nested(depth: number, inner: JSONContent): JSONContent {
  let n = inner
  for (let i = 0; i < depth; i++) n = { type: 'blockquote', content: [n] }
  return doc(n)
}

/* ------------------------------------------------------------------ */
/* lib/itemIds.ts                                                      */
/* ------------------------------------------------------------------ */

test.describe('ids (pure)', () => {
  test('newItemId passes ITEM_ID', () => {
    for (let i = 0; i < 1000; i++) expect(newItemId()).toMatch(ITEM_ID)
  })

  test('collectItemIds skips synced references (their tasks are the original\'s)', () => {
    const d = doc(
      item({ itemId: A }, 'Mine'),
      { type: 'syncedBlock', attrs: { syncId: 's1', sourcePageId: null }, content: [item({ itemId: B }, 'In the original')] },
      { type: 'syncedBlock', attrs: { syncId: 's2', sourcePageId: 'page-x' }, content: [item({ itemId: C }, 'A reference\'s copy')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('x'), item({ itemId: OUT }, 'Compact')] }] },
      item({ itemId: 'not-an-id' }, 'Invalid id'),
    )
    expect([...collectItemIds(d)].sort()).toEqual([A, B, OUT].sort())
  })

  test('remintItems: fresh ids, links among the copy follow, links outside stay, input untouched', () => {
    const d = deepFreeze(
      doc(
        item({ itemId: A, status: 'done', doneAt: NOW, due: '2031-10-17', reminder: '-1d', people: ['p_alex'], blockedBy: [B, OUT], related: [] }, 'Run the checkout'),
        item({ itemId: B, status: 'in_progress', people: ['p_sam'], related: [A] }, 'Approve the copy'),
        { type: 'syncedBlock', attrs: { syncId: 's2', sourcePageId: 'page-x' }, content: [item({ itemId: C, blockedBy: [A] }, 'Reference')] },
      ),
    )
    const before = JSON.stringify(d)
    const { doc: out, map } = remintItems(d)
    expect(JSON.stringify(d)).toBe(before)
    const [a, b, c] = tasksOf(out)
    expect(a.itemId).toMatch(ITEM_ID)
    expect(a.itemId).not.toBe(A)
    expect(b.itemId).not.toBe(B)
    expect(map.get(A)).toBe(a.itemId)
    expect(map.get(B)).toBe(b.itemId)
    expect(a.blockedBy).toEqual([b.itemId, OUT])
    expect(b.related).toEqual([a.itemId])
    // no reset: fields stay
    expect(a.status).toBe('done')
    expect(a.due).toBe('2031-10-17')
    expect(a.people).toBe((d.content![0].attrs as any).people)
    // the reference is the service's: untouched (same object)
    expect(out.content![2]).toBe(d.content![2])
    expect(c.itemId).toBe(C)
  })

  test('remintItems reset: open, no done time, no due date, no reminder — people and links stay', () => {
    const d = deepFreeze(doc(item({ itemId: A, status: 'done', doneAt: NOW, due: '2031-10-17T09:00', reminder: '-1d', people: ['p_alex'], blockedBy: [OUT] }, 'Fresh')))
    const { doc: out } = remintItems(d, { reset: true })
    const [a] = tasksOf(out)
    expect(a).toMatchObject({ status: 'todo', doneAt: null, due: null, reminder: null, people: ['p_alex'], blockedBy: [OUT] })
    expect(a.itemId).not.toBe(A)
  })

  test('remintItems with a shared map: one copy over several docs keeps its links', () => {
    const map = new Map<string, string>()
    const one = remintItems(doc(item({ itemId: A }, 'On page one')), { map })
    const two = remintItems(doc(item({ itemId: B, blockedBy: [A] }, 'On page two')), { map })
    expect(tasksOf(two.doc)[0].blockedBy).toEqual([tasksOf(one.doc)[0].itemId])
  })

  test('resetItems keeps ids; remapItemLinks maps ids and links', () => {
    const d = deepFreeze(doc(item({ itemId: A, status: 'done', doneAt: NOW, due: '2031-10-17', reminder: 'at', blockedBy: [B] }, 'x'), item({ itemId: B }, 'y')))
    const r = tasksOf(resetItems(d))
    expect(r[0]).toMatchObject({ itemId: A, status: 'todo', doneAt: null, due: null, reminder: null, blockedBy: [B] })
    expect(resetItems(doc(p('no tasks')))).toEqual(doc(p('no tasks')))
    const m = tasksOf(remapItemLinks(d, new Map([[B, C]])))
    expect(m[0].blockedBy).toEqual([C])
    expect(m[1].itemId).toBe(C)
    // nothing to change → the same object
    const plain = doc(p('a'), item({ itemId: A }, 'b'))
    expect(remapItemLinks(plain, new Map([[B, C]]))).toBe(plain)
  })

  test('5,000 nesting levels: remint, collect and outermost walk without recursion', () => {
    const d = nested(5000, item({ itemId: A, blockedBy: [OUT] }, 'Deep'))
    expect([...collectItemIds(d)]).toEqual([A])
    const { doc: out } = remintItems(d)
    expect(tasksOf2(out)[0].itemId).not.toBe(A)
    expect(outermostItems(d.content!)).toHaveLength(1)
    expect(itemsOfContent(d)).toHaveLength(1)
  })

  test('outermostItems: the outermost tasks in order, as they are; references stay out', () => {
    const t1 = item({ itemId: A }, 'One', item({ itemId: B }, 'misplaced inside'))
    const t2 = item({ itemId: C }, 'Two')
    const blocks = [p('x'), { type: 'callout', content: [t1] }, t2, { type: 'syncedBlock', attrs: { syncId: 's', sourcePageId: 'pg' }, content: [item({ itemId: OUT }, 'ref')] }]
    const out = outermostItems(blocks)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(t1)
    expect(out[1]).toBe(t2)
  })
})

/** tasksOf without recursion (deep docs). */
function tasksOf2(d: JSONContent): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  const stack = [d]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'workItem') out.push(n.attrs ?? {})
    for (const c of n.content ?? []) stack.push(c)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* editor/workitem: text, scan, patch, turn, lookup                    */
/* ------------------------------------------------------------------ */

test.describe('scan, text, patch (pure)', () => {
  test('itemTitleText: text + mention labels, hard break = space, one line, ≤ 140 chars', () => {
    const t = item({ itemId: A }, '')
    t.content![0] = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship  the ' },
        { type: 'mention', attrs: { id: 'p_alex', label: 'Alex', kind: 'person' } },
        { type: 'hardBreak' },
        { type: 'text', text: 'page\n' },
        { type: 'mention', attrs: { id: 'private', label: null, kind: 'page' } },
      ],
    }
    t.content!.push(p('Notes are never read'))
    expect(itemTitleText(t)).toBe('Ship the @Alex page')
    const long = itemTitleText(item({}, 'x'.repeat(400)))
    expect(long).toHaveLength(140)
    expect(long.endsWith('…')).toBe(true)
    expect(itemTitleText(p('A title block itself'))).toBe('A title block itself')
  })

  test('todoProgress: to-dos anywhere in the notes; null without any', () => {
    const steps = {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p('Name the plans')] },
        { type: 'taskItem', attrs: { checked: false }, content: [p('Shorten'), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('nested')] }] }] },
      ],
    }
    expect(todoProgress(item({ itemId: A }, 'T', p('note'), { type: 'callout', content: [steps] }))).toEqual({ done: 2, total: 3 })
    expect(todoProgress(item({ itemId: A }, 'T', p('note')))).toBeNull()
  })

  test('itemsOfContent: fields, synced flags, list items, order; cached per content object', () => {
    const d = deepFreeze(
      doc(
        item({ id: 'blk-a', itemId: A, status: 'in_progress', people: ['p_alex'] }, 'First', { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('s')] }] }),
        { type: 'syncedBlock', attrs: { syncId: 's1', sourcePageId: null }, content: [item({ itemId: B }, 'Original')] },
        { type: 'syncedBlock', attrs: { syncId: 's2', sourcePageId: 'pg' }, content: [item({ itemId: C }, 'Copy')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('Prepare:'), item({ itemId: OUT }, 'Compact')] }] },
      ),
    )
    const items = itemsOfContent(d)
    expect(items.map((i) => [i.attrs.itemId, i.synced, i.inList, i.order, i.title])).toEqual([
      [A, null, false, 0, 'First'],
      [B, 'original', false, 1, 'Original'],
      [C, 'copy', false, 2, 'Copy'],
      [OUT, null, true, 3, 'Compact'],
    ])
    expect(items[0].blockId).toBe('blk-a')
    expect(items[0].progress).toEqual({ done: 1, total: 1 })
    expect(items[0].attrs.status).toBe('in_progress')
    expect(itemsOfContent(d)).toBe(items)
    expect(itemsOfContent(null)).toHaveLength(0)
  })

  test('itemsOfContent never reads the inline content of a line other than a task title', () => {
    let reads = 0
    const spy = (text: string): JSONContent => {
      const n: JSONContent = { type: 'paragraph' }
      Object.defineProperty(n, 'content', {
        enumerable: true,
        get() {
          reads++
          return [{ type: 'text', text }]
        },
      })
      return n
    }
    const h: JSONContent = { type: 'heading', attrs: { level: 2 } }
    Object.defineProperty(h, 'content', {
      enumerable: true,
      get() {
        reads++
        return [{ type: 'text', text: 'Heading' }]
      },
    })
    const d = doc(spy('Intro'), h, item({ itemId: A }, 'Title is read', spy('A note line')), { type: 'blockquote', content: [spy('quoted')] })
    expect(itemsOfContent(d)).toHaveLength(1)
    expect(reads).toBe(0)
  })

  test('compareOccurrence: earliest page, then page id, then document order', () => {
    const occ = [
      { pageCreatedAt: 20, pageId: 'b', order: 0 },
      { pageCreatedAt: 10, pageId: 'z', order: 3 },
      { pageCreatedAt: 10, pageId: 'a', order: 2 },
      { pageCreatedAt: 10, pageId: 'a', order: 1 },
    ]
    expect([...occ].sort(compareOccurrence)).toEqual([occ[3], occ[2], occ[1], occ[0]])
  })

  test('patchItemAttrs: only changed keys, untouched values by reference, doneAt rules', () => {
    const people = ['p_alex']
    const blockedBy = [B]
    const attrs = deepFreeze({ id: 'blk', itemId: A, status: 'todo', due: null, reminder: null, people, blockedBy, related: [], doneAt: null, frozen: null })
    const done = patchItemAttrs(attrs, { status: 'done' }, NOW)
    expect(done).toEqual({ status: 'done', doneAt: NOW })
    const merged = { ...attrs, ...done }
    expect(merged.people).toBe(people)
    expect(merged.blockedBy).toBe(blockedBy)
    // already done: nothing
    expect(patchItemAttrs(merged, { status: 'done' }, NOW + 5)).toBeNull()
    // reopen clears doneAt
    expect(patchItemAttrs(merged, { status: 'todo' }, NOW)).toEqual({ status: 'todo', doneAt: null })
    expect(patchItemAttrs(merged, { status: 'in_progress' }, NOW)).toEqual({ status: 'in_progress', doneAt: null })
    // no-ops
    expect(patchItemAttrs(attrs, { status: 'todo', people: { add: ['p_alex'] }, blockedBy: { add: [B] } }, NOW)).toBeNull()
    expect(patchItemAttrs(attrs, { status: 'blocked' as never }, NOW)).toBeNull()
  })

  test('patchItemAttrs: links valid, never own, deduped, appended in order, capped; people capped', () => {
    const attrs = { itemId: A, people: [], blockedBy: [B], related: [] }
    expect(patchItemAttrs(attrs, { blockedBy: { add: [A, B, C, 'nope', C, OUT] } }, NOW)).toEqual({ blockedBy: [B, C, OUT] })
    expect(patchItemAttrs(attrs, { blockedBy: { remove: [B] } }, NOW)).toEqual({ blockedBy: [] })
    const many = Array.from({ length: 30 }, (_, i) => `wi_${String(i).padStart(10, '0')}`)
    expect((patchItemAttrs(attrs, { related: { add: many } }, NOW)!.related as string[]).length).toBe(MAX_LINKS)
    const folks = Array.from({ length: 20 }, (_, i) => `p_${i}`)
    expect((patchItemAttrs(attrs, { people: { add: folks } }, NOW)!.people as string[]).length).toBe(MAX_PEOPLE)
    expect(patchItemAttrs(attrs, { people: { add: ['has space', '<b>'] } }, NOW)).toBeNull()
    // a new own id: a link to it goes
    expect(patchItemAttrs({ itemId: A, blockedBy: [B, C] }, { itemId: C }, NOW)).toEqual({ itemId: C, blockedBy: [B] })
    expect(patchItemAttrs({ itemId: A }, { itemId: 'wi_bad' }, NOW)).toBeNull()
  })

  test('patchItemAttrs: due and reminder', () => {
    const due = { itemId: A, due: '2031-10-17', reminder: '-1d' }
    expect(patchItemAttrs(due, { due: null }, NOW)).toEqual({ due: null, reminder: null })
    // a moved date keeps its reminder
    expect(patchItemAttrs(due, { due: '2031-10-20' }, NOW)).toEqual({ due: '2031-10-20' })
    expect(patchItemAttrs(due, { reminder: 'at' }, NOW)).toEqual({ reminder: 'at' })
    expect(patchItemAttrs(due, { reminder: null }, NOW)).toEqual({ reminder: null })
    expect(patchItemAttrs(due, { reminder: 'soon' }, NOW)).toBeNull()
    expect(patchItemAttrs(due, { due: '2031-02-30' }, NOW)).toBeNull()
    // no due: the reminder is ignored
    expect(patchItemAttrs({ itemId: A }, { reminder: '-1d' }, NOW)).toBeNull()
    expect(patchItemAttrs({ itemId: A }, { due: '2031-10-17', reminder: '-1d' }, NOW)).toEqual({ due: '2031-10-17', reminder: '-1d' })
    // a reminder left over without its date does not come back with a new one
    expect(patchItemAttrs({ itemId: A, reminder: '-1d' }, { due: '2031-10-17' }, NOW)).toEqual({ due: '2031-10-17', reminder: null })
  })

  test('patchItemInDoc: the first occurrence outside synced copies, only changed keys, immutable', () => {
    const people = ['p_alex']
    const d = deepFreeze(
      doc(
        p('intro'),
        { type: 'syncedBlock', attrs: { syncId: 's', sourcePageId: 'pg' }, content: [item({ itemId: A, status: 'todo' }, 'ref copy')] },
        { type: 'callout', content: [item({ itemId: A, status: 'todo', people }, 'mine')] },
        item({ itemId: A, status: 'todo' }, 'second occurrence'),
      ),
    )
    const out = patchItemInDoc(d, A, { status: 'done' }, NOW)!
    const tasks = tasksOf(out)
    expect(tasks.map((t) => t.status)).toEqual(['todo', 'done', 'todo'])
    expect(tasks[1].people).toBe(people)
    expect(out.content![0]).toBe(d.content![0])
    expect(out.content![1]).toBe(d.content![1])
    expect(out.content![3]).toBe(d.content![3])
    expect(patchItemInDoc(d, B, { status: 'done' }, NOW)).toBeNull()
    expect(patchItemInDoc(d, A, { status: 'todo' }, NOW)).toBe(d)
  })

  test('itemBlocks / unwrapItemsIn: tasks as plain blocks, at any depth, same array without any', () => {
    const t = item({ itemId: A, status: 'done' }, 'Title', p('Note'))
    expect(itemBlocks(t)).toEqual([p('Title'), p('Note')])
    expect(itemBlocks({ type: 'workItem', attrs: {} })).toEqual([{ type: 'paragraph' }])
    const list = deepFreeze([p('a'), { type: 'callout', content: [t] }, item({ itemId: B }, 'Top', item({ itemId: C }, 'inner'))])
    const out = unwrapItemsIn(list)
    expect(JSON.stringify(out)).not.toContain('workItem')
    expect(out[0]).toBe(list[0])
    expect(out[1]).toEqual({ type: 'callout', content: [p('Title'), p('Note')] })
    expect(out.slice(2)).toEqual([p('Top'), p('inner')])
    const none = [p('a'), p('b')]
    expect(unwrapItemsIn(none)).toBe(none)
  })

  test('lookup registry: fail-closed until registered', () => {
    const l = itemLookup()
    expect(l.canCreate()).toBe(false)
    expect(l.taken(A, null)).toBe(false)
    expect(l.gone(A, null)).toBe(false)
    expect(l.isPrivate(A)).toBe(false)
    setItemLookup({ taken: () => true, gone: () => true, isPrivate: () => true, canCreate: () => true })
    expect(itemLookup().canCreate()).toBe(true)
    setItemLookup(null)
    expect(itemLookup().canCreate()).toBe(false)
  })
})
