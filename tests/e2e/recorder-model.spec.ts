/**
 * Flight recorder — the pure parts, run in Node by the Playwright runner (no browser): the writer
 * context (store/writer.ts: frames, keys, run notes, fallback reports) and the journal's model
 * (features/recorder/model: writer-key grammar, lanes, segmentation and run keys, page classification,
 * schema deltas, canonical parts, touched parts, counts). The model folder may import nothing that
 * reaches the store, the DOM or IndexedDB — a guard reads its import lines. Test data is fictional.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { SYSTEM, currentWriter, endRun, fallbackReports, clearFallbackReports, formatWriterKey, noteRun, onRunNote, reportFallback, withWriter, type RunNote, type Writer } from '../../src/app/store/writer'
import { causeChain, clientSlug, foldsTyping, laneOf, parseWriterKey, runKeyOf, runKindOf, runRefOf, segKeyOf } from '../../src/app/features/recorder/model/writerKeys'
import { classifyPage, placeKey, placeKindOf, parsePlace } from '../../src/app/features/recorder/model/places'
import { databaseChangesDetail } from '../../src/app/features/recorder/model/schema'
import { blockList, pageParts, partsKey, rowParts, schemaParts, viewPart, wholeCanon, type CanonDeps } from '../../src/app/features/recorder/model/canon'
import { touchedParts } from '../../src/app/features/recorder/model/touched'
import { contentDelta, countOps, countPlaces, countWords, windowMeters, wordDelta } from '../../src/app/features/recorder/model/counts'
import { barHeights, followSpan, fracOf, loupeK, loupeLabel, makeAxis, pct, phoneFit, quarterHot, rulerLabels, rulerTicks, runBracket, snapTime, spanAround, stripBars, stripRange, stripTicks, tAtX, tOfU, uOf, xOf } from '../../src/app/features/recorder/model/axis'
import { settleHead, settleLabels, underHeads } from '../../src/app/features/recorder/model/labels'
import { F, K, type JEvent, type JOp, type JSegment } from '../../src/app/features/recorder/model/types'
import type { Database, Page, PropertyDef, View } from '../../src/app/store/types'

/* ------------------------------------------------------------------ */
/* stub deps (the browser spec covers the real helpers)                */
/* ------------------------------------------------------------------ */

const strip = (n: unknown): unknown => {
  if (Array.isArray(n)) return n.map(strip)
  if (n && typeof n === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(n).sort()) {
      if (k === 'id') continue
      const v = strip((n as Record<string, unknown>)[k])
      // like the real blockKey: attributes that say nothing are left out
      if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue
      o[k] = v
    }
    return o
  }
  return n
}
const deps: CanonDeps = {
  contentKey: (c) => JSON.stringify(strip(c ?? null)),
  blockKey: (b) => JSON.stringify(strip(b)),
  valueKey: (v, type) => {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) return ''
    if (Array.isArray(v) && (type === 'multi_select' || type === 'relation' || type === 'person')) return JSON.stringify([...v].sort())
    return JSON.stringify(v)
  },
  iconKey: (i) => (i ? JSON.stringify(i) : ''),
}

const para = (text: string, id?: string): JSONContent => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: text ? [{ type: 'text', text }] : [] })
const docOf = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks })

function page(over: Partial<Page> = {}): Page {
  return {
    id: 'nl1398',
    kind: 'page',
    title: 'Nordlicht Handoff',
    icon: null,
    cover: null,
    parentId: null,
    databaseId: null,
    properties: {},
    content: null,
    contentRev: 0,
    contentOrigin: null,
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    order: 1,
    settings: { fullWidth: false, smallText: false, font: 'sans', locked: false },
    ...over,
  }
}

