/**
 * Task block P1 — the core: ids, scanning, patches, the workspace index, write.ts, reminders, the agenda,
 * people, the AI guards and the schema pins.
 * The pure parts (lib/itemIds.ts, editor/workitem/{scan,text,patch,turn}.ts, features/workitems graph / index)
 * run without a page, imported like workitem-p0.spec does; the rest runs in the app (`?e2e` seam
 * `window.__oneItems`). Test data is fictional.
 */
import type { JSONContent } from '@tiptap/core'
import type { Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { test, expect, openApp, wsEval, createPage, flush, gotoPage, editorOf, mockClaude, MOD } from './fixtures'
import { collectItemIds, ITEM_ID, newItemId, outermostItems, remapItemLinks, remintItems, resetItems } from '../../src/app/lib/itemIds'
import { itemsOfContent, compareOccurrence } from '../../src/app/editor/workitem/scan'
import { itemTitleText, todoProgress } from '../../src/app/editor/workitem/text'
import { patchItemAttrs, patchItemInDoc } from '../../src/app/editor/workitem/patch'
import { itemBlocks, unwrapItemsIn } from '../../src/app/editor/workitem/turn'
import { itemLookup, setItemLookup } from '../../src/app/editor/workitem/lookup'
import { MAX_LINKS, MAX_PEOPLE, itemAttrs } from '../../src/app/editor/workitem/attrs'
import { buildIndex, updateIndex, type PageItems } from '../../src/app/features/workitems/itemIndex'
import { loopEdgesOf, wouldLoop, graphOf } from '../../src/app/features/workitems/graph'
import { itemView, DUP_DELAY } from '../../src/app/features/workitems/view'
import { ringsHere, audienceText } from '../../src/app/features/workitems/audience'
import { unblockedBy } from '../../src/app/features/workitems/unblock'
import { keepYRefs } from '../../src/app/cloud/yrefs'
import { DOC_SCHEMA_VERSION, NODE_GENERATIONS } from '../../src/app/store/generations'
import { WORK_ITEMS_FROM_MARKDOWN } from '../../src/app/editor/workitem/markdown'
import { plainText } from '../../src/app/store/plain'
import * as Y from 'yjs'
import { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'

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
    setItemLookup({ taken: () => true, gone: () => true, isPrivate: () => true, canCreate: () => true, openBlockers: () => 0, dependents: () => 0 })
    expect(itemLookup().canCreate()).toBe(true)
    setItemLookup(null)
    expect(itemLookup().canCreate()).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* features/workitems: the index, the graph, views, audience (pure)    */
/* ------------------------------------------------------------------ */

const deps = { compare: compareOccurrence }

function pageOf(pageId: string, content: JSONContent, flags: Partial<PageItems> = {}): PageItems {
  const trashed = flags.trashed ?? false
  const template = flags.template ?? null
  return { pageId, items: itemsOfContent(content), createdAt: flags.createdAt ?? 1000, private: flags.private ?? false, trashed, template, live: !trashed && !template }
}

const attrsOf = (a: Record<string, unknown>) => itemAttrs(a)

test.describe('index + graph (pure)', () => {
  test('build: winners among live originals, trash and templates apart, synced copies left out', () => {
    const idx = buildIndex(
      [
        pageOf('p1', doc(item({ id: 'b1', itemId: A, status: 'todo', blockedBy: [B] }, 'Ship it'), item({ id: 'b2', itemId: B, status: 'in_progress' }, 'Approve'))),
        pageOf('p2', doc(item({ itemId: C, status: 'done' }, 'Trashed one')), { trashed: true }),
        pageOf('p3', doc(item({ itemId: OUT }, 'In a template'), item({ itemId: 'wi_tplself000', blockedBy: [OUT] }, 'Waits in the template')), { template: 'tpl' }),
        pageOf('p4', doc({ type: 'syncedBlock', attrs: { syncId: 's', sourcePageId: 'p1' }, content: [item({ itemId: A }, 'Ship it (copy)')] })),
        pageOf('p5', doc(p('no tasks'))),
      ],
      0,
      deps,
    )
    expect([...idx.byPage.keys()].sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect([...idx.byId.keys()].sort()).toEqual([A, B].sort())
    expect(idx.byId.get(A)!.pageId).toBe('p1')
    expect(idx.everywhere.get(A)).toBe(1)
    expect(idx.trashed.has(C)).toBe(true)
    expect(idx.templated.get(OUT)![0].template).toBe('tpl')
    expect(idx.dependents.get(B)).toEqual([A])
    const v = itemView(idx, attrsOf({ itemId: A, status: 'todo', blockedBy: [B, C, OUT, 'wi_gone000000'] }), { pageId: 'p1', blockId: 'b1', now: NOW })
    expect(v.indexed).toBe(true)
    expect(v.blockers.map((b) => [b.state, b.title])).toEqual([
      ['in_progress', 'Approve'],
      ['trash', null],
      ['gone', null],
      ['gone', null],
    ])
    expect(v.openBlockers).toBe(1)
    expect(v.blocked).toBe(true)
    // the blocker sees its dependent
    const vb = itemView(idx, attrsOf({ itemId: B, status: 'in_progress' }), { pageId: 'p1', blockId: 'b2', now: NOW })
    expect(vb.dependents.map((d) => d.title)).toEqual(['Ship it'])
    // a template's task resolves its own template's tasks only
    const vt = itemView(idx, attrsOf({ itemId: 'wi_tplself000', blockedBy: [OUT] }), { pageId: 'p3', blockId: null, now: NOW })
    expect(vt.blockers[0].state).toBe('open')
    // loading while team pages are still missing their content
    const loading = buildIndex([pageOf('p1', doc(item({ itemId: A, blockedBy: ['wi_elsewhere0'] }, 'x')))], 2, deps)
    expect(itemView(loading, attrsOf({ itemId: A, blockedBy: ['wi_elsewhere0'] }), { pageId: 'p1', blockId: null, now: NOW }).blockers[0].state).toBe('loading')
  })

  test('after all, done, not indexed yet', () => {
    const idx = buildIndex([pageOf('p1', doc(item({ itemId: A, blockedBy: [B] }, 'Waits'), item({ itemId: B, status: 'done', doneAt: NOW }, 'Finished')))], 0, deps)
    const v = itemView(idx, attrsOf({ itemId: A, blockedBy: [B] }), { pageId: 'p1', blockId: null, now: NOW })
    expect(v.blocked).toBe(false)
    expect(v.afterAll).toBe(true)
    expect(itemView(idx, attrsOf({ itemId: A, status: 'done', doneAt: NOW, blockedBy: [B] }), { pageId: 'p1', blockId: null, now: NOW }).afterAll).toBe(false)
    const fresh = itemView(idx, attrsOf({ itemId: 'wi_brandnew00', blockedBy: [B] }), { pageId: 'p1', blockId: null, now: NOW })
    expect(fresh.indexed).toBe(false)
    expect(fresh.blockers[0].title).toBeNull()
  })

  test('related: own ∪ back, deduped; structural sharing returns the previous view', () => {
    const idx = buildIndex([pageOf('p1', doc(item({ itemId: A, related: [B] }, 'One'), item({ itemId: B, related: [A] }, 'Two'), item({ itemId: C, related: [A] }, 'Three')))], 0, deps)
    const v = itemView(idx, attrsOf({ itemId: A, related: [B] }), { pageId: 'p1', blockId: null, now: NOW })
    expect(v.related.map((r) => [r.itemId, r.own])).toEqual([
      [B, true],
      [C, false],
    ])
    const again = itemView(idx, attrsOf({ itemId: A, related: [B] }), { pageId: 'p1', blockId: null, now: NOW }, v)
    expect(again).toBe(v)
  })

  test('duplicates: winner = earliest page, DUPLICATE only after the delay', () => {
    const idx = buildIndex(
      [pageOf('late', doc(item({ id: 'x2', itemId: A }, 'Copy')), { createdAt: 2000 }), pageOf('early', doc(item({ id: 'x1', itemId: A }, 'Original')), { createdAt: 1000 })],
      0,
      deps,
    )
    expect(idx.dups.get(A)!.map((e) => e.pageId)).toEqual(['early', 'late'])
    expect(idx.byId.get(A)!.pageId).toBe('early')
    const since = () => NOW
    const attrs = attrsOf({ id: 'x2', itemId: A })
    expect(itemView(idx, attrs, { pageId: 'late', blockId: 'x2', now: NOW + DUP_DELAY - 1, dupSince: since }).duplicate).toBeNull()
    expect(itemView(idx, attrs, { pageId: 'late', blockId: 'x2', now: NOW + DUP_DELAY, dupSince: since }).duplicate).toBe('loser')
    expect(itemView(idx, attrsOf({ id: 'x1', itemId: A }), { pageId: 'early', blockId: 'x1', now: NOW + DUP_DELAY, dupSince: since }).duplicate).toBe('winner')
  })

  test('update: a title edit swaps that page\'s entries only; a link change rebuilds the graph', () => {
    const p1 = pageOf('p1', doc(item({ itemId: A, blockedBy: [B] }, 'Ship it')))
    const p2 = pageOf('p2', doc(item({ itemId: B }, 'Approve')))
    const idx = buildIndex([p1, p2], 0, deps)
    const renamed = updateIndex(idx, [pageOf('p2', doc(item({ itemId: B }, 'Approve the copy')))], [], 0, deps)
    expect(renamed.version).toBe(idx.version + 1)
    expect(renamed.byId.get(B)!.title).toBe('Approve the copy')
    expect(renamed.dependents).toBe(idx.dependents)
    expect(renamed.loopEdges).toBe(idx.loopEdges)
    expect(renamed.byId.get(A)).toBe(idx.byId.get(A))
    // the same page state again: the same index object
    expect(updateIndex(renamed, [renamed.byPage.get('p2')!], [], 0, deps)).toBe(renamed)
    // a link removed: graph rebuilt
    const unlinked = updateIndex(renamed, [pageOf('p1', doc(item({ itemId: A }, 'Ship it')))], [], 0, deps)
    expect(unlinked.dependents.get(B)).toBeUndefined()
    // a page leaves (deleted / no tasks): its ids go
    const gone = updateIndex(unlinked, [], ['p2'], 0, deps)
    expect(gone.byId.has(B)).toBe(false)
    // only the unloaded count changed
    const waiting = updateIndex(gone, [], [], 3, deps)
    expect(waiting.unloaded).toBe(3)
    expect(waiting.byId).toBe(gone.byId)
  })

  test('loops: Tarjan on a 3-cycle with a tail; wouldLoop', () => {
    const edges = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
      ['d', ['a']],
      ['e', ['d']],
    ])
    expect([...loopEdgesOf(edges)].sort()).toEqual(['a>b', 'b>c', 'c>a'])
    // a long chain stays iterative
    const chain = new Map<string, string[]>()
    for (let i = 0; i < 20_000; i++) chain.set(`n${i}`, [`n${i + 1}`])
    chain.set('n20000', ['n0'])
    expect(loopEdgesOf(chain).size).toBe(20_001)
    const idx = buildIndex([pageOf('p', doc(item({ itemId: A, blockedBy: [B] }, 'a'), item({ itemId: B, blockedBy: [C] }, 'b'), item({ itemId: C }, 'c')))], 0, deps)
    expect(wouldLoop(idx, C, A)).toBe(true)
    expect(wouldLoop(idx, A, C)).toBe(false)
    expect(wouldLoop(idx, A, A)).toBe(true)
    const looped = buildIndex([pageOf('p', doc(item({ itemId: A, blockedBy: [B] }, 'a'), item({ itemId: B, blockedBy: [A] }, 'b'), item({ itemId: C, blockedBy: [A] }, 'c')))], 0, deps)
    expect([...looped.loopEdges].sort()).toEqual([`${A}>${B}`, `${B}>${A}`].sort())
    const v = itemView(looped, attrsOf({ itemId: A, blockedBy: [B] }), { pageId: 'p', blockId: null, now: NOW })
    expect(v.blockers[0].state).toBe('loop')
    expect(v.blocked).toBe(false)
    expect(graphOf(looped.byId).dependents.get(A)!.sort()).toEqual([B, C].sort())
  })

  test('ringsHere / audienceText', () => {
    const team = { team: true, me: 'u_me', members: new Set(['u_me', 'u_alex']) }
    expect(ringsHere(['u_alex'], { team: false, me: null, members: null })).toBe(true)
    expect(ringsHere([], team)).toBe(true)
    expect(ringsHere(['u_me', 'u_alex'], team)).toBe(true)
    expect(ringsHere(['u_alex'], team)).toBe(false)
    expect(ringsHere(['p_local'], team)).toBe(true)
    expect(ringsHere(['p_local'], { ...team, members: null })).toBe(false)
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`
    const name = (id: string) => ({ u_me: 'You', u_alex: 'Alex', u_mira: 'Mira' })[id] ?? null
    expect(audienceText(['u_alex'], { team: false, me: null, members: null }, name, t, 'en')).toBeNull()
    expect(audienceText([], team, name, t, 'en')).toBe('features.workItems.audience.everyone')
    expect(audienceText(['p_local'], team, name, t, 'en')).toBe('features.workItems.audience.noMember')
    expect(audienceText(['u_alex', 'u_me'], team, name, t, 'en')).toBe('features.workItems.audience.people{"names":"Alex and You"}')
    expect(audienceText(['u_alex', 'u_me'], team, name, t, 'de')).toBe('features.workItems.audience.people{"names":"Alex und You"}')
  })
})

/* ------------------------------------------------------------------ */
/* The live index in the app (window.__oneItems)                       */
/* ------------------------------------------------------------------ */

type Items = {
  notifies: () => number
  index: () => any
  view: (attrs: unknown, pageId: string | null, blockId?: string | null) => any
  isBuilt: () => boolean
  pending: () => number
  rebuild: () => number
  canCreate: () => boolean
}
const items = <R>(page: Page, fn: (i: Items) => R): Promise<R> =>
  page.evaluate(`(${fn.toString()})(window.__oneItems)`) as Promise<R>

test.describe('live index (in the app)', () => {
  test('lazy, incremental, never notifies synchronously; DUPLICATE after the delay without any other change', async ({ page, errors }) => {
    await openApp(page)
    expect(await items(page, (i) => i.isBuilt())).toBe(false)
    expect(await items(page, (i) => i.canCreate())).toBe(true)
    const one = await createPage(page, { title: 'Launch plan', content: doc(item({ id: 'blk-a', itemId: A, blockedBy: [B] }, 'Run the checkout'), item({ id: 'blk-b', itemId: B, status: 'in_progress' }, 'Approve the copy')) })
    const idx = await items(page, (i) => i.index())
    expect(idx.pages).toContain(one)
    expect(idx.byId[A].title).toBe('Run the checkout')
    expect(idx.dependents[B]).toEqual([A])

    // a write: queued, applied a frame later; a read in between applies it at once but notifies only in a microtask
    const sync = await page.evaluate(
      async ({ one, B }) => {
        const w = window as any
        const s = w.__one.workspace.getState()
        const content = JSON.parse(JSON.stringify(s.pages[one].content))
        content.content[1].content[0].content[0].text = 'Approve the final copy'
        s.setContent(one, content, 'e2e')
        const pending = w.__oneItems.pending()
        const n0 = w.__oneItems.notifies()
        const title = w.__oneItems.index().byId[B].title
        const n1 = w.__oneItems.notifies()
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
        return { pending, title, syncNotified: n1 - n0, later: w.__oneItems.notifies() - n0 }
      },
      { one, B },
    )
    expect(sync.pending).toBeGreaterThan(0)
    expect(sync.title).toBe('Approve the final copy')
    expect(sync.syncNotified).toBe(0)
    expect(sync.later).toBe(1)

    // trash the page: its tasks become "in trash" for a ref from elsewhere
    const other = await createPage(page, { title: 'Elsewhere', content: doc(item({ itemId: C, blockedBy: [A] }, 'Waits for the checkout')) })
    await wsEval(page, (s, id) => s.trashPage(id), one)
    await expect.poll(() => items(page, (i) => i.index().trashed)).toContain(A)
    const v = await page.evaluate(({ C, A, other }) => (window as any).__oneItems.view({ itemId: C, status: 'todo', blockedBy: [A], related: [], people: [], due: null, reminder: null, doneAt: null, frozen: null, id: null }, other), { C, A, other })
    expect(v.blockers[0].state).toBe('trash')
    await wsEval(page, (s, id) => s.restorePage(id), one)
    await expect.poll(() => items(page, (i) => Object.keys(i.index().byId))).toContain(A)

    // the same id on a second page: a duplicate, DUPLICATE shows at 1.5 s without any other change
    const dupPage = await createPage(page, { title: 'Pasted twice', content: doc(item({ id: 'blk-dup', itemId: B }, 'Approve the final copy')) })
    await expect.poll(() => items(page, (i) => Object.keys(i.index().dups))).toContain(B)
    const timing = await page.evaluate(
      async ({ B, dupPage }) => {
        const w = window as any
        const attrs = { itemId: B, status: 'todo', blockedBy: [], related: [], people: [], due: null, reminder: null, doneAt: null, frozen: null, id: 'blk-dup' }
        const v0 = w.__oneItems.index().version
        const early = w.__oneItems.view(attrs, dupPage, 'blk-dup').duplicate
        await new Promise((r) => setTimeout(r, 1700))
        return { early, late: w.__oneItems.view(attrs, dupPage, 'blk-dup').duplicate, bumped: w.__oneItems.index().version > v0 }
      },
      { B, dupPage },
    )
    expect(timing.early).toBeNull()
    expect(timing.late).toBe('loser')
    expect(timing.bumped).toBe(true)
    await flush(page)
    expect(errors.list).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* B3: unblock (pure), keepYRefs (pure + y-tiptap), writeItems (app)   */
/* ------------------------------------------------------------------ */

test.describe('unblock + bridge refs (pure)', () => {
  test('unblockedBy: dependents with no other open blocker; loops and done ones left out', () => {
    const idx = buildIndex(
      [
        pageOf(
          'p',
          doc(
            item({ itemId: A }, 'Draft copy'),
            item({ itemId: B, blockedBy: [A] }, 'Ship pricing'),
            item({ itemId: C, blockedBy: [A, OUT] }, 'Two blockers'),
            item({ itemId: OUT }, 'Other open'),
            item({ itemId: 'wi_donealrdy0', status: 'done', doneAt: NOW, blockedBy: [A] }, 'Done already'),
          ),
        ),
      ],
      0,
      deps,
    )
    expect(unblockedBy(idx, A).map((e) => e.itemId)).toEqual([B])
    expect(unblockedBy(idx, [A, OUT]).map((e) => e.itemId).sort()).toEqual([B, C].sort())
    const loop = buildIndex([pageOf('p', doc(item({ itemId: A, blockedBy: [B] }, 'a'), item({ itemId: B, blockedBy: [A] }, 'b')))], 0, deps)
    expect(unblockedBy(loop, A)).toEqual([])
  })

  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*', attrs: { id: { default: null } } },
      workItem: {
        group: 'block',
        content: 'paragraph block*',
        attrs: { id: { default: null }, itemId: { default: null }, status: { default: 'todo' }, people: { default: [] }, blockedBy: { default: [] }, related: { default: [] }, doneAt: { default: null } },
      },
      text: {},
    },
  })
  const yItem = (id: string, itemId: string, people: string[]) => ({
    type: 'workItem',
    attrs: { id, itemId, status: 'todo', people, blockedBy: [B], related: [], doneAt: null },
    content: [{ type: 'paragraph', attrs: { id: `${id}-t` }, content: [{ type: 'text', text: `Task ${itemId}` }] }],
  })

  test('keepYRefs: deep-equal arrays come back as Y\'s objects, input untouched', () => {
    const ydoc = new Y.Doc()
    const frag = ydoc.getXmlFragment('default')
    prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [yItem('b1', A, ['p1']), yItem('b2', C, ['p2'])] }, frag)
    const cloned = deepFreeze(structuredClone(yXmlFragmentToProsemirrorJSON(frag)) as JSONContent)
    const out = keepYRefs(cloned, frag)
    const yAttrs = (frag.get(0) as Y.XmlElement).getAttributes() as Record<string, unknown>
    expect(out.content![0].attrs!.people).toBe(yAttrs.people)
    expect(out.content![0].attrs!.blockedBy).toBe(yAttrs.blockedBy)
    expect(cloned.content![0].attrs!.people).not.toBe(yAttrs.people)
    // a changed array stays the caller's
    const changed = structuredClone(cloned) as JSONContent
    changed.content![1].attrs!.people = ['p2', 'p3']
    const out2 = keepYRefs(changed, frag)
    expect(out2.content![1].attrs!.people).toEqual(['p2', 'p3'])
    expect(out2.content![1].attrs!.blockedBy).toBe(((frag.get(1) as Y.XmlElement).getAttributes() as Record<string, unknown>).blockedBy)
    // nothing to keep → the same object
    const none = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
    expect(keepYRefs(none, frag)).toBe(none)
  })

  test('a bridge-style status write sets only status (+ doneAt) with keepYRefs — people and links too without it', () => {
    const run = (keep: boolean) => {
      const ydoc = new Y.Doc()
      const frag = ydoc.getXmlFragment('default')
      prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [yItem('b1', A, ['p1']), yItem('b2', C, ['p2'])] }, frag)
      const set: string[] = []
      frag.observeDeep((evs) => {
        for (const e of evs) if ((e as Y.YXmlEvent).attributesChanged?.size) set.push(...(e as Y.YXmlEvent).attributesChanged)
      })
      const json = structuredClone(yXmlFragmentToProsemirrorJSON(frag)) as JSONContent
      json.content![0].attrs = { ...json.content![0].attrs, status: 'done', doneAt: NOW }
      prosemirrorJSONToYXmlFragment(schema, keep ? keepYRefs(json, frag) : json, frag)
      return set.sort()
    }
    expect(run(true)).toEqual(['doneAt', 'status'])
    // the negative control: the same write without keepYRefs rewrites the untouched arrays
    expect(run(false)).toEqual(expect.arrayContaining(['people', 'blockedBy']))
  })
})

type Writer = {
  write: (edits: Array<{ itemId: string; patch: Record<string, unknown> }>, opts?: Record<string, unknown>) => { results: Array<{ itemId: string; ok: boolean; refused?: string; pageId?: string }>; unblocked: string[] }
  undoLast: () => void
}
const write = (page: Page, edits: Array<{ itemId: string; patch: Record<string, unknown> }>, opts: Record<string, unknown> = {}) =>
  page.evaluate(({ edits, opts }) => ((window as any).__oneItems as Writer).write(edits, opts), { edits, opts })

/** A task's attrs in the store (first occurrence), or null. */
const storedTask = (page: Page, pageId: string, itemId: string) =>
  wsEval(
    page,
    (s, { pageId, itemId }) => {
      let hit: any = null
      const walk = (n: any) => {
        if (hit) return
        if (n.type === 'workItem' && n.attrs?.itemId === itemId) hit = n.attrs
        for (const c of n.content ?? []) walk(c)
      }
      if (s.pages[pageId]?.content) walk(s.pages[pageId].content)
      return hit
    },
    { pageId, itemId },
  )

test.describe('writeItems (in the app)', () => {
  test('store path: only the changed keys, origin items, unblocked, undo; refusals', async ({ page }) => {
    await openApp(page)
    const plan = await createPage(page, {
      title: 'Launch plan',
      content: doc(item({ id: 'ba', itemId: A, people: ['p_alex'] }, 'Draft copy'), item({ id: 'bb', itemId: B, blockedBy: [A], people: ['p_sam'] }, 'Ship pricing')),
    })
    const before = await storedTask(page, plan, A)
    const r = await write(page, [{ itemId: A, patch: { status: 'done' } }], { by: 'person' })
    expect(r.results[0]).toMatchObject({ ok: true, pageId: plan })
    expect(r.unblocked).toEqual([B])
    await expect(page.getByText('Unblocked: Ship pricing')).toBeVisible()
    const after = await storedTask(page, plan, A)
    expect(after.status).toBe('done')
    expect(typeof after.doneAt).toBe('number')
    expect(after.people).toEqual(before.people)
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, plan)).toBe('items')
    await page.evaluate(() => ((window as any).__oneItems as Writer).undoLast())
    expect((await storedTask(page, plan, A)).status).toBe('todo')

    // loop
    const loop = await write(page, [{ itemId: A, patch: { blockedBy: { add: [B] } } }], { toasts: false })
    expect(loop.results[0].refused).toBe('loop')
    // locked
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), plan)
    expect((await write(page, [{ itemId: A, patch: { status: 'in_progress' } }], { toasts: false })).results[0].refused).toBe('locked')
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: false }), plan)
    // trashed
    await wsEval(page, (s, id) => s.trashPage(id), plan)
    await expect.poll(async () => (await write(page, [{ itemId: A, patch: { status: 'in_progress' } }], { toasts: false })).results[0].refused).toBe('trash')
    await wsEval(page, (s, id) => s.restorePage(id), plan)
    // unknown id
    expect((await write(page, [{ itemId: 'wi_nowhere000', patch: { status: 'done' } }], { toasts: false })).results[0].refused).toBe('gone')

    // a template's tasks: refused without / with a foreign `from`, written for a caller inside the template
    const tpl = await createPage(page, { title: 'Kit', content: doc(item({ itemId: C }, 'Template task')) })
    await wsEval(page, (s, id) => s.updatePage(id, { template: { name: 'Kit' }, hidden: true }), tpl)
    await expect.poll(async () => (await write(page, [{ itemId: C, patch: { status: 'done' } }], { toasts: false })).results[0].refused).toBe('template')
    expect((await write(page, [{ itemId: C, patch: { status: 'done' } }], { toasts: false, from: plan })).results[0].refused).toBe('template')
    expect((await write(page, [{ itemId: C, patch: { status: 'done' } }], { toasts: false, from: tpl })).results[0].ok).toBe(true)
    // a template caller never writes a live task
    expect((await write(page, [{ itemId: A, patch: { status: 'done' } }], { toasts: false, from: tpl })).results[0].refused).toBe('template')
  })

  test('live editor first (one transaction, undo reads the editor); a task the editor no longer holds is refused, never brought back', async ({ page }) => {
    await openApp(page)
    const plan = await createPage(page, { title: 'Launch plan', content: doc(p('Intro'), item({ id: 'ba', itemId: A, people: ['p_alex'] }, 'Draft copy'), item({ id: 'bb', itemId: B }, 'Ship pricing')) })
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), plan)
    const editor = page.locator(`.ProseMirror[data-page-id="${plan}"]`)
    await expect(editor.locator('[data-type="work-item"]')).toHaveCount(2)
    const r = await write(page, [{ itemId: A, patch: { status: 'in_progress', people: { add: ['p_sam'] } } }])
    expect(r.results[0].ok).toBe(true)
    const inEditor = () =>
      page.evaluate(
        ({ plan, A }) => {
          const el = document.querySelector(`.ProseMirror[data-page-id="${plan}"]`) as any
          let attrs: any = null
          el.editor.state.doc.descendants((n: any) => {
            if (!attrs && n.type.name === 'workItem' && n.attrs.itemId === A) attrs = n.attrs
          })
          return attrs && { status: attrs.status, people: attrs.people }
        },
        { plan, A },
      )
    expect(await inEditor()).toEqual({ status: 'in_progress', people: ['p_alex', 'p_sam'] })
    // undo right away: the store has not caught up yet — undo reads the live editor
    await page.evaluate(() => ((window as any).__oneItems as Writer).undoLast())
    expect(await inEditor()).toEqual({ status: 'todo', people: ['p_alex'] })

    // the editor deletes task B; the store still holds it (the editor's save is debounced)
    await page.evaluate(
      ({ plan, B }) => {
        const el = document.querySelector(`.ProseMirror[data-page-id="${plan}"]`) as any
        let at = -1
        let size = 0
        el.editor.state.doc.descendants((n: any, pos: number) => {
          if (at < 0 && n.type.name === 'workItem' && n.attrs.itemId === B) {
            at = pos
            size = n.nodeSize
          }
        })
        el.editor.view.dispatch(el.editor.state.tr.delete(at, at + size))
      },
      { plan, B },
    )
    const gone = await write(page, [{ itemId: B, patch: { status: 'done' } }], { toasts: false })
    expect(gone.results[0].refused).toBe('gone')
    await flush(page)
    expect(await storedTask(page, plan, B)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* B15: task reminders (inbox) — clock-driven                          */
/* ------------------------------------------------------------------ */

type Rem = { key: string; source: string; pageId: string; blockId: string | null; excerpt: string; itemId?: string; people?: string[] }
type InboxData = { items: Array<{ id: string; kind: string; pageId: string; blockId?: string | null }>; rem: Record<string, { seen: number; fired?: number }> }
const inboxData = (page: Page): Promise<InboxData> => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__oneInbox.data())))
/** Task reminders of the ids this test made (the demo seed has one of its own). */
const taskRems = (page: Page, ids: string[]): Promise<Rem[]> =>
  page.evaluate((ids) => JSON.parse(JSON.stringify((window as any).__oneInbox.reminders().filter((r: Rem) => r.itemId && ids.includes(r.itemId)))), ids)

test.describe('task reminders (in the app)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T09:00:00+02:00') })
  })

  test('fires once, named by the task; done → none; template → none; trash → noted; one entry per itemId at the winner', async ({ page, errors }) => {
    const D = 'wi_dup0000000'
    const E = 'wi_trash00000'
    await openApp(page)
    const plan = await createPage(page, {
      title: 'Launch plan',
      content: doc(
        item({ id: 'ba', itemId: A, due: '2026-10-05T10:30', reminder: '-15m', people: ['p_alex'] }, 'Run the checkout'),
        item({ id: 'bb', itemId: B, status: 'done', doneAt: NOW, due: '2026-10-05T10:30', reminder: 'at' }, 'Approve the copy'),
        item({ id: 'bc', itemId: C, due: '2026-10-05T10:30' }, 'No reminder on this one'),
      ),
    })
    // A rings; B is done; C has no reminder
    await expect.poll(() => taskRems(page, [A, B, C]).then((l) => l.map((r) => [r.key, r.source, r.pageId, r.blockId, r.excerpt, r.people]))).toEqual([
      [`w:${A}:2026-10-05T10:30:-15m`, 'item', plan, 'ba', 'Run the checkout', ['p_alex']],
    ])
    await expect.poll(() => inboxData(page).then((d) => Object.keys(d.rem))).toContain(`w:${A}:2026-10-05T10:30:-15m`)

    // two pages, one itemId (a duplicate): one entry, at the winner (earliest page) — its deep link opens that block
    const first = await createPage(page, { title: 'First', content: doc(item({ id: 'd1', itemId: D, due: '2026-10-07', reminder: '-1d' }, 'Book the room')) })
    await page.clock.runFor(5)
    const second = await createPage(page, { title: 'Second', content: doc(p('x'), item({ id: 'd2', itemId: D, due: '2026-10-07', reminder: '-1d' }, 'Book the room'), item({ id: 'd3', itemId: D, due: '2026-10-07', reminder: '-1d' }, 'Book the room')) })
    const winner = await wsEval(page, (s, ids) => {
      const [a, b] = ids.map((id: string) => s.pages[id])
      return a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? a.id : b.id) : a.id < b.id ? a.id : b.id
    }, [first, second])
    await expect.poll(() => taskRems(page, [D]).then((l) => l.map((r) => [r.pageId, r.blockId]))).toEqual([[winner, winner === first ? 'd1' : 'd2']])
    expect(second).not.toBe(first)

    // a template's task never rings
    const tpl = await createPage(page, { title: 'Kit', content: doc(item({ itemId: 'wi_tpl0000000', due: '2026-10-05T10:00', reminder: 'at' }, 'Template task')) })
    await wsEval(page, (s, id) => s.updatePage(id, { template: { name: 'Kit' }, hidden: true }), tpl)
    await expect.poll(() => taskRems(page, ['wi_tpl0000000'])).toEqual([])

    // a page in the trash: seen first, then trashed → noted when its time comes, never fired
    const trashed = await createPage(page, { title: 'Old plan', content: doc(item({ id: 'be', itemId: E, due: '2026-10-05T10:20', reminder: 'at' }, 'Call the printer')) })
    await expect.poll(() => inboxData(page).then((d) => Object.keys(d.rem))).toContain(`w:${E}:2026-10-05T10:20:at`)
    await wsEval(page, (s, id) => s.trashPage(id), trashed)

    // 10:15 → A fires: the toast names the task, the item links its block
    await page.clock.fastForward('01:15:20')
    await expect(page.locator('.toast', { hasText: 'Reminder · Run the checkout — Mon 5 Oct, 10:30' })).toBeVisible()
    await expect.poll(() => inboxData(page).then((d) => d.items.map((i) => [i.id, i.kind, i.pageId, i.blockId]))).toEqual([[`r:w:${A}:2026-10-05T10:30:-15m`, 'reminder', plan, 'ba']])
    // 10:21: the trashed task's time — noted, not fired
    await page.clock.fastForward('00:06:00')
    await expect.poll(() => inboxData(page).then((d) => d.rem[`w:${E}:2026-10-05T10:20:at`]?.fired ?? 0)).toBeGreaterThan(0)
    expect((await inboxData(page)).items.length).toBe(1)

    // done → the reminder is gone (nothing left to fire), and a fired one never fires twice
    await write(page, [{ itemId: A, patch: { status: 'done' } }], { toasts: false })
    await expect.poll(() => taskRems(page, [A])).toEqual([])
    await page.clock.fastForward('02:00:00')
    expect((await inboxData(page)).items.length).toBe(1)

    // the deep link opens the task's block
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await page.locator('#main .ibx-item .ibx-item__open').first().click()
    await expect(page).toHaveURL(new RegExp(`#/p/${plan}\\?b=ba`))
    await flush(page)
    expect(errors.list).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* B16: the agenda and the people section                              */
/* ------------------------------------------------------------------ */

test.describe('agenda + people (in the app)', () => {
  test('agenda: tasks with a due date — title, done faded, overdue, drag-move with Undo, opens at the block', async ({ page, errors }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'))
    await openApp(page)
    const plan = await createPage(page, {
      title: 'Pricing launch',
      content: doc(
        item({ id: 'ba', itemId: A, due: '2026-10-16' }, 'Run the checkout'),
        item({ id: 'bb', itemId: B, status: 'done', doneAt: NOW, due: '2026-10-16T14:30' }, 'Approve the copy'),
        item({ id: 'bc', itemId: C, due: '2026-10-12' }, 'Move the invoice template'),
        item({ id: 'bd', itemId: OUT }, 'No date, not on the agenda'),
      ),
    })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agenda'))
    await expect(page.locator('.ag')).toBeVisible()
    // the source "Tasks" (sources: databases + Tasks); the demo projects hidden for room
    await expect(page.locator('.ag-sources').getByRole('button', { name: /Tasks/ })).toBeVisible()
    const projects = page.locator('.ag-sources').getByRole('button', { name: /Projects/ })
    await projects.click()
    await expect(projects).toHaveAttribute('aria-pressed', 'false')

    // month: the task sits on its day, by its title
    const bar = page.locator('.ag-month .ag-bar', { hasText: 'Run the checkout' })
    await expect(bar).toHaveAttribute('data-start', '2026-10-16')
    await expect(bar).toHaveAttribute('aria-label', /Tasks/)
    await expect(page.locator('.ag-month .ag-bar', { hasText: 'No date' })).toHaveCount(0)

    // drag it to Tue 20: the due date moves (writeItems), Undo puts it back
    const from = (await bar.boundingBox())!
    const to = (await page.locator('.ag-day[data-iso="2026-10-20"]').boundingBox())!
    await page.mouse.move(from.x + 12, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 12, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => (await storedTask(page, plan, A))?.due).toBe('2026-10-20')
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, plan)).toBe('items')
    await page.locator('.toast', { hasText: 'moved to' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await storedTask(page, plan, A))?.due).toBe('2026-10-16')
    // a done task does not move
    await expect(page.locator('.ag-month .ag-bar', { hasText: 'Approve the copy' })).not.toHaveAttribute('data-movable', 'true')

    // list: done faded, the late one in the overdue group
    await page.keyboard.press('l')
    await expect(page.locator('.ag')).toHaveAttribute('data-view', 'list')
    const done = page.locator('.ag-row', { hasText: 'Approve the copy' })
    await expect(done).toHaveAttribute('data-done', 'true')
    await expect(done.locator('.ag-row__excerpt')).toHaveText('Pricing launch')
    const overdue = page.locator('.ag-group[data-overdue]')
    await expect(overdue).toContainText('Move the invoice template')
    await expect(overdue).not.toContainText('Approve the copy')

    // a click opens the page at the task's block
    await page.locator('.ag-row', { hasText: 'Run the checkout' }).click()
    await expect(page).toHaveURL(new RegExp(`#/p/${plan}\\?b=ba`))
    await flush(page)
    expect(errors.list).toEqual([])
  })

  test('people: tasks count as uses; merge rewrites their people (one Undo); someone only assigned cannot be removed', async ({ page }) => {
    await openApp(page)
    const ids = await wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((p) => [p.name, p.id])))
    const grace = await wsEval(page, (s) => s.addPerson('Grace'))
    const plan = await createPage(page, {
      title: 'Pricing launch',
      content: doc(
        item({ id: 'ba', itemId: A, people: [ids.Sam, ids.Alex], blockedBy: [B] }, 'Run the checkout'),
        item({ id: 'bb', itemId: B, people: [ids.Sam] }, 'Approve the copy'),
        item({ id: 'bc', itemId: C, people: [grace] }, 'Book the room'),
      ),
    })
    await flush(page)
    const before = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), plan)
    await page.evaluate(() => (window.location.hash = '#/workspace/people'))
    await expect(page.getByTestId('workspace-page')).toHaveAttribute('data-section', 'people')

    // Grace is assigned only: in use, no Remove
    const g = page.getByTestId('ws-person').filter({ hasText: 'Grace' })
    await expect(g.getByTestId('ws-use')).toHaveText(/1 task/)
    await g.getByRole('button', { name: 'Actions for Grace' }).click()
    await expect(page.getByRole('menuitem', { name: /Remove/ })).toBeDisabled()
    await page.keyboard.press('Escape')
    await g.getByTestId('ws-use').click()
    await expect(page.getByTestId('ws-used-in')).toContainText('Task')
    await expect(page.getByTestId('ws-used-in')).toContainText('Pricing launch')

    // Sam: "… 2 tasks" (+ the seed's own uses); merged into Alex: deduped, the other attrs as they were
    const sam = page.getByTestId('ws-person').filter({ hasText: 'Sam' })
    await expect(sam.getByTestId('ws-use')).toContainText(/\d+ tasks/)
    await sam.getByRole('button', { name: 'Actions for Sam' }).click()
    await page.getByRole('menuitem', { name: 'Merge into' }).click()
    await page.getByRole('menuitem', { name: 'Alex' }).click()
    await sam.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(page.locator('.toasts')).toContainText('Sam merged into Alex')
    await expect.poll(async () => (await storedTask(page, plan, A))?.people).toEqual([ids.Alex])
    expect((await storedTask(page, plan, B))?.people).toEqual([ids.Alex])
    expect((await storedTask(page, plan, A))?.blockedBy).toEqual([B])
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, plan)).toBe('people')

    // one Undo: the person and every task's people back
    await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('ws-person').filter({ hasText: 'Sam' })).toHaveCount(1)
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), plan)).toBe(before)
  })
})

