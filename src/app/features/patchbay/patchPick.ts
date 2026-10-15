/**
 * Patching on the rack (P4, B16) — what a jack may be patched to, pure (Node-loadable) on the model alone:
 *
 *  - choicesOf(jack, model, input) → every patch the "Connect to …" picker offers on a jack (plan §1.13, §3.9):
 *     · an out jack (a source): the targets the matrix allows (patch.ts targetsOf) — group 'to';
 *     · an in jack (a target): the sources that may plug into it — modules on the rack (and folded), § 01 net flags, and
 *       sources the rack does not draw: a database's commands (`database:<id>.rows` → an agent / a script) and a new
 *       row of any database (→ an agent), the own database's row events and fields (→ an automation) — group 'from';
 *     · a server's WRITE? jack: "Lock this tool (OUT)" per write tool and per profile that matches the server — group
 *       'lock' (owners / admins; patch.ts refuses the rest with its reason);
 *     · every cable at the jack: its unplug (and on a server's OUT jack each locked tool's unlock) — group 'unplug'.
 *    A clock of a repeating template is no start for an agent (it makes rows: plug its database's new rows), a ghost of a
 *    setup no end, an EVERYTHING jack no source (its agent may use every database already). Nothing is planned here:
 *    the picker plans each choice (patchApply.ts planPatch) and lists a refused one with its reason.
 *  - acceptOf(jack, model, input) → the jacks a drag from it lights in ink (`data-accept`) and the modules whose jack is
 *    not drawn yet (an agent without MCP servers has no tools jack — its module takes the drop).
 *  - dropPatch(source, target, model, input) → the patch a drop makes (the direction follows the sides: a drag from an
 *    in jack plugs the target into it); a drop on a module's body takes the role it accepts, else its first jack.
 *  - endOfKey(key, model) / patchOfEdge(edge, model) → a jack key or a net key as a PatchEnd, an edge's unplug.
 */
import { canConnect, targetsOf } from './patch'
import { kindOfKey, moduleKey } from './ref'
import { serverToolGroups } from './tools'
import type { Edge, Jack, JackRole, Model, ModelInput, Module, ModuleKey, Patch, PatchEnd } from './types'

export type ChoiceGroup = 'to' | 'from' | 'lock' | 'unplug'

export interface Choice {
  /** stable row id (the patch's ends, the tool) */
  id: string
  group: ChoiceGroup
  patch: Patch
  /** the end the row names: the other end of the cable (lock / unlock: the profile's Outbox end) */
  other: PatchEnd
  /** a server tool (lock / unlock) */
  tool?: string
  /** a source the rack does not draw (a database's commands, a row event nobody listens to yet) */
  virtual?: true
}

