/**
 * THE OUTBOX ("Ausgang") — public API, the only door (docs/OUTBOX.md). Reviewed write-backs to MCP servers: a slip is
 * ONE tool call to a profile's send route (IntegrationProfile.sends), staged — never sent — by a feature or the
 * person, checked by the person (the exact inputs, what foreign text shaped it, what changed since the draft) and
 * sent by the person's own hand. Slice 1 sends by hand only: nothing leaves One; "Mark as sent" writes the row patch
 * (one version, "Reset row"), archives the answered inbox notes and keeps a receipt. Slips and receipts stay on this
 * device (IndexedDB `one-outbox`), never synced, exported or backed up.
 *
 *  - startOutbox(): background service (main.tsx, once after the workspace loads) · outboxReady()
 *  - routes: routesFor(dbId) · routeByRole(dbId, role) · routeById(dbId, routeId) · listRoutes()
 *  - creating (never sends): stageSlip(input) · stageGroup(group, items) · draftSlip({ route, rowId, instruction?,
 *    mentions?, origin, signal? }) — Claude drafts in a request with NO tools
 *  - changing: replaceDraft(id, text, by) · setIncluded(id, on) · withdrawSlip(id, by) · withdrawGroup(groupId, by)
 *  - reading: useSlip(id) · useSlips(q) · getSlips(q) · onSlipsChanged(fn) · groupState(id) · useGroupState(id) ·
 *    useOutboxCounts(dbId?) · outboxCounts(slips, dbId?) · ownSends(rowId, since?) · readTarget (slice 2: refused)
 *  - navigation + UI: openOutbox(q?) · openSlip(id) · OutboxDockSlot { pageId } · OutboxDbFoot { dbId } ·
 *    OutboxRoute { slip? } · OutboxHost (mount once) · OutboxNavBadge · useOutboxVisible() · OutboxStatusCell ·
 *    OutboxTreeCount { dbId } · OutboxReadout { dbId } · RowSlips { pageId }
 *  - outboxCommands(dbId): the database commands of its routes (features/commands)
 * NOT exported, ever: a sender — slice 2's `fire` / `Arm` live only behind ui/Guard.
 */
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { useInbox, addInboxItems, wsKey } from '../inbox/state'
import { activeWorkspace } from '../../cloud'
import { withdrawSlip as withdrawOne, replaceDraft, setIncluded } from './actions'
import { outboxCounts } from './counts'
import { draftSlip } from './draft'
import { groupState } from './hooks'
import { routesFor } from './routes'
import { stage } from './stage'
import { getSlips, startOutbox as startStore, useOutbox } from './store'
import { startWatch } from './watch'
import { SENT_STATES, type OwnSend, type SlipId, type SlipView, type StageInput, type StageRefusal, type RouteRef, type TargetRead } from './types'
import './outbox.css'
// the Outbox's Preflight lamp (registered through features/preflight/registry, dependency-free)
import './lamp'

export type {
  SlipView,
  SlipState,
  Receipt,
  SourceInput,
  SourceRef,
  ResolvedRoute,
  RouteRef,
  SlipOrigin,
  StageRefusal,
  GroupState,
  OwnSend,
  TargetRead,
  OutboxCounts,
  StageInput,
  SlipQuery,
  SlipId,
} from './types'

export { routesFor, routeByRole, routeById, listRoutes } from './routes'
export { draftSlip } from './draft'
export { replaceDraft, setIncluded } from './actions'
export { useSlip, useSlips, useOutboxCounts, groupState, useGroupState, openOutbox, openSlip } from './hooks'
export { getSlips, onSlipsChanged, outboxReady } from './store'
export { outboxCounts } from './counts'
export { outboxCommands } from './commands'
export { OutboxDockSlot, OutboxDbFoot, OutboxRoute, OutboxHost } from './ui/slots'
export { OutboxNavBadge, OutboxStatusCell, OutboxTreeCount, OutboxReadout, RowSlips, useOutboxVisible } from './ui/shell'

