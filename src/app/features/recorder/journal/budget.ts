/**
 * The journal's room on this device — one budget for every scope, pins included: at most
 * min(250 MB, 10 % of the browser's quota), and never while free room is under max(200 MB, 15 % of the
 * quota). Checked before every flush (the estimate cached 60 s; the journal's size = Σ of the scopes' day
 * sizes, which every write raises and every prune lowers). Over its own cap: prune (pins of the person's old
 * segments, then whole oldest days) down to 90 % of the cap. Too little free room: the tape gives days back
 * only when it holds that much — a shortage it cannot cure pauses recording instead (with a 10 min back-off,
 * or until a prune frees room). The workspace always wins: when its own save (or a team copy's write) fails
 * for lack of room, the journal stops writing (records wait in memory) and gives room back on every failure —
 * two older days, else today's pins oldest first; it resumes with the next successful save.
 */
import { onSaveStatus } from '../../../store/persistence'
import { onCopyHealth } from '../../../store/storageHealth'
import type { Scope } from '../model/types'
import type { FlushGate } from './process'
import { openJournal } from './db'
import { journalBytes } from './prune'

const MB = 1024 * 1024
const CAP_MAX = 250 * MB
const HEADROOM_MIN = 200 * MB
const ESTIMATE_TTL = 60_000
/** a pause for room is checked again after this long (or at once when a prune freed room) */
const ROOM_BACKOFF = 10 * 60_000
/** a team copy's write failed: recording waits this long for the next one to work (a team copy reports no "saved") */
const COPY_BACKOFF = 60_000

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
  /** drop today's pins, oldest first (a share of them) — resolves with the pins dropped */
  pruneTodayPins(): Promise<number>
  /** run a prune between two flushes (never while one stores pins or segments) */
  serial<T>(fn: () => Promise<T>): Promise<T>
  forgetting(scope: Scope): boolean
}

/** A failed write for lack of room (an unknown failure counts: the workspace's save failed, room is what helps). */
export function isRoomError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return true
  const name = String((e as { name?: unknown }).name ?? '')
  const msg = String((e as { message?: unknown }).message ?? '')
  if (name === 'QuotaExceededError' || /quota|disk|space/i.test(msg)) return true
  if (name === 'UnknownError') return true
  // a clone error, a version change, an aborted transaction of another cause: room would not help
  return !name || name === 'Error'
}

export class Budget implements FlushGate {
  private estimate: Estimate | null = null
  private bytes: number | null = null
  private bytesAt = 0
  /** why recording is paused (null: it is not) */
  paused: PauseReason = null
  /** when the pause began (back-offs) */
  private pausedAt = 0
  /** the save pause came from a team copy's write (no "saved" ever ends it: a back-off does) */
  private copyPause = false
  /** a prune for the workspace's failed save is running */
  private giving = false
  /** another failure came meanwhile */
  private again = false
  private offs: Array<() => void> = []
  /** the limits for a quota (the test seam may set its own, to test the cap with a small tape) */
  limitsFor: (quota: number) => { cap: number; headroom: number } = Budget.limits

  constructor(private hooks: BudgetHooks) {}

  start(): void {
    this.offs.push(onSaveStatus((s, e) => this.saveStatus(s, e)))
    this.offs.push(
      onCopyHealth((ok, e) => {
        if (!ok) this.copyFailed(e)
        else if (this.copyPause) this.saveStatus('saved')
      }),
    )
  }

  stop(): void {
    this.offs.forEach((f) => f())
    this.offs = []
  }

  /** The workspace's save status (also the seam's simulation). */
  saveStatus(s: 'idle' | 'saving' | 'saved' | 'error', error?: unknown): void {
    if (s === 'error') this.saveFailed(error, false)
    else if (s === 'saved' && this.paused === 'save') {
      this.paused = null
      this.copyPause = false
    }
  }

  /** A team copy's write failed (y-indexeddb, the copy's own records). */
  copyFailed(error?: unknown): void {
    this.saveFailed(error, true)
  }

