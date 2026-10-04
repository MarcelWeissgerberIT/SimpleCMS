/**
 * Custom agents — the browser runner. One tab per workspace leads (a Web Lock held for the tab's
 * lifetime; without Web Locks a BroadcastChannel heartbeat elects the oldest tab) and runs the
 * enabled agents with runner 'browser':
 *  - schedules: checked every 30 s; a slot missed while One was closed runs ONCE on the next open
 *    (the newest due slot only, never one run per missed slot)
 *  - row_created / row_changed: store changes diffed like the automations engine does (local and
 *    remote changes alike — rows from other tabs, other devices, form answers, synced mails); bursts
 *    are coalesced: one run per agent per minute with all its rows as the trigger detail
 * In a team workspace a browser agent runs in its creator's browser only (else every member's open
 * tab would run it). The agents' own writes never trigger agents.
 */
import { pageChanges, useWorkspace } from '../../store/store'
import { inTemplate } from '../../store/selectors'
import type { CustomAgent, Database, ID, Page, PropertyDef } from '../../store/types'
import { useCloud } from '../../cloud'
import { sameValue } from '../automations/engine'
import { t } from '../../i18n'
import { isAgentWriting, startAttributionKeeper } from './attribution'
import { executeRun, isRunningAnywhere } from './exec'
import { latestSlot } from './schedule'
import { forgetSlots, getSlot, loadRuns, putRun, setSlot, useAgentRuns } from './runs'
import { newId } from '../../lib/ids'

export const TICK_MS = 30_000
/** quiet time after the last row event before a trigger run starts */
export const TRIGGER_QUIET_MS = 3_000
/** at most one trigger run per agent per minute */
export const TRIGGER_GAP_MS = 60_000
/** a new row waits for a title, but never longer than this */
const UNTITLED_MAX_MS = 15_000

const COMPUTED = new Set<PropertyDef['type']>(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

const wsKey = () => {
  const a = useCloud.getState().active
  return `${a.kind}:${a.id}`
}

/** Does this browser run the agent? */
export function runsHere(agent: CustomAgent): boolean {
  if (!agent.enabled || agent.runner !== 'browser') return false
  const c = useCloud.getState()
  if (c.active.kind !== 'cloud') return true
  return !!c.user && agent.createdBy === c.user.id && !c.readOnly
}

const mine = (): CustomAgent[] => Object.values(useWorkspace.getState().agents ?? {}).filter(runsHere)

/* ------------------------------------------------------------------ */
/* Leader                                                              */
/* ------------------------------------------------------------------ */

let leader = false
const leaderListeners = new Set<(on: boolean) => void>()
export const isLeader = () => leader
export function onLeader(fn: (on: boolean) => void): () => void {
  leaderListeners.add(fn)
  return () => leaderListeners.delete(fn)
}

function setLeader(on: boolean) {
  if (leader === on) return
  leader = on
  leaderListeners.forEach((l) => l(on))
  if (on) lead()
  else stopLeading()
}

/** Ask for the leader lock (held until the tab goes away). */
function elect(): () => void {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) {
    let release: (() => void) | null = null
    const ac = new AbortController()
    locks
      .request(`one-agents-leader:${wsKey()}`, { signal: ac.signal }, () => {
        setLeader(true)
        return new Promise<void>((r) => (release = r))
      })
      .catch(() => {
        /* aborted */
      })
    return () => {
      ac.abort()
      release?.()
      setLeader(false)
    }
  }
  return electByHeartbeat()
}

/** Fallback without Web Locks: the oldest tab that still beats leads. */
function electByHeartbeat(): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    setLeader(true)
    return () => setLeader(false)
  }
  const me = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const ch = new BroadcastChannel(`one-agents-leader:${wsKey()}`)
  const seen = new Map<string, number>()
  const beat = () => {
    ch.postMessage({ tab: me })
    const now = Date.now()
    for (const [tab, at] of seen) if (now - at > 12_000) seen.delete(tab)
    setLeader([me, ...seen.keys()].sort()[0] === me)
  }
  ch.onmessage = (e: MessageEvent) => {
    const tab = (e.data as { tab?: string; bye?: boolean } | null)?.tab
    if (typeof tab !== 'string') return
    if ((e.data as { bye?: boolean }).bye) seen.delete(tab)
    else seen.set(tab, Date.now())
  }
  const timer = window.setInterval(beat, 4000)
  const bye = () => ch.postMessage({ tab: me, bye: true })
  window.addEventListener('pagehide', bye)
  window.setTimeout(beat, 300)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('pagehide', bye)
    bye()
    ch.close()
    setLeader(false)
  }
}

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

