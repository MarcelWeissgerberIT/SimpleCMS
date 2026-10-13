/**
 * prepare(): the single choke point in front of every AI request, before any data is loaded or sent.
 *
 *  0. the AI policy generation: rules stored by a newer build (Workspace.ai.gen / settings.ai.gen above this build's
 *     AI_POLICY_GEN) → 'reload', nothing sent — this tab would not enforce them;
 *  1. typed text that looks like an API key → 'key_in_text', nothing sent (keys belong in Settings);
 *  2. AI switched off (the governor's AUS; identity until it ships) → 'off';
 *  3. the request's data classes: the purpose's needs ∪ what the call carries ∪ the classes of its sources (a selection
 *     brings its page's member classes only — D-S2-27);
 *  4. the route (core/resolve.ts): chip → device rule → workspace rule → device default → workspace default → legacy
 *     (Claude with this device's model); the winning rule's pins through the filters key · model · capability · data
 *     rule; no rule and no key: demo when on, else 'no_key'. The class 'gate' (a decision model, slice SJ): the agent's
 *     own Vorprüfer → device rule → workspace rule (no chip), a Jev version only — no rule: 'no_route' (never demo);
 *  5. the backstop (D-S2-5): a request carrying page-derived data to a route that does not see everything must say its
 *     text went through that route's redaction and page filter (`applied`), else 'policy' — an unconverted call site
 *     fails closed instead of leaking names or pages;
 *  6. the brake hook (identity until the governor) with the request's estimate band, and an in-tab reservation of its
 *     upper end (features/governor), settled by settle() when the request ends — a route priced per request reserves
 *     its stated bound.
 *
 * precheck(): the same checks before anything is loaded or built (a picture, a file, the page text), without a
 * reservation and without the backstop — it hands the call site the route's redaction (`redact`), its page filter
 * (`visible`) and `allows(cls)`, so the text is built for the route; the request itself prepares again.
 * routeFor(): the resolution alone, for estimates shown before a request (D-S2-32).
 *
 * In DEV and `?e2e` a call without a known purpose or a source list — with no sources for a purpose that carries
 * page data, or carrying a class its purpose does not declare — throws (the recorder's strict() pattern).
 */
import type { Caps, DataClass, FeatureClass, PriceRow, Reservation, Route, RuntimeProviderId, SourceRef, StepNote, Usage, WireHints } from '@/shared/ai/types'
import { blendedPerM, priceRow } from '@/shared/ai/prices'
import type { AIErrorCode } from '@/shared/ai/errors'
import { MODELS } from '@/shared/ai/models'
import { JEV_OPERATOR, JEV_ROUTER, JEV_TIERS, isJevRouter } from '@/shared/ai/jev'
import { OWNER } from '@/shared/ai/owner'
import { AI_POLICY_GEN, MEMBER_CLASSES, allowedFor, policyKnown, redactionFor, seesEverything } from '@/shared/ai/policy'
import { legacyRule, routeKey, sanitizeRoute } from '@/shared/ai/route'
import { looksLikeKey } from '@/shared/ai/keys'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { hasAIKey } from '../../../store/secrets'
import { adjust, CHARS_PER_TOKEN, estimate, missesMode, modeOf, reserve, settle as settleReservation, sourceFor, SOURCE_RE, type Band, type Binding, type HCandidate, type Rest, type RoundVerdict, type RunMode, type StartVerdict } from '../../governor'
import { newId } from '../../../lib/ids'
import { AIError, type AIFix } from './errors'
import { usesDemo } from './demoMode'
import { classOfPage, classesOf, isSources, type SourceWorld } from './sources'
import { PAGE_DERIVED, isPurposeId, purposeOf, type Need, type PurposeId } from './purposes'
import { labelFor, modelInfo, priceFor, shortFor, shortlist, wireHintsFor } from './registry'
import { backstop, canDo, resolveRoute, type Level, type Resolved, type RouteWorld } from './resolve'
import { routable } from './routable'

/** What a call site did to its request text for the route (D-S2-5): redacted names / transcripts, left out pages. */
export interface Applied {
  people: boolean
  transcript: boolean
  /** pages the route may not see were left out (prepared.visible) */
  visible: boolean
  /** the route the text was built for ('p:m' — a request that resolves elsewhere is refused) */
  route?: string
}

export interface PrepareInput {
  purpose: PurposeId
  /** what the request carries: pages, rows, databases, an uploaded file, or the workspace as a whole */
  sources: readonly SourceRef[]
  /** what the person typed for this request (instruction, question, prompt): refused when it looks like a key */
  typed?: string | ReadonlyArray<string | null | undefined> | null
  /** what this call needs of the model beyond the purpose (a PDF, an addressed MCP server …) */
  needs?: readonly Need[]
  /** the purpose's `may` classes this call actually built (page text, the memory block, MCP, people's names) */
  carries?: readonly DataClass[]
  /** what the text went through for the route (precheck's redact / visible) — see Applied */
  applied?: Applied | null
  /** the route chip: this request only */
  route?: Route | null
  /** a model the call picks itself (a custom agent's own model) — else this device's */
  model?: string | null
  /** class 'gate': the agent's own Vorprüfer (review v2 `decider`) — before the device's rule (a decision takes no chip) */
  decider?: Route | null
  /**
   * The request's size: its prompt in characters (documents and pictures counted as what they cost) and its answer
   * budget (max_tokens; a function when it depends on what the model can do) — the estimate band the brake hook gets
   * and whose upper end is reserved while the request runs.
   */
  size?: { promptChars: number; maxTokens: number | ((caps: Caps | null) => number); bandOut?: number }
  /**
   * The run this request belongs to (features/governor modes.ts): its ledger source (fixed ids — 'agent:<id>:<run>',
   * 'autofill:<db>:<prop>:<job>' … — else `<series>:<request id>`, never the bare purpose) and how it runs (the four
   * caller-mode purposes must say: DEV / ?e2e throw without it), plus what the brake reads of it (RunCtx).
   */
  run?: Partial<RunCtx>
  /**
   * Who picked `route`: 'person' = a chip (the person's own pick for this request), 'gate' = the route a precheck resolved
   * and the text was built for (core/shape.ts routed()). A route without it reads as 'person' — its meaning before.
   */
  pinned?: 'person' | 'gate'
  /**
   * MCP servers that may join this request (Claude; their tool lists, characters — null: not known) and how many requests
   * the call may send (the first + the paused turns it resumes: 1 + maxResumes; a loop's first request: absent = 1)
   */
  mcp?: { servers: number; toolChars?: ReadonlyArray<number | null>; rounds?: number }
  /** what this call's answer is when it differs from its purpose's (a picture's JSON description): a structured answer
   *  is never capped (features/governor modes.ts) */
  answer?: 'text' | 'structured'
}

