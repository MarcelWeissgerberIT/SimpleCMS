/**
 * The Patchbay's layout and render geometry (plan §4 B5) — the pure parts in Node, one browser case.
 *  - layout.ts: the same model always gives the same rack; mock 1 lays out like the mock (with "Whole workspace" added,
 *    §3.13) and crosses no more cables than the mock's own rows; net flags sit at their writer's / listener's row; a
 *    fuse path's processors take consecutive rows; seeded with the previous order, one added module moves at most 2
 *    other modules' rows (and a bigger change keeps every known module's order); every module is placed exactly once or
 *    named in one closed fold, and each column head counts placed + folded; "Fuse paths only" opens by itself past 30
 *    modules with an open fuse; filters keep 2 hops; bus chips fold what only they reach; switched-off processors fold as
 *    "off" unless a fuse path or a near miss runs through them; the phone's strand order; the setup band's partition;
 *  - render.ts: the catenary, points along it by length, the fuse point, labels, ticks, paint order, wire styles;
 *    renderStatic parses (a tiny XML check) and holds one fuse glyph per fuse;
 *  - the browser case: renderStatic resolved to a theme's stock tokens and flattened by colors.ts holds no `var(`,
 *    `color-mix(` or `oklch(` (§6 A31), parses as SVG, and the stored row order keeps module keys only.
 * Fixtures: tests/fixtures/patchbay.ts (B2). Every page, name and host is fictional.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { build } from 'vite'
import { test as appTest, openApp } from './fixtures'
import { agent, bigPatchbay, exits, inputOf, mock1, relays, wideScope, type PbWorld } from '../fixtures/patchbay'
import { buildModel } from '../../src/app/features/patchbay/model'
import { moduleKey, scheduleKey } from '../../src/app/features/patchbay/ref'
import {
  AUTO_FUSES_FROM,
  bandPartition,
  chainModules,
  crossingsOf,
  defaultPreset,
  flagId,
  foldId,
  layoutRack,
  profileTags,
  strandOrder,
  type Layout,
  type ModuleSlot,
  type Slot,
} from '../../src/app/features/patchbay/layout'
import {
  cableLength,
  cablePath,
  fusePoint,
  labelPoint,
  paintOrder,
  pointAt,
  renderStatic,
  ticksDash,
  wireStyle,
  type StaticText,
} from '../../src/app/features/patchbay/render'
import { flattenColors } from '../../src/app/features/patchbay/colors'
import type { Chain, ChainStep, Edge, Fuse, Model, ModuleKey, Place } from '../../src/app/features/patchbay/types'

/* ------------------------------------------------------------------ helpers */

const modelOf = (w: PbWorld): Model => buildModel(inputOf(w))

/** The edge leaving `from` (a jack key) whose target starts with `to`. */
function edgeOf(m: Model, from: string, to: string): Edge {
  const e = m.edges.find((x) => x.from === from && x.to.startsWith(to))
  if (!e) throw new Error(`no edge ${from} → ${to}`)
  return e
}

/** A fuse over a path of modules (the shape B4 builds; only what the layout and the picture read is filled). */
function fuseOf(label: string, source: ModuleKey, decider: ModuleKey, hops: Array<{ from: ModuleKey; to: ModuleKey | Place; edge: Edge; via?: Place }>): Fuse {
  const steps: ChainStep[] = hops.map((h) => ({ from: h.from, to: h.to, edge: h.edge.id, ...(h.via ? { via: h.via } : {}) }))
  const chain: Chain = { key: [source, decider, ...steps.map((s) => s.edge)].join('|'), source, decider, steps, shown: Math.min(3, steps.length) }
  const off = { on: true, say: { key: 'x' } }
  return {
    key: label.toLowerCase().padEnd(64, '0'),
    label,
    chain,
    lamps: { outside: off, private: off, out: off },
    at: steps[steps.length - 1].edge,
    facts: [],
    mitigations: [],
    keys: [],
    sigInput: null,
  }
}

const K = {
  trk: moduleKey({ kind: 'server', id: 'srvTracker', name: 'tracker' }),
  clk: moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' }), agents: [] }),
  btn: moduleKey({ kind: 'button', page: 'pgBericht', block: 'btnWeekly' }),
  mail: moduleKey({ kind: 'rowTrigger', db: 'dbMails', event: 'created', prop: null }),
  cnsx: moduleKey({ kind: 'agent', id: 'agTessera' }),
  script: moduleKey({ kind: 'script', id: 'scWeekly' }),
  auto: moduleKey({ kind: 'automation', db: 'dbMails', id: 'autToContact' }),
  ih: moduleKey({ kind: 'agent', id: 'agInbox' }),
  tc: moduleKey({ kind: 'automation', db: 'dbMails', id: 'autToChat' }),
  pipe: moduleKey({ kind: 'pipeline', db: 'dbCoding', pipeline: 'coding' }),
  db: moduleKey({ kind: 'database', id: 'dbHandoff' }),
  page: moduleKey({ kind: 'page', id: 'pgBericht' }),
  ib: moduleKey({ kind: 'inbox' }),
  con: moduleKey({ kind: 'database', id: 'dbKontakte' }),
  all: moduleKey({ kind: 'everything' }),
  hook: moduleKey({ kind: 'outbound', exit: 'webhook', host: 'chat.example', method: 'POST', by: [] }),
  git: moduleKey({ kind: 'outbound', exit: 'git', host: null, method: 'pr', by: [] }),
}
const NET = 'net:dbMails:pMailFwd'

/** F1 of mock 1: Mails · new row → Inbox-Helfer → „Weiterleiten“ → „An Team-Chat“ → Webhook. */
function f1(m: Model): Fuse {
  return fuseOf('F1', K.mail, K.ih, [
    { from: K.ih, via: { db: 'dbMails', prop: 'pMailFwd' }, to: K.tc, edge: edgeOf(m, `${K.ih}.writes`, NET) },
    { from: K.tc, to: K.hook, edge: edgeOf(m, `${K.tc}.out`, K.hook) },
  ])
}

