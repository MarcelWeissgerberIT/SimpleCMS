/**
 * Regler (governor) — the pure parts, run in Node by the Playwright runner (no browser, no network):
 *  - the stored shapes (src/shared/ai/governor.ts): sanitizer round trips, unknown keys kept ≤ 4 KB, `v` > 1 unreadable,
 *    ranges clamped, the standard governor is no value, saving rules kept unread, the device line, `governorGen` per field
 *    and when a stamp is kept, `loosensGovernor`;
 *  - the named generations (src/shared/ai/generations.ts): numbered 2, 3 … without gaps; every entry the build enforces
 *    names a module that exists and names it.
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