/**
 * The run a request belongs to, as the brake reads it (Regler design § 5.3): its ledger source and run mode, and —
 * where they apply — a run's own budget and spend (an agent's maxRunUsd), the allowance token the person granted with E
 * (one-shots), whether the person chose the route for this run, the run's decide reservation (SJ).
 */
export interface RunCtx {
  source: string
  mode: RunMode
  /** the series band (G3: run rings) — absent: none */
  band?: Band | null
  /** the person chose the route for this run (a chip, the Vorlauf's ↵ / S): saving rules never move it (G3) */
  chosen?: boolean
  budget?: number
  spent?: number
  /** a one-request allowance token (allowOnce) */
  allowance?: string
  /** the run's decide reservation (SJ): gate.* requests it covers pass the day line */
  decide?: string
}

/** The run a prepared request belongs to (its ledger source and run mode always set). */
export type PreparedRun = RunCtx

/** What the brake sees of a request (Regler design § 5.3) — money in prepare(), peek in precheck(). */
export interface BrakeCtx {
  purpose: PurposeId
  cls: FeatureClass
  route: Route
  caps: Caps | null
  pool?: readonly string[]
  classes: readonly DataClass[]
  /** prompt tokens, the visible answer budget the call sends, and the answer the band counts (bandOut ≤ maxTokens) */
  size: { promptTokens: number; maxTokens: number; bandOut: number } | null
  /** the request's band on bandOut (null: no price, or no size) */
  band: Band | null
  run: RunCtx
  /** the person's own pick for this request (a gate-pinned route is not a chip) */
  chip: boolean
  /** MCP servers that may join (Claude routes that may receive MCP only), and the requests the call may send */
  mcp: { servers: number; toolChars: ReadonlyArray<number | null>; rounds?: number }
  /** the route's price row (the table, the shortlist row, a dynamic route's stated bound) and its wire facts */
  price: PriceRow | null
  hints?: WireHints
  /** the route as people read it */
  label: string
  /** this call's answer kind when it differs from its purpose's (else modes.ts decides) */
  answer?: 'text' | 'structured'
  /** cheaper routes of the same provider that pass the gate's filters for this request, with their bands (lazy) */
  cheaper: () => ReadonlyArray<{ route: Route; band: Band | null }>
}

/** What the money phase decided: the amount to reserve, a capped visible answer budget, steps for the receipt. */
export interface MoneyVerdict {
  reserve?: number
  maxTokens?: number
  steps?: StepNote[]
  band?: Band | null
  /** an allowance (E) that let it through, USD (the ledger entry says so) */
  allowance?: number
}

/** What the money phase would say (precheck: a hint — never throws, never reserves). */
export interface MoneyHint {
  band: Band | null
  /** the rests now (their binding line) */
  rest: Rest
  fits: 'yes' | 'no' | 'noprice'
}

/** A route move (the ceiling G2, a saving rule G3) — decided in a request's first gate call; not made in G1. */
export interface RouteMove {
  route: Route
  step: StepNote
}

/**
 * The brake (features/governor/install.ts registers it — nobody else): money (prepare only; may throw AIError
 * 'budget'), peek (precheck only). `route` (the ceiling G2, saving rules G3) is the slot those slices fill — the gate
 * does not call it in G1.
 */
export interface Brake {
  route?(ctx: Omit<BrakeCtx, 'size'>): RouteMove | null
  money?(ctx: BrakeCtx): MoneyVerdict | number | void
  peek?(ctx: BrakeCtx): MoneyHint | null
  /** between two requests of a loop (beforeRound); null: go on as before (no line) — a promise only with a line (lazy) */
  round?(ctx: RoundCtx): RoundVerdict | null | Promise<RoundVerdict | null>
  /** before a run's first request (startCheck) — async: the day (and month) are read first */
  start?(input: PrepareInput): Promise<StartCheck>
}

/**
 * A loop's next request (Regler § 5.6): what the brake reads between two rounds — after a tool_use or pause_turn response
 * (before its tools run and before the runner sends again) and before the eager-input retry.
 */
export interface LoopRound {
  prepared: Prepared
  /** what the run spent so far (its responses' ledger entries) */
  spent: number
  /** the last response, and every response of this run so far (the last included) */
  last: Usage
  steps: readonly Usage[]
  /** characters of the tool results the next request carries: none (a pause_turn, the eager retry) … the clip bound */
  pending: { low: number; high: number }
  /** server-side MCP iterations of the last response */
  mcpIterations?: number
  /** the halt card waited over 5 minutes: the cache counts as cold */
  cold?: boolean
  /** H (the AI terminal): what the conversation holds, how a model thinks (client.ts thinks), MCP servers attached */
  history?: () => ReadonlyArray<{ content?: unknown }>
  thinks?: (caps: Caps | null) => boolean
  mcpAttached?: boolean
}

/** What the brake's round gets: the loop round + the route's price and wire facts, H's candidates (lazy). */
export interface RoundCtx extends LoopRound {
  route: Route
  price: PriceRow | null
  hints?: WireHints
  /** cheaper models of the same provider that pass the gate's filters for this request (H) */
  candidates: () => HCandidate[]
}

/** The start check's verdict with the binding line's spend and limit (a held record, the dialog). */
/** A start verdict, with the binding line's spend and limit and the label of the route it priced (a refusal names it). */
export type StartCheck = StartVerdict & { line?: { spent: number; limit: number }; label?: string }

