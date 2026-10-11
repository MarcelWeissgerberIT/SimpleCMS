/**
 * Preflight's own types (internal): what the plate shows of a lamp, the device preferences and the small per-member
 * records in localStorage (§9 of the design). Pure — no imports beyond types.
 */
import type { Done, LampId, Outcome, QueueItem } from './registry'

export type Level = 'dark' | 'amber' | 'red' | 'grey'

/** What the plate shows of one lamp (engine.ts builds it from a reading, the ack record and the source). */
export interface LampView {
  id: LampId
  order: number
  legend: string
  short: string
  /** the second cap line ('' = none) */
  second: string
  rule: string
  level: Level
  count: number
  /** FNV-1a over the reading's ids (hex) */
  idsHash: string
  /** grey reason (a message key) */
  why?: string
  /** something arrived since the last acknowledgement (amber / red lamps only) */
  isNew: boolean
  /** how many ids are new */
  newCount: number
  /** the chip on the cap: '+n' (n ≥ 2) or 'new' (one id, or no acknowledgement on this device yet) */
  chip: 'plus' | 'new' | null
  flash: boolean
  master: boolean
  hasQueue: boolean
  /** how long the last read took (rule card "Cost") */
  ms: number
  /** when it was read (rule card "counted HH:mm") */
  at: number
  amber: number | null
  red: number | null
  /** the level the source forced (wins over the thresholds while count > 0) */
  forced?: 'amber' | 'red'
  parts?: Record<string, number>
  notCards?: number
  hasOpen: boolean
  hasFix: boolean
}

/** Device preferences (localStorage one.preflight.prefs; written only by PreflightSettings). */
export interface PreflightPrefs {
  /** Preflight on Start */
  on: boolean
  /** a new Preflight day begins at (HH:mm, local time) */
  at: string
  /** the first boot of a Preflight day stays on the plate when lamps were lit last time */
  hold: boolean
  /** the lamp test once a day */
  test: boolean
}

/** The Preflight day of this member on this device (one.preflight.today:<scope>). */
export interface TodayRecord {
  /** yyyy-MM-dd (the Preflight day) */
  day: string
  /** the boot hold was decided today (consumed whatever it answered) */
  held?: true
  /** the full plate was shown today */
  shown?: true
  test?: 'ran' | 'skipped' | 'off'
  /** the new lamps at the last fold or at the day's first full render */
  base: LampId[]
}

/** The lit lamps when last counted (one.preflight.last:<scope>): ids and levels only. */
export interface LastCache {
  at: number
  lamps: Array<[LampId, Level]>
}

/** One lamp's acknowledgement: the count, the hash of the acked id set, the hashes (≤ 300), when. */
export interface AckEntry {
  n: number
  h: string
  set: string[]
  at: number
}

export interface AckRecord {
  v: 1
  lamps: Record<LampId, AckEntry>
}

export type PlateMode = 'off' | 'full' | 'strip'

/** One event of the Bordbuch (IndexedDB one-preflight, `<scope>|log|<day>`): ids, kinds, times, outcomes — never text. */
export type PreflightLog =
  | { at: number; k: 'test'; ok?: number; of?: number; flash?: number; skipped?: 'motion' | 'off' }
  | { at: number; k: 'ack'; lamp: LampId; n: number; how: 'enter' | 'mc' | 'open' }
  | { at: number; k: 'card'; lamp: LampId; item: string; outcome: Outcome; kind: string; batch?: string; refs: QueueItem['refs'] }
  | { at: number; k: 'undo'; item: string; lamp?: LampId; batch?: string }
  | { at: number; k: 'source'; lamp: LampId; ref: string; n: number; sup?: number }
  | { at: number; k: 'fold' | 'unfold' | 'clear' | 'relit' }

export type PreflightLogKind = PreflightLog['k']

/** A day of the Bordbuch as stored. */
export interface LogDay {
  v: 1
  day: string
  events: PreflightLog[]
}

/** One card done in this tab today (Z undoes the newest; a batch goes back together). */
export interface DoneEntry {
  id: string
  lamp: LampId
  outcome: Outcome
  at: number
  batch?: string
  undo?: Extract<Done, { ok: true }>['undo']
  /** why it has no Undo (a message key) */
  final?: string
  /** a note the source handed back ("+2 dependants") */
  note?: string
  /** marked once its Undo ran ('undone') */
  undone?: boolean
  label: { kind: string; refs: QueueItem['refs'] }
}
