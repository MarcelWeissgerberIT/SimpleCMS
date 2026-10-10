/**
 * CHANGED per mirror (slice 1): the slip kept the row's source fields at draft time (comment count, last comment's
 * time, source status, changed at). When they change later — a mirror run, typically — the slip's `lastCheck` says
 * what changed and quotes the newest comment; the CHANGED lamp lights and the band asks Hold / Redraft / Send anyway.
 * Honest about its source: "per mirror 07:30", not a live read (slice 2's pre-read replaces it). Replies this device
 * marked sent on the row since explain a comment count going up (and the newest comment when it is one of them).
 */
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { rowChanges } from './fields'
import { readRow } from './provenance'
import { roleNamesFor } from './routes'
import { mutateSlip, outboxReady, useOutbox, withLog } from './store'
import { slipText } from './text'
import { SENT_STATES, type Slip } from './types'

const watched = (s: Slip) => (s.state === 'ready' || s.state === 'held' || s.state === 'missing' || s.state === 'failed') && !!s.baseline

const same = (a: Slip['lastCheck'], b: Array<{ field: string; before: string; now: string }>, latest?: string) =>
  !!a && a.changed.length === b.length && a.changed.every((c, i) => c.field === b[i].field && c.before === b[i].before && c.now === b[i].now) && (a.latest ?? '') === (latest ?? '')

/** Own replies on a row since `at` (their texts). */
function ownTexts(rowId: ID, at: number): string[] {
  return Object.values(useOutbox.getState().slips)
    .filter((s) => s.target.rowId === rowId && SENT_STATES.includes(s.state) && (s.receipt?.at ?? 0) >= at)
    .map(slipText)
    .filter(Boolean)
}

export async function checkRows(rowIds: Iterable<ID>): Promise<void> {
  const rows = new Set(rowIds)
  const slips = Object.values(useOutbox.getState().slips).filter((s) => watched(s) && rows.has(s.target.rowId))
  for (const s of slips) {
    const read = readRow(s.target.rowId, roleNamesFor(s.route.profileId))
    if (!read || !s.baseline) continue
    const changed = rowChanges(s.baseline.fields, read.fields, { texts: ownTexts(s.target.rowId, s.baseline.at), latest: read.latest }).map((c) => ({ ...c, ...(s.baseline?.labels?.[c.field] ? { label: s.baseline.labels[c.field] } : {}) }))
    const latest = changed.length && read.latest && read.latest !== s.baseline.latest ? read.latest.slice(0, 600) : undefined
    if (!changed.length ? !s.lastCheck : same(s.lastCheck, changed, latest)) continue
    await mutateSlip(s.id, (cur) => {
      if (!watched(cur)) return cur
      if (!changed.length) {
        if (!cur.lastCheck) return cur
        const { lastCheck: _gone, ...rest } = cur
        return rest
      }
      if (same(cur.lastCheck, changed, latest)) return cur
      return withLog({ ...cur, lastCheck: { at: Date.now(), from: 'row', changed, ...(latest ? { latest } : {}) } }, 'changed.mirror', { n: changed.length })
    })
  }
}

let started = false

/** Watch the rows of open slips (start once, after the slips are loaded). */
export function startWatch(): () => void {
  if (started) return () => {}
  started = true
  const pending = new Set<ID>()
  let timer: number | undefined
  const flush = () => {
    timer = undefined
    const ids = [...pending]
    pending.clear()
    void checkRows(ids).catch((e) => console.warn('[one] outbox check failed', e))
  }
  void outboxReady().then(() => checkRows(Object.values(useOutbox.getState().slips).map((s) => s.target.rowId)))
  const off = useWorkspace.subscribe((st, prev) => {
    if (st.pages === prev.pages || !useOutbox.getState().loaded) return
    for (const s of Object.values(useOutbox.getState().slips)) if (watched(s) && st.pages[s.target.rowId] !== prev.pages[s.target.rowId]) pending.add(s.target.rowId)
    if (pending.size && timer === undefined) timer = window.setTimeout(flush, 60)
  })
  return () => {
    started = false
    off()
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
