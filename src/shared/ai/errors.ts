/**
 * Every way an AI request can end in an error, for every provider. The first fourteen are the codes One had before the
 * multi-provider work; the rest name what other providers (and the gate in front of every request, and the governor's
 * brake behind it) can say.
 */
export const AI_ERROR_CODES = [
  'no_key',
  'invalid_key',
  'permission',
  'rate_limit',
  'overloaded',
  'offline',
  /** the tab runs an older build whose files are gone from the server: reload */
  'outdated',
  'bad_request',
  /** an MCP server could not be used */
  'mcp',
  /** an MCP server rejected its token */
  'mcp_auth',
  'refusal',
  'empty',
  'aborted',
  'unknown',
  /** no credit left at the provider (or a spend limit reached) */
  'no_credit',
  /** the provider is busy for this key right now (in-flight budget): the same route again */
  'busy',
  'unavailable',
  'timeout',
  /** the provider's moderation refused the request */
  'moderation',
  /** the request does not fit the model's context window */
  'context',
  /** the model cannot do what the request needs (images, PDFs, tools, MCP …) */
  'capability',
  /** the AI data rules do not let this provider receive what the request carries */
  'policy',
  /** no route could be resolved for the request */
  'no_route',
  /** AI is switched off (the governor's AUS) */
  'off',
  /** no upstream of the provider serves the model under the rules (OpenRouter) */
  'no_endpoint',
  /** the model is gone (retired, unknown) */
  'model_gone',
  /** the typed text looks like an API key: refused, never sent */
  'key_in_text',
  /** this workspace has AI rules this tab does not know yet: reload */
  'reload',
  /** the governor's red line: the request does not fit the rest of a budget (refused before sending — never falls back) */
  'budget',
] as const

export type AIErrorCode = (typeof AI_ERROR_CODES)[number]

export const isAIErrorCode = (v: unknown): v is AIErrorCode => typeof v === 'string' && (AI_ERROR_CODES as readonly string[]).includes(v)

/**
 * The detail of a 'budget' refusal: which line binds (the workspace's day / month, this browser's own day / month, the
 * run's own budget), no price for the route (the budget cannot be kept), or the account still loading (no scope to
 * count against).
 */
export const BUDGET_DETAILS = ['day', 'month', 'device-day', 'device-month', 'run', 'noprice', 'scope'] as const
export type BudgetDetail = (typeof BUDGET_DETAILS)[number]
export const isBudgetDetail = (v: unknown): v is BudgetDetail => typeof v === 'string' && (BUDGET_DETAILS as readonly string[]).includes(v)

/**
 * What an error lets the core do: 'switch' = the next pin of the winning rule may answer (only before the first content
 * block, never after an MCP call), 'same' = the same route again after a pause, 'never' = the error stands.
 */
export function fallbackOf(code: AIErrorCode): 'switch' | 'same' | 'never' {
  switch (code) {
    case 'rate_limit':
    case 'overloaded':
    case 'unavailable':
    case 'timeout':
    case 'offline':
    case 'no_credit':
    case 'no_endpoint':
    case 'model_gone':
      return 'switch'
    case 'busy':
      return 'same'
    default:
      return 'never'
  }
}

/**
 * A provider's failure as a transport reports it (pure — a transport never loads the store or the UI's texts): the
 * code, the scrubbed detail, how far the request got (`reach`: 'none' = never sent, no ledger entry · 'refused' = every
 * attempt answered with an error status, nothing billed · 'sent' = in flight or answered, an estimate), the turn so far
 * and the provider's wait hint. The core turns it into the app's AIError with the friendly text.
 */
export class ProviderError extends Error {
  readonly code: AIErrorCode
  readonly detail?: string
  readonly reach: 'none' | 'refused' | 'sent'
  /** the turn so far (a stream cut or failed mid-way) */
  readonly partial?: unknown
  /** ms to wait before the same request again (Retry-After) */
  readonly retryAfter?: number
  /** OpenRouter's limit source (busy vs no credit) */
  readonly limitSource?: string
  /** the HTTP status of a refusal */
  readonly status?: number
  constructor(code: AIErrorCode, detail: string | undefined, o: { reach: 'none' | 'refused' | 'sent'; partial?: unknown; retryAfter?: number; limitSource?: string; status?: number }) {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'ProviderError'
    this.code = code
    this.detail = detail
    this.reach = o.reach
    if (o.partial !== undefined) this.partial = o.partial
    if (o.retryAfter !== undefined) this.retryAfter = o.retryAfter
    if (o.limitSource !== undefined) this.limitSource = o.limitSource
    if (o.status !== undefined) this.status = o.status
  }
}
