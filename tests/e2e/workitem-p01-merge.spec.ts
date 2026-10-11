/**
 * Task block (`workItem`), P0.1 — the merge edges the P0 review found in store/generations.ts. Each finding has a test
 * here that failed before its fix (pure, no page):
 *  - HIGH: a container as the older merge's stale unit (the task wrapped into a new callout / columns, dragged into
 *    an existing one) — nothing either tab wrote is lost, nothing doubled, the task kept;
 *  - HIGH: the cloud 'drop' path (y-prosemirror deleted the tasks) never doubles a column or a task: each task goes
 *    back next to its neighbours in the copy as it is;
 *  - MEDIUM: 700 tasks in one container with nothing lost is fast (no quadratic search);
 *  - MEDIUM: `wrote` is bound to the block (an id, or the task it sits in) — a line retyped to another block's text
 *    stays as typed, an emptied line is never a stale version, a cleared line keeps a version;
 *  - MEDIUM: a line the newer tab added inside a task that the older merge dropped is in the page or in a version;
 *  - LOW: the trial path never leaves a stale whole copy beside an id-less task; moves never give one task another
 *    task's block; the shadow copies an earlier generation kept go once this one wrote the page (or it is gone).
 * The randomized harness behind these (thousands of sessions of an older build against this one, both loss paths)
 * is described in the commit that added this file.
 *
 * The review of P0.1 (two independent adversaries, real Yjs merges for the drop path) — each failed before its fix:
 *  - HIGH (drop): a block of a lost task that the older copy holds elsewhere by id (a concurrent move) stays in the
 *    task as it is, both copies kept; a block added inside a container of the task stays; two copies of one task are
 *    told apart by block id; a block id twice in `before` takes nothing out; the output is valid; placement is fast and
 *    finds neighbours whose ids the older editor made up (also inside an id-less container);
 *  - HIGH (unwrap, `wrote`): a version is bound to its block — a part without an id (cell, column, toggle summary) or a
 *    line typed to read like a sibling stays as typed; a container is never a stale version (a line moved out of it
 *    once, a line deleted from it gone with a version kept); a line moved by a line we added keeps our version;
 *  - MEDIUM (unwrap): idempotent (a task we put back is never a stale copy; an empty task's line moved); a task whose
 *    only line moved and was typed into, or whose id-less toggle was wrapped into a new callout, or unwrapped, comes
 *    back; lines moved along with their own task's never join another one; nesting costs linear time and never throws
 *    (very deep pages: ids only); identical lines keep their place;
 *  - LOW: Enter inside a task's last line keeps both halves in the task; a title dragged above a line outside the task
 *    loses nothing (the line joins the task — documented: the diff cannot tell which block moved);
 *  - cost: long changed stretches (every note of 500 tasks rewritten, every callout of 499 typed into) stay under 50 ms;
 *    a page nested deeper than the block-by-block work finds a task without ids by value.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, createPage, flush, waitForApp, wsEval } from './fixtures'
import { asGeneration, blockVersions, restoreNewer, rewrapNewer, type RewrapOptions } from '../../src/app/store/generations'
import { mergeContent } from '../../src/app/store/merge'

/* ---------------------------------------------------------------- builders */
const t = (s: string): JSONContent => ({ type: 'text', text: s })
const P = (s: string, id?: string | null): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), ...(s ? { content: [t(s)] } : {}) })
const W = (itemId: string, id: string | null, ...content: JSONContent[]): JSONContent => ({ type: 'workItem', attrs: { itemId, ...(id ? { id } : {}), status: 'todo' }, content })
const node = (type: string, id: string | null, ...content: JSONContent[]): JSONContent => ({ type, ...(id ? { attrs: { id } } : {}), content })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const col = (...c: JSONContent[]) => node('column', null, ...c)
const cols = (id: string | null, ...c: JSONContent[]) => node('columns', id, ...c)
const callout = (id: string | null, ...c: JSONContent[]) => node('callout', id, ...c)
const quote = (id: string | null, ...c: JSONContent[]) => node('blockquote', id, ...c)
const details = (id: string | null, summary: string, ...c: JSONContent[]): JSONContent => ({
  type: 'details',
  attrs: { heading: 0, ...(id ? { id } : {}) },
  content: [{ type: 'detailsSummary', ...(summary ? { content: [t(summary)] } : {}) }, { type: 'detailsContent', content: c }],
})
const bullet = (id: string | null, ...items: JSONContent[]) => node('bulletList', id, ...items)
const li = (id: string | null, ...c: JSONContent[]) => node('listItem', id, ...c)
const table = (id: string | null, ...rows: JSONContent[]) => node('table', id, ...rows)
const tr = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells })
const td = (...c: JSONContent[]): JSONContent => ({ type: 'tableCell', content: c })
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

/* ---------------------------------------------------------------- the older build (generation 0) */
const OLD_ID_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'codeBlock', 'callout', 'details', 'image', 'table', 'columns', 'horizontalRule', 'blockMath', 'mermaid', 'pageLink', 'databaseBlock', 'bookmark', 'embed', 'toc', 'fileBlock', 'video', 'audio', 'button', 'tabs', 'tab', 'syncedBlock', 'meetingNotes', 'spreadsheet', 'chart', 'breadcrumb'])
let idSeq = 0
/** the older editor's copy: tasks unwrapped, a fresh id for every block without one (or a second copy of one) */
function oldLoad(d: JSONContent): JSONContent {
  const unwrap = (n: JSONContent): JSONContent[] => (n.type === 'workItem' ? (n.content ?? []).flatMap(unwrap) : [n.content ? { ...n, content: n.content.flatMap(unwrap) } : n])
  const seen = new Set<string>()
  const canon = (n: JSONContent): JSONContent => {
    if (n.type === 'text') return { ...n }
    const out: JSONContent = { type: n.type }
    if (n.attrs || OLD_ID_TYPES.has(n.type ?? '')) {
      const attrs: Record<string, unknown> = { ...(n.attrs ?? {}) }
      if (OLD_ID_TYPES.has(n.type ?? '')) {
        if (!attrs.id || seen.has(attrs.id as string)) attrs.id = `m${(++idSeq).toString(36)}`
        seen.add(attrs.id as string)
      }
      out.attrs = attrs
    }
    if (n.content?.length) out.content = n.content.map(canon)
    if (n.marks) out.marks = n.marks
    return out
  }
  return canon(unwrap(d)[0]!)
}
/** the older build's cross-tab save: its base, what another tab stored, its editor's copy */
const oldMerge = (base: JSONContent, theirs: JSONContent, ours: JSONContent) => mergeContent(base, theirs, ours)!
/** what this generation wrote (persistence.ts keeps these entries per page) */
function memory(...docs: JSONContent[]): (entry: string) => boolean {
  const m = new Set<string>()
  for (const d of docs) for (const e of blockVersions(d)) m.add(e)
  return (e) => m.has(e)
}