/** Stage a slip (never sends). The caller's sources are judged by the Outbox — its trust is never taken. */
export function stageSlip(i: StageInput) {
  return stage(i)
}

/** Stage a group (Round trip): all or nothing — a refusal withdraws the ones staged before it. */
export async function stageGroup(g: { id: string; label: string }, items: Array<Omit<StageInput, 'group'> & { include?: boolean }>): Promise<{ slips: SlipView[] } | { refused: StageRefusal; index: number }> {
  const made: SlipId[] = []
  const slips: SlipView[] = []
  for (let i = 0; i < items.length; i++) {
    const { include, ...rest } = items[i]
    const res = await stage({ ...rest, group: { id: g.id, label: g.label, order: i, include: include !== false } })
    if ('refused' in res) {
      for (const id of made) await withdrawOne(id, 'origin')
      return { refused: res.refused, index: i }
    }
    made.push(res.slip.id)
    slips.push(res.slip)
  }
  return { slips }
}

export function withdrawSlip(id: SlipId, by: 'person' | 'origin') {
  return withdrawOne(id, by)
}

/** Withdraw a group's unsent slips (Round trip's rework). */
export async function withdrawGroup(groupId: string, by: 'person' | 'origin'): Promise<{ withdrawn: SlipId[]; tooLate: SlipId[] }> {
  const withdrawn: SlipId[] = []
  const tooLate: SlipId[] = []
  for (const s of getSlips({ groupId })) {
    if (s.state === 'withdrawn') continue
    const r = await withdrawOne(s.id, by)
    if (r === 'withdrawn') withdrawn.push(s.id)
    else if (r === 'too-late') tooLate.push(s.id)
  }
  return { withdrawn, tooLate }
}

/** What this device sent for a row (values from the args, ids a read-back captured) — another device sees none. */
export function ownSends(rowId: ID, since = 0): OwnSend[] {
  return getSlips({ rowId })
    .filter((s) => SENT_STATES.includes(s.state) && s.receipt && s.receipt.at >= since)
    .map((s) => ({ slipId: s.id, ...(s.route.role ? { role: s.route.role } : {}), tool: s.route.tool, at: s.receipt!.at, values: { ...s.args }, ids: { ...s.receipt!.result.ids }, state: s.state }))
}

/** Slice 2: the route's pre-read through the worker. Not built yet — always refused here. */
export async function readTarget(_route: RouteRef, _rowId: ID): Promise<TargetRead | { refused: 'noWorker' | 'probe' | 'noCheck' | 'error'; detail?: string }> {
  return { refused: 'noWorker' }
}

/** Load this workspace's slips, keep the tabs in step, watch the rows of open slips. Once, from main.tsx. */
export function startOutbox(): () => void {
  const a = startStore()
  const b = startWatch()
  // test hook (dev, or ?e2e): stage / withdraw / read like a later feature would — never a send
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')) {
    ;(window as unknown as { __oneOutbox?: unknown }).__oneOutbox = {
      useOutbox,
      stageSlip,
      stageGroup,
      draftSlip,
      replaceDraft,
      setIncluded,
      withdrawSlip,
      withdrawGroup,
      groupState,
      ownSends,
      getSlips,
      routesFor,
      counts: (dbId?: ID) => outboxCounts(Object.values(useOutbox.getState().slips), dbId),
      /** an inbox note as a mirror agent leaves it (notify_me) */
      addAgentNote: (pageId: ID, agentId: ID, text: string) =>
        addInboxItems(wsKey(activeWorkspace()), [{ id: `g:e2e${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, kind: 'agent', pageId, at: Date.now(), excerpt: text, agentId, runId: 'e2e' }]),
      inbox: () => useInbox.getState().data.items,
      workspace: useWorkspace,
    }
  }
  return () => {
    a()
    b()
  }
}