const moduleRows = (l: Layout) => new Map(l.slots.filter((s): s is ModuleSlot => s.kind === 'module').map((s) => [s.id, s.row]))
const slotOf = (l: Layout, id: string): Slot => {
  const s = l.slots.find((x) => x.id === id)
  if (!s) throw new Error(`no slot ${id}`)
  return s
}

/** Every module placed exactly once or named in exactly one closed fold / bus chip; column heads = placed + folded. */
function expectComplete(m: Model, l: Layout): void {
  const seen = new Map<ModuleKey, number>()
  const add = (k: ModuleKey) => seen.set(k, (seen.get(k) ?? 0) + 1)
  for (const s of l.slots) {
    if (s.kind === 'module') add(s.id)
    else if (s.kind === 'fold' && !s.open) s.modules.forEach(add)
    else if (s.kind === 'bus') s.modules.forEach(add)
  }
  for (const mod of m.modules) expect(seen.get(mod.key), `${mod.key} placed or folded once`).toBe(1)
  expect(seen.size).toBe(m.modules.length)
  for (const col of [1, 2, 3] as const) {
    const c = l.cols[col]
    expect(c.placed + c.idle + c.off + c.filter + c.setup + c.bus, `§ 0${col}: placed + folded`).toBe(c.total)
    expect(c.total).toBe(m.modules.filter((x) => x.col === col).length)
    expect(c.placed).toBe(l.slots.filter((s) => s.kind === 'module' && s.col === col).length)
  }
  // no two slots share a row of their column; spans stay inside the rack
  for (const col of [1, 2, 3] as const) {
    const taken = new Set<number>()
    for (const s of l.slots.filter((x) => x.col === col))
      for (let r = s.row; r < s.row + s.span; r++) {
        expect(taken.has(r), `§ 0${col} row ${r} taken once`).toBe(false)
        taken.add(r)
        expect(r).toBeLessThanOrEqual(l.rows)
      }
  }
  // every wire runs between anchors the rack shows
  const anchors = new Set<string>()
  for (const s of l.slots) {
    if (s.kind === 'module')
      for (const j of [...m.modules.find((x) => x.key === s.id)!.inJacks, ...m.modules.find((x) => x.key === s.id)!.outJacks]) anchors.add(j.key)
    else if (s.kind === 'flag' || s.kind === 'bus') anchors.add(s.id)
  }
  for (const w of l.wires) {
    expect(anchors.has(w.from), `wire ${w.id} from ${w.from}`).toBe(true)
    expect(anchors.has(w.to), `wire ${w.id} to ${w.to}`).toBe(true)
  }
}

/** A tiny XML well-formedness check: balanced tags, quoted attributes, escaped text. */
function xmlOk(svg: string): boolean {
  const stack: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y
  let i = 0
  while (i < svg.length) {
    const lt = svg.indexOf('<', i)
    const textPart = svg.slice(i, lt < 0 ? svg.length : lt)
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(textPart) || textPart.includes('>')) return false
    if (lt < 0) break
    tagRe.lastIndex = lt
    const m = tagRe.exec(svg)
    if (!m) return false
    const [, close, name, , self] = m
    if (close) {
      if (stack.pop() !== name) return false
    } else if (!self) stack.push(name)
    i = tagRe.lastIndex
  }
  return stack.length === 0
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/* ------------------------------------------------------------------ layout: mock 1 */

