/**
 * Run announcements for screen readers (plan §1.7, §6 U6) — pure. A run's start and its end are said once, politely
 * ("Inbox helper running" / "Inbox-Helfer läuft"; "Inbox helper done · 3 proposals" / "… fertig · 3 Vorschläge"),
 * throttled to one per module per 10 s and one per 3 s overall; the ticking timer is never said.
 *
 * At most two words wait per module: the first (a start is never lost to its own quick end) and the newest (a module
 * that runs every second does not pile up a queue — what is said after the first is its latest state). Everything waits
 * in the order it came. The live region (B14) renders the text with announcementText(a, name, t).
 */
import type { ModuleKey } from '../types'

export type AnnounceSay = 'start' | 'end' | 'failed' | 'held'

export interface Announcement {
  /** increasing per announcer (the live region re-reads the same words when the id changes) */
  id: number
  module: ModuleKey
  say: AnnounceSay
  /** 'end': open proposals the run left (agents) */
  proposals?: number
}

export const PER_MODULE_MS = 10_000
export const OVERALL_MS = 3_000

interface Waiting {
  module: ModuleKey
  say: AnnounceSay
  proposals?: number
  /** first queued (the order) */
  q: number
}

export class Announcer {
  private waiting: Waiting[] = []
  private lastBy = new Map<ModuleKey, number>()
  private lastAt = -Infinity
  private seq = 0
  private order = 0

  /** Something to say about a module (with two waiting for it already, it replaces the newer one). */
  push(module: ModuleKey, say: AnnounceSay, extra: { proposals?: number } = {}): void {
    const mine = this.waiting.filter((x) => x.module === module)
    if (mine.length >= 2) {
      const w = mine[mine.length - 1]
      w.say = say
      if (extra.proposals) w.proposals = extra.proposals
      else delete w.proposals
      return
    }
    this.waiting.push({ module, say, ...(extra.proposals ? { proposals: extra.proposals } : {}), q: this.order++ })
  }

  /** The next announcement due at `now` (null: none may be said yet). Call again until null. */
  take(now: number): Announcement | null {
    if (now < this.lastAt + OVERALL_MS) return null
    let best: Waiting | null = null
    for (const w of this.waiting) {
      if (now < (this.lastBy.get(w.module) ?? -Infinity) + PER_MODULE_MS) continue
      if (!best || w.q < best.q) best = w
    }
    if (!best) return null
    this.waiting.splice(this.waiting.indexOf(best), 1)
    this.lastBy.set(best.module, now)
    this.lastAt = now
    return { id: ++this.seq, module: best.module, say: best.say, ...(best.proposals ? { proposals: best.proposals } : {}) }
  }

  /** When something may be said next (null: nothing waits; 0: at once — nothing was said yet). */
  nextAt(): number | null {
    if (!this.waiting.length) return null
    let at = Infinity
    for (const w of this.waiting) at = Math.min(at, (this.lastBy.get(w.module) ?? -Infinity) + PER_MODULE_MS)
    const due = Math.max(at, this.lastAt + OVERALL_MS)
    return Number.isFinite(due) ? due : 0
  }

  get pending(): number {
    return this.waiting.length
  }

  reset(): void {
    this.waiting = []
    this.lastBy.clear()
    this.lastAt = -Infinity
  }
}

/** The words of an announcement (the live region's text) — `name` is the module's name as the rack shows it. */
export function announcementText(a: Pick<Announcement, 'say' | 'proposals'>, name: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (a.say) {
    case 'start':
      return t('features.patchbay.live.runningSay', { name })
    case 'failed':
      return t('features.patchbay.live.failedSay', { name })
    case 'held':
      return t('features.patchbay.live.heldSay', { name })
    default: {
      if (!a.proposals) return t('features.patchbay.live.doneSayPlain', { name })
      const what = t(a.proposals === 1 ? 'features.patchbay.live.proposals.one' : 'features.patchbay.live.proposals', { n: a.proposals })
      return t('features.patchbay.live.doneSay', { name, what })
    }
  }
}
