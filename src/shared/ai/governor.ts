/**
 * The Regler's stored shapes (pure: app + team server) — Workspace.governor (synced; team: meta map `workspace` key
 * `governor`, owners / admins) and the person's own line for this browser (localStorage `one.governor.device`).
 *
 * Every reader goes through the sanitizers: known keys are validated (numbers clamped into their range), unknown
 * top-level keys of a later slice are kept as they were (≤ 4 KB of JSON), a saving rule this build cannot read (any key
 * it does not know included) is kept as it was and never acted on, and a shape version this build does not know (`v` > 1)
 * is kept whole (≤ 64 KB, else a stable marker persistence never writes) — never acted on, never written over. The
 * standard governor is no value (undefined), like the look.
 *
 * Which policy generation a stored value needs comes from governorGen / deviceGovernorGen (older tabs refuse AI while a
 * limit they cannot enforce is stored); governorKeepsGen / deviceKeepsGen say when a value holds something this build
 * cannot judge — the stored stamp is then never lowered.
 */
import type { DeviceAI, FeatureClass, ProviderId, Route, WorkspaceAI } from './types.ts'
import { isProviderId, modelIdProblem } from './models.ts'
import { FEATURE_CLASSES, requiredGen } from './policy.ts'
import { sanitizeRoute, type Unreadable } from './route.ts'
import { GEN, type GenTable } from './generations.ts'

/* ------------------------------------------------------------------ */
/* Autonomy (the lever, G2 — kept from G0)                              */
/* ------------------------------------------------------------------ */

export type Autonomy = 'off' | 'read' | 'propose' | 'apply'
/** ascending */
export const AUTONOMY: readonly Autonomy[] = ['off', 'read', 'propose', 'apply']
export const isAutonomy = (v: unknown): v is Autonomy => typeof v === 'string' && (AUTONOMY as readonly string[]).includes(v)
export const autonomyRank = (a: Autonomy): number => AUTONOMY.indexOf(a)
export const minAutonomy = (a: Autonomy, b: Autonomy): Autonomy => (autonomyRank(a) <= autonomyRank(b) ? a : b)

/* ------------------------------------------------------------------ */
/* Shapes                                                               */
/* ------------------------------------------------------------------ */

export type SaverWho = 'scheduled' | 'trigger' | 'manual' | 'bulk' | 'interactive'
export const SAVER_WHO: readonly SaverWho[] = ['scheduled', 'trigger', 'manual', 'bulk', 'interactive']

export interface SaverWhen {
  /** absent = every kind of start */
  who?: SaverWho[]
  /** ≤ 18 */
  cls?: FeatureClass[]
  /** agent ids, ≤ 50 */
  agents?: string[]
  /** the route the request would take (after the ceiling): a provider, a model, or a blended price above */
  from?: { p?: ProviderId; m?: string; overPerM?: number }
  /** the band's upper end above this (a run's band for runs, the request's for one-shots) */
  bandOver?: number
  /** spent today ≥ this share of the day budget (0.05 … 1) */
  dayOver?: number
}

export interface SaverDef {
  /** 'sv_' + 10 */
  id: string
  on: boolean
  /** ≤ 60 */
  name?: string
  when: SaverWhen
  to: Route
}

export interface WorkspaceGovernor {
  /** shape version; a higher one than this build knows: the whole value is unreadable — kept, never written here */
  v: 1
  /** the lever; absent = 'apply' (no cap) */
  autonomy?: Autonomy
  /** the last lever move: the ghost knob and Z (absent: nothing to undo) */
  moved?: { from: Autonomy; to: Autonomy; at: number; by: string | null }
  /** $ per million blended tokens (3 in : 1 out); absent = no ceiling; 0.01 … 1000 */
  ceiling?: number
  /** USD per device and local day / calendar month; absent = no budget; day 0.10 … 10 000, month 1 … 100 000 */
  day?: number
  month?: number
  /** workspace saving rules, in order (≤ 20) — kept from G0, used from G3; one this build cannot read stays as it was */
  savers?: Array<SaverDef | Unreadable>
  /** the coding worker's measured cost counts and is braked ("Mitregeln") — kept from G0, used from G4 */
  worker?: { governed: boolean }
  updatedAt?: number
  updatedBy?: string | null
}

