/**
 * Regler (governor) — the pure parts, run in Node by the Playwright runner (no browser, no network):
 *  - the stored shapes (src/shared/ai/governor.ts): sanitizer round trips, unknown keys kept ≤ 4 KB, `v` > 1 unreadable,
 *    ranges clamped, the standard governor is no value, saving rules kept unread, the device line, `governorGen` per field
 *    and when a stamp is kept, `loosensGovernor`;
 *  - the named generations (src/shared/ai/generations.ts): numbered 2, 3 … without gaps; every entry the build enforces
 *    names a module that exists and names it;
 *  - the totals' pure core (features/governor/tally.ts, clock.ts): meters, delta pings once per batch, an older tab's
 *    ping → a read, the full read, the day and month roll at a fake midnight, the cache as a lower bound, device sums
 *    over two scopes;
 *  - the book of reservations across tabs (book.ts): messages, expiry, the scope filter, the caller's own excluded;
 *  - allowances (allow.ts), the device line and its scopes (device.ts), paused autofill rows (paused.ts) — with a
 *    storage of the spec's own.
 * Every value is fictional.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  AUTONOMY,
  GOVERNOR_LIMITS,
  autonomyRank,
  deviceGovernorGen,
  deviceKeepsGen,
  governorGen,
  governorKeepsGen,
  isReadableDeviceGovernor,
  isReadableGovernor,
  loosensGovernor,
  minAutonomy,
  readableSavers,
  sameDeviceGovernor,
  sameGovernor,
  sanitizeDeviceGovernor,
  sanitizeDeviceGovernorWithReport,
  sanitizeGovernor,
  sanitizeGovernorWithReport,
  type WorkspaceGovernor,
} from '../../src/shared/ai/governor'
import { GEN, GEN_ENFORCED, type GenTable } from '../../src/shared/ai/generations'
import { AI_POLICY_GEN } from '../../src/shared/ai/policy'
import { closedDaysBefore, dayOf, monthOf, nextMidnight } from '../../src/app/features/governor/clock'
import { cacheOf, closedTally, deltaTally, meterTally, monthSpentOf, newTally, readTally, readTodayCache, rollTally, sumTallies, tallyKnown, todayOf } from '../../src/app/features/governor/tally'
import { BOOK_STALE_MS, emptyBook, expireBook, hearBook, readBookMsg, reservedByOthers, reservedIn } from '../../src/app/features/governor/book'
import { allowOnce, allowTask, allowanceOf, clearAllowances, consume } from '../../src/app/features/governor/allow'
import { DEVICE_KEY, DEVICE_LINE_SPANS_BROWSER, MAX_SCOPES, SCOPES_KEY, deviceLimitOf, deviceLineScopes, forgetScopes, knownScopes, noteScope, readDeviceLimit, setDeviceLimit, type KV } from '../../src/app/features/governor/device'
import { PAUSED_MAX, addPaused, readPaused, takePaused, wipePaused } from '../../src/app/features/governor/paused'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** A full governor every field of which this build reads (Tessera's workspace). */
const FULL = {
  v: 1,
  autonomy: 'propose',
  moved: { from: 'apply', to: 'propose', at: 1_790_000_000_000, by: 'acc-mara-lind' },
  ceiling: 4,
  day: 6,
  month: 120,
  savers: [
    { id: 'sv_Nordlicht1', on: true, name: 'Scheduled to Sonnet', when: { who: ['scheduled', 'trigger'], agents: ['ag-nordlicht'], from: { p: 'anthropic', m: 'claude-opus-5-5' }, bandOver: 1 }, to: { p: 'anthropic', m: 'claude-sonnet-5-5' } },
    { id: 'sv_Tessera002', on: false, when: { cls: ['bulk'], dayOver: 0.5 }, to: { p: 'openrouter', m: 'vendor-a/model-b' } },
  ],
  worker: { governed: true },
  updatedAt: 1_790_000_000_001,
  updatedBy: 'acc-mara-lind',
}

const g = (x: Record<string, unknown>) => sanitizeGovernor({ v: 1, ...x }) as WorkspaceGovernor

