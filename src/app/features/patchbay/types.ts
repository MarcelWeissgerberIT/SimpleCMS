/**
 * THE PATCHBAY — the contract (plan §2.2, written whole in B1 so the tracks build against it in parallel). Types only:
 * nothing here runs, imports are type-only (Node specs import every pure module of the area).
 *
 * Who fills what:
 *  - ModelInput (inputs.ts, B2) → buildModel (model.ts, B2) → reach / chains (B3) → fuses / sig / plain (B4) → Model
 *  - layout + render geometry (B5) · the page (B6–B8) · keys + sign-offs (B9 / B10) · setup lamps (B11 / B12)
 *  - live signal (B13 / B14) · patching (B15 / B16)
 * A later batch may ADD optional fields; it never renames or removes one (other tracks are built against them).
 *
 * Words: the model holds ids, kinds and message refs (MsgRef) only — names, sub-lines and windows are resolved live by
 * the UI from `ref` (§2.2), sentences come from plain.ts. Nothing here is stored, except what cache.ts writes (ids and
 * hosts only, §1.2).
 */
import type { Route as AppRoute } from '../../lib/router'
import type { AgentWriteMode, Automation, CustomAgent, Database, DbCommand, ID, IntegrationProfile, McpServerConfig, OneScript, PipelineStage, PropertyDef } from '../../store/types'
import type { DeviceAI, Route as AIRoute, WorkspaceAI } from '@/shared/ai/types'

/* ================================================================== the rack */

/** § 01 sources · § 02 processing · § 03 targets */
export type Column = 1 | 2 | 3

/** `${kind}:${ids…}` — stable, ids only (ref.ts moduleKey builds it; every part URI-encoded, joined with ':') */
export type ModuleKey = string

export type ModuleKind =
  | 'server' | 'clock' | 'rowTrigger' | 'button' | 'command' | 'incoming' | 'sync' | 'clippings' // § 01
  | 'agent' | 'automation' | 'script' | 'autofill' | 'organise' | 'pipeline' | 'bridge' | 'kit' // § 02
  | 'database' | 'page' | 'inbox' | 'everything' | 'outbound' | 'outbox' // § 03

/** The kind label of an outbound module (WEBHOOK · GIT · HTTP · MAIL · MCP · SYNC) — §1.1, §1.4 */
export type ExitType = 'webhook' | 'git' | 'http' | 'mail' | 'mcp' | 'sync'

/** A row trigger's event (agents: created / changed; automations: created / changed / deleted). */
export type RowEvent = 'created' | 'changed' | 'deleted'

/**
 * The ids the openers and writers need, per module kind (the discriminator matches Module.kind). Never a name or a
 * text: titles are looked up live.
 */
export type ModuleRef =
  /** this device's server (`id`) or one named only by the server-agent runtime (`runtime`, by name) */
  | { kind: 'server'; id: ID | null; name: string; runtime?: true }
  /** one distinct schedule shared by agents (`schedule` = ref.ts scheduleKey), or a repeating database template's clock */
  | { kind: 'clock'; schedule: string; agents: ID[]; template?: { db: ID; id: ID } }
  /** `prop`: a property id · '*' any field (row_changed without a property; autofill / kit rows) · null: no field (created / deleted) */
  | { kind: 'rowTrigger'; db: ID; event: RowEvent; prop: ID | '*' | null }
  | { kind: 'button'; page: ID; block: string }
  /** an own database command (`command` = its id) */
  | { kind: 'command'; db: ID; command: string }
  /** a team incoming webhook / API token into a database, or a server agent's webhook trigger */
  | { kind: 'incoming'; hook: string | null; db: ID | null; agent: ID | null }
  | { kind: 'sync'; source: 'folder' | 'github' }
  | { kind: 'clippings'; inbox: ID }
  | { kind: 'agent'; id: ID }
  | { kind: 'automation'; db: ID; id: ID }
  | { kind: 'script'; id: ID }
  | { kind: 'autofill'; db: ID; prop: ID }
  /** mail "Organise with Claude" into the Mails database (null: not made yet) */
  | { kind: 'organise'; db: ID | null }
  | { kind: 'pipeline'; db: ID; pipeline: 'coding' | 'spec' | 'qa' }
  | { kind: 'bridge' }
  /** a kit value property someone listens to (`type` = the own property type) */
  | { kind: 'kit'; db: ID; prop: ID; type: ID }
  | { kind: 'database'; id: ID }
  | { kind: 'page'; id: ID }
  | { kind: 'inbox' }
  | { kind: 'everything' }
  /**
   * an unattended or by-hand way out — dedupe key = exit type + host + method (§2.4); `by` names what holds it (an
   * automation's webhook action, a script effect, a command, a pipeline's git stage, the GitHub push)
   */
  | { kind: 'outbound'; exit: ExitType; host: string | null; method: string | null; by: ModuleKey[] }
  /** an Outbox send route (`send:<profile>:<route>`) */
  | { kind: 'outbox'; profile: string; route: string; db: ID | null }

