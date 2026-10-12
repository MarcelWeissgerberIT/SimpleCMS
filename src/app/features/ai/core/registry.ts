/**
 * What One knows of a route, synchronously (D-S2-32): the registry rows of the direct models (src/shared/ai/models.ts)
 * and, for OpenRouter, this device's shortlist (settings.ai.models) — never the catalogue (that is async: only the UI and
 * core/call.ts read it). The Jev Router is a pool over the shortlist: its view is synthesised from the pool's models
 * (caps they all share, the lowest context and answer cap, the most expensive row as its stated price bound).
 */
import type { Caps, ModelInfo, PriceRow, Route, ShortlistRow } from '@/shared/ai/types'
import { labelOf, modelRow, providerLabel, shortOfLabel, vendorOf } from '@/shared/ai/models'
import { DYNAMIC_BOUND, boundOf, boundRow } from '@/shared/ai/prices'
import { JEV_TIERS, isJevRouter } from '@/shared/ai/jev'
import { useWorkspace } from '../../../store/store'

/** This device's OpenRouter shortlist (≤ 24 rows; the router is never one of them). */
export const shortlist = (): ShortlistRow[] => (useWorkspace.getState().settings.ai?.models ?? []).filter((r) => !isJevRouter(r.m))

const row = (m: string): ShortlistRow | null => shortlist().find((r) => r.m === m) ?? null

/** A shortlist row as a model view. */
function shortlistInfo(route: Route, r: ShortlistRow): ModelInfo {
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

/**
 * The Jev Router's view for a pool (shortlist ids): caps they all share, the bound of the most expensive pool row
 * (D-S2-24). An empty pool: no caps worth sending to (structured / tools false) and the stated bound.
 */
export function routerInfo(route: Route, pool: readonly string[]): ModelInfo {
  const rows = pool.map(row).filter((r): r is ShortlistRow => !!r)
  const price = rows.length ? boundOf(rows) : boundRow({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output, cacheRead: DYNAMIC_BOUND.input, cacheWrite: DYNAMIC_BOUND.input })
  return { route, label: 'Jev Router', short: 'JEV ROUTER', vendor: '*', caps: poolCaps(rows.map((r) => r.caps)), price }
}

/** The model view of a route (null: unknown here — a gone shortlist model, a wrong id: 'model_gone'). */
export function modelInfo(route: Route, pool?: readonly string[]): ModelInfo | null {
  const r = modelRow(route)
  if (r) return { route: r.route.m === route.m ? { ...r.route, ...(route.effort ? { effort: route.effort } : {}) } : route, label: r.label, short: r.short, vendor: r.vendor, ...(r.role ? { role: r.role } : {}), caps: r.caps, price: r.price }
  if (route.p !== 'openrouter') return null
  if (isJevRouter(route.m)) return routerInfo(route, pool ?? [])
  const s = row(route.m)
  return s ? shortlistInfo(route, s) : null
}

export const capsFor = (route: Route, pool?: readonly string[]): Caps | null => modelInfo(route, pool)?.caps ?? null

/**
 * The price a route is estimated and reserved with: the table, else the shortlist row, else the stated bound of a route
 * priced per request (the router: its pool's bound) — never 0 for a dynamic route (D-S2-24).
 */
export function priceFor(route: Route, pool?: readonly string[]): PriceRow | null {
  const info = modelInfo(route, pool)
  if (info?.price) return info.price
  if (route.p === 'openrouter' && info) return boundRow({ input: DYNAMIC_BOUND.input, output: DYNAMIC_BOUND.output, cacheRead: DYNAMIC_BOUND.input, cacheWrite: DYNAMIC_BOUND.input })
  return null
}

/** "OpenRouter · <label>" where the provider is not otherwise said (D19 / D-S2-20); Claude's own labels as they were. */
export function labelFor(route: Route, pool?: readonly string[]): string {
  if (route.p === 'anthropic') return labelOf(route)
  const info = modelInfo(route, pool)
  return info ? `${providerLabel(route.p)} · ${info.label}` : labelOf(route)
}

/** The short label (a chip's), else the model id's last part. */
export function shortFor(route: Route, pool?: readonly string[]): string {
  return modelInfo(route, pool)?.short ?? (route.m.split('/').pop() ?? route.m).toUpperCase().slice(0, 16)
}

/** A served model's label for a receipt: the shortlist's, else the slug's model part. */
export function servedLabel(p: Route['p'], model: string): string {
  if (p !== 'openrouter') return labelOf({ p, m: model })
  return row(model)?.label ?? model.split('/').pop() ?? model
}

/** A served model's price (the router's answer without a reported cost: priced at the model that served it). */
export function servedPrice(model: string): PriceRow | null {
  return row(model)?.price ?? null
}
