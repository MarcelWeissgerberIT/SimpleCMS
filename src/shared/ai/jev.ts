/**
 * Jev (TypeSafe) on OpenRouter — the only place its slugs live (a source guard keeps every other OpenRouter model and
 * maker out of `src`). Slice 2 offers the Jev Router: OpenRouter hands a request to Jev, which picks one model of the
 * person's list to answer it. Whether it is offered at all is the owner's decision `OWNER.jevRouter` (owner.ts).
 * Router-ness always comes from this allow-list and the catalogue, never from a stored flag (an older tab drops keys it
 * does not know).
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
