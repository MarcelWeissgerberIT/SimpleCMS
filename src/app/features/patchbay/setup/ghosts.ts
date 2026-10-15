/**
 * What a profile's recipe adds to the rack (plan §1.11, §3.7, mock-2) — pure. The modules the recipe touches: the ones
 * that exist (its source server, the inbox) real, the ones its lamps make as ghosts (tag 'ghost', dotted, "not made
 * yet"), and the cables between them as planned cables (`planned`, dotted) — the mirror's five: server READ → agent,
 * clock → agent, agent → its database (solid: the mirror writes it on every run), agent → its report page, agent →
 * inbox notes (when it writes notes). A cable whose both ends exist is the model's own (never planned here).
 *
 * Keys are the model's (ref.ts; keys.ts for ghosts), so a ghost sits where its module will sit and turns real with its
 * lamp. Names come from RecipeFacts — setup/facts.ts fills them with mirrorTitles() (the very titles MirrorSetup's plate
 * shows and createMirror / reuseMirror give) — and are display data only, never a key part.
 */
import type { Column, Edge, EdgeKind, Jack, JackRole, Module, ModuleKey, ModuleRef, OpenTarget, Place } from '../types'
import { jackKey } from '../model'
import { moduleKey, scheduleKey } from '../ref'
import { ghostId, ghostKey } from './keys'
import type { RecipeSetup } from './lamps'

export interface GhostPlan {
  /** what the recipe touches, in rack order: real modules it uses (server, inbox) and ghosts (tag 'ghost') */
  modules: Module[]
  /** the planned cables (`planned: true`) */
  edges: Edge[]
  /** the ghosts' names (display only — the recipe's, as mirrorTitles gives them) */
  names: Record<ModuleKey, string>
  /** the lamps that touch each module ("01" "02" on the server, "04" on the database …) */
  chips: Record<ModuleKey, number[]>
  /** ghost modules ("+4 from profile") */
  ghosts: number
  /** planned cables ("+5 planned") */
  planned: number
}

export interface GhostContext {
  /** module keys on the rack now (a clock another agent shares, a cable the model draws already) */
  existing?: ReadonlySet<ModuleKey>
  /** edge ids on the rack now */
  edges?: ReadonlySet<string>
}

const COL: Record<'server' | 'clock' | 'agent' | 'database' | 'page' | 'inbox', Column> = { server: 1, clock: 1, agent: 2, database: 3, page: 3, inbox: 3 }

function module(ref: ModuleRef, col: Column, ghost: boolean, profile: string, open: OpenTarget): Module {
  const key = moduleKey(ref)
  return { key, kind: ref.kind, col, u: 1, ref, tags: ghost ? ['ghost', 'profile'] : ['profile'], profile, inJacks: [], outJacks: [], nets: [], idle: false, open }
}

function jack(m: Module, side: 'in' | 'out', role: JackRole): Jack {
  const list = side === 'in' ? m.inJacks : m.outJacks
  let j = list.find((x) => x.role === role)
  if (!j) list.push((j = { key: jackKey(m.key, role), module: m.key, side, role, plugged: true }))
  return j
}

/**
 * The recipe on the rack: its ghosts and planned cables. Nothing at all when every part exists and the model draws
 * every cable (the setup is done) — `modules` then lists only the real modules the recipe touches.
 */
