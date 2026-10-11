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
import { keySet, partsDiffer, propKeysAt, propKeysOf, restrictRowParts } from '../../src/app/features/recorder/model/rowkeys'
import { verdicts, type VerdictInput } from '../../src/app/features/recorder/model/hold'
import { foreignOf, placeChain } from '../../src/app/features/recorder/model/chain'
import type { WindowData } from '../../src/app/features/recorder/window/load'
import type { ReadModel } from '../../src/app/features/recorder/window/read'
import { incidentReport, reportFile, type ReportFacts } from '../../src/app/features/recorder/window/report'
import { messages as recorderMessages } from '../../src/app/features/recorder/messages'
import { contentDelta, countOps, countPlaces, countWords, windowMeters, wordDelta } from '../../src/app/features/recorder/model/counts'
import { barHeights, followSpan, fracOf, loupeK, loupeLabel, makeAxis, pct, phoneFit, quarterHot, rulerLabels, rulerTicks, runBracket, snapTime, spanAround, stripBars, stripRange, stripTicks, tAtX, tOfU, uOf, xOf } from '../../src/app/features/recorder/model/axis'
import { hiddenRulerLabels, settleHead, settleLabels, underHeads } from '../../src/app/features/recorder/model/labels'
import { F, K, type EjectRecord, type Foreign, type JEvent, type JOp, type JSegment, type NowDigest, type PinMeta, type PlaceKey, type PlaceWindow } from '../../src/app/features/recorder/model/types'
import type { Database, Page, PropertyDef, View } from '../../src/app/store/types'
import { rewindAllowed, rewindState, setRewindGuard } from '../../src/app/store/rewind'
import { thinSnapshots } from '../../src/app/features/history/thin'
import type { SnapshotMeta } from '../../src/app/features/history/snapshots'
import { planRestoreProps, type SnapshotProps } from '../../src/app/features/history/propsCore'
import { invalidTargetsIn, pairedRelationIn, relationRestoreOk } from '../../src/app/database/model/hierarchyCore'
import { overlay, overlayDb } from '../../src/app/features/recorder/model/overlay'
import { blockHunks, locateUnique } from '../../src/app/features/recorder/model/blocks'
import { core, targetsFor, type CoreInput } from '../../src/app/features/recorder/model/plan'
import { optionRefs, propertyRefs, withoutProperty } from '../../src/app/database/model/withoutProperty'
import { isEjectWriter, isSettled, markSettled, noteEject, onSettled, unmarkSettled, type SettledNote } from '../../src/app/features/recorder/settled'

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
/* model/rowkeys.ts (Δ12)                                              */
/* ------------------------------------------------------------------ */

