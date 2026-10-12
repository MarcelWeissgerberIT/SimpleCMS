/**
 * Routes and rules as stored (agents, workspace and device rules): sanitised by every reader. Only the stored providers
 * pass ('demo' and anything unknown are refused); a model id must pass its provider's validator.
 */
import type { Route, RouteRule } from './types.ts'
import { DEFAULT_CLAUDE_MODEL, EFFORTS, MODELS, isProviderId, modelIdProblem } from './models.ts'
import { isJevModel, isJevSnapshot } from './jev.ts'

export const MAX_PINS = 3

/** A stored route, or null when it is not one. */
export function sanitizeRoute(v: unknown): Route | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (!isProviderId(r.p) || typeof r.m !== 'string' || modelIdProblem(r.p, r.m) !== null) return null
  const effort = typeof r.effort === 'string' && (EFFORTS as readonly string[]).includes(r.effort) ? (r.effort as Route['effort']) : undefined
  return { p: r.p, m: r.m, ...(effort ? { effort } : {}) }
}

/**
 * A stored rule: 1–3 valid pins (repeats dropped), or null. One pin this build cannot read makes the whole rule
 * unreadable — dropping it would move the next pin up (a fallback becoming pin 1).
 */
export function sanitizeRule(v: unknown): RouteRule | null {
  if (!Array.isArray(v) || !v.length || v.length > 16) return null
  const out: RouteRule = []
  for (const x of v) {
    const r = sanitizeRoute(x)
    if (!r) return null
    if (out.some((o) => o.p === r.p && o.m === r.m)) continue
    out.push(r)
  }
  return out.length <= MAX_PINS ? out : null
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

/** An agent's reviewer (advisory only): its pins and what a "block" does — review v1 (S7's chat reviewer). */
export interface AgentReview {
  route: RouteRule
  mode: 'mark' | 'hold'
}

/**
 * An agent's Vorprüfer (slice SJ) — review v2, a versioned envelope that NEVER has a top-level `route` (S1 / S2 readers
 * would take it for a v1 reviewer and run the agent): Jev pre-checks the run's proposals (`pre`) and may make an
 * apply-mode run wait as a whole (`gate`, the Schreibschranke). Older builds read it as Unreadable (kept, not run).
 */
export interface AgentReviewV2 {
  v: 2
  /** the agent's own Vorprüfer (absent: the class rule `gate`) — a Jev version */
  decider?: Route
  /** the snapshot the person confirmed ('openrouter:' + a dated Jev snapshot, jev.ts) — another one holds until confirmed */
  on: string
  /** the Vorprüfung: mark below `markBelow` (0.30–0.95), hold what Jev marks or could not check (`hold`) */
  pre: { markBelow: number; hold: boolean }
  /** the Schreibschranke: an apply-mode run writes only when every check is at or above `allowAt` (0.80–0.99) */
  gate?: { allowAt: number } | null
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
  review?: AgentReview | AgentReviewV2 | null | Unreadable
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

/** Exactly these keys (and only own, plain data). */
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))

/** A threshold as stored: a finite number in [min, max] with at most two decimals (null: not one). */
function hundredths(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null
  return Math.abs(Math.round(v * 100) - v * 100) < 1e-6 ? Math.round(v * 100) / 100 : null
}

/** A Vorprüfer route: OpenRouter + a pinned Jev version, nothing else (no effort, no other key). */
function readDecider(v: unknown): Route | null {
  if (!isObj(v) || !onlyKeys(v, ['p', 'm']) || v.p !== 'openrouter' || !isJevModel(v.m)) return null
  return sanitizeRoute(v)
}

/** Is this a confirmed Jev snapshot ('openrouter:<a Jev version or its dated snapshot>')? */
export const isJevKey = (v: unknown): v is string => isRouteKey(v) && v.startsWith('openrouter:') && isJevSnapshot(v.slice('openrouter:'.length))

/**
 * Review v2, all or nothing (DJ10 r2): keys ⊆ { v, decider, on, pre, gate }, `pre` ⊆ { markBelow, hold }, `gate` ⊆ {
 * allowAt }, the numbers in range with ≤ 2 decimals, `decider` a Jev version, `on` a Jev snapshot — anything else is
 * unreadable (kept, the agent does not run). S7 extends the key set with its own reader.
 */
function readReviewV2(v: Record<string, unknown>): AgentReviewV2 | null {
  if (v.v !== 2 || !onlyKeys(v, ['v', 'decider', 'on', 'pre', 'gate'])) return null
  const pre = v.pre
  if (!isObj(pre) || !onlyKeys(pre, ['markBelow', 'hold']) || typeof pre.hold !== 'boolean') return null
  const markBelow = hundredths(pre.markBelow, 0.3, 0.95)
  if (markBelow === null) return null
  let gate: AgentReviewV2['gate']
  if (v.gate === null) gate = null
  else if (v.gate !== undefined) {
    if (!isObj(v.gate) || !onlyKeys(v.gate, ['allowAt'])) return null
    const allowAt = hundredths(v.gate.allowAt, 0.8, 0.99)
    if (allowAt === null) return null
    gate = { allowAt }
  }
  let decider: Route | undefined
  if (v.decider !== undefined) {
    const d = readDecider(v.decider)
    if (!d) return null
    decider = d
  }
  if (!isJevKey(v.on)) return null
  return { v: 2, ...(decider ? { decider } : {}), on: v.on, pre: { markBelow, hold: pre.hold }, ...(gate !== undefined ? { gate } : {}) }
}

/**
 * A stored reviewer: v1 `{ route, mode }` read as it always was (S7's chat reviewer), a versioned envelope strictly
 * (v2: the Vorprüfer; any other version: null). null = not readable here.
 */
export function readReview(v: unknown): AgentReview | AgentReviewV2 | null {
  if (!isObj(v)) return null
  if ('v' in v) return readReviewV2(v)
  const r = sanitizeRule(v.route)
  return r ? { route: r, mode: v.mode === 'hold' ? 'hold' : 'mark' } : null
}

/** The agent's Vorprüfer settings (null: none — no review, or a v1 reviewer; 'unreadable': kept, the agent does not run). */
export function decisionChecks(a: AgentAIFields): Omit<AgentReviewV2, 'v'> | null | 'unreadable' {
  if (a.review === undefined || a.review === null) return null
  const r = readReview(a.review)
  if (!r) return 'unreadable'
  if (!('v' in r)) return null
  return { ...(r.decider ? { decider: r.decider } : {}), on: r.on, pre: { ...r.pre }, ...(r.gate !== undefined ? { gate: r.gate ? { ...r.gate } : null } : {}) }
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
 * A server build of this slice runs only agents whose first pin is Claude (null / absent = legacy), whose multi-provider
 * fields it can all read, and without a Vorprüfer (decision models reach the server with S9 — DJ14) — anything else waits
 * for a newer version (fail closed).
 */
export function runsOnClaude(a: AgentAIFields): boolean {
  const route = readAgentRoute(a.route)
  if (route === 'unreadable' || !agentAIReadable(a)) return false
  if (decisionChecks(a) !== null) return false
  return !route || route[0]?.p === 'anthropic'
}
