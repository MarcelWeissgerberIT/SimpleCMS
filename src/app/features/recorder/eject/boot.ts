/**
 * Finishing ejects a tab left half done (design §6.4 boot, C3, Δ27): after the start-up recovery, once the store is
 * ready and reads the scope, under the scope's eject lock (busy: the next boot tries again) — every record still
 * 'committing' whose tab is gone (its Web Lock free) is compared with the places as they are: a place whose decided
 * parts (and restored block runs) are what the eject's targets say counts as ejected; the sources are settled for
 * exactly the changes of those places and the record is 'done' with those outcomes — none: 'aborted'. A crash can
 * never leave a review "applied" for work that was reverted. Never writes the workspace.
 */
import { useWorkspace } from '../../../store/store'
import type { EjectRecord, Outcome, PlaceKey, Scope } from '../model/types'
import { liveTabs } from '../journal/prune'
import { recorder } from '../journal/recorder'
import { scopeNow } from '../journal/scope'
import { withEjectLock, withSourceLock } from './commit'
import { blockListOf, canEject } from './plan'
import { ejectsOf, getEject, putEject } from './records'
import { settle } from './sources'
import { objectIn, partDigests } from './targets'

/** Does `list` hold `seq` as a run of consecutive entries? */
const holdsRun = (list: readonly string[], seq: readonly string[]): boolean => {
  if (!seq.length) return true
  for (let i = 0; i + seq.length <= list.length; i++) if (seq.every((b, k) => list[i + k] === b)) return true
  return false
}

/** The places of a record whose decided parts are what its targets say (as the store is now). */
export async function placesAsTargeted(r: EjectRecord): Promise<Set<PlaceKey>> {
  const s = useWorkspace.getState()
  const state = { pages: s.pages, databases: s.databases }
  const out = new Set<PlaceKey>()
  for (const [p, t] of Object.entries(r.targets) as Array<[PlaceKey, EjectRecord['targets'][PlaceKey]]>) {
    const obj = objectIn(state, p)
    const parts = await partDigests(r.s, obj, Object.keys(t.parts))
    if (Object.entries(t.parts).some(([k, d]) => parts[k] !== d)) continue
    if (t.blocks?.length) {
      const content = obj && (obj.kind === 'page' || obj.kind === 'row') ? obj.page.content : null
      const list = (await blockListOf(r.s, content))?.strings ?? []
      if (!t.blocks.every((seq) => holdsRun(list, seq))) continue
    }
    out.add(p)
  }
  return out
}

/** Finish one record a gone tab left 'committing' (inside the eject lock and the source lock). */
async function finishOne(r: EjectRecord): Promise<boolean> {
  const matched = await placesAsTargeted(r)
  if (!matched.size) {
    await putEject({ ...r, state: 'aborted' })
    return false
  }
  const outcomes: Record<PlaceKey, Outcome> = { ...r.outcomes }
  let lost = 0
  for (const p of Object.keys(r.targets) as PlaceKey[])
    if (!matched.has(p)) {
      outcomes[p] = 'held'
      lost++
    }
  const counts = { ...r.counts, back: r.counts.back - lost, held: r.counts.held + lost }
  const settled = await settle({ ...r, outcomes })
  await putEject({ ...r, state: 'done', outcomes, counts, ...(settled.agent ? { agent: settled.agent } : {}), ...(settled.slips ? { slips: settled.slips } : {}) })
  return true
}

/** Finish the scope's half-done ejects of gone tabs. Resolves how many were finished as 'done'. */
export async function finishEjects(scope: Scope = scopeNow()): Promise<number> {
  const s = useWorkspace.getState()
  if (!s.ready || scopeNow() !== scope || !canEject(scope)) return 0
  const open = (await ejectsOf(scope)).filter((r) => r.state === 'committing')
  if (!open.length) return 0
  // without Web Locks nobody can tell a gone tab from a busy one: nothing is finished
  const live = await liveTabs()
  if (!live) return 0
  const own = recorder()?.tab
  const gone = open.filter((r) => r.tab !== own && !live.has(r.tab))
  if (!gone.length) return 0
  const res = await withEjectLock(scope, async () => {
    let n = 0
    for (const r0 of gone) {
      const r = await getEject(r0.id)
      if (!r || r.state !== 'committing') continue
      if (await withSourceLock({ lane: r.lane, run: r.writer }, () => finishOne(r))) n++
    }
    return n
  })
  return res === 'busy' ? 0 : res
}
