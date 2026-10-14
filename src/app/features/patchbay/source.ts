/**
 * The pure core of inputs.ts (plan §1.2 / §2.3): the workspace's wiring + this device's facts → ModelInput, and the
 * memo that rebuilds it only when the wiring changed (the wiring signature). No store, no browser: inputs.ts gathers an
 * InputSource from the stores and hands the areas' readers in (InputReaders); Node specs pass plain data and plain
 * readers, so the very same code builds the input in the app and in the specs.
 *
 * What it reads (§2.3): agents (sanitized, Unreadable fields kept), scripts (+ scans), the live databases (not in the
 * trash, not below a page there, outside templates) with their config fields only — automations without `lastRunAt` /
 * `lastStatus` / `lastMessage`, own commands, repeating templates without `lastRunAt`, properties `{ id, name, type,
 * agentReadOnly, custom, autofill }` with autofill without `fills`, form hooks, Outbox routes —, the referenced pages'
 * facts, the kit's value properties, this device's MCP servers, profiles, mail, memory, AI rules, pipelines, worker,
 * sync, the bridge, sign-offs and the lazy readings (buttons, scans, runtime, hooks, the capture Inbox, the lazy cache).
 *
 * The memo (createInputMemo) — the same ModelInput object comes back while none of these changed:
 *  - by reference: agents · scripts · integrations · kit · ai · governor · fuseSignoffs · settings.mcpServers / mail /
 *    memory / ai · the lazy readings;
 *  - by value: this device's facts (cloud role, bridge, sync, worker, servers under test …);
 *  - per database, a config signature cached by object (a bookkeeping write — an automation's `lastRunAt`, an autofill
 *    `fills` record, a repeating template's `lastRunAt` — gives the same signature);
 *  - the referenced pages (database pages and the pages above them, scope / report / trigger pages, the Inbox): their
 *    objects compared by reference; only a changed one has its facts read again, and only changed facts rebuild.
 * So typing in a page rebuilds nothing, and never walks the page map (lookups by id only).
 */
import { sanitizeAgents } from '../../store/agents'
import { sanitizeScripts } from '../../store/scripts'
import { matchingServers, outToolsOf, profileStatus, sanitizeIntegrations } from '../../store/integrations'
import { sanitizeFuseSignoffs } from '../../store/fuseSignoffs'
import { agentAIReadable, decisionChecks, readAgentRoute } from '@/shared/ai/route'
import type { DeviceAI, Route as AIRoute, WorkspaceAI } from '@/shared/ai/types'
import type { Automation, CustomAgent, Database, DbCommand, ID, IntegrationProfile, Kit, McpServerConfig, Page, PropertyDef, Settings, TemplateRepeat, Workspace } from '../../store/types'
import type {
  AgentInput,
  ButtonInput,
  DatabaseInput,
  HookInput,
  InputCtx,
  KitInput,
  LazyCache,
  MailInput,
  ModelInput,
  PageFacts,
  PipelineInput,
  ProfileInput,
  RuntimeServerInput,
  ScriptInput,
  ScriptScan,
  ServerInput,
  SyncInput,
  WorkerInput,
} from './types'

/* ------------------------------------------------------------------ the source */

/** The workspace parts the wiring is read from (a store state fits). */
export interface InputWorkspace {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  agents?: Workspace['agents']
  scripts?: Workspace['scripts']
  integrations?: Workspace['integrations']
  kit?: Workspace['kit']
  ai?: Workspace['ai']
  governor?: Workspace['governor']
  fuseSignoffs?: Workspace['fuseSignoffs']
  settings: Pick<Settings, 'mcpServers' | 'mail' | 'memory' | 'ai'>
}

/** This device's facts (compared by value). */
export interface DeviceFacts {
  ctx: Omit<InputCtx, 'now'>
  bridge: ModelInput['bridge']
  sync: SyncInput
  worker: WorkerInput
  /** MCP servers whose connection test runs now */
  testing: readonly ID[]
  /** MCP servers whose token an API error refused in this tab */
  refused: readonly ID[]
  /** the kit codes this device trusts, by digest(code) (team; useKitTrust's answers) — null: a local workspace (every code runs) */
  kitTrust: Readonly<Record<string, boolean>> | null
}