test.describe('the stored governor (shared/ai/governor.ts)', () => {
  test('a full value survives a round trip unchanged; JSON in = JSON out', () => {
    const { value, repaired } = sanitizeGovernorWithReport(JSON.parse(JSON.stringify(FULL)))
    expect(repaired).toBe(false)
    expect(value).toEqual(FULL)
    // a second pass changes nothing (idempotent) and is the same value with and without stamps
    expect(sanitizeGovernor(value)).toEqual(FULL)
    expect(sameGovernor(value, sanitizeGovernor(FULL), { meta: true })).toBe(true)
    expect(isReadableGovernor(value)).toBe(true)
    expect(readableSavers(value).map((s) => s.id)).toEqual(['sv_Nordlicht1', 'sv_Tessera002'])
  })

  test('v missing reads as 1; junk v is repaired; a newer v is unreadable — kept whole, never acted on', () => {
    expect(sanitizeGovernor({ day: 6 })).toEqual({ v: 1, day: 6 })
    expect(sanitizeGovernorWithReport({ v: 'one', day: 6 })).toEqual({ value: { v: 1, day: 6 }, repaired: true })
    const newer = { v: 2, day: 'whatever a later build means', lanes: [1, 2, 3] }
    const { value, repaired } = sanitizeGovernorWithReport(newer)
    expect(repaired).toBe(false)
    expect(value).toEqual(newer)
    expect(value).not.toBe(newer)
    expect(isReadableGovernor(value)).toBe(false)
    expect(readableSavers(value)).toEqual([])
    // too big to keep as it was: still unreadable (a marker), never read as "no governor"
    const huge = sanitizeGovernor({ v: 3, blob: 'x'.repeat(GOVERNOR_LIMITS.opaqueBytes + 10) })
    expect(huge).toEqual({ unreadable: true })
    expect(isReadableGovernor(huge)).toBe(false)
  })

  test('unknown top-level keys are kept as they were (≤ 4 KB of JSON), else all dropped and repaired', () => {
    const later = { v: 1, day: 6, rings: { keep: 10 }, note: 'Nordlicht' }
    expect(sanitizeGovernorWithReport(later)).toEqual({ value: later, repaired: false })
    const over = sanitizeGovernorWithReport({ v: 1, day: 6, rings: 'r'.repeat(GOVERNOR_LIMITS.opaqueBytes) })
    expect(over).toEqual({ value: { v: 1, day: 6 }, repaired: true })
    // a value of unknown keys only is still a value (a later slice's field)
    expect(sanitizeGovernor({ v: 1, rings: { keep: 10 } })).toEqual({ v: 1, rings: { keep: 10 } })
    // functions and the like are no JSON: dropped, repaired
    expect(sanitizeGovernorWithReport({ v: 1, day: 6, fn: () => 1 }).repaired).toBe(true)
  })

  test('ranges: finite amounts are clamped (the limit stays a limit), anything else is dropped', () => {
    expect(sanitizeGovernorWithReport({ v: 1, day: 0.01, month: 0, ceiling: 5000 })).toEqual({ value: { v: 1, day: 0.1, month: 1, ceiling: 1000 }, repaired: true })
    expect(sanitizeGovernorWithReport({ v: 1, day: 20_000, month: 1e9, ceiling: 0 })).toEqual({ value: { v: 1, day: 10_000, month: 100_000, ceiling: 0.01 }, repaired: true })
    expect(sanitizeGovernorWithReport({ v: 1, day: Number.NaN, month: '120', ceiling: Infinity })).toEqual({ value: undefined, repaired: true })
    expect(sanitizeGovernorWithReport({ v: 1, day: 0.1, month: 1, ceiling: 0.01 }).repaired).toBe(false)
    expect(sanitizeGovernorWithReport({ v: 1, day: 10_000, month: 100_000, ceiling: 1000 }).repaired).toBe(false)
  })

  test('the standard governor is no value; stamps alone are none', () => {
    expect(sanitizeGovernor(undefined)).toBeUndefined()
    expect(sanitizeGovernor(null)).toBeUndefined()
    expect(sanitizeGovernorWithReport('day=6')).toEqual({ value: undefined, repaired: true })
    expect(sanitizeGovernorWithReport([6])).toEqual({ value: undefined, repaired: true })
    expect(sanitizeGovernor({ v: 1 })).toBeUndefined()
    expect(sanitizeGovernor({ v: 1, autonomy: 'apply', savers: [], worker: { governed: false }, updatedAt: 5, updatedBy: null })).toBeUndefined()
    // positive controls: each field alone is a value
    expect(g({ autonomy: 'read' })).toEqual({ v: 1, autonomy: 'read' })
    expect(g({ moved: { from: 'read', to: 'apply', at: 1, by: null } })).toEqual({ v: 1, moved: { from: 'read', to: 'apply', at: 1, by: null } })
    expect(g({ worker: { governed: true } })).toEqual({ v: 1, worker: { governed: true } })
    expect(g({ month: 50 })).toEqual({ v: 1, month: 50 })
  })

  test('lever fields: autonomy and moved are validated; by ≤ 200; at ≥ 0', () => {
    expect(sanitizeGovernorWithReport({ v: 1, day: 6, autonomy: 'paused' })).toEqual({ value: { v: 1, day: 6 }, repaired: true })
    expect(sanitizeGovernorWithReport({ v: 1, day: 6, moved: { from: 'apply', to: 'read', at: -1, by: null } }).repaired).toBe(true)
    expect(sanitizeGovernorWithReport({ v: 1, day: 6, moved: { from: 'apply', to: 'read', at: 1, by: 'x'.repeat(201) } }).repaired).toBe(true)
    expect(g({ day: 6, moved: { from: 'apply', to: 'read', at: 1 } }).moved).toEqual({ from: 'apply', to: 'read', at: 1, by: null })
    expect(sanitizeGovernorWithReport({ v: 1, day: 6, updatedBy: 7 }).repaired).toBe(true)
  })

  test('saving rules: readable ones sanitized, unreadable ones kept as they were (never matched), junk dropped', () => {
    const later = { id: 'sv_Later00001', on: true, when: { who: ['overnight'] }, to: { p: 'anthropic', m: 'claude-haiku-4-5' } }
    const widened = { id: 'sv_Clamped001', on: true, when: { bandOver: 5000 }, to: { p: 'anthropic', m: 'claude-haiku-4-5' } }
    const ok = { id: 'sv_Readable01', on: true, when: {}, to: { p: 'anthropic', m: 'claude-haiku-4-5', effort: 'loud' } }
    const { value, repaired } = sanitizeGovernorWithReport({ v: 1, savers: [later, 'junk', { id: 'nope' }, widened, ok, { ...ok }] })
    const v = value as WorkspaceGovernor
    // the duplicate id and the junk go; an invalid effort is dropped from the route (route.ts)
    expect(repaired).toBe(true)
    expect(v.savers).toEqual([later, widened, { id: 'sv_Readable01', on: true, when: {}, to: { p: 'anthropic', m: 'claude-haiku-4-5' } }])
    // a dropped or clamped condition would widen the rule: those stay unread
    expect(readableSavers(v).map((s) => s.id)).toEqual(['sv_Readable01'])
    // at most 20 rules
    const many = Array.from({ length: 25 }, (_, i) => ({ ...ok, id: `sv_Many${String(i).padStart(6, '0')}` }))
    expect((g({ savers: many }).savers ?? []).length).toBe(GOVERNOR_LIMITS.savers)
    // a model without a provider, an unknown provider, an agent id that is no id: unread
    for (const when of [{ from: { m: 'claude-opus-5-5' } }, { from: { p: 'mistral' } }, { agents: ['a b'] }, { who: 'scheduled' }])
      expect(readableSavers(g({ savers: [{ ...ok, when }] }))).toEqual([])
  })

  test('sameGovernor compares by value; stamps count only with meta', () => {
    const a = g({ day: 6, updatedAt: 1, updatedBy: 'acc-a' })
    const b = g({ day: 6, updatedAt: 2, updatedBy: 'acc-b' })
    expect(sameGovernor(a, b)).toBe(true)
    expect(sameGovernor(a, b, { meta: true })).toBe(false)
    expect(sameGovernor(a, g({ day: 7, updatedAt: 1, updatedBy: 'acc-a' }))).toBe(false)
    // key order never matters
    expect(sameGovernor(g({ day: 6, month: 120 }), sanitizeGovernor({ month: 120, v: 1, day: 6 }), { meta: true })).toBe(true)
    expect(sameGovernor(undefined, null)).toBe(true)
    expect(sameGovernor(a, undefined)).toBe(false)
  })

  test('the device line: the same rules, no lever and no rules in it', () => {
    expect(sanitizeDeviceGovernorWithReport({ v: 1, day: 8, month: 150, at: 5 })).toEqual({ value: { v: 1, day: 8, month: 150, at: 5 }, repaired: false })
    expect(sanitizeDeviceGovernor({ v: 1, at: 5 })).toBeUndefined()
    expect(sanitizeDeviceGovernorWithReport({ v: 1, day: 0, month: 'x' })).toEqual({ value: { v: 1, day: 0.1 }, repaired: true })
    const newer = sanitizeDeviceGovernor({ v: 2, day: 8, perProvider: { openrouter: 3 } })
    expect(isReadableDeviceGovernor(newer)).toBe(false)
    expect(newer).toEqual({ v: 2, day: 8, perProvider: { openrouter: 3 } })
    // autonomy is no device field: kept as an unknown key (a later build's), never read
    expect(sanitizeDeviceGovernor({ v: 1, day: 8, autonomy: 'off' })).toEqual({ v: 1, day: 8, autonomy: 'off' })
    expect(sameDeviceGovernor(sanitizeDeviceGovernor({ v: 1, day: 8 }), sanitizeDeviceGovernor({ day: 8, v: 1 }))).toBe(true)
  })

  test('autonomy order', () => {
    expect(AUTONOMY).toEqual(['off', 'read', 'propose', 'apply'])
    expect(autonomyRank('off')).toBeLessThan(autonomyRank('read'))
    expect(minAutonomy('apply', 'read')).toBe('read')
    expect(minAutonomy('off', 'propose')).toBe('off')
  })
})