/** A module's tags (EN / DE words in messages: `features.patchbay.tag.*`). */
export type ModuleTag =
  | 'outside' | 'direct' | 'stage' | 'readonly' | 'byHand' | 'afterApproval' | 'asksFirst' | 'outbound' | 'server' | 'blocked'
  | 'unknownHere' | 'ghost' | 'disabled' | 'handRunOnly' | 'awaitsConfirm' | 'profile' | 'thisDevice'

/** A read without a cable: "reads CNSX Handoff" — `tainted` = the place carries content written from outside. */
export interface NetTag {
  place: Place
  tainted?: boolean
  /** the module whose write made the place outside (taint reasons, §1.3 #2) */
  writer?: ModuleKey
}

/** What ↵ / "Open" opens (§3.9) — the UI runs it through the area openers. */
export type OpenTarget =
  /** agents · scripts · coding · kit · outbox · a page / database · workspace sections */
  | { to: 'route'; route: AppRoute }
  | { to: 'modal'; modal: 'automations' | 'dbCommands'; databaseId: ID }
  | { to: 'mcp'; server?: ID }
  | { to: 'autofill'; db: ID; prop: ID }
  | { to: 'settings'; tab: 'mcp' | 'sync' | 'coding' | 'mail' }
  | { to: 'templates'; db: ID }
  | { to: 'none' }

export interface Module {
  key: ModuleKey
  kind: ModuleKind
  /** outbound only: the kind label (WEBHOOK · GIT · …) */
  exit?: ExitType
  col: Column
  /** 2U: agents with ≥ 3 jacks on a side or a run budget (knobs row) */
  u: 1 | 2
  /** ids the openers / writers need */
  ref: ModuleRef
  tags: ModuleTag[]
  /** profile id that touches it (tag "IN-01", filter, setup grouping) */
  profile?: string
  inJacks: Jack[]
  outJacks: Jack[]
  /** reads without a cable */
  nets: NetTag[]
  /** a single-use script folded into its automation (§1.15) */
  folds?: { script?: ID }
  /** read-only; null model = "Standard", null budget = "no budget" */
  knobs?: { model: string | null; budgetUsd: number | null }
  blocked?: 'route' | 'confirm' | 'notHere' | 'unreadable'
  /** no edge at all → folded "n idle" / "n ruhend" */
  idle: boolean
  /** what "Open" opens (§3.9) */
  open: OpenTarget
  // names, sub-lines and windows are resolved live by the UI from ref + Live state — never stored
}

export type JackRole = 'start' | 'tools' | 'read' | 'write' | 'out' | 'writes' | 'everything' | 'report' | 'notes' | 'rows' | 'send' | 'event'

