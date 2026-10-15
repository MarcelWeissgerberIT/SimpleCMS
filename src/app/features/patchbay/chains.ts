/**
 * The chains behind the rack (plan §2.5) — pure. Analysis is complete (§6 A1): it walks the model's flow (every place
 * each module may write, who starts on each place — model.ts `Model.flow`, never the drawn cables alone) with the
 * engines' rules (rules.ts), so a path of any length is found; only the drawing folds ("+n steps" past 3).
 *
 *  1. **Taint fixpoint** (§6 A3): the places from outside to begin with — mail rows, team hooks' rows, Clippings, GitHub
 *     pick-ups — then every place written by a processor that reads one of them (an agent, autofill, organise, the
 *     bridge, an automation started on such a row, a script reading or called on one) is from outside too, iterated
 *     until nothing changes (each place flips once; the marks keep who wrote it and from where).
 *  2. **The walk, per decider** (reach.ts `deciderOf`): breadth first over (module, writer kind), O(V + E) — a decider's
 *     writes start listeners as the engines allow (a server agent's write only a kit relay; `set_property` and a script
 *     inside `run_script` no automation; an agent never an agent directly; autofill never autofill; a write into a
 *     pipeline database reaches the pipeline); an automation's `run_script` starts its script (automations paused). Ways
 *     out (§1.4): an automation's webhook, a decider's MCP write tools (its own or a downstream decider's), a pipeline's
 *     git action, this device's GitHub push (every write it carries), and — by hand — Outbox routes, commands' and
 *     buttons' webhooks, script effects (asked first). A first pass finds what is reached with nobody in between; a
 *     second pass what is reached only through a gate (§1.3): a stage agent's proposals, the bridge or a script asking,
 *     a coding task waiting for Confirm, a git stage behind a gate this device's approvals stop at, a press by hand. A
 *     hand START is never a gate (the walk starts at the decider).
 *     Coding tasks (fix model, coding/trust.ts): a task waits for Confirm when a custom agent wrote it (locally: created
 *     it or changed it last), and in a team when nothing carried a trusted version over to it — a remote write (a server
 *     agent, a team hook or token, another member's tab), a sync / file pick-up, a new row; a change made in the worker's
 *     tab keeps a trusted task trusted. A same-row relay (autofill, a kit value, an automation's `set_property`) after
 *     such a write leaves the row as untrusted as it found it. The worker writes the task row as it runs (Stage moves,
 *     its outputs — model.ts): its moves carry the Confirm gate of how the task was entered.
 *  3. **Loops** (↺): a depth-first pass over the same flow; each (module, place) pair that comes back once.
 *  4. **One chain per (decider, way out)**, its lamps from reach.ts: the outside sources (the primary one is the chain's
 *     source and part of its key — the other sources are named in the lamp), private data relative to the source and
 *     the exit, the exit itself or the gate in front of it. B4 (fuses.ts) decides fuse / near miss / nothing.
 *
 * Steps are the drawn cables after the decider (a net-flag hop is two: the writer's half to the flag `{ to: Place }`, the
 * listener's half from it `{ via: Place, to }`); `edges` lights the whole path, the source's lead cable first.
 */
import { keyPart } from './ref'
import { honoursHandOnly, placeKey, reaches, startable, type WriterKind } from './rules'
import {
  allows,
  autofillPropsOf,
  deciderOf,
  markOutside,
  outWhy,
  outsideSources,
  outsideWhy,
  privateItems,
  privateWhy,
  reachIndex,
  readRoots,
  startingOutside,
  type Decider,
  type OutsideIndex,
  type ReachIndex,
  type ReadRoots,
} from './reach'
import type { ID } from '../../store/types'
import type { Chain, ChainExit, ChainStep, Edge, FlowListen, FlowWrite, Gate, LoopMark, Model, ModelInput, Module, ModuleKey, NetTag, OutsideSource, Place } from './types'

/** Steps drawn in full; the rest fold into "+n steps" (§2.5). */
export const SHOWN_STEPS = 3

/* ------------------------------------------------------------------ the flow as the engines run it */

