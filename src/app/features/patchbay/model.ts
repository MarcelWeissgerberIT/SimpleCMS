/**
 * buildModel(input) → the rack (plan §2.4) — pure, never stored. Modules in three columns (§ 01 sources · § 02
 * processing · § 03 targets), their jacks, the cables between them, net flags, bus chips, unknown parts — and the full
 * flow behind the drawing (`Model.flow`: every place each module may write, who starts on each place) for the chain
 * analysis, which never walks the drawn cables alone: chains.ts (B3) adds `chains` and `loops`, marks the net tags and
 * cables that carry content from outside (taint), and B4 decides the fuses from the chains' lamps.
 *
 * Sources: this device's MCP servers (READ · WRITE? · OUT jacks from tools.ts) and the runtime servers server agents
 * name ("on the server"); clocks (one per distinct agent schedule, one per repeating template — its new rows go to the
 * database's `+row` place); row triggers (one per listened place no drawn module writes — or rows from outside: mail);
 * buttons and own database commands (by hand); incoming hooks and server agents' webhook triggers (from outside); the
 * folder / GitHub sync; Clippings into the capture Inbox.
 * Processing: agents (whatever `enabled` says — a switched-off one runs by hand), automations (switched-off ones are
 * modules without cables), scripts used by several things or with effects (a script only one automation runs is folded
 * into it, §1.15), autofill with `auto`, mail organise, kit value relays someone listens to, pipelines, the bridge.
 * Targets: databases and pages written, "Whole workspace" (§1.19: one cable from an everything-scope writer), the
 * inbox (agent notes), outbound modules (dedupe: exit type + host + method), Outbox routes.
 *
 * Writes into a place someone listens to become a net-flag pair (`net:<db>:<prop | * | +row>`): the writer's cable
 * ends at the § 03 flag, the § 01 flag of the same name starts each listener — no cable across the rack. A field
 * nobody listens to gets no flag: the cable goes to the database. An everything-writer gets a flag for every listened
 * field (not for new rows: the "Whole workspace" cable stands for them; the flow keeps them). The engines' rules decide
 * who a write can start (§1.3): an agent never starts an agent, `set_property` / a script inside `run_script` never
 * start automations, autofill never starts autofill, a server agent's write (remote everywhere) starts only kit relays,
 * an agent's or the bridge's write never reaches a field "only by hand" (rules.ts). A stage-mode agent's writes are
 * proposals in the flow (`FlowWrite.proposal`, a gate for the chains).
 *
 * Dashed (`can`): the AI decides at run time — an agent's writes (its `mirrorOf` database excepted: the mirror writes
 * it on every run), the bridge, a pipeline's git action, a WRITE? cable. Hatched (`outside`): content from outside.
 * Cables from one jack to one column bundle from the 7th on into a "+n" bus chip (still counted).
 */
import { keyPart, moduleKey, scheduleKey } from './ref'
import { GIT_OUT, honoursHandOnly, placeKey, reaches, startable, unattendedGit, type WriterKind } from './rules'
import { withChains } from './chains'
import { withFuses, type FusedModel } from './fuses'
import { declaringProfiles, runtimeOut, toolGroups, toolUse, runtimeTools, type ToolGroups } from './tools'
import type { AgentTrigger, ID, IntegrationFeature } from '../../store/types'
import type {
  AgentInput,
  BusChip,
  Column,
  DatabaseInput,
  Edge,
  EdgeKind,
  ExitType,
  Flow,
  FlowListen,
  FlowWrite,
  Jack,
  JackRole,
  Model,
  ModelInput,
  Module,
  ModuleKey,
  ModuleKind,
  ModuleRef,
  ModuleTag,
  NetLabel,
  OpenTarget,
  Place,
  RowEvent,
  ScriptScan,
  ServerInput,
  UnknownPart,
} from './types'

/* ------------------------------------------------------------------ keys */

/** A place's key in the flow (rules.ts — re-exported: B5 / B6 read it from here). */
export { placeKey }

/** The net flag's key of a listened place (`net:<db>:<prop | * | +row>`). */
export const netKey = (db: ID, prop: string): string => `net:${keyPart(db)}:${prop === '*' || prop === '+row' || prop === '-row' ? prop : keyPart(prop)}`

/** A jack's key (`<module>.<role>`). */
export const jackKey = (module: ModuleKey, role: JackRole): string => `${module}.${role}`

/** Cables leaving one jack to one column bundle into a bus chip from this count on (§1.19). */
export const BUS_FROM = 7

const KIND_RANK: Record<ModuleKind, number> = {
  server: 0, clock: 1, button: 2, command: 3, incoming: 4, sync: 5, clippings: 6, rowTrigger: 7,
  agent: 0, automation: 1, script: 2, autofill: 3, organise: 4, kit: 5, pipeline: 6, bridge: 7,
  database: 0, page: 1, inbox: 2, everything: 3, outbound: 4, outbox: 5,
}

const COL: Record<ModuleKind, Column> = {
  server: 1, clock: 1, rowTrigger: 1, button: 1, command: 1, incoming: 1, sync: 1, clippings: 1,
  agent: 2, automation: 2, script: 2, autofill: 2, organise: 2, pipeline: 2, bridge: 2, kit: 2,
  database: 3, page: 3, inbox: 3, everything: 3, outbound: 3, outbox: 3,
}

/* ------------------------------------------------------------------ the builder */

interface Ctx {
  input: ModelInput
  mods: Map<ModuleKey, Module>
  seq: Map<ModuleKey, number>
  edges: Map<string, Edge>
  nets: Map<string, NetLabel>
  writes: Map<ModuleKey, FlowWrite[]>
  listens: Map<string, FlowListen[]>
  unknown: Map<string, UnknownPart>
  dbs: Map<ID, DatabaseInput>
  /** databases whose rows are mail (`system` 'mails' / 'mail-*', or this device's sync target) */
  mailDbs: Set<ID>
  /** autofill properties per database */
  autofillProps: Map<ID, Set<string>>
  /** fields "only by hand" per database (agents and the bridge never write them, §1.18) */
  handOnly: Map<ID, Set<string>>
  /** the listened places of each database: prop | '*' | '+row' | '-row' */
  listened: Map<ID, Set<string>>
  unlocked: Set<IntegrationFeature>
  scans: Map<ID, ScriptScan | null>
  groups: Map<string, ToolGroups>
  /** jack key → its module */
  jackOf: Map<string, { m: Module; j: Jack }>
}

function mod(c: Ctx, ref: ModuleRef, open: OpenTarget): Module {
  const key = moduleKey(ref)
  let m = c.mods.get(key)
  if (!m) {
    m = { key, kind: ref.kind, col: COL[ref.kind], u: 1, ref, tags: [], inJacks: [], outJacks: [], nets: [], idle: true, open }
    if (ref.kind === 'outbound') m.exit = ref.exit
    c.mods.set(key, m)
    c.seq.set(key, c.seq.size)
  }
  return m
}

function jack(c: Ctx, m: Module, side: 'in' | 'out', role: JackRole): Jack {
  const list = side === 'in' ? m.inJacks : m.outJacks
  let j = list.find((x) => x.role === role)
  if (!j) {
    j = { key: jackKey(m.key, role), module: m.key, side, role, plugged: false }
    list.push(j)
    c.jackOf.set(j.key, { m, j })
  }
  return j
}

