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
import { createHash } from 'node:crypto'
import { createRedactor, redactDoc, redactPersonValue } from '../../src/shared/ai/redact'
import { DATA_CLAUSE, QSET, precheckQuestions } from '../../src/app/features/ai/decide/questions'
import { CHECKED_KINDS, isCheckedKind } from '../../src/app/features/ai/decide/kinds'
import { STATE_LIMITS, dataText, proposalSources, proposalState, type ProposalInput, type StateWorld } from '../../src/app/features/ai/decide/state'
import { checkOf, uncheckedOf } from '../../src/app/features/ai/decide/verdict'
import { classOfPage, classesOf, type SourceWorld } from '../../src/app/features/ai/core/sources'
import type { Database, Page } from '../../src/app/store/types'
import type { StagedChange } from '../../src/app/features/ai/agent/types'

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
    expect(sanitizeJevCheck({ v: 1, at: 5, model: '', state: 'failed', why: 'endpoint' })?.why).toBe('endpoint')
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


/* ------------------------------------------------------------------ */
/* J6 — the question set and what Jev reads (features/ai/decide)        */
/* ------------------------------------------------------------------ */

/** The frozen wording of each question set version: change the wording → bump QSET_VERSION and add its hash here. */
const QSET_HASHES: Record<number, string> = { 1: '93ad0d2a8eac64d5e90f16d5bdfea61e3990df82b9f992787745bb726aeaa7b4' }

test.describe('QSET: the questions Jev answers (features/ai/decide/questions.ts)', () => {
  test('the wording is frozen per version; every question carries the data clause; four named yes / no checks', () => {
    const hash = createHash('sha256').update(JSON.stringify(QSET)).digest('hex')
    expect(hash, 'the question wording changed: bump QSET_VERSION (src/shared/ai/decide.ts) and pin the new hash').toBe(QSET_HASHES[QSET_VERSION])
    expect(Object.keys(QSET)).toEqual([...JEV_CHECK_KEYS])
    for (const k of JEV_CHECK_KEYS) {
      const q = QSET[k]
      expect(q.type, k).toBe('noul')
      expect(q.instructions.endsWith(DATA_CLAUSE), k).toBe(true)
      expect(q.type === 'noul' && !!q.criteria?.true && !!q.criteria?.false, k).toBe(true)
      // never "should this be approved"
      expect(q.instructions.toLowerCase(), k).not.toMatch(/approve|should this/)
    }
    // a request gets its own copy (a caller cannot change the frozen set)
    const copy = precheckQuestions()
    expect(copy).toEqual(QSET)
    ;(copy.asked as { instructions: string }).instructions = 'x'
    expect(QSET.asked.instructions).not.toBe('x')
  })
})

type P = Partial<Page> & { id: string; title: string }
const page = (p: P): Page => ({ kind: 'page', icon: null, cover: null, parentId: null, databaseId: null, properties: {}, content: null, contentRev: 0, contentOrigin: null, favorite: false, trashed: false, trashedAt: null, createdAt: 0, updatedAt: 0, order: 0, settings: {}, ...p }) as unknown as Page
const db = (id: string, properties: AnyJson[], o: AnyJson = {}): Database => ({ id, properties, views: [], ...o }) as unknown as Database
const doc = (...content: AnyJson[]) => ({ type: 'doc', content })
const para = (...content: AnyJson[]) => ({ type: 'paragraph', content })
const txt = (text: string) => ({ type: 'text', text })