/** A module as the walk enters it: its key and the kind of writer it is then (a script inside `run_script` is paused). */
interface Node {
  key: ModuleKey
  kind: WriterKind | null
}

/** One move of the flow: into a module, through a place, the cables it takes, the gate it passes (if any). */
interface Move {
  to: Node
  place?: Place
  steps: ChainStep[]
  gate: Gate | null
  /** pipelines: 'confirm' when the task waits for Confirm (who wrote it, §1.3) — else its approvals decide per git stage */
  pipe?: Gate | null
  /** a press by hand (a command / button on a place written) — never a loop */
  byHand?: true
  /** the place written to reach the listener (`<prop>` · '*' · '+row' · '-row') */
  wp?: string
}

/** A way out reached from a module. */
interface Out {
  exit: ChainExit
  steps: ChainStep[]
  gate: Gate | null
  failClosed: boolean
  withheld: boolean
}

interface FlowIndex {
  ix: ReachIndex
  /** database → its listened places and who listens */
  listens: Map<ID, Array<{ lp: string; ls: FlowListen[] }>>
  writes: Record<ModuleKey, FlowWrite[]>
  /** database → its commands; page → its buttons (pressed by a person) */
  commands: Map<ID, ModuleKey[]>
  buttons: Map<ID, ModuleKey[]>
  /** this device's GitHub push (the edge out of the sync module) */
  push: Edge | null
  deciders: Map<ModuleKey, Decider | null>
}

function flowIndex(ix: ReachIndex): FlowIndex {
  const flow = ix.model.flow ?? { writes: {}, listens: {} }
  const listens = new Map<ID, Array<{ lp: string; ls: FlowListen[] }>>()
  for (const k of Object.keys(flow.listens).sort()) {
    const cut = k.lastIndexOf(':')
    const db = k.slice(0, cut)
    const list = listens.get(db) ?? []
    list.push({ lp: k.slice(cut + 1), ls: flow.listens[k] })
    listens.set(db, list)
  }
  const commands = new Map<ID, ModuleKey[]>()
  const buttons = new Map<ID, ModuleKey[]>()
  for (const m of ix.model.modules) {
    if (m.ref.kind === 'command') commands.set(m.ref.db, [...(commands.get(m.ref.db) ?? []), m.key])
    else if (m.ref.kind === 'button') buttons.set(m.ref.page, [...(buttons.get(m.ref.page) ?? []), m.key])
  }
  const push = ix.github && ix.input.sync.github.auto ? ((ix.from.get(ix.github) ?? []).find((e) => e.kind === 'out') ?? null) : null
  return { ix, listens, writes: flow.writes, commands, buttons, push, deciders: new Map() }
}

const deciderAt = (f: FlowIndex, key: ModuleKey): Decider | null => {
  if (!f.deciders.has(key)) {
    const m = f.ix.mods.get(key)
    f.deciders.set(key, m ? deciderOf(f.ix, m) : null)
  }
  return f.deciders.get(key)!
}

/** The writer kind of a module entered by `how` (a script started by an automation runs with automations paused). */
function kindOf(f: FlowIndex, key: ModuleKey, how: 'root' | 'listen' | 'start' | 'byHand'): Node['kind'] {
  const m = f.ix.mods.get(key)
  if (!m) return null
  switch (m.ref.kind) {
    case 'agent': {
      // a route this build can never run, or one the team server skips: the agent never runs, its writes never happen
      const ai = f.ix.agents.get(m.ref.id)
      if (!ai || ai.routeBlocked || ai.serverSkip) return null
      return ai.agent.runner === 'server' ? 'serverAgent' : 'agent'
    }
    case 'script':
      return how === 'start' ? 'autoScript' : 'script'
    case 'pipeline':
      return 'pipeline'
    case 'automation':
    case 'autofill':
    case 'organise':
    case 'kit':
    case 'bridge':
    case 'clock':
    case 'button':
    case 'command':
    case 'incoming':
    case 'sync':
    case 'clippings':
      return m.ref.kind
    default:
      return null
  }
}

