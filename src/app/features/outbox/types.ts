/**
 * The Outbox's data (docs/OUTBOX.md): a slip is ONE reviewed tool call that writes to an MCP server — kept on this
 * device only (IndexedDB `one-outbox`, `<scope>|slip|<id>`), never synced, exported or backed up. Pure types.
 */
import type { ID, LocalText, PropertyValue, RouteParam, SendRoute } from '../../store/types'

export type SlipId = string
/** 'out_' + 10 base62 characters */
export const SLIP_ID = /^out_[A-Za-z0-9]{10}$/

export type SendPath = 'worker' | 'hand' | 'tab' | 'connector'

export type SlipState =
  /** a slot without text (a caller staged `draft: null`): Edit only */
  | 'missing'
  | 'ready'
  | 'held'
  /** write-ahead: persisted BEFORE the wire is called (slice 2) */
  | 'sending'
  /** the server said ok — or the person marked it sent by hand */
  | 'sent'
  /** the read-back matched */
  | 'confirmed'
  /** the read-back ran and did not find it */
  | 'unconfirmed'
  /** the call may have run: timeout, link lost, tab died */
  | 'unclear'
  /** failed before the call, or the tool's error with a read-back proving absence */
  | 'failed'
  | 'withdrawn'

export const SLIP_STATES: SlipState[] = ['missing', 'ready', 'held', 'sending', 'sent', 'confirmed', 'unconfirmed', 'unclear', 'failed', 'withdrawn']
/** what counts as open (UNCLEAR too, with a red lamp) */
export const OPEN_STATES: SlipState[] = ['missing', 'ready', 'held', 'sending', 'unclear', 'failed', 'unconfirmed']
/** what went out (or was marked sent by hand) */
export const SENT_STATES: SlipState[] = ['sent', 'confirmed', 'unconfirmed']

export type OriginKind = 'command' | 'manual' | 'loop' | 'meeting' | 'terminal' | 'agent' | 'menu' | 'bridge' | 'api'

export interface SlipOrigin {
  kind: OriginKind
  ref?: string
  label?: string
  agentId?: ID
  runId?: string
}

export type SourceKind = 'text' | 'memory' | 'page' | 'row' | 'record' | 'mcp' | 'mail' | 'file' | 'web' | 'image' | 'transcript' | 'coding' | 'agent'

export interface SourceRef {
  kind: SourceKind
  ref: string
  label: string
  /** computed by the Outbox, never taken from a caller */
  trusted: boolean
  /** a typed value (number, date, checkbox, option, person): never shapes free text */
  typed?: boolean
  /** which MCP server it came from (slice 3) */
  server?: string
  /** normalized addresses found in it (≤ 50): the marks survive a reload without the text */
  addresses: string[]
  /** ≤ 280 characters for the chip's tooltip; full texts are never kept */
  excerpt?: string
}

export interface SealAddress {
  /** as written in the text */
  text: string
  norm: string
  /** foreign: only in foreign text · nowhere: in no source · internal: points into One */
  only: 'foreign' | 'nowhere' | 'internal'
  /** the foreign source's label */
  source?: string
  ticked: boolean
}

export interface Seal {
  /** the sources are fully known — else never clean */
  complete: boolean
  /** untrusted, non-typed sources that shaped free text */
  foreign: number
  /** addresses that need a tick before any send key works */
  addresses: SealAddress[]
  /** hidden code points found ("U+202E") */
  hidden: string[]
  /** slice 3: data from server A (or mail) going to server B */
  cross: boolean
  clean: boolean
}

export interface AfterEntry {
  /** as the route names it (a role or a name) */
  ref: string
  propId: ID | null
  name: string
  before: PropertyValue | null
  after: PropertyValue
  refused?: 'handOnly' | 'unknown' | 'type'
}

export interface Receipt {
  at: number
  path: SendPath
  host: string
  tool: string
  argsHash: string
  /** team: the account id; null locally */
  by: string | null
  preRead: { at: number; from: 'row' | 'record' | 'none'; changed: string[]; forced: boolean }
  result: { isError: boolean; text: string; ids: Record<string, string> }
  readBack: { state: 'match' | 'mismatch' | 'absent' | 'none' | 'error' | 'later'; at?: number }
  rowPatch: { applied: Array<{ propId: ID; before: PropertyValue | null; after: PropertyValue }>; skipped: string[]; resetAt?: number; resetSkipped?: string[] }
  archived: string[]
  mismatch?: Array<{ path: string; reviewed: string; sent: string }>
  usd: number
}

