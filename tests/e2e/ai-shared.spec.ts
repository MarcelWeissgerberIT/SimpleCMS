/**
 * Multi-provider AI — the shared contracts (src/shared/ai), pure: run in Node by the Playwright runner (no browser).
 * Model-id validators and refused OpenRouter slugs, the one cost function (cache never priced twice, long-context and
 * time-of-day overrides, reasoning, reported cost, unknown price = none), usage normalisers, estimates, the stored
 * shapes' sanitizers (old ⇄ new, 'demo' and unknown providers refused), the policy generation, keys in text. The
 * shared folder imports nothing outside itself. Test data is fictional.
 */
import './helpers/noNet'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { AI_ERROR_CODES, fallbackOf, isAIErrorCode } from '../../src/shared/ai/errors'
import { MODELS, capsOf, labelOf, modelBase, modelIdProblem, modelRow, refusedSlug, sameModel, vendorOf } from '../../src/shared/ai/models'
import { DYNAMIC_BOUND, PRICES, PRICES_DATE, blendedPerM, costOf, priceRow, tierLabel } from '../../src/shared/ai/prices'
import { estimateUsage, normalise, addUsage } from '../../src/shared/ai/usage'
import { agentAIReadable, legacyRule, readAgentRoute, routeKey, runsOnClaude, sanitizeAgentAI, sanitizeRoute, sanitizeRule } from '../../src/shared/ai/route'
import { AI_POLICY_GEN, policyKnown, requiredGen, sanitizeDeviceAI, sanitizePriceRow, sanitizeWorkspaceAI, storedGen } from '../../src/shared/ai/policy'
import { boundOf, capsOfRow, expandCatalog, hintsOfRow, readCatalogRow, routerLists, suggestRoles, trimCatalog } from '../../src/shared/ai/catalog'
import { looksLikeKey, scrubSecrets } from '../../src/shared/ai/keys'
import type { ChatRequest, DecideRequest, PriceRow, Usage, WireRequest } from '../../src/shared/ai/types'
import type { TurnOf } from '../../src/shared/ai/adapter'
import { OWNER } from '../../src/shared/ai/owner'
import { JEV_ROUTER, JEV_TIERS, ROUTER_PINS, isJevRouter } from '../../src/shared/ai/jev'
import { classOfPage, classesOf, isSources, type SourceWorld } from '../../src/app/features/ai/core/sources'
import type { Database, Page } from '../../src/app/store/types'
import { estimate } from '../../src/app/features/governor/estimate'

