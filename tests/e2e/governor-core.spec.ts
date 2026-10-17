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
 *    storage of the spec's own;
 *  - the brake core (limits.ts, steps.ts, brake.ts): workspace and device lines, reservations here and elsewhere, the
 *    caller's own reservation excluded, allowances, run budgets; oneShot (identity · pass · cap for text only · never with
 *    MCP · refuse with E only when it then fits · cheaper · noprice · scope); round (go · halt for terminal tasks · stop for
 *    every agent mode); the next step (C as read or input, Δ, MCP iterations, the first step on FIRST_STEP_OUT); H (the
 *    68k cold-cache example, 250k context, a 300-page PDF, MCP, thinking); the start check;
 *  - agent runs the Regler held (features/agents/held.ts): one not-started record per agent and day with its count and
 *    times, a stop that keeps the proposals, pruning that never drops a run with open proposals (≤ 50 more, then said),
 *    health's newest real run (a hold lights no fail lamp, an earlier failure stays lit);
 *  - the Preflight lamp VERBRAUCH's reading (lamp.ts): amber from 75 % (count 1, never MASTER CAUTION), red at the line
 *    with the day's held / paused / halt ids, acknowledged per band per day; the numbers as shown (format.ts);
 *  - the drawn instruments' geometry (gauge.ts): the dial's scale, ticks and numerals, the mini bar, the month bar.
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
  isGovernorMarker,
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
  stampDeviceGen,
  stampGen,
  type WorkspaceGovernor,
} from '../../src/shared/ai/governor'
import { GEN, GEN_ENFORCED, GEN_UNNAMED_UPTO, type GenTable } from '../../src/shared/ai/generations'
import { AI_POLICY_GEN } from '../../src/shared/ai/policy'
import { AI_ERROR_CODES, BUDGET_DETAILS, fallbackOf, isAIErrorCode, isBudgetDetail } from '../../src/shared/ai/errors'
import { messages as coreMessages } from '../../src/app/features/messages-core'
import { closedDaysBefore, dayOf, monthOf, nextMidnight } from '../../src/app/features/governor/clock'
import { consumerOf, consumersOf, daysOf, providersOf, rollOf, runsOf } from '../../src/app/features/governor/consumers'
import { applyDayRead, cacheOf, closedDaysOf, closedTally, deltaTally, meterTally, monthSpentOf, newTally, readTally, readTodayCache, rollTally, sumTallies, tallyKnown, todayOf, type DayRead } from '../../src/app/features/governor/tally'
import { BOOK_STALE_MS, emptyBook, expireBook, hearBook, readBookMsg, reservedByOthers, reservedIn } from '../../src/app/features/governor/book'
import { allowOnce, allowTask, allowanceOf, clearAllowances, consume } from '../../src/app/features/governor/allow'
import { DEVICE_KEY, DEVICE_LINE_SPANS_BROWSER, MAX_SCOPES, SCOPES_KEY, deviceLimitOf, deviceLineScopes, forgetScopes, knownScopes, mergeScopes, noteScope, readDeviceLimit, setDeviceLimit, type KV } from '../../src/app/features/governor/device'
import { imageChars, messagesChars, notePdfPages, pdfChars } from '../../src/app/features/ai/core/sizes'
import { PAUSED_MAX, addPaused, readPaused, takePaused, wipePaused } from '../../src/app/features/governor/paused'
import { NO_LIMITS, fits, hasLimit, hasMonthLimit, limitsOf, lineOf, restMin, restOf, type Limits, type Rest, type TotalsLike } from '../../src/app/features/governor/limits'
import { FIRST_STEP_OUT, MCP_ROUNDS, coldCost, contextOf, mcpOneShotBand, mcpReads, nextStep, stepOutputs, switchBand } from '../../src/app/features/governor/steps'
import { ALLOW_USD, allowFits, capFor, cheaperRoute, oneShot, type OneShotCtx, type RefuseDetail, type RunMode } from '../../src/app/features/governor/brake'
import { AGENTS_WAIT_MID_RUN, H_ACROSS_THINKING, asksAtStart, capsHold, cheaperForHalt, needsOfHistory, round, startCheckPure, waitsAtLine, type HCandidate } from '../../src/app/features/governor/halt'
import { HELD_TIMES, PRUNE_EXTRA, heldDay, heldId, heldNotStarted, heldStopped, mergeRun, newestReal, openProposals, pruneRuns } from '../../src/app/features/agents/held'
import type { AgentRun } from '../../src/app/features/agents/types'
import { AMBER_SHARE, readUsageLamp, usageLine } from '../../src/app/features/governor/lamp'
import { fmtBand, fmtLimit, fmtNum, fmtOf, fmtScale, fmtTok } from '../../src/app/features/governor/format'
import { SWEEP, angleOf, arcPath, dialNumerals, dialScale, dialTicks, miniBar, monthBar } from '../../src/app/features/governor/gauge'
import { messages as governorMessages } from '../../src/app/features/governor/messages'
import { blendedPerM, costOf, priceRow } from '../../src/shared/ai/prices'
import { capsOf } from '../../src/shared/ai/models'
import type { Caps, ChatRequest, ModelInfo, PriceRow, Route, Usage, WireHints } from '../../src/shared/ai/types'
import { build, type BuildOpts } from '../../src/shared/ai/wire/openrouterChat'
import { wireMaxTokens } from '../../src/shared/ai/wire/maxTokens'
import { JEV_ROUTER } from '../../src/shared/ai/jev'
import { estimate, wireOutFor } from '../../src/app/features/governor/estimate'
import { CALLER_MODE, RUN_MODES, SOURCE_RE, minOut, missesMode, modeOf, sourceFor } from '../../src/app/features/governor/modes'
import { PURPOSES } from '../../src/app/features/ai/core/purposes'

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
    // a newer shape is kept whole above the 4 KB of unknown keys (20 rules × 50 agents of a later build)
    const big = { v: 3, savers: Array.from({ length: 20 }, (_, i) => ({ id: `sv_Big${String(i).padStart(7, '0')}`, agents: Array.from({ length: 50 }, (_, j) => `ag-nordlicht-${j}`) })) }
    expect(JSON.stringify(big).length).toBeGreaterThan(GOVERNOR_LIMITS.opaqueBytes)
    expect(sanitizeGovernor(big)).toEqual(big)
    // too big to keep at all: a marker that stays unreadable on every later pass, never read as "no governor"
    const huge = sanitizeGovernor({ v: 3, blob: 'x'.repeat(GOVERNOR_LIMITS.newerBytes + 10) })
    expect(isReadableGovernor(huge)).toBe(false)
    expect(isGovernorMarker(huge)).toBe(true)
    const again = sanitizeGovernorWithReport(JSON.parse(JSON.stringify(huge)))
    expect(again).toEqual({ value: huge, repaired: false })
    expect(isReadableGovernor(sanitizeGovernor(again.value))).toBe(false)
    expect(governorKeepsGen(again.value)).toBe(true)
    // positive control: a newer value kept whole is no marker
    expect(isGovernorMarker(sanitizeGovernor(big))).toBe(false)
    // the device line the same way
    const dev = sanitizeDeviceGovernor({ v: 2, blob: 'x'.repeat(GOVERNOR_LIMITS.newerBytes + 10) })
    expect(isGovernorMarker(dev)).toBe(true)
    expect(isReadableDeviceGovernor(sanitizeDeviceGovernor(JSON.parse(JSON.stringify(dev))))).toBe(false)
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
    const ok = { id: 'sv_Readable01', on: true, when: {}, to: { p: 'anthropic', m: 'claude-haiku-4-5' } }
    const { value, repaired } = sanitizeGovernorWithReport({ v: 1, savers: [later, 'junk', { id: 'nope' }, widened, ok, { ...ok }] })
    const v = value as WorkspaceGovernor
    // the duplicate id and the junk go
    expect(repaired).toBe(true)
    expect(v.savers).toEqual([later, widened, ok])
    // a dropped or clamped condition would widen the rule: those stay unread
    expect(readableSavers(v).map((s) => s.id)).toEqual(['sv_Readable01'])
    // at most 20 rules
    const many = Array.from({ length: 25 }, (_, i) => ({ ...ok, id: `sv_Many${String(i).padStart(6, '0')}` }))
    expect((g({ savers: many }).savers ?? []).length).toBe(GOVERNOR_LIMITS.savers)
    // a model without a provider, an unknown provider, an agent id that is no id: unread
    for (const when of [{ from: { m: 'claude-opus-5-5' } }, { from: { p: 'mistral' } }, { agents: ['a b'] }, { who: 'scheduled' }])
      expect(readableSavers(g({ savers: [{ ...ok, when }] }))).toEqual([])
  })

  test('a key this build does not know — of the rule, its condition, its source or its target — keeps the rule unread and as it was', () => {
    const base = { id: 'sv_Later00001', on: true, when: { who: ['scheduled'] }, to: { p: 'anthropic', m: 'claude-haiku-4-5' } }
    const later = [
      { ...base, when: { who: ['scheduled'], hours: { from: 22, to: 6 } } },
      { ...base, id: 'sv_Later00002', until: 1_790_000_000_000 },
      { ...base, id: 'sv_Later00003', when: { from: { p: 'anthropic', vendor: 'any' } } },
      { ...base, id: 'sv_Later00004', to: { p: 'anthropic', m: 'claude-haiku-4-5', variant: 'batch' } },
      { ...base, id: 'sv_Later00005', to: { p: 'anthropic', m: 'claude-haiku-4-5', effort: 'loud' } },
    ]
    const { value, repaired } = sanitizeGovernorWithReport({ v: 1, day: 6, savers: later })
    expect(repaired).toBe(false)
    expect((value as WorkspaceGovernor).savers).toEqual(later)
    expect(readableSavers(value)).toEqual([])
    // a second pass (the next load, another tab) keeps them as they were — never the narrowed rule written back
    expect(sanitizeGovernor(JSON.parse(JSON.stringify(value)))).toEqual(value)
    // positive control: the same rule without the later key is read
    expect(readableSavers(g({ savers: [base] }))).toEqual([base])
    expect(readableSavers(g({ savers: [{ ...base, to: { ...base.to, effort: 'high' } }] })).map((x) => x.to)).toEqual([{ p: 'anthropic', m: 'claude-haiku-4-5', effort: 'high' }])
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

  test('stampGen / stampDeviceGen (train 7 merge review #3): a rule edit never lowers a budget\'s stamp; the stamp follows the rules where nothing else needs it', () => {
    const orOnly = { policy: { providers: { openrouter: { allow: ['public' as const] } }, restricted: [] } }
    const claudeNarrow = { policy: { providers: { anthropic: { allow: ['public' as const] } }, restricted: [] } }
    // the rules alone (no governor): what they need, a stored stamp is not kept — S2's setter as it was
    expect(stampGen(orOnly, undefined, undefined)).toBe(1)
    expect(stampGen(claudeNarrow, undefined, undefined)).toBe(GEN.claudeLimits)
    expect(stampGen(orOnly, undefined, GEN.claudeLimits)).toBe(1)
    // a day budget stored (a phase-B owner set it): the stamp stays the budget's whatever the rules say
    expect(stampGen(orOnly, g({ day: 6 }), GEN.budget)).toBe(GEN.budget)
    expect(stampGen(claudeNarrow, g({ day: 6 }), GEN.budget)).toBe(GEN.budget)
    expect(stampGen(null, g({ month: 120 }), undefined)).toBe(GEN.budget)
    // a governor this build cannot judge (a lever, a newer shape, a later slice's key): never below the stored stamp
    expect(stampGen(orOnly, g({ autonomy: 'propose' }), 5)).toBe(5)
    expect(stampGen(orOnly, sanitizeGovernor({ v: 2, day: 6 }), 4)).toBe(4)
    expect(stampGen(claudeNarrow, g({ day: 6, rings: 1 }), 7)).toBe(7)
    // positive control: a governor this build judges whole stamps what it needs — a higher stored stamp is not kept
    expect(stampGen(orOnly, g({ savers: FULL.savers }), GEN.budget)).toBe(1)
    expect(stampGen(orOnly, g({ day: 6 }), 9)).toBe(GEN.budget)
    // the device: its own rules and the person's line for this browser
    expect(stampDeviceGen(undefined, undefined, undefined)).toBe(1)
    expect(stampDeviceGen({ narrow: { anthropic: ['people'] } }, undefined, undefined)).toBe(GEN.claudeLimits)
    expect(stampDeviceGen({ narrow: { anthropic: ['people'] } }, sanitizeDeviceGovernor({ v: 1, day: 8 }), GEN.budget)).toBe(GEN.budget)
    expect(stampDeviceGen(undefined, sanitizeDeviceGovernor({ v: 1, month: 80 }), undefined)).toBe(GEN.budget)
    expect(stampDeviceGen(undefined, sanitizeDeviceGovernor({ v: 2, day: 8 }), 6)).toBe(6)
    expect(stampDeviceGen(undefined, sanitizeDeviceGovernor({ v: 1, day: 8 }), 6)).toBe(GEN.budget)
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
  function problems(gen: GenTable, enforced: Record<string, string>, build: number, unnamedUpto = 1): string[] {
    const out: string[] = []
    const nums = Object.values(gen).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
    nums.forEach((n, i) => n !== i + 2 && out.push(`gap at ${n}`))
    for (const [name, n] of Object.entries(gen)) {
      if (n === undefined || n > build) continue
      const file = enforced[name]
      if (!file || !existsSync(`${ROOT}${file}`)) out.push(`${name}: no module`)
      else if (n > unnamedUpto && !readFileSync(`${ROOT}${file}`, 'utf8').includes(`GEN.${name}`)) out.push(`${name}: ${file} does not name it`)
    }
    return out
  }

  test('numbered 2, 3 … without gaps; every enforced entry names an existing module that names it', () => {
    expect(problems(GEN, GEN_ENFORCED, AI_POLICY_GEN, GEN_UNNAMED_UPTO)).toEqual([])
    expect(Object.keys(GEN_ENFORCED).sort()).toEqual(Object.keys(GEN).sort())
    // positive controls: a gap, a missing module and a module that does not name its entry are found
    expect(problems({ a: 2, b: 4 }, { a: 'package.json', b: 'package.json' }, 1)).toEqual(['gap at 4'])
    expect(problems({ a: 2 }, { a: 'src/app/nowhere.ts' }, 2)).toEqual(['a: no module'])
    expect(problems({ a: 2 }, { a: 'package.json' }, 2)).toEqual(['a: package.json does not name it'])
    // policy.ts reads GEN.claudeLimits now (train 7): every entry's module names it — none is excused any more
    expect(GEN_UNNAMED_UPTO).toBe(1)
    expect(GEN_ENFORCED.claudeLimits).toBe('src/shared/ai/policy.ts')
    expect(problems({ claudeLimits: 2 }, { claudeLimits: 'src/app/features/ai/core/resolve.ts' }, 2, GEN_UNNAMED_UPTO)).toEqual(['claudeLimits: src/app/features/ai/core/resolve.ts does not name it'])
    // an entry numbered before the table (unnamedUpto 2): its module has to exist, not to name it; a later one still has to
    expect(problems({ claudeLimits: 2, budget: 3 }, { claudeLimits: 'package.json', budget: 'package.json' }, 2, 2)).toEqual([])
    expect(problems({ claudeLimits: 2, budget: 3 }, { claudeLimits: 'package.json', budget: 'package.json' }, 3, 2)).toEqual(['budget: package.json does not name it'])
    expect(problems({ claudeLimits: 2 }, { claudeLimits: 'src/app/nowhere.ts' }, 2, 2)).toEqual(['claudeLimits: no module'])
  })

  test('B5: the budget generation\'s module exists and names it — the build may raise AI_POLICY_GEN to GEN.budget (B12)', () => {
    expect(GEN_ENFORCED.budget).toBe('src/app/features/governor/install.ts')
    expect(problems(GEN, GEN_ENFORCED, GEN.budget, GEN_UNNAMED_UPTO)).toEqual([])
    // the only module that registers the brake with the gate
    expect(readFileSync(`${ROOT}src/app/features/governor/install.ts`, 'utf8')).toContain('registerBeforeSend({ money, peek, round, start: startRun })')
  })

  test('B9: the loop parts stay a lazy chunk — no eager module of the Regler imports loops / halt / steps statically', () => {
    const dir = `${ROOT}src/app/features/governor/`
    const LAZY = ['loops', 'halt', 'steps']
    const staticOf = (src: string): string[] => [...src.matchAll(/^\s*(?:import|export)\b[^;'"]*?from\s+'\.\/([\w.]+)'/gm)].filter((m) => !/^\s*(?:import|export)\s+type\b/.test(m[0])).map((m) => m[1])
    for (const f of ['index.ts', 'install.ts', 'brake.ts', 'mcpBand.ts', 'limits.ts', 'totals.ts', 'background.ts', 'lampSource.ts', 'statusGate.tsx', 'marks.ts', 'plan.ts', 'modes.ts']) {
      const deps = staticOf(readFileSync(dir + f, 'utf8'))
      expect(deps.filter((d) => LAZY.includes(d)), f).toEqual([])
    }
    // positive control: the lazy chunk does import them; install.ts loads it only by import()
    expect(staticOf(readFileSync(dir + 'loops.ts', 'utf8'))).toEqual(expect.arrayContaining(['halt', 'steps']))
    expect(readFileSync(dir + 'install.ts', 'utf8')).toContain("import('./loops')")
  })
})

test.describe('the shared error and type additions (B2)', () => {
  test("'budget' is an error code that never falls back; its details are the brake's refusals", () => {
    expect(AI_ERROR_CODES).toContain('budget')
    expect(isAIErrorCode('budget')).toBe(true)
    expect(fallbackOf('budget')).toBe('never')
    // positive control: a code that does fall back
    expect(fallbackOf('overloaded')).toBe('switch')
    // the brake's refusals (brake.ts RefuseDetail = a binding line · noprice · scope) are exactly the details
    const refusals: RefuseDetail[] = ['day', 'month', 'device-day', 'device-month', 'run', 'noprice', 'scope']
    expect([...BUDGET_DETAILS].sort()).toEqual([...refusals].sort())
    expect(isBudgetDetail('device-month')).toBe(true)
    expect(isBudgetDetail('week')).toBe(false)
  })
  test('both languages name the budget error', () => {
    for (const lang of ['en', 'de'] as const) expect(coreMessages[lang]['features.ai.err.budget']).toBeTruthy()
    expect(coreMessages.de['features.ai.err.budget']).toContain('Regler')
  })
})

test.describe('one answer-budget rule on the wire (B3, shared/ai/wire/maxTokens.ts)', () => {
  const CAPS: Caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'auto', effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 131072, maxOutput: 16384 }
  const ROW: PriceRow = { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3, source: 'catalogue', at: '2026-10-12' }
  const info = (m: string, caps: Partial<Caps> = {}, hints?: WireHints): ModelInfo => ({ route: { p: 'openrouter', m }, label: m, short: m, vendor: m.split('/')[0]!, caps: { ...CAPS, ...caps }, price: ROW, ...(hints ? { hints } : {}) })
  const OPTS: BuildOpts = { pins: ['nordwind'], upstream: { deny: [], noCollect: true, zdr: false }, referer: 'https://one.example/app/' }
  const ROUTER_OPTS: BuildOpts = { ...OPTS, pins: ['nordwind', 'typesafe'], router: { pool: ['vendor-a/model-b', 'vendor-c/thinker-2'], exclude: ['openrouter/*'] } }
  const ask = (route: Route, maxTokens: number): ChatRequest => ({ kind: 'chat', route, system: 'You are the writing assistant.', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Nordlicht launch plan.' }] }], output: { kind: 'text' }, maxTokens, cache: 'none' })
  const MANDATORY: WireHints = { params: ['max_tokens', 'reasoning', 'tools'], reasoning: { mandatory: true, efforts: ['high', 'medium', 'low', 'minimal'], supportsMax: false } }
  const OPTIONAL: WireHints = { params: ['max_tokens', 'reasoning', 'tools'], reasoning: { mandatory: false, efforts: ['high', 'medium', 'low'], supportsMax: false } }
  const PROMPT = 12_000
  /** the cost of the prompt + the answer budget the body carries */
  const billed = (row: PriceRow, maxTokens: number) => costOf({ input: PROMPT, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: maxTokens, reasoning: 0 }, row, 0).usd

  test('the estimate\'s upper end is the cost of exactly what build() sends — five kinds of route', () => {
    const cases: Array<[string, Route, ModelInfo, number]> = [
      ['a fixed OpenRouter row', { p: 'openrouter', m: 'vendor-a/model-b' }, info('vendor-a/model-b'), 8000],
      ['a mandatory reasoner', { p: 'openrouter', m: 'vendor-c/thinker-2' }, info('vendor-c/thinker-2', { reasoning: { mandatory: true } }, MANDATORY), 4000],
      ['an optional reasoner with an effort (the S2 under-count)', { p: 'openrouter', m: 'vendor-f/flex-1', effort: 'medium' }, info('vendor-f/flex-1', {}, OPTIONAL), 3000],
      ['the Jev Router', { p: 'openrouter', m: JEV_ROUTER, effort: 'low' }, info(JEV_ROUTER), 2000],
      ['an answer budget above the output cap', { p: 'openrouter', m: 'vendor-a/model-b' }, info('vendor-a/model-b'), 40_000],
    ]
    for (const [name, route, model, max] of cases) {
      const body = build(ask(route, max), model, route.m === JEV_ROUTER ? ROUTER_OPTS : OPTS).body
      const sent = body.max_tokens as number
      expect(wireMaxTokens(route, max, model.caps, model.hints), name).toBe(sent)
      expect(estimate(route, { promptTokens: PROMPT, maxTokens: max }, 0, ROW, model.caps, model.hints)!.high, name).toBeCloseTo(billed(ROW, sent)!, 10)
    }
    // the optional reasoner without an effort gets no room — and neither does its estimate
    const plain = info('vendor-f/flex-1', {}, OPTIONAL)
    const noEffort: Route = { p: 'openrouter', m: 'vendor-f/flex-1' }
    expect(build(ask(noEffort, 3000), plain, OPTS).body.max_tokens).toBe(3000)
    expect(estimate(noEffort, { promptTokens: PROMPT, maxTokens: 3000 }, 0, ROW, plain.caps, plain.hints)!.high).toBeCloseTo(billed(ROW, 3000)!, 10)
  })

  test('Claude: the visible budget is what is sent (thinking sits inside it)', () => {
    const route: Route = { p: 'anthropic', m: 'claude-sonnet-5-5' }
    const row = priceRow(route)!
    expect(wireMaxTokens(route, 4096, capsOf(route))).toBe(4096)
    expect(estimate(route, { promptTokens: PROMPT, maxTokens: 4096 }, 0)!.high).toBeCloseTo(billed(row, 4096)!, 10)
  })

  test('writeTokens: a cold cache is priced at the cache-write column (the 68k switch example)', () => {
    const haiku: Route = { p: 'anthropic', m: 'claude-haiku-4-5' }
    const cold = estimate(haiku, { promptTokens: 68_000, writeTokens: 68_000, maxTokens: 22_000, outTokens: 15_000 }, 0)!
    // 68k × 1.25 $/M = 0.085 · output 15k–22k × 5 $/M
    expect(cold.low).toBeCloseTo(0.085 + 0.075, 6)
    expect(cold.high).toBeCloseTo(0.085 + 0.11, 6)
    // positive control: the same prompt as plain input is cheaper (1 $/M)
    expect(estimate(haiku, { promptTokens: 68_000, maxTokens: 22_000, outTokens: 15_000 }, 0)!.low).toBeCloseTo(0.068 + 0.075, 6)
    // the brake's wireOut is the same rule
    expect(wireOutFor({ p: 'openrouter', m: JEV_ROUTER }, info(JEV_ROUTER).caps)(2000)).toBe(wireMaxTokens({ p: 'openrouter', m: JEV_ROUTER }, 2000, info(JEV_ROUTER).caps))
  })
})

test.describe('run modes (B4, features/governor/modes.ts)', () => {
  test('one row per purpose of PURPOSES; the caller-mode ones; text purposes capped no lower than minOut', () => {
    expect(Object.keys(RUN_MODES).sort()).toEqual(Object.keys(PURPOSES).sort())
    // 28 + SJ's two decisions (train 9: gate.precheck takes its run's mode, gate.verify is a person's answer check) + the
    // work-order planner (orders B1: manual · trigger)
    expect(Object.keys(RUN_MODES)).toHaveLength(31)
    expect([...CALLER_MODE].sort()).toEqual(['agents.run', 'bulk.autofill', 'bulk.mail', 'coding.plan', 'gate.precheck', 'scripts.effect'])
    expect(missesMode('gate.precheck')).toBe(true)
    expect(missesMode('gate.precheck', 'scheduled')).toBe(false)
    expect(modeOf('gate.verify')).toBe('interactive')
    // decisions are typed answers: never capped
    expect(minOut('gate.precheck', false)).toBeNull()
    expect(minOut('gate.verify', true)).toBeNull()
    // a caller-mode purpose without its mode: the contract misses it; with one: taken; an unknown mode reads as trigger
    expect(missesMode('bulk.mail')).toBe(true)
    expect(missesMode('bulk.mail', 'bulk')).toBe(false)
    expect(modeOf('bulk.mail')).toBe('trigger')
    expect(modeOf('bulk.mail', 'bulk')).toBe('bulk')
    expect(modeOf('agents.run', 'turbo')).toBe('trigger')
    // positive controls: the defaults
    expect(missesMode('menu.action')).toBe(false)
    expect(modeOf('menu.action')).toBe('interactive')
    expect(modeOf('memory.propose')).toBe('follow-up')
    expect(modeOf('nonsense.purpose')).toBe('trigger')
    // text purposes: 1 024, 2 048 where thinking sits inside max_tokens; structured and loops: never capped
    expect(minOut('menu.action', false)).toBe(1024)
    expect(minOut('menu.action', true)).toBe(2048)
    expect(minOut('structure.todb', false)).toBeNull()
    expect(minOut('terminal.task', false)).toBeNull()
    expect(minOut('bulk.autofill', true)).toBeNull()
  })
  test('a request\'s own source: <series>:<id> in the ledger grammar — never the bare purpose', () => {
    for (const p of Object.keys(RUN_MODES)) {
      const src = sourceFor(p, 'r0a1b2c3d4e5')
      expect(src, p).toMatch(SOURCE_RE)
      expect(src, p).not.toBe(p)
    }
    expect(sourceFor('palette.ask', 'x1')).toBe('palette:x1')
    expect(sourceFor('help.ask', 'x1')).toBe('help:x1')
    expect(sourceFor('outbox.draft', 'x1')).toBe('outbox:x1')
    // the bare purpose is not a source (it has a dot)
    expect(SOURCE_RE.test('palette.ask')).toBe(false)
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

  test('a read the ledger did not answer (memory only) is no total: the floor and the deltas stay, no closed day is recorded', async () => {
    const cache = readTodayCache({ day: '2026-10-09', usd: 4.12, unpriced: 0, monthUsd: 110, at: T0 - 1000 })
    const t = newTally('local:local', T0, cache)
    deltaTally(t, delta('b-before', 0.5, '2026-10-09'), T0 + 10)
    const memoryOnly: DayRead = { entries: [{ id: 'mine', usd: 0.05 }], complete: false }
    expect(applyDayRead(t, '2026-10-09', memoryOnly, T0 + 20, T0 + 30)).toBe(false)
    expect(todayOf(t).usd).toBeCloseTo(4.12, 10)
    expect(t.batches.has('b-before')).toBe(true)
    expect(tallyKnown(t)).toBe(false)
    // the month's closed days: a stored record counts, a day the ledger did not answer writes no record
    const failing = async (): Promise<DayRead> => ({ entries: [], complete: false })
    const month = await closedDaysOf(['2026-10-01', '2026-10-02', '2026-10-03'], [{ usd: 3, unpriced: 0 }], failing)
    expect(month).toEqual({ sum: 3, fresh: [], complete: false })
    // the totals then keep the floor (closedTally is not called): 110 − 4.12 closed + today
    expect(monthSpentOf(t)).toBeCloseTo(110, 10)
    // positive controls: a complete read replaces the floor; complete day reads become records
    const full: DayRead = { entries: [{ id: 'x1', usd: 1 }, { id: 'x2', usd: null }], complete: true }
    expect(applyDayRead(t, '2026-10-09', full, T0 + 20, T0 + 30)).toBe(true)
    expect(todayOf(t)).toEqual({ usd: 1, unpriced: 1 })
    expect(tallyKnown(t)).toBe(true)
    const read = async (d: string): Promise<DayRead> => ({ entries: d === '2026-10-02' ? [{ id: 'y1', usd: 2 }, { id: 'y2', usd: null }] : [], complete: true })
    expect(await closedDaysOf(['2026-10-01', '2026-10-02'], [{ usd: 3, unpriced: 0 }], read)).toEqual({ sum: 5, fresh: [['2026-10-02', { usd: 2, unpriced: 1 }]], complete: true })
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
    // a starting tab's hello asks the others for their lists — it never forgets or adds one
    expect(readBookMsg({ type: 'hello', tab: 'tab-c' })).toEqual({ type: 'hello', tab: 'tab-c' })
    expect(readBookMsg({ type: 'hello', tab: 'bad tab' })).toBeNull()
    const book = emptyBook()
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.4, scope: 'local:local' }], at: N }, N)
    hearBook(book, { type: 'res', tab: 'tab-a', scope: 'local:local', list: [{ id: 'r1', usd: 0.9, scope: 'local:local' }], at: N }, N)
    expect(reservedByOthers(book, N)).toBe(0.9)
    hearBook(book, { type: 'hello', tab: 'tab-a' }, N)
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

  test('a later slice’s keys survive a write and the removal of the limit (the stamp they hold stays)', () => {
    const kv = memoryKV()
    kv.setItem(DEVICE_KEY, JSON.stringify({ v: 1, day: 8, at: 1, perProvider: { openrouter: 3 } }))
    expect(deviceKeepsGen(readDeviceLimit(kv))).toBe(true)
    expect(setDeviceLimit({ day: 5 }, kv, 2)).toEqual({ ok: true, value: { v: 1, day: 5, at: 2, perProvider: { openrouter: 3 } } })
    expect(JSON.parse(kv.map.get(DEVICE_KEY) ?? 'null')).toEqual({ v: 1, day: 5, at: 2, perProvider: { openrouter: 3 } })
    // the limit removed: the later keys stay alone — no line here, the stamp still kept
    expect(setDeviceLimit(null, kv, 3)).toEqual({ ok: true, value: { v: 1, at: 3, perProvider: { openrouter: 3 } } })
    expect(JSON.parse(kv.map.get(DEVICE_KEY) ?? 'null')).toEqual({ v: 1, at: 3, perProvider: { openrouter: 3 } })
    expect(deviceLimitOf(kv)).toBeUndefined()
    expect(deviceGovernorGen(readDeviceLimit(kv))).toBe(1)
    expect(deviceKeepsGen(readDeviceLimit(kv))).toBe(true)
    // set again: the later keys are still there
    expect(setDeviceLimit({ month: 150 }, kv, 4)).toEqual({ ok: true, value: { v: 1, month: 150, at: 4, perProvider: { openrouter: 3 } } })
    // positive control: without later keys a removal removes the record
    const plain = memoryKV()
    setDeviceLimit({ day: 8 }, plain, 1)
    setDeviceLimit(null, plain, 2)
    expect(plain.map.has(DEVICE_KEY)).toBe(false)
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

  test('scopes found in the ledger join the list: a new one added, a later day kept, an older one never lowers it; junk and stale skipped', () => {
    const kv = memoryKV()
    const now = at(2026, 10, 9, 14, 6)
    const team = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    noteScope('local:local', at(2026, 10, 5), kv)
    expect(mergeScopes([{ scope: team, last: '2026-10-09' }, { scope: 'local:local', last: '2026-10-08' }], now, kv)).toBe(true)
    expect(knownScopes(now, kv)).toEqual([{ scope: team, last: '2026-10-09' }, { scope: 'local:local', last: '2026-10-08' }])
    // nothing new: nothing written
    expect(mergeScopes([{ scope: 'local:local', last: '2026-10-02' }, { scope: 'bad|scope', last: '2026-10-09' }, { scope: 'cloud:ws-old:u:acc', last: '2026-08-01' }], now, kv)).toBe(false)
    expect(knownScopes(now, kv).map((s) => s.scope)).toEqual([team, 'local:local'])
  })
})

test.describe('a loop\'s size (ai/core/sizes.ts messagesChars)', () => {
  test('text as its JSON; a picture as its pixels, a PDF as its pages — never their base64', () => {
    const text = [{ role: 'user', content: 'Summarise the Nordlicht launch plan.' }, { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] }]
    // positive control: a conversation without media counts exactly as before (its JSON)
    expect(messagesChars(text)).toBe(JSON.stringify(text).length)
    const b64 = 'A'.repeat(4_000_000)
    const pic = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }
    const withPic = [{ role: 'user', content: [{ type: 'text', text: 'What is on the board photo?' }, pic] }]
    const n = messagesChars(withPic)
    expect(n).toBeLessThan(20_000)
    expect(n).toBeGreaterThanOrEqual(imageChars(1568, 1568))
    // a PDF whose pages this tab knows: its pages; else about one page per 60 KB
    const pdf = { type: 'document', title: 'Tessera audit.pdf', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    const unknown = messagesChars([{ role: 'user', content: [pdf] }])
    expect(unknown).toBeGreaterThanOrEqual(pdfChars(50))
    expect(unknown).toBeLessThan(pdfChars(50) + 1000)
    notePdfPages(pdf, 60)
    const known = messagesChars([{ role: 'user', content: [pdf] }])
    expect(known).toBeGreaterThanOrEqual(pdfChars(60))
    expect(known).toBeLessThan(pdfChars(60) + 1000)
    // inside a tool result too
    const inResult = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [pic] }] }]
    expect(messagesChars(inResult)).toBeLessThan(20_000)
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

/* ------------------------------------------------------------------ */
/* A4 — the brake core                                                  */
/* ------------------------------------------------------------------ */

const TEAM = 'cloud:ws-tessera-0001:u:acc-mara-lind'

/** Totals as the brake reads them, with open reservations of this tab and others (id, usd, scope). */
function totals(o: { today?: number; month?: number; devToday?: number; devMonth?: number; res?: Array<{ id: string; usd: number; scope: string }>; scopeId?: string | null } = {}): TotalsLike {
  const res = o.res ?? []
  return {
    scopeId: o.scopeId === undefined ? 'local:local' : o.scopeId,
    scope: { spentToday: o.today ?? 0, spentMonth: o.month ?? o.today ?? 0, unpricedToday: 0 },
    device: { spentToday: o.devToday ?? o.today ?? 0, spentMonth: o.devMonth ?? o.month ?? o.today ?? 0, scopes: ['local:local', TEAM] },
    reserved: (scope?: string, except?: string) => res.filter((r) => r.id !== except && (scope === undefined || r.scope === scope)).reduce((x, r) => x + r.usd, 0),
  }
}

const L = (ws: Partial<Limits['ws']> = {}, device: Partial<Limits['device']> = {}): Limits => ({ ws: { day: null, month: null, ...ws }, device: { day: null, month: null, ...device } })
const rest = (day: number, binding: Rest['binding'] = 'day'): Rest => ({ day, month: Infinity, run: Infinity, binding })
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)
const SONNET: Route = { p: 'anthropic', m: 'claude-sonnet-5-5' }
const HAIKU: Route = { p: 'anthropic', m: 'claude-haiku-4-5' }
const OPUS: Route = { p: 'anthropic', m: 'claude-opus-5-5' }
const row = (r: Route) => priceRow(r) as PriceRow
const UU = (x: Partial<Usage>): Usage => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, ...x })

test.describe('limits and rests (features/governor/limits.ts)', () => {
  test('the lines in force; a value this build cannot read limits nothing here', () => {
    expect(limitsOf(g({ day: 6, month: 120 }), sanitizeDeviceGovernor({ v: 1, day: 8 }))).toEqual({ ws: { day: 6, month: 120 }, device: { day: 8, month: null } })
    expect(limitsOf(sanitizeGovernor({ v: 2, day: 1 }), sanitizeDeviceGovernor({ v: 2, day: 1 }))).toEqual(NO_LIMITS)
    expect(hasLimit(NO_LIMITS)).toBe(false)
    expect(hasLimit(L({}, { month: 50 }))).toBe(true)
    expect(hasMonthLimit(L({ day: 6 }))).toBe(false)
    expect(hasMonthLimit(L({}, { month: 50 }))).toBe(true)
  })

  test("workspace and device lines; reservations here and in other tabs; the caller's own never counted; allowance; run budget", () => {
    const res = [
      { id: 'mine', usd: 0.3, scope: 'local:local' },
      { id: 'tab-b', usd: 0.2, scope: 'local:local' },
      { id: 'team', usd: 0.5, scope: TEAM },
    ]
    const t = totals({ today: 4.12, devToday: 5.32, res })
    const l = L({ day: 6 }, { day: 8 })
    // workspace: 6 − 4.12 − 0.5 = 1.38 · device: 8 − 5.32 − 1.0 = 1.68 → the workspace binds
    const r = restOf(l, t)
    near(r.day, 1.38)
    expect(r.binding).toBe('day')
    expect([r.month, r.run]).toEqual([Infinity, Infinity])
    // the request's own reservation is what it may spend: never counted against it
    near(restOf(l, t, { reservation: 'mine' }).day, 1.68)
    near(restOf(l, t, {}, 1).day, 2.38)
    // the device line binds when it is lower (other workspaces of this browser spent and reserved)
    const d = restOf(L({ day: 6 }, { day: 6 }), t)
    near(d.day, -0.32)
    expect(d.binding).toBe('device-day')
    // a run's own budget
    const run = restOf(l, t, { run: { budget: 3, spent: 2.9 } })
    near(run.run, 0.1)
    expect(run.binding).toBe('run')
    // the month lines
    const m = restOf(L({ month: 120 }, { month: 150 }), totals({ month: 118, devMonth: 140, res }))
    near(m.month, 1.5)
    expect(m.binding).toBe('month')
    expect(restOf(NO_LIMITS, t)).toEqual({ day: Infinity, month: Infinity, run: Infinity, binding: null })
    // device sums over two scopes: this one's and the team's
    expect(lineOf(l, totals({ today: 4.12, devToday: 5.32 }), 'device-day')).toEqual({ spent: 5.32, limit: 8 })
    expect(lineOf(l, t, 'day')).toEqual({ spent: 4.12, limit: 6 })
    expect(lineOf(l, t, 'run', { budget: 3, spent: 2.9 })).toEqual({ spent: 2.9, limit: 3 })
  })

  test('fits: no limit → yes (also without a price); no price with a limit → noprice', () => {
    const none: Rest = { day: Infinity, month: Infinity, run: Infinity, binding: null }
    expect(fits(null, none)).toBe('yes')
    expect(fits(null, rest(1))).toBe('noprice')
    expect(fits({ low: 0.1, high: 1 }, rest(1))).toBe('yes')
    expect(fits({ low: 0.1, high: 1.01 }, rest(1))).toBe('no')
    expect(restMin({ day: 3, month: 2, run: 5, binding: 'month' })).toBe(2)
  })
})

test.describe('one-shots (brake.oneShot)', () => {
  const base: OneShotCtx = { limited: true, scopeKnown: true, band: { low: 0.1, high: 0.5 }, answer: 'text', minOut: 1024, maxTokens: 4096, costAt: (cap) => 0.25 + cap / 8000 }

  test('identity without a limit; scope unknown and no price are refused', () => {
    expect(oneShot({ ...base, limited: false, band: null }, rest(0))).toEqual({ kind: 'identity' })
    expect(oneShot({ ...base, scopeKnown: false }, rest(10))).toEqual({ kind: 'refuse', detail: 'scope' })
    expect(oneShot({ ...base, band: null }, rest(10))).toEqual({ kind: 'refuse', detail: 'noprice' })
  })

  test('fits → pass (reserve the upper end); a text answer near the line is capped to what fits', () => {
    expect(oneShot(base, rest(1))).toEqual({ kind: 'pass', reserve: 0.5, band: base.band })
    expect(oneShot({ ...base, band: { low: 0.3, high: 0.76 } }, rest(0.45))).toEqual({
      kind: 'cap',
      reserve: 0.45,
      maxTokens: 1600,
      band: { low: 0.3, high: 0.76 },
      step: { k: 'brake', code: 'cap', to: '1600' },
    })
    // below the smallest useful answer: no cap — refused
    expect(oneShot({ ...base, band: { low: 0.3, high: 0.76 } }, rest(0.3)).kind).toBe('refuse')
    expect(capFor((c) => c, 10, 100, 5)).toBeNull()
    expect(capFor((c) => c, 10, 100, 1000)).toBe(99)
    expect(capFor(() => null, 10, 100, 1000)).toBeNull()
  })

  test('structured answers and requests with MCP servers are never capped; the MCP band counts 5 more context reads + tool lists', () => {
    expect(oneShot({ ...base, answer: 'structured', band: { low: 0.3, high: 0.76 } }, rest(0.45)).kind).toBe('refuse')
    const mcpBand = mcpOneShotBand({ row: row(SONNET), promptTokens: 10_000, servers: 2, toolChars: [4000, null], maxTokens: 4096 })
    // 10 000 + (4 000 + 8 000) ÷ 4 = 13 000 per read: (13 000 × 2 + 4 096 × 10) / 1e6 + 5 × 13 000 × 2 / 1e6
    near(mcpBand?.high ?? NaN, 0.06696 + MCP_ROUNDS * 0.026)
    near(mcpBand?.low ?? NaN, (13_000 * 2 + 400 * 10) / 1e6)
    // a call that resumes paused turns sends whole requests: one full answer per request, never fewer reads than requests
    expect([mcpReads(), mcpReads(4), mcpReads(7)]).toEqual([MCP_ROUNDS, MCP_ROUNDS, 6])
    const four = mcpOneShotBand({ row: row(SONNET), promptTokens: 10_000, servers: 2, toolChars: [4000, null], maxTokens: 4096, rounds: 4 })
    near(four?.high ?? NaN, 4 * 0.06696 + 2 * 0.026)
    // /generate (6 resumes): 7 requests, each its answer
    const seven = mcpOneShotBand({ row: row(SONNET), promptTokens: 10_000, servers: 2, toolChars: [4000, null], maxTokens: 4096, rounds: 7 })
    near(seven?.high ?? NaN, 7 * 0.06696)
    near(four?.low ?? NaN, mcpBand?.low ?? NaN)
    const v = oneShot({ ...base, band: { low: 0.01, high: 0.05 }, mcp: { servers: 2, band: mcpBand } }, rest(0.1))
    expect(v.kind).toBe('refuse')
    // positive control: the same request without its servers passes
    expect(oneShot({ ...base, band: { low: 0.01, high: 0.05 } }, rest(0.1)).kind).toBe('pass')
    expect(oneShot({ ...base, mcp: { servers: 2, band: mcpBand } }, rest(1)).kind).toBe('pass')
  })

  test('refused before sending: E only when +1 $ makes it fit (else the need), and a cheaper model whose band fits', () => {
    const v = oneShot({ ...base, answer: 'structured', band: { low: 0.4, high: 1.2 }, cheaper: [{ route: SONNET, band: { low: 0.1, high: 0.4 } }, { route: HAIKU, band: { low: 0.05, high: 0.2 } }, { route: OPUS, band: null }] }, rest(0.45))
    expect(v).toMatchObject({ kind: 'refuse', detail: 'day', fix: { kind: 'brake', allow: ALLOW_USD, cheaper: SONNET } })
    if (v.kind === 'refuse') near(v.fix?.need ?? NaN, 0.75)
    const far = oneShot({ ...base, answer: 'structured', band: { low: 0.4, high: 1.6 } }, rest(0.45, 'device-month'))
    expect(far).toMatchObject({ kind: 'refuse', detail: 'device-month', fix: { allow: null } })
    expect(far.kind === 'refuse' && far.fix && 'cheaper' in far.fix).toBe(false)
    if (far.kind === 'refuse') near(far.fix?.need ?? NaN, 1.15)
    // a cheaper band that does not fit either is never offered
    expect(cheaperRoute({ low: 1, high: 2 }, [{ route: HAIKU, band: { low: 0.5, high: 0.9 } }], 0.8)).toBeUndefined()
  })
})

test.describe('loop steps (steps.ts nextStep / switchBand)', () => {
  const last = UU({ input: 1000, cacheRead: 60_000, cacheWrite: 2000, output: 1500 })

  test('the first step of a loop is braked on FIRST_STEP_OUT, not on the 64 000 the wire keeps; later the run’s own outputs', () => {
    expect(stepOutputs([])).toEqual({ low: 400, high: FIRST_STEP_OUT })
    expect(stepOutputs([UU({ output: 900 })])).toEqual({ low: 400, high: FIRST_STEP_OUT })
    expect(stepOutputs([UU({ output: 900 }), UU({ output: 300 }), UU({ output: 2000 })])).toEqual({ low: 900, high: 2000 })
    expect(stepOutputs([UU({ output: 900 }), UU({ output: 300 })])).toEqual({ low: 600, high: 900 })
  })

  test('Anthropic caches explicitly: C as a cache read, Δ (the answer + the tool results) as a cache write', () => {
    expect(contextOf(last)).toBe(63_000)
    const b = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 8000, explicitCache: true })
    // C 63 000 × 0.10 + Δ (1 500 + 2 000) × 2.50 + 400 / 4 096 × 10
    near(b?.low ?? NaN, (63_000 * 0.1 + 3500 * 2.5 + 400 * 10) / 1e6)
    near(b?.high ?? NaN, (63_000 * 0.1 + 3500 * 2.5 + 4096 * 10) / 1e6)
    // a pause_turn: no tool results, the paused answer is read again
    const p = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 0, explicitCache: true })
    near(p?.high ?? NaN, (63_000 * 0.1 + 1500 * 2.5 + 4096 * 10) / 1e6)
    // waited over 5 minutes: the context is written again
    const cold = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 0, explicitCache: true, cold: true })
    near(cold?.high ?? NaN, (63_000 * 2.5 + 1500 * 2.5 + 4096 * 10) / 1e6)
    expect(nextStep({ row: null, last, steps: [last], pendingChars: 0, explicitCache: true })).toBeNull()
  })

  test('OpenAI / OpenRouter / the Jev Router: C at input unless ≥ 80 % was reported as read', () => {
    const sol = row({ p: 'openai', m: 'gpt-6.1-sol' })
    const plain = UU({ input: 63_000, output: 1500 })
    const b = nextStep({ row: sol, last: plain, steps: [plain], pendingChars: 0, explicitCache: false })
    near(b?.high ?? NaN, ((63_000 + 1500) * 2 + 4096 * 10) / 1e6)
    // reported reads ≥ 80 %: read
    const read = UU({ input: 3000, cacheRead: 60_000, output: 1500 })
    const r = nextStep({ row: sol, last: read, steps: [read], pendingChars: 0, explicitCache: false })
    near(r?.high ?? NaN, (63_000 * 0.1 + 1500 * 2 + 4096 * 10) / 1e6)
    // the router's bound row: the context at its input
    const bound: PriceRow = { input: 30, output: 180, cacheRead: 30, cacheWrite: 30, source: 'catalogue', at: '2026-10-12' }
    const j = nextStep({ row: bound, last: plain, steps: [plain], pendingChars: 0, explicitCache: false })
    near(j?.high ?? NaN, ((63_000 + 1500) * 30 + 4096 * 180) / 1e6)
  })

  test('MCP: k = 3 server-side iterations count 3 context reads; the wire’s reasoning room widens the upper end', () => {
    const one = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 8000, explicitCache: true }) ?? { low: 0, high: 0 }
    const three = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 8000, explicitCache: true, mcpIterations: 3 }) ?? { low: 0, high: 0 }
    near(three.high - one.high, (2 * (63_000 + 3500) * 0.1) / 1e6)
    near(three.low - one.low, (2 * (63_000 + 3500) * 0.1) / 1e6)
    const wide = nextStep({ row: row(SONNET), last, steps: [last], pendingChars: 8000, explicitCache: true, wireOut: (v) => v * 5 }) ?? { low: 0, high: 0 }
    near(wide.high - one.high, (4 * 4096 * 10) / 1e6)
  })

  test('a switch writes the context to the new model once (the 68k example)', () => {
    const haiku = switchBand({ to: row(HAIKU), context: 68_000, outLow: 15_000, outHigh: 22_000 })
    near(haiku?.low ?? NaN, 0.085 + 0.075)
    near(haiku?.high ?? NaN, 0.085 + 0.11)
    const sonnet = switchBand({ to: row(SONNET), context: 68_000, outLow: 15_000, outHigh: 22_000 })
    near(sonnet?.low ?? NaN, 0.32)
    near(sonnet?.high ?? NaN, 0.39)
    near(coldCost(row(HAIKU), 68_000) ?? NaN, 0.085)
  })
})