export interface Prepared {
  purpose: PurposeId
  cls: FeatureClass
  /** the route the request goes to (null: demo — canned answers, nothing sent) */
  route: Route | null
  provider: RuntimeProviderId
  model: string
  caps: Caps | null
  /** the data classes the request carries (needs ∪ carries ∪ sources) */
  classes: DataClass[]
  steps: StepNote[]
  reservation: Reservation | null
  /** the Jev Router: the shortlist models it may choose from (ids) */
  pool?: string[]
  /** which level's rule won (null: demo) */
  level: Level | null
  /** what the route's request text leaves out: people's names, meeting transcripts (true = redact) */
  redact: { people: boolean; transcript: boolean }
  /** may the route see this page? (its member classes: private, mail, memory pages) */
  visible: (pageId: ID) => boolean
  /** 'all' = the route sees everything (no redaction, no filter — today's bytes) */
  sees: 'all' | 'filtered'
  /** may the route receive this class? */
  allows: (cls: DataClass) => boolean
  /** the route as people read it ("OpenRouter · …", Claude's own labels) */
  label: string
  /** the run it belongs to: its ledger source (the call site's, else its own `<series>:<id>`) and run mode */
  run: PreparedRun
  /** the brake capped the visible answer budget to this (facades send min(own, maxTokens)); absent: no cap */
  maxTokens?: number
  /** the band the request was braked on (null: none — no limit, or no price / size) */
  band?: Band | null
  /** an allowance (E) let it through, USD */
  allowance?: number
  /** precheck: what the money phase would say (null: no limit) */
  hint?: MoneyHint | null
  /** the route a move put it on (the ceiling G2, a saving rule G3 — never in G1) and the one it came from */
  moved?: { by: 'saver' | 'ceiling'; from: Route }
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
    // connecting OpenRouter (the setup's key comes in stage C) and the free key check
    connectOpenRouter: (o?: { sameTab?: boolean }) => import('../providers/openrouterConnect').then((m) => m.connectOpenRouter(o ?? {})),
    cancelOpenRouter: () => import('../providers/openrouterConnect').then((m) => m.cancelOpenRouter()),
    orConnectState: () => import('../providers/openrouterConnect').then((m) => JSON.parse(JSON.stringify(m.useORConnect.getState())) as unknown),
    verifyProvider: (p: 'anthropic' | 'openrouter', key?: string) => import('./verify').then((m) => m.verifyProvider(p, key)),
    // the rules' setters (store/aiRules.ts) and what the gate resolves — the specs drive them like the setup will
    rules: () =>
      import('../../../store/aiRules').then((m) => {
        // each setter as the spec's own write (the person's, `you~ui:e2e`) — a write without a writer is refused loudly
        const test: Writer = { kind: 'you', via: 'ui', ref: 'e2e' }
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(m)) out[k] = typeof v === 'function' ? (...a: unknown[]) => withWriter(test, () => (v as (...x: unknown[]) => unknown)(...a)) : v
        return out
      }),
    routeFor: (purpose: PurposeId, route?: Route | null) => routeFor(purpose, { route }),
    aiStatus: (purpose: PurposeId) => JSON.parse(JSON.stringify(aiStatus(purpose))) as unknown,
    // what the gate decides for a request, nothing sent or reserved (the route and its shape, or the refusal + its fixes)
    precheck: (input: Pick<PrepareInput, 'purpose' | 'sources' | 'route' | 'carries' | 'needs'>) => {
      try {
        const p = precheck(input)
        return JSON.parse(JSON.stringify({ ok: true, route: p.route ? routeKey(p.route) : null, level: p.level, sees: p.sees, redact: p.redact, classes: p.classes, pool: p.pool ?? null, label: p.label })) as unknown
      } catch (e) {
        return e instanceof AIError ? (JSON.parse(JSON.stringify({ ok: false, code: e.code, detail: e.detail ?? null, fix: e.fix ?? null, fixes: e.fixes ?? [], label: e.label ?? null })) as unknown) : { ok: false, code: 'unknown', detail: String(e) }
      }
    },
    // decisions (slice SJ): the decisions catalogue, one decide request through the gate, the tab's cooldown
    loadDecisions: (force?: boolean) => import('./catalog').then((m) => m.loadDecisionCatalog({ force: !!force })).then((c) => (c ? { at: c.at, ids: c.rows.map((r) => r.id) } : null)),
    decide: (input: unknown) => import('./decide').then((m) => m.decideSeam(input)),
    decideCooldown: () => import('./decide').then((m) => m.decideCooldown()),
    resetDecideCooldown: () => import('./decide').then((m) => m.resetDecideCooldown()),
    // a whole prepare() (nothing sent; the reservation settled at once): the run it would carry and what the brake
    // decided (reserve, cap, band, allowance, its steps), or why it was refused (+ the fixes)
    prepare: (input: PrepareInput) => {
      try {
        const p = prepare(input)
        const reserved = p.reservation?.usd ?? 0
        settle(p)
        const own = p.steps.filter((x) => x.k === 'brake' || x.k === 'allowance')
        return JSON.parse(JSON.stringify({ ok: true, route: p.route ? routeKey(p.route) : null, run: p.run, reserved, maxTokens: p.maxTokens ?? null, band: p.band ?? null, allowance: p.allowance ?? null, steps: own })) as unknown
      } catch (e) {
        return e instanceof AIError ? (JSON.parse(JSON.stringify({ ok: false, code: e.code, detail: e.detail ?? null, fixes: e.fixes ?? [] })) as unknown) : { ok: false, code: 'contract', detail: e instanceof Error ? e.message : String(e) }
      }
    },
    // one request through a facade to the (mocked) host — the brake's cases drive E (run.allowance) and B (a cheaper
    // route as the person's pick) through it; `structured`: completeStructured (never capped); `mcp`: the servers that join
    // as for that kind of request (default none)
    ask: (o: { purpose: PurposeId; prompt: string; route?: Route | null; run?: Partial<RunCtx>; structured?: boolean; mcp?: 'fixed' | 'free' }) =>
      import('../client').then(async (m) => {
        const base = { purpose: o.purpose, sources: [] as SourceRef[], system: 'Answer briefly.', prompt: o.prompt, mcp: o.mcp ?? (false as const), ...(o.route ? { route: o.route, pinned: 'person' as const } : {}), ...(o.run ? { run: o.run } : {}) }
        try {
          const text = o.structured ? await m.completeStructured({ ...base, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } }) : await m.streamCompletion(base)
          return { ok: true, text }
        } catch (e) {
          return e instanceof AIError ? (JSON.parse(JSON.stringify({ ok: false, code: e.code, detail: e.detail ?? null, fixes: e.fixes ?? [] })) as unknown) : { ok: false, code: 'unknown', detail: String(e) }
        }
      }),
    // a spec drives a stored budget before the release raises AI_POLICY_GEN (G1 B12): this tab enforces `gen`
    enforceGen: (gen: number | null) => {
      enforcedGen = typeof gen === 'number' && Number.isInteger(gen) && gen >= 1 ? gen : null
      return buildGen()
    },
    // can a build of generation `gen` enforce the stored rules? (an older tab, simulated)
    policyKnownAt: (gen: number) => {
      const st = useWorkspace.getState()
      return policyKnown(st.ai, st.settings.ai, gen)
    },
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

