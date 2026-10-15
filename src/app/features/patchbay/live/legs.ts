/**
 * The dot path of a run (plan §1.7) — pure: which drawn cables a run lights, from the model alone.
 *
 *  - startLegs: the cable into the module's `start` jack its run came by — after another module's write (`from`: an
 *    automation's / autofill's `cause`) the hop writer → net flag → module; a clock (an agent's schedule), a row trigger
 *    or a net flag (a row change, by its place), a hook (a server agent's webhook);
 *  - writeLegs: module → the places it wrote (a net flag of a listened field it wrote, else its cable to the database /
 *    page, else "Whole workspace");
 *  - exitLegs: module → a way out (an automation's webhook, a pipeline's git action) or another module's start
 *    (automation → script).
 * The index of a model is built once per model object (WeakMap) — O(E) — and every lookup after it is O(degree).
 */
import type { Edge, Model, Module, ModuleKey } from '../types'
import { keyPart } from '../ref'
import type { ID } from '../../../store/types'

/** The module a jack key belongs to (`<module>.<role>`; a net key belongs to none). */
export function moduleOfJack(k: string): ModuleKey | null {
  if (k.startsWith('net:')) return null
  const dot = k.lastIndexOf('.')
  return dot > 0 ? k.slice(0, dot) : null
}

export interface LegIndex {
  model: Model
  mods: Map<ModuleKey, Module>
  /** edges leaving a module's jacks */
  outOf: Map<ModuleKey, Edge[]>
  /** edges ending at a module's `start` jack */
  intoStart: Map<ModuleKey, Edge[]>
  /** edges ending at a net flag, by net key */
  intoNet: Map<string, Edge[]>
}

const cache = new WeakMap<Model, LegIndex>()

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

/** The index of a model (built once per model object). */
export function legIndex(model: Model): LegIndex {
  let ix = cache.get(model)
  if (ix) return ix
  ix = { model, mods: new Map(model.modules.map((m) => [m.key, m])), outOf: new Map(), intoStart: new Map(), intoNet: new Map() }
  for (const e of model.edges) {
    const from = moduleOfJack(e.from)
    if (from) push(ix.outOf, from, e)
    if (e.to.startsWith('net:')) push(ix.intoNet, e.to, e)
    else if (e.to.endsWith('.start')) push(ix.intoStart, e.to.slice(0, -'.start'.length), e)
  }
  cache.set(model, ix)
  return ix
}

/** A place a start came through: a field of a database (`*` any field, `+row` a new row, `-row` a removed one). */
export interface StartPlace {
  db: ID
  prop: string
}

/** How a run came to start, as far as One knows it. */
export interface StartHow {
  /** the module whose write started it (an automation's / autofill's cause) */
  from?: ModuleKey | null
  /** what started it: a clock, a row (trigger or net flag), a hook */
  via?: 'clock' | 'row' | 'hook' | null
  /** the place it listens to (row starts) */
  place?: StartPlace | null
}

const kindOf = (ix: LegIndex, k: string): Module['kind'] | null => {
  const m = moduleOfJack(k)
  return m ? (ix.mods.get(m)?.kind ?? null) : null
}

const netOf = (p: StartPlace) => `net:${keyPart(p.db)}:${p.prop === '*' || p.prop === '+row' || p.prop === '-row' ? p.prop : keyPart(p.prop)}`

/** Does a row trigger's start jack stand for this place? */
function triggerAt(ix: LegIndex, jack: string, p: StartPlace): boolean {
  const m = ix.mods.get(moduleOfJack(jack) ?? '')
  if (m?.ref.kind !== 'rowTrigger') return false
  const r = m.ref
  if (r.db !== p.db) return false
  if (p.prop === '+row') return r.event === 'created'
  if (p.prop === '-row') return r.event === 'deleted'
  return r.event === 'changed' && (r.prop === p.prop || r.prop === '*')
}