export interface Jack {
  /** `${module}.${role}[.${n}]` */
  key: string
  module: ModuleKey
  side: 'in' | 'out'
  role: JackRole
  /** "READ 3", "WRITE? 4", "OUT 2", "EVERYTHING · 9 DB" */
  count?: number
  /** the "?" (heuristic used) / null count = untested */
  guessed?: boolean
  /** write-named tools a profile declared as read (marked, still WRITE?) */
  declaredRead?: string[]
  plugged: boolean
  /** P4: roles it accepts (from patch.ts) */
  patch?: JackRole[]
}

export type EdgeKind = 'reads' | 'writes' | 'starts' | 'out' | 'outsideIn' | 'relay'

export interface Edge {
  id: string
  kind: EdgeKind
  /** jack keys or net keys */
  from: string
  to: string
  /** the AI decides at run time → dashed */
  can?: boolean
  /** hatched ticks (content from outside) */
  outside?: boolean
  /** carries content written from outside (taint, §1.3 #2) */
  tainted?: boolean
  byHand?: boolean
  afterApproval?: boolean
  asksFirst?: boolean
  /** P2 ghost (dotted) */
  planned?: boolean
  /** this device does not know (grey "?") */
  unknown?: boolean
  /** bus chip id when ≥ 7 leave one jack to one column */
  bundle?: string
  /** the db / field it goes through */
  place?: Place
}

export type Place =
  | { db: ID; prop?: ID | '*' | '+row' }
  | { page: ID }
  | { inbox: true }
  | { everything: true }
  | { external: string }

/** Same name at both ends = the same connection. */
export interface NetLabel {
  /** `net:${db}:${prop|'*'|'+row'}` */
  key: string
  place: Place
  /** edge ids ending at the § 03 flag */
  writers: string[]
  /** edge ids leaving the § 01 flag */
  listeners: string[]
}

/** "+n" — cables from one jack to one column bundled past 6 (§1.19); bundled cables still count. */
export interface BusChip {
  id: string
  /** the jack the cables leave */
  jack: string
  col: Column
  /** the bundled edge ids (the popover lists their targets) */
  edges: string[]
}

/* ================================================================== chains and fuses */

export interface ChainStep {
  from: ModuleKey
  via?: Place
  to: ModuleKey | Place
  edge: string
}

/** A person in between (§1.3 gates) — no fuse, a near miss. */
export type Gate = 'proposals' | 'asks' | 'confirm' | 'afterApproval' | 'byHand'

export interface Chain {
  /** ids only, ordered */
  key: string
  /** the outside source (or the tainted place's writer) */
  source: ModuleKey
  decider: ModuleKey | null
  /** ALL steps after the decider (analysis is never cut) */
  steps: ChainStep[]
  /** steps drawn in full (≤ 3); the rest fold as "+n steps" */
  shown: number
  /** ↺ — a (module, place) pair reached twice */
  loop?: { at: string }
  gate?: Gate
  /** why it reaches: tainted places, kit / automation relays */
  via?: { taint?: Place[]; relay?: ModuleKey[] }
}

/** A message by key + vars — never text (plain.ts / the UI translate). */
export interface MsgRef {
  key: string
  vars?: Record<string, string | number>
}

/** One of a fuse's three lamps: on, what it says, an optional detail line. */
export interface Why {
  on: boolean
  say: MsgRef
  detail?: MsgRef
}

/** The facts row of a fuse plate (§2.6) — one per kind at most. */
export type FactKind =
  | 'writeMode' | 'reach' | 'trigger' | 'chain' | 'jev' | 'serverAgent' | 'browserAgent' | 'handRunOnly' | 'awaitsConfirm'
  | 'approvals' | 'thisDevice' | 'declaredRead' | 'bulkCap' | 'failClosed'

export interface Fact {
  kind: FactKind
  say: MsgRef
}

/** What softens a path without clearing the fuse (§1.3 mitigations) — named in the facts, never counted. */
export type MitigationKind = 'jev' | 'directSplit' | 'outLock' | 'webImages' | 'regler' | 'effectiveWrite' | 'directProps'

export interface Mitigation {
  kind: MitigationKind
  say: MsgRef
}