let tickTimer = 0
let ticking = false

/** One schedule pass (leader only): every agent whose newest slot is new runs once. */
export async function tick(now = Date.now()): Promise<void> {
  if (!leader || ticking || !useWorkspace.getState().ready) return
  ticking = true
  try {
    for (const agent of mine()) {
      if (agent.trigger.type !== 'schedule') continue
      const slot = latestSlot(agent.trigger, now)
      if (slot === null) continue
      const last = await getSlot(agent.id)
      // slots before the agent (or its last change) existed don't count
      if (slot <= Math.max(last ?? 0, agent.updatedAt)) continue
      await setSlot(agent.id, slot)
      const detail = `schedule ${agent.trigger.at}`
      if (await isRunningAnywhere(agent.id)) {
        await putRun({ id: newId(), agentId: agent.id, runner: 'browser', trigger: { type: 'schedule', detail }, startedAt: Date.now(), endedAt: Date.now(), status: 'skipped', summary: t('features.agents.run.skipped'), steps: [] })
        continue
      }
      void executeRun(agent, { trigger: { type: 'schedule', detail } })
    }
  } catch (e) {
    console.error('[one] agents: schedule check failed', e)
  } finally {
    ticking = false
  }
}

/* ------------------------------------------------------------------ */
/* Row triggers                                                        */
/* ------------------------------------------------------------------ */

interface Pending {
  rows: Set<ID>
  firstAt: number
  timer: number
}
const pending = new Map<ID, Pending>()
const lastTriggerRun = new Map<ID, number>()

/** When the pending rows of an agent run: after a quiet moment (capped), at most once a minute. */
function due(agentId: ID): number {
  const p = pending.get(agentId)
  const quiet = Math.min(Date.now() + TRIGGER_QUIET_MS, (p?.firstAt ?? Date.now()) + UNTITLED_MAX_MS)
  return Math.max(quiet, (lastTriggerRun.get(agentId) ?? 0) + TRIGGER_GAP_MS)
}

function arm(agentId: ID) {
  const p = pending.get(agentId)
  if (!p) return
  window.clearTimeout(p.timer)
  p.timer = window.setTimeout(() => void flushTrigger(agentId), Math.max(0, due(agentId) - Date.now()))
}

function queueRows(agent: CustomAgent, rows: ID[]) {
  let p = pending.get(agent.id)
  if (!p) {
    p = { rows: new Set(), firstAt: Date.now(), timer: 0 }
    pending.set(agent.id, p)
  }
  for (const id of rows) p.rows.add(id)
  arm(agent.id)
}

async function flushTrigger(agentId: ID) {
  const p = pending.get(agentId)
  if (!p || !leader) return
  const agent = useWorkspace.getState().agents?.[agentId]
  if (!agent || !runsHere(agent) || (agent.trigger.type !== 'row_created' && agent.trigger.type !== 'row_changed')) {
    pending.delete(agentId)
    return
  }
  const pages = useWorkspace.getState().pages
  const rows = [...p.rows].filter((id) => pages[id] && !pages[id].trashed)
  if (!rows.length) {
    pending.delete(agentId)
    return
  }
  // a new row still being typed: wait for its title (up to the cap)
  if (agent.trigger.type === 'row_created' && rows.some((id) => !pages[id].title.trim()) && Date.now() - p.firstAt < UNTITLED_MAX_MS) {
    p.timer = window.setTimeout(() => void flushTrigger(agentId), 1000)
    return
  }
  if (await isRunningAnywhere(agentId)) {
    p.timer = window.setTimeout(() => void flushTrigger(agentId), 5000)
    return
  }
  pending.delete(agentId)
  lastTriggerRun.set(agentId, Date.now())
  const titles = rows.map((id) => pages[id].title.trim() || t('common.untitled'))
  const detail = `${rows.length} · ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ' …' : ''}`
  const res = await executeRun(agent, { trigger: { type: agent.trigger.type, detail }, rows })
  // another tab started it in between: the rows wait for the next run
  if (res === 'busy') queueRows(agent, rows)
}

