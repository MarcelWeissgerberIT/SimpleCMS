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
  | { page: string }
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
  source: 'table' | 'catalogue'
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
    | 'mcp-skipped'
    | 'upstream'
    | 'staged-instead'
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
  gen?: number
}
