/**
 * The OpenRouter wire (multi-provider S2), pure, in Node — never a real host (helpers/noNet.ts first): the SSE parser
 * at every split point, the Chat Completions body for models and the Jev Router (golden snapshots), the body guard,
 * the stream parser and the error table over doc-derived fixtures (tests/fixtures/ai/openrouter/doc — each names its
 * ordocs source; none checked against a real response yet: "verify with a real key").
 */
import { NO_NET, netGuarded } from './helpers/noNet'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { createSSEParser, type SSEEvent } from '../../src/shared/ai/sse'
import { assertSafeBody, build, clampEffort, classify, createChatParser, headroom, WireFailure, type BuildOpts } from '../../src/shared/ai/wire/openrouterChat'
import { JEV_ROUTER } from '../../src/shared/ai/jev'
import type { AIEvent, Caps, ChatRequest, ModelInfo, PriceRow, Turn, UpstreamRule, WireHints, WireRequest } from '../../src/shared/ai/types'

const fixture = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/ai/openrouter/doc/${name}.json`, import.meta.url)), 'utf8')) as T

/** Every event (and comment) of a text fed in the given pieces. */
function parse(pieces: string[]): { events: SSEEvent[]; comments: string[] } {
  const events: SSEEvent[] = []
  const comments: string[] = []
  const p = createSSEParser(
    (e) => events.push(e),
    (c) => comments.push(c),
  )
  for (const x of pieces) p.feed(x)
  p.end()
  return { events, comments }
}

test.describe('sse', () => {
  test('the guard is on: a Node spec reaching the network fails (positive control)', async () => {
    expect(netGuarded()).toBe(true)
    await expect(fetch('https://openrouter.ai/api/v1/models')).rejects.toThrow(NO_NET)
  })

  test('every split point of a stream gives the same events (comments, CRLF, multi-line data, [DONE])', () => {
    const stream = fixture<{ source: string; sse: string }>('stream-text').sse
    const whole = parse([stream])
    expect(whole.events.length).toBeGreaterThan(3)
    expect(whole.comments).toEqual(['OPENROUTER PROCESSING'])
    expect(whole.events.at(-1)!.data).toBe('[DONE]')
    for (let i = 1; i < stream.length; i++) expect(parse([stream.slice(0, i), stream.slice(i)]), `split at ${i}`).toEqual(whole)
    // one character at a time
    expect(parse([...stream])).toEqual(whole)
    // the same stream with CRLF line ends, split anywhere (a CR and its LF in different pieces too)
    const crlf = stream.replace(/\n/g, '\r\n')
    for (let i = 1; i < crlf.length; i += 7) expect(parse([crlf.slice(0, i), crlf.slice(i)]), `CRLF split at ${i}`).toEqual(whole)
  })

  test('CRLF and lone CR line ends, a CR split from its LF, a BOM, fields and comments', () => {
    const crlf = ': keep-alive\r\nevent: note\r\nid: 7\r\ndata: one\r\ndata: two\r\n\r\ndata: three\r\r'
    const want = { events: [{ event: 'note', data: 'one\ntwo', id: '7' }, { data: 'three', id: '7' }], comments: ['keep-alive'] }
    expect(parse([crlf])).toEqual(want)
    expect(parse([crlf.slice(0, crlf.indexOf('\r\n') + 1), crlf.slice(crlf.indexOf('\r\n') + 1)])).toEqual(want)
    expect(parse(['﻿data: x\n\n'])).toEqual({ events: [{ data: 'x' }], comments: [] })
    // a field without a colon, a value without its space, retry and unknown fields
    expect(parse(['data\nretry: 300\nfoo: bar\ndata:y\n\n'])).toEqual({ events: [{ data: '\ny' }], comments: [] })
    // a blank line with no data dispatches nothing
    expect(parse(['event: ping\n\n\n']).events).toEqual([])
  })

  test('a trailing event without a blank line is dispatched on end()', () => {
    expect(parse(['data: {"a":1}\n\ndata: last']).events).toEqual([{ data: '{"a":1}' }, { data: 'last' }])
    expect(parse(['data: last\n']).events).toEqual([{ data: 'last' }])
  })
})

/* ------------------------------------------------------------------ */
/* build: the body for a model and for the Jev Router (golden)           */
/* ------------------------------------------------------------------ */

const GOLDEN = fileURLToPath(new URL('../fixtures/ai/openrouter/golden/', import.meta.url))

/** Write (GOLDEN_WRITE=1, reviewed by hand) or compare a body snapshot. */
function golden(name: string, got: unknown): void {
  const file = `${GOLDEN}build-${name}.json`
  if (process.env.GOLDEN_WRITE === '1') {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
    return
  }
  expect(existsSync(file), `golden body build-${name}.json (GOLDEN_WRITE=1 writes it)`).toBe(true)
  expect(got).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

const CAPS: Caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'auto', effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 131072, maxOutput: 16384 }
const PRICE: PriceRow = { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3, source: 'catalogue', at: '2026-10-12' }
const orModel = (m: string, caps: Partial<Caps> = {}, hints?: WireHints): ModelInfo => ({ route: { p: 'openrouter', m }, label: m, short: m.toUpperCase(), vendor: m.split('/')[0]!, caps: { ...CAPS, ...caps }, price: PRICE, ...(hints ? { hints } : {}) })
const UP: UpstreamRule = { deny: [], noCollect: true, zdr: false }
const OPTS: BuildOpts = { pins: ['nordwind', 'lindenhof/turbo'], upstream: UP, referer: 'https://one.example/app/' }
const chat = (o: Partial<ChatRequest> = {}): ChatRequest => ({ kind: 'chat', route: { p: 'openrouter', m: 'vendor-a/model-b' }, system: 'You are the writing assistant.', messages: [{ role: 'user', parts: [{ type: 'text', text: '<text>\nThe launch is friday\n</text>\n\nTask: Fix spelling.' }] }], output: { kind: 'text' }, maxTokens: 8000, cache: 'none', ...o })
const JSON_OUT: ChatRequest['output'] = { kind: 'json', name: 'answer', schema: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } } }, required: ['rows'], additionalProperties: false } }
const REASONS: WireHints = { params: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs', 'tools'], reasoning: { mandatory: true, efforts: ['high', 'medium', 'low', 'minimal'], supportsMax: false } }
const POOL = ['vendor-a/model-b', 'vendor-c/thinker-2', 'vendor-d/swift-1']
const EXCLUDE = ['vendor-e/*', 'vendor-a/model-b-mini', 'openrouter/*', '*:online', '*:batch', 'perplexity/sonar*', '*-search', '*-search:*', '*deep-research*', '*:free']
const routerModel = (caps: Partial<Caps> = {}) => orModel(JEV_ROUTER, { maxOutput: 16384, ...caps })
const ROUTER_OPTS: BuildOpts = { ...OPTS, pins: ['nordwind', 'lindenhof/turbo', 'typesafe'], router: { pool: POOL, exclude: EXCLUDE } }
const routed = (effort?: ChatRequest['route']['effort'], o: Partial<ChatRequest> = {}) => chat({ route: { p: 'openrouter', m: JEV_ROUTER, ...(effort ? { effort } : {}) }, ...o })
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PDF = 'JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4KJSVFT0YK'

test.describe('build: models', () => {
  test('text: pins, fallbacks off, no collection, parameters required, three plugins off, attribution headers, never the key', () => {
    const b = build(chat(), orModel('vendor-a/model-b'), OPTS)
    expect(b.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(b.headers).toEqual({ 'Content-Type': 'application/json', 'HTTP-Referer': 'https://one.example/app/', 'X-OpenRouter-Title': 'One', 'X-OpenRouter-App-Visibility': 'hidden' })
    expect(b.body.provider).toEqual({ only: ['nordwind', 'lindenhof/turbo'], allow_fallbacks: false, data_collection: 'deny', require_parameters: true })
    expect(b.body.plugins).toEqual([{ id: 'web', enabled: false }, { id: 'context-compression', enabled: false }, { id: 'response-healing', enabled: false }])
    expect(b.body.max_tokens).toBe(8000)
    for (const k of ['reasoning', 'response_format', 'session_id', 'user', 'metadata', 'models', 'transforms']) expect(k in b.body, k).toBe(false)
    golden('text', b)
  })

  test('json output: response_format with a strict schema', () => {
    const b = build(chat({ output: JSON_OUT, maxTokens: 4096 }), orModel('vendor-a/model-b'), OPTS)
    expect(b.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', schema: (JSON_OUT as { schema: unknown }).schema, strict: true } })
    golden('json', b.body)
  })

  test('a picture as a data URL; a PDF as a file read natively (file-parser native); a text document wrapped', () => {
    const img = build(chat({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'Describe the picture.' }, { type: 'image', mime: 'image/png', data: PNG }] }] }), orModel('vendor-a/model-b', { vision: { maxEdge: 1568, maxBytes: 5 << 20 } }), OPTS)
    golden('image', img.body)
    const pdf = build(chat({ messages: [{ role: 'user', parts: [{ type: 'document', title: 'Quarterly plan.pdf', pdf: { data: PDF, pages: 2 } }, { type: 'text', text: 'Summarise the document.' }] }] }), orModel('vendor-a/model-b', { pdf: { maxBytes: 23 << 20, maxPages: 100 } }), OPTS)
    expect((pdf.body.plugins as unknown[]).at(-1)).toEqual({ id: 'file-parser', pdf: { engine: 'native' } })
    golden('pdf', pdf.body)
    const doc = build(chat({ messages: [{ role: 'user', parts: [{ type: 'document', title: 'Notes "Q3" <draft>', text: 'Two risks.' }, { type: 'text', text: 'Summarise.' }] }] }), orModel('vendor-a/model-b'), OPTS)
    expect(JSON.stringify(doc.body.messages)).toContain('<document title=\\"Notes &quot;Q3&quot; &lt;draft&gt;\\">\\nTwo risks.\\n</document>')
    expect('file-parser' in Object.fromEntries((doc.body.plugins as Array<{ id: string }>).map((p) => [p.id, 1]))).toBe(false)
  })

  test('a mandatory-reasoning model: the effort it lists, the answer budget plus reasoning room', () => {
    const b = build(chat({ maxTokens: 4000 }), orModel('vendor-c/thinker-2', { reasoning: { mandatory: true }, effort: ['low', 'medium', 'high'] }, REASONS), OPTS)
    expect(b.body.reasoning).toEqual({ effort: 'low' })
    expect(b.body.max_tokens).toBe(4000 + 16000 > 16384 ? 16384 : 20000)
    golden('reasoning', b.body)
    // the person's effort, clamped to the list (a model taking only high / xhigh gets high for "low")
    const only = build(chat({ route: { p: 'openrouter', m: 'vendor-c/thinker-2', effort: 'low' } }), orModel('vendor-c/thinker-2', { reasoning: { mandatory: true } }, { ...REASONS, reasoning: { mandatory: true, efforts: ['xhigh', 'high'], supportsMax: false } }), OPTS)
    expect(only.body.reasoning).toEqual({ effort: 'high' })
    // a token budget where the model takes one and lists no efforts
    const max = build(chat({ maxTokens: 1000 }), orModel('vendor-c/thinker-2', { reasoning: { mandatory: true } }, { ...REASONS, reasoning: { mandatory: true, efforts: [], supportsMax: true } }), OPTS)
    expect(max.body.reasoning).toEqual({ max_tokens: 4000 })
    // an optional reasoner thinks only when the route asks for an effort
    const optional: WireHints = { ...REASONS, reasoning: { mandatory: false, efforts: ['high', 'medium', 'low', 'none'], supportsMax: false } }
    expect('reasoning' in build(chat(), orModel('vendor-f/flex-1', {}, optional), OPTS).body).toBe(false)
    expect(build(chat({ route: { p: 'openrouter', m: 'vendor-f/flex-1', effort: 'medium' } }), orModel('vendor-f/flex-1', {}, optional), OPTS).body.reasoning).toEqual({ effort: 'medium' })
  })

  test('K17: a small structured answer on a mandatory reasoner — the lowest effort it takes (never none), room for the answer', () => {
    const b = build(chat({ output: JSON_OUT, maxTokens: 200 }), orModel('vendor-c/thinker-2', { reasoning: { mandatory: true } }, { ...REASONS, reasoning: { mandatory: true, efforts: ['high', 'medium', 'low', 'minimal', 'none'], supportsMax: false } }), OPTS)
    expect(b.body.reasoning).toEqual({ effort: 'minimal' })
    expect(b.body.max_tokens).toBe(200 + 1024)
    golden('small-structured', b.body)
    expect(clampEffort('none', ['high', 'none'], true)).toBe('high')
    expect(clampEffort('low', null, false)).toBe('low')
    expect(headroom(200, { maxOutput: 600 })).toBe(600)
  })

  test('cache: breakpoints only for an Anthropic upstream with cache auto; never with cache none', () => {
    const parts: ChatRequest['messages'] = [{ role: 'user', parts: [{ type: 'document', title: 'Plan', text: 'Long text', cache: true }, { type: 'text', text: 'Question?' }] }]
    const none = build(chat({ messages: parts, cache: 'none', route: { p: 'openrouter', m: 'anthropic/claude-sonnet-5.5' } }), orModel('anthropic/claude-sonnet-5.5'), OPTS)
    expect(JSON.stringify(none.body)).not.toContain('cache_control')
    const auto = build(chat({ messages: parts, cache: 'auto', route: { p: 'openrouter', m: 'anthropic/claude-sonnet-5.5' } }), orModel('anthropic/claude-sonnet-5.5', { cache: 'passthrough' }), OPTS)
    expect(JSON.stringify(auto.body).match(/cache_control/g)?.length).toBe(1)
    golden('anthropic-cache', auto.body)
    expect(JSON.stringify(build(chat({ messages: parts, cache: 'auto' }), orModel('vendor-a/model-b'), OPTS).body)).not.toContain('cache_control')
  })

  test('the upstream rule (collection allowed, zero data retention) and a price ceiling for a model priced per request', () => {
    const b = build(chat(), orModel('vendor-g/variable-1'), { ...OPTS, upstream: { deny: ['Lindenhof'], noCollect: false, zdr: true }, maxPrice: { prompt: 30, completion: 180 } })
    expect(b.body.provider).toEqual({ only: ['nordwind', 'lindenhof/turbo'], allow_fallbacks: false, data_collection: 'allow', require_parameters: true, zdr: true, max_price: { prompt: 30, completion: 180 } })
    golden('dynamic-price', b.body)
  })

  test('D-S2-31: a session id only when the request names one (slice 2 names none)', () => {
    expect('session_id' in build(chat(), orModel('vendor-a/model-b'), OPTS).body).toBe(false)
    expect(build(chat({ session: 'c0ffee12' }), orModel('vendor-a/model-b'), OPTS).body.session_id).toBe('c0ffee12')
  })

  test('a decide request has its own wire: build refuses it', () => {
    const decide: WireRequest = { kind: 'decide', route: { p: 'openrouter', m: 'vendor-a/decider' }, state: {}, questions: {} }
    expect(() => build(decide, orModel('vendor-a/decider'), OPTS)).toThrow(/only chat/)
  })
})

test.describe('build: the Jev Router', () => {
  test('text, tier medium: model = the router, its plugin first with the pool and the exclusions, pins = pool ∪ router, no reasoning, room always', () => {
    const b = build(routed('medium'), routerModel(), ROUTER_OPTS)
    expect(b.body.model).toBe(JEV_ROUTER)
    expect((b.body.plugins as unknown[])[0]).toEqual({ id: 'jev-router', cost_tier: 'medium', models: POOL, excluded_models: EXCLUDE })
    expect(b.body.provider).toEqual({ only: ['nordwind', 'lindenhof/turbo', 'typesafe'], allow_fallbacks: false, data_collection: 'deny', require_parameters: true })
    expect('reasoning' in b.body).toBe(false)
    expect(b.body.max_tokens).toBe(16384)
    golden('router-text', b.body)
  })

  test('each tier, and no tier (Jev\'s default policy: no cost_tier)', () => {
    for (const t of ['low', 'high'] as const) expect((build(routed(t), routerModel(), ROUTER_OPTS).body.plugins as Array<Record<string, unknown>>)[0]!.cost_tier).toBe(t)
    const none = build(routed(), routerModel(), ROUTER_OPTS)
    expect('cost_tier' in (none.body.plugins as Array<Record<string, unknown>>)[0]!).toBe(false)
    golden('router-no-tier', none.body)
  })

  test('json and a PDF (an all-native pool): response_format and file-parser beside the router plugin; never reasoning', () => {
    const json = build(routed('low', { output: JSON_OUT, maxTokens: 300 }), routerModel(), ROUTER_OPTS)
    expect(json.body.max_tokens).toBe(300 + 1200)
    expect('reasoning' in json.body).toBe(false)
    golden('router-json', json.body)
    const pdf = build(routed('high', { messages: [{ role: 'user', parts: [{ type: 'document', title: 'Plan.pdf', pdf: { data: PDF, pages: 1 } }, { type: 'text', text: 'Summarise.' }] }] }), routerModel({ pdf: { maxBytes: 23 << 20, maxPages: 100 } }), ROUTER_OPTS)
    expect((pdf.body.plugins as Array<{ id: string }>).map((p) => p.id)).toEqual(['jev-router', 'web', 'context-compression', 'response-healing', 'file-parser'])
    golden('router-pdf', pdf.body)
  })

  test('a route effort on the router is its cost tier — never sent as reasoning, never cached', () => {
    const b = build(routed('high', { cache: 'auto', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi', cache: true }] }] }), routerModel(), ROUTER_OPTS)
    expect(JSON.stringify(b.body)).not.toContain('reasoning')
    expect(JSON.stringify(b.body)).not.toContain('cache_control')
  })
})

test.describe('assertSafeBody', () => {
  const good = () => structuredClone(build(chat(), orModel('vendor-a/model-b'), OPTS).body)
  const goodRouter = () => structuredClone(build(routed('medium'), routerModel(), ROUTER_OPTS).body)
  const breaks = (body: Record<string, unknown>, re: RegExp) => expect(() => assertSafeBody(body)).toThrow(re)

  test('the bodies build makes pass', () => {
    expect(() => assertSafeBody(good())).not.toThrow()
    expect(() => assertSafeBody(goodRouter())).not.toThrow()
  })

  test('every forbidden field is refused', () => {
    for (const k of ['models', 'fallbacks', 'mcp_servers', 'web_search_options', 'transforms', 'route', 'user', 'trace', 'metadata']) breaks({ ...good(), [k]: k === 'models' ? ['vendor-a/x'] : 'x' }, new RegExp(`"${k}"`))
    breaks({ ...good(), tools: [{ type: 'openrouter:web_search' }] }, /function tools/)
  })

  test('pins and the provider rules', () => {
    const b = good()
    breaks({ ...b, provider: { ...(b.provider as object), allow_fallbacks: true } }, /allow_fallbacks/)
    breaks({ ...b, provider: { ...(b.provider as object), only: [] } }, /provider.only/)
    breaks({ ...b, provider: { allow_fallbacks: false, data_collection: 'deny', require_parameters: true } }, /provider.only/)
    breaks({ ...b, provider: { ...(b.provider as object), require_parameters: false } }, /require_parameters/)
    breaks({ ...b, provider: undefined }, /provider pins/)
  })

  test('plugins: the switch-offs stay off, PDFs natively, nothing else', () => {
    const b = good()
    breaks({ ...b, plugins: [] }, /switched off/)
    breaks({ ...b, plugins: [{ id: 'web' }, { id: 'context-compression', enabled: false }, { id: 'response-healing', enabled: false }] }, /"web" must be switched off/)
    breaks({ ...b, plugins: [...(b.plugins as unknown[]), { id: 'moderation' }] }, /"moderation" is never sent/)
    breaks({ ...b, plugins: [...(b.plugins as unknown[]), { id: 'file-parser', pdf: { engine: 'mistral-ocr' } }] }, /natively/)
  })

  test('router rules: plugin only with the router, both lists, no reasoning, one router, no other router or alias', () => {
    const r = goodRouter()
    const plug = (r.plugins as Array<Record<string, unknown>>)[0]!
    breaks({ ...good(), plugins: [plug, ...(good().plugins as unknown[])] }, /only with the Jev Router/)
    breaks({ ...r, plugins: (r.plugins as unknown[]).slice(1) }, /needs its plugin/)
    breaks({ ...r, plugins: [{ ...plug, models: [] }, ...(r.plugins as unknown[]).slice(1)] }, /needs its pool/)
    breaks({ ...r, plugins: [{ ...plug, excluded_models: [] }, ...(r.plugins as unknown[]).slice(1)] }, /needs its exclusions/)
    breaks({ ...r, reasoning: { max_tokens: 2000 } }, /no reasoning settings/)
    breaks({ ...r, reasoning: { effort: 'high' } }, /no reasoning settings/)
    breaks({ ...r, plugins: [plug, plug, ...(r.plugins as unknown[]).slice(1)] }, /one router plugin/)
    breaks({ ...r, plugins: [{ ...plug, allowed_models: ['x/y'] }, ...(r.plugins as unknown[]).slice(1)] }, /allowed_models/)
    breaks({ ...good(), model: 'openrouter/auto' }, /router or an alias/)
    breaks({ ...good(), model: '~vendor-a/model-latest' }, /router or an alias/)
  })
})

/* ------------------------------------------------------------------ */
/* The stream and the error table (doc-derived fixtures)                */
/* ------------------------------------------------------------------ */

interface StreamFixture {
  source: string
  verified: boolean
  sse: string
}

/** Feed a fixture's SSE through both parsers; the events and the turn (or the failure). */
function run(name: string, o: { router?: boolean } = {}): { events: AIEvent[]; turn: Turn | null; failure: WireFailure | null } {
  const fx = fixture<StreamFixture>(name)
  expect(fx.source, `${name} names its ordocs source`).toBeTruthy()
  expect(fx.verified).toBe(false)
  const events: AIEvent[] = []
  const chatParser = createChatParser((e) => events.push(e), o)
  let failure: WireFailure | null = null
  const sse = createSSEParser((e) => {
    if (failure) return
    try {
      chatParser.feed(e.data)
    } catch (err) {
      if (err instanceof WireFailure) failure = err
      else throw err
    }
  })
  sse.feed(fx.sse)
  sse.end()
  let turn: Turn | null = null
  if (!failure)
    try {
      turn = chatParser.end()
    } catch (err) {
      if (err instanceof WireFailure) failure = err
      else throw err
    }
  return { events, turn, failure }
}

const textOf = (t: Turn | null) => (t?.parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('')

test.describe('the stream', () => {
  test('text: deltas in order, the content signal first, the usage chunk is accounting (not a second end), served model and upstream', () => {
    const { events, turn } = run('stream-text')
    expect(events[0]).toEqual({ t: 'served', model: 'vendor-a/model-b', upstream: 'Nordwind' })
    expect(events[1]).toEqual({ t: 'content' })
    expect(events.filter((e) => e.t === 'text').map((e) => (e as { delta: string }).delta)).toEqual(['The launch ', 'plan is on track', ' for Friday.'])
    expect(events.filter((e) => e.t === 'usage')).toHaveLength(1)
    expect(turn).toEqual({ kind: 'chat', parts: [{ type: 'text', text: 'The launch plan is on track for Friday.' }], stop: 'end', usage: { input: 812, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 11, reasoning: 0, reportedUsd: 0.000271 }, served: 'vendor-a/model-b', upstream: 'Nordwind', streamedChars: 39 })
  })

  test('json text, reasoning notes (content signal before them), cached and written tokens out of the input', () => {
    expect(JSON.parse(textOf(run('stream-json').turn))).toEqual({ rows: [{ Name: 'Tessera', Status: 'Open' }] })
    const r = run('stream-reasoning')
    expect(r.events.findIndex((e) => e.t === 'content')).toBeLessThan(r.events.findIndex((e) => e.t === 'note'))
    expect(r.events.filter((e) => e.t === 'note')).toHaveLength(2)
    expect(textOf(r.turn)).toBe('Launch: Friday.')
    expect(r.turn!.usage).toMatchObject({ output: 260, reasoning: 252 })
    expect(run('stream-cache').turn!.usage).toEqual({ input: 500, cacheWrite: 1500, cacheWrite1h: 0, cacheRead: 10000, output: 9, reasoning: 0, reportedUsd: 0.002125 })
  })

  test('tool calls assembled by index (K3 / K4); a call cut by the budget is never emitted (K7)', () => {
    const t = run('stream-tools').turn!
    expect(t.stop).toBe('tool_calls')
    expect(t.parts).toEqual([
      { type: 'tool_call', id: 'call_a1', name: 'search_pages', input: { query: 'launch' } },
      { type: 'tool_call', id: 'call_b2', name: 'read_page', input: { id: 'p_42' } },
    ])
    const cut = run('stream-tool-cut')
    expect(cut.turn!.stop).toBe('max_tokens')
    expect(cut.turn!.parts).toEqual([{ type: 'text', text: 'Looking it up.' }])
    expect(cut.events.some((e) => e.t === 'tool_input_error')).toBe(false)
  })

  test('a refusal is a stop reason; web citations are kept for the post-check', () => {
    expect(run('stream-refusal').turn!.stop).toBe('refusal')
    expect(run('stream-annotations').turn!.annotations).toEqual([{ type: 'url_citation', url: 'https://example.org/report', title: 'Report' }])
  })

  test('a mid-stream error frame fails with the partial text; a 200 holding only an error is a failure', () => {
    const mid = run('stream-midstream-error')
    expect(mid.turn).toBeNull()
    expect(mid.failure!.failure.code).toBe('rate_limit')
    expect(textOf(mid.failure!.partial)).toBe('The plan ')
    const only = run('stream-only-error')
    expect(only.failure!.failure.code).toBe('unavailable')
    expect(only.failure!.partial.parts).toEqual([])
  })

  test('a stream cut before it said it was done fails (nothing passes as a whole answer)', () => {
    const events: AIEvent[] = []
    const p = createChatParser((e) => events.push(e))
    p.feed(JSON.stringify({ model: 'vendor-a/model-b', choices: [{ index: 0, delta: { content: 'Half' }, finish_reason: null }] }))
    expect(() => p.end()).toThrow(WireFailure)
    expect(textOf(p.partial())).toBe('Half')
    expect(() => createChatParser(() => {}).end()).toThrow(/empty/)
  })

  test('a router answer names the model that served it (one of the pool) and its upstream', () => {
    const r = run('stream-router', { router: true })
    expect(r.turn!.served).toBe('vendor-a/model-b')
    expect(r.turn!.upstream).toBe('Nordwind')
    expect(r.turn!.usage!.reportedUsd).toBe(0.000233)
  })
})

test.describe('classify', () => {
  test('every row of the error table (doc-derived): status, limit source, error type, Retry-After, keys scrubbed', () => {
    const fx = fixture<{ cases: Array<{ name: string; status: number; body: unknown; headers?: Record<string, string>; router?: boolean; expect: string; retryAfter?: number; detail?: string }> }>('errors')
    expect(fx.cases.length).toBeGreaterThanOrEqual(24)
    for (const c of fx.cases) {
      const got = classify(c.status, c.body, c.headers ?? null, { router: c.router })
      expect(got.code, c.name).toBe(c.expect)
      if (c.retryAfter !== undefined) expect(got.retryAfter, c.name).toBe(c.retryAfter)
      if (c.detail) expect(got.detail, c.name).toMatch(new RegExp(c.detail))
      expect(got.detail, c.name).not.toMatch(/sk-or-v1-/)
    }
  })

  test('mid-stream errors: a numeric code is the status, a string code is read through its error type', () => {
    for (const c of fixture<{ cases: Array<{ name: string; error: unknown; expect: string }> }>('midstream-errors').cases) expect(classify(200, { error: c.error }).code, c.name).toBe(c.expect)
  })

  test('a router 404 is never a gone model', () => {
    expect(classify(404, { error: { code: 404, message: 'Not found' } }, null, { router: true }).code).toBe('no_endpoint')
    expect(classify(404, { error: { code: 404, message: 'Not found' } }).code).toBe('model_gone')
  })
})