const statusProp: PropertyDef = {
  id: 'stage',
  name: 'Stage',
  type: 'select',
  options: [
    { id: 'o-backlog', name: 'Backlog', color: 'gray' },
    { id: 'o-ready', name: 'Ready', color: 'blue' },
    { id: 'o-done', name: 'Erledigt', color: 'green' },
  ],
}
const view = (over: Partial<View> = {}): View => ({ id: 'v-board', name: 'Tessera-Ansicht', type: 'board', filter: null, sorts: [], visibleProperties: ['stage'], groupBy: 'stage', ...over })
function database(over: Partial<Database> = {}): Database {
  return {
    id: 'db-nordlicht',
    properties: [{ id: 'title', name: 'Name', type: 'title' }, statusProp, { id: 'est', name: 'Schätzung', type: 'number' }, { id: 'f', name: 'Score', type: 'formula', formula: '1' }],
    views: [view()],
    nextUniqueId: 1,
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* store/writer.ts                                                     */
/* ------------------------------------------------------------------ */

test.describe('writer context', () => {
  test('frames: innermost wins, popped after a throw, nothing open outside', () => {
    expect(currentWriter()).toBeNull()
    const seen: Array<string | null> = []
    withWriter({ kind: 'agent', id: 'mirror', run: 'r212' }, () => {
      seen.push(formatWriterKey(currentWriter()!))
      withWriter({ kind: 'editor', id: 'ed1' }, () => seen.push(formatWriterKey(currentWriter()!)))
      seen.push(formatWriterKey(currentWriter()!))
    })
    seen.push(currentWriter() ? 'open' : null)
    expect(seen).toEqual(['agent:mirror:r212', 'editor:ed1', 'agent:mirror:r212', null])
    expect(() =>
      withWriter({ kind: 'you' }, () => {
        withWriter(SYSTEM('stamp'), () => {
          throw new Error('boom')
        })
      }),
    ).toThrow('boom')
    expect(currentWriter()).toBeNull()
    expect(withWriter({ kind: 'you' }, () => 42)).toBe(42)
  })

  test('a thenable result throws (async code opens a frame per burst)', () => {
    expect(() => withWriter({ kind: 'you' }, () => Promise.resolve(1))).toThrow(/synchronous/)
    expect(() => withWriter({ kind: 'you' }, (async () => 1) as () => unknown)).toThrow(/synchronous/)
    expect(currentWriter()).toBeNull()
  })

  test('keys for every writer kind follow the grammar', () => {
    const cases: Array<[Writer, string]> = [
      [{ kind: 'you' }, 'you'],
      [{ kind: 'you', via: 'button' }, 'you~button'],
      [{ kind: 'you', via: 'undo', ref: 'batch_7' }, 'you~undo:batch_7'],
      [{ kind: 'editor', id: 'e-41' }, 'editor:e-41'],
      [{ kind: 'editor', id: 'collab', mixed: true }, 'editor:collab+m'],
      [{ kind: 'terminal', run: 'b1' }, 'terminal:b1'],
      [{ kind: 'terminal', run: 'b1', change: 'c3' }, 'terminal:b1#c3'],
      [{ kind: 'ai', run: 'air1', action: 'transform' }, 'ai:air1:transform'],
      [{ kind: 'agent', id: 'nordlicht', run: 'r212' }, 'agent:nordlicht:r212'],
      [{ kind: 'agent', id: 'nordlicht', run: 'r212', change: 'ch9', remote: true }, 'agent:nordlicht:r212#ch9@r'],
      [{ kind: 'mcp', session: 's1', call: 'c2', tool: 'one_update_row' }, 'mcp:s1:c2:one_update_row'],
      [{ kind: 'script', id: 'tagesplan', run: 'sr1' }, 'script:tagesplan:sr1'],
      [{ kind: 'script', id: null, run: 'sr1', via: 'you~button' }, 'script:-:sr1<you~button'],
      [{ kind: 'sync', source: 'folder', run: 'pk1' }, 'sync:folder:pk1'],
      [{ kind: 'sync', source: 'github', run: 'pk2' }, 'sync:github:pk2'],
      [{ kind: 'automation', db: 'db1', id: 'au1', run: 'ar1', cause: 'you' }, 'automation:db1/au1:ar1<you'],
      [{ kind: 'autofill', db: 'db1', prop: 'p1' }, 'autofill:db1/p1'],
      [{ kind: 'autofill', db: 'db1', prop: 'p1', run: 'f1', cause: 'editor:e1' }, 'autofill:db1/p1:f1<editor:e1'],
      [{ kind: 'import', run: 'im1', source: 'md' }, 'import:im1:md'],
      [{ kind: 'template', id: 'tp1', run: 'tr1', repeat: true }, 'template:tp1:tr1'],
      [{ kind: 'synced', cause: 'agent:nordlicht:r212' }, 'synced<agent:nordlicht:r212'],
      [{ kind: 'history', snap: 'snap1' }, 'history:snap1'],
      [{ kind: 'mail', run: 'm1' }, 'mail:m1'],
      [{ kind: 'coding', task: 't1', run: 'cr1' }, 'coding:t1:cr1'],
      [{ kind: 'kit', type: 'ty1', cause: 'you' }, 'kit:ty1<you'],
      [{ kind: 'member', account: 'acc-mara' }, 'member:acc-mara'],
      [{ kind: 'api', token: 'tk1' }, 'api:tk1'],
      [{ kind: 'hook', id: 'h1' }, 'hook:h1'],
      [{ kind: 'team' }, 'team'],
      [{ kind: 'remote', per: {}, fallback: 'member:acc-mara' }, 'member:acc-mara'],
      [{ kind: 'eject', id: 'ej1', of: 'agent:nordlicht:r212' }, 'eject:ej1>agent:nordlicht:r212'],
      [{ kind: 'rewind', id: 'rw1' }, 'rewind:rw1'],
      [SYSTEM('stamp'), 'system:stamp'],
      [{ kind: 'unknown' }, 'unknown'],
    ]
    for (const [w, key] of cases) expect(formatWriterKey(w), w.kind).toBe(key)
  })

  test('invalid ids become "-", causes stay at most two deep, keys at most 200 chars', () => {
    expect(formatWriterKey({ kind: 'agent', id: 'has space', run: 'ok' })).toBe('agent:-:ok')
    expect(formatWriterKey({ kind: 'agent', id: 'x'.repeat(65), run: 'ok' })).toBe('agent:-:ok')
    expect(formatWriterKey({ kind: 'mcp', session: 's', call: 'c', tool: 'Update-Row' })).toBe('mcp:s:c:-')
    expect(formatWriterKey({ kind: 'ai', run: 'r', action: 'meeting-transcript' })).toBe('ai:r:-')
    expect(formatWriterKey({ kind: 'import', run: 'r', source: 'csv' })).toBe('import:r:csv')
    expect(formatWriterKey({ kind: 'you', via: 'Bad' as never })).toBe('you~ui')
    expect(formatWriterKey({ kind: 'system', why: 'nope' as never })).toBe('system:maintenance')
    // depth: the own part + 2 causes
    const deep = formatWriterKey({ kind: 'kit', type: 'k', cause: 'automation:d/a:r<script:s:r2<you~button' })
    expect(deep).toBe('kit:k<automation:d/a:r<script:s:r2')
    expect(deep.split('<')).toHaveLength(3)
    expect(formatWriterKey({ kind: 'synced', cause: 'a<b<c<d' }).split('<')).toHaveLength(3)
    // characters outside the key alphabet never pass
    expect(formatWriterKey({ kind: 'kit', type: 'k', cause: 'you "quoted"' })).toBe('kit:k<you--quoted-')
    const long = formatWriterKey({ kind: 'kit', type: 'k', cause: `agent:${'a'.repeat(64)}:${'b'.repeat(64)}<agent:${'c'.repeat(64)}:${'d'.repeat(64)}` })
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long.startsWith('kit:k<agent:')).toBe(true)
  })

  test('run notes reach listeners; fallbacks are kept for the seam', () => {
    const got: RunNote[] = []
    const off = onRunNote((e) => got.push(e))
    const w: Writer = { kind: 'agent', id: 'nordlicht', run: 'r212' }
    noteRun(w, { seq: 212 })
    endRun(w)
    off()
    noteRun(w)
    expect(got).toEqual([{ w, meta: { seq: 212 } }, { w, end: true }])
    clearFallbackReports()
    reportFallback('unknown', ['p:a', 'p:b'], 'Error\n    at write (x.ts:1:1)')
    expect(fallbackReports()).toHaveLength(1)
    expect(fallbackReports()[0]).toMatchObject({ step: 'unknown', places: ['p:a', 'p:b'] })
    clearFallbackReports()
  })
})

/* ------------------------------------------------------------------ */
/* model/writerKeys.ts                                                 */
/* ------------------------------------------------------------------ */

test.describe('writer keys → lanes, segments, runs', () => {
  test('parse round-trips the parts', () => {
    expect(parseWriterKey('agent:nordlicht:r212#ch9@r')).toMatchObject({ kind: 'agent', parts: ['nordlicht', 'r212'], change: 'ch9', remote: true })
    expect(parseWriterKey('automation:db1/au1:ar1<you')).toMatchObject({ kind: 'automation', parts: ['db1', 'au1', 'ar1'], cause: 'you' })
    expect(parseWriterKey('you~undo:batch_7')).toMatchObject({ kind: 'you', via: 'undo', ref: 'batch_7' })
    expect(parseWriterKey('synced<agent:a:r')).toMatchObject({ kind: 'synced', cause: 'agent:a:r' })
    expect(parseWriterKey('eject:ej1>agent:a:r')).toMatchObject({ kind: 'eject', parts: ['ej1'], of: 'agent:a:r' })
    expect(parseWriterKey('editor:collab+m')).toMatchObject({ kind: 'editor', parts: ['collab'], mixed: true })
    expect(parseWriterKey('bogus:x').kind).toBe('unknown')
    expect(causeChain('kit:k<automation:d/a:r<you')).toEqual(['kit:k', 'automation:d/a:r', 'you'])
  })

  test('lanes', () => {
    const clientOf = (s: string) => (s === 's1' ? 'Tessera Desk' : null)
    const cases: Array<[string, string]> = [
      ['you', 'you'],
      ['you~button', 'you'],
      ['editor:e1', 'you'],
      ['editor:collab+m', 'you'],
      ['you~undo:b1', 'undo'],
      ['history:s1', 'undo'],
      ['eject:e1>agent:a:r', 'undo'],
      ['rewind:r1', 'undo'],
      ['terminal:b1#c1', 'terminal'],
      ['ai:r1:transform', 'ai'],
      ['agent:nordlicht:r212#c1', 'agent:nordlicht'],
      ['mcp:s1:c1:one_update_row', 'mcp:tessera-desk'],
      ['mcp:s9:c1:one_update_row', 'mcp:-'],
      ['script:tagesplan:sr1<you~button', 'script:tagesplan'],
      ['script:-:sr1', 'script:-'],
      ['sync:folder:p1', 'sync:folder'],
      ['sync:github:p1', 'sync:github'],
      ['automation:db1/au1:r1<you', 'automation:db1/au1'],
      ['autofill:db1/p1', 'autofill'],
      ['import:i1:md', 'import'],
      ['template:t1:r1', 'template'],
      ['mail:m1', 'mail'],
      ['coding:t1:r1', 'coding'],
      ['kit:k1<you', 'kit'],
      ['member:acc-mara', 'member:acc-mara'],
      ['api:t1', 'api'],
      ['hook:h1', 'hook'],
      ['team', 'team'],
      ['unknown', 'unknown'],
      ['synced<agent:nordlicht:r212', 'agent:nordlicht'],
      ['synced<you', 'you'],
    ]
    for (const [key, lane] of cases) expect(laneOf(key, clientOf), key).toBe(lane)
    expect(clientSlug('Tessera Desk ')).toBe('tessera-desk')
    expect(clientSlug('')).toBe('-')
  })

  test('segmentation keys and run keys', () => {
    expect(segKeyOf('you~button')).toBe('you')
    expect(segKeyOf('editor:e1')).toBe('you')
    expect(segKeyOf('editor:collab+m')).toBe('you')
    expect(segKeyOf('you~undo:b1')).toBe('you~undo:b1')
    expect(segKeyOf('history:s1')).toBe('history:s1')
    expect(segKeyOf('agent:a:r1#c1')).toBe('agent:a:r1')
    expect(segKeyOf('agent:a:r1#c2')).toBe('agent:a:r1')
    expect(segKeyOf('terminal:b1#c3')).toBe('terminal:b1')
    expect(segKeyOf('mcp:s1:c1:one_trash')).toBe('mcp:s1:c1')
    expect(segKeyOf('script:x:r1<you')).toBe('script:x:r1')
    expect(segKeyOf('ai:r1:transform')).toBe('ai:r1')
    expect(segKeyOf('automation:d/a:r1<you')).toBe('automation:d/a:r1')
    expect(segKeyOf('kit:k1<you')).toBe('kit:k1<you')
    expect(segKeyOf('autofill:d/p')).toBe('autofill:d/p')
    expect(segKeyOf('autofill:d/p:f1<you')).toBe('autofill:d/p:f1')
    expect(segKeyOf('synced<you')).toBe('synced<you')
    expect(segKeyOf('member:acc-mara')).toBe('member:acc-mara')
    expect(runKeyOf('you')).toBeNull()
    expect(runKeyOf('kit:k1<you')).toBeNull()
    expect(runKeyOf('sync:folder:p1')).toBe('sync:folder:p1')
    expect(runKeyOf('import:i1:csv')).toBe('import:i1')
    expect(runKeyOf('eject:e1>agent:a:r')).toBe('eject:e1')
    expect(runKindOf('agent:a:r1')).toBe('agent')
    expect(runKindOf('kit:x')).toBeNull()
    expect(runRefOf('agent:a:r1')).toBe('r1')
    expect(runRefOf('mcp:s1:c1')).toBe('s1:c1')
    expect(runRefOf('terminal:b1')).toBe('b1')
    expect(foldsTyping('editor:e1', 'you')).toBe(true)
    expect(foldsTyping('ai:r1:meeting_transcript', 'ai:r1')).toBe(true)
    expect(foldsTyping('ai:r1:transform', 'ai:r1')).toBe(false)
    expect(foldsTyping('agent:a:r', 'agent:a:r')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* model/places.ts                                                     */
/* ------------------------------------------------------------------ */

test.describe('places and classification', () => {
  test('place keys and kinds', () => {
    expect(placeKey('page', 'a')).toBe('p:a')
    expect(placeKey('schema', 'd')).toBe('s:d')
    expect(placeKey('view', 'd', 'v')).toBe('v:d/v')
    expect(parsePlace('v:d/v')).toEqual({ kind: 'view', id: 'd', view: 'v' })
    expect(placeKindOf({ databaseId: 'd', kind: 'page' })).toBe('row')
    expect(placeKindOf({ databaseId: null, kind: 'database' })).toBe('db')
    expect(placeKindOf({ databaseId: null, kind: 'page' })).toBe('page')
  })

  test('title / content / props / trash / move / ignored-only', () => {
    const a = page({ content: docOf(para('Tessera Quartalsplan')) })
    expect(classifyPage(undefined, a, deps)).toMatchObject({ kinds: K.CREATE, f: F.NEW })
    expect(classifyPage(a, undefined, deps)).toMatchObject({ kinds: K.DELETE, f: F.GONE })
    expect(classifyPage(a, { ...a, title: 'NL-1398' }, deps).kinds).toBe(K.TITLE)
    expect(classifyPage(a, { ...a, content: docOf(para('Tessera Quartalsplan 2')), contentRev: 1 }, deps).kinds).toBe(K.CONTENT)
    // block ids added by the editor: contentKey-equal → no change
    const ids = classifyPage(a, { ...a, content: docOf(para('Tessera Quartalsplan', 'b1')), contentRev: 1, contentOrigin: 'editor:e1', updatedAt: 9 }, deps)
    expect(ids).toMatchObject({ kinds: 0, ignoredOnly: true })
    const row = page({ databaseId: 'db-nordlicht', parentId: 'db-nordlicht', properties: { stage: 'o-ready', est: 3 } })
    const db = database()
    expect(classifyPage(row, { ...row, properties: { stage: 'o-done', est: 3 } }, deps, db)).toMatchObject({ kinds: K.PROPS, pc: 1 })
    expect(classifyPage(row, { ...row, properties: { stage: 'o-done', est: 5 } }, deps, db).pc).toBe(2)
    // multi-select order is no change
    const ms = page({ databaseId: 'd', properties: { tags: ['a', 'b'] } })
    const msDb = { properties: [{ id: 'tags', name: 'Tags', type: 'multi_select' as const }] }
    expect(classifyPage(ms, { ...ms, properties: { tags: ['b', 'a'] } }, deps, msDb).kinds).toBe(0)
    expect(classifyPage(a, { ...a, trashed: true, trashedAt: 5, favorite: false }, deps).kinds).toBe(K.TRASH)
    expect(classifyPage({ ...a, trashed: true }, a, deps).kinds).toBe(K.RESTORE)
    expect(classifyPage(a, { ...a, parentId: 'p2' }, deps)).toMatchObject({ kinds: K.MOVE, mv: [null, 'p2'] })
    expect(classifyPage(a, { ...a, order: 2 }, deps).kinds).toBe(K.MOVE)
    expect(classifyPage(a, { ...a, icon: { type: 'emoji', value: '🧭' } as Page['icon'] }, deps).kinds).toBe(K.ICON)
    expect(classifyPage(a, { ...a, cover: { type: 'color', value: 'gray' } as unknown as Page['cover'] }, deps).kinds).toBe(K.COVER)
    expect(classifyPage(row, { ...row, recordType: 'rt1' }, deps).kinds).toBe(K.TYPE)
    expect(classifyPage(a, { ...a, settings: { ...a.settings, fullWidth: true } }, deps).kinds).toBe(K.META)
    expect(classifyPage(a, { ...a, hidden: true }, deps).kinds).toBe(K.META)
    // ignored: stamps, favorite, plain, comments, private, origin / rev alone
    const ign = classifyPage(a, { ...a, updatedAt: 7, favorite: true, plain: 'x', updatedBy: 'agent:n', createdBy: 'x', comments: [], private: true, contentOrigin: 'ai', contentRev: 4 }, deps)
    expect(ign).toMatchObject({ kinds: 0, ignoredOnly: true })
    expect(classifyPage(a, { ...a, title: 'x', parentId: 'p' }, deps).kinds).toBe(K.TITLE | K.MOVE)
  })
})

/* ------------------------------------------------------------------ */
/* model/schema.ts                                                     */
/* ------------------------------------------------------------------ */

test.describe('schema deltas', () => {
  const db = database()
  const withProps = (props: PropertyDef[]) => ({ ...db, properties: props })

  test('properties: added / removed / changed / order', () => {
    const added = databaseChangesDetail(db, withProps([...db.properties, { id: 'owner', name: 'Owner', type: 'person' }]))
    expect(added.schema).toEqual([{ part: 'prop+', prop: { id: 'owner', name: 'Owner', type: 'person' } }])
    expect(added.kinds).toBe(K.SCHEMA)
    const removed = databaseChangesDetail(db, withProps(db.properties.filter((p) => p.id !== 'est')))
    expect(removed.schema).toEqual([{ part: 'prop-', prop: { id: 'est', name: 'Schätzung', type: 'number' } }])
    const renamed = databaseChangesDetail(db, withProps(db.properties.map((p) => (p.id === 'est' ? { ...p, name: 'Aufwand' } : p))))
    expect(renamed.schema).toEqual([{ part: 'prop~', prop: { id: 'est', name: 'Aufwand', type: 'number' } }])
    const order = databaseChangesDetail(db, withProps([db.properties[0], db.properties[2], db.properties[1], db.properties[3]]))
    expect(order.schema).toEqual([{ part: 'order' }])
  })

  test('options: added / removed / renamed / order', () => {
    const opts = (o: NonNullable<PropertyDef['options']>) => withProps(db.properties.map((p) => (p.id === 'stage' ? { ...p, options: o } : p)))
    const [backlog, ready, done] = statusProp.options!
    const add = databaseChangesDetail(db, opts([backlog, ready, done, { id: 'o-review', name: 'Review', color: 'purple' }]))
    expect(add.schema).toEqual([{ part: 'opt+', prop: { id: 'stage', name: 'Stage', type: 'select' }, opt: { id: 'o-review', name: 'Review' } }])
    const rm = databaseChangesDetail(db, opts([backlog, done]))
    expect(rm.schema).toEqual([{ part: 'opt-', prop: { id: 'stage', name: 'Stage', type: 'select' }, opt: { id: 'o-ready', name: 'Ready' } }])
    const ren = databaseChangesDetail(db, opts([backlog, { ...ready, name: 'Bereit' }, done]))
    expect(ren.schema).toEqual([{ part: 'opt~', prop: { id: 'stage', name: 'Stage', type: 'select' }, opt: { id: 'o-ready', name: 'Bereit', prev: 'Ready' } }])
    const ord = databaseChangesDetail(db, opts([ready, backlog, done]))
    expect(ord.schema).toEqual([{ part: 'order', prop: { id: 'stage', name: 'Stage', type: 'select' } }])
  })

  test('views: added / removed / changed / layout only', () => {
    const v2 = view({ id: 'v-table', name: 'Liste', type: 'table', groupBy: null })
    expect(databaseChangesDetail(db, { ...db, views: [...db.views, v2] }).views).toEqual([{ id: 'v-table', delta: { part: 'view+', view: { id: 'v-table', name: 'Liste', type: 'table' } }, layout: false }])
    expect(databaseChangesDetail({ ...db, views: [...db.views, v2] }, db).views).toEqual([{ id: 'v-table', delta: { part: 'view-', view: { id: 'v-table', name: 'Liste', type: 'table' } }, layout: false }])
    const changed = databaseChangesDetail(db, { ...db, views: [view({ sorts: [{ propertyId: 'est', direction: 'asc' }] })] })
    expect(changed.views).toEqual([{ id: 'v-board', delta: { part: 'view~', view: { id: 'v-board', name: 'Tessera-Ansicht', type: 'board' } }, layout: false }])
    expect(changed.schema).toBeNull()
    const layout = databaseChangesDetail(db, { ...db, views: [view({ propertyWidths: { est: 120 } })] })
    expect(layout.views).toEqual([{ id: 'v-board', delta: { part: 'view~', view: { id: 'v-board', name: 'Tessera-Ansicht', type: 'board' }, layout: true }, layout: true }])
  })

  test('lock, commands, dbmeta; bookkeeping is no change; created / deleted', () => {
    expect(databaseChangesDetail(db, { ...db, locked: true })).toMatchObject({ schema: [{ part: 'lock' }], kinds: K.LOCK })
    expect(databaseChangesDetail(db, { ...db, commands: [{ id: 'c', kind: 'default' } as never] })).toMatchObject({ schema: [{ part: 'commands' }], kinds: K.COMMANDS })
    expect(databaseChangesDetail(db, { ...db, subItems: { propertyId: 'x' } as never }).kinds).toBe(K.DBMETA)
    // bookkeeping
    expect(databaseChangesDetail(db, { ...db, nextUniqueId: 7 })).toMatchObject({ schema: null, views: [], kinds: 0 })
    const auto = { ...db, automations: [{ id: 'a1', name: 'x', trigger: 'row_added', actions: [] } as never] }
    expect(databaseChangesDetail(auto, { ...auto, automations: [{ ...(auto.automations![0] as object), lastRunAt: 5, lastStatus: 'ok', lastMessage: 'm' } as never] }).schema).toBeNull()
    const af = withProps(db.properties.map((p) => (p.id === 'est' ? { ...p, autofill: { prompt: 'x', fills: {} } as never } : p)))
    const af2 = withProps(af.properties.map((p) => (p.id === 'est' ? { ...p, autofill: { prompt: 'x', fills: { r1: { at: 1, hash: 'h' } } } as never } : p)))
    expect(databaseChangesDetail(af, af2).schema).toBeNull()
    const tpl = { ...db, templates: [{ id: 't', name: 'T', content: null, properties: {}, repeat: { every: 'day', lastRunAt: 1 } as never }] }
    expect(databaseChangesDetail(tpl, { ...tpl, templates: [{ ...tpl.templates[0], repeat: { every: 'day', lastRunAt: 9 } as never }] }).schema).toBeNull()
    expect(databaseChangesDetail(undefined, db).kinds).toBe(K.CREATE)
    expect(databaseChangesDetail(db, undefined).kinds).toBe(K.DELETE)
  })
})

/* ------------------------------------------------------------------ */
/* model/canon.ts + touched.ts                                         */
/* ------------------------------------------------------------------ */

test.describe('canonical parts and touched parts', () => {
  test('a row: parts per stored property (computed ones left out), touched = changed parts', () => {
    const db = database()
    const row = page({ id: 'r1', databaseId: db.id, parentId: db.id, title: 'NL-1408', properties: { stage: 'o-ready', est: 3, f: 99 } })
    const parts = rowParts(row, db, deps)
    expect(Object.keys(parts).sort()).toEqual(['c', 'i', 'o', 'p:est', 'p:stage', 'pa', 'r', 't', 'tr'])
    expect(parts['p:stage']).toBe('"o-ready"')
    const next = { ...row, title: 'NL-1408 b', properties: { ...row.properties, est: 5 } }
    expect(touchedParts({ kind: 'row', page: row, db }, { kind: 'row', page: next, db }, deps)).toEqual(['p:est', 't'])
    expect(touchedParts({ kind: 'row', page: row, db }, { kind: 'row', page: { ...row, trashed: true, updatedAt: 9 }, db }, deps)).toEqual(['tr'])
    expect(touchedParts(null, { kind: 'row', page: row, db }, deps)).toBe('*')
    // a value written and written back: nothing touched
    expect(touchedParts({ kind: 'row', page: row, db }, { kind: 'row', page: { ...row }, db }, deps)).toEqual([])
  })

  test('a page with block ids: blocks by id, order', () => {
    const a = page({ content: docOf(para('Eins', 'b1'), para('Zwei', 'b2'), para('Drei', 'b3')) })
    const blocks = blockList(a.content, deps)
    expect(blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
    const edited = { ...a, content: docOf(para('Eins', 'b1'), para('Zwei!', 'b2'), para('Drei', 'b3')) }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: edited }, deps)).toEqual(['b:b2'])
    const moved = { ...a, content: docOf(para('Zwei', 'b2'), para('Eins', 'b1'), para('Drei', 'b3')) }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: moved }, deps)).toEqual(['bo'])
    const added = { ...a, content: docOf(para('Eins', 'b1'), para('Zwei', 'b2'), para('Drei', 'b3'), para('Vier', 'b4')) }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: added }, deps)).toEqual(['b:b4', 'bo'])
    const titled = { ...a, title: 'Tessera' }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: titled }, deps)).toEqual(['t'])
    expect(Object.keys(pageParts(a, deps)).sort()).toEqual(['cv', 'i', 'o', 'pa', 't', 'tr'])
  })

  test('a page without block ids: id-less blocks, trailing empty paragraph dropped', () => {
    const a = page({ content: docOf(para('Eins'), para('Zwei'), para('')) })
    expect(blockList(a.content, deps)).toHaveLength(2)
    const edited = { ...a, content: docOf(para('Eins'), para('Zwei!')) }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: edited }, deps)).toEqual(['b#'])
    const same = { ...a, content: docOf(para('Eins'), para('Zwei')) }
    expect(touchedParts({ kind: 'page', page: a }, { kind: 'page', page: same }, deps)).toEqual([])
  })

  test('a schema and a view; whole canon and parts key', () => {
    const db = database()
    const parts = schemaParts(db)
    expect(parts['o:stage/o-ready']).toContain('Ready')
    expect(parts['oo:stage']).toBe('o-backlog,o-ready,o-done')
    expect(parts.po).toBe('title,stage,est,f')
    const renamed = { ...db, properties: db.properties.map((p) => (p.id === 'stage' ? { ...p, options: p.options!.map((o) => (o.id === 'o-ready' ? { ...o, name: 'Bereit' } : o)) } : p)) }
    expect(touchedParts({ kind: 'schema', db }, { kind: 'schema', db: renamed }, deps)).toEqual(['o:stage/o-ready'])
    const dropped = { ...db, properties: db.properties.map((p) => (p.id === 'stage' ? { ...p, options: p.options!.filter((o) => o.id !== 'o-ready') } : p)) }
    expect(touchedParts({ kind: 'schema', db }, { kind: 'schema', db: dropped }, deps)).toEqual(['o:stage/o-ready', 'oo:stage'])
    expect(touchedParts({ kind: 'schema', db }, { kind: 'schema', db: { ...db, locked: true } }, deps)).toEqual(['l'])
    // run status of an automation is no part change
    expect(touchedParts({ kind: 'schema', db }, { kind: 'schema', db: { ...db, nextUniqueId: 9 } }, deps)).toEqual([])
    expect(viewPart(view()).v).toContain('Tessera-Ansicht')
    expect(touchedParts({ kind: 'view', view: view() }, { kind: 'view', view: view({ groupBy: null }) }, deps)).toEqual(['v'])
    // whole canon: key order, blocks after
    expect(wholeCanon({ b: '2', a: '1' })).toBe('a\u00001\u0001b\u00002')
    const p = page({ content: docOf(para('x', 'b1')) })
    expect(partsKey({ kind: 'page', page: p }, deps)).toBe(partsKey({ kind: 'page', page: { ...p, updatedAt: 99, updatedBy: 'agent:n', comments: [] } }, deps))
    expect(partsKey({ kind: 'page', page: p }, deps)).not.toBe(partsKey({ kind: 'page', page: { ...p, title: 'y' } }, deps))
    expect(partsKey(null, deps)).toBe('-')
  })
})