/* ---------------------------------------------------------------- inspection */
const textOf = (n: JSONContent | null | undefined): string => (n?.text ?? '') + (n?.content ?? []).map(textOf).join('')
function lines(d: JSONContent | null): string[] {
  const out: string[] = []
  const walk = (n: JSONContent) => {
    if (['paragraph', 'heading', 'codeBlock', 'detailsSummary'].includes(n.type ?? '')) return void out.push(textOf(n))
    n.content?.forEach(walk)
  }
  if (d) walk(d)
  return out
}
const count = (d: JSONContent | null, s: string) => lines(d).filter((x) => x === s).length
const has = (d: JSONContent | null, s: string) => lines(d).some((x) => x.includes(s))
interface Task {
  itemId: string
  title: string
  lines: string[]
  nested: boolean
  inTable: boolean
}
function tasks(d: JSONContent | null): Task[] {
  const out: Task[] = []
  const walk = (n: JSONContent, inTask: boolean, inTable: boolean) => {
    if (n.type === 'workItem') out.push({ itemId: n.attrs?.itemId, title: textOf(n.content?.[0]), lines: lines({ type: 'doc', content: n.content }), nested: inTask, inTable })
    n.content?.forEach((c) => walk(c, inTask || n.type === 'workItem', inTable || n.type === 'table'))
  }
  if (d) walk(d, false, false)
  return out
}
const taskOf = (d: JSONContent | null, s: string) => tasks(d).find((x) => x.lines.some((l) => l.includes(s)))?.itemId ?? null
const rewrap = (before: JSONContent, after: JSONContent, opts: RewrapOptions = {}) => rewrapNewer(before, after, 0, opts)
const missedOf = (r: { missed: number; dropped: JSONContent[] }) => r.missed + r.dropped.length
/** no task inside a task or a table, no task twice, idempotent */
function sane(before: JSONContent, r: { doc: JSONContent | null }, opts: RewrapOptions = {}) {
  const ts = tasks(r.doc)
  expect(ts.some((x) => x.nested || x.inTable)).toBe(false)
  const ids = ts.map((x) => x.itemId)
  expect(new Set(ids).size).toBe(ids.length)
  expect(rewrapNewer(before, r.doc, 0, opts).doc).toEqual(r.doc)
}
/** no line (with text) more often than in any of the sources */
function noDoubles(r: { doc: JSONContent | null }, ...sources: JSONContent[]) {
  const most = new Map<string, number>()
  for (const s of sources) {
    const c = new Map<string, number>()
    for (const l of lines(s)) if (l) c.set(l, (c.get(l) ?? 0) + 1)
    for (const [l, n] of c) most.set(l, Math.max(most.get(l) ?? 0, n))
  }
  const c = new Map<string, number>()
  for (const l of lines(r.doc)) if (l) c.set(l, (c.get(l) ?? 0) + 1)
  for (const [l, n] of c) expect(n, `"${l}"`).toBeLessThanOrEqual(Math.max(1, most.get(l) ?? 0))
}
const unwrapped = (d: JSONContent) => asGeneration(d, 0, 'unwrap')!

