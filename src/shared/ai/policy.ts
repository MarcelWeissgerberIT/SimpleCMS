import { readDataFlow, modelDestinationAllowed, hasFlowLimits } from './dataFlow.ts'
import { isWorkerProvider } from './providers.ts'
/**
 * The AI rules as stored — Workspace.ai (synced, owners / admins) and settings.ai (this device) — what they let a
 * provider receive (allowedFor: shared classes by the workspace, member classes by the member on their device, narrowed
 * on a device), the presets, what a backup would loosen, and the policy generation: a tab whose build is older than the
 * generation a stored rule needs refuses every AI request (it would not enforce that rule).
 */
import type { Caps, DataClass, DeviceAI, FeatureClass, MemberClass, PriceOverride, PriceRow, ProviderId, ProviderPolicy, Restriction, RouteRule, SharedClass, ShortlistRow, UpstreamRule, WorkspaceAI } from './types.ts'
import { EFFORTS, STORED_PROVIDERS, isProviderId, modelIdProblem } from './models.ts'
import { PRICE_KEYS } from './prices.ts'
import { sanitizeRule } from './route.ts'
import { isJevRouter } from './jev.ts'
import { OWNER } from './owner.ts'
import { GEN } from './generations.ts'

export const SHARED_CLASSES: readonly SharedClass[] = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
export const MEMBER_CLASSES: readonly MemberClass[] = ['private', 'mail', 'memory', 'mcp']
export const DATA_CLASSES: readonly DataClass[] = [...SHARED_CLASSES, ...MEMBER_CLASSES]
export const FEATURE_CLASSES: readonly FeatureClass[] = ['write', 'ask', 'workspace', 'structure', 'vision', 'documents', 'bulk', 'meeting', 'memory', 'outbox', 'terminal', 'agents', 'scripts', 'help', 'review', 'generate', 'mcp-setup', 'gate']

/**
 * This build's AI policy generation (generations.ts names each entry; this is N only in a build holding every entry
 * numbered ≤ N): 1 = no rule limits Claude; 2 = GEN.claudeLimits, data rules that limit Claude (a workspace allow list or
 * forbid for Claude, a device narrow) are enforced at every point a request is built (S2); 3 = GEN.budget, a day / month
 * budget of the workspace or this browser is enforced by the Regler's brake (features/governor/install.ts, G1). Restricted
 * pages get a GEN entry of their own, numbered when they merge — never a number promised here.
 */
export const AI_POLICY_GEN: number = GEN.dataFlow

export const MAX_RESTRICTED = 200
export const MAX_SHORTLIST = 24
const MAX_GEN = 1000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const ID_RE = /^[A-Za-z0-9_:-]{1,64}$/

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))] : [])
const gen = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_GEN ? v : undefined)
const fin = (v: unknown, min = 0): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : undefined)

function restrictions(v: unknown): Restriction[] {
  if (!Array.isArray(v)) return []
  const out: Restriction[] = []
  for (const x of v) {
    if (!isObj(x) || typeof x.root !== 'string' || !ID_RE.test(x.root)) continue
    const to = pick(x.to, STORED_PROVIDERS)
    if (out.some((o) => o.root === x.root)) continue
    out.push({ root: x.root, to })
    if (out.length >= MAX_RESTRICTED) break
  }
  return out
}

function upstream(v: unknown): UpstreamRule | undefined {
  if (!isObj(v)) return undefined
  const deny = Array.isArray(v.deny) ? [...new Set(v.deny.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9 ._/-]{1,64}$/.test(x)))].slice(0, 100) : []
  return { deny, noCollect: v.noCollect !== false, zdr: v.zdr === true }
}

function routes<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, RouteRule>> | undefined {
  if (!isObj(v)) return undefined
  const out: Partial<Record<K, RouteRule>> = {}
  for (const k of keys) {
    const r = sanitizeRule(v[k])
    if (r) out[k] = r
  }
  return Object.keys(out).length ? out : undefined
}