/** Properties whose value is computed (never stored — a change of one never starts anything). */
const COMPUTED = new Set(['created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'formula', 'rollup'])

/** The out roles a source may plug from (patch.ts PATCH_MATRIX). */
const SOURCE_ROLES: JackRole[] = ['start', 'rows', 'read', 'write', 'writes', 'everything', 'report', 'out']

export const endOfJack = (j: Pick<Jack, 'module' | 'role'>): PatchEnd => ({ module: j.module, role: j.role })
const endKey = (e: PatchEnd): string => `${e.module}.${e.role}${e.tool !== undefined ? `#${e.tool}` : ''}`

const jackIndex = new WeakMap<Model, Map<string, Jack>>()
function jacksOf(model: Model): Map<string, Jack> {
  let m = jackIndex.get(model)
  if (!m) {
    m = new Map()
    for (const mod of model.modules) for (const j of [...mod.inJacks, ...mod.outJacks]) m.set(j.key, j)
    jackIndex.set(model, m)
  }
  return m
}

/** A jack of the rack by its key. */
export const jackOf = (model: Model, key: string): Jack | null => jacksOf(model).get(key) ?? null

/** A jack key (`<module>.<role>`) or a net key (`net:…`) as the end a patch names. */
export function endOfKey(key: string, model: Model): PatchEnd | null {
  if (key.startsWith('net:')) return { module: key, role: 'start' }
  const j = jacksOf(model).get(key)
  if (j) return endOfJack(j)
  const at = key.lastIndexOf('.')
  return at > 0 ? { module: key.slice(0, at), role: key.slice(at + 1) as JackRole } : null
}

/** The unplug of a cable (its ends as the model drew them). */
export function patchOfEdge(edge: Edge, model: Model): Patch | null {
  const from = endOfKey(edge.from, model)
  const to = endOfKey(edge.to, model)
  return from && to ? { op: 'unplug', from, to, edge: edge.id } : null
}

const isGhost = (m: Module) => m.tags.includes('ghost')

/** The row event a start names (`row|<db>|<event>|<prop>`) — a row trigger and a § 01 flag of the same field are one. */
function rowEvent(e: PatchEnd): string | null {
  const parts = e.module.split(':')
  if (parts[0] === 'net' && parts.length === 3) {
    const [, db, prop] = parts
    if (prop === '+row') return `row|${db}|created|-`
    if (prop === '-row') return `row|${db}|deleted|-`
    return `row|${db}|changed|${prop === '*' ? '-' : prop}`
  }
  if (parts[0] === 'rowTrigger' && parts.length === 4) {
    const [, db, event, prop] = parts
    return `row|${db}|${event}|${prop === '*' ? '-' : prop}`
  }
  return null
}

/** The sources that may plug into `to` (modules first, then § 01 net flags, then what the rack does not draw). */
function sourcesOf(to: PatchEnd, model: Model, input: ModelInput): Array<{ end: PatchEnd; virtual?: true }> {
  const out: Array<{ end: PatchEnd; virtual?: true }> = []
  const seen = new Set<string>()
  const add = (end: PatchEnd, virtual?: true) => {
    const k = endKey(end)
    // a row event names one trigger however it is reached (a row trigger, a § 01 flag, one the rack does not draw)
    const ev = rowEvent(end)
    if (seen.has(k) || (ev && seen.has(ev))) return
    seen.add(k)
    if (ev) seen.add(ev)
    out.push(virtual ? { end, virtual } : { end })
  }
  const target = model.modules.find((m) => m.key === to.module) ?? null
  for (const m of model.modules) {
    if (m.key === to.module || isGhost(m)) continue
    // a repeating template's clock makes rows (plug its database's new rows instead)
    if (m.ref.kind === 'clock' && m.ref.template) continue
    let roles = SOURCE_ROLES.filter((r) => canConnect({ module: m.key, role: r }, to))
    // "writes" and "everything" mean the same patch (scope += db): the agent's own jack
    if (roles.includes('writes') && roles.includes('everything')) roles = roles.filter((r) => r !== (m.outJacks.some((j) => j.role === 'everything') ? 'writes' : 'everything'))
    for (const r of roles) add({ module: m.key, role: r })
  }
  for (const n of model.nets) {
    const e: PatchEnd = { module: n.key, role: 'start' }
    if (canConnect(e, to)) add(e)
  }
  const tk = target?.kind ?? kindOfKey(to.module)
  if (to.role !== 'start') return out
  // a database's commands (an own command that runs the agent / the script) — any live database
  if (tk === 'agent' || tk === 'script') for (const d of input.databases) add({ module: moduleKey({ kind: 'database', id: d.id }), role: 'rows' }, true)
  // a new row of any live database (an agent's row trigger)
  if (tk === 'agent') for (const d of input.databases) add({ module: moduleKey({ kind: 'rowTrigger', db: d.id, event: 'created', prop: null }), role: 'start' }, true)
  // an automation runs on its own database's rows: a new row, a deleted row, a field that changes
  if (tk === 'automation' && target?.ref.kind === 'automation') {
    const db = target.ref.db
    const d = input.databases.find((x) => x.id === db)
    if (d) {
      add({ module: moduleKey({ kind: 'rowTrigger', db, event: 'created', prop: null }), role: 'start' }, true)
      add({ module: moduleKey({ kind: 'rowTrigger', db, event: 'deleted', prop: null }), role: 'start' }, true)
      for (const p of d.properties) if (!COMPUTED.has(p.type)) add({ module: moduleKey({ kind: 'rowTrigger', db, event: 'changed', prop: p.id }), role: 'start' }, true)
    }
  }
  return out
}

/** Every patch the "Connect to …" picker offers on a jack (plan §3.9), in groups: to / from · lock · unplug. */
export function choicesOf(jack: Jack, model: Model, input: ModelInput): Choice[] {
  const out: Choice[] = []
  const self = endOfJack(jack)
  const mod = model.modules.find((m) => m.key === jack.module) ?? null
  if (!mod || isGhost(mod)) return out
  if (jack.side === 'out') {
    // an EVERYTHING jack's agent may use every database already: nothing to plug
    if (jack.role !== 'everything') {
      for (const to of targetsOf(self, model)) {
        if (to.module === jack.module) continue
        out.push({ id: `to:${endKey(to)}`, group: 'to', patch: { op: 'plug', from: self, to }, other: to })
      }
    }
  } else {
    for (const s of sourcesOf(self, model, input)) out.push({ id: `from:${endKey(s.end)}`, group: 'from', patch: { op: 'plug', from: s.end, to: self }, other: s.end, ...(s.virtual ? { virtual: true as const } : {}) })
  }
  // a server's tools: lock a WRITE? tool for a profile that matches the server (OUT), unlock a locked one
  if (mod.ref.kind === 'server' && (jack.role === 'write' || jack.role === 'out')) {
    const ref = mod.ref
    const { groups } = serverToolGroups(input, ref)
    const profiles = input.profiles.filter((p) => p.servers.includes(ref.name))
    for (const p of profiles) {
      const box: PatchEnd = { module: moduleKey({ kind: 'outbox', profile: p.profile.id, route: '', db: null }), role: 'send' }
      if (jack.role === 'write') {
        for (const tool of groups.write) out.push({ id: `lock:${p.profile.id}:${tool}`, group: 'lock', patch: { op: 'plug', from: { ...self, tool }, to: box }, other: box, tool })
      } else {
        const own = new Set([...(p.profile.outTools ?? []), ...(p.profile.sends ?? []).map((r) => r.tool)])
        for (const tool of groups.out) if (own.has(tool)) out.push({ id: `unlock:${p.profile.id}:${tool}`, group: 'unplug', patch: { op: 'unplug', from: { ...self, tool }, to: box }, other: box, tool })
      }
    }
  }
  // every cable at the jack: its unplug (a planned cable of a setup is no cable yet)
  for (const e of model.edges) {
    if (e.planned || (e.from !== jack.key && e.to !== jack.key)) continue
    const p = patchOfEdge(e, model)
    if (!p) continue
    const other = e.from === jack.key ? p.to : p.from
    out.push({ id: `unplug:${e.id}`, group: 'unplug', patch: p, other })
  }
  return out
}

/** What a drag from `jack` lights: the jacks it may plug into (`<module>.<role>`) and the modules whose jack is not drawn. */
export function acceptOf(jack: Jack, model: Model, input: ModelInput): { jacks: Set<string>; modules: Set<ModuleKey> } {
  const jacks = new Set<string>()
  const modules = new Set<ModuleKey>()
  for (const c of choicesOf(jack, model, input)) {
    if (c.group !== 'to' && c.group !== 'from') continue
    const key = `${c.other.module}.${c.other.role}`
    jacks.add(key)
    // its jack not drawn yet (an agent without MCP servers has no tools jack): the module takes the drop
    if (!jackOf(model, key)) modules.add(c.other.module)
  }
  return { jacks, modules }
}

/**
 * The patch a drop makes: onto a jack (the sides decide the direction — a drag from an in jack plugs the other end into
 * it), or onto a module's body (the role it accepts from the source, else its first jack on the other side). Null: the
 * same module, or nothing to drop on.
 */
export function dropPatch(source: Jack, target: { jack?: Jack | null; module?: ModuleKey | null }, model: Model, input: ModelInput): Patch | null {
  const self = endOfJack(source)
  if (target.jack) {
    if (target.jack.module === source.module) return null
    const other = endOfJack(target.jack)
    return source.side === 'in' ? { op: 'plug', from: other, to: self } : { op: 'plug', from: self, to: other }
  }
  const key = target.module
  if (!key || key === source.module) return null
  const m = model.modules.find((x) => x.key === key)
  if (!m) return null
  const fit = choicesOf(source, model, input).find((c) => (c.group === 'to' || c.group === 'from') && c.other.module === key)
  if (fit) return fit.patch
  // nothing fits: the module's jack on the other side (the plan says why it does not connect)
  const j = source.side === 'out' ? m.inJacks[0] : m.outJacks[0]
  const role: JackRole = j?.role ?? 'start'
  return source.side === 'out' ? { op: 'plug', from: self, to: { module: key, role } } : { op: 'plug', from: { module: key, role }, to: self }
}