function tag(m: Module, ...tags: ModuleTag[]): void {
  for (const t of tags) if (!m.tags.includes(t)) m.tags.push(t)
}

type EdgeAttrs = Partial<Pick<Edge, 'can' | 'outside' | 'byHand' | 'afterApproval' | 'asksFirst' | 'failClosed' | 'place'>>

function edge(c: Ctx, kind: EdgeKind, from: Jack | string, to: Jack | string, attrs: EdgeAttrs = {}): Edge {
  const f = typeof from === 'string' ? from : from.key
  const t = typeof to === 'string' ? to : to.key
  const id = `${f}>${t}`
  const had = c.edges.get(id)
  if (had) {
    // the same cable for two reasons: what one of them says holds (dashed wins, hatched wins, a person in between
    // only when both say so)
    if (attrs.can) had.can = true
    if (attrs.outside) had.outside = true
    if (attrs.failClosed) had.failClosed = true
    if (!attrs.byHand) delete had.byHand
    if (!attrs.asksFirst) delete had.asksFirst
    if (!attrs.afterApproval) delete had.afterApproval
    return had
  }
  const e: Edge = { id, kind, from: f, to: t }
  for (const k of ['can', 'outside', 'byHand', 'afterApproval', 'asksFirst', 'failClosed'] as const) if (attrs[k]) e[k] = true
  if (attrs.place) e.place = attrs.place
  c.edges.set(id, e)
  return e
}

const isLiveDb = (c: Ctx, id: ID | null | undefined): id is ID => !!id && c.dbs.has(id)
const isLivePage = (c: Ctx, id: ID | null | undefined): id is ID => {
  if (!id) return false
  const f = c.input.pages[id]
  return !!f && !f.gone && !f.inTemplate
}

const pageOpen = (id: ID): OpenTarget => ({ to: 'route', route: { name: 'page', id } })

function dbModule(c: Ctx, id: ID): Module {
  return mod(c, { kind: 'database', id }, pageOpen(id))
}
function pageModule(c: Ctx, id: ID): Module {
  return mod(c, { kind: 'page', id }, pageOpen(id))
}
function everything(c: Ctx): Module {
  return mod(c, { kind: 'everything' }, { to: 'none' })
}
function inboxModule(c: Ctx): Module {
  return mod(c, { kind: 'inbox' }, { to: 'route', route: { name: 'inbox' } })
}

/** An outbound module (dedupe: exit type + host + method); `by` names what holds it. */
function outbound(c: Ctx, exit: ExitType, host: string | null, method: string | null, by: Module): Module {
  const m = mod(c, { kind: 'outbound', exit, host, method, by: [] }, by.open)
  const ref = m.ref as Extract<ModuleRef, { kind: 'outbound' }>
  if (!ref.by.includes(by.key)) ref.by.push(by.key)
  return m
}

function addFlowWrite(c: Ctx, m: Module, w: FlowWrite): void {
  const list = c.writes.get(m.key) ?? []
  const k = placeKey(w.place)
  const had = list.find((x) => placeKey(x.place) === k)
  if (had) {
    if (w.can) had.can = true
    if (w.outside) had.outside = true
    if (!w.byHand) delete had.byHand
    if (!w.asksFirst) delete had.asksFirst
    if (!w.proposal) delete had.proposal
  } else list.push({ ...w })
  c.writes.set(m.key, list)
}

function listen(c: Ctx, db: ID, prop: string, l: FlowListen): void {
  const k = `${db}:${prop}`
  const list = c.listens.get(k) ?? []
  if (!list.some((x) => x.module === l.module && x.event === l.event)) list.push(l)
  c.listens.set(k, list)
  let set = c.listened.get(db)
  if (!set) c.listened.set(db, (set = new Set()))
  set.add(prop)
}

interface WriteHow {
  can?: boolean
  byHand?: boolean
  asksFirst?: boolean
  outside?: boolean
  /** a proposal the person applies (a stage-mode agent's scope writes) — the flow keeps it, a cable does not show it */
  proposal?: boolean
}

/** Only what holds (no `false` fields in the flow or on a cable). */
const howOf = (h: WriteHow): WriteHow => {
  const out: WriteHow = {}
  for (const k of ['can', 'byHand', 'asksFirst', 'outside', 'proposal'] as const) if (h[k]) out[k] = true
  return out
}

/** A cable's part of a write's how (a proposal is the flow's only). */
const cableOf = (h: WriteHow): EdgeAttrs => {
  const { proposal: _p, ...rest } = h
  void _p
  return rest
}

/**
 * A write into a database place: a net flag for every listened place it reaches (with a listener it can start), else
 * — or always with `alwaysDb` — a cable to the database. `fields`: flags for listened fields only (an everything-writer).
 */
function writeDb(c: Ctx, w: { m: Module; kind: WriterKind }, role: JackRole, db: ID, prop: string, given: WriteHow, opts: { alwaysDb?: boolean; fieldsOnly?: boolean; flagsOnly?: boolean } = {}): void {
  const how = howOf(given)
  addFlowWrite(c, w.m, { place: { db, prop: prop as '*' }, ...how })
  const listened = c.listened.get(db)
  let flagged = false
  if (listened) {
    const hand = honoursHandOnly(w.kind) ? c.handOnly.get(db) : undefined
    for (const lp of listened) {
      if (opts.fieldsOnly && (lp === '+row' || lp === '-row')) continue
      if (hand?.has(lp)) continue
      const ls = c.listens.get(`${db}:${lp}`) ?? []
      if (!ls.some((l) => startable({ kind: w.kind, key: w.m.key }, l) && reaches(prop, lp, l, c.autofillProps.get(db) ?? new Set()))) continue
      const nk = netKey(db, lp)
      let net = c.nets.get(nk)
      if (!net) c.nets.set(nk, (net = { key: nk, place: { db, prop: lp as '*' }, writers: [], listeners: [] }))
      const e = edge(c, 'writes', jack(c, w.m, 'out', role), nk, { ...cableOf(how), place: { db, prop: lp as '*' } })
      if (!net.writers.includes(e.id)) net.writers.push(e.id)
      flagged = true
    }
  }
  if (opts.fieldsOnly || opts.flagsOnly) return
  if (!flagged || opts.alwaysDb) edge(c, 'writes', jack(c, w.m, 'out', role), jack(c, dbModule(c, db), 'in', 'writes'), { ...cableOf(how), place: { db } })
}

/** A write into a place of any kind (a page id that is a database writes the database). */
function writePlace(c: Ctx, w: { m: Module; kind: WriterKind }, role: JackRole, place: Place, given: WriteHow): void {
  const how = howOf(given)
  if ('db' in place) {
    if (isLiveDb(c, place.db)) writeDb(c, w, role, place.db, place.prop ?? '*', how)
    return
  }
  if ('page' in place) {
    if (isLiveDb(c, place.page)) return writeDb(c, w, role, place.page, '*', how)
    if (!isLivePage(c, place.page)) return
    addFlowWrite(c, w.m, { place, ...how })
    edge(c, 'writes', jack(c, w.m, 'out', role), jack(c, pageModule(c, place.page), 'in', 'writes'), { ...cableOf(how), place })
    return
  }
  if ('everything' in place) {
    addFlowWrite(c, w.m, { place, ...how })
    edge(c, 'writes', jack(c, w.m, 'out', role), jack(c, everything(c), 'in', 'writes'), { ...cableOf(how), place })
    return
  }
  if ('inbox' in place) {
    addFlowWrite(c, w.m, { place, ...how })
    edge(c, 'writes', jack(c, w.m, 'out', role), jack(c, inboxModule(c), 'in', 'writes'), { ...cableOf(how), place })
  }
}