test.describe('rounds (brake.round): terminal tasks halt, agents stop', () => {
  const run = (source: string, mode: RunMode = 'interactive') => ({ source, mode })
  const line = { spent: 5.71, limit: 6 }

  test('go reserves the next step; no limit is always go; AUS stops', () => {
    expect(round({ run: run('terminal:c1:t1'), limited: true, next: { low: 0.1, high: 0.2 }, rest: rest(0.29), line })).toEqual({ go: true, reserve: 0.2, band: { low: 0.1, high: 0.2 } })
    expect(round({ run: run('agent:ag-nordlicht:r1', 'scheduled'), limited: false, next: null, rest: rest(-5), line })).toEqual({ go: true, reserve: 0, band: null })
    expect(round({ run: run('terminal:c1:t1'), limited: true, next: { low: 0.1, high: 0.2 }, rest: rest(9), line, off: true })).toEqual({ stop: 'off', band: { low: 0.1, high: 0.2 } })
  })

  test('the AI terminal halts: E only when +1 $ fits, the needle position, H as found', () => {
    const v = round({ run: run('terminal:c1:t1'), limited: true, next: { low: 0.3, high: 0.52 }, rest: rest(0.29), line, now: 7 })
    expect(v).toEqual({ halt: { spent: 5.71, limit: 6, rest: 0.29, next: { low: 0.3, high: 0.52 }, to: 5.71 + 0.52, binding: 'day', allow: ALLOW_USD, cheaper: null, at: 7 } })
    const far = round({ run: run('terminal:c1:t1'), limited: true, next: { low: 1, high: 1.5 }, rest: rest(0.29), line })
    expect('halt' in far && far.halt.allow).toBeNull()
    // no price with a limit: the card, without E
    const noprice = round({ run: run('terminal:c1:t1'), limited: true, next: null, rest: rest(0.29), line })
    expect('halt' in noprice && noprice.halt.allow).toBeNull()
  })

  test('every agent mode stops (never waits mid-run — owner decision 2)', () => {
    expect(AGENTS_WAIT_MID_RUN).toBe(false)
    for (const mode of ['manual', 'scheduled', 'trigger'] as const) {
      expect(waitsAtLine(run('agent:ag-nordlicht:r1', mode))).toBe(false)
      expect(round({ run: run('agent:ag-nordlicht:r1', mode), limited: true, next: { low: 0.3, high: 0.52 }, rest: rest(0.29), line })).toEqual({ stop: 'budget', band: { low: 0.3, high: 0.52 }, binding: 'day', rest: 0.29, line })
    }
    expect(waitsAtLine(run('terminal:c1:t1'))).toBe(true)
    // background work stops too
    expect(round({ run: run('autofill:db1:p1:j1', 'trigger'), limited: true, next: { low: 0.3, high: 0.52 }, rest: rest(0.29), line })).toMatchObject({ stop: 'budget' })
  })
})

