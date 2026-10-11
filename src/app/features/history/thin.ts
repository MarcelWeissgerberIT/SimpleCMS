/**
 * Version history — thinning a page's version list (pure; snapshots.ts re-exports it): dense recently, sparser with
 * age, at most MAX_SNAPSHOTS.
 */
import type { SnapshotMeta, SnapshotReason } from './snapshots'

export const MAX_SNAPSHOTS = 100

/** Versions the flight recorder wrote before an eject / a bring-back: kept on their own for 30 days. */
const KEPT_REASONS: ReadonlySet<SnapshotReason> = new Set(['eject', 'rewind'])

/**
 * Thin a snapshot list (oldest → newest) down to `max`: everything from the last hour stays,
 * then one per 10 min (24 h), one per hour (7 d), one per day (30 d), one per week after that.
 * Within a bucket the newest snapshot survives. "Before the eject" / "before bringing back" versions
 * younger than 30 days keep a bucket of their own, and the hard cap drops other versions first.
 * Pure; exported for testing.
 */
export function thinSnapshots(list: SnapshotMeta[], max = MAX_SNAPSHOTS, now = Date.now()): { keep: SnapshotMeta[]; drop: SnapshotMeta[] } {
  if (list.length <= max) return { keep: list, drop: [] }
  const MIN = 60_000
  const H = 60 * MIN
  const D = 24 * H
  const kept = (m: SnapshotMeta) => KEPT_REASONS.has(m.reason) && now - m.at < 30 * D
  const bucketOf = (m: SnapshotMeta): string => {
    const age = now - m.at
    if (age < H || kept(m)) return `x${m.id}`
    if (age < D) return `m${Math.floor(m.at / (10 * MIN))}`
    if (age < 7 * D) return `h${Math.floor(m.at / H)}`
    if (age < 30 * D) return `d${Math.floor(m.at / D)}`
    return `w${Math.floor(m.at / (7 * D))}`
  }
  const seen = new Set<string>()
  const keepRev: SnapshotMeta[] = []
  const drop: SnapshotMeta[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    const b = bucketOf(m)
    if (seen.has(b)) drop.push(m)
    else {
      seen.add(b)
      keepRev.push(m)
    }
  }
  let keep = keepRev.reverse()
  if (keep.length > max) {
    // the oldest go first — other versions before the ones kept for an eject
    const over = keep.length - max
    const out = new Set<SnapshotMeta>()
    for (const pass of [(m: SnapshotMeta) => !kept(m), () => true])
      for (const m of keep) {
        if (out.size >= over) break
        if (!out.has(m) && pass(m)) out.add(m)
      }
    drop.push(...keep.filter((m) => out.has(m)))
    keep = keep.filter((m) => !out.has(m))
  }
  return { keep, drop }
}
