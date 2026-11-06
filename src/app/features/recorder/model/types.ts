/**
 * Flight recorder — the journal's records (IndexedDB `one-recorder`, per device) and the pins (before-
 * images in the version store `one-history`). Pure types: ids, kinds, times, counts and HMAC digests; no
 * page text and no property values anywhere but in pins (and names in schema deltas).
 */
import type { RunMeta } from '../../../store/writer'
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page, PropertyType, ViewType, ColorName, NumberFormat } from '../../../store/types'
import type { SnapshotPropDef } from '../../history/props'

/** Whose journal: the local workspace, or a team workspace's copy on this device. */
export type Scope = `local:${string}` | `cloud:${string}`

/** A page or row · the schema of a database · a view. */
export type PlaceKey = `p:${string}` | `s:${string}` | `v:${string}/${string}`
/** 'db' = the page object of a database */
export type PlaceKind = 'row' | 'page' | 'db' | 'schema' | 'view'

/** One track on the tape (writerKeys.ts laneOf). */
export type LaneKey = string

/** Event kinds (bitmask). */
export const K = {
  CONTENT: 1,
  TITLE: 2,
  PROPS: 4,
  ICON: 8,
  COVER: 16,
  CREATE: 32,
  TRASH: 64,
  RESTORE: 128,
  DELETE: 256,
  MOVE: 512,
  /** recordType */
  TYPE: 1024,
  /** page settings, hidden, template marker */
  META: 2048,
  SCHEMA: 4096,
  VIEW: 8192,
  LOCK: 16384,
  COMMANDS: 32768,
  /** templates, automations, pipeline, subItems, dependencies, record types, view order … */
  DBMETA: 65536,
} as const

/** Flags (bitmask). */
export const F = {
  /** the place was created in this event / segment */
  NEW: 1,
  /** the place was deleted for good in this event / segment */
  GONE: 2,
  /** synced-block copy of another writer's change */
  COPY: 4,
  /** view change limited to propertyWidths / hiddenGroups / calculations */
  LAYOUT: 8,
  /** team: made earlier than received */
  LATE: 16,
  /** several writers in one update */
  BATCH: 32,
  /** team: content before-state was not synced when received */
  STALE: 64,
  /** an unseen change happened right before this segment */
  GAP: 128,
  /** a listener pair arrived out of order (must not happen) */
  ORDER: 256,
  /** the writer was an Undo of another run */
  UNDO: 512,
  /** the person deleted the place for good: its pins were dropped */
  PURGED: 1024,
} as const

/** store `ops` — one per Vorgang (one store update, or a fold of typing). The deck reads only these. */
export interface JOp {
  /** `${s}|${pad13(at)}|${v}` */
  k: string
  s: Scope
  at: number
  /** folded typing: time of the last folded update */
  t2?: number
  /** Vorgang id `${tab}.${n.toString(36)}` */
  v: string
  w: string
  l: LaneKey
  /** run key (flag id) */
  r?: string
  /** places in this Vorgang (after classification) */
  n: number
  kinds: number
  f?: number
  /** the first place */
  p1: PlaceKey
  /** store updates represented */
  ops: number
}

/** store `events` — one per place per Vorgang. */
export interface JEvent {
  /** `${s}|${pad13(at)}|${v}|${i}` */
  k: string
  s: Scope
  at: number
  t2?: number
  v: string
  w: string
  l: LaneKey
  r?: string
  /** staged change id inside the run (agent / terminal) */
  c?: string
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  kinds: number
  f?: number
  ops: number
  /** words added / removed (content), from changed blocks only */
  wa?: number
  wd?: number
  /** blocks changed / added / removed */
  bc?: [number, number, number]
  /** property values changed */
  pc?: number
  /** segment id */
  g: string
  /** HMAC whole digest of the place after this event (12 chars; '-' = gone) */
  lh: string
  /** team: madeAt when |madeAt − at| > 2 min */
  m?: number
  /** SCHEMA / VIEW events only (names allowed) */
  x?: SchemaDelta[]
  /** MOVE: parent before → after */
  mv?: [ID | null, ID | null]
}

export interface LeftHash {
  /** whole-place digest (12 chars) */
  h: string
  /** part key → 8-char digest (NEW places too; records from before R2: {} for NEW places) */
  parts: Record<string, string>
  /** pages: ordered top-level blocks `<blockId>=<digest>` or `#<digest>` */
  blocks?: string[]
}

/** store `segs` — one writer's uninterrupted stretch on one place. */
export interface JSegment {
  /** `${s}|${nanoid}` */
  id: string
  s: Scope
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  /** writer key of the first event */
  w: string
  /** segmentation key */
  sk: string
  l: LaneKey
  r?: string
  /** derived writers: the key of the cause */
  cause?: string
  from: number
  to: number
  n: number
  /** pin id `<placeKey>|<pinId>` — null: NEW place, or the pin could not be written */
  before: string | null
  /** whole digest of the before state ('-' = absent) */
  bh: string
  /** the state this writer left (null while open, or not recoverable → partial) */
  left: LeftHash | null
  /** lh of its last event */
  lastLh: string
  /**
   * rows: the before digest restricted to the property keys this tab's last digest of the place had (a property added
   * or deleted in between changes every row's whole digest, never a value) — set when `bh` differs from it only so
   */
  bhr?: string
  /** part keys this segment changed; > 400 → '*' */
  touched: string[] | '*'
  /** the tab that recorded it */
  tab: string
  /** open (sparse index) */
  o?: 1
  f: number
}

