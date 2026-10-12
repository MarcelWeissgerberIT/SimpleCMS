/**
 * Multi-provider AI — the shared contracts (src/shared/ai), pure: run in Node by the Playwright runner (no browser).
 * Model-id validators and refused OpenRouter slugs, the one cost function (cache never priced twice, long-context and
 * time-of-day overrides, reasoning, reported cost, unknown price = none), usage normalisers, estimates, the stored
 * shapes' sanitizers (old ⇄ new, 'demo' and unknown providers refused), the policy generation, keys in text. The
 * shared folder imports nothing outside itself. Test data is fictional.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { AI_ERROR_CODES, fallbackOf, isAIErrorCode } from '../../src/shared/ai/errors'
import { MODELS, capsOf, labelOf, modelIdProblem, refusedSlug, vendorOf } from '../../src/shared/ai/models'
import { PRICES, PRICES_DATE, blendedPerM, costOf, priceRow, tierLabel } from '../../src/shared/ai/prices'
import { estimateUsage, normalise, addUsage } from '../../src/shared/ai/usage'
import { legacyRule, routeKey, sanitizeRoute, sanitizeRule } from '../../src/shared/ai/route'
import { AI_POLICY_GEN, policyKnown, requiredGen, sanitizeDeviceAI, sanitizeWorkspaceAI, storedGen } from '../../src/shared/ai/policy'
import { looksLikeKey, scrubSecrets } from '../../src/shared/ai/keys'
import type { PriceRow, Usage } from '../../src/shared/ai/types'

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
    expect(refusedSlug('vendor-a/model-b', { promptPrice: -1 })).toBe('router')
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

  test('estimates: what is known, else characters ÷ 4', () => {
    expect(estimateUsage(4000, 401)).toEqual(U({ input: 1000, output: 101 }))
    expect(estimateUsage(4000, 400, { input: 1500, cacheRead: 200 })).toEqual(U({ input: 1500, cacheRead: 200, output: 100 }))
    expect(addUsage(U({ input: 1, output: 2 }), U({ input: 3, reportedUsd: 0.5 }))).toEqual(U({ input: 4, output: 2, reportedUsd: 0.5 }))
  })
})

test.describe('stored shapes', () => {
  test('routes and rules: stored providers only, 1–3 pins, repeats dropped', () => {
    expect(sanitizeRoute({ p: 'openrouter', m: 'x/y', effort: 'high' })).toEqual({ p: 'openrouter', m: 'x/y', effort: 'high' })
    expect(sanitizeRoute({ p: 'openrouter', m: 'x/y', effort: 'max' })).toEqual({ p: 'openrouter', m: 'x/y' })
    expect(sanitizeRoute({ p: 'demo', m: 'canned' })).toBeNull()
    expect(sanitizeRoute({ p: 'anthropic', m: 'gpt-6-luna' })).toBeNull()
    expect(sanitizeRoute({ p: 'openrouter', m: 'openrouter/auto' })).toBeNull()
    const pins = [{ p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'demo', m: 'x' }, { p: 'openai', m: 'gpt-6-luna' }, { p: 'openrouter', m: 'x/y' }, { p: 'openrouter', m: 'x/z' }]
    expect(sanitizeRule(pins)).toEqual([{ p: 'anthropic', m: 'claude-opus-5-5' }, { p: 'openai', m: 'gpt-6-luna' }, { p: 'openrouter', m: 'x/y' }])
    expect(sanitizeRule([])).toBeNull()
    expect(sanitizeRule('x')).toBeNull()
    expect(legacyRule('claude-sonnet-5-5', true)).toEqual([{ p: 'anthropic', m: 'claude-sonnet-5-5' }])
    // an unknown setting goes to the default model, as before
    expect(legacyRule('claude-haiku-5-5', true)).toEqual([{ p: 'anthropic', m: 'claude-opus-5-5' }])
    expect(legacyRule('claude-opus-5-5', false)).toEqual([])
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

  test('policy generation: this build is 1; a stored gen above it refuses; slice 1 never needs more than 1', () => {
    expect(AI_POLICY_GEN).toBe(1)
    expect(requiredGen({ routes: { '*': [{ p: 'anthropic', m: 'claude-opus-5-5' }] } }, null)).toBe(1)
    expect(storedGen(undefined, undefined)).toBe(1)
    expect(storedGen({ gen: 2 }, { gen: 1 })).toBe(2)
    expect(storedGen({}, { gen: 3 })).toBe(3)
    expect(policyKnown({ gen: 1 }, undefined)).toBe(true)
    expect(policyKnown({ gen: 2 }, undefined)).toBe(false)
    expect(policyKnown(undefined, { gen: 2 })).toBe(false)
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

test('src/shared/ai imports nothing outside itself (type imports with .ts, no enums)', () => {
  const dir = fileURLToPath(new URL('../../src/shared/ai/', import.meta.url))
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(`${dir}${f}`, 'utf8')
    for (const m of src.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+'([^']+)'/gm)) {
      expect(m[1], `${f}: ${m[0]}`).toMatch(/^\.\.?\/[\w/.-]+\.ts$/)
      expect(m[1].startsWith('../') && !m[1].startsWith('../ai/'), `${f} leaves src/shared/ai`).toBe(false)
    }
    expect(/\benum\s+\w+/.test(src), `${f} declares an enum`).toBe(false)
    expect(/\b(window|document|localStorage|indexedDB)\b|\bprocess\.|\brequire\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${f} reaches a runtime`).toBe(false)
  }
})