/** A fictional workspace: Projects (a row "Launch plan" with an owner and a contact), Contacts (a mail directory), a private page and a private database. */
function fixture() {
  const pages: Record<string, Page> = {
    dbproject001: page({ id: 'dbproject001', kind: 'database', title: 'Projects' }),
    rowlaunch001: page({
      id: 'rowlaunch001',
      title: 'Launch plan',
      parentId: 'dbproject001',
      databaseId: 'dbproject001',
      properties: { owner: ['pmaralind01'], contact: ['ctmaralind01'], status: 'Open', budget: 1200 },
      content: doc(para(txt('Owned by '), { type: 'mention', attrs: { kind: 'person', id: 'pmaralind01', label: 'Mara Lind' } }, txt(' — see '), { type: 'mention', attrs: { kind: 'page', id: 'pvnotes00001', label: 'Board notes' } })),
    }),
    rowtessera01: page({ id: 'rowtessera01', title: 'Tessera review', parentId: 'dbproject001', databaseId: 'dbproject001' }),
    dbcontacts01: page({ id: 'dbcontacts01', kind: 'database', title: 'Contacts' }),
    ctmaralind01: page({ id: 'ctmaralind01', title: 'Mara Lind', parentId: 'dbcontacts01', databaseId: 'dbcontacts01', properties: { email: 'mara@nordlicht.example' } }),
    pvnotes00001: page({ id: 'pvnotes00001', title: 'Board notes', private: true }),
    dbprivate001: page({ id: 'dbprivate001', kind: 'database', title: 'Salaries', private: true }),
    outside00001: page({ id: 'outside00001', title: 'Nordlicht secret plan' }),
  }
  const databases: Record<string, Database> = {
    dbproject001: db('dbproject001', [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 'owner', name: 'Owner', type: 'person' },
      { id: 'contact', name: 'Contact', type: 'relation', relationDatabaseId: 'dbcontacts01' },
      { id: 'status', name: 'Status', type: 'select' },
      { id: 'budget', name: 'Budget', type: 'number' },
    ]),
    dbcontacts01: db('dbcontacts01', [{ id: 'title', name: 'Name', type: 'title' }, { id: 'email', name: 'Email', type: 'email' }], { system: 'mail-contacts' }),
    dbprivate001: db('dbprivate001', [{ id: 'title', name: 'Name', type: 'title' }]),
  }
  const people = [{ id: 'pmaralind01', name: 'Mara Lind' }]
  const ids = [...Object.keys(pages), 'pmaralind01']
  return { pages, databases, people, ids }
}

/**
 * The world a route that may not see private / mail pages (and, without `people`, no names) reads — what world.ts builds
 * from the gate: the page filter from the classes, one redactor, row facts and page Markdown through the redaction.
 */
function worldOf(f: ReturnType<typeof fixture>, o: { people: boolean; members: boolean; scope?: ((id: string) => boolean) | null }): StateWorld {
  const sw: SourceWorld = { pages: f.pages, databases: f.databases, memo: new Map() }
  const visible = (id: string) => o.members || ![...classOfPage(id, sw)].some((c) => c === 'private' || c === 'mail')
  const r = createRedactor()
  const name = (id: string) => f.people.find((p) => p.id === id)?.name ?? id
  const serialise = (n: AnyJson): string => {
    if (n.type === 'text') return n.text
    if (n.type === 'mention') return n.attrs.kind === 'page' ? `[@${f.pages[n.attrs.id]?.title ?? n.attrs.label}](#/p/${n.attrs.id})` : `@${n.attrs.label}`
    const inner = (n.content ?? []).map(serialise).join('')
    return n.type === 'doc' ? (n.content ?? []).map(serialise).join('\n\n') : inner
  }
  return {
    pages: f.pages,
    databases: f.databases,
    isId: (tok) => Object.prototype.hasOwnProperty.call(f.pages, tok) || Object.prototype.hasOwnProperty.call(f.databases, tok) || f.people.some((p) => p.id === tok),
    visible,
    people: o.people,
    redactor: r,
    hidden: '[Seite]',
    rowFacts: (d, row) =>
      d.properties
        .filter((p) => p.type !== 'title')
        .map((p) => {
          const v = row.properties[p.id]
          const list = Array.isArray(v) ? (v as string[]) : []
          if (p.type === 'person') return { name: p.name, value: list.map((id) => (o.people ? name(id) : redactPersonValue(id, r))).join(', ') }
          if (p.type === 'relation') return { name: p.name, value: list.map((id) => (!visible(id) ? '—' : !o.people && f.databases[p.relationDatabaseId!]?.system === 'mail-contacts' ? redactPersonValue(id, r) : f.pages[id]!.title)).join(', ') }
          return { name: p.name, value: v === undefined || v === null ? '' : String(v) }
        })
        .filter((x) => x.value),
    markdown: (d) => serialise(o.people && o.members ? d : redactDoc(d as AnyJson, { people: !o.people, transcript: false, visible, hidden: '[Seite]' }, r)),
    inScope: o.scope === undefined ? (id) => id !== 'outside00001' : o.scope,
  }
}

