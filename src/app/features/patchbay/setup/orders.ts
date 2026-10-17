/**
 * Orders B10 — the work orders' setup band "PRÜFAUFTRÄGE" (spec §4): six lamps, pure (Node specs load it).
 *
 *   01 CODING     Coding is on on this device                  → openCodingSettings()
 *   02 WORKER     the worker is online and up to date           → Settings › Coding worker
 *   03 PROJEKTE   a project of each kind the work orders use    → #/coding
 *   04 DATENBANK  the work-orders database                      → ensureOrderDb() (made here, as the person)
 *   05 KONTEXT    OPTIONAL — the server the person picked, tested; "without a server" is a valid end (green, dim) —
 *                 never red: a server set up but never tested is the next step (its connection test), nothing worse
 *   06 ERSTE KETTE the first chain started by hand (↵ on the work order's plate)
 *
 * One lamp is worked on ('next'): the first that is not green, in order; the ones after it wait ('dark'). The facts
 * come from the model input and this device (ui/OrdersBand.tsx reads them); the band never writes on its own.
 */
import type { ID } from '../../../store/types'
import type { LampAction, LampId, ModelInput, MsgRef, SetupLamp } from '../types'
import type { LampSet } from './lamps'

export type OrdersKind = 'spec' | 'coding' | 'qa'

export interface OrdersBandFacts {
  codingOn: boolean
  worker: { online: boolean; verdict: 'ok' | 'outdated' | 'unsafe' | null }
  /** the kinds the work orders use (their config; none yet: all three) */
  kinds: readonly OrdersKind[]
  /** a live project of each kind on this device */
  projects: Partial<Record<OrdersKind, boolean>>
  /** the work-orders database (null: none yet) */
  db: ID | null
  /** the server the person picked for the planner (null: none — a valid end) */
  server: { name: string; id: ID | null; enabled: boolean; tested: boolean } | null
  /** work orders whose chain was started at least once (running, halted or done) */
  chains: number
}

/** The band's profile id in the lamps' DOM contract (`data-pb-profile`) — never a profile's id (those are lower-case). */
export const ORDERS_BAND = 'orders'

const ref = (key: string, vars?: MsgRef['vars']): MsgRef => (vars ? { key: `features.patchbay.lamp.${key}`, vars } : { key: `features.patchbay.lamp.${key}` })

type Raw = { id: LampId; ok: boolean; say: MsgRef; action?: LampAction; optional?: true }

/** The six lamps of the work orders' band, in order (one 'next', the rest after it 'dark'). */
export function ordersLamps(f: OrdersBandFacts): LampSet {
  const raw: Raw[] = []
  raw.push({ id: 'coding', ok: f.codingOn, say: ref(f.codingOn ? 'coding.on' : 'coding.off'), action: { kind: 'codingSettings' } })
  const workerOk = f.worker.online && f.worker.verdict !== 'unsafe' && f.worker.verdict !== 'outdated'
  raw.push({
    id: 'worker',
    ok: workerOk,
    say: ref(workerOk ? 'worker.ok' : !f.worker.online ? 'worker.offline' : f.worker.verdict === 'unsafe' ? 'worker.unsafe' : 'worker.old'),
    action: { kind: 'codingSettings', orders: true },
  })
  const missing = f.kinds.filter((k) => !f.projects[k])
  raw.push({ id: 'projects', ok: missing.length === 0, say: missing.length ? ref(`projects.missing.${missing[0]}`) : ref('projects.ok', { n: f.kinds.length }), action: { kind: 'coding' } })
  raw.push({ id: 'ordersDb', ok: !!f.db, say: ref(f.db ? 'ordersDb.ok' : 'ordersDb.none'), action: f.db ? { kind: 'page', id: f.db } : { kind: 'ordersDb' } })
  const s = f.server
  if (!s) raw.push({ id: 'context', ok: true, optional: true, say: ref('context.none') })
  else if (!s.id) raw.push({ id: 'context', ok: false, optional: true, say: ref('context.missing', { server: s.name }), action: { kind: 'mcpSettings', add: true } })
  else if (!s.enabled) raw.push({ id: 'context', ok: false, optional: true, say: ref('context.off', { server: s.name }), action: { kind: 'mcpSettings', server: s.id } })
  else if (!s.tested) raw.push({ id: 'context', ok: false, optional: true, say: ref('context.untested', { server: s.name }), action: { kind: 'mcpTest', server: s.id } })
  else raw.push({ id: 'context', ok: true, optional: true, say: ref('context.ok', { server: s.name }), action: { kind: 'mcpTest', server: s.id } })
  raw.push({ id: 'firstChain', ok: f.chains > 0, say: ref(f.chains > 0 ? 'firstChain.ok' : 'firstChain.none'), ...(f.db ? { action: { kind: 'page' as const, id: f.db } } : {}) })

  let next: SetupLamp | null = null
  const lamps: SetupLamp[] = raw.map((r, i) => {
    const n = (i + 1) as SetupLamp['n']
    const state: SetupLamp['state'] = r.ok ? 'ok' : next ? 'dark' : 'next'
    const lamp: SetupLamp = { n, id: r.id, state, say: r.say, ...(r.action ? { action: r.action } : {}), ...(r.optional ? { optional: true as const } : {}) }
    if (state === 'next') next = lamp
    return lamp
  })
  return { recipe: null, lamps, done: lamps.filter((l) => l.state === 'ok').length, next }
}

const ALL_KINDS: readonly OrdersKind[] = ['spec', 'coding', 'qa']

/** The band's facts from the model input (and the count of chains started — the store's, read by the band). */
export function ordersBandFacts(input: ModelInput, chains: number): OrdersBandFacts {
  const o = input.orders?.[0] ?? null
  const kinds = o?.config?.kinds.length ? o.config.kinds : ALL_KINDS
  const projects: Partial<Record<OrdersKind, boolean>> = {}
  for (const p of input.pipelines) projects[p.kind] = true
  const name = o?.config?.server ?? null
  const s = name ? input.servers.find((x) => x.server.name === name) : undefined
  return {
    codingOn: input.codingOn !== false,
    worker: { online: input.worker.online, verdict: input.worker.verdict },
    kinds,
    projects,
    db: o?.db ?? null,
    server: name ? { name, id: s?.server.id ?? null, enabled: !!s?.server.enabled, tested: !!s && (s.state === 'ok' || !!s.server.checkedAt) } : null,
    chains,
  }
}
