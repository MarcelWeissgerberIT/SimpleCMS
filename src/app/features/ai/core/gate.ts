/**
 * prepare(): the single choke point in front of every AI request, before any data is loaded or sent.
 *
 *  0. the AI policy generation: rules stored by a newer build (Workspace.ai.gen / settings.ai.gen above this build's
 *     AI_POLICY_GEN) → 'reload', nothing sent — this tab would not enforce them;
 *  1. typed text that looks like an API key → 'key_in_text', nothing sent (keys belong in Settings);
 *  2. AI switched off (the governor's AUS; identity until it ships) → 'off';
 *  3. the request's data classes: the purpose's declaration ∪ the classes of its sources (recorded in slice 1);
 *  4. the route: the legacy level — Claude with this device's model, only with a Claude key ('no_key' as before);
 *     demo on and no key → the runtime 'demo' provider (canned answers, never a request);
 *  5. the brake hook (identity until the governor) with the request's estimate band, and an in-tab reservation of its
 *     upper end (features/governor), settled by settle() when the request ends.
 *
 * precheck(): the same checks before anything is loaded or attached (a picture, a file, MCP servers), without a
 * reservation — the request itself prepares again. Only responses are metered (core/meter.ts), never a check.
 *
 * In DEV and `?e2e` a call without a known purpose or a source list — or with no sources for a purpose that carries
 * page data — throws (the recorder's strict() pattern): every call site names what it sends.
 */
import type { Caps, DataClass, FeatureClass, Reservation, Route, RuntimeProviderId, SourceRef, StepNote } from '@/shared/ai/types'
import { policyKnown } from '@/shared/ai/policy'
import { legacyRule } from '@/shared/ai/route'
import { capsOf } from '@/shared/ai/models'
import { looksLikeKey } from '@/shared/ai/keys'
import { sanitizeRoute } from '@/shared/ai/route'
import { useWorkspace } from '../../../store/store'
import { estimate, reserve, settle as settleReservation, type Band } from '../../governor'
import { AIError } from './errors'
import { isAIDemo } from './demoMode'
import { classesOf, isSources } from './sources'
import { isPurposeId, purposeOf, type Need, type PurposeId } from './purposes'
import { capsFor, priceFor } from './registry'

export interface PrepareInput {
  purpose: PurposeId
  /** what the request carries: pages, rows, databases, an uploaded file, or the workspace as a whole */
  sources: readonly SourceRef[]
  /** what the person typed for this request (instruction, question, prompt): refused when it looks like a key */
  typed?: string | ReadonlyArray<string | null | undefined> | null
  /** what this call needs beyond the purpose (vision, pdf, structured, tools, mcp) */
  needs?: readonly Need[]
  /** a model the call picks itself (a custom agent's own model) — else this device's */
  model?: string | null
  /**
   * The request's size: its prompt in characters (documents and pictures counted as what they cost) and its answer
   * budget (max_tokens; a function when it depends on what the model can do) — the estimate band the brake hook gets
   * and whose upper end is reserved while the request runs.
   */
  size?: { promptChars: number; maxTokens: number | ((caps: Caps | null) => number) }
}

export interface Prepared {
  purpose: PurposeId
  cls: FeatureClass
  /** the route the request goes to (null: demo — canned answers, nothing sent) */
  route: Route | null
  provider: RuntimeProviderId
  model: string
  caps: Caps | null
  /** the data classes the request carries (declaration ∪ sources) */
  classes: DataClass[]
  steps: StepNote[]
  reservation: Reservation | null
  /** the Jev Router: the shortlist models it may choose from (ids) */
  pool?: string[]
}

/* ------------------------------------------------------------------ */
/* The e2e seam: a forced route (?e2e only — never active otherwise)     */
/* ------------------------------------------------------------------ */

let forced: { route: Route; pool?: string[] } | null = null

/** The route the e2e seam forces (null: none) — the gate takes it before any level (stage A: the only way to OpenRouter). */
export const forcedRoute = (): { route: Route; pool?: string[] } | null => forced

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')) {
  const w = window as unknown as { __oneAI?: Record<string, unknown> }
  w.__oneAI = {
    ...(w.__oneAI ?? {}),
    forceRoute(route: unknown, pool?: unknown) {
      const r = route === null ? null : sanitizeRoute(route)
      forced = r ? { route: r, ...(Array.isArray(pool) ? { pool: pool.filter((x): x is string => typeof x === 'string').slice(0, 24) } : {}) } : null
      return forced
    },
    // the catalogue on this device (lazy: nothing opens before a call)
    loadCatalog: (force?: boolean) => import('./catalog').then((m) => m.loadCatalog({ force: !!force })).then((c) => (c ? { at: c.at, rows: c.rows.length, ids: c.rows.map((r) => r.id) } : null)),
    seedEndpoints: (map: Record<string, Array<{ tag: string; name?: string }>>, at?: number) => import('./catalog').then((m) => m.seedEndpoints(map, at)),
  }
}

/* ------------------------------------------------------------------ */
/* Hooks (identity until the governor)                                  */
/* ------------------------------------------------------------------ */