function perProvider<T>(v: unknown, read: (x: unknown) => T | undefined): Partial<Record<ProviderId, T>> | undefined {
  if (!isObj(v)) return undefined
  const out: Partial<Record<ProviderId, T>> = {}
  for (const p of STORED_PROVIDERS) {
    const x = read(v[p])
    if (x !== undefined) out[p] = x
  }
  return Object.keys(out).length ? out : undefined
}

/** Workspace.ai as every reader keeps it (undefined: none, or nothing valid in it). */
export function sanitizeWorkspaceAI(v: unknown): WorkspaceAI | undefined {
  if (!isObj(v)) return undefined
  const out: WorkspaceAI = {}
  if (v.sharedMemberContext === true) out.sharedMemberContext = true
  if (isObj(v.onboarding) && typeof v.onboarding.startPageId === 'string' && ID_RE.test(v.onboarding.startPageId) && v.onboarding.mcpUrl === 'https://aj-atlas.com/api/atlas/mcp' && typeof v.onboarding.mcpName === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(v.onboarding.mcpName) && typeof v.onboarding.project === 'string' && v.onboarding.project.length > 0 && v.onboarding.project.length <= 80) {
    out.onboarding = {startPageId:v.onboarding.startPageId,mcpUrl:v.onboarding.mcpUrl,mcpName:v.onboarding.mcpName,project:v.onboarding.project,skipIntro:v.onboarding.skipIntro===true}
  }
  const flow = readDataFlow(v.dataFlow)
  if (flow) out.dataFlow = flow
  const g = gen(v.gen)
  if (g !== undefined) out.gen = g
  if (isObj(v.policy)) {
    const providers = perProvider<ProviderPolicy>(v.policy.providers, (x) => {
      if (!isObj(x)) return undefined
      const forbid = pick(x.forbid, MEMBER_CLASSES)
      const up = upstream(x.upstream)
      return { allow: pick(x.allow, SHARED_CLASSES), ...(forbid.length ? { forbid } : {}), ...(up ? { upstream: up } : {}) }
    })
    out.policy = { providers: providers ?? {}, restricted: restrictions(v.policy.restricted) }
  }
  const r = routes<FeatureClass | '*'>(v.routes, [...FEATURE_CLASSES, '*'])
  if (r) out.routes = r
  const limits = perProvider(v.limits, (x) => {
    const usd = isObj(x) ? fin(x.monthUsd) : undefined
    return usd === undefined ? undefined : { monthUsd: usd }
  })
  if (limits) out.limits = limits
  const at = fin(v.updatedAt)
  if (at !== undefined) out.updatedAt = at
  if (v.updatedBy === null || (typeof v.updatedBy === 'string' && v.updatedBy.length <= 200)) out.updatedBy = v.updatedBy as string | null
  return Object.keys(out).length ? out : undefined
}

/** A capability set from a stored shortlist row (anything unclear → the more limited value). */
export function sanitizeCaps(v: unknown): Caps | null {
  if (!isObj(v)) return null
  const lim = (x: unknown, a: string, b: string) => (isObj(x) && fin(x[a], 1) !== undefined && fin(x[b], 1) !== undefined ? { [a]: x[a], [b]: x[b] } : false)
  const vision = lim(v.vision, 'maxEdge', 'maxBytes') as Caps['vision']
  const pdf = lim(v.pdf, 'maxBytes', 'maxPages') as Caps['pdf']
  const effort = pick(v.effort, EFFORTS)
  const context = fin(v.context, 1)
  const maxOutput = fin(v.maxOutput, 1)
  if (context === undefined || maxOutput === undefined) return null
  const reasoning = isObj(v.reasoning) ? { mandatory: v.reasoning.mandatory === true, ...(typeof v.reasoning.minEffort === 'string' && v.reasoning.minEffort.length <= 16 ? { minEffort: v.reasoning.minEffort } : {}) } : false
  return {
    structured: v.structured === true,
    tools: v.tools === true,
    vision,
    pdf,
    mcp: v.mcp === 'connector' || v.mcp === 'allow-only' ? v.mcp : false,
    mcpListing: v.mcpListing === true,
    cache: v.cache === 'auto+block' || v.cache === 'auto' || v.cache === 'passthrough' ? v.cache : false,
    effort: effort.length ? effort : false,
    reasoning,
    // anything but a clear "no" or "on request" is treated as searching by itself (refused)
    web: v.web === false ? false : v.web === 'on-request' ? 'on-request' : 'always',
    notes: v.notes === true,
    refusalFallback: v.refusalFallback === true,
    context,
    maxOutput,
    ...(v.decisions === true ? { decisions: true } : {}),
  }
}