test.describe('generations', () => {
  test('governorGen per field; a stamp is kept where this build cannot judge the value', () => {
    expect(governorGen(undefined)).toBe(1)
    expect(governorGen(g({ day: 6 }))).toBe(GEN.budget)
    expect(governorGen(g({ month: 120 }))).toBe(GEN.budget)
    expect(governorGen(g({ worker: { governed: true } }))).toBe(GEN.budget)
    // saving rules stamp nothing
    expect(governorGen(g({ savers: FULL.savers }))).toBe(1)
    expect(governorKeepsGen(g({ savers: FULL.savers }))).toBe(false)
    expect(governorKeepsGen(g({ day: 6 }))).toBe(false)
    // the lever / a ceiling: G1's table has no `lever` — this build cannot judge them, the stamp is kept
    for (const x of [{ autonomy: 'propose' }, { ceiling: 4 }]) {
      expect(governorGen(g(x))).toBe(1)
      expect(governorKeepsGen(g(x))).toBe(true)
    }
    // positive control: a table that names the lever (G2) stamps it and judges it
    const g2: GenTable = { ...GEN, lever: 4 }
    expect(governorGen(g({ autonomy: 'read', day: 6 }), g2)).toBe(4)
    expect(governorGen(g({ ceiling: 4 }), g2)).toBe(4)
    expect(governorKeepsGen(g({ ceiling: 4 }), g2)).toBe(false)
    // 'apply' is no lever position worth a stamp
    expect(governorGen(g({ autonomy: 'apply', day: 6 }), g2)).toBe(GEN.budget)
    // unknown keys and newer shapes: never lowered here
    expect(governorKeepsGen(g({ day: 6, rings: 1 }))).toBe(true)
    expect(governorGen(sanitizeGovernor({ v: 2, day: 6 }))).toBe(1)
    expect(governorKeepsGen(sanitizeGovernor({ v: 2, day: 6 }))).toBe(true)
  })

  test('deviceGovernorGen: a device limit needs the budget generation', () => {
    expect(deviceGovernorGen(undefined)).toBe(1)
    expect(deviceGovernorGen(sanitizeDeviceGovernor({ v: 1, day: 8 }))).toBe(GEN.budget)
    expect(deviceGovernorGen(sanitizeDeviceGovernor({ v: 1, month: 80 }))).toBe(GEN.budget)
    expect(deviceKeepsGen(sanitizeDeviceGovernor({ v: 1, day: 8 }))).toBe(false)
    expect(deviceKeepsGen(sanitizeDeviceGovernor({ v: 2, day: 8 }))).toBe(true)
    expect(deviceKeepsGen(sanitizeDeviceGovernor({ v: 1, day: 8, later: true }))).toBe(true)
  })

  /** What is wrong with a table at a build generation (the check the test runs on the real one). */
  function problems(gen: GenTable, enforced: Record<string, string>, build: number): string[] {
    const out: string[] = []
    const nums = Object.values(gen).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
    nums.forEach((n, i) => n !== i + 2 && out.push(`gap at ${n}`))
    for (const [name, n] of Object.entries(gen)) {
      if (n === undefined || n > build) continue
      const file = enforced[name]
      if (!file || !existsSync(`${ROOT}${file}`)) out.push(`${name}: no module`)
      else if (!readFileSync(`${ROOT}${file}`, 'utf8').includes(`GEN.${name}`)) out.push(`${name}: ${file} does not name it`)
    }
    return out
  }

  test('numbered 2, 3 … without gaps; every enforced entry names an existing module that names it', () => {
    expect(problems(GEN, GEN_ENFORCED, AI_POLICY_GEN)).toEqual([])
    expect(Object.keys(GEN_ENFORCED).sort()).toEqual(Object.keys(GEN).sort())
    // positive controls: a gap, a missing module and a module that does not name its entry are found
    expect(problems({ a: 2, b: 4 }, { a: 'package.json', b: 'package.json' }, 1)).toEqual(['gap at 4'])
    expect(problems({ a: 2 }, { a: 'src/app/nowhere.ts' }, 2)).toEqual(['a: no module'])
    expect(problems({ a: 2 }, { a: 'package.json' }, 2)).toEqual(['a: package.json does not name it'])
  })
})

