import { assertPreparedFlow } from './gate'
import { isWorkerProvider } from '@/shared/ai/providers'
import { sendWorkerText } from './workerModels'
/**
 * sendNeutral(): one request to a provider on the neutral wire (multi-provider S2: OpenRouter one-shots), after the gate
 * prepared it — a lazy part of the AI path (the facades import it only for a non-Claude route):
 *
 *  1. the key of the route's provider, opened for this request only (store/secrets.ts getAIKey);
 *  2. the transport, loaded lazily (providers/openrouter.ts);
 *  3. where it may go (D-S2-13): the model's endpoint pins minus the workspace's deny list — none → 'no_endpoint' before
 *     anything is sent; the Jev Router (D-S2-23): a fresh catalogue (forced once when stale), the pool's pins ∪ the
 *     router's own, the include / exclude lists — a deny list naming its operator → 'policy';
 *  4. send, metered once per response (core/meter.ts) — retries for a rate limit / "busy" (core/retry.ts), the pins of a
 *     model refreshed and the request sent once more on "no endpoints" (never for the router, never after content);
 *  5. after the answer (D-S2-16): the served upstream inside the pins and not denied, a model One does not refuse, a router
 *     answer from its pool, no web citations — else 'policy', nothing returned (the response is still metered).
 * Steps: 'substituted' (another model of the request answered), 'routed' (the router chose; 'over-bound' when the reported
 * cost passed the reserved bound), 'upstream' (refused after the answer).
 */
import type { AIEvent, ChatRequest, PriceRow, ProviderId, StepNote, Turn, UpstreamRule } from '@/shared/ai/types'
import type { ProviderAdapter } from '@/shared/ai/adapter'
import { ProviderError } from '@/shared/ai/errors'
import { refusedSlug } from '@/shared/ai/models'
import { DYNAMIC_BOUND } from '@/shared/ai/prices'
import { hintsOfRow, routerLists } from '@/shared/ai/catalog'
import { isJevRouter } from '@/shared/ai/jev'
import { checkServed } from '@/shared/ai/wire/openrouterChat'
import { useWorkspace } from '../../../store/store'
import { getAIKey } from '../../../store/secrets'
import { AIError, type AIFix } from './errors'
import type { Prepared } from './gate'
import type { MeterCall } from './meter'
import { neutralCut, neutralResponse } from './meter'
import { labelFor, modelInfo, priceFor, servedPrice } from './registry'
import { retryPlan, type RetryCount } from './retry'
import { catalogFresh, loadCatalog, peekCatalog, pinsFor, routerPinsFor, type Pins } from './catalog'

/** The workspace's upstream rule for OpenRouter (no rule: no data collection, nothing denied). */
export function upstreamRule(): UpstreamRule {
  return useWorkspace.getState().ai?.policy?.providers?.openrouter?.upstream ?? { deny: [], noCollect: true, zdr: false }
}

/** The app's address (`HTTP-Referer`): this page without its fragment or query. */
export const referer = (): string => {
  try {
    const u = new URL('./', window.location.href)
    u.hash = ''
    u.search = ''
    return u.href
  } catch {
    return ''
  }
}

const loaders: Partial<Record<string, () => Promise<ProviderAdapter>>> = {
  openrouter: () => import('../providers/openrouter').then((m) => m.openrouter),
}

/** The transport of a provider, loaded on first use. */
export async function loadAdapter(p: string): Promise<ProviderAdapter> {
  const load = loaders[p]
  if (!load) throw new AIError('capability', p)
  try {
    return await load()
  } catch (e) {
    throw new AIError(navigator.onLine ? 'outdated' : 'offline', e instanceof Error ? e.message : String(e))
  }
}

/**
 * What the person can do about a refusal on the wire (acceptance 8, D-S2-13): no operator serves the model under the
 * workspace's rules → the operator rules (step 04) or another model (step 03); a model OpenRouter no longer lists → another
 * model.
 */
export function wireFixes(code: string, p: ProviderId): AIFix[] {
  if (code === 'no_endpoint') return [{ kind: 'step', step: 'data', provider: p }, { kind: 'step', step: 'models', provider: p }]
  if (code === 'model_gone') return [{ kind: 'step', step: 'models', provider: p }]
  return []
}

/** A transport's failure → the app's AIError (the friendly text, naming the route's model; its fix keys). */
const appError = (e: unknown, label?: string, p: ProviderId = 'openrouter'): AIError =>
  e instanceof AIError ? e : e instanceof ProviderError ? new AIError(e.code, e.detail, undefined, label, wireFixes(e.code, p)) : new AIError('unknown', e instanceof Error ? e.message : String(e), undefined, label)

