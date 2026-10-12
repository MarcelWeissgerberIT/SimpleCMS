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
 *  5. the brake hook (identity until the governor) and an in-tab reservation, settled by settle() when the request ends.
 *
 * In DEV and `?e2e` a call without a known purpose or a source list — or with no sources for a purpose that carries
 * page data — throws (the recorder's strict() pattern): every call site names what it sends.
 */
import type { Caps, DataClass, FeatureClass, Reservation, Route, RuntimeProviderId, SourceRef, StepNote } from '@/shared/ai/types'
import { policyKnown } from '@/shared/ai/policy'
import { legacyRule } from '@/shared/ai/route'
import { capsOf } from '@/shared/ai/models'
import { looksLikeKey } from '@/shared/ai/keys'
import { useWorkspace } from '../../../store/store'
import { newId } from '../../../lib/ids'
import { AIError } from './errors'
import { isAIDemo } from './demoMode'
import { classesOf, isSources } from './sources'
import { isPurposeId, purposeOf, type Need, type PurposeId } from './purposes'

export interface PrepareInput {
  purpose: PurposeId
  /** what the request carries: pages, rows, databases, an uploaded file, or the workspace as a whole */
  sources: readonly SourceRef[]
  /** what the person typed for this request (instruction, question, prompt): refused when it looks like a key */
  typed?: string | ReadonlyArray<string | null | undefined> | null
  /** what this call needs beyond the purpose (vision, pdf, structured, tools, mcp) */
  needs?: readonly Need[]
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
}

/* ------------------------------------------------------------------ */
/* Hooks (identity until the governor)                                  */
/* ------------------------------------------------------------------ */

let offHook: () => boolean = () => false
/** AUS: while it answers true, every request is refused ('off'). */
export function registerAIOff(fn: () => boolean): void {
  offHook = fn
}

export type BeforeSend = (purpose: PurposeId, route: Route | null) => number | void
let beforeSendHook: BeforeSend = () => 0
/** The brake: may throw an AIError to stop a request; returns the amount (USD) to reserve. */
export function registerBeforeSend(fn: BeforeSend): void {
  beforeSendHook = fn
}

/* ------------------------------------------------------------------ */
/* Reservations (in this tab)                                           */
/* ------------------------------------------------------------------ */

const MAX_OPEN = 200
const open = new Map<string, Reservation>()

function reserve(usd: number, source: string): Reservation {
  const r: Reservation = { id: newId(), usd: Math.max(0, usd), at: Date.now(), source }
  open.set(r.id, r)
  // a request that never settles (a crashed tab path) cannot grow the book without end
  if (open.size > MAX_OPEN) open.delete(open.keys().next().value as string)
  return r
}

/** The request ended (answered, failed or stopped): its reservation is released. */
export function settle(p: Prepared | null | undefined): void {
  if (p?.reservation) open.delete(p.reservation.id)
}

/** Open reservations of this tab (USD). */
export const reservedUsd = (): number => [...open.values()].reduce((sum, r) => sum + r.usd, 0)

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
  // 4 · the route: the legacy level (Claude + this device's model), demo without a key
  const hasKey = !!s.settings.aiApiKey.trim()
  const [route] = legacyRule(s.settings.aiModel, hasKey)
  if (!route) {
    if (isAIDemo()) return { purpose: input.purpose, cls: purpose.cls, route: null, provider: 'demo', model: 'demo', caps: null, classes: [...classes], steps: [], reservation: null }
    throw new AIError('no_key')
  }
  // 5 · the brake (may throw) and the reservation
  const usd = beforeSendHook(input.purpose, route) ?? 0
  return { purpose: input.purpose, cls: purpose.cls, route, provider: route.p, model: route.m, caps: capsOf(route), classes: [...classes], steps: [], reservation: reserve(usd, input.purpose) }
}