/** What a fuse key changes (§1.9) — the writer each kind uses is fixed in keys.ts (B10). */
export type FuseKeyKind =
  /** key 1 */
  | 'proposals' | 'autofillHand' | 'organiseHand' | 'bridgeAsk'
  /** key 2 / 2b */
  | 'handOnly' | 'cutTools' | 'noAutofill'
  /** key 3 */
  | 'allow' | 'withdraw'

/** The setting a key writes (ids only). */
export type FuseKeyTarget =
  | { agent: ID }
  | { agent: ID; server: string; keep: string[] }
  | { db: ID; prop: ID }
  | { server: ID }
  | { organise: true }
  | { bridge: true }
  | { path: string }

export interface FuseKey {
  n: 1 | 2 | 3
  kind: FuseKeyKind
  target: FuseKeyTarget
  /** shown as a working key (else aria-disabled with `refusal`) */
  offered: boolean
  /** why it is refused here (locked database, rights — owners / admins named, an older server …) */
  refusal?: MsgRef
  /** the line under the key ("each proposal waits for you — applying it still fires …", "<creator> confirms") */
  note?: MsgRef
  /** this device only — other devices keep the path */
  device?: true
}

export interface Fuse {
  /** path key = hash(chain.key) — identity across sessions (sig.ts, 64 hex) */
  key: string
  /** F1, F2 … by sorted key (labels may shift; identity is `key`) */
  label: string
  chain: Chain
  lamps: { outside: Why; private: Why; out: Why }
  /** the edge id the glyph sits on (the last unattended edge before the exit) */
  at: string
  facts: Fact[]
  mitigations: Mitigation[]
  /** read tools that may carry data out (§1.5) */
  residual?: string[]
  keys: FuseKey[]
  /** canonical input to sig.ts (computed async) */
  sigInput: unknown
}

export interface FuseState extends Fuse {
  sig?: string
  parts?: Record<string, string>
  allowed?: { state: 'allowed' | 'lapsed'; at: number; by: string | null; changed: ModuleKey[] }
}

/** Something on a possible path this device cannot see (§1.21) — never a fuse, never read as safe. */
export interface UnknownPart {
  key: string
  what: 'otherBrowser' | 'runtime' | 'hooks' | 'unreadable' | 'lazy'
  module: ModuleKey
  /** member id who can see it */
  who?: string
}

/** A path with a decider and an exit and a closing reason (§1.21) — listed, never counted. */
export interface NearMiss {
  key: string
  chain: Chain
  why: 'gate' | 'dataRule' | 'noPrivate' | 'closedHere'
}

/* ================================================================== setup lamps (P2, §1.11) */

export type LampState = 'ok' | 'next' | 'dark' | 'busy'
export type LampId = 'key' | 'server' | 'test' | 'profile' | 'database' | 'agent' | 'firstRun'

/** What a lamp's key opens (§1.11) — the openers of each area; ids only. */
export type LampAction =
  | { kind: 'aiSetup'; provider: 'anthropic' }
  | { kind: 'mcpSettings'; server?: ID; add?: true }
  | { kind: 'mcpTest'; server: ID }
  | { kind: 'integrations'; profile: string }
  | { kind: 'mirrorSetup'; profile: string; recipe?: string }
  | { kind: 'agentEditor'; agent: ID }
  | { kind: 'runAgent'; agent: ID }
  | { kind: 'review'; agent: ID }

export interface SetupLamp {
  n: 0 | 1 | 2 | 3 | 4 | 5 | 6
  id: LampId
  /** 04–06 per recipe (§1.11) */
  recipe?: string
  state: LampState
  say: MsgRef
  trace?: { from: 'busy'; to: 'ok'; at: number }
  /** kind + ids; on 'next' (primary) and 'ok' (quiet link) */
  action?: LampAction
  /** ghosts that turn real with it ("04" chips) */
  creates?: ModuleKey[]
}

/* ================================================================== the model */

