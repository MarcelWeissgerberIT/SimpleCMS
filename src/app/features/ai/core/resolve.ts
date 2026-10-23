/**
 * Which route a request takes (design § 8.1 / 8.2, the S2 subset) — pure over a RouteWorld, so the Node specs run it:
 *
 *   chip (this request only) → own agent model (class agents) → device.routes[cls] → workspace.routes[cls] → device.default → workspace.routes['*'] → legacy
 *
 * The first level that has a rule wins (levels are never merged). A pin whose provider does not take the class yet
 * (routable.ts) is skipped; a rule left without pins is skipped to the next level (a step says so). The winning rule's
 * pins go through the filters in order — 1 a key on this device · 2 the model known and not refused (a gone shortlist
 * model: 'model_gone'; a chat purpose never takes a decision model) · 3 what the request needs of the model · 4 the
 * data rule over the request's classes — and the first pin that passes is the route. None passes: the first pin's error,
 * with one fix per refused pin (S2 never falls through to the next level — D-S2-4). The Jev Router's pin is a pool:
 * filters 2–3 run per shortlist model; the models that pass are what it may choose from (≥ 1, else 'capability' with
 * the fix "pick models").
 *
 * The class 'gate' (slice SJ, Jev as Vorprüfer) resolves on its own levels — the agent's own Vorprüfer (`decider`) →
 * device.routes.gate → workspace.routes.gate (no chip) — with NO default and NO legacy level: nothing chosen = 'no_route'. Only a
 * Jev version with the decisions capability passes filter 2 (never Claude, never the router, never a chat model, never
 * another decision model); every other class refuses a decision model.
 */
import type { AIErrorCode } from '@/shared/ai/errors'
import type { Caps, DataClass, DeviceAI, FeatureClass, ModelInfo, Route, RouteRule, StepNote, WorkspaceAI } from '@/shared/ai/types'
import { SHARED_PREFIX } from '@/shared/ai/shared-model'
import { refusedClasses, MEMBER_CLASSES } from '@/shared/ai/policy'
import { legacyRule, routeKey } from '@/shared/ai/route'
import { refusedSlug } from '@/shared/ai/models'
import { isJevModel, isJevRouter } from '@/shared/ai/jev'
import { OWNER } from '@/shared/ai/owner'
import type { AIFix } from './errors'
import type { Need } from './purposes'
import { routable } from './routable'

export interface RouteWorld {
  ws?: WorkspaceAI | null
  device?: DeviceAI | null
  /** settings.aiModel (the legacy level's model) */
  aiModel?: string | null
  /** a key for the provider on this device (its marker is set) */
  hasKey(p: Route['p']): boolean
  /** the model view of a route (registry, shortlist, the router's view over a pool) — null: unknown here */
  info(route: Route, pool?: readonly string[]): ModelInfo | null
  /** the device's OpenRouter shortlist (model ids — the router's pool candidates) */
  shortlist: readonly string[]
}

export type Level = 'forced' | 'chip' | 'agent' | 'device' | 'workspace' | 'default' | 'workspace-default' | 'legacy'

export interface ResolveInput {
  cls: FeatureClass
  /** the e2e seam's forced route (`?e2e` only), before every level */
  forced?: { route: Route; pool?: readonly string[] } | null
  /** the route chip: this request only */
  chip?: Route | null
  /** An own Claude model: class agents takes it before defaults; other classes use it at the legacy level. */
  model?: string | null
  /** class 'gate': the agent's own Vorprüfer (review v2 `decider`) — its level, before the device's rule */
  decider?: Route | null
  /** what the model must be able to do (the purpose's ∪ the call's) */
  caps: readonly Need[]
  /** the data classes the request carries (needs ∪ carries ∪ sources) */
  classes: readonly DataClass[]
}

export type Resolved =
  | { ok: true; route: Route; info: ModelInfo; pool?: string[]; level: Level; steps: StepNote[] }
  /** no rule and no Claude key: demo (when on) or 'no_key' — the gate decides; `code: 'no_route'`: class 'gate' with no
   *  rule at all (never demo, never a default) */
  | { ok: false; none: true; steps: StepNote[]; code?: 'no_route' }
  | { ok: false; none?: false; code: AIErrorCode; detail?: string; route: Route; level: Level; steps: StepNote[]; fixes: AIFix[] }

