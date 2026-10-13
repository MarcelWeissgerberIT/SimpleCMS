/**
 * What One knows of a route, synchronously (D-S2-32): the registry rows of the direct models (src/shared/ai/models.ts)
 * and, for OpenRouter, this device's shortlist (settings.ai.models) — never the catalogue (that is async: only the UI and
 * core/call.ts read it). The Jev Router is a pool over the shortlist: its view is synthesised from the pool's models
 * (caps they all share, the lowest context and answer cap, the most expensive row as its stated price bound). A Jev
 * decision model (slice SJ) is known by its id alone — it decides, it never writes text — priced by the decisions
 * catalogue row this tab read (core/decisionRows.ts), never by a bound.
 */
import type { Caps, ModelInfo, PriceRow, Route, ShortlistRow, WireHints } from '@/shared/ai/types'
import { labelOf, modelRow, providerLabel, shortOfLabel } from '@/shared/ai/models'
import { DYNAMIC_BOUND, boundRow } from '@/shared/ai/prices'
import { JEV_CONTEXT, isJevModel, isJevRouter, jevLabel, servedAs } from '@/shared/ai/jev'
import { useWorkspace } from '../../../store/store'
import { routerView, shortlistInfo } from './pool'
import { decisionRow } from './decisionRows'

/** What a decision model can do: decide (typed answers to questions about a text state) — nothing else. */
export const DECIDE_CAPS: Caps = { structured: false, tools: false, vision: false, pdf: false, mcp: false, mcpListing: false, cache: false, effort: false, reasoning: false, web: false, notes: false, refusalFallback: false, context: JEV_CONTEXT, maxOutput: 1, decisions: true }

/** A Jev version's view (its price: the decisions catalogue row this tab read, else none). */
export function decisionInfo(route: Route): ModelInfo {
  const label = jevLabel(route.m)
  return { route: { p: route.p, m: route.m }, label, short: shortOfLabel(label), vendor: 'typesafe', caps: DECIDE_CAPS, price: decisionRow(route.m)?.price ?? null }
}

export { poolCaps, routerView, shortlistInfo } from './pool'

/** What the catalogue this tab holds says of a row's wire (catalog.ts registers it once loaded; sync, no I/O). */
let catalogHints: (id: string) => WireHints | null = () => null
export function registerCatalogHints(fn: (id: string) => WireHints | null): void {
  catalogHints = fn
}

/**
 * The wire facts a request is estimated and braked with (Regler G1 — the band's upper end is never below the wire's
 * max_tokens): what the route's view says, else the catalogue this tab holds, else for an OpenRouter model whose caps
 * say it reasons the worst case — 'reasoning' listed (core/call.ts may read a catalogue copy the gate cannot, sync).
 */
export function wireHintsFor(route: Route, info: Pick<ModelInfo, 'caps' | 'hints'> | null): WireHints | undefined {
  if (info?.hints) return info.hints
  if (route.p !== 'openrouter' || isJevRouter(route.m)) return undefined
  const known = catalogHints(route.m)
  if (known) return known
  const r = info?.caps.reasoning
  return r ? { params: ['reasoning'], reasoning: { mandatory: r.mandatory, efforts: null, supportsMax: false } } : undefined
}

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
  if (isJevModel(route.m)) return decisionInfo(route)
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
  // a decision model is priced by its catalogue row or not at all (a decide request never runs without a price, D45)
  if (info?.caps.decisions) return null
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

/** The shortlist row a served model came from: its own id, else (a dated revision, a variant) the row it is served as —
 *  the same rule the router's pool check uses (servedAs). */
const servedRow = (m: string): ShortlistRow | null => row(m) ?? shortlist().find((r) => servedAs(m, r.m)) ?? null

/** A served model's label for a receipt: the shortlist's, else the slug's model part. */
export function servedLabel(p: Route['p'], model: string): string {
  if (p !== 'openrouter') return labelOf({ p, m: model })
  return servedRow(model)?.label ?? model.split('/').pop() ?? model
}

/** A served model's price (the router's answer without a reported cost: priced at the model that served it). */
export function servedPrice(model: string): PriceRow | null {
  return servedRow(model)?.price ?? null
}
