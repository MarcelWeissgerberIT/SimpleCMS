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
import type { AgentWriteMode, Automation, CustomAgent, Database, DbCommand, FuseSignoff, ID, IntegrationProfile, McpServerConfig, OneScript, PipelineStage, PropertyDef } from '../../store/types'
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
  /** 'server': a server agent the team server skips (a Vorprüfer — server/src/agents/service.ts VORPRUEFER_SKIP) */
  blocked?: 'route' | 'confirm' | 'notHere' | 'unreadable' | 'server'
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
  /**
   * B2: a WRITE? cable of a server whose tool list is unknown here (never tested) to a processor with no allow-list —
   * counted as a way out all the same (fail closed, §1.3 / §6 A7)
   */
  failClosed?: true
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
  /** B3: the way out at the end of the path (its module, its kind, the edge into it — or the WRITE? cable for MCP) */
  exit?: ChainExit
  /** B3: every drawn edge of the path in order, the source's lead cable first (the UI lights these) */
  edges?: string[]
  /** B3: the three conditions of this path (reach.ts) — B4 decides fuse, near miss or nothing from them */
  lamps?: { outside: Why; private: Why; out: Why }
  /** B3: what the lamps say, as data (reach.ts): every outside source of the decider (primary first), the private reach */
  why?: { outside: OutsideSource[]; private: PrivateItem[] }
  /** B3: the decider's data rules close this path's MCP exit ('mcp' withheld from its route) */
  withheld?: 'mcp'
}

/** B3: the way out a chain ends at (§1.4). `edge` = the cable the fuse glyph sits on (the last unattended edge). */
export interface ChainExit {
  /** the outbound / Outbox module — or the server for an MCP exit */
  module: ModuleKey
  type: ExitType | 'outbox'
  edge: string
}

/**
 * B3: content from outside a decider reads (§1.3 #2) — ids only. `source` names the module the content comes from: the
 * mail rows' row trigger (the mail sync), the incoming hook, the server, Clippings, the GitHub sync, or — for a place
 * written from outside (taint) — the writer.
 */
export interface OutsideSource {
  /** 'api': written through a team API token with write scope (anywhere — its writes are bound to no database) */
  kind: 'mail' | 'hook' | 'incoming' | 'api' | 'mcp' | 'clippings' | 'github' | 'tainted'
  source: ModuleKey
  /** the place read (a mail / hook / tainted database or page; Clippings' Inbox; everything for GitHub pick-ups) */
  place?: Place
  /** how the decider reads it: its trigger's rows, its scope, its MCP tools, a webhook trigger's body, its own row, related rows' titles */
  via: 'trigger' | 'scope' | 'tools' | 'webhook' | 'row' | 'related'
  /** taint: who wrote the place, and where that writer's content came from (its own primary source) */
  writer?: ModuleKey
  from?: ModuleKey
  /** a data rule withholds it from the decider's route — then it reaches nothing (§1.3 #2) */
  withheld?: 'mail' | 'mcp' | 'private'
}