const writeGate = (w: FlowWrite): Gate | null => (w.proposal ? 'proposals' : w.asksFirst ? 'asks' : w.byHand ? 'byHand' : null)

/** The cable that draws module `m`'s write reaching place (db, lp) — the net flag, else the database, else Whole workspace. */
function writeCable(f: FlowIndex, m: ModuleKey, place: Place): string {
  const w = f.ix.writeEdge
  if ('db' in place) return w.get(`${m}|${place.db}:${place.prop ?? '*'}`) ?? w.get(`${m}|${place.db}:*`) ?? w.get(`${m}|everything`) ?? ''
  return w.get(`${m}|${placeKey(place)}`) ?? w.get(`${m}|everything`) ?? ''
}

const teamTrust = (f: FlowIndex): boolean => f.ix.input.ctx.team || f.ix.input.worker.confirm === 'always'

/**
 * Who writes a task into a pipeline decides whether it waits for Confirm (§1.3, §6 A9; coding/trust.ts): a custom
 * agent's write always (isAgentWriting never carries trust; locally `needsConfirm` for an agent's task); in a team also
 * a remote write (a hook or token), a sync / file pick-up and a new row (no trusted version before it). Anything else
 * written in the worker's tab keeps a trusted task trusted: null — this device's approvals decide per git stage.
 */
function pipelineGate(f: FlowIndex, writer: Node, wp: string): Gate | null {
  if (writer.kind === 'agent' || writer.kind === 'serverAgent') return 'confirm'
  if (teamTrust(f) && (writer.kind === 'incoming' || writer.kind === 'sync' || wp === '+row')) return 'confirm'
  return null
}

/** Does this write leave the task row it lands on waiting for Confirm (what a same-row relay after it inherits)? */
function leavesUntrusted(f: FlowIndex, writer: Node, wp: string): boolean {
  // locally an agent's change is the person's own again after the next change here (agents/attribution.ts keeper) —
  // only a task an agent created keeps waiting
  if (!teamTrust(f)) return (writer.kind === 'agent' || writer.kind === 'serverAgent') && wp === '+row'
  return pipelineGate(f, writer, wp) === 'confirm'
}

/** A relay that writes the very row it was started on (autofill, a kit value, an automation without a folded script). */
function sameRow(f: FlowIndex, n: Node): boolean {
  if (n.kind === 'autofill' || n.kind === 'kit') return true
  return n.kind === 'automation' && !f.ix.mods.get(n.key)?.folds?.script
}

/** Is a write of `place` carried by this device's GitHub push (team: shared pages, private ones with includePrivate)? */
function pushCarries(f: FlowIndex, place: Place): boolean {
  if (!f.push) return false
  if ('inbox' in place || 'external' in place) return false
  const { input } = f.ix
  if (!input.ctx.team || input.sync.github.includePrivate || 'everything' in place) return true
  const id = 'db' in place ? place.db : place.page
  return !input.pages[id]?.private
}

/**
 * The moves a module makes once entered (its writes, the scripts it starts, the presses by hand its places offer).
 * `pipe`: a pipeline entered with a task waiting for Confirm writes nothing before the person confirms.
 */