/** An everything-writer's field flags: every listened field of every live database. */
function writeAllFields(c: Ctx, w: { m: Module; kind: WriterKind }, how: WriteHow): void {
  for (const db of c.dbs.keys()) if (c.listened.has(db)) writeDb(c, w, 'writes', db, '*', how, { fieldsOnly: true })
}

/* ------------------------------------------------------------------ servers */

function serverGroups(c: Ctx, s: ServerInput): ToolGroups {
  const key = `l:${s.server.id}`
  let g = c.groups.get(key)
  if (!g) {
    const profiles = declaringProfiles(
      c.input.profiles.map((p) => p.profile),
      { name: s.server.name, url: s.server.url, tools: s.server.tools },
    )
    g = toolGroups(s.server.tools, s.out, profiles)
    c.groups.set(key, g)
  }
  return g
}

function serverModule(c: Ctx, s: ServerInput): Module {
  const m = mod(c, { kind: 'server', id: s.server.id, name: s.server.name }, { to: 'mcp', server: s.server.id })
  const g = serverGroups(c, s)
  jackCounts(c, m, g)
  for (const p of c.input.profiles) if (p.active && p.servers.includes(s.server.name)) markProfile(m, p.profile.id)
  return m
}

function jackCounts(c: Ctx, m: Module, g: ToolGroups): void {
  const read = jack(c, m, 'out', 'read')
  const write = jack(c, m, 'out', 'write')
  if (g.tested) {
    read.count = g.read.length
    write.count = g.write.length
    if (g.guessedRead) read.guessed = true
    if (g.guessedWrite) write.guessed = true
    const declared = Object.keys(g.declared)
    if (declared.length) write.declaredRead = declared
  } else {
    read.guessed = true
    write.guessed = true
  }
  if (g.out.length) jack(c, m, 'out', 'out').count = g.out.length
}

function markProfile(m: Module, id: string): void {
  tag(m, 'profile')
  if (!m.profile) m.profile = id
}

/** A runtime server (the team server's agents), by name; its tools as this device knows them. */
function runtimeModule(c: Ctx, name: string, host: string | null): { m: Module; g: ToolGroups } {
  const m = mod(c, { kind: 'server', id: null, name, runtime: true }, { to: 'none' })
  tag(m, 'server')
  const key = `r:${name}`
  let g = c.groups.get(key)
  if (!g) {
    // fix (model): a list only from this device's server at the same host (never a same-named one elsewhere — fail
    // closed, §6 A7), OUT from the profiles matching the runtime server's own name and host (as the team server matches)
    const local = c.input.servers.map((s) => ({ name: s.server.name, url: s.server.url, tools: s.server.tools }))
    const tools = runtimeTools({ name, host }, local)
    const profiles = c.input.profiles.map((p) => p.profile)
    const url = host ? `https://${host}/` : ''
    g = toolGroups(tools, runtimeOut(profiles, { name, host }), declaringProfiles(profiles, { name, url, tools: tools ?? undefined }))
    c.groups.set(key, g)
  }
  jackCounts(c, m, g)
  return { m, g }
}

/** Cable a processor to a server's READ / WRITE? jacks for the tools it may call. */
function attach(c: Ctx, proc: Module, server: Module, g: ToolGroups, allow: readonly string[] | undefined, profiles: ReturnType<typeof declaringProfiles>): void {
  const use = toolUse(g, allow, profiles)
  if (use.leftOut) return
  const tools = jack(c, proc, 'in', 'tools')
  if (use.read === null || use.read.length) edge(c, 'reads', jack(c, server, 'out', 'read'), tools)
  if (use.write === null || use.write.length) edge(c, 'out', jack(c, server, 'out', 'write'), tools, { can: true, ...(use.failClosed ? { failClosed: true } : {}) })
}

/** This device's servers with scope 'all' (autofill and every other non-free request get them — mail organise never). */
function attachAllServers(c: Ctx, proc: Module): void {
  for (const s of c.input.servers) {
    if (!s.server.enabled || s.server.scope !== 'all') continue
    const g = serverGroups(c, s)
    attach(c, proc, serverModule(c, s), g, undefined, [])
  }
}

/* ------------------------------------------------------------------ the parts */

function unknownPart(c: Ctx, what: UnknownPart['what'], module: ModuleKey, who?: string | null): void {
  const key = `${what}:${module}`
  if (!c.unknown.has(key)) c.unknown.set(key, { key, what, module, ...(who ? { who } : {}) })
}

const isMail = (c: Ctx, db: ID) => c.mailDbs.has(db)

/** The places an agent's trigger listens to (null: none — manual, schedule, webhook). */
function triggerPlace(t: AgentTrigger): { db: ID; prop: string; event: RowEvent } | null {
  if (t.type === 'row_created') return { db: t.databaseId, prop: '+row', event: 'created' }
  if (t.type === 'row_changed') return { db: t.databaseId, prop: t.propertyId ?? '*', event: 'changed' }
  return null
}

/** Listeners first (pass A): every place something starts on. */
function collectListeners(c: Ctx): void {
  const { input } = c
  for (const ai of input.agents) {
    const a = ai.agent
    if (!a.enabled) continue
    const tp = triggerPlace(a.trigger)
    if (tp && isLiveDb(c, tp.db)) listen(c, tp.db, tp.prop, { module: moduleKey({ kind: 'agent', id: a.id }), kind: 'agent', event: tp.event })
  }
  for (const db of input.databases) {
    for (const au of db.automations) {
      if (!au.enabled) continue
      const t = au.trigger
      const key = moduleKey({ kind: 'automation', db: db.id, id: au.id })
      if (t.type === 'row_created') listen(c, db.id, '+row', { module: key, kind: 'automation', event: 'created' })
      else if (t.type === 'row_deleted') listen(c, db.id, '-row', { module: key, kind: 'automation', event: 'deleted' })
      else if (t.type === 'property_changed') listen(c, db.id, t.propertyId ?? '*', { module: key, kind: 'automation', event: 'changed' })
    }
    const title = db.properties.find((p) => p.type === 'title')
    for (const p of db.properties) {
      const af = p.autofill
      if (!af?.auto) continue
      let set = c.autofillProps.get(db.id)
      if (!set) c.autofillProps.set(db.id, (set = new Set()))
      set.add(p.id)
      const src = af.preset === 'translate' ? (af.source === 'content' ? '*' : (af.source ?? title?.id ?? '*')) : '*'
      listen(c, db.id, src, { module: moduleKey({ kind: 'autofill', db: db.id, prop: p.id }), kind: 'autofill', event: 'changed' })
    }
  }
  const mail = input.mail
  if (mail?.organise && isLiveDb(c, mail.databaseId)) listen(c, mail.databaseId, '+row', { module: moduleKey({ kind: 'organise', db: mail.databaseId }), kind: 'organise', event: 'created' })
  // kit relays exist where someone else listens to their field (or to any field of their database)
  for (const k of input.kit) {
    if (!isLiveDb(c, k.db)) continue
    const others = [...(c.listens.get(`${k.db}:${k.prop}`) ?? []), ...(c.listens.get(`${k.db}:*`) ?? [])].filter((l) => l.kind !== 'kit')
    if (!others.length) continue
    listen(c, k.db, '*', { module: moduleKey({ kind: 'kit', db: k.db, prop: k.prop, type: k.type }), kind: 'kit', event: 'changed' })
  }
}