/** Where the person's own line for this browser lives (localStorage; features/governor/device.ts reads and writes it). */
export const DEVICE_GOVERNOR_KEY = 'one.governor.device'

/** The person's own line for this browser (localStorage one.governor.device): every workspace and member signed in here. */
export interface DeviceGovernor {
  v: 1
  day?: number
  month?: number
  at?: number
}

/**
 * opaqueBytes: unknown top-level keys of a later slice (in total) and one saving rule kept unread; newerBytes: a whole value
 * of a newer shape (`v` > 1 — kept whole, never written over: a G3+ governor with 20 rules × 50 agents is well above 4 KB).
 */
export const GOVERNOR_LIMITS = { savers: 20, agentsPerRule: 50, classesPerRule: 18, name: 60, by: 200, opaqueBytes: 4000, newerBytes: 64_000 } as const

/** [min, max] of every amount; a finite value outside is clamped into it (the limit stays a limit). */
export const GOVERNOR_RANGES = {
  ceiling: [0.01, 1000],
  day: [0.1, 10_000],
  month: [1, 100_000],
  overPerM: [0.01, 1000],
  bandOver: [0.01, 1000],
  dayOver: [0.05, 1],
} as const satisfies Record<string, readonly [number, number]>

/**
 * Owner decision 3 (Regler design § 20, built with the recommendation — pending confirmation): a stored limit makes
 * every One tab of an older build refuse AI with 'reload' (it could not enforce it). false: limits stamp no generation.
 */
export const LIMITS_RELOAD_OLDER_TABS = true

/* ------------------------------------------------------------------ */
/* Sanitizers                                                           */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const SAVER_ID_RE = /^sv_[A-Za-z0-9]{10}$/
const AGENT_ID_RE = /^[A-Za-z0-9_:-]{1,64}$/
const KNOWN = new Set(['v', 'autonomy', 'moved', 'ceiling', 'day', 'month', 'savers', 'worker', 'updatedAt', 'updatedBy'])
const DEVICE_KNOWN = new Set(['v', 'day', 'month', 'at'])
/** a saving rule's keys this build reads — any other key (of the rule, its `when`, `from` or `to`) leaves it unread */
const SAVER_KEYS = new Set(['id', 'on', 'name', 'when', 'to'])
const WHEN_KEYS = new Set(['who', 'cls', 'agents', 'from', 'bandOver', 'dayOver'])
const FROM_KEYS = new Set(['p', 'm', 'overPerM'])
const ROUTE_KEYS = new Set(['p', 'm', 'effort'])
const onlyKeys = (v: Obj, known: Set<string>): boolean => Object.keys(v).every((k) => known.has(k))

/** A JSON copy of a value kept unread (null: no JSON, or larger than the budget). */
function jsonCopy(v: unknown, max: number = GOVERNOR_LIMITS.opaqueBytes): unknown {
  try {
    const s = JSON.stringify(v)
    return typeof s === 'string' && s.length <= max ? JSON.parse(s) : null
  } catch {
    return null
  }
}

/**
 * The marker for a newer value too large (or not JSON) to keep a copy of: its own `v` is above every shape version, so it
 * reads as a newer value again on every pass (never as a readable governor), and persistence never writes it over the
 * stored value it stands for (isGovernorMarker).
 */
const MARKER = { v: Number.MAX_SAFE_INTEGER, unreadable: true } as const

export const isGovernorMarker = (g: unknown): boolean => isObj(g) && g.v === MARKER.v && g.unreadable === true && Object.keys(g).length === 2

/** A newer value this build cannot read, kept whole (too big or no JSON: the marker). */
function opaque(v: unknown): Unreadable {
  return (jsonCopy(v, GOVERNOR_LIMITS.newerBytes) ?? { ...MARKER }) as unknown as Unreadable
}

/** Is this a governor this build can read (and act on)? A sanitized readable value always carries `v: 1`. */
export const isReadableGovernor = (g: WorkspaceGovernor | Unreadable | null | undefined): g is WorkspaceGovernor => isObj(g) && (g as Obj).v === 1
export const isReadableDeviceGovernor = (d: DeviceGovernor | Unreadable | null | undefined): d is DeviceGovernor => isObj(d) && (d as Obj).v === 1