/** The lazy readings (read on route open, or from the lazy cache) — compared by reference. */
export interface LazyReadings {
  buttons: ButtonInput[] | null
  /** script id → its scan (the memory cache's; a scan for another `updatedAt` is ignored) */
  scans: Record<ID, ScriptScan> | null
  runtime: RuntimeServerInput[] | 'forbidden' | null
  hooks: HookInput[] | 'forbidden' | null
  inbox: ID | null
  cache: LazyCache | null
}

export interface InputSource {
  ws: InputWorkspace
  device: DeviceFacts
  lazy: LazyReadings
  /** the build time (ctx.now) — never part of the signature */
  now: number
}

/** The areas' readers (the app: their index files; Node specs: plain stand-ins). */
export interface InputReaders {
  /** features/automations readAutomations */
  automations(raw: unknown): Automation[]
  /** features/commands readDbCommands */
  commands(raw: unknown): DbCommand[]
  /** features/coding readPipeline → the stages (pipeline databases only) */
  pipeline(db: Database): PipelineInput['stages']
  /** features/coding gitStageWarnings over the worker's repos */
  gitWarnings(stages: PipelineInput['stages']): PipelineInput['warnings']
  /** features/outbox routesFor(dbId) */
  sends(dbId: ID): DatabaseInput['sends']
  /** features/mail readMail (normalized) → the model's view; null: never set up here */
  mail(raw: Settings['mail']): MailInput | null
  /** features/ai/mcp-servers readServers (sanitized, this device's) */
  servers(settings: InputWorkspace['settings']): McpServerConfig[]
  /** features/mcp serverState */
  serverState(server: McpServerConfig, now: number, refused: boolean): string
  /** features/kit valuePropsOf */
  valueProps(db: Database, kit: Kit | undefined): Array<{ prop: PropertyDef; type: { id: ID }; code: string }>
  /** features/agents routeBlock: 'route' when this build cannot run the agent's route */
  routeBlock(agent: CustomAgent): 'route' | null
  /** features/templates nextRun → ms (null: none) */
  nextRun(repeat: TemplateRepeat, now: number): number | null
  /** store/ai readers + the agents' route (features/ai/core routeFor) */
  wsAI(raw: Workspace['ai']): WorkspaceAI | null
  deviceAI(raw: Settings['ai']): DeviceAI | null
  route(): AIRoute | null
}

/* ------------------------------------------------------------------ helpers */

