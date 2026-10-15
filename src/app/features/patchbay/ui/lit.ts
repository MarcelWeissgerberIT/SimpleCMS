/**
 * What lights up (plan §3.3 pointer grammar, §3.9) — pure, from the model alone:
 *  - hover a module: its own cables and, through a net flag it writes or listens to, the twin's cables (ink, never
 *    orange); the flags themselves;
 *  - select a module (click / Space): its cables plus every chain it sits on (chains.ts `edges`), the modules at their
 *    ends — the rest dims;
 *  - light a net flag (click / ↵ on a flag): both twins and every cable into and out of them.
 * The index is built once per model (WeakMap); each question is O(its edges).
 */
import { chainModules } from '../layout'
import type { Edge, Model, ModuleKey } from '../types'

interface LitIndex {
  jackMod: Map<string, ModuleKey>
  /** module → the edges at its jacks */
  own: Map<ModuleKey, string[]>
  /** net key → its writers' and listeners' edges */
  nets: Map<string, string[]>
  /** module → the edges of every chain it sits on */
  chains: Map<ModuleKey, Set<string>>
  ends: Map<string, { from: string; to: string }>
  /** jack key / net key → the edges at it */
  at: Map<string, Edge[]>
}

const cache = new WeakMap<Model, LitIndex>()

function indexOf(model: Model): LitIndex {
  const had = cache.get(model)
  if (had) return had
  const jackMod = new Map<string, ModuleKey>()
  for (const m of model.modules) for (const j of [...m.inJacks, ...m.outJacks]) jackMod.set(j.key, m.key)
  const own = new Map<ModuleKey, string[]>()
  const ends = new Map<string, { from: string; to: string }>()
  const at = new Map<string, Edge[]>()
  const atAdd = (k: string, e: Edge) => {
    const list = at.get(k)
    if (list) list.push(e)
    else at.set(k, [e])
  }
  const add = (k: ModuleKey | undefined, id: string) => {
    if (!k) return
    const list = own.get(k)
    if (list) list.push(id)
    else own.set(k, [id])
  }
  for (const e of model.edges) {
    ends.set(e.id, { from: e.from, to: e.to })
    atAdd(e.from, e)
    atAdd(e.to, e)
    add(jackMod.get(e.from), e.id)
    add(jackMod.get(e.to), e.id)
  }
  const nets = new Map<string, string[]>()
  for (const n of model.nets) nets.set(n.key, [...n.writers, ...n.listeners])
  const chains = new Map<ModuleKey, Set<string>>()
  for (const c of model.chains) {
    if (!c.edges?.length) continue
    for (const k of chainModules(c, model)) {
      const set = chains.get(k) ?? new Set<string>()
      for (const e of c.edges) set.add(e)
      chains.set(k, set)
    }
  }
  const ix = { jackMod, own, nets, chains, ends, at }
  cache.set(model, ix)
  return ix
}

export interface Lit {
  /** 'hover' lights in ink, 'select' / 'net' also dim the rest */
  mode: 'hover' | 'select' | 'net'
  edges: Set<string>
  /** net keys whose flags light */
  nets: Set<string>
  /** modules at the ends of the lit cables (with the one asked for) — not dimmed */
  modules: Set<ModuleKey>
}

/** Net keys an edge passes through (a cable into a § 03 flag or out of a § 01 flag). */
const netsOf = (e: { from: string; to: string }): string[] => [e.from, e.to].filter((x) => x.startsWith('net:'))

function grow(ix: LitIndex, edges: Set<string>, seed: ModuleKey[]): Omit<Lit, 'mode'> {
  const nets = new Set<string>()
  const modules = new Set<ModuleKey>(seed)
  for (const id of edges) {
    const e = ix.ends.get(id)
    if (!e) continue
    for (const n of netsOf(e)) nets.add(n)
  }
  // through a flag: the twin's cables light too (same name = the same connection)
  for (const n of nets) for (const id of ix.nets.get(n) ?? []) edges.add(id)
  for (const id of edges) {
    const e = ix.ends.get(id)
    if (!e) continue
    for (const end of [e.from, e.to]) {
      const k = ix.jackMod.get(end)
      if (k) modules.add(k)
    }
  }
  return { edges, nets, modules }
}

/** What a hovered module lights (its cables and twin flags). */
export function litByHover(model: Model, key: ModuleKey): Lit {
  const ix = indexOf(model)
  return { mode: 'hover', ...grow(ix, new Set(ix.own.get(key) ?? []), [key]) }
}

/** What a selected module lights: its cables and every chain through it. */
export function litBySelection(model: Model, key: ModuleKey): Lit {
  const ix = indexOf(model)
  const edges = new Set(ix.own.get(key) ?? [])
  for (const e of ix.chains.get(key) ?? []) edges.add(e)
  return { mode: 'select', ...grow(ix, edges, [key]) }
}

/** What a lit net flag lights: both twins and their cables. */
export function litByNet(model: Model, net: string): Lit {
  const ix = indexOf(model)
  return { mode: 'net', ...grow(ix, new Set(ix.nets.get(net) ?? []), []) }
}

/** The module a jack belongs to. */
export const moduleOfJack = (model: Model, jack: string): ModuleKey | null => indexOf(model).jackMod.get(jack) ?? null

/** The edges at a module's jacks (its own cables). */
export const cablesOf = (model: Model, key: ModuleKey): string[] => indexOf(model).own.get(key) ?? []

/** The edges at a jack (or a net flag's key). */
export const edgesAt = (model: Model, key: string): Edge[] => indexOf(model).at.get(key) ?? []
