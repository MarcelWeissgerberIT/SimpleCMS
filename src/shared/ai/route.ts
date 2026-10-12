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
