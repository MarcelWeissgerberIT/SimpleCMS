/**
 * Jev as Vorprüfer (slice SJ) — the decision contracts in Node (no browser, never a real host): the Jev family and its
 * start values, the stored pre-check and its math (weakest, mark, the near band, the write gate, a compare suggestion
 * through its shuffle), review v2 read strictly (all or nothing) and kept byte for byte by an older build that refuses to
 * run the agent, Jev's device switches; the decisions wire (body, safety, strict parsing, the error table) over the
 * doc-derived fixtures, each naming its ordocs source. Test data is fictional.
 */
import './helpers/noNet'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { DECISIONS_URL, JEV_CALIBRATED, JEV_CONTEXT, JEV_DEFAULTS, JEV_FAMILY, JEV_NEAR, JEV_STATE_TOKENS, canonicalOf, isJevModel, isJevSnapshot, jevLabel, jevSnapshotDay, jevVersion, newestJev } from '../../src/shared/ai/jev'
import { JEV_CHECK_KEYS, QSET_VERSION, gateAllows, markOf, nearOf, readChecks, sanitizeJevCheck, suggestionOf, weakest, type JevCheck } from '../../src/shared/ai/decide'
import { agentAIReadable, decisionChecks, isJevKey, readReview, runsOnClaude, sanitizeAgentAI } from '../../src/shared/ai/route'
import { sanitizeDeviceAI } from '../../src/shared/ai/policy'
import type { DecideQuestion, DecideRequest, DecideTurn } from '../../src/shared/ai/types'
import { ProviderError } from '../../src/shared/ai/errors'
import { DECIDE_FORBIDDEN, assertSafeDecideBody, buildDecide, classifyDecide, decideTokens, overCap, parseDecide } from '../../src/shared/ai/wire/decisions'
import * as legacy from './helpers/legacyRouteS1'

const JEV = 'typesafe/jev-1.13'
const SNAP = 'typesafe/jev-1.13-20260917'
const ON = `openrouter:${SNAP}`
const V2 = { v: 2, on: ON, pre: { markBelow: 0.7, hold: true }, gate: { allowAt: 0.9 } }

test.describe('the Jev family (src/shared/ai/jev.ts)', () => {
  test('pinned versions only for a request; a snapshot may be dated; the alias, variants and the router never', () => {
    for (const id of [JEV, 'typesafe/jev-2', 'typesafe/jev-1.13.4']) expect(isJevModel(id), id).toBe(true)
    for (const id of ['~typesafe/jev-latest', SNAP, 'typesafe/jev-1.13:free', 'typesafe/jev-router', 'typesafe/jev', 'nordwind/jev-1.13', 'typesafe/jev-1.13 ', 42, null]) expect(isJevModel(id), String(id)).toBe(false)
    expect(isJevSnapshot(SNAP)).toBe(true)
    expect(isJevSnapshot(JEV)).toBe(true)
    expect(isJevSnapshot('typesafe/jev-1.13-2026091')).toBe(false)
    expect(isJevSnapshot('typesafe/jev-router')).toBe(false)
    expect(JEV_FAMILY.source).toBe('^typesafe\\/jev-\\d+(\\.\\d+)*$')
    expect(jevVersion(SNAP)).toEqual([1, 13])
    expect(jevVersion('typesafe/jev-router')).toBeNull()
    expect(jevLabel(SNAP)).toBe('Jev 1.13')
    expect(jevLabel('typesafe/jev-2')).toBe('Jev 2')
    expect(jevSnapshotDay(SNAP)).toBe('2026-09-17')
    expect(jevSnapshotDay(JEV)).toBeNull()
  })

  test('the newest pinned version is the default; the canonical (dated) slug is what the person confirms', () => {
    const rows = [
      { id: '~typesafe/jev-latest', canonical: '~typesafe/jev-latest' },
      { id: 'typesafe/jev-1.9', canonical: 'typesafe/jev-1.9-20260101' },
      { id: JEV, canonical: SNAP },
      { id: 'typesafe/jev-1.13:free', canonical: SNAP },
      { id: 'vendor-k/kev-4b', canonical: 'vendor-k/kev-4b-20260924' },
    ]
    expect(newestJev(rows)?.id).toBe(JEV)
    // 1.13 is newer than 1.9 (numbers, not text)
    expect(newestJev(rows.slice(0, 2))?.id).toBe('typesafe/jev-1.9')
    expect(newestJev([{ id: 'vendor-k/kev-4b' }])).toBeNull()
    expect(canonicalOf({ id: JEV, canonical: SNAP })).toBe(SNAP)
    // a canonical slug that is not a dated form of the id is not taken
    expect(canonicalOf({ id: JEV, canonical: 'typesafe/jev-2-20260917' })).toBe(JEV)
    expect(canonicalOf({ id: JEV, canonical: null })).toBe(JEV)
    expect(canonicalOf({ id: JEV })).toBe(JEV)
  })

  test('start values, context and the one decisions surface', () => {
    expect(JEV_DEFAULTS).toEqual({ markBelow: 0.7, allowAt: 0.9 })
    expect(JEV_CALIBRATED).toBe(false)
    expect(JEV_NEAR).toBe(0.08)
    expect(JEV_CONTEXT).toBe(32_000)
    expect(JEV_STATE_TOKENS).toBe(16_000)
    expect(DECISIONS_URL).toBe('https://openrouter.ai/api/alpha/decisions')
  })
})

