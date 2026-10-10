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
 *    task's block.
 * The randomized harness behind these (thousands of sessions of an older build against this one, both loss paths)
 * is described in the commit that added this file.
 */
import type { JSONContent } from '@tiptap/core'
import { test, expect } from './fixtures'
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
