/**
 * The live signal's state machine (plan §1.7, §3.10) — pure: every event comes with its time, so Node specs drive it
 * with a fake clock. live.ts feeds it from the app while `#/patchbay` is open; the UI (B14) reads `snapshot()`.
 *
 * Runs: a run is one (module, run id) — or, for a writer without runs (autofill's watch, a kit relay), one stretch per
 * module. It lights its module's LED from its start; the LED stays on until the run's end (`endRun`, or the stored run's
 * end from another tab) — a stretch without a run id ends after IDLE_MS (10 s) with no note and no write of it (§6 A24:
 * autofill's watch never ends a run); a run with an id that never says its end is let go after SAFETY_MS.
 * Legs: the cables a run lights, 600 ms each, queued in order per run (≤ LEG_CAP waiting — the oldest go first); an
 * agent's start leg waits for its trigger (its run record comes right after its note): until then its writes wait too,
 * so the dots run clock → agent → database. Another tab's run lights the LED and the window only (no write dots).
 * Lamps: an error (an agent run 'error', a failed automation action) is red until the module's next run; 'budget' (the
 * run's own budget) amber; 'held' (the Regler held it) is never red. Announcements: one start and one end per run that
 * started here (announce.ts throttles them).
 */
import type { Leg, LiveModule, LiveState, Model, ModuleKey } from '../types'
import { Announcer, type Announcement } from './announce'
import { clockOf, exitLegs, legIndex, startLegs, writeLegs, type LegIndex, type StartHow, type WritePlace } from './legs'

/** One cable lit, 600 ms from `at`. */
export const LEG_MS = 600
/** legs waiting at most (the oldest dropped) */
export const LEG_CAP = 12
/** a stretch without a run id ends after this long with no note and no write */
export const IDLE_MS = 10_000
/** a run with an id that never says its end is let go after this */
export const SAFETY_MS = 15 * 60_000
/** a clock's FIRED window */
export const FIRED_MS = 60_000

/** A module's live window (this device). */
export interface LiveEntry extends LiveModule {
  /** the run in flight, or the last one (null: a writer without runs) */
  run?: string | null
  /** the newest note or write of the run in flight (ms) */
  last?: number
  /** another tab's run (LED + window only) */
  elsewhere?: true
  /** a server agent: what the team server says ("on the server") */
  server?: true
  /** open proposals the last run left (agents) */
  proposals?: number
}

/** A leg, and the run it belongs to (≤ 1 comet per run at a time — they follow each other). */
export interface LiveLeg extends Leg {
  run: string
}

export interface LiveSnapshot {
  modules: Record<ModuleKey, LiveEntry>
  /** the legs waiting or playing, by time */
  legs: LiveLeg[]
  /** the cables of runs in flight (reduced motion: their static emphasis) */
  hot: string[]
  /** clock → when it fired (shown "FIRED" for 60 s) */
  fired: Record<ModuleKey, number>
  /** the newest announcement (the live region says it once; its id changes per announcement) */
  announce: Announcement | null
}

/** How a run ended: the stored run's status (agents), an automation's outcome, or plain. */
export type RunEnd = 'ok' | 'staged' | 'error' | 'budget' | 'held' | 'skipped'

interface Run {
  key: string
  module: ModuleKey
  run: string | null
  since: number
  last: number
  /** when this run's next leg may start */
  nextAt: number
  edges: Set<string>
  /** the start leg waits for the trigger (an agent's run record) — its legs wait with it */
  deferred: boolean
  buffered: string[][]
  failed: boolean
  /** its start was announced (its end will be too) */
  said: boolean
  elsewhere: boolean
}

const runKey = (module: ModuleKey, run: string | null) => `${module}#${run ?? '-'}`

export class LiveCore {
  /** `onLeg`: every leg as it is queued (the specs' log of dot paths) */
  constructor(private hooks: { onLeg?: (leg: LiveLeg) => void } = {}) {}

  private ix: LegIndex | null = null
  private runs = new Map<string, Run>()
  private lamps = new Map<ModuleKey, LiveEntry>()
  private legs: LiveLeg[] = []
  private fired = new Map<ModuleKey, number>()
  private extra = new Map<ModuleKey, Partial<LiveEntry>>()
  private announcer = new Announcer()
  private said: Announcement | null = null
  private version = 0
  private snap: { v: number; s: LiveSnapshot } | null = null

  setModel(model: Model | null): void {
    this.ix = model ? legIndex(model) : null
  }

