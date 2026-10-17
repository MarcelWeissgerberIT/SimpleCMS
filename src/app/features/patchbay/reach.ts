/**
 * What a decider reaches (plan §1.3, §2.5 / §2.6) — pure, ids only. chains.ts walks the flow; this module answers, per
 * decider and per path, the three questions a fuse is made of:
 *
 *  - **Who decides** (§1.3 #1): a custom agent (browser or server, whatever `enabled` says — a switched-off one runs by
 *    hand; route-blocked or Unreadable ones are not deciders: blocked, or an unknown part the model already names), AI
 *    autofill with `auto` — and without it while a fill a person starts can take a path ("All AI calls" servers, "Apply
 *    without review"; runs only by hand) —, mail "Organise with Claude", the local MCP bridge in 'apply' (in 'ask' its
 *    writes are asked).
 *  - **Content from outside** (§1.3 #2): mail-class rows (the AI core's `classOfPage` rule: `system` 'mails' / 'mail-*'
 *    or this device's sync target), MCP read results (a server whose tool list is unknown counts whole), a server
 *    agent's webhook trigger body, team incoming hooks' rows, GitHub pick-ups (everything), Clippings (the capture
 *    Inbox's subtree), and every place written by a processor that is itself fed from outside (taint — chains.ts runs
 *    the fixpoint, OutsideIndex). A decider reads its trigger's rows, its scope (everything; team: the shared pages; a
 *    named page or database with what lies below it), its MCP read tools, its own row and related rows' titles
 *    (autofill / organise, §6 A11), the whole workspace (the bridge). A decider's own writes are never its source.
 *  - **Private data in reach, relative to the exit** (§1.3 #3): anything beyond the one row / item that brought the
 *    outside content and its own report page — scope everything, other named places, other rows of the outside
 *    database when it can read them (§6 A6), its trigger's rows when they are not the outside ones, related rows'
 *    titles, MCP reads of any server but the exit's own, One memory (browser agents) — minus what the exit carries
 *    anyway: this device's GitHub push carries every page of a local workspace (then only MCP reads count) and, in a
 *    team without `includePrivate`, every shared page (then only private pages, private memory and MCP reads count).
 *  - **Data rules** (§1.3 #2, §6 A17): `classAllowedOn(route, cls, { ws, device })` — device rules only for deciders
 *    running here (local workspaces, the creator's browser, autofill, organise); a class is withheld only when every
 *    provider the decider may use withholds it. The providers are every routable pin of the rule that wins for the
 *    decider's feature class (fix model — ai/core/resolve.ts levels: device.routes[cls] → workspace.routes[cls] →
 *    device.default → workspace '*' → legacy Claude; the gate tries the pins in order and a pin a data rule refuses
 *    falls through to the next, so any of them may carry the data): agents 'agents' (an own route or a saver rule's
 *    pins as well), autofill and organise 'bulk'. 'mail' withheld → mail rows are no source for it; 'mcp' withheld →
 *    no MCP attach at all (no MCP source, no MCP exit — exec.ts `pre.allows('mcp')`); 'memory' / 'private' withheld →
 *    no memory / no private pages in its private reach. MCP servers join Claude's requests only (the neutral wire
 *    carries none, D-S2-7): a decider none of whose providers is Claude gets no MCP at all — no source, no way out.
 *    The bridge is an outside Claude: no data rule applies to it.
 *
 * Lamps are message refs (`features.patchbay.lamp.*`, strings B4) whose vars hold ids: `db` / `page` = an id, `server`
 * / `writer` / `from` / `via` / `source` = a module key, `place` = a place key — plain.ts and the UI turn them into
 * names. Nothing here reads a store.
 */
import { classAllowedOn } from '../ai/core/allowed'
import { routable } from '../ai/core/routable'
import { readAgentRoute } from '@/shared/ai/route'
import { isProviderId } from '@/shared/ai/models'
import type { DataClass, FeatureClass, ProviderId, RouteRule } from '@/shared/ai/types'
import { moduleKey } from './ref'
import { placeKey } from './rules'
import type { ID } from '../../store/types'
import type { AgentInput, ChainExit, DatabaseInput, Edge, Gate, Model, ModelInput, Module, ModuleKey, OutsideSource, Place, PrivateItem, ScriptScan, Why } from './types'

/* ------------------------------------------------------------------ the index */

/** A processor's link to a server: the READ cable (its read results come in) and the WRITE? cable (a way out). */
export interface ToolLink {
  server: ModuleKey
  /** the READ → tools edge (null: no read tool reachable) */
  read: string | null
  /** the WRITE? → tools edge (null: no write tool) */
  write: string | null
  /** the tool list is unknown here and no allow-list narrows it (fail closed, §6 A7) */
  failClosed: boolean
}