test.describe('a pre-check and its math (src/shared/ai/decide.ts)', () => {
  const ok = (c: Partial<Record<(typeof JEV_CHECK_KEYS)[number], number>>, more: Partial<JevCheck> = {}): JevCheck => {
    const checks = { asked: 0.95, target: 0.95, consistent: 0.95, clean: 0.95, ...c }
    const w = weakest(checks)
    return { v: 1, at: 1, model: SNAP, state: 'ok', checks, low: w.key, p: w.p, ...more }
  }

  test('weakest: the lowest check, ties to the first in question order', () => {
    expect(weakest({ asked: 0.9, target: 0.41, consistent: 0.6, clean: 0.41 })).toEqual({ key: 'target', p: 0.41 })
    expect(weakest({ asked: 0.5, target: 0.5, consistent: 0.5, clean: 0.5 })).toEqual({ key: 'asked', p: 0.5 })
    expect(JEV_CHECK_KEYS).toEqual(['asked', 'target', 'consistent', 'clean'])
  })

  test('mark below the threshold; near = within 0,08 above it (in hundredths, no float noise); unchecked is neither', () => {
    expect(markOf(ok({ consistent: 0.41 }), 0.7)).toBe(true)
    expect(markOf(ok({ consistent: 0.7 }), 0.7)).toBe(false)
    expect(markOf(ok({ consistent: 0.69 }), 0.7)).toBe(true)
    expect(nearOf(ok({ consistent: 0.7 }), 0.7)).toBe(true)
    expect(nearOf(ok({ consistent: 0.77 }), 0.7)).toBe(true)
    // 0.7 + 0.08 is 0.7799999… in floating point: 0.78 is already clear
    expect(nearOf(ok({ consistent: 0.78 }), 0.7)).toBe(false)
    expect(nearOf(ok({ consistent: 0.69 }), 0.7)).toBe(false)
    const skipped: JevCheck = { v: 1, at: 1, model: '', state: 'skipped', why: 'timeout' }
    expect(markOf(skipped, 0.7)).toBe(false)
    expect(nearOf(skipped, 0.7)).toBe(false)
    expect(markOf(null, 0.7)).toBe(false)
  })

  test('the write gate: every check at or above allowAt and Jev answered — unchecked never passes', () => {
    expect(gateAllows(ok({}), 0.9)).toBe(true)
    expect(gateAllows(ok({ clean: 0.9 }), 0.9)).toBe(true)
    expect(gateAllows(ok({ clean: 0.89 }), 0.9)).toBe(false)
    expect(gateAllows(ok({ asked: 0.85 }), 0.9)).toBe(false)
    expect(gateAllows({ v: 1, at: 1, model: '', state: 'failed', why: 'unavailable' }, 0.8)).toBe(false)
    expect(gateAllows(undefined, 0.8)).toBe(false)
    expect(gateAllows({ ...ok({}), checks: undefined }, 0.8)).toBe(false)
  })

  test('a stored check: read strictly — a corrupt or newer one is never a clear one', () => {
    const stored = { v: 1, at: 1790000000000, model: SNAP, state: 'ok', checks: { asked: 0.981, target: 0.99, consistent: 0.41, clean: 0.93 }, low: 'asked', p: 0.99, mark: true, held: 'mark', usd: 0.00004 }
    const s = sanitizeJevCheck(stored)!
    // two decimals; the weakest computed again from the numbers (never taken from the record)
    expect(s).toEqual({ v: 1, at: 1790000000000, model: SNAP, state: 'ok', checks: { asked: 0.98, target: 0.99, consistent: 0.41, clean: 0.93 }, low: 'consistent', p: 0.41, mark: true, held: 'mark', usd: 0.00004 })
    expect(sanitizeJevCheck({ ...stored, v: 2 })).toBeNull()
    expect(sanitizeJevCheck({ ...stored, checks: { asked: 0.9, target: 0.9, consistent: 0.9 } })).toBeNull()
    expect(sanitizeJevCheck({ ...stored, checks: { ...stored.checks, clean: 1.4 } })).toBeNull()
    expect(sanitizeJevCheck({ ...stored, state: 'clear' })).toBeNull()
    expect(sanitizeJevCheck('ok')).toBeNull()
    // a skipped check keeps its reason; an unknown reason or class is dropped; checks on a skipped one are not read
    expect(sanitizeJevCheck({ v: 1, at: 5, model: '', state: 'skipped', why: 'policy', cls: 'rows', held: 'unchecked', checks: stored.checks, usd: null })).toEqual({ v: 1, at: 5, model: '', state: 'skipped', why: 'policy', cls: 'rows', held: 'unchecked', usd: null })
    expect(sanitizeJevCheck({ v: 1, at: 5, model: '', state: 'skipped', why: 'shrug', cls: 'secrets', held: 'maybe' })).toEqual({ v: 1, at: 5, model: '', state: 'skipped' })
    expect(QSET_VERSION).toBe(1)
    expect(readChecks({ asked: 0, target: 1, consistent: 0.5, clean: 0.333 })).toEqual({ asked: 0, target: 1, consistent: 0.5, clean: 0.33 })
  })

  test('a compare suggestion maps the shuffle back (positions are 1-based, the order says who stood there)', () => {
    const turn = (choice: string, confidence: number | null): DecideTurn => ({ kind: 'decide', answers: { best: { type: 'choice', choice, confidence, probs: { '1': 0.1, '2': 0.7, '3': 0.2 } } }, served: { model: SNAP }, usage: null })
    // shown in the order 3, 1, 2: position 2 holds answer 1
    expect(suggestionOf(turn('2', 0.66), [3, 1, 2])).toEqual({ n: 1, p: 0.66 })
    expect(suggestionOf(turn('1', null), [3, 1, 2])).toEqual({ n: 3, p: 0.1 })
    expect(suggestionOf(turn('4', 0.9), [3, 1, 2])).toBeNull()
    expect(suggestionOf(turn('x', 0.9), [3, 1, 2])).toBeNull()
    expect(suggestionOf({ kind: 'decide', answers: { best: { type: 'noul', p: 0.9 } }, served: { model: SNAP }, usage: null }, [1, 2])).toBeNull()
    expect(suggestionOf({ kind: 'decide', answers: {}, served: { model: SNAP }, usage: null }, [1, 2])).toBeNull()
  })
})