/** The databases (and pages) an agent's named scope covers: named live databases, live databases below named pages. */
function namedScope(c: Ctx, a: AgentInput['agent']): { dbs: ID[]; pages: ID[] } {
  const roots = new Set([...a.scope.pages, ...a.scope.databases])
  const dbs: ID[] = []
  for (const id of a.scope.databases) if (isLiveDb(c, id) && !dbs.includes(id)) dbs.push(id)
  for (const db of c.input.databases) if (!dbs.includes(db.id) && (db.under ?? []).some((u) => roots.has(u))) dbs.push(db.id)
  const pages = a.scope.pages.filter((id) => !isLiveDb(c, id) && isLivePage(c, id))
  return { dbs, pages }
}

function agents(c: Ctx): void {
  const { input } = c
  const notify = c.unlocked.has('notify')
  for (const ai of input.agents) {
    const a = ai.agent
    const m = mod(c, { kind: 'agent', id: a.id }, { to: 'route', route: { name: 'agents', id: a.id } })
    m.knobs = { model: a.model ?? null, budgetUsd: Number.isFinite(a.maxRunUsd) && a.maxRunUsd > 0 ? a.maxRunUsd : null }
    tag(m, ai.write === 'apply' ? 'direct' : ai.write === 'stage' ? 'stage' : 'readonly')
    const server = a.runner === 'server'
    if (server) tag(m, 'server')
    if (!a.enabled) tag(m, 'disabled', 'handRunOnly')
    if (ai.awaitsConfirm) tag(m, 'awaitsConfirm')
    if (ai.routeBlocked) {
      tag(m, 'blocked')
      m.blocked = 'route'
    } else if (ai.serverSkip) {
      // fix (model): the team server skips it with its reason (a Vorprüfer) — it never runs
      tag(m, 'blocked')
      m.blocked = 'server'
    }
    if (ai.unreadable.length) {
      tag(m, 'unknownHere')
      m.blocked = 'unreadable'
      unknownPart(c, 'unreadable', m.key)
    }
    const w = { m, kind: (server ? 'serverAgent' : 'agent') as WriterKind }

    // reads without a cable: the scope, the trigger's rows
    if (a.scope.everything) m.nets.push({ place: { everything: true } })
    else {
      const sc = namedScope(c, a)
      for (const db of sc.dbs) m.nets.push({ place: { db } })
      for (const page of sc.pages) m.nets.push({ place: { page } })
    }
    const tp = triggerPlace(a.trigger)
    if (tp && isLiveDb(c, tp.db) && !m.nets.some((n) => 'db' in n.place && n.place.db === tp.db)) m.nets.push({ place: { db: tp.db } })

    // MCP servers: a browser agent's on its creator's device, a server agent's in the runtime
    if (a.mcpServers.length) {
      if (server) {
        const rt = input.runtime
        if (rt === 'forbidden') unknownPart(c, 'runtime', m.key)
        else if (rt === null) unknownPart(c, 'lazy', m.key)
        else
          for (const name of a.mcpServers) {
            const known = rt.find((r) => r.name === name)
            if (!known) {
              // fix (model): a list from the lazy cache may be days old — a server added since is an unknown part (§1.2),
              // never "the runtime has none"; a list read in this session says the server skips it
              if (!input.runtimeFresh) unknownPart(c, 'lazy', m.key)
              continue
            }
            const { m: sm, g } = runtimeModule(c, name, known.host)
            const profiles = declaringProfiles(input.profiles.map((p) => p.profile), { name, url: known.host ? `https://${known.host}/` : '' })
            attach(c, m, sm, g, a.mcpTools?.[name], profiles)
          }
      } else if (!ai.creatorHere) {
        tag(m, 'unknownHere')
        if (!m.blocked) m.blocked = 'notHere'
        unknownPart(c, 'otherBrowser', m.key, a.createdBy ?? null)
      } else
        for (const name of a.mcpServers) {
          const s = input.servers.find((x) => x.server.name === name)
          // fix (model): not set up on this device — in a team the agent runs in every browser of its creator, another
          // one may have it (an unknown part, never "nothing"); locally the agent runs here only: left out
          if (!s) {
            if (input.ctx.team && a.mcpTools?.[name]?.length !== 0) unknownPart(c, 'elsewhere', m.key)
            continue
          }
          // a server switched off on this device is left out of its runs here (fuses.ts names it: closed on this device)
          if (!s.server.enabled) continue
          const sm = serverModule(c, s)
          const g = serverGroups(c, s)
          const profiles = declaringProfiles(input.profiles.map((p) => p.profile), { name: s.server.name, url: s.server.url, tools: s.server.tools })
          attach(c, m, sm, g, a.mcpTools?.[name], profiles)
          for (const p of input.profiles) if (p.active && p.servers.includes(name)) markProfile(m, p.profile.id)
        }
    }

    // writes: the AI decides where (dashed) — a mirror writes its own database on every run; a stage-mode agent's
    // writes are proposals the person applies (the flow says so: a gate for the chains, §2.5)
    if (ai.write !== 'none') {
      const proposal = ai.write === 'stage'
      if (a.scope.everything) {
        const e = jack(c, m, 'out', 'everything')
        e.count = input.databases.length
        writePlace(c, w, 'everything', { everything: true }, { can: true, proposal })
        writeAllFields(c, w, { can: true, proposal })
      } else {
        const sc = namedScope(c, a)
        for (const db of sc.dbs) {
          writeDb(c, w, 'writes', db, '*', { can: db !== a.mirrorOf, proposal }, { alwaysDb: true })
          writeDb(c, w, 'writes', db, '+row', { can: db !== a.mirrorOf, proposal }, {})
          if (a.mirrorOf === db) for (const p of input.profiles) if (p.active && m.profile === p.profile.id) markProfile(dbModule(c, db), p.profile.id)
        }
        for (const page of sc.pages) writePlace(c, w, 'writes', { page }, { can: true, proposal })
      }
    }
    // the report page (every write mode: the run's answer goes there)
    if (a.output?.pageId && isLivePage(c, a.output.pageId)) writePlace(c, w, 'report', { page: a.output.pageId }, {})
    // notes for the person's inbox: notify_me — browser agents, while a profile unlocks it, when the job names it
    if (!server && notify && /\bnotify_me\b/.test(a.instructions)) writePlace(c, w, 'notes', { inbox: true }, {})

    // a server agent's webhook trigger: the delivery body goes into its task verbatim — from outside (§6 A2)
    if (server && a.trigger.type === 'webhook') {
      const src = mod(c, { kind: 'incoming', hook: null, db: null, agent: a.id }, { to: 'route', route: { name: 'agents', id: a.id } })
      tag(src, 'outside', 'server')
      edge(c, 'starts', jack(c, src, 'out', 'start'), jack(c, m, 'in', 'start'), { outside: true })
    }
  }
}