/* ------------------------------------------------------------------ */
/* B17: task titles in Markdown — only inside withItemLabels (export)  */
/* ------------------------------------------------------------------ */

test.describe('Markdown labels (in the app)', () => {
  test('ids everywhere but the export; the export names linked tasks (a private one keeps its id); the trust version ignores a rename elsewhere', async ({ page, errors }, testInfo) => {
    await openApp(page)
    const other = await createPage(page, { title: 'Elsewhere', content: doc(item({ id: 'bo', itemId: A }, 'Draft copy')) })
    const secret = await createPage(page, { title: 'Secret', content: doc(item({ id: 'bs', itemId: C }, 'Hidden plan')) })
    await wsEval(page, (s, id) => s.updatePage(id, { private: true }), secret)
    const plan = await createPage(page, { title: 'Pricing launch', content: doc(item({ id: 'bb', itemId: B, blockedBy: [A], related: [C] }, 'Ship pricing')) })
    const entry = (id: string) => page.evaluate((id) => (window as any).__oneItems.index().byId[id] as { title: string; private: boolean } | undefined, id)
    await expect.poll(async () => (await entry(C))?.private).toBe(true)
    const md = (labels: boolean) => page.evaluate(({ plan, labels }) => (window as any).__oneItems.markdown(plan, labels) as string, { plan, labels })
    const version = () => page.evaluate((id) => (window as any).__oneTrust.version(id) as Promise<string>, plan)

    // plain docToMarkdown (AI reads, sync, coding hashes): ids; the export's scope: titles — never a private one's
    expect(await md(false)).toContain(`Blocked by: [${A}](one:item/${A}) · Related: [${C}](one:item/${C})`)
    expect(await md(true)).toContain(`Blocked by: [Draft copy](one:item/${A}) · Related: [${C}](one:item/${C})`)
    expect(await md(true)).not.toContain('Hidden plan')

    // renaming the linked task on its own page changes neither this page's Markdown nor its coding trust version
    const v0 = await version()
    const plain0 = await md(false)
    await wsEval(
      page,
      (s, id) => {
        const content = JSON.parse(JSON.stringify(s.pages[id].content))
        content.content[0].content[0].content[0].text = 'Draft the final copy'
        s.setContent(id, content, 'e2e')
      },
      other,
    )
    await expect.poll(async () => (await entry(A))?.title).toBe('Draft the final copy')
    expect(await md(false)).toBe(plain0)
    expect(await version()).toBe(v0)
    expect(await md(true)).toContain(`[Draft the final copy](one:item/${A})`)

    // the Markdown export (ZIP) writes the title
    await gotoPage(page, plan)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const out = testInfo.outputPath('plan.zip')
    await (await download).saveAs(out)
    await page.keyboard.press('Escape')
    const zip = unzipSync(new Uint8Array(readFileSync(out)))
    const file = strFromU8(zip[Object.keys(zip).find((n) => n.endsWith('.md'))!]!)
    expect(file).toContain(`> [!TODO] Ship pricing {#${B}}\n> Blocked by: [Draft the final copy](one:item/${A}) · Related: [${C}](one:item/${C})`)
    await flush(page)
    expect(errors.list).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* B6: schema pins — P1 adds no node and no attribute                  */
/* ------------------------------------------------------------------ */

test.describe('schema pins (pure + the live schema)', () => {
  test('generation 1, workItem the only newer node, the Markdown reader off', () => {
    expect(DOC_SCHEMA_VERSION).toBe(1)
    expect(NODE_GENERATIONS).toEqual({ workItem: 1 })
    expect(WORK_ITEMS_FROM_MARKDOWN).toBe(false)
  })

  test('plainText: a task gives its title and notes — never an id, a person id or a date from its attrs', () => {
    const text = plainText(
      doc(
        item({ id: 'blk-1', itemId: A, status: 'done', due: '2031-10-17T09:00', reminder: '-1d', people: ['p_alex01', 'u_member9'], blockedBy: [B], related: [C], doneAt: NOW }, 'Ship the pricing page', p('Notes stay text.')),
      ),
    )
    expect(text).toContain('Ship the pricing page')
    expect(text).toContain('Notes stay text.')
    for (const leak of ['wi_', 'p_alex01', 'u_member9', '2031', 'done', '-1d', 'blk-1', String(NOW)]) expect(text).not.toContain(leak)
  })

  test('the live schema: WorkItem attrs are exactly the P0 list (+ the block id)', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Schema pin', content: doc(p('x')) })
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    const ed = page.locator(`.ProseMirror[data-page-id="${id}"]`)
    await expect(ed).toBeVisible()
    const keys = await ed.evaluate((el) => Object.keys((el as any).editor.schema.nodes.workItem.spec.attrs ?? {}).sort())
    expect(keys).toEqual(['blockedBy', 'doneAt', 'due', 'frozen', 'id', 'itemId', 'people', 'related', 'reminder', 'status'])
    const types = await ed.evaluate((el) => Object.keys((el as any).editor.schema.nodes))
    expect(types.filter((t: string) => /item|task/i.test(t)).sort()).toEqual(['listItem', 'taskItem', 'taskList', 'workItem'].sort())
  })
})

/* ------------------------------------------------------------------ */
/* B13: no AI path removes a task                                      */
/* ------------------------------------------------------------------ */

test.describe('the AI never removes a task (B13)', () => {
  const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  const panel = (page: Page) => page.locator('.ai-panel')

  /** Select from the start of `startText` to the end of `endText` (first occurrences) in the page's editor. */
  async function selectBetween(page: Page, id: string, startText: string, endText: string): Promise<void> {
    await page.evaluate(
      ({ id, startText, endText }) => {
        const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: any }
        const ed = el.editor
        let from = -1
        let to = -1
        ed.state.doc.descendants((n: any, pos: number) => {
          if (!n.isText) return true
          const a = n.text.indexOf(startText)
          if (from < 0 && a >= 0) from = pos + a
          const b = n.text.indexOf(endText)
          if (to < 0 && b >= 0 && (from >= 0 || a >= 0)) to = pos + b + endText.length
          return true
        })
        ed.chain().focus().setTextSelection({ from, to }).run()
      },
      { id, startText, endText },
    )
  }

  async function askImprove(page: Page): Promise<void> {
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(panel(page)).toBeVisible()
    await panel(page).getByRole('option', { name: /Improve writing/ }).click()
    await expect(panel(page).locator('#ai-row-insert')).toBeVisible()
  }

  const ids = async (page: Page, id: string) =>
    page.evaluate((id) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: any }
      const out: Array<{ itemId: string; title: string }> = []
      el.editor.state.doc.descendants((n: any) => {
        if (n.type.name === 'workItem') out.push({ itemId: n.attrs.itemId, title: n.firstChild.textContent })
        return true
      })
      return out
    }, id)

  for (const [name, answer] of [
    ['an answer without the quote', 'A sharper intro.\n\nA sharper closing.'],
    ['an answer with a translated marker', 'A sharper intro.\n\n> [!AUFGABE] Entwurf {#wi_7f3a9c2d01}\n\nA sharper closing.'],
  ] as const) {
    test(`Replace is off over a selection holding a task (${name}); Insert below goes first and takes Enter; the task stays`, async ({ page, context }) => {
      await mockClaude(context, () => answer)
      await openApp(page)
      await setKey(page)
      const id = await createPage(page, { title: 'AI page', content: doc(p('Intro line.'), item({ itemId: A, status: 'in_progress' }, 'Draft copy', p('a note')), p('Closing line.')) })
      await gotoPage(page, id)
      await selectBetween(page, id, 'Intro', 'Closing line.')
      await askImprove(page)
      const rows = panel(page).getByRole('option')
      await expect(rows.first()).toHaveAttribute('id', 'ai-row-insert')
      const replace = panel(page).locator('#ai-row-replace')
      await expect(replace).toHaveAttribute('aria-disabled', 'true')
      await expect(replace).toContainText('Holds a task — insert below instead')
      // Enter takes the first row: Insert below
      await page.keyboard.press('Enter')
      await expect(panel(page)).toHaveCount(0)
      expect(await ids(page, id)).toEqual([{ itemId: A, title: 'Draft copy' }])
      await expect(editorOf(page, id)).toContainText('A sharper closing.')
      await expect(editorOf(page, id).locator('p').first()).toHaveText('Intro line.')
    })
  }

  test('a selection starting inside a title (cutting into the task): Replace off; a few words inside one title stay replaceable', async ({ page, context }) => {
    await mockClaude(context, () => 'Final')
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'AI page', content: doc(item({ itemId: A }, 'Draft copy'), p('Closing line.')) })
    await gotoPage(page, id)
    await selectBetween(page, id, 'copy', 'Closing')
    await askImprove(page)
    await expect(panel(page).locator('#ai-row-replace')).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // inside one title: Replace on, first; the task keeps its id
    await selectBetween(page, id, 'Draft', 'Draft')
    await askImprove(page)
    await expect(panel(page).getByRole('option').first()).toHaveAttribute('id', 'ai-row-replace')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    expect(await ids(page, id)).toEqual([{ itemId: A, title: 'Final copy' }])
  })

  test('"fill" on an empty task title goes after the task; Transform is not offered over a task', async ({ page, context }) => {
    await mockClaude(context, () => 'A line Claude wrote.')
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'AI page', content: doc(p('One line.'), p('Two line.'), item({ itemId: A }, ''), p('After.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('.workitem p').first().click()
    await page.keyboard.press('Alt+Enter')
    await page.locator('[data-popover][role="menu"]').first().locator('#block-ask-ai, [data-id="block-ask-ai"]').or(page.getByRole('menuitem', { name: /^Ask AI/ })).first().click()
    await expect(panel(page)).toBeVisible()
    await panel(page).getByRole('option', { name: /Continue writing/ }).click()
    await expect(panel(page).locator('#ai-row-insert')).toBeVisible()
    await expect(panel(page).locator('#ai-row-insert')).toContainText('Insert below')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    const list = await ids(page, id)
    expect(list).toEqual([{ itemId: A, title: '' }])
    await expect(ed.locator(':scope > p').filter({ hasText: 'A line Claude wrote.' })).toHaveCount(1)
    // Transform: offered over plain lines, not over a range holding the task
    await selectBetween(page, id, 'One', 'Two line.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(panel(page).getByRole('option', { name: /Transform into/ })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await selectBetween(page, id, 'Two', 'After.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.type('transform')
    await expect(panel(page).getByRole('option', { name: /Transform into/ })).toHaveCount(0)
  })

  test('meeting notes "write the notes again" keeps the block\'s task (fields + itemId) after the new notes', async ({ page, context }) => {
    const summary = { title: 'Sync', summary: ['We ship in two steps.'], decisions: [], actionItems: [] }
    await context.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const body = JSON.parse(route.request().postData() ?? '{}')
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(summary) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }) })
    })
    await openApp(page)
    await setKey(page)
    const meeting = {
      type: 'meetingNotes',
      attrs: { title: 'Sync', status: 'done', language: 'en-US', startedAt: 1_790_000_000_000, endedAt: 1_790_000_600_000, duration: 600_000, transcript: [{ t: 0, text: 'Ada: We ship in two steps.' }] },
      content: [p('Old summary line.'), item({ itemId: A, status: 'in_progress', due: '2031-10-17', people: ['p_alex_0001'] }, 'Send the deck to legal')],
    }
    const id = await createPage(page, { title: 'Meeting page', content: doc(meeting) })
    await gotoPage(page, id)
    const deck = page.locator('#main .mtg').first()
    await deck.getByRole('button', { name: 'Meeting notes options' }).click()
    await page.getByRole('menuitem', { name: 'Write the notes again' }).click()
    await page.getByRole('button', { name: 'Replace notes' }).click()
    await expect(editorOf(page, id)).toContainText('We ship in two steps.')
    await expect(editorOf(page, id)).not.toContainText('Old summary line.')
    const list = await ids(page, id)
    expect(list).toEqual([{ itemId: A, title: 'Send the deck to legal' }])
    const attrs = await page.evaluate((id) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: any }
      let a: any = null
      el.editor.state.doc.descendants((n: any) => {
        if (n.type.name === 'workItem') a = n.attrs
        return true
      })
      return a
    }, id)
    expect(attrs).toMatchObject({ status: 'in_progress', due: '2031-10-17', people: ['p_alex_0001'] })
    // after the new notes: the task is the last block of the meeting
    const last = await page.evaluate((id) => {
      const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: any }
      let name = ''
      el.editor.state.doc.descendants((n: any) => {
        if (n.type.name === 'meetingNotes') name = n.lastChild?.type.name ?? ''
        return true
      })
      return name
    }, id)
    expect(last).toBe('workItem')
  })

  test('a browser agent\'s report in "replace" mode keeps the report page\'s task after the report', async ({ page, context }) => {
    await mockClaude(context, () => 'Checked everything. Nothing to change.')
    await openApp(page)
    await setKey(page)
    const report = await createPage(page, { title: 'Agent log', content: doc(p('Old report.'), item({ itemId: A, status: 'todo', due: '2031-10-17' }, 'Follow up with legal')) })
    await wsEval(page, (s) => {
      const now = Date.now()
      s.upsertAgent({ id: 'ag-rep', name: 'Reporter', instructions: 'Look at the workspace and report.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
    })
    await wsEval(page, (s, report) => s.upsertAgent({ ...s.agents['ag-rep'], output: { pageId: report, mode: 'replace' } }), report)
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-rep'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect.poll(() => wsEval(page, (s, id) => (s.pages[id].plain as string) ?? '', report)).toContain('Checked everything')
    const content = await wsEval(page, (s, id) => s.pages[id].content, report)
    const types = (content.content as JSONContent[]).map((n) => n.type)
    expect(types[0]).toBe('heading')
    expect(types[types.length - 1]).toBe('workItem')
    expect(JSON.stringify(content)).not.toContain('Old report.')
    expect(tasksOf(content)).toEqual([expect.objectContaining({ itemId: A, due: '2031-10-17' })])
  })
})