function movesOf(f: FlowIndex, at: Node, pipe: Gate | null = null): Move[] {
  if (!at.kind) return []
  const out: Move[] = []
  const w = { kind: at.kind, key: at.key }
  const base: Gate | null = at.kind === 'pipeline' ? pipe : null
  const honours = honoursHandOnly(w.kind)
  const listenMoves = (db: ID, wpFor: (lp: string) => string | null, gate: Gate | null) => {
    const hand = honours ? f.ix.handOnly.get(db) : undefined
    for (const { lp, ls } of f.listens.get(db) ?? []) {
      const wp = wpFor(lp)
      if (wp === null || hand?.has(lp)) continue
      for (const l of ls) {
        if (!startable(w, l) || !reaches(wp, lp, l, autofillPropsOf(f.ix, db))) continue
        const place: Place = { db, prop: lp as '*' }
        out.push({
          to: { key: l.module, kind: kindOf(f, l.module, 'listen') },
          place,
          gate,
          wp,
          steps: [
            { from: at.key, to: place, edge: writeCable(f, at.key, place) },
            { from: at.key, via: place, to: l.module, edge: f.ix.listenEdge.get(`${l.module}|${placeKey(place)}`) ?? '' },
          ],
        })
      }
    }
  }
  const pipelineMove = (db: ID, gate: Gate | null, wp: string) => {
    const p = f.ix.pipelines.get(db)
    // the worker's own writes into its task rows never enter it again
    if (!p || p === at.key) return
    const place: Place = { db }
    out.push({ to: { key: p, kind: 'pipeline' }, place, gate, wp, pipe: pipelineGate(f, at, wp), steps: [{ from: at.key, via: place, to: p, edge: writeCable(f, at.key, place) }] })
  }
  const pressMoves = (list: ModuleKey[] | undefined, place: Place) => {
    for (const k of list ?? []) out.push({ to: { key: k, kind: kindOf(f, k, 'byHand') }, place, gate: 'byHand', byHand: true, steps: [{ from: at.key, via: place, to: k, edge: writeCable(f, at.key, place) }] })
  }
  for (const write of f.writes[at.key] ?? []) {
    const gate = base ?? writeGate(write)
    const p = write.place
    if ('db' in p) {
      if (!f.ix.dbs.has(p.db)) continue
      const wp = p.prop ?? '*'
      listenMoves(p.db, () => wp, gate)
      pipelineMove(p.db, gate, wp)
      pressMoves(f.commands.get(p.db), { db: p.db })
    } else if ('page' in p) {
      pressMoves(f.buttons.get(p.page), p)
    } else if ('everything' in p) {
      // every place: every listened field, new rows (deleted rows only through the bridge's tidy tools), every pipeline
      for (const db of f.listens.keys()) listenMoves(db, (lp) => (lp === '+row' ? '+row' : lp === '-row' ? (at.kind === 'bridge' ? '-row' : null) : '*'), gate)
      for (const db of [...f.ix.pipelines.keys()].sort()) pipelineMove(db, gate, '*')
      for (const db of [...f.commands.keys()].sort()) pressMoves(f.commands.get(db), { db })
      for (const page of [...f.buttons.keys()].sort()) pressMoves(f.buttons.get(page), { page })
    }
  }
  // the scripts it starts (an automation's run_script — automations paused while it runs; a press runs one as usual)
  for (const e of f.ix.from.get(at.key) ?? []) {
    if (e.kind !== 'starts') continue
    const to = f.ix.jackMod.get(e.to)
    if (!to || f.ix.mods.get(to)?.kind !== 'script') continue
    out.push({ to: { key: to, kind: kindOf(f, to, at.kind === 'automation' ? 'start' : 'listen') }, gate: base, steps: [{ from: at.key, to, edge: e.id }] })
  }
  return out
}

/**
 * The ways out of a module once entered (`pipe`: a pipeline's task waits for Confirm — 'confirm' — or its git stages
 * go by this device's approvals: the cable's `afterApproval`, model.ts per git action).
 */
function outsOf(f: FlowIndex, at: Node, pipe: Gate | null | undefined): Out[] {
  const out: Out[] = []
  const { ix } = f
  for (const e of ix.from.get(at.key) ?? []) {
    if (e.kind !== 'out') continue
    const to = ix.jackMod.get(e.to)
    const m = to ? ix.mods.get(to) : undefined
    if (!m || (m.kind !== 'outbound' && m.kind !== 'outbox')) continue
    const gate = at.kind === 'pipeline' ? (pipe === 'confirm' ? 'confirm' : e.afterApproval ? 'afterApproval' : null) : e.byHand ? 'byHand' : e.asksFirst ? 'asks' : null
    out.push({ exit: { module: m.key, type: m.kind === 'outbox' ? 'outbox' : (m.exit ?? 'webhook'), edge: e.id }, steps: [{ from: at.key, to: m.key, edge: e.id }], gate, failClosed: false, withheld: false })
  }
  // MCP write tools of a decider: they run inside the AI's tool loop — no proposal stops them (§1.3)
  const d = deciderAt(f, at.key)
  // (a decider none of whose providers takes MCP servers has none: D-S2-7)
  if (d?.mcp)
    for (const t of ix.tools.get(at.key) ?? []) {
      if (!t.write) continue
      out.push({ exit: { module: t.server, type: 'mcp', edge: t.write }, steps: [{ from: at.key, to: t.server, edge: t.write }], gate: null, failClosed: t.failClosed, withheld: !allows(ix, d, 'mcp') })
    }
  // this device's GitHub push carries every write it holds (§1.4, §6 A10)
  if (f.push && at.kind !== 'pipeline')
    for (const w of f.writes[at.key] ?? []) {
      if (!pushCarries(f, w.place)) continue
      const target = ix.jackMod.get(f.push.to)
      if (!target) break
      out.push({
        exit: { module: target, type: 'sync', edge: f.push.id },
        steps: [{ from: at.key, via: w.place, to: target, edge: f.push.id }],
        gate: writeGate(w),
        failClosed: false,
        withheld: false,
      })
    }
  return out
}

