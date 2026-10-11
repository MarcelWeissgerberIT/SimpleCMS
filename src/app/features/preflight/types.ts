/**
 * Preflight's own types (internal): what the plate shows of a lamp, the device preferences and the small per-member
 * records in localStorage (§9 of the design). Pure — no imports beyond types.
 */
import type { LampId } from './registry'

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