/** The S1 form of the brake (positional) — the money phase. */
export type BeforeSend = (purpose: PurposeId, route: Route | null, band: Band | null, ctx?: BrakeCtx) => number | void
let brake: Brake = {}
/**
 * The brake (features/governor/install.ts): money in prepare() — may throw an AIError to stop a request, returns the
 * amount (USD) to reserve (nothing: the upper end of the request's band, 0 without a size or a price), may cap a text
 * answer; peek in precheck() — a hint, never a throw. The S1 positional function is still taken (= money).
 */
export function registerBeforeSend(fn: BeforeSend | Brake): void {
  brake = typeof fn === 'function' ? { money: (ctx) => fn(ctx.purpose, ctx.route, ctx.band, ctx) } : fn
}

/** DEV / ?e2e: the generation this build enforces, raised by a spec that drives a stored budget before the release
 *  raises AI_POLICY_GEN (the seam only — null: AI_POLICY_GEN). */
let enforcedGen: number | null = null
const buildGen = (): number => enforcedGen ?? AI_POLICY_GEN

/** A call's visible answer budget under the governor's cap (absent: the call's own — today's bytes). */
export const capped = (own: number, prepared: Pick<Prepared, 'maxTokens'>): number => (typeof prepared.maxTokens === 'number' ? Math.min(own, prepared.maxTokens) : own)

/** The request ended (answered, failed or stopped): its reservation is released (features/governor). */
export function settle(p: Prepared | null | undefined): void {
  settleReservation(p?.reservation?.id)
}

/** The request may cost `usd` from now on: its open reservation follows, or a new one is taken (after a halt). */
function hold(p: Prepared, usd: number): void {
  if (adjust(p.reservation?.id, usd)) return
  p.reservation = reserve(usd, p.run.source)
}

/**
 * Before every further request of a loop (Regler § 5.6; agent/run.ts, S3's core/loop.ts): go — the run's reservation
 * follows the next step · halt (the AI terminal's card: nothing stays reserved while it waits; E / H reserve again with
 * their go) · stop (agents of every mode, background work: they never wait). No line set: go, nothing changes.
 */
export async function beforeRound(r: LoopRound, o: { dry?: boolean } = {}): Promise<RoundVerdict> {
  const p = r.prepared
  const route = p.route
  const v = route && brake.round ? await brake.round({ ...r, route, price: priceOf(route, p.pool), hints: wireHintsFor(route, modelInfo(route, p.pool)), candidates: () => haltCandidates(p) }) : null
  if (!v) return { go: true, reserve: p.reservation?.usd ?? 0, band: null }
  // dry: what it would say (a halt card counting its cache cold) — no reservation moves
  if (o.dry) return v
  if ('go' in v) hold(p, v.reserve)
  else if ('halt' in v) settle(p)
  return v
}

/**
 * Before a run's first request (Regler § 5.6 start check): may it start? Background runs are not started at the line
 * (one held record per agent and day), a manual one asks where it was pressed. No brake / no line: start.
 */
export function startCheck(input: PrepareInput): Promise<StartCheck> {
  return brake.start ? brake.start(input) : Promise.resolve({ start: true })
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
  const decl = purposeOf(input.purpose)
  if (!input.sources.length && !decl.pageless) throw new Error(`[ai] ${input.purpose} carries page data: its sources cannot be empty`)
  const outside = (input.carries ?? []).filter((c) => !decl.needs.includes(c) && !decl.may.includes(c))
  if (outside.length) throw new Error(`[ai] ${input.purpose} carries ${outside.join(', ')} — not in its declaration (needs / may, features/ai/core/purposes.ts)`)
  if (input.run?.source !== undefined && !SOURCE_RE.test(input.run.source)) throw new Error(`[ai] ${input.purpose}: a ledger source of ids only (${input.run.source})`)
}

/** DEV, `?e2e`: a purpose that runs both ways sends no request without its run mode (features/governor modes.ts). */
function checkMode(input: PrepareInput): void {
  if (strict() && missesMode(input.purpose, input.run?.mode)) throw new Error(`[governor] ${input.purpose} runs both ways — its call site passes run.mode (features/governor/modes.ts)`)
}

/** The run of a request: the call site's source and mode, else its own `<series>:<id>` and the purpose's mode. */
const runOf = (input: PrepareInput): PreparedRun => ({ ...(input.run ?? {}), source: input.run?.source ?? sourceFor(input.purpose, newId()), mode: modeOf(input.purpose, input.run?.mode) })

const typedTexts = (t: PrepareInput['typed']): string[] => (typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [])

/** The gate — throws AIError ('reload' · 'key_in_text' · 'off' · 'no_key' · 'policy' · 'capability' · 'model_gone'). */
export function prepare(input: PrepareInput): Prepared {
  checkMode(input)
  input = retried(input)
  // "no size" is a contract error, never "no price" (the brake could not hold a budget for it)
  if (strict() && !input.size) throw new Error(`[governor] prepare without a size (${String(input.purpose)}) — every request names its prompt and answer budget`)
  const p = gate(input, true)
  inputs.set(p, input)
  return p
}