/** What the analysis looks up, built once per model (O(modules + edges)). */
export interface ReachIndex {
  input: ModelInput
  model: Model
  mods: Map<ModuleKey, Module>
  dbs: Map<ID, DatabaseInput>
  agents: Map<ID, AgentInput>
  /** jack key → its module */
  jackMod: Map<string, ModuleKey>
  /** edge id → the edge */
  edge: Map<string, Edge>
  /** module → the cables leaving its jacks / entering its jacks */
  from: Map<ModuleKey, Edge[]>
  into: Map<ModuleKey, Edge[]>
  /** processor → its servers */
  tools: Map<ModuleKey, ToolLink[]>
  /** databases whose rows are mail */
  mailDbs: Set<ID>
  /** database → the team incoming hooks writing its rows */
  hookDbs: Map<ID, ModuleKey[]>
  /** fix (model): the team API tokens with write scope (they write anywhere) */
  api: ModuleKey[]
  /** the capture Inbox (Clippings) when it is on the rack */
  clippings: { inbox: ID; module: ModuleKey } | null
  /** this device's GitHub sync is on the rack (its pick-ups are from outside) */
  github: ModuleKey | null
  /** database → its auto autofill fields */
  autofillProps: Map<ID, Set<string>>
  /** database → its fields "only by hand" (agents and the bridge never write them) */
  handOnly: Map<ID, Set<string>>
  /** pipeline database → its module */
  pipelines: Map<ID, ModuleKey>
  /** `<module>|<placeKey>` → the cable that draws a write of it (a net flag, the database, the page, Whole workspace) */
  writeEdge: Map<string, string>
  /** `<module>|<placeKey>` → the cable that starts it on that place (from the net flag, or from a row trigger) */
  listenEdge: Map<string, string>
  /** a script's scan (the model's own rule: read here, else the lazy cache's of the same version) */
  scans: Map<ID, ScriptScan | null>
}

const EMPTY: ReadonlySet<string> = new Set()

/** Build the index of a model and its input. */
export function reachIndex(model: Model, input: ModelInput): ReachIndex {
  const mods = new Map(model.modules.map((m) => [m.key, m]))
  const jackMod = new Map<string, ModuleKey>()
  for (const m of model.modules) for (const j of [...m.inJacks, ...m.outJacks]) jackMod.set(j.key, m.key)
  const from = new Map<ModuleKey, Edge[]>()
  const into = new Map<ModuleKey, Edge[]>()
  const push = (map: Map<ModuleKey, Edge[]>, k: ModuleKey | null, e: Edge) => {
    if (!k) return
    const list = map.get(k)
    if (list) list.push(e)
    else map.set(k, [e])
  }
  for (const e of model.edges) {
    push(from, jackMod.get(e.from) ?? null, e)
    push(into, jackMod.get(e.to) ?? null, e)
  }

  // servers per processor: the READ / WRITE? cables into its tools jack
  const tools = new Map<ModuleKey, ToolLink[]>()
  for (const e of model.edges) {
    if (e.kind !== 'reads' && e.kind !== 'out') continue
    if (!e.to.endsWith('.tools')) continue
    const proc = jackMod.get(e.to)
    const server = jackMod.get(e.from)
    if (!proc || !server || mods.get(server)?.kind !== 'server') continue
    const list = tools.get(proc) ?? []
    let link = list.find((l) => l.server === server)
    if (!link) list.push((link = { server, read: null, write: null, failClosed: false }))
    if (e.kind === 'reads') link.read = e.id
    else {
      link.write = e.id
      if (e.failClosed) link.failClosed = true
    }
    tools.set(proc, list)
  }
  for (const list of tools.values()) list.sort((a, b) => (a.server < b.server ? -1 : 1))

  const dbs = new Map(input.databases.map((d) => [d.id, d]))
  const mailDbs = new Set(input.databases.filter((d) => d.system === 'mails' || (d.system ?? '').startsWith('mail-') || d.id === input.mail?.databaseId).map((d) => d.id))
  const hookDbs = new Map<ID, ModuleKey[]>()
  const api: ModuleKey[] = []
  const pipelines = new Map<ID, ModuleKey>()
  let clippings: ReachIndex['clippings'] = null
  let github: ModuleKey | null = null
  for (const m of model.modules) {
    const r = m.ref
    if (r.kind === 'incoming' && r.db) hookDbs.set(r.db, [...(hookDbs.get(r.db) ?? []), m.key])
    else if (r.kind === 'incoming' && r.hook?.startsWith('api:')) api.push(m.key)
    else if (r.kind === 'pipeline') pipelines.set(r.db, m.key)
    else if (r.kind === 'clippings') clippings = { inbox: r.inbox, module: m.key }
    else if (r.kind === 'sync' && r.source === 'github') github = m.key
  }

  const autofillProps = new Map<ID, Set<string>>()
  for (const db of input.databases)
    for (const p of db.properties)
      if (p.autofill?.auto) {
        const set = autofillProps.get(db.id) ?? new Set<string>()
        set.add(p.id)
        autofillProps.set(db.id, set)
      }

  // the cables of writes (by writer + place) and of starts (by listener + place)
  const writeEdge = new Map<string, string>()
  const listenEdge = new Map<string, string>()
  for (const e of model.edges) {
    if (e.kind !== 'writes' || !e.place) continue
    const w = jackMod.get(e.from)
    if (!w) continue
    const k = `${w}|${placeKey(e.place)}`
    // a net flag's cable wins over the database's (the flag is the place the listener starts on)
    if (!writeEdge.has(k) || e.to.startsWith('net:')) writeEdge.set(k, e.id)
  }
  const edge = new Map(model.edges.map((e) => [e.id, e]))
  for (const net of model.nets)
    for (const id of net.listeners) {
      const e = edge.get(id)
      const l = e ? jackMod.get(e.to) : null
      if (l) listenEdge.set(`${l}|${placeKey(net.place)}`, id)
    }
  for (const m of model.modules) {
    if (m.ref.kind !== 'rowTrigger') continue
    const r = m.ref
    const prop = r.event === 'created' ? '+row' : r.event === 'deleted' ? '-row' : (r.prop ?? '*')
    for (const e of from.get(m.key) ?? []) {
      const l = jackMod.get(e.to)
      if (l && !listenEdge.has(`${l}|${r.db}:${prop}`)) listenEdge.set(`${l}|${r.db}:${prop}`, e.id)
    }
  }

  const scans = new Map<ID, ScriptScan | null>()
  for (const s of input.scripts) {
    const cached = input.lazy?.scripts?.[s.script.id]
    scans.set(s.script.id, s.scan ?? (cached && cached.at === s.script.updatedAt ? cached : null))
  }

  return {
    input,
    model,
    mods,
    dbs,
    agents: new Map(input.agents.map((a) => [a.agent.id, a])),
    jackMod,
    edge,
    from,
    into,
    tools,
    mailDbs,
    hookDbs,
    api: api.sort(),
    clippings,
    github,
    autofillProps,
    handOnly: new Map(input.databases.map((d) => [d.id, new Set(d.properties.filter((p) => p.agentReadOnly).map((p) => p.id))])),
    pipelines,
    writeEdge,
    listenEdge,
    scans,
  }
}