/** B3: private data in a decider's reach, relative to a path's source and exit (§1.3 #3) — ids only. */
export interface PrivateItem {
  kind: 'everything' | 'named' | 'otherRows' | 'trigger' | 'row' | 'related' | 'mcp' | 'memory'
  place?: Place
  /** 'mcp': the server whose read tools it may call */
  server?: ModuleKey
  /** 'everything': the databases in reach */
  n?: number
  /** team: a private page (`Page.private`) — the lamp names "private page" */
  private?: true
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
  /** B4: the key's own words (vars: ids — „{prop}“ by hand only, {server}: no longer for autofill) */
  label?: MsgRef
  /** B4: the mono "what it changes" line ("Inbox helper: Apply directly → Proposals for review") */
  what?: MsgRef
  /** B4: the team note under key 1 / 2b ("<creator> must confirm the agent afterwards") */
  team?: MsgRef
  /** B4: asked before the write (a mirror agent's recipe tool list changes) */
  asks?: MsgRef
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
  /**
   * … · 'byName': a script that names places by name (§1.17 — what it reads or writes is not known here) ·
   * 'elsewhere': a browser agent's server not set up on this device (team: the creator's other browsers run it too)
   */
  what: 'otherBrowser' | 'runtime' | 'hooks' | 'unreadable' | 'lazy' | 'byName' | 'elsewhere'
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
  /** `name` (fix rest): the database the lamp means, by its name now — MirrorSetup opens on it (a renamed one in the trash: Restore · Open) */
  | { kind: 'mirrorSetup'; profile: string; recipe?: string; name?: string }
  | { kind: 'agentEditor'; agent: ID }
  | { kind: 'runAgent'; agent: ID }
  | { kind: 'review'; agent: ID }

/**
 * One recipe of a profile as the setup reads it (§1.11, §3.7): what it makes and what of it is there. setup/lamps.ts
 * (04–06) and setup/ghosts.ts are pure and take it as data — Node specs pass it straight in; they never import
 * agents/mirror.ts or agents/integrations/recipe.ts (those load the store, the cloud, i18n and CSS). The browser fills
 * it (B11) from the agents area's index: resolveRecipe(profile, recipe, lang) for what the recipe makes, mirrorTitles()
 * for the names (the very titles the setup's spec plate shows and createMirror / reuseMirror give), sameNamedDb /
 * mirrorAgentOf / rememberedReports for what is there — durable facts, never MirrorSetup's in-memory state. Names are
 * shown only, never a key part. B11 may ADD optional fields.
 */
export interface RecipeFacts {
  profileId: string
  recipeId: string
  /** the recipe's name (ResolvedRecipe.name) */
  name: string
  /** this device's servers matching the profile (by name / host), switched on or off — [] = none yet (a server ghost) */
  servers: Array<{ id: ID; name: string }>
  /**
   * the database: `id` = the one there (live, or in the trash with a saved mirror marked for it — `trashed`), null =
   * not made yet (a ghost); `name` = its title, else the name the setup gives it
   */
  database: { id: ID | null; name: string; trashed?: boolean }
  /** the report page: `id` = a live one (the saved agent's, or the page "Use" takes back), null = not made yet */
  report: { id: ID | null; title: string }
  /**
   * the agent: `id` = the saved mirror agent (mirrorAgentOf), null = not saved yet — then what the setup's draft holds
   * (mirrorDraft, named by mirrorTitles); `draftLost`: the database was made by a setup here but no agent was saved
   * (05 reopens MirrorSetup — "Use …")
   */
  agent: {
    id: ID | null
    name: string
    runner: CustomAgent['runner']
    trigger: CustomAgent['trigger']
    write: AgentWriteMode
    /** its allow-list per source server (null: every tool / not known before the test) */
    tools: string[] | null
    draftLost?: boolean
  }
  /** 06 — this device's runs of the saved agent (or its server runs): null = not read yet */
  runs: { total: number; open: number } | null
}

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
  /**
   * B2: the full flow behind the drawing — every place each module may write (also what the rack does not draw as a
   * cable: an everything-writer's new rows, a write whose net flag another writer already carries) and who starts on
   * each place. chains.ts (B3) walks THIS, never the drawn edges, so folding a drawing never hides a path (§2.5).
   */
  flow?: Flow
  /** B3: the loops of the flow (↺) — each (module, place) pair once, drawn once (chains.ts) */
  loops?: LoopMark[]
}

/** B3: a (module, place) pair the flow reaches twice — the loop is drawn once at `module`, marked ↺. */
export interface LoopMark {
  /** `<module>@<placeKey>` — the chain's `loop.at` */
  at: string
  module: ModuleKey
  /** the place through which the loop comes back (absent: a start without a place, e.g. run_script) */
  place?: Place
}

/** One place a module may write, and how (B2, model.ts `flow`). */
export interface FlowWrite {
  place: Place
  /** the AI decides at run time (an agent, the bridge, a pipeline's git action) */
  can?: boolean
  byHand?: boolean
  asksFirst?: boolean
  /** B3: a proposal the person applies (a stage-mode agent's scope writes — its report page is written directly) */
  proposal?: boolean
  /** the write carries content from outside (mail sync, a hook, a GitHub pick-up, Clippings) */
  outside?: boolean
}

