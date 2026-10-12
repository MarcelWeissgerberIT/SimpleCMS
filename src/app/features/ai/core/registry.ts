/**
 * What One knows of a route, synchronously (D-S2-32): the registry rows of the direct models (src/shared/ai/models.ts)
 * and, for OpenRouter, this device's shortlist (settings.ai.models) — never the catalogue (that is async: only the UI and
 * core/call.ts read it). The Jev Router is a pool over the shortlist: its view is synthesised from the pool's models
 * (caps they all share, the lowest context and answer cap, the most expensive row as its stated price bound).
 */
import type { Caps, ModelInfo, PriceRow, Route, ShortlistRow } from '@/shared/ai/types'
import { labelOf, modelRow, providerLabel } from '@/shared/ai/models'
import { DYNAMIC_BOUND, boundRow } from '@/shared/ai/prices'
import { isJevRouter } from '@/shared/ai/jev'
import { useWorkspace } from '../../../store/store'
import { routerView, shortlistInfo } from './pool'

export { poolCaps, routerView, shortlistInfo } from './pool'

/** This device's OpenRouter shortlist (≤ 24 rows; the router is never one of them). */
export const shortlist = (): ShortlistRow[] => (useWorkspace.getState().settings.ai?.models ?? []).filter((r) => !isJevRouter(r.m))

const row = (m: string): ShortlistRow | null => shortlist().find((r) => r.m === m) ?? null

/**
 * The Jev Router's view for a pool (shortlist ids): caps they all share, the bound of the most expensive pool row
 * (D-S2-24). An empty pool: no caps worth sending to (structured / tools false) and the stated bound.
 */
export const routerInfo = (route: Route, pool: readonly string[]): ModelInfo => routerView(route, pool.map(row).filter((r): r is ShortlistRow => !!r))

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