test.describe('review v2: read all or nothing (DJ10 r2)', () => {
  test('a valid v2 is read (with and without its own Vorprüfer and the Schreibschranke)', () => {
    expect(readReview(V2)).toEqual(V2)
    const own = { v: 2, decider: { p: 'openrouter', m: JEV }, on: `openrouter:${JEV}`, pre: { markBelow: 0.3, hold: false } }
    expect(readReview(own)).toEqual(own)
    expect(readReview({ ...V2, gate: null })).toEqual({ ...V2, gate: null })
    expect(readReview({ ...V2, pre: { markBelow: 0.95, hold: true }, gate: { allowAt: 0.99 } })).toEqual({ ...V2, pre: { markBelow: 0.95, hold: true }, gate: { allowAt: 0.99 } })
    expect(isJevKey(ON)).toBe(true)
    expect(isJevKey('openrouter:typesafe/jev-router')).toBe(false)
  })

  test('anything off makes the whole review unreadable', () => {
    const bad: Array<[string, unknown]> = [
      ['v 3', { ...V2, v: 3 }],
      ['v "2"', { ...V2, v: '2' }],
      ['an unknown key', { ...V2, check: { route: [] } }],
      ['a top-level route', { ...V2, route: [{ p: 'anthropic', m: 'claude-opus-5-5' }] }],
      ['no pre', { v: 2, on: ON }],
      ['pre with an unknown key', { ...V2, pre: { markBelow: 0.7, hold: true, mode: 'hold' } }],
      ['markBelow missing', { ...V2, pre: { hold: true } }],
      ['markBelow below 0.30', { ...V2, pre: { markBelow: 0.29, hold: true } }],
      ['markBelow above 0.95', { ...V2, pre: { markBelow: 0.96, hold: true } }],
      ['markBelow with three decimals', { ...V2, pre: { markBelow: 0.705, hold: true } }],
      ['markBelow as text', { ...V2, pre: { markBelow: '0.7', hold: true } }],
      ['hold missing', { ...V2, pre: { markBelow: 0.7 } }],
      ['hold not a boolean', { ...V2, pre: { markBelow: 0.7, hold: 'yes' } }],
      ['allowAt below 0.80', { ...V2, gate: { allowAt: 0.79 } }],
      ['allowAt 1', { ...V2, gate: { allowAt: 1 } }],
      ['gate with an unknown key', { ...V2, gate: { allowAt: 0.9, strict: true } }],
      ['gate not an object', { ...V2, gate: 0.9 }],
      ['a decider that is not Jev', { ...V2, decider: { p: 'openrouter', m: 'vendor-a/model-b' } }],
      ['a decider that is the alias', { ...V2, decider: { p: 'openrouter', m: '~typesafe/jev-latest' } }],
      ['a decider that is the router', { ...V2, decider: { p: 'openrouter', m: 'typesafe/jev-router' } }],
      ['a decider with an effort', { ...V2, decider: { p: 'openrouter', m: JEV, effort: 'low' } }],
      ['a decider on Claude', { ...V2, decider: { p: 'anthropic', m: 'claude-opus-5-5' } }],
      ['a decider null', { ...V2, decider: null }],
      ['on missing', { v: 2, pre: { markBelow: 0.7, hold: true } }],
      ['on not Jev', { ...V2, on: 'openrouter:vendor-a/model-b' }],
      ['on without a provider', { ...V2, on: SNAP }],
    ]
    for (const [why, v] of bad) {
      expect(readReview(v), why).toBeNull()
      const kept = sanitizeAgentAI({ review: v })
      // kept as it was (a save writes it back), never acted on
      expect(JSON.stringify(kept.review), why).toBe(JSON.stringify(v))
      expect(agentAIReadable(kept), why).toBe(false)
      expect(decisionChecks(kept), why).toBe('unreadable')
      expect(runsOnClaude(kept), why).toBe(false)
    }
  })

  test('v1 (the chat reviewer) reads as it always did; the agent fields carry v2 and say what it holds', () => {
    const v1 = { route: [{ p: 'anthropic', m: 'claude-haiku-4-5' }], mode: 'hold' }
    expect(readReview(v1)).toEqual(v1)
    expect(decisionChecks(sanitizeAgentAI({ review: v1 }))).toBeNull()
    expect(decisionChecks(sanitizeAgentAI({}))).toBeNull()
    expect(decisionChecks(sanitizeAgentAI({ review: null }))).toBeNull()
    const a = sanitizeAgentAI({ review: V2 })
    expect(a.review).toEqual(V2)
    expect(agentAIReadable(a)).toBe(true)
    expect(decisionChecks(a)).toEqual({ on: ON, pre: { markBelow: 0.7, hold: true }, gate: { allowAt: 0.9 } })
    // a server build does not run a Vorprüfer agent (DJ14 — decision models reach the server with S9); v1 still runs
    expect(runsOnClaude(a)).toBe(false)
    expect(runsOnClaude(sanitizeAgentAI({ review: v1 }))).toBe(true)
  })

  test('legacy keep: a slice 1 / 2 tab keeps v2 byte for byte and does not run the agent (control: v1 readable by both)', () => {
    for (const v of [V2, { ...V2, gate: null }, { v: 2, decider: { p: 'openrouter', m: JEV }, on: ON, pre: { markBelow: 0.55, hold: false } }]) {
      const old = legacy.sanitizeAgentAI({ review: v })
      expect(JSON.stringify(old.review)).toBe(JSON.stringify(v))
      expect(legacy.agentAIReadable(old)).toBe(false)
      expect(legacy.runsOnClaude(old)).toBe(false)
      // what the older tab writes back is what this build reads (nothing lost on a round trip through it)
      expect(readReview(old.review)).toEqual(readReview(v))
    }
    const v1 = { route: [{ p: 'anthropic', m: 'claude-haiku-4-5' }], mode: 'mark' }
    expect(legacy.agentAIReadable(legacy.sanitizeAgentAI({ review: v1 }))).toBe(true)
    expect(agentAIReadable(sanitizeAgentAI({ review: v1 }))).toBe(true)
  })
})