/** The cables a run of `module` came in by (in order: the hop writer → net flag first, then into the module). */
export function startLegs(ix: LegIndex, module: ModuleKey, how: StartHow = {}): string[] {
  const ins = ix.intoStart.get(module) ?? []
  if (!ins.length) return []
  const at = (e: Edge, p: StartPlace | null | undefined) => !p || (e.from.startsWith('net:') ? e.from === netOf(p) || e.from === netOf({ db: p.db, prop: '*' }) : triggerAt(ix, e.from, p))
  if (how.from) {
    // through a net flag the cause wrote: writer → flag, flag → module
    for (const e of ins) {
      if (!e.from.startsWith('net:') || !at(e, how.place)) continue
      const hop = (ix.intoNet.get(e.from) ?? []).find((w) => moduleOfJack(w.from) === how.from)
      if (hop) return [hop.id, e.id]
    }
    // straight from the cause's jack (automation → script, command → agent, a kit relay's flag)
    const direct = ins.find((e) => moduleOfJack(e.from) === how.from)
    if (direct) return [direct.id]
  }
  if (how.via === 'clock') {
    const e = ins.find((x) => kindOf(ix, x.from) === 'clock')
    return e ? [e.id] : []
  }
  if (how.via === 'hook') {
    const e = ins.find((x) => kindOf(ix, x.from) === 'incoming')
    return e ? [e.id] : []
  }
  if (how.via === 'row' || how.place) {
    // a person's edit (or rows from outside): the row trigger, else the net flag of that place
    const trig = ins.find((e) => !e.from.startsWith('net:') && kindOf(ix, e.from) === 'rowTrigger' && at(e, how.place))
    if (trig) return [trig.id]
    const net = ins.find((e) => e.from.startsWith('net:') && at(e, how.place))
    return net ? [net.id] : []
  }
  return []
}

/** What a write touched in one database row (or a page that is no row). */
export type WritePlace = { db: ID; props: readonly string[]; added?: boolean; content?: boolean } | { page: ID }

/** The cables a write of `module` lights: net flags of the fields it wrote, else its database / page cable, else "Whole workspace". */
export function writeLegs(ix: LegIndex, module: ModuleKey, places: readonly WritePlace[]): string[] {
  const outs = (ix.outOf.get(module) ?? []).filter((e) => e.kind === 'writes')
  if (!outs.length) return []
  const out: string[] = []
  const take = (e: Edge | undefined) => {
    if (e && !out.includes(e.id)) out.push(e.id)
    return !!e
  }
  const whole = outs.find((e) => !!e.place && 'everything' in e.place)
  for (const p of places) {
    if ('page' in p) {
      if (take(outs.find((e) => !!e.place && 'page' in e.place && e.place.page === p.page))) continue
      if (take(outs.find((e) => !!e.place && 'db' in e.place && e.place.db === p.page && e.place.prop === undefined))) continue
      take(whole)
      continue
    }
    let hit = false
    for (const e of outs) {
      const pl = e.place
      if (!pl || !('db' in pl) || pl.db !== p.db || pl.prop === undefined) continue
      const prop = pl.prop
      const fits = prop === '+row' ? !!p.added : prop === '-row' ? false : prop === '*' ? true : p.props.includes(prop)
      if (fits) hit = take(e) || hit
    }
    if (hit) continue
    if (take(outs.find((e) => !!e.place && 'db' in e.place && e.place.db === p.db && e.place.prop === undefined))) continue
    take(whole)
  }
  return out
}

/** The cable from `module` to `target` (a way out, or another module's start): the first one drawn. */
export function exitLegs(ix: LegIndex, module: ModuleKey, target: ModuleKey): string[] {
  const e = (ix.outOf.get(module) ?? []).find((x) => moduleOfJack(x.to) === target)
  return e ? [e.id] : []
}

/** The clock a start leg came from (its FIRED window), if any. */
export function clockOf(ix: LegIndex, legs: readonly string[]): ModuleKey | null {
  for (const id of legs) {
    const e = ix.model.edges.find((x) => x.id === id)
    if (!e) continue
    const m = moduleOfJack(e.from)
    if (m && ix.mods.get(m)?.kind === 'clock') return m
  }
  return null
}