export interface Model {
  modules: Module[]
  edges: Edge[]
  nets: NetLabel[]
  buses: BusChip[]
  chains: Chain[]
  fuses: Fuse[]
  unknown: UnknownPart[]
  nearMisses: NearMiss[]
  counts: { modules: number; idle: number; cables: number; dashed: number; planned: number; ghosts: number }
}

/** The numbers every surface shows (sidebar LED, Preflight lamp, status bar, the readout's FUSE cell) — LED = lamp = readout. */
export interface PatchbayCounts {
  /** open fuses (not allowed; a lapsed one counts as open) */
  open: number
  allowed: number
  unknown: number
  /** false until the first computation after first paint (then the LED may light) */
  ready: boolean
}

/* ================================================================== ModelInput (§2.3, inputs.ts → buildModel) */

/** Who looks, from where: the cloud role and this device's account (team), or a local workspace. */
export interface InputCtx {
  team: boolean
  /** the signed-in account (team), null locally */
  me: string | null
  role: 'owner' | 'admin' | 'member' | 'viewer' | null
  readOnly: boolean
  /** /api/config supports (team): 'signoffs', 'governor' … */
  supports: string[]
  now: number
}

/** An agent as the model reads it: the stored object (Unreadable fields kept as they are) + this device's facts. */
export interface AgentInput {
  agent: CustomAgent
  /** RUNNABLE_PROVIDERS cannot run its route (routeBlock) */
  routeBlocked: boolean
  /** fields this build cannot read (Unreadable) — an unknown part, never a clean "no fuse" */
  unreadable: Array<'route' | 'review' | 'saverRule' | 'applyOn'>
  /** a browser agent another member changed last waits for its creator (awaitsConfirm) */
  awaitsConfirm: boolean
  /** this device is where its servers are known: the creator's browser (team) or always (local); server agents: false */
  creatorHere: boolean
  /** the effective write mode (Regler G2 hook — identity in G1) */
  write: AgentWriteMode
  /** Jev with Schreibschranke on an apply-mode agent (a mitigation) */
  jevGate: boolean
}

/** A script with its lazy scan (null: not scanned here and not in the lazy cache → an unknown part where it matters). */
export interface ScriptInput {
  script: OneScript
  scan: ScriptScan | null
}

/** What a script reaches, from its code (scripts.ts, B2) — ids only. */
export interface ScriptScan {
  /** `script.updatedAt` the scan read */
  at: number
  reads: Place[]
  writes: Place[]
  /** names that make a run ask first (needsCheck): the effects it names */
  effects: Array<'mail' | 'claude' | 'http' | 'trash'>
  /** refs by name (not by id) — shown as "?" */
  byName: boolean
}

/** A live database (not trashed, not in a template) with its config fields only (§1.2 — never `fills` / `last*`). */
export interface DatabaseInput {
  id: ID
  system: Database['system'] | null
  locked: boolean
  properties: Array<Pick<PropertyDef, 'id' | 'name' | 'type' | 'agentReadOnly' | 'custom' | 'autofill'>>
  /** readAutomations (config fields; the model ignores lastRunAt / lastStatus / lastMessage) */
  automations: Automation[]
  /** own commands (readDbCommands, kind ≠ 'default') */
  commands: DbCommand[]
  /** repeating templates: id + schedule (`lastRunAt` left out) */
  repeating: Array<{ id: ID; every: string; next: number | null }>
  /** form views that post to a webhook (a note only, §1.4) */
  formHooks: number
  /** Outbox send routes on its rows (outboxCommands) */
  sends: Array<{ profile: string; route: string; tool: string }>
}

/** Referenced pages only (database pages, report pages, scope pages, the capture Inbox — ≤ a few hundred). */
export interface PageFacts {
  id: ID
  title: string
  kind: 'page' | 'database'
  trashed: boolean
  /** the page or a page above it is in the trash */
  gone: boolean
  inTemplate: boolean
  private: boolean
}