function changedProps(db: Database, before: Page, page: Page, only: ID | null): boolean {
  for (const prop of db.properties) {
    if (COMPUTED.has(prop.type) || (only && prop.id !== only)) continue
    if (prop.type === 'title' ? before.title !== page.title : !sameValue(before.properties[prop.id], page.properties[prop.id])) return true
  }
  return false
}

/** Rows the store change created / changed, per watching agent (the engine's rules, features/automations). */
function diff(state: ReturnType<typeof useWorkspace.getState>, prev: ReturnType<typeof useWorkspace.getState>) {
  const watching = mine().filter((a) => a.trigger.type === 'row_created' || a.trigger.type === 'row_changed')
  if (!watching.length) return
  const { changed } = pageChanges(state.pages, prev.pages)
  if (!changed.length) return
  const hits = new Map<ID, ID[]>()
  for (const id of changed) {
    const page = state.pages[id]
    if (!page.databaseId || page.trashed) continue
    const db = state.databases[page.databaseId]
    if (!db || inTemplate(state.pages, db.id)) continue
    const before = prev.pages[id]
    for (const agent of watching) {
      const trig = agent.trigger
      if ((trig.type !== 'row_created' && trig.type !== 'row_changed') || trig.databaseId !== db.id) continue
      let hit = false
      // a database created in the same update (import / template) doesn't count
      if (trig.type === 'row_created') hit = !before && !!prev.pages[db.id]
      else if (before && !before.trashed) hit = changedProps(db, before, page, trig.propertyId)
      if (hit) hits.set(agent.id, [...(hits.get(agent.id) ?? []), id])
      // an edit of a row that waits to report "created" restarts its quiet time
      else if (pending.get(agent.id)?.rows.has(id)) arm(agent.id)
    }
  }
  for (const [agentId, rows] of hits) {
    const agent = state.agents?.[agentId]
    if (agent) queueRows(agent, rows)
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

let unsubStore: (() => void) | null = null

function lead() {
  window.clearInterval(tickTimer)
  // another tab may have advanced the slots while it led
  forgetSlots()
  tickTimer = window.setInterval(() => void tick(), TICK_MS)
  void tick()
  unsubStore?.()
  unsubStore = useWorkspace.subscribe((state, prev) => {
    if (state.pages === prev.pages || !state.ready || !prev.ready || isAgentWriting()) return
    try {
      diff(state, prev)
    } catch (e) {
      console.error('[one] agents: trigger check failed', e)
    }
  })
  void sweepInterrupted()
}

function stopLeading() {
  window.clearInterval(tickTimer)
  unsubStore?.()
  unsubStore = null
  for (const p of pending.values()) window.clearTimeout(p.timer)
  pending.clear()
}

/** Runs left "running" by a tab that went away: marked as interrupted. */
async function sweepInterrupted() {
  for (const agent of Object.values(useWorkspace.getState().agents ?? {})) {
    if (agent.runner !== 'browser') continue
    const runs = await loadRuns(agent.id)
    const stale = runs.filter((r) => r.status === 'running')
    if (!stale.length || (await isRunningAnywhere(agent.id))) continue
    for (const r of stale) await putRun({ ...r, status: 'error', endedAt: r.endedAt ?? Date.now(), error: t('features.agents.run.interrupted') })
  }
}

let started = false
let stopElection: (() => void) | null = null

/** Start the browser runner (main.tsx, once after hydrate). Returns a stop function. */
export function startAgents(): () => void {
  if (started) return () => {}
  started = true
  const stopKeeper = startAttributionKeeper()
  stopElection = elect()
  // the runs of every agent: the sidebar badge counts what waits for review
  const loadAll = () => {
    for (const id of Object.keys(useWorkspace.getState().agents ?? {})) if (!(id in useAgentRuns.getState().byAgent)) void loadRuns(id)
  }
  loadAll()
  const unsubAgents = useWorkspace.subscribe((s, p) => {
    if (s.agents !== p.agents) {
      loadAll()
      // a schedule edited to a time that is due: no need to wait for the next check
      if (leader) window.setTimeout(() => void tick(), 50)
    }
  })
  return () => {
    started = false
    unsubAgents()
    stopKeeper()
    stopElection?.()
    stopElection = null
    stopLeading()
  }
}