export const autofillPropsOf = (ix: ReachIndex, db: ID): ReadonlySet<string> => ix.autofillProps.get(db) ?? EMPTY

/** The pages above a place, nearest first (databases: DatabaseInput.under; pages: PageFacts.under). */
export const underOf = (ix: ReachIndex, id: ID): readonly ID[] => ix.dbs.get(id)?.under ?? ix.input.pages[id]?.under ?? []

/** A live place: a live database, or a referenced page neither gone nor in a template. */
export const isLivePlace = (ix: ReachIndex, id: ID): boolean => ix.dbs.has(id) || (!!ix.input.pages[id] && !ix.input.pages[id].gone && !ix.input.pages[id].inTemplate)

const isPrivate = (ix: ReachIndex, id: ID): boolean => !!ix.input.pages[id]?.private

/** Is place `id` inside the subtree of one of `roots` (itself or below)? */
export const within = (ix: ReachIndex, id: ID, roots: ReadonlySet<ID>): boolean => roots.has(id) || underOf(ix, id).some((u) => roots.has(u))

/* ------------------------------------------------------------------ deciders and data rules */

/** Orders B10: 'planner' — the work orders' planner (one structured request per request; it chooses the chain's steps). */
export type DeciderKind = 'agent' | 'autofill' | 'organise' | 'bridge' | 'planner'

/** An AI processor that chooses what to write or call while nobody approves each action (§1.3 #1). */
export interface Decider {
  key: ModuleKey
  kind: DeciderKind
  /** runs on this device: device data rules apply to it (§6 A17) */
  here: boolean
  /** the providers its requests may go to (own pins, a saver rule's, else every routable pin of its class's winning rule — Claude when none); null: no data rule applies (the bridge) */
  providers: ProviderId[] | null
  /** one of its providers takes MCP servers (Claude): else no MCP at all — no source, no way out (D-S2-7) */
  mcp: boolean
  /** an agent's (effective) write mode; autofill / organise write directly; the bridge 'apply' or 'ask' */
  write: 'apply' | 'stage' | 'none' | 'ask'
  /** a server agent (runs on the team server, remote everywhere) */
  server: boolean
  /** switched off: runs only by hand (§6 A13) */
  disabled: boolean
}

/** Providers whose requests MCP servers join (client.ts: the neutral wire carries no MCP server, D-S2-7). */
export const MCP_PROVIDERS: readonly ProviderId[] = ['anthropic']

/**
 * The providers a request of feature class `cls` may go to: every routable pin of the rule that wins (ai/core/resolve.ts
 * levels without the chip — this device's `routes[cls]`, the workspace's `routes[cls]`, this device's `default`, the
 * workspace's `'*'`; the first level with a routable pin wins, levels never merge), else the legacy level (Claude).
 * `here`: the request runs on this device — its rules count; elsewhere only the workspace's. The gate tries the pins in
 * order and skips one a data rule refuses (filter 4): any pin may carry the request's data, so every one is a provider.
 */
export function classProviders(input: ModelInput, cls: FeatureClass, here: boolean): ProviderId[] {
  const ws = input.ai.workspace
  const device = here ? input.ai.device : null
  const levels: Array<RouteRule | null | undefined> = [device?.routes?.[cls], ws?.routes?.[cls], device?.default, ws?.routes?.['*']]
  for (const rule of levels) {
    if (!Array.isArray(rule) || !rule.length) continue
    const pins = rule.filter((r) => !!r && isProviderId(r.p) && routable(r.p, cls))
    if (pins.length) return [...new Set(pins.map((r) => r.p))].sort()
  }
  return ['anthropic']
}

const carriesMcp = (providers: ProviderId[] | null): boolean => providers === null || providers.some((p) => MCP_PROVIDERS.includes(p))