const change = (c: Partial<StagedChange> & Pick<StagedChange, 'kind' | 'pageId'>): StagedChange => ({ id: 'c1', n: 1, status: 'pending', ...c }) as StagedChange
const input = (c: StagedChange, trigger: ProposalInput['trigger'] = { type: 'manual' }, changes: StagedChange[] = [c]): ProposalInput => ({
  agent: { instructions: 'Keep the Projects rows of the Nordlicht launch in step. Mark a project Done when its tasks are closed.', write: 'stage' },
  trigger,
  change: c,
  changes,
})

/** The update the leak fixtures read: a person field, a contact relation, a select — and a text naming, linking and quoting. */
const LEAKY = change({
  kind: 'update_row',
  pageId: 'rowlaunch001',
  databaseId: 'dbproject001',
  props: [
    { propId: 'owner', name: 'Owner', type: 'person', before: 'Mara Lind', after: 'Mara Lind', intent: { kind: 'value', value: ['pmaralind01'] } },
    { propId: 'contact', name: 'Contact', type: 'relation', before: 'Mara Lind', after: 'Mara Lind', intent: { kind: 'value', value: ['ctmaralind01'] } },
    { propId: 'status', name: 'Status', type: 'select', before: 'Open', after: 'Done', intent: { kind: 'options', names: ['Done'] } },
  ],
  markdown:
    'Closed by [@Mara Lind](one:person/pmaralind01) on [@Fri 17 Oct](one:date/2026-10-17). See [Board notes](#/p/pvnotes00001) and [the plan](#/p/rowlaunch001). Write to mara@nordlicht.example (row rowlaunch001), key sk-or-v1-abcdefghijklmnopqrstuvwxyz0123.\n\n> [!TODO] Ship the pricing page {#wi_7f3a9c2d01}\n> Owner: [@Mara Lind](one:person/pmaralind01) · Due: [@Fri 17 Oct](one:date/2026-10-17)',
})

