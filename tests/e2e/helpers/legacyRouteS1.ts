/**
 * A FROZEN copy of the agent-field readers of slice 1 (src/shared/ai/route.ts at branch ai-s1, 5e81d9f — identical in
 * slice 2): what a tab of an older build does with a stored agent. ai-decide.spec proves that such a tab keeps review v2
 * byte for byte and refuses to run the agent (DJ10 r2). Never edit to follow the current code — it stands for builds
 * already shipped. The id validators it calls (sanitizeRoute / sanitizeRule) are unchanged since slice 1.
 */
import type { Route, RouteRule } from '../../../src/shared/ai/types'
import { sanitizeRoute, sanitizeRule } from '../../../src/shared/ai/route'

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

declare const UNREAD: unique symbol
/**
 * A stored agent field this build cannot read (a newer version's provider or model id, a shape it does not know): kept
 * as it was — a save from this tab writes it back unchanged — and never acted on: the agent does not run here.
 */
export type Unreadable = { readonly [UNREAD]: true }

/** The multi-provider fields of a custom agent, as every reader keeps them (absent stays absent). */
export interface AgentAIFields {
  /** own pins (null = the workspace / device rule for agents) */
  route?: RouteRule | null | Unreadable
  review?: AgentReview | null | Unreadable
  saverRule?: SaverRule | null | Unreadable
  /** the 'p:m' the person confirmed apply-mode on */
  applyOn?: string | Unreadable
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

const MAX_OPAQUE = 4000

/** A stored value kept unread: its JSON copy (too big or no JSON: a marker that still reads as unreadable). */
function opaque(v: unknown): Unreadable {
  try {
    const s = JSON.stringify(v)
    if (typeof s === 'string' && s.length <= MAX_OPAQUE) return JSON.parse(s) as Unreadable
  } catch {
    /* not JSON */
  }
  return { unreadable: true } as unknown as Unreadable
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function readReview(v: unknown): AgentReview | null {
  if (!isObj(v)) return null
  const r = sanitizeRule(v.route)
  return r ? { route: r, mode: v.mode === 'hold' ? 'hold' : 'mark' } : null
}

function readSaver(v: unknown): SaverRule | null {
  if (!isObj(v)) return null
  const to = sanitizeRoute(v.to)
  return to && typeof v.overUsd === 'number' && Number.isFinite(v.overUsd) && v.overUsd > 0 && v.overUsd <= 1000 ? { overUsd: v.overUsd, to } : null
}

/**
 * The multi-provider fields of a stored agent object. A field this build reads is kept sanitised; one it cannot read is
 * kept as it was (Unreadable) — never dropped, so the agent never runs on a route nobody chose (agentAIReadable).
 */
export function sanitizeAgentAI(v: Record<string, unknown>): AgentAIFields {
  const out: AgentAIFields = {}
  const keep = <T>(raw: unknown, read: (x: unknown) => T | null): T | null | Unreadable | undefined => (raw === undefined ? undefined : raw === null ? null : (read(raw) ?? opaque(raw)))
  const route = keep(v.route, sanitizeRule)
  if (route !== undefined) out.route = route
  const review = keep(v.review, readReview)
  if (review !== undefined) out.review = review
  const saverRule = keep(v.saverRule, readSaver)
  if (saverRule !== undefined) out.saverRule = saverRule
  if (v.applyOn !== undefined && v.applyOn !== null) out.applyOn = isRouteKey(v.applyOn) ? v.applyOn : opaque(v.applyOn)
  if (typeof v.routeSig === 'string' && SIG_RE.test(v.routeSig)) out.routeSig = v.routeSig
  return out
}

/** An agent's own pins as this build reads them: null = none (the legacy level), 'unreadable' = kept, not run here. */
export function readAgentRoute(route: AgentAIFields['route']): RouteRule | null | 'unreadable' {
  if (route === undefined || route === null) return null
  return sanitizeRule(route) ?? 'unreadable'
}

/** Can this build read every multi-provider field the agent holds? (One it cannot read: the agent does not run.) */
export function agentAIReadable(a: AgentAIFields): boolean {
  if (readAgentRoute(a.route) === 'unreadable') return false
  if (a.review !== undefined && a.review !== null && !readReview(a.review)) return false
  if (a.saverRule !== undefined && a.saverRule !== null && !readSaver(a.saverRule)) return false
  if (a.applyOn !== undefined && !isRouteKey(a.applyOn)) return false
  return true
}

/**
 * A browser / server build of this slice runs only agents whose first pin is Claude (null / absent = legacy) and whose
 * multi-provider fields it can all read — anything else waits for a newer version (fail closed).
 */
export function runsOnClaude(a: AgentAIFields): boolean {
  const route = readAgentRoute(a.route)
  if (route === 'unreadable' || !agentAIReadable(a)) return false
  return !route || route[0]?.p === 'anthropic'
}