export type RunKind = 'agent' | 'terminal' | 'mcp' | 'script' | 'ai' | 'import' | 'sync' | 'automation' | 'autofill' | 'template' | 'mail' | 'coding' | 'order' | 'eject' | 'rewind'

export interface RunPlaces {
  rows: number
  newRows: number
  pages: number
  newPages: number
  schema: number
  views: number
  trashed: number
  moved: number
}

/** store `runs` — one per run key (flags on the tape). */
export interface JRun {
  /** `${s}|${runKey}` */
  id: string
  s: Scope
  key: string
  l: LaneKey
  kind: RunKind
  /** AgentRun.id · batch id · MCP activity key · ScriptRun.id · AIRun.id · import root id · pickup id · eject id */
  ref: string
  /** ids / fixed keys only — never text */
  meta?: { seq?: number; tool?: string; source?: string; action?: string; client?: string; ai?: string; aiAlso?: string[]; role?: NonNullable<RunMeta['role']>; group?: string; parent?: string }
  from: number
  to: number
  ops: number
  ended?: number
  places: RunPlaces
  /** Σ wa / wd */
  words: [number, number]
  state: 'live' | 'partly-ejected' | 'ejected'
}

/** Histogram bucket (minutes / quarters): Vorgänge per lane. */
export interface JHist {
  k: string
  s: Scope
  /** minute or quarter index (ms / 60k, ms / 900k) */
  m: number
  lanes: Record<LaneKey, number>
}

export interface SchemaDelta {
  part: 'prop+' | 'prop-' | 'prop~' | 'order' | 'opt+' | 'opt-' | 'opt~' | 'view+' | 'view-' | 'view~' | 'lock' | 'commands' | 'dbmeta'
  /** names allowed (`prop~`: the property after the change) */
  prop?: { id: ID; name: string; type: PropertyType }
  /** `prop~` whose type changed: the type before (a record field, not canon — tapes from before it lack it) */
  was?: PropertyType
  /** option names (renames: prev name) */
  opt?: { id: ID; name: string; prev?: string }
  view?: { id: ID; name: string; type: ViewType }
  /** view change limited to widths / hidden groups / calculations */
  layout?: true
}

/** Daily checkpoint per database (R4). */
export interface SchemaSkeleton {
  id: ID
  locked: boolean
  props: Array<{ id: ID; name: string; type: PropertyType; options?: Array<{ id: ID; name: string; color: ColorName }>; relationDatabaseId?: ID; numberFormat?: NumberFormat }>
  views: Array<{
    id: ID
    name: string
    type: ViewType
    groupBy?: ID | null
    visibleProperties: ID[]
    sorts: Array<{ propertyId: ID; direction: 'asc' | 'desc' }>
    hiddenGroups?: string[]
    filterShape: string
  }>
}
export interface Checkpoint {
  k: string
  s: Scope
  day: number
  at: number
  dbs: Record<ID, SchemaSkeleton>
  digest: Record<ID, string>
}

/** A lost tail: a tab died with items it had not written (`kv ${s}|gap|<at>`). */
export interface LostTail {
  from: number
  to: number
  tab: string
}

/** Per-tab record `kv ${s}|tab|<tab>`. */
export interface TabRecord {
  start: number
  lastFlush: number
  clean: boolean
}

/* ------------------------------------------------------------------ */
/* Pins (version store `one-history / snapshots`)                      */
/* ------------------------------------------------------------------ */

/** key `pin:<scope>|m|<placeKey>|<pinId>` */
export type PinMeta =
  | {
      v: 1
      kind: 'page'
      at: number
      seg: string
      /** everything of the page but its content */
      page: Omit<Page, 'content' | 'plain' | 'comments'>
      /** a row's property definitions from the database as it was then */
      defs: SnapshotPropDef[] | null
      /** content digest, or null = empty content */
      body: string | null
      /** onefile ids in the page and its content */
      files: string[]
      /** when the pin was written (the orphan sweep's grace — `at` is the segment's start) */
      wt?: number
    }
  | {
      v: 1
      kind: 'schema'
      at: number
      seg: string
      dbId: ID
      /** the whole database as it was (every canonical part of its schema and views — digests and recovery read them) */
      db: Database
      files: string[]
      wt?: number
    }

/** key `pin:<scope>|b|<pageId>|<cdig>` — `cdig` = the digest of the exact content (ids included) */
export interface PinBody {
  content: JSONContent | null
  /** when it was written or last referred to by a new pin (the orphan sweep's grace) */
  at?: number
}