export interface LogLine {
  at: number
  code: string
  v?: Record<string, string | number>
}

export interface Slip {
  v: 1
  id: SlipId
  /** 'local:local' | 'cloud:<wsId>' */
  scope: string
  state: SlipState
  createdAt: number
  updatedAt: number
  origin: SlipOrigin
  createdBy: string | null
  target: { dbId: ID; rowId: ID; key: string; rowTitle: string; serverId: ID; serverName: string; serverUrl: string }
  route: { profileId: string; routeId: string; role?: string; sig: string; tool: string; label: LocalText; snapshot: SendRoute }
  /** the draft text, minutes, an option … */
  params: Record<string, string | number>
  /** EXACTLY what goes out (fillArgs); recomputed on every edit */
  args: Record<string, unknown>
  argsHash: string
  /** the text part (a route with a `draft` param); null for typed-only routes */
  draft: { rev: number; by: 'claude' | 'person' | 'code' | 'caller'; claudeText?: string; seenRev: number | null } | null
  title: string
  /** the person's instruction for the draft (this device only; a redraft takes it again) */
  instruction?: string
  after: AfterEntry[]
  /** inbox item ids archived after the send */
  answers: string[]
  quote?: { text: string; at?: string; label?: string }
  baseline: { at: number; from: 'row' | 'record'; fields: Record<string, string>; labels?: Record<string, string>; latest?: string } | null
  lastCheck?: { at: number; from: 'row' | 'record'; changed: Array<{ field: string; label?: string; before: string; now: string }>; latest?: string; identity?: 'ok' | 'mismatch'; ack?: number }
  sources: SourceRef[]
  seal: Seal
  group?: { id: string; label: string; order: number; include: boolean }
  attempt?: { at: number; path: SendPath; tab: string; forced: boolean }
  receipt?: Receipt
  /** ≤ 30 lines, codes + values only */
  log: LogLine[]
  /** drafting cost in USD */
  usd: number
}

/** What features read (a frozen copy of the stored slip). */
export type SlipView = Readonly<Slip>

/* ------------------------------------------------------------------ the API's shapes */

export type RouteRef = { profileId: string; routeId: string }

export interface ResolvedRoute {
  ref: RouteRef
  role?: string
  label: string
  tool: string
  server: { id: ID; name: string; host: string }
  params: RouteParam[]
  hasCheck: boolean
  hasConfirm: boolean
  via: SendPath[]
  /** e.g. ['worker:none'] — why a path is not usable now */
  usable: { path: SendPath | null; reasons: string[] }
  probe: 'ok' | 'missing' | 'stale' | 'n/a'
  /** the profile's name (the routes panel) */
  profileName: string
  /** the route's text param, if any */
  draftParam: RouteParam | null
}

export type StageRefusal = 'noRoute' | 'inactive' | 'noKey' | 'badKey' | 'rowGone' | 'param' | 'tooLong' | 'limit' | 'storage'

export interface SourceInput {
  kind: SourceKind
  ref: string
  label: string
  text?: string
  server?: string
  typed?: boolean
}

export interface StageInput {
  route: RouteRef
  rowId: ID
  /** null → state 'missing'; absent for typed routes */
  draft?: string | null
  params?: Record<string, string | number>
  title?: string
  origin: SlipOrigin
  sources: SourceInput[]
  quote?: { text: string; at?: string; label?: string }
  answers?: string[]
  group?: { id: string; label: string; order: number; include?: boolean }
  replaces?: SlipId
}

export interface SlipQuery {
  dbId?: ID
  rowId?: ID
  groupId?: string
  origin?: { kind: OriginKind; ref?: string }
  states?: SlipState[]
}

export interface GroupState {
  items: number
  missing: number
  ready: number
  held: number
  sending: number
  sent: number
  confirmed: number
  unclear: number
  failed: number
  included: number
}

export interface OwnSend {
  slipId: SlipId
  role?: string
  tool: string
  at: number
  values: Record<string, unknown>
  ids: Record<string, string>
  state: SlipState
}

export interface TargetRead {
  at: number
  fields: Record<string, string>
  latest?: string
  record: unknown
}

export interface OutboxCounts {
  open: number
  clean: number
  foreign: number
  held: number
  changed: number
  unclear: number
  missing: number
  sentToday: number
}