test.describe('H: a cheaper model that can carry the conversation (brake.cheaperForHalt)', () => {
  const cand = (r: Route, over: Partial<HCandidate> = {}): HCandidate => ({ route: r, label: r.m, caps: capsOf(r)!, row: row(r), blended: blendedPerM(row(r)), ...over })
  const opus = { blended: blendedPerM(row(OPUS)), caps: capsOf(OPUS) }
  const needs = needsOfHistory([{ content: [{ type: 'tool_use', id: 'tu1', name: 'read_page', input: {} }] }])
  const ctx = { rest: 0.29, context: 68_000, outLow: 15_000, outHigh: 22_000, needs, current: opus, at: 0 }

  test('the 68k example: from Opus, Sonnet 0,32–0,39 does not fit 0,29; Haiku 4.5 0,16–0,20 does — only across thinking', () => {
    expect(H_ACROSS_THINKING).toBe(false)
    const both = [cand(SONNET), cand(HAIKU)]
    expect(cheaperForHalt(both, ctx)).toBeNull()
    const h = cheaperForHalt(both, { ...ctx, acrossThinking: true })
    expect(h?.route).toEqual(HAIKU)
    near(h?.cold ?? NaN, 0.085)
    near(h?.band.high ?? NaN, 0.195)
    // with room for Sonnet: the most expensive that fits, also across thinking
    expect(cheaperForHalt(both, { ...ctx, rest: 0.4 })?.route).toEqual(SONNET)
    expect(cheaperForHalt(both, { ...ctx, rest: 0.4, acrossThinking: true })?.route).toEqual(SONNET)
    // never the same model or a dearer one
    expect(cheaperForHalt([cand(OPUS)], { ...ctx, rest: 100 })).toBeNull()
  })

  test('a 250k context never offers Haiku 4.5 (200k); a 300-page PDF never a 100-page model; MCP only to models with MCP', () => {
    expect(cheaperForHalt([cand(HAIKU)], { ...ctx, rest: 100, context: 250_000, acrossThinking: true })).toBeNull()
    expect(cheaperForHalt([cand(SONNET), cand(HAIKU)], { ...ctx, rest: 100, context: 250_000, acrossThinking: true })?.route).toEqual(SONNET)
    // positive control: the same Haiku with the context that fits
    expect(cheaperForHalt([cand(HAIKU)], { ...ctx, rest: 100, acrossThinking: true })?.route).toEqual(HAIKU)
    const pdf = needsOfHistory([{ content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0' } }] }], { pdfPages: () => 300 })
    expect(pdf.pdfPages).toBe(300)
    expect(cheaperForHalt([cand(HAIKU)], { ...ctx, rest: 100, needs: pdf, acrossThinking: true })).toBeNull()
    expect(cheaperForHalt([cand(SONNET), cand(HAIKU)], { ...ctx, rest: 100, needs: pdf, acrossThinking: true })?.route).toEqual(SONNET)
    // a PDF whose page count is not known: no model is offered
    const unknown = needsOfHistory([{ content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' } }] }])
    expect(unknown.pdfPages).toBe(Infinity)
    expect(cheaperForHalt([cand(SONNET)], { ...ctx, rest: 100, needs: unknown })).toBeNull()
    const noMcp = cand(HAIKU, { caps: { ...capsOf(HAIKU)!, mcp: false } })
    expect(cheaperForHalt([noMcp], { ...ctx, rest: 100, acrossThinking: true, mcpAttached: true })).toBeNull()
    expect(cheaperForHalt([noMcp], { ...ctx, rest: 100, acrossThinking: true })?.route).toEqual(HAIKU)
    const noVision = cand(HAIKU, { caps: { ...capsOf(HAIKU)!, vision: false } })
    const pic = needsOfHistory([{ content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }] }])
    expect(pic.vision).toBe(true)
    expect(cheaperForHalt([noVision], { ...ctx, rest: 100, needs: pic, acrossThinking: true })).toBeNull()
  })

  test('what the history needs', () => {
    expect(
      needsOfHistory([
        { content: 'plain text' },
        { content: [{ type: 'thinking', thinking: '…', signature: 'sig' }, { type: 'mcp_tool_use', id: 'm1', name: 'search', server_name: 'tracker', input: {} }] },
      ]),
    ).toEqual({ tools: true, vision: false, pdfPages: 0, mcp: true, thinking: true })
    expect(needsOfHistory([])).toEqual({ tools: false, vision: false, pdfPages: 0, mcp: false, thinking: false })
    expect(capsHold(needsOfHistory([]), capsOf(HAIKU)!, 199_000)).toBe(true)
    expect(capsHold(needsOfHistory([]), capsOf(HAIKU)!, 200_001)).toBe(false)
  })
})

test.describe('the start check (brake.startCheckPure)', () => {
  const first = { low: 0.3, high: 0.52 }
  const run = (mode: RunMode) => ({ source: 'agent:ag-nordlicht:r1', mode })

  test('background runs are not started at the line (a used-up month too); a manual run asks where it was pressed', () => {
    expect(startCheckPure({ run: run('scheduled'), limited: false, scopeKnown: false, first: null, rest: rest(-1) })).toEqual({ start: true })
    expect(startCheckPure({ run: run('scheduled'), limited: true, scopeKnown: true, first, rest: rest(1) })).toEqual({ start: true })
    expect(startCheckPure({ run: run('scheduled'), limited: true, scopeKnown: true, first, rest: rest(0) })).toEqual({ start: false, hold: 'day' })
    expect(startCheckPure({ run: run('trigger'), limited: true, scopeKnown: true, first, rest: rest(0.29) })).toEqual({ start: false, hold: 'day' })
    // 07:30, a month limit used up (the day still has room): not started
    const month = restOf(L({ day: 6, month: 120 }), totals({ today: 0, month: 120.4 }))
    expect(month.binding).toBe('month')
    expect(startCheckPure({ run: run('scheduled'), limited: true, scopeKnown: true, first, rest: month })).toEqual({ start: false, hold: 'month' })
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first, rest: rest(0.29) })).toMatchObject({ start: false, ask: { allow: ALLOW_USD, binding: 'day' } })
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first: { low: 1, high: 1.5 }, rest: rest(0.29) })).toMatchObject({ start: false, ask: { allow: null } })
  })

  test('E is offered only where it raises the binding line: pressing it starts the run; a run budget it never raises', () => {
    const l = L({ day: 6 })
    // the day binds: 6 − 5.71 = 0.29 < 0.52 → ask with E; E pressed (+1 $ on the day) → it starts
    const day = restOf(l, totals({ today: 5.71 }))
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first, rest: day })).toMatchObject({ start: false, ask: { allow: ALLOW_USD, binding: 'day' } })
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first, rest: restOf(l, totals({ today: 5.71 }), {}, ALLOW_USD) })).toEqual({ start: true })
    // the run's own budget binds (maxRunUsd 0.25, $1 spent today): E would raise the day only — never offered
    const own = { run: { budget: 0.25, spent: 0 } }
    const runBound = restOf(l, totals({ today: 1 }), own)
    expect(runBound.binding).toBe('run')
    const v = startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first, rest: runBound })
    expect(v).toMatchObject({ start: false, ask: { allow: null, binding: 'run' } })
    if ('ask' in v) near(v.ask.need, 0.27)
    // and pressing it anyway would not start the run (the verdict is the same)
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first, rest: restOf(l, totals({ today: 1 }), own, ALLOW_USD) })).toMatchObject({ start: false, ask: { allow: null, binding: 'run' } })
    // one-shots and rounds the same way
    expect(allowFits(0.52, day)).toBe(true)
    expect(allowFits(0.52, runBound)).toBe(false)
    expect(oneShot({ limited: true, scopeKnown: true, band: first, answer: 'structured', minOut: 1024, maxTokens: 4096 }, runBound)).toMatchObject({ kind: 'refuse', detail: 'run', fix: { allow: null } })
    const pressed = oneShot({ limited: true, scopeKnown: true, band: first, answer: 'structured', minOut: 1024, maxTokens: 4096 }, day)
    expect(pressed).toMatchObject({ kind: 'refuse', fix: { allow: ALLOW_USD } })
    expect(oneShot({ limited: true, scopeKnown: true, band: first, answer: 'structured', minOut: 1024, maxTokens: 4096 }, restOf(l, totals({ today: 5.71 }), {}, ALLOW_USD)).kind).toBe('pass')
    const halt = round({ run: { source: 'terminal:c1:t1', mode: 'interactive' }, limited: true, next: first, rest: runBound, line: { spent: 0, limit: 0.25 } })
    expect('halt' in halt && halt.halt.allow).toBeNull()
    // a month line binds: E raises it too
    expect(allowFits(0.52, { day: Infinity, month: 0.29, run: Infinity, binding: 'month' })).toBe(true)
  })

  test('no scope or no price with a limit: never started; who asks', () => {
    expect(startCheckPure({ run: run('scheduled'), limited: true, scopeKnown: false, first, rest: rest(9) })).toEqual({ start: false, hold: 'scope' })
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: false, first, rest: rest(9) })).toEqual({ start: false, refuse: 'scope' })
    expect(startCheckPure({ run: run('manual'), limited: true, scopeKnown: true, first: null, rest: rest(9) })).toEqual({ start: false, refuse: 'noprice' })
    expect(startCheckPure({ run: run('trigger'), limited: true, scopeKnown: true, first: null, rest: rest(9) })).toEqual({ start: false, hold: 'noprice' })
    expect((['manual', 'interactive', 'bulk', 'scheduled', 'trigger', 'follow-up'] as RunMode[]).filter(asksAtStart)).toEqual(['manual', 'interactive', 'bulk'])
  })
})