/** How often each script is used, and by what. */
function scriptUses(c: Ctx): Map<ID, { automations: ModuleKey[]; other: number }> {
  const uses = new Map<ID, { automations: ModuleKey[]; other: number }>()
  const use = (id: ID | null | undefined, automation?: ModuleKey) => {
    if (!id) return
    const u = uses.get(id) ?? { automations: [], other: 0 }
    if (automation) u.automations.push(automation)
    else u.other++
    uses.set(id, u)
  }
  for (const db of c.input.databases) {
    for (const au of db.automations) if (au.enabled) for (const act of au.actions) if (act.type === 'run_script') use(act.scriptId, moduleKey({ kind: 'automation', db: db.id, id: au.id }))
    for (const cmd of db.commands) {
      if (cmd.kind === 'script') use(typeof cmd.config?.scriptId === 'string' ? cmd.config.scriptId : null)
      if (cmd.kind === 'actions' && Array.isArray(cmd.config?.actions)) for (const act of cmd.config.actions as Array<{ type?: unknown; scriptId?: unknown }>) if (act?.type === 'run_script' && typeof act.scriptId === 'string') use(act.scriptId)
    }
  }
  for (const b of c.input.buttons ?? []) for (const act of b.actions) if (act.type === 'run_script') use(act.scriptId)
  return uses
}

const scanOf = (c: Ctx, id: ID): ScriptScan | null => c.scans.get(id) ?? null

/** A script's ways out from its effects (asked once per run: never unattended). */
function scriptExits(c: Ctx, from: Module, scan: ScriptScan | null): void {
  if (!scan) return
  if (scan.effects.includes('http')) edge(c, 'out', jack(c, from, 'out', 'out'), jack(c, outbound(c, 'http', null, 'POST', from), 'in', 'out'), { asksFirst: true })
  if (scan.effects.includes('mail')) edge(c, 'out', jack(c, from, 'out', 'out'), jack(c, outbound(c, 'mail', null, null, from), 'in', 'out'), { asksFirst: true })
}

function automations(c: Ctx, folded: Map<ID, ModuleKey>): void {
  for (const db of c.input.databases) {
    for (const au of db.automations) {
      const m = mod(c, { kind: 'automation', db: db.id, id: au.id }, { to: 'modal', modal: 'automations', databaseId: db.id })
      if (!au.enabled) {
        tag(m, 'disabled')
        continue
      }
      for (const act of au.actions) {
        if (act.type === 'webhook') {
          const host = hostOf(act.url)
          edge(c, 'out', jack(c, m, 'out', 'out'), jack(c, outbound(c, 'webhook', host, act.method === 'PUT' ? 'PUT' : 'POST', m), 'in', 'out'))
        } else if (act.type === 'set_property') {
          // the triggering row only, in its own database; never starts automations (applyingAction)
          if (act.propertyId) writeDb(c, { m, kind: 'automation' }, 'writes', db.id, act.propertyId, {})
        } else if (act.type === 'run_script' && act.scriptId) {
          if (folded.get(act.scriptId) === m.key) {
            m.folds = { script: act.scriptId }
            const scan = scanOf(c, act.scriptId)
            if (!scan) unknownPart(c, 'lazy', m.key)
            // fix (model): places named by name — what it reads or writes is not known here (§1.17, §1.21)
            else if (scan.byName) unknownPart(c, 'byName', m.key)
            for (const p of scan?.writes ?? []) writePlace(c, { m, kind: 'autoScript' }, 'writes', p, {})
            if (scan?.context) writeDb(c, { m, kind: 'autoScript' }, 'writes', db.id, '*', {})
            scriptExits(c, m, scan)
          } else {
            const sm = mod(c, { kind: 'script', id: act.scriptId }, { to: 'route', route: { name: 'scripts', id: act.scriptId } })
            edge(c, 'starts', jack(c, m, 'out', 'out'), jack(c, sm, 'in', 'start'))
          }
        }
      }
    }
  }
}

/** Script modules: their writes (the scan; `context` = their callers' places) and effects. */
function scripts(c: Ctx, folded: Map<ID, ModuleKey>): void {
  for (const s of c.input.scripts) {
    if (folded.has(s.script.id)) continue
    const m = mod(c, { kind: 'script', id: s.script.id }, { to: 'route', route: { name: 'scripts', id: s.script.id } })
    const scan = scanOf(c, s.script.id)
    // B4: a script not scanned here (nor in the lazy cache at its version) may copy content from outside anywhere —
    // used by something or run by hand from its page: an unknown part, never "nothing" (§1.21)
    if (!scan) unknownPart(c, 'lazy', m.key)
    if (!scan) continue
    // fix (model): places named by name — what it reads or writes is not known here (§1.17, §1.21)
    if (scan.byName) unknownPart(c, 'byName', m.key)
    for (const p of scan.reads) {
      if ('page' in p && isLiveDb(c, p.page)) m.nets.push({ place: { db: p.page } })
      else if ('page' in p && isLivePage(c, p.page)) m.nets.push({ place: p })
    }
    const w = { m, kind: 'script' as WriterKind }
    for (const p of scan.writes) writePlace(c, w, 'writes', p, {})
    scriptExits(c, m, scan)
  }
}

/** The context places of non-folded scripts: each caller's own (an automation's database, a button's page …). */
function scriptContexts(c: Ctx, callers: Array<{ script: ID; place: Place; byHand?: boolean; kind: WriterKind }>): void {
  for (const call of callers) {
    const scan = scanOf(c, call.script)
    if (!scan?.context) continue
    const m = c.mods.get(moduleKey({ kind: 'script', id: call.script }))
    if (!m) continue
    writePlace(c, { m, kind: call.kind }, 'writes', call.place, call.byHand ? { byHand: true } : {})
  }
}

function autofill(c: Ctx): void {
  for (const db of c.input.databases)
    for (const p of db.properties) {
      if (!p.autofill?.auto) continue
      const m = mod(c, { kind: 'autofill', db: db.id, prop: p.id }, { to: 'autofill', db: db.id, prop: p.id })
      // B4: an automatic fill writes straight into the cell whatever "Apply without review" says (watch.ts writes every
      // answer) — that switch is about runs a person starts
      tag(m, 'direct', 'thisDevice')
      m.nets.push({ place: { db: db.id } })
      writeDb(c, { m, kind: 'autofill' }, 'writes', db.id, p.id, {})
      attachAllServers(c, m)
    }
}

function organise(c: Ctx): void {
  const mail = c.input.mail
  if (!mail?.organise || !isLiveDb(c, mail.databaseId)) return
  const m = mod(c, { kind: 'organise', db: mail.databaseId }, { to: 'settings', tab: 'mail' })
  tag(m, 'direct', 'thisDevice')
  m.nets.push({ place: { db: mail.databaseId } })
  if (isLiveDb(c, mail.relationDb)) m.nets.push({ place: { db: mail.relationDb } })
  for (const prop of mail.organiseProps ?? []) writeDb(c, { m, kind: 'organise' }, 'writes', mail.databaseId, prop, {})
  // B4: no MCP server ever joins an organise request (mail/organise.ts `mcp: false`)
}

