/**
 * Who is writing into the store right now — the writer context the flight recorder reads
 * (features/recorder). A synchronous-only stack: `withWriter(w, fn)` pushes a frame, runs `fn` and
 * pops it again. zustand runs its listeners inside `set()`, so a listener sees the exact frame of the
 * write that woke it. Nothing is held across an `await`: async flows carry their `Writer` as a value
 * and open a frame around each synchronous burst of store calls. The innermost frame names the write.
 *
 * No imports from the areas: every area writes through the store and reaches this module without a
 * cross-area import; the recorder only listens.
 */
import type { ID } from './types'

/**
 * 'resume': a write this browser held for a page's first server sync, written by another tab or a later boot (its own
 * tab journaled it when it was made — cloud/content.ts)
 */
export type SystemWhy = 'hydrate' | 'tab' | 'stamp' | 'repair' | 'revert' | 'refused' | 'members' | 'bookkeeping' | 'maintenance' | 'resume'

export type YouVia =
  | 'ui'
  | 'button'
  | 'clip'
  | 'people'
  | 'privacy'
  | 'template'
  | 'setup'
  | 'command'
  | 'memory'
  | 'form'
  | 'journal'
  | 'tour'
  | 'agenda'
  | 'undo'
  /** the Outbox's row patch after "Mark as sent" (features/outbox; its "Reset row" is an Undo) */
  | 'outbox'
  /** a key in Preflight's queue that writes through no source writer of its own (features/preflight/queue/calls.ts) */
  | 'preflight'

/** A writer's canonical id (grammar: features/recorder/model/writerKeys.ts). */
export type WriterKey = string

export type Writer =
  | { kind: 'you'; via?: YouVia; ref?: string }
  /** an editor instance ('collab' = typing in a team workspace; `mixed`: a refresh that carried other writers too) */
  | { kind: 'editor'; id: string; mixed?: true }
  /**
   * an AI terminal apply batch — `change`: the staged change it writes; several written in ONE write (a page's edits, a
   * page's task changes) joined with '+' (writerOfChanges)
   */
  | { kind: 'terminal'; run: string; change?: string }
  /** AI menu accept, transform, redo, image, file, todb, freeboard, meeting, media, split */
  | { kind: 'ai'; run: string; action: string }
  /** a custom agent's run — `change` as the terminal's */
  | { kind: 'agent'; id: ID; run: string; change?: string; remote?: true }
  | { kind: 'mcp'; session: string; call: string; tool: string }
  | { kind: 'script'; id: ID | null; run: string; via?: WriterKey }
  | { kind: 'sync'; source: 'folder' | 'github'; run: string }
  | { kind: 'automation'; db: ID; id: ID; run: string; cause?: WriterKey }
  | { kind: 'autofill'; db: ID; prop: ID; run?: string; cause?: WriterKey }
  /** source: 'md' | 'html' | 'notion' | 'backup' | 'pptx' | 'design' | 'csv' … */
  | { kind: 'import'; run: string; source: string }
  | { kind: 'template'; id: string; run: string; repeat?: true }
  | { kind: 'synced'; cause: WriterKey }
  | { kind: 'history'; snap: ID }
  | { kind: 'mail'; run: string }
  | { kind: 'coding'; task: ID; run: string }
  | { kind: 'kit'; type: ID; cause?: WriterKey }
  /** another member (or me on another device) — team workspaces */
  | { kind: 'member'; account: string }
  | { kind: 'api'; token: string }
  | { kind: 'hook'; id: string }
  | { kind: 'team' }
  /** a remote transaction carrying several writers (per page) — team workspaces */
  | { kind: 'remote'; per: Record<string, WriterKey>; fallback: WriterKey; batch?: true; madeAt?: Record<ID, number> }
  | { kind: 'eject'; id: string; of: WriterKey }
  | { kind: 'rewind'; id: string }
  | { kind: 'system'; why: SystemWhy }
  | { kind: 'unknown' }