/** A finite number clamped into [min, max] (undefined: not a finite number). */
function amount(v: unknown, [min, max]: readonly [number, number], r: Report): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    r.repaired = true
    return undefined
  }
  const n = Math.min(max, Math.max(min, v))
  if (n !== v) r.repaired = true
  return n
}

interface Report {
  repaired: boolean
}

/** The shape version: 'ok' (1 or absent), 'newer' (a number above 1), 'junk' (anything else — read as 1). */
function versionOf(v: unknown): 'ok' | 'newer' | 'junk' {
  if (v === undefined || v === 1) return 'ok'
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return 'newer'
  return 'junk'
}

function pickList<T extends string>(v: unknown, allowed: readonly T[], max: number, r: Report): T[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) {
    r.repaired = true
    return undefined
  }
  const out = [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))].slice(0, max)
  if (out.length !== v.length) r.repaired = true
  return out.length ? out : undefined
}

/** A saver's conditions; null: a condition this build cannot read (the rule is kept unread, never acted on). */
function readWhen(v: unknown): SaverWhen | null {
  if (v === undefined) return {}
  // a condition this build does not know: dropping it would widen the rule
  if (!isObj(v) || !onlyKeys(v, WHEN_KEYS)) return null
  const r: Report = { repaired: false }
  const out: SaverWhen = {}
  const who = pickList(v.who, SAVER_WHO, SAVER_WHO.length, r)
  if (who) out.who = who
  const cls = pickList(v.cls, FEATURE_CLASSES, GOVERNOR_LIMITS.classesPerRule, r)
  if (cls) out.cls = cls
  if (v.agents !== undefined) {
    if (!Array.isArray(v.agents) || v.agents.length > GOVERNOR_LIMITS.agentsPerRule || v.agents.some((a) => typeof a !== 'string' || !AGENT_ID_RE.test(a))) return null
    const agents = [...new Set(v.agents as string[])]
    if (agents.length) out.agents = agents
  }
  if (v.from !== undefined) {
    if (!isObj(v.from) || !onlyKeys(v.from, FROM_KEYS)) return null
    const from: NonNullable<SaverWhen['from']> = {}
    if (v.from.p !== undefined) {
      if (!isProviderId(v.from.p)) return null
      from.p = v.from.p
    }
    if (v.from.m !== undefined) {
      if (!from.p || modelIdProblem(from.p, v.from.m) !== null) return null
      from.m = v.from.m as string
    }
    const over = amount(v.from.overPerM, GOVERNOR_RANGES.overPerM, r)
    if (over !== undefined) from.overPerM = over
    if (Object.keys(from).length) out.from = from
  }
  const bandOver = amount(v.bandOver, GOVERNOR_RANGES.bandOver, r)
  if (bandOver !== undefined) out.bandOver = bandOver
  const dayOver = amount(v.dayOver, GOVERNOR_RANGES.dayOver, r)
  if (dayOver !== undefined) out.dayOver = dayOver
  // a condition dropped would widen the rule: kept unread instead
  return r.repaired ? null : out
}

/** One saving rule this build can act on (null: junk, or a shape it cannot read). */
function readableSaver(v: unknown): SaverDef | null {
  if (!isObj(v) || typeof v.id !== 'string' || !SAVER_ID_RE.test(v.id)) return null
  // a key of a later slice (an end date, a time window …): rebuilt without it the rule would act wider — kept unread
  if (!onlyKeys(v, SAVER_KEYS) || !isObj(v.to) || !onlyKeys(v.to, ROUTE_KEYS)) return null
  const to = sanitizeRoute(v.to)
  if (to && v.to.effort !== undefined && to.effort !== v.to.effort) return null
  const when = readWhen(v.when)
  const nameOk = v.name === undefined || (typeof v.name === 'string' && v.name.length <= GOVERNOR_LIMITS.name)
  if (!to || !when || typeof v.on !== 'boolean' || !nameOk) return null
  return { id: v.id, on: v.on, ...(typeof v.name === 'string' && v.name ? { name: v.name } : {}), when, to }
}

/** One saving rule: readable, kept unread (a valid id, a shape this build cannot read), or null (junk: dropped). */
function readSaver(v: unknown): SaverDef | Unreadable | null {
  const s = readableSaver(v)
  if (s) return s
  if (!isObj(v) || typeof v.id !== 'string' || !SAVER_ID_RE.test(v.id)) return null
  return (jsonCopy(v) as Unreadable | null) ?? null
}