/** A stored price row (null: none or not valid — a bound is never stored). */
export function sanitizePriceRow(v: unknown): PriceRow | null {
  if (!isObj(v) || v.source === 'bound') return null
  const cols: Record<string, number> = {}
  for (const k of PRICE_KEYS) {
    const n = fin(v[k])
    if (n !== undefined) cols[k] = n
  }
  if (cols.input === undefined || cols.output === undefined) return null
  const overrides: PriceOverride[] = []
  if (Array.isArray(v.overrides))
    for (const o of v.overrides.slice(0, 12)) {
      if (!isObj(o)) continue
      const x: Record<string, unknown> = {}
      for (const k of PRICE_KEYS) {
        const n = fin(o[k])
        if (n !== undefined) x[k] = n
      }
      const mp = fin(o.minPrompt)
      if (mp !== undefined) x.minPrompt = mp
      const days = pick(o.utcDays, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
      if (days.length) x.utcDays = days
      const s = fin(o.utcStart)
      const e = fin(o.utcEnd)
      if (s !== undefined && s <= 23) x.utcStart = Math.floor(s)
      if (e !== undefined && e <= 24) x.utcEnd = Math.floor(e)
      overrides.push(x as PriceOverride)
    }
  const at = typeof v.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.at) ? v.at : '1970-01-01'
  return { input: cols.input, output: cols.output, cacheRead: cols.cacheRead ?? cols.input, cacheWrite: cols.cacheWrite ?? cols.input, ...Object.fromEntries(Object.entries(cols).filter(([k]) => !['input', 'output', 'cacheRead', 'cacheWrite'].includes(k))), ...(overrides.length ? { overrides } : {}), source: v.source === 'table' ? 'table' : 'catalogue', at }
}

function shortlist(v: unknown): ShortlistRow[] {
  if (!Array.isArray(v)) return []
  const out: ShortlistRow[] = []
  for (const x of v) {
    // the Jev Router is never a row of the list — it is a pool over it (D-S2-22)
    if (!isObj(x) || typeof x.m !== 'string' || isJevRouter(x.m) || modelIdProblem('openrouter', x.m) !== null || out.some((o) => o.m === x.m)) continue
    const caps = sanitizeCaps(x.caps)
    if (!caps) continue
    out.push({ m: x.m, label: typeof x.label === 'string' ? x.label.slice(0, 80) : x.m, price: sanitizePriceRow(x.price), caps, at: typeof x.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.at) ? x.at : '1970-01-01' })
    if (out.length >= MAX_SHORTLIST) break
  }
  return out
}

/** settings.ai as every reader keeps it (undefined: none, or nothing valid in it). */
export function sanitizeDeviceAI(v: unknown): DeviceAI | undefined {
  if (!isObj(v)) return undefined
  const out: DeviceAI = {}
  if (typeof v.dataFlowHints === 'boolean') out.dataFlowHints = v.dataFlowHints
  const r = routes<FeatureClass>(v.routes, FEATURE_CLASSES)
  if (r) out.routes = r
  const d = sanitizeRule(v.default)
  if (d) out.default = d
  if (typeof v.fallbackForChosen === 'boolean') out.fallbackForChosen = v.fallbackForChosen
  const allow = perProvider(v.allow, (x) => (Array.isArray(x) ? pick(x, MEMBER_CLASSES) : undefined))
  if (allow) out.allow = allow
  const narrow = perProvider(v.narrow, (x) => (Array.isArray(x) ? pick(x, DATA_CLASSES) : undefined))
  if (narrow) out.narrow = narrow
  if (Array.isArray(v.restricted)) out.restricted = restrictions(v.restricted)
  if (Array.isArray(v.models)) out.models = shortlist(v.models)
  const roles = readRoles(v.roles)
  if (roles) out.roles = roles
  // Jev's switches: booleans only, absent = off (an S6 `compare` is kept too — a save from this tab never drops it)
  if (isObj(v.jev)) {
    const j: NonNullable<DeviceAI['jev']> = {}
    if (typeof v.jev.verify === 'boolean') j.verify = v.jev.verify
    if (typeof v.jev.compare === 'boolean') j.compare = v.jev.compare
    if (Object.keys(j).length) out.jev = j
  }
  const g = gen(v.gen)
  if (g !== undefined) out.gen = g
  return Object.keys(out).length ? out : undefined
}