const U = (x: Partial<Usage> = {}): Usage => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, ...x })
const usd = (u: Usage, r: PriceRow | null, at?: Date) => costOf(u, r, at).usd
const close = (a: number | null, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(1e-12)

test.describe('models and slugs', () => {
  test('model ids per provider', () => {
    expect(modelIdProblem('anthropic', 'claude-opus-5-5')).toBeNull()
    expect(modelIdProblem('anthropic', 'claude-some-future-7')).toBeNull()
    expect(modelIdProblem('anthropic', 'gpt-6-luna')).toBe('format')
    expect(modelIdProblem('anthropic', 'Claude-Opus')).toBe('format')
    expect(modelIdProblem('openai', 'gpt-6.1-sol')).toBeNull()
    expect(modelIdProblem('openai', 'ft:gpt-6-luna:nordlicht:tessera:abc1')).toBeNull()
    // a fine-tune's id ends in a mixed-case suffix; plain ids stay lower case
    expect(modelIdProblem('openai', 'ft:gpt-4o-mini-2024-07-18:my-org:custom_suffix:9ABel2dg')).toBeNull()
    expect(modelIdProblem('openai', 'GPT-6-luna')).toBe('format')
    expect(modelIdProblem('openai', '-gpt')).toBe('format')
    expect(modelIdProblem('openrouter', 'vendor-a/model-b')).toBeNull()
    expect(modelIdProblem('openrouter', 'vendor-a/model-b:free')).toBeNull()
    expect(modelIdProblem('openrouter', 'model-b')).toBe('format')
    expect(modelIdProblem('openrouter', 'Vendor/Model')).toBe('format')
    expect(modelIdProblem('demo', 'canned')).toBe('provider')
    expect(modelIdProblem('mistral', 'x/y')).toBe('provider')
    expect(modelIdProblem('anthropic', 42)).toBe('format')
  })

  test('refused OpenRouter slugs: routers, aliases, presets, :online, :batch, models that search the web', () => {
    expect(refusedSlug('openrouter/auto')).toBe('router')
    // a router (the catalogue says so) forwards to models One cannot pin; a price per request alone is no reason
    expect(refusedSlug('vendor-a/model-b', { router: true })).toBe('router')
    expect(refusedSlug('vendor-a/model-b', { router: true, promptPrice: -1, pricing: 'dynamic' })).toBe('router')
    expect(refusedSlug('vendor-a/model-b', { promptPrice: -1 })).toBeNull()
    expect(refusedSlug('vendor-a/model-b', { pricing: 'dynamic' })).toBeNull()
    // the Jev Router (owner update): offered, never refused for being a router or for its price
    expect(OWNER.jevRouter).toBe(true)
    expect(refusedSlug(JEV_ROUTER)).toBeNull()
    expect(refusedSlug(JEV_ROUTER, { router: true, promptPrice: -1, pricing: 'dynamic' })).toBeNull()
    expect(modelIdProblem('openrouter', JEV_ROUTER, { router: true, pricing: 'dynamic' })).toBeNull()
    expect(refusedSlug(`${JEV_ROUTER}:online`)).toBe('online')
    expect(refusedSlug('vendor-z/switch-router', { router: true, pricing: 'dynamic' })).toBe('router')
    expect(refusedSlug('~vendor-a/model-latest')).toBe('alias')
    expect(refusedSlug('vendor-a/model-b@preset')).toBe('alias')
    expect(refusedSlug('vendor-a/model-b:online')).toBe('online')
    expect(refusedSlug('vendor-a/model-b:batch')).toBe('batch')
    expect(refusedSlug('perplexity/sonar-pro')).toBe('web')
    expect(refusedSlug('relace/relace-search')).toBe('web')
    expect(refusedSlug('vendor-a/o-deep-research')).toBe('web')
    expect(refusedSlug('vendor-a/model-b', { web: 'always' })).toBe('web')
    expect(refusedSlug('vendor-a/model-b', { description: 'A fast model that searches the web by itself.' })).toBe('web')
    expect(refusedSlug('vendor-a/model-b', { web: 'on-request', promptPrice: 0.5 })).toBeNull()
    expect(refusedSlug('vendor-a/model-b:free')).toBeNull()
    for (const id of ['openrouter/auto', '~vendor-a/x', 'vendor-a/model-b:online', 'vendor-a/model-b:batch', 'perplexity/sonar']) expect(modelIdProblem('openrouter', id)).not.toBeNull()
  })

  test('registry: caps instead of model names, vendor, labels', () => {
    const haiku = capsOf({ p: 'anthropic', m: 'claude-haiku-4-5' })!
    const opus = capsOf({ p: 'anthropic', m: 'claude-opus-5-5' })!
    // today's Haiku branch = no refusal fallback and no effort
    expect(!haiku.refusalFallback && !haiku.effort).toBe(true)
    expect(!opus.refusalFallback && !opus.effort).toBe(false)
    expect(capsOf({ p: 'anthropic', m: 'claude-sonnet-5-5' })!.refusalFallback).toBe(true)
    expect(haiku.pdf && haiku.pdf.maxPages).toBe(100)
    expect(opus.pdf && opus.pdf.maxPages).toBe(600)
    expect(capsOf({ p: 'openrouter', m: 'vendor-a/model-b' })).toBeNull()
    expect(MODELS.filter((x) => x.selectable).map((x) => routeKey(x.route))).toEqual(['anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-haiku-4-5'])
    expect(MODELS.find((x) => x.route.m === 'claude-haiku-5-5')!.selectable).toBe(false)
    expect(MODELS.filter((x) => x.route.p === 'openai').every((x) => !x.selectable)).toBe(true)
    expect(vendorOf({ p: 'anthropic', m: 'claude-opus-5-5' })).toBe('anthropic')
    expect(vendorOf({ p: 'openrouter', m: 'anthropic/claude-x' })).toBe('anthropic')
    expect(vendorOf({ p: 'openrouter', m: 'vendor-a/model-b' })).toBe('vendor-a')
    // the Jev Router's answer may come from any maker
    expect(vendorOf({ p: 'openrouter', m: JEV_ROUTER })).toBe('*')
    expect(labelOf({ p: 'openrouter', m: JEV_ROUTER })).toBe('OpenRouter · Jev Router')
    expect(labelOf({ p: 'anthropic', m: 'claude-sonnet-5-5' })).toBe('Claude Sonnet 5.5')
    expect(labelOf({ p: 'openrouter', m: 'vendor-a/model-b' })).toBe('OpenRouter · vendor-a/model-b')
  })
})

test.describe('prices', () => {
  test('the table: dated, Sonnet 5.5 cache reads at $0.10, every row with cache write columns', () => {
    expect(PRICES_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(priceRow({ p: 'anthropic', m: 'claude-sonnet-5-5' })!.cacheRead).toBe(0.1)
    expect(priceRow({ p: 'anthropic', m: 'claude-opus-5-5' })!.cacheRead).toBe(0.2)
    for (const r of Object.values(PRICES)) {
      expect(r.cacheWrite).toBeGreaterThan(r.input)
      expect(r.source).toBe('table')
      expect(r.at).toBe(PRICES_DATE)
    }
    expect(priceRow({ p: 'openrouter', m: 'vendor-a/model-b' })).toBeNull()
    expect(priceRow({ p: 'anthropic', m: 'claude-unknown-9' })).toBeNull()
  })

  test('costOf: every column priced once; reasoning is output unless it has its own price', () => {
    const sonnet = priceRow({ p: 'anthropic', m: 'claude-sonnet-5-5' })!
    // 1M of each: 2 (in) + 2.5 (5m write) + 4 (1h write) + 0.1 (read) + 10 (out)
    close(usd(U({ input: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6, output: 1e6 }), sonnet), 18.6)
    close(usd(U({ cacheRead: 1e6 }), sonnet), 0.1)
    // reasoning inside output: not priced twice
    close(usd(U({ output: 1e6, reasoning: 4e5 }), sonnet), 10)
    const own: PriceRow = { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25, reasoning: 8, source: 'catalogue', at: '2026-10-12' }
    close(usd(U({ output: 1e6, reasoning: 4e5 }), own), 0.6 * 4 + 0.4 * 8)
    // a per-request price is added once
    close(usd(U({ input: 1e6 }), { ...own, request: 0.005 }), 1.005)
    expect(costOf(U({ input: 10 }), sonnet).source).toBe('table')
  })

  test('long-context tiers: Haiku 5.5 above 100K ×5 every column, OpenAI above 272K', () => {
    const h = priceRow({ p: 'anthropic', m: 'claude-haiku-5-5' })!
    close(usd(U({ input: 100_000 - 1, output: 1e6 }), h), (99_999 * 0.1) / 1e6 + 0.5)
    // the prompt counts cache reads too: 60K input + 50K read is above 100K
    close(usd(U({ input: 60_000, cacheRead: 50_000 }), h), (60_000 * 0.5 + 50_000 * 0.05) / 1e6)
    const sol = priceRow({ p: 'openai', m: 'gpt-6.1-sol' })!
    close(usd(U({ input: 300_000, output: 1e6 }), sol), (300_000 * 4) / 1e6 + 15)
    close(usd(U({ input: 200_000, output: 1e6 }), sol), (200_000 * 2) / 1e6 + 10)
  })

  test('catalogue overrides by UTC day and hour (wrapping past midnight)', () => {
    const row: PriceRow = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, overrides: [{ utcDays: ['mon', 'tue', 'wed', 'thu', 'fri'], utcStart: 1, utcEnd: 4, input: 2, output: 4 }, { utcStart: 22, utcEnd: 2, output: 3 }], source: 'catalogue', at: '2026-10-12' }
    const mon0230 = new Date('2026-10-12T02:30:00Z')
    const sat0230 = new Date('2026-10-17T02:30:00Z')
    const mon2300 = new Date('2026-10-12T23:00:00Z')
    const mon1200 = new Date('2026-10-12T12:00:00Z')
    close(usd(U({ input: 1e6, output: 1e6 }), row, mon0230), 6)
    close(usd(U({ input: 1e6, output: 1e6 }), row, sat0230), 3)
    close(usd(U({ input: 1e6, output: 1e6 }), row, mon2300), 4)
    close(usd(U({ input: 1e6, output: 1e6 }), row, mon1200), 3)
  })

  test('a reported cost wins; no price row = no price', () => {
    expect(costOf(U({ input: 1e6, reportedUsd: 0.0123 }), priceRow({ p: 'anthropic', m: 'claude-opus-5-5' }))).toEqual({ usd: 0.0123, source: 'reported' })
    expect(costOf(U({ input: 1e6 }), null)).toEqual({ usd: null, source: 'none' })
  })

  test('a dated snapshot id is its model (priced and known as it); an OpenRouter slug never is', () => {
    expect(modelBase('claude-opus-5-5-20261001')).toBe('claude-opus-5-5')
    expect(sameModel('claude-opus-5-5', 'claude-opus-5-5-20261001')).toBe(true)
    expect(sameModel('claude-opus-5-5', 'claude-sonnet-5-5')).toBe(false)
    expect(priceRow({ p: 'anthropic', m: 'claude-sonnet-5-5-20261001' })).toBe(priceRow({ p: 'anthropic', m: 'claude-sonnet-5-5' }))
    expect(modelRow({ p: 'anthropic', m: 'claude-haiku-4-5-20251001' })?.label).toBe('Claude Haiku 4.5')
    expect(priceRow({ p: 'openrouter', m: 'vendor-a/model-b-20261001' })).toBeNull()
  })

  test('estimate(): the band from the one table — the expected answer to the whole budget, cache reads at their price', () => {
    const opus = { p: 'anthropic' as const, m: 'claude-opus-5-5' }
    // 4,000 characters = 1,000 tokens in; 400 out expected, 2,000 at most
    const b = estimate(opus, { promptChars: 4000, maxTokens: 2000 })!
    close(b.low, (1000 * 4 + 400 * 20) / 1e6)
    close(b.high, (1000 * 4 + 2000 * 20) / 1e6)
    // a prompt read from the cache is priced at the cache-read column
    const cached = estimate({ p: 'anthropic', m: 'claude-sonnet-5-5' }, { promptTokens: 10_000, cachedTokens: 8_000, maxTokens: 100, outTokens: 100 })!
    close(cached.low, (2000 * 2 + 8000 * 0.1 + 100 * 10) / 1e6)
    // a model that reasons beyond its visible answer gets headroom on the upper end
    const sol = estimate({ p: 'openai', m: 'gpt-6.1-sol' }, { promptTokens: 1000, maxTokens: 1000, outTokens: 100 })!
    expect(sol.high).toBeGreaterThan((1000 * 2 + 1000 * 10) / 1e6)
    // no price, no band
    expect(estimate({ p: 'openrouter', m: 'vendor-a/model-b' }, { promptChars: 100, maxTokens: 10 })).toBeNull()
  })

  test('blended price and tier labels', () => {
    expect(blendedPerM(priceRow({ p: 'anthropic', m: 'claude-opus-5-5' }))).toBe(8)
    expect(tierLabel(priceRow({ p: 'anthropic', m: 'claude-opus-5-5' }))).toBe('expensive')
    expect(tierLabel(priceRow({ p: 'anthropic', m: 'claude-sonnet-5-5' }))).toBe('mid')
    expect(tierLabel(priceRow({ p: 'openai', m: 'gpt-6-luna' }))).toBe('cheap')
    expect(tierLabel(null)).toBe('unknown')
  })
})

test.describe('usage', () => {
  test('normalise: input never includes the cache; the 1h split; OpenAI and OpenRouter count cached tokens inside the prompt', () => {
    expect(normalise('anthropic', { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 300 })).toEqual(U({ input: 120, output: 40, cacheRead: 900, cacheWrite: 300 }))
    expect(normalise('anthropic', { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } })).toEqual(U({ input: 120, output: 40, cacheWrite: 100, cacheWrite1h: 200 }))
    expect(normalise('anthropic', null)).toEqual(U())
    expect(normalise('openai', { input_tokens: 1000, input_tokens_details: { cached_tokens: 600 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } })).toEqual(U({ input: 400, cacheRead: 600, output: 300, reasoning: 200 }))
    expect(normalise('openrouter', { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 500, cache_write_tokens: 100 }, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.0011 })).toEqual(U({ input: 400, cacheRead: 500, cacheWrite: 100, output: 50, reasoning: 20, reportedUsd: 0.0011 }))
  })

  test('normalise reads a decisions response\'s usage too (input_tokens / output_tokens / cost — doc-derived)', () => {
    const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ai/openrouter/doc/decisions-usage.json', import.meta.url)), 'utf8')) as { source: string; verified: boolean; usage: Record<string, unknown> }
    expect(fx.source).toMatch(/^api_api-reference_alphadecisions_submit-a-decisions-request\.md#/)
    expect(fx.verified).toBe(false)
    expect(normalise('openrouter', fx.usage)).toEqual(U({ input: 476, output: 70, reportedUsd: 0.000019992 }))
  })

  test('estimates: what is known, else characters ÷ 4', () => {
    expect(estimateUsage(4000, 401)).toEqual(U({ input: 1000, output: 101 }))
    expect(estimateUsage(4000, 400, { input: 1500, cacheRead: 200 })).toEqual(U({ input: 1500, cacheRead: 200, output: 100 }))
    expect(addUsage(U({ input: 1, output: 2 }), U({ input: 3, reportedUsd: 0.5 }))).toEqual(U({ input: 4, output: 2, reportedUsd: 0.5 }))
  })
})