/** Something that starts on a place (B2): an automation / agent row trigger, autofill, a kit relay, mail organise. */
export interface FlowListen {
  module: ModuleKey
  kind: ModuleKind
  event: RowEvent
}

/** The flow of a model (B2): writes per module; listeners per place key (placeKey: `<db>:<prop | '*' | '+row' | '-row'>`). */
export interface Flow {
  writes: Record<ModuleKey, FlowWrite[]>
  listens: Record<string, FlowListen[]>
}

/** The numbers every surface shows (sidebar LED, Preflight lamp, status bar, the readout's FUSE cell) — LED = lamp = readout. */
export interface PatchbayCounts {
  /** open fuses (not allowed; a lapsed one counts as open) */
  open: number
  allowed: number
  unknown: number
  /** false until the first computation after first paint (then the LED may light) */
  ready: boolean
  /** B6: the first open fuse's path key in F-order (⌘K "next fuse", the readout's FUSE cell) */
  first?: string
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
  /**
   * a server agent the team server skips with its reason — today one with a Vorprüfer (review v2: `decisionChecks` ≠
   * null → VORPRUEFER_SKIP) until `/api/config` names 'vorpruefer': never a decider, never a writer (§1.3 #1)
   */
  serverSkip?: 'vorpruefer'
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
  /**
   * B2: writes the page it runs for (`page.current` / `page.here` / `page`): an automation's row, a command's rows, a
   * button's page — the caller's place
   */
  context?: boolean
}

/** A live database (not trashed, not in a template) with its config fields only (§1.2 — never `fills` / `last*`). */
export interface DatabaseInput {
  id: ID
  system: Database['system'] | null
  locked: boolean
  /** B3: `relationDatabaseId` too (autofill and organise read the titles of related rows, §6 A11) */
  properties: Array<Pick<PropertyDef, 'id' | 'name' | 'type' | 'agentReadOnly' | 'custom' | 'autofill' | 'relationDatabaseId'>>
  /** readAutomations (config fields; the model ignores lastRunAt / lastStatus / lastMessage) */
  automations: Automation[]
  /** own commands (readDbCommands, kind ≠ 'default') */
  commands: DbCommand[]
  /** repeating templates: id + schedule (`lastRunAt` left out) */
  repeating: Array<{ id: ID; every: string; next: number | null }>
  /** form views that post to a webhook (a note only, §1.4) */
  formHooks: number
  /** Outbox send routes on its rows (outboxCommands) — `server`: the server the route sends through (B2) */
  sends: Array<{ profile: string; route: string; tool: string; server?: string }>
  /** B2: the pages above the database, nearest first (a scope page reaches the databases below it) */
  under?: ID[]
}

/** Referenced pages only (database pages, report pages, scope pages, the capture Inbox — ≤ a few hundred). */
export interface PageFacts {
  id: ID
  title: string
  kind: 'page' | 'database'
  trashed: boolean
  /** the page or a page above it is in the trash */
  gone: boolean
  /**
   * the page in the trash above it when it is only below one (`trashed` false, `gone` true) — the agent editor's checks
   * name it (agents agentSaveIssues takes PageFacts as they are); null / absent: not below a page in the trash
   */
  root?: { id: ID; title: string } | null
  inTemplate: boolean
  private: boolean
  /** B3: the pages above it, nearest first (a scope page reaches what lies below it; Clippings are the Inbox's subtree) */
  under?: ID[]
}

/** A kit value property (valuePropsOf) and whether this device trusts its code (team: a version saved / confirmed here). */
export interface KitInput {
  db: ID
  prop: ID
  type: ID
  /** digest of the value code (never the code) */
  code: string
  trusted: boolean | null
  /**
   * fix (rest): what the value code reads beyond its own row (its scan, ids only — a value script runs in query mode
   * and can read any database or page; its result lands in this field). Absent / null: not scanned here nor in the lazy
   * cache — an unknown part on the relay where it is drawn.
   */
  scan?: KitScan | null
}