const ROLE_KEYS = ['fast', 'standard', 'deep'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

/** The roles per provider (fast / standard / deep → a model id the provider's validator accepts; the Jev Router is
 *  one on OpenRouter — D-S2-9). An id this build refuses is dropped (the assistant suggests again). */
function readRoles(v: unknown): DeviceAI['roles'] | undefined {
  if (!isObj(v)) return undefined
  const out: NonNullable<DeviceAI['roles']> = {}
  for (const p of STORED_PROVIDERS) {
    const x = v[p]
    if (!isObj(x)) continue
    const r: Partial<Record<RoleKey, string>> = {}
    for (const k of ROLE_KEYS) {
      const id = x[k]
      if (typeof id === 'string' && modelIdProblem(p, id) === null) r[k] = id
    }
    if (Object.keys(r).length) out[p] = r
  }
  return Object.keys(out).length ? out : undefined
}

/* ------------------------------------------------------------------ */
/* What a provider may receive (design § 10.2)                          */
/* ------------------------------------------------------------------ */

const isShared = (c: DataClass): c is SharedClass => (SHARED_CLASSES as readonly string[]).includes(c)
const isMember = (c: DataClass): c is MemberClass => (MEMBER_CLASSES as readonly string[]).includes(c)
const has = (list: readonly string[] | undefined, c: string): boolean => !!list && list.includes(c)

/**
 * May provider `p` receive data class `cls` — on this device, under these rules?
 *  - a shared class: the workspace's allow list for `p` (Claude with no rule of its own: every class) and not narrowed
 *    on this device;
 *  - a member class (the member's own data): the member's allow on this device (Claude: always, as before) and not
 *    forbidden by the workspace and not narrowed — a workspace allow never opens one (OWNER.memberClassesOwnedByMember;
 *    false: member classes read like shared ones).
 * Absent rules: Claude = every class; OpenAI / OpenRouter = none.
 */
export function allowedFor(p: ProviderId, cls: DataClass, ws?: WorkspaceAI | null, device?: DeviceAI | null): boolean {
  if (!modelDestinationAllowed(p, ws?.dataFlow)) return false
  if (has(device?.narrow?.[p], cls)) return false
  const rule = ws?.policy?.providers?.[p]
  const claudeOpen = p === 'anthropic' && !rule
  if (isShared(cls)) return claudeOpen || has(rule?.allow, cls)
  if (!isMember(cls)) return false
  if (has(rule?.forbid, cls)) return false
  if (!OWNER.memberClassesOwnedByMember) return claudeOpen || has(rule?.allow as readonly string[] | undefined, cls)
  return p === 'anthropic' || has(device?.allow?.[p], cls)
}

/** Every class `p` may receive, in DATA_CLASSES order. */
export const allowedClasses = (p: ProviderId, ws?: WorkspaceAI | null, device?: DeviceAI | null): DataClass[] => DATA_CLASSES.filter((c) => allowedFor(p, c, ws, device))

/** The classes of a request `p` may NOT receive (in the request's order, each once). */
export const refusedClasses = (p: ProviderId, classes: Iterable<DataClass>, ws?: WorkspaceAI | null, device?: DeviceAI | null): DataClass[] => [...new Set(classes)].filter((c) => !allowedFor(p, c, ws, device))

/** Does `p` see everything (every class allowed: no redaction, no filter — today's Claude)? */
export const seesEverything = (p: ProviderId, ws?: WorkspaceAI | null, device?: DeviceAI | null): boolean => DATA_CLASSES.every((c) => allowedFor(p, c, ws, device))

/**
 * Carry-over (a chain step, fallback, variant, hand-off, replay — S5 / S6): the classes the earlier steps saw that `p`
 * may not receive ([] = it may carry on).
 */
export const carryOver = (classes: Iterable<DataClass>, p: ProviderId, ws?: WorkspaceAI | null, device?: DeviceAI | null): DataClass[] => refusedClasses(p, classes, ws, device)

/** What a route redacts from request text (true = redact): people's names, meeting transcripts. */
export function redactionFor(p: ProviderId, ws?: WorkspaceAI | null, device?: DeviceAI | null): { people: boolean; transcript: boolean } {
  return { people: !allowedFor(p, 'people', ws, device), transcript: !allowedFor(p, 'transcript', ws, device) }
}

/* ------------------------------------------------------------------ */
/* Presets (D-S2-15)                                                    */
/* ------------------------------------------------------------------ */

export type PresetId = 'all' | 'work' | 'marked'
/** The workspace presets — shared classes only (member classes are each member's own block on their device). */
export const PRESETS: Readonly<Record<PresetId, readonly SharedClass[]>> = {
  all: SHARED_CLASSES,
  work: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace'],
  marked: ['public', 'structure', 'selection'],
}

/** Which preset an allow list is ('custom': none of them; 'none': nothing allowed — a new provider starts there). */
export function presetOf(allow: readonly SharedClass[] | null | undefined): PresetId | 'custom' | 'none' {
  const set = new Set(allow ?? [])
  if (!set.size) return 'none'
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id]
    if (p.length === set.size && p.every((c) => set.has(c))) return id
  }
  return 'custom'
}

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