function kits(c: Ctx): void {
  for (const k of c.input.kit) {
    const key = moduleKey({ kind: 'kit', db: k.db, prop: k.prop, type: k.type })
    if (!(c.listens.get(`${k.db}:*`) ?? []).some((l) => l.module === key)) continue
    const m = mod(c, { kind: 'kit', db: k.db, prop: k.prop, type: k.type }, { to: 'route', route: { name: 'kit', tab: 'types', id: k.type } })
    writeDb(c, { m, kind: 'kit' }, 'writes', k.db, k.prop, {})
  }
}

function pipelines(c: Ctx): void {
  const { input } = c
  for (const p of input.pipelines) {
    const m = mod(c, { kind: 'pipeline', db: p.db, pipeline: p.kind }, { to: 'route', route: p.kind === 'coding' ? { name: 'coding' } : { name: 'coding', kind: p.kind } })
    m.nets.push({ place: { db: p.db } })
    // fix (model): a person in between per git stage — a gate this device's approvals stop at between where a task
    // enters and the stage (rules.ts unattendedGit, coding/tasks.ts skipsGate); who wrote the task (Confirm) is the
    // chains' part. One edge per action: nobody in front of any stage of it = nobody in front of the action.
    const free = unattendedGit(p.stages, input.worker.approvals)
    for (const st of p.stages) {
      if (st.kind !== 'git' || !st.gitAction || !GIT_OUT.has(st.gitAction)) continue
      edge(c, 'out', jack(c, m, 'out', 'out'), jack(c, outbound(c, 'git', null, st.gitAction, m), 'in', 'out'), { can: true, ...(free.has(st.gitAction) ? {} : { afterApproval: true }) })
    }
    // fix (model): the worker writes the task row in its tab (coding/tasks.ts finishStage: Stage moves, plan and
    // summary into the page, cost / branch / PR fields) and a 'testcases' doc stage new rows of the Test cases
    // database — automations, agents' row triggers and autofill start on them. Flow first; a cable only where a
    // listener starts (net flags), so the drawing keeps one cable per job.
    if (!p.stages.length) continue
    const w = { m, kind: 'pipeline' as WriterKind }
    writeDb(c, w, 'writes', p.db, '*', {}, { flagsOnly: true })
    if (p.stages.some((st) => st.kind === 'doc' && st.output === 'testcases'))
      for (const db of input.databases) if (db.system === 'testcases') writeDb(c, w, 'writes', db.id, '+row', {}, { flagsOnly: true })
  }
}

function bridge(c: Ctx): void {
  const b = c.input.bridge
  if (!b.enabled) return
  const m = mod(c, { kind: 'bridge' }, { to: 'settings', tab: 'mcp' })
  tag(m, 'thisDevice', b.mode === 'apply' ? 'direct' : b.mode === 'ask' ? 'asksFirst' : 'readonly')
  m.nets.push({ place: { everything: true } })
  if (b.mode === 'read') return
  const how: WriteHow = { can: true, ...(b.mode === 'ask' ? { asksFirst: true } : {}) }
  const w = { m, kind: 'bridge' as WriterKind }
  jack(c, m, 'out', 'everything').count = c.input.databases.length
  writePlace(c, w, 'everything', { everything: true }, how)
  writeAllFields(c, w, how)
}

/** Repeating templates: a clock per template, its new rows into the database's `+row` place. */
function templateClocks(c: Ctx): void {
  for (const db of c.input.databases)
    for (const r of db.repeating) {
      const m = mod(c, { kind: 'clock', schedule: r.every, agents: [], template: { db: db.id, id: r.id } }, { to: 'templates', db: db.id })
      writeDb(c, { m, kind: 'clock' }, 'start', db.id, '+row', {})
    }
}

type Call = { script: ID; place: Place; byHand?: boolean; kind: WriterKind }

/** Buttons (pressed by a person): a script, a webhook, a new row. */
function buttons(c: Ctx, calls: Call[]): void {
  for (const b of c.input.buttons ?? []) {
    if (!isLivePage(c, b.page)) continue
    const m = mod(c, { kind: 'button', page: b.page, block: b.block }, pageOpen(b.page))
    tag(m, 'byHand')
    wireActions(c, m, b.actions, { page: b.page }, calls)
  }
}

function wireActions(c: Ctx, m: Module, actions: Array<{ type: 'run_script'; scriptId: ID | null } | { type: 'webhook'; host: string | null; method: string } | { type: 'add_page'; target: ID | null }>, context: Place, calls: Call[]): void {
  for (const act of actions) {
    if (act.type === 'run_script' && act.scriptId && c.input.scripts.some((s) => s.script.id === act.scriptId)) {
      const sm = mod(c, { kind: 'script', id: act.scriptId }, { to: 'route', route: { name: 'scripts', id: act.scriptId } })
      edge(c, 'starts', jack(c, m, 'out', 'start'), jack(c, sm, 'in', 'start'), { byHand: true })
      calls.push({ script: act.scriptId, place: context, byHand: true, kind: 'script' })
    } else if (act.type === 'webhook') {
      edge(c, 'out', jack(c, m, 'out', 'out'), jack(c, outbound(c, 'webhook', act.host, act.method, m), 'in', 'out'), { byHand: true })
    } else if (act.type === 'add_page' && isLiveDb(c, act.target)) {
      writeDb(c, { m, kind: m.kind === 'button' ? 'button' : 'command' }, 'start', act.target, '+row', { byHand: true })
    }
  }
}

/** Own database commands (by hand) and the Outbox's send routes. */
function commands(c: Ctx, calls: Call[]): void {
  for (const db of c.input.databases) {
    for (const cmd of db.commands) {
      const open: OpenTarget = { to: 'modal', modal: 'dbCommands', databaseId: db.id }
      const cfg = cmd.config ?? {}
      if (cmd.kind === 'agent' && typeof cfg.agentId === 'string' && c.input.agents.some((a) => a.agent.id === cfg.agentId)) {
        const m = mod(c, { kind: 'command', db: db.id, command: cmd.id }, open)
        tag(m, 'byHand')
        const am = c.mods.get(moduleKey({ kind: 'agent', id: cfg.agentId }))
        if (am) edge(c, 'starts', jack(c, m, 'out', 'start'), jack(c, am, 'in', 'start'), { byHand: true })
      } else if (cmd.kind === 'script' && typeof cfg.scriptId === 'string' && c.input.scripts.some((s) => s.script.id === cfg.scriptId)) {
        const m = mod(c, { kind: 'command', db: db.id, command: cmd.id }, open)
        tag(m, 'byHand')
        const sm = mod(c, { kind: 'script', id: cfg.scriptId }, { to: 'route', route: { name: 'scripts', id: cfg.scriptId } })
        edge(c, 'starts', jack(c, m, 'out', 'start'), jack(c, sm, 'in', 'start'), { byHand: true })
        calls.push({ script: cfg.scriptId, place: { db: db.id, prop: '*' }, byHand: true, kind: 'command' })
      } else if (cmd.kind === 'actions' && Array.isArray(cfg.actions)) {
        const actions = commandActions(cfg.actions)
        if (!actions.length) continue
        const m = mod(c, { kind: 'command', db: db.id, command: cmd.id }, open)
        tag(m, 'byHand')
        wireActions(c, m, actions, { db: db.id, prop: '*' }, calls)
      }
    }
    for (const s of db.sends) {
      const cm = mod(c, { kind: 'command', db: db.id, command: `send:${s.profile}:${s.route}` }, { to: 'modal', modal: 'dbCommands', databaseId: db.id })
      tag(cm, 'byHand')
      const om = mod(c, { kind: 'outbox', profile: s.profile, route: s.route, db: db.id }, { to: 'route', route: { name: 'outbox' } })
      tag(om, 'byHand')
      if (s.server && !om.nets.length) om.nets.push({ place: { external: s.server } })
      edge(c, 'out', jack(c, cm, 'out', 'send'), jack(c, om, 'in', 'send'), { byHand: true })
    }
  }
}