  private saveFailed(error: unknown, copy: boolean): void {
    this.paused = 'save'
    this.pausedAt = Date.now()
    this.copyPause = copy
    // every failure for lack of room gives room back (the save retries 1 s, 2 s … 30 s): two older days, else
    // today's pins oldest first — a failure room would not cure only pauses; one that comes while room is being
    // given back gives more once that is done
    if (!isRoomError(error)) return
    if (this.giving) {
      this.again = true
      return
    }
    this.giving = true
    void this.hooks
      .serial(async () => {
        const days = await this.hooks.pruneDays(2).catch(() => 0)
        if (!days) await this.hooks.pruneTodayPins().catch(() => 0)
      })
      .finally(() => {
        this.giving = false
        this.estimate = null
        this.bytes = null
        if (this.again && this.paused === 'save') {
          this.again = false
          this.saveFailed(undefined, this.copyPause)
        }
        this.again = false
      })
  }

  forgetting(scope: Scope): boolean {
    return this.hooks.forgetting(scope)
  }

  wrote(bytes: number): void {
    if (this.bytes !== null) this.bytes += bytes
  }

  /** The device-wide size of the journal (Σ of every scope's day sizes), cached with the estimate. */
  async recorderBytes(): Promise<number> {
    if (this.bytes !== null && Date.now() - this.bytesAt < ESTIMATE_TTL) return this.bytes
    this.bytes = await journalBytes(await openJournal())
    this.bytesAt = Date.now()
    return this.bytes
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

  async allowed(): Promise<boolean> {
    // the workspace's save failed: wait for 'saved' (a team copy: for its next good write, or the back-off)
    if (this.paused === 'save') {
      if (!this.copyPause || Date.now() - this.pausedAt < COPY_BACKOFF) return false
      this.paused = null
      this.copyPause = false
    }
    // a write failed for lack of room twice, or the room ran short: wait for the next prune — or the back-off
    if ((this.paused === 'room' || this.paused === 'quota') && Date.now() - this.pausedAt < ROOM_BACKOFF) return false
    const est = await this.storage()
    if (!est) return this.resume()
    const { cap, headroom } = this.limitsFor(est.quota)
    const mine = await this.recorderBytes()
    const short = headroom - (est.quota - est.usage)
    if (mine <= cap && short <= 0) return this.resume()
    // over: down to 90 % of the cap — and, when free room is short and the tape can make it, by that much more
    const target = Math.min(mine > cap ? cap * 0.9 : mine, short > 0 && mine >= short ? mine - short : mine)
    if (target < mine) {
      await this.hooks.pruneHumanPins().catch(() => 0)
      this.bytes = null
      for (let i = 0; i < 30 && (await this.recorderBytes()) > target; i++) {
        const n = await this.hooks.pruneDays(1).catch(() => 0)
        this.bytes = null
        if (!n) break
      }
    }
    const now = await this.recorderBytes()
    // the free room the tape gave back counts at once (the browser's estimate catches up later)
    const freed = Math.max(0, mine - now)
    if (now > cap || short - freed > 0) {
      this.paused = 'room'
      this.pausedAt = Date.now()
      this.estimate = null
      return false
    }
    if (freed) this.estimate = { ...est, usage: Math.max(0, est.usage - freed) }
    return this.resume()
  }

  private resume(): boolean {
    if (this.paused === 'room' || this.paused === 'quota') this.paused = null
    return true
  }

  async onQuota(): Promise<boolean> {
    const n = await this.hooks.pruneDays(1).catch(() => 0)
    this.estimate = null
    this.bytes = null
    if (!n) {
      this.paused = 'quota'
      this.pausedAt = Date.now()
    }
    return n > 0
  }

  /** A write failed for lack of room again after a day was freed: recording pauses (checked again after the back-off). */
  quotaFailed(): void {
    this.paused = 'quota'
    this.pausedAt = Date.now()
    this.estimate = null
    this.bytes = null
  }

  /** The next check reads the storage estimate and the journal's size afresh. */
  forgetEstimate(): void {
    this.estimate = null
    this.bytes = null
  }

  /** A prune freed room: a pause for room ends (the next flush checks again). */
  freed(): void {
    this.estimate = null
    this.bytes = null
    if (this.paused === 'room' || this.paused === 'quota') this.paused = null
  }
}