test.describe('stored shapes', () => {
  test('routes and rules: stored providers only, 1–3 pins, repeats dropped; one unreadable pin makes the rule unreadable', () => {
    expect(sanitizeRoute({ p: 'openrouter', m: 'x/y', effort: 'high' })).toEqual({ p: 'openrouter', m: 'x/y', effort: 'high' })
    expect(sanitizeRoute({ p: 'openrouter', m: 'x/y', effort: 'max' })).toEqual({ p: 'openrouter', m: 'x/y' })
    expect(sanitizeRoute({ p: 'demo', m: 'canned' })).toBeNull()
    expect(sanitizeRoute({ p: 'anthropic', m: 'gpt-6-luna' })).toBeNull()
    expect(sanitizeRoute({ p: 'openrouter', m: 'openrouter/auto' })).toBeNull()
    const pins = [{ p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'openai', m: 'gpt-6-luna' }, { p: 'openrouter', m: 'x/y' }]
    expect(sanitizeRule(pins)).toEqual([{ p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'openai', m: 'gpt-6-luna' }, { p: 'openrouter', m: 'x/y' }])
    // never a pin dropped (the next one would move up): the whole rule or nothing
    expect(sanitizeRule([{ p: 'demo', m: 'x' }, ...pins])).toBeNull()
    expect(sanitizeRule([{ p: 'google', m: 'gemini-x' }, { p: 'anthropic', m: 'claude-sonnet-5-5' }])).toBeNull()
    expect(sanitizeRule([...pins, { p: 'openrouter', m: 'x/z' }])).toBeNull()
    expect(sanitizeRule([])).toBeNull()
    expect(sanitizeRule('x')).toBeNull()
    expect(legacyRule('claude-sonnet-5-5', true)).toEqual([{ p: 'anthropic', m: 'claude-sonnet-5-5' }])
    // an unknown setting goes to the default model, as before
    expect(legacyRule('claude-haiku-5-5', true)).toEqual([{ p: 'anthropic', m: 'claude-opus-5-5' }])
    expect(legacyRule('claude-opus-5-5', false)).toEqual([])
  })

  test('agent fields: a route, reviewer or saver rule this build cannot read is kept as it was and never runs (fail closed)', () => {
    const FT = 'ft:gpt-4o-mini-2024-07-18:my-org:custom_suffix:9ABel2dg'
    // a fine-tune in front of Claude reads (both pins); it is not Claude, so it does not run here
    const ft = sanitizeAgentAI({ route: [{ p: 'openai', m: FT }, { p: 'anthropic', m: 'claude-sonnet-5-5' }] })
    expect(ft.route).toEqual([{ p: 'openai', m: FT }, { p: 'anthropic', m: 'claude-sonnet-5-5' }])
    expect(runsOnClaude(ft)).toBe(false)
    // a provider this build does not know: kept whole (no pin dropped, Claude never moves up), unreadable, not run
    const raw = { route: [{ p: 'google', m: 'gemini-x' }, { p: 'anthropic', m: 'claude-sonnet-5-5' }] }
    const g = sanitizeAgentAI(raw)
    expect(g.route).toEqual(raw.route)
    expect(readAgentRoute(g.route)).toBe('unreadable')
    expect(agentAIReadable(g)).toBe(false)
    expect(runsOnClaude(g)).toBe(false)
    // kept through a second read and a JSON round trip (a save from this tab writes it back unchanged)
    expect(sanitizeAgentAI(JSON.parse(JSON.stringify(g)))).toEqual(g)
    // the same for a reviewer, a saver rule and applyOn
    for (const extra of [{ review: { route: [{ p: 'google', m: 'gemini-x' }], mode: 'hold' } }, { saverRule: { overUsd: 0.5, to: { p: 'google', m: 'gemini-x' } } }, { applyOn: 'google:gemini-x' }]) {
      const a = sanitizeAgentAI({ route: [{ p: 'anthropic', m: 'claude-sonnet-5-5' }], ...extra })
      expect(a).toMatchObject(extra)
      expect(runsOnClaude(a)).toBe(false)
    }
    // positive controls: Claude first, legacy (absent / null) — runs
    expect(runsOnClaude(sanitizeAgentAI({ route: [{ p: 'anthropic', m: 'claude-sonnet-5-5' }, { p: 'openrouter', m: 'x/y' }] }))).toBe(true)
    expect(runsOnClaude(sanitizeAgentAI({}))).toBe(true)
    expect(runsOnClaude(sanitizeAgentAI({ route: null }))).toBe(true)
    expect(sanitizeAgentAI({})).toEqual({})
    // too big to keep: a marker that still reads as unreadable
    const huge = sanitizeAgentAI({ route: [{ p: 'google', m: 'x'.repeat(5000) }] })
    expect(runsOnClaude(huge)).toBe(false)
  })

  test('Workspace.ai: a full shape survives twice unchanged; junk and demo are dropped; nothing valid = undefined', () => {
    const full = {
      gen: 2,
      policy: {
        providers: {
          anthropic: { allow: ['public', 'page'], forbid: ['mail'] },
          openrouter: { allow: ['public', 'structure', 'selection'], upstream: { deny: ['upstream-z'], noCollect: true, zdr: false } },
        },
        restricted: [{ root: 'pgnordlicht01', to: ['anthropic'] }],
      },
      routes: { '*': [{ p: 'anthropic', m: 'claude-sonnet-5-5' }], bulk: [{ p: 'openrouter', m: 'x/y' }, { p: 'anthropic', m: 'claude-haiku-4-5' }] },
      limits: { openrouter: { monthUsd: 25 } },
      updatedAt: 1760252400000,
      updatedBy: 'acc-mara',
    }
    const once = sanitizeWorkspaceAI(full)
    expect(once).toEqual(full)
    expect(sanitizeWorkspaceAI(JSON.parse(JSON.stringify(once)))).toEqual(full)
    const junk = sanitizeWorkspaceAI({
      gen: 0,
      policy: { providers: { demo: { allow: ['public'] }, openai: { allow: ['public', 'secrets'], forbid: ['page'] } }, restricted: [{ root: '../x', to: ['anthropic'] }, { root: 'pgok00000001', to: ['demo', 'openai'] }] },
      routes: { write: [{ p: 'demo', m: 'x' }], nope: [{ p: 'anthropic', m: 'claude-opus-5-5' }] },
      limits: { openai: { monthUsd: -3 } },
      extra: 'kept?',
    })
    expect(junk).toEqual({ policy: { providers: { openai: { allow: ['public'] } }, restricted: [{ root: 'pgok00000001', to: ['openai'] }] } })
    expect(sanitizeWorkspaceAI({})).toBeUndefined()
    expect(sanitizeWorkspaceAI(null)).toBeUndefined()
    expect(sanitizeWorkspaceAI('x')).toBeUndefined()
  })

  test('settings.ai: the device layer survives; the shortlist keeps valid OpenRouter rows (≤ 24) with caps and prices', () => {
    const caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'passthrough', effort: ['low', 'high'], reasoning: { mandatory: true }, web: false, notes: true, refusalFallback: false, context: 200000, maxOutput: 32000 }
    const price = { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25, overrides: [{ minPrompt: 128000, input: 0.4 }], source: 'catalogue', at: '2026-10-12' }
    const full = {
      routes: { write: [{ p: 'openrouter', m: 'x/y' }] },
      default: [{ p: 'anthropic', m: 'claude-opus-5-5' }],
      fallbackForChosen: true,
      allow: { openrouter: ['memory'] },
      narrow: { anthropic: ['people'] },
      restricted: [{ root: 'pgprivate0001', to: ['anthropic'] }],
      models: [{ m: 'x/y', label: 'Model Y', price, caps, at: '2026-10-12' }],
      gen: 1,
    }
    expect(sanitizeDeviceAI(full)).toEqual(full)
    const bad = sanitizeDeviceAI({ models: [{ m: 'openrouter/auto', label: 'R', price, caps, at: '2026-10-12' }, { m: 'x/z', label: 'Z', price: null, caps: { ...caps, web: 'sometimes' }, at: 'later' }, ...Array.from({ length: 30 }, (_, i) => ({ m: `x/m${i}`, label: `M${i}`, price, caps, at: '2026-10-12' }))] })!
    expect(bad.models!.length).toBe(24)
    expect(bad.models![0]).toMatchObject({ m: 'x/z', price: null, at: '1970-01-01', caps: { web: 'always' } })
    expect(sanitizeDeviceAI({ allow: { demo: ['mail'] } })).toBeUndefined()
  })

  test('policy generation: this build is 2 (S2 enforces rules limiting Claude); a stored gen above it refuses; a rule without a Claude limit needs 1', () => {
    expect(AI_POLICY_GEN).toBe(2)
    expect(requiredGen({ routes: { '*': [{ p: 'anthropic', m: 'claude-opus-5-5' }] } }, null)).toBe(1)
    expect(storedGen(undefined, undefined)).toBe(1)
    expect(storedGen({ gen: 2 }, { gen: 1 })).toBe(2)
    expect(storedGen({}, { gen: 3 })).toBe(3)
    expect(policyKnown({ gen: 1 }, undefined)).toBe(true)
    expect(policyKnown({ gen: 2 }, undefined)).toBe(true)
    expect(policyKnown({ gen: 3 }, undefined)).toBe(false)
    expect(policyKnown(undefined, { gen: 3 })).toBe(false)
    // a build of generation 1 (an older tab) refuses rules stamped 2
    expect(policyKnown({ gen: 2 }, undefined, 1)).toBe(false)
  })
})

