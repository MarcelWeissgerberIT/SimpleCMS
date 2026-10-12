/**
 * The adapter contract (multi-provider S2), in Node — never a real host (helpers/noNet.ts first): every case of
 * src/shared/ai/contract.ts runs against OpenRouter's transport (fetch stubbed with the doc-derived fixtures) and against
 * a fake adapter written from the contract alone (it checks the harness). Each doc-derived case has a recorded twin that
 * stays fixme until the owner's spike transcripts exist (tests/fixtures/ai/openrouter/recorded/README.md); cases of later
 * slices are reserved as fixme.
 */
import { stubFetch } from './helpers/noNet'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { CONTRACT_CASES, DECIDE_REFUSAL, type ContractCase } from '../../src/shared/ai/contract'
import type { ProviderAdapter, SendContext } from '../../src/shared/ai/adapter'
import type { AIEvent, Caps, ChatRequest, DecideQuestion, DecideRequest, DecideTurn, McpPlan, ModelInfo, PriceRow, Turn, WireHints } from '../../src/shared/ai/types'
import { ProviderError } from '../../src/shared/ai/errors'
import { refusedSlug } from '../../src/shared/ai/models'
import { costOf } from '../../src/shared/ai/prices'
import { JEV_ROUTER } from '../../src/shared/ai/jev'
import { checkServed } from '../../src/shared/ai/wire/openrouterChat'
import { checkDecideServed, parseDecide } from '../../src/shared/ai/wire/decisions'
import { openrouter } from '../../src/app/features/ai/providers/openrouter'
import { retryPlan } from '../../src/app/features/ai/core/retry'
import { fakeAdapter, type FakeStep } from './helpers/fakeAdapter'

const doc = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/ai/openrouter/doc/${name}.json`, import.meta.url)), 'utf8')) as T
const sseOf = (name: string) => doc<{ sse: string }>(name).sse

/* ------------------------------------------------------------------ */
/* Requests and models                                                  */
/* ------------------------------------------------------------------ */

const CAPS: Caps = { structured: true, tools: true, vision: false, pdf: false, mcp: false, mcpListing: false, cache: 'auto', effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: 131072, maxOutput: 16384 }
const PRICE: PriceRow = { input: 0.3, output: 1.2, cacheRead: 0.3, cacheWrite: 0.3, source: 'catalogue', at: '2026-10-12' }
const model = (m: string, caps: Partial<Caps> = {}, hints?: WireHints): ModelInfo => ({ route: { p: 'openrouter', m }, label: m, short: m, vendor: m.split('/')[0]!, caps: { ...CAPS, ...caps }, price: PRICE, ...(hints ? { hints } : {}) })
const REASONER: WireHints = { params: ['reasoning', 'structured_outputs', 'response_format'], reasoning: { mandatory: true, efforts: ['high', 'medium', 'low', 'minimal'], supportsMax: false } }
const chat = (o: Partial<ChatRequest> = {}): ChatRequest => ({ kind: 'chat', route: { p: 'openrouter', m: 'vendor-a/model-b' }, system: 'S', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Improve: the launch is friday' }] }], output: { kind: 'text' }, maxTokens: 8000, cache: 'none', ...o })
const JSON_OUT: ChatRequest['output'] = { kind: 'json', name: 'answer', schema: { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'], additionalProperties: false } }
const POOL = ['vendor-a/model-b', 'vendor-c/thinker-2']
const CTX: Omit<SendContext, 'onEvent'> = { key: 'sk-or-v1-contract0000000000000000000000000000', model: model('vendor-a/model-b'), pins: ['nordwind'], upstream: { deny: [], noCollect: true, zdr: false }, referer: 'https://one.example/app/' }
const ROUTER_CTX: Omit<SendContext, 'onEvent'> = { ...CTX, model: model(JEV_ROUTER), pins: ['nordwind', 'typesafe'], router: { pool: POOL, exclude: ['vendor-e/*', 'openrouter/*'] } }
const PLAN: McpPlan = { servers: [{ name: 'kb', url: 'https://kb.example/mcp', token: 'tok-secret-0001', allowed: null, out: [], known: [] }], system: '', forced: [] }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/* ------------------------------------------------------------------ */
/* Subjects: OpenRouter (stubbed fetch) and the fake                    */
/* ------------------------------------------------------------------ */

/** What the stub answers one request with. */
type Answer = { fixture: string; split?: number; crlf?: boolean } | { status: number; body: unknown; headers?: Record<string, string> } | { hang: string }

interface Outcome {
  turn: Turn | null
  error: ProviderError | null
  events: AIEvent[]
  /** requests that reached the network (fetch calls) */
  posts: number
  /** the last request's body as sent */
  body: Record<string, unknown> | null
  /** the abort signal of the last fetch was aborted */
  aborted: boolean
}

interface Subject {
  name: 'openrouter' | 'fake'
  adapter: ProviderAdapter
  run(req: ChatRequest, ctx: Omit<SendContext, 'onEvent'>, answer: Answer, fake: FakeStep, o?: { abortOnText?: boolean }): Promise<Outcome>
}

/** A response body streamed in pieces of `split` characters (or whole). */
function streamBody(text: string, split?: number, hang = false): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const pieces = split ? (text.match(new RegExp(`[\\s\\S]{1,${split}}`, 'g')) ?? []) : [text]
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < pieces.length) c.enqueue(enc.encode(pieces[i++]!))
      else if (!hang) c.close()
      else return new Promise(() => {}) // never ends: only a cancel (the abort) ends it
    },
  })
}

const openrouterSubject: Subject = {
  name: 'openrouter',
  adapter: openrouter,
  async run(req, ctx, answer, _fake, o = {}) {
    let posts = 0
    let body: Record<string, unknown> | null = null
    let signal: AbortSignal | null = null
    const undo = stubFetch((url, init) => {
      posts++
      body = JSON.parse(String(init.body)) as Record<string, unknown>
      signal = (init.signal as AbortSignal | undefined) ?? null
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ctx.key}`)
      if ('status' in answer) return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json', ...(answer.headers ?? {}) } })
      if ('hang' in answer) return new Response(streamBody(answer.hang, undefined, true), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      let sse = sseOf(answer.fixture)
      if (answer.crlf) sse = sse.replace(/\n/g, '\r\n')
      return new Response(streamBody(sse, answer.split), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const events: AIEvent[] = []
    const ctl = new AbortController()
    try {
      const turn = await openrouter.send(req, { ...ctx, signal: ctl.signal, onEvent: (e) => (events.push(e), o.abortOnText && e.t === 'text' && ctl.abort()) })
      return { turn, error: null, events, posts, body, aborted: !!(signal as AbortSignal | null)?.aborted }
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e
      return { turn: null, error: e, events, posts, body, aborted: !!(signal as AbortSignal | null)?.aborted }
    } finally {
      undo()
    }
  },
}