test.describe('what Jev reads of a proposal (features/ai/decide/state.ts) — leak fixtures, each with its positive control', () => {
  const f = fixture()
  const qs = precheckQuestions()
  const json = (st: unknown) => JSON.stringify(st)

  test('no id, no name without `people`, "[Seite]" for a private link, no e-mail, no key, no task id or field line', () => {
    const out = proposalState(input(LEAKY), worldOf(f, { people: false, members: false }), qs)
    if (!out || 'refused' in out) throw new Error('no state')
    const body = json(out.state)
    for (const id of [...f.ids, 'wi_7f3a9c2d01']) expect(body, id).not.toContain(id)
    expect(body).not.toMatch(/Mara|Lind/)
    expect(body).toContain('[Seite]')
    expect(body).not.toContain('Board notes')
    expect(body).not.toContain('nordlicht.example')
    expect(body).not.toMatch(/sk-or-v1-/)
    expect(body).not.toMatch(/Owner:/)
    // the task keeps its title; links read as the visible title; dates as their label
    expect(body).toContain('Ship the pricing page')
    expect(body).toContain('Launch plan')
    expect(body).toContain('@Fri 17 Oct')
    // the person field and the contact relation: "@Person n" / "—" (a mail directory the route may not see)
    const st = out.state as AnyJson
    expect(st.change.fields).toEqual([
      { name: 'Owner', before: '@Person 1', after: '@Person 1' },
      { name: 'Contact', before: '—', after: '—' },
      { name: 'Status', before: 'Open', after: 'Done' },
    ])
    // the row's other values: the changed fields left out; people redacted the same way
    expect(st.row).toEqual({ Budget: '1200' })
    // key order: change first
    expect(Object.keys(st)).toEqual(['change', 'row', 'trigger', 'agent'])
    expect(st.change.target).toEqual({ kind: 'row', title: 'Launch plan', database: 'Projects' })
  })

  test('positive control: with `people` and the member classes allowed the names and the private title are there', () => {
    const out = proposalState(input(LEAKY), worldOf(f, { people: true, members: true }), qs)
    if (!out || 'refused' in out) throw new Error('no state')
    const body = json(out.state)
    expect(body).toContain('@Mara Lind')
    expect(body).toContain('Board notes')
    expect((out.state as AnyJson).change.fields[1]).toEqual({ name: 'Contact', before: 'Mara Lind', after: 'Mara Lind' })
    // ids, e-mail addresses, keys and task ids never — whatever the route may see
    for (const id of [...f.ids, 'wi_7f3a9c2d01']) expect(body, id).not.toContain(id)
    expect(body).not.toContain('nordlicht.example')
    expect(body).not.toMatch(/sk-or-v1-/)
  })

  test('a person mention in the page text before an append is redacted; a private page link inside it reads "[Seite]"', () => {
    const c = change({ kind: 'append', pageId: 'rowlaunch001', markdown: 'Status: shipped.' })
    const out = proposalState(input(c), worldOf(f, { people: false, members: false }), qs)
    if (!out || 'refused' in out) throw new Error('no state')
    const st = out.state as AnyJson
    expect(st.change.before).toBe('Owned by @Person 1 — see [Seite]')
    expect(st.change.after).toBe('Status: shipped.')
    // control
    const open = proposalState(input(c), worldOf(f, { people: true, members: true }), qs) as AnyJson
    expect(open.state.change.before).toBe('Owned by @Mara Lind — see @Board notes')
  })

  test('a trigger row outside the scope (or one the route may not see) gives no title; inside the scope it does', () => {
    const out = proposalState(input(LEAKY, { type: 'row_changed', rows: ['outside00001'] }), worldOf(f, { people: false, members: false }), qs) as AnyJson
    expect(out.state.trigger).toEqual({ type: 'row_changed' })
    expect(json(out.state)).not.toContain('Nordlicht secret plan')
    expect(out.sources).toEqual([{ row: 'rowlaunch001' }])
    // a private trigger row the route may not see: no title either
    const priv = proposalState(input(LEAKY, { type: 'row_changed', rows: ['pvnotes00001'] }), worldOf(f, { people: false, members: false, scope: null }), qs) as AnyJson
    expect(priv.state.trigger).toEqual({ type: 'row_changed' })
    // control: in scope → its title, and the row joins the request's sources
    const inside = proposalState(input(LEAKY, { type: 'row_changed', rows: ['outside00001'] }), worldOf(f, { people: false, members: false, scope: null }), qs) as AnyJson
    expect(inside.state.trigger).toEqual({ type: 'row_changed', title: 'Nordlicht secret plan' })
    expect(inside.sources).toEqual([{ row: 'rowlaunch001' }, { row: 'outside00001' }])
    // the trigger row that IS the target is the one named
    const self = proposalState(input(LEAKY, { type: 'row_changed', rows: ['rowtessera01', 'rowlaunch001'] }), worldOf(f, { people: false, members: false }), qs) as AnyJson
    expect(self.state.trigger).toEqual({ type: 'row_changed', title: 'Launch plan' })
  })

  test('a create_row under a private database declares `private`; under a shared one it does not (control)', () => {
    const sw: SourceWorld = { pages: f.pages, databases: f.databases, memo: new Map() }
    const priv = change({ kind: 'create_row', pageId: 'newrow000001', databaseId: 'dbprivate001', title: 'Q4 budget', props: [] })
    const out = proposalState(input(priv), worldOf(f, { people: false, members: false }), qs) as AnyJson
    expect(out.sources).toEqual([{ db: 'dbprivate001' }])
    expect([...classesOf(out.sources, sw)]).toContain('private')
    // the database's name stays hidden for a route that may not see it; a new row has no values yet
    expect(out.state.change.target).toEqual({ kind: 'row', title: 'Q4 budget', database: '[Seite]' })
    expect(out.state.row).toEqual({})
    const shared = change({ kind: 'create_row', pageId: 'newrow000002', databaseId: 'dbproject001', title: 'Tessera launch', props: [] })
    const ok = proposalState(input(shared), worldOf(f, { people: false, members: false }), qs) as AnyJson
    expect([...classesOf(ok.sources, sw)]).not.toContain('private')
    expect(ok.state.change.target.database).toBe('Projects')
    // a page created under a page staged in the same run: the staged parent's own parent counts
    const parent = change({ kind: 'create_page', pageId: 'stagedpage01', parentId: 'pvnotes00001', title: 'Minutes' })
    const kid = change({ id: 'c2', n: 2, kind: 'create_page', pageId: 'stagedkid001', parentId: 'stagedpage01', title: 'Agenda', dependsOn: 'c1' })
    expect(proposalSources(input(kid, { type: 'manual' }, [parent, kid]), f)).toEqual([{ page: 'pvnotes00001' }])
    expect(proposalSources(input(change({ kind: 'create_page', pageId: 'top000000001', parentId: null, title: 'Top' })), f)).toEqual([{ all: true }])
  })

  test('only checked kinds: a send, a memory, a coding task, a script, media, a database or property build no state', () => {
    expect([...CHECKED_KINDS]).toEqual(['create_page', 'append', 'edit', 'create_row', 'update_row', 'rename', 'workItem'])
    const w = worldOf(f, { people: false, members: false })
    for (const kind of ['send', 'memory', 'coding', 'script', 'media', 'create_database', 'add_property'] as const) {
      expect(isCheckedKind(kind), kind).toBe(false)
      expect(proposalState(input(change({ kind, pageId: 'rowlaunch001' })), w, qs), kind).toBeNull()
    }
    // control: every checked kind builds one
    for (const kind of CHECKED_KINDS) expect(proposalState(input(change({ kind, pageId: 'rowlaunch001', title: 'Launch plan', beforeTitle: 'Launch', databaseId: 'dbproject001' })), w, qs), kind).not.toBeNull()
  })

  test('limits: before / after ≤ 4 000, the instructions whole, ids out of the instructions too', () => {
    const long = change({ kind: 'create_page', pageId: 'newpage00001', parentId: 'outside00001', title: 'Notes', markdown: 'Launch '.repeat(2000) })
    const i = input(long)
    i.agent.instructions = `Write the weekly notes under [Nordlicht](#/p/outside00001) (id outside00001). ${'Plan. '.repeat(1000)}`.slice(0, 8000)
    const out = proposalState(i, worldOf(f, { people: false, members: false }), qs) as AnyJson
    expect(out.state.change.after.length).toBe(STATE_LIMITS.md)
    expect(out.state.change.after.endsWith('…')).toBe(true)
    expect(out.state.agent.instructions).toMatch(/^Write the weekly notes under Nordlicht secret plan \(id \[id\]\)/)
    expect(out.state.agent.instructions.length).toBeGreaterThan(5000)
    expect(out.state.agent.write_mode).toBe('stage')
    expect(out.chars).toBe(JSON.stringify({ state: out.state, questions: qs }).length)
  })

  test('dataText: links of other kinds keep their label; prototype words are never ids', () => {
    const w = worldOf(f, { people: false, members: false })
    expect(dataText('[Agents](#/agents/ag1) · [task](one:item/wi_0123456789) · [site](https://example.org/a)', w)).toBe('Agents · task · [site](https://example.org/a)')
    expect(dataText('constructor toString hasOwnProperty', w)).toBe('constructor toString hasOwnProperty')
  })
})