test.describe('errors and keys', () => {
  test('error codes: today\'s fourteen first; what may switch to the next pin', () => {
    expect(AI_ERROR_CODES.slice(0, 14)).toEqual(['no_key', 'invalid_key', 'permission', 'rate_limit', 'overloaded', 'offline', 'outdated', 'bad_request', 'mcp', 'mcp_auth', 'refusal', 'empty', 'aborted', 'unknown'])
    for (const c of ['no_credit', 'busy', 'unavailable', 'timeout', 'moderation', 'context', 'capability', 'policy', 'no_route', 'off', 'no_endpoint', 'model_gone', 'key_in_text', 'reload']) expect(isAIErrorCode(c)).toBe(true)
    expect(isAIErrorCode('nope')).toBe(false)
    const switches = AI_ERROR_CODES.filter((c) => fallbackOf(c) === 'switch')
    expect(switches.sort()).toEqual(['model_gone', 'no_credit', 'no_endpoint', 'offline', 'overloaded', 'rate_limit', 'timeout', 'unavailable'])
    expect(AI_ERROR_CODES.filter((c) => fallbackOf(c) === 'same')).toEqual(['busy'])
    for (const c of ['refusal', 'moderation', 'invalid_key', 'permission', 'bad_request', 'context', 'policy', 'capability', 'mcp', 'mcp_auth', 'aborted', 'key_in_text', 'reload'] as const) expect(fallbackOf(c)).toBe('never')
  })

  test('looksLikeKey: Claude, OpenAI project, OpenRouter and long sk- keys; near-misses go through', () => {
    for (const s of ['sk-ant-api03-AbCdEf123456789_xyz', 'my key is sk-proj-AbCdEf0123456789', 'sk-or-v1-0123456789abcdef0123', 'use sk-ABCDEFGHIJKLMNOPQRSTUV now', '(sk-ant-e2e-test-key)']) expect(looksLikeKey(s), s).toBe(true)
    for (const s of ['task-1234 for Mara', 'desk-ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'risk-ant-abcdefghijklmnop', 'sk-ant-', 'keys start with sk-proj-…', 'sk-short', '', null]) expect(looksLikeKey(s as string), String(s)).toBe(false)
  })

  test('scrubSecrets: key shapes and every given secret', () => {
    expect(scrubSecrets('401 invalid key sk-ant-api03-AbCdEf123456789 for token tessera-7Hq0', ['tessera-7Hq0'])).toBe('401 invalid key •••• for token ••••')
    expect(scrubSecrets('nothing here', ['abc'])).toBe('nothing here')
  })
})

test.describe('the OpenRouter catalogue (src/shared/ai/catalog.ts) over a trimmed public snapshot', () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
  const rows = fx.data.map((r) => readCatalogRow(r, '2026-10-12')!)
  const by = (id: string) => rows.find((r) => r.id === id)!
  const NOW = Date.parse('2026-10-12T09:00:00Z')

  test('the fixture: ≤ 40 rows, under 60 KB, every row reads', () => {
    expect(fx.data.length).toBeLessThanOrEqual(40)
    expect(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url))).length).toBeLessThan(60 * 1024)
    expect(rows.every(Boolean)).toBe(true)
  })

  test('the Jev Router is accepted (priced per request: no price, never $0); other routers refused as routers, not for their price', () => {
    const jev = by(JEV_ROUTER)
    expect(jev).toMatchObject({ label: 'Jev Router', short: 'JEV ROUTER', router: true, pricing: 'dynamic', price: null, refused: null })
    expect(by('nvidia/switchyard')).toMatchObject({ router: true, pricing: 'dynamic', price: null, refused: 'router' })
    expect(by('openrouter/auto').refused).toBe('router')
    expect(by('openrouter/fusion').refused).toBe('router')
    expect(by('~anthropic/claude-sonnet-latest').refused).toBe('alias')
    expect(by('anthropic/claude-haiku-5.5:batch').refused).toBe('batch')
    expect(by('deepseek/deepseek-v4-flash:online').refused).toBe('online')
    for (const id of ['perplexity/sonar', 'perplexity/sonar-deep-research', 'relace/relace-search']) expect(by(id).refused, id).toBe('web')
    expect(by('dots-studio/dots-3-note-preview:free').refused).toBeNull()
    expect(rows.filter((r) => !r.refused).length).toBeGreaterThan(15)
  })

  test('labels: the name without its maker, short forms upper case ≤ 16', () => {
    expect(by('anthropic/claude-sonnet-5.5')).toMatchObject({ label: 'Claude Sonnet 5.5', short: 'SONNET 5.5' })
    expect(by('openai/gpt-6.1-sol')).toMatchObject({ label: 'GPT-6.1 Sol', short: 'GPT-6.1 SOL' })
    expect(rows.every((r) => r.short.length <= 16 && r.label.length <= 60 && r.description.length <= 600)).toBe(true)
  })

  test('prices per million from per-token strings; long-context, weekday and hour overrides (HHMM → hours, midnight wraps)', () => {
    expect(by('anthropic/claude-haiku-5.5').price).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2, webSearch: 0.01, overrides: [{ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1, minPrompt: 100000 }], source: 'catalogue', at: '2026-10-12' })
    const ds = by('deepseek/deepseek-v4-pro-0813').price!
    expect(ds.overrides![0]).toEqual({ input: 0.66, output: 1.98, cacheRead: 0.022, utcDays: ['sat', 'sun'] })
    expect(ds.overrides!.slice(1).map((o) => [o.utcStart, o.utcEnd])).toEqual([[0, 1], [1, 4], [4, 6], [6, 10], [10, 24]])
    // a Tuesday 02:00 UTC is in the dear window, Saturday is not
    const u = { input: 1_000_000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0 }
    close(costOf(u, ds, new Date('2026-10-13T02:00:00Z')).usd, 1.32)
    close(costOf(u, ds, new Date('2026-10-17T02:00:00Z')).usd, 0.66)
    expect(by('tencent/hy4-preview').price!.overrides!.map((o) => [o.utcStart, o.utcEnd])).toEqual([[0, 16], [16, 24]])
    // a missing cache column reads as the input price (conservative)
    expect(by('openai/gpt-6-astra').price!.cacheWrite).toBeGreaterThan(0)
  })

  test('caps from the row (D-S2-18): structured outputs, tools, pictures, native PDFs, effort, mandatory reasoning, web, output cap', () => {
    expect(capsOfRow(by('stepfun/step-5-preview'))).toMatchObject({ structured: true, tools: true, vision: { maxEdge: 1568, maxBytes: 5 * 1024 * 1024 }, pdf: false, effort: ['low', 'medium', 'high'], reasoning: { mandatory: true }, mcp: false, refusalFallback: false, maxOutput: 64000 })
    expect(capsOfRow(by('anthropic/claude-sonnet-5.5'))).toMatchObject({ pdf: { maxBytes: 23 * 1024 * 1024, maxPages: 100 }, cache: 'passthrough' })
    expect(capsOfRow(by('openai/gpt-6-luna')).cache).toBe('auto')
    expect(capsOfRow(by('inclusionai/ling-3.1-flash')).structured).toBe(false)
    expect(capsOfRow(by('perplexity/sonar')).web).toBe('always')
    expect(hintsOfRow(by('qwen/qwen3.8-flash')).reasoning).toEqual({ mandatory: false, efforts: [], supportsMax: true })
    expect(by('bytedance-seed/seed-2.0-code').expires).toBe('2026-11-11')
  })

  test('the compact form the device keeps reads back to the same rows', () => {
    const t = trimCatalog(fx, NOW)
    expect(t.v).toBe(1)
    expect(t.params.length).toBeLessThan(40)
    expect(expandCatalog(JSON.parse(JSON.stringify(t)))).toEqual(fx.data.map((r) => readCatalogRow(r, '2026-10-12')))
    expect(expandCatalog({ v: 2, rows: [] })).toEqual([])
  })

  test('routerLists: the pool, every other maker wildcarded, other slugs of pool makers, refused patterns, web models, *:free while no collection', () => {
    const pool = ['openai/gpt-6-luna', 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3']
    const l = routerLists(pool, rows, { noCollect: true })!
    expect(l.pool).toEqual(pool)
    expect(l.exclude).toContain('anthropic/*')
    expect(l.exclude).toContain('typesafe/*')
    expect(l.exclude).not.toContain('openai/*')
    expect(l.exclude).toEqual(expect.arrayContaining(['openai/gpt-6.1-sol', 'openai/gpt-6-astra', 'deepseek/deepseek-v4-pro-0813', 'deepseek/deepseek-v4-flash:online']))
    expect(l.exclude).toEqual(expect.arrayContaining(['openrouter/*', '*:online', '*:batch', 'perplexity/sonar*', '*-search', '*-search:*', '*deep-research*', 'perplexity/sonar', 'relace/relace-search', '*:free']))
    for (const p of pool) expect(l.exclude, p).not.toContain(p)
    expect(new Set(l.exclude).size).toBe(l.exclude.length)
    // collection allowed: no *:free, a :free pool model stays; no collection: it leaves the pool
    const free = routerLists([...pool, 'dots-studio/dots-3-note-preview:free'], rows, { noCollect: false })!
    expect(free.pool).toContain('dots-studio/dots-3-note-preview:free')
    expect(free.exclude).not.toContain('*:free')
    expect(routerLists([...pool, 'dots-studio/dots-3-note-preview:free'], rows, { noCollect: true })!.pool).not.toContain('dots-studio/dots-3-note-preview:free')
    // the router is never its own pool member; nothing left / over the limits → null
    expect(routerLists([JEV_ROUTER], rows, { noCollect: true })).toBeNull()
    expect(routerLists(Array.from({ length: 1100 }, (_, i) => `vendor-a/m-${i}`), rows, { noCollect: true })).toBeNull()
  })

  test('boundOf: the most expensive pool row per column, tiers included; a pool row priced per request counts at the stated bound', () => {
    const b = boundOf([by('openai/gpt-6-luna'), by('anthropic/claude-haiku-5.5'), by('deepseek/deepseek-v4-flash')])
    expect(b).toMatchObject({ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1, source: 'bound' })
    expect(boundOf([by('openai/gpt-6-luna'), { price: null }])).toMatchObject({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output })
    // what a bound prices is an estimate, never a catalogue price and never $0
    const c = costOf({ input: 1_000_000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0 }, b)
    expect(c.source).toBe('estimate')
    close(c.usd, 0.5)
    expect(sanitizePriceRow(b)).toBeNull()
  })

  test('suggestRoles: from catalogue data only — the cheapest, the median and the 90th percentile; allow narrows; leaving models left out', () => {
    const r = suggestRoles(rows, undefined, NOW)
    expect(r.fast && r.standard && r.deep).toBeTruthy()
    const blended = (id: string) => blendedPerM(by(id).price)!
    expect(blended(r.fast!)).toBeLessThanOrEqual(blended(r.standard!))
    expect(blended(r.standard!)).toBeLessThanOrEqual(blended(r.deep!))
    for (const id of [r.fast, r.standard, r.deep]) expect(by(id!).refused).toBeNull()
    const again = suggestRoles(rows, (row) => row.id !== r.fast, NOW)
    expect(again.fast).not.toBe(r.fast)
    expect(Object.values(suggestRoles(rows, undefined, NOW))).not.toContain('poolside/laguna-s-2.1')
    expect(suggestRoles([], undefined, NOW)).toEqual({ fast: null, standard: null, deep: null })
  })
})

