/**
 * The Jev Router's view over a pool and a shortlist row's view (pure: the gate's registry and the Node specs use them).
 * The router may send a request to any pool model: its caps are what they all share, its context and answer cap the
 * pool's lowest, its price the stated bound of the most expensive pool row (D-S2-22 / 24).
 */
import type { Caps, ModelInfo, Route, ShortlistRow } from '@/shared/ai/types'
import { shortOfLabel, vendorOf } from '@/shared/ai/models'
import { DYNAMIC_BOUND, boundOf, boundRow } from '@/shared/ai/prices'
import { JEV_TIERS } from '@/shared/ai/jev'

/** A shortlist row as a model view. */
export function shortlistInfo(route: Route, r: ShortlistRow): ModelInfo {
  return { route, label: r.label, short: shortOfLabel(r.label), vendor: vendorOf(route), caps: r.caps, price: r.price }
}

/** The caps every pool model shares (the router may send to any of them). */
export function poolCaps(pool: readonly Caps[]): Caps {
  const all = (f: (c: Caps) => boolean) => pool.length > 0 && pool.every(f)
  const min = (f: (c: Caps) => number) => (pool.length ? Math.min(...pool.map(f)) : 0)
  const vision = all((c) => !!c.vision) ? { maxEdge: min((c) => (c.vision ? c.vision.maxEdge : 0)), maxBytes: min((c) => (c.vision ? c.vision.maxBytes : 0)) } : false
  const pdf = all((c) => !!c.pdf) ? { maxBytes: min((c) => (c.pdf ? c.pdf.maxBytes : 0)), maxPages: min((c) => (c.pdf ? c.pdf.maxPages : 0)) } : false
  return {
    structured: all((c) => c.structured),
    tools: all((c) => c.tools),
    vision,
    pdf,
    mcp: false,
    mcpListing: false,
    cache: 'auto',
    // on a router route the effort IS the cost tier (never sent as reasoning effort)
    effort: [...JEV_TIERS],
    reasoning: false,
    web: false,
    notes: pool.some((c) => c.notes),
    refusalFallback: false,
    context: min((c) => c.context) || 1,
    maxOutput: min((c) => c.maxOutput) || 1,
  }
}

/** The Jev Router's view over the pool's shortlist rows. */
export function routerView(route: Route, rows: readonly ShortlistRow[]): ModelInfo {
  const price = rows.length ? boundOf(rows) : boundRow({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output, cacheRead: DYNAMIC_BOUND.input, cacheWrite: DYNAMIC_BOUND.input })
  return { route, label: 'Jev Router', short: 'JEV ROUTER', vendor: '*', caps: poolCaps(rows.map((r) => r.caps)), price }
}

