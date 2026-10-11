/**
 * Preflight's lamp source registry — dependency-free (types, a Map, an emitter). Built-in lamps register from
 * features/preflight/sources; other areas register their own lamps by importing THIS file directly (the one sanctioned
 * exception to "only through index.ts": preflight/index.ts re-exports UI, and importing it from another area's boot
 * module would form a cycle). The Outbox does it from features/outbox/lamp.ts.
 *
 * A source supplies `subscribe(changed)` (call changed() when the reading may differ — never compute there), an O(k)
 * `read()` (no Claude call, no page-map walk, no network) and optionally `queue` (cards + keys + a Body, P2). Counting
 * runs in idle (engine.ts); the UI reads only `usePreflight`.
 */
import type { ComponentType } from 'react'

/** Built-ins [a-z][a-z0-9-]{1,31}; areas pick a stable one ('outbox', 'recorder', 'tasks'); custom 'c:<lampId>';
 *  profile 'p:<profileId>:<lampId>'. A second registration with the same id replaces the first. */
export type LampId = string

export interface LampReading {
  /** 'off' = the check cannot run here (grey, never red): no permission, not confirmed, timed out, threw */
  state: 'ok' | 'off'
  /** the source's own count (may exceed ids.length) */
  count: number
  /** stable ack ids of what is counted, ≤ 2,000 (the engine hashes them); the queue's item ids are exactly these */
  ids: string[]
  /** grey reason: a message key */
  why?: string
  /** forced level (a sync error is red at count 1, a refused token amber) — wins over the thresholds while count > 0 */
  level?: 'amber' | 'red'
  /** second cap line, ≤ 16 visible characters */
  second?: string
  /** per sub-source, for the rule card */
  parts?: Record<string, number>
  /** superseded today (rule card / slip note), never in count */
  notCards?: number
}

export interface ReadCtx {
  now: number
  signal: AbortSignal
}

export interface LampSourceDef {
  id: LampId
  order: number
  /** ≤ 16 per line, ≤ 2 lines ("\n" = the drawn break); CSS uppercases */
  legend(): string
  /** tab name ≤ 12 */
  short(): string
  /** the rule card sentence */
  rule(): string
  thresholds: { amber: number | null; red: number | null }
  /** blinks when new (default true) */
  flash?: boolean
  /** counts for MASTER CAUTION (default true) */
  master?: boolean
  /** a lamp id it sits after (custom / profile lamps); absent = by order */
  after?: LampId
  /** default true; re-evaluated on every changed() — a lamp not fitted here is not on the panel and not counted */
  fitted?(): boolean
  /**
   * call changed() when the reading may differ: store.subscribe((s, p) => …) with manual comparisons,
   * BroadcastChannels, onRowsChanged — never compute here. Returns the unsubscribe.
   */
  subscribe(changed: () => void): () => void
  /** O(k); no Claude call, no page-map walk, no network; throws → grey 'error' */
  read(ctx: ReadCtx): LampReading | Promise<LampReading>
  /** re-read every minute while the document is visible */
  tick?: boolean
  /** ms after changed() (default 250); 0 for a lamp the person just acted on */
  settle?: number
  /** the screen that fixes it (↵ on a lit cap in P1, the rule card's "Open") */
  open?(): void
  /** a grey lamp's way back; called synchronously in the key press (popups / permission prompts) */
  fix?: { label(): string; run(): void | Promise<void> }
  queue?: QueueSourceDef
}

export type Outcome = 'applied' | 'hand' | 'command' | 'read' | 'discarded'
export type HandWhy = 'startsNow' | 'claudeCode' | 'noBulk' | 'sends' | 'confirm' | 'signIn' | 'needsText' | 'editor' | 'tokens'

export interface QueueItem {
  /** = an id of the reading */
  id: string
  lamp: LampId
  /** 'proposal' | 'terminal' | 'memory' | 'gate' | 'question' | 'failed' | 'confirm' | 'intake' | 'inbox' | 'fix' | 'open' | 'row' | an area's kind ('slip') */
  kind: string
  /** sub-source label (data or a key) */
  tag: string
  refs: { pageId?: string; dbId?: string; agentId?: string; runId?: string; changeId?: string; taskId?: string; slipId?: string; inboxId?: string }
  /** when it appeared */
  at: number
  /** VON HAND reasons as read; actions() recomputes per key at press time */
  hand: HandWhy[]
  /** may ⇧A / X take it at all */
  bulk: boolean
  /** 'reading': the done entry is written when the id leaves the reading */
  resolveBy?: 'action' | 'reading'
  supersedes?: Array<{ at: number }>
  /** set by the queue model, not by sources */
  stale?: boolean
  /** what the card is about, read live by the source (a row's title, a task, a server) — never stored */
  title?: string
  /** a short key before the title (a row's key "NL-201", "#3") */
  keyText?: string
  /** a second line for the compact row (where, what) */
  detail?: string
  /** the order of sub-sources inside one lamp (lower first) */
  sub?: number
  /** the order inside one batch (an agent run's change number: parents before children) */
  n?: number
}