/** A short, stable digest of a text (FNV-1a 64 as 16 hex) — the kit's value code is never carried, only this. */
export function digest(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x0100019d) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** Stable JSON (sorted keys) — for value comparisons of small objects. */
export function stable(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`
}

/** An automation's config fields (no `lastRunAt` / `lastStatus` / `lastMessage`). */
export const automationConfig = (a: Automation): Automation => ({ id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, actions: a.actions })

/** A property as the model reads it (autofill without `fills`). */
export function propertyConfig(p: PropertyDef): DatabaseInput['properties'][number] {
  const out: DatabaseInput['properties'][number] = { id: p.id, name: p.name, type: p.type }
  if (p.agentReadOnly) out.agentReadOnly = true
  if (p.custom) out.custom = p.custom
  if (p.autofill) {
    const { fills: _fills, ...rest } = p.autofill
    void _fills
    out.autofill = rest
  }
  return out
}

/** A repeating template's schedule without its bookkeeping (`lastRunAt`). */
export function repeatConfig(r: TemplateRepeat): string {
  const { lastRunAt: _last, ...rest } = r
  void _last
  return stable(rest)
}

const dbSigs = new WeakMap<Database, string>()

/** A database's config signature (cached by object): what the model reads of it — never bookkeeping. */
export function dbConfigSig(db: Database): string {
  let s = dbSigs.get(db)
  if (s === undefined) {
    s = stable([
      db.system ?? null,
      !!db.locked,
      db.properties.map(propertyConfig),
      Array.isArray(db.automations) ? db.automations.map((a) => (a && typeof a === 'object' ? automationConfig(a) : a)) : null,
      db.commands ?? null,
      (db.templates ?? []).map((t) => [t.id, t.repeat ? repeatConfig(t.repeat) : null]),
      db.views.filter((v) => v.type === 'form').map((v) => !!v.form?.webhookUrl),
      db.pipeline ?? null,
      db.recordTypes ?? null,
    ])
    dbSigs.set(db, s)
  }
  return s
}

/** Walk a page and the pages above it (cycle-safe): its facts. `get` records what it read. */
function factsOf(get: (id: ID) => Page | undefined, id: ID): (PageFacts & { chain: ID[] }) | null {
  const p = get(id)
  if (!p) return null
  const chain: ID[] = []
  const seen = new Set<ID>([p.id])
  let trashedRoot: Page | null = p.trashed ? p : null
  let template = !!p.template
  let cur: Page | undefined = p
  while (cur) {
    const up: ID | null = cur.parentId ?? (cur.databaseId && cur.databaseId !== cur.id ? cur.databaseId : null)
    if (!up || seen.has(up)) break
    seen.add(up)
    chain.push(up)
    cur = get(up)
    if (!cur) break
    if (cur.trashed && !trashedRoot) trashedRoot = cur
    if (cur.template) template = true
  }
  const gone = !!trashedRoot
  return {
    id: p.id,
    title: p.title,
    kind: p.kind === 'database' ? 'database' : 'page',
    trashed: !!p.trashed,
    gone,
    root: trashedRoot && trashedRoot.id !== p.id ? { id: trashedRoot.id, title: trashedRoot.title } : null,
    inTemplate: template,
    private: !!p.private,
    chain,
  }
}

const PIPELINES = new Set(['coding', 'spec', 'qa'])
const UNREADABLE_FIELDS = ['route', 'review', 'saverRule', 'applyOn'] as const

/** The fields of an agent this build cannot read (each checked on its own). */
export function unreadableOf(a: CustomAgent): AgentInput['unreadable'] {
  const out: AgentInput['unreadable'] = []
  if (readAgentRoute(a.route) === 'unreadable') out.push('route')
  for (const f of UNREADABLE_FIELDS) {
    if (f === 'route') continue
    if (a[f] !== undefined && a[f] !== null && !agentAIReadable({ [f]: a[f] })) out.push(f)
  }
  return out
}

/* ------------------------------------------------------------------ the input */

export interface BuiltInput {
  input: ModelInput
  /** every page object read (by id): the memo compares them by reference */
  pageRefs: Map<ID, Page | undefined>
  /** the referenced ids' facts (the memo compares them by value when a page object changed) */
  factsSig: string
}

/** The workspace's wiring + this device's facts → ModelInput (pure; lookups by id only, never a page-map walk). */
export function toModelInput(src: InputSource, read: InputReaders): BuiltInput {
  const { ws, device, lazy } = src
  const pageRefs = new Map<ID, Page | undefined>()
  const get = (id: ID): Page | undefined => {
    const p = ws.pages[id]
    pageRefs.set(id, p)
    return p
  }
  const facts = new Map<ID, PageFacts & { chain: ID[] }>()
  const factOf = (id: ID) => {
    if (facts.has(id)) return facts.get(id)!
    const f = factsOf(get, id)
    if (f) facts.set(id, f)
    return f
  }

  // the live databases (their page live and outside templates), in id order
  const databases: DatabaseInput[] = []
  const live: Database[] = []
  for (const id of Object.keys(ws.databases).sort()) {
    const db = ws.databases[id]
    const f = factOf(db.id)
    if (!f || f.kind !== 'database' || f.gone || f.inTemplate) continue
    live.push(db)
    databases.push({
      id: db.id,
      system: db.system ?? null,
      locked: !!db.locked,
      properties: db.properties.map(propertyConfig),
      automations: read.automations(db.automations).map(automationConfig),
      commands: read.commands(db.commands).filter((c) => c.kind !== 'default'),
      repeating: (db.templates ?? []).filter((t) => !!t.repeat).map((t) => ({ id: t.id, every: repeatConfig(t.repeat!), next: read.nextRun(t.repeat!, src.now) })),
      formHooks: db.views.filter((v) => v.type === 'form' && !!v.form?.webhookUrl).length,
      sends: read.sends(db.id),
      under: f.chain,
    })
  }

  // agents (Unreadable fields kept as they are) and this device's facts about them
  const team = device.ctx.team
  const agents: AgentInput[] = Object.values(sanitizeAgents(ws.agents).agents)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((agent) => {
      const unreadable = unreadableOf(agent)
      const checks = decisionChecks(agent)
      return {
        agent,
        routeBlocked: !unreadable.length && read.routeBlock(agent) === 'route',
        unreadable,
        awaitsConfirm: team && agent.runner === 'browser' && !!agent.updatedBy && agent.updatedBy !== agent.createdBy,
        creatorHere: agent.runner === 'browser' && (!team || (!!device.ctx.me && agent.createdBy === device.ctx.me)),
        write: agent.write,
        jevGate: agent.write === 'apply' && !!checks && checks !== 'unreadable' && !!checks.gate?.allowAt,
      }
    })

  const scripts: ScriptInput[] = Object.values(sanitizeScripts(ws.scripts).scripts)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((script) => {
      const scan = lazy.scans?.[script.id]
      return { script, scan: scan && scan.at === script.updatedAt ? scan : null }
    })

  // the referenced pages: scope / report / trigger / mirror pages, script places, the Inbox, button pages
  const ref = (id: ID | null | undefined) => {
    if (id) factOf(id)
  }
  for (const { agent } of agents) {
    for (const id of agent.scope.pages) ref(id)
    for (const id of agent.scope.databases) ref(id)
    ref(agent.output?.pageId)
    ref(agent.mirrorOf)
    if (agent.trigger.type === 'row_created' || agent.trigger.type === 'row_changed') ref(agent.trigger.databaseId)
  }
  for (const s of scripts) for (const p of [...(s.scan?.reads ?? []), ...(s.scan?.writes ?? [])]) ref('page' in p ? p.page : 'db' in p ? p.db : null)
  for (const b of lazy.buttons ?? []) {
    ref(b.page)
    for (const a of b.actions) if (a.type === 'add_page') ref(a.target)
  }
  const inbox = lazy.inbox ?? lazy.cache?.inbox ?? null
  ref(inbox)

  const kit: KitInput[] = []
  for (const db of live)
    for (const v of read.valueProps(db, ws.kit)) {
      const code = digest(v.code)
      kit.push({ db: db.id, prop: v.prop.id, type: v.type.id, code, trusted: device.kitTrust === null ? true : (device.kitTrust[code] ?? null) })
    }

  const serverList = read.servers(ws.settings)
  const profiles: IntegrationProfile[] = sanitizeIntegrations(ws.integrations).integrations
  const matchView = serverList.map((s) => ({ name: s.name, url: s.url, enabled: s.enabled, tools: s.tools }))
  const testing = new Set(device.testing)
  const refused = new Set(device.refused)
  const servers: ServerInput[] = serverList.map((s) => ({
    server: { id: s.id, name: s.name, url: s.url, enabled: s.enabled, ...(s.scope ? { scope: s.scope } : {}), ...(s.tools ? { tools: [...s.tools] } : {}), ...(s.checkedAt ? { checkedAt: s.checkedAt } : {}), ...(s.checkError ? { checkError: s.checkError } : {}), ...(s.checkAuth ? { checkAuth: s.checkAuth } : {}), ...(s.codeword ? { codeword: s.codeword } : {}) },
    state: read.serverState(s, src.now, refused.has(s.id)),
    out: outToolsOf(profiles, s),
    testing: testing.has(s.id),
  }))
  const profileInputs: ProfileInput[] = profiles.map((profile) => ({ profile, active: profileStatus(profile, matchView).active, servers: matchingServers(profile, matchView) }))

  const mail = read.mail(ws.settings.mail)
  ref(mail?.databaseId)
  ref(mail?.relationDb)

  const pipelines: PipelineInput[] = []
  for (const db of live) {
    if (!db.system || !PIPELINES.has(db.system)) continue
    const stages = read.pipeline(db)
    pipelines.push({ db: db.id, kind: db.system as PipelineInput['kind'], stages, warnings: read.gitWarnings(stages) })
  }

  const pages: Record<ID, PageFacts> = {}
  for (const [id, f] of [...facts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const { chain: _chain, ...rest } = f
    void _chain
    pages[id] = rest
  }

  const input: ModelInput = {
    ctx: { ...device.ctx, now: src.now },
    agents,
    scripts,
    databases,
    pages,
    kit,
    servers,
    runtime: lazy.runtime ?? lazy.cache?.runtime ?? null,
    profiles: profileInputs,
    mail,
    memory: { exists: live.some((d) => d.system === 'memory'), on: ws.settings.memory?.enabled !== false },
    ai: { workspace: read.wsAI(ws.ai), device: read.deviceAI(ws.settings.ai), route: read.route() },
    pipelines,
    worker: device.worker,
    sync: device.sync,
    inbox,
    bridge: device.bridge,
    signoffs: sanitizeFuseSignoffs(ws.fuseSignoffs),
    buttons: lazy.buttons,
    hooks: lazy.hooks ?? lazy.cache?.hooks ?? null,
    lazy: lazy.cache,
  }
  return { input, pageRefs, factsSig: stable(pages) }
}

/* ------------------------------------------------------------------ the memo */

/** What the memo compares, apart from the pages and the databases. */
function refsOf(src: InputSource): unknown[] {
  const { ws, lazy } = src
  const st = ws.settings
  return [ws.agents, ws.scripts, ws.integrations, ws.kit, ws.ai, ws.governor, ws.fuseSignoffs, st.mcpServers, st.mail, st.memory, st.ai, lazy.buttons, lazy.scans, lazy.runtime, lazy.hooks, lazy.inbox, lazy.cache]
}

const deviceSig = (d: DeviceFacts) => stable({ ...d, testing: [...d.testing].sort(), refused: [...d.refused].sort() })

/** The databases' signature: ids + config signatures (each cached by object). */
function dbsSig(databases: Record<ID, Database>): string {
  let out = ''
  for (const id of Object.keys(databases).sort()) out += `${id}\u0000${dbConfigSig(databases[id])}\u0001`
  return out
}

export interface InputMemo {
  /**
   * The input for this source — the SAME object as last time while the wiring did not change. `pagesMoved: false`
   * (inputs.ts: the row index reported no structure change and no change of a referenced page) skips the page check.
   */
  read(src: InputSource, hint?: { pagesMoved?: boolean }): ModelInput
  /** how often the input was built / the referenced pages' facts were read again (perf seams) */
  stats(): { builds: number; pageChecks: number }
  /** the ids the last input read (the referenced set — inputs.ts intersects the row index's changes with it) */
  referenced(): ReadonlySet<ID>
  reset(): void
}

export function createInputMemo(read: InputReaders): InputMemo {
  let last: { src: InputSource; built: BuiltInput; refs: unknown[]; device: string; dbs: string; databases: Record<ID, Database> } | null = null
  let builds = 0
  let pageChecks = 0
  let referenced: Set<ID> = new Set()

  const build = (src: InputSource): ModelInput => {
    const built = toModelInput(src, read)
    builds++
    last = { src, built, refs: refsOf(src), device: deviceSig(src.device), dbs: dbsSig(src.ws.databases), databases: src.ws.databases }
    referenced = new Set(built.pageRefs.keys())
    return built.input
  }

  return {
    read(src, hint = {}) {
      if (!last) return build(src)
      const refs = refsOf(src)
      if (refs.some((r, i) => r !== last!.refs[i])) return build(src)
      const dev = deviceSig(src.device)
      if (dev !== last.device) return build(src)
      if (src.ws.databases !== last.databases) {
        const sig = dbsSig(src.ws.databases)
        if (sig !== last.dbs) return build(src)
        last.databases = src.ws.databases
      }
      if (src.ws.pages !== last.src.ws.pages && hint.pagesMoved !== false) {
        // only a referenced page whose object changed is read again; its facts decide
        let moved = false
        for (const [id, p] of last.built.pageRefs)
          if (src.ws.pages[id] !== p) {
            moved = true
            break
          }
        if (moved) {
          pageChecks++
          const again = toModelInput(src, read)
          if (again.factsSig !== last.built.factsSig) return build(src)
          // same facts: keep the input, remember the new objects
          last.built = { input: last.built.input, pageRefs: again.pageRefs, factsSig: again.factsSig }
          referenced = new Set(again.pageRefs.keys())
        }
      }
      last.src = src
      return last.built.input
    },
    stats: () => ({ builds, pageChecks }),
    referenced: () => referenced,
    reset() {
      last = null
      referenced = new Set()
    },
  }
}
