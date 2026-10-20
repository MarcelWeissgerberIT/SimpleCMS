/**
 * Work orders (Prüfaufträge) — the per-database config (`Database.orders`, store/types.ts OrderConfig) as every reader
 * keeps it. Pure (a Node spec reads it; no store, no i18n).
 *
 *  - Only a `system: 'workorders'` database has one: anywhere else `orders` is ignored ('none').
 *  - Status options by id (`status`), never by name: a key without a valid id is listed in `missing` (the engine halts
 *    with "Status-Option fehlt" instead of guessing — B3 / B7).
 *  - `kinds` ⊆ BA · Coding · QA in the planner's order; junk or nothing left → all three. `projects` only for known
 *    kinds, valid ids only. `checkpoint` ("Stop after the analysis") is on unless stored as `false`. `budgetUsd` is
 *    clamped into BUDGET_RANGE (a junk value is dropped). `server` is the person's own name for their server (an MCP
 *    server name — never a service One names); anything else is "without a server".
 *  - Unknown top-level keys are kept (≤ 4 KB of JSON, else all dropped). A `v` above 1 is a later build's: 'unreadable'
 *    — kept as it is, never acted on (no auto mode, the checkpoint on) and never overwritten (saveOrderConfig).
 */
import type { ID, OrderConfig, OrderKind, OrderStatusKey } from '../../../store/types'

/** The pipelines a chain may use, in the planner's order: BA first, Coding, QA last. */
export const ORDER_KINDS = ['spec', 'coding', 'qa'] as const satisfies readonly OrderKind[]

/** The states of a request, in the board's lane order (Entwurf · Planen · Kette bereit · Läuft · Angehalten · Fertig). */
export const ORDER_STATUS_KEYS = ['draft', 'plan', 'ready', 'running', 'halted', 'done'] as const satisfies readonly OrderStatusKey[]

/** A chain's budget (USD): the smallest and largest one a reader keeps (a stored amount outside is clamped). */
export const BUDGET_RANGE = [0.01, 10_000] as const

/** Option / project ids as the store mints them (and as imports bring them): no spaces, no separators. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** An MCP server's name (features/ai/mcp-servers/config.ts NAME_RE): the person's own, as they named it. */
const SERVER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MAX_EXTRA = 4000
const KNOWN = new Set(['v', 'status', 'server', 'kinds', 'projects', 'checkpoint', 'budgetUsd', 'agent', 'agents'])

export type OrderConfigRead =
  /** not a work-orders database, or nothing stored */
  | { kind: 'none' }
  /** a later build's config (v > 1): kept as it is, never acted on, never overwritten */
  | { kind: 'unreadable' }
  /**
   * the config as this build acts on it — `missing`: states without a valid Status option id; `repaired`: something
   * stored was junk (dropped, clamped or defaulted)
   */
  | { kind: 'ok'; config: OrderConfig; missing: OrderStatusKey[]; repaired: boolean }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isId = (v: unknown): v is ID => typeof v === 'string' && ID_RE.test(v)
const isKind = (v: unknown): v is OrderKind => (ORDER_KINDS as readonly unknown[]).includes(v)

/** The config of a database as every reader keeps it (see the head of this file). */
export function readOrderConfig(db: { system?: string; orders?: unknown } | null | undefined): OrderConfigRead {
  if (!db || db.system !== 'workorders') return { kind: 'none' }
  return sanitizeOrderConfig(db.orders)
}