/** A command's ButtonAction list → the actions that wire something (as the button index reads them). */
function commandActions(raw: unknown[]): Array<{ type: 'run_script'; scriptId: ID | null } | { type: 'webhook'; host: string | null; method: string } | { type: 'add_page'; target: ID | null }> {
  const out: Array<{ type: 'run_script'; scriptId: ID | null } | { type: 'webhook'; host: string | null; method: string } | { type: 'add_page'; target: ID | null }> = []
  for (const a of raw as Array<Record<string, unknown>>) {
    if (!a || typeof a !== 'object') continue
    if (a.type === 'run_script') out.push({ type: 'run_script', scriptId: typeof a.scriptId === 'string' ? a.scriptId : null })
    else if (a.type === 'webhook') out.push({ type: 'webhook', host: hostOf(a.url), method: a.method === 'PUT' ? 'PUT' : 'POST' })
    else if (a.type === 'add_page') out.push({ type: 'add_page', target: typeof a.databaseId === 'string' ? a.databaseId : null })
  }
  return out
}

/** Team incoming webhooks / API tokens (read on open, owners / admins) — rows from outside. */
function incoming(c: Ctx): void {
  const { input } = c
  if (!input.ctx.team) return
  const any = moduleKey({ kind: 'incoming', hook: null, db: null, agent: null })
  const hooks = input.hooks ?? input.lazy?.hooks ?? null
  if (hooks === 'forbidden') unknownPart(c, 'hooks', any)
  else if (hooks === null) unknownPart(c, 'lazy', any)
  else
    for (const h of hooks) {
      if (!isLiveDb(c, h.db)) continue
      const m = mod(c, { kind: 'incoming', hook: h.id, db: h.db, agent: null }, { to: 'route', route: { name: 'workspace', section: 'automation' } })
      tag(m, 'outside')
      writeDb(c, { m, kind: 'incoming' }, 'start', h.db, '+row', { outside: true })
    }
  // fix (model): API tokens with write scope create and change rows and pages anywhere in the shared workspace (and
  // drive the team /mcp endpoint) — content from outside everywhere (reach.ts startingOutside: `all`); not read yet:
  // an unknown part, never "none"
  const tokens = input.tokens ?? input.lazy?.tokens ?? null
  if (tokens === 'forbidden') unknownPart(c, 'hooks', any)
  else if (tokens === null) unknownPart(c, 'lazy', any)
  else
    for (const t of tokens) {
      if (!t.write) continue
      const m = mod(c, { kind: 'incoming', hook: `api:${t.id}`, db: null, agent: null }, { to: 'route', route: { name: 'workspace', section: 'automation' } })
      tag(m, 'outside')
      writePlace(c, { m, kind: 'incoming' }, 'writes', { everything: true }, { outside: true })
    }
}

/** This device's folder / GitHub sync: pick-ups (GitHub's from outside) and the GitHub push (a way out). */
function sync(c: Ctx): void {
  const { sync: s } = c.input
  if (s.github.configured) {
    const m = mod(c, { kind: 'sync', source: 'github' }, { to: 'settings', tab: 'sync' })
    tag(m, 'outside', 'thisDevice')
    writePlace(c, { m, kind: 'sync' }, 'writes', { everything: true }, { outside: true })
    if (s.github.auto) edge(c, 'out', jack(c, m, 'out', 'out'), jack(c, outbound(c, 'sync', s.github.repo, 'push', m), 'in', 'out'))
  }
  if (s.folder.configured) {
    const m = mod(c, { kind: 'sync', source: 'folder' }, { to: 'settings', tab: 'sync' })
    tag(m, 'thisDevice')
    writePlace(c, { m, kind: 'sync' }, 'writes', { everything: true }, {})
  }
}

/** Clippings: web pages shared or clipped into the capture Inbox — from outside. */
function clippings(c: Ctx): void {
  const inbox = c.input.inbox ?? c.input.lazy?.inbox ?? null
  // B4: the Inbox lookup never ran here (no reading, no cache): Clippings may exist — an unknown part where something
  // could read them (an everything scope, a scope page, the bridge), never "nothing" (§1.21)
  if (!inbox && !c.input.inboxRead && !c.input.lazy?.inboxRead) {
    const reader = c.input.agents.some((a) => a.agent.scope.everything || a.agent.scope.pages.length) || (c.input.bridge.enabled && c.input.bridge.mode !== 'read')
    if (reader) unknownPart(c, 'lazy', moduleKey({ kind: 'clippings', inbox: '' }))
    return
  }
  if (!inbox || !isLivePage(c, inbox)) return
  const m = mod(c, { kind: 'clippings', inbox }, pageOpen(inbox))
  tag(m, 'outside')
  writePlace(c, { m, kind: 'clippings' }, 'writes', { page: inbox }, { outside: true })
}

/** Pass C: every listened place — flag → listeners where something writes it, else a row trigger (and mail rows). */
function listenerSide(c: Ctx): void {
  for (const [k, ls] of c.listens) {
    const cut = k.lastIndexOf(':')
    const db = k.slice(0, cut)
    const prop = k.slice(cut + 1)
    const net = c.nets.get(netKey(db, prop))
    const mail = isMail(c, db)
    const start = (from: Jack | string, outside: boolean) => {
      for (const l of ls) {
        const lm = c.mods.get(l.module)
        if (!lm) continue
        // mail organise starts from the mail sync only (rules.ts): never from a module's write
        if (l.kind === 'organise' && typeof from === 'string') continue
        const e = edge(c, l.kind === 'kit' ? 'relay' : 'starts', from, jack(c, lm, 'in', 'start'), outside ? { outside: true } : {})
        if (typeof from === 'string' && net && !net.listeners.includes(e.id)) net.listeners.push(e.id)
      }
    }
    if (net?.writers.length) start(net.key, false)
    // nothing drawn writes it (a person's edit, a sync) — or mail rows arrive from outside: a row trigger
    if (!net?.writers.length || (mail && prop === '+row')) {
      const event: RowEvent = prop === '+row' ? 'created' : prop === '-row' ? 'deleted' : 'changed'
      const m = mod(c, { kind: 'rowTrigger', db, event, prop: event === 'changed' ? prop : null }, pageOpen(db))
      if (mail) tag(m, 'outside')
      start(jack(c, m, 'out', 'start'), mail)
    }
  }
}