test.describe("Jev's switches on this device (settings.ai.jev)", () => {
  test('booleans only, absent = off; an S6 compare switch is kept; an S2-style save has none', () => {
    expect(sanitizeDeviceAI({ jev: { verify: true } })).toEqual({ jev: { verify: true } })
    expect(sanitizeDeviceAI({ jev: { verify: false, compare: true } })).toEqual({ jev: { verify: false, compare: true } })
    expect(sanitizeDeviceAI({ jev: { verify: 'yes', compare: 1, other: true } })).toBeUndefined()
    expect(sanitizeDeviceAI({ jev: true })).toBeUndefined()
    const s2 = sanitizeDeviceAI({ routes: { write: [{ p: 'anthropic', m: 'claude-sonnet-5-5' }] } })!
    expect('jev' in s2).toBe(false)
    expect(s2.jev?.verify ?? false).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The wire (src/shared/ai/wire/decisions.ts)                           */
/* ------------------------------------------------------------------ */

type AnyJson = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DOC = fileURLToPath(new URL('../fixtures/ai/openrouter/doc/', import.meta.url))
const fx = (name: string): AnyJson => JSON.parse(readFileSync(`${DOC}${name}.json`, 'utf8')) as AnyJson
const UP = { deny: [], noCollect: true, zdr: false }
const OPTS = { pins: ['typesafe'], upstream: UP, referer: 'https://one.example/app/' }
const reqOf = (r: AnyJson): DecideRequest => ({ kind: 'decide', route: { p: 'openrouter', m: r.model as string }, state: r.state as Record<string, unknown>, questions: r.questions as Record<string, DecideQuestion> })

test.describe('the decisions wire', () => {
  test('every decisions fixture names its ordocs source and is unverified', () => {
    const names = readdirSync(DOC).filter((f) => f.startsWith('decisions-'))
    expect(names.length).toBeGreaterThanOrEqual(9)
    for (const n of names) {
      const f = JSON.parse(readFileSync(`${DOC}${n}`, 'utf8')) as AnyJson
      expect(f.source, n).toMatch(/^[a-z0-9_-]+\.md(#|\b)/)
      expect(f.verified, n).toBe(false)
      for (const c of (f.cases ?? []) as AnyJson[]) if (c.source) expect(c.source, `${n}: ${c.name}`).toMatch(/\.md/)
    }
  })

  test('the body: the pinned version, state, questions, the pins, fallbacks off, the upstream rule — and nothing else', () => {
    const t = fx('decisions-tutorial')
    const b = buildDecide(reqOf(t.request), OPTS)
    expect(b.url).toBe(DECISIONS_URL)
    expect(b.body).toEqual({ model: 'typesafe/jev-1.13', state: t.request.state, questions: t.request.questions, provider: { only: ['typesafe'], allow_fallbacks: false, data_collection: 'deny' } })
    expect(b.headers).toEqual({ 'Content-Type': 'application/json', 'HTTP-Referer': 'https://one.example/app/', 'X-OpenRouter-Title': 'One', 'X-OpenRouter-App-Visibility': 'hidden' })
    // zero data retention and data collection follow the workspace's upstream rule
    expect((buildDecide(reqOf(t.request), { ...OPTS, upstream: { deny: [], noCollect: false, zdr: true } }).body as AnyJson).provider).toEqual({ only: ['typesafe'], allow_fallbacks: false, data_collection: 'allow', zdr: true })
    // no body built from any fixture carries require_parameters or an identity field (SP-J1: One omits it)
    for (const n of ['decisions-tutorial', 'decisions-api-example', 'decisions-gate-approve', 'decisions-gate-block', 'decisions-gate-review']) {
      const json = JSON.stringify(buildDecide(reqOf(fx(n).request), OPTS).body)
      for (const k of DECIDE_FORBIDDEN) expect(json, `${n}: ${k}`).not.toContain(`"${k}"`)
    }
    // a question's extra fields never ride along
    const odd = buildDecide({ ...reqOf(t.request), questions: { done: { type: 'noul', instructions: 'Is it finished?', extra: 'x' } as unknown as DecideQuestion } }, OPTS)
    expect((odd.body as AnyJson).questions).toEqual({ done: { type: 'noul', instructions: 'Is it finished?' } })
  })

  test('body safety: identity fields, other models, loose pins, odd keys and an oversized state never go out', () => {
    const t = fx('decisions-tutorial')
    const good = buildDecide(reqOf(t.request), OPTS).body as AnyJson
    expect(() => assertSafeDecideBody(good)).not.toThrow()
    const bad: Array<[string, AnyJson]> = [
      ...DECIDE_FORBIDDEN.map((k) => [k, { ...good, [k]: k === 'models' ? ['x/y'] : 'x' }] as [string, AnyJson]),
      ['provider.require_parameters', { ...good, provider: { ...good.provider, require_parameters: true } }],
      ['provider.ignore', { ...good, provider: { ...good.provider, ignore: ['nordwind'] } }],
      ['empty only', { ...good, provider: { ...good.provider, only: [] } }],
      ['fallbacks on', { ...good, provider: { ...good.provider, allow_fallbacks: true } }],
      ['no data rule', { ...good, provider: { only: ['typesafe'], allow_fallbacks: false } }],
      ['zdr false', { ...good, provider: { ...good.provider, zdr: false } }],
      ['the alias', { ...good, model: '~typesafe/jev-latest' }],
      ['a dated snapshot', { ...good, model: 'typesafe/jev-1.13-20260917' }],
      ['the router', { ...good, model: 'typesafe/jev-router' }],
      ['another decision model', { ...good, model: 'vendor-k/kev-4b' }],
      ['a question key with capitals', { ...good, questions: { Asked: { type: 'noul', instructions: 'x' } } }],
      ['a question key too long', { ...good, questions: { [`a${'b'.repeat(32)}`]: { type: 'noul', instructions: 'x' } } }],
      ['no questions', { ...good, questions: {} }],
      ['a question without instructions', { ...good, questions: { a: { type: 'noul' } } }],
      ['a state that is text', { ...good, state: 'ticket' }],
      ['a state over the cap', { ...good, state: { text: 'x'.repeat(16_000 * 4) } }],
    ]
    for (const [why, body] of bad) expect(() => assertSafeDecideBody(body), why).toThrow(/unsafe decisions body/)
    // the cap: chars ÷ 4 + 300 over 16 000 tokens
    expect(decideTokens({ a: 'x'.repeat(100) }, {})).toBe(Math.ceil((JSON.stringify({ a: 'x'.repeat(100) }).length + 2) / 4) + 300)
    expect(overCap({ state: { text: 'x'.repeat(62_000) }, questions: {} })).toBe(false)
    expect(overCap({ state: { text: 'x'.repeat(64_000) }, questions: {} })).toBe(true)
  })

  test('parse: noul, choice, score from the tutorial (output_tokens kept), the API example, another model\'s image answer', () => {
    for (const n of ['decisions-tutorial', 'decisions-api-example']) {
      const f = fx(n)
      const turn = parseDecide(f.response, f.request.questions)
      expect(turn.kind).toBe('decide')
      expect(turn.answers, n).toEqual(f.expect.answers)
      expect(turn.served, n).toEqual(f.expect.served)
      expect(turn.usage!.reportedUsd, n).toBe(0.000019992)
    }
    expect(parseDecide(fx('decisions-tutorial').response, fx('decisions-tutorial').request.questions).usage).toEqual(fx('decisions-tutorial').expect.usage)
    const m = fx('decisions-multimodal')
    const mt = parseDecide(m.response, m.questions)
    expect(mt.answers).toEqual(m.expect.answers)
    expect(mt.served).toEqual(m.expect.served)
    expect({ input: mt.usage!.input, output: mt.usage!.output, reportedUsd: mt.usage!.reportedUsd }).toEqual(m.expect.usage)
  })

  test('parse: the gate cookbook (approve, block, review) and the verified cascade (supported, declined, unsupported)', () => {
    for (const n of ['decisions-gate-approve', 'decisions-gate-block', 'decisions-gate-review']) {
      const f = fx(n)
      const turn = parseDecide(f.response, f.request.questions)
      expect(Object.fromEntries(Object.entries(turn.answers).map(([k, a]) => [k, a.type === 'noul' ? a.p : null])), n).toEqual(f.expect.checks)
      expect(turn.served.model).toBe('typesafe/jev-1.13-20260917')
    }
    const c = fx('decisions-cascade')
    for (const k of c.cases as AnyJson[]) {
      const turn = parseDecide(k.response, c.question)
      const a = turn.answers.support!
      expect(a.type === 'choice' && { choice: a.choice, confidence: a.confidence }, k.name).toEqual(k.expect)
    }
  })

  test("parse is strict: a missing answer, noul 1.4, an unknown choice, a wrong type or no model → 'empty' (went out: metered from its usage)", () => {
    const t = fx('decisions-tutorial')
    const q = t.request.questions as Record<string, DecideQuestion>
    const r = t.response as AnyJson
    const cases: Array<[string, AnyJson]> = [
      ['a missing answer', { ...r, answers: { is_bug: r.answers.is_bug, team: r.answers.team } }],
      ['noul 1.4', { ...r, answers: { ...r.answers, is_bug: { type: 'noul', noul: 1.4 } } }],
      ['noul as text', { ...r, answers: { ...r.answers, is_bug: { type: 'noul', noul: '0.9' } } }],
      ['an unknown choice', { ...r, answers: { ...r.answers, team: { type: 'choice', choice: 'legal', confidence: 0.9 } } }],
      ['a score off the scale', { ...r, answers: { ...r.answers, urgency: { type: 'score', score: 3.2 } } }],
      ['a confidence of 2', { ...r, answers: { ...r.answers, team: { ...r.answers.team, confidence: 2 } } }],
      ['another type', { ...r, answers: { ...r.answers, is_bug: { type: 'choice', choice: 'payments' } } }],
      ['no answers', { ...r, answers: null }],
      ['no model', { ...r, model: undefined }],
    ]
    for (const [why, json] of cases) {
      let err: unknown = null
      try {
        parseDecide(json, q)
      } catch (e) {
        err = e
      }
      expect(err, why).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).code, why).toBe('empty')
      expect((err as ProviderError).reach, why).toBe('sent')
      // the reported usage rides along: the response is metered although it is not used
      expect(((err as ProviderError).partial as DecideTurn).usage?.reportedUsd, why).toBe(0.000019992)
    }
    // a missing confidence is null (never certain); probabilities outside the options are left out
    const loose = parseDecide({ ...r, answers: { ...r.answers, team: { type: 'choice', choice: 'payments', probabilities: { payments: 0.9, legal: 0.1, frontend: 'x' } } } }, q)
    expect(loose.answers.team).toEqual({ type: 'choice', choice: 'payments', confidence: null, probs: { payments: 0.9 } })
    // an answer to a question not asked is ignored
    expect(Object.keys(parseDecide({ ...r, answers: { ...r.answers, extra: { type: 'noul', noul: 0.5 } } }, q).answers)).toEqual(['is_bug', 'team', 'urgency'])
  })

  test('the error table (doc-derived): every documented status → one code, Retry-After read, keys scrubbed', () => {
    for (const c of fx('decisions-errors').cases as AnyJson[]) {
      const out = classifyDecide(c.status, c.body, c.headers ?? null)
      expect(out.code, c.name).toBe(c.expect)
      if (c.retryAfter !== undefined) expect(out.retryAfter, c.name).toBe(c.retryAfter)
      expect(out.detail, c.name).not.toMatch(/sk-or-v1-/)
    }
  })
})