test.describe('agent runs the Regler held (agents/held.ts)', () => {
  const T0 = new Date(2026, 9, 12, 7, 30).getTime()
  const trigger = { type: 'schedule' as const, detail: '07:30' }
  const start = (at: number, binding: 'day' | 'month' = 'day') => ({ agentId: 'ag-nordlicht', day: '2026-10-12', at, binding, line: { spent: 6, limit: 6 }, trigger })
  const run = (id: string, startedAt: number, extra: Partial<AgentRun> = {}): AgentRun => ({ id, agentId: 'ag-nordlicht', runner: 'browser', trigger, startedAt, status: 'ok', summary: '', steps: [], ...extra })
  const change = (status: string) => ({ id: `c-${status}`, kind: 'update_row', status, pageId: 'p-launch' }) as unknown as NonNullable<AgentRun['staged']>[number]

  test('three held starts of a day are ONE record with count 3 and the times; another day is its own record', () => {
    let rec = heldNotStarted(null, start(T0))
    rec = heldNotStarted(rec, start(T0 + 3_600_000))
    rec = heldNotStarted(rec, start(T0 + 7_200_000, 'month'))
    expect(rec.id).toBe(heldId('2026-10-12'))
    expect(heldDay(rec)).toBe('2026-10-12')
    expect(rec).toMatchObject({ status: 'held', startedAt: T0, endedAt: T0 + 7_200_000, summary: '', steps: [] })
    expect(rec.held).toEqual({ kind: 'notStarted', binding: 'month', spent: 6, limit: 6, count: 3, times: [T0, T0 + 3_600_000, T0 + 7_200_000] })
    // merged by id into a list: still one record
    let list = mergeRun([], heldNotStarted(null, start(T0)), 100)
    list = mergeRun(list, heldNotStarted(list[0], start(T0 + 60_000)), 100)
    expect(list.length).toBe(1)
    expect(list[0].held?.count).toBe(2)
    // a record of another day is not counted on
    const other = heldNotStarted({ ...rec, id: heldId('2026-10-11') }, start(T0))
    expect(other.held?.count).toBe(1)
    // the times keep the newest HELD_TIMES
    let many = heldNotStarted(null, start(T0))
    for (let i = 1; i < HELD_TIMES + 5; i++) many = heldNotStarted(many, start(T0 + i * 60_000))
    expect(many.held?.count).toBe(HELD_TIMES + 5)
    expect(many.held?.times?.length).toBe(HELD_TIMES)
    expect(many.held?.times?.[0]).toBe(T0 + 5 * 60_000)
  })

  test('a stop keeps the proposals and the brake numbers; status held, never budget', () => {
    const r = run('r7', T0, { status: 'running', staged: [change('pending'), change('applied')] })
    const held = heldStopped(r, { binding: 'day', line: { spent: 5.71, limit: 6 }, rest: 0.29, next: { low: 0.3, high: 0.52 }, at: T0 + 9000 })
    expect(held.status).toBe('held')
    expect(held.staged).toBe(r.staged)
    expect(held.held).toEqual({ kind: 'stopped', binding: 'day', spent: 5.71, limit: 6 })
    expect(held.brake).toEqual({ binding: 'day', rest: 0.29, next: { low: 0.3, high: 0.52 } })
    expect(held.endedAt).toBe(T0 + 9000)
    expect(openProposals(held)).toBe(1)
  })

  test('120 held runs never push out a run with pending changes; past 50 more the newest run says how many went', () => {
    const pending = run('r-pending', T0 - 1, { status: 'staged', staged: [change('pending'), change('failed')] })
    const held = Array.from({ length: 120 }, (_, i) => run(`held-${i}`, T0 + i * 1000, { status: 'held', held: { kind: 'notStarted', binding: 'day', count: 1 } }))
    let list: AgentRun[] = [pending]
    for (const h of held) list = mergeRun(list, h, 100)
    expect(list.length).toBe(101)
    expect(list.some((r) => r.id === 'r-pending')).toBe(true)
    expect(list[0].pruned).toBeUndefined()
    // positive control: a run without open proposals goes at the limit
    const done = run('r-done', T0 - 1, { status: 'staged', staged: [change('applied')] })
    let plain: AgentRun[] = [done]
    for (const h of held) plain = mergeRun(plain, h, 100)
    expect(plain.length).toBe(100)
    expect(plain.some((r) => r.id === 'r-done')).toBe(false)
    // 60 older runs with open proposals: 50 kept, the 10 oldest go and the newest run counts their proposals
    const open = Array.from({ length: 60 }, (_, i) => run(`open-${i}`, T0 - 100_000 + i, { status: 'staged', staged: [change('pending')] }))
    const pruned = pruneRuns([...held.slice(0, 100), ...open], 100)
    expect(pruned.length).toBe(100 + PRUNE_EXTRA)
    expect(pruned[0].pruned).toBe(10)
    expect(pruned.some((r) => r.id === 'open-0')).toBe(false)
    expect(pruned.some((r) => r.id === 'open-59')).toBe(true)
    // a load prunes without noting; a run put again keeps the count its stored copy had
    expect(pruneRuns([...held.slice(0, 100), ...open], 100, { note: false })[0].pruned).toBeUndefined()
    const again = mergeRun(pruned, { ...pruned[0], pruned: undefined, summary: 'done' }, 100)
    expect(again[0]).toMatchObject({ pruned: 10, summary: 'done' })
  })

  test('train 8 (SJ merge): a change its Vorprüfer held back (ChangeStatus held) is open — its run stays past the limit; a held run is not', () => {
    const held = Array.from({ length: 120 }, (_, i) => run(`held-${i}`, T0 + i * 1000, { status: 'held', held: { kind: 'notStarted', binding: 'day', count: 1 } }))
    // a run whose only open proposal is held back by Jev (status 'staged', the change 'held')
    const jev = run('r-jev', T0 - 1, { status: 'staged', staged: [change('held'), change('applied')] })
    expect(openProposals(jev)).toBe(1)
    let list: AgentRun[] = [jev]
    for (const h of held) list = mergeRun(list, h, 100)
    expect(list.length).toBe(101)
    expect(list.some((r) => r.id === 'r-jev')).toBe(true)
    // a run the Regler stopped keeps its proposals by their own statuses: a held-back one among them counts once
    const stopped = heldStopped(run('r-stop', T0 - 2, { status: 'running', staged: [change('held'), change('pending'), change('discarded')] }), { binding: 'day', rest: 0, next: null, at: T0 - 1 })
    expect(openProposals(stopped)).toBe(2)
    // positive control: the Regler's own held status says nothing about open proposals — a held run without any goes
    const empty = run('r-held-empty', T0 - 3, { status: 'held', held: { kind: 'stopped', binding: 'day' }, staged: [change('applied')] })
    expect(openProposals(empty)).toBe(0)
    let plain: AgentRun[] = [empty]
    for (const h of held) plain = mergeRun(plain, h, 100)
    expect(plain.some((r) => r.id === 'r-held-empty')).toBe(false)
  })

  test('health: a hold is no failure — it lights no fail lamp, an earlier failure stays lit', () => {
    const lamp = (runs: AgentRun[]) => {
      const last = newestReal(runs)
      return !!last && (last.status === 'error' || last.status === 'budget')
    }
    const heldRun = run('h', T0 + 2, { status: 'held' })
    expect(lamp([heldRun, run('ok', T0 + 1)])).toBe(false)
    expect(lamp([heldRun, run('e', T0 + 1, { status: 'error' })])).toBe(true)
    expect(lamp([heldRun, run('s', T0 + 1, { status: 'skipped' }), run('b', T0, { status: 'budget' })])).toBe(true)
    // positive control: the agent's own budget failure lights it
    expect(lamp([run('b', T0, { status: 'budget' })])).toBe(true)
  })
})