/**
 * The person's answer at a brake note (the Regler's red line, features/governor BrakeNote): E — an allowance token
 * (allowOnce) — or B — a cheaper model of the same provider, pinned as their pick — for the retry of the request it
 * refused. The retry carries it: the next prepare() of that purpose in this tab (not background work), within
 * RETRY_MS, once. Nothing is armed without a budget (no note is ever shown then).
 */
const RETRY_MS = 30_000
let armed: { purpose: string; allowance?: string; route?: Route; until: number } | null = null

export function armRetry(purpose: string, o: { allowance?: string; route?: Route }, now = Date.now()): void {
  armed = { purpose, ...(o.allowance ? { allowance: o.allowance } : {}), ...(o.route ? { route: o.route } : {}), until: now + RETRY_MS }
}

function retried(input: PrepareInput): PrepareInput {
  const a = armed
  if (!a || a.purpose !== input.purpose) return input
  armed = null
  const mode = modeOf(input.purpose, input.run?.mode)
  if (Date.now() > a.until || mode === 'trigger' || mode === 'scheduled' || mode === 'follow-up') return input
  return {
    ...input,
    ...(a.route ? { route: a.route, pinned: 'person' as const } : {}),
    ...(a.allowance ? { run: { ...(input.run ?? {}), allowance: a.allowance } } : {}),
  }
}

/** The input each prepared request came from (reprepare). */
const inputs = new WeakMap<Prepared, PrepareInput>()

/**
 * The same request again on another route (the halt card's H — a cheaper model of the same provider): the old
 * reservation is settled, the gate runs again with the route pinned as the person's pick (same provider: the data rule
 * cannot differ; the brake checks the new band).
 */
export function reprepare(prepared: Prepared, route: Route, o: { run?: Partial<RunCtx>; size?: PrepareInput['size'] } = {}): Prepared {
  const input = inputs.get(prepared)
  if (!input) throw new Error('[governor] reprepare: not a prepared request of this tab')
  settle(prepared)
  // a loop's next request carries more than its first did: the caller names its size (the conversation now)
  return prepare({ ...input, route, pinned: 'person', run: { ...prepared.run, ...(o.run ?? {}) }, ...(o.size ? { size: o.size } : {}) })
}

/**
 * The gate's checks before anything is loaded or built, without a reservation (the request prepares again).
 * `backstop`: the text is built already (`applied` given) — refuse it here too, before anything is read for the request.
 */
export function precheck(input: PrepareInput, o: { backstop?: boolean } = {}): Prepared {
  return gate(input, false, !!o.backstop)
}

/** This device's world for the resolver: the rules, the keys, the registry and the shortlist. */
function world(): RouteWorld {
  const s = useWorkspace.getState()
  return {
    ws: s.ai,
    device: s.settings.ai,
    aiModel: s.settings.aiModel,
    // Claude's marker is settings.aiApiKey; the others' are settings.aiKeys (store/secrets.ts)
    hasKey: (p) => (p === 'anthropic' ? !!s.settings.aiApiKey.trim() : hasAIKey(p)),
    info: (route, pool) => modelInfo(route, pool),
    shortlist: shortlist().map((r) => r.m),
  }
}

/** The resolution for a request (the e2e seam's forced route first, `?e2e` only — never for a decision). */
function resolveFor(cls: FeatureClass, o: { chip?: Route | null; model?: string | null; decider?: Route | null; caps: readonly Need[]; classes: readonly DataClass[] }): Resolved {
  const gate = cls === 'gate'
  return resolveRoute({ cls, forced: gate ? null : forced, chip: !gate && o.chip ? sanitizeRoute(o.chip) : null, model: o.model, decider: gate && o.decider ? sanitizeRoute(o.decider) : null, caps: o.caps, classes: o.classes }, world())
}

/** What a request carries: the purpose's needs ∪ carries ∪ the sources' classes (one classOfPage memo per request). */
function requestClasses(input: Pick<PrepareInput, 'purpose' | 'sources' | 'carries'>, w: SourceWorld): Set<DataClass> {
  const purpose = purposeOf(input.purpose)
  const classes = new Set<DataClass>([...purpose.needs, ...(input.carries ?? [])])
  const sources = isSources(input.sources) ? input.sources : [{ all: true } as const]
  for (const c of classesOf(sources, w)) classes.add(c)
  return classes
}

const sourceWorld = (): SourceWorld => {
  const s = useWorkspace.getState()
  return { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null, memo: new Map() }
}

/** A route's price row: the table for Claude, the shortlist row / a dynamic route's stated bound for the others. */
const priceOf = (route: Route, pool?: readonly string[]): PriceRow | null => (route.p === 'anthropic' ? priceRow(route) : priceFor(route, pool))

/**
 * The other routes of a request's own provider that pass the gate's filters for it (key · known · capability · data
 * rule): Claude's selectable models, the OpenRouter shortlist (never across the Jev Router, whose bound is its pool's).
 */
function sameProvider(cls: FeatureClass, route: Route, caps: readonly Need[], classes: readonly DataClass[]): Array<Extract<Resolved, { ok: true }>> {
  const w = world()
  const candidates: Route[] =
    route.p === 'anthropic'
      ? MODELS.filter((m) => m.route.p === 'anthropic' && m.selectable && m.route.m !== route.m).map((m) => ({ p: 'anthropic', m: m.route.m }))
      : route.p === 'openrouter' && !isJevRouter(route.m)
        ? shortlist()
            .filter((r) => r.m !== route.m)
            .map((r) => ({ p: 'openrouter' as const, m: r.m }))
        : []
  const out: Array<Extract<Resolved, { ok: true }>> = []
  for (const c of candidates) {
    const res = resolveRoute({ cls, chip: c, caps, classes }, w)
    if (res.ok && res.level === 'chip') out.push(res)
  }
  return out
}

