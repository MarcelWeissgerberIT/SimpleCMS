/**
 * Multi-provider AI — the shared contracts (pure: compiled by the app and the team server, no DOM, no Node API).
 * Claude (Anthropic) stays the default; OpenAI and OpenRouter join later slices. Every stored shape here is kept by
 * every reader from slice 1 on, before any build writes it (an older reader must never erase a newer build's rules).
 */
import type { AIErrorCode } from './errors.ts'

/** Stored anywhere (routes, rules, the ledger). */
export type ProviderId = 'anthropic' | 'openai' | 'openrouter'
/** Runtime only — 'demo' (canned answers) is never stored; sanitizers refuse it. */
export type RuntimeProviderId = ProviderId | 'demo'
export type Effort = 'low' | 'medium' | 'high'

/** One destination: provider + model (+ effort, clamped to the model's list). */
export interface Route {
  p: ProviderId
  m: string
  effort?: Effort
}
/** 1–3 pins: [first, fallback, fallback]. */
export type RouteRule = Route[]

export type FeatureClass =
  | 'write'
  | 'ask'
  | 'workspace'
  | 'structure'
  | 'vision'
  | 'documents'
  | 'bulk'
  | 'meeting'
  | 'memory'
  | 'outbox'
  | 'terminal'
  | 'agents'
  | 'scripts'
  | 'help'
  | 'review'
  | 'generate'
  | 'mcp-setup'
  | 'gate'
/** Data the workspace decides about (owners / admins in a team). */
export type SharedClass = 'public' | 'structure' | 'selection' | 'page' | 'rows' | 'files' | 'workspace' | 'people' | 'transcript'
/** The member's own data (team): it reaches a provider only with the member's own allow on their device. */
export type MemberClass = 'private' | 'mail' | 'memory' | 'mcp'
export type DataClass = SharedClass | MemberClass

/** What a request carries — the gate classifies each one. */
export type SourceRef =
  /** a page; `as: 'selection'` = only a selection of it goes along (its member classes count, never `page` / `rows`) */
  | { page: string; as?: 'selection' }
  | { row: string }
  | { db: string }
  | { file: 'upload' }
  /** the whole workspace as far as the rules let a route see it (retrieval, scope "everything", terminal search) */
  | { all: true }

export interface Caps {
  structured: boolean
  tools: boolean
  vision: false | { maxEdge: number; maxBytes: number }
  pdf: false | { maxBytes: number; maxPages: number }
  mcp: 'connector' | 'allow-only' | false
  mcpListing: boolean
  cache: 'auto+block' | 'auto' | 'passthrough' | false
  effort: Effort[] | false
  reasoning: false | { mandatory: boolean; minEffort?: string }
  /** 'always' = the model searches the web by itself: refused */
  web: false | 'on-request' | 'always'
  /** progress notes (thinking display "updates", reasoning summaries) */
  notes: boolean
  /** the provider's own refusal fallback to another of its models (Anthropic) */
  refusalFallback: boolean
  context: number
  maxOutput: number
  decisions?: boolean
}

/** $ per million tokens; image / webSearch / request per unit. */
export interface PriceCols {
  input: number
  output: number
  cacheRead: number
  /** 5-minute cache writes */
  cacheWrite: number
  /** 1-hour cache writes */
  cacheWrite1h?: number
  /** a separate price for reasoning tokens (else they are output) */
  reasoning?: number
  image?: number
  webSearch?: number
  request?: number
}
/** Columns that replace the base ones from a prompt size on and / or at UTC days and hours. */
export interface PriceOverride extends Partial<PriceCols> {
  /** prompt tokens (input + cache reads + cache writes) at least */
  minPrompt?: number
  /** 'mon' … 'sun' */
  utcDays?: string[]
  /** hour of the day, 0–23, inclusive */
  utcStart?: number
  /** hour of the day, 1–24, exclusive (a start after the end wraps past midnight) */
  utcEnd?: number
}
export interface PriceRow extends PriceCols {
  overrides?: PriceOverride[]
  /** 'bound' = the stated upper bound of a route priced per request (never stored; costs from it are estimates) */
  source: 'table' | 'catalogue' | 'bound'
  /** the date the prices were read (yyyy-MM-dd) */
  at: string
}

export interface ModelInfo {
  route: Route
  label: string
  short: string
  vendor: string
  role?: 'fast' | 'standard' | 'deep' | 'checker'
  caps: Caps
  price: PriceRow | null
  retired?: true
  /** what the wire needs beyond caps (OpenRouter: the catalogue row's parameters and reasoning list) */
  hints?: WireHints
}

/** A catalogue row's wire facts (OpenRouter): what the request may carry for this model. */
export interface WireHints {
  /** `supported_parameters` */
  params: readonly string[]
  /** the row's `reasoning` object: efforts it takes (null = every effort the gateway knows), mandatory, a token budget */
  reasoning?: { mandatory: boolean; efforts: readonly string[] | null; default?: string; supportsMax: boolean }
  /** 'dynamic' = priced per request (the catalogue lists -1): no price row, a stated bound instead */
  pricing?: 'fixed' | 'dynamic'
}