/** An AIError for a refusal before sending, with its fix keys. */
const refusal = (code: 'no_endpoint' | 'model_gone', detail: string, label: string, p: ProviderId): AIError => new AIError(code, detail, undefined, label, wireFixes(code, p))

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AIError('aborted'))
    const t = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', stop)
      resolve()
    }
    function stop() {
      clearTimeout(t)
      reject(new AIError('aborted'))
    }
    signal?.addEventListener('abort', stop, { once: true })
  })

export interface NeutralOpts {
  mcp?: import('../mcp-servers/config').McpAttachment | null
  onMcp?: (calls: import('../mcp-servers/activity').McpCall[]) => void
  signal?: AbortSignal
  /** each streamed text delta */
  onToken?: (delta: string) => void
  /** the facade call's meter: one entry per response */
  call: MeterCall
  /** the request's size in characters (an estimate when a response ends without its usage) */
  promptChars: number
}

/** One request on the neutral wire → the whole turn (or an AIError). */
export async function sendNeutral(prepared: Prepared, req: ChatRequest, o: NeutralOpts): Promise<Turn> {
  assertPreparedFlow(prepared)
  const route = prepared.route
  if (!route) throw new AIError('no_key')
  if (route.p === 'copilot') return (await import('./copilotCall')).sendCopilotCompletion(prepared, req, o)
  if (isWorkerProvider(route.p)) {
    if (req.kind !== 'chat' || req.output.kind !== 'text' || req.tools?.length || req.messages.some(m => m.parts.some(p => p.type !== 'text'))) throw new AIError('capability')
    const result = await sendWorkerText(route, [{ role: 'system', content: req.system }, ...req.messages.map(m => ({ role: m.role, content: m.parts.map(p => p.type === 'text' ? p.text : '').join('\n') }))], Math.min(req.maxTokens, 16384), o.signal)
    const usage = result.inputTokens !== null && result.outputTokens !== null ? { input: result.inputTokens, output: result.outputTokens, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, ...(route.p === 'local' ? { reportedUsd: 0 } : {}) } : null
    const turn: Turn = { kind: 'chat', parts: [{ type: 'text', text: result.text }], stop: 'end', usage, served: result.model, streamedChars: result.text.length }
    o.call.response(neutralResponse(turn, { price: priceFor(route), promptChars: o.promptChars }))
    o.onToken?.(result.text)
    return turn
  }
  const key = await getAIKey(route.p)
  if (!key) throw new AIError('no_key')
  if (o.signal?.aborted) throw new AIError('aborted')
  const adapter = await loadAdapter(route.p)
  const router = isJevRouter(route.m)
  const upstream = upstreamRule()
  const info = modelInfo(route, prepared.pool)
  const label = labelFor(route, prepared.pool)
  if (!info) throw refusal('model_gone', route.m, label, route.p)

  // 3 · where the request may go
  let pins: Pins | null
  let lists: { pool: string[]; exclude: string[] } | undefined
  let maxPrice: { prompt: number; completion: number } | undefined
  let model = info
  if (router) {
    let cat = await loadCatalog()
    if (!catalogFresh(cat)) cat = await loadCatalog({ force: true })
    if (!catalogFresh(cat)) throw refusal('no_endpoint', 'router: the model list could not be read', label, route.p)
    const r = await routerPinsFor(prepared.pool ?? [], upstream)
    if (r === 'denied') throw new AIError('policy', 'router: the upstream rule excludes its operator', undefined, label, [{ kind: 'step', step: 'data', provider: route.p }])
    if (!r) throw refusal('no_endpoint', 'router: no model of the list can be served', label, route.p)
    const l = routerLists(r.pool, cat.rows, upstream)
    if (!l) throw refusal('no_endpoint', 'router: no model of the list can be served', label, route.p)
    pins = r.pins
    lists = l
    model = modelInfo(route, l.pool) ?? info
  } else {
    // the wire's facts from the catalogue the device holds (never fetched for a model request: D-S2-34)
    const row = route.p === 'openrouter' ? ((await peekCatalog())?.rows.find((r) => r.id === route.m) ?? null) : null
    if (row) model = { ...info, hints: hintsOfRow(row) }
    if (row?.pricing === 'dynamic') maxPrice = { prompt: DYNAMIC_BOUND.input, completion: DYNAMIC_BOUND.output }
    pins = await pinsFor(route.m, upstream)
    if (!pins) throw refusal('no_endpoint', route.m, label, route.p)
  }

  // 4 · send, metered per response; retries before any content
  let request = req
  let refreshed = false
  const tries: RetryCount = { rateLimit: 0, busy: 0 }
  // who serves is checked as soon as the stream says it: an answer that will be refused never shows (D-S2-16)
  const early = (servedModel: string, up?: string) => checkServed({ served: servedModel, ...(up ? { upstream: up } : {}) }, { requested: route.m, router, pool: lists?.pool, upstreams: pins?.names, deny: upstream.deny, refused: (s) => refusedSlug(s) !== null }).problem
  for (;;) {
    assertPreparedFlow(prepared)
    let content = false
    let served: string | null = null
    let blocked = false
    const onEvent = (e: AIEvent) => {
      if (e.t === 'content') content = true
      else if (e.t === 'served') {
        served = e.model
        blocked = !!early(e.model, e.upstream)
      } else if (e.t === 'text' && !blocked) o.onToken?.(e.delta)
    }
    try {
      const turn = await adapter.send(request, { key, model, signal: o.signal, onEvent, pins: pins.tags, upstream, referer: referer(), ...(lists ? { router: lists } : {}), ...(maxPrice ? { maxPrice } : {}) })
      return finish(prepared, turn, { router, pool: lists?.pool, pins, upstream, call: o.call, promptChars: o.promptChars, label })
    } catch (e) {
      if (e instanceof AIError) throw e
      if (!(e instanceof ProviderError)) throw appError(e, label, route.p)
      // the response is metered whatever happens next (never sent: no entry)
      if (e.reach !== 'none') {
        const partial = (e.partial as Turn | undefined) ?? null
        const price = cutPrice(route, prepared.pool, router, partial?.served ?? served)
        o.call.response(neutralCut(e, { promptChars: o.promptChars, price, aborted: !!o.signal?.aborted }))
      }
      if (o.signal?.aborted) throw new AIError('aborted')
      const plan = retryPlan(e, tries, { contentStarted: content })
      if (plan) {
        if (plan.halve) tries.busy++
        else tries.rateLimit++
        await sleep(plan.waitMs, o.signal)
        if (plan.halve) request = { ...request, maxTokens: Math.max(256, Math.floor(request.maxTokens * 0.5)) }
        continue
      }
      // "no endpoints found": the pins were stale — read them again and send once more (never the router's 404)
      if (e.code === 'no_endpoint' && !router && !refreshed && !content && e.reach === 'refused') {
        refreshed = true
        const again = await pinsFor(route.m, upstream, { refresh: true })
        if (again) {
          pins = again
          continue
        }
      }
      throw appError(e, label, route.p)
    }
  }
}