/** Can a model do what a request needs? (no caps known: no) */
export function canDo(caps: Caps | null | undefined, n: Need): boolean {
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
    case 'decisions':
      return !!caps.decisions
  }
}

interface Skip {
  code: AIErrorCode
  detail?: string
  step: StepNote
  fix: AIFix | null
}

type PinResult = { ok: true; info: ModelInfo; pool?: string[] } | ({ ok: false } & Skip)

/** A model of the shortlist the router may choose for this request (filters 2–3 for that model). */
function poolOk(m: string, input: ResolveInput, w: RouteWorld): boolean {
  if (isJevRouter(m) || refusedSlug(m)) return false
  const info = w.info({ p: 'openrouter', m })
  if (!info || info.caps.decisions) return false
  return input.caps.every((n) => canDo(info.caps, n))
}

/** Filters 1–4 for one pin. */
function filterPin(route: Route, input: ResolveInput, w: RouteWorld, forcedPool?: readonly string[]): PinResult {
  const key = routeKey(route)
  // 1 · a key on this device
  if (!w.hasKey(route.p)) return { ok: false, code: 'no_key', step: { k: 'nokey', from: key }, fix: { kind: 'step', step: 'key', provider: route.p } }
  // 2 · known and not refused (+ the router's pool: filters 2–3 per shortlist model); the router writes text — never a
  //     Vorprüfer
  let info: ModelInfo | null
  let pool: string[] | undefined
  if (input.cls === 'gate' && isJevRouter(route.m)) return { ok: false, code: 'capability', detail: 'decisions', step: { k: 'capability', from: key, code: 'decisions' }, fix: { kind: 'step', step: 'models', provider: 'openrouter' } }
  if (route.p === 'openrouter' && isJevRouter(route.m)) {
    if (!OWNER.jevRouter) return { ok: false, code: 'model_gone', detail: 'router', step: { k: 'capability', from: key, code: 'gone' }, fix: { kind: 'step', step: 'models', provider: route.p } }
    pool = [...new Set(forcedPool ?? w.shortlist)].filter((m) => poolOk(m, input, w))
    if (!pool.length) return { ok: false, code: 'capability', detail: 'pool', step: { k: 'capability', from: key, code: 'pool' }, fix: { kind: 'step', step: 'models', provider: route.p } }
    info = w.info(route, pool)
  } else {
    info = route.p === 'openrouter' && refusedSlug(route.m) ? null : w.info(route)
  }
  if (!info) return { ok: false, code: 'model_gone', step: { k: 'capability', from: key, code: 'gone' }, fix: { kind: 'step', step: 'models', provider: route.p } }
  // decisions: the class 'gate' takes a Jev version and nothing else; every other class never takes a decision model
  const decider = route.p === 'openrouter' && isJevModel(route.m) && !!info.caps.decisions
  if (input.cls === 'gate' ? !decider : !!info.caps.decisions) return { ok: false, code: 'capability', detail: 'decisions', step: { k: 'capability', from: key, code: 'decisions' }, fix: input.cls === 'gate' ? { kind: 'step', step: 'models', provider: 'openrouter' } : null }
  // 3 · what the request needs of the model
  const missing = input.caps.find((n) => !canDo(info.caps, n))
  if (missing) return { ok: false, code: 'capability', detail: missing, step: { k: 'capability', from: key, code: missing }, fix: missing === 'decisions' ? { kind: 'step', step: 'models', provider: 'openrouter' } : { kind: 'pick', need: missing } }
  // 4 · the data rule
  const refused = (route.p === 'local' && route.m.startsWith(SHARED_PREFIX) ? input.classes.find(c => MEMBER_CLASSES.some(m => m === c)) : undefined) ?? refusedClasses(route.p, input.classes, w.ws, w.device)[0]
  if (refused) return { ok: false, code: 'policy', detail: refused, step: { k: 'policy', from: key, cls: refused }, fix: { kind: 'step', step: 'data', provider: route.p, data: refused } }
  return { ok: true, info, ...(pool ? { pool } : {}) }
}