test.describe('what a backup would loosen', () => {
  test('budgets raised / removed, the lever raised, the ceiling raised / removed, the worker no longer governed', () => {
    const mine = g({ day: 6, month: 120, autonomy: 'propose', ceiling: 4, worker: { governed: true } })
    expect(loosensGovernor(mine, mine)).toEqual([])
    expect(loosensGovernor(mine, g({ day: 5, month: 100, autonomy: 'read', ceiling: 2, worker: { governed: true } }))).toEqual([])
    expect(loosensGovernor(mine, g({ day: 9, autonomy: 'apply', ceiling: 8 }))).toEqual([
      { kind: 'budget', what: 'day', from: 6, to: 9 },
      { kind: 'budget', what: 'month', from: 120, to: null },
      { kind: 'lever', from: 'propose', to: 'apply' },
      { kind: 'ceiling', from: 4, to: 8 },
      { kind: 'worker' },
    ])
    expect(loosensGovernor(mine, undefined)).toHaveLength(5)
    // taking a governor where there was none only tightens
    expect(loosensGovernor(undefined, mine)).toEqual([])
    expect(loosensGovernor(mine, sanitizeGovernor({ v: 2, day: 1 }))).toEqual([{ kind: 'unreadable' }])
    expect(loosensGovernor(sanitizeGovernor({ v: 2, day: 1 }), mine)).toEqual([{ kind: 'unreadable' }])
  })
})

/* ------------------------------------------------------------------ */
/* A3 — totals, book, allowances, device line, paused rows              */
/* ------------------------------------------------------------------ */