function agentProviders(ix: ReachIndex, a: AgentInput['agent'], here: boolean): ProviderId[] {
  const out = new Set<ProviderId>()
  const own = readAgentRoute(a.route)
  if (own && own !== 'unreadable') for (const pin of own) out.add(pin.p)
  else for (const p of classProviders(ix.input, 'agents', here)) out.add(p)
  // a saver rule moves a run to its cheaper pins: they may carry the run's data too
  const saver = a.saverRule as { to?: unknown } | null | undefined
  if (saver && Array.isArray(saver.to)) for (const pin of saver.to as Array<{ p?: unknown }>) if (pin && isProviderId(pin.p)) out.add(pin.p)
  return [...out].sort()
}

/** The decider a module is, or null (not an AI processor, route-blocked, Unreadable, the bridge in 'read'). */
export function deciderOf(ix: ReachIndex, m: Module): Decider | null {
  const r = m.ref
  const team = ix.input.ctx.team
  if (r.kind === 'agent') {
    const ai = ix.agents.get(r.id)
    // route-blocked, skipped by the team server (a Vorprüfer) or Unreadable: not a decider (blocked, or an unknown part)
    if (!ai || ai.routeBlocked || ai.serverSkip || ai.unreadable.length) return null
    const server = ai.agent.runner === 'server'
    const here = !team || (!server && ai.creatorHere)
    const providers = agentProviders(ix, ai.agent, here)
    return { key: m.key, kind: 'agent', here, providers, mcp: carriesMcp(providers), write: ai.write, server, disabled: !ai.agent.enabled }
  }
  // autofill (bulk.autofill) and organise (bulk.mail) are class 'bulk' — their own route rules, this device's
  if (r.kind === 'autofill' || r.kind === 'organise') {
    const providers = classProviders(ix.input, 'bulk', true)
    // fix (safety-data): an autofill without `auto` runs only by hand (§6 A13) — its fills go to the review unless
    // "Apply without review" is on (model.ts draws it only while it can take a path)
    const af = r.kind === 'autofill' ? ix.dbs.get(r.db)?.properties.find((p) => p.id === r.prop)?.autofill : undefined
    const hand = r.kind === 'autofill' && !af?.auto
    return { key: m.key, kind: r.kind, here: true, providers, mcp: carriesMcp(providers), write: hand && !af?.skipReview ? 'stage' : 'apply', server: false, disabled: hand }
  }
  if (r.kind === 'bridge') {
    const mode = ix.input.bridge.mode
    if (!ix.input.bridge.enabled || mode === 'read') return null
    return { key: m.key, kind: 'bridge', here: true, providers: null, mcp: true, write: mode === 'ask' ? 'ask' : 'apply', server: false, disabled: false }
  }
  // Orders B10: the planner (purpose coding.plan, class 'terminal', this device's rules) — it chooses the chain's steps;
  // a person confirms them with ↵ unless this device holds the consent (then it writes as 'apply'). A config of a later
  // build: it acts on nothing (an unknown part).
  if (r.kind === 'planner') {
    const o = ix.input.orders?.find((x) => x.db === r.db)
    if (!o?.config) return null
    const providers = classProviders(ix.input, 'terminal', true)
    const auto = !!o.auto && !team
    return { key: m.key, kind: 'planner', here: true, providers, mcp: carriesMcp(providers), write: auto ? 'apply' : 'ask', server: false, disabled: false }
  }
  return null
}

/**
 * May the decider's requests carry data class `cls` (one of its providers allows it; device rules only when it runs
 * here)? 'mcp': only providers MCP servers join count (none: no MCP at all — `d.mcp`).
 */
export function allows(ix: ReachIndex, d: Decider, cls: DataClass): boolean {
  if (!d.providers) return true
  const o = { ws: ix.input.ai.workspace, device: d.here ? ix.input.ai.device : null }
  const providers = cls === 'mcp' ? d.providers.filter((p) => MCP_PROVIDERS.includes(p)) : d.providers
  return providers.some((p) => classAllowedOn({ p }, cls, o))
}

/* ------------------------------------------------------------------ read roots */

export type ReadVia = OutsideSource['via']

/** What a processor reads (its read reach, §1.3 #2) — ids only. */
export interface ReadRoots {
  /** every place (an everything scope, the bridge) */
  everything: boolean
  /** team, scope everything: the shared pages only (never a private one) */
  sharedOnly: boolean
  /** places read with what lies below them: the scope, the trigger's database, its own row's database, related databases */
  places: Array<{ id: ID; via: ReadVia }>
  /** servers whose read results come in (READ cable, or the whole unknown list) */
  servers: ToolLink[]
  /** a server agent's webhook trigger (its incoming module) */
  hook: ModuleKey | null
  /** One memory goes along (browser agents, when a memory database exists and memory is on) */
  memory: boolean
  /** an agent's report page (never private data, never read as a source) */
  report: ID | null
}

const NONE: ReadRoots = { everything: false, sharedOnly: false, places: [], servers: [], hook: null, memory: false, report: null }

const triggerDb = (a: AgentInput['agent']): { db: ID; prop: string } | null =>
  a.trigger.type === 'row_created' ? { db: a.trigger.databaseId, prop: '+row' } : a.trigger.type === 'row_changed' ? { db: a.trigger.databaseId, prop: a.trigger.propertyId ?? '*' } : null