/** Clocks of agent schedules (enabled agents): one per distinct schedule. */
function agentClocks(c: Ctx): void {
  const groups = new Map<string, ID[]>()
  for (const ai of c.input.agents) {
    const t = ai.agent.trigger
    if (!ai.agent.enabled || t.type !== 'schedule') continue
    const k = scheduleKey(t)
    groups.set(k, [...(groups.get(k) ?? []), ai.agent.id])
  }
  for (const [schedule, ids] of groups) {
    const m = mod(c, { kind: 'clock', schedule, agents: ids }, { to: 'route', route: { name: 'agents', id: ids[0] } })
    for (const id of ids) {
      const am = c.mods.get(moduleKey({ kind: 'agent', id }))
      if (am) edge(c, 'starts', jack(c, m, 'out', 'start'), jack(c, am, 'in', 'start'))
    }
  }
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url.trim()).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Finish: plugged jacks, idle modules, 2U, outbound tags, bus chips, counts. */
function finish(c: Ctx): Model {
  for (const e of c.edges.values())
    for (const k of [e.from, e.to]) {
      const hit = c.jackOf.get(k)
      if (!hit) continue
      hit.j.plugged = true
      hit.m.idle = false
    }
  const into = new Map<ModuleKey, Edge[]>()
  for (const e of c.edges.values()) {
    const m = c.jackOf.get(e.to)?.m
    if (m) into.set(m.key, [...(into.get(m.key) ?? []), e])
  }
  for (const m of c.mods.values()) {
    if (m.kind === 'agent' && (m.inJacks.length >= 3 || m.outJacks.length >= 3)) m.u = 2
    if (m.kind === 'outbound' || m.kind === 'outbox') {
      // who stands in between: nobody on any cable → outbound; else what every cable says
      const cables = into.get(m.key) ?? []
      if (cables.some((e) => !e.byHand && !e.afterApproval && !e.asksFirst)) tag(m, 'outbound')
      else {
        if (cables.some((e) => e.byHand)) tag(m, 'byHand')
        if (cables.some((e) => e.afterApproval)) tag(m, 'afterApproval')
        if (cables.some((e) => e.asksFirst)) tag(m, 'asksFirst')
      }
    }
  }
  const modules = [...c.mods.values()].sort((a, b) => a.col - b.col || KIND_RANK[a.kind] - KIND_RANK[b.kind] || c.seq.get(a.key)! - c.seq.get(b.key)!)
  const edges = [...c.edges.values()]

  // bus chips: from the 7th cable leaving one jack into one column (§1.19)
  const colOf = (k: string): Column | null => (k.startsWith('net:') ? 3 : (c.jackOf.get(k)?.m.col ?? null))
  const byJack = new Map<string, Edge[]>()
  for (const e of edges) {
    if (!c.jackOf.has(e.from)) continue
    const col = colOf(e.to)
    if (col === null) continue
    const k = `${e.from}|${col}`
    byJack.set(k, [...(byJack.get(k) ?? []), e])
  }
  const buses: BusChip[] = []
  for (const [k, list] of byJack) {
    if (list.length < BUS_FROM) continue
    const [jackKey, col] = k.split('|')
    const id = `bus:${jackKey}:${col}`
    const bundled = list.slice(BUS_FROM - 1)
    for (const e of bundled) e.bundle = id
    buses.push({ id, jack: jackKey, col: Number(col) as Column, edges: bundled.map((e) => e.id) })
  }

  const flow: Flow = { writes: Object.fromEntries(c.writes), listens: Object.fromEntries(c.listens) }
  return {
    modules,
    edges,
    nets: [...c.nets.values()],
    buses,
    chains: [],
    fuses: [],
    unknown: [...c.unknown.values()],
    nearMisses: [],
    // "MODULES 17 · 3 idle": the drawn modules, and the idle ones folded beside them (modules.length = both)
    counts: {
      modules: modules.filter((m) => !m.idle).length,
      idle: modules.filter((m) => m.idle).length,
      cables: edges.length,
      dashed: edges.filter((e) => e.can).length,
      planned: edges.filter((e) => e.planned).length,
      ghosts: modules.filter((m) => m.tags.includes('ghost')).length,
    },
    flow,
  }
}

/** The rack of a model input with its chains and fuses (pure, deterministic). */
export function buildModel(input: ModelInput): FusedModel {
  const c: Ctx = {
    input,
    mods: new Map(),
    seq: new Map(),
    edges: new Map(),
    nets: new Map(),
    writes: new Map(),
    listens: new Map(),
    unknown: new Map(),
    dbs: new Map(input.databases.map((d) => [d.id, d])),
    mailDbs: new Set(input.databases.filter((d) => d.system === 'mails' || (d.system ?? '').startsWith('mail-') || d.id === input.mail?.databaseId).map((d) => d.id)),
    autofillProps: new Map(),
    handOnly: new Map(input.databases.map((d) => [d.id, new Set(d.properties.filter((p) => p.agentReadOnly).map((p) => p.id))])),
    listened: new Map(),
    unlocked: new Set(input.profiles.filter((p) => p.active).flatMap((p) => p.profile.unlocks)),
    scans: new Map(),
    groups: new Map(),
    jackOf: new Map(),
  }
  // a script's scan: read here, else the lazy cache's when it is of the same version
  for (const s of input.scripts) {
    const cached = input.lazy?.scripts?.[s.script.id]
    c.scans.set(s.script.id, s.scan ?? (cached && cached.at === s.script.updatedAt ? cached : null))
  }

  // every server this device knows is on the rack (unwired ones fold as idle)
  for (const s of input.servers) serverModule(c, s)

  collectListeners(c)

  const uses = scriptUses(c)
  const folded = new Map<ID, ModuleKey>()
  for (const s of input.scripts) {
    const u = uses.get(s.script.id)
    const scan = c.scans.get(s.script.id) ?? null
    if (u && u.other === 0 && u.automations.length === 1 && (!scan || !scan.effects.length)) folded.set(s.script.id, u.automations[0])
  }

  agents(c)
  automations(c, folded)
  const calls: Call[] = []
  for (const db of input.databases)
    for (const au of db.automations)
      if (au.enabled) for (const act of au.actions) if (act.type === 'run_script' && act.scriptId && !folded.has(act.scriptId)) calls.push({ script: act.scriptId, place: { db: db.id, prop: '*' }, kind: 'autoScript' })
  buttons(c, calls)
  commands(c, calls)
  scripts(c, folded)
  scriptContexts(c, calls)
  autofill(c)
  organise(c)
  kits(c)
  pipelines(c)
  bridge(c)
  templateClocks(c)
  incoming(c)
  sync(c)
  clippings(c)

  listenerSide(c)
  agentClocks(c)
  // the chains behind the rack: full reachability, taint, gates, loops (chains.ts, B3); the fuses, near misses and
  // unknown parts they make, with each fuse's signature and allowance (fuses.ts, sig.ts, B4)
  return withFuses(withChains(finish(c), input), input)
}