test('owner decisions live in one place (src/shared/ai/owner.ts); the Jev constants in jev.ts', () => {
  expect(OWNER).toEqual({ memberClassesOwnedByMember: true, agentTriggers: false, directWritesOnConfirmedModelOnly: true, newProviderStartsEmpty: true, jevRouter: true })
  expect(JEV_ROUTER).toBe('typesafe/jev-router')
  expect(isJevRouter(JEV_ROUTER)).toBe(true)
  expect(isJevRouter(`${JEV_ROUTER}-20260917`)).toBe(false)
  expect(ROUTER_PINS).toBe('pool')
  expect(JEV_TIERS).toEqual(['low', 'medium', 'high'])
})

test('the neutral wire types: a decide request is a wire request; send() of it is typed to a decide turn', () => {
  // type level: these lines compile only while the contracts hold (adapter.ts TurnOf, types.ts WireRequest)
  const decide: DecideRequest = { kind: 'decide', route: { p: 'openrouter', m: 'vendor-a/decider' }, state: { text: 'Quarterly plan' }, questions: { done: { type: 'noul', instructions: 'Is the plan finished?' } } }
  const wire: WireRequest = decide
  const chat: ChatRequest = { kind: 'chat', route: { p: 'openrouter', m: 'vendor-a/model-b' }, system: 'S', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }], output: { kind: 'text' }, maxTokens: 100, cache: 'none' }
  const turnOfDecide: TurnOf<DecideRequest> = { kind: 'decide', answers: { done: { type: 'noul', p: 0.9 } }, served: { model: 'vendor-a/decider' }, usage: null }
  const turnOfChat: TurnOf<ChatRequest> = { kind: 'chat', parts: [], stop: 'end', usage: null, served: null, streamedChars: 0 }
  expect([wire.kind, chat.kind, turnOfDecide.kind, turnOfChat.kind]).toEqual(['decide', 'chat', 'decide', 'chat'])
})