  /** A run starts (or goes on). `start`: it is a run of its own (said once); `defer`: its start leg comes with resolve(). */
  begin(module: ModuleKey, run: string | null, now: number, opts: { start?: boolean; how?: StartHow; defer?: boolean; since?: number; elsewhere?: boolean } = {}): void {
    const key = runKey(module, run)
    let r = this.runs.get(key)
    if (!r) {
      r = { key, module, run, since: opts.since ?? now, last: now, nextAt: now, edges: new Set(), deferred: false, buffered: [], failed: false, said: false, elsewhere: !!opts.elsewhere }
      this.runs.set(key, r)
      // a new run: the window starts over (what the last run left — its proposals, "another tab" — goes)
      const { proposals: _p, elsewhere: _e, ...lamp } = this.lamp(module)
      const next: LiveEntry = { ...lamp, state: 'running', since: this.sinceOf(module, r.since), run, last: now }
      if (opts.elsewhere) next.elsewhere = true
      this.lamps.set(module, next)
      if (!opts.elsewhere) {
        if (opts.defer) r.deferred = true
        else this.startLeg(r, opts.how ?? {}, now)
      }
    } else {
      r.last = now
      this.touch(module, now)
    }
    if (opts.start && !r.said) {
      r.said = true
      this.announcer.push(module, 'start')
    }
    this.changed()
  }

  /** The trigger of a deferred start is known: its leg, then the legs that waited for it. */
  resolve(module: ModuleKey, run: string | null, how: StartHow, now: number): void {
    const r = this.runs.get(runKey(module, run))
    if (!r || !r.deferred) return
    r.deferred = false
    this.startLeg(r, how, now)
    for (const group of r.buffered.splice(0)) this.queue(r, group, now)
    this.changed()
  }

  /** A write of a run: the cables to the places it wrote. A write with no run in flight starts one (a kit relay). */
  write(module: ModuleKey, run: string | null, places: readonly WritePlace[], now: number, how: StartHow = {}): void {
    if (!this.ix) return
    const kind = this.ix.mods.get(module)?.kind
    const legs = writeLegs(this.ix, module, places)
    if (kind === 'clock') {
      // a repeating template's clock: it fired, its rows go in — no run of its own
      this.fired.set(module, now)
      if (legs.length) this.queue(this.ghost(module, now), legs, now)
      this.changed()
      return
    }
    const r = this.runs.get(runKey(module, run)) ?? (this.begin(module, run, now, { start: true, how }), this.runs.get(runKey(module, run))!)
    r.last = now
    this.touch(module, now)
    // another tab's run: LED and window only — no write dots
    if (r.elsewhere) return this.changed()
    if (r.deferred) r.buffered.push(legs)
    else this.queue(r, legs, now)
    this.changed()
  }

  /** A way out (an automation's webhook, a pipeline's git action) or another module's start, from a run. */
  exit(module: ModuleKey, run: string | null, target: ModuleKey, now: number, failed = false): void {
    if (!this.ix) return
    const legs = exitLegs(this.ix, module, target)
    const r = this.runs.get(runKey(module, run))
    if (failed && r) r.failed = true
    if (failed && !r) this.lamps.set(module, { ...this.lamp(module), state: 'error' })
    if (legs.length) {
      if (r?.deferred) r.buffered.push(legs)
      else this.queue(r ?? this.ghost(module, now), legs, now)
    }
    if (r) r.last = now
    this.changed()
  }

  /** A run ended (`endRun`, or its stored end): the LED goes out — red after an error, amber over its budget, "held". */
  end(module: ModuleKey, run: string | null, now: number, how: RunEnd = 'ok', extra: { proposals?: number } = {}): void {
    const key = runKey(module, run)
    const r = this.runs.get(key)
    if (!r) {
      // a run this tab never saw start (another tab's, ended before the page opened): its lamp only
      if (how !== 'ok' && how !== 'staged' && how !== 'skipped') this.lamps.set(module, { ...this.lamp(module), state: lampOf(how, false), run })
      this.changed()
      return
    }
    this.runs.delete(key)
    const state = lampOf(how, r.failed)
    const others = [...this.runs.values()].some((x) => x.module === module)
    const { proposals: _p, elsewhere: _e, ...lamp } = this.lamp(module)
    const next: LiveEntry = { ...lamp, state: others ? 'running' : state, since: others ? lamp.since : null, run, last: now }
    if (extra.proposals) next.proposals = extra.proposals
    if (r.elsewhere) next.elsewhere = true
    this.lamps.set(module, next)
    if (r.said) this.announcer.push(module, state === 'error' ? 'failed' : state === 'held' ? 'held' : 'end', extra.proposals ? { proposals: extra.proposals } : {})
    this.changed()
  }

  /** A module's lamp outside any run in flight (on open: an automation's last error, an agent's last run, a server's). */
  lampTo(module: ModuleKey, state: LiveState, extra: Partial<LiveEntry> = {}): void {
    if ([...this.runs.values()].some((r) => r.module === module && !r.elsewhere)) return
    this.lamps.set(module, { ...this.lamp(module), state, ...extra })
    this.changed()
  }

  /** What else a module's window shows (a database's "+3 FOR REVIEW", a run's cost) — replaced as a whole per module. */
  setExtra(module: ModuleKey, extra: Partial<LiveEntry> | null): void {
    if (extra) this.extra.set(module, extra)
    else this.extra.delete(module)
    this.changed()
  }