/** H's candidates for a prepared request: the same provider's models that pass its filters, priced, with their caps. */
function haltCandidates(p: Prepared): HCandidate[] {
  const input = inputs.get(p)
  if (!p.route || !input) return []
  const purpose = purposeOf(input.purpose)
  const caps = [...new Set([...purpose.caps, ...(input.needs ?? [])])]
  return sameProvider(p.cls, p.route, caps, p.classes).flatMap((res) => {
    const row = priceOf(res.route, res.pool)
    return res.info.caps ? [{ route: res.route, label: labelFor(res.route, res.pool), caps: res.info.caps, row, blended: blendedPerM(row) }] : []
  })
}

/**
 * The cheaper routes of a request's own provider that pass the gate's filters for it (key · known · capability · data
 * rule), each with its band — the brake offers the best that fits as B (a retry with that route as a chip). Never another
 * provider (its data rules and tokenizer differ).
 */
function cheaperChoices(cls: FeatureClass, route: Route, caps: readonly Need[], classes: readonly DataClass[], size: PrepareInput['size'] | null): Array<{ route: Route; band: Band | null }> {
  if (!size) return []
  const out: Array<{ route: Route; band: Band | null }> = []
  for (const res of sameProvider(cls, route, caps, classes)) {
    const price = res.route.p === 'anthropic' ? undefined : priceFor(res.route, res.pool)
    // the answer budget as the call would set it on THAT model (a model without thinking asks for less)
    const visible = typeof size.maxTokens === 'function' ? size.maxTokens(res.info.caps) : size.maxTokens
    const out1 = Math.min(visible, size.bandOut ?? visible)
    out.push({ route: res.route, band: estimate(res.route, { promptChars: size.promptChars, maxTokens: out1 }, Date.now(), price, res.info.caps, wireHintsFor(res.route, res.info)) })
  }
  return out
}

const DEMO_SHAPE = { redact: { people: false, transcript: false }, visible: () => true, sees: 'all' as const, allows: () => true }

function gate(input: PrepareInput, held: boolean, backstopToo = false): Prepared {
  checkContract(input)
  const s = useWorkspace.getState()
  // 0 · rules this build does not know
  if (!policyKnown(s.ai, s.settings.ai, buildGen())) throw new AIError('reload')
  // 1 · a key typed into a request
  if (typedTexts(input.typed).some(looksLikeKey)) throw new AIError('key_in_text')
  // 2 · AUS
  if (offHook()) throw new AIError('off')
  // 3 · what the request carries: needs ∪ carries ∪ the sources' classes (one classOfPage memo per request)
  const purpose = purposeOf(input.purpose)
  const w = sourceWorld()
  const classes = requestClasses(input, w)
  // 4 · the route
  const caps = [...new Set([...purpose.caps, ...(input.needs ?? [])])]
  const res = resolveFor(purpose.cls, { chip: input.route, model: input.model, decider: input.decider, caps, classes: [...classes] })
  // a decision nobody chose a Vorprüfer for: nothing is sent (never demo, never Claude)
  if (!res.ok && res.none && res.code === 'no_route') throw new AIError('no_route', 'gate', undefined, undefined, [{ kind: 'step', step: 'models', provider: 'openrouter' }])
  if (!res.ok && res.none) {
    if (usesDemo()) return { purpose: input.purpose, cls: purpose.cls, route: null, provider: 'demo', model: 'demo', caps: null, classes: [...classes], steps: res.steps, reservation: null, level: null, label: 'Demo', run: runOf(input), ...DEMO_SHAPE }
    throw new AIError('no_key', undefined, undefined, undefined, [{ kind: 'step', step: 'key', provider: 'anthropic' }])
  }
  if (!res.ok) throw new AIError(res.code, res.detail, undefined, labelFor(res.route), res.fixes)
  const route = res.route
  const pool = res.pool
  const label = labelFor(route, pool)
  const sees = seesEverything(route.p, s.ai, s.settings.ai) ? 'all' : 'filtered'
  const redact = redactionFor(route.p, s.ai, s.settings.ai)
  const hiddenMember: DataClass[] = MEMBER_CLASSES.filter((c) => !allowedFor(route.p, c, s.ai, s.settings.ai))
  const visible = (id: ID): boolean => !hiddenMember.length || ![...classOfPage(id, w)].some((c) => hiddenMember.includes(c))
  const allows = (c: DataClass): boolean => allowedFor(route.p, c, s.ai, s.settings.ai)
  // 5 · the backstop (D-S2-5): text built without the route's redaction / filter never goes to a route that may not see it
  const concerned = held || backstopToo ? backstop({ classes: [...classes], pageDerived: PAGE_DERIVED, sees, redact, hidden: hiddenMember, applied: input.applied, route: routeKey(route) }) : null
  if (concerned) throw new AIError('policy', concerned, undefined, label, [{ kind: 'step', step: 'data', provider: route.p, data: concerned }])
  // 6 · the brake and the reservation: the upper end of the request's band unless the brake says otherwise — a route
  //     priced per request reserves its stated bound (never 0). Money only in prepare (held: it reserves, may cap a text
  //     answer, may refuse 'budget'); precheck only peeks. No line set: the identity (today's bytes).
  const known = res.info.caps
  const size = input.size
  const price = route.p === 'anthropic' ? undefined : priceFor(route, pool)
  const visibleOut = size ? (typeof size.maxTokens === 'function' ? size.maxTokens(known) : size.maxTokens) : 0
  const bandOut = size ? Math.min(visibleOut, size.bandOut ?? visibleOut) : 0
  // the wire's facts as far as this tab knows them — never fewer than the wire will use (registry.ts wireHintsFor)
  const hints = wireHintsFor(route, res.info)
  const band = size ? estimate(route, { promptChars: size.promptChars, maxTokens: bandOut }, Date.now(), price, known, hints) : null
  const run = runOf(input)
  const ctx: BrakeCtx = {
    purpose: input.purpose,
    cls: purpose.cls,
    route,
    caps: known,
    ...(pool ? { pool } : {}),
    classes: [...classes],
    size: size ? { promptTokens: Math.max(0, Math.round(size.promptChars / CHARS_PER_TOKEN)), maxTokens: visibleOut, bandOut } : null,
    band,
    run,
    chip: !!input.route && (input.pinned ?? 'person') === 'person',
    // MCP joins Claude routes that may receive it only (client.ts attachMcp)
    mcp: input.mcp && route.p === 'anthropic' && allows('mcp') ? { servers: Math.max(0, input.mcp.servers), toolChars: input.mcp.toolChars ?? [], ...(input.mcp.rounds ? { rounds: input.mcp.rounds } : {}) } : { servers: 0, toolChars: [] },
    price: price !== undefined ? price : priceRow(route),
    ...(hints ? { hints } : {}),
    label,
    ...(input.answer ? { answer: input.answer } : {}),
    cheaper: () => cheaperChoices(purpose.cls, route, caps, [...classes], size ?? null),
  }
  let usd = band?.high ?? 0
  let capped: number | undefined
  let allowance: number | undefined
  let braked: Band | null | undefined
  let steps = res.steps
  let hint: MoneyHint | null | undefined
  if (held) {
    const said = brake.money?.(ctx)
    if (typeof said === 'number') usd = said
    else if (said) {
      if (typeof said.reserve === 'number') usd = said.reserve
      if (typeof said.maxTokens === 'number') capped = said.maxTokens
      if (typeof said.allowance === 'number' && said.allowance > 0) allowance = said.allowance
      if (said.band !== undefined) braked = said.band
      if (said.steps?.length) steps = [...steps, ...said.steps]
    }
  } else hint = brake.peek?.(ctx) ?? null
  return {
    purpose: input.purpose,
    cls: purpose.cls,
    route,
    provider: route.p,
    model: route.m,
    caps: known,
    classes: [...classes],
    steps,
    reservation: held ? reserve(usd, run.source) : null,
    ...(capped !== undefined ? { maxTokens: capped } : {}),
    ...(braked !== undefined ? { band: braked } : {}),
    ...(allowance !== undefined ? { allowance } : {}),
    ...(hint !== undefined ? { hint } : {}),
    ...(pool ? { pool: [...pool] } : {}),
    level: res.level,
    redact,
    visible,
    sees,
    allows,
    label,
    run,
  }
}