/** Does a stored rule limit Claude (an older build would send Claude what the rule withholds)? */
export function limitsClaude(ws?: WorkspaceAI | null, device?: DeviceAI | null): boolean {
  const rule = ws?.policy?.providers?.anthropic
  if (rule && (SHARED_CLASSES.some((c) => !rule.allow.includes(c)) || (rule.forbid?.length ?? 0) > 0)) return true
  return (device?.narrow?.anthropic?.length ?? 0) > 0
}

/**
 * The lowest generation that enforces every rule — of a workspace and / or this device — that limits a provider an
 * older build can reach: 2 when a rule limits Claude (an S1 tab sends Claude everything), else 1. Rules about OpenRouter
 * alone (and a rule pinning the Jev Router) need nothing: an S1 tab never sends to OpenRouter.
 */
export function requiredGen(ws?: WorkspaceAI | null, device?: DeviceAI | null): number {
  if (hasFlowLimits(ws?.dataFlow) || ws?.policy?.restricted?.length || device?.restricted?.length) return GEN.dataFlow
  const workerKeys = (v: object | null | undefined) => Object.keys(v ?? {}).some(isWorkerProvider)
  const routes = [...Object.values(ws?.routes ?? {}), ...Object.values(device?.routes ?? {}), device?.default ?? []]
  if ([ws?.policy?.providers, ws?.limits, device?.allow, device?.narrow, device?.roles].some(v => v && Object.hasOwn(v, 'copilot')) || routes.some(rule => rule?.some(route => route.p === 'copilot'))) return GEN.copilot
  if (workerKeys(ws?.policy?.providers) || workerKeys(ws?.limits) || workerKeys(device?.allow) || workerKeys(device?.narrow) || workerKeys(device?.roles) || routes.some(rule => rule?.some(route => isWorkerProvider(route.p)))) return GEN.workerModels
  return limitsClaude(ws, device) ? GEN.claudeLimits : 1
}

/* ------------------------------------------------------------------ */
/* What a backup would loosen (D52)                                     */
/* ------------------------------------------------------------------ */