/** The callers' places of a script (an automation's / a command's database, a button's page). */
function callerPlaces(ix: ReachIndex, script: ModuleKey): ID[] {
  const out: ID[] = []
  for (const e of ix.into.get(script) ?? []) {
    if (e.kind !== 'starts') continue
    const caller = ix.mods.get(ix.jackMod.get(e.from) ?? '')
    const r = caller?.ref
    if (!r) continue
    if (r.kind === 'automation' || r.kind === 'command') out.push(r.db)
    else if (r.kind === 'button') out.push(r.page)
  }
  return out
}

/** A processor's read reach (data rules not applied: `outsideSources` / `privateItems` apply them per decider). */
export function readRoots(ix: ReachIndex, m: Module): ReadRoots {
  const r = m.ref
  const places: ReadRoots['places'] = []
  const add = (id: ID | null | undefined, via: ReadVia) => {
    if (id && isLivePlace(ix, id) && !places.some((p) => p.id === id && p.via === via)) places.push({ id, via })
  }
  const servers = (ix.tools.get(m.key) ?? []).filter((t) => t.read !== null)
  switch (r.kind) {
    case 'agent': {
      const ai = ix.agents.get(r.id)
      if (!ai) return NONE
      const a = ai.agent
      if (!a.scope.everything) for (const id of [...a.scope.databases, ...a.scope.pages]) add(id, 'scope')
      const t = triggerDb(a)
      if (t) add(t.db, 'trigger')
      const browser = a.runner !== 'server'
      return {
        everything: a.scope.everything,
        sharedOnly: a.scope.everything && ix.input.ctx.team,
        places,
        servers,
        hook: a.runner === 'server' && a.trigger.type === 'webhook' ? moduleKey({ kind: 'incoming', hook: null, db: null, agent: a.id }) : null,
        memory: browser && ix.input.memory.exists && ix.input.memory.on,
        report: a.output?.pageId ?? null,
      }
    }
    case 'autofill': {
      add(r.db, 'row')
      for (const p of ix.dbs.get(r.db)?.properties ?? []) if (p.type === 'relation' && p.relationDatabaseId) add(p.relationDatabaseId, 'related')
      return { ...NONE, places, servers }
    }
    case 'organise': {
      add(r.db, 'row')
      // B4: one request sorts a batch of mails (organise.ts organiseBatch) — the other mails of the batch go along:
      // "other rows of Mails" are in reach (the mail database read as a whole, §6 A6)
      add(r.db, 'scope')
      add(ix.input.mail?.relationDb, 'related')
      return { ...NONE, places, servers }
    }
    case 'bridge':
      return { ...NONE, everything: true }
    case 'automation':
      add(r.db, 'row')
      // fix (model): a single-use script folded into the automation (§1.15) reads what its scan names
      if (m.folds?.script) for (const p of ix.scans.get(m.folds.script)?.reads ?? []) add('db' in p ? p.db : 'page' in p ? p.page : null, 'scope')
      return { ...NONE, places }
    case 'kit': {
      add(r.db, 'row')
      // fix (rest): the value code runs in query mode — it may read what its scan names, and the rows its row's
      // relations point to (like autofill); the result lands in its field
      const k = ix.input.kit.find((x) => x.db === r.db && x.prop === r.prop)
      for (const p of k?.scan?.reads ?? []) add('db' in p ? p.db : 'page' in p ? p.page : null, 'scope')
      for (const p of ix.dbs.get(r.db)?.properties ?? []) if (p.type === 'relation' && p.relationDatabaseId) add(p.relationDatabaseId, 'related')
      return { ...NONE, places }
    }
    case 'pipeline':
      // fix (model): the worker reads the task row (the task's page and fields go to Claude Code)
      add(r.db, 'row')
      return { ...NONE, places }
    case 'planner':
      // Orders B10: the request row (its own database's rows — from outside when an outside-reading writer wrote them),
      // the picked server's read results; the pages it links are private data (privateItems: 'linked')
      add(r.db, 'row')
      return { ...NONE, places, servers }
    case 'script': {
      const scan = ix.scans.get(r.id) ?? null
      for (const p of scan?.reads ?? []) add('db' in p ? p.db : 'page' in p ? p.page : null, 'scope')
      for (const id of callerPlaces(ix, m.key)) add(id, 'row')
      return { ...NONE, places }
    }
    default:
      return NONE
  }
}

/** What a processor may write into (its write reach, A6 b): everything, or the roots of its named scope. */
export function writeReachCovers(ix: ReachIndex, m: Module, db: ID): boolean {
  if (m.ref.kind === 'bridge') return true
  if (m.ref.kind !== 'agent') return false
  const ai = ix.agents.get(m.ref.id)
  if (!ai || ai.write === 'none') return false
  if (ai.agent.scope.everything) return !(ix.input.ctx.team && isPrivate(ix, db))
  return within(ix, db, new Set([...ai.agent.scope.databases, ...ai.agent.scope.pages]))
}

/* ------------------------------------------------------------------ outside */

/** Why a place's content is from outside (the taint index's entries). */
export interface OutsideMark {
  kind: 'mail' | 'incoming' | 'api' | 'clippings' | 'github' | 'tainted'
  source: ModuleKey
  /** taint: the writer (= source) and where its content came from */
  writer?: ModuleKey
  from?: ModuleKey
}