/** A local time (the Node process's zone — every expectation is in the same zone). */
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

/** A storage of the spec's own. */
function memoryKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

const delta = (batch: string | null, usd: number, day: string | null, unpriced = 0) => ({ scope: 'local:local', day, usd, unpriced, batch })

test.describe('clock (features/governor/clock.ts)', () => {
  test('local days, months, the closed days before a day, the next midnight', () => {
    expect(dayOf(at(2026, 10, 9, 0, 0))).toBe('2026-10-09')
    expect(dayOf(at(2026, 10, 9, 23, 59))).toBe('2026-10-09')
    expect(monthOf('2026-10-09')).toBe('2026-10')
    expect(closedDaysBefore('2026-10-03')).toEqual(['2026-10-01', '2026-10-02'])
    expect(closedDaysBefore('2026-10-01')).toEqual([])
    expect(nextMidnight(at(2026, 10, 9, 14, 6))).toBe(at(2026, 10, 10, 0, 0))
  })
})

test.describe('totals: the pure core (features/governor/tally.ts)', () => {
  const T0 = at(2026, 10, 9, 14, 6)

  test("this tab's meters and the other tabs' deltas; a batch heard twice counts once; an older tab's ping asks for a read", () => {
    const t = newTally('local:local', T0)
    meterTally(t, { id: 'e1', at: T0, usd: 0.25 }, T0)
    meterTally(t, { id: 'e2', at: T0, usd: null }, T0)
    meterTally(t, { id: 'e1', at: T0, usd: 0.25 }, T0)
    expect(todayOf(t)).toEqual({ usd: 0.25, unpriced: 1 })
    expect(deltaTally(t, delta('b1', 1.5, '2026-10-09', 1), T0)).toBe('added')
    expect(deltaTally(t, delta('b1', 1.5, '2026-10-09', 1), T0)).toBe('dup')
    expect(todayOf(t)).toEqual({ usd: 1.75, unpriced: 2 })
    // positive control: another batch counts
    expect(deltaTally(t, delta('b2', 0.5, '2026-10-09'), T0)).toBe('added')
    expect(todayOf(t).usd).toBe(2.25)
    // an older tab's { scope } ping: nothing counted, read again
    expect(deltaTally(t, delta(null, 0, null), T0)).toBe('read')
    expect(deltaTally(t, delta('b3', 9, '2026-10-08'), T0)).toBe('skip')
    expect(todayOf(t).usd).toBe(2.25)
    expect(tallyKnown(t)).toBe(false)
  })

  test("a full read replaces the day: this tab's entries it holds leave, deltas heard while it ran stay", () => {
    const t = newTally('local:local', T0)
    meterTally(t, { id: 'e1', at: T0, usd: 0.25 }, T0)
    meterTally(t, { id: 'e2', at: T0 + 10, usd: 0.75 }, T0 + 10)
    deltaTally(t, delta('before', 1, '2026-10-09'), T0 + 20)
    deltaTally(t, delta('during', 2, '2026-10-09'), T0 + 40)
    // the read started at T0 + 30 and holds e1, the "before" batch's entry (x1) and one more (x2)
    expect(readTally(t, '2026-10-09', [{ id: 'e1', usd: 0.25 }, { id: 'x1', usd: 1 }, { id: 'x2', usd: null }], T0 + 30, T0 + 50)).toBe(true)
    // read 1.25 (+1 unpriced) + own e2 0.75 + the batch heard while it ran 2
    expect(todayOf(t)).toEqual({ usd: 4, unpriced: 1 })
    expect(tallyKnown(t)).toBe(true)
    // an entry the read holds, metered again, is not counted twice
    meterTally(t, { id: 'x1', at: T0, usd: 1 }, T0 + 60)
    expect(todayOf(t).usd).toBe(4)
    // a read of a day that rolled meanwhile is ignored
    expect(readTally(t, '2026-10-08', [], T0, T0 + 70)).toBe(false)
  })

  test('the cache is a lower bound until the first read; month = closed days + today', () => {
    const cache = readTodayCache({ day: '2026-10-09', usd: 4.12, unpriced: 1, monthUsd: 33.4, at: T0 - 1000 })
    expect(cache).toEqual({ day: '2026-10-09', usd: 4.12, unpriced: 1, month: '2026-10', monthUsd: 33.4, at: T0 - 1000 })
    const t = newTally('local:local', T0, cache)
    expect(todayOf(t)).toEqual({ usd: 4.12, unpriced: 1 })
    expect(monthSpentOf(t)).toBeCloseTo(33.4, 10)
    // this tab's own spend above the cache wins; below it, the cache stays the floor
    meterTally(t, { id: 'e1', at: T0, usd: 0.5 }, T0)
    expect(todayOf(t).usd).toBe(4.12)
    meterTally(t, { id: 'e2', at: T0, usd: 5 }, T0)
    expect(todayOf(t).usd).toBe(5.5)
    // the month's closed days read: they replace the floor
    expect(closedTally(t, '2026-10-09', 30, T0)).toBe(true)
    expect(monthSpentOf(t)).toBe(35.5)
    // a cache of an earlier day this month: all of it is closed now; of another month: nothing
    expect(monthSpentOf(newTally('s', T0, readTodayCache({ day: '2026-10-08', usd: 2, monthUsd: 20 })))).toBe(20)
    expect(todayOf(newTally('s', T0, readTodayCache({ day: '2026-10-08', usd: 2, monthUsd: 20 }))).usd).toBe(0)
    expect(monthSpentOf(newTally('s', T0, readTodayCache({ day: '2026-09-30', usd: 2, monthUsd: 90 })))).toBe(0)
    expect(readTodayCache({ day: 'yesterday', usd: 1 })).toBeNull()
    expect(readTodayCache({ day: '2026-10-09', usd: -3, monthUsd: 'x' })).toEqual({ day: '2026-10-09', usd: 0, unpriced: 0, month: '2026-10', monthUsd: 0, at: 0 })
  })

  test('the day rolls at a fake midnight (no timer): today starts at 0, the month keeps the day that ended', () => {
    const t = newTally('local:local', at(2026, 10, 9, 23, 58))
    meterTally(t, { id: 'e1', at: at(2026, 10, 9, 23, 58), usd: 1.2 }, at(2026, 10, 9, 23, 58))
    closedTally(t, '2026-10-09', 30, at(2026, 10, 9, 23, 58))
    expect(rollTally(t, at(2026, 10, 9, 23, 59))).toBe(false)
    expect(rollTally(t, at(2026, 10, 10, 0, 1))).toBe(true)
    expect(t.day).toBe('2026-10-10')
    expect(todayOf(t)).toEqual({ usd: 0, unpriced: 0 })
    expect(monthSpentOf(t)).toBeCloseTo(31.2, 10)
    // closed days are read again for the new day
    expect(t.closed).toBeNull()
    // an entry metered at 23:59 that arrives after the roll belongs to yesterday: not today's
    meterTally(t, { id: 'late', at: at(2026, 10, 9, 23, 59), usd: 0.4 }, at(2026, 10, 10, 0, 2))
    expect(todayOf(t).usd).toBe(0)
    // a new month starts at 0
    const m = newTally('local:local', at(2026, 10, 31, 23, 0))
    meterTally(m, { id: 'e', at: at(2026, 10, 31, 23, 0), usd: 3 }, at(2026, 10, 31, 23, 0))
    meterTally(m, { id: 'f', at: at(2026, 11, 1, 0, 30), usd: 0.2 }, at(2026, 11, 1, 0, 30))
    expect(m.day).toBe('2026-11-01')
    expect(todayOf(m).usd).toBe(0.2)
    expect(monthSpentOf(m)).toBe(0.2)
    // a delta of the new day rolls an idle tally too
    const idle = newTally('local:local', at(2026, 10, 9, 22, 0))
    expect(deltaTally(idle, delta('n1', 0.3, '2026-10-10'), at(2026, 10, 10, 0, 5))).toBe('added')
    expect(todayOf(idle).usd).toBe(0.3)
  })

  test('the cache written after a read; device sums over two scopes', () => {
    const a = newTally('local:local', T0)
    readTally(a, '2026-10-09', [{ id: 'a1', usd: 1 }], T0, T0)
    closedTally(a, '2026-10-09', 10, T0)
    expect(cacheOf(a, T0)).toEqual({ day: '2026-10-09', usd: 1, unpriced: 0, month: '2026-10', monthUsd: 11, at: T0 })
    const b = newTally('cloud:ws-tessera-0001:u:acc-mara-lind', T0, readTodayCache({ day: '2026-10-09', usd: 0.2, monthUsd: 1.2 }))
    expect(sumTallies([a, b])).toEqual({ today: 1.2, month: 12.2 })
    expect(sumTallies([])).toEqual({ today: 0, month: 0 })
  })
})