/* ------------------------------------------------------------------ taint */

const TAINTERS = new Set(['agent', 'autofill', 'organise', 'bridge', 'automation', 'script', 'kit', 'pipeline'])

/** A script (or the automation it is folded into) that names places by name: it may write anywhere (§1.17). */
function writesByName(ix: ReachIndex, m: Module): boolean {
  const id = m.ref.kind === 'script' ? m.ref.id : m.ref.kind === 'automation' ? m.folds?.script : undefined
  return !!id && !!ix.scans.get(id)?.byName
}

/** The places from outside (§1.3 #2) and the processors fed from outside — the fixpoint (§6 A3). */
export function taintOf(ix: ReachIndex): { oi: OutsideIndex; fed: Map<ModuleKey, OutsideSource> } {
  const oi = startingOutside(ix)
  const fed = new Map<ModuleKey, OutsideSource>()
  const writes = ix.model.flow?.writes ?? {}
  const procs: Array<{ m: Module; roots: ReadRoots; d: Decider | null }> = []
  for (const m of ix.model.modules) {
    const byName = writesByName(ix, m)
    if (!TAINTERS.has(m.kind) || (!writes[m.key]?.length && !byName)) continue
    // a route-blocked agent never runs (nor one the team server skips); an Unreadable one may run on a newer build (no
    // data rule known — none applied)
    if (m.ref.kind === 'agent' && (ix.agents.get(m.ref.id)?.routeBlocked || ix.agents.get(m.ref.id)?.serverSkip)) continue
    procs.push({ m, roots: readRoots(ix, m), d: deciderOf(ix, m) })
  }
  procs.sort((a, b) => (a.m.key < b.m.key ? -1 : 1))
  let changed = true
  while (changed) {
    changed = false
    for (const p of procs) {
      if (fed.has(p.m.key)) continue
      const first = outsideSources(ix, oi, p.m, p.roots, p.d).find((s) => !s.withheld)
      if (!first) continue
      fed.set(p.m.key, first)
      changed = true
      const mark = { kind: 'tainted' as const, source: p.m.key, writer: p.m.key, from: first.kind === 'tainted' ? (first.writer ?? first.source) : first.source }
      for (const w of writes[p.m.key] ?? []) {
        const place = w.place
        // the worker's writes into its own task rows: those rows are what fed it — no new place from outside
        if (p.m.ref.kind === 'pipeline' && 'db' in place && place.db === p.m.ref.db) continue
        if ('db' in place) markOutside(oi, { db: place.db }, mark)
        else if ('page' in place || 'everything' in place) markOutside(oi, place, mark)
      }
      // fix (model): places named by name may be any place — conservatively everything (its unknown part says so too)
      if (writesByName(ix, p.m)) markOutside(oi, { everything: true }, mark)
    }
  }
  return { oi, fed }
}

/* ------------------------------------------------------------------ loops */