test.describe('B5 · layout — mock 1 (layout.ts)', () => {
  test('deterministic: the same model (and a model built again) gives the same rack', () => {
    const m = modelOf(mock1())
    const a = layoutRack(m, { fuses: [f1(m)] })
    const b = layoutRack(m, { fuses: [f1(m)] })
    const m2 = modelOf(mock1())
    const c = layoutRack(m2, { fuses: [f1(m2)] })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(a.seeded).toBe(false)
  })

  test('lays out like the mock: § 02 in the mock’s order, each source and target beside what it is cabled to', () => {
    const m = modelOf(mock1())
    const l = layoutRack(m, { fuses: [f1(m)] })
    const rows = moduleRows(l)
    const col = (c: 1 | 2 | 3) => l.slots.filter((s) => s.col === c).map((s) => s.id)
    // § 02 is the mock's column: CNSX-Spiegel (2U, here Tessera-Spiegel), Wochenbericht, Neue Mail → Kontakt, Inbox-Helfer, An Team-Chat, the pipeline
    expect(col(2)).toEqual([K.cnsx, K.script, K.auto, K.ih, K.tc, K.pipe])
    expect(slotOf(l, K.cnsx).span).toBe(2)
    expect([1, 3, 4, 5, 6, 7]).toEqual(col(2).map((k) => rows.get(k)))
    // § 01 as in the mock: tracker, the clock, the button, Mails · new row, the idle fold, the net flag
    expect(col(1)).toEqual([K.trk, K.clk, K.btn, K.mail, foldId('idle', 1), flagId(NET, 'in')])
    expect(rows.get(K.trk)).toBe(1)
    expect(rows.get(K.clk)).toBe(2)
    expect(rows.get(K.btn)).toBe(rows.get(K.script))
    expect(rows.get(K.mail)).toBe(rows.get(K.auto))
    const idle = slotOf(l, foldId('idle', 1))
    expect(idle.kind === 'fold' && idle.modules).toEqual(['server:srvKanal', 'server:srvBildwerk', 'server:srvWiki'])
    // § 03: Tessera Handoff at its writer's row, then the report page and the inbox, Kontakte beside its automation, the
    // net flag pinned to Inbox-Helfer's row, the webhook beside An Team-Chat, git beside the pipeline — as the mock;
    // Whole workspace (§3.13) loses its row to the flag and takes the next free one, the bottom
    expect(col(3)).toEqual([K.db, K.page, K.ib, K.con, flagId(NET, 'out'), K.hook, K.git, K.all])
    expect(rows.get(K.db)).toBe(rows.get(K.cnsx))
    expect(rows.get(K.con)).toBe(rows.get(K.auto))
    expect(slotOf(l, flagId(NET, 'out')).row).toBe(rows.get(K.ih))
    expect(rows.get(K.hook)).toBe(rows.get(K.tc))
    expect(rows.get(K.git)).toBe(rows.get(K.pipe))
    expect(rows.get(K.all)).toBe(8)
    expect(l.rows).toBe(8)
    expect(l.wires).toHaveLength(15)
    expect(l.cols).toEqual({
      1: { placed: 4, idle: 3, off: 0, filter: 0, setup: 0, bus: 0, total: 7 },
      2: { placed: 6, idle: 0, off: 0, filter: 0, setup: 0, bus: 0, total: 6 },
      3: { placed: 7, idle: 0, off: 0, filter: 0, setup: 0, bus: 0, total: 7 },
    })
    expectComplete(m, l)
    expect(profileTags(m)).toEqual(['in-01'])
    expect(l.profiles).toEqual(['in-01'])
  })

  test('crosses no more cables than the mock’s own rows (Whole workspace added at the bottom of § 03)', () => {
    const m = modelOf(mock1())
    const l = layoutRack(m, { fuses: [f1(m)] })
    // the mock's rows (mock.html grid-row − 1), on this model's keys
    const mod = (id: string, col: 1 | 2 | 3, row: number, span: 1 | 2 = 1): Slot => ({ kind: 'module', id, col, row, span })
    const mock: Slot[] = [
      mod(K.trk, 1, 1),
      mod(K.clk, 1, 2),
      mod(K.btn, 1, 3),
      mod(K.mail, 1, 4),
      { kind: 'flag', id: flagId(NET, 'in'), net: NET, side: 'in', col: 1, row: 6, span: 1 },
      mod(K.cnsx, 2, 1, 2),
      mod(K.script, 2, 3),
      mod(K.auto, 2, 4),
      mod(K.ih, 2, 5),
      mod(K.tc, 2, 6),
      mod(K.pipe, 2, 7),
      mod(K.db, 3, 1),
      mod(K.page, 3, 2),
      mod(K.ib, 3, 3),
      mod(K.con, 3, 4),
      { kind: 'flag', id: flagId(NET, 'out'), net: NET, side: 'out', col: 3, row: 5, span: 1 },
      mod(K.hook, 3, 6),
      mod(K.git, 3, 7),
      mod(K.all, 3, 8),
    ]
    const mine = crossingsOf(m, l)
    const theirs = crossingsOf(m, { slots: mock, wires: l.wires })
    test.info().annotations.push({ type: 'crossings', description: `layout ${mine} · mock ${theirs}` })
    expect(mine).toBe(l.crossings)
    expect(mine).toBeLessThanOrEqual(theirs)
    // the flag pinned to its writer's row puts every slot where the mock has it: the same crossings
    expect(mine).toBe(theirs)
  })

  test('net flags: § 01 pinned to its listener’s row, § 03 to its writer’s (what it pushes out takes the next free row)', () => {
    const m = modelOf(mock1())
    const l = layoutRack(m, { fuses: [f1(m)] })
    const rows = moduleRows(l)
    expect(slotOf(l, flagId(NET, 'in')).row).toBe(rows.get(K.tc))
    // Inbox-Helfer's EVERYTHING jack sits above its writes jack, yet the flag keeps the writer's row (§3.4): the F1 glyph
    // on the next cable sits level; Whole workspace moves down instead
    expect(slotOf(l, flagId(NET, 'out')).row).toBe(rows.get(K.ih))
    // the relays: every flag at the row of what it is cabled to in § 02 — never above it, in the order of § 02, and
    // pushed down only by what its own column holds more than § 02 (merge: B3's relays have „Versandliste“ as a third
    // database, so § 03 holds 10 items beside § 02's 7 — the packed column moves its last flags down by up to 3)
    const r = modelOf(relays())
    const lr = layoutRack(r)
    const rr = moduleRows(lr)
    const inCol = (c: number) => lr.slots.filter((x) => x.col === c).length
    const flags: Array<{ col: number; row: number; at: number }> = []
    for (const s of lr.slots) {
      if (s.kind !== 'flag') continue
      const w = lr.wires.find((x) => x.from === s.id || x.to === s.id)!
      const other = (w.from === s.id ? w.to : w.from).split('.')[0]
      const at = rr.get(other)!
      const slack = Math.max(0, inCol(s.col) - inCol(2))
      expect(s.row, `${s.id} not above ${other}`).toBeGreaterThanOrEqual(at)
      expect(s.row - at, `${s.id} beside ${other}`).toBeLessThanOrEqual(2 + slack)
      flags.push({ col: s.col, row: s.row, at })
    }
    for (const c of [1, 3]) {
      const col = flags.filter((f) => f.col === c).sort((a, b) => a.row - b.row)
      for (let i = 1; i < col.length; i++) expect(col[i].at, `§ 0${c} flags in § 02's order`).toBeGreaterThanOrEqual(col[i - 1].at)
    }
  })
})

/* ------------------------------------------------------------------ layout: stable */