test.describe('the book of reservations across tabs (features/governor/book.ts)', () => {
  const N = 1_790_000_000_000

  test('messages are read strictly; a list replaces the last; an empty list or a bye forgets the tab', () => {
    expect(readBookMsg({ type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.4, scope: 'local:local' }, { id: 'bad id', usd: 1 }, { id: 'r2', usd: -1 }], at: N })).toEqual({
      type: 'res',
      tab: 'tab-a',
      scope: 'local:local',
      list: [{ id: 'r1', usd: 0.4, scope: 'local:local' }],
      at: N,
    })
    // an item without a scope counts for the tab's
    expect(readBookMsg({ type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.4 }], at: N })).toMatchObject({ list: [{ id: 'r1', usd: 0.4, scope: 'local:local' }] })
    // a ledger ping is no book message
    expect(readBookMsg({ scope: 'local:local' })).toBeNull()
    expect(readBookMsg({ scope: 'local:local', day: '2026-10-09', usd: 1, unpriced: 0, batch: 'b1' })).toBeNull()
    expect(readBookMsg({ type: 'bye', tab: 'tab-a' })).toEqual({ type: 'bye', tab: 'tab-a' })
    const book = emptyBook()
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.4, scope: 'local:local' }], at: N }, N)
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.9, scope: 'local:local' }], at: N }, N)
    expect(reservedByOthers(book, N)).toBe(0.9)
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [], at: N }, N)
    expect(book.others.size).toBe(0)
    hearBook(book, { type: 'res', tab: 'tab-b', scope: 'local:local', list: [{ id: 'r3', usd: 1 }].map((r) => ({ ...r, scope: 'local:local' })), at: N }, N)
    hearBook(book, { type: 'bye', tab: 'tab-b' }, N)
    expect(book.others.size).toBe(0)
  })

  test("expiry after 2 minutes; the scope filter; the caller's own reservation is never counted", () => {
    const book = emptyBook()
    const team = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'a1', usd: 0.5, scope: 'local:local' }, { id: 'a2', usd: 0.25, scope: team }], at: N }, N)
    hearBook(book, { type: 'res', tab: 'tab-b', scope: team, list: [{ id: 'b1', usd: 2, scope: team }], at: N }, N + 60_000)
    const own = [
      { id: 'mine', usd: 1, scope: 'local:local' },
      { id: 'mine2', usd: 0.1, scope: team },
    ]
    expect(reservedIn(own, book, N + 1000, ['local:local'])).toBe(1.5)
    expect(reservedIn(own, book, N + 1000, [team])).toBeCloseTo(2.35, 10)
    expect(reservedIn(own, book, N + 1000, null)).toBeCloseTo(3.85, 10)
    // the run's own next step is not braked by itself
    expect(reservedIn(own, book, N + 1000, ['local:local'], 'mine')).toBe(0.5)
    expect(reservedIn(own, book, N + 1000, null, 'b1')).toBeCloseTo(1.85, 10)
    // tab A stops speaking: gone 2 minutes after its last message (B is renewed later)
    expireBook(book, N + BOOK_STALE_MS)
    expect(book.others.has('tab-a')).toBe(true)
    expect(reservedIn([], book, N + BOOK_STALE_MS + 1, null)).toBe(2)
    expect(book.others.has('tab-a')).toBe(false)
    expect(reservedByOthers(book, N + 60_000 + BOOK_STALE_MS + 1)).toBe(0)
  })
})