/** What a cut response is estimated at: a router's served model once it is known, else the bound (or the model's row). */
function cutPrice(route: NonNullable<Prepared['route']>, pool: readonly string[] | undefined, router: boolean, served: string | null): PriceRow | null {
  if (router && served) return servedPrice(served) ?? priceFor(route, pool)
  return priceFor(route, pool)
}

/** After the answer: who served it (D-S2-16), the steps, one ledger entry. */
function finish(
  prepared: Prepared,
  turn: Turn,
  o: { router: boolean; pool?: readonly string[]; pins: Pins; upstream: UpstreamRule; call: MeterCall; promptChars: number; label: string },
): Turn {
  const route = prepared.route!
  const check = checkServed(turn, { requested: route.m, router: o.router, pool: o.pool, upstreams: o.pins.names, deny: o.upstream.deny, refused: (s) => refusedSlug(s) !== null })
  const steps: StepNote[] = []
  if (check.step) {
    const reported = turn.usage?.reportedUsd
    const over = o.router && typeof reported === 'number' && prepared.reservation && reported > prepared.reservation.usd
    steps.push(over ? { ...check.step, code: 'over-bound' } : check.step)
  }
  if (check.problem) steps.push({ k: 'upstream', code: check.problem, ...(turn.served ? { to: turn.served } : {}) })
  // a router answer without a reported cost is priced at the model that served it (else its bound)
  const price = o.router ? ((turn.served ? servedPrice(turn.served) : null) ?? priceFor(route, o.pool)) : priceFor(route, o.pool)
  o.call.response(neutralResponse(turn, { price, steps, promptChars: o.promptChars, outcome: check.problem ? 'policy' : undefined }))
  if (check.problem) throw new AIError('policy', check.problem, undefined, o.label)
  return turn
}