/* ------------------------------------------------------------------ */
/* routeFor · aiStatus (the same resolution, nothing sent or reserved)   */
/* ------------------------------------------------------------------ */

/**
 * The route a request of this purpose would take on this device (D-S2-32) — for estimates and limits shown before a
 * request (a cost band, a PDF's pages). A refused rule still names its first pin; no rule and no key: Claude with this
 * device's model (what a key would give, as before).
 */
export function routeFor(purposeId: PurposeId, o: { route?: Route | null } = {}): { route: Route; pool?: string[]; label: string } {
  const purpose = purposeOf(purposeId)
  const res = resolveFor(purpose.cls, { chip: o.route, caps: purpose.caps, classes: [...purpose.needs] })
  if (res.ok) return { route: res.route, ...(res.pool ? { pool: res.pool } : {}), label: labelFor(res.route, res.pool) }
  const route = !res.none ? res.route : legacyRule(useWorkspace.getState().settings.aiModel, true)[0]!
  return { route, label: labelFor(route) }
}

/**
 * The Vorprüfer a pre-check would ask now (slice SJ, the class 'gate'): the agent's own `decider`, else this device's,
 * else the workspace's rule — no default, no legacy. `route` is the pin that level names even when it is refused here
 * (`code` says why: no key, a data rule …); null with 'no_route' = nobody chose one.
 */
export function deciderRoute(decider?: Route | null): { route: Route | null; level: 'agent' | 'device' | 'workspace' | null; code: AIErrorCode | 'no_route' | null } {
  const purpose = purposeOf('gate.precheck')
  const res = resolveFor('gate', { decider: decider ?? null, caps: purpose.caps, classes: [...purpose.needs] })
  if (res.ok) return { route: res.route, level: res.level === 'agent' || res.level === 'device' || res.level === 'workspace' ? res.level : null, code: null }
  if (res.none) return { route: null, level: null, code: 'no_route' }
  return { route: res.route, level: res.level === 'agent' || res.level === 'device' || res.level === 'workspace' ? res.level : null, code: res.code }
}

export interface AIStatus {
  /** a request would go out (or get a demo answer) */
  ready: boolean
  /** the route it would take (null: none — see `reason`, or demo) */
  route: Route | null
  demo: boolean
  /** why it would not: 'reload' (newer rules) · 'no_key' · 'off' · 'policy' · 'capability' · 'route' (this kind of work
   *  runs only on a provider without a key here — "Claude einrichten") · 'model_gone' · 'no_route' (a decision: no
   *  Vorprüfer chosen) */
  reason: 'reload' | 'no_key' | 'off' | 'policy' | 'capability' | 'route' | 'model_gone' | 'no_route' | null
  /** what to do about it (the first refused pin's) */
  fix?: AIFix
}

/** Can a request of this purpose go out on this device now, and where to? (no sources: the purpose's needs only) */
export function aiStatus(purposeId: PurposeId): AIStatus {
  const s = useWorkspace.getState()
  if (!policyKnown(s.ai, s.settings.ai, buildGen())) return { ready: false, route: null, demo: false, reason: 'reload' }
  if (offHook()) return { ready: false, route: null, demo: false, reason: 'off' }
  const purpose = purposeOf(purposeId)
  const res = resolveFor(purpose.cls, { caps: purpose.caps, classes: [...purpose.needs] })
  if (res.ok) return { ready: true, route: res.route, demo: false, reason: null }
  if (res.none && res.code === 'no_route') return { ready: false, route: null, demo: false, reason: 'no_route', fix: { kind: 'step', step: 'models', provider: 'openrouter' } }
  if (res.none) {
    if (usesDemo()) return { ready: true, route: null, demo: true, reason: null }
    // a key for another provider that does not take this kind of work (yet): set up Claude for it
    const other = (['openai', 'openrouter'] as const).filter((p) => hasAIKey(p))
    const route = other.length && other.every((p) => !routable(p, purpose.cls))
    return { ready: false, route: null, demo: false, reason: route ? 'route' : 'no_key', fix: { kind: 'step', step: 'key', provider: 'anthropic' } }
  }
  const reason = res.code === 'policy' || res.code === 'capability' || res.code === 'model_gone' || res.code === 'no_key' ? res.code : 'no_key'
  return { ready: false, route: res.route, demo: false, reason, ...(res.fixes[0] ? { fix: res.fixes[0] } : {}) }
}