test.describe('the lamp VERBRAUCH (lamp.ts readUsageLamp)', () => {
  const T = (today: number, month = today, device = today, deviceMonth = month) => ({ scope: { spentToday: today, spentMonth: month, unpricedToday: 0 }, device: { spentToday: device, spentMonth: deviceMonth, scopes: ['local:local'] } })
  const L = (ws: { day?: number; month?: number }, dev: { day?: number; month?: number } = {}) => ({ ws: { day: ws.day ?? null, month: ws.month ?? null }, device: { day: dev.day ?? null, month: dev.month ?? null } })
  const day = '2026-10-12'

  test('below 75 %: dark; from 75 %: amber with count 1, never MASTER CAUTION; the second line', () => {
    expect(readUsageLamp({ day, limits: L({ day: 6 }), totals: T(4.4) })).toEqual({ state: 'ok', count: 0, ids: [] })
    const amber = readUsageLamp({ day, limits: L({ day: 6 }), totals: T(4.5), second: (s, l) => fmtOf(s, l, 'de') })
    expect(amber).toEqual({ state: 'ok', count: 1, ids: ['use:2026-10-12:amber'], level: 'amber', master: false, second: '4,50/6\u00a0$' })
    expect(AMBER_SHARE).toBe(0.75)
    // no line at all: dark, whatever was spent
    expect(readUsageLamp({ day, limits: L({}), totals: T(400) }).count).toBe(0)
  })

  test('at the line: red, MASTER CAUTION, the day’s held / paused (one per property) / halt ids each their own', () => {
    const red = readUsageLamp({
      day,
      limits: L({ day: 6 }),
      totals: T(6.02),
      held: ['ag-nordlicht', 'ag-nordlicht', 'ag-tessera'],
      paused: [
        { db: 'db-launch', prop: 'p-summary', row: 'r1' },
        { db: 'db-launch', prop: 'p-summary', row: 'r2' },
        { db: 'db-launch', prop: 'p-tags', row: 'r1' },
      ] as Array<{ db: string; prop: string }>,
      halts: ['task-7'],
      second: (s, l) => fmtOf(s, l, 'en'),
    })
    expect(red.ids).toEqual(['use:2026-10-12:red', 'held:ag-nordlicht:2026-10-12', 'held:ag-tessera:2026-10-12', 'paused:db-launch:p-summary', 'paused:db-launch:p-tags', 'halt:task-7'])
    expect(red).toMatchObject({ count: 6, level: 'red', master: true, second: '$6.02/6', parts: { held: 2, paused: 2, halt: 1 } })
    // work waiting at the line lights it red below the line too (the budget was raised since: the use id is not lit)
    const waiting = readUsageLamp({ day, limits: L({ day: 10 }), totals: T(6.02), held: ['ag-nordlicht'] })
    expect(waiting).toMatchObject({ count: 1, ids: ['held:ag-nordlicht:2026-10-12'], level: 'red', master: true })
    // acknowledged per band per day: tomorrow's amber is a new id
    expect(readUsageLamp({ day: '2026-10-13', limits: L({ day: 6 }), totals: T(5) }).ids).toEqual(['use:2026-10-13:amber'])
  })

  test('the line nearest its limit binds: the device line across workspaces, the month', () => {
    expect(usageLine(L({ day: 6 }, { day: 8 }), T(4, 4, 7.5))).toMatchObject({ binding: 'device-day', spent: 7.5, limit: 8 })
    expect(usageLine(L({ day: 6, month: 120 }), T(1, 119))).toMatchObject({ binding: 'month', share: 119 / 120 })
    expect(usageLine(L({}), T(5))).toBeNull()
    expect(readUsageLamp({ day, limits: L({ month: 120 }), totals: T(1, 121) }).ids).toEqual(['use:2026-10-12:red'])
  })

  test('the numbers as shown: tokens, bands, amounts (DE / EN)', () => {
    expect(['de', 'en'].map((l) => [950, 15_300, 68_000, 141_400, 1_240_000].map((n) => fmtTok(n, l as 'de' | 'en')))).toEqual([
      ['950', '15,3k', '68k', '141k', '1,24 Mio.'],
      ['950', '15.3k', '68k', '141k', '1.24M'],
    ])
    // a word joiner after the dash: a narrow card never breaks a band into "0,30–" / "0,52 $"
    expect(fmtBand({ low: 0.3, high: 0.52 }, 'de')).toBe('0,30–\u20600,52\u00a0$')
    expect(fmtBand({ low: 0.3, high: 0.52 }, 'en')).toBe('$0.30–\u20600.52')
    expect(fmtBand({ low: 0.611, high: 0.614 }, 'de')).toBe('0,61\u00a0$')
    expect(fmtNum(6, 'de', true)).toBe('6')
    expect(fmtNum(6, 'de')).toBe('6,00')
    expect(fmtOf(5.71, 6, 'de')).toBe('5,71/6\u00a0$')
    expect(fmtOf(5.71, 6.5, 'en')).toBe('$5.71/6.50')
  })
})

