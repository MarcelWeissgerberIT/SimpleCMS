/**
 * Runs — the pure part of the one run bus (plan §1.6, §1.7, §6 A24 / A25). Node specs load it: no store, no DOM.
 *
 *  - moduleOfWriter(w, look) / moduleOfKey(key, look): which rack module a writer (or a writer key — an automation's
 *    `cause`) is — agent · automation · script · autofill · mail organise · kit relay · pipeline · sync · the bridge ·
 *    a repeating template's clock; null for everything else (the person, an editor, the AI menu, the terminal …).
 *  - runOfWriter(w): the run id a writer carries (null: a writer without runs — autofill's watch, a kit relay).
 *  - RunBook: what a run note means. `noteRun` is no start event (§6 A24): it also means "tells more about itself"
 *    (runMeta.ts aiWriterOf, mail/writer.ts, autofill writeProposal). A run starts ONCE per (writer kind, run id) — a
 *    second note of a run counted already adds nothing. A writer without a run id starts one per note without meta;
 *    a note with meta fills the slot such a note opened (the same fill telling more), else it is a fill of its own
 *    (today's watch notes with meta only). An agent's note without its `seq` is a review applying its proposals ("the
 *    run goes on", review.ts) — never a start.
 *  - the day's tally record (`<scope>|runs|<day>` in IndexedDB `one-patchbay`): addToTally(stored, hits) — the
 *    reducer idb-keyval `update` runs inside one transaction (two tabs never lose a count; a run another tab counted
 *    already — `seen` — is not counted twice), isTally, sumRuns(record, drawn), dayOf(at) (the local day).
 */
import type { RunNote, Writer, WriterKey } from '../../../store/writer'
import type { ID } from '../../../store/types'
import type { ModuleKey, RunTally } from '../types'
import { moduleKey } from '../ref'

/** What the mapping needs to know of the workspace (O(1) reads; Node specs pass plain functions). */
export interface WriterLookups {
  /** the pipeline database of a coding task (its row's database) */
  taskDb(task: ID): ID | null
  /** this device's Mails database (mail organise writes there) */
  mailDb(): ID | null
  /** the kit relay of an own property type in a database (a write's database) */
  kitIn?(type: ID, db: ID | null): ModuleKey | null
  /** the automation a script is folded into (§1.15) — its writes are the automation's */
  foldOf?(script: ID): ModuleKey | null
}

/** Where a write lands — what some writers need to name their module (a kit relay's, a repeating template's database). */
export interface WriteAt {
  db?: ID | null
}

/** The run id a writer carries (null: none — autofill's watch, a kit relay, the person). */
export function runOfWriter(w: Writer): string | null {
  switch (w.kind) {
    case 'agent':
    case 'automation':
    case 'script':
    case 'ai':
    case 'coding':
    case 'sync':
    case 'template':
    case 'mail':
    case 'terminal':
    case 'import':
      return w.run || null
    case 'autofill':
      return w.run ?? null
    case 'mcp':
      return w.call || null
    default:
      return null
  }
}

/** The rack module a writer is (null: not a module — the person, an editor, the AI menu …). */
export function moduleOfWriter(w: Writer, look: WriterLookups, at: WriteAt = {}): ModuleKey | null {
  switch (w.kind) {
    case 'agent':
      return moduleKey({ kind: 'agent', id: w.id })
    case 'automation':
      return moduleKey({ kind: 'automation', db: w.db, id: w.id })
    case 'script':
      if (!w.id) return null
      return look.foldOf?.(w.id) ?? moduleKey({ kind: 'script', id: w.id })
    case 'autofill':
      return moduleKey({ kind: 'autofill', db: w.db, prop: w.prop })
    case 'ai': {
      if (w.action !== 'mail_organise') return null
      return moduleKey({ kind: 'organise', db: look.mailDb() })
    }
    case 'kit':
      return look.kitIn?.(w.type, at.db ?? null) ?? null
    case 'coding': {
      const db = look.taskDb(w.task)
      return db ? moduleKey({ kind: 'pipeline', db, pipeline: 'coding' }) : null
    }
    case 'sync':
      return moduleKey({ kind: 'sync', source: w.source === 'github' ? 'github' : 'folder' })
    case 'mcp':
      return moduleKey({ kind: 'bridge' })
    case 'template':
      return w.repeat && at.db ? moduleKey({ kind: 'clock', schedule: '', agents: [], template: { db: at.db, id: w.id } }) : null
    default:
      return null
  }
}