/** The flow's loops (↺): every (module, place) pair a depth-first walk comes back to, once (presses by hand left out). */
function loopsOf(f: FlowIndex): LoopMark[] {
  const marks = new Map<string, LoopMark>()
  const color = new Map<string, 1 | 2>()
  const id = (n: Node) => `${n.key}|${n.kind}`
  const roots: Node[] = Object.keys(f.writes)
    .sort()
    .map((key) => ({ key, kind: kindOf(f, key, 'listen') }))
  for (const m of f.ix.model.modules) if (m.kind === 'automation') roots.push({ key: m.key, kind: 'automation' })
  for (const root of roots) {
    if (color.has(id(root))) continue
    const stack: Array<{ n: Node; moves: Move[]; i: number }> = [{ n: root, moves: movesOf(f, root).filter((x) => !x.byHand), i: 0 }]
    color.set(id(root), 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top.i >= top.moves.length) {
        color.set(id(top.n), 2)
        stack.pop()
        continue
      }
      const mv = top.moves[top.i++]
      const c = color.get(id(mv.to))
      if (c === 1) {
        const at = `${mv.to.key}@${mv.place ? placeKey(mv.place) : ''}`
        if (!marks.has(at)) marks.set(at, { at, module: mv.to.key, ...(mv.place ? { place: mv.place } : {}) })
        continue
      }
      if (c === 2) continue
      color.set(id(mv.to), 1)
      stack.push({ n: mv.to, moves: movesOf(f, mv.to).filter((x) => !x.byHand), i: 0 })
    }
  }
  return [...marks.values()].sort((a, b) => (a.at < b.at ? -1 : 1))
}

/* ------------------------------------------------------------------ the walk */

interface Hop {
  node: Node
  gate: Gate | null
  parent: Hop | null
  /** the steps from the parent to here */
  lead: ChainStep[]
  pipe?: Gate | null
  /** a same-row relay started on a task row of this pipeline database that waits for Confirm (coding/trust.ts) */
  untrusted?: ID
}

interface Found {
  out: Out
  hop: Hop
  gate: Gate | null
}

/** Breadth first from the decider: `free` = only moves nobody stands in (pass 1), else any (pass 2: the first gate holds). */
function bfs(f: FlowIndex, root: Node, free: boolean, found: Map<string, Found>): void {
  const seen = new Set<string>([`${root.key}|${root.kind}`])
  const queue: Hop[] = [{ node: root, gate: null, parent: null, lead: [] }]
  for (let qi = 0; qi < queue.length; qi++) {
    const hop = queue[qi]
    for (const out of outsOf(f, hop.node, hop.pipe)) {
      const gate = hop.gate ?? out.gate
      if (free && gate) continue
      if (!found.has(out.exit.edge)) found.set(out.exit.edge, { out, hop, gate })
    }
    for (const mv of movesOf(f, hop.node, hop.pipe ?? null)) {
      const gate = hop.gate ?? mv.gate
      if (free && gate) continue
      const db = mv.place && 'db' in mv.place && f.ix.pipelines.has(mv.place.db) ? mv.place.db : null
      let pipe = mv.pipe ?? null
      let untrusted: ID | undefined
      if (db && mv.to.kind === 'pipeline') {
        // a same-row relay writing a task row left waiting for Confirm: the task still waits
        if (pipe !== 'confirm' && hop.untrusted === db && sameRow(f, hop.node)) pipe = 'confirm'
      } else if (db && sameRow(f, mv.to) && (leavesUntrusted(f, hop.node, mv.wp ?? '*') || (hop.untrusted === db && sameRow(f, hop.node)))) untrusted = db
      // a pipeline's ways out depend on who wrote the task, a relay's on the row it was started on: each its own visit
      const k = `${mv.to.key}|${mv.to.kind}${mv.to.kind === 'pipeline' ? `|${pipe ?? ''}` : ''}${untrusted ? `|u:${untrusted}` : ''}`
      if (seen.has(k)) continue
      seen.add(k)
      queue.push({ node: mv.to, gate, parent: hop, lead: mv.steps, ...(mv.to.kind === 'pipeline' ? { pipe } : {}), ...(untrusted ? { untrusted } : {}) })
    }
  }
}

