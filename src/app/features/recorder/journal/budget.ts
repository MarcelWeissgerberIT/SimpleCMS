/**
 * The journal's room on this device — one budget for every scope, pins included: at most
 * min(250 MB, 10 % of the browser's quota), and never while free room is under max(200 MB, 15 % of the
 * quota). Checked before every flush (the estimate cached 60 s). Over: prune first (pins of the person's
 * old segments, then whole oldest days); still over: recording pauses until a prune frees room. The
 * workspace always wins: when its own save fails, the journal stops writing (records wait in memory) and
 * gives two days back; it resumes with the next successful save.
 */
import { onSaveStatus } from '../../../store/persistence'
import type { Scope } from '../model/types'
import type { FlushGate } from './process'
import { openJournal, HI } from './db'

const MB = 1024 * 1024
const CAP_MAX = 250 * MB
const HEADROOM_MIN = 200 * MB
const ESTIMATE_TTL = 60_000

export type PauseReason = 'save' | 'room' | 'quota' | null

interface Estimate {
  at: number
  quota: number
  usage: number
}

export interface BudgetHooks {
  /** prune whole oldest days (all scopes) — resolves with the number of days removed */
  pruneDays(days: number): Promise<number>
  /** drop the pins of the person's segments older than 7 days — resolves with the pins dropped */
  pruneHumanPins(): Promise<number>
  forgetting(scope: Scope): boolean
}

export class Budget implements FlushGate {
  private estimate: Estimate | null = null
  private bytes: number | null = null
  private bytesAt = 0
  /** why recording is paused (null: it is not) */
  paused: PauseReason = null
  private offSave: (() => void) | null = null

  constructor(private hooks: BudgetHooks) {}

  start(): void {
    this.offSave = onSaveStatus((s) => this.saveStatus(s))
  }

  stop(): void {
    this.offSave?.()
    this.offSave = null
  }

  /** The workspace's save status (also the seam's simulation). */
  saveStatus(s: 'idle' | 'saving' | 'saved' | 'error'): void {
    if (s === 'error') {
      if (this.paused !== 'save') {
        this.paused = 'save'
        void this.hooks.pruneDays(2).catch(() => undefined)
      }
    } else if (s === 'saved' && this.paused === 'save') this.paused = null
  }

  forgetting(scope: Scope): boolean {
    return this.hooks.forgetting(scope)
  }

  wrote(bytes: number): void {
    if (this.bytes !== null) this.bytes += bytes
  }

  /** The device-wide size of the journal (Σ per-tab counters of every scope), cached with the estimate. */
  async recorderBytes(): Promise<number> {
    if (this.bytes !== null && Date.now() - this.bytesAt < ESTIMATE_TTL) return this.bytes
    const j = await openJournal()
    const recs = await j.range<{ k: string; bytes?: number }>({ store: 'kv', lo: '', hi: HI })
    let n = 0
    for (const r of recs) if (/\|n\|/.test(r.k)) n += Number(r.bytes ?? 0)
    this.bytes = n
    this.bytesAt = Date.now()
    return n
  }

  private async storage(): Promise<Estimate | null> {
    if (this.estimate && Date.now() - this.estimate.at < ESTIMATE_TTL) return this.estimate
    try {
      const e = await navigator.storage?.estimate?.()
      if (!e?.quota) return null
      this.estimate = { at: Date.now(), quota: e.quota, usage: e.usage ?? 0 }
      return this.estimate
    } catch {
      return null
    }
  }

  /** Limits for a quota. */
  static limits(quota: number): { cap: number; headroom: number } {
    return { cap: Math.min(CAP_MAX, quota * 0.1), headroom: Math.max(HEADROOM_MIN, quota * 0.15) }
  }

  private async over(): Promise<boolean> {
    const est = await this.storage()
    if (!est) return false
    const { cap, headroom } = Budget.limits(est.quota)
    const mine = await this.recorderBytes()
    return mine > cap || est.quota - est.usage < headroom
  }

  async allowed(): Promise<boolean> {
    // the workspace's save failed, or a write failed for lack of room twice: wait for 'saved' / the next prune
    if (this.paused === 'save' || this.paused === 'quota') return false
    if (!(await this.over())) {
      if (this.paused === 'room') this.paused = null
      return true
    }
    // over: the person's old pins first, then whole days, until under 90 % of the cap
    await this.hooks.pruneHumanPins().catch(() => 0)
    this.estimate = null
    this.bytes = null
    for (let i = 0; i < 30 && (await this.over()); i++) {
      const n = await this.hooks.pruneDays(1).catch(() => 0)
      this.estimate = null
      this.bytes = null
      if (!n) break
    }
    if (await this.over()) {
      this.paused = 'room'
      return false
    }
    if (this.paused === 'room') this.paused = null
    return true
  }

  async onQuota(): Promise<boolean> {
    const n = await this.hooks.pruneDays(1).catch(() => 0)
    this.estimate = null
    this.bytes = null
    if (!n) this.paused = 'quota'
    return n > 0
  }

  /** A prune freed room: a pause for room ends. */
  freed(): void {
    this.estimate = null
    this.bytes = null
    if (this.paused === 'room' || this.paused === 'quota') this.paused = null
  }
}