/** A kit value property (valuePropsOf) and whether this device trusts its code (team: a version saved / confirmed here). */
export interface KitInput {
  db: ID
  prop: ID
  type: ID
  /** digest of the value code (never the code) */
  code: string
  trusted: boolean | null
}

/** One of this device's MCP servers (readServers) with its tool facts. */
export interface ServerInput {
  server: Pick<McpServerConfig, 'id' | 'name' | 'url' | 'enabled' | 'scope' | 'tools' | 'checkedAt' | 'checkError' | 'checkAuth' | 'codeword'>
  /** MCP · Connections' state ('off' · 'untested' · 'ok' · 'refusedTest' · 'refusedTab' · 'expired' · 'failed') */
  state: string
  /** OUT tools of matching profiles (outToolsFor) */
  out: string[]
  /** a connection test runs now (useMcpChecks) */
  testing: boolean
}

/** A server the team server's agent runtime names (name + host only); 'forbidden' (viewer) → unknown parts. */
export interface RuntimeServerInput {
  name: string
  host: string | null
}

/** An integration profile on this device (sanitized) and the servers it matches. */
export interface ProfileInput {
  profile: IntegrationProfile
  active: boolean
  servers: string[]
}

export interface MailInput {
  databaseId: ID | null
  auto: 'open' | 'interval' | 'manual'
  everyMin: number
  organise: boolean
}

export interface PipelineInput {
  db: ID
  kind: 'coding' | 'spec' | 'qa'
  stages: Array<Pick<PipelineStage, 'id' | 'kind' | 'auto' | 'gitAction' | 'hold'>>
  /** worker repos whose push / pr is off (gitStageWarnings) */
  warnings: { pushOff: string[]; prOff: string[] }
}

export interface WorkerInput {
  online: boolean
  can: readonly string[] | null
  verdict: 'ok' | 'outdated' | 'unsafe' | null
  /** Claude Code's own MCP server names per repo (null: the worker does not report them) */
  tools: Array<{ repo: string | null; names: string[] }> | null
  approvals: 'all' | 'review' | 'none'
  confirm: 'always' | 'agent'
}

export interface SyncInput {
  github: { configured: boolean; auto: boolean; everyMin: number; includePrivate: boolean; repo: string | null }
  folder: { configured: boolean }
}

/** A button on a page that runs something (button index, B2 — lazy; null in ModelInput = not read yet). */
export interface ButtonInput {
  page: ID
  block: string
  actions: Array<{ type: 'run_script'; scriptId: ID | null } | { type: 'webhook'; host: string | null; method: string } | { type: 'add_page'; target: ID | null }>
}

/** A team incoming webhook / API token (owners / admins, read on open); 'forbidden' → unknown parts. */
export interface HookInput {
  id: string
  db: ID | null
}

/** A stored allowance as the model reads it (store/fuseSignoffs.ts in B9 holds the same shape). */
export interface SignoffEntry {
  sig: string
  parts: Record<string, string>
  at: number
  updatedBy: string | null
}

/** Everything buildModel reads — plain data; Node specs pass fixtures straight in. */
export interface ModelInput {
  ctx: InputCtx
  agents: AgentInput[]
  scripts: ScriptInput[]
  databases: DatabaseInput[]
  pages: Record<ID, PageFacts>
  kit: KitInput[]
  servers: ServerInput[]
  /** the server-agent runtime's servers (on open / lazy cache); 'forbidden' (viewer); null = not read yet */
  runtime: RuntimeServerInput[] | 'forbidden' | null
  profiles: ProfileInput[]
  mail: MailInput | null
  memory: { exists: boolean; on: boolean }
  ai: { workspace: WorkspaceAI | null; device: DeviceAI | null; route: AIRoute | null }
  pipelines: PipelineInput[]
  worker: WorkerInput
  sync: SyncInput
  /** the capture Inbox (lib/capture.ts), looked up on open and cached; null = none / not known */
  inbox: ID | null
  bridge: { enabled: boolean; mode: 'ask' | 'apply' | 'read' }
  signoffs: Record<string, SignoffEntry>
  /** lazy readings (null: not read yet): the button index, team hooks */
  buttons: ButtonInput[] | null
  hooks: HookInput[] | 'forbidden' | null
  /** the lazy cache this device holds (cache.ts) */
  lazy: LazyCache | null
}