/* ------------------------------------------------------------------ */
/* Window reading (R2) and the eject (R3)                               */
/* ------------------------------------------------------------------ */

/** What the eject plan does with a place. */
export type Outcome = 'back' | 'trash' | 'restore' | 'recreate' | 'held' | 'partial' | 'already' | 'skip'

/** Why a place (or a part of it) is held / partial / left alone. */
export type Reason =
  | 'changed'
  | 'interleaved'
  | 'locked'
  | 'pageLocked'
  | 'dependsOnHeld'
  | 'noBefore'
  | 'noLeft'
  | 'open'
  | 'cut'
  | 'gap'
  | 'stale'
  | 'batch'
  | 'otherMember'
  | 'notEjectable'
  | 'reviewUndone'
  | 'alreadyEjected'
  | 'children'
  | 'inUse'
  | 'parent'
  | 'ambiguous'
  | 'sent'
  | 'taskElsewhere'
  | 'taskLoop'
  /** a task the window made would go while a live task links it (Blocked by / Related) */
  | 'taskLinked'
  | 'running'
  | 'pipeline'
  | 'memory'
  | 'moved'
  | 'recordType'
  | 'valuesStay'
  | 'unavailable'

/** A selected window: a writer (its lane, or one run of it) in [a, b) of a scope. */
export interface WindowSel {
  scope: Scope
  lane: LaneKey
  run?: string
  a: number
  b: number
}

/** A segment of another writer after W's first touch (lane null = not recorded: a chain break, a GAP flag). */
export interface Foreign {
  from: number
  lane: LaneKey | null
  w: string | null
  touched: string[] | '*'
  seg: string | null
  open: boolean
}

/** One place W touched in the window: W's segments on it, everyone else's after W's first touch, W's events. */
export interface PlaceWindow {
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  own: JSegment[]
  foreign: Foreign[]
  ownEvents: JEvent[]
  /** an own segment reaches outside [a, b) */
  cut: boolean
  /** cloud scope: the object is not in this member's store now — no pin is read, no preview */
  unavailable?: boolean
}

/** A place as it is now: its whole digest, part digests, block digests (pages) and a sync key of its parts. */
export interface NowDigest {
  exists: boolean
  h: string
  parts: Record<string, string>
  blocks?: string[]
  /** partsKey (unkeyed, memory only — never persisted) */
  key: string
}

/** The place-level verdict of the held check (R2) and the planner core (R3). */
export interface PlaceVerdict {
  p: PlaceKey
  pk: PlaceKind
  db?: ID
  outcome: Outcome
  reason?: Reason
  /** who changed it since (foreign segments after W's last segment first, then the ones within) */
  by: Array<{ lane: LaneKey | null; at: number }>
  /** the first foreign segment after W's first touch (the tape's held diamond) and whose it was (its track) */
  firstForeignAt?: number
  firstForeignLane?: LaneKey | null
  /** W's Vorgänge on it in the window */
  ops: number
  span: [number, number]
  /** staged change ids of W's events on it */
  changes: string[]
}

/** The eject's counts (design §6.1): `back` counts back + trash + restore; `all` = back + held + partial (already-ejected places are listed, never counted). */
export interface PlanCounts {
  ops: number
  all: number
  back: number
  held: number
  partial: number
  already: number
  rows: number
  newRows: number
  pages: number
  schema: number
  views: number
}

/** store `ejects` — one per eject (ids, outcomes, digests, counts and times; never text). */
export interface EjectRecord {
  id: string
  s: Scope
  at: number
  tab: string
  writer: string
  lane: LaneKey
  a: number
  b: number
  state: 'committing' | 'done' | 'aborted'
  outcomes: Record<PlaceKey, Outcome>
  /** segments of the places that went back (back | trash | restore) — what `already` compares */
  segs: string[]
  /** places that go back: HMAC digests of the DECIDED parts of the target (+ `blocks`: restored hunks, `<id|#>=<digest>`) */
  targets: Record<PlaceKey, { parts: Record<string, string>; blocks?: string[][] }>
  /** per place: the units of W's events on it in the window — `<runKey>#<change>` (agent / terminal), a run key (an MCP
   * call, a script run: the whole run) (Δ29) */
  changes: Record<PlaceKey, string[]>
  /** W's run keys in the window (the sources a boot settles without a plan) */
  runs?: string[]
  /** the dialog's switch "discard the run's open proposals" */
  pending?: boolean
  counts: PlanCounts
  versionAt: number
  /** the agent runs it settled; `discarded`: the open proposals it discarded (`<runKey>#<change>` — its Undo opens them
   * again); `stateBefore` / `stateAfter`: which run's state the agent had after / before the eject (ids only, never the state) */
  agent?: { agentId: string; runIds: string[]; discarded: string[]; stateBefore?: unknown; stateAfter?: unknown }
  /** Outbox slips it withdrew (they stay withdrawn after its Undo) */
  slips?: number
  undone?: number
}