  /** Is a run in flight here? */
  running(module: ModuleKey, run: string | null): boolean {
    return this.runs.has(runKey(module, run))
  }

  /** Time passes: idle stretches end, played legs go, FIRED windows close, announcements are said. */
  tick(now: number): void {
    for (const r of [...this.runs.values()]) {
      const idle = now - r.last
      if ((r.run === null && idle >= IDLE_MS) || idle >= SAFETY_MS) this.end(r.module, r.run, now, r.failed ? 'error' : 'ok')
    }
    const before = this.legs.length
    this.legs = this.legs.filter((l) => l.at + LEG_MS > now)
    if (this.legs.length !== before) this.changed()
    for (const [k, at] of this.fired)
      if (now - at >= FIRED_MS) {
        this.fired.delete(k)
        this.changed()
      }
    const a = this.announcer.take(now)
    if (a) {
      this.said = a
      this.changed()
    }
  }

  /** When tick() has something to do next (null: nothing waits — the glue stops its timer). */
  nextDue(): number | null {
    let at = Infinity
    for (const r of this.runs.values()) at = Math.min(at, r.last + (r.run === null ? IDLE_MS : SAFETY_MS))
    for (const l of this.legs) at = Math.min(at, l.at + LEG_MS)
    for (const f of this.fired.values()) at = Math.min(at, f + FIRED_MS)
    const a = this.announcer.nextAt()
    if (a !== null) at = Math.min(at, a)
    return Number.isFinite(at) ? at : null
  }

  snapshot(): LiveSnapshot {
    if (this.snap && this.snap.v === this.version) return this.snap.s
    const modules: Record<ModuleKey, LiveEntry> = {}
    for (const [k, v] of this.lamps) modules[k] = v
    for (const [k, v] of this.extra) modules[k] = { ...(modules[k] ?? { state: 'idle', since: null, cost: null }), ...v }
    const hot = new Set<string>()
    for (const r of this.runs.values()) for (const e of r.edges) hot.add(e)
    const s: LiveSnapshot = { modules, legs: [...this.legs], hot: [...hot], fired: Object.fromEntries(this.fired), announce: this.said }
    this.snap = { v: this.version, s }
    return s
  }

  /** Forget everything (another workspace, the route closed). */
  reset(): void {
    this.runs.clear()
    this.lamps.clear()
    this.legs = []
    this.fired.clear()
    this.extra.clear()
    this.announcer.reset()
    this.said = null
    this.changed()
  }

  /* ---------------------------------------------------------------- */

  private lamp(module: ModuleKey): LiveEntry {
    return this.lamps.get(module) ?? { state: 'idle', since: null, cost: null }
  }

  /** The window's timer counts from the oldest run of the module in flight. */
  private sinceOf(module: ModuleKey, since: number): number {
    let at = since
    for (const r of this.runs.values()) if (r.module === module) at = Math.min(at, r.since)
    return at
  }

  private touch(module: ModuleKey, now: number): void {
    const lamp = this.lamps.get(module)
    if (lamp) this.lamps.set(module, { ...lamp, last: now })
  }

  private startLeg(r: Run, how: StartHow, now: number): void {
    if (!this.ix) return
    const legs = startLegs(this.ix, r.module, how)
    const clock = clockOf(this.ix, legs)
    if (clock) this.fired.set(clock, now)
    this.queue(r, legs, now)
  }

  /** A run-less carrier for legs of no run in flight (a clock's rows, an action noted after its run ended). */
  private ghost(module: ModuleKey, now: number): Run {
    return { key: `${module}#~`, module, run: null, since: now, last: now, nextAt: now, edges: new Set(), deferred: false, buffered: [], failed: false, said: false, elsewhere: false }
  }

  private queue(r: Run, edges: readonly string[], now: number): void {
    for (const edgeId of edges) {
      // a cable this run lit and is still playing / waiting is not lit again
      if (this.legs.some((l) => l.run === r.key && l.edgeId === edgeId)) continue
      const at = Math.max(now, r.nextAt)
      r.nextAt = at + LEG_MS
      r.edges.add(edgeId)
      const leg: LiveLeg = { edgeId, at, run: r.key }
      this.legs.push(leg)
      this.hooks.onLeg?.(leg)
    }
    this.legs.sort((a, b) => a.at - b.at)
    if (this.legs.length > LEG_CAP) this.legs = this.legs.slice(this.legs.length - LEG_CAP)
  }

  private changed(): void {
    this.version++
  }
}

/** The lamp a run's end leaves: red after an error, amber over its own budget, "held" — never red — when the Regler held it. */
function lampOf(how: RunEnd, failed: boolean): LiveState {
  if (failed || how === 'error') return 'error'
  if (how === 'budget') return 'budget'
  if (how === 'held') return 'held'
  return 'idle'
}