/** Every way out of a decider: those reached with nobody in between, then those reached only through a gate. */
function exitsOf(f: FlowIndex, d: Decider): Found[] {
  const root: Node = { key: d.key, kind: kindOf(f, d.key, 'root') }
  const free = new Map<string, Found>()
  bfs(f, root, true, free)
  const any = new Map<string, Found>()
  bfs(f, root, false, any)
  for (const [k, v] of any) if (!free.has(k)) free.set(k, v)
  return [...free.values()].sort((a, b) => (a.out.exit.edge < b.out.exit.edge ? -1 : 1))
}

const pathOf = (hop: Hop): Hop[] => {
  const out: Hop[] = []
  for (let h: Hop | null = hop; h; h = h.parent) out.unshift(h)
  return out
}

const stepNode = (s: ChainStep): string => (typeof s.to === 'string' ? s.to : `@${placeKey(s.to)}`)

/** The cable that brings the primary source to the decider (a row trigger / flag into its start, a READ cable, the hook). */
function leadCable(ix: ReachIndex, d: Decider, src: OutsideSource | null): string | null {
  if (!src) return null
  if (src.via === 'tools') return ix.tools.get(d.key)?.find((t) => t.server === src.source)?.read ?? null
  const into = (ix.into.get(d.key) ?? []).filter((e) => e.to === `${d.key}.start`)
  if (src.via === 'webhook') return into.find((e) => ix.jackMod.get(e.from) === src.source)?.id ?? null
  if ((src.via === 'trigger' || src.via === 'row') && src.place && 'db' in src.place) {
    const db = src.place.db
    const hit = into.find((e) => (e.from.startsWith('net:') ? e.from.startsWith(`net:${keyPart(db)}:`) : ix.mods.get(ix.jackMod.get(e.from) ?? '')?.ref.kind === 'rowTrigger' && (ix.mods.get(ix.jackMod.get(e.from)!)!.ref as { db: ID }).db === db))
    return hit?.id ?? null
  }
  return null
}

/* ------------------------------------------------------------------ the analysis */

export interface ChainAnalysis {
  chains: Chain[]
  loops: LoopMark[]
  /** the places from outside (after the taint fixpoint) */
  outside: OutsideIndex
  /** the processors fed from outside, with their primary source */
  fed: Map<ModuleKey, OutsideSource>
  /** the deciders on the rack */
  deciders: Decider[]
}

/** The chains of a model (pure; the model is not changed). */
export const analyseChains = (model: Model, input: ModelInput): ChainAnalysis => analyse(reachIndex(model, input))

function analyse(ix: ReachIndex): ChainAnalysis {
  const { model } = ix
  const f = flowIndex(ix)
  const { oi, fed } = taintOf(ix)
  const loops = loopsOf(f)
  const loopAt = new Map<ModuleKey, LoopMark>()
  for (const l of loops) if (!loopAt.has(l.module)) loopAt.set(l.module, l)

  const deciders: Decider[] = []
  const chains: Chain[] = []
  for (const m of model.modules) {
    const d = deciderAt(f, m.key)
    if (!d) continue
    deciders.push(d)
    const roots = readRoots(ix, m)
    const sources = outsideSources(ix, oi, m, roots, d)
    const reach = sources.filter((s) => !s.withheld)
    for (const found of exitsOf(f, d)) {
      const path = pathOf(found.hop)
      const steps = [...path.flatMap((h) => h.lead), ...found.out.steps]
      const exit = found.out.exit
      // the primary source: the first that leaves private data in reach for this exit, else the first that reaches
      let primary: OutsideSource | null = null
      let items = privateItems(ix, m, d, roots, null, exit, sources)
      for (const s of reach) {
        const its = privateItems(ix, m, d, roots, s, exit, sources)
        if (!primary) {
          primary = s
          items = its
        }
        if (its.length) {
          primary = s
          items = its
          break
        }
      }
      if (!primary && sources.length) primary = sources[0]
      const relays = path.slice(1).map((h) => h.node.key)
      const source = primary?.source ?? d.key
      const lead = leadCable(ix, d, primary)
      const edges: string[] = []
      for (const e of [lead, ...steps.map((s) => s.edge)]) if (e && !edges.includes(e)) edges.push(e)
      const taint = reach.filter((s) => s.kind === 'tainted' && s.place).map((s) => s.place!)
      const loop = [d.key, ...relays].map((k) => loopAt.get(k)).find((x) => !!x)
      const chain: Chain = {
        key: [...(source !== d.key ? [source] : []), d.key, ...steps.map(stepNode)].join('>'),
        source,
        decider: d.key,
        steps,
        shown: Math.min(SHOWN_STEPS, steps.length),
        ...(loop ? { loop: { at: loop.at } } : {}),
        ...(found.gate ? { gate: found.gate } : {}),
        ...(taint.length || relays.length ? { via: { ...(taint.length ? { taint } : {}), ...(relays.length ? { relay: relays } : {}) } } : {}),
        exit,
        edges,
        lamps: { outside: outsideWhy(sources, primary), private: privateWhy(items), out: outWhy(ix, exit, found.gate, found.out.failClosed, found.out.withheld) },
        why: { outside: sources, private: items },
        ...(found.out.withheld ? { withheld: 'mcp' as const } : {}),
      }
      chains.push(chain)
    }
  }
  chains.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { chains, loops, outside: oi, fed, deciders }
}

