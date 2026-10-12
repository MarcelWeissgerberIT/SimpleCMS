/**
 * The adapter contract (design § 5.1): what One needs from a provider. A provider = one pure wire module (build /
 * parse / classify, golden-tested), one transport (fetch + the shared SSE parser) implementing this interface, its
 * registry and price rows, fixtures — and the contract cases (contract.ts) run against it.
 *
 * Request kinds: 'chat' (text, documents, pictures, tools) and 'decide' (a decision model's typed answers — slice SJ,
 * OpenRouter's decisions API). An adapter lists the kinds it serves; a request of another kind is refused with
 * 'capability' before anything is sent.
 */
import type { AIErrorCode } from './errors.ts'
import type { AIEvent, Caps, ChatRequest, DecideRequest, DecideTurn, KeyCredit, McpPlan, ModelInfo, ProviderId, Turn, UpstreamRule, WireKind, WireRequest } from './types.ts'

/** What a request of a kind gets back. */
export type TurnOf<R extends WireRequest> = R extends DecideRequest ? DecideTurn : Turn

/** What one send needs besides the request. */
export interface SendContext {
  /** the provider key (opened from the vault for this request only) */
  key: string
  /** the model as One knows it (caps, price, the catalogue's wire hints) */
  model: ModelInfo
  signal?: AbortSignal
  onEvent: (e: AIEvent) => void
  /** OpenRouter: the endpoint tags the request may use (`provider.only`) */
  pins?: readonly string[]
  /** OpenRouter: the workspace's upstream rule (deny list, no data collection, zero data retention) */
  upstream?: UpstreamRule
  /** OpenRouter: the app's address (`HTTP-Referer`) */
  referer?: string
  /** OpenRouter, the Jev Router only: the pool (include list) and the exclusions */
  router?: { pool: readonly string[]; exclude: readonly string[] }
  /** OpenRouter, a model priced per request: the price ceiling ($ per million tokens) */
  maxPrice?: { prompt: number; completion: number }
}

export interface BuiltRequest {
  url: string
  body: unknown
  /** never the key — the transport adds it */
  headers: Record<string, string>
}

export type VerifyResult = { ok: true; credit?: KeyCredit } | { ok: false; code: AIErrorCode }

/** What a provider does with the MCP servers a request would take (OpenRouter: none — each one skipped 'provider'). */
export interface McpRendering {
  native: unknown
  skipped: Array<{ server: string; why: 'provider' | 'lock' }>
}

export interface ProviderAdapter {
  id: ProviderId
  /** the request kinds it serves */
  kinds: readonly WireKind[]
  /** PURE: the request as it goes over the wire (golden-tested) */
  build(req: ChatRequest, ctx: Omit<SendContext, 'key' | 'signal' | 'onEvent'>): BuiltRequest
  /** one request, streamed; resolves with the whole turn (a kind it does not serve → AIError 'capability', nothing sent) */
  send<R extends WireRequest>(req: R, ctx: SendContext): Promise<TurnOf<R>>
  mcp(plan: McpPlan, caps: Caps): McpRendering
  /** checks a key without sending any text */
  verify(key: string, signal?: AbortSignal): Promise<VerifyResult>
  models?(key: string, signal?: AbortSignal): Promise<ModelInfo[] | string[]>
  /** true: the adapter retries by itself (Anthropic's SDK); false: the core retries (core/retry.ts) */
  retriesInside: boolean
}