/** fix (rest): a kit value code's reach (scripts.ts scanKitCode) — ids only, cached by the code's digest. */
export interface KitScan {
  /** the places it names (`@[…](p:<id>)`, also the ones a write member is called on: query mode refuses the write, never the read) */
  reads: Place[]
  /** refs by name (not by id) — what it reads is not known here */
  byName: boolean
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
  /** B2: the properties "Organise with Claude" writes (category · priority · needs reply · summary · project) */
  organiseProps?: ID[]
  /** B2: the database organise relates each mail to (its rows' titles are read), null = none */
  relationDb?: ID | null
}

export interface PipelineInput {
  db: ID
  kind: 'coding' | 'spec' | 'qa'
  /** in Stage-option order; `next` (the stage after it, absent = the next one) and a doc stage's `output` (fix model) */
  stages: Array<Pick<PipelineStage, 'id' | 'kind' | 'auto' | 'gitAction' | 'hold' | 'next' | 'output'>>
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

/** A team incoming webhook (owners / admins, read on open); 'forbidden' → unknown parts. */
export interface HookInput {
  id: string
  db: ID | null
}

/**
 * A team API token (owners / admins, read on open with the hooks: `GET api/workspaces/<id>/tokens`) — its id and
 * whether it may write (scope 'write', not revoked). A write token creates and changes rows and pages anywhere in the
 * shared workspace (docs/API.md) and drives the team `/mcp` endpoint: content from outside everywhere.
 */
export interface TokenInput {
  id: string
  write: boolean
}

/**
 * A stored allowance as the model reads it — Workspace.fuseSignoffs' own type (store/types.ts FuseSignoff), keyed by
 * sig.ts `pathKey` and read only through store/fuseSignoffs.ts sanitizeFuseSignoffs: path key and `sig` 64 lower-case
 * hex, `parts` ≤ 24 keys `[a-z]\d{0,2}` → 16 hex each — exactly the shape sig.ts `sigOf` makes (d · a<n> · k<n> · f<n> ·
 * p<n> · s<n> · x, a long group's tail folded into its last part). A broken entry is left out: its fuse stays open.
 */
export type SignoffEntry = FuseSignoff

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
  /**
   * fix (model): the runtime list was read in this session (absent / false: it came from the lazy cache, maybe days old —
   * a server an agent names that the list lacks is then an unknown part, never "the runtime has none")
   */
  runtimeFresh?: boolean
  profiles: ProfileInput[]
  mail: MailInput | null
  memory: { exists: boolean; on: boolean }
  ai: { workspace: WorkspaceAI | null; device: DeviceAI | null; route: AIRoute | null }
  pipelines: PipelineInput[]
  worker: WorkerInput
  sync: SyncInput
  /** the capture Inbox (lib/capture.ts), looked up on open and cached; null = none / not known */
  inbox: ID | null
  /** B4: the Inbox lookup ran here or the lazy cache holds its answer (else Clippings are an unknown part where read) */
  inboxRead?: boolean
  bridge: { enabled: boolean; mode: 'ask' | 'apply' | 'read' }
  signoffs: Record<string, SignoffEntry>
  /** lazy readings (null: not read yet): the button index, team hooks */
  buttons: ButtonInput[] | null
  hooks: HookInput[] | 'forbidden' | null
  /** fix (model): team API tokens, read with the hooks (absent / null: not read yet — an unknown part in a team) */
  tokens?: TokenInput[] | 'forbidden' | null
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
  /** fix (model): team API tokens (id + write scope) — absent / null: not read */
  tokens?: TokenInput[] | null
  /** fix (rest): kit value codes' scans by the code's digest (absent: none kept yet) */
  kits?: Record<string, KitScan>
  inbox: ID | null
  /** B4: the Inbox lookup ran (`inbox` null then means "none", not "not read") */
  inboxRead?: boolean
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