test.describe('a stored check from an answer (features/ai/decide/verdict.ts)', () => {
  test('four probabilities → two decimals, the weakest, the mark; a missing answer → no check; unchecked says why', () => {
    const turn = (answers: AnyJson) => ({ kind: 'decide', answers, served: { model: 'typesafe/jev-1.13-20260917' }, usage: null }) as unknown as DecideTurn
    const ok = checkOf(turn({ asked: { type: 'noul', p: 0.951 }, target: { type: 'noul', p: 0.9 }, consistent: { type: 'noul', p: 0.414 }, clean: { type: 'noul', p: 0.99 } }), { at: 5, usd: 0.00004, markBelow: 0.7 })
    expect(ok).toEqual({ v: 1, at: 5, model: 'typesafe/jev-1.13-20260917', state: 'ok', checks: { asked: 0.95, target: 0.9, consistent: 0.41, clean: 0.99 }, low: 'consistent', p: 0.41, usd: 0.00004, mark: true })
    expect(sanitizeJevCheck(ok)).toEqual(ok)
    expect(checkOf(turn({ asked: { type: 'noul', p: 0.9 } }), { at: 5, usd: 0, markBelow: 0.7 })).toBeNull()
    expect(uncheckedOf('policy', { at: 6, sent: false, cls: 'mail' })).toEqual({ v: 1, at: 6, model: '', state: 'skipped', why: 'policy', cls: 'mail' })
    expect(uncheckedOf('timeout', { at: 6, sent: true, usd: 0.00001 })).toMatchObject({ state: 'failed', why: 'timeout', usd: 0.00001 })
  })
})
