/**
 * Routes and rules as stored (agents, workspace and device rules): sanitised by every reader. Only the stored providers
 * pass ('demo' and anything unknown are refused); a model id must pass its provider's validator.
 */
import type { Route, RouteRule } from './types.ts'
import { DEFAULT_CLAUDE_MODEL, EFFORTS, MODELS, isProviderId, modelIdProblem } from './models.ts'

export const MAX_PINS = 3

/** A stored route, or null when it is not one. */
export function sanitizeRoute(v: unknown): Route | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (!isProviderId(r.p) || typeof r.m !== 'string' || modelIdProblem(r.p, r.m) !== null) return null
  const effort = typeof r.effort === 'string' && (EFFORTS as readonly string[]).includes(r.effort) ? (r.effort as Route['effort']) : undefined
  return { p: r.p, m: r.m, ...(effort ? { effort } : {}) }
}

/** A stored rule: 1–3 valid pins (invalid ones and repeats dropped), or null when none is left. */
export function sanitizeRule(v: unknown): RouteRule | null {
  if (!Array.isArray(v)) return null
  const out: RouteRule = []
  for (const x of v) {
    const r = sanitizeRoute(x)
    if (!r || out.some((o) => o.p === r.p && o.m === r.m)) continue
    out.push(r)
    if (out.length >= MAX_PINS) break
  }
  return out.length ? out : null
}

/** 'p:m' — the key of a route in the ledger, receipts and trust. */
export const routeKey = (r: Pick<Route, 'p' | 'm'>): string => `${r.p}:${r.m}`

/** The Claude models today's code sends (an unknown setting falls back to the default, as it always did). */
const LEGACY_IDS = MODELS.filter((x) => x.route.p === 'anthropic' && x.selectable).map((x) => x.route.m)

/** The legacy level: Claude with the device's model, only with a Claude key — what One did before routes existed. */
export function legacyRule(aiModel: string | null | undefined, hasKey: boolean): RouteRule {
  if (!hasKey) return []
  return [{ p: 'anthropic', m: aiModel && LEGACY_IDS.includes(aiModel) ? aiModel : DEFAULT_CLAUDE_MODEL }]
}

/** An agent's reviewer (advisory only): its pins and what a "block" does. */
export interface AgentReview {
  route: RouteRule
  mode: 'mark' | 'hold'
}

/** The saver rule (governor): above this run cost, scheduled runs use another route. */
export interface SaverRule {
  overUsd: number
  to: Route
}

/** The multi-provider fields of a custom agent, as every reader keeps them (absent stays absent). */
export interface AgentAIFields {
  /** own pins (null = the workspace / device rule for agents) */
  route?: RouteRule | null
  review?: AgentReview | null
  saverRule?: SaverRule | null
  /** the 'p:m' the person confirmed apply-mode on */
  applyOn?: string
  /** the inherited workspace rule at the creator's last save (a hash) */
  routeSig?: string
}

const ROUTE_KEY_RE = /^(anthropic|openai|openrouter):(.+)$/
const SIG_RE = /^[A-Za-z0-9:_-]{1,128}$/

/** Is this a 'p:m' of a stored provider with a valid model id? */
export function isRouteKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 200) return false
  const m = v.match(ROUTE_KEY_RE)
  return !!m && sanitizeRoute({ p: m[1], m: m[2] }) !== null
}

/** The multi-provider fields of a stored agent object (only those that hold; 'demo' and unknown providers dropped). */
export function sanitizeAgentAI(v: Record<string, unknown>): AgentAIFields {
  const out: AgentAIFields = {}
  if (v.route === null) out.route = null
  else {
    const r = sanitizeRule(v.route)
    if (r) out.route = r
  }
  if (v.review === null) out.review = null
  else if (v.review && typeof v.review === 'object' && !Array.isArray(v.review)) {
    const x = v.review as Record<string, unknown>
    const r = sanitizeRule(x.route)
    if (r) out.review = { route: r, mode: x.mode === 'hold' ? 'hold' : 'mark' }
  }
  if (v.saverRule === null) out.saverRule = null
  else if (v.saverRule && typeof v.saverRule === 'object' && !Array.isArray(v.saverRule)) {
    const x = v.saverRule as Record<string, unknown>
    const to = sanitizeRoute(x.to)
    if (to && typeof x.overUsd === 'number' && Number.isFinite(x.overUsd) && x.overUsd > 0 && x.overUsd <= 1000) out.saverRule = { overUsd: x.overUsd, to }
  }
  if (isRouteKey(v.applyOn)) out.applyOn = v.applyOn
  if (typeof v.routeSig === 'string' && SIG_RE.test(v.routeSig)) out.routeSig = v.routeSig
  return out
}

/** A browser / server build of this slice runs only agents whose first pin is Claude (null / absent = legacy). */
export const runsOnClaude = (route: RouteRule | null | undefined): boolean => !route || route[0]?.p === 'anthropic'