/** A stored `orders` value as every reader keeps it (the database's system aside). */
export function sanitizeOrderConfig(v: unknown): OrderConfigRead {
  if (v === undefined || v === null) return { kind: 'none' }
  if (!isObj(v)) return { kind: 'none' }
  const agentNames = ['claude', 'codex', 'local', 'minimax', 'ollama']
  if (v.agent !== undefined && !agentNames.includes(String(v.agent))) return { kind: 'unreadable' }
  if (v.agents !== undefined && (!isObj(v.agents) || Object.entries(v.agents).some(([kind, agent]) => !ORDER_KINDS.includes(kind as OrderKind) || !agentNames.includes(String(agent))))) return { kind: 'unreadable' }
  let repaired = false
  if (typeof v.v === 'number' && Number.isFinite(v.v) && v.v > 1) return { kind: 'unreadable' }
  if (v.v !== 1) repaired = true

  // Status options by id — one state per option; a state without its own valid id is missing (never guessed)
  const status: Partial<Record<OrderStatusKey, ID>> = {}
  const missing: OrderStatusKey[] = []
  const seen = new Set<ID>()
  const rawStatus = isObj(v.status) ? v.status : {}
  if (!isObj(v.status)) repaired = true
  for (const key of ORDER_STATUS_KEYS) {
    const id = Object.prototype.hasOwnProperty.call(rawStatus, key) ? rawStatus[key] : undefined
    if (isId(id) && !seen.has(id)) {
      status[key] = id
      seen.add(id)
    } else {
      if (id !== undefined) repaired = true
      missing.push(key)
    }
  }
  if (Object.keys(rawStatus).some((k) => !(ORDER_STATUS_KEYS as readonly string[]).includes(k))) repaired = true

  // the person's own server, by the name they gave it (nothing else of it is stored)
  let server: OrderConfig['server'] = null
  if (isObj(v.server) && typeof v.server.name === 'string' && SERVER_NAME_RE.test(v.server.name)) server = { name: v.server.name }
  else if (v.server !== null) repaired = true

  // kinds: known ones, once each, in the planner's order; nothing left → all three
  const listed = Array.isArray(v.kinds) ? v.kinds : []
  if (!Array.isArray(v.kinds) || listed.some((k) => !isKind(k))) repaired = true
  let kinds: OrderKind[] = ORDER_KINDS.filter((k) => listed.includes(k))
  if (!kinds.length) {
    if (Array.isArray(v.kinds)) repaired = true
    kinds = [...ORDER_KINDS]
  }

  // a project pinned per kind (absent: as #/coding shows it)
  let projects: Partial<Record<OrderKind, ID>> | undefined
  if (v.projects !== undefined) {
    if (!isObj(v.projects)) repaired = true
    else
      for (const [k, id] of Object.entries(v.projects)) {
        if (isKind(k) && isId(id)) (projects ??= {})[k] = id
        else repaired = true
      }
  }

  // "Stop after the analysis": on unless stored as false
  const checkpoint = v.checkpoint !== false
  if (typeof v.checkpoint !== 'boolean') repaired = true

  let budgetUsd: number | undefined
  if (v.budgetUsd !== undefined) {
    if (typeof v.budgetUsd !== 'number' || !Number.isFinite(v.budgetUsd)) repaired = true
    else {
      budgetUsd = Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], v.budgetUsd))
      if (budgetUsd !== v.budgetUsd) repaired = true
    }
  }

  const extra = extrasOf(v)
  if (extra === null) repaired = true
  const agents: OrderConfig['agents'] = {}
  if (isObj(v.agents)) for (const kind of ORDER_KINDS) {
    const agent = v.agents[kind]
    if (agent === 'claude' || agent === 'codex' || agent === 'local' || agent === 'minimax' || agent === 'ollama') agents[kind] = agent
  }
  const config = {
    ...(extra ?? {}),
    v: 1,
    status: status as Record<OrderStatusKey, ID>,
    server,
    kinds,
    ...(projects ? { projects } : {}),
    checkpoint,
    ...(['claude', 'codex', 'local', 'minimax', 'ollama'].includes(String(v.agent)) ? { agent: v.agent } : {}),
    ...(Object.keys(agents).length ? { agents } : {}),
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
  } as OrderConfig
  return { kind: 'ok', config, missing, repaired }
}

/** The owner's per-role routing; an absent setting preserves historical Claude behavior. */
export function orderAgent(config: Pick<OrderConfig, 'agent' | 'agents'>, kind: OrderKind) {
  return config.agents?.[kind] ?? config.agent
}

/** Unknown top-level keys as they were (their JSON copy, ≤ 4 KB; null: too big or no JSON — all dropped). */
function extrasOf(v: Obj): Obj | null {
  const extra: Obj = {}
  for (const k of Object.keys(v)) if (!KNOWN.has(k)) extra[k] = v[k]
  if (!Object.keys(extra).length) return {}
  try {
    const s = JSON.stringify(extra)
    if (typeof s !== 'string' || s.length > MAX_EXTRA) return null
    const copy = JSON.parse(s) as unknown
    return isObj(copy) && Object.keys(copy).length === Object.keys(extra).length ? copy : null
  } catch {
    return null
  }
}

/** A new database's config: its Status options, without a server, every kind, the checkpoint on, no budget. */
export function newOrderConfig(status: Record<OrderStatusKey, ID>): OrderConfig {
  return { v: 1, status: { ...status }, server: null, kinds: [...ORDER_KINDS], checkpoint: true }
}

/** "Stop after the analysis" as a chain must honour it: on unless a readable config switched it off. */
export const orderCheckpoint = (read: OrderConfigRead): boolean => (read.kind === 'ok' ? read.config.checkpoint : true)

/** May anything act on this config (plan, create, auto)? Only a readable one whose six states all have an option. */
export const orderConfigUsable = (read: OrderConfigRead): read is Extract<OrderConfigRead, { kind: 'ok' }> => read.kind === 'ok' && read.missing.length === 0