test.describe('allowances (features/governor/allow.ts)', () => {
  test.beforeEach(() => clearAllowances())

  test('a one-request token: counted for the request that carries it, consumed once; another day counts nothing', () => {
    const now = at(2026, 10, 9, 14, 6)
    const tok = allowOnce(1, now)
    expect(allowanceOf({ source: 'palette:p1', allowance: tok.id }, now)).toBe(1)
    // the next request of the same purpose carries no token: nothing
    expect(allowanceOf({ source: 'palette:p2' }, now)).toBe(0)
    expect(consume(tok.id)).toBe(true)
    expect(consume(tok.id)).toBe(false)
    expect(allowanceOf({ source: 'palette:p1', allowance: tok.id }, now)).toBe(0)
    const old = allowOnce(1, at(2026, 10, 8, 23, 0))
    expect(allowanceOf({ allowance: old.id }, now)).toBe(0)
    expect(consume(null)).toBe(false)
  })

  test('a task allowance holds for that task and today only; each press adds', () => {
    const now = at(2026, 10, 9, 14, 6)
    expect(allowTask('terminal:c1:t1', 1, now)).toBe(1)
    expect(allowTask('terminal:c1:t1', 1, now + 1000)).toBe(2)
    expect(allowanceOf({ source: 'terminal:c1:t1' }, now)).toBe(2)
    expect(allowanceOf({ source: 'terminal:c1:t2' }, now)).toBe(0)
    expect(allowanceOf({ source: 'terminal:c1:t1' }, at(2026, 10, 10, 0, 1))).toBe(0)
    // a press on the next day starts over
    expect(allowTask('terminal:c1:t1', 1, at(2026, 10, 10, 0, 1))).toBe(1)
    expect(allowTask('agent:ag-nordlicht:r7', Number.NaN, now)).toBe(0)
  })
})