/** A writer key (an automation's / autofill's `cause`) as the writer it names — enough of it to find its module. */
export function writerOfKey(key: WriterKey | null | undefined): Writer | null {
  if (typeof key !== 'string' || !key) return null
  const own = key.split('<')[0]
  const head = own.slice(0, own.indexOf(':'))
  const parts = own.split(':')
  const id = (v: string | undefined) => (v && v !== '-' ? v.split('#')[0].split('@')[0] : '')
  switch (head) {
    case 'agent':
      return id(parts[1]) ? { kind: 'agent', id: id(parts[1]), run: id(parts[2]) } : null
    case 'automation': {
      const [db, au] = (parts[1] ?? '').split('/')
      return db && au ? { kind: 'automation', db, id: au, run: id(parts[2]) } : null
    }
    case 'script':
      return { kind: 'script', id: id(parts[1]) || null, run: id(parts[2]) }
    case 'autofill': {
      const [db, prop] = (parts[1] ?? '').split('/')
      return db && prop ? { kind: 'autofill', db, prop, ...(id(parts[2]) ? { run: id(parts[2]) } : {}) } : null
    }
    case 'kit':
      return id(parts[1]) ? { kind: 'kit', type: id(parts[1]) } : null
    case 'mcp':
      return { kind: 'mcp', session: id(parts[1]), call: id(parts[2]), tool: parts[3] ?? '' }
    case 'coding':
      return id(parts[1]) ? { kind: 'coding', task: id(parts[1]), run: id(parts[2]) } : null
    case 'sync':
      return { kind: 'sync', source: parts[1] === 'github' ? 'github' : 'folder', run: id(parts[2]) }
    case 'ai':
      return { kind: 'ai', run: id(parts[1]), action: parts[2] ?? '' }
    case 'template':
      // the key does not say whether it was a repeat: the caller checks that the clock is on the rack
      return id(parts[1]) ? { kind: 'template', id: id(parts[1]), run: id(parts[2]), repeat: true } : null
    default:
      return null
  }
}

/** The module a writer key names (null: the person, an editor, the system …). */
export const moduleOfKey = (key: WriterKey | null | undefined, look: WriterLookups, at: WriteAt = {}): ModuleKey | null => {
  const w = writerOfKey(key)
  return w ? moduleOfWriter(w, look, at) : null
}

/* ------------------------------------------------------------------ what a note means */

/** A run note read: the module, the run, and whether it starts a run (counted, announced) or goes on with one. */
export interface NoteRead {
  module: ModuleKey
  /** the writer's run id (null: a writer without runs) */
  run: string | null
  /** this note starts a run: count it, announce it */
  start: boolean
  /** the run ended (endRun) */
  end: boolean
  /** `${kind}:${run}` — the run's identity across tabs (null: a writer without runs) */
  seen: string | null
}

/** How many run ids one book remembers (the newest; a run older than that cannot note again in practice). */
const BOOK_MAX = 4096

/**
 * The meaning of each run note, in order (one book per listener: the bus's tally, the live signal's announcements).
 * `read(note)` → null when the note is not about a rack module.
 */
export class RunBook {
  private seen = new Set<string>()
  /** run-less writers: notes without meta not yet told more about, per module */
  private slots = new Map<ModuleKey, number>()

  constructor(private look: WriterLookups) {}

