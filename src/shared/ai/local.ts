/**
 * A model server on this computer (provider 'local', slice 1): an OpenAI-compatible Chat Completions server such as
 * Ollama, reached from this browser at a loopback address. Pure (app + team server): the address rule, the stored
 * config's reader, what such a model can do for One, its price (none: $0) and the context budget a loop checks before
 * every round (Ollama cuts a too-long prompt from the FRONT, silently — One stops first).
 *
 * Only this device's rules name it (settings.ai.local + settings.ai.routes.terminal); a workspace rule or an agent's
 * route never does (policy.ts / route.ts refuse it). The team cloud is refused (core/resolve.ts).
 */
import type { Caps, LocalConfig, PriceRow } from './types.ts'

export const LOCAL_DEFAULT_BASE = 'http://127.0.0.1:11434/v1'
export const LOCAL_DEFAULT_CONTEXT = 32768
export const LOCAL_MIN_CONTEXT = 2048
export const LOCAL_MAX_CONTEXT = 1_048_576
/** The answer budget of one local round (a code model's step: a tool call or a short summary) */
export const LOCAL_MAX_TOKENS = 4096
/** A tool result as a local round carries it, at most (the context is small) */
export const LOCAL_RESULT_CHARS = 6000
/** Characters per token for the local context check — on the low side, so One stops before the server cuts */
export const LOCAL_CHARS_PER_TOKEN = 3

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The base URL One sends to, or null when it is not a loopback address: http(s) only, host 127.0.0.1 · localhost · [::1]
 * (any port), no user or password, no query or fragment. The path ends in /v1 (a pasted …/v1/chat/completions or
 * …/v1/models is cut back; a path without /v1 gets it).
 */
export function localBase(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > 300) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.search || u.hash || raw.includes('#') || raw.includes('?')) return null
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return null
  let path = u.pathname.replace(/\/+$/, '')
  path = path.replace(/\/(chat\/completions|models)$/, '')
  if (!/\/v1$/.test(path)) path = `${path}/v1`
  if (!/^(\/[A-Za-z0-9._~-]+)*$/.test(path)) return null
  return `${u.protocol}//${u.host.toLowerCase()}${path}`
}

/** A model name as local servers list it ('marcel-coder', 'qwen3-coder:30b', 'hf.co/org/repo:Q4_K_M'). */
export const LOCAL_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** settings.ai.local as every reader keeps it (undefined: none, or not valid — an address that is not loopback). */
export function sanitizeLocal(v: unknown): LocalConfig | undefined {
  if (!isObj(v)) return undefined
  const base = localBase(v.base)
  const model = typeof v.model === 'string' ? v.model.trim() : ''
  if (!base || !LOCAL_MODEL_RE.test(model)) return undefined
  const c = typeof v.context === 'number' && Number.isFinite(v.context) ? Math.round(v.context) : LOCAL_DEFAULT_CONTEXT
  return { base, model, context: Math.min(LOCAL_MAX_CONTEXT, Math.max(LOCAL_MIN_CONTEXT, c)) }
}

/**
 * What a local model can do for One in slice 1: function tools — nothing else (no pictures, PDFs, MCP, caching,
 * effort, thinking notes, web or refusal fallback; One never asks it for a structured answer).
 */
export function localCaps(context: number = LOCAL_DEFAULT_CONTEXT): Caps {
  return {
    structured: false,
    tools: true,
    vision: false,
    pdf: false,
    mcp: false,
    mcpListing: false,
    cache: false,
    effort: false,
    reasoning: false,
    web: false,
    notes: false,
    refusalFallback: false,
    context,
    maxOutput: LOCAL_MAX_TOKENS,
  }
}

/** It runs on this computer: no price per token ($0 — a known price, never "no price"). */
export const LOCAL_PRICE: PriceRow = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, source: 'table', at: '2026-10-19' }

/** The tokens a prompt of `chars` characters counts as for the local check (rounded up). */
export const localTokens = (chars: number): number => Math.ceil(Math.max(0, chars) / LOCAL_CHARS_PER_TOKEN)

/**
 * Does the next round fit the server's context window with room for its answer? `limit` = context − answer budget.
 * Over it, the loop stops ('context') instead of letting the server cut the conversation's start.
 */
export function localFits(promptChars: number, context: number, maxTokens: number = LOCAL_MAX_TOKENS): { tokens: number; limit: number; fits: boolean } {
  const tokens = localTokens(promptChars)
  const limit = Math.max(0, context - maxTokens)
  return { tokens, limit, fits: tokens <= limit }
}