test.describe('the instruments’ geometry (gauge.ts) and amounts', () => {
  test('the dial: about 1,25 × the budget, numerals 1 · 2 · 5 per decade, the mini dial leaves out the readout’s numerals', () => {
    expect(dialScale(6, 4.12)).toEqual({ max: 7.5, step: 1 })
    expect(dialScale(6, 5.71, 6.23)).toEqual({ max: 7.5, step: 1 })
    // the value or the next step's end past the scale widens it
    expect(dialScale(6, 9.4)).toEqual({ max: 10, step: 2 })
    expect(dialScale(100, 12)).toEqual({ max: 130, step: 20 })
    // no budget: the scale follows the value (at least 1)
    expect(dialScale(null, 1.56)).toEqual({ max: 2, step: 0.5 })
    expect(dialScale(null, 0)).toEqual({ max: 1, step: 0.2 })
    expect(dialNumerals({ max: 7.5, step: 1 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(dialNumerals({ max: 7.5, step: 1 }, true)).toEqual([2, 3, 4, 5, 6])
    const ticks = dialTicks({ max: 7.5, step: 1 })
    expect(ticks.length).toBe(31)
    expect(ticks.filter((t) => t.kind === 'major').length).toBe(8)
    expect(ticks.filter((t) => t.kind === 'half').length).toBe(8)
    expect(dialTicks({ max: 7.5, step: 1 }, true).every((t) => t.kind !== 'minor')).toBe(true)
    // a day budget under 1 $ (step 0,1, quarters of 0,025): every tick sits evenly — never at a value rounded to cents
    for (const sc of [dialScale(0.5, 0), dialScale(0.1, 0)]) {
      expect(sc.step).toBe(0.1)
      const tk = dialTicks(sc)
      const gaps = tk.slice(1).map((x, i) => x.a - tk[i].a)
      for (const gap of gaps) near(gap, (2 * SWEEP * (sc.step / 4)) / sc.max)
      near(tk[1].a, angleOf(0.025, sc.max))
    }
    expect([angleOf(0, 7.5), angleOf(7.5, 7.5), angleOf(99, 7.5), angleOf(-3, 7.5)]).toEqual([-SWEEP, SWEEP, SWEEP, -SWEEP])
    expect(arcPath(127, 10, 10)).toBe('')
    expect(arcPath(127, -125, 125)).toMatch(/^M\S+ \S+A127 127 0 1 1 /)
  })

  test('the mini bar: needle, this request’s segment, the red line with room past it', () => {
    const g = miniBar(5.71, 0.52, 6)
    expect(g.red).toBe(83.33)
    expect(g.amber).toBe(62.5)
    expect(g.needle).toBe(79.31)
    expect(g.to).toBe(86.53)
    expect(g.over).toBe(true)
    expect(miniBar(1, 0.2, 6).over).toBe(false)
    // a request past the line: its end stays on the bar, past the red line
    expect(miniBar(5.71, 2.69, 8)).toMatchObject({ to: 87.5, red: 83.33, over: true })
    // no limit: no red line, no amber
    expect(miniBar(1.56, 0, null)).toMatchObject({ red: null, amber: null, over: false, needle: 80 })
  })

  test('the month bar: closed days, today, the forecast (Ø × days), the red line and soft limits', () => {
    const g = monthBar({ spent: 33.4, today: 4.12, limit: 120, day: 9, days: 31, soft: [40, 200] })
    expect(g.average).toBeCloseTo(3.711, 3)
    expect(g.projection).toBeCloseTo(115.04, 2)
    expect(g).toMatchObject({ closed: 24.4, today: 27.83, forecast: 95.87, red: 100, amber: 75, over: false, soft: [{ at: 33.33, i: 0 }] })
    expect(monthBar({ spent: 60, today: 5, limit: 120, day: 10, days: 30 })).toMatchObject({ over: true, forecast: 100 })
    const free = monthBar({ spent: 12.4, today: 1.56, limit: null, day: 9, days: 31 })
    expect(free.red).toBeNull()
    expect(free.forecast).toBe(90.91)
  })

  test('amounts as the instruments show them', () => {
    expect(fmtLimit(6, 'de')).toBe('6\u00a0$')
    expect(fmtLimit(6, 'en')).toBe('$6')
    expect(fmtLimit(1, 'de')).toBe('1\u00a0$')
    expect(fmtLimit(6.5, 'en')).toBe('$6.50')
    expect(['de', 'en'].map((l) => [0.5, 2, 1.25, 120].map((v) => fmtScale(v, l as 'de' | 'en')))).toEqual([
      ['0,5', '2', '1,25', '120'],
      ['0.5', '2', '1.25', '120'],
    ])
  })
})

test.describe('strings (features/governor/messages.ts)', () => {
  test('EN and DE hold the same keys, none empty; § 16 is complete; counts have their plural forms', () => {
    const en = governorMessages.en as Record<string, string>
    const de = governorMessages.de as Record<string, string>
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
    for (const [k, v] of [...Object.entries(en), ...Object.entries(de)]) expect(v.trim(), k).not.toBe('')
    // § 16: the held run's toast and inbox note
    for (const k of ['run.held.toast', 'run.held.inbox']) expect(en[`features.governor.${k}`], k).toContain('{name}')
    // a count is never put into one fixed form: ".one" / ".other" pairs, the other with {count}
    for (const k of ['queued.line', 'effects.title', 'halt.staged', 'run.pruned', 'browser.line']) {
      for (const lang of [en, de]) {
        expect(lang[`features.governor.${k}.one`], `${k}.one`).toBeTruthy()
        expect(lang[`features.governor.${k}.other`], `${k}.other`).toBeTruthy()
        expect(lang[`features.governor.${k}`], `${k} alone`).toBeUndefined()
      }
    }
    expect(de['features.governor.queued.line.other']).toBe('{count} KI-Schritte warten · Jetzt ausführen')
    expect(de['features.governor.effects.title.one']).toBe('Wirkung · 1 Stelle')
    expect(en['features.governor.effects.title.other']).toBe('Effect · {count} places')
  })

  test('help: Undo belongs to § 06 only (EN + DE); the workspace article names its AI section and points to the governor', () => {
    const md = (lang: string, id: string) => readFileSync(fileURLToPath(new URL(`../../src/app/help/articles/${lang}/${id}.md`, import.meta.url)), 'utf8')
    expect(md('en', 'governor')).toContain('In § 06, **Undo**')
    expect(md('en', 'governor')).not.toMatch(/^- \*\*Undo\*\* puts back/m)
    expect(md('de', 'governor')).toContain('In § 06 stellt **Rückgängig**')
    for (const [lang, head, name] of [['en', '## AI', '§ 06 Budget & governor'], ['de', '## KI', '§ 06 Budget & Regler']] as const) {
      const text = md(lang, 'workspace')
      expect(text).toContain(head)
      expect(text).toContain(name)
      expect(text).toContain('help:governor')
      expect(text).toMatch(/^summary: .*(AI budget|KI-Budget)/m)
    }
  })
})

test.describe('#/regler tables (features/governor/consumers.ts, B10)', () => {
  const at0 = new Date(2026, 9, 13, 9, 0).getTime()
  const e = (id: string, min: number, source: string, usd: number | null, model = 'claude-opus-5-5', p: 'anthropic' | 'openrouter' = 'anthropic') => ({ id, at: at0 + min * 60_000, source, purpose: 'menu.action', cls: 'write', served: { p, model }, usd })

  test('a source names its consumer: the series, and the agent / database it holds', () => {
    expect(consumerOf({ source: 'terminal:c1:t2' })).toEqual({ kind: 'terminal', key: 'terminal' })
    expect(consumerOf({ source: 'agent:agentNordlicht:run7' })).toEqual({ kind: 'agent', id: 'agentNordlicht', key: 'agent:agentNordlicht' })
    expect(consumerOf({ source: 'autofill:dbTessera:propSummary:w20261013' })).toEqual({ kind: 'autofill', id: 'dbTessera', key: 'autofill:dbTessera' })
    expect(consumerOf({ source: 'ai:r1:improve' }).kind).toBe('menu')
    expect(consumerOf({ source: 'mcp-setup:x1' }).kind).toBe('mcp')
    expect(consumerOf({ source: 'script-draft:x1' }).kind).toBe('writing')
    // the work-order planner (Prüfaufträge B5): one consumer for every request's runs
    expect(consumerOf({ source: 'order:rowPA0000012:or1' })).toEqual({ kind: 'order', key: 'order' })
    // a source this build does not know is "other", never dropped
    expect(consumerOf({ source: 'later-slice:x1' })).toEqual({ kind: 'other', key: 'other' })
  })

  test('consumers: summed per consumer, most spent first; runs = distinct sources; the models by spend; no price counted apart', () => {
    const list = [
      e('a', 1, 'terminal:c1:t1', 1.2),
      e('b', 2, 'terminal:c1:t1', 0.86),
      e('c', 3, 'ai:r1:improve', 0.21),
      e('d', 4, 'ai:r2:transform', 0.56, 'claude-sonnet-5-5'),
      e('f', 5, 'agent:agentNordlicht:run1', 0.74),
      e('g', 6, 'ai:r3:improve', null),
    ]
    const c = consumersOf(list)
    expect(c.map((x) => [x.key, Math.round(x.usd * 100) / 100, x.runs, x.requests, x.unpriced])).toEqual([
      ['terminal', 2.06, 1, 2, 0],
      ['menu', 0.77, 3, 3, 1],
      ['agent:agentNordlicht', 0.74, 1, 1, 0],
    ])
    expect(c[1]!.models.map((m) => m.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
    expect(runsOf(list)).toBe(5)
    expect(providersOf([...list, e('h', 7, 'palette:q1', 0.01, 'vendor-a/model-b', 'openrouter')])).toEqual(['anthropic', 'openrouter'])
  })

  test('the roll: one receipt per run (its responses in order), the newest run first; a response without a price makes the run unpriced', () => {
    const r = rollOf([e('b', 2, 'terminal:c1:t1', 0.86), e('a', 1, 'terminal:c1:t1', 1.2), e('c', 3, 'ai:r1:improve', 0.21), e('d', 9, 'ai:r3:improve', null), e('x', 4, 'ai:r3:improve', 0.1)])
    expect(r.map((x) => x.source)).toEqual(['ai:r3:improve', 'ai:r1:improve', 'terminal:c1:t1'])
    expect(r[2]!.entries.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r[2]!.usd).toBeCloseTo(2.06, 6)
    expect(r[0]!.usd).toBeNull()
  })

  test('the days: newest first, the day total and its runs', () => {
    const y = 24 * 60
    const d = daysOf([e('a', 1, 'terminal:c1:t1', 1.2), e('b', 2, 'terminal:c1:t1', 0.8), e('c', -y, 'ai:r0:improve', 5.2), e('d', 3, 'palette:q1', null)], dayOf)
    expect(d.map((x) => [x.day, Math.round(x.usd * 100) / 100, x.runs, x.unpriced])).toEqual([
      ['2026-10-13', 2, 2, 1],
      ['2026-10-12', 5.2, 1, 0],
    ])
  })
})