  read(e: RunNote): NoteRead | null {
    const module = moduleOfWriter(e.w, this.look)
    if (!module) return null
    const run = runOfWriter(e.w)
    const seen = run ? `${e.w.kind}:${run}` : null
    if (e.end) return { module, run, start: false, end: true, seen }
    // an agent: the runner's start carries its seq; a review applying proposals (meta-less) or a replayed write goes on
    if (e.w.kind === 'agent' && (e.w.remote || typeof e.meta?.seq !== 'number')) return { module, run, start: false, end: false, seen }
    if (seen) {
      if (this.seen.has(seen)) return { module, run, start: false, end: false, seen }
      this.seen.add(seen)
      if (this.seen.size > BOOK_MAX) this.seen.delete(this.seen.values().next().value as string)
      return { module, run, start: true, end: false, seen }
    }
    const open = this.slots.get(module) ?? 0
    if (!e.meta) {
      this.slots.set(module, open + 1)
      return { module, run, start: true, end: false, seen }
    }
    if (open > 0) {
      this.slots.set(module, open - 1)
      return { module, run, start: false, end: false, seen }
    }
    return { module, run, start: true, end: false, seen }
  }

  /** Forget everything (a wipe, another workspace). */
  reset(): void {
    this.seen.clear()
    this.slots.clear()
  }
}

/* ------------------------------------------------------------------ the day's record */

/** One counted start, as the bus hands it to the store. */
export interface TallyHit {
  module: ModuleKey
  at: number
  /** the run's identity (`${kind}:${run}`) — a run another tab counted already is not counted again */
  seen?: string | null
}

/** The stored record of a day (`<scope>|runs|<day>`): runs per module, the last start, the runs counted. */
export interface TallyRecord extends RunTally {
  v: 1
  /** the runs counted (newest last, ≤ SEEN_MAX) */
  seen: string[]
}

export const SEEN_MAX = 1000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isCounts = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)

/** A stored record this build can read (anything else reads as none). */
export function isTally(v: unknown): v is TallyRecord {
  return isObj(v) && isCounts(v.n) && isCounts(v.last) && (v.seen === undefined || (Array.isArray(v.seen) && v.seen.every((s) => typeof s === 'string')))
}

export const EMPTY_TALLY: TallyRecord = Object.freeze({ v: 1, n: Object.freeze({}), last: Object.freeze({}), seen: Object.freeze([]) as unknown as string[] }) as TallyRecord

/** The record with these starts added (pure — idb-keyval `update` runs it inside one transaction). */
export function addToTally(cur: unknown, hits: readonly TallyHit[]): TallyRecord {
  const rec = isTally(cur) ? cur : EMPTY_TALLY
  const n = { ...rec.n }
  const last = { ...rec.last }
  const seen = [...(rec.seen ?? [])]
  const had = new Set(seen)
  for (const h of hits) {
    if (h.seen) {
      if (had.has(h.seen)) continue
      had.add(h.seen)
      seen.push(h.seen)
    }
    n[h.module] = (n[h.module] ?? 0) + 1
    last[h.module] = Math.max(last[h.module] ?? 0, h.at)
  }
  return { v: 1, n, last, seen: seen.length > SEEN_MAX ? seen.slice(seen.length - SEEN_MAX) : seen }
}

/** Runs today over the drawn modules only (the readout's "RUNS TODAY n" matches what is on the rack). */
export function sumRuns(rec: Pick<RunTally, 'n'> | null | undefined, drawn: Iterable<ModuleKey>): number {
  if (!rec) return 0
  let sum = 0
  for (const k of new Set(drawn)) sum += rec.n[k] ?? 0
  return sum
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day of a time, 'yyyy-MM-dd' (the tally rolls at local midnight — the ledger's day too). */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The next local midnight after a time (ms). */
export function nextMidnight(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** The local midnight a time's day began (ms). */
export function startOfDay(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