let offHook: () => boolean = () => false
/** AUS: while it answers true, every request is refused ('off'). */
export function registerAIOff(fn: () => boolean): void {
  offHook = fn
}

export type BeforeSend = (purpose: PurposeId, route: Route | null, band: Band | null) => number | void
let beforeSendHook: BeforeSend = () => undefined
/**
 * The brake: may throw an AIError to stop a request; returns the amount (USD) to reserve — nothing returned: the upper
 * end of the request's estimate band (its size, PrepareInput.size), 0 without a size or a price.
 */
export function registerBeforeSend(fn: BeforeSend): void {
  beforeSendHook = fn
}

/** The request ended (answered, failed or stopped): its reservation is released (features/governor). */
export function settle(p: Prepared | null | undefined): void {
  settleReservation(p?.reservation?.id)
}

/* ------------------------------------------------------------------ */
/* prepare                                                              */
/* ------------------------------------------------------------------ */

/** DEV, `?e2e`: contract violations throw. */
function strict(): boolean {
  if (typeof window === 'undefined') return true
  try {
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return true
    return new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
}

function checkContract(input: PrepareInput): void {
  if (!strict()) return
  if (!isPurposeId(input?.purpose)) throw new Error(`[ai] an AI request without a known purpose (${String(input?.purpose)}) — every call site names its purpose (features/ai/core/purposes.ts)`)
  if (!isSources(input.sources)) throw new Error(`[ai] an AI request (${input.purpose}) without its sources — every call site names what it sends`)
  if (!input.sources.length && !purposeOf(input.purpose).pageless) throw new Error(`[ai] ${input.purpose} carries page data: its sources cannot be empty`)
}

const typedTexts = (t: PrepareInput['typed']): string[] => (typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [])

/** The gate — throws AIError ('reload' · 'key_in_text' · 'off' · 'no_key'). */
export function prepare(input: PrepareInput): Prepared {
  return gate(input, true)
}

/** The gate's checks before anything is loaded, without a reservation (the request prepares again). */
export function precheck(input: PrepareInput): Prepared {
  return gate(input, false)
}

function gate(input: PrepareInput, held: boolean): Prepared {
  checkContract(input)
  const s = useWorkspace.getState()
  // 0 · rules this build does not know
  if (!policyKnown(s.ai, s.settings.ai)) throw new AIError('reload')
  // 1 · a key typed into a request
  if (typedTexts(input.typed).some(looksLikeKey)) throw new AIError('key_in_text')
  // 2 · AUS
  if (offHook()) throw new AIError('off')
  // 3 · what the request carries
  const purpose = purposeOf(input.purpose)
  const classes = new Set<DataClass>(purpose.decl)
  const sources = isSources(input.sources) ? input.sources : [{ all: true } as const]
  for (const c of classesOf(sources, { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null })) classes.add(c)
  // 4 · the route: the e2e seam's forced route first (?e2e only), else the legacy level (Claude + this device's model),
  //     demo without a key
  const force = forced
  const hasKey = !!s.settings.aiApiKey.trim()
  const [route] = force ? [force.route] : legacyRule(input.model || s.settings.aiModel, hasKey)
  if (!route) {
    if (isAIDemo()) return { purpose: input.purpose, cls: purpose.cls, route: null, provider: 'demo', model: 'demo', caps: null, classes: [...classes], steps: [], reservation: null }
    throw new AIError('no_key')
  }
  const pool = force?.pool
  const caps = route.p === 'anthropic' ? capsOf(route) : capsFor(route, pool)
  // a forced route the request needs more of than it can do: refused before anything is loaded (the gate's filter 3)
  if (force) {
    const needs = input.needs ?? purpose.needs
    const missing = needs.find((n) => !canDo(caps, n))
    if (missing) throw new AIError('capability', missing)
  }
  // 5 · the brake (may throw) and the reservation: the upper end of the request's band unless the brake says otherwise —
  //     a route priced per request reserves its stated bound (never 0)
  const size = input.size
  const price = route.p === 'anthropic' ? undefined : priceFor(route, pool)
  const band = size ? estimate(route, { promptChars: size.promptChars, maxTokens: typeof size.maxTokens === 'function' ? size.maxTokens(caps) : size.maxTokens }, Date.now(), price, caps) : null
  const said = beforeSendHook(input.purpose, route, band)
  const usd = typeof said === 'number' ? said : (band?.high ?? 0)
  return { purpose: input.purpose, cls: purpose.cls, route, provider: route.p, model: route.m, caps, classes: [...classes], steps: [], reservation: held ? reserve(usd, input.purpose) : null, ...(pool ? { pool: [...pool] } : {}) }
}

/** Can a model do what a request needs? (no caps known: no) */
function canDo(caps: Caps | null, n: Need): boolean {
  if (!caps) return false
  switch (n) {
    case 'structured':
      return caps.structured
    case 'tools':
      return caps.tools
    case 'vision':
      return !!caps.vision
    case 'pdf':
      return !!caps.pdf
    case 'mcp':
      return !!caps.mcp
    case 'listing':
      return caps.mcpListing
  }
}