export type LooseItem =
  /** a class the other rules let a provider receive that these do not */
  | { kind: 'allow'; p: ProviderId; cls: SharedClass }
  /** a provider these rules give nothing that the other rules open (with what) */
  | { kind: 'provider'; p: ProviderId; classes: SharedClass[] }
  /** a member class the workspace forbids here that the other rules do not */
  | { kind: 'forbid'; p: ProviderId; cls: MemberClass }
  /** OpenRouter's upstream rule relaxed: an operator no longer denied, data collection or ZDR off */
  | { kind: 'upstream'; p: ProviderId; what: 'deny' | 'noCollect' | 'zdr'; name?: string }
  /** the generation stamp lowered */
  | { kind: 'gen'; from: number; to: number }
  /** a soft monthly limit raised (to) or removed (to: null) */
  | { kind: 'limit'; p: ProviderId; from: number; to: number | null }
  /** a restricted page no longer restricted (or open to more providers) */
  | { kind: 'restricted'; root: string }

const UPSTREAM_DEFAULT: UpstreamRule = { deny: [], noCollect: true, zdr: false }

/**
 * Everything `theirs` (a backup's Workspace.ai) allows that `mine` does not ([] = taking theirs loosens nothing). Both
 * are read as stored (sanitized); member classes are the members' own (their devices), only the forbids count here.
 */
export function loosens(mine?: WorkspaceAI | null, theirs?: WorkspaceAI | null): LooseItem[] {
  const out: LooseItem[] = []
  for (const p of STORED_PROVIDERS) if (!modelDestinationAllowed(p, mine?.dataFlow) && modelDestinationAllowed(p, theirs?.dataFlow)) out.push({ kind: 'provider', p, classes: [] })
  if (mine?.dataFlow?.mcpOrigins && (!theirs?.dataFlow?.mcpOrigins || theirs.dataFlow.mcpOrigins.some(x => !mine.dataFlow!.mcpOrigins!.includes(x)))) out.push({ kind: 'restricted', root: 'MCP' })
  for (const p of STORED_PROVIDERS) {
    const a = mine?.policy?.providers?.[p]
    const b = theirs?.policy?.providers?.[p]
    const allowA = SHARED_CLASSES.filter((c) => allowedFor(p, c, mine, null))
    const allowB = SHARED_CLASSES.filter((c) => allowedFor(p, c, theirs, null))
    const more = allowB.filter((c) => !allowA.includes(c))
    if (p !== 'anthropic' && !a && b && more.length) out.push({ kind: 'provider', p, classes: more })
    else for (const cls of more) out.push({ kind: 'allow', p, cls })
    for (const cls of a?.forbid ?? []) if (!has(b?.forbid, cls)) out.push({ kind: 'forbid', p, cls })
    const ua = a?.upstream ?? UPSTREAM_DEFAULT
    const ub = b?.upstream ?? UPSTREAM_DEFAULT
    for (const name of ua.deny) if (!ub.deny.some((x) => x.toLowerCase() === name.toLowerCase())) out.push({ kind: 'upstream', p, what: 'deny', name })
    if (ua.noCollect && !ub.noCollect) out.push({ kind: 'upstream', p, what: 'noCollect' })
    if (ua.zdr && !ub.zdr) out.push({ kind: 'upstream', p, what: 'zdr' })
    const la = mine?.limits?.[p]?.monthUsd
    const lb = theirs?.limits?.[p]?.monthUsd
    if (la !== undefined && (lb === undefined || lb > la)) out.push({ kind: 'limit', p, from: la, to: lb ?? null })
  }
  const ga = mine?.gen ?? 1
  const gb = theirs?.gen ?? 1
  if (gb < ga) out.push({ kind: 'gen', from: ga, to: gb })
  for (const r of mine?.policy?.restricted ?? []) {
    const o = theirs?.policy?.restricted?.find((x) => x.root === r.root)
    if (!o || o.to.some((p) => !r.to.includes(p))) out.push({ kind: 'restricted', root: r.root })
  }
  return out
}

/** The generation the stored rules ask for (the higher of the two stamps; 1 without any). */
export function storedGen(ws?: WorkspaceAI | null, device?: DeviceAI | null): number {
  return Math.max(1, ws?.gen ?? 1, device?.gen ?? 1)
}

/** Can this build enforce the stored rules? (false: refuse every AI request with 'reload'.) */
export const policyKnown = (ws?: WorkspaceAI | null, device?: DeviceAI | null, build = AI_POLICY_GEN): boolean => storedGen(ws, device) <= build

export { isProviderId }