test.describe('row keys across schema changes (Δ12)', () => {
  const schemaEv = (at: number, x: JEvent['x']): JEvent => ({ k: `local:local|${at}|v|0`, s: 'local:local', at, v: 'v', w: 'you', l: 'you', p: 's:db-nordlicht', pk: 'schema', kinds: K.SCHEMA, ops: 1, g: 'g', lh: '-', x })

  test('restrictRowParts: non-p parts kept, p: only for the keys, a missing key empty', () => {
    const parts = { t: '"NL-1408"', c: 'doc', 'p:stage': '"o-ready"', 'p:note': '"Lindenweg"' }
    expect(restrictRowParts(parts, new Set(['p:stage', 'p:est']))).toEqual({ t: '"NL-1408"', c: 'doc', 'p:stage': '"o-ready"', 'p:est': '' })
    expect(propKeysOf(parts)).toBe('p:note,p:stage')
    expect([...keySet('p:note,p:stage')]).toEqual(['p:note', 'p:stage'])
    expect(keySet('').size).toBe(0)
    // a property added with no value since: the row restricted to the keys then canonicalises exactly as then
    const db = database()
    const row = page({ id: 'r1', databaseId: db.id, parentId: db.id, title: 'NL-1408', properties: { stage: 'o-ready', est: 3 } })
    const then = rowParts(row, db, deps)
    const now = rowParts(row, { ...db, properties: [...db.properties, { id: 'note', name: 'Notiz', type: 'text' }] }, deps)
    expect(wholeCanon(now)).not.toBe(wholeCanon(then))
    expect(wholeCanon(restrictRowParts(now, keySet(propKeysOf(then))))).toBe(wholeCanon(then))
  })

  test('partsDiffer: union of keys, a key on one side equal when empty there; o and kit-computed never differ', () => {
    const empty = (k: string) => `E(${k})`
    const left = { t: 'a', o: '1', 'p:stage': 's1', 'p:gone': 'E(p:gone)', 'p:kit': 'k1' }
    const now = { t: 'a', o: '2', 'p:stage': 's1', 'p:new': 'E(p:new)', 'p:kit': 'k2' }
    expect(partsDiffer(left, now, empty, (k) => k === 'p:kit')).toEqual([])
    expect(partsDiffer({ ...left, 'p:gone': 'x' }, now, empty)).toEqual(['p:gone', 'p:kit'])
    expect(partsDiffer(left, { ...now, 'p:new': 'filled', t: 'b' }, empty, (k) => k === 'p:kit')).toEqual(['p:new', 't'])
  })

  test('propKeysAt: the keys a database had then, from the deltas after it (newest first); a stored ↔ computed type change → null', () => {
    const nowProps = [
      { id: 'title', type: 'title' as const },
      { id: 'stage', type: 'select' as const },
      { id: 'note', type: 'text' as const },
      { id: 'uid', type: 'unique_id' as const },
    ]
    const T = 1000
    // now: stage, note, uid stored; note added after T; est deleted after T; a formula added and deleted after T
    const evs = [
      schemaEv(T + 10, [{ part: 'prop+', prop: { id: 'note', name: 'Notiz', type: 'text' } }]),
      schemaEv(T + 20, [{ part: 'prop-', prop: { id: 'est', name: 'Schätzung', type: 'number' } }]),
      schemaEv(T + 30, [{ part: 'prop+', prop: { id: 'tmp', name: 'Tessera', type: 'text' } }]),
      schemaEv(T + 40, [{ part: 'prop-', prop: { id: 'tmp', name: 'Tessera', type: 'text' } }]),
      schemaEv(T - 5, [{ part: 'prop+', prop: { id: 'stage', name: 'Stage', type: 'select' } }]),
    ]
    expect([...propKeysAt(nowProps, evs, T)!].sort()).toEqual(['p:est', 'p:stage', 'p:uid'])
    // at a later moment only the deletion of the temporary property is after it
    expect([...propKeysAt(nowProps, evs, T + 35)!].sort()).toEqual(['p:note', 'p:stage', 'p:tmp', 'p:uid'])
    // a rename after T is no type change; a change text → formula is (null); a delta without `was` counts as none
    expect(propKeysAt(nowProps, [schemaEv(T + 5, [{ part: 'prop~', prop: { id: 'stage', name: 'Phase', type: 'select' } }])], T)).not.toBeNull()
    expect(propKeysAt(nowProps, [schemaEv(T + 5, [{ part: 'prop~', prop: { id: 'note', name: 'Notiz', type: 'formula' }, was: 'text' }])], T)).toBeNull()
    expect(propKeysAt(nowProps, [schemaEv(T + 5, [{ part: 'prop~', prop: { id: 'note', name: 'Notiz', type: 'url' }, was: 'text' }])], T)).not.toBeNull()
  })

  test('schema deltas say the old type of a property whose type changed', () => {
    const db = database()
    const next = { ...db, properties: db.properties.map((p) => (p.id === 'est' ? { ...p, type: 'formula' as const, formula: '2' } : p.id === 'stage' ? { ...p, name: 'Phase' } : p)) }
    const d = databaseChangesDetail(db, next).schema!
    expect(d.find((x) => x.prop?.id === 'est')).toMatchObject({ part: 'prop~', was: 'number', prop: { type: 'formula' } })
    expect(d.find((x) => x.prop?.id === 'stage')!.was).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* model/hold.ts + model/chain.ts (F6)                                 */
/* ------------------------------------------------------------------ */

test.describe('the held check (F6): verdicts per place, chains and foreign segments', () => {
  const S = 'local:local' as const
  const LANE = 'agent:nordlicht-spiegel'
  const RUN = `${LANE}:r212`
  const SEL = { scope: S, lane: LANE, run: RUN, a: 1000, b: 9000 }
  const LEFT = { h: 'L1', parts: { t: 'T', c: 'C', i: '', tr: '0', pa: 'PA', r: '', o: 'O1', 'p:stage': 'S1', 'p:est': 'E2', 'p:kit': 'K1' } }
  const seg = (over: Partial<JSegment> = {}): JSegment => ({ id: `${S}|s1`, s: S, p: 'p:r1', pk: 'row', db: 'db-nordlicht', w: `${RUN}#c5`, sk: RUN, l: LANE, r: RUN, from: 2000, to: 3000, n: 1, before: 'p:r1|pin1', bh: 'B0', left: LEFT, lastLh: 'L1', touched: ['p:stage'], tab: 't1', f: 0, ...over })
  const ev = (over: Partial<JEvent> = {}): JEvent => ({ k: `${S}|2000|v1|0`, s: S, at: 2000, v: 'v1', w: `${RUN}#c5`, l: LANE, r: RUN, c: 'c5', p: 'p:r1', pk: 'row', db: 'db-nordlicht', kinds: K.PROPS, ops: 1, g: `${S}|s1`, lh: 'L1', ...over })
  const foreign = (over: Partial<Foreign> = {}): Foreign => ({ from: 5000, lane: 'you', w: 'you~ui', touched: ['p:stage'], seg: `${S}|f1`, open: false, ...over })
  const place = (over: Partial<PlaceWindow> = {}): PlaceWindow => ({ p: 'p:r1', pk: 'row', db: 'db-nordlicht', own: [seg()], foreign: [], ownEvents: [ev()], cut: false, ...over })
  const now = (parts: Record<string, string> = LEFT.parts, over: Partial<NowDigest> = {}): NowDigest => ({ exists: true, h: 'L1', parts, key: 'k', ...over })
  const data = (places: PlaceWindow[], over: Partial<WindowData> = {}): WindowData => ({ sel: SEL, places: new Map(places.map((w) => [w.p, w])), runs: {}, lostTails: [], ejects: [], schemaEvents: new Map(), ...over })
  const input = (d: WindowData, nows: Record<string, NowDigest>, over: Partial<Omit<VerdictInput, 'db'>> & { db?: Partial<VerdictInput['db']> } = {}): VerdictInput => ({
    data: d,
    now: new Map(Object.entries(nows) as Array<[`p:${string}`, NowDigest]>),
    empty: (k) => `E(${k})`,
    kitComputed: (_db, prop) => prop === 'kit',
    readOnly: { pageLocked: () => false, dbLocked: () => false, ...over.readOnly },
    db: {
      system: () => undefined,
      pipelineRole: () => undefined,
      props: () => [{ id: 'title', type: 'title' }, { id: 'stage', type: 'select' }, { id: 'est', type: 'number' }, { id: 'kit', type: 'number' }, { id: 'uid', type: 'unique_id' }],
      ...over.db,
    },
  })
  const one = (w: PlaceWindow, n: NowDigest | null = now(), over: Parameters<typeof input>[2] = {}, d: Partial<WindowData> = {}) => verdicts(input(data([w], d), n ? { [w.p]: n } : {}, over)).get(w.p)!

  test('rows: back when nothing changed since; held whole when changed since or interleaved — with who and when', () => {
    expect(one(place())).toMatchObject({ outcome: 'back', ops: 1, span: [2000, 2000], changes: ['c5'], by: [] })
    expect(one(place(), now({ ...LEFT.parts, 'p:stage': 'S2' }))).toMatchObject({ outcome: 'held', reason: 'changed' })
    const after = one(place({ foreign: [foreign({ from: 5000 })] }))
    expect(after).toMatchObject({ outcome: 'held', reason: 'changed', by: [{ lane: 'you', at: 5000 }], firstForeignAt: 5000 })
    const within = one(place({ foreign: [foreign({ from: 2500, touched: ['p:est'] })] }))
    expect(within).toMatchObject({ outcome: 'held', reason: 'interleaved', firstForeignAt: 2500 })
    // the order, a kit-computed value, a back-filled unique_id (added after W's end), a property deleted since: no one's change of the row
    const uidEvent: JEvent = { k: `${S}|4000|v9|0`, s: S, at: 4000, v: 'v9', w: 'you', l: 'you', p: 's:db-nordlicht', pk: 'schema', kinds: K.SCHEMA, ops: 1, g: 'g9', lh: '-', x: [{ part: 'prop+', prop: { id: 'uid', name: 'ID', type: 'unique_id' } }] }
    const uidAdded = new Map<string, JEvent[]>([['db-nordlicht', [uidEvent]]])
    for (const touched of [['o'], ['p:kit'], ['p:uid'], ['p:gone']]) expect(one(place({ foreign: [foreign({ touched })] }), now(), {}, { schemaEvents: uidAdded }).outcome, touched.join()).toBe('back')
    // an open foreign segment (Δ11: '*') and a virtual one (lane null) never are
    expect(one(place({ foreign: [foreign({ touched: '*', open: true })] })).outcome).toBe('held')
    expect(one(place({ foreign: [foreign({ lane: null, w: null, touched: ['o'] })] })).outcome).toBe('held')
    // a kit-computed value that changed since, or the order: still back; a value property absent now and empty then: equal
    expect(one(place(), now({ ...LEFT.parts, 'p:kit': 'K9', o: 'O7' })).outcome).toBe('back')
    expect(one(place({ own: [seg({ left: { h: 'L1', parts: { ...LEFT.parts, 'p:note': 'E(p:note)' } } })] })).outcome).toBe('back')
  })

  test('rows: NEW unchanged → trash, changed → held; an old NEW record without parts compares its whole digest', () => {
    const fresh = place({ own: [seg({ f: F.NEW, before: null, touched: '*' })], ownEvents: [ev({ kinds: K.CREATE, f: F.NEW })] })
    expect(one(fresh)).toMatchObject({ outcome: 'trash' })
    expect(one(fresh, now({ ...LEFT.parts, t: 'T2' }))).toMatchObject({ outcome: 'held', reason: 'changed' })
    const old = place({ own: [seg({ f: F.NEW, before: null, touched: '*', left: { h: 'L1', parts: {} } })] })
    expect(one(old, now({}, { h: 'L1' })).outcome).toBe('trash')
    expect(one(old, now({}, { h: 'L9' })).outcome).toBe('held')
    // W trashed it: going back restores it
    expect(one(place({ ownEvents: [ev({ kinds: K.TRASH })] })).outcome).toBe('restore')
    // gone for good now: held; W deleted it: recreate (planned for later slices)
    expect(one(place(), null)).toMatchObject({ outcome: 'held', reason: 'changed' })
    expect(one(place({ own: [seg({ f: F.GONE })] }), null).outcome).toBe('recreate')
  })

  test('rows: sent, memory, pipeline (Δ25), moved, page lock', () => {
    expect(one(place({ ownEvents: [ev({ w: 'you~outbox:slip-1' })] }))).toMatchObject({ outcome: 'held', reason: 'sent' })
    expect(one(place(), now(), { db: { system: () => 'memory' } })).toMatchObject({ outcome: 'held', reason: 'memory' })
    expect(one(place(), now(), { db: { system: () => 'memory-log' } }).reason).toBe('memory')
    const roles: Record<string, string | null> = { stage: 'stage', est: 'priority', kit: null }
    const pipeline = { db: { pipelineRole: (_db: string, prop: string) => roles[prop] ?? null } }
    expect(one(place(), now(), pipeline)).toMatchObject({ outcome: 'held', reason: 'pipeline' })
    expect(one(place({ own: [seg({ touched: ['p:est', 't', 'c'] })] }), now(), pipeline).outcome).toBe('back')
    expect(one(place({ own: [seg({ touched: ['tr'] })] }), now(), pipeline).reason).toBe('pipeline')
    expect(one(place({ own: [seg({ touched: ['p:kit'] })] }), now(), pipeline).reason).toBe('pipeline')
    expect(one(place({ own: [seg({ f: F.NEW, before: null, touched: '*' })] }), now(), pipeline).outcome).toBe('trash')
    expect(one(place({ ownEvents: [ev({ kinds: K.MOVE, mv: ['db-nordlicht', 'db-tessera'] })] }))).toMatchObject({ outcome: 'held', reason: 'moved' })
    expect(one(place({ ownEvents: [ev({ pk: 'page' }), ev({ k: `${S}|2500|v2|0`, at: 2500, v: 'v2' })] })).reason).toBe('moved')
    expect(one(place(), now(), { readOnly: { pageLocked: () => true, dbLocked: () => false } }).reason).toBe('pageLocked')
  })

  test('order: unavailable → open → cut → already → partial (no before, no left, batch)', () => {
    expect(one(place({ unavailable: true })).outcome).toBe('skip')
    expect(one(place({ own: [seg({ o: 1, left: null })] }))).toMatchObject({ outcome: 'partial', reason: 'open' })
    expect(one(place({ cut: true }))).toMatchObject({ outcome: 'partial', reason: 'cut' })
    const rec = (over: Partial<EjectRecord> = {}): EjectRecord => ({ id: 'e1', s: S, at: 9500, tab: 't1', writer: RUN, lane: LANE, a: 1000, b: 9000, state: 'done', outcomes: {}, segs: [`${S}|s1`], targets: {}, changes: {}, counts: { ops: 0, all: 0, back: 0, held: 0, partial: 0, already: 0, rows: 0, newRows: 0, pages: 0, schema: 0, views: 0 }, versionAt: 9500, ...over })
    expect(one(place(), now(), {}, { ejects: [rec()] })).toMatchObject({ outcome: 'already', reason: 'alreadyEjected' })
    // an undone eject, or one that missed a segment of the place, is no "already"
    expect(one(place(), now(), {}, { ejects: [rec({ undone: 9600 })] }).outcome).toBe('back')
    expect(one(place({ own: [seg(), seg({ id: `${S}|s2`, from: 3500, to: 3600 })] }), now(), {}, { ejects: [rec()] }).outcome).toBe('back')
    expect(one(place({ own: [seg({ before: null })] }))).toMatchObject({ outcome: 'partial', reason: 'noBefore' })
    expect(one(place({ own: [seg({ left: null })] }))).toMatchObject({ outcome: 'partial', reason: 'noLeft' })
    expect(one(place({ own: [seg({ f: F.BATCH })] }))).toMatchObject({ outcome: 'partial', reason: 'batch' })
  })

  test('pages part by part: held only when every block W touched is held; schema of a locked database held', () => {
    const left = { h: 'P1', parts: { t: 'T', i: '', tr: '0', pa: 'PA', o: 'O', cv: 'null' }, blocks: ['rh=d0', 'r1=d1', 'r2=d2'] }
    const pg = (touched: string[]) => place({ p: 'p:report', pk: 'page', db: undefined, own: [seg({ p: 'p:report', pk: 'page', db: undefined, left, touched })], ownEvents: [ev({ p: 'p:report', pk: 'page', kinds: K.CONTENT })] })
    const n = (blocks: string[], parts = left.parts) => ({ exists: true, h: 'P2', parts, blocks, key: 'k' })
    expect(one(pg(['b:r1', 'b:r2', 'bo']), n(['rh=d0', 'r1=d1', 'r2=d2'])).outcome).toBe('back')
    expect(one(pg(['b:r1', 'b:r2']), n(['rh=d0', 'r1=x1', 'r2=d2'])).outcome).toBe('back')
    expect(one(pg(['b:r1', 'b:r2']), n(['rh=d0', 'r1=x1', 'r2=x2']))).toMatchObject({ outcome: 'held', reason: 'changed' })
    expect(one(pg(['t']), n(left.blocks, { ...left.parts, t: 'T2' })).outcome).toBe('held')
    const sch = place({ p: 's:db-nordlicht', pk: 'schema', own: [seg({ p: 's:db-nordlicht', pk: 'schema', left: { h: 'D1', parts: { 'o:stage/o-ready': 'X', 'oo:stage': 'Y' } }, touched: ['o:stage/o-ready', 'oo:stage'] })] })
    expect(one(sch, { exists: true, h: 'D1', parts: { 'oo:stage': 'Y' }, key: 'k' }).outcome).toBe('back')
    expect(one(sch, now(), { readOnly: { pageLocked: () => false, dbLocked: () => true } })).toMatchObject({ outcome: 'held', reason: 'locked' })
  })

  test('chains: synced copies of W and an undone eject of W are transparent; a break the loader cannot explain is a virtual foreign', () => {
    const own = new Set([`${S}|s1`, `${S}|s3`])
    const s1 = seg()
    const copyOfW = seg({ id: `${S}|c1`, w: `synced<${RUN}#c5`, cause: `${RUN}#c5`, sk: `synced<${RUN}#c5`, l: LANE, f: F.COPY, from: 3100, to: 3100, bh: 'L1', left: { h: 'L1', parts: {} } })
    const copyOther = seg({ id: `${S}|c2`, w: 'synced<you~ui', cause: 'you~ui', sk: 'synced<you~ui', l: 'you', f: F.COPY, from: 3200, to: 3200, bh: 'L1', left: { h: 'L1', parts: {} } })
    const eject = seg({ id: `${S}|e1`, w: `eject:e7>${RUN}`, sk: `eject:e7>${RUN}`, l: 'undo', r: 'eject:e7', from: 3300, to: 3300, bh: 'L1', left: { h: 'L0', parts: {} } })
    const undo = seg({ id: `${S}|u1`, w: 'you~undo:e7', sk: 'you~undo:e7', l: 'undo', r: undefined, from: 3400, to: 3400, bh: 'L0', left: { h: 'L1', parts: {} } })
    const s3 = seg({ id: `${S}|s3`, from: 3500, to: 3600, bh: 'L1' })
    const sel = { lane: LANE, run: RUN }
    const { chain, breaks } = placeChain(sel, [s3, undo, eject, copyOther, copyOfW, s1], own, new Set(['e7']))
    expect(chain.map((g) => g.id)).toEqual([`${S}|s1`, `${S}|c2`, `${S}|s3`])
    expect(breaks).toEqual([])
    expect(foreignOf(chain, own, new Set())).toEqual([{ from: 3200, lane: 'you', w: 'synced<you~ui', touched: ['p:stage'], seg: `${S}|c2`, open: false }])
    // the eject is live (not undone): its segments are someone else's — and the chain breaks where nothing explains it
    const live = placeChain(sel, [s1, eject, s3], own, new Set())
    expect(live.chain.map((g) => g.id)).toEqual([`${S}|s1`, `${S}|e1`, `${S}|s3`])
    expect(live.breaks.map(([, n]) => n.id)).toEqual([`${S}|s3`])
    expect(foreignOf(live.chain, own, new Set([`${S}|s3`])).map((f) => [f.lane, f.from])).toEqual([['undo', 3300], [null, 3500]])
    // bhr explains a property added in between; an open foreign segment touched anything; a GAP after W's first is virtual
    expect(placeChain(sel, [s1, seg({ id: `${S}|s3`, from: 3500, bh: 'Lx', bhr: 'L1' })], own, new Set()).breaks).toEqual([])
    const open = seg({ id: `${S}|o1`, w: 'you~ui', sk: 'you', l: 'you', r: undefined, from: 3300, to: 3300, bh: 'L1', left: null, o: 1, touched: [], lastLh: 'L1' })
    const f = foreignOf(placeChain(sel, [s1, open, seg({ id: `${S}|s3`, from: 3500, bh: 'L1', f: F.GAP })], own, new Set()).chain, own, new Set())
    expect(f).toEqual([
      { from: 3300, lane: 'you', w: 'you~ui', touched: '*', seg: `${S}|o1`, open: true },
      { from: 3500, lane: null, w: null, touched: '*', seg: `${S}|s3`, open: false },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* window/report.ts (the incident report)                              */
/* ------------------------------------------------------------------ */

test.describe('the incident report', () => {
  const S = 'local:local' as const
  const tOf = (lang: 'en' | 'de') => (key: string, vars?: Record<string, string | number>) => {
    let out = (recorderMessages[lang] as Record<string, string>)[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) out = out.split(`{${k}}`).join(String(v))
    return out
  }
  const T = (hms: string) => new Date(`2026-10-09T${hms}+02:00`).getTime()
  // the parts carry the canonical value strings here (they are digests on the tape): the report must never print them
  const secretParts = { t: '"NL-1408"', 'p:stage': '"o-doing"', 'p:note': '"Lindenweg 12"', 'p:est': '98765.4321', c: 'Nordlicht-Geheimwert-7' }
  const seg = (p: string, touched: string[] | '*', f = 0): JSegment => ({ id: `${S}|${p}`, s: S, p: p as `p:${string}`, pk: 'row', db: 'db-n', w: 'agent:x:r1', sk: 'agent:x:r1', l: 'agent:x', r: 'agent:x:r1', from: T('07:31:04'), to: T('07:34:00'), n: 1, before: 'pin', bh: 'b', left: { h: 'h', parts: secretParts }, lastLh: 'h', touched, tab: 't', f })
  const ev = (p: string, at: string, x?: JEvent['x']): JEvent => ({ k: `${S}|${p}|${at}`, s: S, at: T(at), v: at, w: 'agent:x:r1', l: 'agent:x', r: 'agent:x:r1', p: p as `p:${string}`, pk: x ? 'schema' : 'row', db: 'db-n', kinds: x ? K.SCHEMA : K.PROPS, ops: 1, g: `${S}|${p}`, lh: 'h', ...(x ? { x } : {}) })
  const verdict = (p: string, pk: 'row' | 'page' | 'schema', outcome: 'back' | 'held' | 'trash') => ({ p: p as `p:${string}`, pk, outcome, by: [], ops: 1, span: [0, 0] as [number, number], changes: [] })
  const model = (): ReadModel => {
    const places = new Map<string, PlaceWindow>([
      ['p:r1', { p: 'p:r1', pk: 'row', db: 'db-n', own: [seg('p:r1', ['p:stage', 'p:note', 't'])], foreign: [], ownEvents: [ev('p:r1', '07:31:12')], cut: false }],
      ['p:r2', { p: 'p:r2', pk: 'row', db: 'db-n', own: [seg('p:r2', '*', F.NEW)], foreign: [], ownEvents: [ev('p:r2', '07:33:00')], cut: false }],
      ['s:db-n', { p: 's:db-n', pk: 'schema', db: 'db-n', own: [{ ...seg('s:db-n', ['o:stage/o-ready']), pk: 'schema' }], foreign: [], ownEvents: [ev('s:db-n', '07:32:16', [{ part: 'opt-', prop: { id: 'stage', name: 'Stage', type: 'select' }, opt: { id: 'o-ready', name: 'Ready' } }])], cut: false }],
      ['p:rep', { p: 'p:rep', pk: 'page', own: [{ ...seg('p:rep', ['b:r1']), pk: 'page' }], foreign: [], ownEvents: [ev('p:rep', '07:34:41')], cut: false }],
    ] as Array<[string, PlaceWindow]>)
    const item = (p: string, pk: 'row' | 'page' | 'schema', act: 'changed' | 'new', at: string, text: boolean, words: [number, number] = [0, 0]) => ({ p: p as `p:${string}`, pk, db: pk === 'page' ? undefined : 'db-n', act, verdict: verdict(p, pk, 'back'), at: T(at), words, values: 2, text })
    return {
      sel: { scope: S, lane: 'agent:x', run: 'agent:x:r1', a: T('07:30:00'), b: T('07:35:00') },
      data: { sel: { scope: S, lane: 'agent:x', run: 'agent:x:r1', a: T('07:30:00'), b: T('07:35:00') }, places: places as WindowData['places'], runs: {}, lostTails: [], ejects: [], schemaEvents: new Map() },
      now: new Map(),
      meters: { ops: 52, places: { all: 37, rows: 35, newRows: 3, pages: 1, schema: 1, views: 0 }, words: [212, 40] },
      verdicts: new Map(),
      groups: [
        { kind: 'schema', items: [item('s:db-n', 'schema', 'changed', '07:32:16', false)] },
        { kind: 'pages', items: [item('p:rep', 'page', 'changed', '07:34:41', true, [212, 0])] },
        { kind: 'rows', items: [item('p:r1', 'row', 'changed', '07:31:12', true)] },
        { kind: 'newRows', items: [item('p:r2', 'row', 'new', '07:33:00', false)] },
      ],
      held: [verdict('p:r1', 'row', 'held') as never],
      partial: [],
      incomplete: true,
      unavailable: 0,
    }
  }
  const facts: ReportFacts = {
    workspace: 'Nordlicht Werk',
    writer: 'Agent · Nordlicht-Spiegel',
    seq: 212,
    writers: [{ label: 'Agent · Nordlicht-Spiegel', ops: 52, places: 37, first: T('07:31:04'), last: T('07:34:41') }, { label: 'You · Mara Lind', ops: 3, places: null, first: T('07:31:30'), last: T('07:33:10') }],
    title: (p) => ({ 'p:r1': 'NL-1408 | Export', 'p:r2': 'NL-1432', 'p:rep': 'Nordlicht-Spiegel · Bericht', 's:db-n': 'Nordlicht Handoff' })[p] ?? '',
    rowKey: () => null,
    dbTitle: () => 'Nordlicht Handoff',
    propName: (_db, prop) => ({ stage: 'Stage', note: 'Notiz' })[prop] ?? null,
    propIndex: (_db, prop) => ({ stage: 0, note: 1 })[prop] ?? -1,
  }

  test('headings, the window, every writer, schema names, pages, rows (property NAMES), notes — EN and DE; never a value or content', () => {
    // times are local (the report reads them as the person's clock does)
    const tz = process.env.TZ
    process.env.TZ = 'Europe/Berlin'
    test.info().annotations.push({ type: 'tz', description: 'Europe/Berlin' })
    try {
      run()
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
  function run() {
    for (const lang of ['en', 'de'] as const) {
      const { md, file } = incidentReport(model(), facts, { t: tOf(lang), lang, tz: 'Europe/Berlin', now: T('08:06:00') })
      expect(file).toBe('incident-2026-10-09-0730-agent-x.md')
      const h = lang === 'de'
        ? ['# Vorfallbericht · Nordlicht Werk · Fr 09.10. 07:30–07:34', '## Fenster', '## Alle Schreiber in diesem Zeitraum', '## Was sich geändert hat', '### Schema', '### Seiten', '### Zeilen', '## Hinweise']
        : ['# Incident report · Nordlicht Werk · Fri 9 Oct 07:30–07:34', '## Window', '## All writers in this span', '## What changed', '### Schema', '### Pages', '### Rows', '## Notes']
      for (const x of h) expect(md, `${lang}: ${x}`).toContain(x)
      expect(md).toContain(lang === 'de' ? 'Schreiber: Agent · Nordlicht-Spiegel (Lauf 212)' : 'Writer: Agent · Nordlicht-Spiegel (run 212)')
      expect(md).toContain(lang === 'de' ? '52 Vorgänge an 37 Stellen: 35 Zeilen (3 neu) · 1 Seite · 1 Schema · +212 −40 Wörter' : '52 writes at 37 places: 35 rows (3 new) · 1 page · 1 schema · +212 −40 words')
      expect(md).toContain('| Agent · Nordlicht-Spiegel | 52 | 37 | 07:31 | 07:34 |')
      expect(md).toContain('| You · Mara Lind | 3 | … | 07:31 | 07:33 |')
      expect(md).toContain(lang === 'de' ? '- Nordlicht Handoff · Stage · Option „Ready“ entfernt · 07:32:16' : '- Nordlicht Handoff · Stage · option “Ready” removed · 07:32:16')
      expect(md).toContain(lang === 'de' ? '- Nordlicht-Spiegel · Bericht · Text +212 −0 Wörter · 07:34' : '- Nordlicht-Spiegel · Bericht · text +212 −0 words · 07:34')
      // a title with a pipe stays one cell; the changed properties by name
      expect(md).toMatch(/\| NL-1408 \\\| Export \| Nordlicht Handoff \| (Titel|title|Title), Stage, Notiz \| (ja|yes) \| 07:31 \|/)
      expect(md).toContain(lang === 'de' ? '| NL-1432 | Nordlicht Handoff | neu | — | 07:33 |' : '| NL-1432 | Nordlicht Handoff | new | — | 07:33 |')
      expect(md).toContain(lang === 'de' ? 'Möglicherweise unvollständig' : 'Possibly incomplete')
      for (const secret of ['Lindenweg 12', '98765.4321', 'Nordlicht-Geheimwert-7', 'o-doing', '"NL-1408"']) expect(md, secret).not.toContain(secret)
    }
    expect(reportFile({ sel: { scope: S, lane: 'mcp:tessera-desk', a: T('07:48:00'), b: T('07:50:00') } })).toBe('incident-2026-10-09-0748-mcp-tessera-desk.md')
  }
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
    // the lead label cut on the left goes right of the window when it fits there, else it is left out
    expect(settleLabels([{ anchor: 100, w: 120, shift: -144, flipGap: 0, flips: false, alt: 320 }], view, null)[0]).toEqual({ flip: false, hidden: false, left: 320 })
    expect(settleLabels([{ anchor: 100, w: 120, shift: -144, flipGap: 0, flips: false, alt: 520 }], view, null)[0].hidden).toBe(true)
  })

  test('heads align inward at the edges, "Jetzt →" pinned off to the right; ruler labels under a head are hidden', () => {
    expect(settleHead(300, 60, view)).toEqual({ place: 'center', left: 270, right: 330 })
    expect(settleHead(10, 60, view)).toEqual({ place: 'edge-r', left: 10, right: 70 })
    expect(settleHead(590, 60, view)).toEqual({ place: 'edge-l', left: 530, right: 590 })
    expect(settleHead(700, 70, view, 'now')).toEqual({ place: 'pinned', left: 528, right: 598 })
    expect(settleHead(560, 50, view, 'now')).toEqual({ place: 'edge-l', left: 506, right: 556 })
    expect(settleHead(300, 50, view, 'now')).toEqual({ place: 'center', left: 304, right: 354 })
    expect(underHeads([{ left: 250, right: 280 }, { left: 333, right: 360 }, { left: 335, right: 360 }, { left: 100, right: 130 }, { left: 240, right: 266 }], [{ left: 270, right: 330 }])).toEqual([true, true, false, false, true])
  })

  test('a ruler label cut at either visible edge is hidden, never shown half (the 1024 px XL case: "09:40" at the right edge)', () => {
    const labels = [{ left: -10, right: 20 }, { left: 0, right: 30 }, { left: 250, right: 280 }, { left: 560, right: 600 }, { left: 575, right: 615 }]
    expect(hiddenRulerLabels(labels, [], view)).toEqual([true, false, false, false, true])
    // under a head too
    expect(hiddenRulerLabels(labels, [{ left: 270, right: 330 }], view)).toEqual([true, false, true, false, true])
  })
})

/* ------------------------------------------------------------------ */
/* R3 — the eject                                                      */
/* ------------------------------------------------------------------ */

test.describe('applyRewind (E1): the one write of an eject', () => {
  const T = 5_000_000
  const rowP = (over: Partial<Page> = {}) => page({ id: 'nl1402', parentId: 'db-nordlicht', databaseId: 'db-nordlicht', title: 'NL-1402', ...over })
  const state = (pages: Page[], dbs: Database[] = [database()], recent: string[] = []) => ({ pages: Object.fromEntries(pages.map((p) => [p.id, p])), databases: Object.fromEntries(dbs.map((d) => [d.id, d])), recent })

  test('refusals: the guard, an id that does not exist now, a locked database whose schema would change, a page locked now', () => {
    try {
      setRewindGuard(() => false)
      expect(rewindAllowed()).toBe(false)
    } finally {
      setRewindGuard(() => true)
    }
    expect(rewindAllowed()).toBe(true)
    const cur = state([page(), rowP()])
    expect(rewindState(cur, { pages: { gone: page({ id: 'gone' }) } }, 'eject', T)).toBeNull()
    expect(rewindState(cur, { databases: { 'db-other': database({ id: 'db-other' }) } }, 'eject', T)).toBeNull()
    // an id that does not match its key
    expect(rewindState(cur, { pages: { nl1398: page({ id: 'nl1402' }) } }, 'eject', T)).toBeNull()
    const locked = state([page()], [database({ locked: true })])
    expect(rewindState(locked, { databases: { 'db-nordlicht': database({ locked: true, views: [] }) } }, 'eject', T)).toBeNull()
    expect(rewindState(locked, { databases: { 'db-nordlicht': database({ locked: false }) } }, 'eject', T)).toBeNull()
    // the same schema: a locked database may still be patched (nothing of its schema changes)
    expect(rewindState(locked, { databases: { 'db-nordlicht': database({ locked: true, nextUniqueId: 7 }) } }, 'eject', T)).not.toBeNull()
    const lockedPage = state([page({ settings: { fullWidth: false, smallText: false, font: 'sans', locked: true } })])
    expect(rewindState(lockedPage, { pages: { nl1398: page({ title: 'Nordlicht' }) } }, 'eject', T)).toBeNull()
  })

  test('a patched page keeps what is not a part from the page now; content by reference gets a revision, its origin and its text', () => {
    const content = docOf(para('Bericht', 'rh'))
    const now = page({ content, contentRev: 4, contentOrigin: 'ed1', plain: 'Bericht\n', comments: [{ id: 'cm1', quote: 'Bericht', body: 'Mara Lind fragt nach', createdAt: 9, resolved: false } as never], private: true, createdBy: 'acct-mara', hidden: true, favorite: true, settings: { fullWidth: true, smallText: false, font: 'serif', locked: false } })
    const cur = state([now])
    // a title only: the content's revision stays
    const a = rewindState(cur, { pages: { nl1398: { ...now, title: 'Nordlicht-Spiegel · Bericht', comments: undefined, private: undefined, settings: page().settings, updatedBy: 'agent:x' } } }, 'eject', T)!
    const pa = a.pages.nl1398
    expect(pa).toMatchObject({ title: 'Nordlicht-Spiegel · Bericht', contentRev: 4, contentOrigin: 'ed1', plain: 'Bericht\n', private: true, createdBy: 'acct-mara', hidden: true, favorite: true, updatedAt: T, updatedBy: 'agent:x' })
    expect(pa.comments).toHaveLength(1)
    expect(pa.settings.font).toBe('serif')
    expect(Object.isFrozen(pa) && Object.isFrozen(a.pages)).toBe(true)
    expect(a.changed).toEqual(['nl1398'])
    // content by reference: a new revision, the writer as its origin, the text from it; the stamp from the patch (none: null)
    const back = docOf(para('Bericht', 'rh'), para('Absatz eins', 'p1'))
    const b = rewindState(cur, { pages: { nl1398: { ...now, content: back, updatedBy: undefined } } }, 'eject', T)!.pages.nl1398
    expect(b).toMatchObject({ contentRev: 5, contentOrigin: 'eject', updatedBy: null })
    expect(b.plain).toContain('Absatz eins')
    // untouched pages keep their objects
    const two = state([now, rowP()])
    expect(rewindState(two, { pages: { nl1398: { ...now, title: 'x' } } }, 'eject', T)!.pages.nl1402).toBe(two.pages.nl1402)
  })

  test('trash and restore as the store does them: favourite off, recent pruned; a restored page under a trashed parent goes to the root, a row stays in its database', () => {
    const parent = page({ id: 'parent', trashed: true, trashedAt: 3 })
    const child = page({ id: 'child', parentId: 'parent', trashed: true, trashedAt: 3 })
    const row = rowP({ trashed: true, trashedAt: 3 })
    const dbPage = page({ id: 'db-nordlicht', kind: 'database', trashed: true, trashedAt: 3 })
    const fav = page({ id: 'fav', favorite: true })
    const cur = state([parent, child, row, dbPage, fav], [database()], ['fav', 'child'])
    const next = rewindState(cur, { pages: { child: { ...child, trashed: false }, nl1402: { ...row, trashed: false }, fav: { ...fav, trashed: true } } }, 'eject', T)!
    expect(next.pages.child).toMatchObject({ trashed: false, trashedAt: null, parentId: null })
    expect(next.pages.nl1402).toMatchObject({ trashed: false, trashedAt: null, parentId: 'db-nordlicht', databaseId: 'db-nordlicht' })
    expect(next.pages.fav).toMatchObject({ trashed: true, trashedAt: T, favorite: false })
    expect(next.recent).toEqual(['child'])
    expect(next.changed.sort()).toEqual(['child', 'fav', 'nl1402'])
    // a parent restored in the same update keeps its child under it
    const both = rewindState(cur, { pages: { parent: { ...parent, trashed: false }, child: { ...child, trashed: false } } }, 'eject', T)!
    expect(both.pages.child.parentId).toBe('parent')
    // a database is replaced whole (its id kept); the map is new, the others are the same objects
    const dbs = rewindState(cur, { databases: { 'db-nordlicht': database({ views: [] }) } }, 'eject', T)!
    expect(dbs.databases['db-nordlicht'].views).toEqual([])
    expect(dbs.pages).toBe(cur.pages)
    expect(dbs.changed).toEqual([])
  })
})

test.describe('history for the eject (E2): forced versions, thinning, the restore plan', () => {
  const MIN = 60_000
  const D = 24 * 60 * MIN
  const NOW = 100 * D
  const meta = (id: string, at: number, reason: SnapshotMeta['reason'] = 'auto'): SnapshotMeta => ({ id, pageId: 'nl1402', at, reason, title: 'NL-1402', words: 3, blocks: 1, hash: id })

  test('thinning: "before the eject" versions younger than 30 days keep their own bucket; the cap drops other versions first', () => {
    // two versions in the same hour, 3 days ago: one bucket — unless one is an eject's
    const auto = [meta('a1', NOW - 3 * D), meta('a2', NOW - 3 * D + MIN)]
    const filler = Array.from({ length: 99 }, (_, i) => meta(`f${i}`, NOW - 50 * MIN + i * 10_000))
    expect(thinSnapshots([...auto, ...filler], 100, NOW).drop.map((m) => m.id)).toEqual(['a1'])
    const withEject = [meta('a1', NOW - 3 * D, 'eject'), meta('a2', NOW - 3 * D + MIN), ...filler]
    const kept = thinSnapshots(withEject, 100, NOW)
    expect(kept.keep.map((m) => m.id)).toContain('a1')
    // over the cap: the oldest non-eject version goes, the older eject version stays
    expect(kept.drop.map((m) => m.id)).toEqual(['a2'])
    // older than 30 days an eject version is thinned like any other
    const old = [meta('e1', NOW - 40 * D, 'eject'), meta('e2', NOW - 40 * D + MIN), ...filler]
    expect(thinSnapshots(old, 100, NOW).drop.map((m) => m.id)).toEqual(['e1'])
  })

  test('planRestoreProps: the values that differ and may go back; deleted / type / option left alone and named; multi-select drops deleted options', () => {
    const db = database({ properties: [{ id: 'title', name: 'Name', type: 'title' }, statusProp, { id: 'est', name: 'Schätzung', type: 'number' }, { id: 'labels', name: 'Labels', type: 'multi_select', options: [{ id: 'l-export', name: 'Export', color: 'red' }] }, { id: 'uid', name: 'ID', type: 'unique_id' }, { id: 'note', name: 'Notiz', type: 'text' }] })
    const row = page({ id: 'nl1402', databaseId: 'db-nordlicht', parentId: 'db-nordlicht', properties: { stage: 'o-backlog', est: 5, labels: [], uid: 7, note: 'heute' } })
    const props: SnapshotProps = {
      databaseId: 'db-nordlicht',
      values: { stage: 'o-ready', est: 5, labels: ['l-export', 'l-gone'], uid: 3, gone: 'x' },
      defs: [
        { id: 'stage', name: 'Stage', type: 'select', options: statusProp.options },
        { id: 'est', name: 'Schätzung', type: 'number' },
        { id: 'labels', name: 'Labels', type: 'multi_select' },
        { id: 'uid', name: 'ID', type: 'unique_id' },
        { id: 'gone', name: 'Alt', type: 'text' },
        { id: 'note', name: 'Notiz', type: 'text' },
      ],
    }
    const plan = planRestoreProps(row, props, db)
    // est is equal; uid never goes back; note was empty then (a snapshot leaves empty values out): it goes back empty
    expect(plan.values).toEqual({ stage: 'o-ready', labels: ['l-export'], note: null })
    expect(plan.notRestored).toEqual([
      { name: 'Labels', reason: 'option' },
      { name: 'Alt', reason: 'deleted' },
    ])
    expect(plan.skipped).toEqual(['labels', 'gone'])
    // a select whose option is gone now; a type changed to an incompatible one
    const noReady = database({ properties: [{ ...statusProp, options: statusProp.options!.filter((o) => o.id !== 'o-ready') }, { id: 'est', name: 'Schätzung', type: 'checkbox' }] })
    const p2 = planRestoreProps(row, { databaseId: 'db-nordlicht', values: { stage: 'o-ready', est: 3 }, defs: [props.defs[0], props.defs[1]] }, noReady)
    expect(p2.values).toEqual({})
    expect(p2.notRestored.map((n) => n.reason)).toEqual(['option', 'type'])
    // another database (the row moved): every kept value is "deleted"
    expect(planRestoreProps({ ...row, databaseId: 'db-other' }, props, db).notRestored.map((n) => n.name)).toEqual(['Stage', 'Schätzung', 'Labels', 'Alt'])
  })
})

test.describe('relation checks for the eject (E3): over a planned state, no write to a row outside the plan', () => {
  const row = (id: string, dbId: string, properties: Page['properties'] = {}) => page({ id, parentId: dbId, databaseId: dbId, title: id, properties })
  // Tasks ⇄ Teams: a paired two-way relation; Tasks also has sub-items (parent ⇄ children, a self pair) and a one-way link
  const tasks = database({
    id: 'db-tasks',
    properties: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'team', name: 'Team', type: 'relation', relationDatabaseId: 'db-teams' },
      { id: 'parent', name: 'Übergeordnet', type: 'relation', relationDatabaseId: 'db-tasks' },
      { id: 'parent.2way', name: 'Unteraufgaben', type: 'relation', relationDatabaseId: 'db-tasks' },
      { id: 'see', name: 'Siehe', type: 'relation', relationDatabaseId: 'db-teams' },
    ],
    subItems: { enabled: true, parentPropertyId: 'parent', childPropertyId: 'parent.2way' },
  })
  const teams = database({ id: 'db-teams', properties: [{ id: 'title', name: 'Name', type: 'title' }, { id: 'team.2way', name: 'Aufgaben', type: 'relation', relationDatabaseId: 'db-tasks' }] })
  const prop = (id: string) => tasks.properties.find((p) => p.id === id)!
  const state = (pages: Page[]) => ({ pages: Object.fromEntries(pages.map((p) => [p.id, p])), databases: { 'db-tasks': tasks, 'db-teams': teams } })

  test('pairedRelationIn finds the explicit partner in the given databases', () => {
    expect(pairedRelationIn(state([]).databases, 'db-tasks', prop('team'))?.prop.id).toBe('team.2way')
    expect(pairedRelationIn(state([]).databases, 'db-tasks', prop('see'))).toBeNull()
  })

  test('a two-way value goes back only with every partner whose back-link it adds or drops', () => {
    const s = state([row('t1', 'db-tasks', { team: ['tm-b'] }), row('tm-a', 'db-teams', {}), row('tm-b', 'db-teams', { 'team.2way': ['t1'] })])
    // back to Team A: drops B, adds A — both partners must go back
    expect(relationRestoreOk(s, 'db-tasks', prop('team'), 't1', ['tm-a'], new Set(['t1', 'tm-a', 'tm-b']))).toBe(true)
    expect(relationRestoreOk(s, 'db-tasks', prop('team'), 't1', ['tm-a'], new Set(['t1', 'tm-a']))).toBe(false)
    // a one-way link: always
    expect(relationRestoreOk(s, 'db-tasks', prop('see'), 't1', ['tm-a'], new Set(['t1']))).toBe(true)
  })

  test('sub-items: a loop in the planned state, a second parent, a sub-item that has another parent → not restored', () => {
    // t2 is t1's sub-item now; t1 under t2 would loop
    const s = state([row('t1', 'db-tasks', { 'parent.2way': ['t2'] }), row('t2', 'db-tasks', { parent: ['t1'] }), row('t3', 'db-tasks', {}), row('t4', 'db-tasks', { parent: ['t3'] })])
    const all = new Set(['t1', 't2', 't3', 't4'])
    expect(invalidTargetsIn(s, 'db-tasks', prop('parent'), 't1')).toEqual(new Set(['t2', 't1']))
    expect(relationRestoreOk(s, 'db-tasks', prop('parent'), 't1', ['t2'], all)).toBe(false)
    expect(relationRestoreOk(s, 'db-tasks', prop('parent'), 't1', ['t3'], all)).toBe(true)
    expect(relationRestoreOk(s, 'db-tasks', prop('parent'), 't1', ['t3', 't4'], all)).toBe(false)
    // t4 has t3 as its parent: giving t1 the sub-item t4 would take it from t3
    expect(relationRestoreOk(s, 'db-tasks', prop('parent.2way'), 't1', ['t2', 't4'], all)).toBe(false)
    expect(relationRestoreOk(s, 'db-tasks', prop('parent.2way'), 't1', [], all)).toBe(true)
    // the same loop is fine once t2's link is gone in the planned state
    const planned = state([row('t1', 'db-tasks', {}), row('t2', 'db-tasks', {}), row('t3', 'db-tasks', {})])
    expect(relationRestoreOk(planned, 'db-tasks', prop('parent'), 't1', ['t2'], all)).toBe(true)
  })
})

test.describe('targets are overlays (E4)', () => {
  test('overlay: only the decided parts from before; a comment thread, a lock, a favourite and a privacy marker made since survive; the stamp', () => {
    const before = page({ id: 'nl1402', databaseId: 'db-nordlicht', parentId: 'db-nordlicht', title: 'NL-1402 alt', icon: { type: 'emoji', value: '📦' }, content: docOf(para('vorher')), properties: { stage: 'o-ready', est: 3 }, order: 1, recordType: 'rt-bug' })
    const cur = page({
      ...before,
      title: 'NL-1402 neu',
      icon: null,
      content: docOf(para('nachher')),
      properties: { stage: 'o-backlog', est: 5, note: 'Mara Lind' },
      order: 9,
      recordType: null,
      favorite: true,
      private: true,
      comments: [{ id: 'cm1' } as never],
      settings: { fullWidth: false, smallText: false, font: 'sans', locked: true },
      updatedBy: 'agent:x',
    })
    const out = overlay(cur, before, ['t', 'c', 'p:stage', 'p:note', 'r'], undefined, { stage: 'o-ready' })
    expect(out).toMatchObject({ title: 'NL-1402 alt', icon: null, order: 9, favorite: true, private: true, updatedBy: null, recordType: 'rt-bug' })
    expect(out.content).toBe(before.content)
    // p:note has no planned value: it keeps the one it has
    expect(out.properties).toEqual({ stage: 'o-ready', est: 5, note: 'Mara Lind' })
    expect(out.comments).toHaveLength(1)
    expect(out.settings.locked).toBe(true)
    // the working content of a page wins over 'c'; a pipeline row keeps its agent's stamp; trash with the date
    const working = docOf(para('gemischt'))
    const trashed = overlay({ ...cur, trashed: true, trashedAt: 77 }, before, ['tr', 'o', 'p:est'], working, undefined, 'agent:nordlicht-spiegel')
    expect(trashed).toMatchObject({ trashed: false, trashedAt: null, order: 1, updatedBy: 'agent:nordlicht-spiegel', properties: { stage: 'o-backlog', est: 3, note: 'Mara Lind' } })
    expect(trashed.content).toBe(working)
    const into = overlay(cur, { ...before, trashed: true, trashedAt: 12 }, ['tr', 'pa'])
    expect(into).toMatchObject({ trashed: true, trashedAt: 12, parentId: 'db-nordlicht', databaseId: 'db-nordlicht' })
  })

  test('overlayDb: definitions, options, orders, the lock and views part by part; a property the writer added taken out with its view settings', () => {
    const pin = database({
      properties: [{ id: 'title', name: 'Name', type: 'title' }, statusProp, { id: 'est', name: 'Schätzung', type: 'number' }],
      views: [view(), view({ id: 'v-table', name: 'Tabelle', type: 'table', groupBy: null })],
    })
    const cur = database({
      locked: true,
      properties: [
        { id: 'title', name: 'Name', type: 'title' },
        { id: 'est', name: 'Aufwand', type: 'number' },
        { ...statusProp, options: [{ id: 'o-done', name: 'Fertig', color: 'green' }, { id: 'o-backlog', name: 'Backlog', color: 'gray' }, { id: 'o-new', name: 'Neu', color: 'red' }] },
        { id: 'added', name: 'Notiz', type: 'text' },
      ],
      views: [view({ visibleProperties: ['stage', 'added'], sorts: [{ propertyId: 'added', direction: 'asc' }], filter: { op: 'and', items: [{ propertyId: 'added', operator: 'is_not_empty' }] } as never }), view({ id: 'v-new', name: 'Neu', type: 'list' })],
    })
    const out = overlayDb(
      cur,
      pin,
      [
        { part: 'p:added', op: 'remove' },
        { part: 'p:est', op: 'back' },
        { part: 'o:stage/o-ready', op: 'back' },
        { part: 'o:stage/o-done', op: 'back' },
        { part: 'o:stage/o-new', op: 'remove' },
        { part: 'oo:stage', op: 'back' },
        { part: 'po', op: 'back' },
        { part: 'l', op: 'back' },
        { part: 'v:v-new', op: 'remove' },
        { part: 'v:v-table', op: 'back' },
      ],
      { withoutProperty },
    )
    expect(out.properties.map((p) => p.id)).toEqual(['title', 'stage', 'est'])
    expect(out.properties.find((p) => p.id === 'est')!.name).toBe('Schätzung')
    // "Ready" back at index 1, "Erledigt" renamed back, "Neu" gone
    expect(out.properties.find((p) => p.id === 'stage')!.options!.map((o) => `${o.id}:${o.name}`)).toEqual(['o-backlog:Backlog', 'o-ready:Ready', 'o-done:Erledigt'])
    expect(out.locked).toBeUndefined()
    expect(out.views.map((v) => v.id)).toEqual(['v-board', 'v-table'])
    // the removed property left no view setting behind
    expect(out.views[0]).toMatchObject({ visibleProperties: ['stage'], sorts: [], filter: null })
    expect(cur.properties).toHaveLength(4)
    // a deleted property comes back at its pin index, with its options
    const gone = overlayDb(database({ properties: [{ id: 'title', name: 'Name', type: 'title' }, { id: 'est', name: 'Schätzung', type: 'number' }] }), pin, [{ part: 'p:stage', op: 'back' }], { withoutProperty })
    expect(gone.properties.map((p) => p.id)).toEqual(['title', 'stage', 'est'])
    expect(gone.properties[1].options).toHaveLength(3)
  })
})

test.describe('blocks for the eject (E5): hunks and where they sit now', () => {
  test('blockHunks: by id where blocks have one, else by digest; a changed block with its id is a hunk of its own; last in doc order first', () => {
    // b2 changed, n1 inserted after b3, b5 removed
    const before = ['b1=a', 'b2=b', 'b3=c', 'b5=e']
    const after = ['b1=a', 'b2=B', 'b3=c', 'n1=x']
    const h = blockHunks(before, after)
    expect(h.map((x) => [x.B, x.L])).toEqual([
      [['b5=e'], ['n1=x']],
      [['b2=b'], ['b2=B']],
    ])
    expect(h[0].anchors).toEqual(['b3=c', null])
    expect(h[1].anchors).toEqual(['b1=a', 'b3=c'])
    // id-less blocks pair by digest: an appended paragraph, a removed one
    const loose = blockHunks(['#=p', '#=q', '#=r'], ['#=p', '#=r', '#=s'])
    expect(loose.map((x) => [x.B, x.L, x.anchors])).toEqual([
      [[], ['#=s'], ['#=r', null]],
      [['#=q'], [], ['#=p', '#=r']],
    ])
    expect(blockHunks(['a=1'], ['a=1'])).toEqual([])
  })

  test('locateUnique: ids where present; id-less ranges by digests with both neighbours; none or several → null', () => {
    expect(locateUnique(['b1=a', 'b2=B', 'b3=c'], ['b2=B'], ['b1=a', 'b3=c'])).toEqual([1, 2])
    // the id is there, but not with the text the writer left: not this hunk any more
    expect(locateUnique(['b1=a', 'b2=Z', 'b3=c'], ['b2=B'], ['b1=a', 'b3=c'])).toBeNull()
    expect(locateUnique(['b1=a'], ['b2=B'], ['b1=a', null])).toBeNull()
    // id-less: "#=s" twice, only one between "#=r" and the end
    expect(locateUnique(['#=s', '#=r', '#=s'], ['#=s'], ['#=r', null])).toEqual([2, 3])
    expect(locateUnique(['#=r', '#=s', '#=r', '#=s'], ['#=s'], ['#=r', null])).toEqual([3, 4])
    // ambiguous: the same paragraph with the same neighbours twice
    expect(locateUnique(['#=r', '#=s', '#=t', '#=r', '#=s', '#=t'], ['#=s'], ['#=r', '#=t'])).toBeNull()
    // an empty range (blocks taken out): the gap between both neighbours; an id neighbour matches by id even if edited
    expect(locateUnique(['#=p', '#=r'], [], ['#=p', '#=r'])).toEqual([1, 1])
    expect(locateUnique(['h1=ZZ', '#=r'], [], ['h1=old', '#=r'])).toEqual([1, 1])
    expect(locateUnique(['#=p', '#=x', '#=r'], [], ['#=p', '#=r'])).toBeNull()
    // the doc's start and end are neighbours too
    expect(locateUnique(['#=s', '#=p'], ['#=s'], [null, '#=p'])).toEqual([0, 1])
  })
})

test.describe('the planner core (E6)', () => {
  const S = 'local:local' as const
  const LANE = 'agent:nordlicht-spiegel'
  const RUN = `${LANE}:r212`
  const SEL = { scope: S, lane: LANE, run: RUN, a: 1000, b: 90_000 }
  const DB = 'db-nordlicht'
  let n = 0
  const seg = (p: string, from: number, over: Partial<JSegment> = {}): JSegment => ({ id: `${S}|g${++n}`, s: S, p: p as JSegment['p'], pk: 'row', db: DB, w: `${RUN}#c${n}`, sk: RUN, l: LANE, r: RUN, from, to: from + 100, n: 1, before: `${p}|pin${n}`, bh: 'B', left: { h: 'L', parts: {} }, lastLh: 'L', touched: [], tab: 't1', f: 0, ...over })
  const evOf = (g: JSegment, kinds = K.PROPS): JEvent => ({ k: `${S}|${g.from}|v${g.id}|0`, s: S, at: g.from, v: `v${g.id}`, w: g.w, l: g.l, r: g.r, c: `c-${g.id.slice(-3)}`, p: g.p, pk: g.pk, ...(g.db ? { db: g.db } : {}), kinds, ops: 1, g: g.id, lh: g.left?.h ?? '-' })
  const win = (own: JSegment[], foreign: Foreign[] = []): PlaceWindow => ({ p: own[0].p, pk: own[0].pk, ...(own[0].db ? { db: own[0].db } : {}), own, foreign, ownEvents: own.map((g) => evOf(g, g.pk === 'page' ? K.CONTENT : g.pk === 'schema' ? K.SCHEMA : K.PROPS)), cut: false })
  const fr = (from: number, touched: string[] | '*', lane = 'you'): Foreign => ({ from, lane, w: lane === 'you' ? 'you~ui' : lane, touched, seg: `${S}|f${from}`, open: false })
  const nowD = (parts: Record<string, string>, blocks?: string[], over: Partial<NowDigest> = {}): NowDigest => ({ exists: true, h: 'L', parts, ...(blocks ? { blocks } : {}), key: 'k', ...over })
  const rowPage = (id: string, over: Partial<Page> = {}) => page({ id, parentId: DB, databaseId: DB, title: id, ...over })
  const stdDb = () => database({ id: DB })
  const pageMeta = (pg: Page, body: string | null, defs: SnapshotProps['defs'] | null = null): PinMeta => {
    const { content: _c, plain: _p, comments: _m, ...rest } = pg
    return { v: 1, kind: 'page', at: 1, seg: 'x', page: rest, defs, body, files: [] }
  }
  const schemaMeta = (db: Database): PinMeta => ({ v: 1, kind: 'schema', at: 1, seg: 'x', dbId: db.id, db, files: [] })
  const itemsIn = (c: JSONContent | null | undefined): Array<{ itemId: string; blockedBy: string[] }> => {
    const out: Array<{ itemId: string; blockedBy: string[] }> = []
    const walk = (x: JSONContent) => {
      if (x.type === 'workItem') out.push({ itemId: String(x.attrs?.itemId), blockedBy: (x.attrs?.blockedBy as string[]) ?? [] })
      x.content?.forEach(walk)
    }
    if (c) walk(c)
    return out
  }
  const fns = { planRestoreProps, relationRestoreOk, withoutProperty, propertyRefs, optionRefs, itemsOf: itemsIn, liftMisplacedItems: (d: JSONContent) => d }
  interface Fx {
    places: PlaceWindow[]
    now: Record<string, NowDigest>
    metas?: Record<string, PinMeta>
    bodies?: Record<string, JSONContent | null>
    pinBlocks?: Record<string, { strings: string[]; json: JSONContent[] }>
    nowBlocks?: Record<string, { strings: string[]; json: JSONContent[] }>
    pages: Page[]
    dbs?: Database[]
    items?: { live?: Record<string, string[]>; loops?: string[] }
    pipeline?: boolean
    status?: Record<string, string>
  }
  const coreOf = (fx: Fx, forced: string[] = []) => {
    const dbs = fx.dbs ?? [stdDb()]
    const state = { pages: Object.fromEntries(fx.pages.map((x) => [x.id, x])), databases: Object.fromEntries(dbs.map((d) => [d.id, d])) }
    const input: CoreInput = {
      data: { sel: SEL, places: new Map(fx.places.map((w) => [w.p, w])), runs: {}, lostTails: [], ejects: [], schemaEvents: new Map() },
      now: new Map(Object.entries(fx.now) as Array<[PlaceKey, NowDigest]>),
      pins: { metas: new Map(Object.entries(fx.metas ?? {})), bodies: new Map(Object.entries(fx.bodies ?? {})), blocks: new Map(Object.entries(fx.pinBlocks ?? {})) },
      nowBlocks: new Map(Object.entries(fx.nowBlocks ?? {}) as Array<[PlaceKey, { strings: string[]; json: JSONContent[] }]>),
      state,
      empty: (k) => `E(${k})`,
      kitComputed: () => false,
      readOnly: { pageLocked: (id) => !!state.pages[id]?.settings.locked, dbLocked: (id) => !!state.databases[id]?.locked },
      db: { system: (id) => state.databases[id]?.system, pipelineRole: (id, prop) => (fx.pipeline && id === DB ? (prop === 'title' ? 'title' : prop === 'est' ? 'priority' : prop ? 'stage' : null) : undefined), props: (id) => state.databases[id]?.properties ?? [] },
      items: { livePagesOf: (id) => fx.items?.live?.[id] ?? [], wouldLoop: (from, to) => !!fx.items?.loops?.includes(`${from}>${to}`) },
      sources: { changeStatus: fx.status ? (c) => fx.status![c] : undefined },
      fns,
    }
    const plan = core(input, new Set(forced as PlaceKey[]))
    return { plan, by: (p: string) => plan.places.find((x) => x.p === p)!, state, input }
  }
  const ROW = { t: 'T', i: '', c: 'C', tr: '0', pa: 'PA', r: '', o: 'O', 'p:stage': 'S1', 'p:est': 'E1' }

  test('F1 page: two appends of the writer go, the person\'s fix between them stays', () => {
    const P = 'p:report'
    const b = (id: string, text: string): JSONContent => para(text, id)
    const s1 = seg(P, 2000, { pk: 'page', db: undefined, touched: ['b:a1', 'bo'], left: { h: 'L1', parts: { t: 'T' }, blocks: ['b1=1', 'b2=2', 'b3=3', 'a1=x'] } })
    const s2 = seg(P, 4000, { pk: 'page', db: undefined, touched: ['b:a2', 'bo'], left: { h: 'L2', parts: { t: 'T' }, blocks: ['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y'] } })
    const cur = page({ id: 'report', content: docOf(b('b1', 'eins'), b('b2', 'zwei'), b('b3', 'drei, korrigiert'), b('a1', 'Absatz A'), b('a2', 'Absatz B')) })
    const fx: Fx = {
      places: [win([s1, s2], [fr(3000, ['b:b3'])])],
      now: { [P]: nowD({ t: 'T' }, ['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y'], { h: 'L2' }) },
      metas: { [s1.before!]: pageMeta(cur, 'd1'), [s2.before!]: pageMeta(cur, 'd2') },
      bodies: { 'report|d1': null, 'report|d2': null },
      pinBlocks: {
        [s1.before!]: { strings: ['b1=1', 'b2=2', 'b3=3'], json: [b('b1', 'eins'), b('b2', 'zwei'), b('b3', 'drei')] },
        [s2.before!]: { strings: ['b1=1', 'b2=2', 'b3=3f', 'a1=x'], json: [b('b1', 'eins'), b('b2', 'zwei'), b('b3', 'drei, korrigiert'), b('a1', 'Absatz A')] },
      },
      nowBlocks: { [P]: { strings: ['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y'], json: cur.content!.content! } },
      pages: [cur],
    }
    const { by, plan, state, input } = coreOf(fx)
    const x = by(P)
    expect(x).toMatchObject({ outcome: 'back', hunks: { back: 2, held: 0 } })
    const target = targetsFor(plan, state, input.pins, fns).pages.report
    expect(target.content!.content!.map((c) => c.content?.[0]?.text)).toEqual(['eins', 'zwei', 'drei, korrigiert'])
    // id-less paragraphs: the fix sits between them — the earlier append is held (its neighbour is not what it was)
    const loose = (blocks: string[]) => blocks.map((x2) => `#=${x2.split('=')[1]}`)
    const t1 = seg(P, 2000, { pk: 'page', db: undefined, touched: ['b#', 'bo'], left: { h: 'L1', parts: { t: 'T' }, blocks: loose(['b1=1', 'b2=2', 'b3=3', 'a1=x']) } })
    const t2 = seg(P, 4000, { pk: 'page', db: undefined, touched: ['b#', 'bo'], left: { h: 'L2', parts: { t: 'T' }, blocks: loose(['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y']) } })
    const fx2: Fx = {
      ...fx,
      places: [win([t1, t2], [fr(3000, ['b#'])])],
      now: { [P]: nowD({ t: 'T' }, loose(['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y']), { h: 'L2' }) },
      metas: { [t1.before!]: pageMeta(cur, 'd1'), [t2.before!]: pageMeta(cur, 'd2') },
      pinBlocks: { [t1.before!]: { strings: loose(['b1=1', 'b2=2', 'b3=3']), json: fx.pinBlocks![s1.before!].json }, [t2.before!]: { strings: loose(['b1=1', 'b2=2', 'b3=3f', 'a1=x']), json: fx.pinBlocks![s2.before!].json } },
      nowBlocks: { [P]: { strings: loose(['b1=1', 'b2=2', 'b3=3f', 'a1=x', 'a2=y']), json: cur.content!.content! } },
    }
    expect(coreOf(fx2).by(P)).toMatchObject({ outcome: 'back', hunks: { back: 1, held: 1 } })
  })

  test('F1 schema: the writer\'s option renames go back, the person\'s rename between them stays; a view the writer changed goes back', () => {
    const S1 = `s:${DB}`
    const pin1 = database()
    const after1 = database({ properties: [pin1.properties[0], { ...statusProp, options: statusProp.options!.map((o) => (o.id === 'o-ready' ? { ...o, name: 'Bereit' } : o)) }, pin1.properties[2], pin1.properties[3]] })
    const pin2 = database({ properties: [after1.properties[0], { ...after1.properties[1], options: after1.properties[1].options!.map((o) => (o.id === 'o-done' ? { ...o, name: 'Fertig' } : o)) }, after1.properties[2], after1.properties[3]] })
    const cur = database({ properties: [pin2.properties[0], { ...pin2.properties[1], options: pin2.properties[1].options!.map((o) => (o.id === 'o-backlog' ? { ...o, name: 'Rückstand' } : o)) }, pin2.properties[2], pin2.properties[3]], views: [view({ name: 'Tessera (Agent)' })] })
    const g1 = seg(S1, 2000, { pk: 'schema', touched: ['o:stage/o-ready'], left: { h: 'L1', parts: { 'o:stage/o-ready': 'R2' } } })
    const g2 = seg(S1, 4000, { pk: 'schema', touched: ['o:stage/o-backlog'], left: { h: 'L2', parts: { 'o:stage/o-ready': 'R2', 'o:stage/o-backlog': 'K2' } } })
    const V = `v:${DB}/v-board`
    const gv = seg(V, 2500, { pk: 'view', touched: ['v'], left: { h: 'LV', parts: { v: 'V2' } } })
    const fx: Fx = {
      places: [win([g1, g2], [fr(3000, ['o:stage/o-done'])]), win([gv])],
      now: { [S1]: nowD({ 'o:stage/o-ready': 'R2', 'o:stage/o-backlog': 'K2', 'o:stage/o-done': 'D2' }, undefined, { h: 'L2' }), [V]: nowD({ v: 'V2' }, undefined, { h: 'LV' }) },
      metas: { [g1.before!]: schemaMeta(pin1), [g2.before!]: schemaMeta(pin2), [gv.before!]: schemaMeta(pin1) },
      pages: [],
      dbs: [cur],
    }
    const { plan, by, state, input } = coreOf(fx)
    expect(by(S1)).toMatchObject({ outcome: 'back', parts: { back: ['o:stage/o-backlog', 'o:stage/o-ready'] } })
    expect(by(V).outcome).toBe('back')
    const db = targetsFor(plan, state, input.pins, fns).databases[DB]
    expect(db.properties[1].options!.map((o) => o.name)).toEqual(['Backlog', 'Ready', 'Fertig'])
    expect(db.views[0].name).toBe('Tessera-Ansicht')
    // the person renamed the option W renamed first: that part is held (interleaved), the later one still goes back
    const fx2 = { ...fx, places: [win([g1, g2], [fr(3000, ['o:stage/o-ready'])]), win([gv])] }
    const x2 = coreOf(fx2).by(S1)
    expect(x2).toMatchObject({ outcome: 'back', parts: { back: ['o:stage/o-backlog'], held: [{ part: 'o:stage/o-ready', reason: 'interleaved' }] } })
    // a locked database: schema and view held, rows still planned
    const locked = coreOf({ ...fx, places: [...fx.places, win([seg('p:r1', 2000, { touched: ['p:stage'], left: { h: 'L', parts: ROW } })])], now: { ...fx.now, 'p:r1': nowD(ROW) }, metas: { ...fx.metas, [`p:r1|pin${n}`]: pageMeta(rowPage('r1', { properties: { stage: 'o-ready' } }), null, [{ id: 'stage', name: 'Stage', type: 'select', options: statusProp.options }]) }, pages: [rowPage('r1', { properties: { stage: 'o-backlog' } })], dbs: [{ ...cur, locked: true }] })
    expect(locked.by(S1)).toMatchObject({ outcome: 'held', reason: 'locked' })
    expect(locked.by(V)).toMatchObject({ outcome: 'held', reason: 'locked' })
    expect(locked.by('p:r1').outcome).toBe('back')
  })

  test('rows: back with the planned values, held whole when changed; new rows to the trash unless a kept row links them; recreate never written', () => {
    const r1 = seg('p:r1', 2000, { touched: ['p:stage', 't'], left: { h: 'L', parts: ROW } })
    const r2 = seg('p:r2', 2100, { touched: ['p:stage'], left: { h: 'L', parts: ROW } })
    const nw = seg('p:r3', 2200, { touched: '*', before: null, f: F.NEW, left: { h: 'L', parts: ROW } })
    const gone = seg('p:r4', 2300, { touched: '*', f: F.GONE, left: { h: '-', parts: {} } })
    const defs = [{ id: 'stage', name: 'Stage', type: 'select' as const, options: statusProp.options }, { id: 'est', name: 'Schätzung', type: 'number' as const }]
    const fx: Fx = {
      places: [win([r1]), win([r2]), win([nw]), win([gone])],
      now: { 'p:r1': nowD(ROW), 'p:r2': nowD({ ...ROW, 'p:stage': 'S9' }), 'p:r3': nowD(ROW), 'p:r4': { exists: false, h: '-', parts: {}, key: '-' } },
      metas: { [r1.before!]: pageMeta(rowPage('r1', { title: 'NL-1402', properties: { stage: 'o-ready' } }), null, defs), [r2.before!]: pageMeta(rowPage('r2', { properties: { stage: 'o-ready' } }), null, defs) },
      pages: [rowPage('r1', { title: 'NL-1402 neu', properties: { stage: 'o-backlog', est: 3 } }), rowPage('r2', { properties: { stage: 'o-done' } }), rowPage('r3')],
    }
    const { plan, by, state, input } = coreOf(fx)
    expect(by('p:r1')).toMatchObject({ outcome: 'back', fates: { stage: 'back', '#title': 'back' } })
    expect(by('p:r2')).toMatchObject({ outcome: 'held', reason: 'changed' })
    expect(by('p:r3').outcome).toBe('trash')
    expect(by('p:r4')).toMatchObject({ outcome: 'recreate', reason: 'noBefore' })
    expect(plan.counts).toMatchObject({ all: 4, back: 2, held: 1, partial: 1, rows: 3, newRows: 1 })
    const patch = targetsFor(plan, state, input.pins, fns)
    expect(patch.pages.r1).toMatchObject({ title: 'NL-1402', properties: { stage: 'o-ready', est: 3 } })
    expect(patch.pages.r3.trashed).toBe(true)
    expect(Object.keys(patch.pages).sort()).toEqual(['r1', 'r3'])
    // a row outside the plan links the new row: it stays (inUse)
    const linked = coreOf({ ...fx, dbs: [database({ properties: [...stdDb().properties, { id: 'rel', name: 'Verweis', type: 'relation', relationDatabaseId: DB }] })], pages: [...fx.pages, rowPage('keep', { properties: { rel: ['r3'] } })] })
    expect(linked.by('p:r3')).toMatchObject({ outcome: 'held', reason: 'inUse' })
    // forced (a flip at the commit) and an undone review
    expect(coreOf(fx, ['p:r1']).by('p:r1')).toMatchObject({ outcome: 'held', reason: 'changed' })
    expect(coreOf({ ...fx, status: { [`c-${r1.id.slice(-3)}`]: 'discarded' } }).by('p:r1')).toMatchObject({ outcome: 'skip', reason: 'reviewUndone' })
  })

  test('a property the writer added goes only when unused; a type change only with every row; record types; pipeline rows keep the agent stamp', () => {
    const S1 = `s:${DB}`
    const pin = database()
    const withNote = database({ properties: [...pin.properties, { id: 'note', name: 'Notiz', type: 'text' }] })
    const g = seg(S1, 2000, { pk: 'schema', touched: ['p:note', 'po'], left: { h: 'L', parts: { 'p:note': 'N', po: 'PO' } } })
    const base: Fx = { places: [win([g])], now: { [S1]: nowD({ 'p:note': 'N', po: 'PO' }) }, metas: { [g.before!]: schemaMeta(pin) }, pages: [rowPage('r1')], dbs: [withNote] }
    expect(coreOf(base).by(S1).parts.back).toEqual(['p:note', 'po'])
    // a row that stays keeps a value; a view filters on it; a formula names it — each keeps it
    expect(coreOf({ ...base, pages: [rowPage('r1', { properties: { note: 'Mara Lind' } })] }).by(S1).parts.held).toEqual([{ part: 'p:note', reason: 'inUse' }])
    const filtered = database({ ...withNote, views: [view({ filter: { id: 'f', op: 'and', items: [{ id: 'i', propertyId: 'note', operator: 'is_not_empty' }] } as never })] })
    expect(coreOf({ ...base, dbs: [filtered] }).by(S1).parts.held).toEqual([{ part: 'p:note', reason: 'inUse' }])
    const formula = database({ ...withNote, properties: [...withNote.properties, { id: 'f2', name: 'F', type: 'formula', formula: 'prop("Notiz")' }] })
    expect(coreOf({ ...base, dbs: [formula] }).by(S1).parts.held).toEqual([{ part: 'p:note', reason: 'inUse' }])
    // a type change: back only when every row W touched in this database goes back
    const typed = database({ properties: [pin.properties[0], pin.properties[1], { id: 'est', name: 'Schätzung', type: 'text' }, pin.properties[3]] })
    const gt = seg(S1, 2000, { pk: 'schema', touched: ['p:est'], left: { h: 'L', parts: { 'p:est': 'X' } } })
    const rr = seg('p:r1', 2100, { touched: ['p:est'], left: { h: 'L', parts: ROW } })
    const tfx: Fx = { places: [win([gt]), win([rr])], now: { [S1]: nowD({ 'p:est': 'X' }), 'p:r1': nowD({ ...ROW, 'p:est': 'E9' }) }, metas: { [gt.before!]: schemaMeta(pin), [rr.before!]: pageMeta(rowPage('r1'), null, []) }, pages: [rowPage('r1')], dbs: [typed] }
    expect(coreOf(tfx).by(S1)).toMatchObject({ outcome: 'held', reason: 'dependsOnHeld' })
    expect(coreOf({ ...tfx, now: { ...tfx.now, 'p:r1': nowD(ROW) } }).by(S1).outcome).toBe('back')
    // a record type the planned database no longer holds: the row stays whole
    const rt = seg('p:r1', 2000, { touched: ['r'], left: { h: 'L', parts: ROW } })
    const rfx: Fx = { places: [win([rt])], now: { 'p:r1': nowD(ROW) }, metas: { [rt.before!]: pageMeta(rowPage('r1', { recordType: 'rt-bug' }), null, []) }, pages: [rowPage('r1', { recordType: null })] }
    expect(coreOf(rfx).by('p:r1')).toMatchObject({ outcome: 'held', reason: 'recordType' })
    expect(coreOf({ ...rfx, dbs: [database({ recordTypes: ['rt-bug'] })] }).by('p:r1').outcome).toBe('back')
    // a pipeline task: its title goes back with the agent's stamp (a Confirm before the worker takes it)
    const pt = seg('p:r1', 2000, { touched: ['t'], left: { h: 'L', parts: ROW } })
    const pfx: Fx = { places: [win([pt])], now: { 'p:r1': nowD(ROW) }, metas: { [pt.before!]: pageMeta(rowPage('r1', { title: 'Tessera bauen', updatedBy: 'agent:a1' }), null, []) }, pages: [rowPage('r1', { title: 'Tessera bauen (du)' })], pipeline: true }
    const pp = coreOf(pfx)
    expect(pp.by('p:r1').build).toMatchObject({ kind: 'page', stamp: 'agent:a1' })
    expect(targetsFor(pp.plan, pp.state, pp.input.pins, fns).pages.r1).toMatchObject({ title: 'Tessera bauen', updatedBy: 'agent:a1' })
  })

  test('parents: a move back under its own descendant is held; tasks that live elsewhere or would loop are held', () => {
    const P = 'p:b'
    const g = seg(P, 2000, { pk: 'page', db: undefined, touched: ['pa', 't'], left: { h: 'L', parts: { pa: 'PA2', t: 'T2' } } })
    // B was under C; W moved B to the root and C under B — moving B back under C would be a cycle
    const pages = [page({ id: 'b', parentId: null, title: 'B neu' }), page({ id: 'c', parentId: 'b' })]
    const fx: Fx = { places: [win([g])], now: { [P]: nowD({ pa: 'PA2', t: 'T2' }) }, metas: { [g.before!]: pageMeta(page({ id: 'b', parentId: 'c', title: 'B' }), null) }, pages }
    expect(coreOf(fx).by(P)).toMatchObject({ outcome: 'back', parts: { back: ['t'], held: [{ part: 'pa', reason: 'parent' }] } })
    // a task block that comes back while its itemId lives on another page now; one whose wait would loop
    const task = (itemId: string, blockedBy: string[] = []): JSONContent => ({ type: 'workItem', attrs: { id: 'w1', itemId, blockedBy }, content: [para('Launch plan')] })
    const r = seg('p:r1', 2000, { touched: ['c'], left: { h: 'L', parts: ROW } })
    const rfx: Fx = { places: [win([r])], now: { 'p:r1': nowD(ROW) }, metas: { [r.before!]: pageMeta(rowPage('r1'), 'd') }, bodies: { 'r1|d': docOf(task('wi_aaaaaaaaaa')) }, pages: [rowPage('r1')] }
    expect(coreOf(rfx).by('p:r1').outcome).toBe('back')
    expect(coreOf({ ...rfx, items: { live: { wi_aaaaaaaaaa: ['other'] } } }).by('p:r1')).toMatchObject({ outcome: 'held', reason: 'taskElsewhere' })
    expect(coreOf({ ...rfx, items: { live: { wi_aaaaaaaaaa: ['r1'] } } }).by('p:r1').outcome).toBe('back')
    expect(coreOf({ ...rfx, bodies: { 'r1|d': docOf(task('wi_aaaaaaaaaa', ['wi_bbbbbbbbbb'])) }, items: { loops: ['wi_aaaaaaaaaa>wi_bbbbbbbbbb'] } }).by('p:r1')).toMatchObject({ outcome: 'held', reason: 'taskLoop' })
  })

  test('kit parts are never ejected; a pure view reorder is not either', () => {
    const S1 = `s:${DB}`
    const g = seg(S1, 2000, { pk: 'schema', touched: ['cmd', 'tpl'], left: { h: 'L', parts: { cmd: 'C', tpl: 'T' } } })
    const fx: Fx = { places: [win([g])], now: { [S1]: nowD({ cmd: 'C', tpl: 'T' }) }, metas: { [g.before!]: schemaMeta(database()) }, pages: [] }
    expect(coreOf(fx).by(S1)).toMatchObject({ outcome: 'held', reason: 'notEjectable', why: 'commands' })
    const ro = seg(S1, 2000, { pk: 'schema', touched: [], left: { h: 'L', parts: {} } })
    const w = win([ro])
    w.ownEvents = [{ ...w.ownEvents[0], kinds: K.DBMETA, x: [{ part: 'dbmeta' }] }]
    expect(coreOf({ ...fx, places: [w], now: { [S1]: nowD({}) } }).by(S1)).toMatchObject({ outcome: 'held', reason: 'notEjectable', why: 'viewOrder' })
  })
})

test.describe('settled.ts (E7): what an eject settled, and its own writers', () => {
  test('marks per change and per run, taken back; other tabs hear them on the channel; the eject\'s writers', async () => {
    const heard: unknown[] = []
    const other = new BroadcastChannel('one-recorder')
    other.onmessage = (e) => heard.push(e.data)
    const notes: SettledNote[] = []
    const off = onSettled((n) => notes.push(n))
    try {
      markSettled('agent:a1:r212', ['c5', 'c6'])
      expect(isSettled('agent:a1:r212', 'c5')).toBe(true)
      expect(isSettled('agent:a1:r212', 'c11')).toBe(false)
      // no id asks for the whole run: a run with single changes marked is not settled whole
      expect(isSettled('agent:a1:r212')).toBe(false)
      markSettled('script:s1:run9')
      expect(isSettled('script:s1:run9')).toBe(true)
      expect(isSettled('script:s1:run9', 'any')).toBe(true)
      unmarkSettled('agent:a1:r212', ['c5'])
      expect(isSettled('agent:a1:r212', 'c5')).toBe(false)
      expect(isSettled('agent:a1:r212', 'c6')).toBe(true)
      unmarkSettled('script:s1:run9')
      expect(isSettled('script:s1:run9')).toBe(false)
      expect(notes.map((x) => [x.runKey, x.ids.join(','), x.on, x.local])).toEqual([
        ['agent:a1:r212', 'c5,c6', true, true],
        ['script:s1:run9', '', true, true],
        ['agent:a1:r212', 'c5', false, true],
        ['script:s1:run9', '', false, true],
      ])
      // an eject id; the writers that are the eject's own
      expect(isEjectWriter({ kind: 'you', via: 'undo', ref: 'ej1' })).toBe(false)
      noteEject('ej1')
      expect(isEjectWriter({ kind: 'eject', id: 'ej1', of: 'agent:a1:r212' })).toBe(true)
      expect(isEjectWriter({ kind: 'rewind', id: 'rw1' })).toBe(true)
      expect(isEjectWriter({ kind: 'you', via: 'undo', ref: 'ej1' })).toBe(true)
      expect(isEjectWriter({ kind: 'you', via: 'undo', ref: 'slip-7' })).toBe(false)
      expect(isEjectWriter({ kind: 'you', via: 'ui' })).toBe(false)
      expect(isEjectWriter(null)).toBe(false)
      // a mark from another tab applies here (its note is not local)
      other.postMessage({ kind: 'settled', runKey: 'terminal:b7', ids: ['c1'], on: true })
      other.postMessage({ kind: 'ejectRef', id: 'ej2' })
      await expect.poll(() => isSettled('terminal:b7', 'c1')).toBe(true)
      await expect.poll(() => isEjectWriter({ kind: 'you', via: 'undo', ref: 'ej2' })).toBe(true)
      expect(notes.at(-1)).toMatchObject({ runKey: 'terminal:b7', local: false })
      await expect.poll(() => heard.length).toBeGreaterThanOrEqual(5)
      expect(heard[0]).toEqual({ kind: 'settled', runKey: 'agent:a1:r212', ids: ['c5', 'c6'], on: true })
      expect(heard).toContainEqual({ kind: 'ejectRef', id: 'ej1' })
    } finally {
      off()
      other.close()
    }
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