/** The rule of each level, in order (absent: that level has none). The class 'gate' has no default level. */
function levels(input: ResolveInput, w: RouteWorld): Array<[Level, RouteRule | null | undefined]> {
  if (input.cls === 'gate')
    return [
      ['agent', input.decider ? [input.decider] : null],
      ['device', w.device?.routes?.gate],
      ['workspace', w.ws?.routes?.gate],
    ]
  return [
    ['chip', input.chip ? [input.chip] : null],
    ['agent', input.cls === 'agents' && input.model ? [{p:'anthropic',m:input.model}] : null],
    ['device', w.device?.routes?.[input.cls]],
    ['workspace', w.ws?.routes?.[input.cls]],
    ['default', w.device?.default],
    ['workspace-default', w.ws?.routes?.['*']],
  ]
}

function winning(rule: RouteRule, level: Level, input: ResolveInput, w: RouteWorld, steps: StepNote[], forcedPool?: readonly string[]): Resolved {
  const skips: Skip[] = []
  for (const pin of rule) {
    const r = filterPin(pin, input, w, forcedPool)
    if (r.ok) return { ok: true, route: pin, info: r.info, ...(r.pool ? { pool: r.pool } : {}), level, steps }
    steps.push(r.step)
    skips.push(r)
  }
  const first = skips[0]!
  return { ok: false, code: first.code, ...(first.detail !== undefined ? { detail: first.detail } : {}), route: rule[0]!, level, steps, fixes: skips.map((s) => s.fix).filter((f): f is AIFix => !!f) }
}

/** The route a request takes (or why none). */
export function resolveRoute(input: ResolveInput, w: RouteWorld): Resolved {
  const steps: StepNote[] = []
  if (input.forced) return winning([input.forced.route], 'forced', input, w, steps, input.forced.pool)
  // A person's explicit pick must never fall through to a different provider when the action changes class.
  // Stored defaults may still skip an unsupported class, as before.
  if (input.cls !== 'gate' && input.chip && !routable(input.chip.p, input.cls)) {
    steps.push({ k: 'capability', from: routeKey(input.chip), code: 'class' })
    return { ok: false, code: 'capability', detail: input.cls, route: input.chip, level: 'chip', steps, fixes: [{ kind: 'step', step: 'models', provider: input.chip.p }] }
  }
  for (const [level, rule] of levels(input, w)) {
    if (!rule?.length) continue
    const pins = rule.filter((r) => routable(r.p, input.cls))
    if (!pins.length) {
      // a provider that does not take this kind of work yet: the next level (shown as a step)
      steps.push({ k: 'fallthrough', from: routeKey(rule[0]!), code: 'later' })
      continue
    }
    return winning(pins, level, input, w, steps)
  }
  // a decision is asked only of a Vorprüfer someone chose: no default, no legacy (never Claude)
  if (input.cls === 'gate') return { ok: false, none: true, steps, code: 'no_route' }
  const legacy = legacyRule(input.model || w.aiModel, w.hasKey('anthropic'))
  if (!legacy.length) return { ok: false, none: true, steps }
  return winning(legacy, 'legacy', input, w, steps)
}

/** What a call site did to its request text for the route (D-S2-5) — core/gate.ts Applied. */
export interface AppliedShape {
  people: boolean
  transcript: boolean
  visible: boolean
  route?: string
}

/**
 * The gate's backstop (D-S2-5), pure: the class a request is refused for (null: it may go). Only a request carrying a
 * page-derived class to a route that does not see everything is checked: its text must have gone through that route's
 * redaction (people, transcript) and page filter (member classes it may not see) — never decided by purpose name.
 */
export function backstop(o: {
  classes: readonly DataClass[]
  pageDerived: readonly DataClass[]
  sees: 'all' | 'filtered'
  redact: { people: boolean; transcript: boolean }
  /** member classes the route may not see (pages of them are filtered) */
  hidden: readonly DataClass[]
  applied?: AppliedShape | null
  route: string
}): DataClass | null {
  if (o.sees === 'all') return null
  const derived = o.classes.find((c) => o.pageDerived.includes(c))
  if (!derived) return null
  const a = o.applied
  if (!a || (a.route && a.route !== o.route)) return derived
  if (o.redact.people && !a.people) return 'people'
  if (o.redact.transcript && !a.transcript) return 'transcript'
  if (o.hidden.length && !a.visible) return o.hidden[0]!
  return null
}