test.describe('B5 · layout — stable from the previous order (§6 U15)', () => {
  const add = {
    'an agent writing Kontakte': (w: PbWorld) => {
      w.ws.agents!.agNeu = agent('agNeu', 'Kontakt-Prüfer', { write: 'stage', scope: { everything: false, pages: [], databases: ['dbKontakte'] } })
    },
    'an agent on new Mails rows': (w: PbWorld) => {
      w.ws.agents!.agNeu = agent('agNeu', 'Mail-Leser', { write: 'none', trigger: { type: 'row_created', databaseId: 'dbMails' } })
    },
  }

  for (const [what, change] of Object.entries(add))
    test(`adding one module (${what}) moves at most 2 other modules’ rows`, () => {
      const m = modelOf(mock1())
      const before = layoutRack(m, { fuses: [f1(m)] })
      const w = mock1()
      change(w)
      const m2 = modelOf(w)
      const after = layoutRack(m2, { prev: before.order, fuses: [f1(m2)] })
      expect(after.seeded).toBe(true)
      expect(after.reflowed).toBe(false)
      const a = moduleRows(before)
      const b = moduleRows(after)
      const moved = [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k))
      test.info().annotations.push({ type: 'moved', description: moved.join(', ') || 'none' })
      expect(moved.length).toBeLessThanOrEqual(2)
      expect(b.get(moduleKey({ kind: 'agent', id: 'agNeu' }))).toBeGreaterThan(0)
      // the fuse path stays together
      expect(b.get(K.tc)! - b.get(K.ih)!).toBe(1)
      expectComplete(m2, after)
    })

  test('a bigger change (a new agent on the shared clock writing Tessera Handoff) keeps § 02’s order — rows below it shift', () => {
    const m = modelOf(mock1())
    const before = layoutRack(m)
    const w = mock1()
    w.ws.agents!.agNeu = agent('agNeu', 'Handoff-Leser', {
      write: 'stage',
      scope: { everything: false, pages: [], databases: ['dbHandoff'] },
      trigger: { type: 'schedule', every: 'weekday', at: '07:30', tz: 'Europe/Berlin' },
    })
    const m2 = modelOf(w)
    const after = layoutRack(m2, { prev: before.order })
    expect(after.seeded).toBe(true)
    expect(after.reflowed).toBe(false)
    const order = (l: Layout, col: 1 | 2 | 3) => l.slots.filter((s) => s.kind === 'module' && s.col === col).map((s) => s.id)
    const known = order(before, 2)
    expect(
      order(after, 2).filter((k) => known.includes(k)),
      '§ 02 keeps its order',
    ).toEqual(known)
    // § 01 and § 03 stay beside what they are cabled to (Tessera Handoff and the clock move with the new agent above)
    const rows = moduleRows(after)
    expect(rows.get(K.db)).toBe(rows.get(moduleKey({ kind: 'agent', id: 'agNeu' })))
    expect(rows.get(K.con)).toBe(rows.get(K.auto))
    expectComplete(m2, after)
  })

  test('a layout seeded with its own order is a fixed point; a stranger’s order (no known module) lays out fresh', () => {
    for (const w of [mock1(), relays(), exits(), bigPatchbay(60)]) {
      const m = modelOf(w)
      const first = layoutRack(m)
      const again = layoutRack(m, { prev: first.order })
      expect(again.seeded).toBe(true)
      expect(moduleRows(again)).toEqual(moduleRows(first))
      expect(layoutRack(m, { prev: ['agent:someoneElse', 'script:other'] }).seeded).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ layout: folds, filters, counts */

test.describe('B5 · layout — folds, filters and counts', () => {
  test('every module is placed exactly once or named in a fold; column heads = placed + folded (every fixture)', () => {
    const worlds: Array<[string, PbWorld]> = [
      ['mock 1', mock1()],
      ['exits', exits()],
      ['relays', relays()],
      ['wide 40', wideScope(40)],
      ['named 9', wideScope(40, { named: 9 })],
      ['big 60', bigPatchbay(60)],
    ]
    for (const [name, w] of worlds) {
      const m = modelOf(w)
      const l = layoutRack(m)
      expectComplete(m, l)
      test
        .info()
        .annotations.push({ type: name, description: `${m.modules.length} modules · ${l.wires.length} wires · ${l.rows} rows · ${l.crossings} crossings` })
    }
  })

  test('"Whole workspace": an everything agent in 40 databases has ≤ 4 wires out; a named scope of 9 bundles 3 into "+3"', () => {
    const m = modelOf(wideScope(40))
    const l = layoutRack(m)
    const agentKey = moduleKey({ kind: 'agent', id: 'agNordlicht' })
    const out = l.wires.filter((w) => w.from.startsWith(`${agentKey}.`))
    expect(out.length).toBeLessThanOrEqual(4)
    // the 40 databases are no modules at all: "Whole workspace · 40 databases" stands for them
    expect(m.modules.filter((x) => x.kind === 'database')).toHaveLength(0)
    expect(moduleRows(l).has(K.all)).toBe(true)
    expectComplete(m, l)

    const n = modelOf(wideScope(40, { named: 9 }))
    const ln = layoutRack(n)
    const buses = ln.slots.filter((s) => s.kind === 'bus')
    expect(buses).toHaveLength(1)
    const bus = buses[0]
    expect(bus.kind === 'bus' && bus.edges).toHaveLength(3)
    expect(bus.kind === 'bus' && bus.modules).toHaveLength(3)
    expect(ln.cols[3].bus).toBe(3)
    // 6 single cables + the bus wire + the report page leave the agent
    expect(ln.wires.filter((w) => w.from.startsWith(`${agentKey}.`))).toHaveLength(8)
    expect(ln.wires.find((w) => w.bus)?.edges).toEqual(bus.kind === 'bus' ? bus.edges : [])
    expectComplete(n, ln)
  })

  test('switched-off processors fold as "off" — unless a fuse path or a near miss runs through them', () => {
    const m = modelOf(exits())
    const off = moduleKey({ kind: 'agent', id: 'agExOff' })
    // merge: the model brings its own fuses and near misses now (B4) — F14 runs through the switched-off agent, so by
    // default it keeps its row; without any fuse or near miss it folds
    expect(m.fuses.some((f) => f.chain.decider === off)).toBe(true)
    expect(moduleRows(layoutRack(m)).has(off)).toBe(true)
    const l = layoutRack(m, { fuses: [], nearMisses: [] })
    const fold = slotOf(l, foldId('off', 2))
    expect(fold.kind === 'fold' && fold.modules).toContain(off)
    expect(l.cols[2].off).toBeGreaterThanOrEqual(1)
    expectComplete(m, l)
    // on a fuse path it stays in a row (tagged "runs only by hand" by the page)
    const writes = m.edges.find((e) => e.from === `${off}.writes`)!
    const onPath = fuseOf('F1', moduleKey({ kind: 'database', id: 'dbLeads' }), off, [{ from: off, to: { db: 'dbLeads' }, edge: writes }])
    const l2 = layoutRack(m, { fuses: [onPath], nearMisses: [] })
    expect(moduleRows(l2).has(off)).toBe(true)
    expectComplete(m, l2)
    const l3 = layoutRack(m, { fuses: [], nearMisses: [{ chain: onPath.chain }] })
    expect(moduleRows(l3).has(off)).toBe(true)
    // opened by the person (↵): its modules take rows, the fold stays as the key that closes it
    const l4 = layoutRack(m, { fuses: [], nearMisses: [], unfolded: [foldId('off', 2)] })
    expect(moduleRows(l4).has(off)).toBe(true)
    const open = slotOf(l4, foldId('off', 2))
    expect(open.kind === 'fold' && open.open).toBe(true)
    expect(l4.cols[2].off).toBe(0)
    expectComplete(m, l4)
  })

  test('an off writer’s bus targets fold with it — and opening their fold places them (fix rest)', () => {
    const w = wideScope(40, { named: 9 })
    w.ws.agents!['agNordlicht'] = { ...w.ws.agents!['agNordlicht'], enabled: false }
    const m = modelOf(w)
    const l = layoutRack(m, { fuses: [], nearMisses: [] })
    expectComplete(m, l)
    // no bus chip: the writer is folded, its bundled targets fold with it
    expect(l.slots.filter((s) => s.kind === 'bus')).toHaveLength(0)
    const opened = layoutRack(m, { fuses: [], nearMisses: [], unfolded: [foldId('off', 3)] })
    expectComplete(m, opened)
    expect(opened.cols[3].off).toBe(0)
    for (const id of ['dbNord08', 'dbNord09', 'dbNord10']) expect(moduleRows(opened).has(moduleKey({ kind: 'database', id })), id).toBe(true)
  })

  test('"Fuse paths only" opens by itself past 30 modules with an open fuse — and keeps exactly the paths, the rest named', () => {
    const big = modelOf(bigPatchbay(60))
    expect(big.counts.modules).toBeGreaterThanOrEqual(AUTO_FUSES_FROM)
    expect(defaultPreset(big, 1)).toEqual({ kind: 'fuses' })
    expect(defaultPreset(big, 0)).toBeNull()
    expect(defaultPreset({ counts: { ...big.counts, modules: 30 } }, 3)).toBeNull()
    expect(defaultPreset({ counts: { ...big.counts, modules: 31 } }, 1)).toEqual({ kind: 'fuses' })
    const small = modelOf(mock1())
    expect(defaultPreset(small, 1)).toBeNull()

    // a path in the big rack: Helfer 2 (apply, new rows of Tessera 2) sets „Prüfen“ → „Prüfen → Hook 2“ → the webhook
    const ag = moduleKey({ kind: 'agent', id: 'agBig1' })
    const au = moduleKey({ kind: 'automation', db: 'dbBig1', id: 'autBig1' })
    const hookE = big.edges.find((e) => e.from === `${au}.out`)!
    const exit = hookE.to.slice(0, hookE.to.lastIndexOf('.'))
    const path = fuseOf('F1', moduleKey({ kind: 'rowTrigger', db: 'dbBig1', event: 'created', prop: null }), ag, [
      { from: ag, via: { db: 'dbBig1', prop: 'dbBig1Flag' }, to: au, edge: edgeOf(big, `${ag}.writes`, 'net:dbBig1:dbBig1Flag') },
      { from: au, to: exit, edge: hookE },
    ])
    const l = layoutRack(big, { filter: defaultPreset(big, 1), fuses: [path] })
    expect(l.filter).toEqual({ kind: 'fuses' })
    expect([...moduleRows(l).keys()].sort()).toEqual(chainModules(path.chain, big).sort())
    expect(l.cols[1].filter + l.cols[2].filter + l.cols[3].filter).toBe(big.counts.modules - chainModules(path.chain, big).length)
    // the folds keep the fuse's tag where a path module hides … none does here; and the hidden ones are all named
    for (const s of l.slots) if (s.kind === 'fold' && s.why === 'filter') expect(s.modules.length).toBeGreaterThan(0)
    expectComplete(big, l)
  })

  test('filters keep what is within 2 cables: a database, a profile, what runs now', () => {
    const m = modelOf(mock1())
    const kontakte = layoutRack(m, { filter: { kind: 'databases', ids: ['dbKontakte'] } })
    // Kontakte ← Neue Mail → Kontakt ← Mails · new row (2 hops)
    expect([...moduleRows(kontakte).keys()].sort()).toEqual([K.auto, K.con, K.mail].sort())
    expectComplete(m, kontakte)
    const profile = layoutRack(m, { filter: { kind: 'profile', id: 'in-01' } })
    for (const k of [K.trk, K.cnsx, K.db, K.clk, K.page, K.ib, K.script]) expect(moduleRows(profile).has(k), k).toBe(true)
    expect(moduleRows(profile).has(K.hook)).toBe(false)
    expectComplete(m, profile)
    const running = layoutRack(m, { filter: { kind: 'running' }, running: [K.tc] })
    for (const k of [K.tc, K.hook, K.ih]) expect(moduleRows(running).has(k), k).toBe(true)
    expect(moduleRows(running).has(K.cnsx)).toBe(false)
    expectComplete(m, running)
    // nothing running: everything named in the filter folds (idle stays idle)
    const none = layoutRack(m, { filter: { kind: 'running' } })
    expect(moduleRows(none).size).toBe(0)
    expect(none.cols[1].idle).toBe(3)
    expectComplete(m, none)
  })

  test('a fuse path’s processors take consecutive rows, in path order (the relays: agent → automation → agent → automation)', () => {
    const r = modelOf(relays())
    const a = moduleKey({ kind: 'agent', id: 'agLaunchA' })
    const fr = moduleKey({ kind: 'automation', db: 'dbLaunch', id: 'autFreigabe' })
    const b = moduleKey({ kind: 'agent', id: 'agLaunchB' })
    // B3's relays: „Versand“ lives in its own database „Versandliste“ (agent B is scoped to it)
    const vs = moduleKey({ kind: 'automation', db: 'dbVersand', id: 'autVersand' })
    const hookE = r.edges.find((e) => e.from === `${vs}.out`)!
    const relay = fuseOf(
      'F1',
      moduleKey({ kind: 'clock', schedule: scheduleKey({ type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' }), agents: [] }),
      a,
      [
        { from: a, via: { db: 'dbLaunch', prop: 'pLaunchPhase' }, to: fr, edge: edgeOf(r, `${a}.writes`, 'net:dbLaunch:pLaunchPhase') },
        { from: fr, via: { db: 'dbLaunch', prop: 'pLaunchFreigabe' }, to: b, edge: edgeOf(r, `${fr}.writes`, 'net:dbLaunch:pLaunchFreigabe') },
        { from: b, via: { db: 'dbVersand', prop: 'pVersandFlag' }, to: vs, edge: edgeOf(r, `${b}.writes`, 'net:dbVersand:pVersandFlag') },
        { from: vs, to: hookE.to.slice(0, hookE.to.lastIndexOf('.')), edge: hookE },
      ],
    )
    const rows = moduleRows(layoutRack(r, { fuses: [relay] }))
    const path = [a, fr, b, vs].map((k) => rows.get(k)!)
    for (let i = 1; i < path.length; i++) expect(path[i] - path[i - 1], 'consecutive').toBe(1)
    // without the fuse the same processors are not kept together (the pull is the fuse's)
    const loose = moduleRows(layoutRack(r))
    expect([a, fr, b, vs].map((k) => loose.get(k)!)).not.toEqual(path)
  })

  test('the setup band (drop visit): the profile’s modules, ghosts and what a planned cable reaches; the rest folds, named, F tags kept', () => {
    const m = modelOf(mock1())
    // a ghost report page the profile's recipe would make, cabled (planned) from Tessera-Spiegel's notes jack
    const ghost = moduleKey({ kind: 'page', id: 'pgGhost' })
    m.modules.push({
      key: ghost,
      kind: 'page',
      col: 3,
      u: 1,
      ref: { kind: 'page', id: 'pgGhost' },
      tags: ['ghost'],
      inJacks: [{ key: `${ghost}.writes`, module: ghost, side: 'in', role: 'writes', plugged: true }],
      outJacks: [],
      nets: [],
      idle: false,
      open: { to: 'none' },
    })
    m.edges.push({ id: `${K.cnsx}.notes>${ghost}.writes`, kind: 'writes', from: `${K.cnsx}.notes`, to: `${ghost}.writes`, planned: true })
    const band = bandPartition(m, 'in-01')
    expect(band.touched.sort()).toEqual([K.trk, K.cnsx, K.db, ghost].sort())
    expect(band.untouched).not.toContain(K.cnsx)
    expect(band.untouched).toContain(K.ih)
    const touchesUntouched = m.edges.filter((e) => [e.from, e.to].some((end) => band.untouched.some((k) => end.startsWith(`${k}.`)))).length
    expect(band.cables).toBe(touchesUntouched)
    const fuse = f1(m)
    const l = layoutRack(m, { setup: { profile: 'in-01' }, fuses: [fuse], filter: { kind: 'running' } })
    expect(l.filter).toBeNull() // the band wins over a filter
    expect(l.band?.profile).toBe('in-01')
    expect([...moduleRows(l).keys()].sort()).toEqual([K.trk, K.cnsx, K.db, ghost].sort())
    for (const col of [1, 2, 3] as const) {
      const fold = l.slots.find((s) => s.kind === 'fold' && s.why === 'setup' && s.col === col)
      expect(fold?.kind === 'fold' && fold.fuses, `§ 0${col} keeps F1`).toEqual([fuse.key])
    }
    const wire = l.wires.find((w) => w.to === `${ghost}.writes`)!
    expect(wireStyle(wire, new Map(m.edges.map((e) => [e.id, e]))).planned).toBe(true)
    expectComplete(m, l)
  })
})

/* ------------------------------------------------------------------ the phone */

test.describe('B5 · the phone’s strand order (§3.8)', () => {
  test('fuse cards first, then one strand per drawn processor by name, then "Not processed" naming the rest', () => {
    const w = mock1()
    const m = modelOf(w)
    const names: Record<string, string> = {
      [K.cnsx]: 'Tessera-Spiegel',
      [K.ih]: 'Inbox-Helfer',
      [K.tc]: 'An Team-Chat',
      [K.auto]: 'Neue Mail → Kontakt',
      [K.script]: 'Wochenbericht',
      [K.pipe]: 'Coding · nordlicht',
      'server:srvKanal': 'kanal',
      'server:srvBildwerk': 'bildwerk',
      'server:srvWiki': 'wiki',
    }
    const fuse = f1(m)
    const second = { ...fuse, key: 'f2'.padEnd(64, '0'), label: 'F2' }
    const o = strandOrder(m, { name: (k) => names[k] ?? k, lang: 'de', fuses: [second, fuse] })
    expect(o.fuses).toEqual([fuse.key, second.key])
    expect(o.strands.map((k) => names[k])).toEqual([
      'An Team-Chat',
      'Coding · nordlicht',
      'Inbox-Helfer',
      'Neue Mail → Kontakt',
      'Tessera-Spiegel',
      'Wochenbericht',
    ])
    expect(o.rest.map((k) => names[k])).toEqual(['bildwerk', 'kanal', 'wiki'])
    // every drawn processor is a strand; every module is a strand, on a strand's line, or named in "Not processed"
    expect(o.strands).toHaveLength(m.modules.filter((x) => x.col === 2 && !x.idle).length)
    // a clock writing a database nobody listens to — no processor touches either: both "Not processed"
    const e = exits()
    const em = modelOf(e)
    const eo = strandOrder(em, { name: (k) => k, lang: 'en' })
    for (const k of eo.rest) expect(em.modules.find((x) => x.key === k)!.col === 2 ? em.modules.find((x) => x.key === k)!.idle : true).toBe(true)
  })
})

/* ------------------------------------------------------------------ render geometry */

test.describe('B5 · render geometry (render.ts)', () => {
  test('the catenary: dx = max(30, span · 0.42), sag = 8 + rise · 0.1 + span · 0.06', () => {
    const c = cablePath({ x: 0, y: 0 }, { x: 200, y: 100 })
    expect(c.d).toBe('M0,0 C84,30 116,130 200,100')
    expect(cablePath({ x: 10, y: 10 }, { x: 50, y: 10 }).d).toBe('M10,10 C40,20.4 20,20.4 50,10')
    // backwards (an automation starting a script below it in § 02): out to the right, back in from the left
    const back = cablePath({ x: 300, y: 0 }, { x: 0, y: 80 })
    expect(back.c1.x).toBeGreaterThan(300)
    expect(back.c2.x).toBeLessThan(0)
  })

  test('points by share of length; the fuse point halfway, turned along the cable; labels above', () => {
    const c = cablePath({ x: 0, y: 0 }, { x: 200, y: 100 })
    const a = pointAt(c, 0)
    const z = pointAt(c, 1)
    expect(a.x).toBeCloseTo(0, 5)
    expect(z.x).toBeCloseTo(200, 5)
    expect(z.y).toBeCloseTo(100, 5)
    // a level cable is symmetric: its middle by length is x = 100, and it runs flat there
    const flat = cablePath({ x: 0, y: 0 }, { x: 200, y: 0 })
    const mid = fusePoint(flat)
    expect(mid.x).toBeCloseTo(100, 1)
    expect(Math.abs(mid.angle)).toBeLessThan(0.5)
    // halves by length are equal
    const len = cableLength(c)
    const half = pointAt(c, 0.5)
    expect(len).toBeGreaterThan(Math.hypot(200, 100))
    const l = labelPoint(c, 0.44, -14)
    expect(l.y).toBeCloseTo(pointAt(c, 0.44).y - 14, 5)
    expect(half.angle).toBeGreaterThan(0)
    expect(half.angle).toBeLessThan(90)
  })

  test('hatched ticks over the middle 60 %; paint order bottom to top; a wire’s style from its edges', () => {
    expect(ticksDash(100)).toBe(`0 20 ${Array.from({ length: 7 }, () => '1.6 6').join(' ')} 0 100`)
    const e = (id: string, over: Partial<Edge> = {}): Edge => ({ id, kind: 'writes', from: `${id}.a`, to: `${id}.b`, ...over })
    const edges = new Map(
      [
        e('fuse'),
        e('outside', { outside: true }),
        e('solid'),
        e('can', { can: true }),
        e('unknown', { unknown: true }),
        e('planned', { planned: true, can: true }),
      ].map((x) => [x.id, x]),
    )
    const wires = ['fuse', 'outside', 'solid', 'can', 'unknown', 'planned'].map((id) => ({ id, from: `${id}.a`, to: `${id}.b`, edges: [id] }))
    expect(paintOrder(wires, edges, { fuse: ['fuse'] })).toEqual(['planned', 'unknown', 'can', 'solid', 'outside', 'fuse'])
    expect(paintOrder(wires, edges, { fuse: ['fuse'], lit: ['can'] })).toEqual(['planned', 'unknown', 'solid', 'outside', 'can', 'fuse'])
    expect(wireStyle({ edges: ['can', 'planned'] }, edges)).toEqual({ can: true, outside: false, planned: false, unknown: false })
    expect(wireStyle({ edges: ['solid', 'outside'] }, edges)).toEqual({ can: false, outside: true, planned: false, unknown: false })
  })

  test('renderStatic parses (a tiny XML check) and holds one fuse glyph per fuse', () => {
    const m = modelOf(mock1())
    const fuse = f1(m)
    const l = layoutRack(m, { fuses: [fuse] })
    const text: Partial<StaticText> = { name: (x) => ({ [K.ih]: 'Inbox <a> & b', [K.tc]: '„An Team-Chat“' })[x.key] ?? x.key }
    const svg = renderStatic(m, l, { fuses: [fuse], text, title: 'Nordlicht & Tessera' })
    expect(xmlOk(svg)).toBe(true)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.match(/class="pb-fuse"/g)).toHaveLength(1)
    expect(svg).toContain('Inbox &lt;a&gt; &amp; b')
    expect(svg).toContain('„An Team-Chat“')
    expect(svg.match(/class="pb-wire( pb-wire--path)?"/g)).toHaveLength(l.wires.length)
    expect(svg.match(/class="pb-wire pb-wire--path"/g)).toHaveLength(2) // the F1 path: writes → flag, automation → webhook
    expect(svg.match(/class="pb-mod"/g)).toHaveLength(l.slots.filter((s) => s.kind === 'module').length)
    expect(svg.match(/class="pb-flag"/g)).toHaveLength(2)
    // fonts named with fallbacks; no module key or id leaks into the picture's attributes
    expect(svg).toContain("Archivo, 'Archivo Variable', 'Helvetica Neue', Arial, sans-serif")
    expect(svg).not.toMatch(/data-[a-z]+=/)
    // two fuses, one allowed: two glyphs, the allowed one in ink
    const second = {
      ...fuse,
      key: 'f2'.padEnd(64, '0'),
      label: 'F2',
      at: m.edges.find((x) => x.from === `${K.pipe}.out`)!.id,
      allowed: { state: 'allowed' as const, at: 1, by: null, changed: [] },
    }
    const two = renderStatic(m, l, { fuses: [fuse, second] })
    expect(xmlOk(two)).toBe(true)
    expect(two.match(/class="pb-fuse( pb-fuse--allowed)?"/g)).toHaveLength(2)
    expect(two.match(/class="pb-fuse pb-fuse--allowed"/g)).toHaveLength(1)
    // without a theme the tokens stay; the picture is written only with them (resolved + flattened in the browser case)
    expect(svg).toContain('var(--plate)')
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // every big rack renders too
    for (const w of [bigPatchbay(60), exits(), wideScope(40, { named: 9 })]) {
      const bm = modelOf(w)
      expect(xmlOk(renderStatic(bm, layoutRack(bm)))).toBe(true)
    }
  })

  test('flattenColors replaces every colour function (nested ones with it) and leaves the rest alone', () => {
    const calls: string[] = []
    const flat = (css: string) => {
      calls.push(css)
      return 'rgb(1, 2, 3)'
    }
    const out = flattenColors(
      '<rect fill="color-mix(in srgb, #121210 82%, color-mix(in srgb, #121210 13%, #faf9f5))" stroke="oklch(0.6 0.2 30)" opacity="0.5" stop-color="rgba(0, 0, 0, 0.2)"/>',
      flat,
    )
    expect(out).toBe('<rect fill="rgb(1, 2, 3)" stroke="rgb(1, 2, 3)" opacity="0.5" stop-color="rgba(0, 0, 0, 0.2)"/>')
    expect(calls).toEqual(['color-mix(in srgb, #121210 82%, color-mix(in srgb, #121210 13%, #faf9f5))', 'oklch(0.6 0.2 30)'])
  })

  test('layout budget: bigPatchbay(60) lays out in a few milliseconds (median of 9)', () => {
    const m = modelOf(bigPatchbay(60))
    layoutRack(m)
    const times: number[] = []
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now()
      layoutRack(m)
      times.push(performance.now() - t0)
    }
    const prev = layoutRack(m).order
    const seeded: number[] = []
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now()
      layoutRack(m, { prev })
      seeded.push(performance.now() - t0)
    }
    test
      .info()
      .annotations.push({
        type: 'layout ms',
        description: `fresh ${median(times).toFixed(2)} · seeded ${median(seeded).toFixed(2)} (${m.modules.length} modules, ${m.edges.length} cables)`,
      })
    expect(median(times)).toBeLessThan(15)
    expect(median(seeded)).toBeLessThan(15)
  })
})

/* ------------------------------------------------------------------ the browser case */

appTest.describe('B5 · the picture in a browser — flat colours, SVG, the stored order', () => {
  appTest('renderStatic resolved to the stock tokens and flattened holds no var( / color-mix( / oklch(; the order keeps keys only', async ({ page }) => {
    // one bundle of the picture's pure modules (the app is not involved): an entry file in the test's output folder
    const src = fileURLToPath(new URL('../../src', import.meta.url))
    const entry = appTest.info().outputPath('pb-static.ts')
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(
      entry,
      [
        `export { renderStatic } from '${src}/app/features/patchbay/render'`,
        `export { flatColor, flattenColors } from '${src}/app/features/patchbay/colors'`,
        `export { loadOrder, saveOrder } from '${src}/app/features/patchbay/layout'`,
        `export { resolveVars } from '${src}/app/features/charts/render/palette'`,
      ].join('\n'),
    )
    const out = await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': src } },
      build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'PatchbayStatic', fileName: 'pb-static' } },
    })
    const code = (Array.isArray(out) ? out[0] : out) as { output: Array<{ code: string }> }
    const m = modelOf(mock1())
    const fuse = f1(m)
    const l = layoutRack(m, { fuses: [fuse] })
    await openApp(page)
    await page.addScriptTag({ content: code.output[0].code })
    const res = await page.evaluate(
      ({ model, layout, fuse }) => {
        type Mod = typeof import('../../src/app/features/patchbay/render') &
          typeof import('../../src/app/features/patchbay/colors') &
          typeof import('../../src/app/features/patchbay/layout') &
          typeof import('../../src/app/features/charts/render/palette')
        const pb = (window as unknown as { PatchbayStatic: Mod }).PatchbayStatic
        const shot = (theme: 'light' | 'dark') => {
          const svg = pb.renderStatic(model, layout, { resolve: (t) => pb.resolveVars(t, theme), flat: pb.flatColor, fuses: [fuse], title: 'Nordlicht' })
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
          return {
            leftovers: ['var(', 'color-mix(', 'oklch(', 'currentColor'].filter((x) => svg.includes(x)),
            parsed: !doc.querySelector('parsererror') && doc.documentElement.nodeName === 'svg',
            fuses: doc.querySelectorAll('.pb-fuse').length,
            wires: doc.querySelectorAll('.pb-wire').length,
            bg: doc.querySelector('rect')?.getAttribute('fill') ?? '',
            rgb: (svg.match(/="rgba?\(/g) ?? []).length,
          }
        }
        const grey = pb.flatColor('color-mix(in srgb, #000000 50%, #ffffff)')
        const half = pb.flatColor('color-mix(in srgb, #000000 50%, transparent)')
        const lch = pb.flatColor('oklch(0.6 0.2 30)')
        // the stored order: module keys only, at most 200, junk dropped
        pb.saveOrder('local:local', ['agent:agInbox', 'automation:dbMails:autToChat', 'not a key', ...Array.from({ length: 250 }, (_, i) => `script:sc${i}`)])
        const kept = pb.loadOrder('local:local')
        localStorage.setItem('one.patchbay.order:local:local', '{"broken"')
        const broken = pb.loadOrder('local:local')
        return { light: shot('light'), dark: shot('dark'), grey, half, lch, kept: kept.length, first: kept.slice(0, 3), broken, none: pb.loadOrder(null) }
      },
      { model: m, layout: l, fuse },
    )
    for (const theme of [res.light, res.dark]) {
      expect(theme.leftovers).toEqual([])
      expect(theme.parsed).toBe(true)
      expect(theme.fuses).toBe(1)
      expect(theme.wires).toBe(l.wires.length)
      expect(theme.rgb).toBeGreaterThan(50)
      // a token that is a flat colour already (the page's --bg) stays as tokens.css writes it
      expect(theme.bg).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+, \d+, \d+\))$/i)
    }
    expect(res.light.bg).not.toBe(res.dark.bg)
    const [r, g, b] = (res.grey.match(/\d+/g) ?? []).map(Number)
    for (const v of [r, g, b]) expect(Math.abs(v - 128)).toBeLessThanOrEqual(1)
    expect(res.half).toMatch(/^rgba\(0, 0, 0, 0\.(49|5|50|502)\d*\)$/)
    expect(res.lch).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    expect(res.kept).toBe(200)
    expect(res.first).toEqual(['agent:agInbox', 'automation:dbMails:autToChat', 'script:sc0'])
    expect(res.broken).toEqual([])
    expect(res.none).toEqual([])
  })
})
