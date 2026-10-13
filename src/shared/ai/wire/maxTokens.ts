/**
 * The ONE answer-budget rule on the wire (Regler G1, design § 5.5): what a request's `max_tokens` is for a visible answer
 * budget on a route — the estimate's upper end, the brake's cap and every wire build() use it, so a reservation is
 * never below what the wire allows. Pure (app + team server).
 *
 *  - Anthropic: the visible budget as it is (thinking sits inside max_tokens).
 *  - OpenRouter: the visible budget + reasoning room where the wire adds it — the Jev Router (any pool model may reason),
 *    a model that reasons mandatorily, or one whose catalogue row lists `reasoning` and the route asks for an effort —
 *    capped at the model's output limit.
 *  - OpenAI (S4 brings its wire): until then the S1 estimate's rule — a model that must reason gets the same room on
 *    top (no body is built from it yet, only estimates).
 */
import type { Caps, Route, WireHints } from '../types.ts'
import { isJevRouter } from '../jev.ts'

/**
 * Claude: does the model think inside max_tokens (adaptive thinking — Opus / Sonnet 5.5: an effort and the refusal
 * fallback)? Its answer budget then holds the thinking too (the brake's smallest useful answer is larger there).
 */
export const thinksInside = (caps: Pick<Caps, 'effort' | 'refusalFallback'> | null | undefined): boolean => !!caps && caps.effort !== false && caps.refusalFallback

/** Reasoning room on top of the visible answer: max(1 024, 4 × the answer budget), never above the model's output cap. */
export function headroom(maxTokens: number, caps: Pick<Caps, 'maxOutput'>): number {
  return Math.max(0, Math.min(caps.maxOutput, Math.max(1024, 4 * Math.max(0, Math.round(maxTokens)))))
}

/** How an OpenRouter request reasons: the router, a mandatory reasoner, and whether the body carries `reasoning`. */
export function reasoningOf(route: Pick<Route, 'm' | 'effort'>, caps: Pick<Caps, 'reasoning'>, hints?: WireHints | null): { router: boolean; mandatory: boolean; reasons: boolean } {
  const router = isJevRouter(route.m)
  const r = hints?.reasoning
  const mandatory = !!r?.mandatory || (caps.reasoning !== false && caps.reasoning.mandatory)
  // reasoning only where the catalogue lists it — never on the router (it picks the effort; max_tokens / mode → 400)
  const reasons = !router && !!hints?.params.includes('reasoning') && (mandatory || !!route.effort)
  return { router, mandatory, reasons }
}

/**
 * The request's max_tokens for a visible answer budget. `caps` null (a model this build knows nothing of): the visible
 * budget.
 */
export function wireMaxTokens(route: Pick<Route, 'p' | 'm' | 'effort'>, visible: number, caps: Pick<Caps, 'maxOutput' | 'reasoning'> | null | undefined, hints?: WireHints | null): number {
  const v = Math.max(1, Math.round(visible))
  if (!caps) return v
  if (route.p === 'openai') return caps.reasoning !== false && caps.reasoning.mandatory ? Math.max(1, Math.min(caps.maxOutput, v + headroom(v, caps))) : v
  if (route.p !== 'openrouter') return v
  const { router, mandatory, reasons } = reasoningOf(route, caps, hints)
  // the visible answer + reasoning room: models that reason (always the router — any pool model may), capped
  const room = router || reasons || mandatory ? headroom(v, caps) : 0
  return Math.max(1, Math.min(caps.maxOutput, v + room))
}