export function ghostsOf(profileId: string, r: RecipeSetup, ctx: GhostContext = {}): GhostPlan {
  const names: Record<ModuleKey, string> = {}
  const chips: Record<ModuleKey, number[]> = {}
  const mods: Module[] = []
  const add = (m: Module, chip: number[], name?: string) => {
    mods.push(m)
    chips[m.key] = chip
    if (name !== undefined && m.tags.includes('ghost')) names[m.key] = name
    return m
  }
  const none: OpenTarget = { to: 'none' }
  const recipe = r.recipeId

  // § 01 — the source server (01 / 02) and the clock (05)
  const src = r.servers[0] ?? null
  const server = add(
    src ? module({ kind: 'server', id: src.id, name: src.name }, COL.server, false, profileId, { to: 'mcp', server: src.id }) : module({ kind: 'server', id: ghostId(profileId, recipe, 'server'), name: '' }, COL.server, true, profileId, none),
    [1, 2],
    '',
  )
  const t = r.agent.trigger
  const clockRef: ModuleRef | null = t.type === 'schedule' ? { kind: 'clock', schedule: scheduleKey(t), agents: r.agent.id ? [r.agent.id] : [] } : null
  // a ghost until the agent is saved (unless another agent's clock has the same schedule); a saved agent's clock is the
  // model's — none while the agent is switched off
  const clockThere = !!clockRef && !!ctx.existing?.has(moduleKey(clockRef))
  const clock = clockRef && (clockThere || !r.agent.id) ? add(module(clockRef, COL.clock, !clockThere, profileId, r.agent.id ? { to: 'route', route: { name: 'agents', id: r.agent.id } } : none), [5], r.agent.when ?? '') : null

  // § 02 — the agent (05 / 06)
  const agentGhost = !r.agent.id
  const agent = add(
    module({ kind: 'agent', id: r.agent.id ?? ghostId(profileId, recipe, 'agent') }, COL.agent, agentGhost, profileId, r.agent.id ? { to: 'route', route: { name: 'agents', id: r.agent.id } } : none),
    [5, 6],
    r.agent.name,
  )
  if (agentGhost) agent.knobs = { model: r.agent.model ?? null, budgetUsd: r.agent.budgetUsd ?? null }

  // § 03 — the database and its report page (04), the inbox (notes)
  const dbLive = !!r.database.id && !r.database.trashed
  const db = add(
    module({ kind: 'database', id: dbLive ? r.database.id! : ghostId(profileId, recipe, 'database') }, COL.database, !dbLive, profileId, dbLive ? { to: 'route', route: { name: 'page', id: r.database.id! } } : none),
    [4],
    r.database.name,
  )
  const page = add(
    module({ kind: 'page', id: r.report.id ?? ghostId(profileId, recipe, 'page') }, COL.page, !r.report.id, profileId, r.report.id ? { to: 'route', route: { name: 'page', id: r.report.id } } : none),
    [4],
    r.report.title,
  )
  const inbox = r.agent.notes ? add(module({ kind: 'inbox' }, COL.inbox, false, profileId, { to: 'route', route: { name: 'inbox' } }), []) : null

  // the planned cables: every cable of the recipe that the model does not draw yet
  const edges: Edge[] = []
  const ghost = (m: Module) => m.tags.includes('ghost')
  const cable = (kind: EdgeKind, from: Module, fromRole: JackRole, to: Module, toRole: JackRole, place?: Place) => {
    const f = jack(from, 'out', fromRole)
    const t = jack(to, 'in', toRole)
    const id = `${f.key}>${t.key}`
    if (!ghost(from) && !ghost(to) && ctx.edges?.has(id)) return
    edges.push({ id, kind, from: f.key, to: t.key, planned: true, ...(place ? { place } : {}) })
  }
  cable('reads', server, 'read', agent, 'tools')
  if (clock) cable('starts', clock, 'start', agent, 'start')
  // the mirror writes its own database on every run (solid, never "can"): mirror.ts mirrorOf
  cable('writes', agent, 'writes', db, 'writes', { db: db.ref.kind === 'database' ? db.ref.id : '' })
  cable('writes', agent, 'report', page, 'writes', { page: page.ref.kind === 'page' ? page.ref.id : '' })
  if (inbox) cable('writes', agent, 'notes', inbox, 'writes', { inbox: true })
  // 2U: ≥ 3 jacks on a side (the model's rule)
  if (agent.inJacks.length >= 3 || agent.outJacks.length >= 3) agent.u = 2
  // a real module the recipe only touches keeps the jacks the model gives it: drop what the plan added there
  for (const m of mods) if (!ghost(m)) for (const j of [...m.inJacks, ...m.outJacks]) j.plugged = edges.some((e) => e.from === j.key || e.to === j.key)

  const ghosts = mods.filter(ghost).length
  return { modules: mods, edges, names, chips, ghosts, planned: edges.length }
}

/** The ghost key of a part (re-exported for the UI: a lamp's "04" chip finds its ghosts by these). */
export { ghostKey }