/* ================================================================== device stores (cache.ts) */

/**
 * The lazy cache (§1.2, IndexedDB `one-patchbay` key `<scope>|lazy`): fuse-relevant lazy readings, ids and hosts
 * only — never a title or a text.
 */
export interface LazyCache {
  v: 1
  /** script id → its scan at that `updatedAt` */
  scripts: Record<ID, ScriptScan>
  /** team hook id → its target database */
  hooks: Array<{ id: string; db: ID | null }> | null
  /** the server-agent runtime's servers */
  runtime: RuntimeServerInput[] | null
  inbox: ID | null
  at: number
}

/** Runs today on this device (`<scope>|runs|<day>`, B13): count and last start per module. */
export interface RunTally {
  n: Record<ModuleKey, number>
  last: Record<ModuleKey, number>
}

/** The setup band's state (`<scope>|setup`, B12). */
export interface SetupState {
  profileId: string
  recipeId?: string
  closed?: boolean
  firstWriteAt?: number
}

/** The return chip (sessionStorage `one.patchbay.return`, B11): ids only. */
export interface ReturnState {
  profileId: string
  recipeId?: string
  next: LampId
}

/* ================================================================== live (P3, B13 / B14) */

/** One leg of a run's dot path: an edge lit at `at` (600 ms per leg, queued in order). */
export interface Leg {
  edgeId: string
  at: number
}

export type LiveState = 'idle' | 'running' | 'error' | 'budget' | 'held'

/** A module's live window (this device). */
export interface LiveModule {
  state: LiveState
  /** run start (ms) — the window's timer */
  since: number | null
  /** cost of the running / last run today from the ledger */
  cost: ModuleCost | null
  /** "+3 FOR REVIEW" — staged changes per target database */
  review?: number
}

/** costsByModule (live/costs.ts, pure) — "≈" only for an estimate; unpriced responses counted apart, never as $0. */
export interface ModuleCost {
  usd: number
  estimate: boolean
  unpriced: number
}

/* ================================================================== patching (P4, §2.9) */

export interface PatchEnd {
  module: ModuleKey
  role: JackRole
  /** a server tool (the OUT-lock picker under WRITE?) */
  tool?: string
}

export interface Patch {
  op: 'plug' | 'unplug'
  from: PatchEnd
  to: PatchEnd
  /** unplug: the edge */
  edge?: string
}

/** One write a patch makes — a tagged union over the four writers (§1.13). */
export type PatchWrite =
  | { w: 'agent'; agent: CustomAgent }
  | { w: 'automations'; db: ID; list: Automation[] }
  | { w: 'commands'; db: ID; list: DbCommand[] }
  | { w: 'integration'; profile: IntegrationProfile; replaces?: string }

export type PatchPlan =
  | { writes: PatchWrite[]; inverse: PatchWrite[]; preview: ModelInput; asks?: MsgRef[] }
  | { refused: MsgRef; info?: true }

/* ================================================================== the page */

/** Filter presets (§3.3): fuse paths only · running now · one profile. */
export type FilterPreset = { kind: 'fuses' } | { kind: 'running' } | { kind: 'profile'; id: string } | { kind: 'databases'; ids: ID[] }

/** Where a fuse hint line points (hint.ts): an agent, an agent's server, an automation, an autofill property. */
export type HintKind = 'agent' | 'agentServer' | 'automation' | 'autofill'

/** The fuse a module sits on, as a hint line names it ("On fuse F1 — show in the Patchbay"). */
export interface FuseHint {
  /** the fuse's path key (`#/patchbay?f=<key>`) */
  key: string
  label: string
}