/** Tokens of one response. `input` never includes cache reads or writes; `output` includes `reasoning`. */
export interface Usage {
  input: number
  cacheWrite: number
  cacheWrite1h: number
  cacheRead: number
  output: number
  reasoning: number
  /** what the provider said the response cost (OpenRouter `usage.cost`) */
  reportedUsd?: number
}

export interface StepNote {
  k:
    | 'capability'
    | 'policy'
    | 'nokey'
    | 'cooldown'
    | 'ceiling'
    | 'context'
    | 'fallback'
    | 'fallthrough'
    | 'refusal-fallback'
    | 'substituted'
    /** a router chose the model that answered (from = the router, to = the served model) */
    | 'routed'
    | 'mcp-skipped'
    | 'upstream'
    | 'staged-instead'
    /** the governor's brake: the answer budget capped (code 'cap', to = the tokens), a model switch at the line (code 'H') */
    | 'brake'
    /** an allowance the person granted (E: +1 $ once — code = the USD) */
    | 'allowance'
    /** the estimate band the request or run was braked on (from = low, to = high, USD) */
    | 'band'
  from?: string
  to?: string
  code?: string
  cls?: DataClass
}

export interface Reservation {
  id: string
  usd: number
  at: number
  source: string
}

export type LedgerRole = 'main' | 'variant' | 'merge' | 'review' | 'fallback' | 'repair' | 'decide'
export type CostSource = 'reported' | 'table' | 'catalogue' | 'estimate' | 'none'

/** One response, metered (per device + member, never synced). Ids and numbers only — never page text. */
export interface LedgerEntry {
  id: string
  at: number
  scope: string
  purpose: string
  cls: FeatureClass
  /** fixed ids only: 'ai:<run>:<action>' | 'terminal:<conv>' | 'agent:<id>:<run>' | 'autofill:<db>:<prop>' … */
  source: string
  role: LedgerRole
  group?: string
  parent?: string
  /** the requested route, 'p:m' */
  route: string
  served: { p: ProviderId; model: string; upstream?: string }
  /** the data classes the request carried (declaration ∪ source classes) — no page ids */
  classes: DataClass[]
  fallbackFrom?: string
  ceilingFrom?: string
  usage: Usage
  /** null = no price known */
  usd: number | null
  costSource: CostSource
  priceAt: string
  mcpCalls: number
  outcome: 'ok' | AIErrorCode
  reservation?: string
  /** what happened on the way (a refusal fallback: another model of the provider answered) */
  steps?: StepNote[]
  /** the governor (G1): the estimate band the request was braked on, USD */
  band?: { low: number; high: number }
  /** the governor: an allowance the person granted for it (E), USD */
  allowance?: number
  /** the governor: the visible answer budget it capped the request to (max_tokens) */
  cap?: number
}

/** OpenRouter upstream rules of the workspace. */
export interface UpstreamRule {
  deny: string[]
  noCollect: boolean
  zdr: boolean
}

export interface ProviderPolicy {
  /** what the workspace lets this provider receive */
  allow: SharedClass[]
  /** member classes the workspace forbids for this provider (it can never allow them) */
  forbid?: MemberClass[]
  upstream?: UpstreamRule
}

export interface Restriction {
  root: string
  to: ProviderId[]
}

/** Workspace.ai — synced; team: meta map `workspace`, key `ai`, written by owners / admins only (server guard). */
export interface WorkspaceAI {
  /** the lowest build generation that enforces every stored rule */
  gen?: number
  policy?: {
    providers: Partial<Record<ProviderId, ProviderPolicy>>
    /** ≤ 200 shared roots; subtree semantics */
    restricted: Restriction[]
  }
  routes?: Partial<Record<FeatureClass | '*', RouteRule>>
  limits?: Partial<Record<ProviderId, { monthUsd: number }>>
  updatedAt?: number
  updatedBy?: string | null
}

/** One model of the person's OpenRouter shortlist (settings.ai.models). */
export interface ShortlistRow {
  m: string
  label: string
  price: PriceRow | null
  caps: Caps
  /** when the row was read from the catalogue (yyyy-MM-dd) */
  at: string
}

/** settings.ai — this device (team: this member on this device); never in defaultSettings(). */
export interface DeviceAI {
  routes?: Partial<Record<FeatureClass, RouteRule>>
  default?: RouteRule
  fallbackForChosen?: boolean
  /** the member's own opt-in for member classes (starts empty) */
  allow?: Partial<Record<ProviderId, MemberClass[]>>
  /** switched off on this device */
  narrow?: Partial<Record<ProviderId, DataClass[]>>
  /** ≤ 200: private pages, or shared pages narrowed for this device */
  restricted?: Restriction[]
  /** the OpenRouter shortlist (≤ 24) */
  models?: ShortlistRow[]
  /** per provider: which model is its fast / standard / deep one (setup step 03; on OpenRouter the Jev Router may be one) */
  roles?: Partial<Record<ProviderId, { fast?: string; standard?: string; deep?: string }>>
  gen?: number
}