/* ------------------------------------------------------------------ */
/* routeChoices: the route picker's rows (B8 — the same filters)        */
/* ------------------------------------------------------------------ */

/** Why a route does not fit this request: an error code of the filters, 'later' (not routable for this kind of work
 *  yet), 'typesafe' (the operator rule names the Jev Router's operator), 'needs2' (the router's pool holds < 2). */
export type ChoiceWhy = { code: AIErrorCode | 'later' | 'typesafe' | 'needs2'; detail?: string }

export interface RouteChoice {
  /** routeKey + effort: unique per row */
  key: string
  route: Route
  /** 'now': what the rules choose without a chip · 'rule': this kind of work's rule · 'models' · 'router' */
  group: 'now' | 'rule' | 'models' | 'router'
  ok: boolean
  why?: ChoiceWhy
  /** the Jev Router: the shortlist models it may choose from */
  pool?: string[]
  /** its price row (the router: the stated bound of its pool) */
  price: PriceRow | null
  label: string
  short: string
}

export interface RouteChoices {
  cls: FeatureClass
  /** the route this request takes without a chip (null: none — no key, a refused rule) */
  now: Route | null
  rows: RouteChoice[]
  /** the ROUTER group is shown (OpenRouter set up on this device, the router allowed by the owner) */
  router: boolean
}

const choiceKey = (r: Route): string => `${routeKey(r)}${r.effort ? `#${r.effort}` : ''}`

/**
 * The route picker's rows for a request (§ 12.5): the route the rules choose now, the kind of work's rule, Claude's
 * models (a key here), the OpenRouter shortlist (a key here), the Jev Router's tiers — each through the gate's own
 * filters (key · known · capability · data rule) for this request's classes; the ones that do not fit carry one reason.
 */
export function routeChoices(purposeId: PurposeId, o: { sources?: readonly SourceRef[]; carries?: readonly DataClass[]; needs?: readonly Need[] } = {}): RouteChoices {
  const s = useWorkspace.getState()
  const purpose = purposeOf(purposeId)
  const classes = [...requestClasses({ purpose: purposeId, sources: o.sources ?? [{ all: true }], carries: o.carries }, sourceWorld())]
  const caps = [...new Set([...purpose.caps, ...(o.needs ?? [])])]
  const w = world()
  const check = (route: Route): Pick<RouteChoice, 'ok' | 'why' | 'pool'> => {
    if (!routable(route.p, purpose.cls)) return { ok: false, why: { code: 'later' } }
    const res = resolveRoute({ cls: purpose.cls, chip: route, caps, classes }, w)
    if (res.ok) return res.level === 'chip' ? { ok: true, ...(res.pool ? { pool: res.pool } : {}) } : { ok: false, why: { code: 'later' } }
    if (res.none) return { ok: false, why: { code: 'no_key' } }
    return { ok: false, why: { code: res.code, ...(res.detail !== undefined ? { detail: res.detail } : {}) } }
  }
  const row = (route: Route, group: RouteChoice['group']): RouteChoice => {
    const c = check(route)
    const info = modelInfo(route, c.pool)
    return { key: choiceKey(route), route, group, ...c, price: priceFor(route, c.pool), label: labelFor(route, c.pool), short: info?.short ?? shortFor(route) }
  }
  const rows: RouteChoice[] = []
  const seen = new Set<string>()
  const add = (r: RouteChoice) => {
    if (seen.has(r.key)) return
    seen.add(r.key)
    rows.push(r)
  }
  // the route without a chip
  const nowRes = resolveFor(purpose.cls, { caps, classes })
  const now = nowRes.ok ? nowRes.route : null
  if (now) add({ ...row(now, 'now'), ok: true, ...(nowRes.ok && nowRes.pool ? { pool: nowRes.pool } : {}) })
  // this kind of work's rule (the device's, else the workspace's)
  const rule = s.settings.ai?.routes?.[purpose.cls] ?? s.ai?.routes?.[purpose.cls] ?? []
  for (const pin of rule) if (!isJevRouter(pin.m)) add(row(pin, 'rule'))
  // Claude's models (a key here)
  const claudeKey = !!s.settings.aiApiKey.trim()
  if (claudeKey) for (const m of MODELS) if (m.route.p === 'anthropic' && m.selectable) add(row({ p: 'anthropic', m: m.route.m }, 'models'))
  // the OpenRouter shortlist (a key here)
  const orKey = hasAIKey('openrouter')
  const list = shortlist()
  if (orKey) for (const r of list) add(row({ p: 'openrouter', m: r.m }, 'models'))
  // the Jev Router: three tiers over the pool (≥ 2 models), else one row saying why not
  const router = orKey && OWNER.jevRouter && list.length > 0
  // an empty pool: what none of the shortlist can do for this request (an MCP server, a picture …), else too few models
  const poolWhy = (ids: readonly string[]): ChoiceWhy => {
    const missing = caps.find((n) => ids.every((m) => !canDo(modelInfo({ p: 'openrouter', m })?.caps, n)))
    return missing ? { code: 'capability', detail: missing } : { code: 'needs2' }
  }
  if (router) {
    const deny = (s.ai?.policy?.providers?.openrouter?.upstream?.deny ?? []).map((x) => x.toLowerCase())
    const denied = deny.some((x) => x === JEV_OPERATOR.toLowerCase() || x.startsWith(`${JEV_OPERATOR.toLowerCase()}/`))
    for (const tier of JEV_TIERS) {
      const r = row({ p: 'openrouter', m: JEV_ROUTER, effort: tier }, 'router')
      if (denied) add({ ...r, ok: false, why: { code: 'typesafe' } })
      else if (r.ok && (r.pool?.length ?? 0) < 2) add({ ...r, ok: false, why: { code: 'needs2' } })
      else if (!r.ok && r.why?.code === 'capability' && r.why.detail === 'pool') add({ ...r, why: poolWhy(list.map((x) => x.m)) })
      else add(r)
    }
  }
  return { cls: purpose.cls, now, rows, router }
}