test('src/shared/ai imports nothing outside itself (type imports with .ts, no enums)', () => {
  const dir = fileURLToPath(new URL('../../src/shared/ai/', import.meta.url))
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(`${dir}${f}`, 'utf8')
    for (const m of src.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+'([^']+)'/gm)) {
      expect(m[1], `${f}: ${m[0]}`).toMatch(/^\.\.?\/[\w/.-]+\.ts$/)
      // resolved from the file's own folder (wire/ … included), it stays inside src/shared/ai
      const to = fileURLToPath(new URL(m[1], new URL(f.replace(/\\/g, '/'), new URL('../../src/shared/ai/', import.meta.url))))
      expect(to.startsWith(dir), `${f} leaves src/shared/ai (${m[1]})`).toBe(true)
    }
    expect(/\benum\s+\w+/.test(src), `${f} declares an enum`).toBe(false)
    // comments and string literals left out ('document' is a part type, not the DOM)
    const code = src
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    expect(/\b(window|document|localStorage|indexedDB|sessionStorage|navigator)\b|\bprocess\.|\brequire\(/.test(code), `${f} reaches a runtime`).toBe(false)
  }
})

test.describe('sources → data classes (features/ai/core/sources.ts)', () => {
  const page = (id: string, o: Partial<Page> = {}) => ({ id, title: id, parentId: null, content: { type: 'doc', content: [] }, ...o }) as unknown as Page
  const db = (id: string, system?: Database['system']) => ({ id, system, properties: [], views: [] }) as unknown as Database
  const synced = (sourcePageId: string) => ({ type: 'doc', content: [{ type: 'syncedBlock', attrs: { syncId: 's1', sourcePageId }, content: [{ type: 'paragraph' }] }] })
  const world: SourceWorld = {
    pages: Object.fromEntries(
      [
        page('launch'),
        page('vault', { private: true }),
        page('vault-notes', { parentId: 'vault' }),
        page('mails'),
        page('mail-1', { parentId: 'mails', databaseId: 'mails' }),
        page('contacts'),
        page('mara', { parentId: 'contacts', databaseId: 'contacts' }),
        page('memory'),
        page('mem-1', { parentId: 'memory', databaseId: 'memory' }),
        page('tessera'),
        page('row-1', { parentId: 'tessera', databaseId: 'tessera' }),
        page('digest', { content: synced('vault-notes') as Page['content'] }),
        page('loop-a', { parentId: 'loop-b' }),
        page('loop-b', { parentId: 'loop-a' }),
      ].map((p) => [p.id, p]),
    ),
    databases: { mails: db('mails'), contacts: db('contacts', 'mail-contacts'), memory: db('memory', 'memory'), tessera: db('tessera') },
    mailDb: 'mails',
  }
  const of = (id: string) => [...classOfPage(id, world)].sort()

  test('plain page, private root and below it, Mails row, mail directory, memory row, ordinary row', () => {
    expect(of('launch')).toEqual(['page'])
    expect(of('vault')).toEqual(['page', 'private'])
    expect(of('vault-notes')).toEqual(['page', 'private'])
    expect(of('mail-1')).toEqual(['mail', 'rows'])
    expect(of('mara')).toEqual(['mail', 'rows'])
    expect(of('mem-1')).toEqual(['memory', 'rows'])
    expect(of('row-1')).toEqual(['rows'])
    expect(of('gone')).toEqual([])
  })

  test('a synced-block copy counts as its source page; a broken parent chain ends', () => {
    expect(of('digest')).toEqual(['page', 'private'])
    expect(of('loop-a')).toEqual(['page'])
  })

  test('classesOf: pages, rows, databases, an upload, the workspace', () => {
    const c = (...s: Parameters<typeof classesOf>[0]) => [...classesOf(s, world)].sort()
    expect(c({ page: 'launch' }, { row: 'row-1' })).toEqual(['page', 'rows'])
    expect(c({ db: 'memory' })).toEqual(['memory', 'rows', 'structure'])
    expect(c({ db: 'mails' })).toEqual(['mail', 'rows', 'structure'])
    expect(c({ file: 'upload' })).toEqual(['files'])
    expect(c({ all: true })).toEqual(['workspace'])
    expect(c()).toEqual([])
    expect(isSources([{ page: 'launch' }, { all: true }, { file: 'upload' }])).toBe(true)
    for (const v of [null, 'launch', [{ page: 3 }], [{ file: 'disk' }], [{ all: 'yes' }], [null]]) expect(isSources(v), JSON.stringify(v)).toBe(false)
  })
})

