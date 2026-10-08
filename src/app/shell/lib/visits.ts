/**
 * Visits per device (never synced, never in backups, exports or requests): how often this browser opened
 * each page, for FREQUENT (sidebar, ⌘K) and as a tie-breaker in ⌘K search. localStorage
 * `one.shell.visits:<kind>:<id>` (local:local / cloud:<id>) — wiped by the local reset (prefix one.shell.)
 * and with a team workspace's copy (cloud/device.ts). Only noteVisit() writes; scoring in frecency.ts.
 * RECENT is the workspace's own list (`Workspace.recent`, touchRecent — per device already).
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { activeWorkspace, isDeviceCopyGoing, useCloud, type WorkspaceRef } from '../../cloud'
import type { ID, Page } from '../../store/types'
import { bump, emptyVisits, parseVisits, prune, rankFrequent, scoreAt, serializeVisits, validId, type VisitMap } from './frecency'

export const visitsKey = (scope: string) => `one.shell.visits:${scope}`
/** a page counts as visited after this long in the main column */
export const VISIT_DWELL_MS = 1500

const scopeOf = (ref: WorkspaceRef) => `${ref.kind}:${ref.id}`

interface VisitsState {
  /** `<kind>:<id>` of the workspace the map belongs to */
  scope: string
  map: Readonly<VisitMap>
}

function load(scope: string): VisitsState {
  return { scope, map: parseVisits(safeLocalGet(visitsKey(scope)), Date.now()) }
}

/** Read synchronously at start (no late pop-in of FREQUENT), again when the workspace or another tab changes it. */
export const useVisits = create<VisitsState>()(() => load(scopeOf(activeWorkspace())))

function ensureScope(ref: WorkspaceRef = activeWorkspace()): VisitsState {
  const scope = scopeOf(ref)
  if (useVisits.getState().scope !== scope) useVisits.setState(load(scope))
  return useVisits.getState()
}

if (typeof window !== 'undefined') {
  // another tab counted a visit (or cleared the list): the same list here
  window.addEventListener('storage', (e) => {
    const { scope } = useVisits.getState()
    if (e.key === null || e.key === visitsKey(scope)) useVisits.setState(load(scope))
  })
  useCloud.subscribe((c, prev) => {
    if (c.active !== prev.active) ensureScope(c.active)
  })
}

/** The page counted last (another page counted since this one's visit makes coming back count sooner). */
function lastCounted(map: VisitMap): string | null {
  let best: string | null = null
  let t = -Infinity
  for (const [id, v] of Object.entries(map))
    if (v.t > t) {
      t = v.t
      best = id
    }
  return best
}

/** Count a visit of a page (the main column, after VISIT_DWELL_MS). */
export function noteVisit(id: ID, now = Date.now()): void {
  if (!validId(id)) return
  const ref = activeWorkspace()
  // a copy on its way out keeps nothing new
  if (ref.kind === 'cloud' && isDeviceCopyGoing(ref.id)) return
  const { scope } = ensureScope(ref)
  // what is stored now (another tab may have counted since the last storage event)
  const map = parseVisits(safeLocalGet(visitsKey(scope)), now)
  const prev = map[id]
  const next = bump(prev, now, lastCounted(map) !== id)
  if (next === prev) return
  const merged = emptyVisits()
  Object.assign(merged, map)
  merged[id] = next
  const out = prune(merged, now)
  useVisits.setState({ map: out })
  safeLocalSet(visitsKey(scope), serializeVisits(out))
}

/** Forget this device's visits of the open workspace. */
export function clearVisits(): void {
  const { scope } = ensureScope()
  useVisits.setState({ map: emptyVisits() })
  safeLocalSet(visitsKey(scope), null)
}

/** How often (and how lately) this device opened a page — ⌘K's tie-breaker. */
export function visitScore(id: ID, now = Date.now()): number {
  const v = useVisits.getState().map[id]
  return v ? scoreAt(v, now) : 0
}

/** Shown in lists: there, not in the trash, not a template's page. */
const visible = (pages: Record<ID, Page>, id: ID) => !!pages[id] && !isEffectivelyTrashed(pages, id) && !inTemplate(pages, id)

/** FREQUENT as pages (⌘K's empty field). */
export function frequentPages(pages: Record<ID, Page>, map: Readonly<VisitMap>, now: number, limit: number, exclude: ReadonlySet<ID>): Page[] {
  const out: Page[] = []
  for (const id of rankFrequent(map, now)) {
    if (out.length >= limit) break
    if (!exclude.has(id) && visible(pages, id)) out.push(pages[id])
  }
  return out
}

/** RECENT as pages (newest first). */
export function recentPages(pages: Record<ID, Page>, recent: readonly ID[], limit: number, exclude: ReadonlySet<ID>): Page[] {
  const out: Page[] = []
  for (const id of recent) {
    if (out.length >= limit) break
    if (!exclude.has(id) && visible(pages, id)) out.push(pages[id])
  }
  return out
}

/** RECENT ids (the workspace's recent list), without `exclude` (the open page). */
export function useRecentIds(limit: number, exclude: ID | null): ID[] {
  return useWorkspace(
    useShallow((s) => {
      const out: ID[] = []
      for (const id of s.recent) {
        if (out.length >= limit) break
        if (id !== exclude && visible(s.pages, id)) out.push(id)
      }
      return out
    }),
  )
}

/** FREQUENT ids (this device's visits), best first. */
export function useFrequentIds(limit: number): ID[] {
  const map = useVisits((s) => s.map)
  const ranked = useMemo(() => rankFrequent(map, Date.now()), [map])
  return useWorkspace(
    useShallow((s) => {
      const out: ID[] = []
      for (const id of ranked) {
        if (out.length >= limit) break
        if (visible(s.pages, id)) out.push(id)
      }
      return out
    }),
  )
}