/** Unknown top-level keys, kept as they were (≤ 4 KB of JSON in total; else all dropped). */
function extrasOf(v: Obj, known: Set<string>, r: Report): Obj {
  const extra: Obj = {}
  for (const k of Object.keys(v)) if (!known.has(k)) extra[k] = v[k]
  if (!Object.keys(extra).length) return {}
  const copy = jsonCopy(extra)
  if (!isObj(copy) || Object.keys(copy).length !== Object.keys(extra).length) {
    r.repaired = true
    return {}
  }
  return copy
}

/**
 * Workspace.governor as every reader keeps it, and whether anything was repaired (junk dropped, an amount clamped,
 * unknown keys over the budget). undefined: none, or the standard governor.
 */
export function sanitizeGovernorWithReport(v: unknown): { value: WorkspaceGovernor | Unreadable | undefined; repaired: boolean } {
  const r: Report = { repaired: false }
  if (v === undefined || v === null) return { value: undefined, repaired: false }
  if (!isObj(v)) return { value: undefined, repaired: true }
  const ver = versionOf(v.v)
  if (ver === 'newer') return { value: opaque(v), repaired: false }
  if (ver === 'junk') r.repaired = true
  const out: WorkspaceGovernor = { v: 1 }
  if (v.autonomy !== undefined) {
    if (isAutonomy(v.autonomy)) out.autonomy = v.autonomy
    else r.repaired = true
  }
  if (v.moved !== undefined) {
    const m = v.moved
    const by = isObj(m) && (m.by === null || m.by === undefined || (typeof m.by === 'string' && m.by.length <= GOVERNOR_LIMITS.by)) ? ((m.by as string | null | undefined) ?? null) : undefined
    if (isObj(m) && isAutonomy(m.from) && isAutonomy(m.to) && typeof m.at === 'number' && Number.isFinite(m.at) && m.at >= 0 && by !== undefined) out.moved = { from: m.from, to: m.to, at: m.at, by }
    else r.repaired = true
  }
  const ceiling = amount(v.ceiling, GOVERNOR_RANGES.ceiling, r)
  if (ceiling !== undefined) out.ceiling = ceiling
  const day = amount(v.day, GOVERNOR_RANGES.day, r)
  if (day !== undefined) out.day = day
  const month = amount(v.month, GOVERNOR_RANGES.month, r)
  if (month !== undefined) out.month = month
  if (v.savers !== undefined) {
    if (!Array.isArray(v.savers)) r.repaired = true
    else {
      const savers: Array<SaverDef | Unreadable> = []
      const ids = new Set<string>()
      for (const x of v.savers) {
        const s = readSaver(x)
        const id = isObj(s) && typeof (s as Obj).id === 'string' ? ((s as Obj).id as string) : null
        if (!s || !id || ids.has(id) || savers.length >= GOVERNOR_LIMITS.savers) {
          r.repaired = true
          continue
        }
        ids.add(id)
        savers.push(s)
      }
      if (savers.length) out.savers = savers
    }
  }
  if (v.worker !== undefined) {
    if (isObj(v.worker) && typeof v.worker.governed === 'boolean') out.worker = { governed: v.worker.governed }
    else r.repaired = true
  }
  if (v.updatedAt !== undefined) {
    if (typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) && v.updatedAt >= 0) out.updatedAt = v.updatedAt
    else r.repaired = true
  }
  if (v.updatedBy !== undefined) {
    if (v.updatedBy === null || (typeof v.updatedBy === 'string' && v.updatedBy.length <= GOVERNOR_LIMITS.by)) out.updatedBy = v.updatedBy
    else r.repaired = true
  }
  const extra = extrasOf(v, KNOWN, r)
  const value = { ...extra, ...out } as WorkspaceGovernor
  return { value: hasEffect(value) ? value : undefined, repaired: r.repaired }
}

export const sanitizeGovernor = (v: unknown): WorkspaceGovernor | Unreadable | undefined => sanitizeGovernorWithReport(v).value