test('every Claude request in the app is metered: the files that call the API are known, each call has its meter', () => {
  const root = fileURLToPath(new URL('../../src/app/', import.meta.url))
  const calls = /\.messages\.(?:stream|create)\(|\.toolRunner\(/g
  const found: Record<string, number> = {}
  for (const f of readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(f)) continue
    const src = readFileSync(`${root}${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const n = src.match(calls)?.length ?? 0
    if (n) found[f.replace(/\\/g, '/')] = n
    if (f.replace(/\\/g, '/') !== 'features/ai/providers/anthropic.ts') expect(/import\(\s*'@anthropic-ai\/sdk'/.test(src), `${f} loads the SDK itself`).toBe(false)
  }
  // The engines (§ 7.1): the Claude paths behind runAI / streamCompletion / completeStructured (providers/anthropic.ts),
  // the agent loop, files, images, MCP server tests.
  expect(Object.keys(found).sort()).toEqual(['features/ai/agent/run.ts', 'features/ai/file/request.ts', 'features/ai/image/request.ts', 'features/ai/mcp-servers/generate.ts', 'features/ai/providers/anthropic.ts'])
  const facades = readFileSync(`${root}features/ai/client.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  for (const f of Object.keys(found)) {
    const src = readFileSync(`${root}${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(/from '\.\.?\/(?:core\/)?meter'|from '\.\.\/core\/meter'|from '\.\/core\/meter'/.test(src), `${f} imports the meter`).toBe(true)
    // the Claude paths get their meter from the facades that call them (client.ts opens one per call)
    expect(/\bmeterCall\(/.test(f.endsWith('providers/anthropic.ts') ? facades : src), `${f} opens a meter per request`).toBe(true)
    // Every response is closed by finalOf() (streams) or metered() (one-shots); the agent loop meters each round.
    const closes = f.endsWith('agent/run.ts') ? (src.match(/\bclaudeResponse\(/g)?.length ?? 0) : (src.match(/(?<!function )\b(?:finalOf|metered)\(/g)?.length ?? 0)
    expect(closes, `${f}: ${found[f]} call(s), ${closes} meter close(s)`).toBeGreaterThanOrEqual(f.endsWith('agent/run.ts') ? 1 : found[f])
  }
})