test.describe('task block (P0.1): a container as the older merge\'s stale copy', () => {
  test('the newer tab wraps the task into a new callout with a new line, the older tab types elsewhere — nothing lost', () => {
    const B0 = doc(P('intro', 'a'), W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')), P('end', 'b'))
    const T = doc(P('intro', 'a'), callout('x', W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')), P('r: written by N', 'r')), P('end', 'b'))
    const O = clone(oldLoad(B0))
    O.content![O.content!.length - 1]!.content![0]!.text = 'end + typed in O'
    const after = oldMerge(B0, T, O)
    for (const opts of [{}, { wrote: memory(B0, T) }]) {
      const r = rewrap(T, after, opts)
      expect(has(r.doc, 'r: written by N')).toBe(true)
      expect(has(r.doc, 'end + typed in O')).toBe(true)
      expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Task title', 'note']])
      expect(r.dropped).toEqual([])
      noDoubles(r, O, unwrapped(T))
      sane(T, r, opts)
    }
  })

  test('the newer tab drags the task beside a block (new columns) or into an existing callout — nothing lost or doubled', () => {
    const B0 = doc(P('intro', 'a'), W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')), P('end', 'b'))
    const T = doc(cols('c', col(P('intro', 'a')), col(W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')))), P('end', 'b'))
    const O = clone(oldLoad(B0))
    O.content![O.content!.length - 1]!.content![0]!.text = 'end + typed in O'
    const r = rewrap(T, oldMerge(B0, T, O), { wrote: memory(B0, T) })
    expect(has(r.doc, 'end + typed in O')).toBe(true)
    expect(count(r.doc, 'intro')).toBe(1)
    expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Task title', 'note']])
    noDoubles(r, O, unwrapped(T))
    sane(T, r, { wrote: memory(B0, T) })
    for (const z of [false, true]) {
      const B1 = doc(W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')), ...(z ? [P('zed', 'z')] : []), callout('d', P('q line', 'q')), P('end', 'b'))
      const T1 = doc(...(z ? [P('zed', 'z')] : []), callout('d', W('wi_1', 'w', P('Task title', 'p1'), P('note', 'p2')), P('q line', 'q')), P('end', 'b'))
      const O1 = clone(oldLoad(B1))
      O1.content![O1.content!.length - 1]!.content![0]!.text = 'end typed'
      const r1 = rewrap(T1, oldMerge(B1, T1, O1), { wrote: memory(B1, T1) })
      expect(count(r1.doc, 'q line'), `z ${z}`).toBe(1)
      expect(has(r1.doc, 'end typed')).toBe(true)
      if (z) expect(count(r1.doc, 'zed')).toBe(1)
      expect(tasks(r1.doc).map((x) => x.lines)).toEqual([['Task title', 'note']])
      noDoubles(r1, O1, unwrapped(T1))
      sane(T1, r1, { wrote: memory(B1, T1) })
    }
  })

  test('without block ids: the task wrapped into a callout — nothing lost, the title once', () => {
    const B0 = doc(P('intro'), W('wi_1', null, P('Task title'), P('note')), P('end'))
    const T = doc(P('intro'), callout(null, W('wi_1', null, P('Task title'), P('note')), P('r: written by N')), P('end'))
    const O = clone(oldLoad(B0))
    O.content![O.content!.length - 1]!.content![0]!.text = 'end + typed in O'
    const r = rewrap(T, oldMerge(B0, T, O), { wrote: memory(B0, T) })
    expect(has(r.doc, 'r: written by N')).toBe(true)
    expect(has(r.doc, 'end + typed in O')).toBe(true)
    expect(count(r.doc, 'Task title')).toBe(1)
    expect(tasks(r.doc).map((x) => x.itemId)).toEqual(['wi_1'])
    sane(T, r, { wrote: memory(B0, T) })
  })

  test('a container both tabs changed, without ids, the older merge stored twice — the newer tab\'s line kept beside', () => {
    // the older merge appends our changed tabs whole after its own; the older tab typed into another line there
    const B0 = doc(W('wi_1', null, P('Task one title')), node('tabs', null, node('tab', null, P('team room'), P('draft slides'), P('page bug')), node('tab', null, P('client plan'))))
    const T = doc(W('wi_1', null, P('Task one title')), node('tabs', null, node('tab', null, P('draft slides'), P('page bug')), node('tab', null, P('client plan +N'))))
    const O = clone(oldLoad(B0))
    O.content![1]!.content![0]!.content![2]!.content![0]!.text = 'page bug +O'
    const after = oldMerge(B0, T, O)
    const r = rewrap(T, after, { wrote: memory(B0, T) })
    expect(has(r.doc, 'client plan +N')).toBe(true)
    expect(has(r.doc, 'page bug +O')).toBe(true)
    expect(count(r.doc, 'draft slides')).toBe(1)
    expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Task one title']])
    sane(T, r, { wrote: memory(B0, T) })
  })
})

test.describe('task block (P0.1): the cloud drop path', () => {
  const drop = (before: JSONContent, after: JSONContent) => restoreNewer(before, after, 0, 'drop')!
  /** each task once, none lost or nested; the copy as it is plus the tasks' lines; idempotent */
  function dropSane(before: JSONContent, after: JSONContent, out: JSONContent) {
    const ids = tasks(out).map((x) => x.itemId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const x of tasks(before)) expect(ids).toContain(x.itemId)
    expect(tasks(out).some((x) => x.nested || x.inTable)).toBe(false)
    const want = new Map<string, number>()
    for (const l of lines(after)) want.set(l, (want.get(l) ?? 0) + 1)
    for (const x of tasks(before)) if (!tasks(after).some((y) => y.itemId === x.itemId)) for (const l of x.lines) want.set(l, (want.get(l) ?? 0) + 1)
    const got = new Map<string, number>()
    for (const l of lines(out)) got.set(l, (got.get(l) ?? 0) + 1)
    expect([...got].sort()).toEqual([...want].sort())
    expect(drop(before, out)).toEqual(out)
  }

  test('the older tab typed in the task\'s column and added a column — no column doubled, the task once', () => {
    const before = doc(cols('k', col(P('left intro', 'p1'), W('wi_1', 'w', P('Task title', 't1'), P('task note', 'n1'))), col(P('right', 'p2'))))
    const after = doc(cols('k', col(P('left intro + typed in old tab', 'p1')), col(P('new column from old tab', 'p3')), col(P('right', 'p2'))))
    const out = drop(before, after)
    dropSane(before, after, out)
    expect(out.content![0]!.content).toHaveLength(3)
    expect(out.content![0]!.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem'])
  })

  test('columns swapped or one deleted — nothing doubled, a deleted column stays deleted', () => {
    const K1 = (...x: JSONContent[]) => node('column', null, P('left', 'p1'), ...x)
    const K2 = node('column', null, P('right', 'p2'))
    const before = doc(cols('k', K1(W('wi_1', 'w', P('Task title', 't1'))), K2))
    const after = doc(cols('k', K2, K1()))
    const out = drop(before, after)
    dropSane(before, after, out)
    expect(out.content![0]!.content![1]!.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem'])
    const before3 = doc(cols('k', K1(W('wi_1', 'w', P('Task title', 't1'))), K2, node('column', null, P('third', 'p3'))))
    const after3 = doc(cols('k', node('column', null, P('left + typed', 'p1')), node('column', null, P('third', 'p3'))))
    const out3 = drop(before3, after3)
    dropSane(before3, after3, out3)
    expect(count(out3, 'right')).toBe(0)
  })

  test('a task a member added later stays where it is; the one the older tab dropped comes back beside it', () => {
    const before = doc(cols('k', col(P('left', 'p1'), W('wi_1', 'w1', P('Seen task', 't1')), W('wi_2', 'w2', P('Added later', 't2'))), col(P('right', 'p2'))))
    const after = doc(cols('k', col(P('left + typed', 'p1'), W('wi_2', 'w2', P('Added later', 't2'))), col(P('new column', 'p3')), col(P('right', 'p2'))))
    const out = drop(before, after)
    dropSane(before, after, out)
    expect(tasks(out).map((x) => x.itemId)).toEqual(['wi_1', 'wi_2'])
  })

  test('the container the older tab deleted: the task comes back where it was — never inside a bare list', () => {
    const before = doc(P('a', 'a'), callout('c', P('x', 'x'), W('wi_1', 'w', P('Task', 't'))), P('b', 'b'))
    const after = doc(P('a', 'a'), P('b typed', 'b'))
    const out = drop(before, after)
    dropSane(before, after, out)
    expect(out.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem', 'paragraph'])
    const b2 = doc(P('a', 'a'), node('bulletList', 'l', node('listItem', 'i', P('item', 'ip'), W('wi_2', 'w2', P('T2', 't2')))), P('b', 'b'))
    const a2 = doc(P('a', 'a'), P('b', 'b'))
    const o2 = drop(b2, a2)
    dropSane(b2, a2, o2)
    expect(o2.content!.map((n) => n.type)).toEqual(['paragraph', 'workItem', 'paragraph'])
  })
})

test.describe('task block (P0.1): cost', () => {
  test('700 tasks in one container, nothing lost: the copy as it is, fast', () => {
    for (const mode of ['columns', 'callout']) {
      const n = 700
      const ts = Array.from({ length: n }, (_, i) => W(`wi_${i}`, `w${i}`, P(`Task ${i} title text`, `t${i}`), P(`note ${i} a`, `a${i}`), P(`note ${i} b`, `b${i}`)))
      const before = doc(P('top', 'top'), ...(mode === 'columns' ? [cols('k', col(...ts.slice(0, n / 2)), col(...ts.slice(n / 2)))] : [callout('c', ...ts)]))
      const after = clone(before)
      after.content!.push(P('appended', 'ap'))
      // (warmed up once; then the least CPU time of five — on a busy machine the clock on the wall mostly waits)
      let r = rewrap(before, after)
      let ms = Infinity
      for (let k = 0; k < 5; k++) {
        const c0 = process.cpuUsage()
        r = rewrap(before, after)
        const c = process.cpuUsage(c0)
        ms = Math.min(ms, (c.user + c.system) / 1000)
      }
      expect(r.doc).toBe(after)
      expect(ms, mode).toBeLessThan(50)
    }
  })
})

test.describe('task block (P0.1): what this build wrote, bound to the block', () => {
  test('the older tab clears a task line — it stays cleared, a version kept', () => {
    const v1 = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('', 'n')))
    const T = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('agenda: budget, hiring', 'n')))
    const wrote = memory(v1, T)
    const O = clone(oldLoad(T))
    delete O.content![2]!.content
    const r = rewrap(T, O, { wrote })
    expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Call Bob', '']])
    expect(has(r.doc, 'agenda')).toBe(false)
    expect(missedOf(r)).toBeGreaterThan(0)
    sane(T, r, { wrote })
  })

  test('both lines cleared (or deleted, one empty line left) — the task stays gone', () => {
    const v1 = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('', 'n')))
    const T = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('agenda: budget, hiring', 'n')))
    const wrote = memory(v1, T)
    const O2 = clone(oldLoad(T))
    delete O2.content![1]!.content
    delete O2.content![2]!.content
    const r2 = rewrap(T, O2, { wrote })
    expect(tasks(r2.doc)).toEqual([])
    expect(r2.dropped.map((n) => n.attrs?.itemId)).toEqual(['wi_1'])
    const r3 = rewrap(T, doc(P('intro', 'a'), P('', 't')), { wrote })
    expect(tasks(r3.doc)).toEqual([])
    expect(r3.dropped.map((n) => n.attrs?.itemId)).toEqual(['wi_1'])
  })

  test('a line retyped to another task\'s line stays as typed', () => {
    const T = doc(W('wi_1', 'w1', P('Call Bob', 't1'), P('follow up', 'n1')), W('wi_2', 'w2', P('Email Ann', 't2'), P('follow up later', 'n2'), P('', 'e2')))
    const wrote = memory(T)
    const O = clone(oldLoad(T))
    O.content![2]!.content![0]!.text = 'Call Bob'
    O.content![3]!.content![0]!.text = 'follow up'
    delete O.content![1]!.content
    const r = rewrap(T, O, { wrote })
    expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Call Bob', ''], ['Call Bob', 'follow up', '']])
  })

  test('the older merge keeps a stale empty line over our text — our text in the page or a version', () => {
    const v1 = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('', 'n')), P('other', 'x'))
    const T = doc(P('intro', 'a'), W('wi_1', 'w', P('Call Bob', 't'), P('agenda: budget, hiring', 'n')), P('other', 'x'))
    const O = clone(oldLoad(v1))
    O.content![3]!.content![0]!.text = 'other typed'
    const r = rewrap(T, oldMerge(v1, T, O), { wrote: memory(v1, T) })
    expect(has(r.doc, 'agenda: budget, hiring') || missedOf(r) > 0).toBe(true)
    expect(has(r.doc, 'other typed')).toBe(true)
  })

  test('both tabs typing in different tasks — our word restored over the older merge\'s stale copy', () => {
    const Rj = doc(P('Top', 'top'), W('wi_r1', 'w1', P('Race task 1', 'r1')), P('Mid', 'mid'), W('wi_r2', 'w2', P('Race task 2', 'r2')), P('Bottom', 'bot'))
    const Rk = clone(Rj)
    Rk.content![3]!.content![0]!.content![0]!.text = 'Race task 2 N1y'
    const ours = clone(oldLoad(Rj))
    ours.content![1]!.content![0]!.text = 'Race task 1 L1x'
    const r = rewrap(Rk, oldMerge(Rj, Rk, ours), { wrote: memory(Rj, Rk) })
    expect(tasks(r.doc).map((x) => x.title)).toEqual(['Race task 1 L1x', 'Race task 2 N1y'])
  })
})

test.describe('task block (P0.1): a line the newer tab added inside a task', () => {
  test('dropped by the older merge — it is in the page or in a version kept', () => {
    const B0 = doc(W('wi_1', 'w', P('Call Bob', 't')), P('other line', 'x'))
    const T = doc(W('wi_1', 'w', P('Call Bob', 't'), P('agenda: budget', 'n2')), P('other line', 'x'))
    const O = clone(oldLoad(B0))
    O.content![1]!.content![0]!.text = 'other line + typed in old tab'
    const r = rewrap(T, oldMerge(B0, T, O), { wrote: memory(B0, T) })
    expect(has(r.doc, 'agenda: budget') || missedOf(r) > 0).toBe(true)
    expect(has(r.doc, 'other line + typed in old tab')).toBe(true)
    const B1 = doc(W('wi_1', 'w', P('Call Bob', 't'), P('note one', 'n1')), P('other line', 'x'))
    const T1 = doc(W('wi_1', 'w', P('Call Bob', 't'), P('agenda: budget', 'n2'), P('note one', 'n1')), P('other line', 'x'))
    const O1 = clone(oldLoad(B1))
    O1.content![2]!.content![0]!.text = 'other typed'
    const r1 = rewrap(T1, oldMerge(B1, T1, O1), { wrote: memory(B1, T1) })
    expect(has(r1.doc, 'agenda: budget') || missedOf(r1) > 0).toBe(true)
  })
})

test.describe('task block (P0.1): the trial path and moves', () => {
  test('an id-less task the newer tab added a line to — not doubled, the line in the task', () => {
    for (const typedInTask of [false, true]) {
      const B0 = doc(W('wi_1', null, P('Call Bob'), P('agenda')), P('end'))
      const T = doc(W('wi_1', null, P('Call Bob'), P('agenda'), P('added here')), P('end'))
      const O = clone(oldLoad(B0))
      O.content![2]!.content![0]!.text = 'end + typed'
      if (typedInTask) O.content![0]!.content![0]!.text = 'Call Bob typed'
      const r = rewrap(T, oldMerge(B0, T, O), { wrote: memory(B0, T) })
      expect(lines(r.doc).filter((l) => l.startsWith('Call Bob')), `typed ${typedInTask}`).toHaveLength(1)
      expect(count(r.doc, 'agenda')).toBe(1)
      expect(tasks(r.doc).map((x) => x.lines)).toEqual([[typedInTask ? 'Call Bob typed' : 'Call Bob', 'agenda', 'added here']])
      expect(has(r.doc, 'end + typed')).toBe(true)
      sane(T, r, { wrote: memory(B0, T) })
    }
  })

  test('moves there never give one task another task\'s untouched block, nor a line typed in its region', () => {
    const before = doc(W('wi_A', 'wa', P('A title', 'a1'), P('A note', 'a2'), P('A last', 'a3')), W('wi_B', 'wb', P('B title', 'b1'), P('B note', 'b2')))
    const after = doc(P('A title', 'a1'), P('A last', 'a3'), P('A note', 'a2'), P('B note', 'b2'), P('B title', 'b1'))
    const r = rewrap(before, after)
    expect(taskOf(r.doc, 'A note')).toBe('wi_A')
    expect(tasks(r.doc).find((x) => x.itemId === 'wi_B')?.title).not.toBe('A note')
    sane(before, r)
    const before7 = doc(W('wi_A', 'wa', P('A title', 'a1'), P('A note', 'a2'), P('A last', 'a3')), W('wi_B', 'wb', P('B title', 'b1'), P('B note', 'b2'), P('B last', 'b3')))
    const after7 = doc(P('A title', 'a1'), P('A last', 'a3'), P('new line', 'o1'), P('A note', 'a2'), P('B note', 'b2'), P('B last', 'b3'), P('B title', 'b1'))
    const r7 = rewrap(before7, after7)
    expect(taskOf(r7.doc, 'new line')).not.toBe('wi_B')
    expect(taskOf(r7.doc, 'A note')).toBe('wi_A')
    expect(tasks(r7.doc).find((x) => x.itemId === 'wi_B')?.title).not.toBe('new line')
    sane(before7, r7)
  })

  test('the same node object in both copies (a merge reuses objects) changes nothing', () => {
    const before = doc(P('intro', 'a'), W('wi_1', 'w', P('Task', 't'), P('note', 'n')), P('end', 'e'))
    const kept = before.content![1]!
    const after = doc(P('intro typed', 'a'), kept, P('end', 'e'), P('new', 'x'))
    const r = rewrap(before, after)
    expect(r.doc).toBe(after)
    const lostOne = doc(P('intro', 'a'), P('Task', 't'), kept.content![1]!, P('end', 'e'))
    const r2 = rewrap(before, lostOne)
    expect(tasks(r2.doc).map((x) => x.lines)).toEqual([['Task', 'note']])
    sane(before, r2)
  })
})

/* ---------------------------------------------------------------- the P0.1 review */
const dropOf = (before: JSONContent, after: JSONContent) => restoreNewer(before, after, 0, 'drop')!
/** every node without recursion (pages nested thousands deep) */
function nodesOf(d: JSONContent | null): JSONContent[] {
  const out: JSONContent[] = []
  const st = d ? [d] : []
  while (st.length) {
    const n = st.pop()!
    out.push(n)
    for (const c of n.content ?? []) st.push(c)
  }
  return out
}
const twiceIds = (d: JSONContent | null) => {
  const ids = nodesOf(d).flatMap((n) => (typeof n.attrs?.id === 'string' ? [n.attrs.id as string] : []))
  return ids.filter((x, i) => ids.indexOf(x) !== i)
}
/** valid content: no container emptied, a task / list item starts with a paragraph */
function valid(d: JSONContent | null) {
  for (const n of nodesOf(d)) {
    if (Array.isArray(n.content) && !n.content.length) expect(['paragraph', 'heading', 'doc'], `empty ${n.type}`).toContain(n.type)
    if (n.type === 'workItem' || n.type === 'listItem') expect(n.content?.[0]?.type).toBe('paragraph')
  }
}
/** the drop path: each task once, none lost, every line of the copy plus the lost tasks' lines, valid, idempotent */
function dropOk(before: JSONContent, after: JSONContent, out: JSONContent) {
  const ids = tasks(out).map((x) => x.itemId)
  expect(new Set(ids).size).toBe(ids.length)
  for (const x of tasks(before)) expect(ids).toContain(x.itemId)
  const want = new Map<string, number>()
  for (const l of lines(after)) want.set(l, (want.get(l) ?? 0) + 1)
  for (const x of tasks(before)) if (!tasks(after).some((y) => y.itemId === x.itemId)) for (const l of x.lines) want.set(l, (want.get(l) ?? 0) + 1)
  const got = new Map<string, number>()
  for (const l of lines(out)) got.set(l, (got.get(l) ?? 0) + 1)
  expect([...got].sort()).toEqual([...want].sort())
  valid(out)
  expect(dropOf(before, out)).toEqual(out)
}
/** the least CPU time of seven runs (warmed up five times — on a busy machine the clock on the wall mostly waits) */
function cpuBest(fn: () => unknown): number {
  for (let k = 0; k < 5; k++) fn()
  let ms = Infinity
  for (let k = 0; k < 7; k++) {
    const c0 = process.cpuUsage()
    fn()
    const c = process.cpuUsage(c0)
    ms = Math.min(ms, (c.user + c.system) / 1000)
  }
  return ms
}

test.describe('task block (P0.1 review): the cloud drop path', () => {
  test('a task line the older tab moved meanwhile (a concurrent move) keeps the newer text in the task — both copies stay', () => {
    const before = doc(W('wi_a', 'w1', P('Buy milk today', 'x')))
    const after = doc(callout('c', P('Buy milk', 'x')))
    const out = dropOf(before, after)
    expect(tasks(out).map((x) => x.lines)).toEqual([['Buy milk today']])
    expect(has(out, 'Buy milk')).toBe(true)
    dropOk(before, after, out)
    const b2 = doc(cols('k', col(W('wi_a', 'w', P('Buy milk today', 'x'))), col(P('Other', 'y'))))
    const a2 = doc(P('Buy milk', 'x'), P('Other', 'y'))
    const o2 = dropOf(b2, a2)
    expect(tasks(o2).map((x) => x.lines)).toEqual([['Buy milk today']])
    dropOk(b2, a2, o2)
  })

  test('a block the newer tab added inside a container of the task that the older copy holds stays', () => {
    const before = doc(W('wi_a', 'w', P('Plan', 't'), bullet('b', li('l1', P('one', 'p1')), li('l2', P('two (new)', 'p2')))))
    const after = doc(callout('c', bullet('b', li('l1', P('one', 'p1')))))
    const out = dropOf(before, after)
    expect(taskOf(out, 'two (new)')).toBe('wi_a')
    dropOk(before, after, out)
  })

  test('neighbours the older editor gave ids are found (also in an id-less callout); 2,000 blocks under 50 ms', () => {
    const before = doc(P('Intro'), W('wi_a', null, P('Call Bob')), P('Agenda'), P('Notes'), P('Outro'))
    const after = doc(P('Intro', 'o1'), P('Agenda', 'o2'), P('Notes', 'o3'), P('Outro', 'o4'))
    const out = dropOf(before, after)
    expect(out.content!.map((c) => (c.type === 'workItem' ? 'TASK' : lines(c)[0]))).toEqual(['Intro', 'TASK', 'Agenda', 'Notes', 'Outro'])
    dropOk(before, after, out)
    const b2 = doc(callout(null, P('Intro'), W('wi_a', null, P('Call Bob')), P('Agenda')), P('Outro'))
    const a2 = doc(callout('c1', P('Intro', 'o1'), P('Agenda', 'o2')), P('Outro', 'o4'))
    const o2 = dropOf(b2, a2)
    expect(o2.content![0]!.content!.map((c) => c.type)).toEqual(['paragraph', 'workItem', 'paragraph'])
    dropOk(b2, a2, o2)
    const n = 2000
    const big = doc(...Array.from({ length: n - 2 }, (_, i) => P(`line ${i}`)), W('wi_b', null, P('task')))
    const bigAfter = doc(...Array.from({ length: n - 2 }, (_, i) => P(`line ${i}`, `o${i}`)))
    expect(cpuBest(() => dropOf(big, bigAfter))).toBeLessThan(50)
  })

  test('two copies of one task, a block id twice, a task with a toggle — told apart, nothing taken out, valid content', () => {
    const before = doc(W('wi_a', 'w1', P('Ship v2 — Ann', 't1')), P('Middle', 'm'), W('wi_a', 'w2', P('Ship v2 — Bob', 't2')))
    const after = doc(P('Middle', 'm'), W('wi_a', 'w2', P('Ship v2 — Bob', 't2')))
    const out = dropOf(before, after)
    expect(tasks(out).map((x) => x.title)).toEqual(['Ship v2 — Ann', 'Ship v2 — Bob'])
    expect(twiceIds(out)).toEqual([])
    const b6 = doc(P('Alpha', 'x'), W('wi_b', 'w2', P('Task title', 't'), P('Beta notes', 'x')))
    const o6 = dropOf(b6, doc(P('Alpha', 'x')))
    expect(tasks(o6).map((x) => x.lines)).toEqual([['Task title', 'Beta notes']])
    const b7 = doc(W('wi_a', 'w', P('Title', 't'), details('d', 'Summary', P('Line', 'x'))))
    const a7 = doc(P('Line', 'x'))
    dropOk(b7, a7, dropOf(b7, a7))
  })

  test('6,000 nested callouts: no throw, the task back', () => {
    let b = W('wi_deep', 'w', P('deep task', 't'))
    let a = P('kept', 'k')
    for (let i = 6000; i > 0; i--) {
      b = callout(`c${i}`, b)
      a = callout(`c${i}`, a)
    }
    expect(nodesOf(dropOf(doc(b), doc(a))).filter((n) => n.type === 'workItem')).toHaveLength(1)
  })
})

test.describe('task block (P0.1 review): the unwrap path', () => {
  test('idempotent: a task put back (its lines carry ids the older editor made) is never taken for a stale copy', () => {
    const before = doc(W('wi_30543', null, P('draft meeting L30544 T')))
    const after = doc(P('draft meeting L30544 T', 'm6978'), P('draft meeting L30546 T', 'm6980'))
    const r = rewrap(before, after)
    expect(has(r.doc, 'L30544') && has(r.doc, 'L30546')).toBe(true)
    sane(before, r)
    const b2 = doc(cols('k97849', col(W('wi_97854', 'w97855', P('meeting send L97857')))))
    const a2 = doc(cols('k97849', col(P('meeting send L97851', 'm22426'), P('meeting send L97857', 'm22428'))))
    const r2 = rewrap(b2, a2)
    expect(has(r2.doc, 'L97857') && has(r2.doc, 'L97851')).toBe(true)
    sane(b2, r2)
    const k3 = doc(W('wi_86', null, P('Call Bob')))
    const o3 = { wrote: memory(k3) }
    const r3 = rewrap(k3, doc(P('Call Bob', 'mw'), P('Call Bob', 'o87')), o3)
    expect(count(r3.doc, 'Call Bob')).toBe(2)
    sane(k3, r3, o3)
    // an empty task whose empty line moved into a new callout
    const b4 = doc(W('wi_1', 'w1', P('')), W('wi_2', 'w2', P('u1', 't2'), P('Notes')), P('Notes for Bob', 'p3'), P('', 'p4'))
    const a4 = doc(callout('o5', P('', 'm1'), P('u1', 't2')), P('Notes', 'm2'), P('', 'p4'), P('Notes for Bob +O', 'p3'))
    sane(b4, rewrap(b4, a4))
  })

  test('a task whose only line moved and was typed into, or whose id-less toggle moved into a new callout / out of one, comes back', () => {
    const before = doc(W('wi_1', null, P('review check T')), W('wi_2', null, P('review hiring T'), P('review legal')))
    const after = doc(P('review legal', 'm1'), P('review check T +O', 'm2'))
    const r = rewrap(before, after)
    expect(taskOf(r.doc, 'review check T +O')).toBe('wi_1')
    sane(before, r)
    const b2 = doc(P('Above'), details(null, 'Sum', W('wi_3', null, P('Task'), P('note'))))
    const a2 = doc(callout('c', P('Above', 'm1'), details('m2', 'Sum', P('Task', 'm3'), P('note', 'm4'))))
    const r2 = rewrap(b2, a2)
    expect(tasks(r2.doc).map((x) => x.lines)).toEqual([['Task', 'note']])
    expect(r2.dropped).toEqual([])
    sane(b2, r2)
    const b3 = doc(P('one'), details(null, 'S', W('wi_4', null, P('call pricing'), P('send send'))), P('two'))
    const a3 = doc(P('one', 'm1'), P('call pricing', 'm2'), P('send send', 'm3'), P('two', 'm4'))
    const r3 = rewrap(b3, a3)
    expect(tasks(r3.doc).map((x) => x.lines)).toEqual([['call pricing', 'send send']])
    sane(b3, r3)
  })

  test('identical lines keep their place: typing into the 1st and 3rd of three keeps the 2nd as it was', () => {
    const k1 = doc(P('TODO'), P('TODO'), W('wi_1', null, P('TODO')))
    const r1 = rewrap(k1, doc(P('TODO x', 'm1'), P('TODO', 'm2'), P('TODO done', 'm3')), { wrote: memory(k1) })
    expect(r1.dropped).toEqual([])
    expect(taskOf(r1.doc, 'TODO done')).toBe('wi_1')
    const k2 = doc(P('Call'), W('wi_1', null, P('Call'), P('Call')))
    const r2 = rewrap(k2, doc(P('Call Ann', 'm4'), P('Call', 'm5'), P('Call Bob', 'm6')), { wrote: memory(k2) })
    expect(taskOf(r2.doc, 'Call Ann')).toBe(null)
    expect(taskOf(r2.doc, 'Call Bob')).toBe('wi_1')
  })

  test('Enter inside the task\'s last line keeps both halves in the task; a title dragged above a line outside loses nothing', () => {
    const before = doc(W('wi_a', 'w', P('Title', 't'), P('bob pricing', 'n')), P('After', 'x'))
    const r = rewrap(before, doc(P('Title', 't'), P('bob prici', 'n'), P('ng', 's1'), P('After', 'x')))
    expect(tasks(r.doc).map((x) => x.lines)).toEqual([['Title', 'bob prici', 'ng']])
    sane(before, r)
    // (documented: the diff cannot tell which block moved — the line between the task's blocks joins the task)
    const b2 = doc(P('Unrelated X', 'x'), W('wi_a', 'w', P('Task title', 't'), P('note', 'n')))
    const r2 = rewrap(b2, doc(P('Task title', 't'), P('Unrelated X', 'x'), P('note', 'n')))
    expect(lines(r2.doc)).toEqual(['Task title', 'Unrelated X', 'note'])
    expect(tasks(r2.doc).map((x) => x.itemId)).toEqual(['wi_a'])
    sane(b2, r2)
  })

  test('a callout unwrapped there while a note of another task moved up: each task keeps its own lines', () => {
    const before = doc(callout('c1', W('wi_1', null, P('team T'), P('slides plan', 'p1'), P('draft review', 'p2')), W('wi_2', null, P('meeting T', 't2'), P('pricing', 'p3'))), W('wi_3', null, P('send draft T'), P('hiring the'), P('plan meeting', 'p4')), P('review', 'p5'))
    const after = doc(P('team T', 'm1'), P('hiring the', 'm2'), P('slides plan', 'p1'), P('draft review', 'p2'), P('meeting T', 't2'), P('pricing', 'p3'), P('send draft T', 'm3'), P('plan meeting', 'p4'), P('review', 'p5'))
    const r = rewrap(before, after)
    expect([taskOf(r.doc, 'slides plan'), taskOf(r.doc, 'pricing'), taskOf(r.doc, 'plan meeting')]).toEqual(['wi_1', 'wi_2', 'wi_3'])
    sane(before, r)
  })

  test('nesting: 1,000 callouts and a callout of 2,000 lines under 50 ms; 3,000 quotes without ids never throw', () => {
    let b = W('wi_deep', 'w', P('deep task', 't'))
    let a = P('deep task', 't')
    for (let i = 1000; i > 0; i--) {
      b = callout(`c${i}`, b)
      a = callout(`c${i}`, a)
    }
    expect(cpuBest(() => rewrap(doc(b), doc(a)))).toBeLessThan(50)
    expect(rewrap(doc(b), doc(a)).dropped).toEqual([])
    const big = doc(callout('c', ...Array.from({ length: 1996 }, (_, i) => P(`line ${i} of a long page`, `p${i}`)), W('wi_x', 'w', P('the task', 't'))))
    expect(cpuBest(() => rewrap(big, unwrapped(big)))).toBeLessThan(50)
    let n = W('wi_1', null, P('task'))
    for (let i = 0; i < 3000; i++) n = quote(null, n)
    const known = doc(n)
    const r = rewrap(known, unwrapped(known))
    expect(nodesOf(r.doc).filter((x) => x.type === 'workItem').length + r.dropped.length).toBe(1)
  })
})

test.describe('task block (P0.1 review): long changed stretches and deep pages', () => {
  test('500 id-less tasks with every note rewritten, 499 callouts with every note typed: under 50 ms, no task lost', () => {
    const e3 = doc(...Array.from({ length: 500 }, (_, i) => W(`wi_${i}`, null, P(`Task ${i}`), P(`alpha ${i}`), P(`beta ${i}`))))
    const a3 = clone(oldLoad(e3))
    for (let i = 0; i < a3.content!.length; i++) if (i % 3) a3.content![i]!.content![0]!.text = `zz ${i} other`
    const o3 = { wrote: memory(e3) }
    expect(cpuBest(() => rewrap(e3, a3, o3))).toBeLessThan(50)
    expect(rewrap(e3, a3, o3).dropped).toEqual([])
    const e4 = doc(P('top'), ...Array.from({ length: 499 }, (_, i) => callout(null, W(`wi_${i}`, null, P(`Task ${i} title`), P(`note ${i}`)))), P('end'))
    const a4 = clone(oldLoad(e4))
    for (let i = 1; i <= 499; i++) a4.content![i]!.content![1]!.content![0]!.text += ' typed'
    const o4 = { wrote: memory(e4) }
    expect(cpuBest(() => rewrap(e4, a4, o4))).toBeLessThan(50)
    const r4 = rewrap(e4, a4, o4)
    expect(tasks(r4.doc)).toHaveLength(499)
    expect(taskOf(r4.doc, 'note 7 typed')).toBe('wi_7')
  })

  test('a page nested deeper than the block-by-block work, without ids: the task found by value', () => {
    let b = W('wi_deep', null, P('deep task'), P('deep note'))
    for (let i = 200; i > 0; i--) b = callout(null, P(`line ${i}`), b)
    const before = doc(b)
    const after = clone(unwrapped(before))
    let m = after.content![0]!
    while (m.content!.at(-1)?.type === 'callout') m = m.content!.at(-1)!
    m.content![1]!.content![0]!.text += ' typed'
    const r = rewrap(before, after)
    expect(nodesOf(r.doc).filter((n) => n.type === 'workItem')).toHaveLength(1)
    expect(r.dropped).toEqual([])
  })
})

test.describe('task block (P0.1 review): what this build wrote, bound to the block', () => {
  test('a cell, a column, a toggle summary or a line typed to read like a sibling stays as typed', () => {
    const k1 = doc(W('wi_1', 'w1', P('Release 2.3', 't1'), table('tb1', tr(td(P('Docs', 'a1')), td(P('Done', 'a2'))), tr(td(P('Tests', 'b1')), td(P('Open', 'b2'))))))
    const s1 = doc(P('Release 2.3', 't1'), table('tb1', tr(td(P('Docs', 'a1')), td(P('Done', 'a2'))), tr(td(P('Tests', 'b1')), td(P('Done', 'b2')))))
    expect(count(rewrap(k1, s1, { wrote: memory(k1) }).doc, 'Done')).toBe(2)
    const k2 = doc(W('wi_1', 'w1', P('Decide', 't1'), cols('k1', col(P('Pros', 'c1')), col(P('', 'c2')))))
    const s2 = clone(oldLoad(k2))
    s2.content![1]!.content![1]!.content![0]!.content = [t('Pros')]
    expect(count(rewrap(k2, s2, { wrote: memory(k2) }).doc, 'Pros')).toBe(2)
    const k3 = doc(W('wi_1', 'w1', P('Spec', 't1'), details('d1', 'Details', P('one', 'x1')), details('d2', '', P('one', 'x2'))))
    const s3 = clone(oldLoad(k3))
    s3.content![2]!.content![0]!.content = [t('Details')]
    expect(count(rewrap(k3, s3, { wrote: memory(k3) }).doc, 'Details')).toBe(2)
    const k4 = doc(W('wi_1', null, P('Call Bob'), P('Call')))
    const r4 = rewrap(k4, doc(P('Call Bob', 'm1'), P('Call Bob', 'm2')), { wrote: memory(k4) })
    expect(tasks(r4.doc).map((x) => x.lines)).toEqual([['Call Bob', 'Call Bob']])
    const k5 = doc(W('wi_2', null, P(''), P('b')))
    expect(count(rewrap(k5, doc(P('b', 'm3'), P('b', 'm4')), { wrote: memory(k5) }).doc, 'b')).toBe(2)
  })

  test('a container back as a version we stored: a line moved out of it once, a line deleted from it gone (a version kept)', () => {
    const B0 = doc(W('wi_1', 'w1', P('Groceries', 't1'), bullet('b1', li('l1', P('milk', 'x1')))))
    const T = doc(W('wi_1', 'w1', P('Groceries', 't1'), bullet('b1', li('l1', P('milk', 'x1'), P('eggs', 'n1')))))
    const r = rewrap(T, doc(P('Groceries', 't1'), bullet('b1', li('l1', P('milk', 'x1'))), P('eggs', 'n1')), { wrote: memory(B0, T) })
    expect(count(r.doc, 'eggs')).toBe(1)
    expect(twiceIds(r.doc)).toEqual([])
    const C0 = doc(W('wi_1', 'w1', P('Groceries', 't1'), callout('c1', P('milk', 'x1'))))
    const CT = doc(W('wi_1', 'w1', P('Groceries', 't1'), callout('c1', P('milk', 'x1'), P('eggs', 'n1'))))
    const r2 = rewrap(CT, doc(P('Groceries', 't1'), callout('c1', P('milk', 'x1'))), { wrote: memory(C0, CT) })
    expect(count(r2.doc, 'eggs')).toBe(0)
    expect(missedOf(r2)).toBeGreaterThan(0)
  })

  test('a line of ours moved down by a line we added keeps our version over the older merge\'s stale copy', () => {
    const B0 = doc(W('wi_1', null, P('Title'), P('call meeting'), P('plan email')), W('wi_2', null, P('other')))
    const T = doc(W('wi_1', null, P('Title'), P('NEW line'), P('call meeting'), P('plan email +N')), W('wi_2', null, P('other')))
    const O = clone(oldLoad(B0))
    O.content!.push(P('typed in the older tab', 'o1'))
    const r = rewrap(T, oldMerge(B0, T, O), { wrote: memory(B0, T) })
    expect(has(r.doc, 'plan email +N') || missedOf(r) > 0).toBe(true)
    expect(has(r.doc, 'typed in the older tab')).toBe(true)
  })
})

/** A record of the local workspace (idb-keyval's keyval-store): read, write (undefined deletes). */
function idb(page: Page, key: string, value?: unknown, write = false): Promise<unknown> {
  return page.evaluate(
    async ({ key, value, write }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('keyval-store')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        return await new Promise<unknown>((res, rej) => {
          const tx = db.transaction('keyval', write ? 'readwrite' : 'readonly')
          const os = tx.objectStore('keyval')
          if (!write) {
            const q = os.get(key)
            q.onsuccess = () => res(q.result)
            q.onerror = () => rej(q.error)
            return
          }
          if (value === undefined) os.delete(key)
          else os.put(value, key)
          tx.oncomplete = () => res(undefined)
          tx.onerror = () => rej(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { key, value, write },
  )
}

test.describe('task block (P0.1): shadow copies an earlier generation kept', () => {
  test('go at the start once this generation wrote the page (or it is gone); one an earlier build wrote last stays', async ({ page }) => {
    await openApp(page)
    const mine = await createPage(page, { title: 'Written here', content: doc(P('text here')) })
    const older = await createPage(page, { title: 'Written by an older build', content: doc(P('older text')) })
    await flush(page)
    // an older build stored `older` last: its record carries no stamp of this generation
    const rec = (await idb(page, `one.page.v2:${older}`)) as Record<string, unknown>
    const { _schema: _, ...unstamped } = rec
    await idb(page, `one.page.v2:${older}`, unstamped, true)
    for (const id of [mine, older, 'page-deleted-for-good']) await idb(page, `one.page.g0:${id}`, { content: doc(P('an earlier copy')) }, true)
    await page.reload()
    await waitForApp(page)
    await expect.poll(() => idb(page, `one.page.g0:${mine}`)).toBeUndefined()
    expect(await idb(page, 'one.page.g0:page-deleted-for-good')).toBeUndefined()
    expect(await idb(page, `one.page.g0:${older}`)).toBeDefined()
    // this generation writes it again: gone with the next start
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'typed now' }] }] }, 'test'), older)
    await flush(page)
    await page.reload()
    await waitForApp(page)
    await expect.poll(() => idb(page, `one.page.g0:${older}`)).toBeUndefined()
  })
})