/** Does the value say anything (the standard governor — no lever, no limit, no rule, nothing unknown — is no value)? */
function hasEffect(g: WorkspaceGovernor): boolean {
  if ((g.autonomy && g.autonomy !== 'apply') || g.moved || g.ceiling !== undefined || g.day !== undefined || g.month !== undefined) return true
  if (g.savers?.length || g.worker?.governed) return true
  return Object.keys(g).some((k) => !KNOWN.has(k))
}

/** The person's own line (localStorage one.governor.device) as every reader keeps it. */
export function sanitizeDeviceGovernorWithReport(v: unknown): { value: DeviceGovernor | Unreadable | undefined; repaired: boolean } {
  const r: Report = { repaired: false }
  if (v === undefined || v === null) return { value: undefined, repaired: false }
  if (!isObj(v)) return { value: undefined, repaired: true }
  const ver = versionOf(v.v)
  if (ver === 'newer') return { value: opaque(v), repaired: false }
  if (ver === 'junk') r.repaired = true
  const out: DeviceGovernor = { v: 1 }
  const day = amount(v.day, GOVERNOR_RANGES.day, r)
  if (day !== undefined) out.day = day
  const month = amount(v.month, GOVERNOR_RANGES.month, r)
  if (month !== undefined) out.month = month
  if (v.at !== undefined) {
    if (typeof v.at === 'number' && Number.isFinite(v.at) && v.at >= 0) out.at = v.at
    else r.repaired = true
  }
  const extra = extrasOf(v, DEVICE_KNOWN, r)
  const value = { ...extra, ...out } as DeviceGovernor
  const effect = value.day !== undefined || value.month !== undefined || Object.keys(extra).length > 0
  return { value: effect ? value : undefined, repaired: r.repaired }
}

export const sanitizeDeviceGovernor = (v: unknown): DeviceGovernor | Unreadable | undefined => sanitizeDeviceGovernorWithReport(v).value

/** The saving rules this build can act on (an unreadable one is kept in the list, never matched). */
export const readableSavers = (g: WorkspaceGovernor | Unreadable | null | undefined): SaverDef[] =>
  isReadableGovernor(g) ? (g.savers ?? []).map(readableSaver).filter((s): s is SaverDef => s !== null) : []

/* ------------------------------------------------------------------ */
/* Same / loosens                                                       */
/* ------------------------------------------------------------------ */

/** Stable JSON (keys sorted) — "the same value?" by value. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v ?? null)
}

const withoutStamps = (g: unknown): unknown => {
  if (!isObj(g)) return g
  const { updatedAt: _at, updatedBy: _by, ...rest } = g
  return rest
}

/** The same governor (by value; both absent = the same). `meta`: the stamps (updatedAt / updatedBy) count too. */
export function sameGovernor(a: WorkspaceGovernor | Unreadable | null | undefined, b: WorkspaceGovernor | Unreadable | null | undefined, opts: { meta?: boolean } = {}): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  return opts.meta ? stable(a) === stable(b) : stable(withoutStamps(a)) === stable(withoutStamps(b))
}

export const sameDeviceGovernor = (a: DeviceGovernor | Unreadable | null | undefined, b: DeviceGovernor | Unreadable | null | undefined): boolean =>
  a === b || (!a || !b ? !a && !b : stable(a) === stable(b))

export type GovernorLoose =
  /** a day / month budget raised (to) or removed (to: null) */
  | { kind: 'budget'; what: 'day' | 'month'; from: number; to: number | null }
  /** the lever raised (more autonomy) */
  | { kind: 'lever'; from: Autonomy; to: Autonomy }
  /** the ceiling raised (to) or removed (to: null) */
  | { kind: 'ceiling'; from: number; to: number | null }
  /** the coding worker no longer governed */
  | { kind: 'worker' }
  /** one side is a newer version's value: this build cannot say what taking it changes */
  | { kind: 'unreadable' }