/** Which places hold content from outside (chains.ts fills it: the starting places, then the taint fixpoint). */
export interface OutsideIndex {
  /** database → why its rows are from outside */
  dbs: Map<ID, OutsideMark[]>
  /** page → why it and what lies below it are from outside */
  pages: Map<ID, OutsideMark[]>
  /** every place (GitHub pick-ups; an everything-writer fed from outside) */
  all: OutsideMark[]
}

/** The mail rows' source: the mail database's "new row" trigger (the mail sync) — drawn when something listens to it. */
export const mailSource = (db: ID): ModuleKey => moduleKey({ kind: 'rowTrigger', db, event: 'created', prop: null })

/** The places from outside before any taint: mail databases, hook databases, API tokens, Clippings, GitHub pick-ups. */
export function startingOutside(ix: ReachIndex): OutsideIndex {
  const oi: OutsideIndex = { dbs: new Map(), pages: new Map(), all: [] }
  for (const db of [...ix.mailDbs].sort()) oi.dbs.set(db, [{ kind: 'mail', source: mailSource(db) }])
  for (const [db, hooks] of [...ix.hookDbs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) oi.dbs.set(db, [...(oi.dbs.get(db) ?? []), ...hooks.sort().map((h) => ({ kind: 'incoming' as const, source: h }))])
  // fix (model): a write token's rows and pages may be anywhere in the shared workspace
  for (const t of ix.api) oi.all.push({ kind: 'api', source: t })
  if (ix.clippings) oi.pages.set(ix.clippings.inbox, [{ kind: 'clippings', source: ix.clippings.module }])
  if (ix.github) oi.all.push({ kind: 'github', source: ix.github })
  return oi
}

/** Add a mark to a place (db / page / all) — true when the place was not from outside before. */
export function markOutside(oi: OutsideIndex, place: Place, mark: OutsideMark): boolean {
  const add = (list: OutsideMark[] | undefined): { list: OutsideMark[]; fresh: boolean } => {
    const cur = list ?? []
    if (cur.some((m) => m.kind === mark.kind && m.source === mark.source)) return { list: cur, fresh: false }
    return { list: [...cur, mark], fresh: !cur.length }
  }
  if ('db' in place) {
    const { list, fresh } = add(oi.dbs.get(place.db))
    oi.dbs.set(place.db, list)
    return fresh
  }
  if ('page' in place) {
    const { list, fresh } = add(oi.pages.get(place.page))
    oi.pages.set(place.page, list)
    return fresh
  }
  if ('everything' in place) {
    const fresh = !oi.all.length
    if (!oi.all.some((m) => m.kind === mark.kind && m.source === mark.source)) oi.all.push(mark)
    return fresh
  }
  return false
}

/**
 * The marks of what a read of `id` (and, for a scope, what lies below it) covers: the place, the pages above it, the
 * places below it, and `all` — which lands in the place read itself (GitHub may have written it).
 */
function marksUnder(ix: ReachIndex, oi: OutsideIndex, id: ID, subtree: boolean): Array<{ place: Place; mark: OutsideMark }> {
  const out: Array<{ place: Place; mark: OutsideMark }> = []
  const self: Place = ix.dbs.has(id) ? { db: id } : { page: id }
  const own = ix.dbs.has(id) ? oi.dbs.get(id) : oi.pages.get(id)
  for (const mark of own ?? []) out.push({ place: self, mark })
  // inside an outside subtree (Clippings, a page written from outside): the page above it
  for (const up of underOf(ix, id)) for (const mark of oi.pages.get(up) ?? []) out.push({ place: { page: up }, mark })
  if (subtree) {
    const roots = new Set([id])
    for (const [db, marks] of oi.dbs) if (db !== id && underOf(ix, db).some((u) => roots.has(u))) for (const mark of marks) out.push({ place: { db }, mark })
    for (const [page, marks] of oi.pages) if (page !== id && underOf(ix, page).some((u) => roots.has(u))) for (const mark of marks) out.push({ place: { page }, mark })
  }
  // an API token writes the shared workspace only — never a member's private page
  for (const mark of oi.all) if (!(mark.kind === 'api' && isPrivate(ix, id))) out.push({ place: self, mark })
  return out
}

/** Everything an everything-reader covers (team: the shared places only). */
function marksEverywhere(ix: ReachIndex, oi: OutsideIndex, sharedOnly: boolean): Array<{ place: Place; mark: OutsideMark }> {
  const out: Array<{ place: Place; mark: OutsideMark }> = []
  for (const [db, marks] of oi.dbs) if (!(sharedOnly && isPrivate(ix, db))) for (const mark of marks) out.push({ place: { db }, mark })
  for (const [page, marks] of oi.pages) if (!(sharedOnly && isPrivate(ix, page))) for (const mark of marks) out.push({ place: { page }, mark })
  for (const mark of oi.all) out.push({ place: { everything: true }, mark })
  return out
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const VIA_RANK: Record<ReadVia, number> = { webhook: 0, trigger: 1, row: 2, scope: 3, related: 4, tools: 5 }
const KIND_RANK: Record<OutsideSource['kind'], number> = { hook: 0, mail: 1, incoming: 2, api: 3, clippings: 4, github: 5, mcp: 6, tainted: 7 }

/**
 * The outside sources a processor reads — every one, the primary first: what reaches it (not withheld) before what a
 * data rule withholds, direct content before places written from outside, then by how it reads (webhook · trigger ·
 * own row · scope · related · tools). `d` applies the decider's data rules ('mail', 'mcp'); without it nothing is
 * withheld (automations, scripts). The processor's own writes are never its source.
 */
export function outsideSources(ix: ReachIndex, oi: OutsideIndex, m: Module, roots: ReadRoots, d: Decider | null): OutsideSource[] {
  const out: OutsideSource[] = []
  const seen = new Set<string>()
  const mailOk = !d || allows(ix, d, 'mail')
  const mcpOk = !d || allows(ix, d, 'mcp')
  const add = (s: OutsideSource) => {
    const k = `${s.kind}|${s.source}|${s.place ? placeKey(s.place) : ''}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(s)
  }
  const fromMark = (place: Place, mark: OutsideMark, via: ReadVia) => {
    if (mark.kind === 'tainted' && mark.writer === m.key) return
    const s: OutsideSource = { kind: mark.kind, source: mark.source, place, via }
    if (mark.writer) s.writer = mark.writer
    if (mark.from) s.from = mark.from
    if (mark.kind === 'mail' && !mailOk) s.withheld = 'mail'
    add(s)
  }
  if (roots.hook) add({ kind: 'hook', source: roots.hook, via: 'webhook' })
  for (const p of [...roots.places].sort((a, b) => VIA_RANK[a.via] - VIA_RANK[b.via])) for (const { place, mark } of marksUnder(ix, oi, p.id, p.via === 'scope')) fromMark(place, mark, p.via)
  if (roots.everything) for (const { place, mark } of marksEverywhere(ix, oi, roots.sharedOnly)) fromMark(place, mark, 'scope')
  // a decider none of whose providers takes MCP servers gets no MCP at all (no source — not even a withheld one)
  if (!d || d.mcp) for (const t of roots.servers) add({ kind: 'mcp', source: t.server, via: 'tools', ...(mcpOk ? {} : { withheld: 'mcp' as const }) })
  return out.sort(
    (a, b) =>
      (a.withheld ? 1 : 0) - (b.withheld ? 1 : 0) ||
      (a.kind === 'tainted' ? 1 : 0) - (b.kind === 'tainted' ? 1 : 0) ||
      VIA_RANK[a.via] - VIA_RANK[b.via] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      cmp(a.source, b.source) ||
      cmp(a.place ? placeKey(a.place) : '', b.place ? placeKey(b.place) : ''),
  )
}

/* ------------------------------------------------------------------ private */

const srcPlaceId = (src: OutsideSource | null): ID | null => (src?.place ? ('db' in src.place ? src.place.db : 'page' in src.place ? src.place.page : null) : null)

/**
 * Private data in a decider's reach, relative to the path's outside source `src` and its exit (§1.3 #3, §6 A6 / A10).
 * `sources`: all of the decider's outside sources — the row that started it is never private when it is from outside
 * itself (whichever source the path names). Empty = the lamp stays off ("no private data in reach").
 */
export function privateItems(ix: ReachIndex, m: Module, d: Decider, roots: ReadRoots, src: OutsideSource | null, exit: ChainExit, sources: readonly OutsideSource[] = []): PrivateItem[] {
  const items: PrivateItem[] = []
  const srcId = srcPlaceId(src)
  const outsideRows = new Set(sources.filter((s) => !s.withheld && (s.via === 'trigger' || s.via === 'row')).map(srcPlaceId).filter((x): x is ID => !!x))
  const privOk = allows(ix, d, 'private')
  const team = ix.input.ctx.team
  const add = (item: PrivateItem) => {
    const id = item.place ? ('db' in item.place ? item.place.db : 'page' in item.place ? item.place.page : null) : null
    if (id && team && isPrivate(ix, id)) {
      if (!privOk) return
      item.private = true
    }
    const k = `${item.kind}|${item.place ? placeKey(item.place) : ''}|${item.server ?? ''}`
    if (!items.some((x) => `${x.kind}|${x.place ? placeKey(x.place) : ''}|${x.server ?? ''}` === k)) items.push(item)
  }

  if (roots.everything) {
    const n = ix.input.databases.filter((db) => !(roots.sharedOnly && isPrivate(ix, db.id))).length
    add({ kind: 'everything', n })
  }
  const scope = new Set(roots.places.filter((p) => p.via === 'scope').map((p) => p.id))
  for (const p of roots.places) {
    if (p.id === roots.report) continue
    const isDb = ix.dbs.has(p.id)
    const place: Place = isDb ? { db: p.id } : { page: p.id }
    if (p.via === 'scope') {
      if (p.id === srcId) {
        // the outside database itself: its other rows are private (§6 A6) — a page from outside is the one item
        if (isDb) add({ kind: 'otherRows', place })
      } else add({ kind: 'named', place })
    } else if (p.via === 'trigger' || p.via === 'row') {
      // the row that started it: the outside row itself, or private when the outside content came from elsewhere
      // (the planner's request row is what it plans from — never private data of its own, Orders B10)
      if (p.id !== srcId && !outsideRows.has(p.id) && !scope.has(p.id) && !roots.everything && m.ref.kind !== 'planner') add({ kind: p.via === 'trigger' ? 'trigger' : 'row', place })
    } else if (p.via === 'related') add({ kind: 'related', place })
  }
  // the outside database's other rows go out when the exit sends a row the decider may choose (an automation on it)
  if (exit.type === 'webhook' && srcId && ix.dbs.has(srcId) && exitDb(ix, exit) === srcId && writeReachCovers(ix, m, srcId)) add({ kind: 'otherRows', place: { db: srcId } })
  // Orders B10: the pages a work order links go to the planner (and, as refs, along to the worker) — any page
  if (m.ref.kind === 'planner') add({ kind: 'linked' })
  if (allows(ix, d, 'mcp')) for (const t of roots.servers) if (!(exit.type === 'mcp' && exit.module === t.server)) add({ kind: 'mcp', server: t.server })
  if (roots.memory && allows(ix, d, 'memory')) add({ kind: 'memory', ...(team ? { private: true as const } : {}) })

  // minus what the exit carries anyway: this device's GitHub push
  if (exit.type === 'sync') {
    const carriesPrivate = !team || ix.input.sync.github.includePrivate
    return items.filter((i) => i.kind === 'mcp' || (!carriesPrivate && i.private))
  }
  return items
}

/** The database an exit's automation lives in (null: not an automation's exit). */
function exitDb(ix: ReachIndex, exit: ChainExit): ID | null {
  const e = ix.edge.get(exit.edge)
  const m = e ? ix.mods.get(ix.jackMod.get(e.from) ?? '') : undefined
  return m?.ref.kind === 'automation' ? m.ref.db : null
}

/* ------------------------------------------------------------------ the lamps */

const KEY = 'features.patchbay.lamp'

function sourceVars(s: OutsideSource): Record<string, string> {
  const v: Record<string, string> = { source: s.source }
  if (s.place) {
    if ('db' in s.place) v.db = s.place.db
    else if ('page' in s.place) v.page = s.place.page
    v.place = placeKey(s.place)
  }
  if (s.writer) v.writer = s.writer
  if (s.from) v.from = s.from
  return v
}

/** The outside lamp: on with the primary source ("reads Tessera Handoff — written by Tessera-Spiegel from tracker"). */
export function outsideWhy(sources: readonly OutsideSource[], primary: OutsideSource | null): Why {
  const reach = sources.filter((s) => !s.withheld)
  if (primary && !primary.withheld) {
    const why: Why = { on: true, say: { key: `${KEY}.outside.${primary.kind}`, vars: sourceVars(primary) } }
    if (reach.length > 1) why.detail = { key: `${KEY}.outside.more`, vars: { n: reach.length - 1 } }
    return why
  }
  const held = sources.find((s) => s.withheld)
  if (held) return { on: false, say: { key: `${KEY}.outside.dataRule`, vars: { cls: held.withheld!, ...sourceVars(held) } } }
  return { on: false, say: { key: `${KEY}.outside.none` } }
}

function itemVars(i: PrivateItem): Record<string, string | number> {
  const v: Record<string, string | number> = {}
  if (i.place) {
    if ('db' in i.place) v.db = i.place.db
    else if ('page' in i.place) v.page = i.place.page
  }
  if (i.server) v.server = i.server
  if (i.n !== undefined) v.n = i.n
  return v
}

/** The private lamp: on with the first item ("may read everything", "other rows of Mails"); a team names "private page". */
export function privateWhy(items: readonly PrivateItem[]): Why {
  if (!items.length) return { on: false, say: { key: `${KEY}.private.none` } }
  const first = items[0]
  const why: Why = { on: true, say: { key: `${KEY}.private.${first.kind}`, vars: itemVars(first) } }
  const priv = items.find((i) => i.private)
  if (priv) why.detail = { key: `${KEY}.private.privatePage`, vars: itemVars(priv) }
  else if (items.length > 1) why.detail = { key: `${KEY}.private.more`, vars: { n: items.length - 1 } }
  return why
}

/** The way-out lamp: on for an unattended exit; off with the gate (a person checks first) or the data rule. */
export function outWhy(ix: ReachIndex, exit: ChainExit, gate: Gate | null, failClosed: boolean, withheld: boolean): Why {
  if (withheld) return { on: false, say: { key: `${KEY}.out.dataRule`, vars: { cls: 'mcp', server: exit.module } } }
  if (gate) return { on: false, say: { key: `${KEY}.out.gate.${gate}`, vars: exitVars(ix, exit) } }
  return { on: true, say: { key: `${KEY}.out.${failClosed ? 'failClosed' : exit.type}`, vars: exitVars(ix, exit) } }
}

function exitVars(ix: ReachIndex, exit: ChainExit): Record<string, string | number> {
  const m = ix.mods.get(exit.module)
  const v: Record<string, string | number> = { module: exit.module }
  if (m?.ref.kind === 'outbound') {
    if (m.ref.host) v.host = m.ref.host
    if (m.ref.method) v.method = m.ref.method
    // a git action is said in words (plain.ts sayMsg resolves `git`), never as the worker's verb
    if (m.ref.exit === 'git' && m.ref.method) v.git = m.ref.method
  } else if (m?.ref.kind === 'server') v.server = exit.module
  const e = ix.edge.get(exit.edge)
  const via = e ? ix.jackMod.get(exit.type === 'mcp' ? e.to : e.from) : null
  if (via) v.via = via
  return v
}