test.describe('the device line (features/governor/device.ts)', () => {
  test('set, read, remove; a newer value is never written over; storage refused says so', () => {
    const kv = memoryKV()
    expect(deviceLimitOf(kv)).toBeUndefined()
    expect(setDeviceLimit({ day: 8, month: null }, kv, 5)).toEqual({ ok: true, value: { v: 1, day: 8, at: 5 } })
    expect(JSON.parse(kv.map.get(DEVICE_KEY) ?? 'null')).toEqual({ v: 1, day: 8, at: 5 })
    expect(deviceLimitOf(kv)).toEqual({ v: 1, day: 8, at: 5 })
    expect(setDeviceLimit({ day: null, month: null }, kv)).toEqual({ ok: true, value: undefined })
    expect(kv.map.has(DEVICE_KEY)).toBe(false)
    kv.setItem(DEVICE_KEY, JSON.stringify({ v: 2, day: 8, perProvider: { openrouter: 3 } }))
    expect(readDeviceLimit(kv)).toEqual({ v: 2, day: 8, perProvider: { openrouter: 3 } })
    expect(deviceLimitOf(kv)).toBeUndefined()
    expect(setDeviceLimit({ day: 5 }, kv)).toEqual({ ok: false, why: 'newer' })
    kv.setItem(DEVICE_KEY, '{broken')
    expect(readDeviceLimit(kv)).toBeUndefined()
    const refused: KV = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    expect(setDeviceLimit({ day: 5 }, refused)).toEqual({ ok: false, why: 'storage' })
    expect(setDeviceLimit({ day: 5 }, null)).toEqual({ ok: false, why: 'storage' })
  })

  test('scopes metered here: newest first, 35 days, ≤ 50; the device line spans them (owner decision 1)', () => {
    const kv = memoryKV()
    const now = at(2026, 10, 9, 14, 6)
    const team = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    expect(noteScope('local:local', at(2026, 10, 1), kv)).toBe(true)
    expect(noteScope(team, now, kv)).toBe(true)
    expect(noteScope('not a scope|x', now, kv)).toBe(false)
    expect(knownScopes(now, kv)).toEqual([{ scope: team, last: '2026-10-09' }, { scope: 'local:local', last: '2026-10-01' }])
    // 35 days later the local scope is no longer listed
    expect(knownScopes(at(2026, 11, 6), kv).map((s) => s.scope)).toEqual([team])
    for (let i = 0; i < 60; i++) noteScope(`cloud:ws${String(i).padStart(4, '0')}:u:acc`, now + i, kv)
    expect(JSON.parse(kv.map.get(SCOPES_KEY) ?? '[]')).toHaveLength(MAX_SCOPES)
    forgetScopes((s) => s.startsWith('cloud:ws00'), kv)
    expect(knownScopes(now, kv).some((s) => s.scope.startsWith('cloud:ws00'))).toBe(false)
    // the open scope first, then every other scope of this browser (once)
    expect(DEVICE_LINE_SPANS_BROWSER).toBe(true)
    const known = [{ scope: team, last: '2026-10-09' }, { scope: 'local:local', last: '2026-10-01' }]
    expect(deviceLineScopes('local:local', known)).toEqual(['local:local', team])
    expect(deviceLineScopes(null, known)).toEqual([team, 'local:local'])
    expect(deviceLineScopes('cloud:ws-new:u:acc', [])).toEqual(['cloud:ws-new:u:acc'])
  })
})

test.describe('paused autofill rows (features/governor/paused.ts)', () => {
  const row = (n: number, at = 1000 + n) => ({ db: 'db-launch', prop: 'prop-summary', row: `row-${n}`, cause: 'you~ui', at })

  test('added, deduplicated (the newer cause wins), taken by database / field, wiped', () => {
    const kv = memoryKV()
    addPaused('local:local', [row(1), row(2)], kv)
    addPaused('local:local', [{ ...row(1, 5000), cause: 'mcp:s1:c1:one_update_row' }], kv)
    expect(readPaused('local:local', kv).rows.map((r) => [r.row, r.cause])).toEqual([
      ['row-2', 'you~ui'],
      ['row-1', 'mcp:s1:c1:one_update_row'],
    ])
    // a cause outside the writer-key alphabet is not kept
    addPaused('local:local', [{ ...row(3), cause: 'drop table; --' }], kv)
    expect(readPaused('local:local', kv).rows.find((r) => r.row === 'row-3')?.cause).toBeNull()
    addPaused('local:local', [{ ...row(4), prop: 'prop-owner' }], kv)
    expect(takePaused('local:local', { db: 'db-launch', prop: 'prop-owner' }, kv).map((r) => r.row)).toEqual(['row-4'])
    expect(readPaused('local:local', kv).rows).toHaveLength(3)
    // another scope is another list
    expect(readPaused('cloud:ws-tessera-0001:u:acc-mara-lind', kv).rows).toEqual([])
    expect(takePaused('local:local', {}, kv)).toHaveLength(3)
    expect(kv.map.size).toBe(0)
    addPaused('local:local', [row(9)], kv)
    wipePaused('local:local', kv)
    expect(readPaused('local:local', kv)).toEqual({ rows: [], dropped: 0 })
  })

  test('at most 200: the oldest go and are counted', () => {
    const kv = memoryKV()
    addPaused('local:local', Array.from({ length: 150 }, (_, i) => row(i)), kv)
    const list = addPaused('local:local', Array.from({ length: 80 }, (_, i) => row(1000 + i)), kv)
    expect(list.rows).toHaveLength(PAUSED_MAX)
    expect(list.dropped).toBe(30)
    expect(list.rows[0].row).toBe('row-30')
    expect(readPaused('local:local', kv)).toEqual(list)
    // junk in storage reads as nothing
    kv.setItem('one.governor.paused:local:local', '[1,2')
    expect(readPaused('local:local', kv)).toEqual({ rows: [], dropped: 0 })
  })
})
