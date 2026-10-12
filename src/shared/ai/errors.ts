/**
 * Every way an AI request can end in an error, for every provider. The first fourteen are the codes One had before the
 * multi-provider work; the rest name what other providers (and the gate in front of every request) can say.
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
] as const

export type AIErrorCode = (typeof AI_ERROR_CODES)[number]

export const isAIErrorCode = (v: unknown): v is AIErrorCode => typeof v === 'string' && (AI_ERROR_CODES as readonly string[]).includes(v)

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