/* ------------------------------------------------------------------ */
/* The neutral wire (slice 2): what One asks a provider, what comes back */
/* ------------------------------------------------------------------ */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One part of a message — adapters render it per provider. */
export type Part =
  | { type: 'text'; text: string; cache?: true }
  /** base64, no data: prefix */
  | { type: 'image'; mime: ImageMime; data: string }
  /** a PDF (base64, its page count) or a text document */
  | { type: 'document'; title: string; pdf?: { data: string; pages: number }; text?: string; cache?: true }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; content: string; isError?: true }

export interface Message {
  role: 'user' | 'assistant'
  parts: Part[]
  /** the provider's exact turn, replayed verbatim to the same provider and model (slice 3) */
  native?: { p: ProviderId; m: string; content: unknown; hostedMcp: boolean }
}

/** A JSON schema object (structured outputs, tool inputs). */
export type JsonSchemaObject = Record<string, unknown>

export interface ToolSpec {
  name: string
  description: string
  schema: JsonSchemaObject
}

/** The MCP servers a request would take along (slice 2 renders none for OpenRouter). */
export interface McpPlan {
  servers: Array<{ name: string; url: string; token: string | null; allowed: string[] | null; out: string[]; known: string[] }>
  system: string
  forced: string[]
}

/** A chat request (one-shots in slice 2; the tool loop from slice 3). */
export interface ChatRequest {
  kind: 'chat'
  route: Route
  system: string
  messages: Message[]
  tools?: ToolSpec[]
  output: { kind: 'text' } | { kind: 'json'; name: string; schema: JsonSchemaObject }
  /** the VISIBLE answer budget — adapters add reasoning headroom */
  maxTokens: number
  cache: 'none' | 'auto'
  /** a random per-conversation token (never a page, workspace, run or account id); slice 2 sends none */
  session?: string
}

/* Decision requests (a later slice): the shapes only — slice 2 refuses a 'decide' request before anything is sent. */

export type DecideQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }

export interface DecideRequest {
  kind: 'decide'
  route: Route
  state: Record<string, unknown>
  questions: Record<string, DecideQuestion>
}

export type DecideAnswer =
  | { type: 'noul'; p: number }
  | { type: 'choice'; choice: string; confidence: number | null; probs: Record<string, number> }
  | { type: 'score'; score: number; confidence: number | null; probs: Record<string, number> }

export interface DecideTurn {
  kind: 'decide'
  answers: Record<string, DecideAnswer>
  served: { model: string; upstream?: string }
  usage: Usage | null
}

export type WireRequest = ChatRequest | DecideRequest
export type WireKind = WireRequest['kind']

export type StopReason = 'end' | 'tool_calls' | 'max_tokens' | 'refusal' | 'pause' | 'content_filter'

/** What a stream reports while it runs. */
export type AIEvent =
  | { t: 'text'; delta: string }
  /** a progress note (reasoning shown as it streams) */
  | { t: 'note'; text: string }
  | { t: 'tool_input_error'; id: string; name: string }
  /** the first content of any kind started (text, reasoning, a tool call) — after it nothing is sent again */
  | { t: 'content' }
  /** the model (and the upstream operator) that answers */
  | { t: 'served'; model: string; upstream?: string }
  | { t: 'step'; step: StepNote }
  | { t: 'usage'; usage: Usage }

/** A source the answer cites (a model that searched the web — refused by One). */
export interface Annotation {
  type: 'url_citation'
  url: string
  title?: string
}

/** One chat response, whole. */
export interface Turn {
  kind: 'chat'
  /** the answer: text parts and complete tool calls (a call cut off mid-way is never here) */
  parts: Part[]
  stop: StopReason
  /** null: the response carried no usage report */
  usage: Usage | null
  /** the model that answered (null: not said) */
  served: string | null
  /** the operator that served it (OpenRouter's upstream) */
  upstream?: string
  /** characters that streamed in (text, reasoning, tool input) */
  streamedChars: number
  annotations?: Annotation[]
}

/** A provider key's credit as the provider reports it (no text is ever sent to read it). */
export interface KeyCredit {
  /** the key's own limit (USD; null = none) */
  limit: number | null
  /** what is left of it (null = no limit) */
  remaining: number | null
  /** spent with the key so far (USD) */
  used: number
  /** the account never paid for credit */
  free: boolean
  /** how the limit resets ('daily' · 'weekly' · 'monthly'; null = never) */
  reset: string | null
}