function fakeSubject(): Subject {
  return {
    name: 'fake',
    adapter: fakeAdapter([]),
    async run(req, ctx, _answer, step, o = {}) {
      const fake = fakeAdapter([step])
      const events: AIEvent[] = []
      const ctl = new AbortController()
      try {
        const turn = await fake.send(req, { ...ctx, signal: ctl.signal, onEvent: (e) => (events.push(e), o.abortOnText && e.t === 'text' && ctl.abort()) })
        return { turn, error: null, events, posts: fake.sent.length, body: null, aborted: ctl.signal.aborted }
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e
        return { turn: null, error: e, events, posts: fake.sent.length, body: null, aborted: ctl.signal.aborted }
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Decisions (K21–K27): the same two subjects, one decisions request each */
/* ------------------------------------------------------------------ */

type DecideAnswerStub = { json: unknown } | { status: number; body: unknown; headers?: Record<string, string> } | { hang: true }

interface DecideOutcome {
  turn: DecideTurn | null
  error: ProviderError | null
  posts: number
  body: Record<string, unknown> | null
  url: string | null
}

const JEV_CTX: Omit<SendContext, 'onEvent'> = { ...CTX, model: model('typesafe/jev-1.13', { structured: false, tools: false, decisions: true, context: 32000, maxOutput: 1 }), pins: ['typesafe'] }
const TUTORIAL = doc<{ request: { model: string; state: Record<string, unknown>; questions: Record<string, DecideQuestion> }; response: Record<string, any>; expect: Record<string, any> }>('decisions-tutorial') // eslint-disable-line @typescript-eslint/no-explicit-any
const decideReq = (o: Partial<DecideRequest> = {}): DecideRequest => ({ kind: 'decide', route: { p: 'openrouter', m: TUTORIAL.request.model }, state: TUTORIAL.request.state, questions: TUTORIAL.request.questions, ...o })

/** One decisions request: OpenRouter's transport against a stubbed fetch, or the fake with its scripted step. */
async function runDecide(name: Subject['name'], req: DecideRequest, answer: DecideAnswerStub, step: FakeStep, o: { abort?: 'before' | 'inflight' } = {}): Promise<DecideOutcome> {
  const ctl = new AbortController()
  if (o.abort === 'before') ctl.abort()
  if (name === 'fake') {
    const fake = fakeAdapter([step])
    if (o.abort === 'inflight') setTimeout(() => ctl.abort(), 5)
    try {
      const turn = await fake.send(req, { ...JEV_CTX, signal: ctl.signal, onEvent: () => {} })
      return { turn, error: null, posts: fake.sent.length, body: null, url: null }
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e
      return { turn: null, error: e, posts: fake.sent.length, body: null, url: null }
    }
  }
  let posts = 0
  let body: Record<string, unknown> | null = null
  let url: string | null = null
  const undo = stubFetch((u, init) => {
    posts++
    url = u
    body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JEV_CTX.key}`)
    if (o.abort === 'inflight') setTimeout(() => ctl.abort(), 5)
    if ('hang' in answer)
      return new Promise<Response>((_, reject) => {
        const s = init.signal as AbortSignal | undefined
        const stop = () => reject(new DOMException('aborted', 'AbortError'))
        if (s?.aborted) stop()
        else s?.addEventListener('abort', stop, { once: true })
      })
    if ('status' in answer) return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json', ...(answer.headers ?? {}) } })
    return new Response(JSON.stringify(answer.json), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    const turn = await openrouter.send(req, { ...JEV_CTX, signal: ctl.signal, onEvent: () => {} })
    return { turn, error: null, posts, body, url }
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e
    return { turn: null, error: e, posts, body, url }
  } finally {
    undo()
  }
}

/** The tutorial's answer as the fake hands it back (written from the contract, not the wire). */
const TUTORIAL_TURN: DecideTurn = { kind: 'decide', answers: TUTORIAL.expect.answers, served: TUTORIAL.expect.served, usage: { ...TUTORIAL.expect.usage } }

/* ------------------------------------------------------------------ */
/* The fake's scripted equivalents (written from the contract, not the wire) */
/* ------------------------------------------------------------------ */

const U = (o: Partial<NonNullable<Turn['usage']>> = {}) => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, ...o })
const T = (o: Partial<Turn>): Turn => ({ kind: 'chat', parts: [], stop: 'end', usage: null, served: null, streamedChars: 0, ...o })
const textTurn = (text: string, o: Partial<Turn> = {}) => T({ parts: [{ type: 'text', text }], ...o })
const FAKE: Record<string, FakeStep> = {
  text: { events: [{ t: 'served', model: 'vendor-a/model-b', upstream: 'Nordwind' }, { t: 'content' }, { t: 'text', delta: 'The launch plan is on track for Friday.' }], turn: textTurn('The launch plan is on track for Friday.', { usage: U({ input: 812, output: 11, reportedUsd: 0.000271 }), served: 'vendor-a/model-b', upstream: 'Nordwind' }) },
  json: { events: [{ t: 'content' }], turn: textTurn('{"rows":[{"Name":"Tessera","Status":"Open"}]}') },
  refusal: { events: [{ t: 'content' }], turn: T({ stop: 'refusal' }) },
  cache: { events: [{ t: 'content' }], turn: textTurn('Summary: two risks, one owner.', { usage: U({ input: 500, cacheRead: 10000, cacheWrite: 1500, output: 9, reportedUsd: 0.002125 }) }) },
  reasoning: { events: [{ t: 'content' }, { t: 'note', text: 'Keep the date.' }, { t: 'text', delta: 'Launch: Friday.' }], turn: textTurn('Launch: Friday.') },
  tools: { events: [{ t: 'content' }], turn: T({ stop: 'tool_calls', parts: [{ type: 'tool_call', id: 'call_a1', name: 'search_pages', input: { query: 'launch' } }, { type: 'tool_call', id: 'call_b2', name: 'read_page', input: { id: 'p_42' } }] }) },
  toolCut: { events: [{ t: 'content' }], turn: textTurn('Looking it up.', { stop: 'max_tokens' }) },
  router: { events: [{ t: 'served', model: 'vendor-a/model-b', upstream: 'Nordwind' }, { t: 'content' }], turn: textTurn('Shorter: the launch is on Friday.', { served: 'vendor-a/model-b', upstream: 'Nordwind', usage: U({ input: 700, output: 9, reportedUsd: 0.000233 }) }) },
}
const fakeError = (code: ProviderError['code'], reach: ProviderError['reach'], partial?: Turn): FakeStep => ({ error: new ProviderError(code, undefined, { reach, ...(partial ? { partial } : {}) }) })

/* ------------------------------------------------------------------ */
/* The cases                                                            */
/* ------------------------------------------------------------------ */

const textOf = (t: Turn | null | undefined) => (t?.parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('')
const calls = (t: Turn | null) => (t?.parts ?? []).filter((p) => p.type === 'tool_call')
const refused = (slug: string) => refusedSlug(slug) !== null

const RUN: Record<string, (s: Subject, c: ContractCase) => Promise<void>> = {
  async K1(s, c) {
    const o = await s.run(chat(), CTX, { fixture: 'stream-text' }, FAKE.text!)
    expect(textOf(o.turn)).toBe(c.expect.text)
    expect(o.turn!.stop).toBe(c.expect.stop)
    expect(o.turn!.usage!.reportedUsd).toBe(c.expect.reportedUsd)
    expect(o.events.filter((e) => e.t === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe(c.expect.text)
    expect(o.posts).toBe(1)
  },
  async K2(s, c) {
    const o = await s.run(chat({ output: JSON_OUT, maxTokens: 4096 }), CTX, { fixture: 'stream-json' }, FAKE.json!)
    expect(JSON.parse(textOf(o.turn))).toEqual(c.expect.json)
    if (s.name === 'openrouter') {
      expect((o.body!.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(c.expect.strict)
      expect((o.body!.provider as { require_parameters: boolean }).require_parameters).toBe(c.expect.requireParameters)
    }
  },
  async K3(s, c) {
    const o = await s.run(chat(), CTX, { fixture: 'stream-tools' }, FAKE.tools!)
    expect(calls(o.turn)[0]).toEqual({ type: 'tool_call', ...(c.expect.call as object) })
  },
  async K4(s, c) {
    const o = await s.run(chat(), CTX, { fixture: 'stream-tools', split: 13 }, FAKE.tools!)
    expect(calls(o.turn)).toHaveLength(c.expect.calls as number)
    expect(o.turn!.stop).toBe(c.expect.stop)
  },
  async K6(s, c) {
    const o = await s.run(chat(), CTX, { fixture: 'stream-refusal' }, FAKE.refusal!)
    expect(o.turn!.stop).toBe(c.expect.stop)
  },
  async K7(s, c) {
    const o = await s.run(chat(), CTX, { fixture: 'stream-tool-cut' }, FAKE.toolCut!)
    expect(o.turn!.stop).toBe(c.expect.stop)
    expect(calls(o.turn)).toHaveLength(c.expect.calls as number)
    expect(textOf(o.turn)).toBe(c.expect.text)
    expect(o.events.some((e) => e.t === 'tool_input_error')).toBe(false)
  },
  async K8(s, c) {
    const o = await s.run(chat({ route: { p: 'openrouter', m: 'anthropic/claude-sonnet-5.5' } }), { ...CTX, model: model('anthropic/claude-sonnet-5.5') }, { fixture: 'stream-cache' }, FAKE.cache!)
    const u = o.turn!.usage!
    expect({ input: u.input, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, reportedUsd: u.reportedUsd }).toEqual(c.expect)
    // the reported cost wins over any row: nothing priced twice
    expect(costOf(u, PRICE)).toEqual({ usd: 0.002125, source: 'reported' })
  },
  async K9(s, c) {
    const rows = doc<{ cases: Array<{ name: string; status: number; body: unknown; headers?: Record<string, string>; router?: boolean; expect: string }> }>('errors').cases
    for (const row of rows) {
      const ctx = row.router ? ROUTER_CTX : CTX
      const req = row.router ? chat({ route: { p: 'openrouter', m: JEV_ROUTER } }) : chat()
      const o = await s.run(req, ctx, { status: row.status, body: row.body, headers: row.headers }, fakeError(row.expect as ProviderError['code'], 'refused'))
      expect(o.error?.code, row.name).toBe(row.expect)
      expect(o.error?.reach, row.name).toBe(c.expect.reach)
      expect(o.error?.message ?? '', row.name).not.toMatch(/sk-or-v1-/)
    }
  },
  async K10(s, c) {
    const mid = await s.run(chat(), CTX, { fixture: 'stream-midstream-error' }, fakeError('rate_limit', 'sent', textTurn('The plan ')))
    expect(mid.error!.code).toBe(c.expect.mid)
    expect(textOf(mid.error!.partial as Turn)).toBe(c.expect.partial)
    const only = await s.run(chat(), CTX, { fixture: 'stream-only-error' }, fakeError('unavailable', 'sent', T({})))
    expect(only.error!.code).toBe(c.expect.only)
    expect(only.turn).toBeNull()
  },
  async K11(s, c) {
    for (const split of [1, 7, 64]) {
      const o = await s.run(chat(), CTX, { fixture: 'stream-text', split, crlf: true }, FAKE.text!)
      expect(textOf(o.turn), `split ${split}`).toBe(c.expect.text)
    }
  },
  async K12(s, c) {
    // the request asked for another model: the answer names who served it
    const o = await s.run(chat({ route: { p: 'openrouter', m: 'vendor-a/model-b-pro' } }), { ...CTX, model: model('vendor-a/model-b-pro') }, { fixture: 'stream-text' }, FAKE.text!)
    const ok = checkServed(o.turn!, { requested: 'vendor-a/model-b-pro', router: false, deny: [], upstreams: ['Nordwind'], refused })
    expect(ok).toEqual({ step: { k: 'substituted', from: 'vendor-a/model-b-pro', to: 'vendor-a/model-b' }, problem: null })
    // an upstream the rule denies, or one outside the pins → the answer is not used
    expect(checkServed(o.turn!, { requested: 'vendor-a/model-b', router: false, deny: ['nordwind'], refused }).problem).toBe(c.expect.denied)
    expect(checkServed(o.turn!, { requested: 'vendor-a/model-b', router: false, deny: [], upstreams: ['Lindenhof'], refused }).problem).toBe(c.expect.denied)
    // the same model (a dated revision) is no substitution
    expect(checkServed({ served: 'vendor-a/model-b-20260917', upstream: 'Nordwind' }, { requested: 'vendor-a/model-b', router: false, deny: [], refused }).step).toBeNull()
    // a refused model served → policy; web citations → policy
    expect(checkServed({ served: 'openrouter/auto' }, { requested: 'vendor-a/model-b', router: false, deny: [], refused }).problem).toBe('model:openrouter/auto')
    expect(checkServed({ served: 'vendor-a/model-b', annotations: [{ type: 'url_citation', url: 'https://example.org' }] }, { requested: 'vendor-a/model-b', router: false, deny: [], refused }).problem).toBe('web')
  },
  async K13(s, c) {
    // the keep-alive comment and the first text chunk arrive, then the stream hangs until the person stops it
    const half = sseOf('stream-text').split('\n\n').slice(0, 2).join('\n\n') + '\n\n'
    const o = await s.run(chat(), CTX, { hang: half }, { hang: textTurn('The launch '), events: [{ t: 'content' }, { t: 'text', delta: 'The launch ' }] }, { abortOnText: true })
    expect(o.error!.code).toBe(c.expect.code)
    expect(o.error!.reach).toBe(c.expect.reach)
    expect(textOf(o.error!.partial as Turn)).toBe('The launch ')
    if (s.name === 'openrouter') expect(o.aborted).toBe(true)
  },
  async K14(s, c) {
    const r = s.adapter.mcp(PLAN, CAPS)
    expect(r.native).toBeNull()
    expect(r.skipped).toEqual([{ server: 'kb', why: c.expect.skipped }])
    if (s.name === 'openrouter') {
      const o = await s.run(chat(), CTX, { fixture: 'stream-text' }, FAKE.text!)
      for (const k of ['tools', 'mcp_servers', 'web_search_options']) expect(k in o.body!, k).toBe(false)
      expect(JSON.stringify(o.body)).not.toContain('tok-secret-0001')
    }
  },
  async K15(s, c) {
    const img = chat({ messages: [{ role: 'user', parts: [{ type: 'image', mime: 'image/png', data: PNG }, { type: 'text', text: 'Describe.' }] }] })
    const pdf = chat({ messages: [{ role: 'user', parts: [{ type: 'document', title: 'Plan.pdf', pdf: { data: 'JVBERi0x', pages: 2 } }, { type: 'text', text: 'Summarise.' }] }] })
    if (s.name === 'openrouter') {
      const noVision = await s.run(img, CTX, { fixture: 'stream-text' }, FAKE.text!)
      expect(noVision.error!.code).toBe(c.expect.vision)
      expect(noVision.error!.reach).toBe('none')
      expect(noVision.posts).toBe(0)
      const noPdf = await s.run(pdf, CTX, { fixture: 'stream-text' }, FAKE.text!)
      expect(noPdf.error!.code).toBe(c.expect.pdf)
      expect(noPdf.posts).toBe(0)
      // too many pages for the model's cap: refused too
      const long = await s.run(chat({ messages: [{ role: 'user', parts: [{ type: 'document', title: 'Book.pdf', pdf: { data: 'JVBERi0x', pages: 101 } }] }] }), { ...CTX, model: model('vendor-a/model-b', { pdf: { maxBytes: 23 << 20, maxPages: 100 } }) }, { fixture: 'stream-text' }, FAKE.text!)
      expect(long.error!.code).toBe('capability')
      const ok = await s.run(img, { ...CTX, model: model('vendor-a/model-b', { vision: { maxEdge: 1568, maxBytes: 5 << 20 } }) }, { fixture: 'stream-text' }, FAKE.text!)
      expect(JSON.stringify(ok.body)).toContain(`data:image/png;base64,${PNG}`)
      const okPdf = await s.run(pdf, { ...CTX, model: model('vendor-a/model-b', { pdf: { maxBytes: 23 << 20, maxPages: 100 } }) }, { fixture: 'stream-text' }, FAKE.text!)
      expect((okPdf.body!.plugins as Array<{ id: string }>).some((p) => p.id === 'file-parser')).toBe(true)
    } else {
      const o = await s.run(img, CTX, { fixture: 'stream-text' }, fakeError('capability', 'none'))
      expect(o.error!.code).toBe(c.expect.vision)
    }
  },
  async K16(s, c) {
    if (s.name !== 'openrouter') return
    const req = chat({ cache: 'none', route: { p: 'openrouter', m: 'anthropic/claude-sonnet-5.5' }, messages: [{ role: 'user', parts: [{ type: 'text', text: 'Long', cache: true }] }] })
    const o = await s.run(req, { ...CTX, model: model('anthropic/claude-sonnet-5.5') }, { fixture: 'stream-text' }, FAKE.text!)
    expect(JSON.stringify(o.body).includes('cache_control')).toBe(c.expect.cacheControl)
  },
  async K17(s, c) {
    const req = chat({ route: { p: 'openrouter', m: 'vendor-c/thinker-2' }, output: JSON_OUT, maxTokens: 200 })
    const o = await s.run(req, { ...CTX, model: model('vendor-c/thinker-2', { reasoning: { mandatory: true } }, REASONER) }, { fixture: 'stream-reasoning' }, FAKE.reasoning!)
    expect(textOf(o.turn)).toBe(c.expect.text)
    if (s.name === 'openrouter') {
      expect(o.body!.max_tokens).toBe(c.expect.maxTokens)
      expect(o.body!.reasoning).toEqual({ effort: 'minimal' })
    }
  },
  async K18(s) {
    for (const [fx, step] of [['stream-text', FAKE.text], ['stream-reasoning', FAKE.reasoning], ['stream-tools', FAKE.tools]] as const) {
      const o = await s.run(chat(), CTX, { fixture: fx }, step!)
      const first = o.events.findIndex((e) => e.t === 'text' || e.t === 'note' || e.t === 'tool_input_error')
      const content = o.events.findIndex((e) => e.t === 'content')
      expect(content, fx).toBeGreaterThanOrEqual(0)
      if (first >= 0) expect(content, fx).toBeLessThan(first)
    }
  },
  async 'K19-or'(s, c) {
    if (s.name !== 'openrouter') return
    const o = await s.run(chat(), CTX, { fixture: 'stream-text' }, FAKE.text!)
    expect('mcp_servers' in o.body!).toBe(c.expect.mcpServers)
    expect(s.adapter.mcp(PLAN, CAPS).native).toBeNull()
  },
  async K21(s, c) {
    for (const name of ['decisions-tutorial', 'decisions-api-example']) {
      const f = doc<{ request: { model: string; state: Record<string, unknown>; questions: Record<string, DecideQuestion> }; response: unknown; expect: { answers: unknown } }>(name)
      const req = decideReq({ route: { p: 'openrouter', m: f.request.model }, state: f.request.state, questions: f.request.questions })
      const o = await runDecide(s.name, req, { json: f.response }, { decide: { ...TUTORIAL_TURN, answers: f.expect.answers as DecideTurn['answers'] } })
      expect(o.error, name).toBeNull()
      expect(o.turn!.answers, name).toEqual(f.expect.answers)
      expect(o.posts, name).toBe(1)
    }
    const o = await runDecide(s.name, decideReq(), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })
    const a = o.turn!.answers
    expect(a.is_bug).toEqual({ type: 'noul', p: c.expect.isBug })
    expect(a.team!.type === 'choice' && a.team!.choice).toBe(c.expect.team)
    expect(a.urgency!.type === 'score' && a.urgency!.score).toBe(c.expect.urgency)
    expect(o.turn!.usage!.output).toBe(c.expect.output)
    expect(o.turn!.usage!.reportedUsd).toBe(c.expect.reportedUsd)
    expect(o.turn!.served).toEqual({ model: c.expect.served, upstream: c.expect.upstream })
    if (s.name === 'openrouter') {
      expect(o.url).toBe('https://openrouter.ai/api/alpha/decisions')
      // another decision model's answer (a picture request One never sends) reads at parse level: four decimals, no output
      const m = doc<{ questions: Record<string, DecideQuestion>; response: unknown; expect: { answers: unknown } }>('decisions-multimodal')
      expect(parseDecide(m.response, m.questions).answers).toEqual(m.expect.answers)
    }
  },
  async K22(s, c) {
    const r = TUTORIAL.response
    const variants = [
      { ...r, answers: { is_bug: r.answers.is_bug, team: r.answers.team } },
      { ...r, answers: { ...r.answers, is_bug: { type: 'noul', noul: 1.4 } } },
      { ...r, answers: { ...r.answers, team: { type: 'choice', choice: 'legal', confidence: 0.9 } } },
    ]
    for (const json of variants) {
      const o = await runDecide(s.name, decideReq(), { json }, fakeError('empty', 'sent', { kind: 'decide', answers: {}, served: TUTORIAL_TURN.served, usage: TUTORIAL_TURN.usage } as unknown as Turn))
      expect(o.error!.code).toBe(c.expect.code)
      expect(o.error!.reach).toBe(c.expect.reach)
      expect((o.error!.partial as DecideTurn).usage!.reportedUsd).toBe(c.expect.reportedUsd)
    }
  },
  async K23(s, c) {
    const rows = doc<{ cases: Array<{ name: string; status: number; body: unknown; headers?: Record<string, string>; expect: string; retryAfter?: number }> }>('decisions-errors').cases
    for (const row of rows) {
      const o = await runDecide(s.name, decideReq(), { status: row.status, body: row.body, headers: row.headers }, { error: new ProviderError(row.expect as ProviderError['code'], undefined, { reach: 'refused', ...(row.retryAfter !== undefined ? { retryAfter: row.retryAfter } : {}) }) })
      expect(o.error?.code, row.name).toBe(row.expect)
      expect(o.error?.reach, row.name).toBe(c.expect.reach)
      if (row.retryAfter !== undefined) expect(o.error?.retryAfter, row.name).toBe(row.retryAfter)
      expect(o.error?.message ?? '', row.name).not.toMatch(/sk-or-v1-/)
      expect(o.posts, row.name).toBe(1)
    }
  },
  async K24(s, c) {
    const before = await runDecide(s.name, decideReq(), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN }, { abort: 'before' })
    expect(before.error!.code).toBe(c.expect.code)
    expect(before.error!.reach).toBe(c.expect.before)
    expect(before.posts).toBe(0)
    const inflight = await runDecide(s.name, decideReq(), { hang: true }, { hang: { kind: 'chat', parts: [], stop: 'end', usage: null, served: null, streamedChars: 0 } }, { abort: 'inflight' })
    expect(inflight.error!.code).toBe(c.expect.code)
    expect(inflight.error!.reach).toBe(c.expect.inFlight)
    expect(inflight.posts).toBe(1)
  },
  async K25(s, c) {
    // a model outside the Jev family is refused before anything is sent (both subjects)
    for (const m of ['vendor-k/kev-4b', '~typesafe/jev-latest', 'typesafe/jev-router', 'typesafe/jev-1.13-20260917']) {
      const o = await runDecide(s.name, decideReq({ route: { p: 'openrouter', m } }), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })
      expect(o.error?.code, m).toBe(c.expect.refused)
      expect(o.error?.reach, m).toBe('none')
      expect(o.posts, m).toBe(0)
    }
    if (s.name !== 'openrouter') return
    const o = await runDecide(s.name, decideReq(), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })
    const b = o.body!
    expect(Object.keys(b).sort()).toEqual(['model', 'provider', 'questions', 'state'])
    expect(b.provider).toEqual({ only: c.expect.only, allow_fallbacks: false, data_collection: c.expect.dataCollection })
    const json = JSON.stringify(b)
    for (const k of ['session_id', 'trace', 'user', 'metadata', 'require_parameters', 'plugins', 'models']) expect(json, k).not.toContain(`"${k}"`)
    // the upstream rule: zero data retention and data collection follow it; no pins → nothing sent
    const zdr = await runDecideWith({ upstream: { deny: [], noCollect: false, zdr: true } })
    expect((zdr.body!.provider as Record<string, unknown>)).toEqual({ only: ['typesafe'], allow_fallbacks: false, data_collection: 'allow', zdr: true })
    const none = await runDecideWith({ pins: [] })
    expect(none.error!.code).toBe('no_endpoint')
    expect(none.posts).toBe(0)
  },
  async K26(s, c) {
    const o = await runDecide(s.name, decideReq(), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })
    const served = o.turn!.served
    const SNAP = 'typesafe/jev-1.13-20260917'
    expect(checkDecideServed(served, { requested: 'typesafe/jev-1.13', on: SNAP, upstreams: ['TypeSafe'] })).toBeNull()
    expect(checkDecideServed(served, { requested: 'typesafe/jev-1.13', on: SNAP, upstreams: ['typesafe'] })).toBeNull()
    // another snapshot than the one confirmed → changed (the thresholds belong to one model)
    expect(checkDecideServed(served, { requested: 'typesafe/jev-1.13', on: 'typesafe/jev-1.13-20261101' })).toBe(c.expect.changed)
    expect(checkDecideServed({ ...served, model: 'typesafe/jev-1.14-20261101' }, { requested: 'typesafe/jev-1.13' })).toBe(c.expect.changed)
    // confirmed without a known snapshot: any snapshot of that version
    expect(checkDecideServed(served, { requested: 'typesafe/jev-1.13', on: 'typesafe/jev-1.13' })).toBeNull()
    expect(checkDecideServed({ ...served, model: 'typesafe/jev-1.13:free' }, { requested: 'typesafe/jev-1.13', on: 'typesafe/jev-1.13' })).toBe(c.expect.changed)
    // an operator outside the pins → upstream
    expect(checkDecideServed(served, { requested: 'typesafe/jev-1.13', on: SNAP, upstreams: ['Nordwind'] })).toBe(c.expect.upstream)
    // no operator named: nothing to compare (the pins held the request)
    expect(checkDecideServed({ model: SNAP }, { requested: 'typesafe/jev-1.13', on: SNAP, upstreams: ['Nordwind'] })).toBeNull()
  },
  async K27(s, c) {
    const o = await runDecide(s.name, decideReq({ state: { text: 'x'.repeat(70_000) } }), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })
    expect(o.error!.code).toBe(c.expect.code)
    expect(o.error!.reach).toBe(c.expect.reach)
    expect(o.posts).toBe(c.expect.posts)
    // positive control: under the cap it goes
    expect((await runDecide(s.name, decideReq({ state: { text: 'x'.repeat(40_000) } }), { json: TUTORIAL.response }, { decide: TUTORIAL_TURN })).posts).toBe(1)
  },
  async K28(s, c) {
    const req = chat({ route: { p: 'openrouter', m: JEV_ROUTER, effort: 'medium' } })
    const o = await s.run(req, ROUTER_CTX, { fixture: 'stream-router' }, FAKE.router!)
    if (s.name === 'openrouter') {
      expect(o.body!.model).toBe(JEV_ROUTER)
      expect((o.body!.plugins as Array<Record<string, unknown>>)[0]).toEqual({ id: 'jev-router', cost_tier: 'medium', models: POOL, excluded_models: ['vendor-e/*', 'openrouter/*'] })
      expect((o.body!.provider as { only: string[] }).only).toEqual(['nordwind', 'typesafe'])
      expect('reasoning' in o.body!).toBe(false)
    }
    // served inside the pool → routed; outside → policy
    expect(checkServed(o.turn!, { requested: JEV_ROUTER, router: true, pool: POOL, deny: [], refused }).step).toEqual({ k: c.expect.step, from: JEV_ROUTER, to: 'vendor-a/model-b' })
    expect(checkServed({ ...o.turn!, served: 'vendor-x/elsewhere' }, { requested: JEV_ROUTER, router: true, pool: POOL, deny: [], refused }).problem).toBe(c.expect.outside)
    // the router's own operator denied → policy
    expect(checkServed({ served: 'vendor-a/model-b', upstream: 'TypeSafe' }, { requested: JEV_ROUTER, router: true, pool: POOL, deny: ['TypeSafe'], refused }).problem).toBe('upstream:TypeSafe')
    // no reported cost on a router stream: the turn says so (the meter prices the served row, A8)
    const noCost = { ...o.turn!.usage!, reportedUsd: undefined }
    expect(costOf(noCost, PRICE).source).toBe('catalogue')
    // a router 404 → no_endpoint, one request, never sent again
    const nf = await s.run(req, ROUTER_CTX, { status: 404, body: { error: { code: 404, message: 'No eligible model remains' } } }, fakeError('no_endpoint', 'refused'))
    expect(nf.error!.code).toBe(c.expect.notFound)
    expect(nf.posts).toBe(c.expect.posts)
    expect(retryPlan(nf.error!, { rateLimit: 0, busy: 0 }, { contentStarted: false })).toBeNull()
  },
}

/** OpenRouter's transport with another send context (K25: the upstream rule, no pins). */
async function runDecideWith(ctx: Partial<SendContext>): Promise<DecideOutcome> {
  let posts = 0
  let body: Record<string, unknown> | null = null
  const undo = stubFetch((_u, init) => {
    posts++
    body = JSON.parse(String(init.body)) as Record<string, unknown>
    return new Response(JSON.stringify(TUTORIAL.response), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    return { turn: await openrouter.send(decideReq(), { ...JEV_CTX, ...ctx, onEvent: () => {} }), error: null, posts, body, url: null }
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e
    return { turn: null, error: e, posts, body, url: null }
  } finally {
    undo()
  }
}

const subjects: Subject[] = [openrouterSubject, fakeSubject()]

for (const c of CONTRACT_CASES) {
  test.describe(`${c.id} · ${c.title}`, () => {
    const run = c.openrouter
    if (run.run === 'fixme') {
      test(`${c.id} reserved`, () => test.fixme(true, run.why))
      return
    }
    if (run.run === 'variant') {
      test(`${c.id} → ${run.of}`, () => expect(CONTRACT_CASES.some((x) => x.id === run.of)).toBe(true))
      return
    }
    for (const s of subjects)
      test(`${s.name}${run.run === 'parse' ? ' (parse level)' : ' (doc-derived)'}`, async () => {
        const fn = RUN[c.id]
        expect(fn, `a runner for ${c.id}`).toBeTruthy()
        await fn!(s, c)
      })
    if (run.run === 'doc') test(`${c.id} recorded (${run.spike})`, () => test.fixme(true, `${run.spike}: recorded transcript missing`))
  })
}

test.describe('the decide kind', () => {
  const decide: DecideRequest = { kind: 'decide', route: { p: 'openrouter', m: 'vendor-a/decider' }, state: { text: 'Quarterly plan' }, questions: { done: { type: 'noul', instructions: 'Is it finished?' } } }

  test('OpenRouter serves both kinds; a decide request for a model outside the Jev family is refused before any fetch', async () => {
    expect(openrouter.kinds).toEqual(['chat', 'decide'])
    let posts = 0
    const undo = stubFetch(() => {
      posts++
      return new Response('{}')
    })
    try {
      const e = await openrouter.send(decide, { ...CTX, onEvent: () => {} }).then(
        () => null,
        (x: unknown) => x,
      )
      expect(e).toBeInstanceOf(ProviderError)
      expect({ code: (e as ProviderError).code, detail: (e as ProviderError).detail, reach: (e as ProviderError).reach }).toEqual(DECIDE_REFUSAL)
      expect(posts).toBe(0)
    } finally {
      undo()
    }
  })

  test('the fake serves both kinds (the decide types at work)', async () => {
    const f = fakeAdapter([{ decide: { kind: 'decide', answers: { done: { type: 'noul', p: 0.93 } }, served: { model: 'typesafe/jev-1.13-20260917' }, usage: null } }])
    const t = await f.send({ ...decide, route: { p: 'openrouter', m: 'typesafe/jev-1.13' } }, { ...CTX, onEvent: () => {} })
    expect(t.kind).toBe('decide')
    expect(t.answers.done).toEqual({ type: 'noul', p: 0.93 })
  })
})

test.describe('the transport stays apart', () => {
  test('providers/openrouter.ts imports nothing from the store, other features or the SDK', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/app/features/ai/providers/openrouter.ts', import.meta.url)), 'utf8')
    const specs = [...src.matchAll(/^\s*import[^'"\n]*from\s+'([^']+)'/gm)].map((m) => m[1]!)
    expect(specs.length).toBeGreaterThan(3)
    for (const s of specs) expect(s, s).toMatch(/^@\/shared\/ai\//)
    expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/@anthropic-ai|X-OpenRouter-Metadata/)
  })

  test('the fake never ships: nothing under src/ names it', () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url))
    const hits = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => /fakeAdapter|__ONE_FAKE_ADAPTER__/.test(readFileSync(root + f, 'utf8')))
    expect(hits).toEqual([])
  })

  test('verify: the key\'s credit without sending text; 401 and 402 are codes', async () => {
    const key = doc<{ json: { data: Record<string, unknown> } }>('key').json
    const seen: string[] = []
    let answer: Response = new Response(JSON.stringify(key))
    const undo = stubFetch((url, init) => {
      seen.push(`${init.method} ${url} ${init.body ?? ''}`)
      return answer
    })
    try {
      expect(await openrouter.verify('sk-or-v1-verify000000000000000000')).toEqual({ ok: true, credit: { limit: 1, remaining: 0.74, used: 0.26, free: false, reset: 'monthly' } })
      answer = new Response(JSON.stringify({ error: { code: 401, message: 'User not found' } }), { status: 401 })
      expect(await openrouter.verify('sk-or-v1-verify000000000000000000')).toEqual({ ok: false, code: 'invalid_key' })
      answer = new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), { status: 402 })
      expect(await openrouter.verify('sk-or-v1-verify000000000000000000')).toEqual({ ok: false, code: 'no_credit' })
      expect(seen.every((x) => x === 'GET https://openrouter.ai/api/v1/key ')).toBe(true)
    } finally {
      undo()
    }
  })
})