/* ------------------------------------------------------------------ */
/* model/counts.ts                                                     */
/* ------------------------------------------------------------------ */

test.describe('counts', () => {
  test('Vorgänge, Stellen, Wörter of a lane and of a run (copies never count)', () => {
    const op = (at: number, l: string, r?: string, f?: number): JOp => ({ k: `${at}`, s: 'local:local', at, v: `t.${at}`, w: 'x', l, ...(r ? { r } : {}), n: 1, kinds: 1, p1: 'p:a', ops: 1, ...(f ? { f } : {}) })
    const ops = [op(10, 'you'), op(20, 'agent:n', 'agent:n:r1'), op(30, 'agent:n', 'agent:n:r1'), op(40, 'agent:n', 'agent:n:r2'), op(50, 'agent:n', 'agent:n:r1', F.COPY)]
    expect(countOps(ops, { lane: 'agent:n' }, 0, 100)).toBe(3)
    expect(countOps(ops, { run: 'agent:n:r1' }, 0, 100)).toBe(2)
    expect(countOps(ops, { run: 'agent:n:r1' }, 25, 100)).toBe(1)
    const seg = (p: string, pk: JSegment['pk'], from: number, to: number, f = 0): JSegment => ({ id: p, s: 'local:local', p: p as JSegment['p'], pk, w: 'agent:n:r1', sk: 'agent:n:r1', l: 'agent:n', r: 'agent:n:r1', from, to, n: 1, before: null, bh: '-', left: null, lastLh: '', touched: [], tab: 't', f })
    const segs = [seg('p:r1', 'row', 0, 10), seg('p:r2', 'row', 5, 15, F.NEW), seg('p:r1', 'row', 20, 30), seg('p:pg', 'page', 0, 5), seg('s:db', 'schema', 3, 3), seg('v:db/v', 'view', 50, 60)]
    expect(countPlaces(segs, { run: 'agent:n:r1' }, 0, 40)).toEqual({ all: 4, rows: 2, newRows: 1, pages: 1, schema: 1, views: 0 })
    expect(countPlaces(segs, { run: 'agent:n:r1' }, 12, 40)).toEqual({ all: 2, rows: 2, newRows: 1, pages: 0, schema: 0, views: 0 })
    const ev = (at: number, wa: number, wd: number): JEvent => ({ k: `${at}`, s: 'local:local', at, v: 'v', w: 'x', l: 'you', p: 'p:a', pk: 'page', kinds: 1, ops: 1, g: 'g', lh: 'h', wa, wd })
    expect(countWords([ev(1, 5, 2), ev(2, 3, 0), ev(200, 9, 9)], { lane: 'you' }, 0, 100)).toEqual([8, 2])
  })

  test('the window plate\'s meters from the events of [a, b) (half-open, copies left out)', () => {
    const ev = (at: number, v: string, p: string, pk: JEvent['pk'], extra: Partial<JEvent> = {}): JEvent => ({ k: `${at}|${p}`, s: 'local:local', at, v, w: 'agent:n:r1', l: 'agent:n', r: 'agent:n:r1', p: p as JEvent['p'], pk, kinds: 4, ops: 1, g: 'g', lh: 'h', ...extra })
    const events = [
      ev(10, 'a', 'p:r1', 'row'),
      ev(10, 'a', 'p:r2', 'row', { f: F.NEW }),
      ev(20, 'b', 'p:r1', 'row'),
      ev(30, 'c', 'p:pg', 'page', { wa: 12, wd: 3 }),
      ev(40, 'd', 's:db', 'schema'),
      ev(50, 'e', 'p:r3', 'row', { f: F.COPY }),
      ev(100, 'f', 'p:r4', 'row'),
    ]
    expect(windowMeters(events, { run: 'agent:n:r1' }, 0, 100)).toEqual({ ops: 4, places: { all: 4, rows: 2, newRows: 1, pages: 1, schema: 1, views: 0 }, words: [12, 3] })
    expect(windowMeters(events, { lane: 'agent:n' }, 15, 101).ops).toBe(4)
  })

  test('word deltas from changed blocks only', () => {
    expect(wordDelta('Nordlicht startet heute', 'Nordlicht startet morgen früh')).toEqual([2, 1])
    const a = docOf(para('Nordlicht startet heute', 'b1'), para('Unverändert bleibt das', 'b2'))
    const b = docOf(para('Nordlicht startet morgen früh', 'b1'), para('Unverändert bleibt das', 'b2'), para('Ganz neuer Absatz', 'b3'))
    expect(contentDelta(a, b, deps)).toEqual({ wa: 5, wd: 1, bc: [1, 1, 0] })
    expect(contentDelta(b, a, deps)).toEqual({ wa: 1, wd: 5, bc: [1, 0, 1] })
    // ids assigned by the editor: no words
    expect(contentDelta(docOf(para('Eins zwei')), docOf(para('Eins zwei', 'b1')), deps)).toEqual({ wa: 0, wd: 0, bc: [0, 0, 0] })
    // an empty trailing paragraph is no block of words
    expect(contentDelta(docOf(para('x', 'b1')), docOf(para('x', 'b1'), para('', 'b2')), deps)).toEqual({ wa: 0, wd: 0, bc: [0, 0, 0] })
  })
})