/** What a run tells the recorder when it starts (fixed keys and ids only — never text). */
export interface RunMeta {
  seq?: number
  tool?: string
  source?: string
  action?: string
  client?: string
  /** the AI route that served the run's writes ('<provider>:<model id>' — an identifier, never text) */
  ai?: string
  /** routes that took part besides `ai` (≤ 3: the Jev Router that chose the model …) */
  aiAlso?: string[]
  /** the request's role (main · variant · merge · review · fallback · repair · decide) */
  role?: 'main' | 'variant' | 'merge' | 'review' | 'fallback' | 'repair' | 'decide'
  /** runs that belong together (variants of one request) */
  group?: string
  /** the run this one follows from */
  parent?: string
}

/* ------------------------------------------------------------------ */
/* The frame stack                                                     */
/* ------------------------------------------------------------------ */

const stack: Writer[] = []

/** DEV, `?e2e` and Node (the model specs): contract violations throw / are reported loudly. */
function strict(): boolean {
  if (typeof window === 'undefined') return true
  try {
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return true
    return new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
}

const isThenable = (v: unknown): boolean => !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function'

/**
 * Run `fn` as `w`'s write. `fn` must be synchronous (DEV / e2e: a thenable result throws) — async code
 * passes its Writer down and opens a frame per synchronous burst. A nested frame wins.
 */
export function withWriter<T>(w: Writer, fn: () => T): T {
  const depth = stack.length
  stack.push(w)
  let out: T
  try {
    out = fn()
  } finally {
    stack.length = depth
  }
  if (isThenable(out) && strict()) throw new Error('[writer] withWriter() takes a synchronous function — open a frame per burst after each await')
  return out
}

/** The writer of the write happening now (null: no frame open). */
export function currentWriter(): Writer | null {
  return stack.length ? stack[stack.length - 1] : null
}

export const SYSTEM = (why: SystemWhy): Writer => ({ kind: 'system', why })

/**
 * The writer of ONE write carrying these staged changes of a terminal batch or an agent run (a page's edits, a page's
 * task changes): it names every change it writes (`…#c2` alone, `…#c2+c3` together) — each is a unit of the flight
 * recorder on the places of that write, so an eject takes them back and settles them together, all or none. None:
 * the run's own. Other writers as they are.
 */
export function writerOfChanges(w: Writer, changes: readonly string[]): Writer {
  return changes.length && (w.kind === 'terminal' || w.kind === 'agent') ? { ...w, change: changes.join('+') } : w
}

/* ------------------------------------------------------------------ */
/* Writer keys                                                         */
/* ------------------------------------------------------------------ */

const MAX_KEY = 200
/**
 * A change group's room in a key (terminal / agent): it is never cut — a longer group is written as '*' ("changes this
 * key cannot name": the eject holds its places, model/plan.ts)
 */
const MAX_GROUP = 1000
const MAX_CAUSES = 2
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const NAME_RE = /^[a-z0-9_]{1,40}$/
const VIA_RE = /^[a-z]{1,16}$/
const SYSTEM_WHY = new Set<SystemWhy>(['hydrate', 'tab', 'stamp', 'repair', 'revert', 'refused', 'members', 'bookkeeping', 'maintenance', 'resume'])

/** An id part of a key: valid as it is, else '-'. */
const id = (v: unknown): string => (typeof v === 'string' && ID_RE.test(v) ? v : '-')
/** A tool / action / source part: valid as it is, else '-'. */
const name = (v: unknown): string => (typeof v === 'string' && NAME_RE.test(v) ? v : '-')

/** A cause key: only the key alphabet, at most MAX_CAUSES levels deep (the first ones kept). */
function causeOf(key: unknown, depth: number): string {
  if (typeof key !== 'string' || !key || depth <= 0) return ''
  const clean = key.replace(/[^A-Za-z0-9_\-:/#<>~@+.]/g, '-')
  const parts = clean.split('<')
  return parts.slice(0, depth).join('<')
}

/** The staged change(s) part of a terminal / agent key: ids joined with '+', '-' when one is invalid, '*' when too long. */
function changeOf(v: string): string {
  const ids = v.split('+')
  if (ids.length === 1) return id(v)
  if (!ids.every((x) => ID_RE.test(x))) return '-'
  return v.length > MAX_GROUP ? '*' : v
}

const withCause = (base: string, cause: unknown): string => {
  const c = causeOf(cause, MAX_CAUSES)
  return c ? `${base}<${c}` : base
}

function rawKey(w: Writer): string {
  switch (w.kind) {
    case 'you': {
      if (!w.via) return 'you'
      const via = VIA_RE.test(w.via) ? w.via : 'ui'
      return w.ref ? `you~${via}:${id(w.ref)}` : `you~${via}`
    }
    case 'editor':
      return `editor:${id(w.id)}${w.mixed ? '+m' : ''}`
    case 'terminal':
      return `terminal:${id(w.run)}${w.change ? `#${changeOf(w.change)}` : ''}`
    case 'ai':
      return `ai:${id(w.run)}:${name(w.action)}`
    case 'agent':
      return `agent:${id(w.id)}:${id(w.run)}${w.change ? `#${changeOf(w.change)}` : ''}${w.remote ? '@r' : ''}`
    case 'mcp':
      return `mcp:${id(w.session)}:${id(w.call)}:${name(w.tool)}`
    case 'script':
      return withCause(`script:${w.id ? id(w.id) : '-'}:${id(w.run)}`, w.via)
    case 'sync':
      return `sync:${w.source === 'github' ? 'github' : 'folder'}:${id(w.run)}`
    case 'automation':
      return withCause(`automation:${id(w.db)}/${id(w.id)}:${id(w.run)}`, w.cause)
    case 'autofill':
      return withCause(`autofill:${id(w.db)}/${id(w.prop)}${w.run ? `:${id(w.run)}` : ''}`, w.cause)
    case 'import':
      return `import:${id(w.run)}:${name(w.source)}`
    case 'template':
      return `template:${id(w.id)}:${id(w.run)}`
    case 'synced':
      return `synced<${causeOf(w.cause, MAX_CAUSES) || 'unknown'}`
    case 'history':
      return `history:${id(w.snap)}`
    case 'mail':
      return `mail:${id(w.run)}`
    case 'coding':
      return `coding:${id(w.task)}:${id(w.run)}`
    case 'kit':
      return withCause(`kit:${id(w.type)}`, w.cause)
    case 'member':
      return `member:${id(w.account)}`
    case 'api':
      return `api:${id(w.token)}`
    case 'hook':
      return `hook:${id(w.id)}`
    case 'team':
      return 'team'
    case 'remote':
      return causeOf(w.fallback, MAX_CAUSES + 1) || 'unknown'
    case 'eject':
      return `eject:${id(w.id)}>${causeOf(w.of, MAX_CAUSES) || 'unknown'}`
    case 'rewind':
      return `rewind:${id(w.id)}`
    case 'system':
      return `system:${SYSTEM_WHY.has(w.why) ? w.why : 'maintenance'}`
    default:
      return 'unknown'
  }
}

/**
 * The canonical key of a writer (≤ 200 chars — a terminal / agent key plus its change group, never cut; causes at most 2
 * deep, invalid id parts replaced by '-').
 */
export function formatWriterKey(w: Writer): WriterKey {
  let key = rawKey(w)
  // too long: drop the deepest causes first, then cut (never inside the own part)
  while (key.length > MAX_KEY && key.lastIndexOf('<') > 0) key = key.slice(0, key.lastIndexOf('<'))
  const max = w.kind === 'terminal' || w.kind === 'agent' ? MAX_KEY + MAX_GROUP : MAX_KEY
  return key.length > max ? key.slice(0, max) : key
}

/** Events of the person: a store write inside one of them without a frame is theirs (the recorder's fallback, step 3). */
export const USER_EVENTS: ReadonlySet<string> = new Set(['click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'compositionend', 'change', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchend', 'drop', 'dragend', 'paste', 'cut', 'submit', 'blur', 'focusout'])

/**
 * Is the code running now inside an event of the person (a user interaction the browser dispatched)? DEV / e2e also
 * take a synthetic one of those types: there the test driver stands in for the person (Playwright's fill on date and
 * time fields, selectOption and a spec's dispatchEvent send untrusted events), like the test hook's store writes.
 */
export function inPersonEvent(): boolean {
  const ev = typeof window !== 'undefined' ? (window as unknown as { event?: Event }).event : undefined
  if (!ev) return false
  if (RELAYED_EVENTS.has(ev.type)) return true
  if (!USER_EVENTS.has(ev.type)) return false
  return ev.isTrusted || strict()
}

/** Events a component dispatches inside the person's own key or click: cmdk runs a row's onSelect in one (⌘K, Enter). */
const RELAYED_EVENTS: ReadonlySet<string> = new Set(['cmdk-item-select'])

/** Who wrote when no frame is open and it is not the person (the recorder's fallback steps 1–2: a team change, a tab replay). */
let causeWithoutFrame: (() => WriterKey | null) | null = null

/** The recorder names the writes without a frame it can tell (journal/attribute.ts) — the same steps for every cause. */
export function setCauseResolver(fn: (() => WriterKey | null) | null): void {
  causeWithoutFrame = fn
}

/**
 * The key of the writer of the write happening now — for a service that reacts to it later (an automation, autofill,
 * the kit, synced blocks: their `cause`). Read inside a store listener: the triggering write's frame is still open.
 * Without a frame: the recorder's fallback — a team change ('team'), another tab's save replayed ('system:tab'), the
 * person inside a user event ('you~ui') — else 'unknown'.
 */
export function causeKey(): WriterKey {
  const w = currentWriter()
  if (w) return formatWriterKey(w)
  const k = causeWithoutFrame?.()
  if (k) return k
  return inPersonEvent() ? 'you~ui' : 'unknown'
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export interface RunNote {
  w: Writer
  meta?: RunMeta
  end?: true
}

const runListeners = new Set<(e: RunNote) => void>()

/** A run starts (or tells more about itself). The recorder listens. */
export function noteRun(w: Writer, meta?: RunMeta): void {
  const e: RunNote = meta ? { w, meta } : { w }
  runListeners.forEach((l) => l(e))
}

/** A run ended: its open segments close soon. */
export function endRun(w: Writer): void {
  runListeners.forEach((l) => l({ w, end: true }))
}

export function onRunNote(fn: (e: RunNote) => void): () => void {
  runListeners.add(fn)
  return () => runListeners.delete(fn)
}

/* ------------------------------------------------------------------ */
/* Writes without a writer                                             */
/* ------------------------------------------------------------------ */

export interface FallbackReport {
  at: number
  step: string
  places: string[]
  stack: string
}

const fallbacks: FallbackReport[] = []
const warned = new Set<string>()
const MAX_FALLBACKS = 500

/** The call site of a stack: its first frames below the recorder / zustand (once-per-site key). */
function siteOf(stack: string): string {
  const lines = stack.split('\n').filter((l) => /\sat\s/.test(l) && !/writer\.ts|recorder|attribute|zustand|immer/.test(l))
  return lines.slice(0, 3).join('|') || stack.slice(0, 200)
}

/**
 * A store write had no writer frame and fell back to a guess (features/recorder journal/attribute.ts
 * steps 4–6). Kept for the test seam; DEV / e2e: a console error once per call site — the e2e suite fails on
 * it, so every spec is the net for write paths without a writer.
 */
export function reportFallback(step: string, places: string[], stack = ''): void {
  const report: FallbackReport = { at: Date.now(), step, places: places.slice(0, 20), stack }
  fallbacks.push(report)
  if (fallbacks.length > MAX_FALLBACKS) fallbacks.splice(0, fallbacks.length - MAX_FALLBACKS)
  if (!strict() || typeof window === 'undefined') return
  const site = siteOf(stack)
  if (warned.has(site)) return
  warned.add(site)
  console.error('[recorder] write without a writer', step, report.places.join(' '), stack)
}

/** Writes that fell back to a guess (test seam). */
export function fallbackReports(): FallbackReport[] {
  return fallbacks.slice()
}

export function clearFallbackReports(): void {
  fallbacks.length = 0
}