/** Everything `theirs` (a backup's governor) allows that `mine` does not ([] = taking theirs loosens nothing). */
export function loosensGovernor(mine: WorkspaceGovernor | Unreadable | null | undefined, theirs: WorkspaceGovernor | Unreadable | null | undefined): GovernorLoose[] {
  if (sameGovernor(mine, theirs)) return []
  if ((mine && !isReadableGovernor(mine)) || (theirs && !isReadableGovernor(theirs))) return [{ kind: 'unreadable' }]
  const a = isReadableGovernor(mine) ? mine : undefined
  const b = isReadableGovernor(theirs) ? theirs : undefined
  const out: GovernorLoose[] = []
  for (const what of ['day', 'month'] as const) {
    const x = a?.[what]
    const y = b?.[what]
    if (x !== undefined && (y === undefined || y > x)) out.push({ kind: 'budget', what, from: x, to: y ?? null })
  }
  const la = a?.autonomy ?? 'apply'
  const lb = b?.autonomy ?? 'apply'
  if (autonomyRank(lb) > autonomyRank(la)) out.push({ kind: 'lever', from: la, to: lb })
  if (a?.ceiling !== undefined && (b?.ceiling === undefined || b.ceiling > a.ceiling)) out.push({ kind: 'ceiling', from: a.ceiling, to: b?.ceiling ?? null })
  if (a?.worker?.governed && !b?.worker?.governed) out.push({ kind: 'worker' })
  return out
}

/* ------------------------------------------------------------------ */
/* Generations                                                          */
/* ------------------------------------------------------------------ */

const holdsLever = (g: WorkspaceGovernor): boolean => (!!g.autonomy && g.autonomy !== 'apply') || g.ceiling !== undefined

/**
 * The policy generation a stored governor needs (1: none) — budgets need `budget`, the lever below 'apply' or a ceiling
 * `lever` (when this build's table names it). Saving rules stamp nothing.
 */
export function governorGen(g: WorkspaceGovernor | Unreadable | null | undefined, gens: GenTable = GEN): number {
  if (!LIMITS_RELOAD_OLDER_TABS || !isReadableGovernor(g)) return 1
  let n = 1
  if (g.day !== undefined || g.month !== undefined || g.worker?.governed) n = Math.max(n, gens.budget ?? 1)
  if (holdsLever(g)) n = Math.max(n, gens.lever ?? 1)
  return n
}

/**
 * Does the value hold something this build cannot judge (a newer shape, unknown keys of a later slice, a lever / ceiling
 * without a generation in this build's table)? Then the stored stamp is never lowered here — only raised.
 */
export function governorKeepsGen(g: WorkspaceGovernor | Unreadable | null | undefined, gens: GenTable = GEN): boolean {
  if (!g) return false
  if (!isReadableGovernor(g)) return true
  if (holdsLever(g) && gens.lever === undefined) return true
  return Object.keys(g).some((k) => !KNOWN.has(k))
}

/** The generation this browser's own line needs (1: none). */
export function deviceGovernorGen(d: DeviceGovernor | Unreadable | null | undefined, gens: GenTable = GEN): number {
  if (!LIMITS_RELOAD_OLDER_TABS || !isReadableDeviceGovernor(d)) return 1
  return d.day !== undefined || d.month !== undefined ? (gens.budget ?? 1) : 1
}

export function deviceKeepsGen(d: DeviceGovernor | Unreadable | null | undefined): boolean {
  if (!d) return false
  if (!isReadableDeviceGovernor(d)) return true
  return Object.keys(d).some((k) => !DEVICE_KNOWN.has(k))
}

/**
 * The generation stamp of the workspace's AI rules (Workspace.ai.gen) — ONE helper for every writer of it (S2's rule
 * setter now; the Regler's writers in phase B): the higher of what the rules need (requiredGen) and what the stored
 * governor needs (governorGen) — and, while the governor holds something this build cannot judge (governorKeepsGen), never
 * below the stamp stored now. A rule edit never lowers a budget's stamp. 1: no stamp.
 */
export function stampGen(rules: WorkspaceAI | null | undefined, governor: WorkspaceGovernor | Unreadable | null | undefined, stored: number | undefined, gens: GenTable = GEN): number {
  return Math.max(requiredGen(rules, null), governorGen(governor, gens), governorKeepsGen(governor, gens) ? (stored ?? 1) : 1)
}

/** The same for this device's layer (settings.ai.gen): its own rules and the person's line for this browser. */
export function stampDeviceGen(rules: DeviceAI | null | undefined, line: DeviceGovernor | Unreadable | null | undefined, stored: number | undefined, gens: GenTable = GEN): number {
  return Math.max(requiredGen(null, rules), deviceGovernorGen(line, gens), deviceKeepsGen(line) ? (stored ?? 1) : 1)
}
