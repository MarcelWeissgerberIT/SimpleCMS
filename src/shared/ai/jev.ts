/**
 * Jev (TypeSafe) on OpenRouter — the only place its slugs live (a source guard keeps every other OpenRouter model and
 * maker out of `src`). Slice 2 offers the Jev Router: OpenRouter hands a request to Jev, which picks one model of the
 * person's list to answer it. Whether it is offered at all is the owner's decision `OWNER.jevRouter` (owner.ts).
 * Router-ness always comes from this allow-list and the catalogue, never from a stored flag (an older tab drops keys it
 * does not know). Slice SJ adds Jev itself as a decision model (the Vorprüfer): its family, the default thresholds and the
 * decisions surface.
 */
import type { Effort } from './types.ts'

/** The router's model id on OpenRouter. */
export const JEV_ROUTER = 'typesafe/jev-router'
/** Who runs Jev (named in the picker, the privacy text and the upstream rule). */
export const JEV_OPERATOR = 'TypeSafe'
/** The plugin that configures the router per request (cost tier, include and exclude lists). */
export const JEV_PLUGIN = 'jev-router'

/** Is this the Jev Router's id? */
export const isJevRouter = (id: string | null | undefined): boolean => id === JEV_ROUTER

/**
 * What `provider` pins a router request: 'pool' = `only` = the endpoint tags of the pool's models ∪ the router's own
 * (design D17: every body pins); 'ignore' = `ignore` = the deny list. A RELEASE decision, switched here by hand only if
 * a real key shows that `only` stops the router (spike SP-J4) — never at run time.
 */
export const ROUTER_PINS: 'pool' | 'ignore' = 'pool'

/** The router's cost tiers — they ride in `Route.effort` on a router route (never sent as reasoning effort). */
export const JEV_TIERS: readonly Effort[] = ['low', 'medium', 'high']

/** Patterns no router request may reach (other routers, web-searching models), sent as exclusions. */
export const REFUSED_GLOBS: readonly string[] = ['openrouter/*', '*:online', '*:batch', 'perplexity/sonar*', '*-search', '*-search:*', '*deep-research*']

/** The documented limits of the include / exclude lists (per list). */
export const ROUTER_LIST_MAX = 1024
export const ROUTER_LIST_PATTERN_MAX = 1024
export const ROUTER_LIST_CHARS_MAX = 65_536

/** A model id without its variant suffix and snapshot date ('a/x:free', 'a/x-20260917' → 'a/x'). */
export const slugBase = (id: string): string => id.replace(/:[a-z0-9-]+$/, '').replace(/-\d{8}$/, '')

/** Did `served` come from `listed` (the slug itself, a dated revision of it, or a variant of it)? */
export const servedAs = (served: string, listed: string): boolean => served === listed || slugBase(served) === slugBase(listed)

/* ------------------------------------------------------------------ */
/* Jev as Vorprüfer — the decision model (slice SJ)                    */
/* ------------------------------------------------------------------ */

/**
 * The Jev decision models One asks (owner decision 2: only the Jev family until another model has its own calibration):
 * a pinned version — never the `~typesafe/jev-latest` alias, a dated snapshot or a variant.
 */
export const JEV_FAMILY = /^typesafe\/jev-\d+(\.\d+)*$/
/** A Jev snapshot as a response or the catalogue names it: a pinned version or its dated form. */
const JEV_SNAPSHOT = /^typesafe\/jev-\d+(\.\d+)*(-\d{8})?$/

/** Is this a pinned Jev version (what a request names)? */
export const isJevModel = (id: unknown): id is string => typeof id === 'string' && JEV_FAMILY.test(id)
/** Is this a Jev snapshot (a pinned version or a dated one — what `review.on` and a response name)? */
export const isJevSnapshot = (id: unknown): id is string => typeof id === 'string' && JEV_SNAPSHOT.test(id)

/** The version of a Jev id ('typesafe/jev-1.13' and its dated snapshot → [1, 13]); null: not a Jev snapshot. */
export function jevVersion(id: string): number[] | null {
  if (!isJevSnapshot(id)) return null
  return id.slice('typesafe/jev-'.length).replace(/-\d{8}$/, '').split('.').map(Number)
}

/** The dated snapshot's day ('typesafe/jev-1.13-20260917' → '2026-09-17'); null: not dated. */
export function jevSnapshotDay(id: string): string | null {
  const m = isJevSnapshot(id) ? id.match(/-(\d{4})(\d{2})(\d{2})$/) : null
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** "Jev 1.13" (a dated snapshot reads as its version). */
export const jevLabel = (id: string): string => `Jev ${(jevVersion(id) ?? []).join('.') || id.split('/').pop()}`

/** A decisions catalogue row as far as these helpers need it (`canonical` = the catalogue's `canonical_slug`). */
export interface DecisionRowLike {
  id: string
  canonical?: string | null
}

const newer = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** The newest pinned Jev version among catalogue rows (null: none) — the default Vorprüfer (DJ11). */
export function newestJev<T extends DecisionRowLike>(rows: readonly T[]): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (!isJevModel(r.id)) continue
    if (!best || newer(jevVersion(r.id)!, jevVersion(best.id)!)) best = r
  }
  return best
}

/**
 * The snapshot a row stands for: the catalogue's `canonical_slug` when it is the row's id or a dated form of it, else the
 * id itself. `review.on` holds it — the thresholds belong to one model (DJ19).
 */
export function canonicalOf(row: DecisionRowLike): string {
  const c = row.canonical
  return typeof c === 'string' && (c === row.id || (c.startsWith(`${row.id}-`) && /^\d{8}$/.test(c.slice(row.id.length + 1)))) ? c : row.id
}

/**
 * The same Jev snapshot: `on` (a confirmed key, 'openrouter:' in front or not) and a served or resolved one. An undated
 * confirmed version takes any of its dated snapshots.
 */
export function sameJevSnapshot(on: string, served: string): boolean {
  const a = on.replace(/^openrouter:/, '')
  const b = served.replace(/^openrouter:/, '')
  return a === b || (!/-\d{8}$/.test(a) && b.replace(/-\d{8}$/, '') === a)
}

/** What one pre-check reads, in tokens, for an estimate (a proposal's state ≈ 1 000–1 500 tokens + the questions). */
export const JEV_CHECK_TOKENS = 1_200

/** Jev's context window as its docs state it (the catalogue says 64 000 — the lower documented value wins, DJ13). */
export const JEV_CONTEXT = 32_000
/** What One lets a state (+ the questions) take of it: chars ÷ 4 + 300 over this → clipped, still over → not sent. */
export const JEV_STATE_TOKENS = 16_000
/**
 * The start values (owner decision 3): a check below `markBelow` marks a proposal; the write gate lets an apply-mode run
 * write only when every check is at or above `allowAt`. Shown as "Startwerte" until the owner's calibration run sets them
 * and `JEV_CALIBRATED` — no protection rate is claimed anywhere.
 */
export const JEV_DEFAULTS: { readonly markBelow: number; readonly allowAt: number } = { markBelow: 0.7, allowAt: 0.9 }
/** Repeats of one request moved Jev's numbers by up to eight hundredths: the "close to the threshold" band above a mark. */
export const JEV_NEAR = 0.08
export const JEV_CALIBRATED: boolean = false
/**
 * The decisions surface (an OpenRouter alpha path). Its documented twin `/api/v1/systemone` is the fallback — switched by
 * a release here, never at run time (DJ2).
 */
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