/* ------------------------------------------------------------------ */
/* model/axis.ts, model/labels.ts — the deck's tape                    */
/* ------------------------------------------------------------------ */

test.describe('the tape: axis, loupe, ruler, strip', () => {
  // the story's day, its clock two hours east of UTC (pinned: Node's own zone never matters)
  const off = () => 2 * 3_600_000
  const at = (hms: string) => new Date(`2026-10-09T${hms}+02:00`).getTime()
  const MIN = 60_000
  const T0 = at('06:55:00')
  const T1 = at('08:10:00')
  const zone = { a: at('07:30:00'), b: at('07:35:00'), k: 6 }

  test('the loupe: the mock numbers, forward ∘ inverse = identity', () => {
    const ax = makeAxis(T0, T1, zone)
    // 35 min + 5 min · 6 + 35 min = 100 minutes of units; the window takes 30 %, a minute outside 1 %
    expect(ax.total).toBe(100 * MIN)
    expect(fracOf(ax, zone.b) - fracOf(ax, zone.a)).toBeCloseTo(0.3, 10)
    expect(fracOf(ax, at('07:00:00')) - fracOf(ax, at('06:59:00'))).toBeCloseTo(0.01, 10)
    expect(pct(ax, at('07:30:00'))).toBe('35.000%')
    expect(xOf(ax, T1, 950)).toBeCloseTo(950, 6)
    // every moment comes back from its units — with the window inside, partly outside, and none
    let seed = 7
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280)
    for (const z of [zone, { a: at('06:40:00'), b: at('07:05:00'), k: 2.5 }, { a: at('08:00:00'), b: at('08:30:00'), k: 3 }, null]) {
      const a = makeAxis(T0, T1, z)
      for (let i = 0; i < 1000; i++) {
        const t = T0 + rnd() * (T1 - T0)
        expect(Math.abs(tOfU(a, uOf(a, t)) - t)).toBeLessThan(1e-3)
        expect(Math.abs(tAtX(a, xOf(a, t, 1176), 1176) - t)).toBeLessThan(1e-3)
      }
      // monotone, from 0 to 1
      expect(fracOf(a, T0)).toBeCloseTo(0, 10)
      expect(fracOf(a, T1)).toBeCloseTo(1, 10)
    }
    // a window wholly outside the span leaves the axis plain
    expect(makeAxis(T0, T1, { a: at('09:00:00'), b: at('09:05:00'), k: 6 }).zone).toBeNull()
  })

  test('k: 6 for 5 minutes at 75 MIN, never more than 60 % of the width', () => {
    expect(loupeK(75 * MIN, 5 * MIN)).toBe(6)
    expect(loupeLabel(loupeK(75 * MIN, 5 * MIN))).toBe(6)
    for (const len of [10, 15, 20, 30, 40, 60, 70]) {
      const k = loupeK(75 * MIN, len * MIN)
      expect(k).toBeGreaterThanOrEqual(1)
      expect(k).toBeLessThanOrEqual(6)
      const ax = makeAxis(T0, T1, { a: T0 + 5 * MIN, b: T0 + 5 * MIN + len * MIN, k })
      // the loupe never pushes a window past 60 % (one that is wider by itself stays as it is: k = 1)
      expect(fracOf(ax, T0 + 5 * MIN + len * MIN) - fracOf(ax, T0 + 5 * MIN)).toBeLessThanOrEqual(Math.max(0.6, len / 75) + 1e-9)
    }
    expect(loupeK(75 * MIN, 75 * MIN)).toBe(1)
  })

  test('the span follows now (rounded up to the zoom\'s edge); a rewound playhead keeps a 10 % margin', () => {
    expect(followSpan(at('08:05:40'), '75m', off)).toEqual({ t0: T0, t1: T1 })
    expect(followSpan(at('08:05:40'), '15m', off)).toEqual({ t0: at('07:51:00'), t1: at('08:06:00') })
    // a sliver of future stays: 08:05:55 is too close to 08:06
    expect(followSpan(at('08:05:55'), '15m', off).t1).toBe(at('08:07:00'))
    expect(followSpan(at('08:05:40'), '24h', off).t1).toBe(at('09:00:00'))
    const cur = { t0: T0, t1: T1 }
    expect(spanAround(at('07:30:00'), '75m', cur, at('08:05:40'), off)).toBe(cur)
    const moved = spanAround(at('06:50:00'), '75m', cur, at('08:05:40'), off)
    expect(moved.t1 - moved.t0).toBe(75 * MIN)
    expect(at('06:50:00') - moved.t0).toBeGreaterThanOrEqual(7.5 * MIN - 1)
  })

  test('a flag brackets its run, rounded outward to the 5-minute tick (half-open)', () => {
    expect(runBracket(at('07:31:04'), at('07:34:41'), 5 * MIN, off)).toEqual({ a: at('07:30:00'), b: at('07:35:00') })
    expect(runBracket(at('07:31:04'), at('07:35:00'), 5 * MIN, off)).toEqual({ a: at('07:30:00'), b: at('07:40:00') })
    expect(runBracket(at('07:30:00'), at('07:30:00'), 5 * MIN, off)).toEqual({ a: at('07:30:00'), b: at('07:35:00') })
    // a dragged edge snaps to the zoom's step or to an edge close by
    expect(snapTime(at('07:31:20'), MIN, [], 30_000, off)).toBe(at('07:31:00'))
    expect(snapTime(at('07:31:40'), MIN, [], 30_000, off)).toBe(at('07:32:00'))
    expect(snapTime(at('07:31:20'), MIN, [at('07:31:04')], 30_000, off)).toBe(at('07:31:04'))
  })

  test('phone fit: the mock\'s 503 px tape scrolled to 171 px', () => {
    const ax = makeAxis(T0, T1, zone)
    const fit = phoneFit(ax, 284, at('07:29:00'), at('08:00:30'))
    expect(Math.round(fit.width)).toBe(503)
    expect(Math.round(fit.scrollLeft)).toBe(171)
  })

  test('ruler ticks ≥ 4 px apart (10-second ticks only inside the window), labels ≥ 28 px apart', () => {
    const ax = makeAxis(T0, T1, zone)
    const width = 950
    const ticks = rulerTicks(ax, '75m', width, off)
    const secs = ticks.filter((t) => t.cls === 's')
    expect(secs.length).toBe(25)
    expect(secs.every((t) => t.t > zone.a && t.t < zone.b)).toBe(true)
    expect(ticks.filter((t) => t.cls === 'h').map((t) => t.t)).toEqual([at('07:00:00'), at('07:15:00'), at('07:30:00'), at('07:45:00'), at('08:00:00')])
    const xs = ticks.map((t) => xOf(ax, t.t, width))
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(4 - 1e-9)
    const labels = rulerLabels(ax, '75m', width, off)
    expect(labels.filter((l) => l.kind === 'base').map((l) => l.t)).toEqual([at('07:00:00'), at('07:15:00'), at('07:30:00'), at('07:45:00'), at('08:00:00')])
    expect(labels.filter((l) => l.kind === 'zone').map((l) => l.t)).toEqual([at('07:31:00'), at('07:32:00'), at('07:33:00'), at('07:34:00')])
    expect(labels.filter((l) => l.kind === 'end').map((l) => l.t)).toEqual([at('07:35:00')])
    const lx = labels.map((l) => xOf(ax, l.t, width))
    for (let i = 1; i < lx.length; i++) expect(lx[i] - lx[i - 1]).toBeGreaterThanOrEqual(28 - 1e-9)
    // 6 STD: the 5-minute window gets minute ticks, no 10-second level at all
    const six = makeAxis(at('02:10:00'), at('08:10:00'), { a: zone.a, b: zone.b, k: loupeK(360 * MIN, 5 * MIN) })
    const t6 = rulerTicks(six, '6h', width, off)
    expect(t6.some((t) => (t.t - zone.a) % MIN === 0 && t.t > zone.a && t.t < zone.b && t.cls === 's')).toBe(true)
    expect(t6.every((t) => (t.t - T0) % MIN === 0)).toBe(true)
    // 15 MIN: no loupe; a short label every minute, HH:MM every 5 minutes
    const fifteen = makeAxis(at('07:52:00'), at('08:07:00'))
    const l15 = rulerLabels(fifteen, '15m', width, off)
    expect(l15.filter((l) => l.fmt === 'hm').map((l) => l.t)).toEqual([at('07:55:00'), at('08:00:00'), at('08:05:00')])
    expect(l15.filter((l) => l.kind === 'minor').length).toBeGreaterThan(8)
  })

  test('the 24 h strip: 96 quarters ending at the tape\'s edge, hot where they overlap the window', () => {
    // whole quarters: the last one holds the tape's right edge
    const r = stripRange(T1)
    expect(r.to).toBe(at('08:15:00'))
    expect(r.to - r.from).toBe(24 * 3_600_000)
    const counts = new Map([[Math.floor(at('07:31:00') / (15 * MIN)), 52], [Math.floor(at('07:58:00') / (15 * MIN)), 13]])
    const s = stripBars(T1, counts)
    expect(s.bars.length).toBe(96)
    expect(s.bars.reduce((a, b) => a + b, 0)).toBe(65)
    const hot = s.bars.map((_, i) => quarterHot(s.q0 + i, { a: zone.a, b: zone.b })).flatMap((h, i) => (h ? [i] : []))
    expect(hot.map((i) => (s.q0 + i) * 15 * MIN)).toEqual([at('07:30:00')])
    expect(barHeights([0, 1, 4])).toEqual([0, 25, 100])
    expect(barHeights([0, 1, 100])[1]).toBe(8)
    const ticks = stripTicks(r.from, r.to, off)
    expect(ticks[0].day).toBe(true)
    expect(ticks.filter((t) => t.day).length).toBe(2)
  })
})