/** The places a net tag reads that hold content from outside (not by the module's own writes). */
function taggedOutside(ix: ReachIndex, oi: OutsideIndex, self: ModuleKey, tag: NetTag): ModuleKey | null {
  const p = tag.place
  const pick = (marks: ReadonlyArray<{ writer?: ModuleKey; source: ModuleKey }> | undefined) => (marks ?? []).find((m) => m.writer !== self)
  let hit: { writer?: ModuleKey; source: ModuleKey } | undefined
  if ('db' in p) hit = pick(oi.dbs.get(p.db)) ?? ix.dbs.get(p.db)?.under?.map((u) => pick(oi.pages.get(u))).find(Boolean)
  else if ('page' in p) hit = pick(oi.pages.get(p.page)) ?? (ix.input.pages[p.page]?.under ?? []).map((u) => pick(oi.pages.get(u))).find(Boolean)
  else if ('everything' in p) hit = [...oi.dbs.values(), ...oi.pages.values()].map(pick).find(Boolean)
  hit ??= 'external' in p || 'inbox' in p ? undefined : pick(oi.all)
  return hit ? (hit.writer ?? hit.source) : null
}

/**
 * The model with its chains (B3): `chains`, `loops`, net tags that read a place from outside marked (`tainted`, the
 * `writer` that made it so), and the write cables of processors fed from outside marked `tainted`. A new model — the
 * one passed in is not changed.
 */
export function withChains(model: Model, input: ModelInput): Model {
  const ix = reachIndex(model, input)
  const a = analyse(ix)
  const modules = model.modules.map((m) => {
    if (!m.nets.length) return m
    let changed = false
    const nets = m.nets.map((tag) => {
      const writer = taggedOutside(ix, a.outside, m.key, tag)
      if (!writer) return tag
      changed = true
      return { ...tag, tainted: true, writer }
    })
    return changed ? { ...m, nets } : m
  })
  const edges = model.edges.map((e) => {
    if (e.kind !== 'writes' || e.outside) return e
    const w = ix.jackMod.get(e.from)
    return w && a.fed.has(w) ? { ...e, tainted: true } : e
  })
  return { ...model, modules, edges, chains: a.chains, loops: a.loops }
}

/**
 * One step of the flow (the engines' rules applied, presses by hand left out): the modules a module's writes or starts
 * set going — `runScript`: the module is a script started by an automation's `run_script` (automations paused). For the
 * specs and the live signal (B13); builds its own index (not for a hot path).
 */
export function startsOf(model: Model, input: ModelInput, key: ModuleKey, opts: { runScript?: boolean } = {}): ModuleKey[] {
  const f = flowIndex(reachIndex(model, input))
  const node: Node = { key, kind: kindOf(f, key, opts.runScript ? 'start' : 'listen') }
  return [...new Set(movesOf(f, node).filter((m) => !m.byHand).map((m) => m.to.key))].sort()
}