export interface CardAction {
  key: 'a' | 'd' | 'o' | 'r' | 'n' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  label: string
  outcome: Outcome
  /** VON HAND reasons for THIS key, computed now */
  hand?: HandWhy[]
  /** why the key is inert right now — null = usable */
  blocked?: { key: string; vars?: Record<string, string | number> } | null
  input?: { label: string; multiline?: boolean }
  /** must start inside the key press (popups) */
  sync?: boolean
  /** inert while the workspace is read-only here */
  writes?: boolean
  /** its Done will carry an Undo */
  undoable?: boolean
  run(item: QueueItem, input?: string): Promise<Done> | Done
}

export type Done =
  | {
      ok: true
      outcome?: Outcome
      undo?: () => Promise<'undone' | 'kept' | 'final'>
      /** why there is no Undo (a message key) */
      final?: string
      note?: string
      /** the key only went somewhere (opened a page): no done entry, the card stays */
      stay?: true
      /** the source decides by its reading: the card shows "in work" until its id leaves */
      resolve?: 'reading'
      /** a bulk call: the ids it really acted on (default: all it was given) */
      items?: string[]
    }
  /** a message key or text in the UI language; the card stays — `elsewhere`: decided elsewhere meanwhile (a tombstone) */
  | { ok: false; error: string; elsewhere?: true }

export interface QueueSourceDef {
  /** data every card of this lamp needs (IDB records, lazy chunks) — when the queue opens */
  load?(): Promise<void>
  items(ctx: ReadCtx): QueueItem[] | Promise<QueueItem[]>
  /** async per-card data when it becomes the current card — keys are inert until it resolves */
  prepare?(item: QueueItem, signal: AbortSignal): Promise<void>
  /** called at render AND again at press time */
  actions(item: QueueItem): CardAction[]
  /** several cards at once (⇧A, X): one call = one batch; without it the runner goes one by one */
  bulk?: { apply?(items: QueueItem[]): Promise<Done>; discard?(items: QueueItem[]): Promise<Done> }
  /** the body for this source's kinds (built-in kinds have bodies in preflight/ui/bodies) */
  Body?: ComponentType<{ item: QueueItem; expanded: boolean }>
  /** an id in work left the reading: how it ended (a slip sent → 'hand', withdrawn → 'discarded'); default: the key's */
  resolved?(id: string): Outcome | null
}

/* ---------------- the registry */

const sources = new Map<LampId, LampSourceDef>()
const listeners = new Set<() => void>()
let list: readonly LampSourceDef[] = []

function emit(): void {
  list = [...sources.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      console.warn('[one] preflight registry listener failed', e)
    }
  }
}

/** Register a lamp. A second registration with the same id replaces the first. Returns the unregister function. */
export function registerLampSource(def: LampSourceDef): () => void {
  sources.set(def.id, def)
  emit()
  return () => {
    if (sources.get(def.id) !== def) return
    sources.delete(def.id)
    emit()
  }
}

/** Every registered lamp, by order. */
export function lampSources(): readonly LampSourceDef[] {
  return list
}

/** A lamp by id (undefined: not registered). */
export function lampSource(id: LampId): LampSourceDef | undefined {
  return sources.get(id)
}

/** Called after a lamp was registered or removed. Returns the unsubscribe. */
export function onSourcesChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* ---------------- facts other areas hand in (Preflight never imports them) */

/**
 * Whether an Outbox slip is still open — an agent's `send` proposal counts only while its slip is (the Outbox sets
 * this from features/outbox/lamp.ts). null: unknown slip. No probe registered → every `send` proposal counts.
 */
export interface SlipProbe {
  isOpen(slipId: string): boolean | null
  subscribe(changed: () => void): () => void
  /** open the slip in the Outbox (an agent's `send` proposal's A: the Outbox's own cover and press) */
  open?(slipId: string): void
}

let probe: SlipProbe | null = null
const probeListeners = new Set<() => void>()

export function setSlipProbe(p: SlipProbe | null): void {
  probe = p
  for (const fn of probeListeners) fn()
}

export function slipProbe(): SlipProbe | null {
  return probe
}

/** Called when a slip changed (through the probe) or the probe itself was set. Returns the unsubscribe. */
export function onSlips(fn: () => void): () => void {
  probeListeners.add(fn)
  let off = probe?.subscribe(fn) ?? null
  const reprobe = () => {
    off?.()
    off = probe?.subscribe(fn) ?? null
  }
  probeListeners.add(reprobe)
  return () => {
    probeListeners.delete(fn)
    probeListeners.delete(reprobe)
    off?.()
  }
}