test.describe('the tape: label pass (tape.js settle)', () => {
  const view = { left: 0, right: 600 }

  test('labels flip left of their mark before the now line or the edge; a range label flips to its start', () => {
    const [free, beforeNow, edge, range, lead] = settleLabels(
      [
        { anchor: 100, w: 80, shift: 14, flipGap: 6, flips: true },
        { anchor: 400, w: 80, shift: 14, flipGap: 6, flips: true },
        { anchor: 560, w: 80, shift: 8, flipGap: 8, flips: true },
        { anchor: 300, w: 120, shift: 8, flipGap: 8, start: 200, flips: true },
        { anchor: 250, w: 120, shift: -24 - 120, flipGap: 0, flips: false },
      ],
      view,
      420,
    )
    expect(free).toEqual({ flip: false, hidden: false, left: 114 })
    // 400 + 14 + 80 > 420 − 6: flips to 400 − 6 − 80
    expect(beforeNow).toEqual({ flip: true, hidden: false, left: 314 })
    // right of now: the edge is the limit
    expect(edge).toEqual({ flip: true, hidden: false, left: 472 })
    // 300 + 8 + 120 > 414: the range label sits left of the range's start
    expect(range).toEqual({ flip: true, hidden: false, left: 72 })
    expect(lead).toEqual({ flip: false, hidden: false, left: 106 })
  })

  test('a label still cut at either edge is hidden; on one lane the later of two overlapping goes', () => {
    const out = settleLabels(
      [
        { anchor: 10, w: 90, shift: 14, flipGap: 6, flips: true, start: -40 },
        { anchor: 20, w: 120, shift: -144, flipGap: 0, flips: false },
        { anchor: 200, w: 80, shift: 14, flipGap: 6, flips: true, lane: 'mcp' },
        { anchor: 230, w: 80, shift: 14, flipGap: 6, flips: true, lane: 'mcp' },
        { anchor: 230, w: 80, shift: 14, flipGap: 6, flips: true, lane: 'sync' },
      ],
      view,
      null,
    )
    expect(out.map((o) => o.hidden)).toEqual([false, true, false, true, false])
    // flipped past the left edge: hidden
    expect(settleLabels([{ anchor: 595, w: 60, shift: 8, flipGap: 8, start: 20, flips: true }], view, null)[0]).toEqual({ flip: true, hidden: true, left: -48 })
  })

  test('heads align inward at the edges, "Jetzt →" pinned off to the right; ruler labels under a head are hidden', () => {
    expect(settleHead(300, 60, view)).toEqual({ place: 'center', left: 270, right: 330 })
    expect(settleHead(10, 60, view)).toEqual({ place: 'edge-r', left: 10, right: 70 })
    expect(settleHead(590, 60, view)).toEqual({ place: 'edge-l', left: 530, right: 590 })
    expect(settleHead(700, 70, view, 'now')).toEqual({ place: 'pinned', left: 528, right: 598 })
    expect(settleHead(560, 50, view, 'now')).toEqual({ place: 'edge-l', left: 506, right: 556 })
    expect(settleHead(300, 50, view, 'now')).toEqual({ place: 'center', left: 304, right: 354 })
    expect(underHeads([{ left: 250, right: 280 }, { left: 333, right: 360 }, { left: 335, right: 360 }, { left: 100, right: 130 }], [{ left: 270, right: 330 }])).toEqual([true, true, false, false])
  })
})

/* ------------------------------------------------------------------ */
/* the model stays pure                                                */
/* ------------------------------------------------------------------ */

test('the model folder imports only itself, types and pure libraries', () => {
  const dir = fileURLToPath(new URL('../../src/app/features/recorder/model/', import.meta.url))
  const bad: string[] = []
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(dir + f, 'utf8')
    for (const m of src.matchAll(/^\s*import\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm)) {
      const typeOnly = !!m[1]
      const from = m[2]
      if (typeOnly || from.startsWith('./')) continue
      bad.push(`${f}: ${from}`)
    }
    for (const m of src.matchAll(/import\(\s*'([^']+)'\s*\)/g)) bad.push(`${f}: dynamic ${m[1]}`)
  }
  expect(bad).toEqual([])
})
