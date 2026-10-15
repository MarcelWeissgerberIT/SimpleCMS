/**
 * A recipe's ghosts on the rack (plan §3.3 "ghost", §3.7) — pure. The model as built (model.ts, never stored) plus what
 * a profile's lamps will make: ghostsOf's modules and planned cables merged in, so the layout, the cable layer, the
 * jack picker and the words all see one rack:
 *  - a module the model has already (the source server, an inbox) keeps everything it has and gains the jacks the plan
 *    plugs into it (a server nobody uses yet is no longer idle: a planned cable leaves it);
 *  - a module the model lacks joins as it is (a ghost — tag 'ghost', dotted — or a real one nothing used yet: the inbox);
 *  - planned cables join unless the model draws that cable already;
 *  - the counts again: MODULES and CABLES count the ghosts and the planned cables too (`ghosts`, `planned` say how many
 *    — the readout writes "10 + 4 from profile", "7 + 5 planned").
 * The fuses, chains and nets are the model's own (a ghost is in no chain: nothing runs through it yet).
 */
import type { Jack, Model, Module } from '../types'
import type { GhostPlan } from './ghosts'

const cache = new WeakMap<Model, WeakMap<GhostPlan, Model>>()

/** The model with a recipe's ghosts and planned cables (the same object for the same two inputs). */
export function withGhosts<M extends Model>(model: M, plan: GhostPlan | null): M {
  if (!plan || (!plan.modules.length && !plan.edges.length)) return model
  const byPlan = cache.get(model) ?? new WeakMap<GhostPlan, Model>()
  cache.set(model, byPlan)
  const had = byPlan.get(plan)
  if (had) return had as M

  const planned = new Set<string>()
  for (const e of plan.edges) {
    planned.add(e.from)
    planned.add(e.to)
  }
  const index = new Map(model.modules.map((m, i) => [m.key, i]))
  const modules: Module[] = [...model.modules]
  for (const p of plan.modules) {
    const at = index.get(p.key)
    if (at === undefined) {
      modules.push({ ...p, idle: false, inJacks: [...p.inJacks], outJacks: [...p.outJacks] })
      continue
    }
    const m = modules[at]
    const add = (have: Jack[], from: Jack[]) => [...have, ...from.filter((j) => planned.has(j.key) && !have.some((h) => h.key === j.key))]
    const inJacks = add(m.inJacks, p.inJacks)
    const outJacks = add(m.outJacks, p.outJacks)
    const touched = [...inJacks, ...outJacks].some((j) => planned.has(j.key))
    if (inJacks.length === m.inJacks.length && outJacks.length === m.outJacks.length && !(m.idle && touched) && m.profile) continue
    modules[at] = { ...m, inJacks, outJacks, idle: m.idle && !touched, ...(m.profile ? {} : { profile: p.profile }) }
  }
  const ids = new Set(model.edges.map((e) => e.id))
  const edges = [...model.edges, ...plan.edges.filter((e) => !ids.has(e.id))]
  const out = {
    ...model,
    modules,
    edges,
    counts: {
      modules: modules.filter((m) => !m.idle).length,
      idle: modules.filter((m) => m.idle).length,
      cables: edges.length,
      dashed: edges.filter((e) => e.can).length,
      planned: edges.filter((e) => e.planned).length,
      ghosts: modules.filter((m) => m.tags.includes('ghost')).length,
    },
  }
  byPlan.set(plan, out)
  return out
}
