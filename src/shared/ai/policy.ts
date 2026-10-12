/**
 * The AI rules as stored — Workspace.ai (synced, owners / admins) and settings.ai (this device) — and the policy
 * generation: a tab whose build is older than the generation a stored rule needs refuses every AI request (it would
 * not enforce that rule). Slice 1 keeps these shapes through every reader and writes none of them.
 */
import type { Caps, DataClass, DeviceAI, FeatureClass, MemberClass, PriceOverride, PriceRow, ProviderId, ProviderPolicy, Restriction, RouteRule, SharedClass, ShortlistRow, UpstreamRule, WorkspaceAI } from './types.ts'
import { EFFORTS, STORED_PROVIDERS, isProviderId, modelIdProblem } from './models.ts'
import { PRICE_KEYS } from './prices.ts'
import { sanitizeRule } from './route.ts'

export const SHARED_CLASSES: readonly SharedClass[] = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
export const MEMBER_CLASSES: readonly MemberClass[] = ['private', 'mail', 'memory', 'mcp']
export const DATA_CLASSES: readonly DataClass[] = [...SHARED_CLASSES, ...MEMBER_CLASSES]
export const FEATURE_CLASSES: readonly FeatureClass[] = ['write', 'ask', 'workspace', 'structure', 'vision', 'documents', 'bulk', 'meeting', 'memory', 'outbox', 'terminal', 'agents', 'scripts', 'help', 'review', 'generate', 'mcp-setup', 'gate']

/** This build's AI policy generation (1: Claude gets everything — no rule limits a provider yet). */
export const AI_POLICY_GEN = 1

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

/** A stored price row (null: none or not valid). */
export function sanitizePriceRow(v: unknown): PriceRow | null {
  if (!isObj(v)) return null
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
    if (!isObj(x) || typeof x.m !== 'string' || modelIdProblem('openrouter', x.m) !== null || out.some((o) => o.m === x.m)) continue
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
  const g = gen(v.gen)
  if (g !== undefined) out.gen = g
  return Object.keys(out).length ? out : undefined
}

/**
 * The lowest generation that enforces every rule — of a workspace and / or this device — that limits a provider an
 * older build can reach. Slice 1 has no such rule: 1.
 */
export function requiredGen(_ws?: WorkspaceAI | null, _device?: DeviceAI | null): number {
  return 1
}

/** The generation the stored rules ask for (the higher of the two stamps; 1 without any). */
export function storedGen(ws?: WorkspaceAI | null, device?: DeviceAI | null): number {
  return Math.max(1, ws?.gen ?? 1, device?.gen ?? 1)
}

/** Can this build enforce the stored rules? (false: refuse every AI request with 'reload'.) */
export const policyKnown = (ws?: WorkspaceAI | null, device?: DeviceAI | null, build = AI_POLICY_GEN): boolean => storedGen(ws, device) <= build

export { isProviderId }
